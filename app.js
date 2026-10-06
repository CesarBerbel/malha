'use strict';

const DAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const DEFAULT_SETTINGS = {
  restAlert: 60,       // segundos de descanso entre séries até começar a piscar
  hydrateAlert: 180,   // segundos de pausa entre exercícios (hidratação)
  alertRepeat: 15,     // repetir vibração/som a cada N segundos depois do limite
  vibrate: true,
  sound: true,
  keepAwake: true,
  weightStep: 2.5,     // kg somados/subtraídos pelos botões + e − durante o treino
  watchMode: 'auto',   // auto | on | off
};

// Cor e sigla de cada grupo muscular (avatares das listas)
const GROUP_META = {
  'Peito': { c: '#FF6B57', a: 'Pt' },
  'Costas': { c: '#4D9DFF', a: 'Ct' },
  'Ombros': { c: '#A78BFA', a: 'Om' },
  'Bíceps': { c: '#FBBF24', a: 'Bi' },
  'Tríceps': { c: '#F472B6', a: 'Tr' },
  'Pernas': { c: '#34D399', a: 'Pn' },
  'Glúteos': { c: '#FB923C', a: 'Gl' },
  'Panturrilha': { c: '#22D3EE', a: 'Pa' },
  'Abdômen': { c: '#94A3B8', a: 'Ab' },
};

// ---------- armazenamento ----------
const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem('malha.' + key); return v ? JSON.parse(v) : fallback; }
    catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('malha.' + key, JSON.stringify(value)); } catch { /* sem espaço / modo privado */ }
  },
};

const state = {
  tab: 'treino',
  settings: { ...DEFAULT_SETTINGS, ...store.get('settings', {}) },
  custom: store.get('custom', []),       // exercícios criados pelo usuário
  plans: store.get('plans', {}),         // { "1": { name, items: [{exId, sets, reps, weight, rest}] } }
  history: store.get('history', []),
  session: store.get('session', null),   // treino em andamento
  editDay: new Date().getDay(),
  treinoDay: null,
  picker: false,                         // gaveta de escolha de exercícios aberta
  libFilter: { q: '', group: '' },
  dialog: null,                          // { message, detail, ok, danger, resolve }
  lastDone: null,
  sync: store.get('sync', null),         // { code, token, pushedAt } – ligação com o app do relógio
};

const save = {
  settings: () => { store.set('settings', state.settings); schedulePush(); },
  custom: () => { store.set('custom', state.custom); schedulePush(); },
  plans: () => { store.set('plans', state.plans); schedulePush(); },
  history: () => store.set('history', state.history),
  session: () => store.set('session', state.session),
  sync: () => store.set('sync', state.sync),
};

// ---------- sincronização com o app do relógio ----------
// O celular é a fonte do plano: envia a cada mudança. O relógio devolve os treinos feitos.
const SYNC_ALPHABET = '0123456789'; // só números: o relógio tem teclado numérico próprio
const canSync = () => !!state.sync && location.protocol !== 'file:';

function randomCode(n = 6) {
  const a = crypto.getRandomValues(new Uint32Array(n));
  return [...a].map((x) => SYNC_ALPHABET[x % SYNC_ALPHABET.length]).join('');
}
function randomToken() {
  return [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function newId() {
  return Date.now().toString(36) + randomToken().slice(0, 8);
}

function syncPayload() {
  const exercises = {};
  Object.values(state.plans).forEach((p) => p.items.forEach((it) => {
    const e = exById(it.exId);
    exercises[it.exId] = { name: e.name, group: e.group };
  }));
  const { restAlert, hydrateAlert, alertRepeat, weightStep, vibrate } = state.settings;
  return { plans: state.plans, exercises, settings: { restAlert, hydrateAlert, alertRepeat, weightStep, vibrate } };
}

// Códigos antigos com letras viram números (mantém a chave secreta)
if (state.sync && !/^\d{6}$/.test(state.sync.code)) {
  state.sync = { ...state.sync, code: randomCode(), pushedAt: null };
  store.set('sync', state.sync);
}

let pushTimer = 0;
function schedulePush() {
  if (!canSync()) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => pushSync().catch(() => {}), 1200);
}

async function pushSync(retries = 2) {
  const s = state.sync;
  const res = await fetch(`/api/sync/${s.code}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.token}` },
    body: JSON.stringify(syncPayload()),
  });
  if (res.status === 403 && !s.pushedAt && retries > 0) {
    // Código recém-gerado já existia no servidor (raríssimo): sorteia outro
    s.code = randomCode();
    save.sync();
    return pushSync(retries - 1);
  }
  if (!res.ok) throw new Error(`sync ${res.status}`);
  s.pushedAt = new Date().toISOString();
  save.sync();
}

async function pullWatchHistory() {
  const s = state.sync;
  const res = await fetch(`/api/sync/${s.code}/history`, { headers: { Authorization: `Bearer ${s.token}` } });
  if (!res.ok) return 0;
  const { entries = [] } = await res.json();
  // Ids já importados (inclusive os que o usuário apagou depois) nunca voltam
  const imported = new Set(store.get('importedIds', []));
  state.history.forEach((h) => h.id && imported.add(h.id));
  const fresh = entries.filter((e) => e && e.id && !imported.has(e.id) && Array.isArray(e.exercises));
  if (!fresh.length) return 0;
  fresh.forEach((e) => imported.add(e.id));
  store.set('importedIds', [...imported].slice(-2000));
  state.history = [...state.history, ...fresh].sort((a, b) => new Date(b.date) - new Date(a.date));
  save.history();
  // A última carga usada no relógio passa a ser a carga do plano
  fresh.sort((a, b) => new Date(a.date) - new Date(b.date)).forEach((e) => {
    const plan = state.plans[e.day];
    if (!plan) return;
    e.exercises.forEach((x) => {
      const item = plan.items.find((it) => it.exId === x.exId);
      const last = (x.weights || []).filter((w) => w !== '' && w != null).pop();
      if (item && last != null) item.weight = String(last);
    });
  });
  save.plans();
  return fresh.length;
}

async function syncNow({ quiet = false } = {}) {
  if (!canSync()) return;
  try {
    await pushSync();
    const n = await pullWatchHistory();
    if (n) toast(plural(n, 'treino do relógio importado', 'treinos do relógio importados'));
    else if (!quiet) toast('Sincronizado com o relógio');
    if (n || (!quiet && state.tab === 'ajustes')) render();
  } catch {
    if (!quiet) toast('Sem conexão com o servidor');
  }
}

async function enableSync() {
  state.sync = { code: randomCode(), token: randomToken(), pushedAt: null };
  save.sync();
  render();
  await syncNow();
}

// ---------- utilidades ----------
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function allExercises() { return [...EXERCISES, ...state.custom]; }
function exById(id) { return allExercises().find((e) => e.id === id) || { id, name: '(exercício removido)', group: '' }; }
function dayPlan(day) { return state.plans[day] || { name: '', items: [] }; }

