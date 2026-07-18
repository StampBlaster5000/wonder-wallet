/**
 * Wonder Wallet — Phase 2 server: multi-chain read layer + asset-aware UTXO scan.
 *
 * Architecture rule (platform + SPEC §14): the browser NEVER calls an external
 * API directly. Browser → this server (proxy · cache · validation) → open data
 * sources. All sources verified live in Phase 0 / start of Phase 2.
 */
'use strict';

const express = require('express');
const path = require('path');
const rateLimit = require('express-rate-limit');
const dns = require('dns').promises;
const netmod = require('net');
const core = require('./core');
const btc = require('./sources/bitcoin');
const cp = require('./sources/counterparty');
const stamps = require('./sources/stamps');
const eth = require('./sources/ethereum');
const sol = require('./sources/solana');
const prices = require('./sources/prices');
const scan = require('./sources/scan');
const activity = require('./sources/activity');
const emblem = require('./sources/emblem');

const app = express();
const PORT = process.env.PORT || 3000;
const VERSION = '0.31.0';
const PHASE = 'Beta';

// Stateless proxy — Wonder Wallet holds NO user data server-side. All user state
// (keys, watch-list, UTXO labels, settings) lives in the browser (localStorage / IndexedDB).

app.disable('x-powered-by');
// Behind the Emblem stateless proxy (single hop on localhost) — trust exactly one proxy so
// express-rate-limit can read the real client IP from X-Forwarded-For without throwing.
app.set('trust proxy', 1);
app.use(express.json({ limit: '512kb' })); // larger to carry base64 stamp-art on mint

// ── Security headers (Phase 10 hardened). NOTE: script-src has NO 'unsafe-inline' — all
// scripts are external files; this neutralizes the injected-event-handler XSS class. ──
app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'self'", "base-uri 'self'", "form-action 'self'", "object-src 'none'",
    ].join('; ')
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=(), payment=()');
  next();
});


// ── Address validation / chain detection ──
const RE = {
  bitcoin: /^(bc1[a-z0-9]{8,87}|[13][a-km-zA-HJ-NP-Z1-9]{25,39})$/,
  ethereum: /^0x[0-9a-fA-F]{40}$/,
  solana: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
  // Counterparty asset: BTC/XCP, a named asset (incl. subasset PARENT.child), or numeric A<int>.
  cpasset: /^(BTC|XCP|[A-Z]{1,12}(\.[a-zA-Z0-9.\-_@!]{1,24})?|A\d{17,20})$/,
  txid: /^[0-9a-fA-F]{64}$/,
};
function detectChain(v) {
  if (RE.bitcoin.test(v)) return 'bitcoin';
  if (RE.ethereum.test(v)) return 'ethereum';
  if (RE.solana.test(v)) return 'solana';
  return null;
}
// SECURITY (audit #6): never echo internal/upstream URLs in error responses.
const safeErr = (m) => String(m || '').replace(/https?:\/\/[^\s"']+/gi, '[upstream]').slice(0, 200);
const wrap = (fn) => (req, res) => fn(req, res).catch((e) => {
  const status = e.status === 400 ? 400 : 502;
  res.status(status).json({ error: status === 400 ? 'bad_request' : 'upstream_error', detail: safeErr(e.message) });
});

// ── Rate limiters (audit #4) — protect money/cost + outbound-proxy routes ──
const limitMoney = rateLimit({ windowMs: 60_000, max: 20, standardHeaders: true, legacyHeaders: false, message: { error: 'rate_limited' } });
const limitProxy = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false, message: { error: 'rate_limited' } });
// Media (stamp art + NFT/token covers): cached GETs, public images — a single portfolio
// view legitimately needs many. Generous cap; abuse is bounded by per-image size + caching.
const limitMedia = rateLimit({ windowMs: 60_000, max: 1200, standardHeaders: true, legacyHeaders: false, message: { error: 'rate_limited' } });

// ── SSRF-safe image fetch (audit #1/#2): https only, block private IPs, validate each
//    redirect hop, require image content-type, cap size. Used by both image proxies. ──
function isPrivateIp(ip) {
  if (netmod.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || a >= 224;
  }
  const x = String(ip).toLowerCase();
  return x === '::1' || x === '::' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe80') || x.startsWith('::ffff:127.') || x.startsWith('::ffff:10.') || x.startsWith('::ffff:192.168.') || x.startsWith('::ffff:169.254.');
}
async function assertPublicHttps(u) {
  const url = new URL(u);
  if (url.protocol !== 'https:') { const e = new Error('https_only'); e.status = 400; throw e; }
  const { address } = await dns.lookup(url.hostname);
  if (isPrivateIp(address)) { const e = new Error('blocked_host'); e.status = 400; throw e; }
  return url.toString();
}
// Like assertPublicHttps but also allows http:// — classic Counterparty artwork (Rare Pepes, etc.)
// is hosted on legacy HTTP-only servers. The real SSRF guard is the private-IP block, not the scheme;
// the client always loads it back over our own HTTPS, so there's no mixed-content on the browser side.
async function assertPublicHttp(u) {
  const url = new URL(u);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') { const e = new Error('bad_proto'); e.status = 400; throw e; }
  const { address } = await dns.lookup(url.hostname);
  if (isPrivateIp(address)) { const e = new Error('blocked_host'); e.status = 400; throw e; }
  return url.toString();
}
async function safeFetchImage(startUrl, res, allowHttp = false) {
  let url = startUrl;
  for (let hop = 0; hop <= 3; hop++) {
    await (allowHttp ? assertPublicHttp(url) : assertPublicHttps(url)); // re-validate EVERY hop (anti-redirect-SSRF)
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    let r;
    try { r = await fetch(url, { signal: ctrl.signal, redirect: 'manual' }); } finally { clearTimeout(t); }
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) { url = new URL(r.headers.get('location'), url).toString(); continue; }
    const ct = r.headers.get('content-type') || '';
    if (!r.ok || !ct.startsWith('image/')) return res.status(404).end();
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 3_000_000) return res.status(413).end();
    res.setHeader('Content-Type', ct);
    // Stamp/SRC-20 covers are content-addressed (hash.svg → immutable); NFT images are effectively
    // static too. Cache a day so repeat visits don't re-pull covers (stampchain moved SRC-20 art to
    // embedded WebP — covers are now ~0.5–46 KB, so this is cheap and heavily amortized).
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.send(buf);
  }
  return res.status(508).end();
}
// Same SSRF-safe fetch, but RETURNS the image buffer (so callers can try multiple sources and pick).
async function fetchImageBuffer(startUrl, allowHttp) {
  let url = startUrl;
  for (let hop = 0; hop <= 3; hop++) {
    await (allowHttp ? assertPublicHttp(url) : assertPublicHttps(url));
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 8000);
    let r; try { r = await fetch(url, { signal: ctrl.signal, redirect: 'manual' }); } finally { clearTimeout(t); }
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) { url = new URL(r.headers.get('location'), url).toString(); continue; }
    const ct = r.headers.get('content-type') || '';
    if (!r.ok || !ct.startsWith('image/')) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length || buf.length > 5_000_000) return null;
    return { buf, ct };
  }
  return null;
}

