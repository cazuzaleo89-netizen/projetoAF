document.addEventListener('DOMContentLoaded', () => {

const PANEL_URL = 'https://cazuzaleo89-netizen.github.io/projetoAF/';
const TEC_ORIGIN = 'tecconcursos.com.br';

// ── Dados carregados ────────────────────────────────────────────────────────
let appData = null;
let cfgSettings = { dailyGoal: 30, notifications: true, autoReveal: true, targetRate: 70 };
let popTimerRunning = false;
let popTimerElapsed = 0;
let popTimerLocal = null;

// ── Pomodoro local state ─────────────────────────────────────────────────────
let pomData = { active: false, state: 'work', count: 0, remaining: 0, workMins: 25, breakMins: 5, longBreakMins: 15 };
let pomTickInterval = null;

// ── Cronômetro no popup ─────────────────────────────────────────────────────
function fmtTimer(secs) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const pad = n => String(n).padStart(2, '0');
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function popTimerTick() {
  if (popTimerRunning) popTimerElapsed++;
  const val = document.getElementById('pop-timer-val');
  const dot = document.getElementById('pop-timer-dot');
  const tog = document.getElementById('pop-timer-tog');
  if (val) val.textContent = fmtTimer(popTimerElapsed);
  if (dot) { dot.style.background = popTimerRunning ? '#22c55e' : '#374151'; dot.style.boxShadow = popTimerRunning ? '0 0 6px #22c55e' : 'none'; }
  if (tog) tog.textContent = popTimerRunning ? '⏸' : '▶';
}

function initPopTimer(timerData) {
  if (!timerData) return;
  popTimerElapsed = timerData.elapsed || 0;
  popTimerRunning = !!timerData.running;
  if (popTimerLocal) clearInterval(popTimerLocal);
  popTimerLocal = setInterval(popTimerTick, 1000);
  popTimerTick();
}

function popTimerToggle() {
  const action = popTimerRunning ? 'TIMER_PAUSE' : 'TIMER_START';
  chrome.runtime.sendMessage({ type: action }, resp => {
    if (resp) { popTimerElapsed = resp.elapsed || 0; popTimerRunning = !!resp.running; popTimerTick(); }
  });
  popTimerRunning = !popTimerRunning;
  popTimerTick();
}

function popTimerReset() {
  if (!confirm('Zerar cronômetro?')) return;
  chrome.runtime.sendMessage({ type: 'TIMER_RESET' }, resp => {
    popTimerElapsed = 0; popTimerRunning = false; popTimerTick();
  });
}

// ── Abas ────────────────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('panel-' + tab.dataset.tab).classList.add('active');
    if (tab.dataset.tab === 'revisao' && appData) renderRevisao(appData);
    if (tab.dataset.tab === 'historico' && appData) renderHistorico(appData);
    if (tab.dataset.tab === 'analise' && appData) renderAnalise(appData);
  });
});

// ── Utilitários ─────────────────────────────────────────────────────────────
async function findTab(origin) {
  try {
    const all = await Promise.race([
      chrome.tabs.query({}),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 1000)),
    ]);
    return all.find(t => t.url && t.url.includes(origin)) || null;
  } catch { return null; }
}

async function pingContent(tabId) {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(null), 700);
    try {
      chrome.tabs.sendMessage(tabId, { type: 'PING' }, resp => {
        clearTimeout(timer);
        resolve(resp || null);
      });
    } catch { clearTimeout(timer); resolve(null); }
  });
}

function fmt(n) { return (n || 0).toString(); }
function pct(a, t) { return t > 0 ? Math.round(a / t * 100) : 0; }

function fmtDate(isoDate) {
  if (!isoDate) return '—';
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
}

