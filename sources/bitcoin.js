/** Bitcoin data via mempool.space / Esplora-compatible REST (Phase 0 §2). */
'use strict';

const { fetchJson, cacheGet, cacheSet } = require('./http');

const BASE = process.env.BTC_API || 'https://mempool.space/api';

async function getAddress(address) {
  const key = `btc:addr:${address}`;
  const hit = cacheGet(key);
  if (hit) return hit;
  const [info, utxos] = await Promise.all([
    fetchJson(`${BASE}/address/${address}`),
    fetchJson(`${BASE}/address/${address}/utxo`),
  ]);
  const cs = info.chain_stats || {};
  const ms = info.mempool_stats || {};
  const balanceSats = (cs.funded_txo_sum || 0) - (cs.spent_txo_sum || 0) + ((ms.funded_txo_sum || 0) - (ms.spent_txo_sum || 0));
  const out = {
    address,
    balanceSats,
    txCount: cs.tx_count || 0,
    utxos: (utxos || []).map((u) => ({
      txid: u.txid,
      vout: u.vout,
      value: u.value,
      confirmed: !!u.status?.confirmed,
      blockHeight: u.status?.block_height || null,
    })),
  };
  cacheSet(key, out, 30_000);
  return out;
}

async function getTipHeight() {
  const key = 'btc:tip';
  const hit = cacheGet(key);
  if (hit) return hit;
  const h = await fetchJson(`${BASE}/blocks/tip/height`);
  cacheSet(key, h, 30_000);
  return h;
}

async function getFees() {
  const key = 'btc:fees';
  const hit = cacheGet(key);
  if (hit) return hit;
  // `/v1/fees/recommended` is the primary source, but it CLAMPS every tier to a 1 sat/vB floor —
  // so a near-empty mempool reads a flat 1/1/1 with no cheap option. When that happens, derive
  // finer sub-1 tiers from the projected mempool blocks (the same data mempool.space's site shows)
  // so the presets stay useful for patient, low-fee sends. Busy-mempool behavior is unchanged.
  const [rec, blocks] = await Promise.all([
    fetchJson(`${BASE}/v1/fees/recommended`).catch(() => null),
    fetchJson(`${BASE}/v1/fees/mempool-blocks`).catch(() => null),
  ]);
  const fees = rec || { fastestFee: 1, halfHourFee: 1, hourFee: 1, economyFee: 1, minimumFee: 1 };
  const nb = Array.isArray(blocks) && blocks[0] && blocks[0].medianFee > 0 ? blocks[0].medianFee : null;
  if (nb != null && nb < 1 && (fees.fastestFee || 1) <= 1) {
    const r1 = (n) => Math.max(0.1, Math.round(n * 10) / 10);
    const low = r1(nb);                    // next-block floor everyone's paying (e.g. 0.4)
    fees.fastestFee = 1;                    // high: guarantees next block + clears the 1 s/vB relay floor
    fees.halfHourFee = r1((low + 1) / 2);   // medium: midpoint (e.g. 0.7)
    fees.hourFee = low;                     // low priority (e.g. 0.4)
    fees.economyFee = low;
    fees.minimumFee = Math.min(fees.minimumFee || 1, low);
    fees.source = 'projected';              // flag: sub-1 tiers derived from projected mempool blocks
  }
  cacheSet(key, fees, 30_000);
  return fees;
}

// Raw previous-transaction hex — needed as `nonWitnessUtxo` to sign a LEGACY (P2PKH) input.
async function getRawTx(txid) {
  const key = `btc:rawtx:${txid}`;
  const hit = cacheGet(key);
  if (hit) return hit;
  const r = await fetch(`${BASE}/tx/${txid}/hex`, { headers: { Accept: 'text/plain' } });
  if (!r.ok) { const e = new Error('tx_not_found'); e.status = 404; throw e; }
  const raw = (await r.text()).trim();
  if (!/^[0-9a-fA-F]+$/.test(raw)) throw new Error('bad_tx_hex');
  cacheSet(key, raw, 600_000); // prev txs are immutable — cache long
  return raw;
}

module.exports = { getAddress, getFees, getTipHeight, getRawTx, BASE };
