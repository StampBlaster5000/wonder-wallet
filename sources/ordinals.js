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
  let val = false;
  try {
    const o = await fetchJson(`${BASE}/output/${utxo}`, { timeout: 6000 });
    const inscr = Array.isArray(o.inscriptions) ? o.inscriptions.length : 0;
    const runes = o.runes && Object.keys(o.runes).length ? Object.keys(o.runes).length : 0;
    val = inscr > 0 || runes > 0;
  } catch (_) { val = false; } // not-found / non-JSON ⇒ treat as no inscription
  cacheSet(key, val, 300_000);
  return val;
}

/**
 * Scan a list of utxos for inscriptions (capped + concurrency-limited to stay
 * friendly to the public ord server and the host watchdog).
 */
async function getProtectedUtxos(utxos, { cap = 25 } = {}) {
  const scanned = utxos.slice(0, cap);
  const flags = await pool(scanned, (u) => outputProtected(`${u.txid}:${u.vout}`), 4);
  const protectedSet = new Set();
  scanned.forEach((u, i) => { if (flags[i] === true) protectedSet.add(`${u.txid}:${u.vout}`); });
  return { protectedSet, scannedCount: scanned.length, capped: utxos.length > cap };
}

module.exports = { outputProtected, getProtectedUtxos, BASE };
