/**
 * Emblem Vault bridge (Phase 7c). Server-proxies the open Emblem API (no key gate
 * — the apiKey is a non-enforced label) and builds the on-chain calldata for
 * buyWithSignedPrice / unvaultWithSignedPrice. Keys stay client-side: the browser
 * personal_signs the mint/unvault message, we fetch the signed price + assemble
 * the tx, the client signs+broadcasts via the EVM pipeline. ABI encoder verified
 * byte-identical to ethers.
 */
'use strict';

const { fetchJson, cacheGet, cacheSet } = require('./http');
const { keccak_256 } = require('@noble/hashes/sha3');

const V2 = process.env.EMBLEM_V2 || 'https://v2.emblemvault.io';
const V3 = process.env.EMBLEM_V3 || 'https://v3.emblemvault.io';
const HANDLER = '0x23859b51117dbFBcdEf5b757028B18d7759a4460';   // mint, chains 1 & 137
const DIAMOND = '0x214C964bBd3640971E111d3a994CbB89b296a9ad';   // unvault (V2)
const ZERO = '0x0000000000000000000000000000000000000000';
const KEY = { 'x-api-key': 'demo' };

const bn = (v) => (v == null ? 0n : typeof v === 'object' && v.hex != null ? BigInt(v.hex) : BigInt(v));
const toHexWei = (b) => '0x' + b.toString(16);
function toBytes(v) { const s = String(v == null ? '' : v); return /^0x/i.test(s) ? s : /^[0-9a-fA-F]*$/.test(s) && s.length % 2 === 0 ? '0x' + s : '0x' + Buffer.from(s, 'utf8').toString('hex'); }

// ── minimal ABI encoder (address|uint256|bytes), verified vs ethers ──
const pad = (a) => String(a).toLowerCase().replace(/^0x/, '').padStart(64, '0');
function abiEncode(types, values) {
  const head = [], tail = []; let off = types.length * 32;
  for (let i = 0; i < types.length; i++) {
    const t = types[i], v = values[i];
    if (t === 'address') head.push(pad(v));
    else if (t === 'uint256') head.push(BigInt(v).toString(16).padStart(64, '0'));
    else { const b = String(v).replace(/^0x/, ''); head.push(BigInt(off).toString(16).padStart(64, '0')); const padded = b + '0'.repeat((64 - (b.length % 64)) % 64); const chunk = BigInt(b.length / 2).toString(16).padStart(64, '0') + padded; tail.push(chunk); off += chunk.length / 2; }
  }
  return head.join('') + tail.join('');
}
function encodeCall(sig, types, values) {
  return '0x' + Buffer.from(keccak_256(Buffer.from(sig, 'utf8'))).toString('hex').slice(0, 8) + abiEncode(types, values);
}
const MINT_SIG = 'buyWithSignedPrice(address,address,uint256,address,uint256,uint256,bytes,bytes,uint256)';
const MINT_T = ['address', 'address', 'uint256', 'address', 'uint256', 'uint256', 'bytes', 'bytes', 'uint256'];
const UNVAULT_SIG = 'unvaultWithSignedPrice(address,uint256,uint256,address,uint256,bytes,uint256)';
const UNVAULT_T = ['address', 'uint256', 'uint256', 'address', 'uint256', 'bytes', 'uint256'];

// ── reads ──
async function getCurated() {
  const k = 'emblem:curated';
  const hit = cacheGet(k); if (hit) return hit;
  const list = await fetchJson(`${V2}/curated`, { headers: KEY });
  const out = (list || []).map((c) => ({
    id: c.id, name: c.name, contracts: c.contracts, addressChain: c.addressChain,
    collectionType: c.collectionType, collectionChain: c.collectionChain, price: c.price,
    mintable: c.mintable, image: (c.loadingImages && c.loadingImages[0]) || c.imageHandler || null,
  }));
  cacheSet(k, out, 300_000);
  return out;
}

async function getVaults(address, type = 'created') {
  const t = ['vaulted', 'unvaulted', 'created', 'unclaimed'].includes(type) ? type : 'created';
  const j = await fetchJson(`${V2}/myvaults/${address}?vaultType=${t}`, { headers: KEY });
  const arr = Array.isArray(j) ? j : j.data || [];
  return arr.map((v) => ({
    tokenId: v.tokenId, name: v.name, image: v.image,
    addresses: (v.addresses || []).map((a) => ({ coin: a.coin, address: a.address })),
    status: v.ownership?.status || null, claimedBy: v.ownership?.claimedBy || null, network: v.network,
  }));
}