// Normalize a Counterparty artwork pointer (ipfs:// · ar:// · bare CID · http) to an https URL.
function normPointer(u) {
  u = String(u || '').trim(); let m;
  if ((m = u.match(/^ar:\/\/([A-Za-z0-9_-]{43})/i))) return 'https://arweave.net/' + m[1];
  // ipfs:// OR ipfs:CID (single colon, no slashes — a common Counterparty form)
  if ((m = u.match(/^ipfs:(?:\/\/)?(?:ipfs\/)?([A-Za-z0-9./_-]+)/i))) return 'https://ipfs.io/ipfs/' + m[1];
  // Arweave URLs are often malformed (sandbox subdomain + a stray /FILE.json path); pull the real
  // content txid and hit arweave.net directly.
  if (/arweave\.net/i.test(u) && (m = u.match(/arweave\.net\/(?:raw\/)?([A-Za-z0-9_-]{43})/i))) return 'https://arweave.net/' + m[1];
  if (/^https?:\/\//i.test(u)) return u; // keep the original scheme (many CP hosts are http-only)
  if ((m = u.match(/(Qm[1-9A-HJ-NP-Za-km-z]{44}|baf[a-z0-9]{50,})/))) return 'https://ipfs.io/ipfs/' + m[1];
  return null;
}
const IMG_EXT = /\.(png|jpe?g|gif|webp|svg|avif|bmp)(\?|#|$)/i;
// Resolve a CP asset's artwork: its `description` is usually a URL/ipfs/ar pointer to a JSON
// metadata file (enhanced asset info) whose `image` field holds the real artwork. Follow that one
// hop (redirect-safe, SSRF-guarded) and return an https image URL. Handles a direct image or JSON blob too.
async function resolveCpAssetImage(description) {
  if (!description) return null;
  let d = String(description).trim();
  if (d[0] === '{') { try { const j = JSON.parse(d); return normPointer(j.image || j.image_url || j.imageUrl || j.img); } catch (_) { return null; } }
  const first = d.match(/(?:ar:\/\/|ipfs:\/\/|https?:\/\/)\S+/i);
  let url = normPointer(first ? first[0] : d);
  if (!url) return null;
  if (IMG_EXT.test(url)) return url; // already a direct image
  let cur = url;
  for (let hop = 0; hop <= 2; hop++) {
    await assertPublicHttp(cur); // re-validate every hop (anti-redirect-SSRF); http allowed for legacy CP hosts
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 6000);
    let r; try { r = await fetch(cur, { signal: ctrl.signal, redirect: 'manual' }); } finally { clearTimeout(t); }
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) { cur = new URL(r.headers.get('location'), cur).toString(); continue; }
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    if (ct.startsWith('image/')) return cur; // was an image after all
    if (!/json|text|octet-stream/.test(ct)) return null;
    const txt = (await r.text()).slice(0, 200_000);
    let j; try { j = JSON.parse(txt); } catch (_) { return null; }
    return normPointer(j.image || j.image_url || j.imageUrl || j.img);
  }
  return null;
}

// Stamp content can be image / text / HTML / gif / svg. SSRF-safe like the above, but
// content-type-aware: HTML is served with a strict `sandbox` CSP so even direct navigation
// runs it in an OPAQUE origin (a malicious HTML stamp can't read the wallet's storage/keys).
const STAMP_ALLOW = (ct) => /^(image\/|text\/(plain|html)|application\/(json|gzip))/i.test(ct);
async function safeFetchStamp(startUrl, res) {
  let url = startUrl;
  for (let hop = 0; hop <= 3; hop++) {
    await assertPublicHttps(url);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    let r;
    try { r = await fetch(url, { signal: ctrl.signal, redirect: 'manual' }); } finally { clearTimeout(t); }
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) { url = new URL(r.headers.get('location'), url).toString(); continue; }
    if (!r.ok) return res.status(404).end();
    let ct = (r.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim();
    if (!STAMP_ALLOW(ct)) ct = 'application/octet-stream'; // unknown → non-executable download
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 2_000_000) return res.status(413).end();
    res.setHeader('Content-Type', ct);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    if (/text\/html/i.test(ct)) {
      res.setHeader('Content-Security-Policy', 'sandbox allow-scripts'); // opaque-origin sandbox
      res.removeHeader('X-Frame-Options'); // allow the wallet to iframe this preview — the sandbox keeps it isolated regardless of who frames it
      // Many stamps are "recursive": their HTML loads art via root-relative paths
      // (e.g. <script src="/s/A123…">) that resolve against the SOURCE origin, not ours.
      // Inject a <base> so those relative URLs resolve against stampchain — without it
      // the iframe renders blank. The sandbox keeps it isolated from the wallet regardless.
      const origin = new URL(url).origin;
      let html = buf.toString('utf8');
      const baseTag = `<base href="${origin}/">`;
      if (/<head[^>]*>/i.test(html)) html = html.replace(/<head[^>]*>/i, (m) => m + baseTag);
      else if (/<html[^>]*>/i.test(html)) html = html.replace(/<html[^>]*>/i, (m) => m + baseTag);
      else html = baseTag + html;
      return res.send(html);
    }
    return res.send(buf);
  }
  return res.status(508).end();
}

