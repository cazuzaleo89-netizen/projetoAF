/* ═════════════════════════════════════════════════════════════════════════════
 * Painel Fiscal — Popup v3.0
 * Controla os painéis HOJE / REVISÃO / INSIGHTS / ANÁLISE / HISTÓRICO / CONFIG
 * ════════════════════════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {

  const PANEL_URL   = 'https://cazuzaleo89-netizen.github.io/projetofiscal/';
  const TEC_ORIGIN  = 'tecconcursos.com.br';

  // ═══════════════════════════════════════════════════════════════════════════
  // ESTADO GLOBAL
  // ═══════════════════════════════════════════════════════════════════════════

  let appData      = null;
  let cfgSettings  = { dailyGoal: 30, notifications: true, autoReveal: true,
                       targetRate: 70, smartGoal: false, autoBackup: true };
  let insightsData = null;
  let calendarData = null;
  let editalData   = null;
  let clustersData = null;
  let activityData = null;
  let irtStats     = null;
  let libStats     = null;
  let libFilters   = { materia: '', banca: '', ano: '', status: '' };
  let libPage      = 1;
  let activeTab    = 'hoje';

  // ── Cronômetro popup
  let popTimerRunning = false;
  let popTimerElapsed = 0;
  let popTimerLocal   = null;

  // ── Pomodoro local
  let pomData = { active: false, state: 'work', count: 0, remaining: 0,
                  workMins: 25, breakMins: 5, longBreakMins: 15 };
  let pomFocusSecs = 0;
  let pomTickInterval = null;

  // ── Huberman manual timer
  let _manHubLabel = '';
  let _manHubLocal = null;

  // ── Hour chart toggle
  let _hrPopMode = 'q';

  // ── Refresh mutex
  let _refreshBusy = false;

  // ═══════════════════════════════════════════════════════════════════════════
  // UTILITÁRIOS
  // ═══════════════════════════════════════════════════════════════════════════

  function $(id) { return document.getElementById(id); }
  function fmt(n) { return (n || 0).toString(); }
  function pct(a, t) { return t > 0 ? Math.round(a / t * 100) : 0; }
  function setEl(id, txt) {
    const el = $(id);
    if (el && el.textContent !== txt) el.textContent = txt;
  }
  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
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
  function fmtTimer(secs) {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    const pad = n => String(n).padStart(2, '0');
    return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }
  function fmtRemaining(secs) {
    if (secs <= 0) return 'agora';
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m`;
    return `${secs}s`;
  }
  function accColor(rate) {
    if (rate >= 70) return '#22c55e';
    if (rate >= 50) return '#f59e0b';
    return '#ef4444';
  }
  function todayKey() { return new Date().toISOString().split('T')[0]; }

  function bgMsg(payload, timeoutMs = 8000) {
    return new Promise(resolve => {
      let done = false;
      const timer = setTimeout(() => { if (!done) { done = true; resolve(null); } }, timeoutMs);
      try {
        chrome.runtime.sendMessage(payload, r => {
          if (done) return;
          done = true; clearTimeout(timer);
          if (chrome.runtime.lastError) resolve(null);
          else resolve(r || {});
        });
      } catch { done = true; clearTimeout(timer); resolve(null); }
    });
  }

  async function findTab(origin) {
    try {
      const all = await Promise.race([
        chrome.tabs.query({}),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 1200)),
      ]);
      return all.find(t => t.url && t.url.includes(origin)) || null;
    } catch { return null; }
  }

  async function pingContent(tabId) {
    return new Promise(resolve => {
      const timer = setTimeout(() => resolve(null), 700);
      try {
        chrome.tabs.sendMessage(tabId, { type: 'PING' }, resp => {
          clearTimeout(timer); resolve(resp || null);
        });
      } catch { clearTimeout(timer); resolve(null); }
    });
  }

  function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 200);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MODAL DE CONFIRMAÇÃO (substitui confirm()/alert() do browser)
  // ═══════════════════════════════════════════════════════════════════════════

  function modal(title, text, buttons) {
    return new Promise(resolve => {
      const mb = $('modal');
      $('modal-title').textContent = title;
      $('modal-text').innerHTML = text;
      const btnsWrap = $('modal-btns');
      btnsWrap.innerHTML = '';
      buttons.forEach(b => {
        const el = document.createElement('button');
        el.className = 'modal-btn ' + (b.kind || 'cancel');
        el.textContent = b.label;
        el.onclick = () => { mb.classList.remove('show'); resolve(b.value); };
        btnsWrap.appendChild(el);
      });
      mb.classList.add('show');
    });
  }

  function modalAlert(text, title) {
    return modal(title || 'Aviso', text, [{ label: 'OK', value: true, kind: 'confirm' }]);
  }

  function modalConfirm(text, title, danger) {
    return modal(title || 'Confirmar', text, [
      { label: 'Cancelar', value: false, kind: 'cancel' },
      { label: danger ? 'Confirmar' : 'OK', value: true, kind: danger ? 'danger' : 'confirm' },
    ]);
  }

  function modalPrompt(text, placeholder) {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:99999;display:flex;align-items:center;justify-content:center;';
      const box = document.createElement('div');
      box.style.cssText = 'background:#1a1a1a;border:1px solid rgba(56,189,248,.2);border-radius:12px;padding:18px;width:380px;max-width:95vw;display:flex;flex-direction:column;gap:10px;';
      box.innerHTML = `
        <div style="font-size:11px;color:#7dd3fc;font-weight:700;line-height:1.5;">${escapeHtml(text)}</div>
        <textarea id="_mp_ta" style="width:100%;height:120px;background:#0d0d0d;border:1px solid rgba(56,189,248,.18);border-radius:7px;color:#e2e8f0;font-size:11px;padding:8px;resize:vertical;font-family:monospace;" placeholder="${escapeHtml(placeholder || '')}"></textarea>
        <div style="display:flex;gap:8px;justify-content:flex-end;">
          <button id="_mp_cancel" style="padding:6px 14px;background:transparent;border:1px solid #333;border-radius:7px;color:#6b7280;font-size:11px;cursor:pointer;">Cancelar</button>
          <button id="_mp_ok" style="padding:6px 14px;background:#0369a1;border:none;border-radius:7px;color:#fff;font-size:11px;font-weight:700;cursor:pointer;">Importar</button>
        </div>`;
      overlay.appendChild(box);
      document.body.appendChild(overlay);
      const ta = box.querySelector('#_mp_ta');
      ta?.focus();
      box.querySelector('#_mp_cancel').onclick = () => { overlay.remove(); resolve(null); };
      box.querySelector('#_mp_ok').onclick = () => { const v = ta?.value || ''; overlay.remove(); resolve(v); };
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CRONÔMETRO POPUP
  // ═══════════════════════════════════════════════════════════════════════════

  function popTimerTick() {
    if (popTimerRunning) popTimerElapsed++;
    const val = $('pop-timer-val');
    const dot = $('pop-timer-dot');
    const tog = $('pop-timer-tog');
    if (val) val.textContent = fmtTimer(popTimerElapsed);
    if (dot) {
      dot.style.background = popTimerRunning ? '#22c55e' : '#374151';
      dot.style.boxShadow  = popTimerRunning ? '0 0 6px #22c55e' : 'none';
    }
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

  async function popTimerToggle() {
    const action = popTimerRunning ? 'TIMER_PAUSE' : 'TIMER_START';
    const resp = await bgMsg({ type: action });
    if (resp) { popTimerElapsed = resp.elapsed || 0; popTimerRunning = !!resp.running; }
    else popTimerRunning = !popTimerRunning;
    popTimerTick();
  }

  async function popTimerReset() {
    if (!(await modalConfirm('Zerar cronômetro?'))) return;
    await bgMsg({ type: 'TIMER_RESET' });
    popTimerElapsed = 0; popTimerRunning = false; popTimerTick();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // POMODORO
  // ═══════════════════════════════════════════════════════════════════════════

  function fmtPomTime(secs) {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
  }

  // ── Feature 1: Sons do Pomodoro (Web Audio API) ──────────────────────────
  let pomSoundOn = true;
  chrome.storage.local.get({ pomSoundOn: true }, r => {
    pomSoundOn = r.pomSoundOn;
    updateSoundBtn();
  });

  function updateSoundBtn() {
    const btn = $('pom-sound-btn');
    if (btn) btn.textContent = pomSoundOn ? '🔔' : '🔕';
    if (btn) btn.title = pomSoundOn ? 'Som ativado — clique para silenciar' : 'Som silenciado — clique para ativar';
  }

  function togglePomSound() {
    pomSoundOn = !pomSoundOn;
    chrome.storage.local.set({ pomSoundOn });
    updateSoundBtn();
  }

  function playPomSound(type) {
    if (!pomSoundOn) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const notes = {
        work:   [{ f: 440, t: 0,    d: 0.15 }, { f: 554, t: 0.18, d: 0.15 }, { f: 659, t: 0.36, d: 0.25 }],
        brk:    [{ f: 523, t: 0,    d: 0.2  }, { f: 392, t: 0.25, d: 0.3  }],
        pause:  [{ f: 330, t: 0,    d: 0.1  }],
        resume: [{ f: 392, t: 0,    d: 0.1  }, { f: 523, t: 0.13, d: 0.15 }],
      };
      (notes[type] || notes.pause).forEach(({ f, t, d }) => {
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.value = f;
        gain.gain.setValueAtTime(0, ctx.currentTime + t);
        gain.gain.linearRampToValueAtTime(0.18, ctx.currentTime + t + 0.02);
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + t + d);
        osc.start(ctx.currentTime + t);
        osc.stop(ctx.currentTime + t + d + 0.05);
      });
    } catch (_) {}
  }
  // ─────────────────────────────────────────────────────────────────────────

  function pomodoroTick() {
    if (pomData.active && !pomData.paused && pomData.remaining > 0) pomData.remaining--;
    const state = $('pom-state-lbl');
    const time  = $('pom-time-val');
    const cnt   = $('pom-count');
    const tog   = $('pom-tog');
    if (state) state.textContent = pomData.state === 'work' ? 'TRABALHO'
                : pomData.state === 'longBreak' ? 'PAUSA LONGA' : 'PAUSA';
    if (time)  time.textContent  = fmtPomTime(pomData.remaining);
    if (cnt)   cnt.textContent   = pomData.count;
    if (tog) {
      if (pomData.paused)       tog.textContent = '▶ Continuar';
      else if (pomData.active)  tog.textContent = '⏸ Pausar';
      else                      tog.textContent = '▶ Iniciar';
    }
  }

  function initPomodoro(data) {
    if (!data) return;
    const prevState = pomData.state;
    pomData = { ...pomData, ...data };
    if (pomTickInterval) clearInterval(pomTickInterval);
    if (data.active && !data.paused) pomTickInterval = setInterval(pomodoroTick, 1000);
    // Play sound when background triggers a state change (alarm fired)
    if (data.state && data.state !== prevState) {
      playPomSound(data.state === 'work' ? 'work' : 'brk');
    }
    // Feature 4: atualiza indicador de foco pomodoro na sessão
    renderPomFocus();
    pomodoroTick();
  }

  async function pomodoroToggle() {
    let type;
    if (pomData.paused)      { type = 'POMODORO_RESUME'; playPomSound('resume'); }
    else if (pomData.active) { type = 'POMODORO_PAUSE';  playPomSound('pause');  }
    else                     { type = 'POMODORO_START';  playPomSound('work');   }
    const resp = await bgMsg({ type });
    if (resp) initPomodoro(resp);
  }

  async function pomodoroSkipBtn() {
    const resp = await bgMsg({ type: 'POMODORO_SKIP' });
    if (resp) initPomodoro(resp);
  }

  async function pomodoroResetBtn() {
    const resp = await bgMsg({ type: 'POMODORO_STOP' });
    if (resp) {
      pomData = { ...pomData, active: false, paused: false, count: 0, state: 'work',
                  remaining: (resp.workMins || pomData.workMins) * 60 };
      if (pomTickInterval) { clearInterval(pomTickInterval); pomTickInterval = null; }
      pomodoroTick();
    }
  }

  // ── Feature 4: Exibe tempo de foco acumulado via pomodoro na sessão ───────
  function renderPomFocus() {
    const el = $('pom-focus-badge');
    if (!el) return;
    const secs = pomFocusSecs;
    if (!secs || secs <= 0) { el.style.display = 'none'; return; }
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    el.textContent = h > 0 ? `🍅 ${h}h${m.toString().padStart(2,'0')}m de foco` : `🍅 ${m}m de foco`;
    el.style.display = 'inline-flex';
  }
  // ─────────────────────────────────────────────────────────────────────────

  // ═══════════════════════════════════════════════════════════════════════════
  // PLANO DIÁRIO DE MATÉRIAS
  // ═══════════════════════════════════════════════════════════════════════════

  let _planSubjects = [];   // autocomplete pool

  // ── Confetti dopamina ────────────────────────────────────────────────────
  function launchConfetti(intensity = 'full') {
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9999;';
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    canvas.width  = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;

    const count  = intensity === 'full' ? 120 : 30;
    const colors = ['#22c55e','#38bdf8','#a78bfa','#f59e0b','#f97316','#ec4899','#84cc16'];
    const pieces = Array.from({ length: count }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height * (intensity === 'full' ? 0.5 : 0.3) - canvas.height * 0.1,
      r: Math.random() * 5 + 3,
      d: Math.random() * count,
      color: colors[Math.floor(Math.random() * colors.length)],
      tilt: Math.floor(Math.random() * 10) - 10,
      tiltAngle: 0,
      tiltAngleInc: (Math.random() * 0.07) + 0.05,
      vx: (Math.random() - 0.5) * 3,
      vy: Math.random() * 3 + 1,
      alpha: 1,
    }));

    let frame = 0;
    const totalFrames = intensity === 'full' ? 160 : 80;

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      pieces.forEach(p => {
        p.tiltAngle += p.tiltAngleInc;
        p.x  += p.vx;
        p.y  += p.vy;
        p.vy += 0.08;
        p.tilt = Math.sin(p.tiltAngle) * 12;
        if (frame > totalFrames * 0.6) p.alpha -= 1 / (totalFrames * 0.4);
        ctx.globalAlpha = Math.max(0, p.alpha);
        ctx.beginPath();
        ctx.lineWidth = p.r;
        ctx.strokeStyle = p.color;
        ctx.moveTo(p.x + p.tilt + p.r / 3, p.y);
        ctx.lineTo(p.x + p.tilt, p.y + p.tilt + p.r);
        ctx.stroke();
      });
      frame++;
      if (frame < totalFrames) requestAnimationFrame(draw);
      else canvas.remove();
    }
    requestAnimationFrame(draw);
  }

  // ── Renderização do plano ─────────────────────────────────────────────────
  function renderDailyPlan(plan, subjectStats) {
    if (subjectStats) _planSubjects = (subjectStats || []).map(s => s.materia).filter(Boolean);
    const el = $('daily-plan-section');
    if (!el) return;
    if (!plan) { el.innerHTML = ''; return; }

    const items   = plan.items || [];
    const total   = items.length;
    const done    = items.filter(i => i.done).length;
    const allDone = total > 0 && done === total;
    const pct     = total > 0 ? Math.round(done / total * 100) : 0;

    const progressColor = allDone ? '#22c55e' : pct >= 60 ? '#84cc16' : pct >= 30 ? '#f59e0b' : '#38bdf8';

    const itemsHtml = items.map(item => `
      <div class="dp-item${item.done ? ' dp-done' : ''}" data-id="${escapeHtml(item.id)}">
        <button class="dp-check" data-id="${escapeHtml(item.id)}" title="${item.done ? 'Desmarcar' : 'Marcar como feito'}">
          ${item.done
            ? '<svg width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="7" r="6.5" fill="#22c55e"/><polyline points="3.5,7 6,9.5 10.5,4.5" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
            : '<svg width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="7" r="6.5" fill="none" stroke="#374151" stroke-width="1.5"/></svg>'
          }
        </button>
        <span class="dp-label">${escapeHtml(item.materia)}</span>
        <button class="dp-del" data-id="${escapeHtml(item.id)}" title="Remover">×</button>
      </div>`).join('');

    el.innerHTML = `
      <div class="dp-header">
        <span class="dp-title">📋 PLANO DO DIA</span>
        <span class="dp-counter" style="color:${progressColor}">${done}/${total}</span>
      </div>
      ${total > 0 ? `
        <div class="dp-progress-bar">
          <div class="dp-progress-fill" style="width:${pct}%;background:${progressColor};"></div>
        </div>` : ''}
      ${allDone && total > 0 ? `
        <div class="dp-all-done">🎉 Plano do dia concluído! Incrível foco!</div>` : ''}
      <div class="dp-list" id="dp-list">${itemsHtml}</div>
      <div class="dp-input-row">
        <div class="dp-input-wrap">
          <input class="dp-input" id="dp-input" placeholder="Adicionar matéria…" autocomplete="off" maxlength="60"/>
          <div class="dp-autocomplete" id="dp-autocomplete"></div>
        </div>
        <button class="dp-add-btn" id="dp-add-btn">+</button>
      </div>
    `;

    // Bind check buttons
    el.querySelectorAll('.dp-check').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const wasAllDone = (plan.items || []).filter(i => i.done).length === (plan.items || []).length && (plan.items||[]).length > 0;
        const resp = await bgMsg({ type: 'DAILY_PLAN_TOGGLE', id });
        if (resp) {
          // Check if now all done
          const nowDone = (resp.items || []).filter(i => i.done).length;
          const nowTotal = (resp.items || []).length;
          if (nowTotal > 0 && nowDone === nowTotal && !wasAllDone) {
            launchConfetti('full');
            if (pomSoundOn) playPomSound('work');
          } else if (!wasAllDone) {
            launchConfetti('mini');
          }
          renderDailyPlan(resp);
        }
      });
    });

    // Bind delete buttons
    el.querySelectorAll('.dp-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const newItems = (plan.items || []).filter(i => i.id !== id);
        await bgMsg({ type: 'DAILY_PLAN_SAVE', items: newItems });
        plan.items = newItems;
        renderDailyPlan(plan);
      });
    });

    // Bind input
    const input = $('dp-input');
    const acBox = $('dp-autocomplete');
    const addBtn = $('dp-add-btn');

    function showAc(val) {
      if (!val || val.length < 1) { acBox.style.display = 'none'; return; }
      const matches = _planSubjects.filter(s =>
        s.toLowerCase().includes(val.toLowerCase()) &&
        !(plan.items||[]).find(i => i.materia.toLowerCase() === s.toLowerCase())
      ).slice(0, 5);
      if (!matches.length) { acBox.style.display = 'none'; return; }
      acBox.innerHTML = matches.map(m =>
        `<div class="dp-ac-item" tabindex="0">${escapeHtml(m)}</div>`
      ).join('');
      acBox.style.display = 'block';
      acBox.querySelectorAll('.dp-ac-item').forEach(item => {
        item.addEventListener('mousedown', e => {
          e.preventDefault();
          input.value = item.textContent;
          acBox.style.display = 'none';
          addItem();
        });
      });
    }

    if (input) {
      input.addEventListener('input', () => showAc(input.value));
      input.addEventListener('blur', () => setTimeout(() => { acBox.style.display = 'none'; }, 150));
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); addItem(); }
      });
    }

    async function addItem() {
      const val = input ? input.value.trim() : '';
      if (!val) return;
      if ((plan.items || []).find(i => i.materia.toLowerCase() === val.toLowerCase())) {
        input.value = ''; return;
      }
      const newItem = { id: Date.now().toString(), materia: val, done: false, doneAt: null };
      const newItems = [...(plan.items || []), newItem];
      await bgMsg({ type: 'DAILY_PLAN_SAVE', items: newItems });
      plan.items = newItems;
      if (input) input.value = '';
      if (acBox) acBox.style.display = 'none';
      renderDailyPlan(plan);
      // Focus back on input
      const newInput = $('dp-input');
      if (newInput) newInput.focus();
    }

    if (addBtn) addBtn.addEventListener('click', addItem);
  }

  async function loadDailyPlan() {
    const resp = await bgMsg({ type: 'DAILY_PLAN_GET' });
    if (resp) renderDailyPlan(resp, appData ? appData.subjectStats : []);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HUBERMAN MANUAL (timer livre 5/9/11/custom)
  // ═══════════════════════════════════════════════════════════════════════════

  function renderManHubSection(t) {
    const el = $('man-hub-section');
    if (!el) return;
    if (t && t.running) {
      const remM = Math.floor(t.remaining / 60);
      const remS = t.remaining % 60;
      el.innerHTML = `
        <div style="background:linear-gradient(135deg,rgba(109,40,217,.08),rgba(15,18,32,.6));border:1px solid rgba(139,92,246,.25);border-radius:10px;padding:11px;margin-bottom:10px;">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:7px;">
            <span style="font-size:11px;font-weight:800;color:#a78bfa;letter-spacing:.6px;">🧠 HUBERMAN — ${escapeHtml(t.label)}</span>
          </div>
          <div style="font-family:'SF Mono','Courier New',monospace;font-size:22px;font-weight:800;color:#e2e8f0;text-align:center;margin-bottom:8px;">
            ${remM.toString().padStart(2,'0')}:${remS.toString().padStart(2,'0')}
          </div>
          <div style="display:flex;gap:5px;">
            <button class="hub-btn ok"   data-action="man-hub-result" data-remembered="1">✓ Lembrei</button>
            <button class="hub-btn fail" data-action="man-hub-result" data-remembered="0">✕ Esqueci</button>
            <button class="hub-btn dis"  data-action="man-hub-cancel">⏹ Cancelar</button>
          </div>
        </div>`;
    } else {
      el.innerHTML = `
        <div style="background:#0f1220;border:1px solid rgba(139,92,246,.18);border-radius:10px;padding:10px;margin-bottom:10px;">
          <div style="font-size:10px;font-weight:800;color:#a78bfa;letter-spacing:.6px;margin-bottom:7px;">🧠 INICIAR REVISÃO MANUAL</div>
          <div style="display:flex;gap:5px;">
            <button class="hub-btn open" data-action="man-hub-start" data-mins="5"  data-label="5 min">5min</button>
            <button class="hub-btn open" data-action="man-hub-start" data-mins="9"  data-label="9 min">9min</button>
            <button class="hub-btn open" data-action="man-hub-start" data-mins="11" data-label="11 min">11min</button>
          </div>
        </div>`;
    }
  }

  async function manHubStart(mins, label) {
    _manHubLabel = label || (mins + ' min');
    const resp = await bgMsg({ type: 'MANUAL_HUB_START', mins, label: _manHubLabel });
    if (resp && resp.timer) {
      renderManHubSection(resp.timer);
      if (_manHubLocal) clearInterval(_manHubLocal);
      _manHubLocal = setInterval(async () => {
        const t = await bgMsg({ type: 'MANUAL_HUB_GET' });
        if (!t || !t.running) {
          clearInterval(_manHubLocal); _manHubLocal = null;
          renderManHubSection({ running: false });
        } else renderManHubSection(t);
      }, 1000);
    }
  }

  async function manHubCancel() {
    await bgMsg({ type: 'MANUAL_HUB_CANCEL' });
    if (_manHubLocal) { clearInterval(_manHubLocal); _manHubLocal = null; }
    renderManHubSection({ running: false });
  }

  async function manHubResult(remembered) {
    await bgMsg({ type: 'HUB_REVIEW_RESULT', label: _manHubLabel, remembered: !!remembered });
    await manHubCancel();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FATIGUE ALERT
  // ═══════════════════════════════════════════════════════════════════════════

  function renderFatigueAlert(recentResults, todayStats) {
    const el = $('fatigue-alert-pop');
    if (!el) return;
    const total = (todayStats.acertos || 0) + (todayStats.erros || 0);
    if (total < 6 || !recentResults || recentResults.length < 5) { el.style.display = 'none'; return; }
    const overall = (todayStats.acertos || 0) / total;
    const last5 = recentResults.slice(-5);
    const recentRate = last5.filter(r => r === 'correct').length / 5;
    if (overall >= 0.58 && recentRate <= 0.35) {
      el.textContent = `⚠️ Queda de rendimento — últimas 5 questões: ${Math.round(recentRate * 100)}% (geral: ${Math.round(overall * 100)}%). Pause 5-10 min.`;
      el.style.display = 'block';
    } else el.style.display = 'none';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GRÁFICO POR HORA DO DIA
  // ═══════════════════════════════════════════════════════════════════════════

  function hrPopMode(mode) {
    _hrPopMode = mode;
    const b1 = $('hr-btn-q'), b2 = $('hr-btn-rate');
    if (b1) { b1.style.background = mode === 'q' ? 'rgba(74,108,247,.15)' : 'transparent';
              b1.style.color      = mode === 'q' ? '#6366f1' : '#475569'; }
    if (b2) { b2.style.background = mode === 'rate' ? 'rgba(74,108,247,.15)' : 'transparent';
              b2.style.color      = mode === 'rate' ? '#6366f1' : '#475569'; }
    if (appData) renderHourlyChart(appData.hourlyStats);
  }

  function renderHourlyChart(hourlyStats) {
    const el = $('hourly-chart');
    if (!el) return;
    if (!hourlyStats || !hourlyStats.length) { el.innerHTML = ''; return; }
    const isRate = _hrPopMode === 'rate';
    const buckets = hourlyStats.map((h, i) => ({
      h: i, q: h.q || 0, rate: h.q > 0 ? Math.round(h.ace / h.q * 100) : null,
    }));
    const vals = buckets.map(b => isRate ? (b.rate !== null ? b.rate : 0) : b.q);
    const maxV = Math.max(1, ...vals);
    let html = '<div style="display:flex;align-items:flex-end;gap:1.5px;height:50px;background:#141728;border:1px solid rgba(255,255,255,.05);border-radius:7px;padding:5px 4px;">';
    buckets.forEach(b => {
      const v = isRate ? (b.rate !== null ? b.rate : 0) : b.q;
      const h = Math.max(2, Math.round(v / maxV * 40));
      const c = b.q === 0 ? '#2a2f47' : isRate
        ? (b.rate >= 70 ? '#22c55e' : b.rate >= 50 ? '#f59e0b' : '#ef4444')
        : '#6366f1';
      const title = `${b.h}h · ${b.q} Q · ${b.rate !== null ? b.rate + '%' : '—'}`;
      html += `<div style="flex:1;height:${h}px;background:${c};border-radius:1px;" title="${title}"></div>`;
    });
    html += '</div>';
    el.innerHTML = html;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GRÁFICO SEMANAL — VERSÃO RICA
  // ═══════════════════════════════════════════════════════════════════════════

  let _wcMode = 'both';   // 'q' | 'rate' | 'both'
  let _wcData = null;

  function wcSetMode(m) {
    _wcMode = m;
    ['wc-tab-q','wc-tab-rate','wc-tab-both'].forEach(id => {
      const el = $(id);
      if (!el) return;
      const active = id === 'wc-tab-' + m;
      el.style.background = active ? 'rgba(56,189,248,.18)' : 'transparent';
      el.style.color       = active ? '#38bdf8' : '#475569';
    });
    if (_wcData) renderWeekChart(_wcData);
  }

  function accColorWc(taxa, hasData) {
    if (!hasData) return '#2a2f47';
    if (taxa >= 70) return '#22c55e';
    if (taxa >= 50) return '#f59e0b';
    return '#ef4444';
  }

  function renderWeekChart(weekStats) {
    _wcData = weekStats;
    const el = $('week-chart');
    if (!el) return;
    if (!weekStats || !weekStats.length) { el.innerHTML = ''; return; }

    const todayStr = new Date().toISOString().split('T')[0];
    const maxQ   = Math.max(1, ...weekStats.map(d => d.resolved));
    const totalQ = weekStats.reduce((s, d) => s + d.resolved, 0);
    const days   = weekStats.filter(d => d.resolved > 0);
    const avgRate= days.length ? Math.round(days.reduce((s, d) => s + d.taxa, 0) / days.length) : 0;
    const bestDay= days.length ? days.reduce((a, b) => b.resolved > a.resolved ? b : a) : null;
    const streak = (() => {
      let s = 0;
      for (let i = weekStats.length - 1; i >= 0; i--) {
        if (weekStats[i].resolved > 0) s++;
        else break;
      }
      return s;
    })();

    // ── SVG chart ────────────────────────────────────────────────────────────
    const W = 340, H = 120;
    const padL = 6, padR = 6, padT = 18, padB = 22;
    const chartW = W - padL - padR;
    const chartH = H - padT - padB;
    const barW   = Math.floor(chartW / 7) - 4;
    const gap    = Math.floor(chartW / 7);

    const mode = _wcMode;

    // Y-grid lines (3 horizontal)
    let gridLines = '';
    for (let i = 1; i <= 3; i++) {
      const y = padT + chartH - (chartH * i / 3);
      gridLines += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="rgba(255,255,255,.04)" stroke-width="1"/>`;
    }

    // Bars + line for taxa
    let bars = '', labels = '', linePoints = '', dotCircles = '';
    weekStats.forEach((d, i) => {
      const cx   = padL + i * gap + gap / 2;
      const isToday = d.date === todayStr;
      const hasQ = d.resolved > 0;

      // Bar height (questões)
      const barH = hasQ ? Math.max(4, Math.round(d.resolved / maxQ * chartH)) : 2;
      const barX = cx - barW / 2;
      const barY = padT + chartH - barH;
      const barColor = accColorWc(d.taxa, hasQ);

      if (mode === 'q' || mode === 'both') {
        // Bar glow for today
        if (isToday && hasQ) {
          bars += `<rect x="${barX - 1}" y="${barY - 1}" width="${barW + 2}" height="${barH + 1}" rx="4" fill="${barColor}" opacity="0.18"/>`;
        }
        bars += `<rect x="${barX}" y="${barY}" width="${barW}" height="${barH}" rx="3" fill="${barColor}" opacity="${isToday ? '1' : '0.78'}"/>`;
        // Q count above bar
        if (hasQ && barH > 10) {
          bars += `<text x="${cx}" y="${barY + barH / 2 + 4}" text-anchor="middle" font-size="8" font-weight="700" fill="rgba(0,0,0,0.7)">${d.resolved}</text>`;
        } else if (hasQ) {
          bars += `<text x="${cx}" y="${barY - 3}" text-anchor="middle" font-size="8" font-weight="700" fill="${barColor}">${d.resolved}</text>`;
        }
      }

      // Rate line overlay
      if ((mode === 'rate' || mode === 'both') && hasQ) {
        const ry = padT + chartH - Math.round(d.taxa / 100 * chartH);
        linePoints += `${cx},${ry} `;
        dotCircles += `<circle cx="${cx}" cy="${ry}" r="2.5" fill="${barColor}" stroke="#0f1117" stroke-width="1.5"/>`;
        if (mode === 'rate') {
          bars += `<rect x="${barX}" y="${ry}" width="${barW}" height="${padT + chartH - ry}" rx="3" fill="${barColor}" opacity="0.55"/>`;
          bars += `<text x="${cx}" y="${ry - 4}" text-anchor="middle" font-size="8" font-weight="700" fill="${barColor}">${d.taxa}%</text>`;
        }
      }

      // Day label
      const labelColor = isToday ? '#38bdf8' : '#475569';
      const labelWeight = isToday ? '800' : '600';
      labels += `<text x="${cx}" y="${H - 4}" text-anchor="middle" font-size="9" font-weight="${labelWeight}" fill="${labelColor}">${d.label}</text>`;
      // Today dot indicator
      if (isToday) {
        labels += `<circle cx="${cx}" cy="${H - 15}" r="1.5" fill="#38bdf8"/>`;
      }
    });

    // Taxa polyline
    let polyline = '';
    if ((mode === 'rate' || mode === 'both') && linePoints.trim()) {
      polyline = `<polyline points="${linePoints.trim()}" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="1.2" stroke-dasharray="3,2"/>`;
    }

    const svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="overflow:visible">
      ${gridLines}
      ${bars}
      ${polyline}
      ${dotCircles}
      ${labels}
    </svg>`;

    // ── Summary cards ─────────────────────────────────────────────────────────
    const rateColor = avgRate >= 70 ? '#22c55e' : avgRate >= 50 ? '#f59e0b' : '#ef4444';
    const summaryCards = [
      { label: 'QUESTÕES', value: totalQ, color: '#38bdf8' },
      { label: 'TAXA MÉDIA', value: days.length ? avgRate + '%' : '—', color: rateColor },
      { label: 'MELHOR DIA', value: bestDay ? bestDay.resolved : '—', color: '#a78bfa' },
      { label: 'SEQUÊNCIA', value: streak + 'd', color: streak >= 3 ? '#f97316' : '#475569' },
    ];
    const cardsHtml = summaryCards.map(c => `
      <div class="wc-sum-card">
        <div class="wc-sum-val" style="color:${c.color}">${c.value}</div>
        <div class="wc-sum-lbl">${c.label}</div>
      </div>`).join('');

    // ── Tabs ──────────────────────────────────────────────────────────────────
    const makeTab = (id, label, mode_val) => {
      const active = _wcMode === mode_val;
      return `<button id="${id}" class="wc-tab"
        style="background:${active ? 'rgba(56,189,248,.18)' : 'transparent'};color:${active ? '#38bdf8' : '#475569'};"
        >${label}</button>`;
    };

    el.innerHTML = `
      <div class="wc-header">
        <span class="wc-title">📊 PRODUTIVIDADE SEMANAL</span>
        <div class="wc-tabs">
          ${makeTab('wc-tab-q', 'Q', 'q')}
          ${makeTab('wc-tab-rate', '%', 'rate')}
          ${makeTab('wc-tab-both', '▦', 'both')}
        </div>
      </div>
      <div class="wc-chart-wrap">${svg}</div>
      <div class="wc-summary">${cardsHtml}</div>
    `;

    // Bind tabs
    ['wc-tab-q','wc-tab-rate','wc-tab-both'].forEach(id => {
      const btn = $(id);
      if (btn) btn.onclick = () => wcSetMode(id.replace('wc-tab-',''));
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIORIDADE DE MATÉRIAS
  // ═══════════════════════════════════════════════════════════════════════════

  function renderPriorityList(subjects) {
    const el = $('priority-list');
    if (!el) return;
    if (!subjects || subjects.length < 2) { el.innerHTML = ''; return; }
    const withRate = subjects.map(s => ({ ...s,
      erroRate: s.total > 0 ? Math.round(s.erros / s.total * 100) : 0,
    }));
    withRate.sort((a, b) => b.erroRate - a.erroRate);
    const top3 = withRate.filter(s => s.total >= 5).slice(0, 3);
    const best = [...withRate].reverse().find(s => s.total >= 5);

    let html = '<div class="pri-title">🎯 PRIORIDADE</div>';
    top3.forEach(s => {
      const taxaAcerto = 100 - s.erroRate;
      html += `<div class="pri-row">
        <span class="pri-badge atencao">ATENÇÃO</span>
        <span class="pri-name" title="${escapeHtml(s.materia)}">${escapeHtml(s.materia)}</span>
        <span class="pri-pct" style="color:#ef4444;">${taxaAcerto}%</span>
      </div>`;
    });
    if (best && !top3.find(s => s.materia === best.materia)) {
      const taxa = 100 - best.erroRate;
      html += `<div class="pri-row">
        <span class="pri-badge dominando">DOMINANDO</span>
        <span class="pri-name" title="${escapeHtml(best.materia)}">${escapeHtml(best.materia)}</span>
        <span class="pri-pct" style="color:#22c55e;">${taxa}%</span>
      </div>`;
    }
    el.innerHTML = html;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PREDIÇÃO DE APROVAÇÃO
  // ═══════════════════════════════════════════════════════════════════════════

  function renderAprovacao(todayStats, settings) {
    const el = $('aprovacao-bar');
    if (!el) return;
    const resolved = todayStats.resolved || 0;
    if (resolved === 0) {
      el.innerHTML = '';
      el.style.display = 'none';
      return;
    }
    el.style.display = 'block';

    const target = (settings && settings.targetRate) || 70;
    const taxa = pct(todayStats.acertos || 0, resolved);
    const fillPct = Math.min(100, Math.round(taxa / target * 100));
    const fillColor = taxa >= 85 ? '#22c55e' : taxa >= target ? '#6366f1' : taxa >= 50 ? '#f59e0b' : '#ef4444';

    let status = '';
    if      (taxa < 50)     status = `<span style="color:#ef4444">🔴 Em risco</span>`;
    else if (taxa < target) status = `<span style="color:#f59e0b">🟡 Em desenvolvimento</span>`;
    else if (taxa < 85)     status = `<span style="color:#22c55e">🟢 Aprovável</span>`;
    else                    status = `<span style="color:#6366f1">🏆 Excelente!</span>`;

    el.innerHTML = `
      <div class="aprov-label">
        <span>Predição de Aprovação</span>
        <span>Meta: ${target}% · Atual: ${taxa}%</span>
      </div>
      <div class="aprov-track">
        <div class="aprov-fill" style="width:${fillPct}%;background:${fillColor};"></div>
        <div class="aprov-target-line" style="left:100%;">
          <span class="aprov-target-lbl">${target}%</span>
        </div>
      </div>
      <div class="aprov-status">${status}</div>`;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CALENDÁRIO MINI (HOJE)
  // ═══════════════════════════════════════════════════════════════════════════

  function renderCalMini(calendar) {
    const el = $('cal-mini');
    if (!el) return;
    if (!calendar || !calendar.length) {
      el.innerHTML = '<div style="font-size:10px;color:#475569;padding:6px;">Sem revisões agendadas.</div>';
      return;
    }
    const today = todayKey();
    el.innerHTML = calendar.map((d, i) => {
      const n = d.items.length;
      const cls = i === 0 && d.date === today ? 'cal-day today'
                : n > 0 ? 'cal-day has' : 'cal-day';
      const cntCls = n === 0 ? 'cal-cnt zero' : 'cal-cnt';
      const label  = i === 0 ? 'Hoje' : d.dow;
      return `<div class="${cls}" title="${d.date} · ${n} revisão(ões)">
        <div class="cal-dow">${label}</div>
        <div class="${cntCls}">${n}</div>
      </div>`;
    }).join('');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER: HOJE
  // ═══════════════════════════════════════════════════════════════════════════

  function renderHoje(data) {
    const today = data.todayStats || {};
    const global = data.globalStats || {};
    const settings = data.settings || {};
    const goal = (settings.smartGoal && data.smartGoal) ? data.smartGoal : (settings.dailyGoal || 30);

    // Streak
    setEl('streak-badge', `🔥 ${global.streak || 0}d`);

    // Smart goal badge
    const sgBadge = $('goal-smart-badge');
    if (sgBadge) sgBadge.classList.toggle('hidden', !(settings.smartGoal && data.smartGoal));

    // Meta
    const resolved = today.resolved || 0;
    const goalPct  = Math.min(100, Math.round(resolved / goal * 100));
    setEl('goal-progress', `${resolved} / ${goal}`);
    const fill = $('goal-fill');
    if (fill) {
      fill.style.width = goalPct + '%';
      // Feature 3: cor dinâmica da barra conforme progresso
      const barColor = goalPct >= 100 ? '#22c55e'       // verde — meta atingida
                     : goalPct >= 75  ? '#84cc16'        // verde-lima — quase lá
                     : goalPct >= 50  ? '#f59e0b'        // âmbar — metade
                     : goalPct >= 25  ? '#fb923c'        // laranja — começando
                     :                  'var(--accent)'; // azul padrão
      fill.style.background = `linear-gradient(90deg, ${barColor}cc, ${barColor})`;
      fill.style.boxShadow  = goalPct > 0 ? `0 0 10px ${barColor}66` : 'none';
    }
    // Feature 3: texto "X faltam" ou "✓ Meta atingida!"
    const goalRem = $('goal-remaining');
    if (goalRem) {
      const rem = Math.max(0, goal - resolved);
      goalRem.textContent = goalPct >= 100 ? '✓ Meta atingida!' : `${rem} faltam`;
      goalRem.style.color = goalPct >= 100 ? '#22c55e' : 'var(--text-faint)';
    }
    // Feature 3: efeito de celebração ao atingir 100%
    if (goalPct >= 100 && !fill.dataset.celebrated) {
      fill.dataset.celebrated = '1';
      fill.style.transition = 'width 500ms cubic-bezier(0.16, 1, 0.3, 1), background 800ms ease, box-shadow 800ms ease';
      setTimeout(() => { fill.style.boxShadow = '0 0 20px #22c55e99'; }, 200);
      setTimeout(() => { fill.style.boxShadow = '0 0 8px #22c55e66'; }, 1000);
    } else if (goalPct < 100) {
      delete fill.dataset.celebrated;
    }

    // Stats
    setEl('d-resolved', fmt(resolved));
    setEl('d-acertos',  fmt(today.acertos));
    setEl('d-erros',    fmt(today.erros));

    // Taxa
    const taxa = pct(today.acertos || 0, resolved);
    const arc = $('ring-arc'), ringPct = $('ring-pct'), ringSub = $('ring-sub');
    const circumf = 138.2;
    if (arc) {
      if (resolved > 0) {
        arc.style.visibility = 'visible';
        arc.style.strokeDashoffset = circumf - (circumf * taxa / 100);
        arc.style.stroke = accColor(taxa);
      } else {
        arc.style.visibility = 'hidden';
      }
    }
    if (ringPct) {
      ringPct.style.color = resolved > 0 ? accColor(taxa) : 'var(--text-faint)';
      ringPct.textContent = resolved > 0 ? taxa + '%' : '—';
    }
    if (ringSub) ringSub.textContent = resolved > 0
      ? `${today.acertos || 0} acertos · ${today.erros || 0} erros hoje`
      : 'Resolva questões no TEC para começar a rastrear.';

    // Aprovação
    renderAprovacao(today, settings);

    // Matérias
    const subjects = data.subjectStats || [];
    const subjList = $('subj-list');
    if (subjList) {
      if (!subjects.length) {
        subjList.innerHTML = '<div style="font-size:11px;color:#374151;text-align:center;padding:12px 0;">Nenhuma matéria registrada ainda.</div>';
      } else {
        const maxTotal = Math.max(...subjects.map(s => s.total));
        subjList.innerHTML = subjects.slice(0, 7).map(s => {
          const p = pct(s.acertos, s.total);
          return `<div class="subj-row">
            <span class="subj-name" title="${escapeHtml(s.materia)}">${escapeHtml(s.materia)}</span>
            <div class="subj-bar"><div class="subj-bar-fill" style="width:${Math.round(s.total/maxTotal*100)}%;background:${accColor(p)};"></div></div>
            <span class="subj-pct" style="color:${accColor(p)}">${p}%</span>
          </div>`;
        }).join('');
      }
    }

    renderPriorityList(subjects);
    renderWeekChart(data.weekStats);
    renderHourlyChart(data.hourlyStats);
    renderFatigueAlert(data.recentResults || [], today);
    renderManHubSection(data.manualHubTimer);
    if (data.pomodoro) initPomodoro(data.pomodoro);
    // Plano diário
    if (data.subjectStats) _planSubjects = (data.subjectStats || []).map(s => s.materia).filter(Boolean);
    loadDailyPlan();
    if (data.activeSession) {
      pomFocusSecs = data.activeSession.pomodoroFocusSecs || 0;
      renderPomFocus();
    }

    // Calendar mini (vem do GET_CALENDAR, carregado sob demanda)
    if (calendarData) renderCalMini(calendarData);

    // Activity card (carregado em paralelo via loadAll)
    if (activityData) renderActivityCard(activityData);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER: REVISÃO
  // ═══════════════════════════════════════════════════════════════════════════

  function simImpIcon(imp) {
    return imp === 3 ? '🔴' : imp === 2 ? '🟡' : '🟢';
  }

  // ─── Ícone de estratégia V4 ───────────────────────────────────────────────
  function strategyBadge(item) {
    const conf = item.v4_confidence;
    if (!conf && !item.estrategia) return '';
    const strats = item.v4_strategies || [];
    // Resumo legível das estratégias
    const labels = {
      tfidf:      'TF-IDF', gabarito: 'Gabarito', graph: 'Grafo',
      expand:     'Sinônimo', concept: 'Conceito', weakness: 'Fraqueza',
      stem:       'Radical', verb: 'Verbo', ngram: 'N-Gram', banca_year: 'Banca',
    };
    const readable = strats.slice(0, 3).map(s => labels[s] || s).join(' · ');
    const color = conf >= 5 ? '#4ade80' : conf >= 3 ? '#fbbf24' : '#94a3b8';
    return conf
      ? `<span class="sim-strategy-badge" title="Estratégias: ${strats.join(', ')}" style="color:${color};">⚡${conf}</span>`
      : `<span class="sim-strategy-badge" style="color:#64748b;">${readable || item.estrategia || ''}</span>`;
  }

  function simPanelHtml(related, qid, updatedAt) {
    // Sem resultados mas com qid: mostra botão de busca
    if (!related || !related.length) {
      if (!qid) return '';
      return `<div class="sim-panel sim-empty">
        <div class="sim-toggle-row">
          <span style="font-size:10px;color:#475569;">📎 Nenhuma similar encontrada</span>
          <button class="sim-recalc-btn" data-action="recalc-similar"
            data-qid="${escapeHtml(qid)}" title="Buscar questões similares">
            🔍 Buscar Similares
          </button>
        </div>
      </div>`;
    }

    const scoreDisplay = r => {
      const s = r.v4_score != null ? r.v4_score : (r.score || 0);
      return Math.round(Math.min(s, 99));
    };

    const itemsHtml = related.map(r => {
      const url = r.url || '';

      // Badge de match (tipo de similaridade)
      const matchBadge = r.matchType === 'enun+alts'
        ? '<span class="sim-match-badge sim-match-full" title="Enunciado + alternativas similares">📝+📋</span>'
        : r.matchType === 'enun'
        ? '<span class="sim-match-badge sim-match-enun" title="Enunciado similar">📝</span>'
        : r.matchType === 'principal'
        ? '<span class="sim-match-badge sim-match-concept" title="Mesmo conceito">💡</span>'
        : r.matchType === 'relacionado'
        ? '<span class="sim-match-badge sim-match-related" title="Conceito relacionado">🔗</span>'
        : '';

      // Badge de biblioteca PDF
      const libBadge = r.fromPDF
        ? `<span class="sim-biblio-badge" title="Da biblioteca PDF: ${escapeHtml(r.pdfSource || '')}">📥</span>`
        : '';

      // Info de banca/ano
      const bancaInfo = (r.banca || r.ano)
        ? `<span class="sim-banca-info">${escapeHtml(r.banca || '')}${r.ano ? ' ' + r.ano : ''}</span>`
        : '';

      // Badge de estratégia V4
      const stBadge = strategyBadge(r);

      // Preview do enunciado (se disponível)
      const enuncPreview = r.enunciado
        ? `<div class="sim-enunciado" title="${escapeHtml(r.enunciado)}">${escapeHtml(r.enunciado.slice(0, 90))}${r.enunciado.length > 90 ? '…' : ''}</div>`
        : '';

      // Gabarito badge
      const gabBadge = r.gabarito
        ? `<span class="sim-gabarito-badge">✔ ${escapeHtml(r.gabarito)}</span>`
        : '';

      return `<div class="sim-item" data-qid="${escapeHtml(r.qid || '')}">
        <span class="sim-imp">${simImpIcon(r.importance)}</span>
        <div class="sim-body">
          <div class="sim-assunto-row">
            <span class="sim-assunto">${escapeHtml((r.assunto || r.materia || '—').slice(0, 28))}</span>
            ${matchBadge}${libBadge}${bancaInfo}${stBadge}${gabBadge}
          </div>
          <div class="sim-desc" title="${escapeHtml(r.desc || '')}">${escapeHtml((r.desc || r.qid || '').slice(0, 55))}</div>
          ${enuncPreview}
          <div class="sim-stats">
            <span class="sim-stat-ok">✅ ${r.acertos || 0}</span>
            <span class="sim-stat-err">❌ ${r.erros || 0}</span>
            <span class="sim-stat-score" title="Pontuação de similaridade">◆ ${scoreDisplay(r)}%</span>
            ${r.matchReason ? `<span class="sim-reason" title="${escapeHtml(r.matchReason)}">💬</span>` : ''}
          </div>
        </div>
        ${url ? `<button class="sim-open" data-action="open-question" data-url="${escapeHtml(url)}" title="Abrir questão">↗</button>` : ''}
      </div>`;
    }).join('');

    const allUrls = related.filter(r => r.url).map(r => r.url);
    const blockBtn = allUrls.length > 1
      ? `<button class="sim-block-btn" data-action="open-sim-block" data-urls="${escapeHtml(encodeURIComponent(JSON.stringify(allUrls)))}">🔗 Revisar bloco (${allUrls.length} questões)</button>`
      : '';

    const updatedStr = updatedAt
      ? `<span class="sim-updated-at" title="Último cálculo">🕐 ${new Date(updatedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>`
      : '';

    const recalcBtn = qid
      ? `<button class="sim-recalc-btn" data-action="recalc-similar" data-qid="${escapeHtml(qid)}" title="Recalcular com 17 técnicas">🔄</button>`
      : '';

    return `<div class="sim-panel">
      <div class="sim-toggle" data-action="toggle-similar">
        <span>📎 ${related.length} similar(es)</span>
        <span class="sim-header-right">${updatedStr}${recalcBtn}<span data-role="arrow" class="sim-arrow">▶</span></span>
      </div>
      <div data-role="sim-body" style="display:none;">
        <div class="sim-list">${itemsHtml}</div>
        ${blockBtn}
      </div>
    </div>`;
  }

  function retentionBadge(retention) {
    if (retention == null) return '';
    const pctV = Math.round(retention * 100);
    const cls = retention >= 0.7 ? 'ret-high' : retention >= 0.4 ? 'ret-mid' : 'ret-low';
    return `<span class="badge ${cls}" title="Predição de retenção SM-2">🧠 ${pctV}%</span>`;
  }

  function notesTagsHtml(qid, notes, tags) {
    const note     = (notes && notes[qid]) || '';
    const tagsList = (tags && tags[qid]) || [];
    const tagsView = tagsList.length
      ? `<div style="margin-bottom:5px;"><span class="qcard-tagline">TAGS:</span>${tagsList.map(t => `<span class="qcard-tag">${escapeHtml(t)}</span>`).join('')}</div>`
      : '';
    return `<div class="qcard-extra">
      ${tagsView}
      <div class="qcard-extra-row">
        <input class="qcard-inp" data-role="note-inp" data-qid="${escapeHtml(qid)}" placeholder="Anotação..." value="${escapeHtml(note)}" maxlength="500">
        <button class="qcard-inp-btn" data-action="save-note" data-qid="${escapeHtml(qid)}">💾</button>
      </div>
      <div class="qcard-extra-row">
        <input class="qcard-inp" data-role="tag-inp" data-qid="${escapeHtml(qid)}" placeholder="tag1, tag2..." maxlength="200">
        <button class="qcard-inp-btn" data-action="save-tag" data-qid="${escapeHtml(qid)}">+ tag</button>
      </div>
    </div>`;
  }

  function qCardHtml(q, sessionMode, notes, tags) {
    const today  = todayKey();
    const isDue  = !q.nextReview || q.nextReview <= today;
    const errBadge  = q.errorCount ? `<span class="badge err">✕ ${q.errorCount}x</span>` : '';
    const dateBadge = sessionMode
      ? `<span class="badge due-now">🔴 Esta sessão</span>`
      : isDue
        ? `<span class="badge due-now">⏰ Revisar hoje</span>`
        : `<span class="badge future">📅 ${fmtDate(q.nextReview)}</span>`;
    const difBadge = q.dificuldade ? `<span class="badge dif">${escapeHtml(q.dificuldade)}</span>` : '';
    const simBadge = q.relatedQuestions?.length
      ? `<span class="badge" style="background:rgba(99,102,241,.15);color:#818cf8;">📎 ${q.relatedQuestions.length} similares</span>`
      : '';
    const semBadge = q.semanticConcepts?.concepts?.length
      ? `<span class="badge" style="background:rgba(34,197,94,.1);color:#4ade80;" title="${escapeHtml(q.semanticConcepts.concepts.slice(0,3).join(', '))}">🤖 ${q.semanticConcepts.concepts.length} conceitos</span>`
      : '';
    const retBadge = retentionBadge(q.retention);
    const desc = escapeHtml((q.desc || ('Questão #' + q.qid)).slice(0, 55));
    const url  = escapeHtml(q.url || '');
    const assuntoHtml = q.assunto ? `<div style="font-size:9px;color:#6366f1;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(q.assunto)}</div>` : '';

    return `<div class="qcard ${isDue || sessionMode ? 'due' : ''}">
      <div class="qcard-top">
        <div class="qcard-icon wrong">✕</div>
        <div class="qcard-meta">
          <div class="qcard-mat">${escapeHtml(q.materia || 'Matéria')}</div>
          ${assuntoHtml}
          <div class="qcard-desc" title="${escapeHtml(q.desc || '')}">${desc}</div>
        </div>
      </div>
      <div class="qcard-badges">${errBadge}${dateBadge}${difBadge}${retBadge}${simBadge}${semBadge}</div>
      <div class="qcard-btns">
        <button class="qbtn review"  data-action="open-question" data-url="${url}">📖 Abrir</button>
        <button class="qbtn errei"   data-action="mark-review" data-qid="${escapeHtml(q.qid)}" data-quality="1" title="Alt+1">✕ Errei</button>
        <button class="qbtn acertei" data-action="mark-review" data-qid="${escapeHtml(q.qid)}" data-quality="4" title="Alt+2">✓ Difícil</button>
        <button class="qbtn acertei" data-action="mark-review" data-qid="${escapeHtml(q.qid)}" data-quality="5" title="Alt+3" style="background:rgba(34,197,94,.25);">✓✓ Fácil</button>
      </div>
      ${notesTagsHtml(q.qid, notes, tags)}
      ${simPanelHtml(q.relatedQuestions, q.qid, q.relatedUpdatedAt)}
    </div>`;
  }

  // Huberman cards (na revisão)
  function renderHubSection(hubItems) {
    const wrap = $('hub-section-wrap');
    if (!wrap) return;
    if (!hubItems || !hubItems.length) { wrap.innerHTML = ''; return; }
    const cards = hubItems.map(h => {
      const isDue = h.isDue;
      const cdClass = isDue ? 'ready' : 'waiting';
      const cdText  = isDue ? '⚡ REVISAR AGORA' : `⏱ ${fmtRemaining(h.remaining)}`;
      const dots = [1, 2, 3].map(p => {
        if (h.customMins != null) return `<span class="hub-dot custom" title="Custom"></span>`;
        if (p < h.phase)  return `<span class="hub-dot done"></span>`;
        if (p === h.phase) return `<span class="hub-dot active"></span>`;
        return `<span class="hub-dot"></span>`;
      }).join('');
      const phaseLbl = h.customMins != null
        ? `${h.customMins}min (custom)`
        : `Fase ${h.phase}/3 · ${[5,9,11][h.phase-1]}min`;
      return `<div class="hub-card ${isDue ? 'due-now' : ''}">
        <div class="hub-mat">${escapeHtml(h.materia || 'Geral')}</div>
        <div class="hub-desc" title="${escapeHtml(h.desc || '')}">${escapeHtml((h.desc || '').slice(0, 50))}</div>
        <div class="hub-phases">${dots}<span class="hub-phase-lbl">${phaseLbl}</span></div>
        <div class="hub-countdown ${cdClass}" data-hub-cd="${escapeHtml(h.qid)}">${cdText}</div>
        <div class="hub-btns">
          <button class="hub-btn open" data-action="hub-open"    data-url="${escapeHtml(h.url || '')}">📖 Abrir</button>
          <button class="hub-btn ok"   data-action="hub-correct" data-qid="${escapeHtml(h.qid)}">✓ OK</button>
          <button class="hub-btn fail" data-action="hub-wrong"   data-qid="${escapeHtml(h.qid)}">✕ Errei</button>
          <button class="hub-btn dis"  data-action="hub-dismiss" data-qid="${escapeHtml(h.qid)}">×</button>
        </div>
      </div>`;
    }).join('');
    const customRow = `<div class="hub-custom">
      <span class="hub-custom-lbl">⏱ Intervalo:</span>
      <input class="hub-custom-inp" id="hub-custom-mins" type="number" min="1" max="180" value="15">
      <button class="hub-custom-btn" data-action="hub-add-custom">+ Custom</button>
    </div>`;
    wrap.innerHTML = `<div class="hub-section">
      <div class="hub-title">🧠 MÉTODO HUBERMAN · ${hubItems.length} ativa(s)</div>
      ${cards}
      ${customRow}
    </div>`;
  }

  function populateFilterDropdowns(subjects, dueReviews) {
    const matSel = $('sim-filter-materia');
    const assSel = $('sim-filter-assunto');
    if (!matSel || !assSel) return;

    const mats = new Set();
    const allAss = new Map(); // mat -> Set(assunto)
    for (const q of dueReviews || []) {
      if (q.materia) mats.add(q.materia);
      if (q.materia && q.assunto) {
        if (!allAss.has(q.materia)) allAss.set(q.materia, new Set());
        allAss.get(q.materia).add(q.assunto);
      }
    }
    (subjects || []).forEach(s => { if (s.materia) mats.add(s.materia); });

    const cur = matSel.value;
    matSel.innerHTML = '<option value="">Todas</option>' +
      [...mats].sort().map(m => `<option value="${escapeHtml(m)}"${m === cur ? ' selected' : ''}>${escapeHtml(m)}</option>`).join('');

    const curM = matSel.value;
    const curA = assSel.value;
    const assOptions = curM && allAss.has(curM)
      ? [...allAss.get(curM)].sort()
      : [];
    assSel.innerHTML = '<option value="">Todos</option>' +
      assOptions.map(a => `<option value="${escapeHtml(a)}"${a === curA ? ' selected' : ''}>${escapeHtml(a)}</option>`).join('');
  }

  function renderRevisao(data) {
    const due       = data.dueReviews || [];
    const hub       = data.hubQueue   || [];
    const session   = data.activeSession;
    const dueQids   = new Set(due.map(q => q.qid));
    const sessionErrors = session && session.questions
      ? session.questions.filter(q => q.result === 'wrong' && q.qid && !dueQids.has(q.qid))
      : [];

    const notes = data.notes || {};
    const tags  = data.tags  || {};

    setEl('due-count', String(due.length + sessionErrors.length));
    renderRevPreAlert(data.preAlert);
    renderHubSection(hub);
    populateFilterDropdowns(data.subjectStats, due);

    const revList = $('rev-list');
    if (!revList) return;

    let html = '';
    if (sessionErrors.length) {
      html += `<div class="cluster-hdr">🔴 SESSÃO ATUAL · ${sessionErrors.length}</div>`;
      html += sessionErrors.map(q => qCardHtml(q, true, notes, tags)).join('');
    }

    if (due.length) {
      const clustered = data.clusteredReviews || [];
      if (clustered.length > 1) {
        for (const c of clustered) {
          if (c.items.length === 1) html += qCardHtml(c.items[0], false, notes, tags);
          else {
            html += `<div class="cluster-hdr">📚 ${escapeHtml(c.label)} (${c.items.length})</div>`;
            html += c.items.map(q => qCardHtml(q, false, notes, tags)).join('');
          }
        }
      } else {
        html += due.map(q => qCardHtml(q, false, notes, tags)).join('');
      }
    }

    if (!html) {
      html = `<div class="rev-empty"><div class="icon">🎉</div><p>Nenhuma revisão pendente!<br>Continue resolvendo questões.</p></div>`;
    }
    revList.innerHTML = html;
  }

  function renderRevPreAlert(preAlert) {
    const el = $('rev-prealert');
    if (!el) return;
    if (!preAlert || !preAlert.count) { el.style.display = 'none'; return; }
    el.style.display = '';
    el.innerHTML = `⚠️ <strong>${preAlert.count} questão(ões)</strong> de <em>${escapeHtml(preAlert.materia)}</em> aguardando revisão antes desta sessão.`;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER: INSIGHTS
  // ═══════════════════════════════════════════════════════════════════════════

  async function ensureInsightsData() {
    if (insightsData) return insightsData;
    insightsData = await bgMsg({ type: 'GET_INSIGHTS_DATA' });
    return insightsData || {};
  }

  async function ensureCalendarData() {
    if (calendarData) return calendarData;
    const r = await bgMsg({ type: 'GET_CALENDAR' });
    calendarData = (r && r.calendar) || [];
    return calendarData;
  }

  function renderInsightsList(insights) {
    const el = $('ins-list');
    if (!el) return;
    if (!insights || !insights.length) {
      el.innerHTML = '<div style="font-size:11px;color:#475569;padding:14px 6px;line-height:1.5;">Resolva mais questões para gerar insights personalizados sobre seu padrão de estudo.</div>';
      return;
    }
    el.innerHTML = insights.map(i => `
      <div class="ins-card">
        <span class="ins-icon">${i.icon || '💡'}</span>
        <span class="ins-text">${escapeHtml(i.text)}</span>
      </div>`).join('');
  }

  function renderWeeklyCompare(weekly) {
    const el = $('weekly-compare');
    if (!el) return;
    if (!weekly) { el.innerHTML = ''; return; }
    const dr   = weekly.deltaResolved || 0;
    const drT  = dr > 0 ? `+${dr}` : `${dr}`;
    const drCls = dr > 0 ? 'up' : dr < 0 ? 'dn' : 'eq';
    const drv  = weekly.deltaRate || 0;
    const drvT = drv > 0 ? `+${drv}pp` : `${drv}pp`;
    const drvCls = drv > 0 ? 'up' : drv < 0 ? 'dn' : 'eq';
    el.innerHTML = `
      <div class="wkc-row">
        <div class="wkc-card">
          <div class="wkc-lbl">ESTA SEMANA</div>
          <div class="wkc-val">${weekly.current.resolved}</div>
          <div class="wkc-sub">questões · ${weekly.current.rate}%</div>
        </div>
        <div class="wkc-card">
          <div class="wkc-lbl">ANTERIOR</div>
          <div class="wkc-val" style="color:#94a3b8;">${weekly.previous.resolved}</div>
          <div class="wkc-sub">questões · ${weekly.previous.rate}%</div>
        </div>
      </div>
      <div style="display:flex;gap:7px;">
        <div class="wkc-card" style="padding:7px 6px;">
          <span class="wkc-delta ${drCls}">${drT} questões</span>
        </div>
        <div class="wkc-card" style="padding:7px 6px;">
          <span class="wkc-delta ${drvCls}">${drvT} taxa</span>
        </div>
      </div>`;
  }

  function renderHeatmap(heatmap) {
    const el = $('heatmap-wrap');
    if (!el) return;
    if (!heatmap || !Object.keys(heatmap).length) {
      el.innerHTML = '<div style="font-size:11px;color:#475569;padding:8px 0;">Ainda sem dados — continue resolvendo!</div>';
      return;
    }
    const dows = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];

    // Encontra max para escalar opacidade
    let maxQ = 0;
    for (const v of Object.values(heatmap)) if (v.q > maxQ) maxQ = v.q;

    let cells = '<div class="hm-cell"></div>';
    for (let h = 0; h < 24; h++) cells += `<div class="hm-hd">${h % 6 === 0 ? h : ''}</div>`;

    for (let d = 0; d < 7; d++) {
      cells += `<div class="hm-dow">${dows[d]}</div>`;
      for (let h = 0; h < 24; h++) {
        const v = heatmap[`${d}_${h}`];
        if (!v || v.q === 0) {
          cells += `<div class="hm-cell" title="${dows[d]} ${h}h · sem dados"></div>`;
        } else {
          const rate = Math.round(v.ace / v.q * 100);
          const intensity = Math.min(1, v.q / Math.max(1, maxQ));
          // Cor: verde (alta taxa) para vermelho (baixa)
          const c = rate >= 70 ? `rgba(34,197,94,${0.25 + intensity * 0.75})`
                  : rate >= 50 ? `rgba(245,158,11,${0.25 + intensity * 0.75})`
                  :              `rgba(239,68,68,${0.25 + intensity * 0.75})`;
          cells += `<div class="hm-cell" style="background:${c};" title="${dows[d]} ${h}h · ${v.q} Q · ${rate}%">${v.q >= 5 ? v.q : ''}</div>`;
        }
      }
    }

    el.innerHTML = `
      <div class="hm-wrap"><div class="hm-tbl">${cells}</div></div>
      <div class="hm-legend">
        <span class="hm-legend-dot" style="background:rgba(239,68,68,.7);"></span><span>&lt;50%</span>
        <span class="hm-legend-dot" style="background:rgba(245,158,11,.7);margin-left:6px;"></span><span>50-70%</span>
        <span class="hm-legend-dot" style="background:rgba(34,197,94,.7);margin-left:6px;"></span><span>&gt;70%</span>
      </div>`;
  }

  function renderForgettingCurve(buckets) {
    const el = $('forgetting-curve');
    if (!el) return;
    if (!buckets || !buckets.every) { el.innerHTML = ''; return; }
    const hasAny = buckets.some(b => b.n > 0);
    if (!hasAny) {
      el.innerHTML = '<div style="font-size:11px;color:#475569;padding:8px 0;">Faça revisões SM-2 para gerar a curva.</div>';
      return;
    }
    const bars = buckets.map(b => {
      if (b.rate == null || b.n === 0) {
        return `<div class="fc-bar-wrap">
          <div class="fc-pct" style="color:#475569;">—</div>
          <div class="fc-bar-bg"><div class="fc-bar empty" style="height:5%"></div></div>
          <div class="fc-lbl">${b.label}</div>
          <div class="fc-n">${b.n}</div>
        </div>`;
      }
      return `<div class="fc-bar-wrap">
        <div class="fc-pct">${b.rate}%</div>
        <div class="fc-bar-bg"><div class="fc-bar" style="height:${b.rate}%"></div></div>
        <div class="fc-lbl">${b.label}</div>
        <div class="fc-n">${b.n}</div>
      </div>`;
    }).join('');
    el.innerHTML = `<div class="fc-wrap">${bars}</div>
      <div style="font-size:9.5px;color:#475569;margin-top:5px;text-align:center;">% de acerto em revisões agrupado por dias desde a última revisão</div>`;
  }

  function renderInterleaving(suggestion) {
    const el = $('interleaving');
    if (!el) return;
    if (!suggestion || !suggestion.suggestion?.length) {
      el.innerHTML = '<div style="font-size:11px;color:#475569;padding:8px 0;">Precisa de ≥ 5 questões em ≥ 2 matérias.</div>';
      return;
    }
    const mix = suggestion.suggestion.map(s =>
      `<span class="il-mat">${escapeHtml(s.materia)} <span class="il-mat-n">· ${s.questions} Q</span></span>`
    ).join('');
    el.innerHTML = `<div class="il-card">
      <div class="il-title">📚 PRÓXIMA SESSÃO SUGERIDA</div>
      <div class="il-mix">${mix}</div>
      <div class="il-rationale">${escapeHtml(suggestion.rationale)}</div>
    </div>`;
  }

  async function renderInsights() {
    const d = await ensureInsightsData();
    renderInsightsList(d.insights);
    renderWeeklyCompare(d.weekly);
    renderHeatmap(d.heatmap);
    renderForgettingCurve(d.forgetting);
    renderInterleaving(d.interleaving);
    // Clusters semânticos (lazy)
    if (!clustersData) clustersData = await bgMsg({ type: 'GET_SEMANTIC_CLUSTERS' });
    renderSemanticClusters(clustersData);
    // Metacognição (calibração de confiança)
    await renderMetacog();
  }

  async function renderMetacog() {
    // Busca dados de metacognição e renderiza um card de calibração
    const container = $('insights-list');
    if (!container) return;
    const { metacog } = await bgMsg({ type: 'GET_METACOG_SUMMARY' }) || {};
    if (!metacog || metacog.total < 5) return; // pouco dado
    const existing = document.getElementById('metacog-card');
    if (existing) existing.remove();

    // Ilusão de domínio = achava que sabia mas errou
    const illusionPct = metacog.total > 0
      ? Math.round(metacog.illusion / metacog.total * 100)
      : 0;
    // Underconfidence = achava que não sabia mas acertou
    const underPct = metacog.total > 0
      ? Math.round(metacog.under / metacog.total * 100)
      : 0;
    // Calibração = acertou e sabia + errou e não sabia
    const calibPct = metacog.total > 0
      ? Math.round(metacog.calibrated / metacog.total * 100)
      : 0;

    const illusionColor = illusionPct >= 25 ? '#f87171' : illusionPct >= 15 ? '#fbbf24' : '#4ade80';
    const calibColor    = calibPct   >= 75 ? '#4ade80' : calibPct   >= 55 ? '#fbbf24' : '#f87171';

    const card = document.createElement('div');
    card.id = 'metacog-card';
    card.className = 'ins-card';
    card.style.cssText = 'flex-direction:column;border-color:rgba(99,102,241,.2);';
    card.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;width:100%;">
        <span style="font-size:16px;">🧠</span>
        <span style="font-size:10px;font-weight:800;color:#818cf8;letter-spacing:.08em;text-transform:uppercase;">Calibração de Confiança</span>
        <span style="margin-left:auto;font-size:9px;color:#475569;">${metacog.total} registros</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:7px;width:100%;margin-bottom:10px;">
        <div style="background:#0a0d14;border:1px solid rgba(148,163,184,.08);border-radius:8px;padding:8px 6px;text-align:center;">
          <div style="font-size:19px;font-weight:800;color:${calibColor};letter-spacing:-.02em;">${calibPct}%</div>
          <div style="font-size:8.5px;color:#334155;font-weight:700;margin-top:3px;letter-spacing:.06em;text-transform:uppercase;">Calibrado</div>
        </div>
        <div style="background:#0a0d14;border:1px solid rgba(248,113,113,.15);border-radius:8px;padding:8px 6px;text-align:center;">
          <div style="font-size:19px;font-weight:800;color:${illusionColor};letter-spacing:-.02em;">${illusionPct}%</div>
          <div style="font-size:8.5px;color:#334155;font-weight:700;margin-top:3px;letter-spacing:.06em;text-transform:uppercase;">Ilusão</div>
        </div>
        <div style="background:#0a0d14;border:1px solid rgba(148,163,184,.08);border-radius:8px;padding:8px 6px;text-align:center;">
          <div style="font-size:19px;font-weight:800;color:#818cf8;letter-spacing:-.02em;">${underPct}%</div>
          <div style="font-size:8.5px;color:#334155;font-weight:700;margin-top:3px;letter-spacing:.06em;text-transform:uppercase;">Subconf.</div>
        </div>
      </div>
      <div style="font-size:10.5px;color:#64748b;line-height:1.55;width:100%;">
        ${illusionPct >= 25
          ? `⚠️ <strong style="color:#fbbf24;">Atenção:</strong> ${illusionPct}% das questões você achava que sabia mas errou — ilusão de domínio alta.`
          : calibPct >= 75
          ? `✅ Calibração excelente! Você tem boa consciência do que sabe e do que não sabe.`
          : `📊 Continue marcando sua confiança para construir o perfil de calibração.`
        }
        ${metacog.weakAssunto ? `<br>Assunto com mais ilusão: <strong style="color:#f87171;">${escapeHtml(metacog.weakAssunto)}</strong>` : ''}
      </div>`;
    container.insertBefore(card, container.firstChild);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER: ANÁLISE
  // ═══════════════════════════════════════════════════════════════════════════

  function renderAnalise(data) {
    renderPreAlertAnalise(data.preAlert);
    renderConfusionPatterns(data.confusionPatterns || []);
    renderArticleCoverage(data.articleCoverage || {});
    renderSemanticStatus(data.settings || {});
  }

  function renderPreAlertAnalise(preAlert) {
    const el = $('pre-alert-pop'); const txt = $('pre-alert-pop-text');
    if (!el || !txt) return;
    if (!preAlert || !preAlert.count) { el.style.display = 'none'; return; }
    el.style.display = '';
    const items = (preAlert.items || []).map(i => `• ${escapeHtml(i.assunto || i.desc || i.qid)}`).join('<br>');
    txt.innerHTML = `<strong>${preAlert.count} questão(ões)</strong> pendente(s) de <em>${escapeHtml(preAlert.materia)}</em>:<br>${items}`;
  }

  function renderConfusionPatterns(patterns) {
    const el = $('confusion-list');
    if (!el) return;
    if (!patterns.length) {
      el.innerHTML = '<div style="font-size:11px;color:#475569;padding:8px 0;">Ainda sem dados suficientes.<br>Erre pelo menos 3 questões relacionadas para detectar padrões.</div>';
      return;
    }
    el.innerHTML = patterns.map(p => `
      <div class="conf-item">
        <div class="conf-pair">⚠️ ${escapeHtml(p.a)} ↔ ${escapeHtml(p.b)}</div>
        <div class="conf-meta">${p.materia ? escapeHtml(p.materia) + ' · ' : ''}Confundido <strong>${p.count}×</strong></div>
      </div>`).join('');
  }

  function renderArticleCoverage(coverage) {
    const el = $('article-coverage-list');
    if (!el) return;
    const allMats = Object.entries(coverage);
    if (!allMats.length) {
      el.innerHTML = '<div style="font-size:11px;color:#475569;padding:8px 0;">Nenhuma questão com referência legal registrada ainda.</div>';
      return;
    }
    let html = '';
    for (const [mat, refs] of allMats) {
      const ranked = Object.entries(refs)
        .map(([ref, v]) => ({ ref, ...v, total: v.correct + v.wrong,
                              pct: v.correct + v.wrong > 0 ? Math.round(v.correct / (v.correct + v.wrong) * 100) : 0 }))
        .filter(r => r.total > 0)
        .sort((a, b) => a.pct - b.pct || b.total - a.total)
        .slice(0, 8);
      if (!ranked.length) continue;
      html += `<div class="cov-mat-hdr">${escapeHtml(mat.replace(/_/g, ' ').toUpperCase())}</div>`;
      for (const r of ranked) {
        const color = r.pct >= 70 ? '#22c55e' : r.pct >= 40 ? '#f59e0b' : '#ef4444';
        html += `<div class="cov-bar-wrap">
          <span class="cov-bar-ref" title="${escapeHtml(r.ref)}">${escapeHtml(r.ref)}</span>
          <div class="cov-bar-bg"><div class="cov-bar-fill" style="width:${r.pct}%;background:${color};"></div></div>
          <span class="cov-bar-pct" style="color:${color};">${r.pct}%</span>
        </div>`;
      }
    }
    el.innerHTML = html || '<div style="font-size:11px;color:#475569;padding:8px 0;">Sem artigos rastreados ainda.</div>';
  }

  function renderSemanticStatus(settings) {
    const el = $('semantic-status');
    if (!el) return;
    if (settings.claudeApiKey) {
      el.innerHTML = '<span style="color:#22c55e;font-weight:700;">✓ API Claude configurada.</span> Conceitos semânticos são extraídos automaticamente ao errar questões.';
    } else {
      el.innerHTML = 'Configure a chave da API Claude em <strong>CONFIG → Chave API Claude</strong> para ativar análise semântica de conceitos jurídicos.';
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER: ACTIVITY (procrastinação útil)
  // ═══════════════════════════════════════════════════════════════════════════

  function fmtMinSec(secs) {
    if (!secs) return '0m';
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    if (h > 0) return `${h}h${m ? m + 'm' : ''}`;
    if (m > 0) return `${m}m`;
    return `${secs}s`;
  }

  function ratioColor(r) {
    if (r === null) return '#374151';
    if (r >= 75) return '#22c55e';
    if (r >= 50) return '#f59e0b';
    return '#ef4444';
  }

  function ratioCls(r) {
    if (r === null) return '';
    if (r >= 75) return 'high';
    if (r >= 50) return 'mid';
    return 'low';
  }

  function renderActivityCard(stats) {
    const el = $('activity-card');
    if (!el) return;
    if (!stats) { el.innerHTML = ''; return; }
    const t = stats.today || {};
    if ((t.productive + t.idle) < 60) { el.innerHTML = ''; return; }

    const ratio = t.ratio;
    const color = ratioColor(ratio);
    const circ  = 113.1;
    const offset = ratio === null ? circ : circ - (circ * ratio / 100);
    const ratioTxt = ratio === null ? '—' : `${ratio}%`;

    // Sparkline 7 dias
    const max7 = Math.max(60, ...(stats.last7 || []).map(d => d.productive + d.idle));
    const bars = (stats.last7 || []).map(d => {
      const total = d.productive + d.idle;
      const height = Math.max(2, Math.round(total / max7 * 22));
      return `<div class="act-7d-bar ${ratioCls(d.ratio)}" style="height:${height}px;" title="${d.dow} ${d.date}: ${fmtMinSec(d.productive)} prod · ${fmtMinSec(d.idle)} idle"></div>`;
    }).join('');

    let note = '';
    if (ratio !== null && ratio < 50 && t.productive + t.idle > 600) {
      note = '<div class="act-sub" style="color:#fca5a5;">⚠️ Muito tempo idle hoje — abra o caderno e foque</div>';
    } else if (ratio !== null && ratio >= 80) {
      note = '<div class="act-sub" style="color:#86efac;">🔥 Foco excelente hoje</div>';
    }

    el.innerHTML = `
      <div class="act-card">
        <svg class="act-ring" width="44" height="44" viewBox="0 0 44 44">
          <circle cx="22" cy="22" r="18" fill="none" stroke="#20243a" stroke-width="4"/>
          <circle cx="22" cy="22" r="18" fill="none" stroke="${color}" stroke-width="4"
            stroke-linecap="round" stroke-dasharray="${circ}" stroke-dashoffset="${offset}"
            transform="rotate(-90 22 22)" style="transition:all .4s"/>
          <text x="22" y="26" text-anchor="middle" font-size="11" font-weight="800" fill="${color}">${ratioTxt}</text>
        </svg>
        <div class="act-info">
          <div class="act-title">🎯 FOCO HOJE</div>
          <div class="act-vals">Produtivo: <span>${fmtMinSec(t.productive)}</span> · Idle: <span>${fmtMinSec(t.idle)}</span></div>
          ${note}
        </div>
        <div class="act-7d" title="Últimos 7 dias">${bars}</div>
      </div>`;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER: CLUSTERS SEMÂNTICOS
  // ═══════════════════════════════════════════════════════════════════════════

  function renderSemanticClusters(data) {
    const el = $('sem-clusters');
    if (!el) return;
    if (!data || !data.hasEnough) {
      el.innerHTML = `<div style="font-size:11px;color:#475569;padding:8px 0;line-height:1.5;">
        Requer ≥ 3 questões erradas com análise semântica Claude.
        ${data && data.count !== undefined ? `Você tem <strong style="color:#94a3b8;">${data.count}</strong> questão(ões) com conceitos analisados.` : 'Configure a API key em CONFIG e erre algumas questões para começar.'}
      </div>`;
      return;
    }
    if (!data.clusters || !data.clusters.length) {
      el.innerHTML = `<div style="font-size:11px;color:#475569;padding:8px 0;">
        Suas ${data.count} questões com conceitos não formam clusters claros — seus erros são em conceitos variados (o que pode ser positivo!).
      </div>`;
      return;
    }
    el.innerHTML = data.clusters.map(c => {
      const conceptsHtml = (c.commonConcepts.length ? c.commonConcepts : c.topConcepts)
        .slice(0, 5)
        .map(c => `<span class="cluster-concept-tag">${escapeHtml(c)}</span>`).join('');
      const matsHtml = c.materias.slice(0, 3).join(', ');
      const questionsHtml = c.questions.slice(0, 4).map(q => `
        <div class="cluster-q-row">
          <span class="cqr-assunto">${escapeHtml((q.assunto || q.materia || '').slice(0, 18))}</span>
          <span class="cqr-desc" title="${escapeHtml(q.desc || '')}">${escapeHtml((q.desc || q.qid).slice(0, 40))}</span>
          ${q.url ? `<button class="cqr-open" data-action="open-question" data-url="${escapeHtml(q.url)}">↗</button>` : ''}
        </div>`).join('');
      const moreHint = c.questions.length > 4 ? `<div style="font-size:9px;color:#475569;text-align:center;padding-top:3px;">+${c.questions.length - 4} mais...</div>` : '';
      return `<div class="cluster-card">
        <div class="cluster-hdr-row">
          <div class="cluster-concepts">${conceptsHtml || '(sem conceitos comuns)'}</div>
          <span class="cluster-size">${c.size} Q</span>
        </div>
        <div class="cluster-meta"><strong>${c.totalErrors}</strong> erros · ${escapeHtml(matsHtml || '—')}</div>
        <div class="cluster-questions">${questionsHtml}${moreHint}</div>
      </div>`;
    }).join('');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER: EDITAL
  // ═══════════════════════════════════════════════════════════════════════════

  function renderEditalEmpty() {
    const el = $('edital-content');
    if (!el) return;
    const apiKeySet = cfgSettings.claudeApiKey;
    el.innerHTML = `
      <div class="ed-empty">
        <span class="icon">📋</span>
        <div>Cole o texto do edital em <strong>uma ou mais partes</strong> para gerar o <strong>mapa de cobertura</strong>.</div>
      </div>
      ${!apiKeySet ? '<div style="background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.25);border-radius:8px;padding:9px 11px;margin-bottom:10px;font-size:10.5px;color:#fca5a5;">⚠️ Configure sua <strong>API key do Claude</strong> em CONFIG primeiro.</div>' : ''}
      <div class="ed-parts-wrap" id="ed-parts-wrap">
        <div class="ed-part" id="ed-part-0">
          <div class="ed-part-header">
            <span class="ed-part-label">Parte 1</span>
            <span class="ed-part-chars" id="ed-chars-0">0 caracteres</span>
          </div>
          <textarea class="ed-textarea" id="ed-part-text-0" placeholder="Cole aqui a 1ª parte do edital (matérias, tópicos)…"></textarea>
        </div>
      </div>
      <div class="ed-parts-btns">
        <button class="ed-add-part-btn" id="ed-add-part">＋ Adicionar parte</button>
        <span class="ed-parts-hint" id="ed-total-chars">Total: 0 caracteres</span>
      </div>
      <div class="ed-imp-actions">
        <button class="ed-imp-btn primary" id="edital-import-btn" ${!apiKeySet ? 'disabled' : ''}>🤖 Analisar com Claude</button>
        <button class="ed-imp-btn" id="edital-json-btn" title="Importar JSON pré-processado">📥 Importar JSON</button>
      </div>
      <div id="edital-import-status" style="margin-top:6px;font-size:10px;color:#64748b;display:none;"></div>`;

    let partCount = 1;

    // Atualiza contadores de caracteres
    function updateCharCounts() {
      let total = 0;
      for (let i = 0; i < partCount; i++) {
        const ta = $(`ed-part-text-${i}`);
        if (!ta) continue;
        const len = ta.value.length;
        const charEl = $(`ed-chars-${i}`);
        if (charEl) charEl.textContent = len.toLocaleString('pt-BR') + ' caracteres';
        total += len;
      }
      const tot = $('ed-total-chars');
      if (tot) tot.textContent = `Total: ${total.toLocaleString('pt-BR')} caracteres`;
    }

    // Listener no primeiro textarea
    $('ed-part-text-0')?.addEventListener('input', updateCharCounts);

    // Botão adicionar parte
    $('ed-add-part')?.addEventListener('click', () => {
      const wrap = $('ed-parts-wrap');
      if (!wrap) return;
      const idx = partCount;
      partCount++;
      const div = document.createElement('div');
      div.className = 'ed-part';
      div.id = `ed-part-${idx}`;
      div.innerHTML = `
        <div class="ed-part-header">
          <span class="ed-part-label">Parte ${idx + 1}</span>
          <span class="ed-part-chars" id="ed-chars-${idx}">0 caracteres</span>
          <button class="ed-remove-part" data-idx="${idx}" title="Remover parte">✕</button>
        </div>
        <textarea class="ed-textarea" id="ed-part-text-${idx}" placeholder="Cole aqui a parte ${idx + 1} do edital…"></textarea>`;
      wrap.appendChild(div);
      $(`ed-part-text-${idx}`)?.addEventListener('input', updateCharCounts);
      div.querySelector('.ed-remove-part')?.addEventListener('click', () => {
        div.remove();
        updateCharCounts();
      });
      $(`ed-part-text-${idx}`)?.focus();
    });

    const btn = $('edital-import-btn');
    if (btn) btn.addEventListener('click', importEdital);

    $('edital-json-btn')?.addEventListener('click', importEditalJson);
  }

  function statusColor(s) {
    return s === 'green' ? '#22c55e'
         : s === 'yellow' ? '#f59e0b'
         : s === 'orange' ? '#fb923c'
         : '#ef4444';
  }

  function statusBadgeCls(pct) {
    return pct >= 70 ? 'green' : pct >= 30 ? 'yellow' : 'red';
  }

  function renderEditalLoaded(data) {
    const el = $('edital-content');
    if (!el) return;

    const importDate = data.importedAt ? new Date(data.importedAt).toLocaleDateString('pt-BR') : '—';
    const summary = data.summary || {};

    let matsHtml = '';
    for (const m of data.materias) {
      const topsHtml = m.topicos.map(t => {
        const meta = t.respondedCount > 0
          ? `${t.respondedCount}Q · ${t.rate !== null ? t.rate + '%' : '—'}`
          : t.questionCount > 0 ? `${t.questionCount}Q vistas` : 'sem dados';
        return `<div class="ed-top">
          <span class="ed-top-dot ${t.status}"></span>
          <span class="ed-top-name" title="${escapeHtml(t.nome)}">${escapeHtml(t.nome)}</span>
          <span class="ed-top-meta">${meta}</span>
        </div>`;
      }).join('');

      const matCov = m.coveragePct;
      const matCls = statusBadgeCls(matCov);

      matsHtml += `<div class="ed-mat">
        <div class="ed-mat-hd" data-action="ed-toggle-mat">
          <span class="ed-mat-arrow">▶</span>
          <span class="ed-mat-name">${escapeHtml(m.nome)}</span>
          <span class="ed-mat-cov ${matCls}">${matCov}% cob.</span>
        </div>
        <div class="ed-mat-body">
          <div style="font-size:9.5px;color:#64748b;margin-bottom:6px;">
            ${m.topicos.length} tópicos · ${m.respondedCount} Q resolvidas · taxa ${m.rate !== null ? m.rate + '%' : '—'}
          </div>
          ${topsHtml || '<div style="font-size:10px;color:#475569;padding:4px 0;">Sem tópicos extraídos.</div>'}
        </div>
      </div>`;
    }

    let gapsHtml = '';
    if (data.gaps && data.gaps.length) {
      gapsHtml = `<div class="ed-gaps">
        <div class="ed-gaps-title">⚠️ TOP LACUNAS (PRIORIDADE)</div>
        ${data.gaps.slice(0, 10).map(g => `<div class="ed-gap-row">
          <span class="ed-gap-mat">[${escapeHtml(g.materia.slice(0, 12))}]</span>
          <span class="ed-gap-name" title="${escapeHtml(g.topico)}">${escapeHtml(g.topico)}</span>
          <span class="ed-gap-peso">p${g.peso.toFixed(1)}</span>
        </div>`).join('')}
      </div>`;
    }

    el.innerHTML = `
      <div class="ed-summary">
        <div class="ed-sum-name">📋 ${escapeHtml(data.name || 'Edital')}</div>
        <div class="ed-sum-stats">
          <span><strong>${summary.totalMaterias || 0}</strong> matérias</span>
          <span><strong>${summary.totalTopicos || 0}</strong> tópicos</span>
          <span style="color:#86efac;">🟢 <strong>${summary.greenTopicos || 0}</strong></span>
          <span style="color:#fca5a5;">🔴 <strong>${summary.redTopicos || 0}</strong></span>
        </div>
        <div style="font-size:9.5px;color:#475569;margin-top:4px;">Importado em ${importDate}</div>
        <div class="ed-sum-actions">
          <button class="ed-sum-btn" id="edital-refresh">↻ Recalcular</button>
          <button class="ed-sum-btn danger" id="edital-delete">🗑 Remover edital</button>
        </div>
      </div>
      ${matsHtml}
      ${gapsHtml}`;

    $('edital-refresh')?.addEventListener('click', async () => {
      editalData = null;
      await renderEdital();
    });
    $('edital-delete')?.addEventListener('click', deleteEdital);
  }

  async function renderEdital() {
    if (!editalData) editalData = await bgMsg({ type: 'GET_EDITAL_COVERAGE' });
    if (!editalData || !editalData.hasEdital) {
      renderEditalEmpty();
    } else {
      renderEditalLoaded(editalData);
    }
  }

  async function importEdital() {
    const status = $('edital-import-status');
    const btn    = $('edital-import-btn');

    // Coleta todas as partes preenchidas
    const parts = [];
    let i = 0;
    while (true) {
      const ta = $(`ed-part-text-${i}`);
      if (!ta) break;
      const txt = ta.value.trim();
      if (txt) parts.push(txt);
      i++;
    }

    if (!parts.length) {
      await modalAlert('Cole o texto do edital em pelo menos uma parte.');
      return;
    }
    const totalChars = parts.reduce((s, p) => s + p.length, 0);
    if (totalChars < 100) {
      await modalAlert('Texto muito curto. Cole o conteúdo completo do edital.');
      return;
    }

    btn.disabled = true;
    status.style.display = 'block';

    // Mostra resumo do que vai processar
    const partsLabel = parts.length === 1
      ? `1 parte (${totalChars.toLocaleString('pt-BR')} caracteres)`
      : `${parts.length} partes (${totalChars.toLocaleString('pt-BR')} caracteres no total)`;
    status.textContent = `⏳ Iniciando análise — ${partsLabel}…`;

    // Processa cada parte em paralelo via background
    let feedbackIdx = 0;
    const feedbackTimer = setInterval(() => {
      feedbackIdx++;
      const msgs = [
        `⏳ Analisando ${partsLabel}…`,
        '⏳ Extraindo matérias e tópicos…',
        '⏳ Mesclando resultados…',
        '⏳ Quase pronto…',
      ];
      status.textContent = msgs[feedbackIdx % msgs.length];
    }, 4000);

    // Passa todas as partes para o background — ele processa em paralelo
    const r = await bgMsg(
      { type: 'IMPORT_EDITAL', text: parts.join('\n\n--- PARTE ---\n\n'), parts },
      120000   // 2 min de timeout para editais grandes
    );

    clearInterval(feedbackTimer);

    if (!r || !r.ok) {
      const errMsg = (r && r.error) || 'erro desconhecido';
      status.innerHTML = !r
        ? `<span style="color:#ef4444;">❌ Tempo esgotado (2 min). Tente dividir o edital em mais partes.</span>`
        : `<span style="color:#ef4444;">❌ Falha: ${escapeHtml(errMsg)}</span>`;
      btn.disabled = false;
      return;
    }

    const mats = r.parsed?.materias?.length || 0;
    status.innerHTML = `<span style="color:#22c55e;">✓ Edital importado! ${mats} matéria(s) encontrada(s).</span>`;
    editalData = null;
    setTimeout(() => { renderEdital(); }, 800);
  }

  async function importEditalJson() {
    // Abre modal pedindo o JSON
    const json = await modalPrompt(
      '📥 Cole o JSON do edital pré-processado abaixo.\n\nO arquivo deve ter o formato: { "name": "...", "materias": [...] }',
      'Cole o JSON aqui…'
    );
    if (!json || !json.trim()) return;
    const status = $('edital-import-status');
    if (status) { status.style.display = 'block'; status.textContent = '⏳ Importando JSON…'; }
    const r = await bgMsg({ type: 'IMPORT_EDITAL_JSON', json }, 10000);
    if (!r || !r.ok) {
      if (status) status.innerHTML = `<span style="color:#ef4444;">❌ ${escapeHtml((r && r.error) || 'JSON inválido')}</span>`;
      return;
    }
    const mats = r.parsed?.materias?.length || 0;
    if (status) status.innerHTML = `<span style="color:#22c55e;">✓ Importado! ${mats} matéria(s) carregada(s).</span>`;
    editalData = null;
    setTimeout(() => { renderEdital(); }, 600);
  }

  async function deleteEdital() {
    if (!(await modalConfirm('Remover edital importado? Isso não apaga seu histórico de questões.', 'Confirmar', true))) return;
    await bgMsg({ type: 'DELETE_EDITAL' });
    editalData = null;
    renderEditalEmpty();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // IRT STATS NA REVISÃO
  // ═══════════════════════════════════════════════════════════════════════════

  async function renderIRTStats() {
    const el = $('irt-stats');
    if (!el) return;
    if (!irtStats) {
      const r = await bgMsg({ type: 'GET_IRT_STATS' });
      irtStats = (r && r.stats) || [];
    }
    if (!irtStats.length) {
      el.innerHTML = 'Treine mais matérias para calibrar o modelo.';
      return;
    }
    // Mostra top 3 matérias mais treinadas
    const top = irtStats.slice(0, 3);
    el.innerHTML = top.map(s => {
      const lvl = s.theta > 0.5 ? 'forte' : s.theta < -0.5 ? 'fraco' : 'médio';
      const color = s.theta > 0.5 ? '#86efac' : s.theta < -0.5 ? '#fca5a5' : '#fcd34d';
      return `<div>${escapeHtml(s.materia.slice(0, 22))}: <span style="color:${color};">θ=${s.theta.toFixed(2)} (${lvl})</span> · ${s.n} resp.</div>`;
    }).join('');
  }

  function populateIRTMaterias(stats, subjects) {
    const sel = $('irt-materia');
    if (!sel) return;
    const mats = new Set();
    (stats || []).forEach(s => mats.add(s.materia));
    (subjects || []).forEach(s => { if (s.materia) mats.add(s.materia); });
    const cur = sel.value;
    sel.innerHTML = '<option value="">Todas as matérias</option>' +
      [...mats].sort().map(m => `<option value="${escapeHtml(m)}"${m === cur ? ' selected' : ''}>${escapeHtml(m)}</option>`).join('');
  }

  async function startIRTSimulado() {
    const materia = $('irt-materia').value || '';
    const r = await bgMsg({ type: 'GET_IRT_NEXT', materia, count: 10 });
    if (!r || !r.questions || !r.questions.length) {
      await modalAlert('Sem questões erradas suficientes para gerar simulado adaptativo. Resolva e erre algumas no TEC primeiro.');
      return;
    }
    const avgDif = r.questions.reduce((s, q) => s + (q.difficulty || 0), 0) / r.questions.length;
    const txt = `<strong>${r.questions.length}</strong> questões selecionadas otimizando ganho de informação.<br>
      <span style="color:#94a3b8;">Seu θ${materia ? ` em ${escapeHtml(materia)}` : ''}: <strong>${r.theta.toFixed(2)}</strong> · dificuldade média: <strong>${avgDif.toFixed(2)}</strong></span><br><br>
      Abrir todas?`;
    const go = await modalConfirm(txt, '🎯 Simulado Adaptativo');
    if (!go) return;
    r.questions.forEach(q => { if (q.url) chrome.tabs.create({ url: q.url, active: false }); });
    await new Promise(resolve => chrome.storage.local.set({
      simuladoQueue: r.questions.map(q => ({ qid: q.qid, url: q.url, materia: q.materia, assunto: q.assunto, desc: q.desc }))
    }, resolve));
    window.close();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BIBLIOTECA PDF
  // ═══════════════════════════════════════════════════════════════════════════

  function libStatusShow(kind, text) {
    const el = $('lib-import-status');
    if (!el) return;
    el.className = 'lib-import-status show ' + kind;
    el.innerHTML = text;
  }

  function libStatusHide() {
    const el = $('lib-import-status');
    if (el) el.className = 'lib-import-status';
  }

  async function handlePDFFile(file) {
    if (!file) return;
    if (!file.name.match(/\.pdf$/i) && file.type !== 'application/pdf') {
      libStatusShow('error', '❌ O arquivo precisa ser um PDF.');
      return;
    }
    if (!window.PFPdfParser) {
      libStatusShow('error', '❌ Parser não carregado. Recarregue a extensão.');
      return;
    }
    libStatusShow('info', '⏳ Lendo PDF...');
    try {
      const buf = await file.arrayBuffer();
      libStatusShow('info', '⏳ Extraindo texto...');
      const text = await window.PFPdfParser.extractTextFromPDF(buf);
      libStatusShow('info', '⏳ Identificando questões...');
      const parsed = window.PFPdfParser.parseTECPdfText(text);
      if (!parsed.questions.length) {
        libStatusShow('error', `❌ Nenhuma questão reconhecida.<br><span style="font-size:10px;color:#fca5a5;">Verifique se é um PDF exportado do TecConcursos. Chunks detectados: ${parsed.stats.totalChunks}.</span>`);
        return;
      }
      libStatusShow('info', `⏳ Salvando ${parsed.questions.length} questões...`);
      const r = await bgMsg({
        type: 'IMPORT_QUESTIONS_FROM_PDF',
        questions: parsed.questions,
        source: file.name,
      });
      if (!r || !r.ok) {
        libStatusShow('error', '❌ Falha ao salvar: ' + ((r && r.error) || 'erro desconhecido'));
        return;
      }
      const detalhe = `Adicionadas: <strong>${r.added}</strong> · Mescladas: <strong>${r.merged}</strong>${r.skipped ? ' · Puladas: <strong>' + r.skipped + '</strong>' : ''}`;
      libStatusShow('success', `✓ ${r.total} questão(ões) importadas de <em>${escapeHtml(file.name)}</em><br><span style="font-size:10px;">${detalhe}</span>`);
      libStats = null;
      await renderBiblio();
      setTimeout(libStatusHide, 6000);
    } catch (e) {
      console.error('PDF import error:', e);
      libStatusShow('error', '❌ Erro: ' + escapeHtml(String(e.message || e)));
    }
  }

  function renderLibStats(stats) {
    const wrap = $('lib-stats-wrap');
    if (!wrap) return;
    if (!stats || !stats.hasLibrary) { wrap.innerHTML = ''; return; }
    const sourcesText = stats.sources.length === 1
      ? `1 PDF importado`
      : `${stats.sources.length} PDFs importados`;
    wrap.innerHTML = `
      <div class="lib-stats">
        <div class="lib-stats-row">
          <span class="lib-stat-chip"><strong>${stats.total}</strong> questões</span>
          <span class="lib-stat-chip"><strong>${stats.bancas.length}</strong> bancas</span>
          <span class="lib-stat-chip"><strong>${stats.materias.length}</strong> matérias</span>
          <span class="lib-stat-chip">${sourcesText}</span>
        </div>
        <div class="lib-stats-row" style="margin-top:5px;">
          <span class="lib-stat-chip"><strong>${stats.unresolved}</strong> não-resolvidas</span>
          <span class="lib-stat-chip green"><strong>${stats.resolved}</strong> só acertos</span>
          <span class="lib-stat-chip red"><strong>${stats.wrong}</strong> com erros</span>
        </div>
      </div>`;
  }

  function renderLibFilters(stats) {
    const wrap = $('lib-filters-wrap');
    if (!wrap) return;
    if (!stats || !stats.hasLibrary) { wrap.innerHTML = ''; return; }
    wrap.innerHTML = `
      <div class="lib-filters">
        <div class="lib-filter-row">
          <span class="lib-filter-lbl">MATÉRIA</span>
          <select class="lib-filter-sel" id="lib-f-materia">
            <option value="">Todas</option>
            ${stats.materias.map(m => `<option value="${escapeHtml(m)}"${m === libFilters.materia ? ' selected' : ''}>${escapeHtml(m)}</option>`).join('')}
          </select>
        </div>
        <div class="lib-filter-row">
          <span class="lib-filter-lbl">BANCA</span>
          <select class="lib-filter-sel" id="lib-f-banca">
            <option value="">Todas</option>
            ${stats.bancas.map(b => `<option value="${escapeHtml(b)}"${b === libFilters.banca ? ' selected' : ''}>${escapeHtml(b)}</option>`).join('')}
          </select>
          <select class="lib-filter-sel" id="lib-f-ano" style="max-width:80px;">
            <option value="">Ano</option>
            ${stats.anos.map(a => `<option value="${a}"${String(a) === String(libFilters.ano) ? ' selected' : ''}>${a}</option>`).join('')}
          </select>
        </div>
        <div class="lib-filter-row">
          <span class="lib-filter-lbl">STATUS</span>
          <select class="lib-filter-sel" id="lib-f-status">
            <option value=""${!libFilters.status ? ' selected' : ''}>Todos</option>
            <option value="unresolved"${libFilters.status === 'unresolved' ? ' selected' : ''}>Não resolvidas</option>
            <option value="resolved"${libFilters.status === 'resolved' ? ' selected' : ''}>Só acertos</option>
            <option value="wrong"${libFilters.status === 'wrong' ? ' selected' : ''}>Com erros</option>
          </select>
        </div>
      </div>`;

    ['lib-f-materia','lib-f-banca','lib-f-ano','lib-f-status'].forEach(id => {
      const el = $(id);
      if (!el) return;
      el.addEventListener('change', () => {
        libFilters = {
          materia: $('lib-f-materia').value,
          banca:   $('lib-f-banca').value,
          ano:     $('lib-f-ano').value,
          status:  $('lib-f-status').value,
        };
        libPage = 1;
        renderLibList();
      });
    });
  }

  async function renderLibList() {
    const list = $('lib-list');
    const pag  = $('lib-pagination');
    if (!list) return;
    const r = await bgMsg({ type: 'GET_LIBRARY_LIST', filters: libFilters, page: libPage, pageSize: 20 });
    if (!r || !r.items || !r.items.length) {
      list.innerHTML = libStats && libStats.total > 0
        ? '<div class="lib-empty"><span class="icon">🔎</span><div>Nenhuma questão encontrada para esses filtros.</div></div>'
        : '<div class="lib-empty"><span class="icon">📚</span><div>Sua biblioteca está vazia. Importe um PDF do TEC para começar.</div></div>';
      if (pag) pag.innerHTML = '';
      return;
    }
    list.innerHTML = r.items.map(q => {
      const cls = q.status === 'wrong' ? 'wrong' : q.status === 'resolved' ? 'resolved' : 'unresolved';
      const statusLbl = q.status === 'wrong' ? '❌ Errei' : q.status === 'resolved' ? '✓ OK' : '○ Não feita';
      const cargo = q.cargo ? `${q.cargo}${q.orgao ? ' · ' + q.orgao : ''}` : (q.orgao || '');
      return `<div class="lib-q ${cls}">
        <div class="lib-q-hdr">
          <span class="lib-q-banca">${escapeHtml(q.banca || '?')}</span>
          <span class="lib-q-cargo" title="${escapeHtml(cargo)}">${escapeHtml(cargo)}</span>
          <span class="lib-q-ano">${q.ano || ''}</span>
          <span class="lib-q-status ${cls}">${statusLbl}</span>
        </div>
        <div class="lib-q-assunto">${escapeHtml(q.assunto || q.materia || '—')}</div>
        <div class="lib-q-desc" title="${escapeHtml(q.enunciado || '')}">${escapeHtml((q.enunciado || q.desc || '').slice(0, 160))}${q.enunciado && q.enunciado.length > 160 ? '...' : ''}</div>
        <div class="lib-q-btns">
          <button class="lib-q-btn primary" data-action="open-question" data-url="${escapeHtml(q.url)}">📖 Abrir no TEC</button>
          <button class="lib-q-btn danger" data-action="lib-delete" data-qid="${escapeHtml(q.qid)}" title="Remover">🗑</button>
        </div>
      </div>`;
    }).join('');

    if (pag) {
      pag.innerHTML = `<div class="lib-pagination">
        <button class="lib-pag-btn" id="lib-prev" ${r.page <= 1 ? 'disabled' : ''}>← Anterior</button>
        <span>Página ${r.page} de ${r.totalPages} · ${r.totalFiltered} questões</span>
        <button class="lib-pag-btn" id="lib-next" ${r.page >= r.totalPages ? 'disabled' : ''}>Próxima →</button>
      </div>`;
      $('lib-prev')?.addEventListener('click', () => { if (libPage > 1) { libPage--; renderLibList(); }});
      $('lib-next')?.addEventListener('click', () => { libPage++; renderLibList(); });
    }
  }

  async function renderBiblio() {
    // Stats sempre primeiro
    if (!libStats) libStats = await bgMsg({ type: 'GET_LIBRARY_STATS' });
    renderLibStats(libStats);
    renderLibFilters(libStats);
    await renderLibList();
  }

  // Listener de delete
  async function deleteLibQuestion(qid) {
    if (!(await modalConfirm('Remover esta questão da biblioteca?<br><span style="font-size:10px;color:#94a3b8;">Se você já a resolveu no TEC, o histórico de acertos/erros é mantido.</span>'))) return;
    await bgMsg({ type: 'DELETE_LIBRARY_QUESTION', qid });
    libStats = null;
    await renderBiblio();
  }

  // Drag&drop handlers
  function setupBiblioListeners() {
    const dropZone = $('lib-drop-zone');
    const fileInp  = $('lib-import-file');
    if (!dropZone || !fileInp) return;

    dropZone.addEventListener('click', () => fileInp.click());
    fileInp.addEventListener('change', ev => {
      const f = ev.target.files[0];
      if (f) handlePDFFile(f);
      ev.target.value = '';
    });
    dropZone.addEventListener('dragover', ev => {
      ev.preventDefault();
      dropZone.classList.add('dragover');
    });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', ev => {
      ev.preventDefault();
      dropZone.classList.remove('dragover');
      const f = ev.dataTransfer.files[0];
      if (f) handlePDFFile(f);
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER: HISTÓRICO
  // ═══════════════════════════════════════════════════════════════════════════

  function renderHistorico(data) {
    const sessions = data.sessions || [];
    const wrap = $('hist-list');
    if (!wrap) return;
    if (!sessions.length) {
      wrap.innerHTML = `<div class="hist-empty">
        <div style="font-size:28px;margin-bottom:8px;">📋</div>
        <div style="font-size:12px;color:#64748b;">Nenhuma sessão registrada ainda.</div>
      </div>`;
      return;
    }
    wrap.innerHTML = sessions.map(s => {
      const taxa = pct(s.acertos || 0, (s.acertos || 0) + (s.erros || 0));
      const color = accColor(taxa);
      let materiaHtml = '';
      if (s.questions && s.questions.length) {
        const mats = {};
        s.questions.forEach(q => {
          if (!q.materia) return;
          if (!mats[q.materia]) mats[q.materia] = { c: 0, w: 0 };
          if (q.result === 'correct') mats[q.materia].c++;
          else if (q.result === 'wrong') mats[q.materia].w++;
        });
        const matList = Object.entries(mats).slice(0, 3).map(([m, v]) => {
          const t = v.c + v.w;
          const p = pct(v.c, t);
          return `<span style="font-size:9px;color:#64748b;margin-right:6px;">${escapeHtml(m).slice(0,20)} <strong style="color:${accColor(p)};">${p}%</strong></span>`;
        }).join('');
        if (matList) materiaHtml = `<div style="margin-top:5px;">${matList}</div>`;
      }
      return `<div class="scard">
        <div class="scard-top">
          <span class="scard-date">${fmtDate(s.date)} ${s.endTime ? '· ' + new Date(s.endTime).toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'}) : ''}</span>
          <span class="scard-acc" style="color:${color};">${taxa}%</span>
        </div>
        <div class="scard-name" title="${escapeHtml(s.caderno || '')}">${escapeHtml(s.caderno || 'Sessão')}</div>
        <div class="scard-stats">
          <span class="sstat g">✓ <span>${s.acertos || 0}</span></span>
          <span class="sstat r">✕ <span>${s.erros || 0}</span></span>
          <span class="sstat p">⏱ <span>${fmtElapsed(s.elapsed)}</span></span>
        </div>
        ${materiaHtml}
      </div>`;
    }).join('');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER: CONFIG
  // ═══════════════════════════════════════════════════════════════════════════

  function setToggle(id, on) {
    const el = $('tog-' + id);
    if (el) el.className = 'toggle-sw' + (on ? ' on' : '');
  }
  function toggleSetting(id) {
    cfgSettings[id] = !cfgSettings[id];
    setToggle(id, cfgSettings[id]);
  }

  function renderConfig(data) {
    cfgSettings = data.settings || cfgSettings;
    const goalInp = $('cfg-goal');     if (goalInp) goalInp.value = cfgSettings.dailyGoal || 30;
    const keyEl   = $('cfg-claude-key'); if (keyEl) keyEl.value = cfgSettings.claudeApiKey ? '••••••••' : '';
    setToggle('notifications', cfgSettings.notifications !== false);
    setToggle('autoReveal',    cfgSettings.autoReveal !== false);
    setToggle('smartGoal',     cfgSettings.smartGoal === true);
    setToggle('autoBackup',    cfgSettings.autoBackup !== false);
    renderQBankStats(data.questionBankStats);
  }

  function renderQBankStats(stats) {
    const el = $('qbank-stats');
    if (!el || !stats) return;
    el.innerHTML = `
      <span style="font-size:10px;background:#20243a;border-radius:6px;padding:3px 8px;color:#94a3b8;">📚 ${stats.total} questões</span>
      <span style="font-size:10px;background:rgba(34,197,94,.1);border-radius:6px;padding:3px 8px;color:#22c55e;">🟢 ${stats.dominadas}</span>
      <span style="font-size:10px;background:rgba(245,158,11,.1);border-radius:6px;padding:3px 8px;color:#f59e0b;">🟡 ${stats.atencao}</span>
      <span style="font-size:10px;background:rgba(239,68,68,.1);border-radius:6px;padding:3px 8px;color:#ef4444;">🔴 ${stats.criticas}</span>`;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STATUS BAR
  // ═══════════════════════════════════════════════════════════════════════════

  async function updateStatusBar() {
    const dot = $('s-dot'); const txt = $('s-txt');
    if (!dot || !txt) return;
    try {
      const tecTab = await findTab(TEC_ORIGIN);
      let pingData = null;
      if (tecTab) { try { pingData = await pingContent(tecTab.id); } catch {} }

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

  // ═══════════════════════════════════════════════════════════════════════════
  // LOAD & REFRESH
  // ═══════════════════════════════════════════════════════════════════════════

  async function loadAll() {
    appData = await bgMsg({ type: 'GET_POPUP_DATA' });
    if (!appData) appData = { todayStats: {}, globalStats: {}, sessions: [], subjectStats: [], dueReviews: [], settings: {} };

    // Calendar (lazy mas usado no HOJE)
    if (!calendarData) {
      const r = await bgMsg({ type: 'GET_CALENDAR' });
      calendarData = (r && r.calendar) || [];
    }
    // Activity (usado no HOJE)
    if (!activityData) {
      activityData = await bgMsg({ type: 'GET_ACTIVITY_STATS' });
    }
    // IRT stats (usado no REVISÃO)
    if (!irtStats) {
      const r = await bgMsg({ type: 'GET_IRT_STATS' });
      irtStats = (r && r.stats) || [];
    }

    try { renderHoje(appData); }       catch (e) { console.error('renderHoje', e); }
    try { renderRevisao(appData); }    catch (e) { console.error('renderRevisao', e); }
    try { renderHistorico(appData); }  catch (e) { console.error('renderHistorico', e); }
    try { renderConfig(appData); }     catch (e) { console.error('renderConfig', e); }
    try { renderAnalise(appData); }    catch (e) { /* */ }
    try { renderIRTStats(); }          catch (e) { /* */ }
    try { populateIRTMaterias(irtStats, appData.subjectStats); } catch (e) { /* */ }
    try { initPopTimer(appData.timer); } catch (e) { /* */ }
    updateStatusBar();
    updateRevTabBadge();
  }

  function updateRevTabBadge() {
    if (!appData) return;
    const due  = appData.dueReviews || [];
    const hub  = appData.hubQueue   || [];
    const sess = appData.activeSession;
    const dueQids = new Set(due.map(q => q.qid));
    const sessErr = sess && sess.questions
      ? sess.questions.filter(q => q.result === 'wrong' && q.qid && !dueQids.has(q.qid))
      : [];
    const total = hub.length + due.length + sessErr.length;
    const sbItem = document.querySelector('.sb-item[data-tab="revisao"]');
    if (!sbItem) return;
    // Remove badge anterior
    sbItem.querySelector('.sb-badge')?.remove();
    if (total > 0) {
      const badge = document.createElement('span');
      badge.className = 'sb-badge';
      badge.textContent = total > 99 ? '99+' : String(total);
      sbItem.appendChild(badge);
    }
  }

  async function softRefresh(force = false) {
    if (_refreshBusy && !force) return;
    if (!force) _refreshBusy = true;
    try {
      const fresh = await bgMsg({ type: 'GET_POPUP_DATA' });
      if (!fresh) return;
      appData = fresh;

      const today = fresh.todayStats || {};
      const resolved = today.resolved || 0;
      const settings = fresh.settings || {};
      const goal = (settings.smartGoal && fresh.smartGoal) ? fresh.smartGoal : (settings.dailyGoal || 30);
      const taxa = pct(today.acertos || 0, resolved);

      setEl('d-resolved', fmt(resolved));
      setEl('d-acertos',  fmt(today.acertos));
      setEl('d-erros',    fmt(today.erros));
      setEl('goal-progress', `${resolved} / ${goal}`);

      const sgBadge = $('goal-smart-badge');
      if (sgBadge) sgBadge.classList.toggle('hidden', !(settings.smartGoal && fresh.smartGoal));

      setEl('ring-pct', resolved > 0 ? taxa + '%' : '—');
      setEl('ring-sub', resolved > 0
        ? `${today.acertos || 0} acertos · ${today.erros || 0} erros hoje`
        : 'Resolva questões no TEC para começar a rastrear.');

      const fill = $('goal-fill');
      if (fill) fill.style.width = Math.min(100, Math.round(resolved / goal * 100)) + '%';
      const arc = $('ring-arc');
      if (arc) {
        if (resolved > 0) {
          arc.style.visibility = 'visible';
          arc.style.strokeDashoffset = 138.2 - (138.2 * taxa / 100);
          arc.style.stroke = accColor(taxa);
        } else {
          arc.style.visibility = 'hidden';
        }
      }
      const ringPct = $('ring-pct');
      if (ringPct) {
        ringPct.style.color = resolved > 0 ? accColor(taxa) : 'var(--text-faint)';
      }

      setEl('streak-badge', `🔥 ${(fresh.globalStats || {}).streak || 0}d`);

      updateRevTabBadge();
      updateHubCountdowns(fresh.hubQueue || []);

      try { renderAprovacao(today, settings); } catch {}
      try { renderPriorityList(fresh.subjectStats || []); } catch {}
      try { renderWeekChart(fresh.weekStats); } catch {}
      try { renderQBankStats(fresh.questionBankStats); } catch {}
      try { renderHourlyChart(fresh.hourlyStats); } catch {}
      try { renderFatigueAlert(fresh.recentResults || [], today); } catch {}
      try { if (fresh.manualHubTimer && !_manHubLocal) renderManHubSection(fresh.manualHubTimer); } catch {}
      try { renderRevPreAlert(fresh.preAlert); } catch {}

      if (fresh.pomodoro && fresh.pomodoro.active !== pomData.active) initPomodoro(fresh.pomodoro);
      else if (fresh.pomodoro) { pomData = { ...pomData, ...fresh.pomodoro }; renderPomFocus(); }
      // Feature 4: sincroniza foco pomodoro na sessão via polling
      if (fresh.activeSession) {
        pomFocusSecs = fresh.activeSession.pomodoroFocusSecs || 0;
        renderPomFocus();
      } else if (!fresh.activeSession && pomFocusSecs > 0) {
        pomFocusSecs = 0;
        renderPomFocus();
      }

      // Invalida caches sob demanda quando aba é insights/edital/biblio
      insightsData = null;
      calendarData = null;
      clustersData = null;
      activityData = null;
      irtStats     = null;
      libStats     = null;
    } finally { _refreshBusy = false; }
  }

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

  // ═══════════════════════════════════════════════════════════════════════════
  // AÇÕES
  // ═══════════════════════════════════════════════════════════════════════════

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
    await bgMsg({ type: 'REVIEW_QUESTION', qid, quality });
    await softRefresh(true);
  }

  function saveConfig() {
    cfgSettings.dailyGoal = parseInt($('cfg-goal').value) || 30;
    const keyEl = $('cfg-claude-key');
    if (keyEl && keyEl.value && !keyEl.value.startsWith('•')) cfgSettings.claudeApiKey = keyEl.value.trim();
    bgMsg({ type: 'SAVE_SETTINGS', settings: cfgSettings }).then(() => {
      const btn = $('cfg-save');
      const orig = btn.textContent;
      btn.textContent = '✓ Salvo!';
      setTimeout(() => { btn.textContent = orig; }, 1500);
    });
  }

  async function exportWrong() {
    const r = await bgMsg({ type: 'EXPORT_WRONG' });
    if (!r || !r.bank) return;
    downloadFile(JSON.stringify(r.bank, null, 2), 'painel-fiscal-erros.json', 'application/json');
  }

  async function exportCSV() {
    const r = await bgMsg({ type: 'EXPORT_WRONG' });
    if (!r || !r.bank) return;
    const header = 'QID,Matéria,Assunto,Erros,Última Erro,Próxima Revisão,URL';
    const rows = r.bank.map(q =>
      [q.qid, q.materia, q.assunto, q.errorCount, q.lastError, q.nextReview, q.url]
        .map(v => `"${(v || '').toString().replace(/"/g, '""')}"`).join(',')
    );
    downloadFile('\ufeff' + [header, ...rows].join('\n'), 'painel-fiscal-erros.csv', 'text/csv;charset=utf-8');
  }

  async function exportAnki() {
    const r = await bgMsg({ type: 'EXPORT_ANKI' });
    if (!r || !r.text) { modalAlert('Sem questões erradas registradas ainda.'); return; }
    downloadFile(r.text, 'painel-fiscal-anki.txt', 'text/plain;charset=utf-8');
    modalAlert('Arquivo Anki exportado. No Anki: File → Import → escolha o .txt. As tags vêm na 4ª coluna.', 'Exportado');
  }

  async function exportBackup() {
    const r = await bgMsg({ type: 'EXPORT_BACKUP' });
    if (!r || !r.backup) return;
    const ts = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
    downloadFile(JSON.stringify(r.backup, null, 2), `painel-fiscal-backup-${ts}.json`, 'application/json');
  }

  function importBackup() { $('cfg-import-file').click(); }

  async function handleImportFile(ev) {
    const file = ev.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      // Suporta tanto o formato novo { schemaVersion, exportedAt, data: {...} }
      // quanto flat (legado). A validação olha nos dois níveis.
      const inner = (data && data.data) ? data.data : data;
      if (!inner || (!inner.wrongBank && !inner.questionBank && !inner.sessions && !inner.globalStats)) {
        await modalAlert('Arquivo não parece ser um backup válido do Painel Fiscal.');
        ev.target.value = '';
        return;
      }
      const mode = await modal('Importar Backup', `
        Como aplicar o backup?<br><br>
        <strong style="color:#22c55e;">MESCLAR</strong> — combina com dados atuais (recomendado)<br>
        <strong style="color:#ef4444;">SUBSTITUIR</strong> — apaga tudo e usa só o backup`, [
        { label: 'Cancelar',   value: null,        kind: 'cancel' },
        { label: 'Substituir', value: 'replace',   kind: 'danger' },
        { label: 'Mesclar',    value: 'merge',     kind: 'confirm' },
      ]);
      if (!mode) { ev.target.value = ''; return; }
      const r = await bgMsg({ type: 'IMPORT_BACKUP', backup: data, mode });
      if (r && r.ok) {
        await modalAlert(`Backup ${mode === 'merge' ? 'mesclado' : 'substituído'} com sucesso!<br>${r.keys || 0} chaves processadas.`, 'Importado');
        await loadAll();
      } else {
        await modalAlert('Falha ao importar: ' + ((r && r.error) || 'erro desconhecido'));
      }
    } catch (e) {
      await modalAlert('Erro ao ler arquivo: ' + e.message);
    } finally {
      ev.target.value = '';
    }
  }

  async function exportQuestionBank() {
    const r = await bgMsg({ type: 'EXPORT_QUESTION_BANK' });
    if (!r || !r.bank) return;
    downloadFile(JSON.stringify(r.bank, null, 2), 'painel-fiscal-repositorio.json', 'application/json');
  }

  async function copyQuestionBank() {
    const r = await bgMsg({ type: 'EXPORT_QUESTION_BANK' });
    if (!r || !r.bank) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(r.bank));
      const btn = $('cfg-copy-qbank'); const orig = btn.textContent;
      btn.textContent = '✓ Copiado!';
      setTimeout(() => { btn.textContent = orig; }, 2000);
    } catch { modalAlert('Não foi possível copiar. Use o botão Exportar JSON.'); }
  }

  async function resetStats() {
    if (!(await modalConfirm('⚠ Isso apagará TODOS os dados locais (sessões, erros, stats, notes, tags, IRT, edital, biblioteca PDF, activity). Tem certeza?', 'Resetar tudo?', true))) return;
    await new Promise(r => chrome.storage.local.clear(r));
    insightsData = null; calendarData = null; clustersData = null;
    activityData = null; irtStats = null; editalData = null; libStats = null;
    await loadAll();
    const btn = $('cfg-reset');
    btn.textContent = '✓ Dados removidos';
    setTimeout(() => { btn.textContent = '🗑 Resetar estatísticas'; }, 2000);
  }

  // ── Huberman
  function hubOpen(url) { if (url) { chrome.tabs.create({ url }); window.close(); } }
  async function hubCorrect(qid) { await bgMsg({ type: 'HUBERMAN_CORRECT', qid }); await softRefresh(true); }
  async function hubWrong(qid)   { await bgMsg({ type: 'HUBERMAN_WRONG',   qid }); await softRefresh(true); }
  async function hubDismiss(qid) { await bgMsg({ type: 'HUBERMAN_DISMISS', qid }); await softRefresh(true); }
  async function hubAddCustom() {
    const mins = parseInt($('hub-custom-mins').value) || 15;
    const hub  = (appData?.hubQueue || [])[0];
    if (!hub) { await modalAlert('Nenhuma questão Huberman na fila para agendar.'); return; }
    await bgMsg({ type: 'HUBERMAN_CUSTOM', qid: hub.qid, mins });
    await softRefresh(true);
  }

  // ── Simulado com filtro
  async function startSimulado() {
    const materia = $('sim-filter-materia').value || '';
    const assunto = $('sim-filter-assunto').value || '';
    const count   = Math.max(5, Math.min(50, parseInt($('sim-filter-count').value) || 10));

    const r = await bgMsg({ type: 'GET_SIMULADO', filter: { materia, assunto }, count });
    if (!r || !r.questions || !r.questions.length) {
      await modalAlert('Nenhuma questão no banco de erros para esse filtro. Resolva questões erradas no TEC primeiro.');
      return;
    }
    const questions = r.questions;
    await new Promise(resolve => chrome.storage.local.set({ simuladoQueue: questions }, resolve));
    questions.forEach(q => { if (q.url) chrome.tabs.create({ url: q.url, active: false }); });
    await modalAlert(`Simulado iniciado com ${questions.length} questões! As abas foram abertas.`);
    window.close();
  }

  // ── Notes / Tags
  async function saveNote(qid) {
    const inp = document.querySelector(`[data-role="note-inp"][data-qid="${qid}"]`);
    if (!inp) return;
    await bgMsg({ type: 'SAVE_NOTE', qid, note: inp.value });
    const btn = document.querySelector(`[data-action="save-note"][data-qid="${qid}"]`);
    if (btn) { const orig = btn.textContent; btn.textContent = '✓'; setTimeout(() => { btn.textContent = orig; }, 1200); }
  }

  async function saveTag(qid) {
    const inp = document.querySelector(`[data-role="tag-inp"][data-qid="${qid}"]`);
    if (!inp || !inp.value.trim()) return;
    const newTags = inp.value.split(',').map(t => t.trim()).filter(Boolean);
    const existing = (appData?.tags?.[qid]) || [];
    const merged = [...new Set([...existing, ...newTags])];
    await bgMsg({ type: 'SAVE_TAG', qid, tags: merged });
    if (!appData.tags) appData.tags = {};
    appData.tags[qid] = merged;
    inp.value = '';
    renderRevisao(appData);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TABS
  // ═══════════════════════════════════════════════════════════════════════════

  document.querySelectorAll('.sb-item').forEach(tab => {
    tab.addEventListener('click', async () => {
      document.querySelectorAll('.sb-item').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      activeTab = tab.dataset.tab;
      $('panel-' + activeTab).classList.add('active');
      if (activeTab === 'revisao'   && appData) renderRevisao(appData);
      if (activeTab === 'historico' && appData) renderHistorico(appData);
      if (activeTab === 'analise'   && appData) renderAnalise(appData);
      if (activeTab === 'insights')              await renderInsights();
      if (activeTab === 'edital')                await renderEdital();
      if (activeTab === 'biblio')                await renderBiblio();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // EVENT DELEGATION (CSP-safe)
  // ═══════════════════════════════════════════════════════════════════════════

  document.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action  = btn.dataset.action;
    const qid     = btn.dataset.qid;
    const url     = btn.dataset.url;
    const quality = btn.dataset.quality;

    switch (action) {
      case 'open-question':   openQuestion(url); break;
      case 'mark-review':     markReview(qid, parseInt(quality)); break;
      case 'hub-open':        hubOpen(url); break;
      case 'hub-correct':     hubCorrect(qid); break;
      case 'hub-wrong':       hubWrong(qid); break;
      case 'hub-dismiss':     hubDismiss(qid); break;
      case 'hub-add-custom':  hubAddCustom(); break;
      case 'save-note':       saveNote(qid); break;
      case 'save-tag':        saveTag(qid); break;
      case 'man-hub-start':   manHubStart(parseInt(btn.dataset.mins) || 5, btn.dataset.label); break;
      case 'man-hub-cancel':  manHubCancel(); break;
      case 'man-hub-result':  manHubResult(btn.dataset.remembered === '1'); break;
      case 'toggle-similar': {
        const body = btn.parentElement.querySelector('[data-role="sim-body"]');
        const arr  = btn.querySelector('[data-role="arrow"]');
        if (body) {
          const open = body.style.display !== 'none';
          body.style.display = open ? 'none' : 'block';
          if (arr) arr.textContent = open ? '▶' : '▼';
        }
        break;
      }

      case 'recalc-similar': {
        const qid = btn.dataset.qid;
        if (!qid) break;

        // Feedback visual: botão mostra loading
        const origTxt = btn.textContent;
        btn.textContent = '⏳';
        btn.disabled    = true;

        // Busca payload do wrongBank via storage
        chrome.runtime.sendMessage({ type: 'EXPORT_WRONG' }, async wrRes => {
          const bankArr = (wrRes?.bank) || [];
          const q = bankArr.find(q => q.qid === qid);
          if (!q) {
            btn.textContent = origTxt;
            btn.disabled    = false;
            return;
          }

          chrome.runtime.sendMessage(
            { type: 'RECALCULATE_SIMILAR', payload: q, limit: 8 },
            res => {
              const similar  = res?.similar || [];
              const updatedAt = res?.updatedAt;

              // Substitui o sim-panel inteiro dentro do qcard
              const simPanelEl = btn.closest('.sim-panel');
              if (simPanelEl) {
                const newHtml = simPanelHtml(similar, qid, updatedAt);
                const tmp = document.createElement('div');
                tmp.innerHTML  = newHtml;
                simPanelEl.replaceWith(tmp.firstElementChild || simPanelEl);
              }

              btn.textContent = origTxt;
              btn.disabled    = false;

              // Abre automaticamente o painel de resultados
              const newPanel = document.querySelector(`.qcard [data-role="sim-body"]`);
              if (newPanel) newPanel.style.display = 'block';
            }
          );
        });
        break;
      }
      case 'open-sim-block': {
        try {
          const urls = JSON.parse(decodeURIComponent(btn.dataset.urls || '[]'));
          urls.forEach(u => chrome.tabs.create({ url: u, active: false }));
        } catch {}
        break;
      }
      case 'ed-toggle-mat': {
        const body = btn.parentElement.querySelector('.ed-mat-body');
        const arr  = btn.querySelector('.ed-mat-arrow');
        if (body && arr) {
          const open = body.classList.contains('open');
          body.classList.toggle('open', !open);
          arr.classList.toggle('open', !open);
        }
        break;
      }
      case 'lib-delete': {
        deleteLibQuestion(btn.dataset.qid);
        break;
      }
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ATALHOS DE TECLADO
  // ═══════════════════════════════════════════════════════════════════════════

  document.addEventListener('keydown', async e => {
    if (!e.altKey) return;
    if (activeTab !== 'revisao') return;
    let quality = null;
    if (e.key === '1') quality = 1;
    else if (e.key === '2') quality = 4;
    else if (e.key === '3') quality = 5;
    if (quality === null) return;
    // Primeira qcard com botão de revisão
    const firstQid = document.querySelector('[data-action="mark-review"]')?.dataset.qid;
    if (firstQid) {
      e.preventDefault();
      await markReview(firstQid, quality);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // STATIC LISTENERS
  // ═══════════════════════════════════════════════════════════════════════════

  $('btn-tec').addEventListener('click', openTec);
  $('btn-panel').addEventListener('click', openPanel);
  $('pop-timer-tog').addEventListener('click', popTimerToggle);
  $('pop-timer-reset').addEventListener('click', popTimerReset);

  $('cfg-notifications').addEventListener('click', () => toggleSetting('notifications'));
  $('cfg-autoReveal').addEventListener('click',    () => toggleSetting('autoReveal'));
  $('cfg-smartGoal').addEventListener('click',     () => toggleSetting('smartGoal'));
  $('cfg-autoBackup').addEventListener('click',    () => toggleSetting('autoBackup'));

  $('cfg-save').addEventListener('click', saveConfig);
  $('cfg-export-json').addEventListener('click', exportWrong);
  $('cfg-export-csv').addEventListener('click', exportCSV);
  $('cfg-export-anki').addEventListener('click', exportAnki);
  $('cfg-export-backup').addEventListener('click', exportBackup);
  $('cfg-import-backup').addEventListener('click', importBackup);
  $('cfg-import-file').addEventListener('change', handleImportFile);
  $('cfg-reset').addEventListener('click', resetStats);
  $('cfg-export-qbank').addEventListener('click', exportQuestionBank);
  $('cfg-copy-qbank').addEventListener('click', copyQuestionBank);

  // Pomodoro
  $('pom-tog').addEventListener('click', pomodoroToggle);
  $('pom-skip').addEventListener('click', pomodoroSkipBtn);
  $('pom-sound-btn') && $('pom-sound-btn').addEventListener('click', togglePomSound);
  $('pom-reset').addEventListener('click', pomodoroResetBtn);
  $('pom-toggle-section').addEventListener('click', () => {
    const body = $('pom-body'); const arrow = $('pom-arrow');
    if (!body || !arrow) return;
    const isOpen = body.classList.contains('open');
    body.classList.toggle('open', !isOpen);
    arrow.classList.toggle('open', !isOpen);
  });

  // Hour chart toggle
  $('hr-btn-q').addEventListener('click', () => hrPopMode('q'));
  $('hr-btn-rate').addEventListener('click', () => hrPopMode('rate'));

  // Simulado
  const btnSim = $('btn-simulado');
  if (btnSim) btnSim.addEventListener('click', startSimulado);

  // IRT Simulado Adaptativo
  const btnIRT = $('btn-irt');
  if (btnIRT) btnIRT.addEventListener('click', startIRTSimulado);

  // Biblioteca PDF
  setupBiblioListeners();

  // Filtro: atualiza assunto quando matéria muda
  $('sim-filter-materia').addEventListener('change', () => {
    if (appData) populateFilterDropdowns(appData.subjectStats, appData.dueReviews);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════════════════════════════════════════

  loadAll();

  const _refreshInterval = setInterval(softRefresh, 3000);
  const _statusInterval  = setInterval(updateStatusBar, 10000);

  window.addEventListener('unload', () => {
    clearInterval(_refreshInterval);
    clearInterval(_statusInterval);
    if (popTimerLocal)   clearInterval(popTimerLocal);
    if (pomTickInterval) clearInterval(pomTickInterval);
    if (_manHubLocal)    clearInterval(_manHubLocal);
  });

}); // end DOMContentLoaded
