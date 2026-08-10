/*
 * Wonder Wallet dApp provider — request broker (pure decision logic).
 * Phase 12 (v0.48). ACTIVE — the dApp provider ships wired into every build and injects on all sites (universal, MetaMask/Phantom model, v0.48+). See STORE_LISTING.md + docs/DAPP_PROVIDER_PLAN.md (superseded).
 *
 * decide() is a PURE function: given (method, origin, permission store) it returns what the
 * background service worker should do — serve directly, open an approval popup, revoke, or reject
 * with a numeric code. All the chrome.* side effects (storage, chrome.windows.create, signing via
 * wallet-core) live in the background integration; keeping the decision pure makes it unit-testable
 * and keeps the security rules in one auditable place.
 *
 * Rules (mirror XCP Wallet v0.5.2 + our locked decisions):
 *  • unknown method                     → reject 4200
 *  • ww_disconnect                      → revoke (+ background emits `disconnect`)
 *  • ww_requestAccounts, permitted      → serve cached accounts (no popup)
 *  • ww_requestAccounts, NOT permitted  → open Connect approval
 *  • ww_accounts                        → always serve ([] if not connected — never errors)
 *  • other reads, permitted             → serve; NOT permitted → reject 4100
 *  • any sign method, permitted         → open Sign approval (EVERY call — no blanket grant)
 *  • any sign method, NOT permitted     → reject 4100
 */
(function (root) {
  'use strict';

  var P = (typeof module !== 'undefined' && module.exports) ? require('./protocol.js') : root.WWProtocol;
  var PERM = (typeof module !== 'undefined' && module.exports) ? require('./permissions.js') : root.WWPermissions;
  var ERR = P.ERR;

  function reject(code, message) { return { action: 'reject', code: code, message: message }; }

  function decide(ctx) {
    var method = ctx.method, origin = ctx.origin, store = ctx.store || {};
    var kind = P.classify(method);
    var permitted = PERM.isPermitted(store, origin);

    if (kind === 'unsupported') return reject(ERR.UNSUPPORTED, 'Unsupported method: ' + method);
    if (kind === 'manage') {
      if (method === 'ww_disconnect' || method === 'sol_disconnect') return { action: 'revoke' }; // idempotent
      return { action: 'serve', method: method }; // wallet_switch/addEthereumChain → no-op (we're mainnet-only)
    }

    if (kind === 'connect') {
      if (permitted) return { action: 'serve', method: method, accounts: PERM.accountsFor(store, origin) };
      return { action: 'approve', kind: 'connect', method: method };
    }

    // *_accounts: never errors — returns the connected accounts, or [] if not connected (EIP-1193 semantics).
    if (method === 'ww_accounts' || method === 'eth_accounts' || method === 'sol_accounts') return { action: 'serve', method: method, accounts: PERM.accountsFor(store, origin) };

    if (kind === 'read') {
      // chainId / network are PUBLIC — dApps read them before connecting.
      if (['ww_chainId', 'ww_getNetwork', 'eth_chainId', 'net_version'].indexOf(method) >= 0) return { action: 'serve', method: method };
      // Generic EVM/web3 RPC (eth_call, eth_getBalance, eth_estimateGas, …) is a PUBLIC chain query —
      // dApps fire these before connecting to render their UI, and they expose no wallet data.
      if (/^eth_/.test(method) || /^net_/.test(method) || /^web3_/.test(method)) return { action: 'serve', method: method };
      if (!permitted) return reject(ERR.UNAUTHORIZED, 'Not connected. Request accounts first.');
      return { action: 'serve', method: method, accounts: PERM.accountsFor(store, origin) };
    }

    if (kind === 'sign') {
      if (!permitted) return reject(ERR.UNAUTHORIZED, 'Not connected. Call ww_requestAccounts first.');
      return { action: 'approve', kind: 'sign', method: method }; // recheck the grant again right before signing
    }

    return reject(ERR.INTERNAL, 'Unhandled request');
  }

  var API = { decide: decide };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.WWBroker = API;
})(typeof self !== 'undefined' ? self : this);