// ── Meta ──
app.get('/api/health', (req, res) =>
  res.json({ ok: true, app: 'wonder-wallet', version: VERSION, phase: PHASE, coreVersion: core.CORE_VERSION, stateless: true }));

app.get('/api/config', (req, res) => res.json({
  version: VERSION, phase: PHASE,
  chains: Object.values(core.CHAINS).map((c) => ({ id: c.id, name: c.name, symbol: c.symbol, model: c.model, curve: c.curve, status: c.status, path: c.path || null })),
  btcAddressTypes: Object.values(core.BTC_ADDRESS_TYPES),
  dust: core.DUST,
}));

app.get('/api/prices', wrap(async (req, res) => res.json(await prices.getPrices())));

// Live chain/index sync status for the landing's "in sync with the chains" badges.
let _statusCache = { at: 0, data: null };
app.get('/api/status', wrap(async (req, res) => {
  if (_statusCache.data && Date.now() - _statusCache.at < 20_000) return res.json(_statusCache.data);
  // Timeout each upstream so one slow/hanging source (e.g. stampchain's /health) can't stall the whole call.
  const j = (p) => { const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 8000); return fetch(p, { headers: { Accept: 'application/json' }, signal: ctrl.signal }).then((r) => r.json()).finally(() => clearTimeout(t)); };
  const [tip, cpRoot, stTip] = await Promise.allSettled([
    // Stamps sync is derived from the indexer's own `last_block` (via a working endpoint) vs the BTC tip.
    // stampchain's /health endpoint currently hangs even when the indexer is fully synced, so we avoid it.
    btc.getTipHeight(), j(`${cp.BASE}/`), j(`${stamps.BASE}/stamps?limit=1`),
  ]);
  const out = { btc: null, cp: null, stamps: null };
  const tipH = (tip.status === 'fulfilled' && tip.value) ? Number(tip.value) : null;
  if (tipH) out.btc = { height: tipH };
  if (cpRoot.status === 'fulfilled') { const r = cpRoot.value.result || cpRoot.value; out.cp = { version: r.version || null, height: r.counterparty_height || r.backend_height || null, ready: !!r.server_ready }; }
  if (stTip.status === 'fulfilled' && stTip.value) {
    const lb = Number(stTip.value.last_block) || null;
    // "synced" = indexer within 2 blocks of the chain tip (or, if we couldn't read the tip, simply reachable).
    out.stamps = { indexed: lb, synced: lb ? (tipH ? lb >= tipH - 2 : true) : false };
  }
  _statusCache = { at: Date.now(), data: out };
  res.json(out);
}));

app.get('/api/detect/:value', (req, res) => res.json({ chain: detectChain(String(req.params.value || '').trim()) }));

// ── Bitcoin ──
// NOTE: static sub-paths must be declared BEFORE the `:address` catch-all,
// otherwise `/api/btc/fees` matches `:address` = "fees".
app.get('/api/btc/fees', wrap(async (req, res) => res.json(await btc.getFees())));
// Raw prev-tx hex (nonWitnessUtxo) for legacy-source signing. 4-segment path — no :address collision.
app.get('/api/btc/tx/:txid/hex', wrap(async (req, res) => {
  const t = String(req.params.txid);
  if (!/^[0-9a-fA-F]{64}$/.test(t)) { const e = new Error('bad_txid'); e.status = 400; throw e; }
  res.type('text/plain').send(await btc.getRawTx(t));
}));

app.get('/api/btc/:address', wrap(async (req, res) => {
  const address = String(req.params.address);
  if (!RE.bitcoin.test(address)) { const e = new Error('invalid'); e.status = 400; throw e; }
  const data = await btc.getAddress(address);
  // Fast path: no asset scan yet → honest "unknown".
  const utxos = core.classifyUtxos(data.utxos, { assetScanReady: false });
  res.json({ address, balanceSats: data.balanceSats, txCount: data.txCount, utxos, source: 'mempool.space' });
}));

app.get('/api/btc/:address/scan', wrap(async (req, res) => {
  const address = String(req.params.address);
  if (!RE.bitcoin.test(address)) { const e = new Error('invalid'); e.status = 400; throw e; }
  const data = await btc.getAddress(address);
  const scanned = await scan.scanAddress(address, data.utxos);
  res.json({ address, balanceSats: data.balanceSats, txCount: data.txCount, utxos: scanned, source: 'counterparty + ordinals' });
}));

app.get('/api/btc/:address/assets', wrap(async (req, res) => {
  const address = String(req.params.address);
  if (!RE.bitcoin.test(address)) { const e = new Error('invalid'); e.status = 400; throw e; }
  const [counterparty, st] = await Promise.all([
    cp.getAddressAssets(address).catch(() => []),
    stamps.getBalance(address).catch(() => ({ stamps: [], src20: [] })),
  ]);
  res.json({ address, counterparty, stamps: st.stamps, src20: st.src20 });
}));

// Unified activity / transaction history (Counterparty + BTC + SRC-20, classified, with confirm state).
app.get('/api/activity/:address', wrap(async (req, res) => {
  const address = String(req.params.address);
  if (!RE.bitcoin.test(address)) { const e = new Error('invalid'); e.status = 400; throw e; }
  res.json(await activity.getActivity(address));
}));

// Broadcast a signed raw transaction (client signs locally; server only relays).
app.post('/api/btc/broadcast', limitMoney, wrap(async (req, res) => {
  const txhex = String(req.body.txhex || '').trim();
  if (!/^[0-9a-fA-F]{20,}$/.test(txhex)) { const e = new Error('bad_tx'); e.status = 400; throw e; }
  const r = await fetch(`${btc.BASE}/tx`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: txhex });
  const body = await r.text();
  if (!r.ok) return res.status(502).json({ error: 'broadcast_rejected', detail: safeErr(body) });
  res.json({ ok: true, txid: body.trim() });
}));

