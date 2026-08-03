/*
 * Wonder Wallet dApp provider — approval window renderer (Connect / Sign / Broadcast).
 * Phase 12 (v0.48). STAGED: not reachable until wired at v0.48 (post-approval).
 *
 * Presentation only. The background hands us a fully-prepared request so this file never touches
 * keys or the network — it renders exactly what the user is approving and posts back the decision:
 *   req = { id, origin, favicon, method, params, accountAddress, myAddresses:[], assetTags:{utxo->{kind,label}}, locked }
 *
 * The user's explicit requirement: NO BLIND SIGNING. Every dialog shows origin, the full breakdown,
 * and prioritized warnings (asset-bearing UTXOs, unusual sighash, high fee, a message that is really
 * transaction data). Signing paths surface the raw payload behind a "Show raw" toggle.
 */
(function () {
  'use strict';
  // Carry the wallet's theme (Midnight/Parchment) into this window. localStorage is shared across all
  // extension pages, and this runs before any content renders (route() is async), so there's no flash.
  try { if (localStorage.getItem('ww:theme') === 'light') document.documentElement.classList.add('theme-light'); } catch (_) {}
  var C = window.WonderCore, S = window.WWTxSummary;
  // This window loads wallet-core directly (no shim), so network calls use the ABSOLUTE proxy URL.
  // IMPORTANT: the Wonder Wallet API is served at the ARTIFACT path (like shim.js WW_PROXY) — the
  // emblem.build ROOT /api/ is the auth-gated dashboard and returns Unauthorized.
  var PROXY = 'https://build-1dadb019a5802eb5fee63753.emblem.build/pub/bitcoin_wallet/wonder-wallet';
  // Testnet Mode mirrors the extension's global toggle — the popup persists it to localStorage, which
  // is shared across ALL extension pages (incl. this approval window). So the network the user set on
  // the wallet carries into the connect/sign request: testnet derives coin-type-1' addresses (tb1…),
  // signs with the testnet key, and reads reflect testnet4.
  function netMode() { try { return localStorage.getItem('ww:netmode') === 'testnet' ? 'testnet' : 'mainnet'; } catch (_) { return 'mainnet'; } }
  var isTN = function () { return netMode() === 'testnet'; };
  (function () { // tag proxy reads with the active network via a query param (no CORS preflight; cache-distinct)
    var _f = window.fetch.bind(window);
    window.fetch = function (input, init) {
      try {
        if (isTN()) {
          var url = typeof input === 'string' ? input : (input && input.url) || '';
          if (url.indexOf(PROXY) === 0 && !/[?&]network=/.test(url)) {
            var nu = url + (url.indexOf('?') >= 0 ? '&' : '?') + 'network=testnet';
            input = (typeof input === 'string') ? nu : new Request(nu, input);
          }
        }
      } catch (_) {}
      return _f(input, init);
    };
  })();
  function postJson(path, body) { return fetch(PROXY + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(function (r) { return r.json(); }); }
  var app = document.getElementById('app');
  // Build stamp — a persistent corner badge (survives re-renders) so it's obvious which build is loaded.
  // Bump BUILD on each provider fix; if the badge doesn't match, the extension wasn't fully reloaded.
  var BUILD = 'b23 · testnet-connect'
  try { var _vb = document.createElement('div'); _vb.className = 'ap-ver'; _vb.textContent = 'v' + (chrome.runtime.getManifest().version) + ' ' + BUILD; document.body.appendChild(_vb); } catch (_) {}
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); };
  var btc = function (n) { return n == null ? '—' : (Number(n) / 1e8).toFixed(8).replace(/0+$/, '').replace(/\.$/, '') + ' BTC'; };
  var short = function (a) { a = String(a || ''); return a.length > 22 ? a.slice(0, 10) + '…' + a.slice(-8) : a; };
  var _btcUsd = 0; // BTC price for the sign screen's fee/total USD readout — prefetched on window open
  try { fetch(PROXY + '/api/prices').then(function (r) { return r.json(); }).then(function (p) { _btcUsd = (p && p.bitcoin) || 0; }).catch(function () {}); } catch (_) {}
  function usdTag(sats) { if (isTN()) return ''; var u = (Number(sats) / 1e8) * _btcUsd; return (_btcUsd && u) ? ' <span class="ap-fine">≈ $' + u.toLocaleString('en-US', { maximumFractionDigits: 2 }) + '</span>' : ''; }
  var reqId = new URLSearchParams(location.search).get('id');
  var req = null;

  chrome.runtime.sendMessage({ type: 'ww_get_pending', id: reqId }, function (r) {
    req = r || null;
    // The keys live in THIS window's context. The unlocked seed is in chrome.storage.session (put there
    // by the popup/expanded surface via ext-session.js); this window has no ext-session, so restore it
    // ourselves — resumeSession() needs the secret PASSED IN. The approval window is a TRUSTED_CONTEXT,
    // so it can read chrome.storage.session.
    restoreSession().then(function () { if (req && C && C.isUnlocked && !C.isUnlocked()) req.locked = true; route(); });
  });
  function restoreSession() {
    return new Promise(function (resolve) {
      try {
        if (C && C.isUnlocked && C.isUnlocked()) return resolve();
        if (!(window.chrome && chrome.storage && chrome.storage.session)) return resolve();
        chrome.storage.session.get('ww:session', function (o) {
          var s = o && o['ww:session'];
          try { if (s && s.secret && C && C.resumeSession) C.resumeSession(s.secret); } catch (_) {}
          resolve();
        });
      } catch (_) { resolve(); }
    });
  }
  function decide(approved, extra) { chrome.runtime.sendMessage({ type: 'ww_decision', id: reqId, approved: approved, extra: extra || null }, function () { window.close(); }); }
  var onApprove = function () { return Promise.resolve(null); }; // each dialog overrides this
  function showErr(e) { var w = document.querySelector('.ap-wrap'); if (!w) return; var d = document.createElement('div'); d.className = 'ap-warn danger'; d.textContent = '⛔ ' + ((e && e.message) || String(e)); w.appendChild(d); }

  // ── Active / pinned account ────────────────────────────────────────────────
  // The extension surfaces persist the selected account to localStorage (shared across all extension
  // pages, incl. this window). CONNECT captures whatever is ACTIVE now; SIGN uses the account PINNED
  // into the grant at connect time (req.accountRef) so switching accounts in the extension never
  // silently moves an already-connected site. accountRef format: 'hd:<index>:<type>' | 'imp:<id>:<type>'.
  function lsJson(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (_) { return null; } }
  function activeAcct() {
    var last = lsJson('ww:lastacct') || 'hd:0';
    var v = String(last);
    if (v.indexOf('imp:') === 0) { var id = v.slice(4); var it = (lsJson('ww:imptype') || {})[id] || 'nativeSegwit'; return { kind: 'imported', importedId: id, type: it, ref: 'imp:' + id + ':' + it }; }
    if (v.indexOf('hd:') === 0) { var n = parseInt(v.slice(3), 10) || 0; var t = (lsJson('ww:btctype') || {})[n] || 'nativeSegwit'; return { kind: 'hd', account: n, type: t, ref: 'hd:' + n + ':' + t }; }
    return { kind: v.indexOf('hw') === 0 ? 'hardware' : 'watch', type: 'nativeSegwit', ref: v }; // can't sign via the provider
  }
  function pinnedAcct() {
    var p = String((req && req.accountRef) || 'hd:0:nativeSegwit').split(':');
    if (p[0] === 'imp') return { kind: 'imported', importedId: p[1], type: p[2] || 'nativeSegwit', account: 0 };
    return { kind: 'hd', account: parseInt(p[1], 10) || 0, type: p[2] || 'nativeSegwit' }; // 'hd:0' (2-part legacy ref) → nativeSegwit
  }
  // Public info for the account being connected (address/pubkey/paired addrs/eth/sol).
  function deriveActive(A) {
    if (A.kind === 'imported') {
      var im = (C.importedAccounts() || []).filter(function (x) { return x.id === A.importedId; })[0];
      var bt = (im && im.bitcoin) || {};
      return { address: (bt[A.type] || bt.nativeSegwit || {}).address, publicKey: null, legacy: (bt.legacy || {}).address, taproot: (bt.taproot || {}).address, eth: null, sol: null };
    }
    var acct = C.accounts(A.account, 0, netMode()), b = acct.bitcoin[A.type] || acct.bitcoin.nativeSegwit || {};
    return { address: b.address, publicKey: b.publicKey || null, legacy: (acct.bitcoin.legacy || {}).address, taproot: (acct.bitcoin.taproot || {}).address, eth: (acct.ethereum || {}).address || null, sol: (acct.solana || {}).address || null };
  }

  // Origin banner shown on EVERY dialog — the anti-phishing anchor.
  function originBar() {
    var host = '';
    try { host = new URL(req.origin).host; } catch (_) { host = req.origin || 'unknown site'; }
    // Inline SVG globe — the page CSP blocks cross-origin favicons (img-src 'self'), and inline onerror
    // handlers are blocked by script-src 'self', so a fetched favicon would just show a broken image.
    var globe = '<svg class="ap-fav" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.4 2.5 15.6 0 18M12 3c-2.5 2.4-2.5 15.6 0 18"/></svg>';
    return '<div class="ap-origin">' + globe + '<span class="ap-host">' + esc(host) + '</span><span class="ap-secure">🔒 request from this site</span></div>';
  }
  function warns(list) {
    if (!list || !list.length) return '';
    return '<div class="ap-warns">' + list.map(function (w) {
      var ic = w.level === 'danger' ? '⛔' : w.level === 'warn' ? '⚠️' : 'ℹ️';
      return '<div class="ap-warn ' + esc(w.level) + '">' + ic + ' <span>' + esc(w.text) + '</span></div>';
    }).join('') + '</div>';
  }
  function foot(rejectLabel, okLabel, danger) {
    return '<div class="ap-foot"><button class="btn ghost" id="apNo">' + esc(rejectLabel) + '</button><button class="btn' + (danger ? ' ap-danger' : '') + '" id="apYes">' + esc(okLabel) + '</button></div>';
  }
  function wireFoot() {
    document.getElementById('apNo').onclick = function () { decide(false); };
    var yes = document.getElementById('apYes'); if (!yes) return;
    yes.onclick = function () { yes.disabled = true; Promise.resolve().then(onApprove).then(function (extra) { decide(true, extra); }).catch(function (e) { yes.disabled = false; showErr(e); }); };
  }

  // Live account sync: extension pages share localStorage, so a `storage` event fires here when the
  // side panel switches account. Only the Connect screen listens (via _acctChangeCb) so the shown
  // account/address always matches what the user selected in Wonder Wallet.
  var _acctChangeCb = null;
  try { window.addEventListener('storage', function (e) { if (_acctChangeCb && (e.key === 'ww:lastacct' || e.key === 'ww:btctype' || e.key === 'ww:imptype')) _acctChangeCb(); }); } catch (_) {}

  function route() {
    _acctChangeCb = null; // cleared on every screen; renderConnect re-arms it
    if (!req) return renderError('This request has expired or could not be found. Please try again from the site.');
    if (req.locked) return renderLocked();
    switch (req.method) {
      case 'ww_requestAccounts': case 'eth_requestAccounts': case 'sol_connect': case 'wallet_requestPermissions': return renderConnect();
      case 'ww_signMessage': return renderSignMessage();
      case 'ww_signPsbt': case 'ww_signTransaction': return renderSignPsbt();
      case 'ww_broadcastTransaction': return renderBroadcast();
      case 'personal_sign': case 'eth_sign': return renderSignEthMessage();
      case 'eth_signTypedData': case 'eth_signTypedData_v3': case 'eth_signTypedData_v4': return renderSignEthTypedData();
      case 'eth_sendTransaction': case 'eth_signTransaction': return renderSignEthTx();
      case 'sol_signMessage': return renderSignSolMessage();
      case 'sol_signTransaction': case 'sol_signAllTransactions': case 'sol_signAndSendTransaction': return renderSignSolTx();
      default: return renderError('Unsupported request: ' + esc(req.method));
    }
  }

  function renderError(msg) { app.innerHTML = '<div class="ap-wrap">' + originBar() + '<div class="ap-title">Request</div><div class="ap-hint">' + esc(msg) + '</div><div class="ap-foot"><button class="btn" id="apNo">Close</button></div></div>'; document.getElementById('apNo').onclick = function () { decide(false); }; }
  // Locked → unlock RIGHT HERE in the branded window (UniSat-style), then transition to the connect/sign
  // screen in the SAME window. This window holds wallet-core + shares the IndexedDB vault, so it unlocks
  // directly — no separate surface, no finicky sidePanel/openPopup gesture APIs. On success we also
  // persist the session so the popup/side-panel reflect the unlock.
  function renderLocked() {
    app.innerHTML = '<div class="ap-wrap">' + originBar()
      + '<div class="ap-brand"><span class="ap-seal"></span><span class="ap-brandname">Wonder Wallet</span></div>'
      + '<div class="ap-title" style="text-align:center">Enter your password</div>'
      + '<div class="ap-hint" style="text-align:center">Unlock to connect <b>' + esc(hostOf()) + '</b> and choose an account.</div>'
      + '<input id="apPw" class="ap-in" type="password" placeholder="Password" autocomplete="current-password" />'
      + '<div id="apErr" class="ap-warn danger" style="display:none"></div>'
      + '<div class="ap-foot"><button class="btn ghost" id="apNo">Cancel</button><button class="btn" id="apUnlock">Unlock</button></div></div>';
    document.getElementById('apNo').onclick = function () { decide(false); };
    var pw = document.getElementById('apPw'), btn = document.getElementById('apUnlock'), err = document.getElementById('apErr');
    function go() {
      var v = pw.value; if (!v) { pw.focus(); return; }
      btn.disabled = true; err.style.display = 'none';
      Promise.resolve().then(function () { return C.unlock(v); }).then(function () {
        try { var sec = C.getSessionSecret(); if (sec && window.chrome && chrome.storage && chrome.storage.session) chrome.storage.session.set({ 'ww:session': { secret: sec, lastActive: Date.now() } }); } catch (_) {}
        req.locked = false; route(); // → connect / sign, in this same window (UniSat-style transition)
      }).catch(function (e) {
        btn.disabled = false; err.style.display = '';
        err.textContent = (e && e.message === 'wrong_password') ? 'Wrong password — try again.' : 'Unlock failed.';
        pw.value = ''; pw.focus();
      });
    }
    btn.onclick = go;
    pw.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
    setTimeout(function () { try { pw.focus(); } catch (_) {} }, 40);
  }

  // ── CONNECT ── CHAIN-AWARE account picker: BTC / ETH / SOL depending on the request method, so an
  // Ethereum dApp (eth_requestAccounts) sees 0x… accounts, a Solana dApp sees its address, etc.
  function chainOfMethod(m) { m = String(m || ''); if (m.indexOf('sol_') === 0) return 'sol'; if (m.indexOf('eth_') === 0 || m === 'personal_sign' || m.indexOf('wallet_') === 0) return 'eth'; return 'btc'; }
  function renderConnect() {
    var chain = chainOfMethod(req.method);
    var chainName = chain === 'eth' ? 'Ethereum' : chain === 'sol' ? 'Solana' : 'Bitcoin';
    var choices;
    try { choices = buildAcctChoices(chain); } catch (e) { return renderError('Could not read your accounts — unlock and retry.'); }
    if (!choices.length) return renderError('No connectable ' + chainName + ' account found. Create or import one in Wonder Wallet, then retry.');
    var active = activeAcct();
    // Default selection: the active account by ref, else by account INDEX (a BTC ref won't match an eth/sol ref).
    var selRef = (choices.filter(function (c) { return c.ref === active.ref; })[0] || choices.filter(function (c) { return c.account === active.account; })[0] || choices[0]).ref;
    function draw() {
      var sel = choices.filter(function (c) { return c.ref === selRef; })[0] || choices[0];
      var canPair = chain === 'btc' && sel.kind === 'hd' && sel.legacy && sel.type !== 'legacy';
      onApprove = function () { return grantFor(sel, document.getElementById('apPaired')); };
      var rows = choices.map(function (c) {
        return '<button type="button" class="ap-acct' + (c.ref === selRef ? ' on' : '') + '" data-ref="' + esc(c.ref) + '">'
          + '<span class="ap-acct-i">' + (c.ref === selRef ? '●' : '○') + '</span>'
          + '<span class="ap-acct-m"><b>' + esc(c.label) + '</b><span class="ap-acct-t">' + esc(chain === 'btc' ? shortType(c.type) : chainName) + '</span></span>'
          + '<span class="ap-acct-a mono">' + esc(short(c.address)) + '</span></button>';
      }).join('');
      app.innerHTML = '<div class="ap-wrap">' + originBar()
        + '<div class="ap-title">Connect with Wonder Wallet</div>'
        + '<div class="ap-hint">Select the <b>' + esc(chainName) + '</b> account to use on this site.</div>'
        + '<div class="ap-accts">' + rows + '</div>'
        + (canPair ? '<label class="ap-check"><input type="checkbox" id="apPaired"/> Also share my paired Legacy address (some Stamps/Counterparty marketplaces need it). <span class="ap-fine">Links your two addresses to this site.</span></label>' : '')
        + warns([{ level: 'info', text: 'Only connect to sites you trust. Disconnect any time from Advanced → Connected sites.' }])
        + foot('Cancel', 'Connect', false) + '</div>';
      Array.prototype.forEach.call(document.querySelectorAll('.ap-acct'), function (b) { b.onclick = function () { selRef = b.getAttribute('data-ref'); draw(); }; });
      wireFoot();
    }
    draw();
  }
  function shortType(t) { return ({ nativeSegwit: 'Native SegWit', legacy: 'Legacy', taproot: 'Taproot', nestedSegwit: 'Nested SegWit' })[t] || t; }
  // Every HD account (0–3 always + any extras in ww:accts), each at its saved BTC type.
  function hdAcctList() {
    var set = {}, v = lsJson('ww:accts');
    if (Array.isArray(v)) v.forEach(function (x) { if (typeof x === 'number' && x >= 0 && x <= 1000) set[x] = 1; });
    for (var i = 0; i < 4; i++) set[i] = 1;
    return Object.keys(set).map(Number).sort(function (a, b) { return a - b; });
  }
  function buildAcctChoices(chain) {
    var out = [];
    hdAcctList().forEach(function (n) {
      var acct = C.accounts(n, 0, netMode());
      if (chain === 'eth') {
        var e = acct.ethereum || {};
        if (e.address) out.push({ kind: 'hd', account: n, chain: 'eth', type: 'eth', ref: 'hd:' + n + ':eth', label: 'Account ' + n, address: e.address, eth: e.address, sol: null, publicKey: null });
      } else if (chain === 'sol') {
        var s = acct.solana || {};
        if (s.address) out.push({ kind: 'hd', account: n, chain: 'sol', type: 'sol', ref: 'hd:' + n + ':sol', label: 'Account ' + n, address: s.address, sol: s.address, eth: null, publicKey: null });
      } else {
        var t = (lsJson('ww:btctype') || {})[n] || 'nativeSegwit';
        var b = acct.bitcoin[t] || acct.bitcoin.nativeSegwit || {};
        out.push({ kind: 'hd', account: n, chain: 'btc', type: t, ref: 'hd:' + n + ':' + t, label: 'Account ' + n, address: b.address, publicKey: b.publicKey || null, legacy: (acct.bitcoin.legacy || {}).address, taproot: (acct.bitcoin.taproot || {}).address, eth: (acct.ethereum || {}).address || null, sol: (acct.solana || {}).address || null });
      }
    });
    if (chain === 'btc') { // imported keys are Bitcoin-only
      try {
        (C.importedAccounts() || []).forEach(function (im) {
          var t = (lsJson('ww:imptype') || {})[im.id] || 'nativeSegwit', bt = im.bitcoin || {};
          out.push({ kind: 'imported', account: 0, chain: 'btc', importedId: im.id, type: t, ref: 'imp:' + im.id + ':' + t, label: im.label || 'Imported key', address: (bt[t] || bt.nativeSegwit || {}).address, publicKey: null, legacy: (bt.legacy || {}).address, taproot: (bt.taproot || {}).address, eth: null, sol: null });
        });
      } catch (_) {}
    }
    return out.filter(function (c) { return c.address; });
  }
  function grantFor(sel, pairedEl) {
    var chain = sel.chain || 'btc';
    var paired = !!(pairedEl && pairedEl.checked && chain === 'btc' && sel.kind === 'hd' && sel.legacy && sel.type !== 'legacy');
    // Sign-In With Bitcoin proof — BTC connects only (auto-signs a domain+nonce+issued message).
    var proof = null;
    if (chain === 'btc') {
      try {
        var nonce = (self.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now());
        var issued = new Date().toISOString();
        var pmsg = window.WWProof.buildProofMessage(req.origin, nonce, issued);
        var sm = (sel.kind === 'imported') ? C.signMessageImported(pmsg, sel.importedId, sel.type) : C.signMessage(pmsg, sel.account, sel.type, netMode());
        proof = { address: sel.address, message: pmsg, signature: (sm && sm.signature) || sm, scheme: (sm && sm.format) || 'BIP-322' };
      } catch (e) { /* best-effort */ }
    }
    return {
      accounts: [sel.address], accountRef: sel.ref, publicKey: sel.publicKey || null,
      addresses: chain === 'btc' ? { active: sel.address, nativeSegwit: sel.type === 'nativeSegwit' ? sel.address : undefined, legacy: sel.legacy, taproot: sel.taproot } : { active: sel.address },
      myAddresses: [sel.address, paired ? sel.legacy : null].filter(Boolean),
      eth: sel.eth, sol: sel.sol, pairedAddresses: paired, proof: proof,
    };
  }
  function renderConnectUnsupported(kind) {
    app.innerHTML = '<div class="ap-wrap">' + originBar() + '<div class="ap-title">Can’t connect this account</div>'
      + '<div class="ap-hint">' + (kind === 'hardware' ? 'A hardware (Ledger) account can’t sign through the in-page connector yet — it needs the device UI.' : 'Watch-only accounts have no keys to sign with.') + ' Switch to a seed or imported account in the extension, then retry from the site.</div>'
      + '<div class="ap-foot"><button class="btn ghost" id="apNo">Cancel</button></div></div>';
    document.getElementById('apNo').onclick = function () { decide(false); };
  }

  // ── SIGN MESSAGE ──
  function renderSignMessage() {
    var P = pinnedAcct();
    var sum = S.summarizeMessage(req.params && req.params[0], { origin: hostOf() });
    onApprove = function () { var m = req.params && req.params[0]; var sm = (P.kind === 'imported') ? C.signMessageImported(m, P.importedId, P.type) : C.signMessage(m, P.account, P.type, netMode()); return { result: (sm && sm.signature) || sm }; };
    app.innerHTML = '<div class="ap-wrap">' + originBar()
      + '<div class="ap-title">Signature request</div>'
      + '<div class="ap-hint">The site wants you to sign this message with <span class="mono">' + esc(short(req.accountAddress)) + '</span> (' + esc(sum.scheme) + '):</div>'
      + '<div class="ap-msg mono">' + (sum.text ? esc(sum.text) : '<span class="ap-fine">(empty message)</span>') + '</div>'
      + warns(sum.warnings)
      + foot('Reject', 'Sign message', sum.looksLikeTransaction) + '</div>';
    wireFoot();
  }

  // ── SIGN PSBT / TRANSACTION ──
  function renderSignPsbt() {
    var raw = req.params && req.params[0];
    var psbtHex = typeof raw === 'string' ? raw : (raw && (raw.hex || raw.psbtHex));
    // opts is the SECOND arg — UniSat-style signPsbt(psbtHex, {autoFinalized, toSignInputs}). (Fall back
    // to an object first-arg for callers that pass {hex, ...opts} as one param.) MUST read params[1] or
    // autoFinalized is dropped → we'd return a signed PSBT instead of the finalized {txhex}.
    var opts = (req.params && typeof req.params[1] === 'object' && req.params[1]) || (raw && typeof raw === 'object' ? raw : {});
    var P = pinnedAcct();
    var types = req.paired ? (P.type === 'legacy' ? ['legacy'] : [P.type, 'legacy']) : undefined;
    onApprove = function () { return { result: C.signProvider({ psbt: psbtHex, toSignInputs: opts.signInputs || opts.toSignInputs, autoFinalized: opts.autoFinalized, account: P.account, index: 0, type: P.type, types: types, importedId: P.importedId, prevTxs: opts.prevTxs || {}, network: netMode() }) }; };
    var d;
    try {
      d = C.describePsbt(psbtHex);
      var mine = {}; (req.myAddresses || []).forEach(function (a) { mine[a] = true; });
      var tags = req.assetTags || {};
      d.inputs.forEach(function (i) { i.mine = !!mine[i.address]; i.asset = tags[i.txid + ':' + i.index] || null; });
      d.outputs.forEach(function (o) { o.mine = !!mine[o.address]; });
    } catch (e) { return renderError('Could not decode this transaction: ' + esc(e.message || 'invalid PSBT')); }

    paintPsbt(d, psbtHex);
    // Fetch the BTC price → add a USD readout to the fee + total, then re-paint. Best-effort.
    if (!_btcUsd) fetch(PROXY + '/api/prices').then(function (r) { return r.json(); }).then(function (p) { _btcUsd = (p && p.bitcoin) || 0; if (_btcUsd) paintPsbt(d, psbtHex); }).catch(function () {});
    // Live asset-tagging: check each of our inputs' UTXOs against coin-control and flag asset-bearing
    // ones (Stamp / SRC-20 / Counterparty / Ordinal) so we never blind-sign one away. Best-effort, async.
    tagInputAssets(d).then(function (changed) { if (changed) paintPsbt(d, psbtHex); });
  }
  function paintPsbt(d, psbtHex) {
    var sum = S.summarizePsbt(d, { origin: hostOf() });
    var sendsHtml = sum.sends.map(function (s2) { return row(short(s2.address), btc(s2.value), 'send'); }).join('') || '<div class="ap-fine" style="padding:6px 0">No external payments (self-transfer / consolidation).</div>';
    var changeHtml = sum.change.map(function (c2) { return row(short(c2.address) + ' (change)', btc(c2.value), 'you'); }).join('');
    var inputsHtml = sum.mineInputs.map(function (i) { return row(short(i.address) + (i.asset ? ' · ' + esc(i.asset.label || i.asset.kind) : ''), btc(i.value), i.asset ? 'asset' : 'in'); }).join('');
    var sighash = sum.sighashTypes.map(function (s3) { return '<span class="ap-tag' + (s3.safe ? '' : ' bad') + '">' + esc(s3.name) + '</span>'; }).join(' ');
    app.innerHTML = '<div class="ap-wrap">' + originBar()
      + '<div class="ap-title">Confirm transaction</div>'
      + warns(sum.warnings)
      + '<div class="ap-sec">Sending</div>' + sendsHtml + changeHtml
      + '<div class="ap-kv big"><span>Network fee</span><span>' + btc(sum.fee) + usdTag(sum.fee) + (sum.feeKnown ? '' : ' <span class="ap-fine">(unverified)</span>') + '</span></div>'
      + '<div class="ap-kv big"><span>You pay (total)</span><span class="mono">' + btc(sum.youPay) + usdTag(sum.youPay) + '</span></div>'
      + '<div class="ap-sec">Your inputs being spent</div>' + inputsHtml
      + (sighash ? '<div class="ap-kv"><span>Sighash</span><span>' + sighash + '</span></div>' : '')
      + '<details class="ap-raw"><summary>Show raw PSBT</summary><div class="ap-msg mono">' + esc(psbtHex) + '</div></details>'
      + foot('Reject', 'Sign & approve', sum.warnings.some(function (w) { return w.level === 'danger'; })) + '</div>';
    wireFoot();
  }
  // Query coin-control for each of our input addresses; tag any input whose UTXO is asset-bearing.
  function tagInputAssets(d) {
    var addrs = {};
    d.inputs.forEach(function (i) { if (i.mine && i.address && !i.asset) addrs[i.address] = true; });
    var list = Object.keys(addrs);
    if (!list.length) return Promise.resolve(false);
    return Promise.all(list.map(function (a) {
      return fetch(PROXY + '/api/btc/' + encodeURIComponent(a) + '/coincontrol').then(function (r) { return r.json(); }).catch(function () { return null; });
    })).then(function (results) {
      var byUtxo = {};
      results.forEach(function (cc) {
        if (cc && cc.utxos) cc.utxos.forEach(function (u) {
          if (u.category === 'protected') {
            var carry = (u.carries && u.carries[0]) || null;
            byUtxo[u.txid + ':' + u.vout] = { kind: (u.reasons && u.reasons[0]) || 'asset', label: (carry && (carry.name || carry.asset)) || (u.reasons && u.reasons[0]) || 'asset-bearing' };
          }
        });
      });
      var changed = false;
      d.inputs.forEach(function (i) { var t = byUtxo[i.txid + ':' + i.index]; if (t) { i.asset = t; changed = true; } });
      return changed;
    });
  }

  // ── BROADCAST ──
  function renderBroadcast() {
    var rawhex = req.params && req.params[0];
    onApprove = function () { return { broadcast: true, rawhex: rawhex }; }; // background pushes via the proxy
    var outs = []; try { outs = C.decodeTxOutputs(rawhex); } catch (_) {}
    var mine = {}; (req.myAddresses || []).forEach(function (a) { mine[a] = true; });
    var rows = outs.map(function (o) { return o.opReturn ? row('OP_RETURN (data)', '', 'in') : row(short(o.address) + (mine[o.address] ? ' (you)' : ''), btc(o.value), mine[o.address] ? 'you' : 'send'); }).join('');
    app.innerHTML = '<div class="ap-wrap">' + originBar()
      + '<div class="ap-title">Broadcast transaction</div>'
      + '<div class="ap-hint">This will publish a signed transaction to the Bitcoin network. This cannot be undone.</div>'
      + '<div class="ap-sec">Outputs</div>' + (rows || '<div class="ap-fine">Could not decode outputs.</div>')
      + warns([{ level: 'warn', text: 'Only broadcast if you signed and reviewed this transaction. ' + esc(hostOf()) + ' provided it.' }])
      + '<details class="ap-raw"><summary>Show raw transaction</summary><div class="ap-msg mono">' + esc(rawhex) + '</div></details>'
      + foot('Cancel', 'Broadcast', true) + '</div>';
    wireFoot();
  }

  // ── ETHEREUM ──
  function hexToUtf8Maybe(s) { s = String(s || ''); if (/^0x[0-9a-fA-F]*$/.test(s)) { try { var h = s.slice(2), u = new Uint8Array(h.length / 2); for (var i = 0; i < u.length; i++) u[i] = parseInt(h.substr(i * 2, 2), 16); return new TextDecoder().decode(u); } catch (_) {} } return s; }
  function hexToBytes(s) { s = String(s || '').replace(/^0x/, ''); if (s.length % 2) s = '0' + s; var u = new Uint8Array(s.length / 2); for (var i = 0; i < u.length; i++) u[i] = parseInt(s.substr(i * 2, 2), 16); return u; }
  // personal_sign params are [message, address] (some legacy dApps reverse them) — the message is the non-address one.
  function ethMsgParam(params) { var a = (params && params[0]) || '', b = (params && params[1]) || ''; var isAddr = function (x) { return /^0x[0-9a-fA-F]{40}$/.test(String(x)); }; return (isAddr(a) && !isAddr(b) && b) ? b : a; }
  function b64ToBytes(s) { try { var bin = atob(s), u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; } catch (_) { return new Uint8Array(0); } }

  function renderSignEthMessage() {
    var raw = ethMsgParam(req.params);
    var sum = S.summarizeMessage(hexToUtf8Maybe(raw), { origin: hostOf() });
    // Sign the DECODED message bytes (personal_sign carries hex) — signing the literal "0x…" string
    // would produce a signature over the wrong data and dApps (SIWE login) would reject it.
    var msg = /^0x[0-9a-fA-F]*$/.test(raw) ? hexToBytes(raw) : raw;
    onApprove = function () { return { result: C.ethPersonalSign(msg, pinnedAcct().account) }; };
    app.innerHTML = '<div class="ap-wrap">' + originBar()
      + '<div class="ap-title">Signature request · Ethereum</div>'
      + '<div class="ap-hint">Sign this message with <span class="mono">' + esc(short(req.eth || req.accountAddress)) + '</span>:</div>'
      + '<div class="ap-msg mono">' + (sum.text ? esc(sum.text) : '<span class="ap-fine">(empty)</span>') + '</div>'
      + warns(sum.warnings) + foot('Reject', 'Sign message', sum.looksLikeTransaction) + '</div>';
    wireFoot();
  }
  function renderSignEthTx() {
    var tx = (req.params && req.params[0]) || {};
    var sum = S.summarizeEthTx(tx, { origin: hostOf() });
    var isSignOnly = req.method === 'eth_signTransaction';
    var from = req.eth || tx.from || req.accountAddress;
    var prep = null; // gas/nonce/fees fetched from the proxy (shown before signing, reused on approve)
    var prepBody = { from: from, to: tx.to, valueWei: tx.value || '0x0', data: tx.data || tx.input || '0x', network: 'ethereum' };

    function draw() {
      onApprove = function () {
        var p = prep ? Promise.resolve(prep) : postJson('/api/eth/prepare', prepBody);
        return p.then(function (pp) {
          if (!pp || pp.error) throw new Error((pp && (pp.detail || pp.error)) || 'Could not prepare the transaction (gas/nonce).');
          var signed = C.sendEvm({
            account: pinnedAcct().account, to: tx.to, valueWei: tx.value ? BigInt(tx.value) : 0n, data: tx.data || tx.input || '0x',
            nonce: tx.nonce != null ? Number(tx.nonce) : pp.nonce, chainId: pp.chainId,
            maxFeePerGas: pp.maxFeePerGas, maxPriorityFeePerGas: pp.maxPriorityFeePerGas,
            gasLimit: tx.gas ? BigInt(tx.gas) : BigInt(pp.gasLimit),
          });
          if (isSignOnly) return { result: signed.raw }; // eth_signTransaction: return signed raw, do NOT broadcast
          return postJson('/api/eth/broadcast', { raw: signed.raw, network: 'ethereum' }).then(function (b) {
            if (!b || b.error) throw new Error((b && (b.detail || b.error)) || 'Broadcast rejected.');
            return { result: b.txhash }; // eth_sendTransaction resolves to the tx hash
          });
        });
      };
      var feeRow = '';
      if (prep) {
        try {
          var gl = tx.gas ? BigInt(tx.gas) : BigInt(prep.gasLimit);
          var maxEth = Number(gl * BigInt(prep.maxFeePerGas)) / 1e18;
          feeRow = '<div class="ap-kv"><span>Max network fee</span><span>' + maxEth.toFixed(6).replace(/0+$/, '').replace(/\.$/, '') + ' ETH</span></div>'
            + '<div class="ap-kv"><span>Gas / nonce</span><span class="ap-fine">' + gl.toString() + ' · #' + prep.nonce + '</span></div>';
        } catch (_) {}
      } else { feeRow = '<div class="ap-warn warn">⚠️ <span>Couldn’t fetch gas/fee estimate — it will be computed when you approve.</span></div>'; }
      app.innerHTML = '<div class="ap-wrap">' + originBar()
        + '<div class="ap-title">' + (isSignOnly ? 'Sign transaction' : 'Confirm transaction') + ' · Ethereum</div>' + warns(sum.warnings)
        + '<div class="ap-sec">' + (isSignOnly ? 'Transaction' : 'Sending') + '</div>' + row(short(sum.to || 'contract creation'), sum.valueEth, sum.isContract ? 'asset' : 'send')
        + '<div class="ap-kv"><span>From</span><span class="mono">' + esc(short(from)) + '</span></div>'
        + (sum.isContract ? '<div class="ap-kv"><span>Call data</span><span class="ap-fine">' + ((sum.data.length - 2) / 2) + ' bytes — contract interaction</span></div>' : '')
        + feeRow
        + '<details class="ap-raw"><summary>Show raw data</summary><div class="ap-msg mono">' + esc(sum.data) + '</div></details>'
        + foot('Reject', isSignOnly ? 'Sign' : 'Sign & send', sum.warnings.some(function (w) { return w.level === 'danger'; })) + '</div>';
      wireFoot();
    }
    app.innerHTML = '<div class="ap-wrap">' + originBar() + '<div class="ap-title">Confirm transaction · Ethereum</div><div class="ap-hint">Fetching gas & fee estimate…</div></div>';
    postJson('/api/eth/prepare', prepBody).then(function (pp) { if (pp && !pp.error) prep = pp; }).catch(function () {}).then(draw);
  }

  // eth_signTypedData_v4 (EIP-712) — parse, show the domain + message, sign with C.ethSignTypedData.
  function renderSignEthTypedData() {
    var params = req.params || [];
    // v3/v4 order is [address, typedDataJSON]; be lenient and pick whichever param IS the typed data.
    function asTd(x) { try { var o = typeof x === 'string' ? JSON.parse(x) : x; return (o && o.types && o.primaryType) ? o : null; } catch (_) { return null; } }
    var td = asTd(params[1]) || asTd(params[0]);
    if (!td) return renderError('Could not parse the EIP-712 typed-data payload.');
    var dom = td.domain || {};
    onApprove = function () { return { result: C.ethSignTypedData(td, pinnedAcct().account) }; };
    var msgStr = ''; try { msgStr = JSON.stringify(td.message, null, 2); } catch (_) { msgStr = String(td.message); }
    var domRows = '';
    if (dom.name) domRows += kv('Domain', dom.name + (dom.version ? ' · v' + dom.version : ''));
    if (dom.chainId != null) domRows += kv('Chain', 'chainId ' + dom.chainId);
    if (dom.verifyingContract) domRows += kv('Contract', short(dom.verifyingContract));
    var wl = [{ level: 'info', text: 'Typed-data signatures can authorize actions (token permits, DEX orders, logins). Be sure you trust what ' + hostOf() + ' will do with it.' }];
    if (dom.chainId != null && Number(dom.chainId) !== 1) wl.unshift({ level: 'warn', text: 'This targets chainId ' + dom.chainId + ' — not Ethereum mainnet.' });
    app.innerHTML = '<div class="ap-wrap">' + originBar()
      + '<div class="ap-title">Signature request · Ethereum</div>'
      + '<div class="ap-hint">' + esc(hostOf()) + ' wants you to sign <b>' + esc(td.primaryType) + '</b> typed data with <span class="mono">' + esc(short(req.eth || req.accountAddress)) + '</span>:</div>'
      + domRows
      + '<div class="ap-sec">Message</div><div class="ap-msg mono" style="max-height:220px;overflow:auto;white-space:pre-wrap">' + esc(msgStr) + '</div>'
      + warns(wl)
      + '<details class="ap-raw"><summary>Show raw typed data</summary><div class="ap-msg mono">' + esc(JSON.stringify(td)) + '</div></details>'
      + foot('Reject', 'Sign', false) + '</div>';
    wireFoot();
  }

  // ── SOLANA ──
  function renderSignSolMessage() {
    var msgB64 = (req.params && req.params[0]) || '';
    var text = ''; try { text = new TextDecoder().decode(b64ToBytes(msgB64)); } catch (_) {}
    var sum = S.summarizeMessage(text, { origin: hostOf() });
    onApprove = function () { return { result: C.solSignMessage(msgB64, pinnedAcct().account) }; };
    app.innerHTML = '<div class="ap-wrap">' + originBar()
      + '<div class="ap-title">Signature request · Solana</div>'
      + '<div class="ap-hint">Sign this message with <span class="mono">' + esc(short(req.sol || req.accountAddress)) + '</span>:</div>'
      + '<div class="ap-msg mono">' + (sum.text ? esc(sum.text) : '<span class="ap-fine">(binary message)</span>') + '</div>'
      + warns(sum.warnings) + foot('Reject', 'Sign message', false) + '</div>';
    wireFoot();
  }
  function bytesToB64(u8) { var s = ''; for (var i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s); }
  function renderSignSolTx() {
    var txB64 = (req.params && req.params[0]) || '';
    var isSend = req.method === 'sol_signAndSendTransaction';
    onApprove = function () {
      var signedB64 = C.solSignTransaction(txB64, pinnedAcct().account);
      if (!isSend) return { result: signedB64 }; // sign only → return the signed tx (dApp broadcasts)
      // signAndSendTransaction: broadcast via our RPC and return the 64-byte signature (Wallet Standard shape).
      return postJson('/api/sol/broadcast', { txBase64: signedB64 }).then(function (b) {
        if (!b || b.error) throw new Error((b && (b.detail || b.error)) || 'Broadcast rejected.');
        var raw = b64ToBytes(signedB64); var sig = raw.slice(1, 65); // sigs start after compactU16(count)=1 byte (<128 sigs)
        return { result: { signature: bytesToB64(sig), txid: b.signature } };
      });
    };
    app.innerHTML = '<div class="ap-wrap">' + originBar()
      + '<div class="ap-title">' + (isSend ? 'Sign &amp; send' : 'Sign') + ' transaction · Solana</div>'
      + '<div class="ap-hint">' + esc(hostOf()) + ' is asking you to ' + (isSend ? 'sign &amp; broadcast' : 'sign') + ' a Solana transaction with <span class="mono">' + esc(short(req.sol || req.accountAddress)) + '</span>. Wonder Wallet signs only your slot.</div>'
      + warns([{ level: 'warn', text: 'Solana transactions can move tokens or invoke programs. Review the action on the site before approving.' }, { level: 'info', text: 'Only sign if you trust ' + esc(hostOf()) + '.' }])
      + '<details class="ap-raw"><summary>Show raw transaction (base64)</summary><div class="ap-msg mono">' + esc(txB64) + '</div></details>'
      + foot('Reject', isSend ? 'Sign & send' : 'Sign', true) + '</div>';
    wireFoot();
  }

  function row(label, value, kind) { return '<div class="ap-row ' + esc(kind) + '"><span class="ap-row-l">' + esc(label) + '</span><span class="ap-row-v">' + esc(value) + '</span></div>'; }
  function kv(k, v) { return '<div class="ap-kv"><span>' + esc(k) + '</span><span>' + esc(v) + '</span></div>'; }
  function hostOf() { try { return new URL(req.origin).host; } catch (_) { return req.origin || 'the site'; } }
})();
