// Servidor do Malha: entrega o app web e uma API mínima de sincronização celular ↔ relógio.
// Sem dependências externas. Dados em DATA_DIR/sync.json (use um volume persistente no Coolify).
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 80;
const PUBLIC = path.join(__dirname, 'public');
const DATA_DIR = process.env.DATA_DIR || '/data';
const DATA_FILE = path.join(DATA_DIR, 'sync.json');
const MAX_BODY = 512 * 1024;
const MAX_HISTORY = 500;
const CODE_RE = /^[0-9]{6}$/; // só números: fácil de digitar no teclado numérico do relógio

// Limita quem tenta adivinhar códigos: no máximo 30 códigos inexistentes por IP a cada 10 min
const misses = new Map();
function tooManyMisses(ip) {
  const now = Date.now();
  const m = misses.get(ip);
  if (!m || now - m.since > 600000) return false;
  return m.count >= 30;
}
function countMiss(ip) {
  const now = Date.now();
  const m = misses.get(ip);
  if (!m || now - m.since > 600000) misses.set(ip, { since: now, count: 1 });
  else m.count++;
  if (misses.size > 10000) misses.clear();
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// ---------- armazenamento ----------
let db = {};
try { db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { db = {}; }

let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(DATA_FILE + '.tmp', JSON.stringify(db));
      fs.renameSync(DATA_FILE + '.tmp', DATA_FILE);
    } catch (err) {
      console.error('Não foi possível salvar os dados:', err.message);
    }
  }, 500);
}

const hash = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

function tokenOk(rec, req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token || !rec) return false;
  const a = Buffer.from(hash(token)), b = Buffer.from(rec.tokenHash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------- utilidades HTTP ----------
function send(res, status, body, headers = {}) {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': typeof body === 'object' && !Buffer.isBuffer(body) ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
    ...headers,
  });
  res.end(data);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('muito grande'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(Object.assign(new Error('JSON inválido'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

// ---------- API ----------
async function api(req, res, parts) {
  // parts: ['api', 'sync', CODE, ('history')?]
  const code = parts[2] || '';
  if (parts[1] !== 'sync' || !CODE_RE.test(code)) return send(res, 404, { error: 'não encontrado' });
  // O proxy do Coolify acrescenta o IP real no fim da lista; o início pode ser forjado pelo cliente
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',').pop().trim();
  if (tooManyMisses(ip)) return send(res, 429, { error: 'muitas tentativas, aguarde alguns minutos' });
  const rec = db[code];
  const sub = parts[3];

  if (!sub) {
    if (req.method === 'GET') {
      if (!rec || !rec.payload) { countMiss(ip); return send(res, 404, { error: 'código não encontrado' }); }
      return send(res, 200, { ...rec.payload, updatedAt: rec.updatedAt });
    }
    if (req.method === 'PUT') {
      const body = await readJson(req);
      const auth = req.headers.authorization || '';
      if (!auth.startsWith('Bearer ') || auth.length < 20) return send(res, 401, { error: 'sem chave' });
      if (rec && !tokenOk(rec, req)) return send(res, 403, { error: 'código pertence a outro aparelho' });
      if (!body || typeof body.plans !== 'object') return send(res, 400, { error: 'plano inválido' });
      db[code] = {
        tokenHash: rec ? rec.tokenHash : hash(auth.slice(7)),
        payload: { plans: body.plans, exercises: body.exercises || {}, settings: body.settings || {} },
        updatedAt: new Date().toISOString(),
        history: rec ? rec.history || [] : [],
      };
      persist();
      return send(res, 200, { ok: true, updatedAt: db[code].updatedAt });
    }
  }

  if (sub === 'history') {
    if (!rec) return send(res, 404, { error: 'código não encontrado' });
    if (req.method === 'POST') {
      // O relógio envia treinos concluídos; ids repetidos são ignorados
      const body = await readJson(req);
      const entries = Array.isArray(body.entries) ? body.entries : [];
      const known = new Set(rec.history.map((e) => e.id));
      let added = 0;
      for (const e of entries) {
        if (e && typeof e.id === 'string' && !known.has(e.id)) { rec.history.push(e); known.add(e.id); added++; }
      }
      rec.history = rec.history.slice(-MAX_HISTORY);
      if (added) persist();
      return send(res, 200, { ok: true, added });
    }
    if (req.method === 'GET') {
      if (!tokenOk(rec, req)) return send(res, 403, { error: 'sem permissão' });
      return send(res, 200, { entries: rec.history });
    }
  }
  return send(res, 405, { error: 'método não permitido' });
}

// ---------- arquivos estáticos ----------
function serveStatic(req, res, pathname) {
  let file = path.normalize(path.join(PUBLIC, decodeURIComponent(pathname)));
  if (!file.startsWith(PUBLIC)) return send(res, 403, 'proibido');
  fs.stat(file, (err, st) => {
    if (!err && st.isDirectory()) file = path.join(file, 'index.html');
    else if (err) file = path.join(PUBLIC, 'index.html'); // rotas do app caem no index
    fs.readFile(file, (err2, data) => {
      if (err2) return send(res, 404, 'não encontrado');
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-cache', // arquivos sem hash no nome: sempre revalidar
      });
      res.end(req.method === 'HEAD' ? undefined : data);
    });
  });
}

http.createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, 'http://x');
    if (req.method === 'OPTIONS') return send(res, 204, '');
    if (pathname === '/healthz') return send(res, 200, 'ok');
    const parts = pathname.split('/').filter(Boolean);
    if (parts[0] === 'api') return await api(req, res, parts);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'método não permitido');
    return serveStatic(req, res, pathname);
  } catch (err) {
    send(res, err.status || 500, { error: err.status ? err.message : 'erro interno' });
    if (!err.status) console.error(err);
  }
}).listen(PORT, () => console.log(`Malha ouvindo na porta ${PORT}`));