// ── Coin control: full per-UTXO detail (category + carries + confirmations + labels/freezes) ──
app.get('/api/btc/:address/coincontrol', wrap(async (req, res) => {
  const address = String(req.params.address);
  if (!RE.bitcoin.test(address)) { const e = new Error('invalid'); e.status = 400; throw e; }

  const [data, tip] = await Promise.all([btc.getAddress(address), btc.getTipHeight().catch(() => null)]);
  const { perUtxo, ordRes, floor } = await scan.classify(data.utxos);

  // Labels / freezes / time-locks are client-side (localStorage) now — the server stays
  // stateless and returns raw classification; the wallet overlays its local meta.

  // Enrich the protected UTXOs with what they actually carry (capped to stay light).
  const carries = {};
  const protectedKeys = data.utxos.map((u) => `${u.txid}:${u.vout}`).filter((k) => perUtxo[k].reasons.includes('counterparty-bound')).slice(0, 20);
  await Promise.all(protectedKeys.map(async (k) => {
    try { carries[k] = await cp.getUtxoAssets(k); } catch (_) { carries[k] = []; }
  }));

  const utxos = data.utxos.map((u) => {
    const k = `${u.txid}:${u.vout}`;
    const c = perUtxo[k];
    return {
      utxo: k, txid: u.txid, vout: u.vout, value: u.value,
      confirmations: u.blockHeight && tip ? Math.max(0, tip - u.blockHeight + 1) : (u.confirmed ? null : 0),
      category: c.category,
      reasons: c.reasons,
      carries: carries[k] || (c.reasons.includes('inscription') ? [{ asset: 'inscription', name: 'Ordinal inscription' }] : []),
      frozen: false, freezeUntil: null, timelocked: false, label: '', // overlaid client-side
    };
  });

  const sum = (f) => utxos.filter(f).reduce((a, u) => a + u.value, 0);
  const summary = {
    total: utxos.length,
    spendable: utxos.filter((u) => u.category === 'spendable' && !u.frozen && !u.timelocked).length,
    protected: utxos.filter((u) => u.category === 'protected').length,
    dust: utxos.filter((u) => u.category === 'dust').length,
    unknown: utxos.filter((u) => u.category === 'unknown').length,
    frozen: utxos.filter((u) => u.frozen || u.timelocked).length,
    sats: {
      total: sum(() => true),
      spendable: sum((u) => u.category === 'spendable' && !u.frozen && !u.timelocked),
      protected: sum((u) => u.category === 'protected'),
    },
  };
  res.json({ address, balanceSats: data.balanceSats, floor, tip, scanMeta: { ordinalsScanned: ordRes.scannedCount, ordinalsCapped: ordRes.capped, total: data.utxos.length }, summary, utxos });
}));

// ── Counterparty asset intelligence ──
app.get('/api/cp/asset/:asset', wrap(async (req, res) => res.json(await cp.getAsset(String(req.params.asset)))));
// xchain.io aggregates + renders Counterparty asset art reliably (it already chases each asset's
// on-chain pointer, incl. the flaky arweave/ipfs ones). It returns a single generic PLACEHOLDER
// (this md5) for assets that have no real art — we detect + skip that so those fall back to our
// own clean letter placeholder.
// xchain serves a generic CP-logo placeholder for assets it can't render art for; skip those so
// they fall back to the on-chain pointer / our own letter placeholder. (It has used a couple of
// placeholder variants over time — match any known one.)
const XCHAIN_PLACEHOLDER_MD5 = new Set(['a758b9b397eacc038e5b931d5f466bbf', '32bfe0dbdd5ceaa1b4ea6a3d8873779a']);
async function fetchXchainIcon(asset) {
  const url = 'https://xchain.io/icon/' + encodeURIComponent(asset) + '.png';
  try {
    await assertPublicHttps(url);
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 8000);
    let r; try { r = await fetch(url, { signal: ctrl.signal }); } finally { clearTimeout(t); }
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    if (!r.ok || !ct.startsWith('image/')) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length || buf.length > 3_000_000) return null;
    const md5 = require('crypto').createHash('md5').update(buf).digest('hex');
    if (XCHAIN_PLACEHOLDER_MD5.has(md5)) return null; // xchain's "no artwork" placeholder → treat as none
    return { buf, ct };
  } catch (_) { return null; }
}
// cdn.xcp.io — a dedicated Counterparty art CDN. /img/full/<asset> serves the FULL-resolution
// original (e.g. 500×500, animated GIFs preserved), /img/icon/<asset> a 48px thumbnail. Broad
// coverage (subassets, numeric assets) and far crisper than xchain's forced-48px icons. It serves
// a fixed placeholder for artless assets, so skip those by md5 and fall through to other sources.
const XCP_CDN_PLACEHOLDER_MD5 = new Set([
  '90c76b7dee2a44aa33e32352fd932fff', // /img/full   "no artwork" (300×180)
  'a7c258b2c00270dcfe6777f707c122fa', // /img/icon   "no artwork" (48×48)
]);
async function fetchXcpCdn(asset, full) {
  const url = 'https://cdn.xcp.io/img/' + (full ? 'full/' : 'icon/') + encodeURIComponent(asset);
  try {
    await assertPublicHttps(url);
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 8000);
    let r; try { r = await fetch(url, { signal: ctrl.signal }); } finally { clearTimeout(t); }
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    if (!r.ok || !ct.startsWith('image/')) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length || buf.length > 5_000_000) return null;
    const md5 = require('crypto').createHash('md5').update(buf).digest('hex');
    if (XCP_CDN_PLACEHOLDER_MD5.has(md5)) return null; // cdn's "no artwork" placeholder → treat as none
    return { buf, ct };
  } catch (_) { return null; }
}
// The creator's actual on-chain art (full resolution) resolved from the asset description.
async function resolveOnchainImage(asset) {
  let info; try { info = await cp.getAsset(asset); } catch (_) { return null; }
  let img = null; try { img = await resolveCpAssetImage(info && info.description); } catch (_) {}
  if (!img) return null;
  try { return await fetchImageBuffer(img, true); } catch (_) { return null; } // allow http:// (legacy CP hosts)
}
// Asset artwork. Three sources, tried in order and unioned: cdn.xcp.io (dedicated CP art CDN —
// full-res + broad coverage, our primary), the creator's on-chain art (from the asset description),
// and xchain's fast 48px thumbnail. ?full=1 (detail view) prefers full resolution; default (small
// list icons) prefers 48px thumbnails. Cached; 404 → the UI's letter placeholder.
app.get('/api/cp/assetimg/:asset', limitMedia, wrap(async (req, res) => {
  const asset = String(req.params.asset || '');
  const full = req.query.full === '1';
  const send = (x) => { res.setHeader('Content-Type', x.ct); res.setHeader('Cache-Control', 'public, max-age=86400'); res.send(x.buf); };
  const sources = full
    ? [() => fetchXcpCdn(asset, true), () => resolveOnchainImage(asset), () => fetchXchainIcon(asset)]
    : [() => fetchXcpCdn(asset, false), () => fetchXchainIcon(asset), () => resolveOnchainImage(asset)];
  for (const src of sources) { let x = null; try { x = await src(); } catch (_) {} if (x && x.buf) return send(x); }
  return res.status(404).end();
}));
// Address-held CP assets (populates the Destroy-tab asset picker + balance hint).
app.get('/api/cp/holdings/:address', wrap(async (req, res) => {
  const a = String(req.params.address);
  if (!RE.bitcoin.test(a)) { const e = new Error('invalid'); e.status = 400; throw e; }
  try { res.json({ holdings: await cp.getHoldings(a) }); } catch (_) { res.json({ holdings: [] }); }
}));
// Assets an address OWNS (issuance-suite pickers: issue-more / lock / transfer / describe / subasset).
app.get('/api/cp/owned/:address', wrap(async (req, res) => {
  const a = String(req.params.address);
  if (!RE.bitcoin.test(a)) { const e = new Error('invalid'); e.status = 400; throw e; }
  try { res.json({ owned: await cp.getOwnedAssets(a) }); } catch (_) { res.json({ owned: [] }); }
}));
// Asset-name availability + ownership (Create validation; issuance-suite ownership guards).
app.get('/api/cp/assetname/:asset', limitProxy, wrap(async (req, res) => {
  const a = String(req.params.asset || '').toUpperCase();
  if (!RE.cpasset.test(a)) { const e = new Error('bad_asset'); e.status = 400; throw e; }
  res.json(await cp.checkAssetName(a));
}));

