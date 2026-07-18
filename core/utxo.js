/**
 * Wonder Wallet — portable core: asset-aware UTXO classification.
 *
 * The killer differentiator (SPEC §8). Two distinct safety layers:
 *   1. Asset-aware lock (PRIMARY) — never auto-select a UTXO that *carries*
 *      anything (Counterparty-bound asset, Stamp, inscription, or a UTXO
 *      committed to an open PSBT listing), REGARDLESS of value.
 *   2. Value floor (SECONDARY) — don't auto-select tiny outputs.
 *
 * Phase 1 implements the value-floor layer + the data shape. The asset-aware
 * layer (the union of Counterparty / Ordinals / Stamps indexers — see
 * PHASE0-API-MAP.md §2) lands in Phase 2/4; until then `protected` UTXOs are
 * surfaced as "unknown — pending asset-aware scan" rather than silently
 * treated as spendable.
 */

'use strict';

// Output-type-aware dust limits (sats) — Phase 0 §2.
const DUST = {
  p2pkh: 546, // legacy
  p2wpkh: 294, // native segwit / taproot reuse this
  generic: 500, // Wonder Wallet's default generic SegWit-era safety floor
};

// Reasons a UTXO is "protected" (must not be auto-spent). Phase 2/4 populates these.
const PROTECT_REASONS = {
  COUNTERPARTY: 'counterparty-bound',
  INSCRIPTION: 'inscription',
  STAMP: 'stamp',
  OPEN_LISTING: 'open-psbt-listing',
  USER_FROZEN: 'user-frozen',
  TIMELOCKED: 'user-timelock',
};

/**
 * Classify a flat list of UTXOs into spendable / dust / protected buckets.
 * @param {Array<{txid:string, vout:number, value:number}>} utxos  value in sats
 * @param {object} [opts]
 * @param {number} [opts.floor=DUST.generic]  value floor in sats
 * @param {Set<string>} [opts.protectedSet]   set of "txid:vout" known to carry assets (Phase 2+)
 * @param {boolean} [opts.assetScanReady=false] whether the asset-aware scan has run
 */
function classifyUtxos(utxos, opts = {}) {
  const floor = opts.floor ?? DUST.generic;
  const protectedSet = opts.protectedSet ?? new Set();
  const assetScanReady = opts.assetScanReady ?? false;

  const buckets = { spendable: [], dust: [], protected: [], unknown: [] };

  for (const u of utxos) {
    const key = `${u.txid}:${u.vout}`;
    if (protectedSet.has(key)) {
      buckets.protected.push(u);
    } else if (!assetScanReady) {
      // Honest state: we cannot yet prove this UTXO is asset-free.
      buckets.unknown.push(u);
    } else if (u.value < floor) {
      buckets.dust.push(u);
    } else {
      buckets.spendable.push(u);
    }
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
    buckets,
    assetScanReady,
    floor,
  };
}

module.exports = { DUST, PROTECT_REASONS, classifyUtxos };
