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
  pickMode: false,                       // escolhendo exercício para o plano
  libFilter: { q: '', group: '' },
  lastDone: null,
};

const save = {
  settings: () => store.set('settings', state.settings),
  custom: () => store.set('custom', state.custom),
  plans: () => store.set('plans', state.plans),
  history: () => store.set('history', state.history),
  session: () => store.set('session', state.session),
};

// ---------- utilidades ----------
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function allExercises() { return [...EXERCISES, ...state.custom]; }
function exById(id) { return allExercises().find((e) => e.id === id) || { id, name: '(exercício removido)', group: '' }; }
function dayPlan(day) { return state.plans[day] || { name: '', items: [] }; }

function fmt(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  const mm = String(m).padStart(2, '0'), ss = String(s).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function fmtDuration(ms) {
  const min = Math.round(ms / 60000);
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;
}

// ---------- modo relógio ----------
function isWatch() {
  const mode = state.settings.watchMode;
  if (mode === 'on' || new URLSearchParams(location.search).has('watch')) return true;
  if (mode === 'off') return false;
  return Math.min(innerWidth, innerHeight) <= 330 && Math.max(innerWidth, innerHeight) <= 500;
}

function applyWatch() {
  document.body.classList.toggle('watch', isWatch());
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

const parseKg = (v) => parseFloat(String(v ?? '').replace(',', '.'));
const fmtKg = (n) => String(Math.round(n * 100) / 100).replace('.', ',');

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

function weightsLabel(weights) {
  const list = weights.filter((w) => w !== '' && w != null);
  if (!list.length) return '';
  const uniq = [...new Set(list)];
  return uniq.length === 1 ? `${uniq[0]} kg` : `${list.join(' / ')} kg`;
}

function finishSession() {
  const s = state.session;
  if (!s) return;
  const now = Date.now();
  if (s.phase === 'work') s.log.push({ ex: s.ex, set: s.set, workMs: now - s.t0, restMs: 0, weight: s.items[s.ex].weight });
  const entry = {
    date: new Date(s.start).toISOString(),
    day: s.day,
    name: s.name,
    durationMs: now - s.start,
    exercises: s.items.map((it, i) => {
      const sets = s.log.filter((l) => l.ex === i);
      return {
        name: it.name, reps: it.reps, weight: it.weight,
        weights: sets.map((l) => l.weight ?? it.weight), // carga de cada série
        setsDone: sets.length, setsPlanned: it.sets,
        workMs: sets.reduce((a, l) => a + l.workMs, 0),
      };
    }).filter((e) => e.setsDone > 0),
  };
  if (entry.exercises.length) {
    state.history.unshift(entry);
    save.history();
  }
  state.lastDone = entry;
  state.session = null;
  save.session();
  updateWakeLock();
  buzz([200, 100, 200]);
  beep(3);
  render();
}

function cancelSession() {
  if (!confirm('Encerrar o treino? As séries já feitas serão salvas no histórico.')) return;
  finishSession();
}

// ---------- tick dos cronômetros ----------
let lastAlertAt = 0;

function alertLimit(s) {
  if (s.phase === 'rest') return (Number(s.items[s.ex]?.rest) || state.settings.restAlert) * 1000;
  if (s.phase === 'hydrate') return state.settings.hydrateAlert * 1000;
  return Infinity;
}

function tick() {
  const s = state.session;
  if (!s) return;
  const now = Date.now();
  const elapsed = s.phase === 'ready' ? 0 : now - s.t0;
  const limit = alertLimit(s);
  const over = elapsed >= limit;

  const timer = $('#timer');
  if (timer) timer.textContent = fmt(elapsed);
  const total = $('#total');
  if (total) total.textContent = fmt(now - s.start);
  const card = $('#timer-card');
  if (card) card.classList.toggle('alert', over);
  const bar = $('#rest-bar');
  if (bar && isFinite(limit)) bar.style.width = Math.min(100, (elapsed / limit) * 100) + '%';

  if (over && (!lastAlertAt || now - lastAlertAt >= state.settings.alertRepeat * 1000)) {
    lastAlertAt = now;
    buzz([300, 150, 300]);
    beep(2);
  }
}
setInterval(tick, 250);

// ---------- telas ----------
function render() {
  applyWatch();
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === state.tab));
  $('#topbar-sub').textContent = state.session ? '● treino em andamento' : '';
  const view = $('#view');
  const tab = isWatch() ? 'treino' : state.tab;
  view.innerHTML = ({
    treino: renderTreino,
    plano: renderPlano,
    exercicios: renderExercicios,
    historico: renderHistorico,
    ajustes: renderAjustes,
  }[tab])();
  tick();
}