// ── Counterparty actions (Phase 6): compose → (client signs) → broadcast ──
// `attach` is address-sourced (fits the generic route). `detach` is UTXO-sourced — it has
// its own route below. `order`/`cancel`/`btcpay` power the DEX.
const CP_TYPES = new Set(['send', 'mpma', 'sweep', 'dispenser', 'dispense', 'dividend', 'destroy', 'issuance', 'broadcast', 'order', 'cancel', 'btcpay', 'fairminter', 'fairmint', 'attach']);
const qstr = (o) => Object.entries(o || {}).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');

app.post('/api/cp/compose/:type', limitMoney, wrap(async (req, res) => {
  const type = String(req.params.type);
  if (!CP_TYPES.has(type)) { const e = new Error('bad_type'); e.status = 400; throw e; }
  const source = String(req.body.source || '');
  if (!RE.bitcoin.test(source)) { const e = new Error('bad_source'); e.status = 400; throw e; }
  // Counterparty's `destroy` requires a `tag` param to be PRESENT (empty value is valid), but qstr
  // drops empty strings — so force an empty `tag=` when the user didn't supply one. Otherwise the
  // node rejects the compose with "Missing required parameter: tag".
  const p = req.body.params || {};
  const tagFix = (type === 'destroy' && (p.tag == null || p.tag === '')) ? '&tag=' : '';
  const url = `${cp.BASE}/addresses/${source}/compose/${type}?${qstr(p)}${tagFix}&verbose=true&allow_unconfirmed_inputs=true`;
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  const j = await r.json();
  if (j.error || !j.result) {
    return res.status(400).json({ error: 'compose_failed', detail: safeErr(j.error || (j.messages && j.messages[0]) || 'Counterparty rejected the compose') });
  }
  const x = j.result;
  res.json({ psbt: x.psbt, inputs_values: x.inputs_values, lock_scripts: x.lock_scripts, btc_fee: x.btc_fee, btc_in: x.btc_in, btc_out: x.btc_out, btc_change: x.btc_change, data: x.data, signed_tx_estimated_size: x.signed_tx_estimated_size, name: x.name, warnings: x.warnings, params: x.params });
}));

// XCP-fee pre-flight (sweep/dividend/attach/issuance expose estimatexcpfees).
app.post('/api/cp/estimate/:type', limitMoney, wrap(async (req, res) => {
  const type = String(req.params.type);
  if (!CP_TYPES.has(type)) { const e = new Error('bad_type'); e.status = 400; throw e; }
  const source = String(req.body.source || '');
  if (!RE.bitcoin.test(source)) { const e = new Error('bad_source'); e.status = 400; throw e; }
  try {
    const r = await fetch(`${cp.BASE}/addresses/${source}/compose/${type}/estimatexcpfees?${qstr(req.body.params)}`, { headers: { Accept: 'application/json' } });
    const j = await r.json();
    res.json({ xcpFee: typeof j.result === 'number' ? j.result : null });
  } catch (_) { res.json({ xcpFee: null }); }
}));

// CP mempool status (pending Counterparty txs for an address).
app.get('/api/cp/mempool/:address', wrap(async (req, res) => {
  const a = String(req.params.address);
  if (!RE.bitcoin.test(a)) { const e = new Error('invalid'); e.status = 400; throw e; }
  try {
    const j = await (await fetch(`${cp.BASE}/addresses/${a}/mempool?limit=20`, { headers: { Accept: 'application/json' } })).json();
    res.json({ pending: Array.isArray(j.result) ? j.result : [] });
  } catch (_) { res.json({ pending: [] }); }
}));

