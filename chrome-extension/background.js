/**
 * Painel Fiscal — Background Service Worker v3.0
 *
 * Mudanças principais em relação à v2.2.0:
 *   • Persistência completa do estado (hubQueue, activeSession, pomodoro,
 *     hourlyStats, manualHubTimer) em chrome.storage → sobrevive ao SW dormir
 *   • Pomodoro via chrome.alarms (não mais setInterval)
 *   • Sessões abandonadas são fechadas automaticamente após inatividade
 *   • Bug fix: findSimilarQuestions agora itera sobre o questionBank plano
 *   • Schema versionado + pruning automático de today_* > 60 dias
 *   • Heatmap dia-da-semana × hora
 *   • Forgetting curve / retention analytics
 *   • Comparação semanal (esta semana vs anterior)
 *   • Time-per-question (médias por matéria/assunto)
 *   • Insights em linguagem natural
 *   • Smart goal (meta ajustada ao histórico)
 *   • Calendário de revisões dos próximos 7 dias
 *   • Sugestão de interleaving
 *   • Predição de acerto por questão (baseada em SM-2)
 *   • Notes & tags por questão
 *   • Export Anki (.txt importável)
 *   • Backup automático + import JSON
 *
 * Contrato de mensagens com o painel externo (cazuzaleo89-netizen.github.io)
 * é mantido intacto. Apenas mensagens internas (extensão ↔ extensão) foram
 * adicionadas.
 */

const PANEL_URL_PATTERN = 'https://cazuzaleo89-netizen.github.io/projetofiscal/*';
const SCHEMA_VERSION    = 3;
const STATE_KEY         = 'pf_persistent_state';
const SESSION_IDLE_MIN  = 30;   // minutos de inatividade → encerra sessão
const TODAY_RETENTION_D = 90;   // mantém today_* dos últimos N dias

// ══════════════════════════════════════════════════════════════════════════
// ESTADO EM MEMÓRIA (persistido a cada mudança em chrome.storage)
// ══════════════════════════════════════════════════════════════════════════

const state = {
  hubQueue:        [],                                  // [{qid,url,materia,assunto,desc,phase,reviewAt,addedAt,customMins,mins}]
  activeSession:   null,                                // {id,date,startTime,...}
  hourlyStats:     Array(24).fill(null).map(() => ({ q: 0, ace: 0 })),
  hourlyStatsDay:  '',                                  // YYYY-MM-DD do hourlyStats
  pomodoro: {
    active: false, state: 'work',
    workMins: 25, breakMins: 5, longBreakMins: 15,
    count: 0, endTime: null,
  },
  manualHubTimer:  { running: false, label: '', totalSecs: 0, startTs: null },
  timer:           { startTime: null, elapsed: 0, running: false },
  panelTabId:      null,
  tecTabId:        null,
  filaCount:       0,
};

let _stateLoaded = false;
let _stateSaveTimer = null;

async function loadState() {
  if (_stateLoaded) return;
  _stateLoaded = true;
  try {
    const stored = await new Promise(r => chrome.storage.local.get(STATE_KEY, r));
    const s = stored[STATE_KEY];
    if (!s) return;

    if (Array.isArray(s.hubQueue))   state.hubQueue = s.hubQueue;
    if (s.activeSession)              state.activeSession = s.activeSession;
    if (Array.isArray(s.hourlyStats) && s.hourlyStats.length === 24)
      state.hourlyStats = s.hourlyStats;
    if (s.hourlyStatsDay)             state.hourlyStatsDay = s.hourlyStatsDay;
    if (s.pomodoro)                   state.pomodoro = { ...state.pomodoro, ...s.pomodoro };
    if (s.manualHubTimer)             state.manualHubTimer = s.manualHubTimer;
    if (s.timer)                      state.timer = s.timer;

    // Reset hourlyStats se mudou o dia
    ensureHourlyDay();
  } catch { /* */ }
}

function saveStateNow() {
  return new Promise(r => chrome.storage.local.set({ [STATE_KEY]: {
    hubQueue:       state.hubQueue,
    activeSession:  state.activeSession,
    hourlyStats:    state.hourlyStats,
    hourlyStatsDay: state.hourlyStatsDay,
    pomodoro:       state.pomodoro,
    manualHubTimer: state.manualHubTimer,
    timer:          state.timer,
    savedAt:        Date.now(),
  } }, r));
}

// Debounced save — agrupa escritas em 300ms
function saveState() {
  if (_stateSaveTimer) clearTimeout(_stateSaveTimer);
  _stateSaveTimer = setTimeout(() => { _stateSaveTimer = null; saveStateNow(); }, 300);
}

function ensureHourlyDay() {
  const today = todayKey();
  if (state.hourlyStatsDay !== today) {
    state.hourlyStatsDay = today;
    state.hourlyStats    = Array(24).fill(null).map(() => ({ q: 0, ace: 0 }));
    saveState();
  }
}

// ══════════════════════════════════════════════════════════════════════════
// UTILITÁRIOS
// ══════════════════════════════════════════════════════════════════════════

function todayKey() { return new Date().toISOString().split('T')[0]; }

function dayOfWeek(date) { return (date || new Date()).getDay(); } // 0=Dom

function ensureLoaded(fn) {
  // Wrapper async: garante state carregado antes de qualquer handler
  return async (...args) => { await loadState(); return fn(...args); };
}

async function getStorage(keys) {
  return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}
async function setStorage(data) {
  return new Promise(resolve => chrome.storage.local.set(data, resolve));
}

// ══════════════════════════════════════════════════════════════════════════
// MÉTODO HUBERMAN — fila de revisão de curto prazo
// ══════════════════════════════════════════════════════════════════════════

const HUB_PHASES = [5, 9, 11];

function hubAlarmName(qid) { return 'hub-' + qid; }

function hubSchedule(q, phase, customMins) {
  const mins = customMins != null ? customMins : HUB_PHASES[phase - 1];
  if (mins == null) return false;

  const idx = state.hubQueue.findIndex(h => h.qid === q.qid);
  if (idx >= 0) state.hubQueue.splice(idx, 1);
  chrome.alarms.clear(hubAlarmName(q.qid));

  const reviewAt = Date.now() + mins * 60 * 1000;
  state.hubQueue.push({
    qid:        q.qid,
    url:        q.url     || '',
    materia:    q.materia || '',
    assunto:    q.assunto || '',
    desc:       q.desc    || ('Questão #' + q.qid),
    phase,
    customMins: customMins || null,
    reviewAt,
    addedAt:    Date.now(),
    mins,
  });

  chrome.alarms.create(hubAlarmName(q.qid), { delayInMinutes: mins });
  saveState();
  return true;
}

function hubGetStatus() {
  const now = Date.now();
  return state.hubQueue.map(h => ({
    ...h,
    isDue:     now >= h.reviewAt,
    remaining: Math.max(0, Math.round((h.reviewAt - now) / 1000)),
    phaseName: h.customMins != null ? `${h.customMins}min (custom)` : `${HUB_PHASES[h.phase - 1]}min`,
  })).sort((a, b) => a.reviewAt - b.reviewAt);
}

function hubAdvancePhase(qid) {
  const idx = state.hubQueue.findIndex(h => h.qid === qid);
  if (idx < 0) return null;
  const item = state.hubQueue[idx];
  state.hubQueue.splice(idx, 1);
  chrome.alarms.clear(hubAlarmName(qid));

  const nextPhase = item.phase + 1;
  saveState();
  if (nextPhase <= HUB_PHASES.length) {
    hubSchedule(item, nextPhase);
    return 'next';
  }
  return 'done';
}

function hubResetPhase(qid) {
  const idx = state.hubQueue.findIndex(h => h.qid === qid);
  if (idx < 0) return;
  const item = state.hubQueue[idx];
  state.hubQueue.splice(idx, 1);
  chrome.alarms.clear(hubAlarmName(qid));
  hubSchedule(item, 1);
}

async function hubNotifyTec(item) {
  const tab = state.tecTabId ? { id: state.tecTabId } : await findTecTab();
  if (!tab) return;
  try { await chrome.tabs.sendMessage(tab.id, { type: 'HUBERMAN_DUE', item }); }
  catch { /* */ }
}

// ══════════════════════════════════════════════════════════════════════════
// CRONÔMETRO
// ══════════════════════════════════════════════════════════════════════════

function timerGetElapsed() {
  if (!state.timer.running || !state.timer.startTime) return state.timer.elapsed;
  return state.timer.elapsed + Math.floor((Date.now() - state.timer.startTime) / 1000);
}

function timerStart() {
  if (state.timer.running) return;
  state.timer.startTime = Date.now();
  state.timer.running   = true;
  saveState();
}

function timerPause() {
  if (!state.timer.running) return;
  state.timer.elapsed   = timerGetElapsed();
  state.timer.startTime = null;
  state.timer.running   = false;
  saveState();
}

function timerReset() {
  state.timer.startTime = null;
  state.timer.elapsed   = 0;
  state.timer.running   = false;
  saveState();
}

function timerSnapshot() {
  return { elapsed: timerGetElapsed(), running: state.timer.running };
}

// ══════════════════════════════════════════════════════════════════════════
// MODO POMODORO — agora via chrome.alarms (sobrevive ao SW dormir)
// ══════════════════════════════════════════════════════════════════════════

const POM_ALARM = 'pf_pomodoro_advance';

function pomodoroSnapshot() {
  const now = Date.now();
  const p   = state.pomodoro;
  const remaining = p.active && p.endTime
    ? Math.max(0, Math.round((p.endTime - now) / 1000))
    : 0;
  return {
    active:        p.active,
    state:         p.state,
    count:         p.count,
    workMins:      p.workMins,
    breakMins:     p.breakMins,
    longBreakMins: p.longBreakMins,
    remaining,
    endTime:       p.endTime,
  };
}

function pomodoroDurationMs() {
  const p = state.pomodoro;
  if (p.state === 'work')       return p.workMins      * 60 * 1000;
  if (p.state === 'longBreak')  return p.longBreakMins * 60 * 1000;
  return p.breakMins * 60 * 1000;
}

function pomodoroAdvance() {
  const p = state.pomodoro;
  if (p.state === 'work') {
    p.count++;
    if (p.count % 4 === 0) {
      p.state = 'longBreak';
      showNotification('☕ Pausa longa!', `${p.longBreakMins} minutos de descanso. Você completou ${p.count} pomodoros!`, 'pom-break');
    } else {
      p.state = 'break';
      showNotification('☕ Pausa curta!', `${p.breakMins} minutos de descanso.`, 'pom-break');
    }
  } else {
    p.state = 'work';
    showNotification('🍅 Hora de trabalhar!', `${p.workMins} minutos de foco. Pomodoro #${p.count + 1}.`, 'pom-work');
  }
  p.endTime = Date.now() + pomodoroDurationMs();
  scheduleNextPomodoroAlarm();
  saveState();
}

function scheduleNextPomodoroAlarm() {
  chrome.alarms.clear(POM_ALARM);
  if (!state.pomodoro.active || !state.pomodoro.endTime) return;
  const remainingMs = state.pomodoro.endTime - Date.now();
  const minutes     = Math.max(1/60, remainingMs / 60000); // mínimo 1s
  chrome.alarms.create(POM_ALARM, { delayInMinutes: minutes });
}

function pomodoroStart() {
  const p = state.pomodoro;
  p.active  = true;
  p.state   = 'work';
  p.endTime = Date.now() + pomodoroDurationMs();
  scheduleNextPomodoroAlarm();
  saveState();
}

function pomodoroStop() {
  state.pomodoro.active  = false;
  state.pomodoro.endTime = null;
  chrome.alarms.clear(POM_ALARM);
  saveState();
}

function pomodoroSkip() {
  if (!state.pomodoro.active) return;
  pomodoroAdvance();
}

// ══════════════════════════════════════════════════════════════════════════
// MANUAL HUBERMAN TIMER
// ══════════════════════════════════════════════════════════════════════════

const MAN_HUB_ALARM = 'pf_manual_hub_review';

function manualHubSnapshot() {
  const t = state.manualHubTimer;
  if (!t.running) return { running: false };
  const remaining = Math.max(0, t.totalSecs - Math.floor((Date.now() - t.startTs) / 1000));
  return { running: true, label: t.label, totalSecs: t.totalSecs, remaining };
}

// ══════════════════════════════════════════════════════════════════════════
// SM-2 (Repetição espaçada)
// ══════════════════════════════════════════════════════════════════════════

function sm2Update(item, quality) {
  let { repetitions = 0, easeFactor = 2.5, interval = 1 } = item;

  if (quality >= 3) {
    if (repetitions === 0)      interval = 1;
    else if (repetitions === 1) interval = 6;
    else                        interval = Math.round(interval * easeFactor);
    repetitions++;
  } else {
    repetitions = 0;
    interval    = 1;
  }

  easeFactor = Math.max(1.3, easeFactor + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));

  const nextReview = new Date();
  nextReview.setDate(nextReview.getDate() + interval);

  return {
    repetitions,
    easeFactor: parseFloat(easeFactor.toFixed(2)),
    interval,
    nextReview: nextReview.toISOString().split('T')[0],
    lastReviewedAt: Date.now(),
  };
}

// Predição de retenção (Ebbinghaus simplificado, baseada em SM-2)
function predictRetention(item) {
  if (!item || item.lastReviewedAt == null) return 0.5;
  const elapsedDays = (Date.now() - item.lastReviewedAt) / 86400000;
  const interval    = Math.max(1, item.interval || 1);
  // R = exp(-elapsed / (interval * easeFactor))
  const stability   = interval * Math.max(1, item.easeFactor || 2.5);
  return Math.max(0.05, Math.min(0.99, Math.exp(-elapsedDays / stability)));
}

// ══════════════════════════════════════════════════════════════════════════
// ITEM RESPONSE THEORY (IRT 2PL) — modelo psicométrico
// ══════════════════════════════════════════════════════════════════════════
//  Cada questão tem dificuldade (b) e discriminação (a):
//   P(acerto | θ) = 1 / (1 + exp(-a * (θ - b)))
//   I(θ) = a² * P(θ) * (1 - P(θ))  [função de informação de Fisher]
//  θ é estimado por matéria via MAP (gradient + prior Gaussiano N(0,1))
//
//  Calibração inicial:
//    - b derivado da própria performance histórica do user no assunto (logit)
//    - a fixo em 1.0 (sem múltiplos respondentes, não conseguimos discriminar)

function logit(p) { return Math.log(p / (1 - p)); }
function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }

function irtProbability(theta, a, b) {
  return sigmoid(a * (theta - b));
}

function irtInformation(theta, a, b) {
  const p = irtProbability(theta, a, b);
  return a * a * p * (1 - p);
}