function fmtElapsed(secs) {
  if (!secs) return '—';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function accColor(rate) {
  if (rate >= 70) return '#22c55e';
  if (rate >= 50) return '#f59e0b';
  return '#ef4444';
}

// ── Alerta de fadiga ─────────────────────────────────────────────────────────
function renderFatigueAlert(recentResults, todayStats) {
  const el = document.getElementById('fatigue-alert-pop');
  if (!el) return;
  const total = (todayStats.acertos || 0) + (todayStats.erros || 0);
  if (total < 6 || !recentResults || recentResults.length < 5) { el.style.display = 'none'; return; }
  const overall = (todayStats.acertos || 0) / total;
  const last5 = recentResults.slice(-5);
  const recentRate = last5.filter(r => r === 'correct').length / 5;
  if (overall >= 0.58 && recentRate <= 0.35) {
    el.textContent = `⚠️ Queda de rendimento — últimas 5 questões: ${Math.round(recentRate * 100)}% acerto (geral: ${Math.round(overall * 100)}%). Pause 5-10 min. [×]`;
    el.style.display = 'block';
  } else {
    el.style.display = 'none';
  }
}

// ── Gráfico por hora do dia ───────────────────────────────────────────────────
let _hrPopMode = 'q';
function hrPopMode(mode) {
  _hrPopMode = mode;
  document.getElementById('hr-btn-q').style.background    = mode === 'q'    ? 'rgba(74,108,247,.15)' : 'transparent';
  document.getElementById('hr-btn-q').style.color         = mode === 'q'    ? '#6366f1' : '#475569';
  document.getElementById('hr-btn-rate').style.background = mode === 'rate' ? 'rgba(74,108,247,.15)' : 'transparent';
  document.getElementById('hr-btn-rate').style.color      = mode === 'rate' ? '#6366f1' : '#475569';
  if (appData) renderHourlyChart(appData.hourlyStats);
}

function renderHourlyChart(hourlyStats) {
  const el  = document.getElementById('pop-hourly-chart');
  const ins = document.getElementById('pop-hourly-insight');
  if (!el || !hourlyStats) return;

  // Only show hours 5–23
  const buckets = [];
  for (let h = 5; h <= 23; h++) {
    const b = hourlyStats[h] || { q: 0, ace: 0 };
    buckets.push({ h, q: b.q, rate: b.q > 0 ? Math.round(b.ace / b.q * 100) : null });
  }

  const isRate = _hrPopMode === 'rate';
  const vals   = buckets.map(b => isRate ? (b.rate !== null ? b.rate : 0) : b.q);
  const maxVal = isRate ? 100 : Math.max(...vals, 1);
  const H = 42;

  let html = `<div style="display:flex;align-items:flex-end;gap:1px;height:${H}px;">`;
  buckets.forEach((b, i) => {
    const v   = vals[i];
    const pct = maxVal > 0 ? Math.max(v / maxVal, v > 0 ? 0.05 : 0) : 0;
    const hPx = Math.round(pct * H);
    const col = isRate
      ? (b.rate !== null ? (b.rate >= 70 ? '#22c55e' : b.rate >= 50 ? '#f59e0b' : '#ef4444') : 'rgba(255,255,255,.04)')
      : '#4a6cf7';
    const hasData = isRate ? b.rate !== null : v > 0;
    const tip = isRate ? `${b.h}h: ${b.rate !== null ? b.rate + '%' : '—'}` : `${b.h}h: ${v}q`;
    html += `<div style="display:flex;flex-direction:column;align-items:center;flex:1;gap:1px;" title="${tip}">
      <div style="width:100%;border-radius:2px 2px 0 0;height:${hPx}px;background:${hasData ? col : 'rgba(255,255,255,.04)'};"></div>
      <div style="font-size:6px;color:#374151;font-family:monospace;">${b.h}</div>
    </div>`;
  });
  html += '</div>';
  el.innerHTML = html;

  if (ins) {
    if (isRate) {
      const valid = buckets.filter(b => b.rate !== null && b.q >= 2);
      if (valid.length) {
        const best = valid.reduce((a, b) => b.rate > a.rate ? b : a, valid[0]);
        ins.textContent = `Melhor aproveitamento: ${best.h}h (${best.rate}%)`;
      } else ins.textContent = 'Resolva mais questões para ver análise';
    } else {
      const best = buckets.reduce((a, b) => b.q > a.q ? b : a, buckets[0]);
      ins.textContent = best.q > 0 ? `Hora mais produtiva hoje: ${best.h}h (${best.q} questões)` : 'Sem questões registradas hoje';
    }
  }
}

// ── Timer Huberman Manual ─────────────────────────────────────────────────────
let _manHubLabel = '';
let _manHubLocal = null;  // interval para countdown local no popup

function manHubStart(mins, label) {
  if (!mins || isNaN(mins) || mins < 1) return;
  _manHubLabel = label || (mins + ' min');
  chrome.runtime.sendMessage({ type: 'MANUAL_HUB_START', mins, label: _manHubLabel }, resp => {
    if (resp && resp.ok) {
      document.getElementById('man-hub-result').style.display = 'none';
      renderManHubTimer(resp.timer);
      clearInterval(_manHubLocal);
      _manHubLocal = setInterval(() => {
        chrome.runtime.sendMessage({ type: 'MANUAL_HUB_GET' }, t => { if (t) renderManHubTimer(t); });
      }, 1000);
    }
  });
}

function manHubCancel() {
  clearInterval(_manHubLocal);
  chrome.runtime.sendMessage({ type: 'MANUAL_HUB_CANCEL' }, () => {
    document.getElementById('man-hub-active').style.display = 'none';
    document.getElementById('man-hub-result').style.display = 'none';
  });
}

function manHubResult(remembered) {
  chrome.runtime.sendMessage({ type: 'HUB_REVIEW_RESULT', label: _manHubLabel, remembered }, () => {});
  document.getElementById('man-hub-result').style.display = 'none';
  // Pequeno flash visual
  const active = document.getElementById('man-hub-active');
  if (active) active.style.display = 'none';
}

function renderManHubTimer(t) {
  const activeEl = document.getElementById('man-hub-active');
  const resultEl = document.getElementById('man-hub-result');
  if (!activeEl) return;
  if (!t || !t.running) {
    if (t && t.running === false && _manHubLocal) {
      // Timer terminou
      clearInterval(_manHubLocal); _manHubLocal = null;
      activeEl.style.display = 'none';
      if (resultEl) resultEl.style.display = 'block';
    }
    return;
  }
  activeEl.style.display = 'flex';
  const lbl  = document.getElementById('man-hub-lbl');
  const disp = document.getElementById('man-hub-display');
  const m    = Math.floor(t.remaining / 60);
  const s    = t.remaining % 60;
  if (lbl)  lbl.textContent  = t.label || '';
  if (disp) disp.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  // Detectar conclusão
  if (t.remaining === 0) {
    clearInterval(_manHubLocal); _manHubLocal = null;
    activeEl.style.display = 'none';
    if (resultEl) resultEl.style.display = 'block';
  }
}

// ── Gráfico semanal ──────────────────────────────────────────────────────────
function renderWeekChart(weekStats) {
  const el = document.getElementById('week-chart');
  if (!el) return;
  if (!weekStats || !weekStats.length) { el.innerHTML = ''; return; }

  const W = 340, H = 100, padL = 6, padR = 6, padT = 8, padB = 28;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;
  const maxResolved = Math.max(1, ...weekStats.map(d => d.resolved));
  const barW = Math.floor(chartW / 7) - 4;

  let bars = '';
  let labels = '';
  weekStats.forEach((d, i) => {
    const x = padL + i * (chartW / 7) + (chartW / 7 - barW) / 2;
    const barH = d.resolved > 0 ? Math.max(4, Math.round((d.resolved / maxResolved) * chartH)) : 2;
    const y = padT + chartH - barH;
    const color = d.resolved === 0 ? '#20243a' : d.taxa >= 70 ? '#22c55e' : d.taxa >= 50 ? '#f59e0b' : '#ef4444';
    const isToday = i === weekStats.length - 1;
    const stroke = isToday ? 'stroke="#818cf8" stroke-width="1.5"' : '';
    bars += `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" rx="3" fill="${color}" opacity="${d.resolved === 0 ? 0.3 : 0.85}" ${stroke}>
      <title>${d.date}: ${d.resolved} questões · ${d.taxa}% acertos</title>
    </rect>`;
    if (d.resolved > 0) {
      bars += `<text x="${x + barW / 2}" y="${y - 3}" text-anchor="middle" font-size="8" fill="${color}" font-weight="700">${d.resolved}</text>`;
    }
    const lx = x + barW / 2;
    const ly = H - 6;
    const labelColor = isToday ? '#818cf8' : '#475569';
    labels += `<text x="${lx}" y="${ly}" text-anchor="middle" font-size="9" fill="${labelColor}" font-weight="${isToday ? '800' : '600'}">${d.label}</text>`;
  });

  el.innerHTML = `
    <div class="wc-title">DESEMPENHO SEMANAL</div>
    <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="display:block;overflow:visible;">
      <line x1="${padL}" y1="${padT + chartH}" x2="${W - padR}" y2="${padT + chartH}" stroke="#20243a" stroke-width="1"/>
      ${bars}
      ${labels}
    </svg>`;
}

// ── Pomodoro ─────────────────────────────────────────────────────────────────
function fmtPomTime(secs) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

function pomodoroTick() {
  if (pomData.active && pomData.remaining > 0) pomData.remaining--;
  const stateEl = document.getElementById('pom-state-lbl');
  const timeEl  = document.getElementById('pom-time-val');
  const togBtn  = document.getElementById('pom-tog');
  const countEl = document.getElementById('pom-count');
  if (stateEl) stateEl.textContent = pomData.state === 'work' ? 'TRABALHO' : pomData.state === 'longBreak' ? 'PAUSA LONGA' : 'PAUSA';
  if (timeEl) timeEl.textContent = fmtPomTime(pomData.active ? pomData.remaining : (pomData.workMins || 25) * 60);
  if (togBtn) togBtn.textContent = pomData.active ? '⏸ Pausar' : '▶ Iniciar';
  if (countEl) countEl.textContent = pomData.count;
}

function initPomodoro(data) {
  if (!data) return;
  pomData = { ...pomData, ...data };
  if (pomTickInterval) clearInterval(pomTickInterval);
  if (pomData.active) {
    pomTickInterval = setInterval(pomodoroTick, 1000);
  }
  pomodoroTick();
}

// ── Ranking de prioridade ─────────────────────────────────────────────────────
function renderPriorityList(subjects) {
  const el = document.getElementById('priority-list');
  if (!el) return;
  if (!subjects || subjects.length < 2) { el.innerHTML = ''; return; }

  const withRate = subjects.map(s => ({ ...s, erroRate: s.total > 0 ? Math.round(s.erros / s.total * 100) : 0 }));
  withRate.sort((a, b) => b.erroRate - a.erroRate);

  const top3 = withRate.slice(0, Math.min(3, withRate.length));
  // Best = highest accuracy = lowest error rate among those with questions
  const best = [...withRate].reverse().find(s => s.total > 0);

  let html = '<div class="pri-title">RANKING DE MATÉRIAS</div>';

  top3.forEach(s => {
    html += `<div class="pri-row">
      <span class="pri-badge atencao">⚠ Atenção</span>
      <span class="pri-name">${s.materia}</span>
      <span class="pri-pct" style="color:#ef4444">${s.erroRate}% erros</span>
    </div>`;
  });

  if (best && !top3.find(s => s.materia === best.materia)) {
    const acc = best.total > 0 ? Math.round(best.acertos / best.total * 100) : 0;
    html += `<div class="pri-row">
      <span class="pri-badge dominando">✓ Dominando</span>
      <span class="pri-name">${best.materia}</span>
      <span class="pri-pct" style="color:#22c55e">${acc}% acertos</span>
    </div>`;
  }

  el.innerHTML = html;
}

// ── Aprovação bar ─────────────────────────────────────────────────────────────
function renderAprovacao(todayStats, settings) {
  const el = document.getElementById('aprovacao-bar');
  if (!el) return;
  const resolved = todayStats.resolved || 0;
  if (resolved === 0) { el.innerHTML = ''; return; }

  const target = (settings && settings.targetRate) || 70;
  const taxa = pct(todayStats.acertos || 0, resolved);
  const fillPct = Math.min(100, Math.round(taxa / target * 100));
  const targetLinePct = 100; // target is always at 100% of the bar width
  const fillColor = taxa >= 85 ? '#22c55e' : taxa >= target ? '#6366f1' : taxa >= 50 ? '#f59e0b' : '#ef4444';

  let status = '';
  if (taxa < 50)         status = `<span style="color:#ef4444">🔴 Em risco</span>`;
  else if (taxa < target) status = `<span style="color:#f59e0b">🟡 Em desenvolvimento</span>`;
  else if (taxa < 85)    status = `<span style="color:#22c55e">🟢 Aprovável</span>`;
  else                   status = `<span style="color:#6366f1">🏆 Excelente!</span>`;

  el.innerHTML = `
    <div class="aprov-label">
      <span>Predição de Aprovação</span>
      <span>Meta: ${target}% · Atual: ${taxa}%</span>
    </div>
    <div class="aprov-track">
      <div class="aprov-fill" style="width:${fillPct}%;background:${fillColor};"></div>
      <div class="aprov-target-line" style="left:${targetLinePct}%;">
        <span class="aprov-target-lbl">${target}%</span>
      </div>
    </div>
    <div class="aprov-status">${status}</div>`;
}

// ── Renderização: Hoje ──────────────────────────────────────────────────────
function renderHoje(data) {
  const today = data.todayStats || {};
  const global = data.globalStats || {};
  const goal = (data.settings || {}).dailyGoal || 30;

  // Streak
  document.getElementById('streak-badge').textContent = `🔥 ${global.streak || 0}d`;

  // Meta
  const resolved = today.resolved || 0;
  const goalPct = Math.min(100, Math.round(resolved / goal * 100));
  document.getElementById('goal-progress').textContent = `${resolved} / ${goal}`;
  document.getElementById('goal-fill').style.width = goalPct + '%';

  // Stats grid
  document.getElementById('d-resolved').textContent = fmt(resolved);
  document.getElementById('d-acertos').textContent  = fmt(today.acertos);
  document.getElementById('d-erros').textContent    = fmt(today.erros);

  // Taxa
  const taxa = pct(today.acertos || 0, resolved);
  const arc = document.getElementById('ring-arc');
  const circumf = 138.2;
  arc.style.strokeDashoffset = circumf - (circumf * taxa / 100);
  arc.style.stroke = accColor(taxa);
  document.getElementById('ring-pct').style.color = accColor(taxa);
  document.getElementById('ring-pct').textContent = resolved > 0 ? taxa + '%' : '—';
  document.getElementById('ring-sub').textContent = resolved > 0
    ? `${today.acertos || 0} acertos · ${today.erros || 0} erros hoje`
    : 'Resolva questões no TEC para começar a rastrear.';

  // Aprovação bar
  renderAprovacao(today, data.settings);

  // Matérias
  const subjects = data.subjectStats || [];
  const subjList = document.getElementById('subj-list');
  if (!subjects.length) {
    subjList.innerHTML = '<div style="font-size:11px;color:#374151;text-align:center;padding:12px 0;">Nenhuma matéria registrada ainda.</div>';
  } else {
    const maxTotal = Math.max(...subjects.map(s => s.total));
    subjList.innerHTML = subjects.slice(0, 7).map(s => {
      const p = pct(s.acertos, s.total);
      return `<div class="subj-row">
        <span class="subj-name">${s.materia}</span>
        <div class="subj-bar"><div class="subj-bar-fill" style="width:${Math.round(s.total/maxTotal*100)}%;background:${accColor(p)};"></div></div>
        <span class="subj-pct" style="color:${accColor(p)}">${p}%</span>
      </div>`;
    }).join('');
  }

  // Ranking de prioridade
  renderPriorityList(subjects);

  // Gráfico semanal
  renderWeekChart(data.weekStats);

  // Pomodoro
  if (data.pomodoro) initPomodoro(data.pomodoro);
}

// ── Renderização: Revisão ───────────────────────────────────────────────────
function simImpIcon(imp) {
  return imp === 3 ? '🔴' : imp === 2 ? '🟡' : '🟢';
}

function simPanelHtml(related) {
  if (!related || !related.length) return '';
  const uid = 'sim-' + Math.random().toString(36).slice(2, 7);
  const itemsHtml = related.map(r => {
    const url = (r.url || '').replace(/'/g, "\\'");
    return `<div class="sim-item">
      <span class="sim-imp">${simImpIcon(r.importance)}</span>
      <div class="sim-body">
        <div class="sim-assunto">${r.assunto || r.materia || '—'}</div>
        <div class="sim-desc" title="${r.desc || ''}">${(r.desc || r.qid).slice(0, 52)}</div>
        <div class="sim-stats">✅ ${r.acertos} · ❌ ${r.erros} · sim. ${Math.round((r.score||0)*100)}%</div>
      </div>
      ${url ? `<button class="sim-open" data-action="open-question" data-url="${url}">↗</button>` : ''}
    </div>`;
  }).join('');

  const allUrls = related.filter(r => r.url).map(r => r.url);
  const blockBtn = allUrls.length > 1
    ? `<button class="sim-block-btn" data-action="open-sim-block" data-urls="${encodeURIComponent(JSON.stringify(allUrls))}">🔗 Revisar bloco (${allUrls.length} questões similares)</button>`
    : '';

  return `<div class="sim-panel">
    <div class="sim-toggle" onclick="
      const l=this.nextElementSibling;
      const open=l.style.display!=='none';
      l.style.display=open?'none':'block';
      this.children[1].textContent=open?'▶':'▼';
    ">
      <span>📎 ${related.length} questão(ões) similar(es) encontrada(s)</span>
      <span style="font-size:8px;color:#475569;">▼</span>
    </div>
    <div style="display:none;">
      <div class="sim-list">${itemsHtml}</div>
      ${blockBtn}
    </div>
  </div>`;
}

function qCardHtml(q, sessionMode) {
  const today = new Date().toISOString().split('T')[0];
  const isDue  = !q.nextReview || q.nextReview <= today;
  const errBadge  = q.errorCount ? `<span class="badge err">✕ ${q.errorCount}x</span>` : '';
  const dateBadge = sessionMode
    ? `<span class="badge due-now">🔴 Esta sessão</span>`
    : isDue
      ? `<span class="badge due-now">⏰ Revisar hoje</span>`
      : `<span class="badge future">📅 ${fmtDate(q.nextReview)}</span>`;
  const difBadge = q.dificuldade ? `<span class="badge dif">${q.dificuldade}</span>` : '';
  const simBadge = q.relatedQuestions?.length
    ? `<span class="badge" style="background:rgba(99,102,241,.15);color:#818cf8;">📎 ${q.relatedQuestions.length} similares</span>`
    : '';
  const semBadge = q.semanticConcepts?.concepts?.length
    ? `<span class="badge" style="background:rgba(34,197,94,.1);color:#4ade80;" title="${q.semanticConcepts.concepts.slice(0,3).join(', ')}">🤖 ${q.semanticConcepts.concepts.length} conceitos</span>`
    : '';
  const desc = (q.desc || 'Questão #' + q.qid).slice(0, 55);
  const url  = (q.url || '').replace(/'/g, "\\'");
  const assuntoHtml = q.assunto ? `<div style="font-size:9px;color:#6366f1;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${q.assunto}</div>` : '';

  return `<div class="qcard ${isDue || sessionMode ? 'due' : ''}">
    <div class="qcard-top">
      <div class="qcard-icon wrong">✕</div>
      <div class="qcard-meta">
        <div class="qcard-mat">${q.materia || 'Matéria'}</div>
        ${assuntoHtml}
        <div class="qcard-desc" title="${q.desc || ''}">${desc}</div>
      </div>
    </div>
    <div class="qcard-badges">${errBadge}${dateBadge}${difBadge}${simBadge}${semBadge}</div>
    <div class="qcard-btns">
      <button class="qbtn review" data-action="open-question" data-url="${url}">📖 Abrir</button>
      <button class="qbtn acertei" data-action="mark-review" data-qid="${q.qid}" data-quality="4">✓ Acertei</button>
      <button class="qbtn errei" data-action="mark-review" data-qid="${q.qid}" data-quality="1">✕ Errei</button>
    </div>
    ${simPanelHtml(q.relatedQuestions)}
  </div>`;
}

// ── Huberman helpers ─────────────────────────────────────────────────────────
function fmtRemaining(secs) {
  if (secs <= 0) return 'REVISAR AGORA';
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m ${String(s).padStart(2,'0')}s` : `${s}s`;
}

function renderHubSection(hubItems) {
  if (!hubItems || !hubItems.length) return '';

  const cards = hubItems.map(h => {
    const isDue  = h.isDue;
    const remaining = h.remaining || 0;
    const isCustom  = h.customMins != null;

    // Indicadores de fase
    const dots = [1, 2, 3].map(p => {
      let cls = 'hub-dot';
      if (p < h.phase)    cls += ' done';
      else if (p === h.phase) cls += isCustom ? ' custom' : ' active';
      return `<div class="${cls}"></div>`;
    }).join('');

    const phaseLabel = isCustom
      ? `Custom ${h.customMins}min`
      : `Fase ${h.phase} de 3 · ${[5,9,11][h.phase-1]}min`;

    const countdown = isDue
      ? `<span class="hub-countdown ready" data-hub-cd="${h.qid}">⚡ REVISAR AGORA</span>`
      : `<span class="hub-countdown waiting" data-hub-cd="${h.qid}">⏱ ${fmtRemaining(remaining)}</span>`;

    const url = (h.url || '').replace(/'/g, "\\'");
    const qid = h.qid;

    return `<div class="hub-card ${isDue ? 'due-now' : ''}">
      <div class="hub-phases">
        ${dots}
        <span class="hub-phase-lbl">${phaseLabel}</span>
      </div>
      ${h.materia ? `<div class="hub-mat">${h.materia}</div>` : ''}
      <div class="hub-desc" title="${h.desc || ''}">${(h.desc || 'Questão #' + qid).slice(0,52)}</div>
      ${countdown}
      <div class="hub-btns">
        <button class="hub-btn open" data-action="hub-open" data-url="${url}">📖 Abrir</button>
        <button class="hub-btn ok"   data-action="hub-correct" data-qid="${qid}">✓ Acertei</button>
        <button class="hub-btn fail" data-action="hub-wrong" data-qid="${qid}">✕ Errei</button>
        <button class="hub-btn dis"  data-action="hub-dismiss" data-qid="${qid}">–</button>
      </div>
    </div>`;
  }).join('');

  return `<div class="hub-section">
    <div class="hub-title">🧠 MÉTODO HUBERMAN — REVISÃO ATIVA</div>
    ${cards}
    <div class="hub-custom">
      <span class="hub-custom-lbl">Agendar em:</span>
      <input class="hub-custom-inp" type="number" id="hub-custom-mins" min="1" max="120" placeholder="min" value="15">
      <button class="hub-custom-btn" data-action="hub-add-custom">+ Agendar</button>
    </div>
  </div>`;
}

function renderRevisao(data) {
  const due     = data.dueReviews || [];
  const session = data.activeSession;

  // Erros da sessão atual (não duplicar com o banco de revisão)
  const dueQids = new Set(due.map(q => q.qid));
  const sessionErrors = session && session.questions
    ? session.questions.filter(q => q.result === 'wrong' && q.qid && !dueQids.has(q.qid))
    : [];

  const hubItems = data.hubQueue || [];
  const total = hubItems.length + due.length + sessionErrors.length;
  document.getElementById('due-count').textContent = total;

  if (total === 0) {
    document.getElementById('rev-list').innerHTML = `
      <div class="rev-empty">
        <div class="icon">🎉</div>
        <p>Nenhuma revisão pendente!<br>Continue resolvendo questões.</p>
      </div>`;
    return;
  }

  let html = '';

  // 1. Seção Huberman (prioridade máxima)
  html += renderHubSection(hubItems);

  // 2. Seção "Esta Sessão" — erros recentes
  if (sessionErrors.length > 0) {
    html += `<div style="font-size:10px;color:#ef4444;font-weight:700;letter-spacing:.8px;margin-bottom:7px;">🔴 DESTA SESSÃO</div>`;
    html += sessionErrors.map(q => qCardHtml(q, true)).join('');
  }

  // 3. Seção SM-2 agendadas — renderiza em clusters por assunto
  if (due.length > 0) {
    if (hubItems.length > 0 || sessionErrors.length > 0) {
      html += `<div style="font-size:10px;color:#475569;font-weight:700;letter-spacing:.8px;margin:10px 0 7px;">📅 AGENDADAS (SM-2)</div>`;
    }
    if (data.clusteredReviews && data.clusteredReviews.length > 0) {
      html += renderClusters(data.clusteredReviews);
    } else {
      html += due.map(q => qCardHtml(q, false)).join('');
    }
  }

  document.getElementById('rev-list').innerHTML = html;
  renderRevPreAlert(data.preAlert);
}

// ── Renderização: Histórico ─────────────────────────────────────────────────
function renderHistorico(data) {
  const sessions = data.sessions || [];
  if (!sessions.length) {
    document.getElementById('hist-list').innerHTML = `
      <div class="hist-empty">
        <div style="font-size:28px;margin-bottom:8px;">📋</div>
        <div style="font-size:12px;color:#64748b;">Nenhuma sessão registrada ainda.<br>Conclua um caderno no TEC para registrar.</div>
      </div>`;
    return;
  }

  document.getElementById('hist-list').innerHTML = sessions.map(s => {
    const taxa = pct(s.acertos || 0, (s.acertos || 0) + (s.erros || 0));
    const color = accColor(taxa);
    // Compute per-materia breakdown from session questions
    let materiaHtml = '';
    if (s.questions && s.questions.length > 0) {
      const mats = {};
      s.questions.forEach(q => {
        if (!q.materia) return;
        if (!mats[q.materia]) mats[q.materia] = { acertos: 0, erros: 0 };
        if (q.result === 'correct') mats[q.materia].acertos++;
        else if (q.result === 'wrong') mats[q.materia].erros++;
      });
      const matList = Object.entries(mats).slice(0, 3).map(([m, v]) => {
        const t = v.acertos + v.erros;
        const p = t > 0 ? Math.round(v.acertos / t * 100) : 0;
        return `<span style="font-size:9px;color:${accColor(p)};font-weight:700;">${m.slice(0,18)}: ${p}%</span>`;
      }).join('<span style="color:#374151"> · </span>');
      if (matList) materiaHtml = `<div style="margin-top:5px;line-height:1.6;">${matList}</div>`;
    }
    return `<div class="scard">
      <div class="scard-top">
        <span class="scard-date">📅 ${fmtDate(s.date)}</span>
        <span class="scard-acc" style="color:${color}">${taxa}%</span>
      </div>
      <div class="scard-name">${s.caderno || s.materia || 'Sessão TEC'}</div>
      <div class="scard-stats">
        <span class="sstat p">Total <span>${(s.acertos || 0) + (s.erros || 0)}</span></span>
        <span class="sstat g">Acertos <span>${s.acertos || 0}</span></span>
        <span class="sstat r">Erros <span>${s.erros || 0}</span></span>
        <span class="sstat">⏱ <span>${fmtElapsed(s.elapsed)}</span></span>
      </div>
      ${materiaHtml}
    </div>`;
  }).join('');
}

// ── Renderização: Config ────────────────────────────────────────────────────
function renderConfig(data) {
  cfgSettings = data.settings || cfgSettings;
  document.getElementById('cfg-goal').value = cfgSettings.dailyGoal || 30;
  setToggle('notifications', cfgSettings.notifications !== false);
  setToggle('autoReveal', cfgSettings.autoReveal !== false);
  const keyEl = document.getElementById('cfg-claude-key');
  if (keyEl) keyEl.value = cfgSettings.claudeApiKey ? '••••••••' : '';
  renderQBankStats(data.questionBankStats);
}

// ── Renderização: Revisão com clusters e pré-alerta ─────────────────────────
function renderRevPreAlert(preAlert) {
  const el = document.getElementById('rev-prealert');
  if (!el) return;
  if (!preAlert || !preAlert.count) { el.style.display = 'none'; return; }
  el.style.display = '';
  el.innerHTML = `⚠️ <strong>${preAlert.count} questão(ões)</strong> de <em>${preAlert.materia}</em> aguardando revisão antes desta sessão.`;
}

function renderClusters(clusteredReviews) {
  if (!clusteredReviews || !clusteredReviews.length) return '';
  let html = '';
  for (const cluster of clusteredReviews) {
    if (cluster.items.length === 1) {
      html += qCardHtml(cluster.items[0], false);
    } else {
      html += `<div class="cluster-hdr">📚 ${cluster.label} (${cluster.items.length} questões)</div>`;
      html += cluster.items.map(q => qCardHtml(q, false)).join('');
    }
  }
  return html;
}

// ── Renderização: Análise ────────────────────────────────────────────────────
function renderAnalise(data) {
  renderPreAlertAnalise(data.preAlert);
  renderConfusionPatterns(data.confusionPatterns || []);
  renderArticleCoverage(data.articleCoverage || {});
  renderSemanticStatus(data.settings || {});
}

function renderPreAlertAnalise(preAlert) {
  const el = document.getElementById('pre-alert-pop');
  const txt = document.getElementById('pre-alert-pop-text');
  if (!el || !txt) return;
  if (!preAlert || !preAlert.count) { el.style.display = 'none'; return; }
  el.style.display = '';
  const items = (preAlert.items || []).map(i => `• ${i.assunto || i.desc || i.qid}`).join('<br>');
  txt.innerHTML = `<strong>${preAlert.count} questão(ões)</strong> pendente(s) de <em>${preAlert.materia}</em>:<br>${items}`;
}

function renderConfusionPatterns(patterns) {
  const el = document.getElementById('confusion-list');
  if (!el) return;
  if (!patterns.length) {
    el.innerHTML = '<div style="font-size:11px;color:#475569;padding:8px 0;">Ainda sem dados suficientes.<br>Erre pelo menos 3 questões relacionadas para detectar padrões.</div>';
    return;
  }
  el.innerHTML = patterns.map(p => `
    <div class="conf-item">
      <div class="conf-pair">⚠️ ${p.a} ↔ ${p.b}</div>
      <div class="conf-meta">${p.materia ? p.materia + ' · ' : ''}Confundido <strong>${p.count}×</strong></div>
    </div>`).join('');
}

function renderArticleCoverage(coverage) {
  const el = document.getElementById('article-coverage-list');
  if (!el) return;
  const allMats = Object.entries(coverage);
  if (!allMats.length) {
    el.innerHTML = '<div style="font-size:11px;color:#475569;padding:8px 0;">Nenhuma questão com referência legal registrada ainda.</div>';
    return;
  }
  let html = '';
  for (const [mat, refs] of allMats) {
    const ranked = Object.entries(refs)
      .map(([ref, v]) => ({ ref, ...v, total: v.correct + v.wrong, pct: v.correct + v.wrong > 0 ? Math.round(v.correct / (v.correct + v.wrong) * 100) : 0 }))
      .filter(r => r.total > 0)
      .sort((a, b) => a.pct - b.pct || b.total - a.total)
      .slice(0, 8);
    if (!ranked.length) continue;
    html += `<div class="cov-mat-hdr">${mat.replace(/_/g, ' ').toUpperCase()}</div>`;
    for (const r of ranked) {
      const color = r.pct >= 70 ? '#22c55e' : r.pct >= 40 ? '#f59e0b' : '#ef4444';
      html += `<div class="cov-bar-wrap">
        <span class="cov-bar-ref" title="${r.ref}">${r.ref}</span>
        <div class="cov-bar-bg"><div class="cov-bar-fill" style="width:${r.pct}%;background:${color};"></div></div>
        <span class="cov-bar-pct" style="color:${color};">${r.pct}%</span>
      </div>`;
    }
  }
  el.innerHTML = html || '<div style="font-size:11px;color:#475569;padding:8px 0;">Sem artigos rastreados ainda.</div>';
}

function renderSemanticStatus(settings) {
  const el = document.getElementById('semantic-status');
  if (!el) return;
  if (settings.claudeApiKey) {
    el.innerHTML = '<span style="color:#22c55e;font-weight:700;">✓ API Claude configurada.</span> Conceitos semânticos são extraídos automaticamente ao errar questões.';
  } else {
    el.innerHTML = 'Configure a chave da API Claude em <strong>CONFIG → Chave API Claude</strong> para ativar análise semântica de conceitos jurídicos.';
  }
}

function setToggle(id, on) {
  const el = document.getElementById('tog-' + id);
  if (el) el.className = 'toggle-sw' + (on ? ' on' : '');
}

function toggleSetting(id) {
  cfgSettings[id] = !cfgSettings[id];
  setToggle(id, cfgSettings[id]);
}

// ── Status bar ──────────────────────────────────────────────────────────────
async function updateStatusBar() {
  const dot = document.getElementById('s-dot');
  const txt = document.getElementById('s-txt');
  if (!dot || !txt) return;

  try {
    let tecTab = null;
    let pingData = null;

    tecTab = await findTab(TEC_ORIGIN); // already has internal try/catch + timeout
    if (tecTab) {
      try { pingData = await pingContent(tecTab.id); } catch { /* */ }
    }

    if (!tecTab) {
      dot.className = 's-dot warn';
      txt.textContent = 'TEC não está aberto — clique em TEC para abrir';
    } else if (!pingData) {
      dot.className = 's-dot warn';
      txt.innerHTML = '<strong>TEC detectado</strong> — recarregue a aba do TEC';
    } else {
      dot.className = 's-dot on';
      const { localAce = 0, localErr = 0 } = pingData.stats || {};
      const total = localAce + localErr;
      txt.innerHTML = total > 0
        ? `<strong>⚡ Ativo</strong> · ✓${localAce} ✕${localErr}`
        : `<strong>⚡ Monitor ativo</strong> — abra um caderno`;
    }
  } catch {
    dot.className = 's-dot warn';
    txt.textContent = 'Erro ao verificar conexão';
  }
}

// ── Load completo ───────────────────────────────────────────────────────────
async function loadAll() {
  try {
    appData = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout')), 2000);
      chrome.runtime.sendMessage({ type: 'GET_POPUP_DATA' }, r => {
        clearTimeout(t);
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve(r || {});
      });
    });
  } catch {
    appData = { todayStats: {}, globalStats: {}, sessions: [], subjectStats: [], dueReviews: [], settings: {} };
  }

  try { renderHoje(appData); }     catch(e) { console.error('renderHoje', e); }
  try { renderRevisao(appData); }  catch(e) { console.error('renderRevisao', e); }
  try { renderHistorico(appData); }catch(e) { console.error('renderHistorico', e); }
  try { renderConfig(appData); }   catch(e) { console.error('renderConfig', e); }
  try { renderAnalise(appData); }  catch(e) { /* */ }
  try { initPopTimer(appData.timer); } catch(e) { console.error('initPopTimer', e); }
  try { if (appData.pomodoro) initPomodoro(appData.pomodoro); } catch(e) { console.error('initPomodoro', e); }
  try { renderHourlyChart(appData.hourlyStats); } catch(e) { /* */ }
  try { renderFatigueAlert(appData.recentResults || [], appData.todayStats || {}); } catch(e) { /* */ }
  try { renderManHubTimer(appData.manualHubTimer); } catch(e) { /* */ }
  updateStatusBar(); // dispara async sem bloquear o resto do loadAll

  // Badge de revisões (banco + sessão atual)
  const due2    = (appData.dueReviews || []);
  const sess2   = appData.activeSession;
  const dueQids2 = new Set(due2.map(q => q.qid));
  const sessErr2 = sess2 && sess2.questions
    ? sess2.questions.filter(q => q.result === 'wrong' && q.qid && !dueQids2.has(q.qid))
    : [];
  const totalRev2 = due2.length + sessErr2.length;
  const revTabEl = document.querySelector('[data-tab="revisao"]');
  if (revTabEl) revTabEl.textContent = totalRev2 > 0 ? `REVISÃO (${totalRev2})` : 'REVISÃO';
}

// ── Ações ────────────────────────────────────────────────────────────────────
function openPanel() {
  findTab('cazuzaleo89-netizen.github.io').then(tab => {
    if (tab) chrome.tabs.update(tab.id, { active: true });
    else chrome.tabs.create({ url: PANEL_URL });
    window.close();
  });
}

function openTec() {
  findTab(TEC_ORIGIN).then(tab => {
    if (tab) chrome.tabs.update(tab.id, { active: true });
    else chrome.tabs.create({ url: 'https://www.tecconcursos.com.br' });
    window.close();
  });
}

function openQuestion(url) {
  if (!url) return;
  chrome.tabs.create({ url });
  window.close();
}

async function markReview(qid, quality) {
  if (!qid) return;
  await new Promise(resolve => {
    chrome.runtime.sendMessage({ type: 'REVIEW_QUESTION', qid, quality }, resolve);
  });
  await loadAll();
  // Volta pra aba revisão
  document.querySelector('[data-tab="revisao"]').click();
}

function saveConfig() {
  cfgSettings.dailyGoal = parseInt(document.getElementById('cfg-goal').value) || 30;
  const keyEl = document.getElementById('cfg-claude-key');
  if (keyEl && keyEl.value && !keyEl.value.startsWith('•')) cfgSettings.claudeApiKey = keyEl.value.trim();
  chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings: cfgSettings }, () => {
    const btn = document.querySelector('.cfg-btn.primary');
    const orig = btn.textContent;
    btn.textContent = '✓ Salvo!';
    setTimeout(() => { btn.textContent = orig; }, 1500);
  });
}

async function exportWrong() {
  const r = await new Promise(resolve => chrome.runtime.sendMessage({ type: 'EXPORT_WRONG' }, resolve));
  if (!r || !r.bank) return;
  const blob = new Blob([JSON.stringify(r.bank, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'painel-fiscal-erros.json'; a.click();
  URL.revokeObjectURL(url);
}

async function exportCSV() {
  const r = await new Promise(resolve => chrome.runtime.sendMessage({ type: 'EXPORT_WRONG' }, resolve));
  if (!r || !r.bank) return;
  const header = 'QID,Matéria,Assunto,Erros,Última Erro,Próxima Revisão,URL';
  const rows = r.bank.map(q =>
    [q.qid, q.materia, q.assunto, q.errorCount, q.lastError, q.nextReview, q.url]
      .map(v => `"${(v || '').toString().replace(/"/g, '""')}"`)
      .join(',')
  );
  const csv = [header, ...rows].join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'painel-fiscal-erros.csv'; a.click();
  URL.revokeObjectURL(url);
}