function fmt(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  const mm = String(m).padStart(2, '0'), ss = String(s).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function fmtSecs(sec) {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

function fmtDuration(ms) {
  const min = Math.round(ms / 60000);
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;
}

const parseKg = (v) => parseFloat(String(v ?? '').replace(',', '.'));
const fmtKg = (n) => String(Math.round(n * 100) / 100).replace('.', ',');

function estimateMin(items) {
  let sec = 0;
  items.forEach((it, i) => {
    sec += it.sets * 40 + (it.sets - 1) * (Number(it.rest) || state.settings.restAlert);
    if (i < items.length - 1) sec += state.settings.hydrateAlert;
  });
  return Math.max(1, Math.round(sec / 60));
}

function weightsLabel(weights) {
  const list = weights.filter((w) => w !== '' && w != null);
  if (!list.length) return '';
  const uniq = [...new Set(list)];
  return uniq.length === 1 ? `${uniq[0]} kg` : `${list.join(' / ')} kg`;
}

// ---------- ícones (traço no estilo Lucide) ----------
const ICONS = {
  dumbbell: '<path d="M14.4 14.4 9.6 9.6"/><path d="M18.66 21.49a2 2 0 1 1-2.83-2.83l-1.77 1.77a2 2 0 1 1-2.83-2.83l6.36-6.36a2 2 0 1 1 2.83 2.83l-1.77 1.77a2 2 0 1 1 2.83 2.83z"/><path d="m21.5 21.5-1.4-1.4"/><path d="M3.9 3.9 2.5 2.5"/><path d="M6.4 12.77a2 2 0 1 1-2.83-2.83l1.77-1.77a2 2 0 1 1-2.83-2.83l2.83-2.83a2 2 0 1 1 2.83 2.83l1.77-1.77a2 2 0 1 1 2.83 2.83z"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="3"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  chart: '<path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  play: '<path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.6-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z" fill="currentColor" stroke="none"/>',
  pause: '<rect x="6" y="4" width="4.5" height="16" rx="1.5" fill="currentColor" stroke="none"/><rect x="13.5" y="4" width="4.5" height="16" rx="1.5" fill="currentColor" stroke="none"/>',
  skip: '<path d="M5 5.5v13a1 1 0 0 0 1.55.83l9.4-6.5a1 1 0 0 0 0-1.66l-9.4-6.5A1 1 0 0 0 5 5.5z"/><path d="M19 5v14"/>',
  stop: '<rect x="5" y="5" width="14" height="14" rx="3"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  up: '<path d="m18 15-6-6-6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  droplet: '<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  trash: '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  layers: '<path d="m12 2 9 5-9 5-9-5 9-5z"/><path d="m3 17 9 5 9-5"/><path d="m3 12 9 5 9-5"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  watch: '<rect x="6" y="6" width="12" height="12" rx="3"/><path d="M9 6V2h6v4M9 18v4h6v-4"/>',
  heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
};

function icon(name, size = 22) {
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}

function avatar(group) {
  const g = GROUP_META[group] || { c: '#94A3B8', a: '··' };
  return `<span class="avatar" style="--c:${g.c}">${g.a}</span>`;
}

// ---------- modo relógio ----------
function isWatch() {
  const mode = state.settings.watchMode;
  if (mode === 'on' || new URLSearchParams(location.search).has('watch')) return true;
  if (mode === 'off') return false;
  return Math.min(innerWidth, innerHeight) <= 330 && Math.max(innerWidth, innerHeight) <= 500;
}

// ---------- alertas: som, vibração, tela ligada ----------
let audioCtx = null;
function unlockAudio() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) audioCtx = new AC();
  }
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
}

function beep(times = 2) {
  if (!state.settings.sound || !audioCtx) return;
  for (let i = 0; i < times; i++) {
    const t = audioCtx.currentTime + i * 0.25;
    const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.4, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t); osc.stop(t + 0.2);
  }
}

function buzz(pattern) {
  if (state.settings.vibrate && navigator.vibrate) navigator.vibrate(pattern);
}

