/*
 * Wonder Wallet dApp provider — background wiring. Phase 12 (v0.48). ACTIVE — the dApp provider ships wired into every build and injects on all sites (universal, MetaMask/Phantom model, v0.48+). See STORE_LISTING.md + docs/DAPP_PROVIDER_PLAN.md (superseded).
 * At v0.48, background.js adds ONE line:  importScripts('provider/background-wire.js');
 * (which itself pulls in protocol/permissions/broker/background-provider). Until then nothing here
 * runs — background.js is untouched, so the shipped package keeps minimal permissions.
 */
(function () {
  'use strict';
  try { importScripts('provider/protocol.js', 'provider/permissions.js', 'provider/broker.js', 'provider/background-provider.js'); } catch (e) { /* already loaded */ }
  var BG = self.WWProviderBg;

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || !msg.type) return;
    switch (msg.type) {
      case 'ww_provider_request': {
        // TRUE origin comes from Chrome's sender info — never from anything the page sent.
        var origin = sender.origin || (sender.url ? new URL(sender.url).origin : null);
        BG.handleProviderRequest(origin, msg.method, msg.params, sender.tab && sender.tab.id).then(sendResponse);
        return true; // async
      }
      case 'ww_get_pending': BG.getPending(msg.id, sendResponse); return true;
      case 'ww_decision': BG.onDecision(msg.id, msg.approved, msg.extra, sendResponse); return true;
      case 'ww_sites_list': BG.listSites(sendResponse); return true;
      case 'ww_sites_revoke': BG.revokeSite(msg.origin, sendResponse); return true;
      default: return;
    }
  });
})();
