/**
 * Painel Fiscal — Background Service Worker v2.0
 * Gerencia: sessões, banco de erros, repetição espaçada SM-2,
 * relay de mensagens TEC↔Painel, badge e notificações.
 */

const PANEL_URL_PATTERN = 'https://cazuzaleo89-netizen.github.io/projetofiscal/*';

// ════════════════════════════════════════════════════════
// ESTADO EM MEMÓRIA
// ════════════════════════════════════════════════════════

let panelTabId  = null;
let tecTabId    = null;
let filaCount   = 0;
let activeSession = null;  // sessão corrente (não persistida ainda)
let _bgSearchTabId = null; // aba de busca de similares em background

// ── Estatísticas por hora do dia (em memória, reset diário) ──────────────
let _hourlyDay = '';
let hourlyStats = Array(24).fill(null).map(() => ({ q: 0, ace: 0 }));
function _ensureHourlyDay() {
  const today = todayKey();
  if (_hourlyDay !== today) { _hourlyDay = today; hourlyStats = Array(24).fill(null).map(() => ({ q: 0, ace: 0 })); }
}

// ── Timer Huberman Manual (5/9/11min) ────────────────────────────────────
let manualHubTimer = { running: false, label: '', totalSecs: 0, startTs: null };
const MAN_HUB_ALARM = 'pf_manual_hub_review';
function manualHubSnapshot() {
  if (!manualHubTimer.running) return { running: false };
  const remaining = Math.max(0, manualHubTimer.totalSecs - Math.floor((Date.now() - manualHubTimer.startTs) / 1000));
  return { running: true, label: manualHubTimer.label, totalSecs: manualHubTimer.totalSecs, remaining };
}

// ════════════════════════════════════════════════════════
// MÉTODO HUBERMAN — Fila de revisão em curto prazo
// Protocolo: 5min → 9min → 11min → custom → SM-2 longo prazo
// ════════════════════════════════════════════════════════

const HUB_PHASES = [5, 9, 11];   // minutos por fase
const hubQueue   = [];            // [{qid,url,materia,assunto,desc,phase,reviewAt,addedAt}]

function hubAlarmName(qid) { return 'hub-' + qid; }

function hubSchedule(q, phase, customMins) {
  const mins = customMins != null ? customMins : HUB_PHASES[phase - 1];
  if (mins == null) return false;  // todas as fases concluídas

  // Remove entrada anterior deste qid
  const idx = hubQueue.findIndex(h => h.qid === q.qid);
  if (idx >= 0) hubQueue.splice(idx, 1);

  // Cancela alarme anterior
  chrome.alarms.clear(hubAlarmName(q.qid));

  const reviewAt = Date.now() + mins * 60 * 1000;
  hubQueue.push({
    qid:     q.qid,
    url:     q.url     || '',
    materia: q.materia || '',
    assunto: q.assunto || '',
    desc:    q.desc    || 'Questão #' + q.qid,
    phase,
    customMins: customMins || null,
    reviewAt,
    addedAt: Date.now(),
    mins,
  });

  chrome.alarms.create(hubAlarmName(q.qid), { delayInMinutes: mins });
  return true;
}

function hubGetStatus() {
  const now = Date.now();
  return hubQueue.map(h => ({
    ...h,
    isDue:     now >= h.reviewAt,
    remaining: Math.max(0, Math.round((h.reviewAt - now) / 1000)), // segundos
    phaseName: h.customMins != null ? `${h.customMins}min (custom)` : `${HUB_PHASES[h.phase - 1]}min`,
  })).sort((a, b) => a.reviewAt - b.reviewAt);
}

function hubAdvancePhase(qid) {
  const idx = hubQueue.findIndex(h => h.qid === qid);
  if (idx < 0) return;
  const item = hubQueue[idx];
  hubQueue.splice(idx, 1);
  chrome.alarms.clear(hubAlarmName(qid));

  const nextPhase = item.phase + 1;
  if (nextPhase <= HUB_PHASES.length) {
    hubSchedule(item, nextPhase);
    return 'next';
  }
  return 'done';  // concluiu todas as fases → fica no SM-2
}

function hubResetPhase(qid) {
  const idx = hubQueue.findIndex(h => h.qid === qid);
  if (idx < 0) return;
  const item = hubQueue[idx];
  hubQueue.splice(idx, 1);
  chrome.alarms.clear(hubAlarmName(qid));
  hubSchedule(item, 1);  // reinicia do zero
}

async function hubNotifyTec(item) {
  const tab = tecTabId ? { id: tecTabId } : await findTecTab();
  if (!tab) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'HUBERMAN_DUE', item });
  } catch { /* tab pode não ter content script */ }
}

// ════════════════════════════════════════════════════════
// CRONÔMETRO (gerenciado no background para persistir entre navegações)
// ════════════════════════════════════════════════════════

const timer = {
  startTime: null,   // Date.now() quando foi ligado/retomado
  elapsed: 0,        // segundos acumulados (pausa incluída)
  running: false,
};

function timerGetElapsed() {
  if (!timer.running || !timer.startTime) return timer.elapsed;
  return timer.elapsed + Math.floor((Date.now() - timer.startTime) / 1000);
}

function timerStart() {
  if (timer.running) return;
  timer.startTime = Date.now();
  timer.running   = true;
}

function timerPause() {
  if (!timer.running) return;
  timer.elapsed   = timerGetElapsed();
  timer.startTime = null;
  timer.running   = false;
}

function timerReset() {
  timer.startTime = null;
  timer.elapsed   = 0;
  timer.running   = false;
}

function timerSnapshot() {
  return { elapsed: timerGetElapsed(), running: timer.running };
}

// ════════════════════════════════════════════════════════
// MODO POMODORO
// ════════════════════════════════════════════════════════

const pomodoro = {
  active: false,
  state: 'work',       // 'work' | 'break' | 'longBreak'
  workMins: 25,
  breakMins: 5,
  longBreakMins: 15,
  count: 0,
  endTime: null,
  _checkInterval: null,
};

function pomodoroSnapshot() {
  const now = Date.now();
  const remaining = pomodoro.active && pomodoro.endTime
    ? Math.max(0, Math.round((pomodoro.endTime - now) / 1000))
    : 0;
  return {
    active:    pomodoro.active,
    state:     pomodoro.state,
    count:     pomodoro.count,
    workMins:  pomodoro.workMins,
    breakMins: pomodoro.breakMins,
    longBreakMins: pomodoro.longBreakMins,
    remaining,
    endTime:   pomodoro.endTime,
  };
}