// ── DEX (Counterparty order book) ──
// Slim an order row down to what the UI needs (incl. tx_hash = the offer_hash for cancel).
const slimOrder = (o) => ({
  tx_hash: o.tx_hash, source: o.source,
  give_asset: o.give_asset, give_remaining: o.give_remaining_normalized ?? o.give_quantity_normalized,
  get_asset: o.get_asset, get_remaining: o.get_remaining_normalized ?? o.get_quantity_normalized,
  give_quantity_normalized: o.give_quantity_normalized, get_quantity_normalized: o.get_quantity_normalized,
  expiration: o.expiration, status: o.status,
});
// Open order book for an asset pair (both directions of the market).
app.get('/api/cp/book/:a1/:a2', wrap(async (req, res) => {
  const a1 = String(req.params.a1).toUpperCase(), a2 = String(req.params.a2).toUpperCase();
  if (!RE.cpasset.test(a1) || !RE.cpasset.test(a2)) { const e = new Error('bad_asset'); e.status = 400; throw e; }
  try {
    const j = await (await fetch(`${cp.BASE}/orders/${a1}_${a2}?status=open&limit=50&verbose=true`, { headers: { Accept: 'application/json' } })).json();
    res.json({ orders: (Array.isArray(j.result) ? j.result : []).map(slimOrder) });
  } catch (_) { res.json({ orders: [] }); }
}));
// Open order book for a SINGLE asset — every pair it trades in (both directions).
app.get('/api/cp/assetbook/:asset', wrap(async (req, res) => {
  const a = String(req.params.asset).toUpperCase();
  if (!RE.cpasset.test(a)) { const e = new Error('bad_asset'); e.status = 400; throw e; }
  try {
    const j = await (await fetch(`${cp.BASE}/assets/${encodeURIComponent(a)}/orders?status=open&limit=50&verbose=true`, { headers: { Accept: 'application/json' } })).json();
    res.json({ orders: (Array.isArray(j.result) ? j.result : []).map(slimOrder) });
  } catch (_) { res.json({ orders: [] }); }
}));
// Open dispensers at an address (Send-to-dispenser detection): sending `satoshirate` sats
// triggers one dispense of `giveQty` of the asset.
app.get('/api/cp/dispensers/:address', wrap(async (req, res) => {
  const a = String(req.params.address);
  if (!RE.bitcoin.test(a)) { const e = new Error('invalid'); e.status = 400; throw e; }
  try {
    const j = await (await fetch(`${cp.BASE}/addresses/${a}/dispensers?status=open&limit=20&verbose=true`, { headers: { Accept: 'application/json' } })).json();
    const dispensers = (Array.isArray(j.result) ? j.result : []).filter((x) => Number(x.status) === 0 && Number(x.satoshirate) > 0).map((x) => ({
      asset: (x.asset_info && x.asset_info.asset_longname) || x.asset,
      giveQty: x.give_quantity_normalized != null ? String(x.give_quantity_normalized) : String(x.give_quantity),
      satoshirate: Number(x.satoshirate),
      remaining: x.give_remaining_normalized != null ? String(x.give_remaining_normalized) : String(x.give_remaining),
    }));
    res.json({ dispensers });
  } catch (_) { res.json({ dispensers: [] }); }
}));
// An address's own open orders (so it can cancel them).
app.get('/api/cp/myorders/:address', wrap(async (req, res) => {
  const a = String(req.params.address);
  if (!RE.bitcoin.test(a)) { const e = new Error('invalid'); e.status = 400; throw e; }
  try {
    const j = await (await fetch(`${cp.BASE}/addresses/${a}/orders?status=open&limit=50&verbose=true`, { headers: { Accept: 'application/json' } })).json();
    res.json({ orders: (Array.isArray(j.result) ? j.result : []).map(slimOrder) });
  } catch (_) { res.json({ orders: [] }); }
}));

// ── Attach / Detach (move CP assets between an address balance and a UTXO) ──
// Detachable balances: the address's asset balances that currently sit on a UTXO.
app.get('/api/cp/attached/:address', wrap(async (req, res) => {
  const a = String(req.params.address);
  if (!RE.bitcoin.test(a)) { const e = new Error('invalid'); e.status = 400; throw e; }
  try {
    const j = await (await fetch(`${cp.BASE}/addresses/${a}/balances?limit=500&verbose=true`, { headers: { Accept: 'application/json' } })).json();
    const attached = (Array.isArray(j.result) ? j.result : []).filter((b) => b.utxo).map((b) => ({
      utxo: b.utxo, asset: b.asset, asset_longname: b.asset_longname,
      quantity_normalized: b.quantity_normalized, divisible: b.asset_info?.divisible,
    }));
    res.json({ attached });
  } catch (_) { res.json({ attached: [] }); }
}));
// Detach composes from a UTXO (not an address) → its own endpoint shape.
app.post('/api/cp/detach', limitMoney, wrap(async (req, res) => {
  const utxo = String(req.body.utxo || '');
  if (!/^[0-9a-fA-F]{64}:\d+$/.test(utxo)) { const e = new Error('bad_utxo'); e.status = 400; throw e; }
  const dest = req.body.destination ? String(req.body.destination) : '';
  if (dest && !RE.bitcoin.test(dest)) { const e = new Error('bad_destination'); e.status = 400; throw e; }
  const q = qstr({ destination: dest || undefined });
  const url = `${cp.BASE}/utxos/${utxo}/compose/detach?${q}&verbose=true&allow_unconfirmed_inputs=true`;
  const j = await (await fetch(url, { headers: { Accept: 'application/json' } })).json();
  if (j.error || !j.result) return res.status(400).json({ error: 'compose_failed', detail: safeErr(j.error || (j.messages && j.messages[0]) || 'detach rejected') });
  const x = j.result;
  res.json({ psbt: x.psbt, inputs_values: x.inputs_values, lock_scripts: x.lock_scripts, btc_fee: x.btc_fee, btc_in: x.btc_in, btc_out: x.btc_out, btc_change: x.btc_change, data: x.data, signed_tx_estimated_size: x.signed_tx_estimated_size, name: x.name, warnings: x.warnings });
}));

// ── Stamps ──
app.get('/api/stamp/:id', wrap(async (req, res) => res.json(await stamps.getStamp(String(req.params.id)))));

