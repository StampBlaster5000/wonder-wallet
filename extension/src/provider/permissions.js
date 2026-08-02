/*
 * Wonder Wallet dApp provider — per-origin permission store (pure logic).
 * Phase 12 (v0.48). STAGED: not wired into the build until after store approval.
 *
 * Pure functions over a plain object `store` (origin -> grant). The background service worker
 * loads/saves that object to chrome.storage.local under key 'ww:connections'; these helpers hold
 * ZERO chrome/browser deps so they unit-test in Node and can't accidentally touch storage.
 *
 * A grant PERSISTS UNTIL REVOKED (the product requirement) — there is no expiry here.
 * The account a site sees is PINNED at connect time (locked decision #3): switching the wallet's
 * active account does NOT silently change what a connected site sees; an explicit per-site switch does.
 */
(function (root) {
  'use strict';

  var STORAGE_KEY = 'ww:connections';

  // Normalize a URL/origin to a bare https origin ("https://host[:port]"). Returns null for
  // anything we refuse to talk to (non-https, opaque, file://, malformed) — fail closed.
  function normalizeOrigin(input) {
    if (!input) return null;
    var s = String(input);
    try {
      var u = new URL(s.indexOf('://') >= 0 ? s : 'https://' + s);
      if (u.protocol !== 'https:') return null;      // wallets only talk to secure origins
      if (!u.hostname) return null;
      return u.origin;
    } catch (_) { return null; }
  }

  function getPermission(store, origin) {
    var o = normalizeOrigin(origin);
    return (o && store && store[o]) ? store[o] : null;
  }
  function isPermitted(store, origin) { return !!getPermission(store, origin); }

  // Accounts a permitted origin is allowed to see ([] if not connected — never throws).
  function accountsFor(store, origin) {
    var p = getPermission(store, origin);
    return p && Array.isArray(p.accounts) ? p.accounts.slice() : [];
  }

  // Record a connection. `grant` = { accounts:[addr], accountRef:'hd:0'|'imp:id'|'hardware',
  // chains:['btc'], pairedAddresses?:bool }. `now` is passed in (Date.now() is unavailable in some
  // contexts and must stay injectable for deterministic tests).
  function grant(store, origin, g, now) {
    var o = normalizeOrigin(origin);
    if (!o) throw new Error('bad_origin');
    store = store || {};
    store[o] = {
      accounts: (g && g.accounts) || [],
      accountRef: (g && g.accountRef) || null,
      chains: (g && g.chains) || ['btc'],
      pairedAddresses: !!(g && g.pairedAddresses),
      grantedAt: now || 0,
      lastUsed: now || 0,
    };
    return store;
  }

  // Remove one origin. Returns { store, existed } so the caller knows whether to emit `disconnect`.
  function revoke(store, origin) {
    var o = normalizeOrigin(origin);
    var existed = !!(o && store && store[o]);
    if (existed) delete store[o];
    return { store: store || {}, existed: existed };
  }
  function revokeAll(store) { return {}; }

  function touch(store, origin, now) {
    var p = getPermission(store, origin);
    if (p) p.lastUsed = now || 0;
    return store;
  }

  // For the "Connected sites" manager UI.
  function list(store) {
    store = store || {};
    return Object.keys(store).map(function (o) {
      var p = store[o];
      return { origin: o, accounts: p.accounts, accountRef: p.accountRef, chains: p.chains, pairedAddresses: p.pairedAddresses, grantedAt: p.grantedAt, lastUsed: p.lastUsed };
    }).sort(function (a, b) { return (b.lastUsed || 0) - (a.lastUsed || 0); });
  }

  var API = {
    STORAGE_KEY: STORAGE_KEY,
    normalizeOrigin: normalizeOrigin, getPermission: getPermission, isPermitted: isPermitted,
    accountsFor: accountsFor, grant: grant, revoke: revoke, revokeAll: revokeAll, touch: touch, list: list,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.WWPermissions = API;
})(typeof self !== 'undefined' ? self : this);
