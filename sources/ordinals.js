/**
 * Ordinals/Runes per-UTXO detection (Phase 0 §2). Best-effort via a public
 * `ord` server. NOTE: Hiro's API sunsets 2026-03-09 — we use an ord `/output`
 * endpoint, and the robust end-state is self-hosting `ord`.
 */
'use strict';

const { fetchJson, pool, cacheGet, cacheSet } = require('./http');

const BASE = process.env.ORD_API || 'https://ordinals.com';

/** Returns true if the output carries an inscription or rune. */
async function outputProtected(utxo) {
  const key = `ord:${utxo}`;
  const hit = cacheGet(key);
  if (hit !== null) return hit;
  try {
    const o = await fetchJson(`${BASE}/output/${utxo}`, { timeout: 6000 });
    // WW-B06: only a well-formed, positively-indexed response may clear an output. An ord 404 means the
    // index couldn't resolve the outpoint — NOT that it proved the output inscription/rune-free — and a
    // 200 with wrong-typed fields must not clear it either. Require indexed===true + an array
    // `inscriptions` + a plain-object `runes`; otherwise return UNKNOWN and DO NOT negative-cache it, so a
    // 404 / outage / malformed body re-checks next time instead of sticking "clear" for five minutes.
    const okShape = o && o.indexed === true && Array.isArray(o.inscriptions) && o.runes && typeof o.runes === 'object' && !Array.isArray(o.runes);
    if (!okShape) return false; // unknown — not cached
    const val = o.inscriptions.length > 0 || Object.keys(o.runes).length > 0;
    cacheSet(key, val, 300_000); // cache only a genuine determination
    return val;
  } catch (_) { return false; } // 404 / non-JSON / timeout ⇒ UNKNOWN, not cached (do not negative-cache)
}

/**
 * Scan a list of utxos for inscriptions (capped + concurrency-limited to stay
 * friendly to the public ord server and the host watchdog).
 */
async function getProtectedUtxos(utxos, { cap = 120 } = {}) {
  const scanned = utxos.slice(0, cap);
  const flags = await pool(scanned, (u) => outputProtected(`${u.txid}:${u.vout}`), 6);
  const protectedSet = new Set();
  scanned.forEach((u, i) => { if (flags[i] === true) protectedSet.add(`${u.txid}:${u.vout}`); });
  return { protectedSet, scannedCount: scanned.length, capped: utxos.length > cap };
}

module.exports = { outputProtected, getProtectedUtxos, BASE };