// ── Ações Huberman ────────────────────────────────────────────────────────────
function hubOpen(url) {
  if (!url) return;
  chrome.tabs.create({ url });
  window.close();
}

async function hubCorrect(qid) {
  await new Promise(resolve => chrome.runtime.sendMessage({ type: 'HUBERMAN_CORRECT', qid }, resolve));
  await softRefresh(true);
  document.querySelector('[data-tab="revisao"]').click();
}

async function hubWrong(qid) {
  await new Promise(resolve => chrome.runtime.sendMessage({ type: 'HUBERMAN_WRONG', qid }, resolve));
  await softRefresh(true);
  document.querySelector('[data-tab="revisao"]').click();
}

async function hubDismiss(qid) {
  await new Promise(resolve => chrome.runtime.sendMessage({ type: 'HUBERMAN_DISMISS', qid }, resolve));
  await softRefresh(true);
}

async function hubAddCustom() {
  const mins = parseInt(document.getElementById('hub-custom-mins').value) || 15;
  const data = appData || {};
  const hub  = (data.hubQueue || [])[0];
  if (!hub) { alert('Nenhuma questão Huberman na fila para agendar.'); return; }
  await new Promise(resolve => chrome.runtime.sendMessage({ type: 'HUBERMAN_CUSTOM', qid: hub.qid, mins }, resolve));
  await softRefresh(true);
}

