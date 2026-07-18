/* Wonder Wallet — unified activity / transaction history.
   Merges three views of an address's on-chain life:
     • Counterparty Core   → rich metaprotocol classification (send, dispenser, dividend, issuance,
                              sweep, destroy, order, mpma, fairmint, attach/detach, …) + confirm state.
     • mempool.space        → BTC confirmation status, block height/time, fee + vsize (for boosting),
                              and the address's net value delta (direction) — also surfaces plain BTC txs.
     • stampchain           → SRC-20 deploy / mint / transfer. There's no address-filtered SRC-20
                              history endpoint, so we look up each candidate BTC txid (src20/tx/:hash);
                              SRC-20 ops ride on tiny BTC txs, so this positively identifies them.
   Each item carries enough for the UI to label it and for CPFP boosting of anything unconfirmed. */
'use strict';
const { fetchJson, cacheGet, cacheSet } = require('./http');
const CP = process.env.CP_API || 'https://api.counterparty.io:4000/v2';
const MEMPOOL = process.env.BTC_API || 'https://mempool.space/api';
const STAMPS = process.env.STAMPS_API || 'https://stampchain.io/api/v2';

const vsizeOf = (weight) => Math.ceil((weight || 0) / 4);

// Look up which of the given txids are SRC-20 ops. No address feed exists, so probe each txid —
// concurrency-capped to stay gentle on stampchain. Returns { txid → {op, tick, amt, dest} }.
async function src20ForTxids(txids) {
  const out = {}; const ids = txids.slice(0, 60); const N = 8;
  const probe = async (id) => {
    try {
      const r = await fetchJson(`${STAMPS}/src20/tx/${id}`);
      const row = Array.isArray(r && r.data) ? r.data[0] : (r && r.data) || r;
      if (row && row.op) out[id] = { op: String(row.op).toLowerCase(), tick: row.tick, amt: row.amt, max: row.max, lim: row.lim, dest: row.destination };
    } catch (_) {}
  };
  for (let i = 0; i < ids.length; i += N) await Promise.all(ids.slice(i, i + N).map(probe));
  return out;
}

async function getActivity(address) {
  const key = `activity:${address}`;
  const hit = cacheGet(key);
  if (hit) return hit;

  const [cpConf, cpMem, btcTxs] = await Promise.all([
    fetchJson(`${CP}/addresses/${address}/transactions?verbose=true&limit=100`).catch(() => ({ result: [] })),
    fetchJson(`${CP}/addresses/${address}/mempool?verbose=true`).catch(() => ({ result: [] })),
    fetchJson(`${MEMPOOL}/address/${address}/txs`).catch(() => []),
  ]);

  // ── BTC layer: txid → status / fee / vsize / net delta for this address ──
  const btcMap = {};
  for (const t of (Array.isArray(btcTxs) ? btcTxs : [])) {
    const inSum = (t.vin || []).filter((v) => v.prevout && v.prevout.scriptpubkey_address === address).reduce((a, v) => a + (v.prevout.value || 0), 0);
    const outSum = (t.vout || []).filter((o) => o.scriptpubkey_address === address).reduce((a, o) => a + (o.value || 0), 0);
    const net = outSum - inSum; // >0 received · <0 sent
    const vsize = vsizeOf(t.weight);
    const rbf = (t.vin || []).some((v) => (v.sequence || 0) < 0xfffffffe);
    let ownVout = null;
    (t.vout || []).forEach((o, i) => { if (ownVout == null && o.scriptpubkey_address === address && (o.value || 0) > 1000) ownVout = { vout: i, value: o.value }; });
    btcMap[t.txid] = {
      confirmed: !!(t.status && t.status.confirmed), blockHeight: (t.status && t.status.block_height) || null, time: (t.status && t.status.block_time) || null,
      fee: t.fee || null, vsize, feeRate: t.fee && vsize ? +(t.fee / vsize).toFixed(2) : null, net, direction: net >= 0 ? 'in' : 'out', rbf, ownVout,
    };
  }

  const items = [], seen = new Set();
  const push = (it) => { if (!it.txid || seen.has(it.txid)) return; seen.add(it.txid); items.push(it); };
  const cpItem = (t, memp) => {
    const hash = t.tx_hash; if (!hash) return;
    const ud = t.unpacked_data || {}; const b = btcMap[hash] || {};
    push({
      txid: hash, source: 'cp', type: ud.message_type || 'counterparty', data: ud.message_data || {},
      confirmed: memp ? false : (b.confirmed != null ? b.confirmed : t.block_index != null),
      blockHeight: t.block_index || b.blockHeight || null, time: b.time || t.block_time || null,
      fee: b.fee, vsize: b.vsize, feeRate: b.feeRate, rbf: b.rbf, direction: b.direction, ownVout: b.ownVout || null,
    });
  };
  // Counterparty first (already classified).
  for (const t of (cpConf.result || [])) cpItem(t, false);
  for (const t of (cpMem.result || [])) cpItem(t, true);

  // Enrich the remaining BTC txs: which are SRC-20 ops vs plain BTC sends/receives?
  const btcTxids = Object.keys(btcMap).filter((id) => !seen.has(id));
  const src20 = await src20ForTxids(btcTxids);
  for (const txid of btcTxids) {
    const b = btcMap[txid], s = src20[txid];
    if (s) push({ txid, source: 'src20', type: 'src20_' + s.op, data: { op: s.op, tick: s.tick, amt: s.amt, max: s.max, lim: s.lim, to: s.dest }, confirmed: b.confirmed, blockHeight: b.blockHeight, time: b.time, fee: b.fee, vsize: b.vsize, feeRate: b.feeRate, rbf: b.rbf, direction: b.direction, ownVout: b.ownVout });
    else push({ txid, source: 'btc', type: b.direction === 'in' ? 'receive' : 'send', data: { amountSats: Math.abs(b.net) }, confirmed: b.confirmed, blockHeight: b.blockHeight, time: b.time, fee: b.fee, vsize: b.vsize, feeRate: b.feeRate, rbf: b.rbf, direction: b.direction, ownVout: b.ownVout });
  }

  // Unconfirmed first, then newest confirmed first.
  items.sort((a, b) => {
    if (!a.confirmed !== !b.confirmed) return a.confirmed ? 1 : -1;
    return (b.blockHeight || 9e9) - (a.blockHeight || 9e9) || (b.time || 0) - (a.time || 0);
  });
  const out = { address, items: items.slice(0, 120) };
  cacheSet(key, out, 45_000);
  return out;
}

module.exports = { getActivity };
