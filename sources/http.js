/** Shared fetch + TTL cache + small concurrency helper for all data sources. */
'use strict';

const netctx = require('./netctx');

const cache = new Map();
// Cache keys are network-scoped so a testnet read can never serve a cached mainnet
// value (or vice-versa) for the same address / asset id / txid.
const nk = (key) => `${netctx.current()}|${key}`;
function cacheGet(key) {
  const k = nk(key);
  const hit = cache.get(k);
  if (hit && Date.now() < hit.exp) return hit.v;
  if (hit) cache.delete(k);
  return null;
}
function cacheSet(key, v, ttl = 30_000) {
  cache.set(nk(key), { v, exp: Date.now() + ttl });
  if (cache.size > 2000) cache.delete(cache.keys().next().value);
}

async function fetchJson(url, { timeout = 7000, method = 'GET', body, headers } = {}) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(url, {
      method,
      signal: ctrl.signal,
      headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) {
      const e = new Error(`upstream ${r.status} @ ${url}`);
      e.status = r.status;
      throw e;
    }
    return await r.json();
  } finally {
    clearTimeout(id);
  }
}

async function rpc(url, method, params, opts = {}) {
  const out = await fetchJson(url, { method: 'POST', body: { jsonrpc: '2.0', id: 1, method, params }, ...opts });
  if (out.error) {
    const e = new Error(out.error.message || 'rpc_error');
    e.rpc = out.error;
    throw e;
  }
  return out.result;
}

/** Run async tasks with a concurrency cap (keeps us friendly to public APIs + the watchdog). */
async function pool(items, worker, concurrency = 4) {
  const results = new Array(items.length);
  let i = 0;
  async function run() {
    while (i < items.length) {
      const idx = i++;
      try { results[idx] = await worker(items[idx], idx); }
      catch (e) { results[idx] = { __error: e.message }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}

module.exports = { fetchJson, rpc, pool, cacheGet, cacheSet };