// Calibra b de um item baseado no histórico agregado por assunto.
// Items que o user historicamente erra muito → b alto (difícil pra ele).
async function calibrateItemIRT(item) {
  if (!item) return { a: 1.0, b: 0.0 };
  if (item.irt && Number.isFinite(item.irt.b)) return item.irt;

  // Usa taxa de acerto histórica do próprio item; com poucos dados, recorre ao subjectStats
  const total = (item.acertos || 0) + (item.erros || 0);
  let rate;
  if (total >= 3) {
    rate = item.acertos / total;
  } else if (item.materia) {
    const stats = await getSubjectStats();
    const s = stats.find(x => x.materia === item.materia);
    rate = s && s.total > 0 ? s.acertos / s.total : 0.5;
  } else rate = 0.5;

  // Limita extremos pra evitar logit infinito
  rate = Math.max(0.05, Math.min(0.95, rate));
  // b inverso da taxa de acerto: quem acerta muito → b baixo (questões fáceis pra ele)
  const b = -logit(rate);
  // Clamp em ±3 (escala IRT padrão)
  return { a: 1.0, b: Math.max(-3, Math.min(3, b)) };
}

async function loadThetaMap() {
  const stored = await getStorage('pf_irt');
  return stored.pf_irt || {};
}

async function saveThetaMap(thetaMap) {
  await setStorage({ pf_irt: thetaMap });
}

// Atualiza theta por matéria via MAP (gradient + prior N(0,1))
async function updateTheta(materia, response, a, b) {
  if (!materia) return;
  const thetaMap = await loadThetaMap();
  const cur = thetaMap[materia] || { theta: 0, n: 0, lastUpdate: 0 };

  const expected = irtProbability(cur.theta, a, b);
  // Gradient do log-posterior: a*(y - P) - θ (prior Gaussiano padrão)
  const grad   = a * (response - expected) - cur.theta;
  // Learning rate decai com n (mais estável quanto mais dados)
  const lr     = 0.3 / Math.sqrt(1 + cur.n * 0.1);
  let newTheta = cur.theta + lr * grad;
  newTheta     = Math.max(-3, Math.min(3, newTheta));

  thetaMap[materia] = { theta: newTheta, n: cur.n + 1, lastUpdate: Date.now() };
  await saveThetaMap(thetaMap);
}

// Recommended next questions (top-N pelo ganho de informação)
async function irtSelectAdaptive(materia, count = 10) {
  const thetaMap = await loadThetaMap();
  const theta    = thetaMap[materia]?.theta ?? 0;
  const wrong    = await loadWrongBank();
  let pool       = Object.values(wrong);
  if (materia) pool = pool.filter(q => q.materia === materia);
  if (!pool.length) return { questions: [], theta, n: thetaMap[materia]?.n || 0 };

  // Calibra IRT pra todos
  const calibrated = await Promise.all(pool.map(async q => {
    const irt = q.irt || (await calibrateItemIRT(q));
    return { q, irt, info: irtInformation(theta, irt.a, irt.b) };
  }));

  calibrated.sort((a, b) => b.info - a.info);
  const questions = calibrated.slice(0, count).map(c => ({
    qid: c.q.qid, url: c.q.url, materia: c.q.materia,
    assunto: c.q.assunto, desc: c.q.desc,
    information: c.info, difficulty: c.irt.b,
  }));
  return { questions, theta, n: thetaMap[materia]?.n || 0 };
}

async function getIRTStats() {
  const thetaMap = await loadThetaMap();
  return Object.entries(thetaMap)
    .map(([materia, v]) => ({
      materia, theta: v.theta, n: v.n,
      // Habilidade percentil (0-100) ≈ φ(θ) onde φ é CDF normal
      percentile: Math.round(sigmoid(v.theta * 1.7) * 100),
    }))
    .sort((a, b) => b.n - a.n);
}

// Wrapper: chama calibração + persistência do IRT no item + update do theta
async function updateIRTAfterResponse(payload, response) {
  if (!payload.qid || !payload.materia) return;
  try {
    const { questionBank } = await getStorage({ questionBank: {} });
    const item = questionBank[payload.qid];
    if (!item) return;
    if (!item.irt) {
      item.irt = await calibrateItemIRT(item);
      questionBank[payload.qid] = item;
      await setStorage({ questionBank });
    }
    await updateTheta(payload.materia, response, item.irt.a, item.irt.b);
  } catch (e) { /* silencioso — não bloquear o fluxo */ }
}

// ══════════════════════════════════════════════════════════════════════════
// STATS DIÁRIOS / GLOBAIS
// ══════════════════════════════════════════════════════════════════════════

async function loadStats() {
  const { globalStats } = await getStorage({ globalStats: {
    totalResolved: 0, totalAcertos: 0, totalErros: 0,
    streak: 0, lastStudyDate: '',
  } });
  return globalStats;
}

async function updateGlobalStats(acertos, erros) {
  const stats = await loadStats();
  stats.totalResolved += acertos + erros;
  stats.totalAcertos  += acertos;
  stats.totalErros    += erros;

  const today = todayKey();
  if (stats.lastStudyDate !== today) {
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
    const yKey = yesterday.toISOString().split('T')[0];
    stats.streak = stats.lastStudyDate === yKey ? stats.streak + 1 : 1;
    stats.lastStudyDate = today;
  }
  await setStorage({ globalStats: stats });
  return stats;
}

async function updateTodayStats(delta) {
  const key = 'today_' + todayKey();
  const stored = await getStorage({ [key]: { date: todayKey(), resolved: 0, acertos: 0, erros: 0 } });
  const today = stored[key];
  today.resolved += (delta.acertos || 0) + (delta.erros || 0);
  today.acertos  += delta.acertos || 0;
  today.erros    += delta.erros   || 0;
  await setStorage({ [key]: today });
  return today;
}

async function getTodayStats() {
  const key = 'today_' + todayKey();
  const stored = await getStorage({ [key]: { date: todayKey(), resolved: 0, acertos: 0, erros: 0 } });
  return stored[key];
}

// ══════════════════════════════════════════════════════════════════════════
// QUESTION BANK & WRONG BANK (formato plano {qid: {...}})
// ══════════════════════════════════════════════════════════════════════════

async function loadQuestionBank() {
  const { questionBank } = await getStorage({ questionBank: {} });
  return questionBank;
}

async function updateQuestionBank(payload, result) {
  const { questionBank } = await getStorage({ questionBank: {} });
  const today = todayKey();
  const qid   = payload.qid || payload.pos?.toString() || 'unknown';
  if (!qid || qid === 'unknown') return;

  const existing = questionBank[qid] || {
    qid,
    url:     payload.url     || '',
    materia: payload.materia || '',
    assunto: payload.assunto || '',
    desc:    payload.desc    || ('Questão #' + qid),
    acertos: 0, erros: 0,
    firstSeen: today, lastSeen: today, importance: 1,
    times: [],
  };

  existing.lastSeen = today;
  if (payload.materia) existing.materia = payload.materia;
  if (payload.assunto) existing.assunto = payload.assunto;
  if (payload.url)     existing.url     = payload.url;
  if (payload.desc)    existing.desc    = payload.desc;

  // ── NOVO: persiste enunciado e alternativas se vierem (não sobrescreve com vazio)
  if (payload.enunciado && payload.enunciado.length > 30) {
    existing.enunciado = payload.enunciado;
  }
  if (payload.alternativas && Object.keys(payload.alternativas).length >= 4) {
    existing.alternativas = payload.alternativas;
  }

  if (result === 'correct') existing.acertos++;
  else                      existing.erros++;

  // importance: 1=nunca errou, 2=errou 1x, 3=errou 2+
  existing.importance = existing.erros === 0 ? 1 : existing.erros === 1 ? 2 : 3;

  // Time-per-question (mantém últimas 5 medições)
  if (payload.timeSpent && payload.timeSpent > 1 && payload.timeSpent < 1800) {
    existing.times = existing.times || [];
    existing.times.push(payload.timeSpent);
    if (existing.times.length > 5) existing.times.shift();
    existing.avgTime = Math.round(existing.times.reduce((a, b) => a + b, 0) / existing.times.length);
  }

  questionBank[qid] = existing;
  await setStorage({ questionBank });
}

async function loadWrongBank() {
  const { wrongBank } = await getStorage({ wrongBank: {} });
  return wrongBank;
}

async function addToWrongBank(payload) {
  if (!payload.qid) return;
  const bank  = await loadWrongBank();
  const today = todayKey();

  if (bank[payload.qid]) {
    bank[payload.qid].errorCount = (bank[payload.qid].errorCount || 1) + 1;
    bank[payload.qid].lastError  = today;
    bank[payload.qid].nextReview = today;
    if (payload.materia)     bank[payload.qid].materia     = payload.materia;
    if (payload.assunto)     bank[payload.qid].assunto     = payload.assunto;
    if (payload.desc)        bank[payload.qid].desc        = payload.desc;
    if (payload.dificuldade) bank[payload.qid].dificuldade = payload.dificuldade;
    if (payload.enunciado && payload.enunciado.length > 30)
      bank[payload.qid].enunciado = payload.enunciado;
    if (payload.alternativas && Object.keys(payload.alternativas).length >= 4)
      bank[payload.qid].alternativas = payload.alternativas;
  } else {
    bank[payload.qid] = {
      qid:         payload.qid,
      url:         payload.url         || '',
      materia:     payload.materia     || '',
      assunto:     payload.assunto     || '',
      desc:        payload.desc        || 'Questão #' + payload.qid,
      dificuldade: payload.dificuldade || '',
      enunciado:   payload.enunciado   || '',
      alternativas: payload.alternativas || null,
      errorCount:  1,
      firstError:  today,
      lastError:   today,
      nextReview:  today,
      interval:    1,
      repetitions: 0,
      easeFactor:  2.5,
      lastReviewedAt: Date.now(),
    };
  }
  await setStorage({ wrongBank: bank });
  return bank;
}

async function reviewWrongQuestion(qid, quality) {
  const bank = await loadWrongBank();
  if (!bank[qid]) return;

  const before  = { ...bank[qid] };
  const updated = sm2Update(bank[qid], quality);
  Object.assign(bank[qid], updated);

  // Log de revisão para forgetting curve
  await logReview({
    qid,
    materia: bank[qid].materia || '',
    quality,
    daysSinceLastReview: before.lastReviewedAt
      ? Math.max(0, Math.round((Date.now() - before.lastReviewedAt) / 86400000))
      : null,
    ts: Date.now(),
  });

  if (quality >= 4 && bank[qid].repetitions >= 3) {
    delete bank[qid];  // questão dominada → sai do banco
  }

  await setStorage({ wrongBank: bank });
  return bank;
}

// ══════════════════════════════════════════════════════════════════════════
// SIMILARIDADE (bug fix: agora itera no banco plano)
// ══════════════════════════════════════════════════════════════════════════

const PT_STOPWORDS = new Set([
  'para','com','uma','ser','que','não','por','mais','como','mas','foi','ele',
  'ela','seu','sua','dos','das','nas','nos','num','uns','umas','lhe','nós',
  'isso','esse','esta','este','essa','pelo','pela','depois','mesmo','entre',
  'sobre','ainda','porque','quando','quem','está','caso','seja','deve','cada',
  'todo','toda','todos','todas','assim','desde','durante','apenas','podem',
  'pode','fazer','feita','feito','tendo','sendo','foram','teria','seria',
  'também','onde','qual','quais','quanto','sem','após','ante','perante',
  'salvo','exceto','inclusive','mediante','conforme','segundo','artigo',
  'inciso','parágrafo','alínea','qualquer','razão','forma','vista','valor',
  'prazo','cujas','cujos','cuja','cujo','deste','desta','desse','nesse',
  'nesta','neste','aquele','aquela','tanto',
]);

function extractKeywords(text, materia, assunto) {
  const src = ((text || '') + ' ' + (materia || '') + ' ' + (assunto || '')).toLowerCase();
  const kws = new Set();

  const artRefs = src.match(/art(?:igo)?\.?\s*\d+[oº°]?(?:-[a-z])?/g) || [];
  artRefs.forEach(a => kws.add(a.replace(/\s+/g, '').replace('artigo', 'art.')));

  const parRefs = src.match(/§\s*\d+[oº°]?/g) || [];
  parRefs.forEach(p => kws.add(p.replace(/\s+/g, '')));

  const incRefs = src.match(/inciso\s+(?:[ivxlcdmIVXLCDM]+|\d+)/g) || [];
  incRefs.forEach(i => kws.add(i.replace(/\s+/g, '_')));

  const lawRefs = src.match(/\b(?:ctn|cf\/?\d{2}|crfb|clt|cpc|cp\b|cpp|cdc|lei\s+\d[\d./]+)\b/g) || [];
  lawRefs.forEach(l => kws.add(l.replace(/\s+/g, '_')));

  const words = src.replace(/[^\wáàâãéêíóôõúçñü\s]/g, ' ').split(/\s+/);
  words.forEach(w => {
    if (w.length > 4 && !PT_STOPWORDS.has(w) && !/^\d+$/.test(w)) kws.add(w);
  });

  return kws;
}

function jaccardSim(setA, setB) {
  if (!setA.size || !setB.size) return 0;
  let inter = 0;
  for (const k of setA) if (setB.has(k)) inter++;
  return inter / (setA.size + setB.size - inter);
}

async function findSimilarQuestions(payload, limit = 5) {
  const bank = await loadQuestionBank();

  // Constrói keywords da questão alvo separadas por componente
  const tgtEnunciadoText = payload.enunciado || payload.desc || '';
  const tgtAltsText = payload.alternativas
    ? Object.values(payload.alternativas).join(' ')
    : '';

  const tgtKwEnun = extractKeywords(tgtEnunciadoText, payload.materia, payload.assunto);
  const tgtKwAlts = tgtAltsText ? extractKeywords(tgtAltsText, '', '') : null;

  if (!tgtKwEnun.size) return [];

  const tgtQid       = payload.qid || payload.pos?.toString();
  const tgtAssunto   = payload.assunto || '';
  const tgtMateria   = payload.materia || payload.disciplina || '';
  const hasFullData  = !!(payload.enunciado && payload.alternativas);

  const results = [];

  // BUG FIX: banco é plano {qid: {...}}, não aninhado
  for (const q of Object.values(bank)) {
    if (!q || !q.qid || q.qid === tgtQid) continue;

    const qEnunText = q.enunciado || q.desc || '';
    const qAltsText = q.alternativas ? Object.values(q.alternativas).join(' ') : '';

    const qKwEnun = extractKeywords(qEnunText, q.materia, q.assunto);
    const simEnun = jaccardSim(tgtKwEnun, qKwEnun);

    // Similaridade nas alternativas só se ambos lados tiverem alternativas
    let simAlts = 0;
    if (tgtKwAlts && qAltsText) {
      const qKwAlts = extractKeywords(qAltsText, '', '');
      simAlts = jaccardSim(tgtKwAlts, qKwAlts);
    }

    const sameAssunto = tgtAssunto && q.assunto === tgtAssunto;
    const sameDisc    = tgtMateria && q.materia === tgtMateria;

    // Score composto:
    //  - Modo rico (alvo e candidato têm enunciado + alternativas):
    //      55% enunciado + 30% alternativas + bônus taxonomia
    //  - Modo legacy (sem alternativas em algum lado): só enunciado/desc
    let score;
    if (hasFullData && q.alternativas) {
      score = 0.55 * simEnun + 0.30 * simAlts
            + (sameAssunto ? 0.22 : 0) + (sameDisc ? 0.06 : 0);
    } else {
      score = simEnun + (sameAssunto ? 0.28 : 0) + (sameDisc ? 0.08 : 0);
    }

    if (score >= 0.18 || (sameAssunto && (q.erros || 0) > 0 && simEnun >= 0.10)) {
      // matchType ajuda o UI mostrar por que casou
      const matchType = simAlts >= 0.4 ? 'enun+alts'
                      : simEnun >= 0.3 ? 'enun'
                      : 'taxonomia';
      results.push({
        qid: q.qid,
        url: q.url || '',
        desc: q.desc || q.assunto || ('Questão #' + q.qid),
        materia: q.materia || '',
        assunto: q.assunto || '',
        importance: q.importance || 1,
        acertos: q.acertos || 0,
        erros:   q.erros   || 0,
        score: Math.round(score * 100) / 100,
        simEnun:    Math.round(simEnun * 100) / 100,
        simAlts:    Math.round(simAlts * 100) / 100,
        matchType,
        hasAlts: !!q.alternativas,
        // Flags da biblioteca PDF
        fromPDF:    !!q._fromPDF,
        pdfSource:  q._pdfSource || '',
        banca:      q.banca || '',
        ano:        q.ano   || null,
        gabarito:   q.gabarito || '',
      });
    }
  }

  return results.sort((a, b) => b.score - a.score || b.erros - a.erros).slice(0, limit);
}

