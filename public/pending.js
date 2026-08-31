/*
 * Wonder Wallet — pending-spend ledger (double-spend / over-commit safety).
 *
 * Displayed balances are the CONFIRMED Counterparty/Bitcoin ledger. When you broadcast a spend (an XCP-69
 * mint, a Counterparty send, a swap/order, a dividend, a SRC-20 transfer, a BTC send) the debit isn't
 * reflected until it confirms — so firing several in a row can silently over-commit a balance. This ledger
 * records each committed amount the INSTANT it broadcasts and every balance readout subtracts it, so the
 * number you see is what you can still spend. Persisted in localStorage → instant + survives reloads, and
 * stays on-device (no server-side user data, preserving self-custody).
 *
 * Auto-restore: an entry is kept only while its transaction is IN FLIGHT. On reconcile() it's dropped once
 * the tx confirms (the confirmed balance now reflects it — no double count) OR it drops from the mempool /
 * is rejected by Counterparty or Bitcoin (the confirmed balance never moved — the amount is restored). No
 * special "success vs fail" handling: leaving the mempool is the single signal.
 *
 * Amounts are stored NORMALIZED (human units: XCP as 5, a divisible token as its decimal amount, BTC as
 * BTC) so they subtract directly from the normalized confirmed balance the UI shows.
 */
(function (root) {
  'use strict';
  var KEY = 'ww:pending';
  var GRACE_MS = 45 * 60 * 1000; // an entry absent from mempool AND unconfirmed this long is treated as dropped

  function nowMs() { try { return Date.now(); } catch (_) { return 0; } }
  function load() { try { return JSON.parse((root.localStorage && localStorage.getItem(KEY)) || '{}') || {}; } catch (_) { return {}; } }
  function save(m) { try { root.localStorage && localStorage.setItem(KEY, JSON.stringify(m)); } catch (_) {} }
  var A = function (addr) { return String(addr || ''); };
  var AS = function (asset) { return String(asset || '').toUpperCase(); };

  // Record a committed spend at broadcast. amount = NORMALIZED units of `asset` debited from `address`.
  function add(address, asset, amount, txid) {
    var a = A(address), amt = Number(amount);
    if (!a || !asset || !(amt > 0) || !txid) return;
    var m = load(); var list = m[a] || [];
    if (list.some(function (e) { return e.txid === txid && AS(e.asset) === AS(asset); })) return; // idempotent
    list.push({ asset: AS(asset), amount: amt, txid: String(txid), ts: nowMs() });
    m[a] = list; save(m);
  }
  // Sum of in-flight committed amounts for one asset on one address.
  function pending(address, asset) {
    var m = load(), list = m[A(address)] || [], as = AS(asset), s = 0;
    for (var i = 0; i < list.length; i++) if (AS(list[i].asset) === as) s += Number(list[i].amount) || 0;
    return s;
  }
  // confirmed - pending, floored at 0 — the single helper every balance readout routes through.
  function avail(address, asset, confirmed) {
    var c = Number(confirmed) || 0, p = pending(address, asset);
    return Math.max(0, c - p);
  }
  function entries(address) { return (load()[A(address)] || []).slice(); }
  function removeTx(address, txid) { var m = load(), a = A(address); if (!m[a]) return; m[a] = m[a].filter(function (e) { return e.txid !== txid; }); if (!m[a].length) delete m[a]; save(m); }

  // Prune settled/dropped entries for an address. `statusOf(txid)` → 'confirmed' | 'mempool' | 'gone'
  // (gone = not found in the recent confirmed set nor the mempool). Confirmed → drop (confirmed balance
  // now authoritative). mempool → keep (still in flight). gone → keep until GRACE, then drop (restore).
  function reconcileWith(address, statusOf) {
    var m = load(), a = A(address), list = m[a]; if (!list || !list.length) return;
    var t = nowMs();
    var kept = list.filter(function (e) {
      var st = statusOf(e.txid);
      if (st === 'confirmed') return false;            // settled on chain → confirmed balance reflects it
      if (st === 'mempool') return true;               // in flight → keep subtracting
      return (t - (e.ts || 0)) < GRACE_MS;             // 'gone': keep briefly (propagation), then drop (restore)
    });
    if (kept.length !== list.length) { if (kept.length) m[a] = kept; else delete m[a]; save(m); }
  }
  // Convenience: reconcile from the shared /api/activity feed (items carry {txid, confirmed}). Throttled per
  // address so frequent balance refreshes don't spam the endpoint (it's server-cached anyway).
  var _last = {};
  async function reconcile(address, fetchFn) {
    var a = A(address); if (!a) return;
    var f = fetchFn || (typeof fetch !== 'undefined' ? fetch : (root.fetch || null)); if (!f) return;
    if (!(load()[a] || []).length) return;             // nothing to reconcile
    if (nowMs() - (_last[a] || 0) < 20000) return;     // throttle
    _last[a] = nowMs();
    try {
      var r = await f('api/activity/' + encodeURIComponent(a)).then(function (x) { return x.json(); });
      var byId = {}; (r.items || []).forEach(function (it) { byId[it.txid] = it; });
      reconcileWith(a, function (txid) { var it = byId[txid]; return it ? (it.confirmed ? 'confirmed' : 'mempool') : 'gone'; });
    } catch (_) {}
  }

  root.WWPending = { add: add, pending: pending, avail: avail, entries: entries, removeTx: removeTx, reconcile: reconcile, reconcileWith: reconcileWith };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.WWPending;
})(typeof self !== 'undefined' ? self : this);
