/*
 * Wonder Wallet dApp provider — inpage script (runs in the PAGE's MAIN world).
 * Phase 12 (v0.48). STAGED: not injected until the manifest is wired at v0.48 (post-approval).
 *
 * Defines window.wonderWallet — an EIP-1193-style provider (request/on/removeListener) with
 * `ww_`-prefixed methods, mirroring XCP Wallet so sites integrate both with near-identical code.
 *
 * SECURITY BOUNDARY NOTE: this script runs in the page's own world, so it is NOT a trust boundary.
 * All real authority lives in the background service worker (which authenticates the true origin from
 * Chrome's sender info) and the in-extension approval popups (which the page cannot forge). This file
 * only marshals request/response envelopes; it never holds keys and never decides permissions.
 */
(function () {
  'use strict';
  if (window.wonderWallet) return; // already injected

  var CHANNEL_REQ = 'ww:provider:req', CHANNEL_RES = 'ww:provider:res', CHANNEL_EVT = 'ww:provider:evt';
  var INIT_EVENT = 'wonder-wallet#initialized', DISCOVER_EVENT = 'wonder-wallet#discover';

  var pending = {};                 // id -> { resolve, reject }
  var listeners = {};               // event -> [handler]
  var seq = 0;
  function nextId() { seq += 1; return 'ww-' + seq + '-' + String(Math.floor((performance.now() % 1) * 1e9) + seq); }

  function emit(event, payload) {
    (listeners[event] || []).slice().forEach(function (h) { try { h(payload); } catch (_) {} });
  }

  // The single entry point. Returns a Promise that settles when the background replies.
  function request(args) {
    return new Promise(function (resolve, reject) {
      if (!args || typeof args.method !== 'string') {
        reject({ code: -32602, message: 'Invalid request: { method, params } required' });
        return;
      }
      var id = nextId();
      pending[id] = { resolve: resolve, reject: reject };
      window.postMessage({ channel: CHANNEL_REQ, id: id, method: args.method, params: args.params || [] }, window.location.origin);
    });
  }

  function on(event, handler) { (listeners[event] = listeners[event] || []).push(handler); return provider; }
  function removeListener(event, handler) {
    listeners[event] = (listeners[event] || []).filter(function (h) { return h !== handler; });
    return provider;
  }

  var provider = {
    isWonderWallet: true,
    request: request,
    on: on,
    removeListener: removeListener,
    // thin sugar over request() for the most common calls (parity with unisat-style naming)
    requestAccounts: function () { return request({ method: 'ww_requestAccounts' }); },
    getAccounts: function () { return request({ method: 'ww_accounts' }); },
    getPublicKey: function () { return request({ method: 'ww_getPublicKey' }); },
    getAddresses: function () { return request({ method: 'ww_getAddresses' }); },
    getBalances: function () { return request({ method: 'ww_getBalances' }); },
    signMessage: function (msg, addr) { return request({ method: 'ww_signMessage', params: [msg, addr] }); },
    signPsbt: function (psbtHex, opts) { return request({ method: 'ww_signPsbt', params: [psbtHex, opts] }); },
    signTransaction: function (hex) { return request({ method: 'ww_signTransaction', params: [hex] }); },
    broadcastTransaction: function (hex) { return request({ method: 'ww_broadcastTransaction', params: [hex] }); },
    disconnect: function () { return request({ method: 'ww_disconnect' }); },
  };

  // Responses + events come back from the content script via window.postMessage on our own origin.
  window.addEventListener('message', function (e) {
    if (e.source !== window || !e.data || e.origin !== window.location.origin) return;
    var d = e.data;
    if (d.channel === CHANNEL_RES && d.id && pending[d.id]) {
      var p = pending[d.id]; delete pending[d.id];
      if (d.error) p.reject(d.error); else p.resolve(d.result);
    } else if (d.channel === CHANNEL_EVT && d.event) {
      emit(d.event, d.payload);
    }
  });

  Object.defineProperty(window, 'wonderWallet', { value: provider, writable: false, configurable: false });
  try { window.dispatchEvent(new Event(INIT_EVENT)); } catch (_) {}
  // SPA re-announce: a page can dispatch DISCOVER to have us re-fire the init event.
  window.addEventListener(DISCOVER_EVENT, function () { try { window.dispatchEvent(new Event(INIT_EVENT)); } catch (_) {} });
})();