function resetStats() {
  if (!confirm('⚠ Isso apagará TODOS os dados locais (sessões, erros, stats). Tem certeza?')) return;
  chrome.storage.local.clear(() => {
    loadAll();
    const btn = document.querySelector('.cfg-btn.danger');
    btn.textContent = '✓ Dados removidos';
    setTimeout(() => { btn.textContent = '🗑 Resetar estatísticas'; }, 2000);
  });
}

// ── Repositório de questões ───────────────────────────────────────────────────
async function exportQuestionBank() {
  const r = await new Promise(resolve => chrome.runtime.sendMessage({ type: 'EXPORT_QUESTION_BANK' }, resolve));
  if (!r || !r.bank) return;
  const blob = new Blob([JSON.stringify(r.bank, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'painel-fiscal-repositorio.json'; a.click();
  URL.revokeObjectURL(url);
}

async function copyQuestionBank() {
  const r = await new Promise(resolve => chrome.runtime.sendMessage({ type: 'EXPORT_QUESTION_BANK' }, resolve));
  if (!r || !r.bank) return;
  try {
    await navigator.clipboard.writeText(JSON.stringify(r.bank));
    const btn = document.getElementById('cfg-copy-qbank');
    const orig = btn.textContent;
    btn.textContent = '✓ Copiado!';
    setTimeout(() => { btn.textContent = orig; }, 2000);
  } catch { alert('Não foi possível copiar. Use o botão Exportar JSON.'); }
}

function renderQBankStats(stats) {
  const el = document.getElementById('qbank-stats');
  if (!el || !stats) return;
  el.innerHTML = `
    <span style="font-size:10px;background:#20243a;border-radius:6px;padding:3px 8px;color:#94a3b8;">📚 ${stats.total} questões</span>
    <span style="font-size:10px;background:rgba(34,197,94,.1);border-radius:6px;padding:3px 8px;color:#22c55e;">🟢 ${stats.dominadas}</span>
    <span style="font-size:10px;background:rgba(245,158,11,.1);border-radius:6px;padding:3px 8px;color:#f59e0b;">🟡 ${stats.atencao}</span>
    <span style="font-size:10px;background:rgba(239,68,68,.1);border-radius:6px;padding:3px 8px;color:#ef4444;">🔴 ${stats.criticas}</span>
  `;
}

// ── Simulado automático ───────────────────────────────────────────────────────
async function startSimulado() {
  const r = await new Promise(resolve => chrome.runtime.sendMessage({ type: 'GET_SIMULADO' }, resolve));
  if (!r || !r.questions || !r.questions.length) {
    alert('Nenhuma questão no banco de erros ainda! Resolva questões no TEC primeiro.');
    return;
  }
  const questions = r.questions;
  // Store the queue for later use
  await new Promise(resolve => chrome.storage.local.set({ simuladoQueue: questions }, resolve));
  // Open all question URLs as tabs
  questions.forEach(q => { if (q.url) chrome.tabs.create({ url: q.url }); });
  alert(`Simulado iniciado com ${questions.length} questões! As abas foram abertas. Use o widget do TEC para navegar.`);
  window.close();
}

// ── Pomodoro: botão toggle (start/pause) ──────────────────────────────────────
function pomodoroToggle() {
  if (pomData.active) {
    chrome.runtime.sendMessage({ type: 'POMODORO_STOP' }, resp => {
      if (resp) initPomodoro(resp);
    });
  } else {
    chrome.runtime.sendMessage({ type: 'POMODORO_START' }, resp => {
      if (resp) initPomodoro(resp);
    });
  }
}

function pomodoroSkipBtn() {
  chrome.runtime.sendMessage({ type: 'POMODORO_SKIP' }, resp => {
    if (resp) initPomodoro(resp);
  });
}

function pomodoroResetBtn() {
  chrome.runtime.sendMessage({ type: 'POMODORO_STOP' }, resp => {
    if (resp) {
      // Also reset count
      pomData = { ...pomData, active: false, count: 0, state: 'work', remaining: 0 };
      if (resp.workMins) pomData.remaining = resp.workMins * 60;
      if (pomTickInterval) { clearInterval(pomTickInterval); pomTickInterval = null; }
      pomodoroTick();
    }
  });
}

// ── Atualização em tempo real ────────────────────────────────────────────────
let _refreshBusy = false; // mutex: evita chamadas concorrentes do intervalo

// force=true: chamadas de ações do usuário sempre executam (ignora mutex)
async function softRefresh(force = false) {
  if (_refreshBusy && !force) return;
  if (!force) _refreshBusy = true;
  try {
    let fresh;
    try {
      fresh = await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('timeout')), 1500);
        chrome.runtime.sendMessage({ type: 'GET_POPUP_DATA' }, r => {
          clearTimeout(t);
          if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
          else resolve(r || {});
        });
      });
    } catch { return; }

    appData = fresh;

    // Atualiza stats de hoje sem re-renderizar tudo
    const today = fresh.todayStats || {};
    const resolved = today.resolved || 0;
    const acertos  = today.acertos  || 0;
    const erros    = today.erros    || 0;
    const goal     = (fresh.settings || {}).dailyGoal || 30;
    const goalPct  = Math.min(100, Math.round(resolved / goal * 100));
    const taxa     = pct(acertos, resolved);

    setEl('d-resolved', fmt(resolved));
    setEl('d-acertos',  fmt(acertos));
    setEl('d-erros',    fmt(erros));
    setEl('goal-progress', `${resolved} / ${goal}`);
    setEl('ring-pct', resolved > 0 ? taxa + '%' : '—');
    setEl('ring-sub', resolved > 0
      ? `${acertos} acertos · ${erros} erros hoje`
      : 'Resolva questões no TEC para começar a rastrear.');

    const fill = document.getElementById('goal-fill');
    if (fill) fill.style.width = goalPct + '%';

    const arc = document.getElementById('ring-arc');
    if (arc) {
      arc.style.strokeDashoffset = 138.2 - (138.2 * taxa / 100);
      arc.style.stroke = accColor(taxa);
    }
    const ringPct = document.getElementById('ring-pct');
    if (ringPct) ringPct.style.color = accColor(taxa);

    // Atualiza streak
    const global = fresh.globalStats || {};
    setEl('streak-badge', `🔥 ${global.streak || 0}d`);

    // Conta revisões (Huberman + banco + sessão)
    const due = fresh.dueReviews || [];
    const hub = fresh.hubQueue   || [];
    const session = fresh.activeSession;
    const dueQids = new Set(due.map(q => q.qid));
    const sessionErr = session && session.questions
      ? session.questions.filter(q => q.result === 'wrong' && q.qid && !dueQids.has(q.qid))
      : [];
    const totalRev = hub.length + due.length + sessionErr.length;

    const revTab = document.querySelector('[data-tab="revisao"]');
    if (revTab) revTab.textContent = totalRev > 0 ? `REVISÃO (${totalRev})` : 'REVISÃO';

    // Atualiza só os contadores Huberman (sem reconstruir DOM)
    updateHubCountdowns(fresh.hubQueue || []);

    // Atualiza aprovação, prioridade, gráficos e alertas
    try { renderAprovacao(fresh.todayStats || {}, fresh.settings); } catch (e) { /* */ }
    try { renderPriorityList(fresh.subjectStats || []); } catch (e) { /* */ }
    try { renderWeekChart(fresh.weekStats); } catch (e) { /* */ }
    try { renderQBankStats(fresh.questionBankStats); } catch (e) { /* */ }
    try { renderHourlyChart(fresh.hourlyStats); } catch (e) { /* */ }
    try { renderFatigueAlert(fresh.recentResults || [], fresh.todayStats || {}); } catch (e) { /* */ }
    try { if (fresh.manualHubTimer && !_manHubLocal) renderManHubTimer(fresh.manualHubTimer); } catch (e) { /* */ }
    try { renderRevPreAlert(fresh.preAlert); } catch (e) { /* */ }

    // Atualiza pomodoro se mudou estado
    if (fresh.pomodoro && fresh.pomodoro.active !== pomData.active) {
      initPomodoro(fresh.pomodoro);
    } else if (fresh.pomodoro) {
      pomData = { ...pomData, ...fresh.pomodoro };
    }
  } finally {
    _refreshBusy = false;
  }
}

