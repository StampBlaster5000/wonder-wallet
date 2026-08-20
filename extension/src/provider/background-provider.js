/*
 * Wonder Wallet dApp provider — background router. Phase 12 (v0.48). ACTIVE — the dApp provider ships wired into every build and injects on all sites (universal, MetaMask/Phantom model, v0.48+). See STORE_LISTING.md + docs/DAPP_PROVIDER_PLAN.md (superseded).
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
  // Project-controlled backend (audit #3) — wonder-wallet.com's Cloudflare Worker proxies /api → the
  // stateless server.js. Overridable via Advanced → Reader endpoint (ww:reader). The service worker has
  // no localStorage, so read/track it from chrome.storage.local (the settings UI writes both stores).
  var DEFAULT_READER = 'https://wonder-wallet.com';
  var PROXY = DEFAULT_READER;
  try {
    chrome.storage.local.get('ww:reader', function (o) { var c = o && o['ww:reader']; if (c && /^https:\/\//.test(c)) PROXY = c.replace(/\/+$/, ''); });
    chrome.storage.onChanged.addListener(function (ch, area) { if (area === 'local' && ch['ww:reader']) { var c = ch['ww:reader'].newValue; PROXY = (c && /^https:\/\//.test(c)) ? c.replace(/\/+$/, '') : DEFAULT_READER; } });
  } catch (_) {}
  var PENDING = {}; // id -> { origin, method, params, tabId, kind, resolve, snapshot, winId, expireT }
  var WINDOWS = {}; // approvalWindowId -> requestId
  var MAX_PENDING = 6;               // WW-B23: global ceiling on concurrent approval windows
  var PENDING_TTL_MS = 5 * 60 * 1000; // WW-B23: auto-reject a request left unanswered this long

  function loadStore(cb) { chrome.storage.local.get(PERM.STORAGE_KEY, function (o) { cb((o && o[PERM.STORAGE_KEY]) || {}); }); }
  function saveStore(store, cb) { var o = {}; o[PERM.STORAGE_KEY] = store; chrome.storage.local.set(o, cb || function () {}); }
  function nowMs() { return Date.now(); }
  function genId() { return 'req-' + ((typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : (nowMs() + '-' + Math.floor(Math.random() * 1e6))); } // crypto UUID (audit #7c)
  function faviconFor(origin) { try { return new URL(origin).origin + '/favicon.ico'; } catch (_) { return ''; } }
  function pendingCount() { return Object.keys(PENDING).length; }

  // WW-B15: serialize every read-modify-write of the permission store. chrome.storage get→set is async,
  // so two concurrent flows (e.g. a grant landing while a revoke runs) can each load the OLD store and
  // the later save clobbers the earlier — resurrecting a revoked grant. Chaining all mutations through
  // one promise makes them atomic: each fn sees the result of the previous. `fn(store)` returns the new
  // store (or undefined to keep it); the optional result is passed to cb.
  var _writeChain = Promise.resolve();
  function mutateStore(fn, cb) {
    _writeChain = _writeChain.then(function () {
      return new Promise(function (done) {
        loadStore(function (store) {
          var next; try { next = fn(store); } catch (_) { next = undefined; }
          var toSave = next && next.store ? next.store : (next || store);
          saveStore(toSave, function () { try { if (cb) cb(next); } catch (_) {} done(); });
        });
      });
    });
    return _writeChain;
  }

  // WW-B13: cancel every pending request for an origin (called the instant a grant is revoked) so a
  // request that was in-flight when the user hit "revoke" can never still resolve into a signature.
  function cancelPending(origin, reason) {
    var target = PERM.normalizeOrigin(origin);
    Object.keys(PENDING).forEach(function (id) {
      var pnd = PENDING[id]; if (!pnd || PERM.normalizeOrigin(pnd.origin) !== target) return;
      closePending(id, { code: P.ERR.UNAUTHORIZED, message: reason || 'Connection was revoked before this request completed' });
    });
  }
  // Tear down one pending request: clear its expiry, close its window, resolve the caller with an error.
  function closePending(id, err) {
    var pnd = PENDING[id]; if (!pnd) return; delete PENDING[id];
    if (pnd.expireT) { try { clearTimeout(pnd.expireT); } catch (_) {} }
    if (pnd.winId != null) { delete WINDOWS[pnd.winId]; try { chrome.windows.remove(pnd.winId); } catch (_) {} }
    try { pnd.resolve({ error: err || { code: P.ERR.USER_REJECTED, message: 'Request closed' } }); } catch (_) {}
  }

  // Content script → background. Returns a Promise resolving to { result } | { error:{code,message} }.
  function handleProviderRequest(origin, method, params, tabId) {
    return new Promise(function (resolve) {
      if (!PERM.normalizeOrigin(origin)) return resolve({ error: { code: P.ERR.UNAUTHORIZED, message: 'Insecure or invalid origin' } });
      loadStore(function (store) {
        var d = B.decide({ method: method, origin: origin, store: store });
        if (d.action === 'reject') return resolve({ error: { code: d.code, message: d.message } });
        if (d.action === 'revoke') {
          cancelPending(origin, 'Disconnected'); // WW-B13: kill in-flight sign requests first
          return mutateStore(function (s) { return PERM.revoke(s, origin); }, function (rr) { if (rr && rr.existed) emitEvent(origin, 'disconnect'); resolve({ result: true }); });
        }
        if (d.action === 'serve') return serveRead(origin, method, params, store, resolve);
        if (d.action === 'approve') return openApproval(origin, method, params, tabId, d.kind, resolve, store);
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
        // Defense-in-depth (WW-C12): only allowlisted reads are ever proxied — never a raw broadcast.
        if (P.isPublicRead(method)) return ethRpc(method, params, resolve);
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

  function openApproval(origin, method, params, tabId, kind, resolve, store) {
    // WW-B23: bound the fan-out. If this origin already has a pending approval window, focus it and
    // reject the new duplicate instead of stacking popups; and never exceed a global ceiling.
    var target = PERM.normalizeOrigin(origin);
    var existingId = Object.keys(PENDING).find(function (pid) { return PERM.normalizeOrigin(PENDING[pid].origin) === target; });
    if (existingId) {
      var ex = PENDING[existingId];
      if (ex && ex.winId != null) { try { chrome.windows.update(ex.winId, { focused: true }); } catch (_) {} }
      return resolve({ error: { code: P.ERR.USER_REJECTED, message: 'Finish the pending Wonder Wallet request for this site first.' } });
    }
    if (pendingCount() >= MAX_PENDING) return resolve({ error: { code: P.ERR.USER_REJECTED, message: 'Too many pending wallet requests — resolve the open ones first.' } });

    var id = genId();
    // WW-B13: for a SIGN request, FREEZE the granted account now. The window will sign with this exact
    // account (getPending returns the snapshot, not the live store), and onDecision re-checks the live
    // grant against it before relaying — so a mid-flight revoke/account-switch cannot redirect the sig.
    var perm = (store && PERM.getPermission(store, origin)) || null;
    var snapshot = (kind === 'sign' && perm) ? { accountRef: perm.accountRef || null, account: (perm.accounts || [])[0] || null } : null;
    PENDING[id] = { origin: origin, method: method, params: params, tabId: tabId, kind: kind, resolve: resolve, snapshot: snapshot, winId: null, expireT: null };
    // Auto-reject if left unanswered (WW-B23) — frees the origin slot and closes the orphaned window.
    PENDING[id].expireT = setTimeout(function () { closePending(id, { code: P.ERR.USER_REJECTED, message: 'Request timed out' }); }, PENDING_TTL_MS);
    var url = chrome.runtime.getURL('provider/approval.html?id=' + id);
    var W = 400, H = 660;
    function make(win) {
      var o = { url: url, type: 'popup', width: W, height: H, focused: true };
      // Anchor to the TOP-RIGHT of the dApp's window (under the toolbar / extension button) — exactly
      // like UniSat's notification popup, so it reads as part of the extension, not a floating window.
      if (win && win.width) { o.top = Math.max(0, (win.top || 0) + 74); o.left = Math.max(0, (win.left || 0) + win.width - W - 20); }
      chrome.windows.create(o, function (w) { if (w && PENDING[id]) { WINDOWS[w.id] = id; PENDING[id].winId = w.id; } });
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
      // WW-B13: a sign request signs with the account FROZEN at request time, not whatever the live
      // store says now (which a concurrent switch could have changed).
      var acctRef = (pnd.snapshot && pnd.snapshot.accountRef != null) ? pnd.snapshot.accountRef : (p.accountRef || null);
      var acctAddr = (pnd.snapshot && pnd.snapshot.account != null) ? pnd.snapshot.account : ((p.accounts || [])[0] || null);
      sendResponse({
        id: id, origin: pnd.origin, favicon: faviconFor(pnd.origin), method: pnd.method, params: pnd.params, kind: pnd.kind,
        tabId: pnd.tabId != null ? pnd.tabId : null, // the dApp tab — so the approval window can open the side panel in its window
        accountRef: acctRef, accountAddress: acctAddr,
        eth: p.eth || null, sol: p.sol || null,
        myAddresses: p.myAddresses || p.accounts || [], paired: !!p.pairedAddresses, assetTags: {}, locked: false,
      });
    });
  }

  // Approval window posts the user's decision. For CONNECT it also sends the computed account info;
  // for SIGN it sends the already-signed result (signing happened in the window, which holds the keys).
  // Detach a pending request on a SUCCESSFUL decision: clear its expiry + window mapping, return it.
  function finishPending(id) {
    var pnd = PENDING[id]; if (!pnd) return null; delete PENDING[id];
    if (pnd.expireT) { try { clearTimeout(pnd.expireT); } catch (_) {} }
    if (pnd.winId != null) delete WINDOWS[pnd.winId];
    return pnd;
  }
  // WW-B13: right before we RELEASE a signature/broadcast, prove the grant that authorized it still
  // exists AND still points at the same account it was frozen to. If the user revoked or switched
  // accounts while the approval window was open, refuse — the signature is never handed back.
  function grantStillValid(pnd, cb) {
    loadStore(function (store) {
      var p = PERM.getPermission(store, pnd.origin);
      if (!p) return cb(false);
      if (pnd.snapshot && pnd.snapshot.accountRef != null && p.accountRef !== pnd.snapshot.accountRef) return cb(false);
      cb(true);
    });
  }

  function onDecision(id, approved, extra, sendResponse) {
    var pnd = finishPending(id); if (!pnd) { if (sendResponse) sendResponse({ ok: false }); return; }
    if (sendResponse) sendResponse({ ok: true });
    if (!approved) { pnd.resolve({ error: { code: P.ERR.USER_REJECTED, message: 'User rejected the request' } }); return; }
    if (pnd.kind === 'connect') {
      var accts = (extra && extra.accounts) || [];
      mutateStore(function (store) {
        store = PERM.grant(store, pnd.origin, { accounts: accts, accountRef: extra && extra.accountRef, chains: ['btc'], pairedAddresses: extra && extra.pairedAddresses }, nowMs());
        var key = PERM.normalizeOrigin(pnd.origin);
        if (store[key]) { store[key].publicKey = (extra && extra.publicKey) || null; store[key].addresses = (extra && extra.addresses) || null; store[key].myAddresses = (extra && extra.myAddresses) || accts; store[key].eth = (extra && extra.eth) || null; store[key].sol = (extra && extra.sol) || null; }
        return store;
      }, function () {
        var chain = P.chainOf(pnd.method);
        var eth = (extra && extra.eth) || null, sol = (extra && extra.sol) || null;
        emitEvent(pnd.origin, 'accountsChanged', chain === 'eth' ? (eth ? [eth] : []) : accts);
        var out;
        if (pnd.method === 'wallet_requestPermissions') out = eth ? [{ parentCapability: 'eth_accounts', caveats: [{ type: 'restrictReturnedAccounts', value: [eth] }] }] : [];
        else out = chain === 'eth' ? (eth ? [eth] : []) : chain === 'sol' ? (sol ? { address: sol } : null) : { accounts: accts, proof: extra && extra.proof };
        pnd.resolve({ result: out });
      });
    } else if (extra && extra.broadcast) { // ww_broadcastTransaction: window approved → SW pushes via proxy
      grantStillValid(pnd, function (okGrant) {
        if (!okGrant) return pnd.resolve({ error: { code: P.ERR.UNAUTHORIZED, message: 'Connection changed before broadcast — cancelled.' } });
        fetch(PROXY + '/api/btc/broadcast', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ txhex: extra.rawhex }) })
          .then(function (r) { return r.json(); })
          .then(function (j) { pnd.resolve(j && j.error ? { error: { code: P.ERR.INTERNAL, message: j.detail || j.error } } : { result: { txid: j.txid } }); })
          .catch(function () { pnd.resolve({ error: { code: P.ERR.INTERNAL, message: 'broadcast failed' } }); });
      });
    } else { // sign: the approval window already signed; relay its result only if the grant still holds
      if (extra && extra.error) { pnd.resolve({ error: extra.error }); return; }
      grantStillValid(pnd, function (okGrant) {
        if (!okGrant) return pnd.resolve({ error: { code: P.ERR.UNAUTHORIZED, message: 'Connection changed before signing completed — the signature was not released.' } });
        pnd.resolve({ result: extra && extra.result });
      });
    }
  }

  function emitEvent(origin, event, payload) {
    var target = PERM.normalizeOrigin(origin);
    chrome.tabs.query({}, function (tabs) {
      (tabs || []).forEach(function (t) { try { if (t.url && new URL(t.url).origin === target) chrome.tabs.sendMessage(t.id, { type: 'ww_provider_event', event: event, payload: payload }); } catch (_) {} });
    });
  }

  // An approval window closed without a decision → reject the pending request (clears its expiry too).
  if (chrome.windows && chrome.windows.onRemoved) chrome.windows.onRemoved.addListener(function (winId) {
    var id = WINDOWS[winId]; if (!id) return;
    closePending(id, { code: P.ERR.USER_REJECTED, message: 'Request window closed' });
  });

  // For the "Connected sites" manager in the popup.
  function listSites(sendResponse) { loadStore(function (store) { sendResponse(PERM.list(store)); }); }
  function revokeSite(origin, sendResponse) {
    cancelPending(origin, 'Disconnected'); // WW-B13: cancel any in-flight request for this site
    mutateStore(function (s) { return PERM.revoke(s, origin); }, function (r) { if (r && r.existed) emitEvent(origin, 'disconnect'); sendResponse({ ok: true }); });
  }

  root.WWProviderBg = { handleProviderRequest: handleProviderRequest, getPending: getPending, onDecision: onDecision, listSites: listSites, revokeSite: revokeSite };
})(self);