async function getDueReviews() {
  const bank = await loadWrongBank();
  const today = todayKey();
  return Object.values(bank)
    .filter(q => q.nextReview <= today)
    .map(q => ({ ...q, retention: predictRetention(q) }))
    .sort((a, b) => {
      if (b.errorCount !== a.errorCount) return b.errorCount - a.errorCount;
      return a.nextReview.localeCompare(b.nextReview);
    });
}

// ══════════════════════════════════════════════════════════════════════════
// COBERTURA POR ARTIGO / PADRÕES DE CONFUSÃO
// ══════════════════════════════════════════════════════════════════════════

function extractArticleRefs(text, materia) {
  const src = ((text || '') + ' ' + (materia || '')).toLowerCase();
  const refs = new Set();
  const artRefs = src.match(/art(?:igo)?\.?\s*\d+[oº°]?(?:-[a-z])?/g) || [];
  artRefs.forEach(a => refs.add(a.replace(/\s+/g, '').replace('artigo', 'art.')));
  const parRefs = src.match(/§\s*\d+[oº°]?/g) || [];
  parRefs.forEach(p => refs.add(p.replace(/\s+/g, '')));
  return [...refs];
}

async function updateArticleCoverage(payload, result) {
  const refs = extractArticleRefs(payload.enunciado || payload.desc, payload.materia);
  if (!refs.length) return;
  const stored = await getStorage('pf_article_coverage');
  const cov    = stored.pf_article_coverage || {};
  const key    = (payload.materia || 'geral').toLowerCase().replace(/\s+/g, '_');
  if (!cov[key]) cov[key] = {};
  for (const ref of refs) {
    if (!cov[key][ref]) cov[key][ref] = { correct: 0, wrong: 0 };
    if (result === 'correct') cov[key][ref].correct++;
    else                      cov[key][ref].wrong++;
  }
  await setStorage({ pf_article_coverage: cov });
}

async function updateConfusionPatterns(payload) {
  const refs = extractArticleRefs(payload.enunciado || payload.desc, payload.materia);
  if (refs.length < 2) return;
  const stored   = await getStorage('pf_confusion_patterns');
  const patterns = stored.pf_confusion_patterns || {};
  for (let i = 0; i < refs.length; i++) {
    for (let j = i + 1; j < refs.length; j++) {
      const pairKey = [refs[i], refs[j]].sort().join('||');
      if (!patterns[pairKey]) {
        patterns[pairKey] = { a: refs[i], b: refs[j], count: 0, materia: payload.materia || '' };
      }
      patterns[pairKey].count++;
    }
  }
  await setStorage({ pf_confusion_patterns: patterns });
}

function clusterDueReviews(dueReviews) {
  const clusters = {};
  for (const q of dueReviews) {
    const key = (q.assunto || q.materia || 'geral').toLowerCase();
    if (!clusters[key]) {
      clusters[key] = { label: q.assunto || q.materia || 'Geral', materia: q.materia || '', items: [] };
    }
    clusters[key].items.push(q);
  }
  return Object.values(clusters).sort((a, b) => b.items.length - a.items.length);
}

// ══════════════════════════════════════════════════════════════════════════
// HEATMAP DIA-DA-SEMANA × HORA
// ══════════════════════════════════════════════════════════════════════════

async function updateHeatmap(result) {
  const stored = await getStorage('pf_heatmap');
  const hm     = stored.pf_heatmap || {};
  const now    = new Date();
  const key    = `${now.getDay()}_${now.getHours()}`;
  if (!hm[key]) hm[key] = { q: 0, ace: 0 };
  hm[key].q++;
  if (result === 'correct') hm[key].ace++;
  await setStorage({ pf_heatmap: hm });
}

async function getHeatmap() {
  const stored = await getStorage('pf_heatmap');
  return stored.pf_heatmap || {};
}

// ══════════════════════════════════════════════════════════════════════════
// LOG DE REVISÕES (forgetting curve)
// ══════════════════════════════════════════════════════════════════════════

async function logReview(entry) {
  const stored = await getStorage('pf_review_log');
  const log    = stored.pf_review_log || [];
  log.push(entry);
  if (log.length > 1000) log.splice(0, log.length - 1000);
  await setStorage({ pf_review_log: log });
}

async function getForgettingCurve() {
  const stored = await getStorage('pf_review_log');
  const log    = stored.pf_review_log || [];
  // Buckets: 1d, 3d, 7d, 14d, 30d, 60d+
  const buckets = [
    { label: '1d',   max: 1,    correct: 0, total: 0 },
    { label: '3d',   max: 3,    correct: 0, total: 0 },
    { label: '7d',   max: 7,    correct: 0, total: 0 },
    { label: '14d',  max: 14,   correct: 0, total: 0 },
    { label: '30d',  max: 30,   correct: 0, total: 0 },
    { label: '60d+', max: 9999, correct: 0, total: 0 },
  ];
  for (const e of log) {
    if (e.daysSinceLastReview == null) continue;
    const b = buckets.find(b => e.daysSinceLastReview <= b.max);
    if (!b) continue;
    b.total++;
    if ((e.quality || 0) >= 3) b.correct++;
  }
  return buckets.map(b => ({
    label: b.label,
    rate:  b.total > 0 ? Math.round(b.correct / b.total * 100) : null,
    n:     b.total,
  }));
}

// ══════════════════════════════════════════════════════════════════════════
// CLAUDE API (mantido inalterado funcionalmente)
// ══════════════════════════════════════════════════════════════════════════

async function callClaudeForConcepts(text, apiKey) {
  if (!apiKey || !text) return null;
  const cacheKey = 'sem_' + Array.from(text.slice(0, 200))
    .reduce((h, c) => (Math.imul(31, h) + c.charCodeAt(0)) | 0, 0).toString(36);
  const stored = await getStorage('pf_semantic_cache');
  const cache  = stored.pf_semantic_cache || {};
  if (cache[cacheKey]) return cache[cacheKey];
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 256,
        messages: [{
          role: 'user',
          content: `Extraia conceitos jurídicos e artigos desta questão. Responda APENAS com JSON: {"concepts":["conceito1"],"articles":["art.X"]}\n\nQuestão: ${text.slice(0, 600)}`,
        }],
      }),
    });
    if (!resp.ok) return null;
    const data  = await resp.json();
    const raw   = data.content?.[0]?.text || '';
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    cache[cacheKey] = parsed;
    const keys = Object.keys(cache);
    if (keys.length > 500) keys.slice(0, 50).forEach(k => delete cache[k]);
    await setStorage({ pf_semantic_cache: cache });
    return parsed;
  } catch { return null; }
}

// ══════════════════════════════════════════════════════════════════════════
// SESSÕES
// ══════════════════════════════════════════════════════════════════════════

async function saveSessionToHistory(session) {
  if (!session) return;
  const { sessions = [] } = await getStorage({ sessions: [] });
  sessions.unshift(session);
  if (sessions.length > 100) sessions.length = 100;
  await setStorage({ sessions });
}

async function getSessions(limit = 20) {
  const { sessions = [] } = await getStorage({ sessions: [] });
  return sessions.slice(0, limit);
}

async function closeActiveSession(reason) {
  if (!state.activeSession) return;
  state.activeSession.endTime = Date.now();
  state.activeSession.elapsed = timerGetElapsed();
  state.activeSession.reason  = reason || 'closed';
  await saveSessionToHistory({ ...state.activeSession });
  await updateGlobalStats(state.activeSession.acertos || 0, state.activeSession.erros || 0);
  state.activeSession = null;
  saveState();
}

// ══════════════════════════════════════════════════════════════════════════
// SUBJECT STATS
// ══════════════════════════════════════════════════════════════════════════

async function updateSubjectStats(materia, acertos, erros, assunto) {
  if (!materia) return;
  const { subjectStats = {} } = await getStorage({ subjectStats: {} });
  if (!subjectStats[materia]) {
    subjectStats[materia] = { materia, acertos: 0, erros: 0, total: 0, assuntos: {} };
  }
  subjectStats[materia].acertos += acertos;
  subjectStats[materia].erros   += erros;
  subjectStats[materia].total   += acertos + erros;
  if (assunto) {
    if (!subjectStats[materia].assuntos) subjectStats[materia].assuntos = {};
    if (!subjectStats[materia].assuntos[assunto]) {
      subjectStats[materia].assuntos[assunto] = { assunto, acertos: 0, erros: 0, total: 0 };
    }
    subjectStats[materia].assuntos[assunto].acertos += acertos;
    subjectStats[materia].assuntos[assunto].erros   += erros;
    subjectStats[materia].assuntos[assunto].total   += acertos + erros;
  }
  await setStorage({ subjectStats });
}

async function getSubjectStats() {
  const { subjectStats = {} } = await getStorage({ subjectStats: {} });
  return Object.values(subjectStats).sort((a, b) => b.total - a.total);
}

// ══════════════════════════════════════════════════════════════════════════
// SETTINGS
// ══════════════════════════════════════════════════════════════════════════

async function getSettings() {
  const { settings } = await getStorage({ settings: {
    dailyGoal:    30,
    smartGoal:    false,
    notifications: true,
    autoReveal:    true,
    targetRate:    70,
    autoBackup:    true,
  } });
  return settings;
}

// ══════════════════════════════════════════════════════════════════════════
// SMART GOAL — meta sugerida com base nos últimos 14 dias
// ══════════════════════════════════════════════════════════════════════════

async function calculateSmartGoal() {
  const settings = await getSettings();
  if (!settings.smartGoal) return settings.dailyGoal || 30;

  const days = [];
  for (let i = 1; i <= 14; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const key = 'today_' + d.toISOString().split('T')[0];
    const stored = await getStorage({ [key]: null });
    if (stored[key]) days.push(stored[key].resolved || 0);
  }
  const studyDays = days.filter(n => n > 0);
  if (studyDays.length < 3) return settings.dailyGoal || 30;

  const avg = studyDays.reduce((a, b) => a + b, 0) / studyDays.length;
  // 5% acima da média, com mínimo 10 e máximo 200
  return Math.max(10, Math.min(200, Math.round(avg * 1.05)));
}

// ══════════════════════════════════════════════════════════════════════════
// STATS SEMANAIS + COMPARAÇÃO
// ══════════════════════════════════════════════════════════════════════════

async function getWeekStats() {
  const days = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  const result = [];
  const keys   = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    keys.push('today_' + d.toISOString().split('T')[0]);
  }
  // Single batched read
  const stored = await getStorage(keys);
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    const data = stored['today_' + dateStr] || { date: dateStr, resolved: 0, acertos: 0, erros: 0 };
    const taxa = data.resolved > 0 ? Math.round(data.acertos / data.resolved * 100) : 0;
    result.push({
      date: dateStr,
      label: days[d.getDay()],
      resolved: data.resolved || 0,
      acertos:  data.acertos  || 0,
      erros:    data.erros    || 0,
      taxa,
    });
  }
  return result;
}

async function getWeeklyCompare() {
  const keys = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    keys.push('today_' + d.toISOString().split('T')[0]);
  }
  const stored = await getStorage(keys);
  let curr = { resolved: 0, acertos: 0 };
  let prev = { resolved: 0, acertos: 0 };
  for (let i = 13; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const data = stored['today_' + d.toISOString().split('T')[0]] || {};
    const target = i < 7 ? curr : prev;
    target.resolved += data.resolved || 0;
    target.acertos  += data.acertos  || 0;
  }
  const currRate = curr.resolved > 0 ? Math.round(curr.acertos / curr.resolved * 100) : 0;
  const prevRate = prev.resolved > 0 ? Math.round(prev.acertos / prev.resolved * 100) : 0;
  return {
    current:  { ...curr, rate: currRate },
    previous: { ...prev, rate: prevRate },
    deltaResolved: curr.resolved - prev.resolved,
    deltaRate:     currRate - prevRate,
  };
}

// ══════════════════════════════════════════════════════════════════════════
// CALENDÁRIO DE REVISÕES (próximos 7 dias)
// ══════════════════════════════════════════════════════════════════════════

async function getReviewCalendar() {
  const bank = await loadWrongBank();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(today); d.setDate(d.getDate() + i);
    days.push({
      date: d.toISOString().split('T')[0],
      dow:  ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'][d.getDay()],
      items: [],
    });
  }
  const lastDay = days[6].date;
  for (const q of Object.values(bank)) {
    if (!q.nextReview) continue;
    if (q.nextReview > lastDay) continue;
    // Tudo que está vencido vai para o dia 0 (hoje)
    let targetDate = q.nextReview < days[0].date ? days[0].date : q.nextReview;
    const day = days.find(d => d.date === targetDate);
    if (day) day.items.push({
      qid: q.qid, materia: q.materia || '', assunto: q.assunto || '',
      desc: q.desc, errorCount: q.errorCount || 0,
    });
  }
  return days;
}

// ══════════════════════════════════════════════════════════════════════════
// INTERLEAVING — sugere mix de matérias para a próxima sessão
// ══════════════════════════════════════════════════════════════════════════

async function getInterleavingSuggestion() {
  const stats = await getSubjectStats();
  if (stats.length < 2) return null;

  const withRate = stats.map(s => ({
    ...s,
    erroRate: s.total > 0 ? s.erros / s.total : 0,
  }));

  // 3 matérias com pior taxa (mas total >= 5 para evitar ruído)
  const weak = withRate.filter(s => s.total >= 5).sort((a, b) => b.erroRate - a.erroRate).slice(0, 3);
  if (weak.length < 2) return null;

  const totalQ = 24;
  const perSubject = Math.floor(totalQ / weak.length);
  return {
    suggestion: weak.map(s => ({
      materia: s.materia,
      questions: perSubject,
      erroRate: Math.round(s.erroRate * 100),
    })),
    rationale: `Misture ${weak.length} matérias fracas (${weak.map(s => s.materia).join(', ')}) — interleaving melhora retenção em 30-50%.`,
  };
}

