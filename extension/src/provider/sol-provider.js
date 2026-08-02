/*
 * Wonder Wallet dApp provider — Solana (Wallet Standard). Phase 12 (v0.48). STAGED.
 * Registers a Wallet-Standard wallet so @solana/wallet-adapter dApps (e.g. emblemvault.ai) auto-list
 * "Wonder Wallet" with NO site changes. Marshals connect/sign to the shared page↔background bridge.
 * NOTE: validate against a live wallet-adapter dApp at activation — the Wallet Standard surface is finicky.
 */
(function () {
  'use strict';
  var CHANNEL_REQ = 'ww:provider:req', CHANNEL_RES = 'ww:provider:res';
  var pending = {}, seq = 0, changeListeners = [];
  function nextId() { seq += 1; return 'sol-' + seq + '-' + (performance.now() | 0); }
  function send(method, params) { return new Promise(function (res, rej) { var id = nextId(); pending[id] = { res: res, rej: rej }; window.postMessage({ channel: CHANNEL_REQ, id: id, method: method, params: params || [] }, window.location.origin); }); }
  window.addEventListener('message', function (e) { if (e.source !== window || !e.data || e.origin !== window.location.origin) return; var d = e.data; if (d.channel === CHANNEL_RES && d.id && pending[d.id]) { var p = pending[d.id]; delete pending[d.id]; if (d.error) p.rej(d.error); else p.res(d.result); } });

  var b64 = { enc: function (u8) { var s = ''; for (var i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s); }, dec: function (s) { var bin = atob(s), u8 = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return u8; } };
  // A Solana address IS its base58-encoded ed25519 pubkey — decode it to bytes for the WalletAccount.
  function bs58decode(str) {
    var A = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz', bytes = [0];
    for (var i = 0; i < str.length; i++) { var c = A.indexOf(str[i]); if (c < 0) return new Uint8Array(0); for (var j = 0; j < bytes.length; j++) bytes[j] *= 58; bytes[0] += c; var carry = 0; for (var k = 0; k < bytes.length; k++) { bytes[k] += carry; carry = bytes[k] >> 8; bytes[k] &= 0xff; } while (carry) { bytes.push(carry & 0xff); carry >>= 8; } }
    for (var z = 0; z < str.length && str[z] === '1'; z++) bytes.push(0);
    return new Uint8Array(bytes.reverse());
  }

  var ICON = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMjggMTI4Ij48cmVjdCB3aWR0aD0iMTI4IiBoZWlnaHQ9IjEyOCIgcng9IjMwIiBmaWxsPSIjMGEwYTBmIi8+PGNpcmNsZSBjeD0iNjQiIGN5PSI2NCIgcj0iNDUiIGZpbGw9IiNFMEI0NTMiLz48L3N2Zz4=';
  var accounts = [];

  function makeAccount(address, pubkeyBytes) {
    return { address: address, publicKey: pubkeyBytes || new Uint8Array(0), chains: ['solana:mainnet'], features: ['solana:signTransaction', 'solana:signMessage', 'solana:signAndSendTransaction'], label: 'Wonder Wallet' };
  }
  function emitChange(props) { changeListeners.slice().forEach(function (l) { try { l(props); } catch (_) {} }); }

  var wallet = {
    version: '1.0.0', name: 'Wonder Wallet', icon: ICON, chains: ['solana:mainnet'],
    get accounts() { return accounts; },
    features: {
      'standard:connect': { version: '1.0.0', connect: function (input) {
        // Wallet-adapter auto-connect passes { silent:true } on load — don't prompt; return the cached
        // account (via the sol_accounts read) if already connected, else nothing.
        if (input && input.silent) return send('sol_accounts', []).then(function (r) { var a = Array.isArray(r) ? r : (r ? [r] : []); accounts = a.length ? [makeAccount(a[0], bs58decode(a[0]))] : []; emitChange({ accounts: accounts }); return { accounts: accounts }; });
        return send('sol_connect', []).then(function (r) { accounts = r && r.address ? [makeAccount(r.address, bs58decode(r.address))] : []; emitChange({ accounts: accounts }); return { accounts: accounts }; });
      } },
      'standard:disconnect': { version: '1.0.0', disconnect: function () { return send('sol_disconnect', []).then(function () { accounts = []; emitChange({ accounts: accounts }); }); } },
      'standard:events': { version: '1.0.0', on: function (event, listener) { if (event === 'change') { changeListeners.push(listener); return function () { changeListeners = changeListeners.filter(function (l) { return l !== listener; }); }; } return function () {}; } },
      'solana:signTransaction': { version: '1.0.0', supportedTransactionVersions: ['legacy', 0], signTransaction: function (input) { var arr = [].concat(input); return Promise.all(arr.map(function (i) { return send('sol_signTransaction', [b64.enc(i.transaction)]).then(function (r) { return { signedTransaction: b64.dec(r) }; }); })); } },
      'solana:signMessage': { version: '1.0.0', signMessage: function (input) { var arr = [].concat(input); return Promise.all(arr.map(function (i) { return send('sol_signMessage', [b64.enc(i.message)]).then(function (r) { return { signedMessage: i.message, signature: b64.dec(r) }; }); })); } },
      'solana:signAndSendTransaction': { version: '1.0.0', supportedTransactionVersions: ['legacy', 0], signAndSendTransaction: function (input) { var arr = [].concat(input); return Promise.all(arr.map(function (i) { return send('sol_signAndSendTransaction', [b64.enc(i.transaction)]).then(function (r) { return { signature: b64.dec(r.signature || r) }; }); })); } },
    },
  };

  // Wallet Standard registration (both directions of the handshake for max compatibility).
  function register() { try { window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet', { detail: function (api) { try { api.register(wallet); } catch (_) {} } })); } catch (_) {} }
  window.addEventListener('wallet-standard:app-ready', function (e) { try { e.detail.register(wallet); } catch (_) {} });
  register();
})();