async function getBalance(tokenId) {
  try { const j = await fetchJson(`${V3}/vault/balance/${tokenId}?live=true`, { headers: KEY }); return j.balances || []; }
  catch (_) { return []; }
}

// WW-C06: the deposit address the user later sends their asset to comes from this upstream response.
// A malformed/empty/bogus BTC address must never reach the client as a "deposit target", so validate
// every returned address by its coin before handing it back (fail closed on a bad Bitcoin address).
const RE_BTC_DEP = /^((bc1|tb1)[a-z0-9]{8,87}|[123mn2][a-km-zA-HJ-NP-Z1-9]{25,39})$/;
async function createVault(template) {
  // create-curated generates deposit addresses server-side and can be slow.
  const j = await fetchJson(`${V2}/create-curated`, { method: 'POST', headers: KEY, body: template, timeout: 45000 });
  const v = j.data || j;
  if (v.err || v.error) throw new Error(v.err || v.error);
  const addresses = (v.addresses || []).map((a) => ({ coin: a.coin, address: a.address, path: a.path }));
  for (const a of addresses) {
    if (/btc|bitcoin/i.test(a.coin || '') && !RE_BTC_DEP.test(String(a.address || '').trim())) throw new Error('bad_deposit_address');
  }
  return { tokenId: v.tokenId, addresses, name: v.name, targetContract: v.targetContract };
}

// ── build on-chain calldata (client signs+broadcasts the returned tx) ──
// SECURITY (audit #3): validate the upstream signed-price response before turning it
// into calldata the user signs and PAYS for. Reject bad addresses / non-hex sigs and
// cap the ETH value (a compromised/MITM'd API can't silently drain the wallet).
const addr40 = (a) => /^0x[0-9a-fA-F]{40}$/.test(String(a));
const isHex = (s) => /^0x[0-9a-fA-F]*$/.test(String(s));
const MAX_PRICE_WEI = 10n * 10n ** 18n; // 10 ETH sanity ceiling for a vault mint/unvault
function checkPrice(p) { if (p < 0n || p > MAX_PRICE_WEI) throw new Error('price_out_of_range'); return p; }

async function buildMint(tokenId, signature, chainId = 1) {
  const r = await fetchJson(`${V2}/mint-curated`, { method: 'POST', headers: KEY, timeout: 30000, body: { method: 'buyWithSignedPrice', tokenId: String(tokenId), signature, chainId: String(chainId) } });
  if (r.error || r.err) throw new Error(r.error || r.err);
  if (!addr40(r._nftAddress) || !addr40(r._to)) throw new Error('bad_mint_address');
  if (!isHex(r._signature)) throw new Error('bad_mint_signature');
  const price = checkPrice(bn(r._price));
  const data = encodeCall(MINT_SIG, MINT_T, [r._nftAddress, ZERO, price, r._to, bn(r._tokenId), bn(r._nonce), r._signature, toBytes(r.serialNumber), 1n]);
  return { to: HANDLER, valueWei: toHexWei(price), data, priceWei: price.toString(), nftAddress: r._nftAddress, to_: r._to };
}

async function buildUnvault(tokenId, signature, chainId = 1) {
  const r = await fetchJson(`${V2}/unvault-curated`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: { method: 'unvaultWithSignedPrice', tokenId: String(tokenId), signature, chainId: String(chainId) } });
  if (!r.success) throw new Error(r.msg || r.err || 'unvault_rejected');
  if (!addr40(r._nftAddress)) throw new Error('bad_unvault_address');
  if (!isHex(r._signature)) throw new Error('bad_unvault_signature');
  const price = checkPrice(bn(r._price));
  const data = encodeCall(UNVAULT_SIG, UNVAULT_T, [r._nftAddress, bn(r._tokenId), bn(r._nonce), ZERO, price, r._signature, bn(r._timestamp)]);
  return { to: DIAMOND, valueWei: toHexWei(price), data, priceWei: price.toString() };
}

module.exports = { getCurated, getVaults, getBalance, createVault, buildMint, buildUnvault, HANDLER, DIAMOND, encodeCall };