function pomodoroGetDuration() {
  if (pomodoro.state === 'work')       return pomodoro.workMins * 60 * 1000;
  if (pomodoro.state === 'longBreak')  return pomodoro.longBreakMins * 60 * 1000;
  return pomodoro.breakMins * 60 * 1000;
}

function pomodoroAdvance() {
  if (pomodoro.state === 'work') {
    pomodoro.count++;
    if (pomodoro.count % 4 === 0) {
      pomodoro.state = 'longBreak';
      showNotification('☕ Pausa longa!', `${pomodoro.longBreakMins} minutos de descanso. Você completou ${pomodoro.count} pomodoros!`, 'pom-break');
    } else {
      pomodoro.state = 'break';
      showNotification('☕ Pausa curta!', `${pomodoro.breakMins} minutos de descanso.`, 'pom-break');
    }
  } else {
    pomodoro.state = 'work';
    showNotification('🍅 Hora de trabalhar!', `${pomodoro.workMins} minutos de foco. Pomodoro #${pomodoro.count + 1}.`, 'pom-work');
  }
  pomodoro.endTime = Date.now() + pomodoroGetDuration();
}

function pomodoroStartCheck() {
  if (pomodoro._checkInterval) clearInterval(pomodoro._checkInterval);
  pomodoro._checkInterval = setInterval(() => {
    if (!pomodoro.active || !pomodoro.endTime) return;
    if (Date.now() >= pomodoro.endTime) {
      pomodoroAdvance();
    }
  }, 5000);
}

function pomodoroStart() {
  pomodoro.active  = true;
  pomodoro.state   = 'work';
  pomodoro.endTime = Date.now() + pomodoroGetDuration();
  pomodoroStartCheck();
}

function pomodoroStop() {
  pomodoro.active  = false;
  pomodoro.endTime = null;
  if (pomodoro._checkInterval) { clearInterval(pomodoro._checkInterval); pomodoro._checkInterval = null; }
}

function pomodoroSkip() {
  if (!pomodoro.active) return;
  pomodoroAdvance();
}

// ════════════════════════════════════════════════════════
// ALGORITMO SM-2 (Repetição Espaçada)
// ════════════════════════════════════════════════════════

function sm2Update(item, quality) {
  // quality: 0=apagão total, 3=correto com esforço, 5=perfeito
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
  };
}

// ════════════════════════════════════════════════════════
// STORAGE — LEITURA / ESCRITA
// ════════════════════════════════════════════════════════

async function getStorage(keys) {
  return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}
async function setStorage(data) {
  return new Promise(resolve => chrome.storage.local.set(data, resolve));
}

function todayKey() {
  return new Date().toISOString().split('T')[0]; // YYYY-MM-DD
}

// ── Estatísticas globais ──────────────────────────────────────────────────────