// ══════════════════════════════════════════════════════════════════════════
// INSIGHTS EM LINGUAGEM NATURAL
// ══════════════════════════════════════════════════════════════════════════

async function generateInsights() {
  const insights = [];
  const heatmap  = await getHeatmap();
  const stats    = await getSubjectStats();

  // 1. Melhor hora do dia (precisa de >= 5 questões em alguma hora)
  const byHour = {};
  for (const [key, val] of Object.entries(heatmap)) {
    const [, hour] = key.split('_').map(Number);
    if (!byHour[hour]) byHour[hour] = { q: 0, ace: 0 };
    byHour[hour].q   += val.q;
    byHour[hour].ace += val.ace;
  }
  const hourBuckets = Object.entries(byHour)
    .filter(([, v]) => v.q >= 5)
    .map(([h, v]) => ({ h: +h, rate: v.ace / v.q, q: v.q }));
  if (hourBuckets.length >= 3) {
    const best  = hourBuckets.reduce((a, b) => b.rate > a.rate ? b : a);
    const worst = hourBuckets.reduce((a, b) => b.rate < a.rate ? b : a);
    if (best.h !== worst.h && best.rate - worst.rate > 0.15) {
      insights.push({
        type: 'time',
        icon: '⏰',
        text: `Você acerta ${Math.round(best.rate * 100)}% às ${best.h}h mas só ${Math.round(worst.rate * 100)}% às ${worst.h}h.`,
        weight: 3,
      });
    }
  }

  // 2. Melhor / pior dia da semana
  const byDow = {};
  for (const [key, val] of Object.entries(heatmap)) {
    const [dow] = key.split('_').map(Number);
    if (!byDow[dow]) byDow[dow] = { q: 0, ace: 0 };
    byDow[dow].q   += val.q;
    byDow[dow].ace += val.ace;
  }
  const dowBuckets = Object.entries(byDow)
    .filter(([, v]) => v.q >= 10)
    .map(([d, v]) => ({ d: +d, rate: v.ace / v.q }));
  if (dowBuckets.length >= 3) {
    const dayNames = ['domingo','segunda','terça','quarta','quinta','sexta','sábado'];
    const best  = dowBuckets.reduce((a, b) => b.rate > a.rate ? b : a);
    const worst = dowBuckets.reduce((a, b) => b.rate < a.rate ? b : a);
    if (best.d !== worst.d && best.rate - worst.rate > 0.1) {
      insights.push({
        type: 'dow',
        icon: '📅',
        text: `Seu melhor dia é ${dayNames[best.d]} (${Math.round(best.rate * 100)}%), o pior é ${dayNames[worst.d]} (${Math.round(worst.rate * 100)}%).`,
        weight: 2,
      });
    }
  }

  // 3. Matéria mais fraca
  const weak = stats.filter(s => s.total >= 10)
    .sort((a, b) => (a.acertos / a.total) - (b.acertos / b.total))[0];
  if (weak) {
    const rate = Math.round(weak.acertos / weak.total * 100);
    if (rate < 60) {
      insights.push({
        type: 'weak',
        icon: '🎯',
        text: `${weak.materia} é seu ponto fraco: ${rate}% de acerto em ${weak.total} questões.`,
        weight: 4,
      });
    }
  }

  // 4. Comparação semanal
  try {
    const cmp = await getWeeklyCompare();
    if (cmp.previous.resolved >= 20 && cmp.current.resolved >= 20) {
      if (cmp.deltaRate >= 5) {
        insights.push({
          type: 'trend',
          icon: '📈',
          text: `Esta semana sua taxa subiu ${cmp.deltaRate}pp (${cmp.previous.rate}% → ${cmp.current.rate}%). Continua assim!`,
          weight: 3,
        });
      } else if (cmp.deltaRate <= -5) {
        insights.push({
          type: 'trend',
          icon: '📉',
          text: `Esta semana sua taxa caiu ${Math.abs(cmp.deltaRate)}pp (${cmp.previous.rate}% → ${cmp.current.rate}%). Reveja a rotina.`,
          weight: 3,
        });
      }
    }
  } catch { /* */ }

  return insights.sort((a, b) => b.weight - a.weight);
}

// ══════════════════════════════════════════════════════════════════════════
// NOTES & TAGS
// ══════════════════════════════════════════════════════════════════════════

async function saveNote(qid, note) {
  if (!qid) return;
  const stored = await getStorage('pf_notes');
  const notes  = stored.pf_notes || {};
  if (!note || !note.trim()) delete notes[qid];
  else                       notes[qid] = note.trim().slice(0, 2000);
  await setStorage({ pf_notes: notes });
}

async function getNotes() {
  const stored = await getStorage('pf_notes');
  return stored.pf_notes || {};
}

async function saveTags(qid, tags) {
  if (!qid) return;
  const stored = await getStorage('pf_tags');
  const tagMap = stored.pf_tags || {};
  if (!Array.isArray(tags) || !tags.length) delete tagMap[qid];
  else tagMap[qid] = tags.map(t => String(t).trim().slice(0, 30)).filter(Boolean).slice(0, 8);
  await setStorage({ pf_tags: tagMap });
}

async function getTags() {
  const stored = await getStorage('pf_tags');
  return stored.pf_tags || {};
}

// ══════════════════════════════════════════════════════════════════════════
// EXPORT ANKI (.txt importável: campos separados por tab)
// ══════════════════════════════════════════════════════════════════════════

async function buildAnkiExport() {
  const wrong = await loadWrongBank();
  const notes = await getNotes();
  const tags  = await getTags();
  const lines = ['#separator:tab', '#html:true', '#tags column:4'];

  for (const q of Object.values(wrong)) {
    const front = [
      q.materia ? `<b>${escapeHtml(q.materia)}</b>` : '',
      q.assunto ? `<i>${escapeHtml(q.assunto)}</i>` : '',
      `<br>${escapeHtml(q.desc || ('Questão #' + q.qid))}`,
      q.url ? `<br><a href="${q.url}">Abrir no TEC</a>` : '',
    ].filter(Boolean).join(' — ');

    const back = [
      notes[q.qid] ? `<b>Nota:</b><br>${escapeHtml(notes[q.qid]).replace(/\n/g, '<br>')}` : '',
      `<b>Erros:</b> ${q.errorCount} · <b>SM-2 interval:</b> ${q.interval}d · <b>Ease:</b> ${q.easeFactor}`,
      `<b>Última revisão:</b> ${q.nextReview || '—'}`,
    ].filter(Boolean).join('<br><br>');

    const ankiTags = [
      'TecConcursos',
      q.materia ? 'M_' + q.materia.replace(/\s+/g, '_') : '',
      q.assunto ? 'A_' + q.assunto.replace(/\s+/g, '_') : '',
      ...(tags[q.qid] || []).map(t => 'tag_' + t.replace(/\s+/g, '_')),
    ].filter(Boolean).join(' ');

    lines.push([
      front.replace(/\t/g, ' '),
      back.replace(/\t/g, ' '),
      q.qid,
      ankiTags,
    ].join('\t'));
  }
  return lines.join('\n');
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ══════════════════════════════════════════════════════════════════════════
// BACKUP COMPLETO + IMPORT
// ══════════════════════════════════════════════════════════════════════════

const BACKUP_KEYS = [
  'globalStats', 'questionBank', 'wrongBank', 'subjectStats', 'sessions', 'settings',
  'pf_article_coverage', 'pf_confusion_patterns', 'pf_heatmap', 'pf_review_log',
  'pf_notes', 'pf_tags', 'pf_hub_reviews', 'tec_ranking',
  'pf_irt', 'pf_edital', 'pf_activity', 'pf_metacog',
];

async function buildBackup() {
  const all = await getStorage(BACKUP_KEYS);
  // Inclui também today_* dos últimos 90 dias
  const todayKeys = [];
  for (let i = 0; i < 90; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    todayKeys.push('today_' + d.toISOString().split('T')[0]);
  }
  const todays = await getStorage(todayKeys);
  return {
    schemaVersion: SCHEMA_VERSION,
    exportedAt:    new Date().toISOString(),
    data:          { ...all, ...todays },
  };
}

async function importBackup(backup, mode) {
  if (!backup || typeof backup !== 'object' || !backup.data) {
    return { ok: false, error: 'Backup inválido' };
  }
  try {
    if (mode === 'replace') {
      // Limpa apenas as chaves conhecidas (preserva state persistente atual)
      const allKeys = Object.keys(backup.data);
      await new Promise(r => chrome.storage.local.remove(allKeys, r));
    }
    // Merge inteligente para coleções: bancos, settings, subjectStats
    const current = await getStorage(BACKUP_KEYS);
    const merged  = {};

    for (const [key, val] of Object.entries(backup.data)) {
      if (key.startsWith('today_')) {
        merged[key] = val;
      } else if (key === 'sessions' && Array.isArray(val)) {
        const old = (current.sessions || []);
        merged.sessions = [...val, ...old].slice(0, 100);
      } else if (key === 'wrongBank' || key === 'questionBank' || key === 'pf_notes' || key === 'pf_tags' || key === 'pf_semantic_cache') {
        merged[key] = { ...(current[key] || {}), ...val };
      } else if (key === 'subjectStats' && val && typeof val === 'object') {
        const cur = current.subjectStats || {};
        for (const [mat, s] of Object.entries(val)) {
          if (!cur[mat]) { cur[mat] = s; continue; }
          cur[mat].acertos += s.acertos || 0;
          cur[mat].erros   += s.erros   || 0;
          cur[mat].total   += s.total   || 0;
          cur[mat].assuntos = { ...(cur[mat].assuntos || {}), ...(s.assuntos || {}) };
        }
        merged.subjectStats = cur;
      } else if (key === 'pf_review_log' && Array.isArray(val)) {
        merged.pf_review_log = [...(current.pf_review_log || []), ...val].slice(-1000);
      } else {
        merged[key] = val;
      }
    }
    await setStorage(merged);
    return { ok: true, keys: Object.keys(merged).length };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// ══════════════════════════════════════════════════════════════════════════
// EDITAL → GAP MAPPING (extrai árvore via Claude e cruza com cobertura)
// ══════════════════════════════════════════════════════════════════════════
//  Schema do edital salvo:
//   { name, importedAt, tree: { materias: [{ nome, peso, topicos: [...] }] } }

async function parseEditalWithClaude(text, apiKey) {
  if (!apiKey || !text) return null;
  const prompt = `Extraia a árvore hierárquica de tópicos deste edital de concurso público brasileiro. Responda APENAS com JSON válido (sem markdown, sem texto explicativo), no formato:

{
  "name": "Nome do concurso",
  "materias": [
    {
      "nome": "Nome da matéria",
      "peso": 1.0,
      "topicos": [
        { "nome": "Tópico principal", "subtopicos": ["Subtópico 1", "Subtópico 2"] }
      ]
    }
  ]
}

Diretrizes:
- "peso" é o peso relativo na nota final (use 1.0 se não estiver explícito)
- Inclua TODOS os tópicos e subtópicos do edital, mesmo os menores
- Use os nomes EXATOS do edital (preserve maiúsculas/minúsculas, acentos)
- Mantenha a estrutura: matéria → tópico → subtópico
- Se houver itens numerados (1., 2., a, b, c), use-os como subtópicos
- NÃO invente tópicos que não estão no edital

EDITAL:
${text.slice(0, 60000)}`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':     'application/json',
        'x-api-key':        apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 8000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) return { error: `API ${res.status}` };
    const data = await res.json();
    const raw  = data.content?.[0]?.text || '';
    const m    = raw.match(/\{[\s\S]*\}/);
    if (!m) return { error: 'Sem JSON na resposta' };
    return JSON.parse(m[0]);
  } catch (e) { return { error: String(e) }; }
}

// Normaliza string para matching: lowercase, sem acentos, sem espaços/pontuação
function normStr(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

async function saveEdital(parsed) {
  if (!parsed || !parsed.materias) return { ok: false, error: 'Edital sem matérias' };
  const edital = {
    name:       parsed.name || 'Edital sem nome',
    importedAt: new Date().toISOString(),
    tree:       parsed,
  };
  await setStorage({ pf_edital: edital });
  return { ok: true };
}

async function deleteEdital() {
  await new Promise(r => chrome.storage.local.remove(['pf_edital'], r));
}

// Cruza edital com dados do user.
// Para cada tópico do edital, encontra questões correspondentes no questionBank
// fazendo matching aproximado por (assunto || materia).
async function getEditalCoverage() {
  const stored = await getStorage('pf_edital');
  const edital = stored.pf_edital;
  if (!edital) return { hasEdital: false };

  const qb = await loadQuestionBank();
  const items = Object.values(qb);

  // Indexa questões por (matéria normalizada) → array
  const byMatNorm = {};
  for (const q of items) {
    const k = normStr(q.materia);
    if (!byMatNorm[k]) byMatNorm[k] = [];
    byMatNorm[k].push(q);
  }

  // Para cada matéria do edital, calcula cobertura
  const materias = (edital.tree.materias || []).map(m => {
    const matNorm = normStr(m.nome);
    // Tenta match exato; se falhar, tenta containment
    let matched = byMatNorm[matNorm] || [];
    if (!matched.length) {
      for (const [k, qs] of Object.entries(byMatNorm)) {
        if (k.includes(matNorm) || matNorm.includes(k)) {
          matched = matched.concat(qs);
        }
      }
    }

    // Tópicos
    const topicos = (m.topicos || []).map(t => {
      const topNorm = normStr(t.nome);
      const tQs = matched.filter(q => {
        const a = normStr(q.assunto);
        const d = normStr(q.desc);
        return a.includes(topNorm) || topNorm.includes(a) || d.includes(topNorm);
      });
      const acertos = tQs.reduce((s, q) => s + (q.acertos || 0), 0);
      const erros   = tQs.reduce((s, q) => s + (q.erros   || 0), 0);
      const total   = acertos + erros;
      const rate    = total > 0 ? acertos / total : null;
      // Status: green ≥10Q+≥70%, yellow ≥3Q, red <3Q
      const status  = total >= 10 && rate >= 0.7 ? 'green'
                    : total >= 3  && (rate === null || rate >= 0.5) ? 'yellow'
                    : total >= 3 ? 'orange'
                    : 'red';
      return {
        nome: t.nome,
        questionCount: tQs.length,
        respondedCount: total,
        rate: rate !== null ? Math.round(rate * 100) : null,
        status,
        subtopicos: t.subtopicos || [],
      };
    });

    const matAcertos = matched.reduce((s, q) => s + (q.acertos || 0), 0);
    const matErros   = matched.reduce((s, q) => s + (q.erros   || 0), 0);
    const matTotal   = matAcertos + matErros;
    const matRate    = matTotal > 0 ? Math.round(matAcertos / matTotal * 100) : null;

    const grnCount = topicos.filter(t => t.status === 'green').length;
    const totalTops = topicos.length;
    const coveragePct = totalTops > 0 ? Math.round(grnCount / totalTops * 100) : 0;

    return {
      nome: m.nome, peso: m.peso || 1.0,
      questionCount: matched.length, respondedCount: matTotal,
      rate: matRate, coveragePct,
      topicos,
    };
  });

  // Top gaps: tópicos vermelhos ordenados por peso da matéria
  const gaps = [];
  for (const m of materias) {
    for (const t of m.topicos) {
      if (t.status === 'red' || t.status === 'orange') {
        gaps.push({
          materia: m.nome, peso: m.peso,
          topico:  t.nome, status: t.status,
          questionCount: t.questionCount,
        });
      }
    }
  }
  gaps.sort((a, b) => (b.peso - a.peso) || (a.questionCount - b.questionCount));

  return {
    hasEdital: true,
    name:       edital.name,
    importedAt: edital.importedAt,
    materias,
    gaps:       gaps.slice(0, 20),
    summary: {
      totalMaterias:  materias.length,
      totalTopicos:   materias.reduce((s, m) => s + m.topicos.length, 0),
      greenTopicos:   materias.reduce((s, m) => s + m.topicos.filter(t => t.status === 'green').length, 0),
      redTopicos:     materias.reduce((s, m) => s + m.topicos.filter(t => t.status === 'red').length, 0),
    },
  };
}

// ══════════════════════════════════════════════════════════════════════════
// BIBLIOTECA DE QUESTÕES (PDF do TEC)
// ══════════════════════════════════════════════════════════════════════════
//  Schema pf_library = { qid: { ...questão_estruturada } }
//  qid é o mesmo ID do TEC (extraído da URL do PDF), então cruza automaticamente
//  com questionBank/wrongBank quando o user resolver a questão lá.

// Parser do texto extraído do PDF do TEC (pelo pdf.js no popup)
function parseTECPdfText(rawText) {
  if (!rawText) return { questions: [], errors: ['Texto vazio'] };

  // pdf.js produz texto em "linhas lógicas" separadas por espaço duplo.
  // Convertemos isso em linhas reais usando \n como separador.
  const text = rawText.replace(/\n+/g, ' ').replace(/[ \t]{2,}/g, '\n');

  const URL_RE = /www\.tecconcursos\.com\.br\/questoes\/(\d{5,9})/g;
  const matches = [...text.matchAll(URL_RE)];
  if (!matches.length) return { questions: [], errors: ['Nenhuma URL de questão encontrada no PDF'] };

  const questions = [];
  const errors    = [];
  for (let i = 0; i < matches.length; i++) {
    const m   = matches[i];
    const qid = m[1];
    const start = m.index + m[0].length;
    const end   = (i + 1 < matches.length) ? matches[i + 1].index : text.length;
    const block = text.slice(start, end).trim();
    try {
      const parsed = parseTECBlock(qid, block);
      if (parsed) questions.push(parsed);
      else errors.push(`Q ${qid}: parse falhou (sem alternativas)`);
    } catch (e) {
      errors.push(`Q ${qid}: ${e.message}`);
    }
  }
  return { questions, errors };
}

function parseTECBlock(qid, block) {
  const lines = block.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length < 3) return null;

  const banca       = parseTECBancaLine(lines[0]);
  const { materia, assunto } = parseTECMateriaLine(lines[1]);

  let enunciadoParts = [];
  let altStartIdx    = -1;
  for (let i = 2; i < lines.length; i++) {
    if (/^a\)/i.test(lines[i])) { altStartIdx = i; break; }
    enunciadoParts.push(lines[i]);
  }
  if (altStartIdx === -1) return null;

  let enunciado = enunciadoParts.join(' ').trim();
  let questionNumber = null;
  const numM = enunciado.match(/^(\d+)\)\s*(.+)/);
  if (numM) {
    questionNumber = parseInt(numM[1]);
    enunciado = numM[2];
  }

  const alternativas = { A: '', B: '', C: '', D: '', E: '' };
  let currentLetter = null;
  let gabarito = '';
  for (let i = altStartIdx; i < lines.length; i++) {
    const l = lines[i];
    const gabM = l.match(/^Gabarito:\s*([A-E])/i);
    if (gabM) { gabarito = gabM[1].toUpperCase(); break; }
    const altM = l.match(/^([a-e])\)\s*(.*)/i);
    if (altM) {
      currentLetter = altM[1].toUpperCase();
      alternativas[currentLetter] = altM[2].trim();
    } else if (currentLetter) {
      alternativas[currentLetter] += ' ' + l;
    }
  }
  Object.keys(alternativas).forEach(k => {
    alternativas[k] = alternativas[k].replace(/\s+/g, ' ').trim();
  });

  // Só aceita se tem 4+ alternativas (E pode faltar em algumas)
  const altsFilled = Object.values(alternativas).filter(x => x.length).length;
  if (altsFilled < 4) return null;

  return {
    qid,
    url: 'https://www.tecconcursos.com.br/questoes/' + qid,
    questionNumber,
    banca:         banca.banca,
    cargo:         banca.cargo,
    orgao:         banca.orgao,
    especialidade: banca.especialidade,
    ano:           banca.ano,
    materia,
    assunto,
    enunciado,
    alternativas,
    gabarito,
  };
}