function renderTreino() {
  if (state.session) return renderSession();
  if (state.lastDone) return renderDone();

  const today = new Date().getDay();
  const day = state.treinoDay ?? today;
  const plan = dayPlan(day);
  const options = DAYS.map((d, i) => {
    const p = dayPlan(i);
    const label = `${d}${i === today ? ' (hoje)' : ''}${p.items.length ? ` · ${p.items.length} ex.` : ''}`;
    return `<option value="${i}" ${i === day ? 'selected' : ''}>${esc(label)}</option>`;
  }).join('');

  const list = plan.items.length
    ? `<ol class="plain-list">${plan.items.map((it) => `
        <li><b>${esc(exById(it.exId).name)}</b>
        <span class="muted">${it.sets}×${it.reps}${it.weight ? ` · ${esc(it.weight)} kg` : ''}</span></li>`).join('')}</ol>
       <button class="btn primary big" data-action="start" data-day="${day}">▶ Iniciar treino</button>`
    : `<p class="empty">Nenhum exercício programado para ${DAYS[day].toLowerCase()}.</p>
       ${isWatch() ? '' : `<button class="btn" data-action="goto-plan" data-day="${day}">Montar treino de ${DAYS[day]}</button>`}`;

  return `
    <section class="card">
      <label class="field"><span>Dia</span><select data-change="treino-day">${options}</select></label>
      ${plan.name ? `<h2>${esc(plan.name)}</h2>` : ''}
      ${list}
    </section>`;
}

function renderSession() {
  const s = state.session;
  const item = s.items[s.ex];
  const phaseInfo = {
    ready: { label: 'Pronto', btn: '▶ Play', cls: 'ready' },
    work: { label: 'Executando', btn: s.set + 1 >= item.sets ? '⏸ Pausa · fim do exercício' : '⏸ Pausa', cls: 'work' },
    rest: { label: 'Descanso', btn: '▶ Play · próxima série', cls: 'rest' },
    hydrate: { label: '💧 Hidratação', btn: '▶ Play · próximo exercício', cls: 'hydrate' },
  }[s.phase];
  if (isWatch()) phaseInfo.btn = s.phase === 'work' ? '⏸ Pausa' : '▶ Play';

  const dots = Array.from({ length: item.sets }, (_, i) => {
    const cls = i < s.set ? 'done' : (i === s.set && s.phase === 'work' ? 'current' : '');
    return `<i class="${cls}"></i>`;
  }).join('');

  const showBar = s.phase === 'rest' || s.phase === 'hydrate';

  return `
    <section class="session phase-${phaseInfo.cls}">
      <div class="session-head">
        <span class="muted">Exercício ${s.ex + 1}/${s.items.length} · total <span id="total">00:00</span></span>
        ${s.phase === 'hydrate' ? '<span class="next-label">Próximo:</span>' : ''}
        <h2 class="ex-name">${esc(item.name)}</h2>
        <div class="ex-meta">Série <b>${Math.min(s.set + 1, item.sets)}</b> de ${item.sets} · <b>${item.reps}</b> reps</div>
        <div class="weight-ctl">
          <button class="btn round" data-action="weight-minus" aria-label="Diminuir carga">−</button>
          <label><input type="text" inputmode="decimal" placeholder="—" value="${esc(item.weight)}" data-change="session-weight" aria-label="Carga em kg"><span>kg</span></label>
          <button class="btn round" data-action="weight-plus" aria-label="Aumentar carga">+</button>
        </div>
        <div class="dots">${dots}</div>
      </div>

      <div id="timer-card" class="timer-card">
        <div class="phase-label">${phaseInfo.label}</div>
        <div id="timer" class="timer">00:00</div>
        ${showBar ? '<div class="rest-track"><div id="rest-bar" class="rest-bar"></div></div>' : ''}
      </div>

      <button class="btn primary huge" data-action="primary">${phaseInfo.btn}</button>

      <div class="row session-tools">
        <button class="btn small" data-action="sets-minus" title="Remover série">− série</button>
        <button class="btn small" data-action="sets-plus" title="Adicionar série">+ série</button>
        <button class="btn small" data-action="skip">⏭ Pular</button>
        <button class="btn small danger" data-action="stop">■ Encerrar</button>
      </div>
    </section>`;
}

