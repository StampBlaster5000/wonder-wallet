/** Counterparty Core API v2 (Phase 0 §1). Open, no key, 1000-row cap. */
'use strict';

const { fetchJson, cacheGet, cacheSet } = require('./http');
const netctx = require('./netctx');

// Counterparty Core API v2. Testnet uses the public testnet4 node (verified synced,
// v11.x) — full issuance / sends / dispensers / DEX + classic-stamp issuance.
const BASES = {
  mainnet: process.env.CP_API || 'https://api.counterparty.io:4000/v2',
  testnet: process.env.CP_API_TESTNET || 'https://testnet4.counterparty.io:44000/v2',
};
const base = () => BASES[netctx.current()] || BASES.mainnet;

/** All Counterparty asset balances held by an address (address- or utxo-bound). */
async function getAddressAssets(address) {
  const key = `cp:assets:${address}`;
  const hit = cacheGet(key);
  if (hit) return hit;
  const data = await fetchJson(`${base()}/addresses/${address}/balances?limit=500&verbose=true`);
  const rows = (data.result || []).filter((r) => Number(r.quantity) > 0);
  const out = rows.map((r) => ({
    asset: r.asset,
    name: r.asset_longname || r.asset,
    quantity: Number(r.quantity), // raw (kept for compatibility)
    qtyNormalized: r.quantity_normalized != null ? String(r.quantity_normalized) : String(r.quantity), // human amount
    divisible: !!(r.asset_info && r.asset_info.divisible),
    utxo: r.utxo || null, // non-null ⇒ asset is bound to a specific UTXO (must protect it)
  }));
  cacheSet(key, out, 30_000);
  return out;
}

/** Address-held CP assets for pickers (Destroy/etc.) — normalized balance + divisibility.
 *  Excludes UTXO-bound balances (those must be detached before they can be acted on here). */
async function getHoldings(address) {
  const key = `cp:hold:${address}`;
  const hit = cacheGet(key);
  if (hit) return hit;
  const data = await fetchJson(`${base()}/addresses/${address}/balances?limit=500&verbose=true`);
  const rows = (data.result || []).filter((r) => !r.utxo && Number(r.quantity) > 0);
  const out = rows.map((r) => ({
    asset: r.asset,
    name: r.asset_longname || r.asset,
    qty: r.quantity_normalized != null ? String(r.quantity_normalized) : String(r.quantity),
    divisible: !!(r.asset_info && r.asset_info.divisible),
  }));
  cacheSet(key, out, 30_000);
  return out;
}

/** Assets an address currently OWNS (is issuer/controller of) — the set it can issue-more,
 *  lock, transfer, re-describe, or create subassets under. `/addresses/{a}/assets` returns
 *  only rows where owner == the address. */
async function getOwnedAssets(address) {
  const key = `cp:owned:${address}`;
  const hit = cacheGet(key);
  if (hit) return hit;
  const data = await fetchJson(`${base()}/addresses/${address}/assets?limit=500&verbose=true`);
  const out = (data.result || []).map((r) => ({
    asset: r.asset,
    name: r.asset_longname || r.asset,
    divisible: !!r.divisible,
    locked: !!r.locked,
  }));
  cacheSet(key, out, 30_000);
  return out;
}

/** Lightweight asset-name check: is this name registered, and who owns it?
 *  CP returns {result:null, error:'Not found'} for available names. */
async function checkAssetName(name) {
  const key = `cp:name:${name}`;
  const hit = cacheGet(key);
  if (hit) return hit;
  let out = { exists: false };
  try {
    const data = await fetchJson(`${base()}/assets/${encodeURIComponent(name)}?verbose=true`);
    const a = data && data.result;
    if (a && a.asset) out = { exists: true, owner: a.owner, issuer: a.issuer, divisible: !!a.divisible, locked: !!a.locked, longname: a.asset_longname || null };
  } catch (_) {}
  cacheSet(key, out, 30_000);
  return out;
}

/** Asset intelligence: supply, divisibility, lock state, issuer, description, mime. */
async function getAsset(asset) {
  const key = `cp:asset:${asset}`;
  const hit = cacheGet(key);
  if (hit) return hit;
  const data = await fetchJson(`${base()}/assets/${encodeURIComponent(asset)}`);
  const a = data.result || data;
  const out = {
    asset: a.asset,
    name: a.asset_longname || a.asset,
    issuer: a.issuer,
    owner: a.owner,
    divisible: !!a.divisible,
    locked: !!a.locked,
    supply: Number(a.supply),
    description: a.description || '',
    mimeType: a.mime_type || null,
    firstIssuance: a.first_issuance_block_index || null,
  };
  cacheSet(key, out, 120_000);
  return out;
}

/**
 * Batched per-UTXO Counterparty check — the asset-aware scan input.
 * `withbalances?utxos=a,b,c` returns `{result: {"txid:vout": true|false}}`.
 * Returns a Set of "txid:vout" that carry a Counterparty balance.
 */
async function getProtectedUtxos(utxos) {
  const keys = utxos.map((u) => `${u.txid}:${u.vout}`);
  const protectedSet = new Set();
  const checkedSet = new Set(); // only UTXOs whose chunk fetch SUCCEEDED (positively cleared-able)
  for (let i = 0; i < keys.length; i += 50) {
    const chunk = keys.slice(i, i + 50);
    try {
      const data = await fetchJson(`${base()}/utxos/withbalances?utxos=${encodeURIComponent(chunk.join(','))}`);
      // WW-B05: a partial/empty/malformed map must NOT silently clear the omitted UTXOs. Only a key that
      // came back as an OWN property with a STRICT boolean is "known"; anything missing or non-boolean
      // stays UNKNOWN (classified never-spendable), so a hiccup can't make an asset UTXO look asset-free.
      const map = (data && data.result && typeof data.result === 'object' && !Array.isArray(data.result)) ? data.result : {};
      for (const k of chunk) {
        if (!Object.prototype.hasOwnProperty.call(map, k) || typeof map[k] !== 'boolean') continue; // leave UNKNOWN
        checkedSet.add(k); // this UTXO's CP status is now genuinely KNOWN
        if (map[k] === true) protectedSet.add(k);
      }
    } catch (_) {
      // SECURITY (audit C1): a failed/timed-out chunk must NOT silently clear these
      // UTXOs — leaving them out of checkedSet makes the classifier treat them as
      // `unknown` (never `spendable`), so an API hiccup can't cause an asset-burn.
    }
  }
  return { protectedSet, checkedSet };
}

/** Which Counterparty assets sit on a specific UTXO (for protected-UTXO detail). */
async function getUtxoAssets(utxo) {
  const key = `cp:utxo:${utxo}`;
  const hit = cacheGet(key);
  if (hit) return hit;
  const data = await fetchJson(`${base()}/utxos/${utxo}/balances`);
  const out = (data.result || []).map((r) => ({ asset: r.asset, name: r.asset_longname || r.asset, quantity: Number(r.quantity) }));
  cacheSet(key, out, 60_000);
  return out;
}

module.exports = { getAddressAssets, getHoldings, getOwnedAssets, checkAssetName, getAsset, getProtectedUtxos, getUtxoAssets, base, get BASE() { return base(); } };
