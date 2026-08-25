/* Regression suite for the Solana Compute Budget priority-fee decoder (WW-C03).
   Mirrors extension/src/provider/approval.js solPriorityFee() — pins the exact decode the audit PoC
   defeated (a hidden 1-SOL SetComputeUnitPrice reported as no-danger). If this goes red, the extension's
   priority-fee surfacing/cap is broken. Pure logic — no DOM, no browser. Keep in lockstep with approval.js. */
const assert = require('assert');

// ── decoder (identical logic to approval.js) ──
const CB = [3, 6, 70, 111, 229, 33, 23, 50, 255, 236, 173, 186, 114, 195, 155, 231, 188, 140, 229, 187, 197, 247, 18, 107, 44, 67, 155, 58, 64, 0, 0, 0];
function readSV(b, o) { let v = 0, s = 0, i = o, x; for (;;) { x = b[i++]; v |= (x & 0x7f) << s; if ((x & 0x80) === 0) break; s += 7; } return [v, i]; }
function solPriorityFee(b) {
  try {
    let o = 0, sv;
    sv = readSV(b, o); o = sv[1] + sv[0] * 64;
    if (b[o] & 0x80) o += 1;
    const numReqSigs = b[o]; o += 3;
    sv = readSV(b, o); const kc = sv[0]; o = sv[1]; const keys = [];
    for (let k = 0; k < kc; k++) { keys.push(b.slice(o, o + 32)); o += 32; }
    o += 32;
    sv = readSV(b, o); const ic = sv[0]; o = sv[1];
    let limit = null, price = null, dup = false;
    for (let ix = 0; ix < ic; ix++) {
      const pid = b[o]; o += 1;
      sv = readSV(b, o); o = sv[1] + sv[0];
      sv = readSV(b, o); const dn = sv[0]; o = sv[1]; const d = b.slice(o, o + dn); o += dn;
      const prog = keys[pid]; let match = !!prog && prog.length === 32;
      if (match) for (let m = 0; m < 32; m++) if (prog[m] !== CB[m]) { match = false; break; }
      if (match) {
        if (d[0] === 2 && dn >= 5) { if (limit != null) dup = true; limit = d[1] | (d[2] << 8) | (d[3] << 16) | (d[4] * 0x1000000); }
        else if (d[0] === 3 && dn >= 9) { if (price != null) dup = true; let p = 0; for (let j = 0; j < 8; j++) p += d[1 + j] * Math.pow(2, 8 * j); price = p; }
      }
    }
    if (price == null && !dup) return null;
    const cu = limit != null ? limit : 200000, pri = price != null ? Math.ceil(cu * price / 1e6) : 0, base = 5000 * Math.max(1, numReqSigs);
    return { priorityLamports: pri, cuLimit: cu, price: price || 0, baseLamports: base, totalLamports: base + pri, dup };
  } catch (_) { return null; }
}

// ── tx builders ──
const u32le = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
const u64le = (n) => { const a = []; let x = n; for (let i = 0; i < 8; i++) { a.push(x & 255); x = Math.floor(x / 256); } return a; };
function tx({ limit, price, version0 } = {}) {
  const b = []; b.push(1); for (let i = 0; i < 64; i++) b.push(0); // 1 sig
  if (version0) b.push(0x80);
  b.push(1, 0, 1);                                                 // header
  b.push(2); for (let i = 0; i < 32; i++) b.push(0x11); CB.forEach((x) => b.push(x)); // payer + ComputeBudget
  for (let i = 0; i < 32; i++) b.push(0x22);                       // blockhash
  const ixs = [];
  if (limit != null) ixs.push([1, 0, 5, 2, ...u32le(limit)]);
  if (price != null) ixs.push([1, 0, 9, 3, ...u64le(price)]);
  if (arguments[0] && arguments[0].price2 != null) ixs.push([1, 0, 9, 3, ...u64le(arguments[0].price2)]); // duplicate SetComputeUnitPrice
  if (arguments[0] && arguments[0].limit2 != null) ixs.push([1, 0, 5, 2, ...u32le(arguments[0].limit2)]); // duplicate SetComputeUnitLimit
  b.push(ixs.length); ixs.forEach((ix) => ix.forEach((x) => b.push(x)));
  return Uint8Array.from(b);
}

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; } catch (e) { fail++; console.log('  ✗ ' + name + ': ' + (e && e.message)); } }

t('PoC: limit 200000 + price 5e9 → 1 SOL priority fee', () => {
  const r = solPriorityFee(tx({ limit: 200000, price: 5000000000 }));
  assert.strictEqual(r.priorityLamports, 1000000000, 'priority = 1 SOL');
});
t('same, versioned (v0) tx decodes identically', () => {
  const r = solPriorityFee(tx({ limit: 200000, price: 5000000000, version0: true }));
  assert.strictEqual(r.priorityLamports, 1000000000);
});
t('price with default CU limit (200000) when no SetComputeUnitLimit', () => {
  const r = solPriorityFee(tx({ price: 1000000 })); // 1e6 µlpc × 200000 CU / 1e6 = 200000 lamports
  assert.strictEqual(r.cuLimit, 200000);
  assert.strictEqual(r.priorityLamports, 200000);
});
t('no Compute Budget instruction → null (no false positive)', () => {
  assert.strictEqual(solPriorityFee(tx({})), null);
});
t('garbage bytes → null (fail safe, never throws)', () => {
  assert.strictEqual(solPriorityFee(Uint8Array.from([1, 2, 3])), null);
});
t('hard-cap threshold: 1 SOL exceeds the 0.5 SOL cap', () => {
  const r = solPriorityFee(tx({ limit: 200000, price: 5000000000 }));
  assert.ok(r.priorityLamports > 500000000, 'PoC fee is above the hard cap');
});
t('WW-C03: two SetComputeUnitPrice → dup flagged (refused on sign)', () => {
  const r = solPriorityFee(tx({ limit: 200000, price: 1000, price2: 5000000000 }));
  assert.strictEqual(r.dup, true, 'duplicate price must set dup');
});
t('WW-C03: two SetComputeUnitLimit → dup flagged', () => {
  const r = solPriorityFee(tx({ limit: 200000, price: 1000, limit2: 400000 }));
  assert.strictEqual(r.dup, true, 'duplicate limit must set dup');
});
t('WW-C03: single price/limit → dup false (no false positive)', () => {
  const r = solPriorityFee(tx({ limit: 200000, price: 1000000 }));
  assert.strictEqual(r.dup, false);
});

console.log((fail ? '❌' : '✅') + ' sol-priority-fee: ' + pass + ' passed' + (fail ? ', ' + fail + ' FAILED' : ''));
process.exit(fail ? 1 : 0);