function renderDone() {
  const d = state.lastDone;
  const sets = d.exercises.reduce((a, e) => a + e.setsDone, 0);
  return `
    <section class="card done">
      <h2>🎉 Treino concluído!</h2>
      <p class="big-stat">${fmtDuration(d.durationMs)}</p>
      <p class="muted">${d.exercises.length} exercícios · ${sets} séries</p>
      <button class="btn primary" data-action="dismiss-done">OK</button>
    </section>`;
}

function renderPlano() {
  const day = state.editDay;
  const plan = dayPlan(day);
  const chips = DAYS.map((d, i) => `
    <button class="chip ${i === day ? 'active' : ''}" data-action="edit-day" data-day="${i}">
      ${d.slice(0, 3)}${dayPlan(i).items.length ? '<sup>●</sup>' : ''}
    </button>`).join('');

  const items = plan.items.map((it, i) => `
    <li class="plan-item">
      <div class="plan-item-head">
        <b>${i + 1}. ${esc(exById(it.exId).name)}</b>
        <span class="row tight">
          <button class="icon-btn" data-action="move" data-i="${i}" data-dir="-1" ${i === 0 ? 'disabled' : ''} title="Subir">↑</button>
          <button class="icon-btn" data-action="move" data-i="${i}" data-dir="1" ${i === plan.items.length - 1 ? 'disabled' : ''} title="Descer">↓</button>
          <button class="icon-btn danger" data-action="remove-item" data-i="${i}" title="Remover">✕</button>
        </span>
      </div>
      <div class="grid4">
        <label class="field"><span>Séries</span><input type="number" min="1" max="20" inputmode="numeric" value="${it.sets}" data-item="${i}" data-key="sets"></label>
        <label class="field"><span>Reps</span><input type="text" inputmode="numeric" value="${esc(it.reps)}" data-item="${i}" data-key="reps"></label>
        <label class="field"><span>Carga (kg)</span><input type="text" inputmode="decimal" value="${esc(it.weight)}" data-item="${i}" data-key="weight"></label>
        <label class="field"><span>Descanso (s)</span><input type="number" min="0" inputmode="numeric" placeholder="${state.settings.restAlert}" value="${it.rest ?? ''}" data-item="${i}" data-key="rest"></label>
      </div>
    </li>`).join('');

  const otherDays = DAYS.map((d, i) => (i !== day && dayPlan(i).items.length) ? `<option value="${i}">${d}</option>` : '').join('');

  return `
    <section class="card">
      <div class="chips">${chips}</div>
      <label class="field"><span>Nome do treino de ${DAYS[day]}</span>
        <input type="text" placeholder="Ex.: Treino A – Peito e tríceps" value="${esc(plan.name)}" data-change="plan-name"></label>
      ${plan.items.length ? `<ul class="plain-list">${items}</ul>` : '<p class="empty">Dia de descanso. Adicione exercícios para montar o treino.</p>'}
      <div class="row">
        <button class="btn primary" data-action="pick">+ Adicionar exercício</button>
        ${otherDays ? `<select data-change="copy-from"><option value="">Copiar de…</option>${otherDays}</select>` : ''}
        ${plan.items.length ? '<button class="btn danger" data-action="clear-day">Limpar dia</button>' : ''}
      </div>
    </section>`;
}

