/*
 * Wonder Wallet — web Terminal wallet connector (injected-provider "Connect Wallet").
 * Lets wonder-wallet.com connect to an already-installed browser wallet so the user can use the Terminal
 * with their existing keys: read balances/assets (via our server proxy) and SIGN through that wallet
 * (compose server-side → provider signs → broadcast).
 *
 * THREE provider protocols, normalized to ONE interface the Terminal calls:
 *   1. UniSat-shaped  — UniSat / OKX / Wonder Wallet. Named methods (requestAccounts, signPsbt, pushPsbt);
 *                       the wallet finalizes + broadcasts.
 *   2. Horizon        — discovered via `window.btc_providers`, provider at `window[<id>]`, JSON-RPC
 *                       `request(method, params)` (POSITIONAL). Methods: getAddresses / signPsbt /
 *                       signMessage. Signs only — WE finalize + broadcast.
 *   3. XCP Wallet     — `window.xcpwallet`, EIP-1193 `request({ method, params })` with `xcp_*` methods
 *                       (xcp_requestAccounts / xcp_signPsbt / xcp_signBitcoinPsbt / xcp_signMessage).
 *                       Signs only — WE finalize + broadcast.
 *
 * Normalized connection object returned by connect():
 *   { id, name, kind, address, publicKey, proof, btcType,
 *     signPsbt(psbtHex,opts)->signedPsbtHex, signMessage(msg,type)->sig,
 *     pushPsbt(signedPsbtHexOrTxObj)->txid, pushTx(rawHex)->txid, getAccounts, getPublicKey, on, disconnect() }
 *
 * Dual-mode: require()-able (tests) + loadable as a classic script in the Terminal.
 */
