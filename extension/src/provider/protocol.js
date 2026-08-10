/*
 * Wonder Wallet dApp provider — shared protocol constants + method classification.
 * Phase 12 (v0.48). ACTIVE — the dApp provider ships wired into every build and injects on all sites (universal, MetaMask/Phantom model, v0.48+). See STORE_LISTING.md + docs/DAPP_PROVIDER_PLAN.md (superseded).
 *
 * Dual-mode: `require()`-able in Node (tests) AND loadable as a classic script in the
 * content script / service worker (sets self.WWProtocol). inpage.js inlines its own copy
 * so it never depends on anything in the page's world.
 *
 * Design mirrors XCP Wallet v0.5.2 (our closest peer): EIP-1193-style request({method,params}),
 * `ww_`-prefixed methods, and numeric error codes — so a site that integrated xcpwallet can add
 * Wonder Wallet with near-identical code. See docs/DAPP_PROVIDER_PLAN.md §3d.
 */
(function (root) {
  'use strict';

  // postMessage channel between inpage (MAIN world) and content script (ISOLATED world).
  var CHANNEL_REQ = 'ww:provider:req';   // page  → content → background
  var CHANNEL_RES = 'ww:provider:res';   // background → content → page (response to a request id)
  var CHANNEL_EVT = 'ww:provider:evt';   // background → content → page (accountsChanged / disconnect)
  var INIT_EVENT = 'wonder-wallet#initialized';
  var DISCOVER_EVENT = 'wonder-wallet#discover';

  // EIP-1193-style numeric error codes (branch on `code`, never the message).
  var ERR = {
    USER_REJECTED: 4001,   // user closed/declined the approval popup
    UNAUTHORIZED: 4100,    // origin not connected, or wallet locked / no wallet
    UNSUPPORTED: 4200,     // unknown method
    DISCONNECTED: 4900,    // background momentarily unavailable — safe to retry
    INTERNAL: -32603,      // internal error (details masked)
  };

  // Provider surface across all three chains. Grouped by how the broker must treat each call.
  // BTC = ww_* (our namespace). ETH = EIP-1193 method names. SOL = sol_* (Wallet Standard features map here).
  var METHODS = {
    connect: ['ww_requestAccounts', 'eth_requestAccounts', 'sol_connect', 'wallet_requestPermissions'],   // opens Connect approval if not permitted
    read: [
      'ww_accounts', 'ww_getAddresses', 'ww_getPublicKey', 'ww_getBalances', 'ww_getNetwork', 'ww_chainId',
      'eth_accounts', 'eth_chainId', 'net_version', 'wallet_getPermissions',
      'sol_accounts',
    ],
    sign: [
      'ww_signMessage', 'ww_signPsbt', 'ww_signTransaction', 'ww_broadcastTransaction',
      'personal_sign', 'eth_sign', 'eth_signTypedData', 'eth_signTypedData_v3', 'eth_signTypedData_v4', 'eth_sendTransaction', 'eth_signTransaction',
      'sol_signMessage', 'sol_signTransaction', 'sol_signAllTransactions', 'sol_signAndSendTransaction',
    ],
    manage: ['ww_disconnect', 'sol_disconnect', 'wallet_switchEthereumChain', 'wallet_addEthereumChain'],
  };
  var EVENTS = ['accountsChanged', 'networkChanged', 'chainChanged', 'disconnect'];

  // Which bucket a method falls in — the broker keys all of its decisions off this.
  function classify(method) {
    if (METHODS.connect.indexOf(method) >= 0) return 'connect';
    if (METHODS.read.indexOf(method) >= 0) return 'read';
    if (METHODS.sign.indexOf(method) >= 0) return 'sign';
    if (METHODS.manage.indexOf(method) >= 0) return 'manage';
    // Generic EVM JSON-RPC (eth_call, eth_getBalance, eth_blockNumber, eth_estimateGas, …) → a public
    // read the background proxies to a node, so Wonder Wallet is a FULL EIP-1193 provider on any dApp.
    if (/^eth_/.test(method) || /^net_/.test(method) || /^web3_/.test(method)) return 'read';
    return 'unsupported';
  }
  // Which chain a method belongs to — the background uses this to serve the right address/chainId.
  function chainOf(method) {
    if (method.indexOf('sol_') === 0) return 'sol';
    if (method.indexOf('ww_') === 0) return 'btc';
    if (method.indexOf('eth_') === 0 || method === 'personal_sign' || method === 'net_version' || method.indexOf('wallet_') === 0) return 'eth';
    return 'btc';
  }

  var WWP = {
    CHANNEL_REQ: CHANNEL_REQ, CHANNEL_RES: CHANNEL_RES, CHANNEL_EVT: CHANNEL_EVT,
    INIT_EVENT: INIT_EVENT, DISCOVER_EVENT: DISCOVER_EVENT,
    ERR: ERR, METHODS: METHODS, EVENTS: EVENTS, classify: classify, chainOf: chainOf,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = WWP;
  else root.WWProtocol = WWP;
})(typeof self !== 'undefined' ? self : this);