let wakeLock = null;
async function updateWakeLock() {
  const want = state.settings.keepAwake && state.session && document.visibilityState === 'visible';
  try {
    if (want && !wakeLock && 'wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!want && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch { wakeLock = null; }
}
document.addEventListener('visibilitychange', updateWakeLock);

// ---------- diálogo e aviso ----------
// Resolve true (ok), 'alt' (opção alternativa) ou false (cancelar).
function ask(message, { detail = '', ok = 'Confirmar', danger = false, alt = '', cancel = 'Cancelar' } = {}) {
  return new Promise((resolve) => {
    state.dialog = { message, detail, ok, danger, alt, cancel, resolve };
    renderOverlay();
  });
}

function closeDialog(result) {
  const d = state.dialog;
  if (!d) return;
  state.dialog = null;
  renderOverlay();
  d.resolve(result);
}

let toastTimer = 0;
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

// ---------- sessão de treino ----------
// Fases: ready (aguardando play) → work (executando série) → rest (descanso entre séries)
//        → ... → hydrate (pausa maior antes do próximo exercício) → work → ... → fim
function startSession(day) {
  const plan = dayPlan(day);
  if (!plan.items.length) return;
  unlockAudio();
  const now = Date.now();
  state.session = {
    day,
    name: plan.name,
    items: plan.items.map((it) => ({ ...it, name: exById(it.exId).name })),
    ex: 0,
    set: 0,
    phase: 'ready',
    t0: now,
    start: now,
    log: [],
  };
  state.tab = 'treino';
  lastAlertAt = 0;
  save.session();
  updateWakeLock();
  render();
}

function primaryAction() {
  const s = state.session;
  if (!s) return;
  unlockAudio();
  const now = Date.now();

  if (s.phase === 'work') {
    // PAUSA: encerra a série atual e começa o cronômetro de descanso do zero
    const item = s.items[s.ex];
    s.log.push({ ex: s.ex, set: s.set, workMs: now - s.t0, restMs: 0, weight: item.weight });
    s.set++;
    s.t0 = now;
    if (s.set < item.sets) {
      s.phase = 'rest';
    } else if (s.ex < s.items.length - 1) {
      s.ex++;
      s.set = 0;
      s.phase = 'hydrate';
    } else {
      s.phase = 'finished'; // série já registrada acima
      finishSession();
      return;
    }
    buzz(80);
  } else {
    // PLAY: começa (ou retoma) a série
    if (s.phase !== 'ready' && s.log.length) s.log[s.log.length - 1].restMs = now - s.t0;
    s.phase = 'work';
    s.t0 = now;
    buzz([40, 40, 40]);
  }
  lastAlertAt = 0;
  save.session();
  render();
}

function skipExercise() {
  const s = state.session;
  if (!s) return;
  if (s.ex >= s.items.length - 1) { finishSession(); return; }
  s.ex++;
  s.set = 0;
  if (s.phase === 'work' || s.phase === 'ready') { s.phase = 'ready'; s.t0 = Date.now(); }
  else s.phase = 'hydrate'; // continua descansando, agora antes do novo exercício
  save.session();
  render();
}

function adjustSets(delta) {
  const s = state.session;
  if (!s) return;
  const item = s.items[s.ex];
  item.sets = Math.max(s.set + 1, item.sets + delta); // para terminar antes, use "Pular"
  save.session();
  render();
}

// Ajusta a carga durante o treino; o plano guarda o último peso usado para a próxima vez.
function setSessionWeight(value) {
  const s = state.session;
  if (!s) return;
  const item = s.items[s.ex];
  item.weight = value;
  const planItem = state.plans[s.day]?.items.find((it) => it.exId === item.exId);
  if (planItem) { planItem.weight = value; save.plans(); }
  save.session();
  render();
}

function stepWeight(dir) {
  const s = state.session;
  if (!s) return;
  const cur = parseKg(s.items[s.ex].weight) || 0;
  setSessionWeight(fmtKg(Math.max(0, cur + dir * state.settings.weightStep)));
}

function finishSession() {
  const s = state.session;
  if (!s) return;
  const now = Date.now();
  if (s.phase === 'work') s.log.push({ ex: s.ex, set: s.set, workMs: now - s.t0, restMs: 0, weight: s.items[s.ex].weight });
  const entry = {
    id: newId(),
    source: 'phone',
    date: new Date(s.start).toISOString(),
    day: s.day,
    name: s.name,
    durationMs: now - s.start,
    exercises: s.items.map((it, i) => {
      const sets = s.log.filter((l) => l.ex === i);
      return {
        exId: it.exId, name: it.name, reps: it.reps, weight: it.weight,
        weights: sets.map((l) => l.weight ?? it.weight), // carga de cada série
        setsDone: sets.length, setsPlanned: it.sets,
        workMs: sets.reduce((a, l) => a + l.workMs, 0),
      };
    }).filter((e) => e.setsDone > 0),
  };
  if (!entry.exercises.length) { discardSession(); return; }
  state.history.unshift(entry);
  save.history();
  state.lastDone = entry;
  state.session = null;
  state.tab = 'treino';
  save.session();
  updateWakeLock();
  buzz([200, 100, 200]);
  beep(3);
  render();
}

// Nenhuma série concluída nem em andamento: o treino pode ser cancelado sem deixar rastro.
function sessionIsEmpty(s) {
  return !s.log.length && s.phase !== 'work';
}

function discardSession() {
  state.session = null;
  save.session();
  updateWakeLock();
  render();
  toast('Treino cancelado');
}

async function cancelSession() {
  const s = state.session;
  if (!s) return;
  if (sessionIsEmpty(s)) {
    const ok = await ask('Cancelar o treino?', { detail: 'Nenhuma série foi feita, então nada será salvo.', ok: 'Cancelar treino', cancel: 'Voltar', danger: true });
    if (ok) discardSession();
    return;
  }
  const sets = s.log.length + (s.phase === 'work' ? 1 : 0);
  const choice = await ask('Encerrar o treino?', {
    detail: `Você fez ${plural(sets, 'série', 'séries')}.`,
    ok: 'Salvar e encerrar',
    alt: 'Descartar sem salvar',
    cancel: 'Continuar treinando',
  });
  if (choice === true) finishSession();
  else if (choice === 'alt') discardSession();
}

function volumeKg(entry) {
  return entry.exercises.reduce((sum, e) => {
    const reps = parseInt(e.reps, 10) || 0;
    return sum + (e.weights || []).reduce((a, w) => a + (parseKg(w) || 0) * reps, 0);
  }, 0);
}

// ---------- tick dos cronômetros ----------
let lastAlertAt = 0;
const RING_C = 2 * Math.PI * 108;

function alertLimit(s) {
  if (s.phase === 'rest') return (Number(s.items[s.ex]?.rest) || state.settings.restAlert) * 1000;
  if (s.phase === 'hydrate') return state.settings.hydrateAlert * 1000;
  return Infinity;
}

function tick() {
  const s = state.session;
  updateMini();
  if (!s) return;
  const now = Date.now();
  const elapsed = s.phase === 'ready' ? 0 : now - s.t0;
  const limit = alertLimit(s);
  const over = elapsed >= limit;

  const timer = $('#timer');
  if (timer) timer.textContent = fmt(elapsed);
  const total = $('#total');
  if (total) total.textContent = fmt(now - s.start);
  const sub = $('#timer-sub');
  if (sub && isFinite(limit)) sub.textContent = over ? `+${fmt(elapsed - limit)} além do descanso` : `meta ${fmt(limit)}`;

  const fg = $('#ring-fg');
  if (fg) {
    let p = 0;
    if (s.phase === 'work') p = (elapsed % 60000) / 60000;
    else if (isFinite(limit)) p = Math.min(1, elapsed / limit);
    fg.style.strokeDashoffset = String(RING_C * (1 - p));
  }
  $('#session')?.classList.toggle('alert', over);

  if (over && (!lastAlertAt || now - lastAlertAt >= state.settings.alertRepeat * 1000)) {
    lastAlertAt = now;
    buzz([300, 150, 300]);
    beep(2);
  }
}
setInterval(tick, 250);

// Barra flutuante com o treino em andamento quando o usuário está em outra aba
function updateMini() {
  const mini = $('#mini');
  const s = state.session;
  const show = !!s && state.tab !== 'treino' && !isWatch();
  mini.hidden = !show;
  if (!show) return;
  const elapsed = s.phase === 'ready' ? 0 : Date.now() - s.t0;
  const over = elapsed >= alertLimit(s);
  const label = { ready: 'Pronto', work: 'Executando', rest: 'Descanso', hydrate: 'Hidratação' }[s.phase];
  mini.className = `mini phase-${s.phase}${over ? ' alert' : ''}`;
  mini.innerHTML = `
    <span class="mini-dot"></span>
    <span class="mini-text"><b>${esc(s.items[s.ex].name)}</b><small>${label}</small></span>
    <span class="mini-time">${fmt(elapsed)}</span>
    ${icon('right', 18)}`;
}

// ---------- componentes ----------
function pageHead(title, sub = '') {
  return `<header class="page-head"><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ''}</header>`;
}

function weekStrip(selected, action) {
  const now = new Date();
  const today = now.getDay();
  return `<div class="week">${DAYS.map((d, i) => {
    const date = new Date(now);
    date.setDate(now.getDate() + (i - today));
    const cls = [i === selected && 'sel', i === today && 'today', dayPlan(i).items.length && 'has'].filter(Boolean).join(' ');
    return `<button class="wday ${cls}" data-action="${action}" data-day="${i}" aria-label="${d}">
      <span>${d.slice(0, 3)}</span><b>${date.getDate()}</b><i></i></button>`;
  }).join('')}</div>`;
}

function stepper(action, value, attrs = '', label = '') {
  return `<div class="stepper" role="group" ${label ? `aria-label="${label}"` : ''}>
    <button data-action="${action}" data-dir="-1" ${attrs} aria-label="Diminuir">${icon('minus', 18)}</button>
    <b>${value}</b>
    <button data-action="${action}" data-dir="1" ${attrs} aria-label="Aumentar">${icon('plus', 18)}</button>
  </div>`;
}

// ---------- telas ----------
const VIEWS = {
  treino: () => (state.session ? (isWatch() ? renderWatchSession() : renderSession()) : state.lastDone ? renderDone() : (isWatch() ? renderWatchHome() : renderHome())),
  plano: () => renderPlano(),
  historico: () => renderHistorico(),
  ajustes: () => renderAjustes(),
};

function render() {
  const watch = isWatch();
  document.body.classList.toggle('watch', watch);
  const tab = watch ? 'treino' : state.tab;
  document.body.dataset.view = tab;
  document.body.classList.toggle('in-session', !!state.session && tab === 'treino');
  $('#view').innerHTML = VIEWS[tab]();
  $('#nav').innerHTML = watch ? '' : renderNav(tab);
  renderOverlay();
  tick();
}

function renderNav(active) {
  const tabs = [['treino', 'dumbbell', 'Treino'], ['plano', 'calendar', 'Plano'], ['historico', 'chart', 'Histórico'], ['ajustes', 'sliders', 'Ajustes']];
  return tabs.map(([id, ic, label]) => `
    <button class="${id === active ? 'active' : ''}" data-tab="${id}" aria-label="${label}">
      <span class="nav-ic">${icon(ic, 22)}</span><span>${label}</span>
    </button>`).join('');
}

function renderHome() {
  const now = new Date();
  const today = now.getDay();
  const day = state.treinoDay ?? today;
  const plan = dayPlan(day);
  const head = pageHead('Treino', cap(now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })));
  const strip = weekStrip(day, 'treino-day');

  if (!plan.items.length) {
    return `${head}${strip}
      <section class="empty-card">
        <div class="empty-ic">${icon('moon', 30)}</div>
        <h2>Dia de descanso</h2>
        <p>Nenhum treino programado para ${DAYS[day].toLowerCase()}.</p>
        <button class="btn btn-primary" data-action="goto-plan" data-day="${day}">${icon('plus', 20)} Montar treino de ${DAYS[day]}</button>
      </section>
      ${renderLast()}`;
  }

  const sets = plan.items.reduce((a, it) => a + Number(it.sets), 0);
  const list = plan.items.map((it, i) => {
    const ex = exById(it.exId);
    return `<li class="row-card">
      ${avatar(ex.group)}
      <div class="row-main"><b>${esc(ex.name)}</b><small>${ex.group || ''}</small></div>
      <div class="row-meta"><b>${it.sets}×${esc(it.reps)}</b>${it.weight ? `<small>${esc(it.weight)} kg</small>` : ''}</div>
    </li>`;
  }).join('');

  return `${head}${strip}
    <section class="hero">
      <span class="eyebrow">${day === today ? 'Treino de hoje' : DAYS[day]}</span>
      <h2>${esc(plan.name || `Treino de ${DAYS[day]}`)}</h2>
      <div class="hero-stats">
        <div><b>${plan.items.length}</b><span>exercícios</span></div>
        <div><b>${sets}</b><span>séries</span></div>
        <div><b>~${estimateMin(plan.items)}</b><span>minutos</span></div>
      </div>
      <button class="btn btn-cta" data-action="start" data-day="${day}">${icon('play', 22)} Começar treino</button>
    </section>
    <div class="section-head"><h3>Exercícios</h3><button class="link-btn" data-action="goto-plan" data-day="${day}">Editar</button></div>
    <ol class="row-list">${list}</ol>
    ${renderLast()}`;
}