function parseTECBancaLine(line) {
  const out = { banca: '', cargo: '', orgao: '', especialidade: '', ano: null };
  const dashM = line.match(/^([^-]+?)\s*-\s*(.+)$/);
  if (!dashM) { out.banca = line; return out; }
  out.banca = dashM[1].trim();
  const parts = dashM[2].split('/').map(p => p.trim());
  if (parts.length >= 1) out.cargo = parts[0];
  if (parts.length >= 2) out.orgao = parts[1];
  if (parts.length >= 2) {
    const lastPart = parts[parts.length - 1];
    const anoM = lastPart.match(/^(\d{4})$/);
    if (anoM) {
      out.ano = parseInt(anoM[1]);
      if (parts.length >= 3) out.especialidade = parts.slice(2, parts.length - 1).join('/');
    } else if (parts.length >= 3) {
      out.especialidade = parts.slice(2).join('/');
    }
  }
  return out;
}

function parseTECMateriaLine(line) {
  const dashIdx = line.lastIndexOf(' - ');
  if (dashIdx === -1) return { materia: line.trim(), assunto: '' };
  return {
    materia: line.slice(0, dashIdx).trim(),
    assunto: line.slice(dashIdx + 3).trim(),
  };
}

async function loadLibrary() {
  const { pf_library } = await getStorage({ pf_library: {} });
  return pf_library;
}

// Recebe lista de questões parseadas e mescla no storage
async function importToLibrary(questions, sourceFile) {
  if (!Array.isArray(questions) || !questions.length) {
    return { ok: false, error: 'Nenhuma questão para importar' };
  }
  const lib = await loadLibrary();
  let added = 0, updated = 0;
  const ts = Date.now();
  for (const q of questions) {
    if (!q.qid) continue;
    const exists = !!lib[q.qid];
    lib[q.qid] = {
      ...q,
      importedFrom: sourceFile || (lib[q.qid]?.importedFrom) || '',
      importedAt:   lib[q.qid]?.importedAt || ts,
      lastUpdated:  ts,
    };
    if (exists) updated++; else added++;
  }
  await setStorage({ pf_library: lib });
  return { ok: true, added, updated, total: Object.keys(lib).length };
}

async function getLibraryStats() {
  const lib = await loadLibrary();
  const items = Object.values(lib);
  const bancas = {}, anos = {}, materias = {}, sources = {};
  for (const q of items) {
    if (q.banca)   bancas[q.banca]     = (bancas[q.banca] || 0) + 1;
    if (q.ano)     anos[q.ano]         = (anos[q.ano] || 0) + 1;
    if (q.materia) materias[q.materia] = (materias[q.materia] || 0) + 1;
    if (q.importedFrom) sources[q.importedFrom] = (sources[q.importedFrom] || 0) + 1;
  }
  // Quantas estão no questionBank do user (já resolveu)
  const qb = await loadQuestionBank();
  const resolved = items.filter(q => qb[q.qid]).length;
  return {
    total: items.length,
    resolved,
    pending: items.length - resolved,
    bancas, anos, materias, sources,
  };
}

async function getLibraryList(filter = {}) {
  const lib = await loadLibrary();
  const qb  = await loadQuestionBank();
  let items = Object.values(lib);
  if (filter.banca)   items = items.filter(q => q.banca === filter.banca);
  if (filter.ano)     items = items.filter(q => q.ano   === filter.ano);
  if (filter.materia) items = items.filter(q => q.materia === filter.materia);
  if (filter.source)  items = items.filter(q => q.importedFrom === filter.source);
  if (filter.status === 'resolved') items = items.filter(q => qb[q.qid]);
  if (filter.status === 'pending')  items = items.filter(q => !qb[q.qid]);
  // Ordena: pendentes primeiro, depois por ano desc
  items.sort((a, b) => {
    const ar = qb[a.qid] ? 1 : 0;
    const br = qb[b.qid] ? 1 : 0;
    if (ar !== br) return ar - br;
    return (b.ano || 0) - (a.ano || 0);
  });
  // Anexa flag resolved + stats do questionBank
  return items.slice(0, 200).map(q => {
    const bankItem = qb[q.qid];
    return {
      ...q,
      resolved:    !!bankItem,
      acertos:     bankItem?.acertos || 0,
      erros:       bankItem?.erros   || 0,
      lastSeen:    bankItem?.lastSeen || '',
    };
  });
}

async function deleteFromLibrary(qids) {
  if (!Array.isArray(qids) || !qids.length) return { ok: false };
  const lib = await loadLibrary();
  let removed = 0;
  for (const qid of qids) {
    if (lib[qid]) { delete lib[qid]; removed++; }
  }
  await setStorage({ pf_library: lib });
  return { ok: true, removed };
}

async function deleteLibraryByFilter(filter) {
  const lib = await loadLibrary();
  let removed = 0;
  for (const [qid, q] of Object.entries(lib)) {
    let match = true;
    if (filter.banca   && q.banca   !== filter.banca)   match = false;
    if (filter.ano     && q.ano     !== filter.ano)     match = false;
    if (filter.source  && q.importedFrom !== filter.source) match = false;
    if (filter.materia && q.materia !== filter.materia) match = false;
    if (match) { delete lib[qid]; removed++; }
  }
  await setStorage({ pf_library: lib });
  return { ok: true, removed };
}

// Busca questões na BIBLIOTECA que sejam similares à passada (quando user erra no TEC)
async function findSimilarInLibrary(payload, limit = 8) {
  const lib = await loadLibrary();
  if (!Object.keys(lib).length) return [];
  const qb = await loadQuestionBank();

  const tgtEnunText = payload.enunciado || payload.desc || '';
  const tgtAltsText = payload.alternativas
    ? Object.values(payload.alternativas).join(' ')
    : '';
  const tgtKwEnun = extractKeywords(tgtEnunText, payload.materia, payload.assunto);
  const tgtKwAlts = tgtAltsText ? extractKeywords(tgtAltsText, '', '') : null;
  if (!tgtKwEnun.size) return [];

  const tgtQid     = payload.qid || '';
  const tgtAssunto = payload.assunto || '';
  const tgtMateria = payload.materia || '';

  const results = [];
  for (const q of Object.values(lib)) {
    if (!q.qid || q.qid === tgtQid) continue;

    const qEnunText = q.enunciado || '';
    const qAltsText = q.alternativas ? Object.values(q.alternativas).join(' ') : '';
    const qKwEnun = extractKeywords(qEnunText, q.materia, q.assunto);
    const simEnun = jaccardSim(tgtKwEnun, qKwEnun);

    let simAlts = 0;
    if (tgtKwAlts && qAltsText) {
      const qKwAlts = extractKeywords(qAltsText, '', '');
      simAlts = jaccardSim(tgtKwAlts, qKwAlts);
    }

    const sameAssunto = tgtAssunto && q.assunto === tgtAssunto;
    const sameMateria = tgtMateria && q.materia === tgtMateria;

    const score = 0.50 * simEnun + 0.28 * simAlts
                + (sameAssunto ? 0.20 : 0) + (sameMateria ? 0.05 : 0);

    if (score >= 0.18 || (sameAssunto && simEnun >= 0.10)) {
      const inBank = qb[q.qid];
      results.push({
        qid: q.qid,
        url: q.url,
        banca: q.banca || '',
        ano:   q.ano,
        cargo: q.cargo || '',
        orgao: q.orgao || '',
        materia: q.materia || '',
        assunto: q.assunto || '',
        enunciado: (q.enunciado || '').slice(0, 200),
        gabarito: q.gabarito || '',
        score: Math.round(score * 100) / 100,
        simEnun: Math.round(simEnun * 100) / 100,
        simAlts: Math.round(simAlts * 100) / 100,
        resolved: !!inBank,
        userAcertos: inBank?.acertos || 0,
        userErros:   inBank?.erros   || 0,
      });
    }
  }
  // Ordena: pendentes (não resolvidas) primeiro, por score desc
  results.sort((a, b) => {
    if (a.resolved !== b.resolved) return a.resolved ? 1 : -1;
    return b.score - a.score;
  });
  return results.slice(0, limit);
}

// ══════════════════════════════════════════════════════════════════════════
// CLUSTERS SEMÂNTICOS DE ERROS (via Jaccard de conceitos do Claude)
// ══════════════════════════════════════════════════════════════════════════
//  Usa o campo semanticConcepts[] que já é populado quando user erra
//  uma questão e tem Claude API configurada. Constrói grafo de similaridade
//  e roda Union-Find para agrupar.

function unionFindClusters(items, similarityThreshold) {
  // items: array de { id, set }  | similarityThreshold: 0..1
  const parent = items.map((_, i) => i);
  const find = i => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i].set, b = items[j].set;
      const inter = new Set([...a].filter(x => b.has(x)));
      const union2 = new Set([...a, ...b]);
      const jac = union2.size > 0 ? inter.size / union2.size : 0;
      if (jac >= similarityThreshold) union(i, j);
    }
  }

  const groups = {};
  for (let i = 0; i < items.length; i++) {
    const r = find(i);
    if (!groups[r]) groups[r] = [];
    groups[r].push(items[i]);
  }
  return Object.values(groups);
}

