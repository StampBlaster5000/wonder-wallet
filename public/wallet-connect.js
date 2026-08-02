/*
 * Wonder Wallet — web Terminal wallet connector (injected-provider "Connect Wallet").
 * Lets wonder-wallet.com connect to an already-installed browser wallet — UniSat, OKX, or Wonder Wallet —
 * so the user can use the Terminal with their existing keys: read balances/assets (via our server proxy)
 * and SIGN transactions through that wallet's provider (compose server-side → provider.signPsbt → broadcast).
 *
 * UniSat, OKX, and Wonder Wallet all expose the same UniSat-shaped BTC API, so one normalized interface
 * covers all three. Dual-mode: require()-able (tests) + loadable as a classic script in the Terminal.
 *
 * Normalized connection object returned by connect():
 *   { id, name, address, publicKey,
 *     signPsbt(psbtHex,opts)->signedPsbtHex, signMessage(msg,type)->sig,
 *     pushPsbt(psbtHex)->txid, pushTx(rawHex)->txid, on(evt,fn), disconnect() }
 */
(function (root) {
  'use strict';

  // Registry: how to reach each wallet's BTC provider off a window-like object, and its connect/method map.
  var WALLETS = {
    unisat: {
      name: 'UniSat',
      get: function (w) { return w.unisat; },
      connect: function (p) { return p.requestAccounts().then(function (a) { return { accounts: a }; }); },
    },
    okx: {
      name: 'OKX Wallet',
      get: function (w) { return w.okxwallet && w.okxwallet.bitcoin; },
      connect: function (p) { return p.connect().then(function (r) { return { accounts: [r.address], publicKey: r.publicKey }; }); },
    },
    wonder: {
      name: 'Wonder Wallet',
      get: function (w) { return w.wonderWallet; },
      connect: function (p) { return p.requestAccounts().then(function (r) { return { accounts: (r && r.accounts) || r, proof: r && r.proof }; }); },
    },
  };
  var ORDER = ['wonder', 'unisat', 'okx'];

  // Which supported wallets are installed right now.
  function detect(win) {
    win = win || (typeof window !== 'undefined' ? window : {});
    return ORDER.filter(function (id) { try { return !!WALLETS[id].get(win); } catch (_) { return false; } })
      .map(function (id) { return { id: id, name: WALLETS[id].name }; });
  }

  // Normalize a wallet's provider to the common interface the Terminal calls.
  function wrap(id, p) {
    var listeners = [];
    var api = {
      id: id, name: WALLETS[id].name, address: null, publicKey: null, raw: p,
      getAccounts: function () { return Promise.resolve(p.getAccounts ? p.getAccounts() : (p.getSelectedAccount ? [p.getSelectedAccount()] : [])); },
      getPublicKey: function () { return Promise.resolve(p.getPublicKey ? p.getPublicKey() : api.publicKey); },
      // All three take (psbtHex, {autoFinalized, toSignInputs}) and return a signed PSBT hex.
      signPsbt: function (psbtHex, opts) { return Promise.resolve(p.signPsbt(psbtHex, opts || {})); },
      signMessage: function (msg, type) { return Promise.resolve(p.signMessage(msg, type)); },
      // Finalize + broadcast a PSBT (UniSat/OKX/Wonder all expose pushPsbt); fall back to signPsbt(autoFinalized)+pushTx.
      pushPsbt: function (psbtHex) {
        if (p.pushPsbt) return Promise.resolve(p.pushPsbt(psbtHex));
        return Promise.resolve(p.signPsbt(psbtHex, { autoFinalized: true })).then(function (signed) { return api.pushTx(signed); });
      },
      pushTx: function (rawHex) { return Promise.resolve(p.pushTx ? p.pushTx(rawHex) : (p.broadcastTransaction ? p.broadcastTransaction(rawHex) : Promise.reject(new Error('no_broadcast')))); },
      on: function (evt, fn) { listeners.push([evt, fn]); if (p.on) try { p.on(evt, fn); } catch (_) {} return api; },
      disconnect: function () { try { if (p.disconnect) p.disconnect(); } catch (_) {} listeners.forEach(function (l) { try { p.removeListener && p.removeListener(l[0], l[1]); } catch (_) {} }); },
    };
    return api;
  }

  // Connect to a wallet by id. Returns the normalized connection (with address + publicKey resolved).
  function connect(id, win) {
    win = win || (typeof window !== 'undefined' ? window : {});
    var def = WALLETS[id]; if (!def) return Promise.reject(new Error('unknown_wallet:' + id));
    var p; try { p = def.get(win); } catch (_) { p = null; }
    if (!p) return Promise.reject(new Error('not_installed:' + id));
    var api = wrap(id, p);
    return Promise.resolve(def.connect(p)).then(function (r) {
      api.address = (r.accounts && r.accounts[0]) || null;
      if (!api.address) throw new Error('no_account');
      api.proof = r.proof || null;
      return Promise.resolve(r.publicKey || (p.getPublicKey ? p.getPublicKey() : null)).catch(function () { return null; })
        .then(function (pk) { api.publicKey = pk || null; try { root.localStorage && localStorage.setItem('ww:connected', id); } catch (_) {} return api; });
    });
  }

  // SILENT reconnect across a page refresh — no prompt. getAccounts()/getSelectedAccount() return the
  // already-authorized account if the site is still connected (and the wallet unlocked), else nothing.
  // Returns the normalized connection, or null if not restorable (revoked, locked, or wallet absent).
  function reconnect(id, win) {
    win = win || (typeof window !== 'undefined' ? window : {});
    var def = WALLETS[id]; if (!def) return Promise.resolve(null);
    var p; try { p = def.get(win); } catch (_) { p = null; }
    if (!p) return Promise.resolve(null); // provider not injected (yet)
    var api = wrap(id, p);
    var getAcc = p.getAccounts ? p.getAccounts() : (p.getSelectedAccount ? Promise.resolve([p.getSelectedAccount()]) : Promise.resolve([]));
    return Promise.resolve(getAcc).then(function (accts) {
      var a = accts && accts[0]; if (!a) return null; // not authorized / wallet locked → don't restore
      api.address = (a && a.address) ? a.address : a; // OKX getSelectedAccount() may return { address }
      if (!api.address) return null;
      return Promise.resolve(p.getPublicKey ? p.getPublicKey() : null).catch(function () { return null; })
        .then(function (pk) { api.publicKey = pk || null; return api; });
    }).catch(function () { return null; });
  }

  function lastConnected() { try { return root.localStorage && localStorage.getItem('ww:connected'); } catch (_) { return null; } }
  function forget() { try { root.localStorage && localStorage.removeItem('ww:connected'); } catch (_) {} }

  var API = { detect: detect, connect: connect, reconnect: reconnect, wrap: wrap, WALLETS: WALLETS, lastConnected: lastConnected, forget: forget };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.WalletConnect = API;
})(typeof self !== 'undefined' ? self : this);