(function (root) {
  'use strict';

  // ── shared helpers ──
  function b64ToHex(b64) {
    var bin = (typeof atob !== 'undefined') ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
    var h = ''; for (var i = 0; i < bin.length; i++) h += ('0' + bin.charCodeAt(i).toString(16)).slice(-2);
    return h;
  }
  function hexOf(psbt) { return /^[0-9a-fA-F]+$/.test(psbt) ? psbt : b64ToHex(psbt); }
  function core() { return (typeof window !== 'undefined' && window.WonderCore) || (typeof global !== 'undefined' && global.WonderCore) || root.WonderCore || null; }
  function fetchFn() { return (typeof fetch !== 'undefined') ? fetch : (root.fetch || null); }

  // Every input index of a composed PSBT — first-party CP/BTC sends spend a single source address, so the
  // connected wallet is asked to sign all of them under that address. (Callers may override via opts.signInputs.)
  function allInputIndices(psbtHex) {
    try { var c = core(); var ins = (c && c.psbtInputs) ? c.psbtInputs(psbtHex) : []; return ins.map(function (_x, i) { return i; }); }
    catch (_) { return []; }
  }
  // Broadcast a raw tx hex through our server proxy → txid.
  function broadcastRaw(txhex) {
    var f = fetchFn(); if (!f) return Promise.reject(new Error('no_fetch'));
    return f('api/btc/broadcast', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ txhex: txhex }) })
      .then(function (r) { return r.json(); })
      .then(function (b) { if (!b || b.error) throw new Error((b && (b.detail || b.error)) || 'broadcast_failed'); return b.txid; });
  }
  // A wallet that signs but does NOT broadcast (Horizon/XCP): finalize its signed PSBT locally (WonderCore,
  // keyless) then broadcast the raw tx via our server.
  function finalizeAndBroadcast(signedPsbt) {
    var c = core();
    if (!c || !c.finalizeSignedPsbt) return Promise.reject(new Error('finalize_unavailable — reload the page'));
    var fin; try { fin = c.finalizeSignedPsbt(signedPsbt); } catch (e) { return Promise.reject(new Error('could not finalize the signed transaction: ' + (e && e.message))); }
    return broadcastRaw(fin.txhex).then(function (txid) { return txid || fin.txid; });
  }

  // ═══════════════════════════ 1. UniSat-shaped (UniSat / OKX / Wonder) ═══════════════════════════
  var WALLETS = {
    unisat: { name: 'UniSat', get: function (w) { return w.unisat; }, connect: function (p) { return p.requestAccounts().then(function (a) { return { accounts: a }; }); } },
    okx: { name: 'OKX Wallet', get: function (w) { return w.okxwallet && w.okxwallet.bitcoin; }, connect: function (p) { return p.connect().then(function (r) { return { accounts: [r.address], publicKey: r.publicKey }; }); } },
    wonder: { name: 'Wonder Wallet', get: function (w) { return w.wonderWallet; }, connect: function (p) { return p.requestAccounts().then(function (r) { return { accounts: (r && r.accounts) || r, proof: r && r.proof }; }); } },
  };
  var ORDER = ['wonder', 'unisat', 'okx'];

  function wrapUnisat(id, p) {
    var listeners = [];
    var api = {
      id: id, name: WALLETS[id].name, kind: 'unisat', address: null, publicKey: null, btcType: null, raw: p,
      getAccounts: function () { return Promise.resolve(p.getAccounts ? p.getAccounts() : (p.getSelectedAccount ? [p.getSelectedAccount()] : [])); },
      getPublicKey: function () { return Promise.resolve(p.getPublicKey ? p.getPublicKey() : api.publicKey); },
      signPsbt: function (psbtHex, opts) { return Promise.resolve(p.signPsbt(psbtHex, opts || {})); },
      signMessage: function (msg, type) { return Promise.resolve(p.signMessage(msg, type)); },
      pushPsbt: function (psbtHex) { if (p.pushPsbt) return Promise.resolve(p.pushPsbt(psbtHex)); return Promise.resolve(p.signPsbt(psbtHex, { autoFinalized: true })).then(function (s) { return api.pushTx(s); }); },
      pushTx: function (rawHex) { return Promise.resolve(p.pushTx ? p.pushTx(rawHex) : (p.broadcastTransaction ? p.broadcastTransaction(rawHex) : broadcastRaw(rawHex))); },
      on: function (evt, fn) { listeners.push([evt, fn]); if (p.on) try { p.on(evt, fn); } catch (_) {} return api; },
      disconnect: function () { try { if (p.disconnect) p.disconnect(); } catch (_) {} listeners.forEach(function (l) { try { p.removeListener && p.removeListener(l[0], l[1]); } catch (_) {} }); },
    };
    return api;
  }

  // ═══════════════════════════ 2. Horizon (window.btc_providers) ═══════════════════════════
  // Discovery array entries: { id, name, icon, methods:[...] }; the provider object is window[entry.id]
  // and exposes request(method, params) → Promise<{ result }>. Signs only (no broadcast method).
  function horizonEntries(win) {
    var arr = (win && win.btc_providers) || [];
    if (!Array.isArray(arr)) return [];
    return arr.filter(function (e) { return e && e.methods && e.methods.indexOf && e.methods.indexOf('signPsbt') >= 0; })
      .map(function (e) { return { id: e.id, name: e.name || 'Bitcoin Wallet', icon: e.icon || null, provider: win[e.id] }; })
      .filter(function (e) { return e.provider && typeof e.provider.request === 'function'; });
  }
  function horizonEntry(win, id) { return horizonEntries(win).filter(function (e) { return e.id === id; })[0] || null; }
  // Unwrap Horizon's { result: <resp> } envelope and surface errors as thrown.
  function horizonCall(provider, method, params) {
    return Promise.resolve(provider.request(method, params)).then(function (r) {
      var resp = (r && typeof r === 'object' && 'result' in r) ? r.result : r;
      if (resp && resp.error) throw new Error(typeof resp.error === 'string' ? resp.error : 'request_failed');
      return resp;
    });
  }
  // Dig a named field out of a possibly-nested response ({x} | {result:{x}} | {result:{result:{x}}}).
  function pick(resp, key) {
    if (resp == null) return undefined;
    if (resp[key] != null) return resp[key];
    if (resp.result != null) return pick(resp.result, key);
    return undefined;
  }
  function wrapHorizon(entry) {
    var p = entry.provider;
    var api = {
      id: entry.id, name: entry.name, kind: 'horizon', icon: entry.icon, address: null, publicKey: null, btcType: null, proof: null, raw: p,
      getAccounts: function () { return Promise.resolve(api.address ? [api.address] : []); },
      getPublicKey: function () { return Promise.resolve(api.publicKey); },
      signPsbt: function (psbtHex, opts) {
        var h = hexOf(psbtHex), si = (opts && opts.signInputs) || {};
        if (!Object.keys(si).length && api.address) { si[api.address] = allInputIndices(h); }
        return horizonCall(p, 'signPsbt', { hex: h, signInputs: si }).then(function (resp) {
          var s = pick(resp, 'signedPsbt'); if (!s) throw new Error('wallet_returned_no_signed_psbt'); return s;
        });
      },
      signMessage: function (msg) { return horizonCall(p, 'signMessage', { message: msg, address: api.address }).then(function (resp) { var s = pick(resp, 'signature'); if (!s) throw new Error('wallet_returned_no_signature'); return s; }); },
      pushPsbt: function (signedPsbt) { return finalizeAndBroadcast(signedPsbt); },
      pushTx: function (rawHex) { return broadcastRaw(rawHex); },
      on: function () { return api; },
      disconnect: function () {},
    };
    return api;
  }
  function connectHorizon(entry) {
    var api = wrapHorizon(entry);
    return horizonCall(entry.provider, 'getAddresses', undefined).then(function (resp) {
      var list = pick(resp, 'addresses') || (Array.isArray(resp) ? resp : []);
      var a = list && list[0]; if (!a) throw new Error('no_account');
      api.address = a.address || a;
      api.publicKey = a.publicKey || null;
      api.btcType = a.type === 'p2pkh' ? 'legacy' : (a.type === 'p2wpkh' ? 'nativeSegwit' : null);
      if (!api.address) throw new Error('no_account');
      return api;
    });
  }

  // ═══════════════════════════ 3. XCP Wallet (window.xcpwallet) ═══════════════════════════
  // EIP-1193 request({ method, params }) with xcp_* methods. xcp_signPsbt is Counterparty-only and refuses
  // plain BTC → fall back to xcp_signBitcoinPsbt for a plain payment. Signs only (no broadcast method).
  function xcpProvider(win) { return (win && win.xcpwallet && typeof win.xcpwallet.request === 'function') ? win.xcpwallet : null; }
  function xcpCall(p, method, params) { return Promise.resolve(p.request({ method: method, params: params })); }
  function wrapXcp(p) {
    var api = {
      id: 'xcp', name: 'XCP Wallet', kind: 'xcp', address: null, publicKey: null, btcType: null, proof: null, raw: p,
      getAccounts: function () { return xcpCall(p, 'xcp_accounts', []).then(function (a) { return a || []; }).catch(function () { return []; }); },
      getPublicKey: function () { return Promise.resolve(api.publicKey); },
      signPsbt: function (psbtHex, opts) {
        var h = hexOf(psbtHex), si = (opts && opts.signInputs) || {};
        if (!Object.keys(si).length && api.address) { si[api.address] = allInputIndices(h); }
        var param = { hex: h, signInputs: si };
        return xcpCall(p, 'xcp_signPsbt', [param]).then(function (r) { return (r && r.hex) || r; })
          .catch(function (e) {
            // xcp_signPsbt only signs Counterparty txs; a plain BTC payment goes through xcp_signBitcoinPsbt.
            var m = (e && (e.message || e.error)) || '';
            if (/counterparty|not a counterparty|plain|bitcoin payment|refus/i.test(String(m))) {
              return xcpCall(p, 'xcp_signBitcoinPsbt', [param]).then(function (r) { return (r && r.hex) || r; });
            }
            throw e;
          });
      },
      signMessage: function (msg) { return xcpCall(p, 'xcp_signMessage', [msg]).then(function (r) { return (r && r.signature) || r; }); },
      pushPsbt: function (signedPsbt) { return finalizeAndBroadcast(signedPsbt); },
      pushTx: function (rawHex) { return broadcastRaw(rawHex); },
      on: function (evt, fn) { try { p.on && p.on(evt, fn); } catch (_) {} return api; },
      disconnect: function () { try { p.request({ method: 'xcp_disconnect' }); } catch (_) {} },
    };
    return api;
  }
  function connectXcp(p) {
    var api = wrapXcp(p);
    return xcpCall(p, 'xcp_requestAccounts', undefined).then(function (r) {
      var accts = (r && r.accounts) || (Array.isArray(r) ? r : []);
      api.address = accts && accts[0]; if (!api.address) throw new Error('no_account');
      api.proof = (r && r.proof) || null;
      return api;
    });
  }

  // ═══════════════════════════ unified detect / connect / reconnect ═══════════════════════════
  function detect(win) {
    win = win || (typeof window !== 'undefined' ? window : {});
    var out = [];
    ORDER.forEach(function (id) { try { if (WALLETS[id].get(win)) out.push({ id: id, name: WALLETS[id].name, kind: 'unisat' }); } catch (_) {} });
    horizonEntries(win).forEach(function (e) { out.push({ id: e.id, name: e.name, kind: 'horizon', icon: e.icon }); });
    if (xcpProvider(win)) out.push({ id: 'xcp', name: 'XCP Wallet', kind: 'xcp' });
    return out;
  }

  function connect(id, win) {
    win = win || (typeof window !== 'undefined' ? window : {});
    if (WALLETS[id]) {
      var p; try { p = WALLETS[id].get(win); } catch (_) { p = null; }
      if (!p) return Promise.reject(new Error('not_installed:' + id));
      var api = wrapUnisat(id, p);
      return Promise.resolve(WALLETS[id].connect(p)).then(function (r) {
        api.address = (r.accounts && r.accounts[0]) || null;
        if (!api.address) throw new Error('no_account');
        api.proof = r.proof || null;
        return Promise.resolve(r.publicKey || (p.getPublicKey ? p.getPublicKey() : null)).catch(function () { return null; })
          .then(function (pk) { api.publicKey = pk || null; remember(id); return api; });
      });
    }
    if (id === 'xcp') { var xp = xcpProvider(win); if (!xp) return Promise.reject(new Error('not_installed:xcp')); return connectXcp(xp).then(function (api) { remember('xcp'); return api; }); }
    var he = horizonEntry(win, id); if (he) return connectHorizon(he).then(function (api) { remember(id); return api; });
    return Promise.reject(new Error('unknown_wallet:' + id));
  }

  // SILENT reconnect across a refresh — no prompt. UniSat/OKX/Wonder via getAccounts/getSelectedAccount;
  // XCP via xcp_accounts (documented no-popup). Horizon has no silent-account method → require a manual
  // reconnect (returns null) so a page load never triggers its approval popup.
  function reconnect(id, win) {
    win = win || (typeof window !== 'undefined' ? window : {});
    if (WALLETS[id]) {
      var p; try { p = WALLETS[id].get(win); } catch (_) { p = null; }
      if (!p) return Promise.resolve(null);
      var api = wrapUnisat(id, p);
      var getAcc = p.getAccounts ? p.getAccounts() : (p.getSelectedAccount ? Promise.resolve([p.getSelectedAccount()]) : Promise.resolve([]));
      return Promise.resolve(getAcc).then(function (accts) {
        var a = accts && accts[0]; if (!a) return null;
        api.address = (a && a.address) ? a.address : a; if (!api.address) return null;
        return Promise.resolve(p.getPublicKey ? p.getPublicKey() : null).catch(function () { return null; }).then(function (pk) { api.publicKey = pk || null; return api; });
      }).catch(function () { return null; });
    }
    if (id === 'xcp') {
      var xp = xcpProvider(win); if (!xp) return Promise.resolve(null);
      var xapi = wrapXcp(xp);
      return xcpCall(xp, 'xcp_accounts', []).then(function (accts) { var a = accts && accts[0]; if (!a) return null; xapi.address = a; return xapi; }).catch(function () { return null; });
    }
    return Promise.resolve(null); // Horizon: manual reconnect only
  }

  function remember(id) { try { (root.localStorage || (typeof localStorage !== 'undefined' && localStorage)) && localStorage.setItem('ww:connected', id); } catch (_) {} }
  function lastConnected() { try { return (typeof localStorage !== 'undefined') ? localStorage.getItem('ww:connected') : null; } catch (_) { return null; } }
  function forget() { try { (typeof localStorage !== 'undefined') && localStorage.removeItem('ww:connected'); } catch (_) {} }

  var API = { detect: detect, connect: connect, reconnect: reconnect, wrap: wrapUnisat, WALLETS: WALLETS, lastConnected: lastConnected, forget: forget,
    // exposed for tests
    _wrapHorizon: wrapHorizon, _wrapXcp: wrapXcp, _finalizeAndBroadcast: finalizeAndBroadcast, _pick: pick };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.WalletConnect = API;
})(typeof self !== 'undefined' ? self : this);