async function getSemanticClusters() {
  const wrong = await loadWrongBank();
  const withConcepts = Object.values(wrong)
    .filter(q => q.semanticConcepts?.concepts?.length >= 2)
    .map(q => ({
      id: q.qid, qid: q.qid, materia: q.materia, assunto: q.assunto,
      desc: q.desc, url: q.url, errorCount: q.errorCount || 1,
      concepts: q.semanticConcepts.concepts.map(c => c.toLowerCase().trim()),
      set: new Set(q.semanticConcepts.concepts.map(c => c.toLowerCase().trim())),
    }));

  if (withConcepts.length < 3) {
    return { hasEnough: false, count: withConcepts.length };
  }

  const groups = unionFindClusters(withConcepts, 0.35);
  // Apenas grupos com 2+ questões (1 não é cluster)
  const clusters = groups
    .filter(g => g.length >= 2)
    .map(g => {
      // Conceitos em comum: interseção de todos
      const common = g.reduce((acc, q) => acc === null
        ? new Set(q.set)
        : new Set([...acc].filter(x => q.set.has(x))), null);
      // Conceitos mais frequentes (se interseção é vazia)
      const freq = {};
      for (const q of g) for (const c of q.concepts) freq[c] = (freq[c] || 0) + 1;
      const topConcepts = Object.entries(freq)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([c]) => c);

      const totalErrors = g.reduce((s, q) => s + q.errorCount, 0);
      // Materias representadas
      const mats = [...new Set(g.map(q => q.materia).filter(Boolean))];

      return {
        size: g.length,
        questions: g.map(q => ({
          qid: q.qid, materia: q.materia, assunto: q.assunto,
          desc: q.desc, url: q.url, errorCount: q.errorCount,
        })),
        commonConcepts: common && common.size > 0 ? [...common] : topConcepts,
        topConcepts,
        totalErrors,
        materias: mats,
      };
    });

  // Ordena por relevância: tamanho × erros totais
  clusters.sort((a, b) => (b.size * b.totalErrors) - (a.size * a.totalErrors));

  return {
    hasEnough: true,
    count: withConcepts.length,
    clusters: clusters.slice(0, 10),
  };
}

// ══════════════════════════════════════════════════════════════════════════
// ACTIVITY TRACKER — distingue tempo produtivo de zombie
// ══════════════════════════════════════════════════════════════════════════
//  Content script envia a cada ~30s: { productive, idle } em segundos.
//  Salvo em pf_activity['YYYY-MM-DD'] = { productive, idle, sessions: N }
//  Mantém últimos 30 dias.

async function recordActivity(productive, idle) {
  productive = Math.max(0, parseInt(productive) || 0);
  idle       = Math.max(0, parseInt(idle) || 0);
  if (productive + idle === 0) return;
  const stored = await getStorage('pf_activity');
  const act = stored.pf_activity || {};
  const key = todayKey();
  if (!act[key]) act[key] = { productive: 0, idle: 0, lastReport: 0 };
  act[key].productive += productive;
  act[key].idle       += idle;
  act[key].lastReport  = Date.now();

  // Prune > 30 dias
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 30);
  const cutoffKey = cutoff.toISOString().split('T')[0];
  for (const k of Object.keys(act)) if (k < cutoffKey) delete act[k];

  await setStorage({ pf_activity: act });
}

async function getActivityStats() {
  const stored = await getStorage('pf_activity');
  const act = stored.pf_activity || {};
  const today = act[todayKey()] || { productive: 0, idle: 0 };
  const last7 = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const k = d.toISOString().split('T')[0];
    const v = act[k] || { productive: 0, idle: 0 };
    last7.push({
      date: k,
      dow: ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'][d.getDay()],
      productive: v.productive,
      idle:       v.idle,
      ratio: v.productive + v.idle > 0
        ? Math.round(v.productive / (v.productive + v.idle) * 100)
        : null,
    });
  }
  return {
    today: {
      productive: today.productive,
      idle:       today.idle,
      ratio: today.productive + today.idle > 0
        ? Math.round(today.productive / (today.productive + today.idle) * 100)
        : null,
    },
    last7,
  };
}

// ══════════════════════════════════════════════════════════════════════════
// BIBLIOTECA PDF — questões importadas de PDFs do TEC
// ══════════════════════════════════════════════════════════════════════════
//  Não é storage separado: questões importadas vivem no MESMO questionBank,
//  com flags _fromPDF, _pdfSource, _importedAt e campos extras (banca, ano,
//  cargo, orgao, gabarito, enunciado, alternativas).
//
//  Quando o user resolve a questão no TEC, o tracking normal atualiza
//  acertos/erros sem perder os campos do PDF (graças ao spread em
//  updateQuestionBank que NÃO sobrescreve com vazio).

async function importQuestionsFromPDF(questions, sourceName) {
  if (!Array.isArray(questions) || !questions.length) {
    return { ok: false, error: 'Lista de questões vazia' };
  }
  const { questionBank } = await getStorage({ questionBank: {} });
  const today = todayKey();
  const now   = Date.now();

  let added = 0, merged = 0, skipped = 0;
  for (const q of questions) {
    if (!q.qid || !q.alternativas || Object.keys(q.alternativas).length < 4) {
      skipped++;
      continue;
    }
    const existing = questionBank[q.qid];
    if (existing) {
      // Merge: prioriza dados ricos do PDF (banca, ano, enunciado, alternativas)
      // mas mantém acertos/erros/SM-2 e timestamps de resolução
      existing.url        = existing.url || q.url;
      existing.materia    = existing.materia || q.materia;
      existing.assunto    = existing.assunto || q.assunto;
      existing.desc       = existing.desc    || q.desc;
      existing.banca      = q.banca   || existing.banca;
      existing.ano        = q.ano     || existing.ano;
      existing.cargo      = q.cargo   || existing.cargo;
      existing.orgao      = q.orgao   || existing.orgao;
      existing.gabarito   = q.gabarito|| existing.gabarito;
      // Só sobrescreve enunciado/alternativas se PDF tem versão melhor
      if (q.enunciado && q.enunciado.length > (existing.enunciado || '').length) {
        existing.enunciado = q.enunciado;
      }
      if (q.alternativas && Object.keys(q.alternativas).length >= 4) {
        existing.alternativas = q.alternativas;
      }
      existing._fromPDF      = true;
      existing._pdfSource    = sourceName || existing._pdfSource || 'PDF';
      existing._importedAt   = existing._importedAt || now;
      questionBank[q.qid] = existing;
      merged++;
    } else {
      // Nova entrada
      questionBank[q.qid] = {
        qid:       q.qid,
        url:       q.url,
        materia:   q.materia    || '',
        assunto:   q.assunto    || '',
        desc:      q.desc       || ('Questão #' + q.qid),
        enunciado: q.enunciado  || '',
        alternativas: q.alternativas,
        banca:     q.banca      || '',
        ano:       q.ano        || null,
        cargo:     q.cargo      || '',
        orgao:     q.orgao      || '',
        gabarito:  q.gabarito   || '',
        acertos:   0,
        erros:     0,
        firstSeen: today,
        lastSeen:  today,
        importance: 1,
        times:     [],
        _fromPDF:  true,
        _pdfSource: sourceName || 'PDF',
        _importedAt: now,
      };
      added++;
    }
  }
  await setStorage({ questionBank });
  return { ok: true, added, merged, skipped, total: added + merged };
}

async function getLibraryStats() {
  const bank = await loadQuestionBank();
  const lib  = Object.values(bank).filter(q => q._fromPDF);
  if (!lib.length) return { hasLibrary: false, total: 0 };

  // Stats por status: não resolvida / só acertos / com erros
  let unresolved = 0, resolved = 0, wrong = 0;
  const bancas = new Set(), anos = new Set(), materias = new Set();
  for (const q of lib) {
    const total = (q.acertos || 0) + (q.erros || 0);
    if (total === 0) unresolved++;
    else if ((q.erros || 0) > 0) wrong++;
    else resolved++;
    if (q.banca)   bancas.add(q.banca);
    if (q.ano)     anos.add(q.ano);
    if (q.materia) materias.add(q.materia);
  }

  // Fontes (PDFs distintos importados)
  const sources = new Set(lib.map(q => q._pdfSource).filter(Boolean));

  return {
    hasLibrary: true,
    total:      lib.length,
    unresolved, resolved, wrong,
    bancas:   [...bancas].sort(),
    anos:     [...anos].sort((a, b) => b - a),
    materias: [...materias].sort(),
    sources:  [...sources].sort(),
  };
}

async function getLibraryList(filters, page, pageSize) {
  filters  = filters  || {};
  page     = page     || 1;
  pageSize = pageSize || 20;

  const bank = await loadQuestionBank();
  let lib    = Object.values(bank).filter(q => q._fromPDF);

  if (filters.materia)  lib = lib.filter(q => q.materia === filters.materia);
  if (filters.banca)    lib = lib.filter(q => q.banca   === filters.banca);
  if (filters.ano)      lib = lib.filter(q => q.ano     === parseInt(filters.ano));
  if (filters.status === 'unresolved') {
    lib = lib.filter(q => (q.acertos || 0) + (q.erros || 0) === 0);
  } else if (filters.status === 'resolved') {
    lib = lib.filter(q => (q.acertos || 0) > 0 && (q.erros || 0) === 0);
  } else if (filters.status === 'wrong') {
    lib = lib.filter(q => (q.erros || 0) > 0);
  }
  if (filters.q) {
    const needle = filters.q.toLowerCase();
    lib = lib.filter(q =>
      (q.enunciado || '').toLowerCase().includes(needle) ||
      (q.assunto   || '').toLowerCase().includes(needle) ||
      (q.materia   || '').toLowerCase().includes(needle)
    );
  }

  // Ordena: erradas primeiro, depois não-resolvidas, depois resolvidas
  lib.sort((a, b) => {
    const sa = (a.erros || 0) > 0 ? 0 : (a.acertos || 0) === 0 ? 1 : 2;
    const sb = (b.erros || 0) > 0 ? 0 : (b.acertos || 0) === 0 ? 1 : 2;
    if (sa !== sb) return sa - sb;
    return (b._importedAt || 0) - (a._importedAt || 0);
  });

  const totalFiltered = lib.length;
  const start = (page - 1) * pageSize;
  const items = lib.slice(start, start + pageSize).map(q => ({
    qid:       q.qid,
    url:       q.url,
    materia:   q.materia,
    assunto:   q.assunto,
    desc:      q.desc,
    enunciado: (q.enunciado || '').slice(0, 200),
    banca:     q.banca,
    ano:       q.ano,
    cargo:     q.cargo,
    orgao:     q.orgao,
    gabarito:  q.gabarito,
    acertos:   q.acertos || 0,
    erros:     q.erros   || 0,
    status: (q.erros || 0) > 0 ? 'wrong'
          : (q.acertos || 0) > 0 ? 'resolved'
          : 'unresolved',
    _pdfSource: q._pdfSource,
  }));
  return { items, page, pageSize, totalFiltered, totalPages: Math.ceil(totalFiltered / pageSize) };
}

async function deleteLibraryQuestion(qid) {
  if (!qid) return { ok: false };
  const { questionBank } = await getStorage({ questionBank: {} });
  if (!questionBank[qid]) return { ok: false };
  // Se a questão tem stats reais, NÃO apaga totalmente — só remove flags do PDF
  const q = questionBank[qid];
  if ((q.acertos || 0) + (q.erros || 0) > 0) {
    delete q._fromPDF;
    delete q._pdfSource;
    delete q._importedAt;
    questionBank[qid] = q;
  } else {
    delete questionBank[qid];
  }
  await setStorage({ questionBank });
  return { ok: true };
}

async function clearLibrary(scope) {
  // scope: 'all' | 'source:NomeDoArquivo.pdf'
  const { questionBank } = await getStorage({ questionBank: {} });
  let removed = 0;
  for (const [qid, q] of Object.entries(questionBank)) {
    if (!q._fromPDF) continue;
    if (scope && scope.startsWith('source:') && q._pdfSource !== scope.slice(7)) continue;
    // Mesma lógica: preserva se já tem stats
    if ((q.acertos || 0) + (q.erros || 0) > 0) {
      delete q._fromPDF; delete q._pdfSource; delete q._importedAt;
    } else {
      delete questionBank[qid];
    }
    removed++;
  }
  await setStorage({ questionBank });
  return { ok: true, removed };
}

// ══════════════════════════════════════════════════════════════════════════
// BADGE & NOTIFICAÇÕES
// ══════════════════════════════════════════════════════════════════════════

function updateBadge(count) {
  state.filaCount = count || 0;
  if (state.filaCount > 0) {
    chrome.action.setBadgeText({ text: String(state.filaCount) });
    chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

function showNotification(title, message, id) {
  chrome.notifications.create(id || 'pf-' + Date.now(), {
    type: 'basic', iconUrl: 'icons/icon48.png',
    title: title || 'Painel Fiscal',
    message: message || '', priority: 1,
  });
}

async function checkDailyGoal(todayStats) {
  const settings = await getSettings();
  const goal = settings.smartGoal ? await calculateSmartGoal() : (settings.dailyGoal || 30);
  if (todayStats.resolved === goal) {
    showNotification('🎯 Meta atingida!', `Você resolveu ${goal} questões hoje. Parabéns!`, 'pf-goal');
  }
}

// ══════════════════════════════════════════════════════════════════════════
// RELAY TEC ↔ PAINEL
// ══════════════════════════════════════════════════════════════════════════

async function findPanelTab() {
  const tabs = await chrome.tabs.query({ url: PANEL_URL_PATTERN });
  return tabs.length ? tabs[0] : null;
}
async function findTecTab() {
  const tabs = await chrome.tabs.query({ url: '*://www.tecconcursos.com.br/*' });
  return tabs.length ? tabs[0] : null;
}

async function relayToPanel(payload) {
  const tab = await findPanelTab();
  if (!tab) return;
  state.panelTabId = tab.id;
  try {
    await chrome.tabs.sendMessage(state.panelTabId, { type: 'FROM_TEC', payload });
  } catch {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: state.panelTabId },
        func: p => window.dispatchEvent(new MessageEvent('message', { data: p })),
        args: [payload],
      });
    } catch { /* */ }
  }
}

async function relayToTec(payload) {
  const tab = state.tecTabId ? { id: state.tecTabId } : await findTecTab();
  if (!tab) return;
  state.tecTabId = tab.id;
  try {
    await chrome.tabs.sendMessage(state.tecTabId, { type: 'FROM_PANEL', payload });
  } catch {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: state.tecTabId },
        func: p => window.dispatchEvent(new MessageEvent('message', { data: p })),
        args: [payload],
      });
    } catch { /* */ }
  }
}