// Proxy stamp art so the browser only ever loads images from our own origin (img-src 'self').
app.get('/api/stamp/:id/content', limitMedia, wrap(async (req, res) => {
  const meta = await stamps.getStamp(String(req.params.id).replace(/[^0-9]/g, ''));
  if (!meta.art) return res.status(404).json({ error: 'no_art' });
  await safeFetchStamp(meta.art, res); // serves image/text/html (HTML sandboxed)
}));

// ── First-party minting modules (Phase 12): compose → client signs PSBT → broadcast ──
// SRC-20 deploy / mint / transfer (stampchain returns an unsigned PSBT hex).
app.post('/api/stamps/src20/create', limitMoney, wrap(async (req, res) => {
  const source = String(req.body.source || '');
  if (!RE.bitcoin.test(source)) { const e = new Error('bad_source'); e.status = 400; throw e; }
  const body = { ...(req.body.params || {}), sourceAddress: source, changeAddress: source };
  const r = await stamps.src20Create(body);
  if (r.error) return res.status(400).json({ error: 'compose_failed', detail: safeErr(r.error) });
  res.json({ hex: r.hex, inputsToSign: r.inputsToSign, fee: r.est_miner_fee || r.fee, vsize: r.est_tx_size, cpid: r.cpid, change: r.change_value });
}));
// Live ticker status (deploy availability / mint progress) — drives the inline ✓/✗ hints.
app.get('/api/stamps/src20/tick/:tick', limitProxy, wrap(async (req, res) => {
  const t = String(req.params.tick || '');
  if (!t || t.length > 32) { const e = new Error('bad_tick'); e.status = 400; throw e; }
  res.json(await stamps.getSrc20Tick(t));
}));
// The address's SRC-20 holdings (populates the Transfer-tab token dropdown).
app.get('/api/stamps/src20/holdings/:address', wrap(async (req, res) => {
  const a = String(req.params.address);
  if (!RE.bitcoin.test(a)) { const e = new Error('invalid'); e.status = 400; throw e; }
  try { const b = await stamps.getBalance(a); res.json({ src20: b.src20 || [] }); }
  catch (_) { res.json({ src20: [] }); }
}));
// Bitcoin Stamp art mint (OLGA).
app.post('/api/stamps/olga/mint', limitMoney, wrap(async (req, res) => {
  const source = String(req.body.source || '');
  if (!RE.bitcoin.test(source)) { const e = new Error('bad_source'); e.status = 400; throw e; }
  const body = { ...(req.body.params || {}), sourceWallet: source };
  const r = await stamps.olgaMint(body);
  if (r.error) return res.status(400).json({ error: 'compose_failed', detail: safeErr(r.error) });
  res.json({ hex: r.hex, txDetails: r.txDetails, fee: r.est_miner_fee, vsize: r.est_tx_size, cpid: r.cpid, change: r.change_value });
}));
// Stamp fee preview (no UTXOs needed).
app.post('/api/stamps/olga/estimate', limitProxy, wrap(async (req, res) => {
  res.json(await stamps.olgaEstimate(req.body.params || {}));
}));

// ── SRC-101 (Bitcoin Stamps naming — "Bitname" .btc) ──
// Resolve a `.btc` name → address (Send-field resolution). Name is validated loosely; the
// resolver base64-encodes it and queries the canonical .btc deploy.
app.get('/api/src101/resolve/:name', limitProxy, wrap(async (req, res) => {
  const name = String(req.params.name || '');
  if (!name || name.length > 80) { const e = new Error('bad_name'); e.status = 400; throw e; }
  res.json(await stamps.resolveSrc101(name));
}));
// An address's `.btc` names + its primary (reverse) name — drives the Names group + identity chip.
app.get('/api/src101/names/:address', limitProxy, wrap(async (req, res) => {
  const a = String(req.params.address);
  if (!RE.bitcoin.test(a)) { const e = new Error('invalid'); e.status = 400; throw e; }
  try {
    const names = await stamps.getSrc101Names(a);
    const primary = names.find((n) => n.primary && !n.expired) || names.find((n) => !n.expired) || null;
    res.json({ names, primary: primary ? primary.name : null, deploy: stamps.SRC101_BTC_DEPLOY });
  } catch (_) { res.json({ names: [], primary: null }); }
}));
// SRC-101 compose (deploy/mint/transfer/setrecord/renew) → unsigned PSBT. Wired & ready; see the
// note in sources/stamps.js (upstream endpoint currently rejects documented shapes).
app.post('/api/src101/create', limitMoney, wrap(async (req, res) => {
  const source = String(req.body.source || '');
  const dryRun = req.body.dryRun === true;
  if (!dryRun && !RE.bitcoin.test(source)) { const e = new Error('bad_source'); e.status = 400; throw e; }
  const body = { ...(req.body.params || {}), ...(dryRun ? { dryRun: true } : { sourceAddress: source, changeAddress: source }) };
  const r = await stamps.src101Create(body);
  if (r.error) return res.status(400).json({ error: 'compose_failed', detail: safeErr(r.error) });
  // dryRun → fee/cost estimate (works upstream even while full compose is WIP); else the unsigned PSBT.
  if (r.is_estimate || (dryRun && r.est_miner_fee != null)) {
    return res.json({ estimate: true, est_miner_fee: r.est_miner_fee, total_dust_value: r.total_dust_value, total_cost: r.total_cost, est_tx_size: r.est_tx_size });
  }
  res.json({ hex: r.hex, base64: r.base64, inputsToSign: r.inputsToSign, fee: r.est_miner_fee || r.fee, vsize: r.est_tx_size, change: r.change });
}));

// ── Ethereum / Solana ──
app.get('/api/eth/:address', wrap(async (req, res) => {
  const a = String(req.params.address);
  if (!RE.ethereum.test(a)) { const e = new Error('invalid'); e.status = 400; throw e; }
  const network = String(req.query.network || 'eth' + 'ereum');
  res.json(await eth.getAddress(a, eth.NETWORKS[network] ? network : 'ethereum'));
}));