function renderExercicios() {
  const { q, group } = state.libFilter;
  const needle = slug(q);
  const list = allExercises().filter((e) => (!group || e.group === group) && (!needle || slug(e.name).includes(needle)));
  const byGroup = GROUPS.map((g) => [g, list.filter((e) => e.group === g)]).filter(([, l]) => l.length);
  const customIds = new Set(state.custom.map((c) => c.id));
  const inPlan = new Set(dayPlan(state.editDay).items.map((it) => it.exId));

  const groupsHtml = byGroup.map(([g, l]) => `
    <h3>${g}</h3>
    <ul class="ex-list">${l.map((e) => {
      const added = state.pickMode && inPlan.has(e.id);
      return `
      <li>
        <button class="ex-row ${added ? 'added' : ''}" data-action="${state.pickMode ? 'toggle-in-plan' : 'noop'}" data-id="${esc(e.id)}">
          <span>${esc(e.name)}</span>${state.pickMode ? `<b class="add">${added ? '−' : '+'}</b>` : ''}
        </button>
        ${customIds.has(e.id) && !state.pickMode ? `<button class="icon-btn danger" data-action="del-custom" data-id="${esc(e.id)}" title="Excluir">✕</button>` : ''}
      </li>`;
    }).join('')}
    </ul>`).join('');

  return `
    <section class="card">
      ${state.pickMode ? `<div class="pick-banner"><span>Treino de <b>${DAYS[state.editDay]}</b>: <b>${inPlan.size}</b> exercício${inPlan.size === 1 ? '' : 's'}<br><small class="muted">Toque para adicionar ou remover</small></span>
        <button class="btn small" data-action="pick-done">Concluir</button></div>` : ''}
      <div class="row">
        <input type="search" placeholder="Buscar exercício…" value="${esc(q)}" data-change="lib-q" class="grow">
        <select data-change="lib-group"><option value="">Todos</option>${GROUPS.map((g) => `<option ${g === group ? 'selected' : ''}>${g}</option>`).join('')}</select>
      </div>
      ${groupsHtml || '<p class="empty">Nenhum exercício encontrado.</p>'}
      <details class="custom-form">
        <summary>Criar exercício personalizado</summary>
        <div class="row">
          <input type="text" id="custom-name" placeholder="Nome do exercício" class="grow">
          <select id="custom-group">${GROUPS.map((g) => `<option>${g}</option>`).join('')}</select>
          <button class="btn" data-action="add-custom">Criar</button>
        </div>
      </details>
    </section>`;
}

function renderHistorico() {
  if (!state.history.length) return '<section class="card"><p class="empty">Nenhum treino registrado ainda.</p></section>';
  const items = state.history.map((h) => {
    const d = new Date(h.date);
    const sets = h.exercises.reduce((a, e) => a + e.setsDone, 0);
    return `
      <details class="hist">
        <summary>
          <b>${d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })}</b>
          ${h.name ? esc(h.name) : DAYS[h.day]}
          <span class="muted">${fmtDuration(h.durationMs)} · ${sets} séries</span>
        </summary>
        <ul class="plain-list">${h.exercises.map((e) => `
          <li>${esc(e.name)} <span class="muted">${e.setsDone}/${e.setsPlanned} × ${esc(e.reps)}${(() => { const w = weightsLabel(e.weights || [e.weight]); return w ? ` · ${esc(w)}` : ''; })()}</span></li>`).join('')}
        </ul>
      </details>`;
  }).join('');
  return `
    <section class="card">
      <p class="muted">${state.history.length} treinos registrados</p>
      ${items}
      <button class="btn danger" data-action="clear-history">Apagar histórico</button>
    </section>`;
}