// ══════════════════════════════════════════════════════════════════════════
// HANDLERS DE MENSAGEM
// ══════════════════════════════════════════════════════════════════════════

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;

  (async () => {
    await loadState();

    switch (msg.type) {

      case 'CONTENT_READY':
        state.tecTabId = sender.tab ? sender.tab.id : null;
        saveState();
        break;

      case 'QUESTION_CORRECT': {
        const payload = msg.payload || {};
        const today   = await updateTodayStats({ acertos: 1 });
        await updateQuestionBank(payload, 'correct');
        if (payload.materia) await updateSubjectStats(payload.materia, 1, 0, payload.assunto);
        await updateIRTAfterResponse(payload, 1);
        await checkDailyGoal(today);
        ensureHourlyDay();
        const h1 = new Date().getHours();
        state.hourlyStats[h1].q++;
        state.hourlyStats[h1].ace++;
        updateHeatmap('correct').catch(() => {});
        updateArticleCoverage(payload, 'correct').catch(() => {});
        if (state.activeSession) {
          state.activeSession.acertos = (state.activeSession.acertos || 0) + 1;
          state.activeSession.questions = state.activeSession.questions || [];
          state.activeSession.questions.push({ ...payload, result: 'correct' });
          state.activeSession.lastActivity = Date.now();
        }
        saveState();
        break;
      }

      case 'QUESTION_WRONG': {
        const payload = msg.payload || {};
        const today   = await updateTodayStats({ erros: 1 });
        await updateQuestionBank(payload, 'wrong');
        if (payload.materia) await updateSubjectStats(payload.materia, 0, 1, payload.assunto);
        await updateIRTAfterResponse(payload, 0);
        await addToWrongBank(payload);
        if (payload.qid) hubSchedule(payload, 1);

        // Similar questions em background
        if (payload.qid) {
          findSimilarQuestions(payload).then(async similar => {
            if (!similar.length) return;
            const wb = await loadWrongBank();
            if (wb[payload.qid]) {
              wb[payload.qid].relatedQuestions = similar;
              await setStorage({ wrongBank: wb });
              const criticals = similar.filter(s => s.importance === 3 || s.erros >= 2);
              if (criticals.length > 0) {
                const settings = await getSettings();
                if (settings.notifications !== false) {
                  showNotification(
                    `📎 ${similar.length} questão(ões) similar(es)`,
                    `"${(payload.desc || payload.assunto || '').slice(0, 60)}" — veja em REVISÃO`,
                    'sim-found-' + payload.qid,
                  );
                }
              }
            }
          }).catch(() => {});
        }

        const due = await getDueReviews();
        updateBadge(due.length + state.hubQueue.length);
        ensureHourlyDay();
        const h2 = new Date().getHours();
        state.hourlyStats[h2].q++;
        updateHeatmap('wrong').catch(() => {});
        updateArticleCoverage(payload, 'wrong').catch(() => {});
        updateConfusionPatterns(payload).catch(() => {});

        // Claude semantic (se configurado)
        if (payload.qid && (payload.enunciado || payload.desc)) {
          getSettings().then(async s => {
            if (!s.claudeApiKey) return;
            const textForClaude = payload.enunciado && payload.enunciado.length > 50
              ? payload.enunciado.slice(0, 1500)
              : (payload.desc || '');
            const concepts = await callClaudeForConcepts(textForClaude, s.claudeApiKey);
            if (!concepts) return;
            const wb = await loadWrongBank();
            if (wb[payload.qid]) {
              wb[payload.qid].semanticConcepts = concepts;
              await setStorage({ wrongBank: wb });
            }
          }).catch(() => {});
        }

        if (state.activeSession) {
          state.activeSession.erros = (state.activeSession.erros || 0) + 1;
          state.activeSession.questions = state.activeSession.questions || [];
          state.activeSession.questions.push({ ...payload, result: 'wrong' });
          state.activeSession.lastActivity = Date.now();
        }
        saveState();
        break;
      }

      case 'SESSION_START': {
        const payload = msg.payload || {};
        // Se já há sessão e mudou de caderno → fecha a antiga
        if (state.activeSession && state.activeSession.caderno && payload.caderno
            && state.activeSession.caderno !== payload.caderno) {
          await closeActiveSession('switched');
        }
        if (!state.activeSession) {
          state.activeSession = {
            id:        Date.now().toString(),
            date:      todayKey(),
            startTime: Date.now(),
            lastActivity: Date.now(),
            caderno:   payload.caderno  || '',
            materia:   payload.materia  || '',
            totalQ:    payload.totalQ   || 0,
            acertos:   0,
            erros:     0,
            questions: [],
          };
        }
        if (!state.timer.running) timerStart();

        // Pré-alerta
        if (payload.materia || payload.assunto) {
          getDueReviews().then(async dueList => {
            const related = dueList.filter(q =>
              (payload.materia && q.materia === payload.materia) ||
              (payload.assunto && q.assunto === payload.assunto),
            );
            if (related.length > 0) {
              const settings = await getSettings();
              if (settings.notifications !== false) {
                showNotification(
                  `⚠️ ${related.length} revisão(ões) pendente(s)`,
                  `Você tem erros de ${payload.materia || payload.assunto} para revisar antes.`,
                  'pf-prealert-' + Date.now(),
                );
              }
              if (state.activeSession) {
                state.activeSession._preAlert = {
                  count: related.length,
                  materia: payload.materia || payload.assunto,
                  items: related.slice(0, 3).map(q => ({ qid: q.qid, desc: q.desc, assunto: q.assunto })),
                };
                saveState();
              }
            }
          }).catch(() => {});
        }
        saveState();
        break;
      }

      case 'SESSION_END': {
        const payload = msg.payload || {};
        if (state.activeSession) {
          state.activeSession.endTime  = Date.now();
          state.activeSession.elapsed  = timerGetElapsed();
          if (payload.stats) {
            state.activeSession.acertos = payload.stats.correct || state.activeSession.acertos;
            state.activeSession.erros   = payload.stats.wrong   || state.activeSession.erros;
          }
          state.activeSession.reason = 'completed';
          await saveSessionToHistory({ ...state.activeSession });
          await updateGlobalStats(state.activeSession.acertos, state.activeSession.erros);
          timerReset();
          state.activeSession = null;
        }
        saveState();
        break;
      }

      case 'HUBERMAN_CORRECT': {
        const result = hubAdvancePhase(msg.qid);
        if (result === 'done') {
          showNotification('🧠 Revisão Huberman concluída!',
            'Questão dominada nas 3 fases. Agora no SM-2 de longo prazo.', 'hub-done-' + msg.qid);
        }
        const due2 = await getDueReviews();
        updateBadge(due2.length + state.hubQueue.length);
        sendResponse({ hub: hubGetStatus() });
        return;
      }

      case 'HUBERMAN_WRONG': {
        hubResetPhase(msg.qid);
        const due3 = await getDueReviews();
        updateBadge(due3.length + state.hubQueue.length);
        sendResponse({ hub: hubGetStatus() });
        return;
      }

      case 'HUBERMAN_CUSTOM': {
        const idx  = state.hubQueue.findIndex(h => h.qid === msg.qid);
        const base = idx >= 0 ? state.hubQueue[idx] : {
          qid: msg.qid, url: msg.url || '', materia: '', assunto: '',
          desc: 'Questão #' + msg.qid,
        };
        if (idx >= 0) state.hubQueue.splice(idx, 1);
        const mins = Math.max(1, parseInt(msg.mins) || 5);
        hubSchedule(base, (base.phase || 1), mins);
        sendResponse({ hub: hubGetStatus() });
        return;
      }

      case 'HUBERMAN_GET':
        sendResponse({ hub: hubGetStatus() });
        return;

      case 'HUBERMAN_DISMISS': {
        const di = state.hubQueue.findIndex(h => h.qid === msg.qid);
        if (di >= 0) {
          state.hubQueue.splice(di, 1);
          chrome.alarms.clear(hubAlarmName(msg.qid));
          saveState();
        }
        sendResponse({ hub: hubGetStatus() });
        return;
      }

      case 'TIMER_START':  timerStart();  sendResponse(timerSnapshot()); return;
      case 'TIMER_PAUSE':  timerPause();  sendResponse(timerSnapshot()); return;
      case 'TIMER_RESET':  timerReset();  sendResponse(timerSnapshot()); return;
      case 'TIMER_GET':    sendResponse(timerSnapshot()); return;

      case 'UPDATE_BADGE':
        updateBadge(msg.filaCount || 0);
        break;

      case 'RELAY_TO_PANEL': await relayToPanel(msg.payload); break;
      case 'RELAY_TO_TEC':   await relayToTec(msg.payload); break;

      case 'SHOW_NOTIFICATION':
        showNotification(msg.title, msg.message, msg.id);
        break;

      case 'POMODORO_START':  pomodoroStart(); sendResponse(pomodoroSnapshot()); return;
      case 'POMODORO_STOP':   pomodoroStop();  sendResponse(pomodoroSnapshot()); return;
      case 'POMODORO_SKIP':   pomodoroSkip();  sendResponse(pomodoroSnapshot()); return;
      case 'POMODORO_GET':    sendResponse(pomodoroSnapshot()); return;

      case 'GET_SIMULADO': {
        const allBank = await loadWrongBank();
        const filter = msg.filter || {};
        const count  = Math.min(50, Math.max(5, parseInt(msg.count) || 10));
        let pool = Object.values(allBank);
        if (filter.materia) pool = pool.filter(q => q.materia === filter.materia);
        if (filter.assunto) pool = pool.filter(q => q.assunto === filter.assunto);
        const sorted = pool
          .sort((a, b) => (b.errorCount || 0) - (a.errorCount || 0))
          .slice(0, count)
          .map(q => ({ qid: q.qid, url: q.url, materia: q.materia, assunto: q.assunto, desc: q.desc }));
        sendResponse({ questions: sorted });
        return;
      }

      case 'FIND_SIMILAR': {
        const similar = await findSimilarQuestions(msg.payload || {}, msg.limit || 5);
        sendResponse({ similar });
        return;
      }

      case 'MANUAL_HUB_START': {
        const mins = Math.max(1, Math.min(120, msg.mins || 5));
        state.manualHubTimer = { running: true, label: msg.label || (mins + ' min'),
          totalSecs: mins * 60, startTs: Date.now() };
        chrome.alarms.clear(MAN_HUB_ALARM);
        chrome.alarms.create(MAN_HUB_ALARM, { delayInMinutes: mins });
        saveState();
        sendResponse({ ok: true, timer: manualHubSnapshot() });
        return;
      }
      case 'MANUAL_HUB_CANCEL': {
        chrome.alarms.clear(MAN_HUB_ALARM);
        state.manualHubTimer.running = false;
        saveState();
        sendResponse({ ok: true });
        return;
      }
      case 'MANUAL_HUB_GET':
        sendResponse(manualHubSnapshot());
        return;

      case 'HUB_REVIEW_RESULT': {
        const stored = (await getStorage('pf_hub_reviews')).pf_hub_reviews || [];
        stored.push({ ts: Date.now(), label: msg.label || '', remembered: !!msg.remembered });
        if (stored.length > 300) stored.splice(0, stored.length - 300);
        await setStorage({ pf_hub_reviews: stored });
        sendResponse({ ok: true });
        return;
      }

      case 'GET_POPUP_DATA': {
        const [
          todayStats, globalStats, wrongBank, sessions, subjectStats,
          settings, dueReviews, weekStats, questionBank,
          artCovStored, confStored, notes, tags,
        ] = await Promise.all([
          getTodayStats(), loadStats(), loadWrongBank(), getSessions(20),
          getSubjectStats(), getSettings(), getDueReviews(), getWeekStats(),
          loadQuestionBank(),
          getStorage('pf_article_coverage'),
          getStorage('pf_confusion_patterns'),
          getNotes(), getTags(),
        ]);
        const qbItems     = Object.values(questionBank);
        const articleCoverage   = artCovStored.pf_article_coverage || {};
        const confusionPatterns = Object.values(confStored.pf_confusion_patterns || {})
          .filter(p => p.count >= 3)
          .sort((a, b) => b.count - a.count).slice(0, 10);
        const clusteredReviews  = clusterDueReviews(dueReviews);
        const smartGoal         = settings.smartGoal ? await calculateSmartGoal() : null;

        sendResponse({
          todayStats, globalStats,
          wrongBankSize: Object.keys(wrongBank).length,
          sessions, subjectStats, settings,
          dueReviews, clusteredReviews,
          filaCount: state.filaCount,
          panelTabId: state.panelTabId, tecTabId: state.tecTabId,
          activeSession: state.activeSession,
          timer: timerSnapshot(),
          hubQueue: hubGetStatus(),
          weekStats,
          pomodoro: pomodoroSnapshot(),
          hourlyStats: state.hourlyStats,
          manualHubTimer: manualHubSnapshot(),
          recentResults: state.activeSession
            ? (state.activeSession.questions || []).slice(-10).map(q => q.result)
            : [],
          preAlert: state.activeSession?._preAlert || null,
          articleCoverage, confusionPatterns,
          notes, tags,
          smartGoal,
          questionBankStats: {
            total: qbItems.length,
            dominadas: qbItems.filter(q => q.importance === 1).length,
            atencao:   qbItems.filter(q => q.importance === 2).length,
            criticas:  qbItems.filter(q => q.importance === 3).length,
          },
        });
        return;
      }

      case 'GET_INSIGHTS_DATA': {
        const [heatmap, forgetting, weekly, interleaving, insights] = await Promise.all([
          getHeatmap(), getForgettingCurve(), getWeeklyCompare(),
          getInterleavingSuggestion(), generateInsights(),
        ]);
        sendResponse({ heatmap, forgetting, weekly, interleaving, insights });
        return;
      }

      case 'GET_CALENDAR': {
        const calendar = await getReviewCalendar();
        sendResponse({ calendar });
        return;
      }

      case 'GET_DUE_COUNT': {
        const due = await getDueReviews();
        sendResponse({ dueCount: due.length, hubCount: state.hubQueue.length });
        return;
      }

      case 'GET_ANALISE_DATA': {
        const [artCov, confPatt, settings2] = await Promise.all([
          getStorage('pf_article_coverage'),
          getStorage('pf_confusion_patterns'),
          getSettings(),
        ]);
        const topWeak = {};
        const covData = artCov.pf_article_coverage || {};
        for (const [mat, refs] of Object.entries(covData)) {
          const ranked = Object.entries(refs)
            .map(([ref, v]) => ({ ref, ...v, total: v.correct + v.wrong, pct: v.correct + v.wrong > 0 ? Math.round(v.correct / (v.correct + v.wrong) * 100) : 0 }))
            .filter(r => r.total > 0)
            .sort((a, b) => a.pct - b.pct || b.total - a.total);
          if (ranked.length) topWeak[mat] = ranked.slice(0, 10);
        }
        const confusions = Object.values(confPatt.pf_confusion_patterns || {})
          .filter(p => p.count >= 2)
          .sort((a, b) => b.count - a.count).slice(0, 20);
        sendResponse({ topWeak, confusions, apiKeySet: !!settings2.claudeApiKey });
        return;
      }

      case 'GET_SEMANTIC_CONCEPTS': {
        const settings3 = await getSettings();
        const concepts  = await callClaudeForConcepts(msg.text, settings3.claudeApiKey);
        sendResponse({ concepts });
        return;
      }

      case 'REVIEW_QUESTION': {
        await reviewWrongQuestion(msg.qid, msg.quality || 4);
        const due = await getDueReviews();
        updateBadge(due.length + state.hubQueue.length);
        sendResponse({ ok: true, dueReviews: due });
        return;
      }

      case 'SAVE_NOTE':
        await saveNote(msg.qid, msg.note);
        sendResponse({ ok: true });
        return;

      case 'SAVE_TAG':
        await saveTags(msg.qid, msg.tags);
        sendResponse({ ok: true });
        return;

      case 'EXPORT_QUESTION_BANK': {
        const qb = await loadQuestionBank();
        sendResponse({ bank: Object.values(qb) });
        return;
      }

      case 'GET_QUESTION_BANK_STATS': {
        const qb = await loadQuestionBank();
        const items = Object.values(qb);
        sendResponse({
          total: items.length,
          dominadas: items.filter(q => q.importance === 1).length,
          atencao:   items.filter(q => q.importance === 2).length,
          criticas:  items.filter(q => q.importance === 3).length,
        });
        return;
      }

      case 'EXPORT_WRONG': {
        const bank = await loadWrongBank();
        sendResponse({ bank: Object.values(bank) });
        return;
      }

      case 'EXPORT_ANKI': {
        const text = await buildAnkiExport();
        sendResponse({ text });
        return;
      }

      case 'EXPORT_BACKUP': {
        const backup = await buildBackup();
        sendResponse({ backup });
        return;
      }

      case 'IMPORT_BACKUP': {
        const r = await importBackup(msg.backup, msg.mode || 'merge');
        sendResponse(r);
        return;
      }

      // ── IRT (Item Response Theory) ─────────────────────────────────
      case 'GET_IRT_NEXT': {
        const r = await irtSelectAdaptive(msg.materia || '', msg.count || 10);
        sendResponse(r);
        return;
      }

      case 'GET_IRT_STATS': {
        const stats = await getIRTStats();
        sendResponse({ stats });
        return;
      }

      // ── Edital → Gap Mapping ───────────────────────────────────────
      case 'IMPORT_EDITAL': {
        const settings4 = await getSettings();
        if (!settings4.claudeApiKey) {
          sendResponse({ ok: false, error: 'API key Claude não configurada' });
          return;
        }
        const parsed = await parseEditalWithClaude(msg.text || '', settings4.claudeApiKey);
        if (!parsed || parsed.error) {
          sendResponse({ ok: false, error: parsed?.error || 'Falha no parse' });
          return;
        }
        const saved = await saveEdital(parsed);
        sendResponse({ ...saved, parsed });
        return;
      }

      case 'GET_EDITAL_COVERAGE': {
        const cov = await getEditalCoverage();
        sendResponse(cov);
        return;
      }

      case 'DELETE_EDITAL': {
        await deleteEdital();
        sendResponse({ ok: true });
        return;
      }

      // ── Clusters semânticos ────────────────────────────────────────
      case 'GET_SEMANTIC_CLUSTERS': {
        const c = await getSemanticClusters();
        sendResponse(c);
        return;
      }

      // ── Activity tracker ───────────────────────────────────────────
      case 'REPORT_ACTIVITY': {
        await recordActivity(msg.productive, msg.idle);
        sendResponse({ ok: true });
        return;
      }

      case 'GET_ACTIVITY_STATS': {
        const a = await getActivityStats();
        sendResponse(a);
        return;
      }

      // ── Biblioteca PDF ────────────────────────────────────────────
      case 'IMPORT_QUESTIONS_FROM_PDF': {
        const r = await importQuestionsFromPDF(msg.questions || [], msg.source || 'PDF');
        sendResponse(r);
        return;
      }

      case 'GET_LIBRARY_STATS': {
        const r = await getLibraryStats();
        sendResponse(r);
        return;
      }

      case 'GET_LIBRARY_LIST': {
        const r = await getLibraryList(msg.filters || {}, msg.page || 1, msg.pageSize || 20);
        sendResponse(r);
        return;
      }

      case 'DELETE_LIBRARY_QUESTION': {
        const r = await deleteLibraryQuestion(msg.qid);
        sendResponse(r);
        return;
      }

      case 'CLEAR_LIBRARY': {
        const r = await clearLibrary(msg.scope || 'all');
        sendResponse(r);
        return;
      }

      // ── Contexto da matéria (para o widget) ──────────────────────────────
      case 'GET_SUBJECT_CONTEXT': {
        const { materia = '', assunto = '' } = msg.payload || {};
        const bank = await loadQuestionBank();
        const qs = Object.values(bank).filter(q => {
          if (assunto) return q.assunto === assunto;
          return q.materia === materia;
        });
        if (!qs.length) { sendResponse({ total: 0 }); return; }
        const acertos = qs.reduce((a, q) => a + (q.acertos || 0), 0);
        const total   = qs.reduce((a, q) => a + (q.acertos || 0) + (q.erros || 0), 0);
        const taxa    = total > 0 ? Math.round(acertos / total * 100) : 0;
        // Tendência: compara taxa geral com os últimos 5 erros/acertos
        const recent = qs
          .filter(q => q.lastSeen)
          .sort((a, b) => (b.lastSeen > a.lastSeen ? 1 : -1))
          .slice(0, 10);
        const recentAce   = recent.reduce((a, q) => a + (q.acertos || 0), 0);
        const recentTotal = recent.reduce((a, q) => a + (q.acertos || 0) + (q.erros || 0), 0);
        const recentTaxa  = recentTotal > 0 ? Math.round(recentAce / recentTotal * 100) : taxa;
        const trend       = recentTaxa - taxa; // positivo = melhora recente
        // Tempo médio
        const timesAll = qs.flatMap(q => q.times || []).filter(t => t > 0);
        const avgTime  = timesAll.length > 0
          ? Math.round(timesAll.reduce((a, b) => a + b, 0) / timesAll.length)
          : 0;
        sendResponse({ total: qs.length, taxa, trend, avgTime });
        return;
      }

      // ── Metacognição ──────────────────────────────────────────────────────
      case 'GET_METACOG_SUMMARY': {
        const { pf_metacog = [] } = await getStorage({ pf_metacog: [] });
        if (!pf_metacog.length) { sendResponse({ metacog: null }); return; }
        let total = 0, illusion = 0, under = 0, calibrated = 0;
        const illusionByAssunto = {};
        for (const m of pf_metacog) {
          total++;
          const knew    = m.confidence === 'knew';
          const guessed = m.confidence === 'guessed';
          const didnt   = m.confidence === 'didnt_know';
          const correct = m.result === 'correct';
          // Ilusão de domínio: achava que sabia mas errou
          if (knew && !correct) {
            illusion++;
            const k = m.assunto || m.materia || '?';
            illusionByAssunto[k] = (illusionByAssunto[k] || 0) + 1;
          }
          // Subconfiança: não sabia mas acertou
          if (didnt && correct) under++;
          // Calibrado: (sabia e acertou) OU (não sabia e errou)
          if ((knew && correct) || (didnt && !correct)) calibrated++;
        }
        // Assunto com mais ilusão
        const weakAssunto = Object.entries(illusionByAssunto)
          .sort((a, b) => b[1] - a[1])[0]?.[0] || null;
        sendResponse({ metacog: { total, illusion, under, calibrated, weakAssunto } });
        return;
      }

      case 'RECORD_CONFIDENCE': {        const { qid, confidence, result, materia = '', assunto = '' } = msg.payload || {};
        if (!qid || !confidence) { sendResponse({ ok: false }); return; }
        const { pf_metacog = [] } = await getStorage({ pf_metacog: [] });
        // Evita duplicar o mesmo qid+sessão (permite atualizar)
        const existIdx = pf_metacog.findIndex(m => m.qid === qid && m.session === todayKey());
        const entry = { qid, confidence, result, materia, assunto,
                        date: todayKey(), session: todayKey(), ts: Date.now() };
        if (existIdx >= 0) pf_metacog[existIdx] = entry;
        else pf_metacog.push(entry);
        // Mantém 1000 registros
        if (pf_metacog.length > 1000) pf_metacog.splice(0, pf_metacog.length - 1000);
        await setStorage({ pf_metacog });
        // Atualiza questionBank com a confiança
        const { questionBank } = await getStorage({ questionBank: {} });
        if (questionBank[qid]) {
          questionBank[qid].lastConfidence = confidence;
          await setStorage({ questionBank });
        }
        sendResponse({ ok: true });
        return;
      }

      case 'SAVE_SETTINGS':
        await setStorage({ settings: msg.settings });
        sendResponse({ ok: true });
        return;

      case 'SAVE_TEC_RANKING':
        await setStorage({ tec_ranking: msg.data });
        sendResponse({ ok: true });
        return;

      case 'GET_TEC_RANKING': {
        const { tec_ranking = null } = await getStorage({ tec_ranking: null });
        sendResponse({ data: tec_ranking });
        return;
      }

      case 'GET_STATUS':
        sendResponse({ filaCount: state.filaCount, panelTabId: state.panelTabId, tecTabId: state.tecTabId });
        return;

      case 'GET_FILA': {
        const due = await getDueReviews();
        updateBadge(due.length + state.hubQueue.length);
        sendResponse({ dueCount: due.length });
        return;
      }
    }
  })();

  return true; // keep channel open
});