function renderLast() {
  const h = state.history[0];
  if (!h) return '';
  const d = new Date(h.date);
  return `<div class="section-head"><h3>Último treino</h3></div>
    <section class="row-card last">
      <span class="avatar soft">${icon('flame', 20)}</span>
      <div class="row-main"><b>${esc(h.name || `Treino de ${DAYS[h.day]}`)}</b><small>${cap(d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' }))}</small></div>
      <div class="row-meta"><b>${fmtDuration(h.durationMs)}</b><small>${plural(h.exercises.reduce((a, e) => a + e.setsDone, 0), 'série', 'séries')}</small></div>
    </section>`;
}

const PHASES = {
  ready: { label: 'Pronto', icon: 'play' },
  work: { label: 'Executando', icon: 'flame' },
  rest: { label: 'Descanso', icon: 'clock' },
  hydrate: { label: 'Hidratação', icon: 'droplet' },
};

function phaseHint(s, item) {
  const last = s.set + 1 >= item.sets;
  return {
    ready: `Toque no play para começar a série ${s.set + 1}`,
    work: last ? 'Última série! Toque ao terminar' : 'Toque ao terminar a série para descansar',
    rest: `Respire. Toque para iniciar a série ${s.set + 1}`,
    hydrate: 'Beba água. Toque para começar este exercício',
  }[s.phase];
}

function renderSession() {
  const s = state.session;
  const item = s.items[s.ex];
  const ex = exById(item.exId);
  const ph = PHASES[s.phase];
  const next = s.items[s.ex + 1];
  const pct = Math.round((s.ex / s.items.length) * 100);
  const segs = Array.from({ length: item.sets }, (_, i) =>
    `<i class="${i < s.set ? 'ok' : i === s.set && s.phase === 'work' ? 'now' : ''}"></i>`).join('');

  return `
    <section id="session" class="session phase-${s.phase}">
      <div class="s-top">
        <div class="s-progress">
          <span>Exercício ${s.ex + 1} de ${s.items.length}</span>
          <div class="bar"><i style="width:${pct}%"></i></div>
        </div>
        <span class="s-total">${icon('clock', 15)}<span id="total">00:00</span></span>
      </div>

      <div class="s-ex">
        <span class="eyebrow">${s.phase === 'hydrate' ? 'A seguir' : esc(ex.group || 'Exercício')}</span>
        <h2>${esc(item.name)}</h2>
      </div>

      <div class="ring">
        <svg viewBox="0 0 240 240" aria-hidden="true">
          <circle class="ring-track" cx="120" cy="120" r="108"/>
          <circle id="ring-fg" class="ring-fg" cx="120" cy="120" r="108" stroke-dasharray="${RING_C}" stroke-dashoffset="${RING_C}"/>
        </svg>
        <div class="ring-center">
          <span class="phase-chip">${icon(ph.icon, 14)} ${ph.label}</span>
          <div id="timer" class="timer">00:00</div>
          <span id="timer-sub" class="timer-sub">${s.phase === 'work' ? 'tempo da série' : ''}</span>
        </div>
      </div>

      <div class="s-stats">
        <div class="tile">
          <span class="tile-label">Série</span>
          <div class="tile-row">
            <button class="mini-btn" data-action="sets-minus" aria-label="Remover série">${icon('minus', 16)}</button>
            <b class="tile-value">${Math.min(s.set + 1, item.sets)}<small>/${item.sets}</small></b>
            <button class="mini-btn" data-action="sets-plus" aria-label="Adicionar série">${icon('plus', 16)}</button>
          </div>
          <div class="segs">${segs}</div>
        </div>
        <div class="tile">
          <span class="tile-label">Repetições</span>
          <b class="tile-value">${esc(item.reps)}</b>
        </div>
        <div class="tile tile-wide">
          <span class="tile-label">Carga</span>
          <div class="tile-row">
            <button class="mini-btn" data-action="weight-minus" aria-label="Diminuir carga">${icon('minus', 16)}</button>
            <label class="kg"><input type="text" inputmode="decimal" placeholder="—" value="${esc(item.weight)}" data-change="session-weight" aria-label="Carga em kg"><span>kg</span></label>
            <button class="mini-btn" data-action="weight-plus" aria-label="Aumentar carga">${icon('plus', 16)}</button>
          </div>
        </div>
      </div>

      <div class="s-controls">
        <button class="ctl" data-action="skip">${icon('skip', 22)}<span>Pular</span></button>
        <button class="fab" data-action="primary" aria-label="${s.phase === 'work' ? 'Pausa' : 'Play'}">${icon(s.phase === 'work' ? 'pause' : 'play', 36)}</button>
        ${sessionIsEmpty(s)
          ? `<button class="ctl danger" data-action="stop">${icon('x', 22)}<span>Cancelar</span></button>`
          : `<button class="ctl danger" data-action="stop">${icon('stop', 22)}<span>Encerrar</span></button>`}
      </div>
      <p class="hint">${phaseHint(s, item)}</p>

      ${next && s.phase !== 'hydrate' ? `<div class="next-up">${avatar(exById(next.exId).group)}<div><small>Depois</small><b>${esc(next.name)}</b></div><span>${next.sets}×${esc(next.reps)}</span></div>` : ''}
    </section>`;
}

