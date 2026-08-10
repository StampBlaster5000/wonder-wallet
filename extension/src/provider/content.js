/*
 * Wonder Wallet dApp provider — content script (ISOLATED world, document_start).
 * Phase 12 (v0.48). ACTIVE — the dApp provider ships wired into every build and injects on all sites (universal, MetaMask/Phantom model, v0.48+). See STORE_LISTING.md + docs/DAPP_PROVIDER_PLAN.md (superseded).
 *
 * Two jobs:
 *  1. Inject inpage.js into the page's MAIN world so window.wonderWallet exists.
 *  2. Relay messages both ways: page (postMessage) <-> background (chrome.runtime).
 *
 * The background reads the TRUE origin from Chrome's sender info (not from anything the page sends),
 * so this bridge is a dumb pipe — it forwards, it does not decide.
 */
(function () {
  'use strict';
  var CHANNEL_REQ = 'ww:provider:req', CHANNEL_RES = 'ww:provider:res', CHANNEL_EVT = 'ww:provider:evt';

  // 1. Inject the providers into MAIN world: BTC (window.wonderWallet) + ETH (EIP-1193/6963) + SOL (Wallet Standard).
  ['provider/inpage.js', 'provider/eth-provider.js', 'provider/sol-provider.js'].forEach(function (file) {
    try {
      var s = document.createElement('script');
      s.src = chrome.runtime.getURL(file);
      s.async = false;
      (document.head || document.documentElement).appendChild(s);
      s.onload = function () { s.remove(); };
    } catch (_) {}
  });

  // 2a. Page -> background. Forward request envelopes; post the reply back on the same origin.
  window.addEventListener('message', function (e) {
    if (e.source !== window || e.origin !== window.location.origin || !e.data || e.data.channel !== CHANNEL_REQ) return; // origin check (audit #7c)
    var msg = e.data;
    var reply = function (payload) {
      window.postMessage({ channel: CHANNEL_RES, id: msg.id, result: payload && payload.result, error: payload && payload.error }, window.location.origin);
    };
    try {
      chrome.runtime.sendMessage({ type: 'ww_provider_request', method: msg.method, params: msg.params }, function (resp) {
        if (chrome.runtime.lastError) { reply({ error: { code: 4900, message: 'Wallet background unavailable — retry.' } }); return; }
        reply(resp || { error: { code: -32603, message: 'No response' } });
      });
    } catch (_) {
      reply({ error: { code: 4900, message: 'Wallet background unavailable — retry.' } });
    }
  });

  // 2b. Background -> page. Forward wallet events (accountsChanged / networkChanged / disconnect).
  chrome.runtime.onMessage.addListener(function (m) {
    if (m && m.type === 'ww_provider_event' && m.event) {
      window.postMessage({ channel: CHANNEL_EVT, event: m.event, payload: m.payload }, window.location.origin);
    }
  });
})();
