/** USD price feed via CoinGecko (Phase 0 §9). Cached 60s. */
'use strict';

const { fetchJson, cacheGet, cacheSet } = require('./http');

const BASE = process.env.PRICE_API || 'https://api.coingecko.com/api/v3';
const IDS = { bitcoin: 'BTC', ethereum: 'ETH', solana: 'SOL', counterparty: 'XCP' };

async function getPrices() {
  const key = 'prices';
  const hit = cacheGet(key);
  if (hit) return hit;
  let out = { bitcoin: null, ethereum: null, solana: null, counterparty: null };
  try {
    const data = await fetchJson(`${BASE}/simple/price?ids=${Object.keys(IDS).join(',')}&vs_currencies=usd`);
    out = {
      bitcoin: data.bitcoin?.usd ?? null,
      ethereum: data.ethereum?.usd ?? null,
      solana: data.solana?.usd ?? null,
      counterparty: data.counterparty?.usd ?? null,
    };
  } catch (_) { /* non-fatal */ }
  cacheSet(key, out, 60_000);
  return out;
}

module.exports = { getPrices };