async function loadStats() {
  const { globalStats } = await getStorage({ globalStats: { totalResolved: 0, totalAcertos: 0, totalErros: 0, streak: 0, lastStudyDate: '', dailyGoal: 30 } });
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

// ── Stats de hoje ─────────────────────────────────────────────────────────────

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

// ── Repositório de questões (acertos E erros) ─────────────────────────────────

async function loadQuestionBank() {
  const { questionBank } = await getStorage({ questionBank: {} });
  return questionBank;
}

async function updateQuestionBank(payload, result) {
  const { questionBank } = await getStorage({ questionBank: {} });
  const today = todayKey();
  const qid = payload.qid || payload.pos?.toString() || 'unknown';
  if (!qid || qid === 'unknown') return;

  const existing = questionBank[qid] || {
    qid, url: payload.url || '', materia: payload.materia || '',
    assunto: payload.assunto || '', desc: payload.desc || ('Questão #' + qid),
    acertos: 0, erros: 0, firstSeen: today, lastSeen: today, importance: 1
  };

  existing.lastSeen = today;
  if (payload.materia) existing.materia = payload.materia;
  if (payload.assunto) existing.assunto = payload.assunto;
  if (payload.url) existing.url = payload.url;
  if (payload.desc) existing.desc = payload.desc;
  if (payload.dificuldade) existing.dificuldade = payload.dificuldade;
  if (payload.tecAcertoGeral) existing.tecAcertoGeral = payload.tecAcertoGeral;
  if (payload.tecResolucaoTotal) existing.tecResolucaoTotal = payload.tecResolucaoTotal;

  if (result === 'correct') existing.acertos++;
  else existing.erros++;

  // importance: 1=never wrong, 2=wrong once, 3=wrong 2+ times
  existing.importance = existing.erros === 0 ? 1 : existing.erros === 1 ? 2 : 3;

  questionBank[qid] = existing;
  await setStorage({ questionBank });
}

async function updateQuestionTecDifficulty(payload) {
  if (!payload || !payload.qid) return;
  const qid = String(payload.qid);
  const hasTecData = payload.dificuldade || payload.tecAcertoGeral || payload.tecResolucaoTotal;
  if (!hasTecData) return;
  const { questionBank } = await getStorage({ questionBank: {} });
  const today = todayKey();
  const existing = questionBank[qid] || {
    qid,
    url: payload.url || '',
    materia: payload.materia || '',
    assunto: payload.assunto || '',
    desc: payload.desc || ('Questao #' + qid),
    acertos: 0, erros: 0,
    firstSeen: today, lastSeen: today, importance: 1,
  };
  existing.lastSeen = today;
  if (payload.url) existing.url = payload.url;
  if (payload.materia) existing.materia = payload.materia;
  if (payload.assunto) existing.assunto = payload.assunto;
  if (payload.desc) existing.desc = payload.desc;
  if (payload.dificuldade) existing.dificuldade = payload.dificuldade;
  if (payload.tecAcertoGeral) existing.tecAcertoGeral = payload.tecAcertoGeral;
  if (payload.tecResolucaoTotal) existing.tecResolucaoTotal = payload.tecResolucaoTotal;
  questionBank[qid] = existing;
  const wrongBank = await loadWrongBank();
  if (wrongBank[qid]) {
    if (payload.dificuldade) wrongBank[qid].dificuldade = payload.dificuldade;
    if (payload.tecAcertoGeral) wrongBank[qid].tecAcertoGeral = payload.tecAcertoGeral;
    if (payload.tecResolucaoTotal) wrongBank[qid].tecResolucaoTotal = payload.tecResolucaoTotal;
    await setStorage({ wrongBank });
  }
  await setStorage({ questionBank });
}

// ── Banco de questões erradas ─────────────────────────────────────────────────

async function loadWrongBank() {
  const { wrongBank } = await getStorage({ wrongBank: {} });
  return wrongBank;
}

async function addToWrongBank(payload) {
  if (!payload.qid) return;
  const bank = await loadWrongBank();
  const today = todayKey();

  if (bank[payload.qid]) {
    bank[payload.qid].errorCount  = (bank[payload.qid].errorCount || 1) + 1;
    bank[payload.qid].lastError   = today;
    bank[payload.qid].nextReview  = today;   // volta para revisão imediata ao errar de novo
    // Atualiza metadados se vieram desta vez
    if (payload.materia)     bank[payload.qid].materia     = payload.materia;
    if (payload.assunto)     bank[payload.qid].assunto     = payload.assunto;
    if (payload.desc)        bank[payload.qid].desc        = payload.desc;
    if (payload.dificuldade) bank[payload.qid].dificuldade = payload.dificuldade;
  } else {
    bank[payload.qid] = {
      qid:         payload.qid,
      url:         payload.url         || '',
      materia:     payload.materia     || '',
      assunto:     payload.assunto     || '',
      desc:        payload.desc        || 'Questão #' + payload.qid,
      dificuldade: payload.dificuldade || '',
      errorCount:  1,
      firstError:  today,
      lastError:   today,
      nextReview:  today,   // aparece IMEDIATAMENTE na fila de revisão
      interval:    1,
      repetitions: 0,
      easeFactor:  2.5,
    };
  }

  await setStorage({ wrongBank: bank });
  return bank;
}

async function reviewWrongQuestion(qid, quality) {
  const bank = await loadWrongBank();
  if (!bank[qid]) return;
  const updated = sm2Update(bank[qid], quality);
  Object.assign(bank[qid], updated);

  if (quality >= 4 && bank[qid].repetitions >= 3) {
    // Questão dominada — remove do banco de erros
    delete bank[qid];
  }

  await setStorage({ wrongBank: bank });
  return bank;
}

// ════════════════════════════════════════════════════════════════════════════
// MOTOR DE SIMILARIDADE — detecta questões parecidas pelo conteúdo jurídico
// Usa extração de palavras-chave legais + índice Jaccard (sem API externa)
// ════════════════════════════════════════════════════════════════════════════

const PT_STOPWORDS = new Set([
  'para','com','uma','ser','que','não','por','mais','como','mas','foi','ele',
  'ela','seu','sua','dos','das','nas','nos','num','uns','umas','lhe','nós',
  'isso','esse','esta','este','essa','pelo','pela','depois','mesmo','entre',
  'sobre','ainda','porque','quando','quem','está','caso','seja','deve','cada',
  'todo','toda','todos','todas','assim','desde','durante','apenas','podem',
  'pode','fazer','feita','feito','tendo','sendo','foram','teria','seria',
  'também','onde','qual','quais','quanto','sem','após','ante','perante',
  'salvo','exceto','inclusive','mediante','conforme','segundo','artigo',
  'inciso','parágrafo','alínea','mediante','qualquer','quando','razão',
  'forma','vista','valor','prazo','cujas','cujos','cuja','cujo','deste',
  'desta','desse','desse','nesse','nesta','neste','aquele','aquela','tanto',
]);

function extractKeywords(text, materia, assunto) {
  const src = ((text || '') + ' ' + (materia || '') + ' ' + (assunto || '')).toLowerCase();
  const kws = new Set();

  // 1. Referências a artigos de lei (alto peso — marcadores jurídicos específicos)
  const artRefs = src.match(/art(?:igo)?\.?\s*\d+[oº°]?(?:-[a-z])?/g) || [];
  artRefs.forEach(a => kws.add(a.replace(/\s+/g, '').replace('artigo', 'art.')));

  // 2. Parágrafos
  const parRefs = src.match(/§\s*\d+[oº°]?/g) || [];
  parRefs.forEach(p => kws.add(p.replace(/\s+/g, '')));

  // 3. Incisos
  const incRefs = src.match(/inciso\s+(?:[ivxlcdmIVXLCDM]+|\d+)/g) || [];
  incRefs.forEach(i => kws.add(i.replace(/\s+/g, '_')));

  // 4. Leis específicas mencionadas (CTN, CF, CLT, CPC etc.)
  const lawRefs = src.match(/\b(?:ctn|cf\/?\d{2}|crfb|clt|cpc|cp\b|cpp|cdc|lei\s+\d[\d.\/]+)\b/g) || [];
  lawRefs.forEach(l => kws.add(l.replace(/\s+/g, '_')));

  // 5. Palavras jurídicas significativas (>4 chars, sem stopwords)
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
  const targetKw = extractKeywords(payload.desc || payload.enunciado, payload.materia, payload.assunto);
  if (!targetKw.size) return [];

  const results = [];

  for (const [disc, subjects] of Object.entries(bank)) {
    for (const [assunto, qmap] of Object.entries(subjects)) {
      for (const [qid, q] of Object.entries(qmap)) {
        if (qid === (payload.qid || payload.pos?.toString())) continue;

        const sameAssunto = assunto === payload.assunto;
        const sameDisc    = disc === (payload.materia || payload.disciplina);

        const qKw  = extractKeywords(q.desc, disc, assunto);
        const sim  = jaccardSim(targetKw, qKw);
        const score = sim + (sameAssunto ? 0.28 : 0) + (sameDisc ? 0.08 : 0);

        // Mostra se: score suficiente OU mesmo assunto com histórico de erro
        if (score >= 0.15 || (sameAssunto && q.erros > 0)) {
          results.push({
            qid, url: q.url || '', desc: q.desc || assunto,
            materia: disc, assunto,
            importance: q.importance || 1,
            acertos: q.acertos || 0, erros: q.erros || 0,
            score: Math.round(score * 100) / 100,
          });
        }
      }
    }
  }

  return results.sort((a, b) => b.score - a.score || b.erros - a.erros).slice(0, limit);
}

async function getDueReviews() {
  const bank = await loadWrongBank();
  const today = todayKey();
  return Object.values(bank)
    .filter(q => q.nextReview <= today)
    .sort((a, b) => {
      if (b.errorCount !== a.errorCount) return b.errorCount - a.errorCount;
      return a.nextReview.localeCompare(b.nextReview);
    });
}

// ════════════════════════════════════════════════════════════════════════════
// COBERTURA POR ARTIGO — mapeia acertos/erros por referência jurídica
// ════════════════════════════════════════════════════════════════════════════

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
  const refs = extractArticleRefs(payload.desc || payload.enunciado, payload.materia);
  if (!refs.length) return;
  const stored = await new Promise(r => chrome.storage.local.get('pf_article_coverage', r));
  const cov = stored['pf_article_coverage'] || {};
  const key = (payload.materia || 'geral').toLowerCase().replace(/\s+/g, '_');
  if (!cov[key]) cov[key] = {};
  for (const ref of refs) {
    if (!cov[key][ref]) cov[key][ref] = { correct: 0, wrong: 0 };
    if (result === 'correct') cov[key][ref].correct++;
    else cov[key][ref].wrong++;
  }
  await new Promise(r => chrome.storage.local.set({ pf_article_coverage: cov }, r));
}

