/**
 * Painel Fiscal — TEC Automator v2.0
 * Widget visual com grade de questões (estilo Base do Aprovado)
 * Rastreia acertos/erros em tempo real e persiste localmente.
 */
(function () {
  'use strict';
  if (window._pfTecAuto2) return;
  window._pfTecAuto2 = true;

  const PANEL_URL = 'https://cazuzaleo89-netizen.github.io/projetofiscal/';

  // ════════════════════════════════════════════════════════
  // ESTADO
  // ════════════════════════════════════════════════════════
  const S = {
    pfw: null,
    A: 0, E: 0,                   // contadores TEC sincronizados
    connectTime: Date.now(),
    lastUrl: '',
    endSent: false,
    desempenhoOpen: false,
    autoFetchKey: '',
    textDetectKey: '',
    hiddenSince: 0,
    // Grade de questões
    questions: [],                 // [{result,qid,url,materia,assunto,timeSpent}]
    totalQ: 0,
    currentQ: 0,                   // 1-based
    caderno: '',
    materia: '',
    assunto: '',
    // Contadores locais (não dependem do painel)
    localAce: 0,
    localErr: 0,
    // Stats do painel (via postMessage)
    stats: { elapsed: 0, acertos: 0, erros: 0, resolved: 0, running: false, paused: false, discName: '', dificuldade: '' },
    // Fila de revisão
    fila: [],
    // UI
    minimized: false,
    // Tempo por questão
    questionStart: Date.now(),
  };

  let widgetEl = null;
  let observer = null;
  let timerInterval = null;   // setInterval do cronômetro
  let timerElapsed  = 0;      // segundos (cache local do background)
  let timerRunning  = false;

  // Novas vars: drag, hub e revisões pendentes
  let _pfDragPos  = null;   // {left, top} em px (null = posição default)
  let _pfHubNext  = null;   // próximo item Huberman ativo
  let _pfDueCount = 0;      // revisões SM-2 pendentes
  let _syncTick   = 0;      // contador para sincronizações periódicas

  // ════════════════════════════════════════════════════════
  // COMUNICAÇÃO COM PAINEL
  // ════════════════════════════════════════════════════════

  function findPanelWindow() {
    if (window.opener && !window.opener.closed) return window.opener;
    try { const w = window.open('', '_pfPanel'); if (w && !w.closed && w !== window) return w; } catch (x) { /* */ }
    return null;
  }

  function send(result, qi) {
    const msg = { type: 'TEC_QUESTION', result };
    if (qi) Object.assign(msg, qi);
    if (S.pfw && !S.pfw.closed) { try { S.pfw.postMessage(msg, '*'); return true; } catch (x) { /* */ } }
    S.pfw = findPanelWindow();
    if (S.pfw && !S.pfw.closed) { try { S.pfw.postMessage(msg, '*'); return true; } catch (x) { /* */ } }
    try { chrome.runtime.sendMessage({ type: 'RELAY_TO_PANEL', payload: msg }); return true; } catch (x) { /* */ }
    return false;
  }

  function sendRaw(msg) {
    if (S.pfw && !S.pfw.closed) { try { S.pfw.postMessage(msg, '*'); return; } catch (x) { /* */ } }
    S.pfw = findPanelWindow();
    if (S.pfw && !S.pfw.closed) { try { S.pfw.postMessage(msg, '*'); return; } catch (x) { /* */ } }
    try { chrome.runtime.sendMessage({ type: 'RELAY_TO_PANEL', payload: msg }); } catch (x) { /* */ }
  }

  // Comunicação com background (armazenamento local)
  function toBg(type, payload) {
    try { chrome.runtime.sendMessage({ type, payload }); } catch (x) { /* */ }
  }

  // ════════════════════════════════════════════════════════
  // CRONÔMETRO
  // ════════════════════════════════════════════════════════

  function fmtTimer(secs) {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    const pad = n => String(n).padStart(2, '0');
    return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }

  function updateTimerDisplay() {
    const display = document.getElementById('_pf2timerVal');
    const dot     = document.getElementById('_pf2timerDot');
    const togBtn  = document.getElementById('_pf2timerTog');
    if (!display) return;
    if (timerRunning) timerElapsed++;          // incremento local entre polls
    display.textContent = fmtTimer(timerElapsed);
    if (dot) {
      dot.style.background = timerRunning ? '#22c55e' : '#f59e0b';
      dot.style.boxShadow  = timerRunning ? '0 0 6px #22c55e' : '0 0 5px #f59e0b';
    }
    if (togBtn) togBtn.textContent = timerRunning ? '⏸' : '▶';
  }

  function syncTimerFromBg(callback) {
    try {
      chrome.runtime.sendMessage({ type: 'TIMER_GET' }, resp => {
        if (resp) {
          timerElapsed = resp.elapsed || 0;
          timerRunning = !!resp.running;
          updateTimerDisplay();
        }
        if (callback) callback(resp);
      });
    } catch (x) { /* */ }
  }

  function startTimerTick() {
    if (timerInterval) clearInterval(timerInterval);
    syncTimerFromBg();
    timerInterval = setInterval(() => {
      updateTimerDisplay();
      _syncTick++;
      // Atualiza countdown do hub mini a cada segundo sem re-render completo
      updateHubCd();
      if (_syncTick % 15 === 0) syncHubStatus();
      if (_syncTick % 30 === 0) { syncDueCount(); _syncTick = 0; }
    }, 1000);
    setInterval(syncTimerFromBg, 10000);
  }

  // ── Sincronização: Huberman ─────────────────────────────────────────────────
  function syncHubStatus() {
    try {
      chrome.runtime.sendMessage({ type: 'HUBERMAN_GET' }, resp => {
        if (!resp) return;
        const queue = (resp.hub || []).filter(h => !h.isDue || true); // inclui todos
        if (!queue.length) { if (_pfHubNext) { _pfHubNext = null; renderWidget(); } return; }
        const next = queue.sort((a, b) => a.reviewAt - b.reviewAt)[0];
        const wasNull = !_pfHubNext;
        _pfHubNext = next;
        if (wasNull) renderWidget(); // mostrar o novo banner
      });
    } catch (x) {}
  }

  function updateHubCd() {
    const cdEl = document.getElementById('_pf2hubcd');
    if (!cdEl || !_pfHubNext) return;
    const remNow = Math.max(0, Math.round((_pfHubNext.reviewAt - Date.now()) / 1000));
    const cdTxt = remNow > 0 ? `⏱ ${Math.floor(remNow/60)}:${String(remNow%60).padStart(2,'0')}` : '⚡ REVISAR';
    const cdColor = remNow <= 0 ? '#f59e0b' : '#a78bfa';
    cdEl.textContent = cdTxt;
    cdEl.style.color = cdColor;
  }

  // ── Sincronização: revisões SM-2 pendentes ──────────────────────────────────
  function syncDueCount() {
    try {
      chrome.runtime.sendMessage({ type: 'GET_DUE_COUNT' }, resp => {
        if (!resp) return;
        const total = (resp.dueCount || 0);
        if (total !== _pfDueCount) { _pfDueCount = total; renderWidget(); }
      });
    } catch (x) {}
  }

  // ── Drag & drop do widget ───────────────────────────────────────────────────
  function initDrag() {
    if (!widgetEl) return;
    let dragging = false, ox = 0, oy = 0, sl = 0, st = 0;

    widgetEl.addEventListener('mousedown', e => {
      if (!e.target.closest('._pf2h') || e.target.closest('button')) return;
      dragging = true;
      const r = widgetEl.getBoundingClientRect();
      ox = e.clientX; oy = e.clientY;
      sl = r.left;    st = r.top;
      widgetEl.style.right  = 'auto';
      widgetEl.style.bottom = 'auto';
      widgetEl.style.left   = sl + 'px';
      widgetEl.style.top    = st + 'px';
      widgetEl.style.cursor = 'grabbing';
      e.preventDefault();
    });

    document.addEventListener('mousemove', e => {
      if (!dragging) return;
      const nl = Math.max(0, Math.min(window.innerWidth - widgetEl.offsetWidth, sl + e.clientX - ox));
      const nt = Math.max(0, Math.min(window.innerHeight - 40, st + e.clientY - oy));
      widgetEl.style.left = nl + 'px';
      widgetEl.style.top  = nt + 'px';
    }, { passive: true });

    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      widgetEl.style.cursor = '';
      _pfDragPos = { left: parseFloat(widgetEl.style.left), top: parseFloat(widgetEl.style.top) };
      try { localStorage.setItem('_pfPos', JSON.stringify(_pfDragPos)); } catch (x) {}
    });
  }

  function applyDragPos() {
    if (!widgetEl) return;
    try {
      const saved = _pfDragPos || JSON.parse(localStorage.getItem('_pfPos') || 'null');
      if (saved && saved.left != null) {
        _pfDragPos = saved;
        widgetEl.style.right  = 'auto';
        widgetEl.style.bottom = 'auto';
        widgetEl.style.left   = Math.min(saved.left, window.innerWidth - 50)  + 'px';
        widgetEl.style.top    = Math.min(saved.top,  window.innerHeight - 50) + 'px';
      }
    } catch (x) {}
  }

  function timerControl(action) {
    try {
      chrome.runtime.sendMessage({ type: action }, resp => {
        if (resp) { timerElapsed = resp.elapsed || 0; timerRunning = !!resp.running; updateTimerDisplay(); }
      });
    } catch (x) { /* */ }
  }

  // ════════════════════════════════════════════════════════
  // PARSERS
  // ════════════════════════════════════════════════════════

  function parseCounter() {
    const tx = document.body.innerText || '';
    let m = tx.match(/(\d+)\s+Acertos?\s+e\s+(\d+)\s+Erros?/i);
    if (!m) m = tx.match(/Acertos?[:\s]+(\d+)[^\d]+Erros?[:\s]+(\d+)/i);
    if (!m) m = tx.match(/(\d+)\s+certos?\s+e\s+(\d+)\s+errados?/i);
    if (!m) {
      // Tenta pegar contadores separados em elementos de stats do TEC
      const els = document.querySelectorAll('[class*="acerto"],[class*="erro"],[class*="correct"],[class*="wrong"],[class*="stat"]');
      let a = null, e = null;
      els.forEach(el => {
        const t = el.textContent || '';
        if (/acerto/i.test(t)) { const n = t.match(/\d+/); if (n) a = parseInt(n[0]); }
        if (/erro/i.test(t))   { const n = t.match(/\d+/); if (n) e = parseInt(n[0]); }
      });
      if (a !== null && e !== null) return { a, e };
    }
    return m ? { a: parseInt(m[1]), e: parseInt(m[2]) } : null;
  }

  function parsePosition() {
    const tx = document.body.innerText || '';
    let m = tx.match(/Quest[aã]o\s+(\d+)\s+de\s+(\d+)/i);
    if (!m) m = tx.match(/(\d+)\s*\/\s*(\d+)\s*quest/i);
    if (!m) m = tx.match(/(\d+)\s+de\s+(\d+)/i);
    return m ? { n: parseInt(m[1]), t: parseInt(m[2]) } : null;
  }

  function getInfo() {
    const info = { url: '', desc: '', materia: '', assunto: '', qid: '', myTotal: 0, myErrors: 0, timeSpent: 0 };
    const tx = document.body.innerText || '';

    const urlPM = window.location.pathname.match(/\/questoes\/(\d{5,9})(?:\/|$)/);
    if (urlPM) { info.qid = urlPM[1]; info.url = 'https://www.tecconcursos.com.br/questoes/' + urlPM[1]; }
    if (!info.qid) {
      const links = document.querySelectorAll("a[href*='/questoes/']");
      for (const l of links) {
        const lm = l.href.match(/\/questoes\/(\d{5,9})/);
        if (lm) { info.qid = lm[1]; info.url = 'https://www.tecconcursos.com.br/questoes/' + lm[1]; break; }
      }
    }
    if (!info.qid) { const idM = tx.match(/#(\d{5,9})\b/); if (idM) { info.qid = idM[1]; info.url = 'https://www.tecconcursos.com.br/questoes/' + idM[1]; } }
    if (!info.url) info.url = window.location.href;

    const matM = tx.match(/Mat[eé]ria:\s*([^\n\r×]+)/i);
    if (matM) info.materia = matM[1].replace(/\s*[××].*$/, '').trim();
    const assM = tx.match(/Assunto:\s*([^\n\r×]+)/i);
    if (assM) info.assunto = assM[1].replace(/\s*[××].*$/, '').trim();
    const parts = [];
    if (info.materia) parts.push(info.materia);
    if (info.assunto) parts.push(info.assunto);
    info.desc = parts.join(' — ') || (info.qid ? 'Questão #' + info.qid : 'Questão');

    const myResM = tx.match(/Total de resolu[çc][õo]es[:\s]+(\d+)/i);
    info.myTotal = myResM ? parseInt(myResM[1]) : 0;
    const myErrArr = tx.match(/\bErrou\b/gi);
    info.myErrors = myErrArr ? myErrArr.length : 0;
    const myErrNumM = tx.match(/(\d+)\s*(?:erros?\b|[x×]\s*errou)/i) || tx.match(/errou[\s:]+(\d+)/i);
    if (myErrNumM) { const ne = parseInt(myErrNumM[1]); if (ne > info.myErrors) info.myErrors = ne; }

    info.timeSpent = Math.round((Date.now() - S.questionStart) / 1000);
    return info;
  }

  // ════════════════════════════════════════════════════════
  // GRADE DE QUESTÕES
  // ════════════════════════════════════════════════════════

  function ensureQuestions(total) {
    if (!total || total <= 0) return;
    S.totalQ = total;
    while (S.questions.length < total) {
      S.questions.push({ result: null, qid: '', url: '', materia: '', assunto: '', timeSpent: 0 });
    }
  }

  function setQuestionResult(pos, result, qi) {
    if (!pos || pos < 1) return;
    ensureQuestions(Math.max(S.totalQ, pos));
    const q = S.questions[pos - 1];
    q.result = result;
    if (qi) {
      if (qi.qid) q.qid = qi.qid;
      if (qi.url) q.url = qi.url;
      if (qi.materia) q.materia = qi.materia;
      if (qi.assunto) q.assunto = qi.assunto;
      if (qi.timeSpent) q.timeSpent = qi.timeSpent;
    }
  }

  // ════════════════════════════════════════════════════════
  // ESTILOS DO WIDGET
  // ════════════════════════════════════════════════════════

  function injectStyles() {
    if (document.getElementById('_pfStyles2')) return;
    const st = document.createElement('style');
    st.id = '_pfStyles2';
    st.textContent = `
      @keyframes _pfSlide2{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
      @keyframes _pfPop{0%{transform:scale(.7)}60%{transform:scale(1.15)}100%{transform:scale(1)}}
      @keyframes _pfPulse2{0%,100%{opacity:1}50%{opacity:.5}}

      #_pfWidget2{
        position:fixed;bottom:20px;right:20px;z-index:2147483647;
        width:316px;
        background:#1a1d2e;
        border-radius:13px;
        border:1px solid rgba(255,255,255,.09);
        box-shadow:0 24px 70px rgba(0,0,0,.85),0 0 0 1px rgba(255,255,255,.04) inset;
        font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;
        color:#e2e8f0;overflow:hidden;user-select:none;
        animation:_pfSlide2 .32s cubic-bezier(.16,1,.3,1);
      }
      #_pfWidget2 *{box-sizing:border-box;}

      /* ── Header ── */
      ._pf2h{
        display:flex;align-items:center;gap:8px;
        padding:10px 12px;
        background:linear-gradient(135deg,#252a40,#1e2338);
        border-bottom:1px solid rgba(255,255,255,.07);
        min-height:42px;
      }
      ._pf2logo{
        width:26px;height:26px;background:#f59e0b;border-radius:6px;
        display:flex;align-items:center;justify-content:center;
        font-size:14px;flex-shrink:0;font-weight:900;
      }
      ._pf2title{flex:1;font-size:13px;font-weight:700;color:#e2e8f0;letter-spacing:.3px;}
      ._pf2hbtn{
        width:22px;height:22px;border:none;cursor:pointer;
        border-radius:5px;background:rgba(255,255,255,.07);
        color:#94a3b8;font-size:13px;line-height:1;padding:0;
        display:flex;align-items:center;justify-content:center;
        transition:background .15s,color .15s;flex-shrink:0;
      }
      ._pf2hbtn:hover{background:rgba(255,255,255,.14);color:#e2e8f0;}

      /* ── Body ── */
      ._pf2body{padding:11px 12px;}

      ._pf2session{
        font-size:12.5px;font-weight:700;color:#c7d2fe;
        margin-bottom:5px;line-height:1.35;
        white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
      }

      ._pf2stats{
        display:flex;align-items:center;gap:7px;
        font-size:11px;color:#64748b;margin-bottom:9px;
      }
      ._pf2stats .qtotal{color:#94a3b8;}
      ._pf2stats .qcerto{color:#22c55e;font-weight:700;}
      ._pf2stats .qreforco{color:#f59e0b;font-weight:700;}
      ._pf2syncbtn{
        margin-left:auto;width:20px;height:20px;border:none;cursor:pointer;
        background:rgba(255,255,255,.06);border-radius:50%;
        color:#64748b;font-size:12px;
        display:flex;align-items:center;justify-content:center;
        transition:all .3s;border:1px solid rgba(255,255,255,.06);
      }
      ._pf2syncbtn:hover{background:rgba(255,255,255,.12);color:#94a3b8;transform:rotate(180deg);}

      /* Cronômetro */
      ._pf2timer{
        display:flex;align-items:center;gap:7px;
        background:#0f1220;border:1px solid rgba(255,255,255,.07);
        border-radius:10px;padding:9px 12px;margin-bottom:10px;
      }
      ._pf2timerdot{
        width:7px;height:7px;border-radius:50%;flex-shrink:0;
        transition:background .3s,box-shadow .3s;
      }
      ._pf2timerval{
        flex:1;font-family:'SF Mono','Courier New',monospace;
        font-size:22px;font-weight:800;color:#e2e8f0;letter-spacing:1px;line-height:1;
      }
      ._pf2timerbtn{
        width:26px;height:26px;border:1px solid rgba(255,255,255,.1);
        border-radius:7px;background:rgba(255,255,255,.06);
        color:#94a3b8;font-size:13px;cursor:pointer;
        display:flex;align-items:center;justify-content:center;
        transition:all .15s;flex-shrink:0;padding:0;
      }
      ._pf2timerbtn:hover{background:rgba(255,255,255,.14);color:#e2e8f0;}
      ._pf2timerbtn.paused{background:rgba(34,197,94,.1);border-color:#22c55e55;color:#22c55e;}
      ._pf2timerbtn.paused:hover{background:rgba(34,197,94,.2);}

      /* Barra de precisão */
      ._pf2bar{height:3px;background:#2a2f47;border-radius:2px;margin-bottom:9px;overflow:hidden;}
      ._pf2barfill{height:100%;background:linear-gradient(90deg,#22c55e,#4ade80);border-radius:2px;transition:width .5s cubic-bezier(.16,1,.3,1);}

      ._pf2pos{font-size:11px;color:#6366f1;font-weight:700;margin-bottom:8px;letter-spacing:.3px;}

      /* ── Grade de círculos ── */
      ._pf2grid{
        display:grid;
        grid-template-columns:repeat(9,1fr);
        gap:4px;
        margin-bottom:11px;
      }
      ._pf2c{
        width:100%;aspect-ratio:1;border-radius:50%;
        display:flex;align-items:center;justify-content:center;
        font-size:9.5px;font-weight:800;cursor:pointer;
        border:2px solid transparent;
        transition:transform .15s,box-shadow .15s,border-color .2s;
        position:relative;
      }
      ._pf2c:hover{transform:scale(1.15);z-index:2;}
      ._pf2c.pending{background:#252a42;color:#4b5563;border-color:#2f3555;}
      ._pf2c.correct{background:#15803d;color:#fff;border-color:#22c55e;animation:_pfPop .25s ease;}
      ._pf2c.wrong{background:#b91c1c;color:#fff;border-color:#ef4444;animation:_pfPop .25s ease;}
      ._pf2c.current.pending{background:#2a2640;border-color:#f59e0b;box-shadow:0 0 0 3px rgba(245,158,11,.2);color:#f59e0b;}
      ._pf2c.current.correct{border-color:#f59e0b;box-shadow:0 0 0 3px rgba(245,158,11,.2);}
      ._pf2c.current.wrong{border-color:#f59e0b;box-shadow:0 0 0 3px rgba(245,158,11,.2);}

      /* ── Fila de revisão (mini banner) ── */
      ._pf2fila{
        display:flex;align-items:center;gap:7px;
        background:rgba(239,68,68,.09);
        border:1px solid rgba(239,68,68,.2);
        border-radius:8px;padding:6px 10px;
        margin-bottom:10px;cursor:pointer;
        transition:background .15s;
      }
      ._pf2fila:hover{background:rgba(239,68,68,.15);}
      ._pf2filadot{width:5px;height:5px;border-radius:50%;background:#ef4444;flex-shrink:0;animation:_pfPulse2 1.2s ease infinite;}
      ._pf2filatxt{flex:1;font-size:10.5px;color:#fca5a5;font-weight:700;}
      ._pf2filakbd{font-size:8px;color:#64748b;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);padding:1px 5px;border-radius:3px;font-family:monospace;}

      /* ── Navegação ── */
      ._pf2nav{display:flex;gap:7px;border-top:1px solid rgba(255,255,255,.06);padding-top:10px;}
      ._pf2navbtn{
        flex:1;padding:8px 4px;border:1px solid rgba(255,255,255,.09);
        background:#20243a;color:#94a3b8;border-radius:8px;
        font-size:12px;font-weight:700;cursor:pointer;
        transition:all .15s;
      }
      ._pf2navbtn:hover{background:#272c47;color:#e2e8f0;border-color:rgba(255,255,255,.18);}
      ._pf2navbtn.primary{background:#4f46e5;border-color:#6366f1;color:#fff;}
      ._pf2navbtn.primary:hover{background:#4338ca;border-color:#818cf8;}

      /* ── Estado minimizado ── */
      #_pfWidget2.pf2-min{
        width:auto;border-radius:50px;cursor:pointer;
      }
      #_pfWidget2.pf2-min ._pf2body{display:none;}
      #_pfWidget2.pf2-min ._pf2h{
        border-radius:50px;border:none;padding:8px 14px;gap:10px;
      }

      /* ── Drag handle ── */
      ._pf2h{cursor:grab;}
      ._pf2h:active{cursor:grabbing;}
      ._pf2drag{
        display:flex;flex-direction:column;gap:2.5px;flex-shrink:0;
        opacity:.35;pointer-events:none;
      }
      ._pf2drag span{display:block;width:14px;height:2px;background:#94a3b8;border-radius:1px;}

      /* ── Taxa ao vivo ── */
      ._pf2taxa{
        display:flex;background:#0f1220;border:1px solid rgba(255,255,255,.07);
        border-radius:9px;margin-bottom:9px;overflow:hidden;
      }
      ._pf2taxa-it{
        flex:1;display:flex;flex-direction:column;align-items:center;
        justify-content:center;padding:7px 4px;
      }
      ._pf2taxa-it+._pf2taxa-it{border-left:1px solid rgba(255,255,255,.06);}
      ._pf2taxa-v{font-size:16px;font-weight:800;line-height:1;}
      ._pf2taxa-l{font-size:8px;color:#475569;font-weight:700;letter-spacing:.7px;margin-top:2px;}

      /* ── Mini histórico ── */
      ._pf2mhist{display:flex;align-items:center;gap:3px;margin-bottom:9px;}
      ._pf2mhist-lbl{font-size:9px;color:#475569;font-weight:700;margin-right:2px;flex-shrink:0;}
      ._pf2mhd{width:10px;height:10px;border-radius:3px;flex-shrink:0;}
      ._pf2mhd.c{background:#15803d;border:1px solid rgba(34,197,94,.25);}
      ._pf2mhd.w{background:#b91c1c;border:1px solid rgba(239,68,68,.25);}
      ._pf2mhd.p{background:#252a42;border:1px solid rgba(255,255,255,.06);}

      /* ── Hub mini ── */
      ._pf2hub-min{
        display:flex;align-items:center;gap:6px;
        background:rgba(139,92,246,.07);border:1px solid rgba(139,92,246,.18);
        border-radius:7px;padding:5px 9px;margin-bottom:8px;cursor:pointer;transition:background .15s;
      }
      ._pf2hub-min:hover{background:rgba(139,92,246,.14);}
      ._pf2hub-min-txt{flex:1;font-size:10px;color:#c4b5fd;font-weight:700;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
      ._pf2hub-min-cd{font-size:10px;font-weight:800;flex-shrink:0;font-family:monospace;}

      /* ── Revisões SM-2 pendentes ── */
      ._pf2due{
        display:flex;align-items:center;gap:6px;
        background:rgba(99,102,241,.07);border:1px solid rgba(99,102,241,.15);
        border-radius:7px;padding:5px 9px;margin-bottom:8px;cursor:pointer;transition:background .15s;
      }
      ._pf2due:hover{background:rgba(99,102,241,.14);}
      ._pf2due-dot{width:5px;height:5px;border-radius:50%;background:#6366f1;flex-shrink:0;}
      ._pf2due-txt{flex:1;font-size:10px;color:#818cf8;font-weight:700;}
    `;
    document.head.appendChild(st);
  }

  // ════════════════════════════════════════════════════════
  // RENDERIZAÇÃO DO WIDGET
  // ════════════════════════════════════════════════════════

  function renderWidget() {
    if (!widgetEl) return;
    injectStyles();

    if (S.minimized) {
      widgetEl.className = 'pf2-min';
      widgetEl.innerHTML = `
        <div class="_pf2h">
          <div class="_pf2logo">≡</div>
          <div class="_pf2title">Painel Fiscal</div>
          <span style="font-size:11px;color:#22c55e;font-weight:700;">✓${S.localAce}</span>
          <span style="font-size:11px;color:#ef4444;font-weight:700;">✕${S.localErr}</span>
        </div>`;
      widgetEl.onclick = () => { S.minimized = false; renderWidget(); };
      return;
    }

    widgetEl.className = '';
    widgetEl.onclick = null;

    const pos = parsePosition();
    const curQ = pos ? pos.n : S.currentQ;
    const totalQ = pos ? pos.t : (S.totalQ || 0);
    if (totalQ > 0) ensureQuestions(totalQ);

    const answered = S.questions.filter(q => q.result !== null).length;
    const correct  = S.questions.filter(q => q.result === 'correct').length;
    const reforco  = S.questions.filter(q => q.result === 'wrong').length;
    const pct      = answered > 0 ? Math.round(correct / answered * 100) : 0;

    const caderno = S.caderno || S.materia || document.title.replace(/\s*[|·\-]\s*TecConcursos.*$/i, '').trim() || 'Sessão TEC';
    const shortCaderno = caderno.length > 36 ? caderno.slice(0, 34) + '…' : caderno;

    // Monta círculos
    const showTotal = Math.max(totalQ, S.questions.length, 1);
    let circlesHtml = '';
    for (let i = 0; i < showTotal; i++) {
      const q = S.questions[i] || { result: null };
      const num = i + 1;
      const isCurrent = num === curQ;
      let cls = 'pending';
      let label = num;
      if (q.result === 'correct') { cls = 'correct'; label = '✓'; }
      else if (q.result === 'wrong') { cls = 'wrong'; label = '✕'; }
      if (isCurrent) cls += ' current';
      const url = q.url ? `data-url="${q.url}"` : '';
      circlesHtml += `<div class="_pf2c ${cls}" data-n="${num}" ${url} title="Q${num}${q.materia ? ' · ' + q.materia : ''}">${label}</div>`;
    }

    // Banner de fila
    const filaBanner = S.fila.length > 0 ? `
      <div class="_pf2fila" id="_pf2filarow">
        <div class="_pf2filadot"></div>
        <span class="_pf2filatxt">${S.fila.length} revisão${S.fila.length > 1 ? 'ões' : ''} pendente${S.fila.length > 1 ? 's' : ''}</span>
        <kbd class="_pf2filakbd">Alt+R</kbd>
      </div>` : '';

    // ── Novos elementos ──────────────────────────────────────────────────────
    const taxaColor = pct >= 70 ? '#22c55e' : pct >= 50 ? '#f59e0b' : '#ef4444';
    const ritmo = timerElapsed >= 60 ? Math.round(answered / (timerElapsed / 3600)) : 0;
    const taxaRow = answered > 0 ? `
      <div class="_pf2taxa">
        <div class="_pf2taxa-it">
          <div class="_pf2taxa-v" style="color:${taxaColor}">${pct}%</div>
          <div class="_pf2taxa-l">TAXA</div>
        </div>
        <div class="_pf2taxa-it">
          <div class="_pf2taxa-v" style="color:#94a3b8">${answered}</div>
          <div class="_pf2taxa-l">RESPONDIDAS</div>
        </div>
        <div class="_pf2taxa-it">
          <div class="_pf2taxa-v" style="color:#64748b">${ritmo > 0 ? '~' + ritmo : '—'}</div>
          <div class="_pf2taxa-l">Q/HORA</div>
        </div>
      </div>` : '';

    const lastAnswered = S.questions.filter(q => q.result !== null).slice(-9);
    const histDots = lastAnswered.map(q => `<div class="_pf2mhd ${q.result === 'correct' ? 'c' : 'w'}"></div>`).join('');
    const miniHist = lastAnswered.length > 0 ? `
      <div class="_pf2mhist">
        <span class="_pf2mhist-lbl">Últimas:</span>
        ${histDots}
      </div>` : '';

    const hubMini = _pfHubNext ? (() => {
      const remNow = Math.max(0, Math.round((_pfHubNext.reviewAt - Date.now()) / 1000));
      const cdTxt = remNow > 0 ? `⏱ ${Math.floor(remNow/60)}:${String(remNow%60).padStart(2,'0')}` : '⚡ REVISAR';
      const cdColor = remNow <= 0 ? '#f59e0b' : '#a78bfa';
      return `<div class="_pf2hub-min" id="_pf2hubmin">
        <span style="font-size:13px;flex-shrink:0;">🧠</span>
        <span class="_pf2hub-min-txt">Fase ${_pfHubNext.phase} · ${(_pfHubNext.desc || '').slice(0, 28)}</span>
        <span class="_pf2hub-min-cd" id="_pf2hubcd" style="color:${cdColor}">${cdTxt}</span>
      </div>`;
    })() : '';

    const dueBanner = _pfDueCount > 0 ? `
      <div class="_pf2due" id="_pf2duebanner">
        <div class="_pf2due-dot"></div>
        <span class="_pf2due-txt">📅 ${_pfDueCount} revisão${_pfDueCount !== 1 ? 'ões' : ''} SM-2 pendente${_pfDueCount !== 1 ? 's' : ''}</span>
      </div>` : '';

    widgetEl.innerHTML = `
      <div class="_pf2h">
        <div class="_pf2drag"><span></span><span></span><span></span></div>
        <div class="_pf2logo">≡</div>
        <div class="_pf2title">Painel Fiscal</div>
        <button class="_pf2hbtn" id="_pf2min" title="Minimizar">−</button>
        <button class="_pf2hbtn" id="_pf2x" title="Fechar">×</button>
      </div>
      <div class="_pf2body">
        <div class="_pf2session">${shortCaderno}</div>
        <div class="_pf2stats">
          <span class="qtotal">${showTotal} questões</span>
          <span class="qcerto">✓ ${correct}/${answered}</span>
          ${reforco > 0 ? `<span class="qreforco">+${reforco} reforço</span>` : ''}
          <button class="_pf2syncbtn" id="_pf2sync" title="Sincronizar com painel">↺</button>
        </div>

        ${taxaRow}
        ${miniHist}

        <!-- Cronômetro -->
        <div class="_pf2timer">
          <div class="_pf2timerdot" id="_pf2timerDot" style="background:${timerRunning ? '#22c55e' : '#f59e0b'};box-shadow:0 0 6px ${timerRunning ? '#22c55e' : '#f59e0b'};"></div>
          <span class="_pf2timerval" id="_pf2timerVal">${fmtTimer(timerElapsed)}</span>
          <button class="_pf2timerbtn ${timerRunning ? '' : 'paused'}" id="_pf2timerTog" title="${timerRunning ? 'Pausar' : 'Iniciar'}">${timerRunning ? '⏸' : '▶'}</button>
          <button class="_pf2timerbtn" id="_pf2timerReset" title="Zerar">⏹</button>
        </div>

        <div class="_pf2pos">◆ ${curQ || '?'}/${showTotal || '?'}</div>
        <div class="_pf2grid">${circlesHtml}</div>
        ${hubMini}
        ${dueBanner}
        ${filaBanner}
        <div class="_pf2nav">
          <button class="_pf2navbtn" id="_pf2ant">← Ant</button>
          <button class="_pf2navbtn primary" id="_pf2prox">Prox →</button>
        </div>
      </div>`;

    // — Eventos dos botões
    document.getElementById('_pf2min').onclick = ev => { ev.stopPropagation(); S.minimized = true; renderWidget(); };
    document.getElementById('_pf2x').onclick = ev => {
      ev.stopPropagation();
      if (confirm('Remover widget do Painel Fiscal?')) {
        if (observer) observer.disconnect();
        widgetEl.remove(); widgetEl = null; window._pfTecAuto2 = false;
      }
    };
    document.getElementById('_pf2sync').onclick = ev => {
      ev.stopPropagation();
      toBg('GET_FILA', {});
      send('ping', null);
    };

    // Botões do cronômetro
    document.getElementById('_pf2timerTog').onclick = ev => {
      ev.stopPropagation();
      timerControl(timerRunning ? 'TIMER_PAUSE' : 'TIMER_START');
      timerRunning = !timerRunning;
      renderWidget();  // re-render para trocar ícone imediatamente
    };
    document.getElementById('_pf2timerReset').onclick = ev => {
      ev.stopPropagation();
      if (confirm('Zerar cronômetro?')) {
        timerControl('TIMER_RESET');
        timerElapsed = 0; timerRunning = false;
        renderWidget();
      }
    };

    // Navegação: clica nos botões do TEC
    const navClick = selector => ev => {
      ev.stopPropagation();
      const btn = document.querySelector(selector);
      if (btn) { btn.click(); return; }
      const all = document.querySelectorAll('button');
      const re = selector.includes('ant') ? /ant|anterior|voltar|prev/i : /pr[oó]x|próximo|next|seguinte/i;
      for (const b of all) { if (re.test(b.textContent || '') && b.offsetParent) { b.click(); return; } }
    };
    document.getElementById('_pf2ant').onclick = navClick('[class*="anterior"],[aria-label*="Anterior"]');
    document.getElementById('_pf2prox').onclick = navClick('[class*="proxim"],[aria-label*="Próxima"]');

    // Clique em círculo → abre questão
    widgetEl.querySelectorAll('._pf2c[data-url]').forEach(c => {
      if (c.getAttribute('data-url')) {
        c.addEventListener('click', ev => { ev.stopPropagation(); window.open(c.getAttribute('data-url'), '_self'); });
      }
    });

    // Banner de fila
    const filaRow = document.getElementById('_pf2filarow');
    if (filaRow && S.fila[0]) filaRow.onclick = () => window.open(S.fila[0].link || S.fila[0].url, '_self');

    // Hub mini: clica para abrir a questão
    const hubMinEl = document.getElementById('_pf2hubmin');
    if (hubMinEl && _pfHubNext) {
      hubMinEl.onclick = () => { if (_pfHubNext.url) window.open(_pfHubNext.url, '_self'); };
    }

    // Due banner: clica para abrir popup
    const dueEl = document.getElementById('_pf2duebanner');
    if (dueEl) dueEl.onclick = () => { try { chrome.runtime.sendMessage({ type: 'OPEN_POPUP' }); } catch (x) {} };
  }

  // ════════════════════════════════════════════════════════
  // SCANNING
  // ════════════════════════════════════════════════════════

  function scanDesempenho() {
    const tx = document.body.innerText || '';
    if (!tx.includes('Meu Desempenho')) return;
    const qi = getInfo();
    if (!qi.qid) return;
    const meuIdx = tx.indexOf('Meu Desempenho');
    const globalTx = meuIdx >= 0 ? tx.slice(0, meuIdx) : tx;
    const myTx = meuIdx >= 0 ? tx.slice(meuIdx) : '';
    const errouArr = myTx.match(/\bErrou\b/gi);
    let myErrors = errouArr ? errouArr.length : 0;
    const myErrNumM = myTx.match(/(\d+)\s*(?:erros?\b|[x×]\s*errou)/i);
    if (myErrNumM) { const ne = parseInt(myErrNumM[1]); if (ne > myErrors) myErrors = ne; }
    const myResM = myTx.match(/Total de resolu[çc][õo]es[:\s]+(\d+)/i);
    const myTotal = myResM ? parseInt(myResM[1]) : 0;
    const difM = globalTx.match(/Dificuldade:\s*([^\n\r]+)/i);
    const dificuldade = difM ? difM[1].trim() : '';
    qi.myErrors = myErrors; qi.myTotal = myTotal; qi.dificuldade = dificuldade;
    if (dificuldade && S.stats.dificuldade !== dificuldade) { S.stats.dificuldade = dificuldade; renderWidget(); }
    send('desempenho_detail', qi);
  }

  function autoFetchDesempenho(snapQid) {
    const qi = getInfo();
    if (snapQid && qi.qid && qi.qid !== snapQid) return;
    const dKey = (qi.qid || window.location.href) + '_' + S.A + '_' + S.E;
    if (S.autoFetchKey === dKey) return;
    const tx = document.body.innerText || '';
    const meuIdx = tx.indexOf('Meu Desempenho');
    const myTx = meuIdx >= 0 ? tx.slice(meuIdx) : '';
    const hasData = meuIdx >= 0 && (myTx.includes('Total de resolu') || myTx.includes('Errou') || myTx.includes('Acertou'));
    if (hasData) { S.autoFetchKey = dKey; scanDesempenho(); return; }
    const clickables = document.querySelectorAll('button,[role="button"]');
    for (const btn of clickables) {
      const t = (btn.textContent || '').trim();
      if (/desempenho/i.test(t) && !/fechar|esconder/i.test(t) && t.length < 80) {
        S.autoFetchKey = dKey; btn.click();
        setTimeout(() => {
          scanDesempenho();
          setTimeout(() => {
            for (const b of document.querySelectorAll('button')) { if (/fechar/i.test(b.textContent || '')) { b.click(); break; } }
          }, 350);
        }, 750);
        break;
      }
    }
  }

  function scanHistory() {
    const tx = document.body.innerText || '';
    if (!window.location.pathname.match(/\/questoes\/(\d{5,9})(?:\/|$)/)) return;
    let myErrors = 0;
    const myErrArr = tx.match(/\bErrou\b/gi);
    myErrors = myErrArr ? myErrArr.length : 0;
    const myErrNumM = tx.match(/(\d+)\s*(?:erros?\b|[x×]\s*errou)/i) || tx.match(/errou[\s:]+(\d+)/i);
    if (myErrNumM) { const ne = parseInt(myErrNumM[1]); if (ne > myErrors) myErrors = ne; }
    if (myErrors <= 0) return;
    const myResM = tx.match(/Total de resolu[çc][õo]es[:\s]+(\d+)/i);
    const qi = getInfo();
    if (!qi.qid) return;
    qi.myErrors = myErrors; qi.myTotal = myResM ? parseInt(myResM[1]) : 0;
    send('wrong_import', qi);
  }

  function checkCadernoEnd() {
    if (S.endSent) return;
    const pos = parsePosition();
    if (!pos || pos.n !== pos.t || pos.t <= 0) return;
    const counter = parseCounter();
    const done = counter ? (counter.a + counter.e) : 0;
    if (done >= pos.t) {
      S.endSent = true;
      setTimeout(() => {
        const stats = { total: pos.t, correct: counter ? counter.a : 0, wrong: counter ? counter.e : 0, elapsed: S.stats.elapsed || 0 };
        sendRaw({ type: 'TEC_CADERNO_END', stats });
        toBg('SESSION_END', { stats, questions: S.questions, caderno: S.caderno });
      }, 2500);
    }
  }

  // ════════════════════════════════════════════════════════
  // LOOP PRINCIPAL (MutationObserver)
  // ════════════════════════════════════════════════════════

  function check() {
    const cu = window.location.href;

    // Mudança de URL = nova questão
    if (cu !== S.lastUrl) {
      S.lastUrl = cu;
      S.endSent = false;
      S.desempenhoOpen = false;
      S.textDetectKey = '';
      S.questionStart = Date.now();

      const pos2 = parsePosition();
      if (pos2) { S.currentQ = pos2.n; ensureQuestions(pos2.t); }

      const title = document.title.replace(/\s*[|·\-]\s*TecConcursos.*$/i, '').trim();
      if (title && !S.caderno) S.caderno = title;

      setTimeout(scanHistory, 1200);
      setTimeout(checkCadernoEnd, 1500);
      renderWidget();
    }

    const tx0 = document.body.innerText || '';

    // Atualiza posição
    const pos = parsePosition();
    if (pos && pos.n !== S.currentQ) { S.currentQ = pos.n; ensureQuestions(pos.t); renderWidget(); }

    // Painel Desempenho abriu?
    const desempOpen = tx0.includes('Meu Desempenho') && tx0.includes('Desempenho Geral');
    if (desempOpen && !S.desempenhoOpen) { S.desempenhoOpen = true; setTimeout(scanDesempenho, 400); }
    else if (!desempOpen) S.desempenhoOpen = false;

    const counter = parseCounter();
    const warmup = Date.now() - S.connectTime < 3000;

    // ── Fallback: detecção por texto ──
    if (!counter) {
      const hasAcertou = /você acertou|acertou!|mandou bem|resposta correta|gabarito correto|alternativa correta/i.test(tx0);
      const hasErrou   = /você errou|resposta incorreta|gabarito incorreto|alternativa incorreta|errou!/i.test(tx0);
      if ((hasAcertou || hasErrou) && !warmup) {
        const qi = getInfo();
        const key = (qi.qid || cu) + '_' + (hasAcertou ? 'c' : 'e');
        if (key !== S.textDetectKey) {
          S.textDetectKey = key;
          S.desempenhoOpen = false;
          const snapQid = qi.qid;
          const curPos = pos ? pos.n : S.currentQ;

          if (hasAcertou) {
            S.localAce++;
            S.stats.acertos = Math.max(S.stats.acertos, S.localAce);
            S.stats.resolved = S.localAce + S.localErr;
            setQuestionResult(curPos, 'correct', qi);
            renderWidget();
            send('correct', null);
            toBg('QUESTION_CORRECT', { qid: qi.qid, url: qi.url, materia: qi.materia, assunto: qi.assunto, timeSpent: qi.timeSpent, pos: curPos, timestamp: Date.now() });
          } else {
            S.localErr++;
            S.stats.erros = Math.max(S.stats.erros, S.localErr);
            S.stats.resolved = S.localAce + S.localErr;
            setQuestionResult(curPos, 'wrong', qi);
            renderWidget();
            send('wrong_fast', qi);
            toBg('QUESTION_WRONG', { qid: qi.qid, url: qi.url, materia: qi.materia, assunto: qi.assunto, desc: qi.desc, timeSpent: qi.timeSpent, pos: curPos, timestamp: Date.now() });
            setTimeout(() => {
              const qi2 = getInfo();
              if (snapQid && qi2.qid !== snapQid) { qi2.qid = snapQid; qi2.url = qi.url; qi2.desc = qi.desc; qi2.materia = qi.materia; qi2.assunto = qi.assunto; }
              send('wrong', qi2);
            }, 500);
          }

          setTimeout(() => autoFetchDesempenho(snapQid), 1500);
          setTimeout(() => autoFetchDesempenho(snapQid), 4000);
          setTimeout(checkCadernoEnd, 800);
        }
      } else if (!hasAcertou && !hasErrou) {
        S.textDetectKey = '';
      }
      return;
    }

    // ── Primário: contador "X Acertos e Y Erros" ──
    const da = counter.a - S.A;
    const de = counter.e - S.E;
    if (warmup) { if (da > 0) S.A = counter.a; if (de > 0) S.E = counter.e; return; }

    const curPos = pos ? pos.n : S.currentQ;

    if (da > 0) {
      S.localAce += da;
      S.stats.acertos = Math.max(S.stats.acertos, S.localAce);
      S.stats.resolved = S.localAce + S.localErr;
      setQuestionResult(curPos, 'correct', getInfo());
      for (let i = 0; i < da; i++) send('correct', null);
      S.A = counter.a;
      toBg('QUESTION_CORRECT', { pos: curPos, timestamp: Date.now() });
      renderWidget();
    }

    if (da > 0 || de > 0) {
      S.desempenhoOpen = false;
      const snapQidD = getInfo().qid;
      S.textDetectKey = (snapQidD || cu) + '_' + (da > 0 ? 'c' : 'e');
      setTimeout(() => autoFetchDesempenho(snapQidD), 1500);
      setTimeout(() => autoFetchDesempenho(snapQidD), 4000);
    }
    if (da > 0 || de > 0) setTimeout(checkCadernoEnd, 800);

    if (de > 0) {
      const deCount = de; S.E = counter.e;
      const qi0 = getInfo();
      S.localErr += deCount;
      S.stats.erros = Math.max(S.stats.erros, S.localErr);
      S.stats.resolved = S.localAce + S.localErr;
      setQuestionResult(curPos, 'wrong', qi0);
      renderWidget();
      send('wrong_fast', qi0);
      toBg('QUESTION_WRONG', { qid: qi0.qid, url: qi0.url, materia: qi0.materia, assunto: qi0.assunto, desc: qi0.desc, timeSpent: qi0.timeSpent, pos: curPos, timestamp: Date.now() });
      setTimeout(() => {
        const qi = getInfo();
        if (qi0.qid && (!qi.qid || qi.qid !== qi0.qid)) { qi.url = qi0.url; qi.qid = qi0.qid; qi.desc = qi0.desc || qi.desc; qi.materia = qi0.materia || qi.materia; qi.assunto = qi0.assunto || qi.assunto; }
        for (let i = 0; i < deCount; i++) send('wrong', qi);
        if (!qi.myErrors) {
          const _u = qi.url, _q = qi.qid;
          setTimeout(() => { const q2 = getInfo(); q2.url = _u; q2.qid = _q; if (q2.myErrors > 0) send('wrong_update', q2); }, 2500);
        }
      }, 500);
    }
  }

  // ════════════════════════════════════════════════════════
  // LISTENERS DE MENSAGENS
  // ════════════════════════════════════════════════════════

  window.addEventListener('message', ev => {
    if (!ev.data || !ev.data.type) return;

    if (ev.data.type === 'TEC_STATS_UPDATE') {
      S.stats = {
        elapsed: ev.data.elapsed || 0,
        acertos: Math.max(ev.data.acertos || 0, S.localAce),
        erros:   Math.max(ev.data.erros   || 0, S.localErr),
        resolved: Math.max(ev.data.resolved || 0, S.localAce + S.localErr),
        running: !!ev.data.running, paused: !!ev.data.paused,
        discName: ev.data.discName || '',
        dificuldade: ev.data.dificuldade || S.stats.dificuldade || '',
      };
      if (ev.data.discName && !S.caderno) S.caderno = ev.data.discName;
      renderWidget();
      try { chrome.runtime.sendMessage({ type: 'UPDATE_BADGE', filaCount: S.fila.length, stats: S.stats }); } catch (x) { /* */ }
      return;
    }
    if (ev.data.type === 'PF_FILA_READY') {
      S.fila = ev.data.items || [];
      renderWidget();
      try { chrome.runtime.sendMessage({ type: 'UPDATE_BADGE', filaCount: S.fila.length }); } catch (x) { /* */ }
      return;
    }
    if (ev.data.type === 'PF_OPEN_QUESTION' && ev.data.url) { window.open(ev.data.url, '_self'); return; }
    if (ev.data.type === 'PF_NO_FILA') {
      const nb = document.createElement('div');
      nb.style.cssText = 'position:fixed;top:14px;left:50%;transform:translateX(-50%);background:#1a1d2e;color:#e2e8f0;padding:10px 18px;border-radius:10px;font-size:13px;z-index:2147483647;border:1px solid rgba(255,255,255,.12);font-family:sans-serif;';
      nb.textContent = '⏰ Fila vazia — nenhuma revisão pendente';
      document.body.appendChild(nb);
      setTimeout(() => nb.remove(), 3000);
    }
  });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg) return;
    if (msg.type === 'PING') {
      sendResponse({ pong: true, stats: { localAce: S.localAce, localErr: S.localErr, totalQ: S.totalQ, currentQ: S.currentQ, caderno: S.caderno } });
      return true;
    }
    if (msg.type === 'FROM_PANEL') window.dispatchEvent(new MessageEvent('message', { data: msg.payload }));
    if (msg.type === 'GET_QUESTIONS') {
      sendResponse({ questions: S.questions, totalQ: S.totalQ, currentQ: S.currentQ, caderno: S.caderno });
      return true;
    }
    if (msg.type === 'HUBERMAN_DUE' && msg.item) showHubermanBanner(msg.item);
  });

  // ════════════════════════════════════════════════════════
  // BANNER HUBERMAN (aparece quando uma fase está pronta)
  // ════════════════════════════════════════════════════════

  function showHubermanBanner(item) {
    const prev = document.getElementById('_pfHubBanner');
    if (prev) prev.remove();

    const phaseLabel = item.customMins != null
      ? `Intervalo custom ${item.customMins}min`
      : `Fase ${item.phase} de 3 · ${[5, 9, 11][item.phase - 1]}min`;

    const phases = [1, 2, 3].map(p => {
      if (p < item.phase)  return `<span style="width:8px;height:8px;border-radius:50%;background:#22c55e;display:inline-block;"></span>`;
      if (p === item.phase) return `<span style="width:10px;height:10px;border-radius:50%;background:#f59e0b;display:inline-block;box-shadow:0 0 7px #f59e0b;"></span>`;
      return `<span style="width:8px;height:8px;border-radius:50%;background:#374151;display:inline-block;"></span>`;
    }).join('');

    const bn = document.createElement('div');
    bn.id = '_pfHubBanner';
    bn.style.cssText = `
      position:fixed;top:14px;left:50%;transform:translateX(-50%);
      background:linear-gradient(135deg,#1e1340,#0f1220);
      border:1px solid rgba(139,92,246,.4);
      border-radius:14px;padding:13px 16px;
      box-shadow:0 8px 32px rgba(139,92,246,.35),0 0 0 1px rgba(139,92,246,.15) inset;
      font-family:-apple-system,BlinkMacSystemFont,sans-serif;
      z-index:2147483647;min-width:300px;max-width:380px;
      animation:_pfSlide2 .3s cubic-bezier(.16,1,.3,1);
    `;
    bn.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:9px;">
        <span style="font-size:18px;">🧠</span>
        <div style="flex:1;">
          <div style="font-size:11px;font-weight:800;color:#a78bfa;letter-spacing:.6px;">REVISÃO HUBERMAN · ${phaseLabel.toUpperCase()}</div>
          <div style="display:flex;align-items:center;gap:5px;margin-top:4px;">${phases}</div>
        </div>
        <button id="_pfHubClose" style="background:none;border:none;color:#64748b;font-size:16px;cursor:pointer;padding:2px 6px;">✕</button>
      </div>
      <div style="font-size:12px;color:#c4b5fd;font-weight:600;margin-bottom:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
        ${item.materia ? `<span style="color:#7c3aed;font-weight:700;">${item.materia}</span> — ` : ''}${(item.desc || 'Questão #' + item.qid).slice(0, 60)}
      </div>
      <div style="display:flex;gap:7px;">
        <button id="_pfHubAbrir" style="flex:2;padding:8px;background:#6d28d9;border:none;border-radius:8px;color:#fff;font-size:12px;font-weight:700;cursor:pointer;">📖 Abrir Questão</button>
        <button id="_pfHubAcertei" style="flex:1;padding:8px;background:rgba(34,197,94,.15);border:1px solid #22c55e55;border-radius:8px;color:#22c55e;font-size:11px;font-weight:700;cursor:pointer;">✓ Acertei</button>
        <button id="_pfHubErrei" style="flex:1;padding:8px;background:rgba(239,68,68,.12);border:1px solid #ef444455;border-radius:8px;color:#ef4444;font-size:11px;font-weight:700;cursor:pointer;">✕ Errei</button>
      </div>`;

    document.body.appendChild(bn);

    // Auto-remove após 60s se não interagir
    const autoRemove = setTimeout(() => { if (bn.parentElement) bn.remove(); }, 60000);

    document.getElementById('_pfHubClose').onclick  = () => { clearTimeout(autoRemove); bn.remove(); };
    document.getElementById('_pfHubAbrir').onclick  = () => { clearTimeout(autoRemove); bn.remove(); if (item.url) window.open(item.url, '_self'); };
    document.getElementById('_pfHubAcertei').onclick = () => {
      clearTimeout(autoRemove); bn.remove();
      toBg('HUBERMAN_CORRECT', { qid: item.qid });
    };
    document.getElementById('_pfHubErrei').onclick  = () => {
      clearTimeout(autoRemove); bn.remove();
      toBg('HUBERMAN_WRONG', { qid: item.qid });
    };
  }

  // Alt+R → próxima da fila
  window.addEventListener('keydown', ev => {
    if (ev.altKey && (ev.key === 'r' || ev.key === 'R')) {
      ev.preventDefault();
      sendRaw({ type: 'PF_REQUEST_NEXT_FILA' });
    }
  });

  // Visibilidade → notifica painel (cronômetro só é controlado manualmente)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      S.hiddenSince = Date.now();
      setTimeout(() => {
        if (document.hidden && S.hiddenSince && (Date.now() - S.hiddenSince) >= 120000) {
          sendRaw({ type: 'TEC_TAB_INACTIVE' });
        }
      }, 120000);
    } else {
      if (S.hiddenSince && (Date.now() - S.hiddenSince) >= 120000) sendRaw({ type: 'TEC_TAB_ACTIVE' });
      S.hiddenSince = 0;
    }
  });

  // ════════════════════════════════════════════════════════
  // INIT
  // ════════════════════════════════════════════════════════

  function init() {
    S.pfw = findPanelWindow();
    S.connectTime = Date.now();

    const initCounter = parseCounter();
    if (initCounter) { S.A = initCounter.a; S.E = initCounter.e; }

    const pos0 = parsePosition();
    if (pos0) { S.currentQ = pos0.n; ensureQuestions(pos0.t); }

    const tx0 = document.body.innerText || '';
    const matM = tx0.match(/Mat[eé]ria:\s*([^\n\r×]+)/i);
    if (matM) S.materia = matM[1].replace(/\s*[××].*$/, '').trim();

    const title = document.title.replace(/\s*[|·\-]\s*TecConcursos.*$/i, '').trim();
    S.caderno = S.caderno || title || S.materia;

    const connected = send('ping', null);
    if (connected) {
      const assM = tx0.match(/Assunto:\s*([^\n\r×]+)/i);
      const assunto = assM ? assM[1].replace(/\s*[××].*$/, '').trim() : '';
      const sp = new URLSearchParams(window.location.search);
      send('session_info', { total: S.totalQ, materia: S.materia, assunto, caderno: S.caderno, cadernoBase: sp.get('cadernoBase') || '', idPasta: sp.get('idPasta') || '' });
      S.lastUrl = window.location.href;
      setTimeout(scanHistory, 1500);
    }

    toBg('SESSION_START', { caderno: S.caderno, materia: S.materia, totalQ: S.totalQ, url: window.location.href, timestamp: Date.now() });

    // Cria widget
    if (!document.getElementById('_pfWidget2')) {
      injectStyles();
      widgetEl = document.createElement('div');
      widgetEl.id = '_pfWidget2';
      document.body.appendChild(widgetEl);
      applyDragPos();
      renderWidget();
      initDrag();
    }

    observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });

    // Inicia tick do cronômetro + syncs periódicas
    startTimerTick();
    syncHubStatus();
    syncDueCount();

    try { chrome.runtime.sendMessage({ type: 'CONTENT_READY', connected, url: window.location.href }); } catch (x) { /* */ }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