// Atualiza apenas os textos de contagem regressiva já existentes no DOM
// sem tocar nos botões — evita o congelamento por reconstrução de DOM
function updateHubCountdowns(hubItems) {
  hubItems.forEach(h => {
    const cd = document.querySelector(`[data-hub-cd="${h.qid}"]`);
    if (!cd) return;
    if (h.isDue) {
      cd.className = 'hub-countdown ready';
      cd.textContent = '⚡ REVISAR AGORA';
      const card = cd.closest('.hub-card');
      if (card && !card.classList.contains('due-now')) card.classList.add('due-now');
    } else {
      cd.className = 'hub-countdown waiting';
      cd.textContent = `⏱ ${fmtRemaining(h.remaining)}`;
    }
  });
}

function setEl(id, txt) {
  const el = document.getElementById(id);
  if (el && el.textContent !== txt) el.textContent = txt;
}

// ── Event listeners for static buttons ──────────────────────────────────────
document.getElementById('btn-tec').addEventListener('click', openTec);
document.getElementById('btn-panel').addEventListener('click', openPanel);
document.getElementById('pop-timer-tog').addEventListener('click', popTimerToggle);
document.getElementById('pop-timer-reset').addEventListener('click', popTimerReset);
document.getElementById('cfg-notifications').addEventListener('click', () => toggleSetting('notifications'));
document.getElementById('cfg-autoReveal').addEventListener('click', () => toggleSetting('autoReveal'));
document.getElementById('cfg-save').addEventListener('click', saveConfig);
document.getElementById('cfg-export-json').addEventListener('click', exportWrong);
document.getElementById('cfg-export-csv').addEventListener('click', exportCSV);
document.getElementById('cfg-reset').addEventListener('click', resetStats);
document.getElementById('cfg-export-qbank').addEventListener('click', exportQuestionBank);
document.getElementById('cfg-copy-qbank').addEventListener('click', copyQuestionBank);

