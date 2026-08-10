/*
 * Wonder Wallet dApp provider — Ethereum (EIP-1193 + EIP-6963). Phase 12 (v0.48). ACTIVE — the dApp provider ships wired into every build and injects on all sites (universal, MetaMask/Phantom model, v0.48+). See STORE_LISTING.md + docs/DAPP_PROVIDER_PLAN.md (superseded).
 * Injected into the page MAIN world alongside inpage.js. Exposes an EIP-1193 provider and ANNOUNCES
 * it via EIP-6963 so EVM dApps list "Wonder Wallet" automatically — no site changes, no clobbering
 * an existing window.ethereum (multi-wallet discovery). Marshals to the shared page↔background bridge.
 */
(function () {
  'use strict';
  var CHANNEL_REQ = 'ww:provider:req', CHANNEL_RES = 'ww:provider:res', CHANNEL_EVT = 'ww:provider:evt';
  var pending = {}, listeners = {}, seq = 0;
  function nextId() { seq += 1; return 'eth-' + seq + '-' + (performance.now() | 0); }

  function request(args) {
    return new Promise(function (resolve, reject) {
      if (!args || typeof args.method !== 'string') return reject({ code: -32602, message: 'Invalid request' });
      var id = nextId(); pending[id] = { resolve: resolve, reject: reject };
      window.postMessage({ channel: CHANNEL_REQ, id: id, method: args.method, params: args.params || [] }, window.location.origin);
    });
  }
  function emit(ev, p) { (listeners[ev] || []).slice().forEach(function (h) { try { h(p); } catch (_) {} }); }

  var provider = {
    isWonderWallet: true, isMetaMask: false,
    chainId: '0x1', networkVersion: '1', selectedAddress: null,
    request: request,
    on: function (ev, h) { (listeners[ev] = listeners[ev] || []).push(h); return provider; },
    removeListener: function (ev, h) { listeners[ev] = (listeners[ev] || []).filter(function (x) { return x !== h; }); return provider; },
    // legacy compatibility shims some dapps still call
    enable: function () { return request({ method: 'eth_requestAccounts' }); },
  };

  window.addEventListener('message', function (e) {
    if (e.source !== window || !e.data || e.origin !== window.location.origin) return;
    var d = e.data;
    if (d.channel === CHANNEL_RES && d.id && pending[d.id]) { var p = pending[d.id]; delete pending[d.id]; if (d.error) p.reject(d.error); else { if (d.result && d.result.chainId) provider.chainId = d.result.chainId; p.resolve(d.result); } }
    else if (d.channel === CHANNEL_EVT && d.event) { if (d.event === 'accountsChanged') provider.selectedAddress = (d.payload && d.payload[0]) || null; if (d.event === 'chainChanged' && d.payload) provider.chainId = d.payload; emit(d.event, d.payload); }
  });

  // Only claim window.ethereum if nothing else has (defer to EIP-6963 for coexistence).
  try { if (!window.ethereum) window.ethereum = provider; } catch (_) {}

  // ── EIP-6963 multi-wallet discovery ──
  var ICON = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMjggMTI4Ij48cmVjdCB3aWR0aD0iMTI4IiBoZWlnaHQ9IjEyOCIgcng9IjMwIiBmaWxsPSIjMGEwYTBmIi8+PGNpcmNsZSBjeD0iNjQiIGN5PSI2NCIgcj0iNDUiIGZpbGw9IiNFMEI0NTMiLz48L3N2Zz4=';
  var info = { uuid: '7b2f9c1e-1d4a-4c2b-9f3e-a1b2c3d4e5f6', name: 'Wonder Wallet', icon: ICON, rdns: 'com.wonderwallet' }; // valid RFC-4122 hex (audit #9)
  function announce() { try { window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info: info, provider: provider }) })); } catch (_) {} }
  window.addEventListener('eip6963:requestProvider', announce);
  announce();
})();
