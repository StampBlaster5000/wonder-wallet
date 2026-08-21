/* Wonder Wallet — shared fee-preset staggering. The mempool API often returns EQUAL rates at low load,
   which made fee rows show tied numbers and light up more than one preset. Every fee row now runs its
   presets through WWFee.stagger() so they're strictly descending (Fast > Med > Econ, ≥1 sat/vB apart) —
   exactly one lights up, and Fast always sits above Med. One helper, used everywhere, so it can't drift
   per-flow again. */
(function () {
  'use strict';
  // keys: ordered HIGH→LOW, e.g. ['fastestFee','halfHourFee','hourFee'] (add 'economyFee' last for 4-tier
  // rows). Returns a new object with the same keys as positive integers, each strictly greater than the
  // next-lower tier. The LOWEST tier (last key) is preserved as the floor.
  function stagger(fees, keys) {
    fees = fees || {};
    keys = keys || ['fastestFee', 'halfHourFee', 'hourFee'];
    var num = function (v, d) { var n = Math.round(Number(v)); return (isFinite(n) && n > 0) ? n : d; };
    var out = {};
    var prev = num(fees[keys[keys.length - 1]], 1);
    out[keys[keys.length - 1]] = prev;
    for (var i = keys.length - 2; i >= 0; i--) { var v = Math.max(num(fees[keys[i]], prev + 1), prev + 1); out[keys[i]] = v; prev = v; }
    return out;
  }
  window.WWFee = { stagger: stagger };
})();