function renderDone() {
  const d = state.lastDone;
  const sets = d.exercises.reduce((a, e) => a + e.setsDone, 0);
  const vol = volumeKg(d);
  return `
    <section class="done">
      <div class="done-badge">${icon('check', 44)}</div>
      <h1>Treino concluído!</h1>
      <p>${esc(d.name || `Treino de ${DAYS[d.day]}`)}</p>
      <div class="stat-grid">
        <div><b>${fmtDuration(d.durationMs)}</b><span>duração</span></div>
        <div><b>${d.exercises.length}</b><span>exercícios</span></div>
        <div><b>${sets}</b><span>séries</span></div>
        <div><b>${vol ? fmtKg(Math.round(vol)) : '—'}</b><span>kg levantados</span></div>
      </div>
      <button class="btn btn-cta" data-action="dismiss-done">Concluir</button>
    </section>`;
}

function renderWatchHome() {
  const today = new Date().getDay();
  const day = state.treinoDay ?? today;
  const plan = dayPlan(day);
  // Primeira tela: dia, nome e play. Rolando: lista de exercícios e saída do modo relógio.
  const list = plan.items.map((it, i) => {
    const ex = exById(it.exId);
    const color = (GROUP_META[ex.group] || {}).c || 'var(--muted)';
    return `<li style="--c:${color}">
      <span class="w-num">${i + 1}</span>
      <span class="w-ex-text"><b>${esc(ex.name)}</b><small>${it.sets}×${esc(it.reps)}${it.weight ? ` · ${esc(it.weight)} kg` : ''}</small></span>
    </li>`;
  }).join('');

  return `
    <section class="w-home">
      <div class="w-hero">
        <div class="w-day">
          <button class="w-arrow" data-action="treino-day" data-day="${(day + 6) % 7}" aria-label="Dia anterior">${icon('left', 18)}</button>
          <span>${day === today ? 'Hoje' : DAYS[day]}</span>
          <button class="w-arrow" data-action="treino-day" data-day="${(day + 1) % 7}" aria-label="Próximo dia">${icon('right', 18)}</button>
        </div>
        ${plan.items.length ? `
          <b class="w-title">${esc(plan.name || `Treino de ${DAYS[day]}`)}</b>
          <small class="w-sub">${plural(plan.items.length, 'exercício', 'exercícios')} · ~${estimateMin(plan.items)} min</small>
          <button class="fab" data-action="start" data-day="${day}" aria-label="Começar treino">${icon('play', 30)}</button>
          <span class="w-scroll">${icon('down', 16)} exercícios</span>`
        : `<b class="w-title">Descanso</b><small class="w-sub">Sem treino neste dia</small>
           <span class="w-scroll">${icon('down', 16)} opções</span>`}
      </div>
      ${list ? `<ol class="w-list">${list}</ol>` : ''}
      <button class="w-exit" data-action="exit-watch">${icon('x', 16)} Sair do modo relógio</button>
    </section>`;
}

function renderWatchSession() {
  const s = state.session;
  const item = s.items[s.ex];
  return `
    <section id="session" class="w-session phase-${s.phase}">
      <svg class="w-ring" viewBox="0 0 240 240" aria-hidden="true">
        <circle class="ring-track" cx="120" cy="120" r="108"/>
        <circle id="ring-fg" class="ring-fg" cx="120" cy="120" r="108" stroke-dasharray="${RING_C}" stroke-dashoffset="${RING_C}"/>
      </svg>
      <div class="w-center">
        <small class="w-phase">${s.phase === 'hydrate' ? 'A seguir' : PHASES[s.phase].label}</small>
        <b class="w-ex">${esc(item.name)}</b>
        <small class="w-meta">${Math.min(s.set + 1, item.sets)}/${item.sets} · ${esc(item.reps)}×${item.weight ? ` · ${esc(item.weight)}kg` : ''}</small>
        <div id="timer" class="timer">00:00</div>
        <div class="w-controls">
          <button class="w-small" data-action="skip" aria-label="Pular">${icon('skip', 16)}</button>
          <button class="fab" data-action="primary" aria-label="${s.phase === 'work' ? 'Pausa' : 'Play'}">${icon(s.phase === 'work' ? 'pause' : 'play', 26)}</button>
          <button class="w-small" data-action="stop" aria-label="${sessionIsEmpty(s) ? 'Cancelar' : 'Encerrar'}">${icon(sessionIsEmpty(s) ? 'x' : 'stop', 16)}</button>
        </div>
      </div>
    </section>`;
}

function renderPlano() {
  const day = state.editDay;
  const plan = dayPlan(day);
  const cards = plan.items.map((it, i) => {
    const ex = exById(it.exId);
    return `
    <article class="pcard">
      <div class="pcard-head">
        ${avatar(ex.group)}
        <div class="row-main"><b>${esc(ex.name)}</b><small>${ex.group || ''}</small></div>
        <div class="pcard-actions">
          <button class="icon-btn" data-action="move" data-i="${i}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="Subir">${icon('up', 18)}</button>
          <button class="icon-btn" data-action="move" data-i="${i}" data-dir="1" ${i === plan.items.length - 1 ? 'disabled' : ''} aria-label="Descer">${icon('down', 18)}</button>
          <button class="icon-btn danger" data-action="remove-item" data-i="${i}" aria-label="Remover">${icon('trash', 18)}</button>
        </div>
      </div>
      <div class="pcard-fields">
        <div class="pf"><span>Séries</span>${stepper('item-sets', it.sets, `data-i="${i}"`, 'Séries')}</div>
        <label class="pf"><span>Repetições</span><input type="text" inputmode="numeric" value="${esc(it.reps)}" data-item="${i}" data-key="reps"></label>
        <label class="pf"><span>Carga</span><span class="suffix"><input type="text" inputmode="decimal" placeholder="—" value="${esc(it.weight)}" data-item="${i}" data-key="weight"><em>kg</em></span></label>
        <label class="pf"><span>Descanso</span><span class="suffix"><input type="number" min="0" inputmode="numeric" placeholder="${state.settings.restAlert}" value="${it.rest ?? ''}" data-item="${i}" data-key="rest"><em>s</em></span></label>
      </div>
    </article>`;
  }).join('');

  const otherDays = DAYS.map((d, i) => (i !== day && dayPlan(i).items.length) ? `<option value="${i}">${d}</option>` : '').join('');
  const sets = plan.items.reduce((a, it) => a + Number(it.sets), 0);

  return `
    ${pageHead('Plano semanal', 'Monte o treino de cada dia da semana')}
    ${weekStrip(day, 'edit-day')}
    <section class="plan-head">
      <span class="eyebrow">${DAYS[day]}</span>
      <input class="title-input" type="text" placeholder="Dê um nome (ex.: Treino A – Peito)" value="${esc(plan.name)}" data-change="plan-name" aria-label="Nome do treino">
      <p class="muted">${plan.items.length ? `${plural(plan.items.length, 'exercício', 'exercícios')} · ${sets} séries · ~${estimateMin(plan.items)} min` : 'Dia de descanso'}</p>
    </section>
    <div class="pcards">${cards}</div>
    <button class="add-tile" data-action="pick">${icon('plus', 22)} Adicionar exercícios</button>
    <div class="plan-tools">
      ${otherDays ? `<label class="select-pill">${icon('copy', 16)}<select data-change="copy-from"><option value="">Copiar de outro dia</option>${otherDays}</select></label>` : ''}
      ${plan.items.length ? `<button class="link-btn danger" data-action="clear-day">${icon('trash', 16)} Limpar dia</button>` : ''}
    </div>`;
}

