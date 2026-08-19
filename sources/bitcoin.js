/** Bitcoin data via mempool.space / Esplora-compatible REST (Phase 0 §2). */
'use strict';

const { fetchJson, cacheGet, cacheSet } = require('./http');
const netctx = require('./netctx');

// Esplora-compatible REST. Testnet uses mempool.space's testnet4 instance (same routes).
const BASES = {
  mainnet: process.env.BTC_API || 'https://mempool.space/api',
  testnet: process.env.BTC_API_TESTNET || 'https://mempool.space/testnet4/api',
};
const base = () => BASES[netctx.current()] || BASES.mainnet;

async function getAddress(address) {
  const key = `btc:addr:${address}`;
  const hit = cacheGet(key);
  if (hit) return hit;
  const [info, utxos] = await Promise.all([
    fetchJson(`${base()}/address/${address}`),
    fetchJson(`${base()}/address/${address}/utxo`),
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
  const h = await fetchJson(`${base()}/blocks/tip/height`);
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
    fetchJson(`${base()}/v1/fees/recommended`).catch(() => null),
    fetchJson(`${base()}/v1/fees/mempool-blocks`).catch(() => null),
  ]);
  // WW-C07: NEVER pass upstream fee fields through untyped — a compromised/custom reader could return a
  // string (e.g. an HTML/iframe payload) that later reaches an innerHTML sink in a view. Coerce every tier
  // to a finite sat/vB within a defensible range; anything else falls back to a safe default. Only
  // sanitized numbers leave this boundary, so the markup sinks downstream can never receive a payload.
  const san = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 && n <= 1e6 ? n : d; };
  const raw = rec || {};
  const fees = {
    fastestFee: san(raw.fastestFee, 1), halfHourFee: san(raw.halfHourFee, 1),
    hourFee: san(raw.hourFee, 1), economyFee: san(raw.economyFee, 1), minimumFee: san(raw.minimumFee, 1),
  };
  const mf = Array.isArray(blocks) && blocks[0] ? Number(blocks[0].medianFee) : NaN;
  const nb = Number.isFinite(mf) && mf > 0 ? mf : null;
  if (nb != null && nb < 1 && fees.fastestFee <= 1) {
    const r1 = (n) => Math.max(0.1, Math.round(n * 10) / 10);
    const low = r1(nb);                    // next-block floor everyone's paying (e.g. 0.4)
    fees.fastestFee = 1;                    // high: guarantees next block + clears the 1 s/vB relay floor
    fees.halfHourFee = r1((low + 1) / 2);   // medium: midpoint (e.g. 0.7)
    fees.hourFee = low;                     // low priority (e.g. 0.4)
    fees.economyFee = low;
    fees.minimumFee = Math.min(fees.minimumFee, low);
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
  const r = await fetch(`${base()}/tx/${txid}/hex`, { headers: { Accept: 'text/plain' } });
  if (!r.ok) { const e = new Error('tx_not_found'); e.status = 404; throw e; }
  const raw = (await r.text()).trim();
  if (!/^[0-9a-fA-F]+$/.test(raw)) throw new Error('bad_tx_hex');
  cacheSet(key, raw, 600_000); // prev txs are immutable — cache long
  return raw;
}

// Decoded tx: inputs (with prevout values + addresses) + outputs + fee/vsize/status. Used by the
// RBF fee-bump flow, which needs the original inputs' values and the recipient output to safely
// reconstruct a higher-fee replacement.
async function getTxInfo(txid) {
  const key = `btc:txinfo:${txid}`;
  const hit = cacheGet(key);
  if (hit) return hit;
  const r = await fetch(`${base()}/tx/${txid}`, { headers: { Accept: 'application/json' } });
  if (!r.ok) { const e = new Error('tx_not_found'); e.status = 404; throw e; }
  const t = await r.json();
  const out = {
    txid: t.txid,
    vin: (t.vin || []).map((v) => ({ txid: v.txid, vout: v.vout, value: (v.prevout && v.prevout.value) || 0, address: (v.prevout && v.prevout.scriptpubkey_address) || null })),
    vout: (t.vout || []).map((o) => ({ address: o.scriptpubkey_address || null, value: o.value || 0 })),
    fee: t.fee || 0,
    vsize: Math.ceil((t.weight || 0) / 4),
    confirmed: !!(t.status && t.status.confirmed),
    rbf: (t.vin || []).some((v) => (v.sequence != null ? v.sequence : 0xffffffff) < 0xfffffffe), // BIP-125 opt-in
  };
  cacheSet(key, out, 20_000); // short — an unconfirmed tx can confirm or get replaced
  return out;
}

module.exports = { getAddress, getFees, getTipHeight, getRawTx, getTxInfo, base, get BASE() { return base(); } };