// ════════════════════════════════════════════════════════════════════════════
// PADRÕES DE CONFUSÃO — detecta artigos que o usuário confunde
// ════════════════════════════════════════════════════════════════════════════

async function updateConfusionPatterns(payload) {
  const refs = extractArticleRefs(payload.desc || payload.enunciado, payload.materia);
  if (refs.length < 2) return;
  const stored = await new Promise(r => chrome.storage.local.get('pf_confusion_patterns', r));
  const patterns = stored['pf_confusion_patterns'] || {};
  for (let i = 0; i < refs.length; i++) {
    for (let j = i + 1; j < refs.length; j++) {
      const pairKey = [refs[i], refs[j]].sort().join('||');
      if (!patterns[pairKey]) patterns[pairKey] = { a: refs[i], b: refs[j], count: 0, materia: payload.materia || '' };
      patterns[pairKey].count++;
    }
  }
  await new Promise(r => chrome.storage.local.set({ pf_confusion_patterns: patterns }, r));
}

// ════════════════════════════════════════════════════════════════════════════
// CLUSTER DE REVISÕES — agrupa revisões pendentes por assunto
// ════════════════════════════════════════════════════════════════════════════

function clusterDueReviews(dueReviews) {
  const clusters = {};
  for (const q of dueReviews) {
    const key = (q.assunto || q.materia || 'geral').toLowerCase();
    if (!clusters[key]) clusters[key] = { label: q.assunto || q.materia || 'Geral', materia: q.materia || '', items: [] };
    clusters[key].items.push(q);
  }
  return Object.values(clusters).sort((a, b) => b.items.length - a.items.length);
}

// ════════════════════════════════════════════════════════════════════════════
// CLAUDE API — extração semântica de conceitos jurídicos
// ════════════════════════════════════════════════════════════════════════════

async function callClaudeForConcepts(text, apiKey) {
  if (!apiKey || !text) return null;
  const cacheKey = 'sem_' + Array.from(text.slice(0, 200)).reduce((h, c) => (Math.imul(31, h) + c.charCodeAt(0)) | 0, 0).toString(36);
  const stored = await new Promise(r => chrome.storage.local.get('pf_semantic_cache', r));
  const cache = stored['pf_semantic_cache'] || {};
  if (cache[cacheKey]) return cache[cacheKey];
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
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
    const data = await resp.json();
    const raw = data.content?.[0]?.text || '';
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    cache[cacheKey] = parsed;
    const keys = Object.keys(cache);
    if (keys.length > 500) keys.slice(0, 50).forEach(k => delete cache[k]);
    await new Promise(r => chrome.storage.local.set({ pf_semantic_cache: cache }, r));
    return parsed;
  } catch { return null; }
}

// ── Histórico de sessões ──────────────────────────────────────────────────────

async function saveSessions(session) {
  if (!session) return;
  const { sessions = [] } = await getStorage({ sessions: [] });
  sessions.unshift(session); // mais recente primeiro
  if (sessions.length > 100) sessions.length = 100; // limite
  await setStorage({ sessions });
}

async function getSessions(limit = 20) {
  const { sessions = [] } = await getStorage({ sessions: [] });
  return sessions.slice(0, limit);
}

// ── Stats por matéria ─────────────────────────────────────────────────────────

async function updateSubjectStats(materia, acertos, erros, assunto) {
  if (!materia) return;
  const { subjectStats = {} } = await getStorage({ subjectStats: {} });
  if (!subjectStats[materia]) subjectStats[materia] = { materia, acertos: 0, erros: 0, total: 0, assuntos: {} };
  subjectStats[materia].acertos += acertos;
  subjectStats[materia].erros   += erros;
  subjectStats[materia].total   += acertos + erros;
  // Salva stats por assunto também
  if (assunto) {
    if (!subjectStats[materia].assuntos) subjectStats[materia].assuntos = {};
    if (!subjectStats[materia].assuntos[assunto]) subjectStats[materia].assuntos[assunto] = { assunto, acertos: 0, erros: 0, total: 0 };
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

// ── Configurações ─────────────────────────────────────────────────────────────

async function getSettings() {
  const { settings } = await getStorage({ settings: { dailyGoal: 30, notifications: true, reviewAlgo: 'sm2', targetRate: 70 } });
  return settings;
}

// ── Estatísticas semanais ─────────────────────────────────────────────────────

async function getWeekStats() {
  const days = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  const result = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    const key = 'today_' + dateStr;
    const stored = await getStorage({ [key]: null });
    const data = stored[key] || { date: dateStr, resolved: 0, acertos: 0, erros: 0 };
    const taxa = data.resolved > 0 ? Math.round(data.acertos / data.resolved * 100) : 0;
    result.push({
      date: dateStr,
      label: days[d.getDay()],
      resolved: data.resolved || 0,
      acertos: data.acertos || 0,
      erros: data.erros || 0,
      taxa,
    });
  }
  return result;
}

// ════════════════════════════════════════════════════════
// BADGE
// ════════════════════════════════════════════════════════

function updateBadge(count) {
  filaCount = count || 0;
  if (filaCount > 0) {
    chrome.action.setBadgeText({ text: String(filaCount) });
    chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

// ════════════════════════════════════════════════════════
// NOTIFICAÇÕES
// ════════════════════════════════════════════════════════

function showNotification(title, message, id) {
  chrome.notifications.create(id || 'pf-' + Date.now(), {
    type: 'basic', iconUrl: 'icons/icon48.png',
    title: title || 'Painel Fiscal',
    message: message || '', priority: 1,
  });
}

async function checkDailyGoal(todayStats) {
  const settings = await getSettings();
  const goal = settings.dailyGoal || 30;
  if (todayStats.resolved === goal) {
    showNotification('🎯 Meta atingida!', `Você resolveu ${goal} questões hoje. Parabéns!`, 'pf-goal');
  }
}

// ════════════════════════════════════════════════════════
// RELAY TEC ↔ PAINEL
// ════════════════════════════════════════════════════════

async function findPanelTab() {
  const tabs = await chrome.tabs.query({ url: PANEL_URL_PATTERN });
  return tabs.length ? tabs[0] : null;
}
async function findTecTab() {
  const tabs = await chrome.tabs.query({ url: '*://www.tecconcursos.com.br/*' });
  return tabs.length ? tabs[0] : null;
}

async function relayToPanel(payload) {
  if (payload?.type === 'TEC_QUESTION' && payload.result === 'desempenho_detail') {
    await updateQuestionTecDifficulty(payload);
  }
  const tab = await findPanelTab();
  if (!tab) return;
  panelTabId = tab.id;
  try {
    await chrome.tabs.sendMessage(panelTabId, { type: 'FROM_TEC', payload });
  } catch {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: panelTabId },
        func: p => window.dispatchEvent(new MessageEvent('message', { data: p })),
        args: [payload],
      });
    } catch { /* */ }
  }
}

