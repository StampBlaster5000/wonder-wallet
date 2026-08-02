/*
 * Wonder Wallet dApp provider — background router. Phase 12 (v0.48). STAGED.
 * importScripts()'d into background.js at v0.48 (classic service worker). Owns: the permission store,
 * the request→decision flow, opening the approval window, relaying its result, and emitting events.
 *
 * KEY MV3 ARCHITECTURE: the background service worker holds NO keys (they live in the unlocked page
 * context). So SIGNING and account COMPUTE happen in the approval window (a full page with wallet-core
 * that can resume the session); the background only ROUTES and stores permissions. Reads are served
 * from the info the approval window cached into the grant at connect time (+ a balance proxy fetch),
 * so no key access is needed for reads. The true origin comes from Chrome's sender info, never the page.
 */
(function (root) {
  'use strict';
  var PERM = self.WWPermissions, B = self.WWBroker, P = self.WWProtocol;
  // The Wonder Wallet API is at the ARTIFACT path (matches shim.js WW_PROXY); the emblem.build root
  // /api/ is the auth-gated dashboard (Unauthorized). connect-src/host_permissions are origin-based, so
  // the extra path is fine.
  var PROXY = 'https://build-1dadb019a5802eb5fee63753.emblem.build/pub/bitcoin_wallet/wonder-wallet';
  var PENDING = {}; // id -> { origin, method, params, tabId, kind, resolve }
  var WINDOWS = {}; // approvalWindowId -> requestId

  function loadStore(cb) { chrome.storage.local.get(PERM.STORAGE_KEY, function (o) { cb((o && o[PERM.STORAGE_KEY]) || {}); }); }
  function saveStore(store, cb) { var o = {}; o[PERM.STORAGE_KEY] = store; chrome.storage.local.set(o, cb || function () {}); }
  function nowMs() { return Date.now(); }
  function genId() { return 'req-' + nowMs() + '-' + Math.floor(Math.random() * 1e6); }
  function faviconFor(origin) { try { return new URL(origin).origin + '/favicon.ico'; } catch (_) { return ''; } }

  // Content script → background. Returns a Promise resolving to { result } | { error:{code,message} }.
  function handleProviderRequest(origin, method, params, tabId) {
    return new Promise(function (resolve) {
      if (!PERM.normalizeOrigin(origin)) return resolve({ error: { code: P.ERR.UNAUTHORIZED, message: 'Insecure or invalid origin' } });
      loadStore(function (store) {
        var d = B.decide({ method: method, origin: origin, store: store });
        if (d.action === 'reject') return resolve({ error: { code: d.code, message: d.message } });
        if (d.action === 'revoke') { var rr = PERM.revoke(store, origin); saveStore(rr.store); if (rr.existed) emitEvent(origin, 'disconnect'); return resolve({ result: true }); }
        if (d.action === 'serve') return serveRead(origin, method, params, store, resolve);
        if (d.action === 'approve') return openApproval(origin, method, params, tabId, d.kind, resolve);
        resolve({ error: { code: P.ERR.INTERNAL, message: 'unhandled' } });
      });
    });
  }

  // Reads: served from the grant's cached public info (+ a balance / RPC proxy). No keys involved.
  function serveRead(origin, method, params, store, resolve) {
    var p = PERM.getPermission(store, origin) || {};
    PERM.touch(store, origin, nowMs()); saveStore(store);
    switch (method) {
      case 'ww_accounts': case 'ww_requestAccounts': return resolve({ result: p.accounts || [] });
      case 'ww_getAddresses': return resolve({ result: p.addresses || { active: (p.accounts || [])[0] || null } });
      case 'ww_getPublicKey': return resolve({ result: p.publicKey || null });
      case 'ww_getNetwork': return resolve({ result: 'mainnet' });
      case 'ww_chainId': return resolve({ result: '0x0' });
      case 'ww_getBalances': return fetchBalances((p.accounts || [])[0], resolve);
      // Ethereum (EIP-1193)
      case 'eth_accounts': return resolve({ result: p.eth ? [p.eth] : [] });
      case 'eth_chainId': return resolve({ result: '0x1' });     // mainnet
      case 'net_version': return resolve({ result: '1' });
      case 'wallet_getPermissions': return resolve({ result: p.eth ? [{ parentCapability: 'eth_accounts' }] : [] });
      case 'eth_requestAccounts': return resolve({ result: p.eth ? [p.eth] : [] });     // already permitted
      case 'wallet_switchEthereumChain': case 'wallet_addEthereumChain': return resolve({ result: null }); // mainnet-only no-op
      // Solana
      case 'sol_accounts': return resolve({ result: p.sol ? [p.sol] : [] });
      case 'sol_connect': return resolve({ result: p.sol ? { address: p.sol } : null });  // already permitted
      default:
        // Generic EVM/web3 JSON-RPC → proxy to a node so we're a full EIP-1193 provider on any dApp.
        if (/^eth_/.test(method) || /^net_/.test(method) || /^web3_/.test(method)) return ethRpc(method, params, resolve);
        return resolve({ error: { code: P.ERR.UNSUPPORTED, message: method } });
    }
  }
  // Proxy an allowlisted generic RPC method to our server's EVM node relay.
  function ethRpc(method, params, resolve) {
    fetch(PROXY + '/api/eth/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method: method, params: params || [], network: 'ethereum' }) })
      .then(function (r) { return r.json(); })
      .then(function (j) { if (j && j.error) resolve({ error: { code: P.ERR.INTERNAL, message: j.detail || j.error } }); else resolve({ result: j ? j.result : null }); })
      .catch(function () { resolve({ error: { code: P.ERR.INTERNAL, message: 'rpc proxy failed' } }); });
  }
  function fetchBalances(addr, resolve) {
    if (!addr) return resolve({ result: { confirmed: 0, unconfirmed: 0, total: 0 } });
    fetch(PROXY + '/api/btc/' + encodeURIComponent(addr)).then(function (r) { return r.json(); })
      .then(function (j) { var s = j.balanceSats || 0; resolve({ result: { confirmed: s, unconfirmed: 0, total: s } }); })
      .catch(function () { resolve({ error: { code: P.ERR.INTERNAL, message: 'balance fetch failed' } }); });
  }

  function openApproval(origin, method, params, tabId, kind, resolve) {
    var id = genId();
    PENDING[id] = { origin: origin, method: method, params: params, tabId: tabId, kind: kind, resolve: resolve };
    var url = chrome.runtime.getURL('provider/approval.html?id=' + id);
    var W = 400, H = 660;
    function make(win) {
      var o = { url: url, type: 'popup', width: W, height: H, focused: true };
      // Anchor to the TOP-RIGHT of the dApp's window (under the toolbar / extension button) — exactly
      // like UniSat's notification popup, so it reads as part of the extension, not a floating window.
      if (win && win.width) { o.top = Math.max(0, (win.top || 0) + 74); o.left = Math.max(0, (win.left || 0) + win.width - W - 20); }
      chrome.windows.create(o, function (w) { if (w) WINDOWS[w.id] = id; });
    }
    try {
      if (tabId != null && chrome.tabs && chrome.tabs.get) {
        chrome.tabs.get(tabId, function (t) {
          if (t && t.windowId != null && chrome.windows && chrome.windows.get) chrome.windows.get(t.windowId, function (win) { make(win); });
          else make(null);
        });
      } else make(null);
    } catch (_) { make(null); }
  }

  // Approval window asks for its request payload (background enriches with cached account info).
  function getPending(id, sendResponse) {
    var pnd = PENDING[id]; if (!pnd) return sendResponse(null);
    loadStore(function (store) {
      var p = PERM.getPermission(store, pnd.origin) || {};
      sendResponse({
        id: id, origin: pnd.origin, favicon: faviconFor(pnd.origin), method: pnd.method, params: pnd.params, kind: pnd.kind,
        tabId: pnd.tabId != null ? pnd.tabId : null, // the dApp tab — so the approval window can open the side panel in its window
        accountRef: p.accountRef || null, accountAddress: (p.accounts || [])[0] || null,
        eth: p.eth || null, sol: p.sol || null,
        myAddresses: p.myAddresses || p.accounts || [], paired: !!p.pairedAddresses, assetTags: {}, locked: false,
      });
    });
  }

  // Approval window posts the user's decision. For CONNECT it also sends the computed account info;
  // for SIGN it sends the already-signed result (signing happened in the window, which holds the keys).
  function onDecision(id, approved, extra, sendResponse) {
    var pnd = PENDING[id]; if (!pnd) { if (sendResponse) sendResponse({ ok: false }); return; }
    delete PENDING[id];
    if (!approved) { pnd.resolve({ error: { code: P.ERR.USER_REJECTED, message: 'User rejected the request' } }); if (sendResponse) sendResponse({ ok: true }); return; }
    if (pnd.kind === 'connect') {
      loadStore(function (store) {
        var accts = (extra && extra.accounts) || [];
        store = PERM.grant(store, pnd.origin, { accounts: accts, accountRef: extra && extra.accountRef, chains: ['btc'], pairedAddresses: extra && extra.pairedAddresses }, nowMs());
        var key = PERM.normalizeOrigin(pnd.origin);
        if (store[key]) { store[key].publicKey = (extra && extra.publicKey) || null; store[key].addresses = (extra && extra.addresses) || null; store[key].myAddresses = (extra && extra.myAddresses) || accts; store[key].eth = (extra && extra.eth) || null; store[key].sol = (extra && extra.sol) || null; }
        saveStore(store);
        var chain = P.chainOf(pnd.method);
        var eth = (extra && extra.eth) || null, sol = (extra && extra.sol) || null;
        emitEvent(pnd.origin, 'accountsChanged', chain === 'eth' ? (eth ? [eth] : []) : accts);
        var out;
        if (pnd.method === 'wallet_requestPermissions') out = eth ? [{ parentCapability: 'eth_accounts', caveats: [{ type: 'restrictReturnedAccounts', value: [eth] }] }] : [];
        else out = chain === 'eth' ? (eth ? [eth] : []) : chain === 'sol' ? (sol ? { address: sol } : null) : { accounts: accts, proof: extra && extra.proof };
        pnd.resolve({ result: out });
        if (sendResponse) sendResponse({ ok: true });
      });
    } else if (extra && extra.broadcast) { // ww_broadcastTransaction: window approved → SW pushes via proxy
      fetch(PROXY + '/api/btc/broadcast', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ txhex: extra.rawhex }) })
        .then(function (r) { return r.json(); })
        .then(function (j) { pnd.resolve(j && j.error ? { error: { code: P.ERR.INTERNAL, message: j.detail || j.error } } : { result: { txid: j.txid } }); })
        .catch(function () { pnd.resolve({ error: { code: P.ERR.INTERNAL, message: 'broadcast failed' } }); });
      if (sendResponse) sendResponse({ ok: true });
    } else { // sign: the approval window already signed; relay its result
      pnd.resolve(extra && extra.error ? { error: extra.error } : { result: extra && extra.result });
      if (sendResponse) sendResponse({ ok: true });
    }
  }

  function emitEvent(origin, event, payload) {
    var target = PERM.normalizeOrigin(origin);
    chrome.tabs.query({}, function (tabs) {
      (tabs || []).forEach(function (t) { try { if (t.url && new URL(t.url).origin === target) chrome.tabs.sendMessage(t.id, { type: 'ww_provider_event', event: event, payload: payload }); } catch (_) {} });
    });
  }

  // An approval window closed without a decision → reject the pending request.
  if (chrome.windows && chrome.windows.onRemoved) chrome.windows.onRemoved.addListener(function (winId) {
    var id = WINDOWS[winId]; if (!id) return; delete WINDOWS[winId];
    var pnd = PENDING[id]; if (pnd) { delete PENDING[id]; pnd.resolve({ error: { code: P.ERR.USER_REJECTED, message: 'Request window closed' } }); }
  });

  // For the "Connected sites" manager in the popup.
  function listSites(sendResponse) { loadStore(function (store) { sendResponse(PERM.list(store)); }); }
  function revokeSite(origin, sendResponse) { loadStore(function (store) { var r = PERM.revoke(store, origin); saveStore(r.store); if (r.existed) emitEvent(origin, 'disconnect'); sendResponse({ ok: true }); }); }

  root.WWProviderBg = { handleProviderRequest: handleProviderRequest, getPending: getPending, onDecision: onDecision, listSites: listSites, revokeSite: revokeSite };
})(self);
