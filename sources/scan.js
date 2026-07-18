/**
 * Asset-aware UTXO scan — the killer differentiator (SPEC §8).
 * Unions the Counterparty per-UTXO check (full coverage) with an Ordinals
 * inscription check (capped + concurrency-limited). A UTXO is only ever called
 * "spendable" when BOTH sources cleared it AND it's above the value floor.
 * Anything the ordinals pass couldn't reach stays "unknown" — never presumed safe.
 */
'use strict';

const core = require('../core');
const cp = require('./counterparty');
const ord = require('./ordinals');

/** Shared classifier: returns per-UTXO {category, reasons} + the raw protection sets. */
async function classify(utxos) {
  const floor = core.DUST.generic;
  const [cpRes, ordRes] = await Promise.all([
    cp.getProtectedUtxos(utxos).catch(() => ({ protectedSet: new Set(), checkedSet: new Set() })),
    ord.getProtectedUtxos(utxos).catch(() => ({ protectedSet: new Set(), scannedCount: 0, capped: utxos.length > 0 })),
  ]);
  const cpSet = cpRes.protectedSet;
  const cpChecked = cpRes.checkedSet; // CP status positively known
  const ordSet = ordRes.protectedSet;
  const ordScannedKeys = new Set(utxos.slice(0, ordRes.scannedCount).map((u) => `${u.txid}:${u.vout}`));

  const perUtxo = {};
  for (const u of utxos) {
    const k = `${u.txid}:${u.vout}`;
    const reasons = [];
    if (cpSet.has(k)) reasons.push(core.PROTECT_REASONS.COUNTERPARTY);
    if (ordSet.has(k)) reasons.push(core.PROTECT_REASONS.INSCRIPTION);
    let category;
    if (reasons.length) category = 'protected';
    // SECURITY (audit C1/C2): only `spendable` when BOTH sources POSITIVELY cleared
    // this UTXO. A UTXO not confirmed CP-clear (fetch failed) or not reached by the
    // ordinals scan stays `unknown` — never presumed safe.
    else if (!cpChecked.has(k) || !ordScannedKeys.has(k)) category = 'unknown';
    else if (u.value < floor) category = 'dust';
    else category = 'spendable';
    perUtxo[k] = { category, reasons };
  }
  return { perUtxo, cpSet, cpChecked, ordSet, ordRes, floor };
}

async function scanAddress(address, utxos) {
  const { perUtxo, cpChecked, ordRes, floor } = await classify(utxos);
  const buckets = { spendable: [], dust: [], protected: [], unknown: [] };
  const protectedDetail = [];
  for (const u of utxos) {
    const k = `${u.txid}:${u.vout}`;
    const c = perUtxo[k];
    buckets[c.category].push(u);
    if (c.category === 'protected') protectedDetail.push({ utxo: k, value: u.value, reasons: c.reasons });
  }
  const sum = (arr) => arr.reduce((a, u) => a + u.value, 0);
  return {
    counts: {
      total: utxos.length,
      spendable: buckets.spendable.length,
      dust: buckets.dust.length,
      protected: buckets.protected.length,
      unknown: buckets.unknown.length,
    },
    sats: {
      total: sum(utxos),
      spendable: sum(buckets.spendable),
      dust: sum(buckets.dust),
      protected: sum(buckets.protected),
      unknown: sum(buckets.unknown),
    },
    protectedDetail,
    scanMeta: {
      counterparty: cpChecked.size >= utxos.length ? 'full' : `${cpChecked.size}/${utxos.length}`,
      counterpartyComplete: cpChecked.size >= utxos.length,
      ordinalsScanned: ordRes.scannedCount,
      ordinalsCapped: ordRes.capped,
      total: utxos.length,
    },
    assetScanReady: true,
    floor,
  };
}

module.exports = { scanAddress, classify };