async function relayToTec(payload) {
  const tab = tecTabId ? { id: tecTabId } : await findTecTab();
  if (!tab) return;
  tecTabId = tab.id;
  try {
    await chrome.tabs.sendMessage(tecTabId, { type: 'FROM_PANEL', payload });
  } catch {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tecTabId },
        func: p => window.dispatchEvent(new MessageEvent('message', { data: p })),
        args: [payload],
      });
    } catch { /* */ }
  }
}

// ════════════════════════════════════════════════════════
// HANDLERS DE MENSAGEM
// ════════════════════════════════════════════════════════

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;

  (async () => {
    switch (msg.type) {

      // ── Ciclo de vida do content script ────────────────────────────────────
      case 'CONTENT_READY':
        tecTabId = sender.tab ? sender.tab.id : null;
        break;

      // ── Questão correta ────────────────────────────────────────────────────
      case 'QUESTION_CORRECT': {
        const payload = msg.payload || {};
        const today = await updateTodayStats({ acertos: 1 });
        await updateQuestionBank(payload, 'correct');
        if (payload.materia) await updateSubjectStats(payload.materia, 1, 0, payload.assunto);
        await checkDailyGoal(today);
        _ensureHourlyDay(); const _h1 = new Date().getHours(); hourlyStats[_h1].q++; hourlyStats[_h1].ace++;
        updateArticleCoverage(payload, 'correct').catch(() => {});
        if (activeSession) {
          activeSession.acertos = (activeSession.acertos || 0) + 1;
          activeSession.questions = activeSession.questions || [];
          activeSession.questions.push({ ...payload, result: 'correct' });
        }
        break;
      }

      // ── Questão errada ─────────────────────────────────────────────────────
      case 'QUESTION_WRONG': {
        const payload = msg.payload || {};
        const today = await updateTodayStats({ erros: 1 });
        await updateQuestionBank(payload, 'wrong');
        if (payload.materia) await updateSubjectStats(payload.materia, 0, 1, payload.assunto);
        await addToWrongBank(payload);
        if (payload.qid) hubSchedule(payload, 1);
        // Busca questões similares em segundo plano (não bloqueia a resposta)
        if (payload.qid) {
          findSimilarQuestions(payload).then(async similar => {
            if (!similar.length) return;
            const wb = await loadWrongBank();
            if (wb[payload.qid]) {
              wb[payload.qid].relatedQuestions = similar;
              await setStorage({ wrongBank: wb });
              // Notifica se há questões críticas similares
              const criticals = similar.filter(s => s.importance === 3 || s.erros >= 2);
              if (criticals.length > 0) {
                const settings = await getSettings();
                if (settings.notifications !== false) {
                  showNotification(
                    `📎 ${similar.length} questão(ões) similar(es) encontrada(s)`,
                    `"${(payload.desc||payload.assunto||'').slice(0,60)}" — abra o popup para ver o bloco`,
                    'sim-found-' + payload.qid
                  );
                }
              }
            }
          }).catch(() => {});
        }
        const due = await getDueReviews();
        updateBadge(due.length + hubQueue.length);
        _ensureHourlyDay(); const _h2 = new Date().getHours(); hourlyStats[_h2].q++;
        updateArticleCoverage(payload, 'wrong').catch(() => {});
        updateConfusionPatterns(payload).catch(() => {});
        // Enriquecimento semântico via Claude API (se configurado)
        if (payload.qid && (payload.desc || payload.enunciado)) {
          getSettings().then(async s => {
            if (!s.claudeApiKey) return;
            const concepts = await callClaudeForConcepts(payload.desc || payload.enunciado, s.claudeApiKey);
            if (!concepts) return;
            const wb = await loadWrongBank();
            if (wb[payload.qid]) {
              wb[payload.qid].semanticConcepts = concepts;
              await setStorage({ wrongBank: wb });
            }
          }).catch(() => {});
        }
        if (activeSession) {
          activeSession.erros = (activeSession.erros || 0) + 1;
          activeSession.questions = activeSession.questions || [];
          activeSession.questions.push({ ...payload, result: 'wrong' });
        }
        break;
      }

      // ── Início de sessão ───────────────────────────────────────────────────
      case 'SESSION_START': {
        const payload = msg.payload || {};
        activeSession = {
          id:        Date.now().toString(),
          date:      todayKey(),
          startTime: Date.now(),
          caderno:   payload.caderno  || '',
          materia:   payload.materia  || '',
          totalQ:    payload.totalQ   || 0,
          acertos:   0,
          erros:     0,
          questions: [],
        };
        // Auto-inicia cronômetro ao começar sessão
        if (!timer.running) timerStart();
        // Pré-alerta: verifica se há erros pendentes da mesma matéria/assunto
        if (payload.materia || payload.assunto) {
          getDueReviews().then(async dueList => {
            const related = dueList.filter(q =>
              (payload.materia && q.materia === payload.materia) ||
              (payload.assunto && q.assunto === payload.assunto)
            );
            if (related.length > 0) {
              const settings = await getSettings();
              if (settings.notifications !== false) {
                showNotification(
                  `⚠️ ${related.length} revisão(ões) pendente(s)`,
                  `Você tem erros de ${payload.materia || payload.assunto} para revisar antes de continuar.`,
                  'pf-prealert-' + Date.now()
                );
              }
              // Guarda para exibir no popup
              activeSession._preAlert = {
                count: related.length,
                materia: payload.materia || payload.assunto,
                items: related.slice(0, 3).map(q => ({ qid: q.qid, desc: q.desc, assunto: q.assunto })),
              };
            }
          }).catch(() => {});
        }
        break;
      }

      // ── Fim de sessão (caderno concluído) ──────────────────────────────────
      case 'SESSION_END': {
        const payload = msg.payload || {};
        if (activeSession) {
          activeSession.endTime  = Date.now();
          activeSession.elapsed  = timerGetElapsed();
          if (payload.stats) {
            activeSession.acertos = payload.stats.correct || activeSession.acertos;
            activeSession.erros   = payload.stats.wrong   || activeSession.erros;
          }
          await saveSessions({ ...activeSession });
          await updateGlobalStats(activeSession.acertos, activeSession.erros);
          timerReset();
          activeSession = null;
        }
        break;
      }

      // ── Huberman: acertou → avança fase ───────────────────────────────────
      case 'HUBERMAN_CORRECT': {
        const result = hubAdvancePhase(msg.qid);
        if (result === 'done') {
          showNotification('🧠 Revisão Huberman concluída!',
            'Questão dominada nas 3 fases. Agora no SM-2 de longo prazo.', 'hub-done-' + msg.qid);
        }
        const due2 = await getDueReviews();
        updateBadge(due2.length + hubQueue.length);
        sendResponse({ hub: hubGetStatus() });
        return;
      }

      // ── Huberman: errou → reinicia fase 1 ─────────────────────────────────
      case 'HUBERMAN_WRONG': {
        hubResetPhase(msg.qid);
        const due3 = await getDueReviews();
        updateBadge(due3.length + hubQueue.length);
        sendResponse({ hub: hubGetStatus() });
        return;
      }

      // ── Huberman: intervalo customizado ───────────────────────────────────
      case 'HUBERMAN_CUSTOM': {
        const idx = hubQueue.findIndex(h => h.qid === msg.qid);
        const base = idx >= 0 ? hubQueue[idx] : { qid: msg.qid, url: msg.url || '', materia: '', assunto: '', desc: 'Questão #' + msg.qid };
        if (idx >= 0) hubQueue.splice(idx, 1);
        const mins = Math.max(1, parseInt(msg.mins) || 5);
        hubSchedule(base, (base.phase || 1), mins);
        sendResponse({ hub: hubGetStatus() });
        return;
      }

      // ── Huberman: retorna fila atual ───────────────────────────────────────
      case 'HUBERMAN_GET':
        sendResponse({ hub: hubGetStatus() });
        return;

      // ── Huberman: descarta item da fila ───────────────────────────────────
      case 'HUBERMAN_DISMISS': {
        const di = hubQueue.findIndex(h => h.qid === msg.qid);
        if (di >= 0) { hubQueue.splice(di, 1); chrome.alarms.clear(hubAlarmName(msg.qid)); }
        sendResponse({ hub: hubGetStatus() });
        return;
      }

      // ── Cronômetro: controles ──────────────────────────────────────────────
      case 'TIMER_START':
        timerStart();
        sendResponse(timerSnapshot());
        return;

      case 'TIMER_PAUSE':
        timerPause();
        sendResponse(timerSnapshot());
        return;

      case 'TIMER_RESET':
        timerReset();
        sendResponse(timerSnapshot());
        return;

      case 'TIMER_GET':
        sendResponse(timerSnapshot());
        return;

      // ── Badge ──────────────────────────────────────────────────────────────
      case 'UPDATE_BADGE':
        updateBadge(msg.filaCount || 0);
        break;

      // ── Relay TEC → Painel ─────────────────────────────────────────────────
      case 'RELAY_TO_PANEL':
        await relayToPanel(msg.payload);
        break;

      // ── Relay Painel → TEC ─────────────────────────────────────────────────
      case 'RELAY_TO_TEC':
        await relayToTec(msg.payload);
        break;

      // ── Notificação desktop ────────────────────────────────────────────────
      case 'SHOW_NOTIFICATION':
        showNotification(msg.title, msg.message, msg.id);
        break;

      // ── Pomodoro ───────────────────────────────────────────────────────────
      case 'POMODORO_START':
        pomodoroStart();
        sendResponse(pomodoroSnapshot());
        return;

      case 'POMODORO_STOP':
        pomodoroStop();
        sendResponse(pomodoroSnapshot());
        return;

      case 'POMODORO_SKIP':
        pomodoroSkip();
        sendResponse(pomodoroSnapshot());
        return;

      case 'POMODORO_GET':
        sendResponse(pomodoroSnapshot());
        return;

      // ── Simulado automático com erros ──────────────────────────────────────
      case 'GET_SIMULADO': {
        const allBank = await loadWrongBank();
        const sorted = Object.values(allBank)
          .sort((a, b) => (b.errorCount || 0) - (a.errorCount || 0))
          .slice(0, 10)
          .map(q => ({ qid: q.qid, url: q.url, materia: q.materia, assunto: q.assunto, desc: q.desc }));
        sendResponse({ questions: sorted });
        return;
      }

      // ── Popup: solicita dados completos ────────────────────────────────────
      // ── Busca de questões similares sob demanda ───────────────────────────
      case 'FIND_SIMILAR': {
        const similar = await findSimilarQuestions(msg.payload || {}, msg.limit || 5);
        sendResponse({ similar });
        return;
      }

      // ── Timer Huberman manual (5/9/11min) ─────────────────────────────────
      case 'MANUAL_HUB_START': {
        const mins = Math.max(1, Math.min(120, msg.mins || 5));
        manualHubTimer = { running: true, label: msg.label || (mins + ' min'), totalSecs: mins * 60, startTs: Date.now() };
        chrome.alarms.clear(MAN_HUB_ALARM);
        chrome.alarms.create(MAN_HUB_ALARM, { delayInMinutes: mins });
        sendResponse({ ok: true, timer: manualHubSnapshot() });
        return;
      }
      case 'MANUAL_HUB_CANCEL': {
        chrome.alarms.clear(MAN_HUB_ALARM);
        manualHubTimer.running = false;
        sendResponse({ ok: true });
        return;
      }
      case 'MANUAL_HUB_GET': {
        sendResponse(manualHubSnapshot());
        return;
      }
      // ── Resultado de revisão Huberman manual ──────────────────────────────
      case 'HUB_REVIEW_RESULT': {
        const stored = (await new Promise(r => chrome.storage.local.get('pf_hub_reviews', r)))['pf_hub_reviews'] || [];
        stored.push({ ts: Date.now(), label: msg.label || '', remembered: !!msg.remembered });
        if (stored.length > 300) stored.splice(0, stored.length - 300);
        await new Promise(r => chrome.storage.local.set({ pf_hub_reviews: stored }, r));
        sendResponse({ ok: true });
        return;
      }

      case 'GET_POPUP_DATA': {
        const [todayStats, globalStats, wrongBank, sessions, subjectStats, settings, dueReviews, weekStats, questionBank, artCovStored, confStored] = await Promise.all([
          getTodayStats(),
          loadStats(),
          loadWrongBank(),
          getSessions(20),
          getSubjectStats(),
          getSettings(),
          getDueReviews(),
          getWeekStats(),
          loadQuestionBank(),
          new Promise(r => chrome.storage.local.get('pf_article_coverage', r)),
          new Promise(r => chrome.storage.local.get('pf_confusion_patterns', r)),
        ]);
        const qbItems = Object.values(questionBank);
        const articleCoverage = artCovStored['pf_article_coverage'] || {};
        const confusionPatterns = Object.values(confStored['pf_confusion_patterns'] || {})
          .filter(p => p.count >= 3)
          .sort((a, b) => b.count - a.count)
          .slice(0, 10);
        const clusteredReviews = clusterDueReviews(dueReviews);
        sendResponse({
          todayStats,
          globalStats,
          wrongBankSize: Object.keys(wrongBank).length,
          sessions,
          subjectStats,
          settings,
          dueReviews,
          clusteredReviews,
          filaCount,
          panelTabId,
          tecTabId,
          activeSession,
          timer: timerSnapshot(),
          hubQueue: hubGetStatus(),
          weekStats,
          pomodoro: pomodoroSnapshot(),
          hourlyStats,
          manualHubTimer: manualHubSnapshot(),
          recentResults: activeSession ? (activeSession.questions || []).slice(-10).map(q => q.result) : [],
          preAlert: activeSession?._preAlert || null,
          articleCoverage,
          confusionPatterns,
          questionBankStats: {
            total: qbItems.length,
            dominadas: qbItems.filter(q => q.importance === 1).length,
            atencao: qbItems.filter(q => q.importance === 2).length,
            criticas: qbItems.filter(q => q.importance === 3).length,
          },
        });
        return;
      }

      // ── Content: contagem leve de revisões pendentes (usado pelo widget TEC) ──
      case 'GET_DUE_COUNT': {
        const due = await getDueReviews();
        sendResponse({ dueCount: due.length, hubCount: hubQueue.length });
        return;
      }

      // ── Popup: solicita dados de análise avançada ─────────────────────────
      case 'GET_ANALISE_DATA': {
        const [artCov, confPatt, settings2] = await Promise.all([
          new Promise(r => chrome.storage.local.get('pf_article_coverage', r)),
          new Promise(r => chrome.storage.local.get('pf_confusion_patterns', r)),
          getSettings(),
        ]);
        const topWeak = {};
        const covData = artCov['pf_article_coverage'] || {};
        for (const [mat, refs] of Object.entries(covData)) {
          const ranked = Object.entries(refs)
            .map(([ref, v]) => ({ ref, ...v, total: v.correct + v.wrong, pct: v.correct + v.wrong > 0 ? Math.round(v.correct / (v.correct + v.wrong) * 100) : 0 }))
            .filter(r => r.total > 0)
            .sort((a, b) => a.pct - b.pct || b.total - a.total);
          if (ranked.length) topWeak[mat] = ranked.slice(0, 10);
        }
        const confusions = Object.values(confPatt['pf_confusion_patterns'] || {})
          .filter(p => p.count >= 2)
          .sort((a, b) => b.count - a.count)
          .slice(0, 20);
        // Try Claude semantic enhancement if API key is set
        sendResponse({ topWeak, confusions, apiKeySet: !!(settings2.claudeApiKey) });
        return;
      }

      // ── Popup: chama Claude para conceitos de questão ──────────────────────
      case 'GET_SEMANTIC_CONCEPTS': {
        const settings3 = await getSettings();
        const concepts = await callClaudeForConcepts(msg.text, settings3.claudeApiKey);
        sendResponse({ concepts });
        return;
      }

      // ── Popup: marca questão como revisada ────────────────────────────────
      case 'REVIEW_QUESTION': {
        await reviewWrongQuestion(msg.qid, msg.quality || 4);
        const due = await getDueReviews();
        updateBadge(due.length);
        sendResponse({ ok: true, dueReviews: due });
        return;
      }

      // ── Popup: exporta repositório de questões ────────────────────────────
      case 'EXPORT_QUESTION_BANK': {
        const qb = await loadQuestionBank();
        sendResponse({ bank: Object.values(qb) });
        return;
      }

      // ── Popup: stats do repositório de questões ───────────────────────────
      case 'GET_QUESTION_BANK_STATS': {
        const qb = await loadQuestionBank();
        const items = Object.values(qb);
        sendResponse({
          total: items.length,
          dominadas: items.filter(q => q.importance === 1).length,
          atencao: items.filter(q => q.importance === 2).length,
          criticas: items.filter(q => q.importance === 3).length,
        });
        return;
      }

      // ── Popup: exporta banco de erros ─────────────────────────────────────
      case 'EXPORT_WRONG': {
        const bank = await loadWrongBank();
        sendResponse({ bank: Object.values(bank) });
        return;
      }

      // ── Popup: salva configurações ────────────────────────────────────────
      case 'SAVE_SETTINGS':
        await setStorage({ settings: msg.settings });
        sendResponse({ ok: true });
        return;

      // ── Reforço Inteligente: salva/retorna alvo de filtro ────────────────
      case 'SET_REFORCO_TARGET':
        await setStorage({ reforco_target: msg.data });
        sendResponse({ ok: true });
        return;

      case 'GET_REFORCO_TARGET': {
        const { reforco_target = null } = await getStorage({ reforco_target: null });
        sendResponse({ data: reforco_target });
        return;
      }

      // ── Ranking TEC: salva dados do scraper ──────────────────────────────
      case 'SAVE_TEC_RANKING':
        await setStorage({ tec_ranking: msg.data });
        sendResponse({ ok: true });
        return;

      // ── Ranking TEC: retorna dados para o painel ──────────────────────────
      case 'GET_TEC_RANKING': {
        const { tec_ranking = null } = await getStorage({ tec_ranking: null });
        sendResponse({ data: tec_ranking });
        return;
      }

      // ── TEC API: salva/retorna endpoint descoberto pelo MAIN world script ──
      case 'STORE_TEC_API': {
        const stored = { base: msg.base, full: msg.full, items: msg.schema || null, storedAt: Date.now() };
        await setStorage({ tec_api_info: stored });
        // Se veio da aba de busca em background, salva separadamente
        if (_bgSearchTabId && sender.tab?.id === _bgSearchTabId && msg.schema?.length) {
          await setStorage({ tec_api_info_bg: stored });
        }
        sendResponse({ ok: true });
        return;
      }
      case 'GET_TEC_API': {
        const { tec_api_info = null } = await getStorage({ tec_api_info: null });
        sendResponse({ data: tec_api_info });
        return;
      }

      // ── Abre TEC em background tab, aguarda render Angular, extrai questões ─
      case 'FIND_SIMILAR_TAB': {
        const filterUrl = msg.url;
        const excludeQid = String(msg.qid || '');
        const materia = (msg.materia || '').toLowerCase();

        if (!filterUrl || !filterUrl.includes('tecconcursos')) {
          sendResponse({ similares: [] });
          return;
        }
        try {
          // Limpa dado anterior da aba de busca
          await setStorage({ tec_api_info_bg: null });

          const tab = await new Promise(r => chrome.tabs.create({ url: filterUrl, active: false }, r));
          _bgSearchTabId = tab.id;

          // Aguarda Angular carregar e content_main.js interceptar as chamadas API (~7s)
          await new Promise(r => setTimeout(r, 7000));

          const similares = [];
          const seen = new Set(excludeQid ? [excludeQid] : []);

          // — Estratégia 1: dados capturados pelo content_main.js via intercept de fetch/XHR
          const { tec_api_info_bg = null } = await getStorage({ tec_api_info_bg: null });
          if (tec_api_info_bg?.items?.length) {
            for (const q of tec_api_info_bg.items) {
              if (!q.id || seen.has(q.id)) continue;
              seen.add(q.id);
              similares.push({
                qid: q.id,
                url: `https://www.tecconcursos.com.br/questoes/${q.id}`,
                label: q.enunciado || 'Questão #' + q.id,
                materia: q.materia, assunto: q.assunto, banca: q.banca,
                source: 'api-bg',
              });
              if (similares.length >= 6) break;
            }
          }

          // — Estratégia 2: scraping do DOM (fallback quando API não foi capturada)
          if (similares.length < 3) {
            try {
              const results = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: (excludeQid, materia) => {
                  // Tenta ler dados do window que content.js possa ter populado
                  const seen = new Set(excludeQid ? [excludeQid] : []);
                  const found = [];
                  // Linka questões individuais: /questoes/ID
                  const links = [...document.querySelectorAll('a[href]')];
                  for (const a of links) {
                    const m = (a.href || '').match(/\/questoes\/(\d{5,9})(?:\/|$|\?)/);
                    if (!m || seen.has(m[1])) continue;
                    seen.add(m[1]);
                    const row = a.closest('[class*="questao"],[class*="item"],[class*="card"],[class*="list"],[class*="row"]') || a.parentElement;
                    const rowText = (row?.innerText || a.textContent || '').toLowerCase();
                    if (materia && rowText.length > 20 && !rowText.includes(materia.slice(0, 6))) continue;
                    found.push({
                      qid: m[1],
                      url: `https://www.tecconcursos.com.br/questoes/${m[1]}`,
                      label: (row?.innerText || '').trim().slice(0, 120) || 'Questão #' + m[1],
                    });
                    if (found.length >= 6) break;
                  }
                  return found;
                },
                args: [excludeQid, materia],
              });
              for (const q of (results?.[0]?.result || [])) {
                if (!seen.has(q.qid)) { seen.add(q.qid); similares.push(q); }
                if (similares.length >= 6) break;
              }
            } catch (_) {}
          }

          _bgSearchTabId = null;
          await chrome.tabs.remove(tab.id).catch(() => {});
          sendResponse({ similares });
        } catch (_) {
          _bgSearchTabId = null;
          sendResponse({ similares: [] });
        }
        return;
      }

      // ── Status geral ──────────────────────────────────────────────────────
      case 'GET_STATUS':
        sendResponse({ filaCount, panelTabId, tecTabId });
        return;

      // ── Fila para o content script ────────────────────────────────────────
      case 'GET_FILA': {
        const due = await getDueReviews();
        updateBadge(due.length);
        break;
      }
    }
  })();

  return true; // mantém canal aberto para sendResponse assíncrono
});