function renderHistorico() {
  const h = state.history;
  const weekAgo = Date.now() - 7 * 86400000;
  const week = h.filter((x) => new Date(x.date).getTime() >= weekAgo);
  const weekMs = week.reduce((a, x) => a + x.durationMs, 0);

  const stats = `
    <div class="stat-grid three">
      <div><b>${week.length}</b><span>treinos em 7 dias</span></div>
      <div><b>${weekMs ? fmtDuration(weekMs) : '0 min'}</b><span>tempo em 7 dias</span></div>
      <div><b>${h.length}</b><span>treinos no total</span></div>
    </div>`;

  if (!h.length) {
    return `${pageHead('Histórico')}${stats}
      <section class="empty-card">
        <div class="empty-ic">${icon('chart', 30)}</div>
        <h2>Nenhum treino ainda</h2>
        <p>Seus treinos concluídos aparecem aqui.</p>
      </section>`;
  }

  const items = h.map((x, idx) => {
    const d = new Date(x.date);
    const sets = x.exercises.reduce((a, e) => a + e.setsDone, 0);
    return `
      <details class="hcard">
        <summary>
          <span class="date-block"><b>${d.getDate()}</b><small>${d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')}</small></span>
          <span class="row-main"><b>${esc(x.name || `Treino de ${DAYS[x.day]}`)}</b><small class="with-ic">${cap(d.toLocaleDateString('pt-BR', { weekday: 'long' }))} · ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}${x.source === 'watch' ? ` · ${icon('watch', 13)} relógio` : ''}</small></span>
          <span class="row-meta"><b>${fmtDuration(x.durationMs)}</b><small>${plural(sets, 'série', 'séries')}</small></span>
        </summary>
        ${x.heartRate || x.calories ? `<div class="hr-line">${icon('heart', 16)}<span>${[
          x.heartRate ? `média <b>${x.heartRate.avg}</b> · máx <b>${x.heartRate.max}</b> bpm` : '',
          x.calories ? `<b>${x.calories}</b> kcal` : '',
        ].filter(Boolean).join(' · ')}</span></div>` : ''}
        <ul class="hlist">${x.exercises.map((e) => {
          const w = weightsLabel(e.weights || [e.weight]);
          return `<li><span>${esc(e.name)}</span><small>${e.setsDone}/${e.setsPlanned} × ${esc(e.reps)}${w ? ` · ${esc(w)}` : ''}${e.hrAvg ? ` · ♥ ${e.hrAvg}` : ''}</small></li>`;
        }).join('')}</ul>
        <div class="hcard-foot">
          <button class="link-btn danger" data-action="del-hist" data-i="${idx}">${icon('trash', 16)} Apagar este treino</button>
        </div>
      </details>`;
  }).join('');

  return `${pageHead('Histórico', plural(h.length, 'treino registrado', 'treinos registrados'))}${stats}
    <div class="hcards">${items}</div>
    <button class="link-btn danger center" data-action="clear-history">${icon('trash', 16)} Apagar histórico</button>`;
}

function renderAjustes() {
  const s = state.settings;
  const timeRow = (key, title, desc, step) => `
    <div class="set-row">
      <div class="set-text"><b>${title}</b><small>${desc}</small></div>
      ${stepper('set-step', fmtSecs(s[key]), `data-key="${key}" data-step="${step}"`, title)}
    </div>`;
  const switchRow = (key, title, desc = '') => `
    <label class="set-row">
      <div class="set-text"><b>${title}</b>${desc ? `<small>${desc}</small>` : ''}</div>
      <span class="switch"><input type="checkbox" ${s[key] ? 'checked' : ''} data-setting="${key}"><i></i></span>
    </label>`;
  const seg = (value, label) => `<button class="${s.watchMode === value ? 'on' : ''}" data-action="set-watch" data-value="${value}">${label}</button>`;

  return `
    ${pageHead('Ajustes')}
    <h3 class="group-title">Cronômetros</h3>
    <section class="group">
      ${timeRow('restAlert', 'Descanso entre séries', 'Depois disso o cronômetro pisca', 15)}
      ${timeRow('hydrateAlert', 'Hidratação entre exercícios', 'Pausa maior ao trocar de exercício', 30)}
      ${timeRow('alertRepeat', 'Repetir alerta a cada', 'Enquanto a pausa passar do limite', 5)}
      <div class="set-row">
        <div class="set-text"><b>Incremento da carga</b><small>Botões − e + durante o treino</small></div>
        ${stepper('set-step', `${fmtKg(s.weightStep)} kg`, 'data-key="weightStep" data-step="0.5"', 'Incremento da carga')}
      </div>
    </section>

    <h3 class="group-title">Alertas</h3>
    <section class="group">
      ${switchRow('vibrate', 'Vibrar')}
      ${switchRow('sound', 'Tocar som')}
      ${switchRow('keepAwake', 'Manter a tela ligada', 'Durante o treino')}
    </section>

    <h3 class="group-title">App do relógio</h3>
    <section class="group">
      ${state.sync ? `
      <div class="set-row column">
        <div class="set-text"><b>Código do relógio</b><small>No app Malha do relógio, toque em “Conectar” e digite este código</small></div>
        <div class="sync-code" aria-label="Código ${state.sync.code.split('').join(' ')}">${esc(state.sync.code.slice(0, 3))}<span></span>${esc(state.sync.code.slice(3))}</div>
        <small class="muted center-text">${state.sync.pushedAt
          ? `Plano enviado às ${new Date(state.sync.pushedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} de ${new Date(state.sync.pushedAt).toLocaleDateString('pt-BR')}`
          : 'Ainda não enviado'}</small>
        <div class="inline-form">
          <button class="btn btn-soft grow" data-action="sync-now">${icon('link', 18)} Sincronizar agora</button>
          <button class="btn btn-soft" data-action="sync-off">${icon('x', 18)} Desconectar</button>
        </div>
      </div>` : `
      <div class="set-row column">
        <div class="set-text"><b>Conectar o app do Galaxy Watch</b><small>Gera um código curto para digitar no relógio. O plano vai sozinho a cada mudança, e os treinos feitos no relógio voltam para o histórico.</small></div>
        <button class="btn btn-primary" data-action="sync-enable">${icon('watch', 18)} Gerar código</button>
      </div>`}
    </section>

    <h3 class="group-title">Modo relógio</h3>
    <section class="group">
      <div class="set-row column">
        <div class="set-text"><b>Interface compacta para smartwatch</b><small>No automático, liga sozinha em telas pequenas</small></div>
        <div class="segmented">${seg('auto', 'Automático')}${seg('on', 'Ligado')}${seg('off', 'Desligado')}</div>
      </div>
    </section>

    <h3 class="group-title">Levar para outro aparelho</h3>
    <section class="group">
      <div class="set-row column">
        <div class="set-text"><b>Link de sincronização</b><small>Abra o link no relógio ou em outro celular para importar o plano</small></div>
        <button class="btn btn-soft" data-action="export">${icon('link', 18)} Copiar link do meu plano</button>
        <div class="inline-form">
          <input type="text" id="import-in" placeholder="Cole aqui um link ou código">
          <button class="btn btn-soft" data-action="import">${icon('download', 18)} Importar</button>
        </div>
      </div>
    </section>
    <p class="footnote">Malha · seus dados ficam salvos neste aparelho</p>`;
}