// Prepare an EIP-1559 tx (nonce/gas/fees) — client signs the result.
app.post('/api/eth/prepare', limitMoney, wrap(async (req, res) => {
  const { from, to, valueWei, data, network } = req.body;
  if (!RE.ethereum.test(String(from || '')) || !RE.ethereum.test(String(to || ''))) { const e = new Error('bad_addr'); e.status = 400; throw e; }
  if (data != null && data !== '' && !/^0x[0-9a-fA-F]{0,8192}$/.test(String(data))) { const e = new Error('bad_data'); e.status = 400; throw e; }
  if (valueWei != null && valueWei !== '' && !/^0x[0-9a-fA-F]{0,64}$/.test(String(valueWei))) { const e = new Error('bad_value'); e.status = 400; throw e; }
  res.json(await eth.prepareTx({ from, to, valueWei: valueWei || '0x0', data: data || '0x', network: eth.NETWORKS[network] ? network : 'ethereum' }));
}));

// Relay a signed EVM tx.
app.post('/api/eth/broadcast', limitMoney, wrap(async (req, res) => {
  const raw = String(req.body.raw || '');
  if (!/^0x[0-9a-fA-F]{20,4096}$/.test(raw)) { const e = new Error('bad_tx'); e.status = 400; throw e; }
  try {
    const txhash = await eth.broadcast(raw, eth.NETWORKS[req.body.network] ? req.body.network : 'ethereum');
    res.json({ ok: true, txhash });
  } catch (e) { res.status(502).json({ error: 'broadcast_rejected', detail: safeErr(e.rpc?.message || e.message) }); }
}));
// ERC-721/1155 gallery (Alchemy NFT API; enabled: false when no ALCHEMY_KEY).
app.get('/api/eth/:address/nfts', wrap(async (req, res) => {
  const a = String(req.params.address);
  if (!RE.ethereum.test(a)) { const e = new Error('invalid'); e.status = 400; throw e; }
  const network = eth.NETWORKS[req.query.network] ? String(req.query.network) : 'ethereum';
  res.json(await eth.getNfts(a, network));
}));
// Same-origin image proxy (NFT art) — SSRF-safe (audit #2): https only, no private
// IPs, redirects re-validated per hop, image content-type only, size-capped.
app.get('/api/img', limitMedia, wrap(async (req, res) => {
  await safeFetchImage(String(req.query.url || ''), res);
}));

app.get('/api/sol/blockhash', wrap(async (req, res) => res.json(await sol.getBlockhash())));
const b64ok = (s) => /^[A-Za-z0-9+/]{40,8000}={0,2}$/.test(String(s || ''));
app.post('/api/sol/simulate', limitProxy, wrap(async (req, res) => {
  if (!b64ok(req.body.txBase64)) { const e = new Error('bad_tx'); e.status = 400; throw e; }
  res.json(await sol.simulate(String(req.body.txBase64)));
}));
app.post('/api/sol/broadcast', limitMoney, wrap(async (req, res) => {
  if (!b64ok(req.body.txBase64)) { const e = new Error('bad_tx'); e.status = 400; throw e; }
  try { const signature = await sol.broadcast(String(req.body.txBase64)); res.json({ ok: true, signature }); }
  catch (e) { res.status(502).json({ error: 'broadcast_rejected', detail: safeErr(e.rpc?.message || e.message) }); }
}));
app.get('/api/sol/:address/nfts', wrap(async (req, res) => {
  const a = String(req.params.address);
  if (!RE.solana.test(a)) { const e = new Error('invalid'); e.status = 400; throw e; }
  res.json(await sol.getNfts(a));
}));
// Compressed-NFT transfer context (getAsset + getAssetProof + canopy) for client-side Bubblegum signing.
app.get('/api/sol/cnft/:id', wrap(async (req, res) => {
  const id = String(req.params.id);
  if (!RE.solana.test(id)) { const e = new Error('invalid'); e.status = 400; throw e; }
  res.json(await sol.getCnftContext(id));
}));
app.get('/api/sol/:address', wrap(async (req, res) => {
  const a = String(req.params.address);
  if (!RE.solana.test(a)) { const e = new Error('invalid'); e.status = 400; throw e; }
  res.json(await sol.getAddress(a));
}));

// ── Emblem Vault bridge (Phase 7c) ──
app.get('/api/emblem/curated', wrap(async (req, res) => res.json(await emblem.getCurated())));
app.get('/api/emblem/vaults/:address', wrap(async (req, res) => {
  const a = String(req.params.address);
  if (!RE.ethereum.test(a) && !RE.bitcoin.test(a) && !RE.solana.test(a)) { const e = new Error('invalid'); e.status = 400; throw e; }
  res.json({ vaults: await emblem.getVaults(a, String(req.query.type || 'created')) });
}));
app.get('/api/emblem/balance/:tokenId', wrap(async (req, res) => res.json({ balances: await emblem.getBalance(String(req.params.tokenId).replace(/[^0-9]/g, '')) })));
app.post('/api/emblem/create', limitMoney, wrap(async (req, res) => {
  try { res.json(await emblem.createVault(req.body.template || {})); }
  catch (e) { res.status(400).json({ error: 'create_failed', detail: safeErr(e.message) }); }
}));
app.post('/api/emblem/mint', limitMoney, wrap(async (req, res) => {
  try { res.json(await emblem.buildMint(req.body.tokenId, req.body.signature, req.body.chainId || 1)); }
  catch (e) { res.status(400).json({ error: 'mint_failed', detail: safeErr(e.message) }); }
}));
app.post('/api/emblem/unvault', limitMoney, wrap(async (req, res) => {
  try { res.json(await emblem.buildUnvault(req.body.tokenId, req.body.signature, req.body.chainId || 1)); }
  catch (e) { res.status(400).json({ error: 'unvault_failed', detail: safeErr(e.message) }); }
}));

// Clean URL for the Wonder Terminal (the wallet lives on its own page). Served WITHOUT a trailing
// slash so the page's relative asset URLs (styles.css, wallet-core.js …) resolve against the app root.
app.get('/app', (req, res) => res.sendFile(path.join(__dirname, 'public', 'app.html')));
app.get('/app/', (req, res) => res.redirect(301, 'app'));
app.use(express.static(path.join(__dirname, 'public')));
app.listen(PORT, () => console.log(`[wonder-wallet] ${PHASE} listening on ${PORT}`));
