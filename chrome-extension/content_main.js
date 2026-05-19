/**
 * Painel Fiscal — MAIN world script
 * Roda no contexto da página (não isolated), intercepta fetch/XHR REAL do TEC (Angular).
 * Comunica com content.js (isolated world) via CustomEvent no mesmo DOM.
 */
(function () {
  'use strict';

  function _emit(detail) {
    window.dispatchEvent(new CustomEvent('_pf_tec_api', { detail }));
  }

  // URL patterns que indicam chamadas de questões do TEC
  // Cobre: /api/questoes, /api/v1/questoes, /api/v2/questoes,
  //        /questoes (listagem Angular), /materias/.../questoes, etc.
  function _isQuestaoUrl(url) {
    if (!url || !url.includes('tecconcursos.com.br')) return false;
    return /\/(questoes?|questao)(\/|\?|$)/i.test(url) ||
           /\/(api|v\d+)\/(questoes?|search|buscar|filtrar)/i.test(url) ||
           /\/materias?\/[^/]+\/questoes/i.test(url) ||
           /\/assuntos?\/[^/]+\/questoes/i.test(url);
  }

  function _parseItems(data) {
    const raw = Array.isArray(data) ? data
      : (data.data || data.questoes || data.items || data.results || data.content || []);
    if (!Array.isArray(raw) || !raw.length) return [];
    return raw.slice(0, 10).map(q => ({
      id:       String(q.id || q.questao_id || q.questaoId || ''),
      materia:  q.materia?.nome  || q.materia  || q.disciplina?.nome || q.disciplina || '',
      assunto:  q.assunto?.nome  || q.assunto  || '',
      banca:    q.banca?.nome    || q.banca?.sigla || q.banca || '',
      enunciado:(q.enunciado     || q.texto    || q.descricao || '').slice(0, 150),
    })).filter(q => q.id);
  }

  // ── Intercepta window.fetch ──────────────────────────────────────────────
  const _origFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input?.url || '');
    const prom = _origFetch.apply(this, arguments);

    if (_isQuestaoUrl(url)) {
      _emit({ type: 'URL', base: url.split('?')[0], full: url });

      prom.then(async res => {
        try {
          const clone = res.clone();
          const ct = clone.headers.get('content-type') || '';
          if (!ct.includes('json')) return;
          const data = await clone.json();
          const items = _parseItems(data);
          if (items.length > 0) {
            _emit({ type: 'DATA', base: url.split('?')[0], full: url, items });
          }
        } catch (_) {}
      }).catch(() => {});
    }

    return prom;
  };

  // ── Intercepta XMLHttpRequest ────────────────────────────────────────────
  const _oxOpen = XMLHttpRequest.prototype.open;
  const _oxSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    this._pfUrl = url;
    return _oxOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function () {
    const url = this._pfUrl || '';
    if (_isQuestaoUrl(url)) {
      _emit({ type: 'URL', base: url.split('?')[0], full: url });
      this.addEventListener('load', () => {
        try {
          const data = JSON.parse(this.responseText);
          const items = _parseItems(data);
          if (items.length > 0) {
            _emit({ type: 'DATA', base: url.split('?')[0], full: url, items });
          }
        } catch (_) {}
      });
    }
    return _oxSend.apply(this, arguments);
  };
})();