// ---------- gaveta de exercícios e diálogo ----------
let overlayKind = null;

function renderOverlay() {
  const ov = $('#overlay');
  const kind = state.dialog ? 'dialog' : state.picker ? 'picker' : null;
  if (kind !== overlayKind) {
    overlayKind = kind;
    ov.className = kind ? `open is-${kind}` : '';
    document.body.classList.toggle('locked', !!kind);
    if (kind === 'dialog') {
      const d = state.dialog;
      ov.innerHTML = `
        <div class="backdrop" data-action="dialog-cancel"></div>
        <div class="dialog" role="alertdialog" aria-modal="true">
          <h3>${esc(d.message)}</h3>
          ${d.detail ? `<p>${esc(d.detail)}</p>` : ''}
          ${d.alt ? `
          <div class="dialog-actions stacked">
            <button class="btn btn-primary" data-action="dialog-ok">${esc(d.ok)}</button>
            <button class="btn btn-danger-soft" data-action="dialog-alt">${esc(d.alt)}</button>
            <button class="btn btn-soft" data-action="dialog-cancel">${esc(d.cancel)}</button>
          </div>` : `
          <div class="dialog-actions">
            <button class="btn btn-soft" data-action="dialog-cancel">${esc(d.cancel)}</button>
            <button class="btn ${d.danger ? 'btn-danger' : 'btn-primary'}" data-action="dialog-ok">${esc(d.ok)}</button>
          </div>`}
        </div>`;
      $('[data-action="dialog-ok"]', ov).focus();
    } else if (kind === 'picker') {
      ov.innerHTML = `
        <div class="backdrop" data-action="pick-done"></div>
        <div class="sheet" role="dialog" aria-modal="true" aria-label="Adicionar exercícios">
          <div class="grab"></div>
          <div class="sheet-head">
            <div><h3>Adicionar exercícios</h3><small>Treino de ${DAYS[state.editDay]}</small></div>
            <button class="btn btn-primary sm" data-action="pick-done">Concluir <span id="pick-count" class="count"></span></button>
          </div>
          <label class="search">${icon('search', 18)}<input type="search" placeholder="Buscar exercício" value="${esc(state.libFilter.q)}" data-change="lib-q"></label>
          <div id="pick-chips" class="gchips"></div>
          <div id="pick-list" class="sheet-body"></div>
        </div>`;
      refreshPicker();
    } else {
      ov.innerHTML = '';
    }
  } else if (kind === 'picker') {
    refreshPicker();
  }
}

function refreshPicker() {
  const { q, group } = state.libFilter;
  const needle = slug(q);
  const inPlan = new Set(dayPlan(state.editDay).items.map((it) => it.exId));
  const customIds = new Set(state.custom.map((c) => c.id));
  const list = allExercises().filter((e) => (!group || e.group === group) && (!needle || slug(e.name).includes(needle)));

  $('#pick-count').textContent = inPlan.size;
  $('#pick-chips').innerHTML = ['', ...GROUPS].map((g) =>
    `<button class="gchip ${g === group ? 'on' : ''}" data-action="lib-group" data-group="${g}">${g || 'Todos'}</button>`).join('');

  const rows = list.map((e) => {
    const added = inPlan.has(e.id);
    return `
      <div class="pick-row ${added ? 'added' : ''}">
        ${avatar(e.group)}
        <div class="row-main"><b>${esc(e.name)}</b><small>${e.group}${customIds.has(e.id) ? ' · personalizado' : ''}</small></div>
        ${customIds.has(e.id) ? `<button class="icon-btn" data-action="del-custom" data-id="${esc(e.id)}" aria-label="Excluir exercício personalizado">${icon('trash', 16)}</button>` : ''}
        <button class="toggle ${added ? 'on' : ''}" data-action="toggle-in-plan" data-id="${esc(e.id)}" aria-label="${added ? 'Remover do treino' : 'Adicionar ao treino'}">${icon(added ? 'minus' : 'plus', 20)}</button>
      </div>`;
  }).join('');

  $('#pick-list').innerHTML = `
    ${rows || '<p class="empty">Nenhum exercício encontrado.</p>'}
    <div class="custom-box">
      <b>Não achou? Crie o seu</b>
      <div class="inline-form">
        <input type="text" id="custom-name" placeholder="Nome do exercício" value="${esc(q)}">
        <select id="custom-group">${GROUPS.map((g) => `<option ${g === group ? 'selected' : ''}>${g}</option>`).join('')}</select>
        <button class="btn btn-soft" data-action="add-custom">${icon('plus', 18)} Criar</button>
      </div>
    </div>`;
}

// ---------- exportar / importar ----------
function exportCode() {
  const json = JSON.stringify({ v: 1, plans: state.plans, custom: state.custom, settings: { ...state.settings, watchMode: 'auto' } });
  return btoa(unescape(encodeURIComponent(json)));
}

function importCode(text) {
  const m = String(text).match(/import=([^&\s]+)/);
  const code = decodeURIComponent(m ? m[1] : text.trim());
  const data = JSON.parse(decodeURIComponent(escape(atob(code))));
  if (!data || typeof data.plans !== 'object') throw new Error('formato inválido');
  state.plans = data.plans;
  state.custom = Array.isArray(data.custom) ? data.custom : [];
  if (data.settings) state.settings = { ...state.settings, ...data.settings, watchMode: state.settings.watchMode };
  save.plans(); save.custom(); save.settings();
}

async function checkImportLink() {
  if (!location.hash.startsWith('#import=')) return;
  const hash = location.hash;
  history.replaceState(null, '', location.pathname + location.search);
  const ok = await ask('Importar plano de treino?', { detail: 'O plano atual deste aparelho será substituído.', ok: 'Importar' });
  if (!ok) return;
  try { importCode(hash); toast('Plano importado'); render(); }
  catch { toast('Link de importação inválido'); }
}

// ---------- eventos ----------
function updatePlan(day, fn) {
  const plan = { ...dayPlan(day), items: [...dayPlan(day).items] };
  fn(plan);
  if (!plan.items.length && !plan.name) delete state.plans[day];
  else state.plans[day] = plan;
  save.plans();
}

function renderView() {
  const tab = isWatch() ? 'treino' : state.tab;
  $('#view').innerHTML = VIEWS[tab]();
}