// Pomodoro buttons
document.getElementById('pom-tog').addEventListener('click', pomodoroToggle);
document.getElementById('pom-skip').addEventListener('click', pomodoroSkipBtn);
document.getElementById('pom-reset').addEventListener('click', pomodoroResetBtn);

// Pomodoro collapsible section toggle
document.getElementById('pom-toggle-section').addEventListener('click', () => {
  const body = document.getElementById('pom-body');
  const arrow = document.getElementById('pom-arrow');
  if (!body || !arrow) return;
  const isOpen = body.classList.contains('open');
  body.classList.toggle('open', !isOpen);
  arrow.classList.toggle('open', !isOpen);
});

// Simulado
const btnSimulado = document.getElementById('btn-simulado');
if (btnSimulado) btnSimulado.addEventListener('click', startSimulado);

// ── Event delegation for dynamic buttons (hub cards and qcards) ──────────────
document.addEventListener('click', e => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  const qid = btn.dataset.qid;
  const url = btn.dataset.url;
  const quality = btn.dataset.quality;
  switch (action) {
    case 'open-question': openQuestion(url); break;
    case 'mark-review': markReview(qid, parseInt(quality)); break;
    case 'hub-open': hubOpen(url); break;
    case 'hub-correct': hubCorrect(qid); break;
    case 'hub-wrong': hubWrong(qid); break;
    case 'hub-dismiss': hubDismiss(qid); break;
    case 'hub-add-custom': hubAddCustom(); break;
    case 'open-sim-block': {
      try {
        const urls = JSON.parse(decodeURIComponent(btn.dataset.urls || '[]'));
        urls.forEach(u => chrome.tabs.create({ url: u, active: false }));
      } catch(e) {}
      break;
    }
  }
});

// ── Inicializa ───────────────────────────────────────────────────────────────
loadAll();

// softRefresh: atualiza dados/stats (rápido, mutex garante 1 instância por vez)
const _refreshInterval = setInterval(softRefresh, 3000);

// updateStatusBar: usa chrome.tabs.query (mais lento, intervalo separado e maior)
const _statusInterval  = setInterval(updateStatusBar, 10000);

window.addEventListener('unload', () => {
  clearInterval(_refreshInterval);
  clearInterval(_statusInterval);
});

}); // end DOMContentLoaded
