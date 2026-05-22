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

  // ── Recebe dados do content_main.js (MAIN world) via CustomEvent ────────
  // content_main.js intercepta o fetch/XHR REAL do Angular do TEC
  const _tecApi = { base: null, paths: [], schema: null };
  window.addEventListener('_pf_tec_api', ev => {
    const d = ev.detail;
    if (!d) return;
    if (d.type === 'URL' && d.base) {
      if (!_tecApi.paths.includes(d.base)) _tecApi.paths.push(d.base);
      if (!_tecApi.base) {
        _tecApi.base = d.base;
        try { chrome.runtime.sendMessage({ type: 'STORE_TEC_API', base: d.base, full: d.full }); } catch(_) {}
      }
    }
    if (d.type === 'DATA' && d.base && d.items?.length) {
      _tecApi.base   = d.base;
      _tecApi.schema = d;
      try { chrome.runtime.sendMessage({ type: 'STORE_TEC_API', base: d.base, full: d.full, schema: d.items }); } catch(_) {}
      // Corresponde questões capturadas ao reforço pendente
      for (const entry of (typeof S !== 'undefined' ? S.reforcoQueue : [])) {
        if (entry.fetched || entry.similares.length) continue;
        const matKey = (entry.qi.materia || '').toLowerCase().slice(0, 7);
        const matching = d.items.filter(q => {
          if (!matKey) return true;
          return (q.materia || '').toLowerCase().includes(matKey);
        });
        if (matching.length >= 2) {
          entry.similares = matching.map(q => ({
            qid: q.id, url: `https://www.tecconcursos.com.br/questoes/${q.id}`,
            label: q.enunciado || `Questão #${q.id}`,
            banca: q.banca, assunto: q.assunto, materia: q.materia, source: 'api-live',
          }));
          entry.loading = false;
          entry.fetched = true;
          if (typeof renderWidget === 'function') renderWidget();
        }
      }
    }
  });

  // ── Heartbeat para o painel detectar extensão ativa ──
  if (location.hostname === 'cazuzaleo89-netizen.github.io') {
    const beat = () => localStorage.setItem('_pf_ext_heartbeat', Date.now());
    beat();
    setInterval(beat, 8000);
    // Sincroniza ranking do TEC ao localStorage do painel
    const syncRanking = () => {
      try {
        chrome.runtime.sendMessage({ type: 'GET_TEC_RANKING' }, r => {
          if (r && r.data) localStorage.setItem('_pf_tec_ranking', JSON.stringify(r.data));
        });
      } catch (x) {}
    };
    syncRanking();
    setInterval(syncRanking, 30000);
    return;
  }

  // ── Scraper da página de ranking TEC (estatisticas/comparar) ──
  if (location.pathname.includes('/estatisticas/comparar')) {

    function _pfToast(msg, ok) {
      const t = document.createElement('div');
      t.style.cssText = `position:fixed;bottom:20px;right:20px;z-index:2147483647;
        background:${ok ? '#15803d' : '#92400e'};color:#fff;
        padding:10px 16px;border-radius:10px;font:700 12px/1.4 -apple-system,sans-serif;
        box-shadow:0 4px 20px rgba(0,0,0,.45);transition:opacity .4s;max-width:320px;`;
      t.textContent = msg;
      document.body.appendChild(t);
      setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 500); }, 5000);
    }

    function scrapeTecRanking() {
      const txt = document.body.innerText || '';
      if (txt.length < 150) return false;

      const data = { scrapedAt: Date.now(), url: location.href };
      const gM = location.pathname.match(/\/comparar\/(\d+)/);
      if (gM) data.groupId = gM[1];

      // Total users — several possible patterns
      for (const p of [
        /(\d+)\s*participantes?/i, /(\d+)\s*usu[aá]rios?/i,
        /(\d+)\s*membros?/i, /total[:\s]+(\d+)/i, /de\s+(\d{2,4})\b/,
      ]) {
        const m = txt.match(p);
        if (m && parseInt(m[1]) > 5) { data.totalUsers = parseInt(m[1]); break; }
      }

      // Flexible block extractor — handles both "VOCÊ\n30" and "Você: 30"
      const extractMetric = (metricVariants, isPercent) => {
        let startIdx = -1;
        for (const v of metricVariants) {
          const i = txt.search(new RegExp(v, 'i'));
          if (i >= 0) { startIdx = i; break; }
        }
        if (startIdx < 0) return null;
        const block = txt.slice(startIdx, startIdx + 900);

        const grabNum = (src, labelVariants, pct) => {
          for (const lv of labelVariants) {
            const li = src.search(new RegExp(lv, 'i'));
            if (li < 0) continue;
            const after = src.slice(li, li + 120);
            const m = pct
              ? after.match(/([\d]+[,.]\d+)\s*%/) || after.match(/(\d+)\s*%/)
              : after.match(/[\s\n:]+(\d+)/);
            if (m) return parseFloat((m[1] || m[0]).replace(',', '.'));
          }
          return null;
        };

        const posGrab = (src) => {
          for (const p of [
            /posi[çc][ãa]o[\s\S]{0,25}?(\d+)/i,
            /(\d+)\s*[°º]/,
            /posição\s*(\d+)/i,
            /lugar[:\s]+(\d+)/i,
          ]) { const m = src.match(p); if (m) return parseInt(m[1]); }
          return null;
        };

        const voce    = grabNum(block, ['você','voce','VOCÊ','VOCE','vc\b'], isPercent);
        const media   = grabNum(block, ['média','media','MÉDIA','MEDIA','méd'], isPercent);
        const posicao = posGrab(block);

        if (voce === null && posicao === null) return null;
        return { voce, media, posicao };
      };

      data.metrics = {};
      const res = extractMetric(['resolu[çc][õo]es','resolucoes','resoluções'], false);
      if (res) data.metrics.resolucoes = res;
      const ace = extractMetric(['acertos','acerto'], false);
      if (ace) data.metrics.acertos = ace;
      const des = extractMetric(['desempenho'], true);
      if (des) data.metrics.desempenho = des;

      // DOM leaf-node fallback when innerText layout breaks ordering
      if (!Object.keys(data.metrics).length) {
        try {
          const leaves = [];
          const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          while (w.nextNode()) {
            const t2 = (w.currentNode.textContent || '').trim();
            if (t2) leaves.push(t2);
          }
          const joined = leaves.join('\n');
          if (joined.length > 200) {
            // Retry with cleaned joined text
            const r2 = extractMetric.toString(); // just trigger re-run on joined
            for (const [variants, key, pct] of [
              [['resolu'], 'resolucoes', false],
              [['acerto'], 'acertos', false],
              [['desempenho'], 'desempenho', true],
            ]) {
              const idx = joined.search(new RegExp(variants[0], 'i'));
              if (idx < 0) continue;
              const blk = joined.slice(idx, idx + 900);
              const youM = pct ? blk.match(/([\d]+[,.]?\d*)\s*%/i) : null;
              const nums = [...blk.matchAll(/\d+[,.]?\d*/g)].map(m => parseFloat(m[0].replace(',','.')));
              if (nums.length >= 1) {
                data.metrics[key] = { voce: nums[0] || null, media: nums[1] || null, posicao: null };
              }
            }
          }
        } catch(x) {}
      }

      const ok = Object.keys(data.metrics).length > 0;
      if (ok) {
        try { chrome.runtime.sendMessage({ type: 'SAVE_TEC_RANKING', data }, () => {}); } catch(x) {}
        _pfToast('✅ Painel Fiscal: ranking capturado!', true);
      } else {
        _pfToast('⚠️ Painel Fiscal: não encontrei os dados — use "Inserir manualmente" no painel', false);
      }
      return ok;
    }

    let _scraped = false;
    [800, 2000, 4500, 9000].forEach(d => setTimeout(() => { if (!_scraped) _scraped = scrapeTecRanking(); }, d));
    const _obs = new MutationObserver(() => { if (!_scraped) _scraped = scrapeTecRanking(); });
    _obs.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => _obs.disconnect(), 25000);
    return;
  }

  // ── Auto-fill: página de filtro TEC (questoes/filtrar) ──────────────────
  if (location.pathname.includes('/questoes/filtrar')) {
    const _pfp = new URLSearchParams(location.search);
    const _pfMateria  = _pfp.get('pf_materia');
    const _pfAssunto  = _pfp.get('pf_assunto');
    const _pfKeywords = _pfp.get('pf_keywords');
    const _pfCaderno  = _pfp.get('pf_caderno');

    if (_pfMateria || _pfAssunto || _pfKeywords) {
      function _pfFiltBanner() {
        if (document.getElementById('_pfFiltBanner')) return;
        const label = _pfAssunto || _pfMateria || _pfKeywords || 'Reforço';
        const bn = document.createElement('div');
        bn.id = '_pfFiltBanner';
        bn.style.cssText = `
          position:fixed;top:0;left:0;right:0;z-index:2147483647;
          background:linear-gradient(135deg,#1e1b4b,#312e81);
          border-bottom:2px solid #3b82f6;padding:10px 20px;
          display:flex;align-items:center;gap:12px;
          font-family:-apple-system,BlinkMacSystemFont,sans-serif;
          box-shadow:0 4px 24px rgba(0,0,0,.4);`;
        bn.innerHTML = `
          <span style="font-size:18px;">🎯</span>
          <div style="flex:1;">
            <div style="font-size:10px;font-weight:800;color:#93c5fd;letter-spacing:.6px;text-transform:uppercase;">PAINEL FISCAL — REFORÇO INTELIGENTE</div>
            <div style="font-size:12px;color:#e2e8f0;margin-top:2px;"><strong>${label}</strong> — filtre as questões e clique em <em>Gerar Caderno</em></div>
          </div>
          <button id="_pfFiltBannerX" style="background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.2);color:#e2e8f0;border-radius:6px;padding:4px 10px;font-size:11px;cursor:pointer;">✕ Fechar</button>`;
        document.body.style.marginTop = '52px';
        document.body.prepend(bn);
        document.getElementById('_pfFiltBannerX').onclick = () => { bn.remove(); document.body.style.marginTop = ''; };
      }

      function _pfFiltFill() {
        let filled = false;
        if (_pfKeywords) {
          const inp = document.querySelector('input[placeholder*="enunciado" i], input[placeholder*="texto" i], input[type="search"]');
          if (inp && !inp.value) {
            inp.value = _pfKeywords;
            ['input','change'].forEach(ev => inp.dispatchEvent(new Event(ev, { bubbles: true })));
            filled = true;
          }
        }
        if (_pfCaderno) {
          const ci = document.querySelector('input[placeholder*="aderno" i], input[name*="caderno" i]');
          if (ci && ci.value === 'Caderno de Estudo') {
            ci.value = _pfCaderno;
            ['input','change'].forEach(ev => ci.dispatchEvent(new Event(ev, { bubbles: true })));
          }
        }
        if (filled) _pfFiltBanner();
        return filled;
      }

      _pfFiltBanner();
      [500, 1500, 3500, 7000].forEach(d => setTimeout(_pfFiltFill, d));
      const _fObs = new MutationObserver(_pfFiltFill);
      _fObs.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => _fObs.disconnect(), 20000);
    }
    return;
  }

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
    consecutiveWrong: 0,    // fadiga cognitiva
    recentResults: [],       // últimos 10 resultados (para queda de taxa)
    reforcoQueue: [],        // [{qi,similares[],loading,fetched}] acumuladas na sessão
    // Stats do painel (via postMessage)
    stats: { elapsed: 0, acertos: 0, erros: 0, resolved: 0, running: false, paused: false, discName: '', dificuldade: '' },
    // Fila de revisão
    fila: [],
    // UI
    minimized: false,
    lastEval: '',          // 'cabi' | 'chutei' | 'naosabia'
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
    const info = { url: '', desc: '', materia: '', assunto: '', banca: '', qid: '', myTotal: 0, myErrors: 0, timeSpent: 0 };
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

    // Lê hrefs dos links nativos do TEC — breadcrumb e metadados da questão
    // Inclui links relativos (sem "tecconcursos" no href)
    const allPageLinks = [...document.querySelectorAll('a[href]')];
    function _resolveHref(a) {
      const h = a.href || '';
      if (h.startsWith('http')) return h;
      if (h.startsWith('/')) return 'https://www.tecconcursos.com.br' + h;
      return h;
    }
    if (info.materia) {
      const matLow = info.materia.toLowerCase();
      const mLink = allPageLinks.find(a => {
        const t = (a.textContent || '').trim().toLowerCase();
        return t === matLow && _resolveHref(a).includes('tecconcursos');
      });
      if (mLink) info.materiaUrl = _resolveHref(mLink);
    }
    if (info.assunto) {
      const assLow = info.assunto.toLowerCase();
      const aLink = allPageLinks.find(a => {
        const t = (a.textContent || '').trim().toLowerCase();
        // Aceita correspondência parcial para assuntos longos (>40 chars)
        return (t === assLow || (assLow.length > 40 && t.startsWith(assLow.slice(0, 35).toLowerCase())))
          && _resolveHref(a).includes('tecconcursos');
      });
      if (aLink) info.assuntoUrl = _resolveHref(aLink);
    }

    for (const p of [/Banca[:\s]+([A-ZÁÉÍÓÚ][^\n\r,·×]{2,25})/i, /Organiza[çc][aã]o[:\s]+([^\n\r,]{2,25})/i]) {
      const bm = tx.match(p); if (bm) { info.banca = bm[1].trim(); break; }
    }
    // Extrai banca da linha de referência: "#2154055 FCC - 2022 - Analista..."
    if (!info.banca) {
      const refM = tx.match(/#\d{5,9}\s+([\w\-]{2,15})\s*[-–]\s*20\d\d/);
      if (refM) info.banca = refM[1].trim();
    }
    if (!info.banca) {
      const el = document.querySelector('[data-banca],[class*="banca-nome"],[class*="banca_nome"]');
      if (el) info.banca = (el.textContent || '').trim().slice(0, 30);
    }
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

    // Captura o texto do enunciado da questão para busca por similaridade
    info.enunciado = _extractEnunciado();
    info.keywords  = _extractKeywords(info.enunciado, info.materia, info.assunto);

    return info;
  }

  function _extractEnunciado() {
    // Tenta seletores comuns do TEC
    const sel = [
      '[class*="enunciado"]', '[class*="question-text"]', '[class*="questao-texto"]',
      '[class*="statement"]', '[class*="pergunta"]', 'article p', '.q-text',
    ];
    for (const s of sel) {
      const el = document.querySelector(s);
      if (el) {
        const t = (el.innerText || el.textContent || '').trim();
        if (t.length > 30) return t.slice(0, 400);
      }
    }
    // Fallback: maior parágrafo da página que pareça um enunciado
    const paras = [...document.querySelectorAll('p')].map(p => (p.innerText||'').trim()).filter(t => t.length > 60 && t.length < 800);
    return paras.sort((a,b) => b.length - a.length)[0] || '';
  }

  function _extractKeywords(enunciado, materia, assunto) {
    const stopwords = new Set(['de','do','da','em','no','na','os','as','um','uma','que','se','por','com','para','ao','dos','das','pelo','pela','entre','sobre','mais','quando','como','mas','ou','não','são','foi','ser','ter','tem','isso','este','esta','esse','essa','isso','aquele','qual','quais','após','antes','durante','caso','forma','artigo','lei','decreto']);
    const text = `${enunciado} ${assunto}`.toLowerCase();
    const words = text.match(/\b[a-záéíóúàâêôãõç]{4,}\b/g) || [];
    const freq = {};
    for (const w of words) { if (!stopwords.has(w)) freq[w] = (freq[w]||0) + 1; }
    return Object.entries(freq).sort((a,b) => b[1]-a[1]).slice(0,6).map(([w])=>w).join(' ');
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
        background:#1e2432;
        border-radius:14px;
        border:1px solid rgba(59,130,246,.15);
        box-shadow:0 24px 70px rgba(0,0,0,.85),0 8px 32px rgba(59,130,246,.08),0 0 0 1px rgba(255,255,255,.04) inset;
        font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;
        color:#e2e8f0;overflow:hidden;user-select:none;
        animation:_pfSlide2 .32s cubic-bezier(.16,1,.3,1);
      }
      #_pfWidget2 *{box-sizing:border-box;}

      /* ── Header ── */
      ._pf2h{
        display:flex;align-items:center;gap:8px;
        padding:10px 12px;
        background:linear-gradient(135deg,#252d3d,#1e2432);
        border-bottom:2px solid rgba(59,130,246,.2);
        min-height:44px;
        position:relative;
      }
      ._pf2logo{
        width:28px;height:28px;background:linear-gradient(135deg,#2563eb,#3b82f6);border-radius:8px;
        display:flex;align-items:center;justify-content:center;
        font-size:14px;flex-shrink:0;font-weight:900;
        box-shadow:0 2px 8px rgba(37,99,235,.4);
      }
      ._pf2title{flex:1;font-size:13px;font-weight:700;color:#e2e8f0;letter-spacing:.3px;}
      ._pf2hbtn{
        width:24px;height:24px;border:none;cursor:pointer;
        border-radius:6px;background:rgba(255,255,255,.07);
        color:#94a3b8;font-size:13px;line-height:1;padding:0;
        display:flex;align-items:center;justify-content:center;
        transition:background .15s,color .15s;flex-shrink:0;
      }
      ._pf2hbtn:hover{background:rgba(59,130,246,.2);color:#93c5fd;}

      /* ── Body ── */
      ._pf2body{padding:11px 12px;}

      ._pf2session{
        font-size:12.5px;font-weight:700;color:#bfdbfe;
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
        display:flex;align-items:center;gap:8px;
        background:#131c2e;border:1px solid rgba(59,130,246,.2);
        border-radius:11px;padding:10px 13px;margin-bottom:10px;
        border-left:3px solid #3b82f6;
      }
      ._pf2timerdot{
        width:7px;height:7px;border-radius:50%;flex-shrink:0;
        transition:background .3s,box-shadow .3s;
      }
      ._pf2timerval{
        flex:1;font-family:'SF Mono','Courier New',monospace;
        font-size:23px;font-weight:800;color:#e2e8f0;letter-spacing:2px;line-height:1;
      }
      ._pf2timerbtn{
        width:28px;height:28px;border:1px solid rgba(255,255,255,.1);
        border-radius:8px;background:rgba(255,255,255,.06);
        color:#94a3b8;font-size:13px;cursor:pointer;
        display:flex;align-items:center;justify-content:center;
        transition:all .15s;flex-shrink:0;padding:0;
      }
      ._pf2timerbtn:hover{background:rgba(59,130,246,.2);color:#93c5fd;border-color:rgba(59,130,246,.3);}
      ._pf2timerbtn.paused{background:rgba(34,197,94,.1);border-color:#22c55e55;color:#22c55e;}
      ._pf2timerbtn.paused:hover{background:rgba(34,197,94,.2);}

      /* Barra de precisão */
      ._pf2bar{height:3px;background:#1e2839;border-radius:2px;margin-bottom:9px;overflow:hidden;}
      ._pf2barfill{height:100%;background:linear-gradient(90deg,#22c55e,#4ade80);border-radius:2px;transition:width .5s cubic-bezier(.16,1,.3,1);}

      ._pf2pos{font-size:11px;color:#3b82f6;font-weight:700;margin-bottom:8px;letter-spacing:.3px;}

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
      ._pf2c.pending{background:#252d3d;color:#4b5563;border-color:#2d3a4d;}
      ._pf2c.correct{background:#15803d;color:#fff;border-color:#22c55e;animation:_pfPop .25s ease;}
      ._pf2c.wrong{background:#b91c1c;color:#fff;border-color:#ef4444;animation:_pfPop .25s ease;}
      ._pf2c.current.pending{background:#1e2d4d;border-color:#3b82f6;box-shadow:0 0 0 3px rgba(59,130,246,.25);color:#3b82f6;}
      ._pf2c.current.correct{border-color:#3b82f6;box-shadow:0 0 0 3px rgba(59,130,246,.2);}
      ._pf2c.current.wrong{border-color:#3b82f6;box-shadow:0 0 0 3px rgba(59,130,246,.2);}

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
      ._pf2nav{display:flex;gap:8px;border-top:1px solid rgba(59,130,246,.12);padding-top:10px;}
      ._pf2navbtn{
        flex:1;padding:9px 6px;border:1px solid rgba(255,255,255,.1);
        background:#252d3d;color:#94a3b8;border-radius:10px;
        font-size:12px;font-weight:700;cursor:pointer;
        transition:all .15s;letter-spacing:.2px;
      }
      ._pf2navbtn:hover{background:#2d3748;color:#e2e8f0;border-color:rgba(59,130,246,.3);}
      ._pf2navbtn.primary{background:linear-gradient(135deg,#2563eb,#3b82f6);border-color:#3b82f6;color:#fff;box-shadow:0 2px 12px rgba(37,99,235,.3);}
      ._pf2navbtn.primary:hover{background:linear-gradient(135deg,#1d4ed8,#2563eb);border-color:#60a5fa;box-shadow:0 4px 16px rgba(37,99,235,.4);}

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
        display:flex;background:#131c2e;border:1px solid rgba(59,130,246,.12);
        border-radius:10px;margin-bottom:9px;overflow:hidden;
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
      ._pf2mhd.p{background:#252d3d;border:1px solid rgba(255,255,255,.06);}

      /* ── Hub mini ── */
      ._pf2hub-min{
        display:flex;align-items:center;gap:6px;
        background:rgba(59,130,246,.07);border:1px solid rgba(59,130,246,.18);
        border-radius:8px;padding:5px 9px;margin-bottom:8px;cursor:pointer;transition:background .15s;
      }
      ._pf2hub-min:hover{background:rgba(59,130,246,.14);}
      ._pf2hub-min-txt{flex:1;font-size:10px;color:#93c5fd;font-weight:700;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
      ._pf2hub-min-cd{font-size:10px;font-weight:800;flex-shrink:0;font-family:monospace;}

      /* ── Revisões SM-2 pendentes ── */
      ._pf2due{
        display:flex;align-items:center;gap:6px;
        background:rgba(59,130,246,.07);border:1px solid rgba(59,130,246,.15);
        border-radius:8px;padding:5px 9px;margin-bottom:8px;cursor:pointer;transition:background .15s;
      }
      ._pf2due:hover{background:rgba(59,130,246,.14);}
      ._pf2due-dot{width:5px;height:5px;border-radius:50%;background:#3b82f6;flex-shrink:0;}
      ._pf2due-txt{flex:1;font-size:10px;color:#60a5fa;font-weight:700;}
      ._pf2reforco{
        display:flex;align-items:center;gap:6px;
        background:rgba(59,130,246,.06);border:1px solid rgba(59,130,246,.2);
        border-radius:8px;padding:5px 9px;margin-bottom:8px;
      }

      /* ── Como foi? ── */
      ._pf2eval{margin-bottom:10px;}
      ._pf2eval-lbl{font-size:9.5px;font-weight:700;color:#64748b;letter-spacing:.8px;margin-bottom:5px;}
      ._pf2eval-chips{display:flex;gap:5px;}
      ._pf2chip{
        flex:1;padding:6px 4px;border-radius:8px;
        font-size:10.5px;font-weight:700;cursor:pointer;
        border:1px solid rgba(255,255,255,.08);
        background:#252d3d;color:#64748b;
        transition:all .15s;text-align:center;
        display:flex;align-items:center;justify-content:center;gap:3px;
      }
      ._pf2chip:hover{border-color:rgba(59,130,246,.35);color:#93c5fd;background:#1e2d4d;}
      ._pf2chip.sel-cabi{background:rgba(34,197,94,.12);border-color:#22c55e55;color:#4ade80;}
      ._pf2chip.sel-chutei{background:rgba(245,158,11,.1);border-color:#f59e0b44;color:#fbbf24;}
      ._pf2chip.sel-naosabia{background:rgba(239,68,68,.1);border-color:#ef444433;color:#f87171;}
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
        ${S.reforcoQueue.length > 0 ? (() => {
          const nErros = S.reforcoQueue.length;
          const nSim = S.reforcoQueue.reduce((a, r) => a + r.similares.length, 0);
          const isLoading = S.reforcoQueue.some(r => r.loading);
          const simTxt = isLoading ? '⏳ buscando…' : nSim > 0 ? `${nSim} similar${nSim!==1?'es':''}` : 'filtro pronto';
          return `<div class="_pf2reforco" id="_pf2reforcoRow">
            <span style="font-size:13px;flex-shrink:0;">🎯</span>
            <div style="flex:1;min-width:0;">
              <div style="font-size:10px;font-weight:800;color:#93c5fd;line-height:1.2;">${nErros} erro${nErros!==1?'s':''} · ${simTxt}</div>
              <div style="font-size:9px;color:#475569;margin-top:1px;">Rodada de Reforço</div>
            </div>
            <button id="_pf2reforcoBtn" style="background:rgba(37,99,235,.28);border:1px solid rgba(37,99,235,.55);color:#93c5fd;border-radius:7px;padding:3px 8px;font-size:10px;font-weight:800;cursor:pointer;white-space:nowrap;flex-shrink:0;">Ver ↗</button>
          </div>`;
        })() : ''}
        <div class="_pf2eval">
          <div class="_pf2eval-lbl">COMO FOI?</div>
          <div class="_pf2eval-chips">
            <button class="_pf2chip ${S.lastEval === 'cabi' ? 'sel-cabi' : ''}" id="_pf2cabi">🧠 Cabi</button>
            <button class="_pf2chip ${S.lastEval === 'chutei' ? 'sel-chutei' : ''}" id="_pf2chutei">🎲 Chutei</button>
            <button class="_pf2chip ${S.lastEval === 'naosabia' ? 'sel-naosabia' : ''}" id="_pf2naosabia">😶 Não sabia</button>
          </div>
        </div>
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

    // Chips "Como foi?"
    ['cabi','chutei','naosabia'].forEach(val => {
      const el = document.getElementById('_pf2' + val);
      if (el) el.onclick = ev => { ev.stopPropagation(); S.lastEval = S.lastEval === val ? '' : val; renderWidget(); };
    });

    // Clique em círculo → abre questão
    widgetEl.querySelectorAll('._pf2c[data-url]').forEach(c => {
      if (c.getAttribute('data-url')) {
        c.addEventListener('click', ev => { ev.stopPropagation(); window.open(c.getAttribute('data-url'), '_self'); });
      }
    });

    // Banner de fila
    const filaRow = document.getElementById('_pf2filarow');
    if (filaRow && S.fila[0]) filaRow.onclick = () => window.open(S.fila[0].link || S.fila[0].url, '_self');

    // Reforço Inteligente
    const reforcoBtn = document.getElementById('_pf2reforcoBtn');
    if (reforcoBtn) reforcoBtn.onclick = ev => { ev.stopPropagation(); showRodadaReforco(); };

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
        // Dispara Rodada de Reforço se houver erros na sessão
        if (S.reforcoQueue.length > 0 && !document.getElementById('_pfRodadaOverlay')) {
          setTimeout(showRodadaReforco, 1800);
        }
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
    if (pos && pos.n !== S.currentQ) { S.currentQ = pos.n; S.lastEval = ''; ensureQuestions(pos.t); renderWidget(); }

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
            trackFadiga('correct');
            renderWidget();
            send('correct', null);
            toBg('QUESTION_CORRECT', { qid: qi.qid, url: qi.url, materia: qi.materia, assunto: qi.assunto, timeSpent: qi.timeSpent, pos: curPos, timestamp: Date.now() });
          } else {
            S.localErr++;
            S.stats.erros = Math.max(S.stats.erros, S.localErr);
            S.stats.resolved = S.localAce + S.localErr;
            setQuestionResult(curPos, 'wrong', qi);
            addToReforcoQueue({ qid: qi.qid, url: qi.url, materia: qi.materia, assunto: qi.assunto, banca: qi.banca, materiaUrl: qi.materiaUrl, assuntoUrl: qi.assuntoUrl });
            trackFadiga('wrong');
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
      for (let i = 0; i < da; i++) { send('correct', null); trackFadiga('correct'); }
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
      for (let i = 0; i < deCount; i++) trackFadiga('wrong');
      S.stats.erros = Math.max(S.stats.erros, S.localErr);
      S.stats.resolved = S.localAce + S.localErr;
      setQuestionResult(curPos, 'wrong', qi0);
      addToReforcoQueue({ qid: qi0.qid, url: qi0.url, materia: qi0.materia, assunto: qi0.assunto, banca: qi0.banca, materiaUrl: qi0.materiaUrl, assuntoUrl: qi0.assuntoUrl });
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
      nb.style.cssText = 'position:fixed;top:14px;left:50%;transform:translateX(-50%);background:#1e2432;color:#e2e8f0;padding:10px 18px;border-radius:10px;font-size:13px;z-index:2147483647;border:1px solid rgba(255,255,255,.12);font-family:sans-serif;';
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
      background:linear-gradient(135deg,#1e2432,#131c2e);
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

  // ── Fadiga Cognitiva ────────────────────────────────────────────────────────
  let _fadigaShown = false;

  function trackFadiga(result) {
    if (result === 'correct') {
      S.consecutiveWrong = 0;
    } else {
      S.consecutiveWrong++;
    }
    S.recentResults.push(result);
    if (S.recentResults.length > 10) S.recentResults.shift();

    // Alerta: 3+ erros consecutivos
    if (S.consecutiveWrong === 3 && !_fadigaShown) {
      _fadigaShown = true;
      showFadigaBanner('consecutive');
      setTimeout(() => { _fadigaShown = false; }, 300000); // reset após 5min
      return;
    }

    // Alerta: taxa caiu muito nas últimas 8 questões
    if (S.recentResults.length >= 8) {
      const recentWrong = S.recentResults.slice(-8).filter(r => r === 'wrong').length;
      const sessionTotal = S.localAce + S.localErr;
      const sessionTaxa = sessionTotal > 5 ? S.localAce / sessionTotal : 1;
      if (recentWrong >= 6 && sessionTaxa < 0.55 && !_fadigaShown) {
        _fadigaShown = true;
        showFadigaBanner('drop');
        setTimeout(() => { _fadigaShown = false; }, 600000);
      }
    }
  }

  function showFadigaBanner(type) {
    const prev = document.getElementById('_pfFadigaBanner');
    if (prev) prev.remove();

    const msgs = {
      consecutive: { icon: '🧠', title: '3 erros consecutivos', sub: 'Pode ser fadiga cognitiva. Uma pausa de 5 min restaura a concentração.', color: '#f59e0b', btnLabel: '⏸ Pausar 5 min' },
      drop:        { icon: '📉', title: 'Taxa de acerto caindo', sub: 'Você acertou menos de 25% nas últimas 8 questões. Hora de recuperar.', color: '#ef4444', btnLabel: '☕ Pausa curta' },
    };
    const m = msgs[type] || msgs.consecutive;

    const bn = document.createElement('div');
    bn.id = '_pfFadigaBanner';
    bn.style.cssText = `
      position:fixed;top:14px;left:50%;transform:translateX(-50%);
      background:linear-gradient(135deg,#1a1207,#1a0f0f);
      border:1px solid ${m.color}55;border-radius:14px;
      padding:12px 16px;box-shadow:0 8px 32px rgba(0,0,0,.5),0 0 0 1px ${m.color}22 inset;
      font-family:-apple-system,BlinkMacSystemFont,sans-serif;
      z-index:2147483647;min-width:280px;max-width:360px;
      animation:_pfSlide2 .3s cubic-bezier(.16,1,.3,1);
    `;
    bn.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
        <span style="font-size:18px;">${m.icon}</span>
        <div style="flex:1;">
          <div style="font-size:11px;font-weight:800;color:${m.color};letter-spacing:.4px;">${m.title.toUpperCase()}</div>
          <div style="font-size:10.5px;color:#94a3b8;margin-top:2px;">${m.sub}</div>
        </div>
        <button id="_pfFadigaX" style="background:none;border:none;color:#64748b;font-size:16px;cursor:pointer;padding:2px 5px;line-height:1;">✕</button>
      </div>
      <div style="display:flex;gap:7px;">
        <button id="_pfFadigaPause" style="flex:2;padding:7px;background:${m.color}22;border:1px solid ${m.color}55;border-radius:8px;color:${m.color};font-size:11px;font-weight:700;cursor:pointer;">${m.btnLabel}</button>
        <button id="_pfFadigaIgnore" style="flex:1;padding:7px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:8px;color:#64748b;font-size:11px;cursor:pointer;">Continuar</button>
      </div>`;
    document.body.appendChild(bn);

    const autoRemove = setTimeout(() => bn.remove(), 30000);
    document.getElementById('_pfFadigaX').onclick      = () => { clearTimeout(autoRemove); bn.remove(); };
    document.getElementById('_pfFadigaIgnore').onclick = () => { clearTimeout(autoRemove); bn.remove(); };
    document.getElementById('_pfFadigaPause').onclick  = () => {
      clearTimeout(autoRemove); bn.remove();
      S.consecutiveWrong = 0;
      timerControl('TIMER_PAUSE');
      timerRunning = false;
      renderWidget();
    };
  }

  // ════════════════════════════════════════════════════════
  // REFORÇO INTELIGENTE — Busca similares + Rodada de Reforço
  // ════════════════════════════════════════════════════════

  function _pfRqToast(msg, color) {
    const t = document.createElement('div');
    t.style.cssText = `position:fixed;bottom:76px;right:20px;z-index:2147483645;
      background:linear-gradient(135deg,#1e1b4b,#312e81);color:${color||'#a5b4fc'};
      padding:8px 14px;border-radius:10px;font:700 11px/1.5 -apple-system,sans-serif;
      border:1px solid rgba(37,99,235,.4);box-shadow:0 4px 20px rgba(0,0,0,.5);
      transition:opacity .4s;display:flex;align-items:center;gap:8px;max-width:260px;`;
    t.innerHTML = msg;
    document.body.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 500); }, 3500);
  }

  function addToReforcoQueue(qi) {
    if (!qi || !qi.qid) return;
    if (S.reforcoQueue.find(r => r.qi.qid === qi.qid)) return;

    // Captura enunciado e keywords no momento exato do erro (DOM ainda está com a questão)
    if (!qi.enunciado) qi.enunciado = _extractEnunciado();
    if (!qi.keywords)  qi.keywords  = _extractKeywords(qi.enunciado || '', qi.materia || '', qi.assunto || '');

    const entry = { qi: { ...qi }, similares: [], loading: true, fetched: false };
    S.reforcoQueue.push(entry);
    renderWidget();

    const assunto = (qi.assunto || qi.materia || '').slice(0, 30);
    _pfRqToast(`<span style="font-size:14px">📚</span> Buscando similares: <strong>${assunto}</strong>…`);

    _findSimilarQuestions(qi)
      .then(found => { entry.similares = found || []; entry.loading = false; entry.fetched = true; renderWidget(); })
      .catch(() => { entry.loading = false; entry.fetched = true; renderWidget(); });
  }

  async function _findSimilarQuestions(qi) {
    const found = [];
    const seen  = new Set([qi.qid]);
    const materiaKey = (qi.materia || '').toLowerCase();

    function _isRelevant(q) {
      const qMat = (q.materia || '').toLowerCase();
      if (materiaKey && qMat && !qMat.includes(materiaKey.slice(0, 8)) && !materiaKey.includes(qMat.slice(0, 8))) return false;
      return true;
    }

    function _normalize(items, srcLabel) {
      return items.map(q => {
        const id = String(q.id || q.questao_id || q.questaoId || '');
        if (!id || id === qi.qid || seen.has(id)) return null;
        return {
          qid:     id,
          url:     `https://www.tecconcursos.com.br/questoes/${id}`,
          label:   (q.enunciado || q.texto || q.descricao || `Questão #${id}`).slice(0, 120),
          materia: q.materia?.nome || q.materia || '',
          assunto: q.assunto?.nome || q.assunto || '',
          banca:   q.banca?.nome  || q.banca?.sigla || q.banca || '',
          source:  srcLabel,
        };
      }).filter(Boolean);
    }

    // ── Estratégia A: API direta com IDs reais (primária — rápido, preciso) ──
    // Passo 1: descobrir IDs de assunto/matéria/banca
    let assuntoId = '', materiaId = '', bancaId = '';

    // 1a: dados já capturados pelo content_main.js na sessão atual
    const captured = _tecApi.schema?.items;
    if (Array.isArray(captured)) {
      const match = captured.find(q => q.id === qi.qid) || captured[0];
      if (match) { assuntoId = match.assunto_id || ''; materiaId = match.materia_id || ''; bancaId = match.banca_id || ''; }
    }

    // 1b: busca direta do detalhe da questão no TEC — retorna em <1s
    if (!assuntoId && !materiaId && qi.qid) {
      const detail = await _fetchQuestaoDetail(qi.qid);
      if (detail) {
        assuntoId = String(detail.assunto?.id || detail.assunto_id || '');
        materiaId = String(detail.materia?.id || detail.materia_id || '');
        bancaId   = String(detail.banca?.id   || detail.banca_id   || '');
      }
    }

    // Passo 2: busca por ID (mais preciso que por nome)
    if (assuntoId || materiaId) {
      const byId = await _fetchSimilaresPorIds(qi, assuntoId, materiaId, bancaId);
      for (const q of _normalize(byId, 'api-ids')) {
        if (_isRelevant(q)) { seen.add(q.qid); found.push(q); }
      }
    }
    if (found.length >= 5) return found.slice(0, 6);

    // ── Estratégia B: API por nome (fallback quando IDs não disponíveis) ────
    const baseEps = _tecApi.base
      ? [_tecApi.base.replace(/\/\d+$/, ''), '/api/questoes', '/api/v1/questoes']
      : ['/api/questoes', '/api/v1/questoes', '/api/v2/questoes'];

    for (const ep of baseEps) {
      try {
        const p = new URLSearchParams({ per_page: '8', page: '1' });
        if (qi.assunto)  p.set('assunto',  qi.assunto);
        if (qi.materia)  p.set('materia',  qi.materia);
        if (qi.banca)    p.set('banca',    qi.banca);
        const res = await fetch(`${ep}?${p}`, { credentials: 'include', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5000) });
        if (!res.ok || !(res.headers.get('content-type') || '').includes('json')) continue;
        const data = await res.json();
        const items = Array.isArray(data) ? data : (data.data || data.questoes || data.items || data.results || []);
        for (const q of _normalize(items, 'api-name')) {
          if (_isRelevant(q)) { seen.add(q.qid); found.push(q); }
        }
        if (found.length >= 3) break;
      } catch(_) {}
    }
    if (found.length >= 5) return found.slice(0, 6);

    // ── Estratégia C: Script tag JSON (dados do Angular já na página) ────────
    try {
      const assuntoSlice = (qi.assunto || '').toLowerCase().slice(0, 8);
      const matSlice     = materiaKey.slice(0, 6);
      for (const sc of document.querySelectorAll('script:not([src])')) {
        const src = sc.textContent;
        if (src.length < 500 || src.length > 800000) continue;
        if (matSlice && !src.toLowerCase().includes(matSlice)) continue;
        const idMs = src.match(/"(?:id|questao_id)"\s*:\s*(\d{5,9})/g);
        if (!idMs) continue;
        for (const m of idMs) {
          const id = m.match(/\d+/)[0];
          if (seen.has(id)) continue;
          const ctxIdx = src.indexOf(m);
          const ctx    = src.slice(Math.max(0, ctxIdx - 300), ctxIdx + 400).toLowerCase();
          if (!ctx.includes(matSlice) && !ctx.includes(assuntoSlice)) continue;
          seen.add(id);
          const enM  = src.slice(Math.max(0, ctxIdx - 300), ctxIdx + 400).match(/"enunciado"\s*:\s*"([^"]{10,100})/);
          const assM = src.slice(Math.max(0, ctxIdx - 300), ctxIdx + 400).match(/"(?:assunto|assunto_nome)"\s*:\s*"([^"]{2,50})/);
          const banM = src.slice(Math.max(0, ctxIdx - 300), ctxIdx + 400).match(/"(?:banca|banca_nome)"\s*:\s*"([^"]{2,20})/);
          found.push({ qid: id, url: `https://www.tecconcursos.com.br/questoes/${id}`, label: enM ? enM[1] : `Questão #${id}`, assunto: assM ? assM[1] : (qi.assunto || ''), banca: banM ? banM[1] : (qi.banca || ''), materia: qi.materia, source: 'script' });
          if (found.length >= 5) break;
        }
        if (found.length >= 5) break;
      }
    } catch(_) {}

    return found.slice(0, 6);
  }

  // Busca detalhes de uma questão na API do TEC (retorna assunto_id, materia_id, etc.)
  async function _fetchQuestaoDetail(qid) {
    const base = _tecApi.base ? _tecApi.base.replace(/\/\d+$/, '').replace(/\/questoes.*/, '/questoes') : null;
    const eps = [...new Set([...(base ? [`${base}/${qid}`] : []), `/api/questoes/${qid}`, `/api/v1/questoes/${qid}`, `/api/v2/questoes/${qid}`])];
    for (const ep of eps) {
      try {
        const res = await fetch(ep, { credentials: 'include', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(4000) });
        if (!res.ok || !(res.headers.get('content-type') || '').includes('json')) continue;
        const data = await res.json();
        if (data?.id || data?.questao_id) return data;
      } catch(_) {}
    }
    return null;
  }

  // Busca questões similares usando IDs reais (assunto_id/materia_id/banca_id)
  async function _fetchSimilaresPorIds(qi, assuntoId, materiaId, bancaId) {
    const base = _tecApi.base ? _tecApi.base.replace(/\/\d+$/, '') : null;
    const eps  = [...new Set([...(base ? [base] : []), '/api/questoes', '/api/v1/questoes', '/api/v2/questoes'])];
    for (const ep of eps) {
      try {
        const p = new URLSearchParams({ per_page: '10', page: '1' });
        if (assuntoId) p.set('assunto_id', assuntoId);
        else if (materiaId) p.set('materia_id', materiaId);
        if (bancaId) p.set('banca_id', bancaId);
        const res = await fetch(`${ep}?${p}`, { credentials: 'include', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5000) });
        if (!res.ok || !(res.headers.get('content-type') || '').includes('json')) continue;
        const data = await res.json();
        const items = Array.isArray(data) ? data : (data.data || data.questoes || data.items || data.results || []);
        if (items.length >= 2) return items;
      } catch(_) {}
    }
    return [];
  }

  async function _tryTecApi(endpoint, qi) {
    const p = new URLSearchParams();
    if (qi.materia)  p.set('materia',  qi.materia);
    if (qi.assunto)  p.set('assunto',  qi.assunto);
    if (qi.banca)    p.set('banca',    qi.banca);
    if (qi.keywords) p.set('q',        qi.keywords);
    if (qi.keywords) p.set('enunciado', qi.keywords);
    p.set('per_page', '6'); p.set('page', '1');

    const res = await fetch(`${endpoint}?${p}`, {
      credentials: 'include',
      headers: { Accept: 'application/json', ..._tecApi.headers },
    });
    if (!res.ok) return [];
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('json')) return [];

    const data = await res.json();
    const items = Array.isArray(data) ? data : (data.data || data.questoes || data.items || data.results || []);
    if (!Array.isArray(items) || !items.length) return [];

    const materiaKey = (qi.materia || '').toLowerCase();
    return items.map(q => {
      const id = String(q.id || q.questao_id || q.questao?.id || '');
      const qMat = (q.materia?.nome || q.materia || '').toLowerCase();
      if (materiaKey && qMat && !qMat.includes(materiaKey.slice(0,8)) && !materiaKey.includes(qMat.slice(0,8))) return null;
      if (!id || id === qi.qid) return null;
      return {
        qid:     id,
        url:     q.url || q.link || `https://www.tecconcursos.com.br/questoes/${id}`,
        banca:   q.banca?.nome || q.banca || '',
        assunto: q.assunto?.nome || q.assunto || '',
        materia: q.materia?.nome || q.materia || '',
        label:   (q.enunciado || q.texto || q.descricao || `Questão #${id}`).slice(0, 100),
        source:  'api',
      };
    }).filter(Boolean).slice(0, 5);
  }

  function _tecFilterUrl(qi) {
    // Usa o link nativo do TEC quando disponível (extraído do DOM da questão)
    if (qi.assuntoUrl) return qi.assuntoUrl;
    if (qi.materiaUrl) return qi.materiaUrl;
    // Fallback: monta URL de filtro do TEC com os parâmetros que conhecemos
    const p = new URLSearchParams();
    if (qi.materia) p.set('materia', qi.materia);
    if (qi.assunto) p.set('assunto', qi.assunto);
    if (qi.banca)   p.set('banca',   qi.banca);
    return 'https://www.tecconcursos.com.br/questoes/filtrar?' + p.toString();
  }

  function openReforcoFilter(qi) {
    if (!qi) return;
    window.open(_tecFilterUrl(qi), '_blank');
  }

  function showRodadaReforco() {
    const prev = document.getElementById('_pfRodadaOverlay');
    if (prev) { prev.remove(); return; }
    if (!S.reforcoQueue.length) return;

    const nErros = S.reforcoQueue.length;
    const nSim   = S.reforcoQueue.reduce((a, r) => a + r.similares.length, 0);
    const loading = S.reforcoQueue.some(r => r.loading);

    const overlay = document.createElement('div');
    overlay.id = '_pfRodadaOverlay';
    overlay.style.cssText = `
      position:fixed;inset:0;background:rgba(0,0,0,.88);backdrop-filter:blur(8px);
      z-index:2147483646;display:flex;align-items:center;justify-content:center;padding:16px;
      font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;animation:_pfFadeIn .25s ease;`;

    const cards = S.reforcoQueue.map((entry, idx) => {
      const q = entry.qi;
      const hasSim = entry.similares.length > 0;
      const subjLabel = (q.assunto || q.materia || 'Questão #' + q.qid).slice(0, 40);

      const simRows = entry.similares.map((s, si) => `
        <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.05);">
          <div style="width:18px;height:18px;border-radius:50%;background:rgba(99,102,241,.18);border:1px solid rgba(37,99,235,.4);
            display:flex;align-items:center;justify-content:center;font-size:9px;color:#60a5fa;font-weight:800;flex-shrink:0;">${si+1}</div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:10.5px;color:#cbd5e1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${s.label}</div>
            ${s.banca || s.assunto ? `<div style="font-size:9px;color:#475569;">${[s.banca,s.assunto].filter(Boolean).join(' · ')}</div>` : ''}
          </div>
          <a href="${s.url}" target="_blank"
            style="background:rgba(37,99,235,.2);border:1px solid rgba(37,99,235,.4);color:#93c5fd;
            border-radius:6px;padding:3px 9px;font-size:10px;text-decoration:none;font-weight:700;white-space:nowrap;">Abrir ↗</a>
        </div>`).join('');

      return `
        <div style="padding:14px 16px;border-bottom:1px solid rgba(255,255,255,.07);">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
            <div style="width:24px;height:24px;border-radius:50%;background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.3);
              display:flex;align-items:center;justify-content:center;font-size:12px;flex-shrink:0;">❌</div>
            <div style="flex:1;min-width:0;">
              <div style="font-size:11px;font-weight:700;color:#f1f5f9;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${subjLabel}</div>
              <div style="font-size:9.5px;color:#475569;">${[q.banca, q.qid ? '#'+q.qid : ''].filter(Boolean).join(' · ')}</div>
              ${q.keywords ? `<div style="font-size:9px;color:#334155;margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">🔑 ${q.keywords}</div>` : ''}
            </div>
          </div>
          ${entry.loading
            ? `<div style="display:flex;align-items:center;gap:8px;padding:8px;background:rgba(99,102,241,.07);border-radius:8px;margin-bottom:8px;">
                <div style="width:12px;height:12px;border:2px solid rgba(99,102,241,.25);border-top-color:#3b82f6;border-radius:50%;animation:_pfSpin 1s linear infinite;flex-shrink:0;"></div>
                <span style="font-size:10px;color:#64748b;">Buscando questões similares no banco do TEC…</span>
              </div>`
            : hasSim
              ? `<div style="font-size:9.5px;color:#3b82f6;font-weight:700;letter-spacing:.5px;text-transform:uppercase;margin-bottom:6px;">
                  📚 ${entry.similares.length} similar${entry.similares.length>1?'es':''} de <strong style="color:#a5b4fc">${q.assunto||q.materia||''}</strong>
                </div>${simRows}`
              : `<div style="display:flex;align-items:center;gap:6px;padding:8px;background:rgba(245,158,11,.06);border:1px solid rgba(245,158,11,.2);border-radius:8px;margin-bottom:6px;">
                  <span style="font-size:13px;">🔍</span>
                  <span style="font-size:10px;color:#92400e;">API do TEC ainda não mapeada para este assunto. Use o filtro abaixo — a extensão preenche os campos automaticamente.</span>
                </div>`
          }
          <a href="${_tecFilterUrl(q)}" target="_blank"
            style="display:flex;align-items:center;justify-content:center;gap:6px;margin-top:8px;
            background:rgba(14,24,48,.85);border:1px solid rgba(37,99,235,.35);color:#818cf8;
            border-radius:8px;padding:7px;font-size:10.5px;font-weight:700;text-decoration:none;">
            📋 Gerar Caderno de Reforço no TEC
          </a>
        </div>`;
    }).join('');

    overlay.innerHTML = `
      <div style="background:#0b0d18;border:1px solid rgba(37,99,235,.4);border-radius:18px;
        width:100%;max-width:520px;max-height:90vh;overflow:hidden;display:flex;flex-direction:column;
        box-shadow:0 0 0 1px rgba(99,102,241,.1) inset,0 28px 80px rgba(0,0,0,.75);">
        <!-- Header fixo -->
        <div style="background:linear-gradient(135deg,rgba(30,27,75,.95),rgba(49,46,129,.8));
          padding:18px 20px 14px;border-bottom:1px solid rgba(37,99,235,.2);flex-shrink:0;">
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:${nSim>0?'12':'0'}px;">
            <span style="font-size:26px;line-height:1;">🎯</span>
            <div style="flex:1;">
              <div style="font-size:15px;font-weight:800;color:#e2e8f0;">Rodada de Reforço</div>
              <div style="font-size:11px;color:#3b82f6;margin-top:3px;">
                ${nErros} questão${nErros>1?'ões':''} errada${nErros>1?'s':''} ·
                ${loading ? '⏳ buscando similares…' : nSim + ' similar' + (nSim!==1?'es':'') + ' encontrada' + (nSim!==1?'s':'')}
              </div>
            </div>
            <button id="_pfRodadaX" style="background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);
              color:#64748b;border-radius:8px;padding:5px 10px;font-size:15px;cursor:pointer;">✕</button>
          </div>
          ${nSim > 0 ? `
          <button id="_pfRodadaAll" style="width:100%;background:linear-gradient(135deg,#4338ca,#7c3aed);
            border:none;color:#fff;border-radius:10px;padding:10px;font-size:12px;font-weight:800;
            cursor:pointer;letter-spacing:.3px;display:flex;align-items:center;justify-content:center;gap:8px;">
            🚀 Abrir Todas as Questões Similares (${nSim})
          </button>` : ''}
        </div>
        <!-- Cards com scroll -->
        <div style="overflow-y:auto;flex:1;">${cards}</div>
      </div>`;

    if (!document.getElementById('_pfRodadaCSS')) {
      const st = document.createElement('style');
      st.id = '_pfRodadaCSS';
      st.textContent = `
        @keyframes _pfSpin { to { transform: rotate(360deg); } }
        @keyframes _pfFadeIn { from { opacity: 0; transform: scale(.97); } to { opacity: 1; transform: none; } }`;
      document.head.appendChild(st);
    }

    document.body.appendChild(overlay);

    document.getElementById('_pfRodadaX').onclick = () => overlay.remove();
    overlay.addEventListener('click', ev => { if (ev.target === overlay) overlay.remove(); });

    const allBtn = document.getElementById('_pfRodadaAll');
    if (allBtn) allBtn.onclick = () => {
      S.reforcoQueue.forEach((entry, i) => {
        entry.similares.forEach((s, j) => {
          setTimeout(() => window.open(s.url, '_blank'), (i * 3 + j) * 120);
        });
      });
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
