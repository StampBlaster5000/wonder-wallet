/** Bitcoin Stamps + SRC-20 via stampchain.io (Phase 0 §3). Open, no key needed. */
'use strict';

const { fetchJson, cacheGet, cacheSet } = require('./http');

const BASE = process.env.STAMPS_API || 'https://stampchain.io/api/v2';

// SRC-20 emoji ticks are returned as literal escape strings (e.g. "\U0001f47d").
// Decode \U + 8 hex (astral) and \u + 4 hex (BMP) into the real characters.
function decodeTick(t) {
  if (typeof t !== 'string') return t;
  return t
    .replace(/\\U([0-9a-fA-F]{8})/g, (m, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch (_) { return m; } })
    .replace(/\\u([0-9a-fA-F]{4})/g, (m, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch (_) { return m; } });
}

// Format a SRC-20 amount string (can exceed Number precision) — strip trailing
// zeros and add thousands separators without losing precision.
function fmtSrc20(a) {
  let s = String(a == null ? '' : a).trim();
  if (!s) return null;
  if (s.includes('.')) s = s.replace(/\.?0+$/, '');
  const [i, f] = s.split('.');
  const grouped = (i || '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return f ? `${grouped}.${f}` : grouped;
}

/** Combined stamp + SRC-20 holdings for an address. Stamps and SRC-20 are fetched from the granular
    /stamps/balance + /src20/balance endpoints (not the flaky aggregate /balance/:addr), and — crucially —
    cached INDEPENDENTLY with a "serve last-good on failure" fallback.

    Why the fallback matters: the UI classifies which Counterparty assets are stamps purely from this
    stamps list. If a transient stampchain hiccup returned an EMPTY stamps list, those stamps' CP asset
    ids would leak into the Tokens tab and the Collectibles gallery would go blank. Serving the last
    successful snapshot on a live failure keeps that classification stable through stampchain outages. */
async function getBalance(address) {
  const [stamps, src20] = await Promise.all([_stampsBal(address), _src20Bal(address)]);
  return { stamps, src20, btcBalance: null };
}
async function _stampsBal(address) {
  const fresh = `st:stamps:${address}`, lastGood = `st:stampsLG:${address}`;
  const hit = cacheGet(fresh);
  if (hit) return hit;
  let res = null; try { res = await fetchJson(`${BASE}/stamps/balance/${address}?limit=500`); } catch (_) {}
  // WW-C13: a malformed 200 body (no documented `data` array — e.g. {} or an error envelope) must follow
  // the FAILURE path and return last-good; it must NOT be treated as an empty dataset that overwrites the
  // last-good snapshot and blanks the gallery. A genuine empty result ({data:[]}) IS a valid array → cached.
  if (!res || !Array.isArray(res.data)) return cacheGet(lastGood) || [];
  // /stamps/balance → { data: [{ stamp, cpid, balance, stamp_url, stamp_mimetype, … }] }
  const stamps = res.data.map((s) => ({
    stamp: s.stamp,
    cpid: s.cpid,
    quantity: Number(s.balance ?? s.quantity ?? 1), // held qty lives in `balance` on this endpoint
    art: s.stamp_url || null,
    mime: s.stamp_mimetype || null,
  }));
  cacheSet(fresh, stamps, 30_000);         // fresh window
  cacheSet(lastGood, stamps, 1_800_000);   // last-good fallback, 30 min — refreshed on every success
  return stamps;
}
async function _src20Bal(address) {
  const fresh = `st:src20:${address}`, lastGood = `st:src20LG:${address}`;
  const hit = cacheGet(fresh);
  if (hit) return hit;
  let res = null; try { res = await fetchJson(`${BASE}/src20/balance/${address}?limit=500`); } catch (_) {}
  if (!res || !Array.isArray(res.data)) return cacheGet(lastGood) || []; // WW-C13: malformed → last-good, never overwrite
  // /src20/balance → { data: [{ tick, amt, deploy_img, … }] } (flat). Keep the group-wrapped fallback for safety.
  const raw = res.data.flatMap((x) => (x && Array.isArray(x.data) ? x.data : [x]));
  const src20 = raw.filter((t) => t && t.tick).map((t) => ({
    tick: decodeTick(t.tick),
    amount: fmtSrc20(t.amt ?? t.amount ?? t.balance),
    img: t.deploy_img || null, // token cover image (named tokens); emoji ticks have none
  }));
  cacheSet(fresh, src20, 30_000);
  cacheSet(lastGood, src20, 1_800_000);
  return src20;
}

/** Stamp detail (incl. the served art URL). */
async function getStamp(id) {
  const key = `st:stamp:${id}`;
  const hit = cacheGet(key);
  if (hit) return hit;
  const data = await fetchJson(`${BASE}/stamps/${encodeURIComponent(id)}`);
  // Detail shape: {data:{stamp:{…}}}; list shape: {data:[{…}]}.
  const s = data?.data?.stamp || (Array.isArray(data?.data) ? data.data[0] : data?.data) || data;
  const out = {
    stamp: s.stamp,
    cpid: s.cpid,
    creator: s.creator_name || s.creator,
    supply: Number(s.supply),
    locked: !!s.locked,
    divisible: !!s.divisible,
    art: s.stamp_url || null,
    mime: s.stamp_mimetype || null,
    fileSize: s.file_size_bytes || null,
    blockTime: s.block_time || null,
  };
  cacheSet(key, out, 120_000);
  return out;
}

/** SRC-20 deploy/mint status for a ticker. `mint_status` present ⇒ the tick is deployed
 *  (taken); absent ⇒ available. Computes mints-remaining from supply ÷ per-mint limit. */
async function getSrc20Tick(tick) {
  const key = `st:tick:${String(tick).toLowerCase()}`;
  const hit = cacheGet(key);
  if (hit) return hit;
  let out = { deployed: false };
  try {
    const d = await fetchJson(`${BASE}/src20/tick/${encodeURIComponent(tick)}`);
    const m = d && d.mint_status;
    // stampchain returns a ZEROED mint_status for AVAILABLE tickers (not null) — the real
    // signal that a tick is deployed is the presence of its deploy tx_hash (and a supply).
    if (m && m.tx_hash && Number(m.max_supply) > 0) {
      const max = Number(m.max_supply), minted = Number(m.total_minted), lim = Number(m.limit);
      const mintsLeft = (lim > 0 && Number.isFinite(max) && Number.isFinite(minted)) ? Math.max(0, Math.floor((max - minted) / lim)) : null;
      out = {
        deployed: true,
        max_supply: m.max_supply, total_minted: m.total_minted, limit: m.limit,
        total_mints: m.total_mints, decimals: m.decimals,
        progress: Number(m.progress),
        mints_left: mintsLeft,
        complete: Number(m.progress) >= 100 || mintsLeft === 0,
      };
    }
  } catch (_) {}
  cacheSet(key, out, 60_000);
  return out;
}

// ── Minting compose (Phase 12 first-party modules) — return an unsigned PSBT (hex) ──
async function postStamp(pathname, body, timeout = 25000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(`${BASE}/${pathname}`, {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.status === 'error') return { error: j.error || j.message || `stampchain ${r.status}` };
    return j;
  } finally { clearTimeout(t); }
}
const src20Create = (body) => postStamp('src20/create', body, 25000);   // op: deploy|mint|transfer
const olgaMint = (body) => postStamp('olga/mint', body, 30000);          // stamp art
const olgaEstimate = (body) => postStamp('olga/estimate', body, 20000);  // stamp fee preview
// SRC-101 compose (deploy/mint/transfer/setrecord/renew) — wired & ready. NOTE (2026-07-08):
// stampchain's src101/create currently rejects its own documented request shapes upstream, so the
// in-wallet minting suite falls back to a bitname.pro deep-link until the endpoint is fixed.
const src101Create = (body) => postStamp('src101/create', body, 25000);

// ── SRC-101 (Bitcoin Stamps naming — "Bitname" `.btc`) — READ layer (resolution + holdings) ──
// The canonical `.btc` namespace deploy (root=btc, ~1,950 names). Verified live 2026-07-08;
// the three sibling BitNameService deploys are empty. Names are base64(utf8) in the API.
const SRC101_BTC_DEPLOY = process.env.SRC101_DEPLOY || '77fb147b72a551cf1e2f0b37dccf9982a1c25623a7fe8b4d5efaac566cf63fed';
const b64name = (n) => Buffer.from(String(n), 'utf8').toString('base64');
// stampchain's SRC-101 name route requires the LITERAL base64 tokenid — it rejects percent-encoded
// padding (`%3D`), so names whose base64 ends in `=`/`==` (hydro, elon, solar…) 404 if encoded.
// `+` and `=` are legal raw in a URL path segment (RFC 3986); only `/` must be escaped.
const b64path = (n) => b64name(n).replace(/\//g, '%2F');
const normSrc101 = (name) => String(name || '').trim().toLowerCase().replace(/\.btc$/i, '');
// A user-entered token that looks like a name to resolve (e.g. "satoshi.btc").
const isSrc101Name = (s) => /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?\.btc$/i.test(String(s || '').trim());

/** Resolve a `.btc` name → the address to send to. Prefers the name's on-chain `address` record,
 *  falls back to the current owner. `exists:false` when unregistered; `expired:true` past expiry. */
async function resolveSrc101(name, deploy = SRC101_BTC_DEPLOY) {
  const bare = normSrc101(name);
  if (!bare) return { name, exists: false };
  const key = `src101:res:${deploy}:${bare}`;
  const hit = cacheGet(key); if (hit) return hit;
  let out = { name: bare + '.btc', bare, exists: false, address: null, owner: null, expired: false, deploy };
  try {
    const data = await fetchJson(`${BASE}/src101/${deploy}/${b64path(bare)}`);
    const r = (data && Array.isArray(data.data)) ? data.data[0] : (data && data.data) || null;
    if (r && (r.owner || r.address_btc)) {
      const now = Math.floor(Date.now() / 1000);
      const exp = Number(r.expire_timestamp) || 0;
      const expired = exp > 0 && exp < now;
      out = {
        name: (r.tokenid_utf8 || bare) + '.btc', bare, deploy,
        exists: !expired, expired,
        address: r.address_btc || r.owner || null, // send target: prefer the record, else owner
        owner: r.owner || null,
        img: r.img || null,
        expire: exp || null,
      };
    }
  } catch (_) {}
  cacheSet(key, out, 60_000);
  return out;
}

/** All `.btc` names an address holds (for the "Names" collectible group). */
async function getSrc101Names(address, deploy = SRC101_BTC_DEPLOY) {
  const key = `src101:bal:${address}`;
  const hit = cacheGet(key); if (hit) return hit;
  let out = [];
  try {
    const data = await fetchJson(`${BASE}/src101/balance/${encodeURIComponent(address)}?limit=500`);
    const rows = (data && Array.isArray(data.data)) ? data.data : [];
    const now = Math.floor(Date.now() / 1000);
    out = rows.filter((r) => r && r.tokenid_utf8).map((r) => ({
      name: r.tokenid_utf8 + '.btc',
      tokenidUtf8: r.tokenid_utf8,
      deploy: r.deploy_hash || deploy,
      img: r.img || null,
      primary: !!r.prim,
      expire: Number(r.expire_timestamp) || null,
      expired: !!(Number(r.expire_timestamp) && Number(r.expire_timestamp) < now),
      addressRecord: r.address_btc || null,
    }));
  } catch (_) {}
  cacheSet(key, out, 30_000);
  return out;
}

/** Reverse resolution — an address's PRIMARY `.btc` name (for "you = satoshi.btc"). */
async function getSrc101Primary(address) {
  const names = await getSrc101Names(address);
  const live = names.filter((n) => !n.expired);
  const p = live.find((n) => n.primary) || live[0];
  return p ? p.name : null;
}

/**
 * SRC-20 DRY RUN (Testnet Mode). There is no reliable public testnet Stamps/SRC-20 indexer,
 * so on testnet we do NOT broadcast — we locally construct the exact SRC-20 inscription the
 * transaction would carry and estimate its cost, returning NO broadcastable hex. This lets a
 * builder test the *construction* path (the easy-to-get-wrong part) at zero risk. Pure function.
 */
function src20DryRun(params, feeRate) {
  const p = params || {};
  const op = String(p.op || '').toLowerCase();
  const json = { p: 'src-20', op };
  if (p.tick) json.tick = String(p.tick).toUpperCase();
  if (op === 'deploy') { json.max = String(p.max); json.lim = String(p.lim); if (p.dec != null && p.dec !== '') json.dec = String(p.dec); }
  else if (op === 'mint' || op === 'transfer') { json.amt = String(p.amt); }
  const payload = JSON.stringify(json);
  // Modern SRC-20 (post-block 796,000) encodes "stamp:"+JSON directly onto BTC, length-prefixed and
  // chunked into 32-byte P2WSH "data" outputs (OLGA). Estimate outputs, dust and miner fee from that.
  const data = 'stamp:' + payload;
  const bytes = Buffer.byteLength(data, 'utf8');
  const dataOutputs = Math.ceil((bytes + 2) / 32);         // 2-byte length prefix + 32B per P2WSH output
  const DUST = 330;                                         // P2WSH dust floor
  const estDust = dataOutputs * DUST;
  const estVsize = Math.ceil(10 + 68 + (dataOutputs + 1) * 43); // ~1 input + N P2WSH + 1 change
  const rate = Math.max(1, Number(feeRate) || 10);
  const estMinerFee = Math.ceil(estVsize * rate);
  return {
    dryRun: true, op, json, payload,
    encoding: 'SRC-20 · OLGA (P2WSH data outputs)',
    bytes, dataOutputs,
    est_dust_value: estDust, est_tx_size: estVsize, est_miner_fee: estMinerFee, total_cost: estDust + estMinerFee,
    note: 'Testnet dry run — the transaction is constructed and priced locally but NOT broadcast (no public testnet SRC-20 indexer exists).',
  };
}

module.exports = {
  getBalance, getStamp, getSrc20Tick, src20Create, olgaMint, olgaEstimate, src20DryRun, BASE,
  src101Create, resolveSrc101, getSrc101Names, getSrc101Primary, isSrc101Name, normSrc101, SRC101_BTC_DEPLOY,
};
