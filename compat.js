/**
 * Painel Fiscal — Web Compatibility Shim v1.0
 *
 * Quando o popup é aberto como página web (GitHub Pages, arquivo local),
 * este script substitui as chrome.* APIs por equivalentes web:
 *
 *   chrome.storage.local   → localStorage (chaves sem prefixo, igual à extensão)
 *   chrome.runtime.sendMessage → barramento in-page (invoca background.js inline)
 *   chrome.tabs.create/update  → window.open()
 *   chrome.alarms              → setTimeout / setInterval
 *   chrome.notifications       → Notification API do browser
 *   chrome.action / scripting  → no-op (só faz sentido na extensão)
 *
 * Quando roda como extensão Chrome, este script detecta chrome.runtime.id
 * e SAIR IMEDIATAMENTE sem alterar nada — a extensão continua 100% intacta.
 *
 * Ordem de carregamento no popup.html:
 *   1. compat.js     ← este arquivo (cria o mock se necessário)
 *   2. background.js ← registra os message-listeners in-page
 *   3. popup.js      ← usa chrome.* normalmente (real ou mock)
 */

(function () {
  'use strict';

  /* ── 1. Detectar contexto ──────────────────────────────────────────── */
  const IS_EXT = (
    typeof chrome !== 'undefined' &&
    typeof chrome.runtime !== 'undefined' &&
    !!chrome.runtime.id
  );

  if (IS_EXT) return; // Extensão real → não sobrescrever nada

  /* ── 2. Registros internos ─────────────────────────────────────────── */
  const _msgListeners   = [];   // chrome.runtime.onMessage
  const _alarmListeners = [];   // chrome.alarms.onAlarm
  const _alarmTimers    = {};   // name → { type, handle }

  /* ── 3. Storage (localStorage, chaves exatamente iguais às da extensão) */
  const _store = {
    /**
     * Suporta todas as formas da API:
     *   get(null, cb)              → todos os pares
     *   get('key', cb)             → {key: valor}
     *   get(['k1','k2'], cb)       → {k1:..., k2:...}
     *   get({k1: default1}, cb)    → {k1: valor_ou_default}
     */
    get(keys, cb) {
      const result = {};

      if (keys === null || keys === undefined) {
        // Retorna TUDO que está no localStorage
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k !== null) {
            try { result[k] = JSON.parse(localStorage.getItem(k)); }
            catch { result[k] = localStorage.getItem(k); }
          }
        }
      } else if (typeof keys === 'string') {
        const raw = localStorage.getItem(keys);
        result[keys] = raw !== null ? JSON.parse(raw) : undefined;
      } else if (Array.isArray(keys)) {
        keys.forEach(k => {
          const raw = localStorage.getItem(k);
          result[k] = raw !== null ? JSON.parse(raw) : undefined;
        });
      } else if (typeof keys === 'object') {
        // Objeto com defaults
        Object.entries(keys).forEach(([k, def]) => {
          const raw = localStorage.getItem(k);
          result[k] = raw !== null ? JSON.parse(raw) : def;
        });
      }

      if (cb) setTimeout(() => cb(result), 0);
      return Promise.resolve(result);
    },

    set(data, cb) {
      try {
        Object.entries(data).forEach(([k, v]) => {
          localStorage.setItem(k, JSON.stringify(v));
        });
      } catch (e) {
        // localStorage cheio — ignora silenciosamente
        console.warn('[PF Compat] localStorage.setItem falhou:', e);
      }
      if (cb) setTimeout(() => cb(), 0);
      return Promise.resolve();
    },

    clear(cb) {
      localStorage.clear();
      if (cb) setTimeout(() => cb(), 0);
      return Promise.resolve();
    },

    remove(keys, cb) {
      const list = Array.isArray(keys) ? keys : [keys];
      list.forEach(k => localStorage.removeItem(k));
      if (cb) setTimeout(() => cb(), 0);
      return Promise.resolve();
    },
  };

  /* ── 4. Message bus (roteia sendMessage → listeners do background.js) ─ */
  function _sendMessage(payload, cb) {
    // Assíncrono para mimetizar o comportamento real da extensão
    setTimeout(() => {
      let responded = false;

      const sendResponse = (r) => {
        if (responded) return;
        responded = true;
        if (cb) cb(r ?? null);
      };

      let asyncPending = false;
      for (const listener of [..._msgListeners]) {
        const ret = listener(payload, { id: 'web-compat', url: location.href }, sendResponse);
        if (ret === true) { asyncPending = true; break; } // handler é async
        if (responded) return;
      }

      // Se nenhum handler respondeu em ~200ms, resolve com null
      if (!asyncPending && !responded) {
        setTimeout(() => { if (!responded) { responded = true; if (cb) cb(null); } }, 200);
      }
    }, 0);
  }

  /* ── 5. Alarms → setTimeout / setInterval ─────────────────────────── */
  function _alarmCreate(name, opts) {
    // Suporta chrome.alarms.create({periodInMinutes:…}) sem name
    if (typeof name === 'object') { opts = name; name = '__default__'; }
    opts = opts || {};
    _alarmClear(name);

    const fireAlarm = () => {
      const alarm = { name, scheduledTime: Date.now() };
      _alarmListeners.forEach(fn => {
        try { fn(alarm); } catch (e) { console.error('[PF Compat] alarmListener erro:', e); }
      });
      // Se periódico, registra novo interval
      if (opts.periodInMinutes) {
        _alarmTimers[name] = {
          type: 'interval',
          handle: setInterval(fireAlarm, opts.periodInMinutes * 60_000),
        };
      } else {
        delete _alarmTimers[name];
      }
    };

    const delayMs = opts.delayInMinutes != null
      ? opts.delayInMinutes * 60_000
      : opts.when != null
        ? Math.max(0, opts.when - Date.now())
        : opts.periodInMinutes != null
          ? opts.periodInMinutes * 60_000
          : 0;

    _alarmTimers[name] = {
      type: 'timeout',
      handle: setTimeout(fireAlarm, delayMs),
    };
  }

  function _alarmClear(name, cb) {
    if (_alarmTimers[name]) {
      const { type, handle } = _alarmTimers[name];
      type === 'timeout' ? clearTimeout(handle) : clearInterval(handle);
      delete _alarmTimers[name];
    }
    if (cb) cb(true);
    return Promise.resolve(true);
  }

  function _alarmClearAll(cb) {
    Object.keys(_alarmTimers).forEach(n => _alarmClear(n));
    if (cb) cb();
    return Promise.resolve();
  }

  /* ── 6. Notificações (usa Notification API nativa do browser) ──────── */
  function _notify(id, opts, cb) {
    try {
      if (typeof Notification !== 'undefined') {
        if (Notification.permission === 'granted') {
          new Notification(opts?.title || 'Painel Fiscal', {
            body: opts?.message || '',
            icon: opts?.iconUrl || '',
          });
        } else if (Notification.permission !== 'denied') {
          Notification.requestPermission().then(perm => {
            if (perm === 'granted') _notify(id, opts, null);
          });
        }
      }
    } catch { /* permissão negada ou contexto não suporta */ }
    if (cb) cb(id || 'notif-0');
  }

  /* ── 7. Montar objeto chrome global ────────────────────────────────── */
  window.chrome = {

    runtime: {
      id: 'web-compat',
      get lastError() { return null; },
      sendMessage:  _sendMessage,
      onMessage: {
        addListener:    fn => _msgListeners.push(fn),
        removeListener: fn => {
          const i = _msgListeners.indexOf(fn);
          if (i >= 0) _msgListeners.splice(i, 1);
        },
        hasListener: fn => _msgListeners.includes(fn),
      },
      // Dispara onInstalled/onStartup depois que os scripts carregarem
      onInstalled: { addListener: fn => setTimeout(() => fn({ reason: 'install' }), 300) },
      onStartup:   { addListener: fn => setTimeout(() => fn(), 300) },
    },

    storage: {
      local: _store,
      // Garante que `chrome.storage.local.get` não seja chamado sem estar
      // no contexto certo — alguns polyfills testam session também
      session: _store,
    },

    tabs: {
      create(opts, cb) {
        if (opts?.url) window.open(opts.url, '_blank', 'noopener');
        if (cb) setTimeout(() => cb({ id: -1, url: opts?.url || '' }), 0);
      },
      update(tabId, opts, cb) {
        if (opts?.url) window.open(opts.url, '_blank', 'noopener');
        if (cb) setTimeout(() => cb({ id: tabId }), 0);
      },
      query(opts, cb) {
        if (cb) setTimeout(() => cb([]), 0);
        return Promise.resolve([]);
      },
      sendMessage(tabId, msg, opts, cb) {
        // Suporta versão com 3 ou 4 argumentos
        const callback = typeof opts === 'function' ? opts : cb;
        if (callback) setTimeout(() => callback(null), 0);
      },
      onRemoved: { addListener: () => {}, removeListener: () => {} },
      onUpdated: { addListener: () => {}, removeListener: () => {} },
    },

    alarms: {
      create:   _alarmCreate,
      clear:    _alarmClear,
      clearAll: _alarmClearAll,
      get(name, cb) { if (cb) cb(_alarmTimers[name] ? { name } : undefined); },
      getAll(cb) { if (cb) cb(Object.keys(_alarmTimers).map(n => ({ name: n }))); },
      onAlarm: {
        addListener:    fn => _alarmListeners.push(fn),
        removeListener: fn => {
          const i = _alarmListeners.indexOf(fn);
          if (i >= 0) _alarmListeners.splice(i, 1);
        },
      },
    },

    notifications: {
      create:    _notify,
      clear(id, cb) { if (cb) cb(true); },
      onClicked: { addListener: () => {} },
      onClosed:  { addListener: () => {} },
    },

    action: {
      setBadgeText:            () => {},
      setBadgeBackgroundColor: () => {},
      setTitle:                () => {},
      setIcon:                 () => {},
    },

    scripting: {
      executeScript: () => Promise.resolve([]),
      insertCSS:     () => Promise.resolve(),
    },

    windows: {
      getLastFocused(opts, cb) {
        const w = { id: -1, focused: true, type: 'normal' };
        if (cb) setTimeout(() => cb(w), 0);
        return Promise.resolve(w);
      },
      get(id, opts, cb) {
        const w = { id, focused: true, type: 'normal' };
        if (cb) setTimeout(() => cb(w), 0);
        return Promise.resolve(w);
      },
      update: () => {},
    },

  };

  console.info('[PF Compat] Modo web ativo — chrome.* APIs substituídas por equivalentes localStorage/window.');

})();