function renderAjustes() {
  const s = state.settings;
  const num = (key, label, hint, min = 5, step = 5) => `
    <label class="field"><span>${label}</span><input type="number" min="${min}" step="${step}" inputmode="decimal" value="${s[key]}" data-setting="${key}"><small>${hint}</small></label>`;
  const check = (key, label) => `
    <label class="check"><input type="checkbox" ${s[key] ? 'checked' : ''} data-setting="${key}"> ${label}</label>`;

  return `
    <section class="card">
      <h3>Cronômetros</h3>
      ${num('restAlert', 'Descanso entre séries (s)', 'Depois desse tempo o cronômetro pisca para lembrar de voltar.')}
      ${num('hydrateAlert', 'Pausa de hidratação entre exercícios (s)', 'Pausa maior ao trocar de exercício.')}
      ${num('alertRepeat', 'Repetir alerta a cada (s)', 'Vibração/som repetidos enquanto a pausa passar do limite.')}
      ${num('weightStep', 'Incremento da carga (kg)', 'Quanto os botões − e + mudam o peso durante o treino.', 0.5, 0.5)}
      <h3>Alertas</h3>
      ${check('vibrate', 'Vibrar')}
      ${check('sound', 'Tocar som')}
      ${check('keepAwake', 'Manter a tela ligada durante o treino')}
      <h3>Modo relógio</h3>
      <label class="field"><span>Interface compacta para smartwatch</span>
        <select data-setting="watchMode">
          <option value="auto" ${s.watchMode === 'auto' ? 'selected' : ''}>Automático (tela pequena)</option>
          <option value="on" ${s.watchMode === 'on' ? 'selected' : ''}>Sempre ligado neste aparelho</option>
          <option value="off" ${s.watchMode === 'off' ? 'selected' : ''}>Desligado</option>
        </select></label>
    </section>
    <section class="card">
      <h3>Levar o treino para outro aparelho</h3>
      <p class="muted">Gere um link com seu plano e abra-o no relógio ou em outro celular para importar.</p>
      <button class="btn" data-action="export">Gerar link de sincronização</button>
      <textarea id="export-out" readonly rows="3" hidden></textarea>
      <div class="row">
        <input type="text" id="import-in" placeholder="Cole aqui um link ou código" class="grow">
        <button class="btn" data-action="import">Importar</button>
      </div>
    </section>`;
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

function checkImportLink() {
  if (!location.hash.startsWith('#import=')) return;
  try {
    if (confirm('Importar o plano de treino deste link? O plano atual deste aparelho será substituído.')) {
      importCode(location.hash);
      alert('Plano importado!');
    }
  } catch { alert('Link de importação inválido.'); }
  history.replaceState(null, '', location.pathname + location.search);
}

// ---------- eventos ----------
function updatePlan(day, fn) {
  const plan = { ...dayPlan(day), items: [...dayPlan(day).items] };
  fn(plan);
  if (!plan.items.length && !plan.name) delete state.plans[day];
  else state.plans[day] = plan;
  save.plans();
}

document.addEventListener('click', (ev) => {
  const tabBtn = ev.target.closest('[data-tab]');
  if (tabBtn) {
    state.tab = tabBtn.dataset.tab;
    if (state.tab !== 'exercicios') state.pickMode = false;
    render();
    return;
  }
  const el = ev.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const a = el.dataset.action;
  const i = Number(el.dataset.i);

  switch (a) {
    case 'start': startSession(Number(el.dataset.day)); break;
    case 'primary': primaryAction(); break;
    case 'skip': skipExercise(); break;
    case 'stop': cancelSession(); break;
    case 'sets-plus': adjustSets(1); break;
    case 'sets-minus': adjustSets(-1); break;
    case 'weight-plus': stepWeight(1); break;
    case 'weight-minus': stepWeight(-1); break;
    case 'dismiss-done': state.lastDone = null; render(); break;
    case 'goto-plan': state.editDay = Number(el.dataset.day); state.tab = 'plano'; render(); break;
    case 'edit-day': state.editDay = Number(el.dataset.day); render(); break;
    case 'pick': state.pickMode = true; state.tab = 'exercicios'; render(); break;
    case 'pick-done': state.pickMode = false; state.tab = 'plano'; render(); break;
    case 'toggle-in-plan': {
      const id = el.dataset.id;
      updatePlan(state.editDay, (p) => {
        const idx = p.items.findIndex((it) => it.exId === id);
        if (idx >= 0) p.items.splice(idx, 1);
        else p.items.push({ exId: id, sets: 3, reps: '8', weight: '', rest: null });
      });
      render();
      break;
    }
    case 'move':
      updatePlan(state.editDay, (p) => {
        const j = i + Number(el.dataset.dir);
        [p.items[i], p.items[j]] = [p.items[j], p.items[i]];
      });
      render();
      break;
    case 'remove-item': updatePlan(state.editDay, (p) => p.items.splice(i, 1)); render(); break;
    case 'clear-day':
      if (confirm(`Apagar o treino de ${DAYS[state.editDay]}?`)) { delete state.plans[state.editDay]; save.plans(); render(); }
      break;
    case 'add-custom': {
      const name = $('#custom-name').value.trim();
      if (!name) return;
      const id = 'custom-' + slug(name) + '-' + Date.now().toString(36);
      state.custom.push({ id, name, group: $('#custom-group').value });
      save.custom();
      render();
      break;
    }
    case 'del-custom':
      if (confirm('Excluir este exercício personalizado?')) {
        state.custom = state.custom.filter((c) => c.id !== el.dataset.id);
        save.custom();
        render();
      }
      break;
    case 'clear-history':
      if (confirm('Apagar todo o histórico de treinos?')) { state.history = []; save.history(); render(); }
      break;
    case 'export': {
      const out = $('#export-out');
      const url = location.origin + location.pathname + '#import=' + encodeURIComponent(exportCode());
      out.hidden = false;
      out.value = url;
      out.select();
      navigator.clipboard?.writeText(url).then(() => { el.textContent = 'Link copiado ✓'; }, () => {});
      break;
    }
    case 'import':
      try { importCode($('#import-in').value); alert('Plano importado!'); render(); }
      catch { alert('Código inválido.'); }
      break;
  }
});

document.addEventListener('change', (ev) => {
  const el = ev.target;
  if (el.dataset.setting) {
    const key = el.dataset.setting;
    state.settings[key] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Math.max(Number(el.min) || 0, Number(el.value) || DEFAULT_SETTINGS[key]) : el.value;
    save.settings();
    if (key === 'watchMode') render();
    return;
  }
  if (el.dataset.item !== undefined) {
    const i = Number(el.dataset.item), key = el.dataset.key;
    updatePlan(state.editDay, (p) => {
      const it = { ...p.items[i] };
      if (key === 'sets') it.sets = Math.max(1, Math.min(20, Number(el.value) || 1));
      else if (key === 'rest') it.rest = el.value === '' ? null : Math.max(0, Number(el.value));
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
    case 'treino-day': state.treinoDay = Number(el.value); render(); break;
    case 'plan-name': updatePlan(state.editDay, (p) => { p.name = el.value.trim(); }); break;
    case 'lib-group': state.libFilter.group = el.value; render(); break;
    case 'copy-from':
      if (el.value !== '' && confirm(`Copiar o treino de ${DAYS[el.value]} para ${DAYS[state.editDay]}?`)) {
        state.plans[state.editDay] = JSON.parse(JSON.stringify(dayPlan(Number(el.value))));
        save.plans();
      }
      render();
      break;
  }
});

document.addEventListener('input', (ev) => {
  if (ev.target.dataset.change === 'lib-q') {
    state.libFilter.q = ev.target.value;
    const pos = ev.target.selectionStart;
    render();
    const input = $('[data-change="lib-q"]');
    input.focus();
    input.setSelectionRange(pos, pos);
  }
});

// Atalhos de teclado (útil no computador): espaço = play/pausa
document.addEventListener('keydown', (ev) => {
  if (ev.code === 'Space' && state.session && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) {
    ev.preventDefault();
    primaryAction();
  }
});

window.addEventListener('resize', () => {
  const was = document.body.classList.contains('watch');
  if (was !== isWatch()) render();
});

// ---------- início ----------
checkImportLink();
render();
updateWakeLock();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