document.addEventListener('click', async (ev) => {
  const tabBtn = ev.target.closest('[data-tab]');
  if (tabBtn) {
    state.tab = tabBtn.dataset.tab;
    render();
    scrollTo(0, 0);
    return;
  }
  const el = ev.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const a = el.dataset.action;
  const i = Number(el.dataset.i);
  const dir = Number(el.dataset.dir);

  switch (a) {
    case 'start': startSession(Number(el.dataset.day)); break;
    case 'primary': primaryAction(); break;
    case 'skip': skipExercise(); break;
    case 'stop': cancelSession(); break;
    case 'sets-plus': adjustSets(1); break;
    case 'sets-minus': adjustSets(-1); break;
    case 'weight-plus': stepWeight(1); break;
    case 'weight-minus': stepWeight(-1); break;
    case 'open-session': state.tab = 'treino'; render(); scrollTo(0, 0); break;
    case 'dismiss-done': state.lastDone = null; render(); break;
    case 'treino-day': state.treinoDay = Number(el.dataset.day); render(); break;
    case 'goto-plan': state.editDay = Number(el.dataset.day); state.tab = 'plano'; render(); scrollTo(0, 0); break;
    case 'edit-day': state.editDay = Number(el.dataset.day); render(); break;
    case 'pick': state.picker = true; renderOverlay(); break;
    case 'pick-done': state.picker = false; render(); break;
    case 'lib-group': state.libFilter.group = el.dataset.group; refreshPicker(); $('#pick-list').scrollTop = 0; break;
    case 'toggle-in-plan': {
      const id = el.dataset.id;
      updatePlan(state.editDay, (p) => {
        const idx = p.items.findIndex((it) => it.exId === id);
        if (idx >= 0) p.items.splice(idx, 1);
        else p.items.push({ exId: id, sets: 3, reps: '8', weight: '', rest: null });
      });
      refreshPicker();
      renderView();
      break;
    }
    case 'item-sets':
      updatePlan(state.editDay, (p) => {
        p.items[i] = { ...p.items[i], sets: Math.max(1, Math.min(20, Number(p.items[i].sets) + dir)) };
      });
      renderView();
      break;
    case 'move':
      updatePlan(state.editDay, (p) => {
        const j = i + dir;
        [p.items[i], p.items[j]] = [p.items[j], p.items[i]];
      });
      renderView();
      break;
    case 'remove-item': updatePlan(state.editDay, (p) => p.items.splice(i, 1)); renderView(); break;
    case 'clear-day':
      if (await ask(`Apagar o treino de ${DAYS[state.editDay]}?`, { ok: 'Apagar', danger: true })) {
        delete state.plans[state.editDay]; save.plans(); render();
      }
      break;
    case 'add-custom': {
      const name = $('#custom-name').value.trim();
      if (!name) { $('#custom-name').focus(); return; }
      const group = $('#custom-group').value;
      const id = 'custom-' + slug(name) + '-' + Date.now().toString(36);
      state.custom.push({ id, name, group });
      save.custom();
      updatePlan(state.editDay, (p) => p.items.push({ exId: id, sets: 3, reps: '8', weight: '', rest: null }));
      state.libFilter = { q: '', group };
      const input = $('[data-change="lib-q"]');
      if (input) input.value = '';
      refreshPicker();
      renderView();
      toast(`“${name}” criado e adicionado`);
      break;
    }
    case 'del-custom':
      if (await ask('Excluir este exercício personalizado?', { ok: 'Excluir', danger: true })) {
        state.custom = state.custom.filter((c) => c.id !== el.dataset.id);
        save.custom();
        render();
      }
      break;
    case 'del-hist': {
      const entry = state.history[i];
      if (!entry) return;
      const when = new Date(entry.date).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' });
      if (await ask('Apagar este treino?', { detail: `${entry.name || `Treino de ${DAYS[entry.day]}`}, ${when}.`, ok: 'Apagar', danger: true })) {
        state.history = state.history.filter((x) => x !== entry);
        save.history();
        render();
        toast('Treino apagado');
      }
      break;
    }
    case 'clear-history':
      if (await ask('Apagar todo o histórico?', { detail: 'Essa ação não pode ser desfeita.', ok: 'Apagar', danger: true })) {
        state.history = []; save.history(); render();
      }
      break;
    case 'set-step': {
      const key = el.dataset.key;
      const step = Number(el.dataset.step);
      const min = key === 'weightStep' ? 0.5 : step;
      state.settings[key] = Math.max(min, Math.round((state.settings[key] + dir * step) * 100) / 100);
      save.settings();
      renderView();
      break;
    }
    case 'set-watch': state.settings.watchMode = el.dataset.value; save.settings(); render(); break;
    case 'sync-enable': enableSync(); break;
    case 'sync-now': syncNow(); break;
    case 'sync-off':
      if (await ask('Desconectar o relógio?', { detail: 'O relógio deixa de receber o plano. Para conectar de novo, um código novo será gerado.', ok: 'Desconectar', danger: true })) {
        state.sync = null; save.sync(); render();
      }
      break;
    case 'exit-watch': {
      // "Desligado" vence o automático; também tira o ?watch do endereço, que força o modo
      state.settings.watchMode = 'off';
      save.settings();
      const params = new URLSearchParams(location.search);
      params.delete('watch');
      history.replaceState(null, '', location.pathname + (params.toString() ? `?${params}` : '') + location.hash);
      render();
      scrollTo(0, 0);
      toast('Modo relógio desligado. Para voltar: Ajustes');
      break;
    }
    case 'export': {
      const url = location.origin + location.pathname + '#import=' + encodeURIComponent(exportCode());
      try { await navigator.clipboard.writeText(url); toast('Link copiado. Abra no outro aparelho'); }
      catch { $('#import-in').value = url; toast('Copie o link do campo abaixo'); }
      break;
    }
    case 'import':
      try { importCode($('#import-in').value); toast('Plano importado'); render(); }
      catch { toast('Código inválido'); }
      break;
    case 'dialog-ok': closeDialog(true); break;
    case 'dialog-alt': closeDialog('alt'); break;
    case 'dialog-cancel': closeDialog(false); break;
  }
});

document.addEventListener('change', (ev) => {
  const el = ev.target;
  if (el.dataset.setting) {
    state.settings[el.dataset.setting] = el.checked;
    save.settings();
    if (el.dataset.setting === 'keepAwake') updateWakeLock();
    return;
  }
  if (el.dataset.item !== undefined) {
    const i = Number(el.dataset.item), key = el.dataset.key;
    updatePlan(state.editDay, (p) => {
      const it = { ...p.items[i] };
      if (key === 'rest') it.rest = el.value === '' ? null : Math.max(0, Number(el.value));
      else it[key] = el.value.trim();
      p.items[i] = it;
    });
    return;
  }
  switch (el.dataset.change) {
    case 'session-weight': {
      const n = parseKg(el.value);
      setSessionWeight(el.value.trim() === '' ? '' : isNaN(n) ? el.value.trim() : fmtKg(Math.max(0, n)));
      break;
    }
    case 'plan-name': updatePlan(state.editDay, (p) => { p.name = el.value.trim(); }); break;
    case 'copy-from': {
      const from = el.value;
      if (from === '') return;
      ask(`Copiar o treino de ${DAYS[from]} para ${DAYS[state.editDay]}?`, { ok: 'Copiar' }).then((ok) => {
        if (ok) {
          state.plans[state.editDay] = JSON.parse(JSON.stringify(dayPlan(Number(from))));
          save.plans();
          toast('Treino copiado');
        }
        render();
      });
      break;
    }
  }
});

document.addEventListener('input', (ev) => {
  if (ev.target.dataset.change === 'lib-q') {
    state.libFilter.q = ev.target.value;
    refreshPicker();
  }
});

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') {
    if (state.dialog) closeDialog(false);
    else if (state.picker) { state.picker = false; render(); }
    return;
  }
  // Atalho no computador: espaço = play/pausa
  if (ev.code === 'Space' && state.session && !overlayKind && !/INPUT|TEXTAREA|SELECT|BUTTON/.test(document.activeElement.tagName)) {
    ev.preventDefault();
    primaryAction();
  }
});

window.addEventListener('resize', () => {
  if (document.body.classList.contains('watch') !== isWatch()) render();
});

// ---------- início ----------
render();
checkImportLink();
updateWakeLock();
syncNow({ quiet: true });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') syncNow({ quiet: true });
});

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