// ══════════════════════════════════════════════════════════════════════════
// EVENTOS DE ABA
// ══════════════════════════════════════════════════════════════════════════

chrome.tabs.onRemoved.addListener(tabId => {
  if (tabId === state.tecTabId)   state.tecTabId   = null;
  if (tabId === state.panelTabId) state.panelTabId = null;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab.url) return;
  if (tab.url.includes('tecconcursos.com.br'))               state.tecTabId   = tabId;
  if (tab.url.includes('cazuzaleo89-netizen.github.io'))     state.panelTabId = tabId;
});

// ══════════════════════════════════════════════════════════════════════════
// LIFECYCLE
// ══════════════════════════════════════════════════════════════════════════

chrome.runtime.onInstalled.addListener(async () => {
  await loadState();

  // Schema migration & pruning
  const v = (await getStorage('pf_schema_version')).pf_schema_version || 1;
  if (v < SCHEMA_VERSION) {
    await pruneOldTodays();
    await setStorage({ pf_schema_version: SCHEMA_VERSION });
  }

  // Reagenda alarmes Huberman para itens persistidos
  for (const h of state.hubQueue) {
    const remainingMs = h.reviewAt - Date.now();
    if (remainingMs > 0) {
      chrome.alarms.create(hubAlarmName(h.qid), { delayInMinutes: remainingMs / 60000 });
    }
  }

  // Reagenda pomodoro
  scheduleNextPomodoroAlarm();

  // Reagenda manual hub timer
  if (state.manualHubTimer.running) {
    const remainingMs = state.manualHubTimer.totalSecs * 1000 - (Date.now() - state.manualHubTimer.startTs);
    if (remainingMs > 0) {
      chrome.alarms.create(MAN_HUB_ALARM, { delayInMinutes: remainingMs / 60000 });
    } else {
      state.manualHubTimer.running = false;
      saveState();
    }
  }

  // Injeta content.js em abas TEC abertas
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.url && tab.url.includes('tecconcursos.com.br') && tab.id) {
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
        state.tecTabId = tab.id;
      } catch { /* */ }
    }
  }

  // Alarmes periódicos
  chrome.alarms.create('daily-review-check',  { periodInMinutes: 60 });
  chrome.alarms.create('session-idle-check',  { periodInMinutes: 5 });
  chrome.alarms.create('weekly-backup-check', { periodInMinutes: 60 * 24 }); // 1×/dia, checa se 7d desde último backup
});

chrome.runtime.onStartup.addListener(async () => {
  await loadState();
  scheduleNextPomodoroAlarm();
});

async function pruneOldTodays() {
  const all = await new Promise(r => chrome.storage.local.get(null, r));
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - TODAY_RETENTION_D);
  const cutoffKey = 'today_' + cutoff.toISOString().split('T')[0];
  const toRemove = Object.keys(all).filter(k => k.startsWith('today_') && k < cutoffKey);
  if (toRemove.length) {
    await new Promise(r => chrome.storage.local.remove(toRemove, r));
  }
}

// ══════════════════════════════════════════════════════════════════════════
// ALARM HANDLER
// ══════════════════════════════════════════════════════════════════════════

chrome.alarms.onAlarm.addListener(async alarm => {
  await loadState();

  if (alarm.name === POM_ALARM) {
    if (state.pomodoro.active && state.pomodoro.endTime && Date.now() >= state.pomodoro.endTime) {
      pomodoroAdvance();
    } else {
      scheduleNextPomodoroAlarm();
    }
    return;
  }

  if (alarm.name === MAN_HUB_ALARM) {
    const lbl = state.manualHubTimer.label || 'Revisão';
    state.manualHubTimer.running = false;
    saveState();
    showNotification('🧠 Revisão Huberman Manual',
      `Hora de revisar! ${lbl} concluídos.`, 'hub-manual-done');
    return;
  }

  if (alarm.name.startsWith('hub-')) {
    const qid  = alarm.name.slice(4);
    const item = state.hubQueue.find(h => h.qid === qid);
    if (!item) return;

    const settings = await getSettings();
    if (settings.notifications !== false) {
      const label = item.customMins != null
        ? `Intervalo custom ${item.customMins}min`
        : `Fase ${item.phase} de 3 · ${HUB_PHASES[item.phase - 1]}min`;
      showNotification(`🧠 Revisão Huberman — ${label}`,
        item.desc || 'Questão #' + item.qid, 'hub-due-' + qid);
    }

    const due = await getDueReviews();
    updateBadge(due.length + state.hubQueue.length);
    await hubNotifyTec(item);
    return;
  }

  if (alarm.name === 'session-idle-check') {
    if (state.activeSession && state.activeSession.lastActivity) {
      const idle = Date.now() - state.activeSession.lastActivity;
      if (idle > SESSION_IDLE_MIN * 60 * 1000) {
        await closeActiveSession('idle');
      }
    }
    return;
  }

  if (alarm.name === 'weekly-backup-check') {
    const settings = await getSettings();
    if (!settings.autoBackup) return;
    const last = (await getStorage('pf_last_backup_prompt')).pf_last_backup_prompt || 0;
    if (Date.now() - last < 7 * 24 * 60 * 60 * 1000) return;
    showNotification('💾 Hora do backup',
      'Faça backup das suas estatísticas (CONFIG → Exportar Backup).', 'pf-backup');
    await setStorage({ pf_last_backup_prompt: Date.now() });
    return;
  }

  if (alarm.name !== 'daily-review-check') return;
  const due = await getDueReviews();
  updateBadge(due.length + state.hubQueue.length);
  if (due.length > 0) {
    const settings = await getSettings();
    if (settings.notifications !== false) {
      showNotification('📋 Revisões pendentes',
        `Você tem ${due.length} questão${due.length > 1 ? 'ões' : ''} para revisar hoje.`,
        'pf-daily');
    }
  }
});

chrome.notifications.onClicked.addListener(async () => {
  await loadState();
  const tab = state.tecTabId ? { id: state.tecTabId } : await findTecTab();
  if (!tab) return;
  chrome.tabs.update(tab.id, { active: true });
  const win = await chrome.windows.get(tab.windowId).catch(() => null);
  if (win) chrome.windows.update(win.id, { focused: true });
});