// ════════════════════════════════════════════════════════
// EVENTOS DE ABAS
// ════════════════════════════════════════════════════════

chrome.tabs.onRemoved.addListener(tabId => {
  if (tabId === tecTabId)   tecTabId   = null;
  if (tabId === panelTabId) panelTabId = null;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab.url) return;
  if (tab.url.includes('tecconcursos.com.br'))               tecTabId   = tabId;
  if (tab.url.includes('cazuzaleo89-netizen.github.io'))      panelTabId = tabId;
});

// ════════════════════════════════════════════════════════
// APÓS INSTALAR: injeta content.js em abas TEC abertas
// ════════════════════════════════════════════════════════

chrome.runtime.onInstalled.addListener(async () => {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.url && tab.url.includes('tecconcursos.com.br') && tab.id) {
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
        tecTabId = tab.id;
      } catch { /* */ }
    }
  }

  // Alarme diário para lembrete de revisão
  chrome.alarms.create('daily-review-check', { periodInMinutes: 60 });
});

// ════════════════════════════════════════════════════════
// ALARME DIÁRIO
// ════════════════════════════════════════════════════════

chrome.alarms.onAlarm.addListener(async alarm => {

  // ── Huberman manual: timer concluído ─────────────────────────────────────
  if (alarm.name === MAN_HUB_ALARM) {
    const lbl = manualHubTimer.label || 'Revisão';
    manualHubTimer.running = false;
    showNotification('🧠 Revisão Huberman Manual', `Hora de revisar! ${lbl} concluídos.`, 'hub-manual-done');
    return;
  }

  // ── Huberman: alarme de revisão disparou ──────────────────────────────────
  if (alarm.name.startsWith('hub-')) {
    const qid  = alarm.name.slice(4);
    const item = hubQueue.find(h => h.qid === qid);
    if (!item) return;

    const settings = await getSettings();
    if (settings.notifications !== false) {
      const label = item.customMins != null
        ? `Intervalo custom ${item.customMins}min`
        : `Fase ${item.phase} de 3 · ${HUB_PHASES[item.phase - 1]}min`;
      showNotification(
        `🧠 Revisão Huberman — ${label}`,
        item.desc || 'Questão #' + item.qid,
        'hub-due-' + qid
      );
    }

    const due = await getDueReviews();
    updateBadge(due.length + hubQueue.length);
    await hubNotifyTec(item);
    return;
  }

  // ── Alarme diário SM-2 ────────────────────────────────────────────────────
  if (alarm.name !== 'daily-review-check') return;
  const due = await getDueReviews();
  updateBadge(due.length + hubQueue.length);
  if (due.length > 0) {
    const settings = await getSettings();
    if (settings.notifications !== false) {
      showNotification('📋 Revisões pendentes', `Você tem ${due.length} questão${due.length > 1 ? 'ões' : ''} para revisar hoje.`, 'pf-daily');
    }
  }
});

// ── Clique na notificação → foca aba TEC ──────────────────────────────────────
chrome.notifications.onClicked.addListener(async () => {
  const tab = tecTabId ? { id: tecTabId } : await findTecTab();
  if (!tab) return;
  chrome.tabs.update(tab.id, { active: true });
  const win = await chrome.windows.get(tab.windowId).catch(() => null);
  if (win) chrome.windows.update(win.id, { focused: true });
});
