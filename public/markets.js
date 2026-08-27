/* Wonder Wallet — Counterparty Market (AMM). Phase 3: self-custodial Swap over the native
   TOKEN/XCP constant-product pools + DEX order book. We DON'T build a router — core's own
   /pools/{give}/{get}/quote prices the pool and book together and reports the split; a "market swap"
   is just a min-output DEX `order` (fills at the quoted rate or better, or rests). Every swap is
   composed → proven by the Phase-0 verifier → signed in your browser. Liquidity / Limit / Dispense
   tabs land next. */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const RE_ASSET = /^[A-Z0-9._]{1,30}$/;
  const SATS = 100000000;
  const toRaw = (human, divisible) => { const n = Number(human); if (!isFinite(n) || n <= 0) return null; return divisible ? String(Math.round(n * SATS)) : String(Math.round(n)); };
  const fromRaw = (raw, divisible) => { const n = Number(raw); if (!isFinite(n)) return '0'; return divisible ? (n / SATS) : n; };

  function modal(html) {
    let m = $('#mktModal');
    if (!m) { m = document.createElement('div'); m.id = 'mktModal'; m.className = 'modal'; m.innerHTML = '<div class="modal-card mkt-card" id="mktCard"></div>'; document.body.appendChild(m); m.addEventListener('click', (e) => { if (e.target.id === 'mktModal') close(); }); }
    $('#mktCard').innerHTML = html; m.hidden = false; return $('#mktCard');
  }
  // Closing the Market clears the session — no stale quote/qty when it's reopened (fresh estimates every time).
  function resetSession() {
    Object.assign(S, { sell: 'XCP', sellDiv: true, buy: '', buyDiv: true, amount: '', quote: null, quoteErr: false, slippage: 'auto',
      dispMode: 'buy', dispAsset: '', dispensers: null, dispErr: false, dispPick: 0, dispCount: 1, dispRecv: '', routeMode: 'auto', dispSel: null, sellAsset: '', sellComp: null });
    Object.assign(L, { dir: 'buy', token: '', tokenDiv: true, quote: 'XCP', quoteDiv: true, price: '', amount: '', bestBid: null, bestAsk: null, pool: null });
    Object.assign(Q, { sub: 'add', a: '', aDiv: true, b: 'XCP', bDiv: true, pool: null, loaded: false, amtA: '', amtB: '', lpAmt: '' });
    TABS = 'swap';
  }
  const close = () => { const m = $('#mktModal'); if (m) m.hidden = true; resetSession(); };
  let ONBACK = null; // optional caller-supplied "‹ Back" handler (set by open); e.g. the extension's Advanced Tools

  // Swap state: `sell`/`buy` are BOTH freely-chosen assets (Counterparty AMM + DEX support any pair, not
  // just TOKEN/XCP). Defaults to selling XCP; the middle ⇅ swaps the two sides.
  const S = { sell: 'XCP', sellDiv: true, buy: '', buyDiv: true, amount: '', quote: null, slippage: 'auto', feeRate: 6, fees: null, dispMode: 'buy', dispAsset: '', dispensers: null, dispErr: false, dispPick: 0, dispCount: 1, dispRecv: '', routeMode: 'auto', dispSel: null, sellAsset: '', sellComp: null };
  const assetSize = (a) => Math.max(5, Math.min(13, (a || '').length || 5)); // input width to fit the ticker
  const DISP_TX_VB = 154; // ~vsize of one dispense tx (1-2 inputs, dispenser payment + change) for miner-fee estimates
  const DIVCACHE = { XCP: true, BTC: true };
  let TABS = 'swap', BTCUSD = 0;
  // Pool-discovery / analytics state (Swap tab): the full pool directory, the chosen sort, and XCP/USD.
  let POOLS = null, POOLSORT = 'tvl', XCPUSD = 0;
  const ASSETINFO = {}; // asset → {assetId, supplyNorm, divisible, locked, issuer, firstIssuance} (cached)
  const cnum = (n, d = 8) => { const v = Number(n); return isFinite(v) ? v.toLocaleString('en-US', { maximumFractionDigits: d }) : '—'; };
  const kfmt = (n) => { const v = Number(n); if (!isFinite(v)) return '—'; if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B'; if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M'; if (v >= 1e3) return (v / 1e3).toFixed(1) + 'k'; return v.toLocaleString('en-US', { maximumFractionDigits: 2 }); };
  const ago = (unixSec) => { const s = Math.max(0, Math.floor(Date.now() / 1000 - Number(unixSec))); const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600); if (d > 0) return d + 'd ' + h + 'h ago'; const m = Math.floor((s % 3600) / 60); return h > 0 ? h + 'h ' + m + 'm ago' : m + 'm ago'; };
  const dateStr = (unixSec) => { try { return new Date(Number(unixSec) * 1000).toISOString().slice(0, 10); } catch (_) { return '—'; } };
  // XCP-side reserve of a pool (the TVL anchor). Returns null for non-XCP pairs (no XCP leg to price).
  const poolXcp = (p) => (p.b === 'XCP' ? Number(p.resB) : p.a === 'XCP' ? Number(p.resA) : null);
  const poolFunded = (p) => Number(p.resA) > 0 && Number(p.resB) > 0;

  async function loadPools(force) {
    if (POOLS && !force) return POOLS;
    try { const j = await fetch('api/cp/pools').then((r) => r.json()); POOLS = Array.isArray(j.result) ? j.result : []; } catch (_) { POOLS = []; }
    if (!XCPUSD) { try { const p = await fetch('api/prices').then((r) => r.json()); XCPUSD = Number(p && p.counterparty) || 0; } catch (_) {} }
    return POOLS;
  }
  async function assetInfo(a) {
    if (a in ASSETINFO) return ASSETINFO[a];
    let out = null; try { out = await fetch('api/cp/asset/' + encodeURIComponent(a)).then((r) => r.json()); } catch (_) {}
    ASSETINFO[a] = out; return out;
  }
  const nfmt = (n) => Number(n).toLocaleString('en-US');
  const usd = (sats) => { const u = (Number(sats) / SATS) * BTCUSD; return u ? ' ≈ $' + u.toLocaleString('en-US', { maximumFractionDigits: 2 }) : ''; };
  async function ensureBtcUsd() { if (!BTCUSD) { try { BTCUSD = Number((await fetch('api/prices').then((r) => r.json())).bitcoin) || 0; } catch (_) {} } }
  const feeUsdOf = (c) => (c && c.btc_fee != null ? usd(c.btc_fee) : '');

  async function divisible(asset) {
    if (asset in DIVCACHE) return DIVCACHE[asset];
    let d = true; try { const i = await fetch('api/cp/asset/' + encodeURIComponent(asset)).then((r) => r.json()); d = i && i.divisible != null ? !!i.divisible : true; } catch (_) {}
    DIVCACHE[asset] = d; return d;
  }
  const pair = () => ({ give: S.sell, giveDiv: S.sellDiv, get: S.buy, getDiv: S.buyDiv });

  let _qt = null;
  async function refreshQuote() {
    clearTimeout(_qt);
    S.quote = null; paintQuote();
    const p = pair(); if (!RE_ASSET.test(S.sell) || !RE_ASSET.test(S.buy) || S.sell === S.buy) return;
    const raw = toRaw(S.amount, p.giveDiv); if (!raw) return;
    _qt = setTimeout(async () => {
      const q = document.getElementById('mktQuote'); if (q) q.innerHTML = '<span class="fine">Quoting…</span>';
      S.quoteErr = false;
      try {
        const r = await fetch(`api/cp/pool/${encodeURIComponent(p.give)}/${encodeURIComponent(p.get)}/quote?quantity=${raw}`); const j = await r.json();
        if (!r.ok || j.error) throw new Error('upstream');
        S.quote = j.result || null;
      } catch (_) { S.quote = null; S.quoteErr = true; }
      paintQuote();
    }, 280);
  }

  function autoSlip() { const imp = S.quote && S.quote.price_impact ? Number(S.quote.price_impact) : 0; return Math.min(5, Math.max(0.5, Math.ceil(imp * 10) / 10)); }
  const slipPct = () => (S.slippage === 'auto' ? autoSlip() : Number(S.slippage));

  function paintQuote() {
    const box = document.getElementById('mktQuote'); const out = document.getElementById('mktGet'); if (!box) return;
    const p = pair(), q = S.quote;
    if (S.quoteErr) { box.innerHTML = `<div class="ob-err">Couldn't reach the Counterparty indexer to price this — retry in a moment.</div>`; if (out) out.value = ''; return; }
    if (!q) { box.innerHTML = ''; if (out) out.value = ''; return; }
    if (!q.pool_exists && !(q.estimated_output > 0)) { box.innerHTML = '<span class="warn" style="display:block">No pool or order-book liquidity for this pair yet.</span>'; if (out) out.value = ''; return; }
    const estHuman = fromRaw(q.estimated_output, p.getDiv);
    if (out) out.value = (typeof estHuman === 'number' ? estHuman.toLocaleString('en-US', { maximumFractionDigits: 8 }) : estHuman);
    const poolShare = q.estimated_output > 0 ? Math.round((Number(q.pool_output) / Number(q.estimated_output)) * 100) : 100;
    const route = poolShare >= 99 ? 'Pool' : poolShare <= 1 ? 'Order book' : `${poolShare}% pool · ${100 - poolShare}% book`;
    const minRecv = fromRaw(Math.floor(Number(q.estimated_output) * (1 - slipPct() / 100)), p.getDiv);
    const impact = Number(q.price_impact || 0);
    const impCls = impact >= 5 ? 'color:#e74c3c' : impact >= 3 ? 'color:var(--gold2)' : 'color:var(--muted2)';
    box.innerHTML = `<div class="mkt-qrow"><span>Route</span><b>${esc(route)}</b></div>
      <div class="mkt-qrow"><span>Price impact</span><b style="${impCls}">${impact.toFixed(2)}%</b></div>
      <div class="mkt-qrow"><span>Pool fee</span><b>${(Number(q.fee_bps || 50) / 100).toFixed(2)}%</b></div>
      <div class="mkt-qrow"><span>Min received</span><b>${typeof minRecv === 'number' ? minRecv.toLocaleString('en-US', { maximumFractionDigits: 8 }) : minRecv} ${esc(p.get)} <span class="fine">(${slipPct()}% slippage)</span></b></div>`;
  }

  function render() {
    const p = pair();
    modal(`<div class="cc-head">${ONBACK ? '<button class="p-ibtn" id="mktBack" title="Back">←</button>' : ''}<div style="flex:1;min-width:0"><h3 class="m-title" style="margin:0">Market</h3><div class="cp-addr">Counterparty AMM · self-custodial swaps over pool + order book</div></div><button class="m-close-x" id="mktX" title="Close" aria-label="Close">✕</button></div>
      <div class="lp-tabs">${[['swap', 'Swap'], ['liquidity', 'Liquidity'], ['limit', 'Limit'], ['dispense', 'Dispense']].map(([k, l]) => `<button class="lp-tab${k === TABS ? ' on' : ''}" data-tab="${k}">${l}</button>`).join('')}</div>
      <div id="mktBody"></div>`);
    $('#mktX').onclick = close;
    { const mb = $('#mktBack'); if (mb) mb.onclick = () => { close(); if (ONBACK) ONBACK(); }; }
    $('#mktCard').querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => { TABS = b.dataset.tab; render(); }));
    if (TABS === 'swap') renderSwap();
    else if (TABS === 'dispense') renderDispense();
    else if (TABS === 'limit') renderLimit();
    else if (TABS === 'liquidity') renderLiquidity();
  }

  // ── Limit orders (resting DEX order at a chosen price + cancel) — ANY asset/asset pair (incl BTC),
  //    not just TOKEN/XCP. `token` = base asset, `quote` = the priced-in asset. ──
  const L = { dir: 'buy', token: '', tokenDiv: true, quote: 'XCP', quoteDiv: true, price: '', amount: '', bestBid: null, bestAsk: null, pool: null };
  function renderLimit() {
    const baseL = L.token || 'TOKEN', quoteL = L.quote || 'XCP';
    $('#mktBody').innerHTML = `
      <div class="lp-tabs" style="margin-bottom:10px"><button class="lp-tab${L.dir === 'buy' ? ' on' : ''}" data-d="buy">Buy</button><button class="lp-tab${L.dir === 'sell' ? ' on' : ''}" data-d="sell">Sell</button></div>
      <div class="mkt-side"><div class="mkt-lbl">Pair</div><div class="mkt-in" style="gap:6px">
        <input id="limBase" class="mkt-tokenin" style="width:116px;text-align:left;font-size:15px" placeholder="TOKEN" spellcheck="false" value="${esc(L.token)}"/>
        <span style="color:var(--muted)">/</span>
        <input id="limQuote" class="mkt-tokenin" style="width:116px;text-align:left;font-size:15px" placeholder="XCP" spellcheck="false" value="${esc(L.quote)}"/></div></div>
      <div id="limBook" class="ob-box"></div>
      <div class="mkt-side"><div class="mkt-lbl">Price <button class="mini" id="limMkt" style="margin-left:6px" title="Fill best market price">Market</button></div><div class="mkt-in"><input id="limPrice" class="mkt-amt" type="number" min="0" step="any" placeholder="0.0" value="${esc(L.price)}"/><span class="mkt-asset" id="limPriceLbl">${esc(quoteL)} each</span></div></div>
      <div class="mkt-side"><div class="mkt-lbl">Amount</div><div class="mkt-in"><input id="limAmt" class="mkt-amt" type="number" min="0" step="any" placeholder="0.0" value="${esc(L.amount)}"/><span class="mkt-asset" id="limTokLbl">${esc(baseL)}</span></div></div>
      <div id="limTotal" class="lp-cost"></div>
      <div id="mktStatus" class="statusline" hidden></div>
      <div class="wbtns"><button class="primary" id="limGo">Review ${L.dir === 'buy' ? 'buy' : 'sell'} order</button></div>
      <div id="limOrders" style="margin-top:14px"></div>`;
    const base = $('#limBase'), quote = $('#limQuote'), pr = $('#limPrice'), am = $('#limAmt');
    const total = () => { const p = Number(pr.value), a = Number(am.value); const el = $('#limTotal'); if (el) el.innerHTML = (p > 0 && a > 0) ? `${L.dir === 'buy' ? 'Pay' : 'Receive'} <b>${(p * a).toLocaleString('en-US', { maximumFractionDigits: 8 })} ${esc(L.quote || 'XCP')}</b> for <b>${a.toLocaleString('en-US', { maximumFractionDigits: 8 })} ${esc(L.token || 'TOKEN')}</b> — rests until filled at your price or better` : ''; };
    // Update in place — do NOT re-render on every keystroke (destroys the input mid-typing). Debounce the book.
    let bookT;
    const upcase = (el, key) => { const up = el.value.toUpperCase(); if (el.value !== up) { const c = el.selectionStart; el.value = up; try { el.setSelectionRange(c, c); } catch (_) {} } L[key] = up.trim(); };
    const onPair = () => {
      const tl = $('#limTokLbl'); if (tl) tl.textContent = L.token || 'TOKEN';
      const pl = $('#limPriceLbl'); if (pl) pl.textContent = (L.quote || 'XCP') + ' each';
      total();
      clearTimeout(bookT);
      bookT = setTimeout(() => {
        if (!RE_ASSET.test(L.token)) { const b = $('#limBook'); if (b) b.innerHTML = ''; return; }
        divisible(L.token).then((d) => { L.tokenDiv = d; });
        if (RE_ASSET.test(L.quote) && L.token !== L.quote) { loadBook(); divisible(L.quote).then((d) => { L.quoteDiv = d; }); }
        else if (!L.quote) loadAllPairs();          // quote blank → list every market the base trades in
        else { const b = $('#limBook'); if (b) b.innerHTML = ''; }
      }, 350);
    };
    base.oninput = () => { upcase(base, 'token'); onPair(); };
    quote.oninput = () => { upcase(quote, 'quote'); onPair(); };
    pr.oninput = () => { L.price = pr.value; total(); }; am.oninput = () => { L.amount = am.value; total(); }; total();
    $('#mktCard').querySelectorAll('[data-d]').forEach((b) => (b.onclick = () => { L.dir = b.dataset.d; render(); }));
    $('#limGo').onclick = reviewLimit;
    const mk = $('#limMkt'); if (mk) mk.onclick = () => { const px = (L.dir === 'buy' ? L.bestAsk : L.bestBid) ?? L.pool; if (px && pr) { pr.value = Number(px).toFixed(8); L.price = pr.value; total(); } };
    if (RE_ASSET.test(L.token) && RE_ASSET.test(L.quote) && L.token !== L.quote) loadBook();
    else if (RE_ASSET.test(L.token) && !L.quote) loadAllPairs();
    loadOrders();
  }
  // Live order book + spread + AMM pool price for the entered pair (base/quote). Click a level to fill price.
  async function loadBook() {
    const box = $('#limBook'); if (!box) return;
    const base = L.token, quote = L.quote || 'XCP';
    box.innerHTML = '<div class="fine">Loading order book…</div>';
    let orders = [];
    try {
      const r = await fetch(`api/cp/book/${encodeURIComponent(base)}/${encodeURIComponent(quote)}`); const j = await r.json();
      if (!r.ok || j.error) throw new Error('upstream');
      orders = j.orders || [];
    } catch (_) {
      box.innerHTML = `<div class="acct-grp">Order book · ${esc(base)} / ${esc(quote)}</div><div class="ob-err">Couldn't reach the Counterparty indexer. <button class="mini" id="obRetry">Retry</button></div>`;
      const rb = $('#obRetry'); if (rb) rb.onclick = loadBook; return;
    }
    const bids = [], asks = [];
    for (const o of orders) {
      const gq = Number(o.give_quantity_normalized), tq = Number(o.get_quantity_normalized); // fixed order rate
      if (!(gq > 0) || !(tq > 0)) continue;
      if (o.give_asset === quote && o.get_asset === base) {          // bid: pay QUOTE for BASE
        const rem = Number(o.get_remaining != null ? o.get_remaining : tq); if (rem > 0) bids.push({ price: gq / tq, amount: rem });
      } else if (o.give_asset === base && o.get_asset === quote) {   // ask: sell BASE for QUOTE
        const rem = Number(o.give_remaining != null ? o.give_remaining : gq); if (rem > 0) asks.push({ price: tq / gq, amount: rem });
      }
    }
    bids.sort((a, b) => b.price - a.price); asks.sort((a, b) => a.price - b.price);
    L.bestBid = bids[0] ? bids[0].price : null; L.bestAsk = asks[0] ? asks[0].price : null;
    const spread = (L.bestBid && L.bestAsk) ? (L.bestAsk - L.bestBid) : null;
    const spreadPct = (spread != null && L.bestBid && L.bestAsk) ? (spread / ((L.bestBid + L.bestAsk) / 2)) * 100 : null;
    let pool = null;
    try { const p = await fetch(`api/cp/pool/${encodeURIComponent(base)}/${encodeURIComponent(quote)}`).then((r) => r.json()); if (p.result) { const pr = p.result, aQ = pr.asset_a === quote; const qr = Number(aQ ? pr.reserve_a_normalized : pr.reserve_b_normalized), br = Number(aQ ? pr.reserve_b_normalized : pr.reserve_a_normalized); pool = br > 0 ? qr / br : null; } } catch (_) {}
    L.pool = pool;
    const px = (v) => (v != null ? Number(v).toFixed(8) : '—');
    const lvl = (r, cls) => `<button class="ob-row ${cls}" data-p="${r.price}" data-amt="${r.amount}" data-side="${cls}"><span>${px(r.price)}</span><span>${r.amount.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span></button>`;
    box.innerHTML = `<div class="acct-grp">Order book · ${esc(base)} / ${esc(quote)}</div>
      <div class="ob-sum"><span>Bid <b class="up">${px(L.bestBid)}</b></span><span>Ask <b class="dn">${px(L.bestAsk)}</b></span><span>Spread <b>${spread != null ? px(spread) + (spreadPct != null ? ` (${spreadPct.toFixed(1)}%)` : '') : '—'}</b></span>${pool != null ? `<span>Pool <b>${px(pool)}</b></span>` : ''}</div>
      <div class="ob-levels">
        <div class="ob-asks">${asks.slice(0, 4).reverse().map((a) => lvl(a, 'ask')).join('') || '<div class="fine ob-none">no asks</div>'}</div>
        <div class="ob-bids">${bids.slice(0, 4).map((b) => lvl(b, 'bid')).join('') || '<div class="fine ob-none">no bids</div>'}</div>
      </div>`;
    // Tap a level to fill it: an ASK (someone selling BASE) ⇒ you BUY; a BID (someone buying BASE) ⇒ you
    // SELL. Fills direction + price + the level's available amount so you can go straight to Review.
    box.querySelectorAll('.ob-row[data-p]').forEach((rw) => (rw.onclick = () => {
      const price = Number(rw.dataset.p), amt = Number(rw.dataset.amt);
      L.dir = rw.dataset.side === 'ask' ? 'buy' : 'sell';
      L.price = String(price); L.amount = String(amt);
      const pr = $('#limPrice'), am = $('#limAmt'); if (pr) pr.value = Number(price).toFixed(8); if (am) am.value = amt;
      $('#mktCard').querySelectorAll('[data-d]').forEach((b) => b.classList.toggle('on', b.dataset.d === L.dir));
      const go = $('#limGo'); if (go) go.textContent = 'Review ' + (L.dir === 'buy' ? 'buy' : 'sell') + ' order';
      const el = $('#limTotal'); if (el) el.innerHTML = (price > 0 && amt > 0) ? `${L.dir === 'buy' ? 'Pay' : 'Receive'} <b>${(price * amt).toLocaleString('en-US', { maximumFractionDigits: 8 })} ${esc(L.quote || 'XCP')}</b> for <b>${amt.toLocaleString('en-US', { maximumFractionDigits: 8 })} ${esc(L.token || 'TOKEN')}</b> — rests until filled at your price or better` : '';
    }));
  }
  // All markets a single asset trades in (quote left blank) — tap a pair to load its book.
  async function loadAllPairs() {
    const box = $('#limBook'); if (!box) return;
    const base = L.token;
    box.innerHTML = `<div class="fine">Loading all ${esc(base)} markets…</div>`;
    let orders = [];
    try { orders = (await fetch('api/cp/assetbook/' + encodeURIComponent(base)).then((r) => r.json())).orders || []; } catch (_) {}
    const pairs = {};
    for (const o of orders) { const other = o.give_asset === base ? o.get_asset : o.get_asset === base ? o.give_asset : null; if (other) pairs[other] = (pairs[other] || 0) + 1; }
    const list = Object.keys(pairs).sort((a, b) => pairs[b] - pairs[a]);
    if (!list.length) { box.innerHTML = `<div class="acct-grp">${esc(base)} · markets</div><div class="fine">No open orders in any ${esc(base)} pair right now — enter a quote asset to start one.</div>`; return; }
    box.innerHTML = `<div class="acct-grp">${esc(base)} · open markets — tap a pair to load its book</div>`
      + list.map((qa) => `<button class="disp-opt" data-pair="${esc(qa)}" style="cursor:pointer"><span class="disp-give">${esc(base)} / ${esc(qa)}</span><span class="dex-rate">${pairs[qa]} order${pairs[qa] > 1 ? 's' : ''}</span></button>`).join('');
    box.querySelectorAll('[data-pair]').forEach((b) => (b.onclick = () => {
      L.quote = b.dataset.pair; const qi = $('#limQuote'); if (qi) qi.value = L.quote;
      const pl = $('#limPriceLbl'); if (pl) pl.textContent = L.quote + ' each';
      divisible(L.quote).then((d) => { L.quoteDiv = d; }); loadBook();
    }));
  }
  async function loadOrders() {
    const box = $('#limOrders'); if (!box) return;
    const src = window.WonderCpFlow && window.WonderCpFlow.activeSource(); if (!src) return;
    try {
      const j = await fetch('api/cp/myorders/' + encodeURIComponent(src)).then((r) => r.json());
      const orders = (j.orders || []); // any pair — no longer XCP-only
      if (!orders.length) { box.innerHTML = ''; return; }
      box.innerHTML = `<div class="acct-grp">Your open orders</div>` + orders.slice(0, 8).map((o) => `<div class="disp-opt" style="cursor:default"><span class="disp-give">${esc(o.give_asset)} ${esc(String(o.give_remaining))} → ${esc(o.get_asset)} ${esc(String(o.get_remaining))}</span><button class="mini" data-cancel="${esc(o.tx_hash)}">Cancel</button></div>`).join('');
      box.querySelectorAll('[data-cancel]').forEach((b) => (b.onclick = () => cancelOrder(b.dataset.cancel)));
    } catch (_) { box.innerHTML = ''; }
  }
  async function cancelOrder(hash) {
    const s = $('#mktStatus'); if (s) { s.hidden = false; s.className = 'statusline load'; s.textContent = 'Composing cancel…'; }
    try {
      const { compose } = await window.WonderCpFlow.composeVerify('cancel', { offer_hash: hash, sat_per_vbyte: S.feeRate }, { feeRatePerVb: S.feeRate });
      const { txid } = await window.WonderCpFlow.sign(compose);
      if (s) { s.className = 'statusline'; s.innerHTML = `Cancel sent ✓ — <a href="https://mempool.space/tx/${encodeURIComponent(txid)}" target="_blank" rel="noopener" style="color:var(--gold2)">${esc(String(txid).slice(0, 16))}…</a>`; }
      loadOrders();
    } catch (e) { if (s) { s.className = 'statusline err'; s.textContent = 'Failed: ' + (e.message || 'cancel error'); } }
  }
  async function reviewLimit() {
    const s = $('#mktStatus'); if (!s) return;
    const p = Number(L.price), a = Number(L.amount), base = L.token, quote = L.quote || 'XCP';
    if (!RE_ASSET.test(base) || !RE_ASSET.test(quote) || base === quote) { s.hidden = false; s.className = 'statusline err'; s.textContent = 'Enter two different assets for the pair.'; return; }
    if (!(p > 0) || !(a > 0)) { s.hidden = false; s.className = 'statusline err'; s.textContent = 'Enter a price and amount.'; return; }
    s.hidden = false; s.className = 'statusline load'; s.textContent = 'Composing & verifying…';
    try {
      const baseRaw = String(Math.round(a * (L.tokenDiv ? SATS : 1)));
      const quoteRaw = String(Math.round(p * a * (L.quoteDiv ? SATS : 1)));
      const params = L.dir === 'buy'
        ? { give_asset: quote, give_quantity: quoteRaw, get_asset: base, get_quantity: baseRaw, expiration: 8064, fee_required: 0, sat_per_vbyte: S.feeRate }
        : { give_asset: base, give_quantity: baseRaw, get_asset: quote, get_quantity: quoteRaw, expiration: 8064, fee_required: 0, sat_per_vbyte: S.feeRate };
      const { compose, report } = await window.WonderCpFlow.composeVerify('order', params, { feeRatePerVb: S.feeRate });
      await ensureBtcUsd();
      const feeSats = compose.btc_fee != null ? nfmt(compose.btc_fee) : '—';
      modal(`<div class="cc-head"><div><h3 class="m-title" style="margin:0">Confirm ${L.dir} order</h3><div class="cp-addr">${esc(base)} / ${esc(quote)} · limit</div></div></div>
        <div class="m-rows">
          <div class="m-row"><span class="k">${L.dir === 'buy' ? 'Buy' : 'Sell'}</span><span class="v">${a.toLocaleString('en-US', { maximumFractionDigits: 8 })} ${esc(base)}</span></div>
          <div class="m-row"><span class="k">Price</span><span class="v">${p.toLocaleString('en-US', { maximumFractionDigits: 8 })} ${esc(quote)} each</span></div>
          <div class="m-row"><span class="k">${L.dir === 'buy' ? 'Pay' : 'Receive'}</span><span class="v">${(p * a).toLocaleString('en-US', { maximumFractionDigits: 8 })} ${esc(quote)}</span></div>
          <div class="m-row"><span class="k">Miner fee</span><span class="v">${feeSats} sats${feeUsdOf(compose)}</span></div>
        </div>
        ${window.WonderVerify.bannerHtml(report)}
        <div class="fine" style="margin-top:8px">Rests on the Counterparty DEX; if an AMM pool exists for this pair it fills automatically when its price crosses yours.</div>
        <div id="limcStatus" class="statusline" hidden></div>
        <div class="wbtns"><button class="ghost" id="limcBack">Back</button><button class="primary" id="limcGo">Sign &amp; place</button></div>`);
      $('#limcBack').onclick = () => render();
      $('#limcGo').onclick = async () => {
        const cs = $('#limcStatus'); cs.hidden = false; cs.className = 'statusline load'; cs.textContent = 'Signing & broadcasting…';
        try { const { txid } = await window.WonderCpFlow.sign(compose); cs.className = 'statusline'; cs.innerHTML = `Order placed ✓ — <a href="https://mempool.space/tx/${encodeURIComponent(txid)}" target="_blank" rel="noopener" style="color:var(--gold2)">${esc(String(txid).slice(0, 18))}…</a>`; sealBroadcast(); }
        catch (e) { cs.className = 'statusline err'; cs.textContent = 'Failed: ' + (e.message || 'sign/broadcast error'); }
      };
    } catch (e) { s.className = 'statusline err'; s.textContent = /insufficient/i.test(e.message || '') ? `Not enough ${L.dir === 'buy' ? quote : base} to place this order.` : (e.message || 'Compose/verify failed.'); }
  }

  // ── Dispense (buy from dispensers cheapest-first · or create one to sell) ──
  function renderDispense() {
    $('#mktBody').innerHTML = `
      <div class="lp-tabs" style="margin-bottom:10px"><button class="lp-tab${S.dispMode === 'buy' ? ' on' : ''}" data-dm="buy">Buy</button><button class="lp-tab${S.dispMode === 'sell' ? ' on' : ''}" data-dm="sell">Sell · create</button></div>
      <div id="dispModeBody"></div>
      <div id="mktStatus" class="statusline" hidden></div>`;
    $('#mktCard').querySelectorAll('[data-dm]').forEach((b) => (b.onclick = () => { S.dispMode = b.dataset.dm; renderDispense(); }));
    if (S.dispMode === 'sell') renderDispenseSell(); else renderDispenseBuy();
  }
  function renderDispenseBuy() {
    $('#dispModeBody').innerHTML = `
      <div class="mkt-side"><div class="mkt-lbl">Buy from dispensers</div>
        <div class="mkt-in"><input id="dispAsset" class="mkt-tokenin" style="width:150px;text-align:left;font-size:15px" placeholder="ASSET name" spellcheck="false" value="${esc(S.dispAsset)}"/><button class="ghost sm" id="dispFind">Find</button></div></div>
      <div class="disp-cols"><div id="dispBuy"></div><div id="dispList"></div></div>`;
    const el = $('#dispAsset');
    $('#dispFind').onclick = findDispensers;
    el.onkeydown = (e) => { if (e.key === 'Enter') findDispensers(); };
    if (S.dispAsset && S.dispensers) paintDispensers();
  }
  // Create a dispenser to SELL an asset — competition-aware (buyers fill cheapest first).
  function renderDispenseSell() {
    $('#dispModeBody').innerHTML = `
      <div class="mkt-side"><div class="mkt-lbl">Asset to sell</div><div class="mkt-in"><input id="sellAsset" class="mkt-tokenin" style="width:150px;text-align:left;font-size:15px" placeholder="ASSET" spellcheck="false" value="${esc(S.sellAsset)}"/><button class="ghost sm" id="sellCheck">Check</button></div></div>
      <div id="sellComp" class="lp-cost"></div>
      <div class="mkt-side"><div class="mkt-lbl">Give per dispense</div><div class="mkt-in"><input id="sellGive" class="mkt-amt" type="number" min="0" step="any" placeholder="0.0"/><span class="mkt-asset">${esc(S.sellAsset || 'units')}</span></div></div>
      <div class="mkt-side"><div class="mkt-lbl">Total to escrow</div><div class="mkt-in"><input id="sellEscrow" class="mkt-amt" type="number" min="0" step="any" placeholder="0.0"/><span class="mkt-asset">${esc(S.sellAsset || 'total')}</span></div></div>
      <div class="mkt-side"><div class="mkt-lbl">Price per dispense</div><div class="mkt-in"><input id="sellRate" class="mkt-amt" type="number" min="1" step="1" placeholder="sats"/><span class="mkt-asset">sats</span></div></div>
      <div class="lp-presets" id="sellPresets"></div>
      <div class="wbtns" style="margin-top:10px"><button class="primary" id="sellGo">Review dispenser</button></div>`;
    const a = $('#sellAsset');
    $('#sellCheck').onclick = checkComp; a.onkeydown = (e) => { if (e.key === 'Enter') checkComp(); };
    $('#sellGo').onclick = doSellDispenser;
    if (S.sellAsset && S.sellComp != null) paintComp();
  }
  async function checkComp() {
    const a = $('#sellAsset'); S.sellAsset = (a.value || '').trim().toUpperCase(); a.value = S.sellAsset;
    if (!RE_ASSET.test(S.sellAsset)) return;
    const c = $('#sellComp'); if (c) c.textContent = 'Checking the competition…';
    try { const j = await fetch('api/cp/asset-dispensers/' + encodeURIComponent(S.sellAsset)).then((r) => r.json()); S.sellComp = (j.dispensers || []); } catch (_) { S.sellComp = []; }
    renderDispenseSell();
  }
  function paintComp() {
    const c = $('#sellComp'); const pre = $('#sellPresets'); if (!c) return;
    const cheapest = S.sellComp.length ? S.sellComp[0].satoshirate : 0;
    c.innerHTML = cheapest ? `Competition · cheapest is <b>${nfmt(cheapest)} sats</b> per dispense${usd(cheapest)}. Buyers fill cheapest first, so undercut or match to sell.` : `No competing dispensers for ${esc(S.sellAsset)} — you set the price.`;
    if (pre && cheapest) { pre.innerHTML = [['Floor', cheapest], ['−1', Math.max(1, cheapest - 1)], ['+10%', Math.ceil(cheapest * 1.1)]].map(([l, v]) => `<button class="mini" data-rate="${v}">${l} (${nfmt(v)})</button>`).join(''); pre.querySelectorAll('[data-rate]').forEach((b) => (b.onclick = () => { const r = $('#sellRate'); if (r) r.value = b.dataset.rate; })); }
  }
  async function doSellDispenser() {
    const s = $('#mktStatus'); if (!s) return;
    const asset = S.sellAsset, give = Number($('#sellGive').value), escrow = Number($('#sellEscrow').value), rate = Number($('#sellRate').value);
    if (!RE_ASSET.test(asset)) { s.hidden = false; s.className = 'statusline err'; s.textContent = 'Enter the asset to sell.'; return; }
    if (!(give > 0) || !(escrow > 0) || !(rate >= 1)) { s.hidden = false; s.className = 'statusline err'; s.textContent = 'Enter give-per-dispense, total to escrow, and a price (sats).'; return; }
    s.hidden = false; s.className = 'statusline load'; s.textContent = 'Composing & verifying…';
    try {
      const div = await divisible(asset);
      const params = { asset, give_quantity: String(Math.round(give * (div ? SATS : 1))), escrow_quantity: String(Math.round(escrow * (div ? SATS : 1))), mainchainrate: String(Math.round(rate)), status: 0, sat_per_vbyte: S.feeRate };
      const { compose, report } = await window.WonderCpFlow.composeVerify('dispenser', params, { feeRatePerVb: S.feeRate });
      await ensureBtcUsd();
      const feeSats = compose.btc_fee != null ? nfmt(compose.btc_fee) : '—';
      const dispenses = Math.floor(escrow / give) || 0;
      modal(`<div class="cc-head"><div><h3 class="m-title" style="margin:0">Confirm dispenser</h3><div class="cp-addr">Selling ${esc(asset)}</div></div></div>
        <div class="m-rows">
          <div class="m-row"><span class="k">Give per dispense</span><span class="v">${give.toLocaleString('en-US', { maximumFractionDigits: 8 })} ${esc(asset)}</span></div>
          <div class="m-row"><span class="k">Escrow</span><span class="v">${escrow.toLocaleString('en-US', { maximumFractionDigits: 8 })} ${esc(asset)} (~${dispenses} dispenses)</span></div>
          <div class="m-row"><span class="k">Price</span><span class="v">${nfmt(rate)} sats each${usd(rate)}</span></div>
          <div class="m-row"><span class="k">Miner fee</span><span class="v">${feeSats} sats${feeUsdOf(compose)}</span></div>
        </div>
        ${window.WonderVerify.bannerHtml(report)}
        <div class="fine" style="margin-top:8px">Buyers send BTC to your address to trigger a dispense. You can close it anytime to reclaim the escrow.</div>
        <div id="selcStatus" class="statusline" hidden></div>
        <div class="wbtns"><button class="ghost" id="selcBack">Back</button><button class="primary" id="selcGo">Sign &amp; create</button></div>`);
      $('#selcBack').onclick = () => render();
      $('#selcGo').onclick = async () => {
        const cs = $('#selcStatus'); cs.hidden = false; cs.className = 'statusline load'; cs.textContent = 'Signing & broadcasting…';
        try { const { txid } = await window.WonderCpFlow.sign(compose); cs.className = 'statusline'; cs.innerHTML = `Dispenser created ✓ — <a href="https://mempool.space/tx/${encodeURIComponent(txid)}" target="_blank" rel="noopener" style="color:var(--gold2)">${esc(String(txid).slice(0, 18))}…</a>`; sealBroadcast(); }
        catch (e) { cs.className = 'statusline err'; cs.textContent = 'Failed: ' + (e.message || 'sign/broadcast error'); }
      };
    } catch (e) { s.className = 'statusline err'; s.textContent = /insufficient|doesn.?t have|does not have/i.test(e.message || '') ? `You don't hold enough ${asset} to escrow that amount.` : (e.message || 'Compose/verify failed.'); }
  }
  async function findDispensers() {
    const el = $('#dispAsset'); S.dispAsset = (el.value || '').trim().toUpperCase(); el.value = S.dispAsset;
    if (!RE_ASSET.test(S.dispAsset)) return;
    const list = $('#dispList'); if (list) list.innerHTML = '<div class="fine">Finding dispensers…</div>';
    S.dispErr = false;
    try {
      const r = await fetch('api/cp/asset-dispensers/' + encodeURIComponent(S.dispAsset)); const j = await r.json();
      if (!r.ok || j.error) throw new Error('upstream');
      S.dispensers = j.dispensers || [];
    } catch (_) { S.dispensers = []; S.dispErr = true; }
    S.dispPick = 0; S.dispCount = 1; paintDispensers();
  }
  // Fee-aware routing across open dispensers (they ARE the order book). Fill a target receive amount
  // by whole dispenses, minimizing TOTAL outlay = dispenser payments + miner fees (each dispenser is a
  // separate tx). A shallow cheap dispenser that adds a whole tx fee for a few units can lose to a
  // single deeper dispenser that finishes the order in one tx — so we don't just take cheapest-per-unit.
  // Reports effective avg price + "% over floor" (the slippage) the way a Uniswap route would.
  function routeBuy(dispensers, target, opts) {
    opts = opts || {};
    const all = (dispensers || []).map((d) => ({ address: d.address, rate: Number(d.satoshirate), give: Number(d.giveQty), remaining: Number(d.remaining) }))
      .filter((d) => d.give > 0 && d.rate > 0 && d.remaining >= d.give)
      .map((d) => ({ ...d, unit: d.rate / d.give, wholeRem: Math.floor(d.remaining / d.give + 1e-9) * d.give }))
      .sort((a, b) => a.unit - b.unit || a.rate - b.rate);
    const T = Number(target) || 0;
    const feePerTx = DISP_TX_VB * S.feeRate;
    const bookTotal = all.reduce((s, d) => s + d.wholeRem, 0);
    // Market floor = the cheapest per-unit dispenser holding a non-trivial share of the book (>= 1% of
    // total open depth). Anything priced BELOW that while holding a sliver is a floor-pin / spam dispenser
    // (undercut the market with ~1 unit to drag the displayed floor down) — we HIDE it from the book and
    // never route through it. `floorUnit` is this market floor, so "% over floor" reflects the real book.
    const floorDepth = Math.max(1, 0.01 * bookTotal);
    const mf = all.find((d) => d.wholeRem >= floorDepth - 1e-9);
    const floorUnit = mf ? mf.unit : (all[0] ? all[0].unit : null);
    const visible = all.filter((d) => floorUnit == null || d.unit >= floorUnit - 1e-9);
    // Routing pool = visible dispensers, optionally restricted to a user's custom selection.
    const pool = opts.allowed ? visible.filter((d) => opts.allowed.has(d.address)) : visible;
    const fillFrom = (d, units) => { const disp = Math.min(Math.floor(d.wholeRem / d.give + 1e-9), Math.max(1, Math.ceil((units - 1e-9) / d.give))); return { address: d.address, rate: d.rate, give: d.give, dispenses: disp, filled: disp * d.give, sats: disp * d.rate }; };
    const cost = (sl) => sl.reduce((s, x) => s + x.sats, 0) + sl.length * feePerTx; // total outlay incl miner fees
    const fillOf = (sl) => sl.reduce((s, x) => s + x.filled, 0);
    // Candidate 1: pure cheapest-first greedy (min asset cost, max depth if unfillable).
    const greedy = (() => { let need = T; const sl = []; for (const d of pool) { if (need <= 1e-9) break; const s = fillFrom(d, need); sl.push(s); need -= s.filled; } return sl; })();
    const candidates = [greedy];
    // In AUTO mode only, also try: take the k cheapest dispensers fully, then finish the remainder with the
    // SINGLE cheapest dispenser deep enough to cover it in one tx (trades a per-unit premium for a saved
    // fee). Custom mode uses exactly the picked set, so no auto substitution.
    if (!opts.allowed) {
      const prefix = []; let cum = 0;
      for (let k = 0; k < pool.length; k++) {
        const need = T - cum; if (need <= 1e-9) break;
        for (let j = k; j < pool.length; j++) { if (pool[j].wholeRem >= need - 1e-9) { candidates.push(prefix.concat([fillFrom(pool[j], need)])); break; } }
        prefix.push(fillFrom(pool[k], pool[k].wholeRem)); cum += pool[k].wholeRem;
      }
    }
    // Choose: among candidates that meet the target, the min total outlay; else the deepest fill (greedy).
    const fillers = candidates.filter((sl) => fillOf(sl) >= T - 1e-9);
    const slices = fillers.length ? fillers.reduce((a, b) => (cost(a) <= cost(b) ? a : b)) : greedy;
    const totalFilled = fillOf(slices);
    const totalSats = slices.reduce((s, x) => s + x.sats, 0);
    const avgUnit = totalFilled > 0 ? totalSats / totalFilled : null;
    const overFloorPct = (avgUnit != null && floorUnit) ? (avgUnit / floorUnit - 1) * 100 : null;
    const bookDepth = visible.reduce((s, d) => s + d.wholeRem, 0);
    // Was a fee-aware route chosen over the naive cheapest-first? (for a transparency hint)
    const greedyFills = fillOf(greedy) >= T - 1e-9;
    const savedVsGreedy = greedyFills ? Math.max(0, Math.round(cost(greedy) - cost(slices))) : 0;
    return { slices, totalFilled, totalSats, floorUnit, avgUnit, overFloorPct, txs: slices.length, shortfall: Math.max(0, T - totalFilled), bookDepth, sorted: visible, feePerTx, minerSats: slices.length * feePerTx, savedVsGreedy, totalCost: totalSats + slices.length * feePerTx };
  }
  function roundStep(v, step) { return step > 0 ? Math.max(step, Math.floor(v / step) * step) : v; }
  function paintDispensers() {
    const list = $('#dispList'), card = $('#dispBuy'); if (!list) return;
    if (S.dispErr) { list.innerHTML = `<div class="ob-err">Couldn't reach the Counterparty indexer — this is a connection issue, not a definitive "none." <button class="mini" id="dispRetry">Retry</button></div>`; const rb = $('#dispRetry'); if (rb) rb.onclick = findDispensers; if (card) card.innerHTML = ''; return; }
    if (!S.dispensers || !S.dispensers.length) { list.innerHTML = `<div class="dash-empty">No open dispensers for ${esc(S.dispAsset)} right now. A dispenser sends you this asset when you pay BTC to its address — none are open for it at the moment (oracle-priced dispensers are hidden here). You can also check the AMM pool + DEX via <b>Swap</b>.</div>`; if (card) card.innerHTML = ''; return; }
    const cheapest = routeBuy(S.dispensers, Infinity).sorted[0];
    if ((!S.dispRecv || Number(S.dispRecv) <= 0) && cheapest) S.dispRecv = String(cheapest.give);
    paintRoute();
  }
  // Uniswap-style buy card: enter a target, see the cheapest-first route (send BTC, avg price,
  // % over floor / slippage, tx count, miner fee) + the dispenser order book with used rows lit.
  // AUTO picks the cheapest all-in route; CUSTOM lets you click dispensers and quote your own route.
  function paintRoute() {
    const card = $('#dispBuy'), list = $('#dispList'); if (!card || !list) return;
    // Re-rendering the card replaces the amount input, which would drop focus mid-typing. Remember if it
    // was focused (and the caret) so we can restore it after the rebuild — lets you type "100" in one go.
    const keepFocus = document.activeElement && document.activeElement.id === 'dispRecv';
    const caret = keepFocus ? document.activeElement.selectionStart : null;
    const asset = S.dispAsset, target = Number(S.dispRecv) || 0;
    const auto = routeBuy(S.dispensers, target);
    const custom = S.routeMode === 'custom';
    if (custom && !S.dispSel) S.dispSel = new Set(auto.slices.map((s) => s.address)); // seed from the auto route
    const r = custom ? routeBuy(S.dispensers, target, { allowed: S.dispSel }) : auto;
    const step = auto.sorted.length ? auto.sorted[0].give : 1, maxRecv = auto.bookDepth;
    const rateLine = (target > 0 && r.avgUnit != null)
      ? `1 ${esc(asset)} = <b>${nfmt(Math.round(r.avgUnit))} sats</b>${usd(r.avgUnit)}${r.overFloorPct != null ? ` · <span class="${r.overFloorPct > 0.5 ? 'over' : 'up'}">${r.overFloorPct.toFixed(r.overFloorPct < 10 ? 1 : 0)}% over floor</span>` : ''}`
      : (custom ? 'Pick dispensers below to build your route.' : 'Enter an amount to route across the book.');
    const routesLine = r.slices.length ? `${r.txs} tx${r.txs > 1 ? 's' : ''} · ${r.slices.map((s) => nfmt(s.filled)).join(' + ')} ${esc(asset)}` : '—';
    const minerSats = r.minerSats;
    const totalOutlay = r.totalSats + minerSats;
    const delta = custom ? Math.round(r.totalCost - auto.totalCost) : 0; // custom vs the cheapest auto route
    card.innerHTML = `
      <div class="ds-modes"><button class="ds-mode${!custom ? ' on' : ''}" data-rm="auto">Auto</button><button class="ds-mode${custom ? ' on' : ''}" data-rm="custom">Custom</button>${custom ? `<button class="mini ds-reset" id="dispReset" title="Reset to the cheapest auto route">reset</button>` : ''}</div>
      <div class="disp-swap">
        <div class="ds-side"><div class="ds-lbl">You receive</div>
          <div class="ds-row"><input id="dispRecv" class="ds-amt" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" placeholder="0" value="${esc(S.dispRecv)}"/><span class="ds-asset">${esc(asset)}</span></div>
          <div class="ds-presets" id="dispPresets"></div></div>
        <div class="ds-arrow">↓</div>
        <div class="ds-side"><div class="ds-lbl">You send</div>
          <div class="ds-row"><span class="ds-amt ds-out">${(r.totalSats / SATS).toFixed(8)}</span><span class="ds-asset">BTC</span></div>
          <div class="ds-sub">${nfmt(r.totalSats)} sats${usd(r.totalSats)}</div></div>
      </div>
      <div class="ds-rate">${rateLine}</div>
      <div class="ds-meta">
        <div><span>Routes</span><b>${routesLine}</b></div>
        <div><span>You get</span><b>${nfmt(r.totalFilled)} ${esc(asset)}</b></div>
        <div><span>Miner fees · ${r.txs} tx${r.txs > 1 ? 's' : ''}</span><b>~${nfmt(minerSats)} sats${usd(minerSats)}</b></div>
        <div><span>Total cost</span><b>${nfmt(totalOutlay)} sats${usd(totalOutlay)}</b></div>
      </div>
      ${custom && r.slices.length ? `<div class="fine ${delta > 0 ? 'over' : 'up'}">vs. Auto (cheapest): ${delta > 0 ? `+${nfmt(delta)} sats${usd(delta)} more` : delta < 0 ? `${nfmt(-delta)} sats${usd(-delta)} cheaper` : 'same total'} — ${auto.txs} tx auto vs ${r.txs} tx here.</div>` : ''}
      ${!custom && r.savedVsGreedy > 0 ? `<div class="fine up">Fee-aware route: finishing with a deeper dispenser saves ~${nfmt(r.savedVsGreedy)} sats${usd(r.savedVsGreedy)} vs. the naive cheapest-first split.</div>` : ''}
      ${r.shortfall > 1e-7 && target > 0 ? `<div class="fine over">${custom ? 'Your selected dispensers' : 'Book depth'} only cover ${nfmt(r.totalFilled)} ${esc(asset)}${custom ? ' — pick more dispensers below' : ` — not enough open dispensers to fully fill ${nfmt(target)}`}.</div>` : ''}
      <div class="wbtns" style="margin-top:10px"><button class="primary" id="dispGo"${r.slices.length ? '' : ' disabled'}>${r.txs > 1 ? `Review buy · ${r.txs} txs` : 'Review buy'}</button></div>
      <div class="fine">${custom ? 'Custom route: tap dispensers below to include/exclude them. Each dispenser is a separate Bitcoin payment.' : 'Auto picks the cheapest all-in route (dispenser prices + miner fees). Switch to Custom to choose your own dispensers.'}</div>`;
    card.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => { if (S.routeMode !== b.dataset.rm) { S.routeMode = b.dataset.rm; if (b.dataset.rm === 'auto') S.dispSel = null; paintRoute(); } }));
    const rst = $('#dispReset'); if (rst) rst.onclick = () => { S.dispSel = new Set(auto.slices.map((s) => s.address)); paintRoute(); };
    const pre = $('#dispPresets');
    if (pre) {
      const opts = [['1×', step], ['10×', step * 10], ['Half', roundStep(maxRecv / 2, step)], ['Max', maxRecv]].filter(([, v]) => v > 0 && v <= maxRecv);
      pre.innerHTML = opts.map(([l, v]) => `<button class="mini" data-recv="${v}">${l}</button>`).join('');
      pre.querySelectorAll('[data-recv]').forEach((b) => (b.onclick = () => { S.dispRecv = String(b.dataset.recv); paintRoute(); }));
    }
    const inp = $('#dispRecv');
    if (inp) inp.oninput = () => { const c = inp.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1'); if (c !== inp.value) inp.value = c; S.dispRecv = c; paintRoute(); };
    const go = $('#dispGo'); if (go && r.slices.length) go.onclick = () => reviewRoute(r);
    if (keepFocus && inp) { inp.focus(); try { const p = caret == null ? inp.value.length : Math.min(caret, inp.value.length); inp.setSelectionRange(p, p); } catch (_) {} }
    // order book — dispensers cheapest-first; rows filling the order are highlighted with partial amounts.
    // In custom mode, rows are tappable to include/exclude and show a check.
    const usedBy = {}; r.slices.forEach((s) => { usedBy[s.address] = s; });
    list.innerHTML = `<div class="acct-grp">Dispensers · cheapest first${custom ? ' · tap to pick' : ''}</div>` + auto.sorted.slice(0, 14).map((d) => {
      const u = usedBy[d.address], sel = custom && S.dispSel && S.dispSel.has(d.address);
      return `<div class="ob-drow${u ? ' used' : ''}${custom ? ' pick' : ''}${sel ? ' sel' : ''}"${custom ? ` data-addr="${esc(d.address)}"` : ''}>${custom ? `<span class="ob-check">${sel ? '✓' : ''}</span>` : ''}<span class="ob-drate">${nfmt(d.rate)} <em>sats</em>${d.give !== 1 ? ` <em>/ ${nfmt(d.give)}</em>` : ''}</span><span class="ob-damt">${u ? `<b>${nfmt(u.filled)}</b> of ${nfmt(d.wholeRem)}` : nfmt(d.wholeRem)} ${esc(asset)}</span></div>`;
    }).join('') + `<div class="fine ob-foot">${custom ? 'Ticked rows are in your route.' : 'Lit rows fill your order.'} Total open: ${nfmt(maxRecv)} ${esc(asset)}.</div>`;
    if (custom) list.querySelectorAll('[data-addr]').forEach((row) => (row.onclick = () => {
      const a = row.dataset.addr; if (!S.dispSel) S.dispSel = new Set();
      if (S.dispSel.has(a)) S.dispSel.delete(a); else S.dispSel.add(a); paintRoute();
    }));
  }
  function reviewRoute(r) {
    if (!r.slices.length) return; const asset = S.dispAsset;
    modal(`<div class="cc-head"><div><h3 class="m-title" style="margin:0">Confirm buy</h3><div class="cp-addr">${esc(asset)} · ${r.txs} dispenser${r.txs > 1 ? 's' : ''} · cheapest-first</div></div></div>
      <div class="m-rows">
        <div class="m-row"><span class="k">Receive</span><span class="v">${nfmt(r.totalFilled)} ${esc(asset)}</span></div>
        <div class="m-row"><span class="k">Pay</span><span class="v">${nfmt(r.totalSats)} sats${usd(r.totalSats)}</span></div>
        <div class="m-row"><span class="k">Avg price</span><span class="v">${nfmt(Math.round(r.avgUnit))} sats / ${esc(asset)}${r.overFloorPct != null ? ` · ${r.overFloorPct.toFixed(1)}% over floor` : ''}</span></div>
        <div class="m-row"><span class="k">Transactions</span><span class="v">${r.txs} — each dispenser paid separately</span></div>
      </div>
      <div id="routeProg" class="ds-prog"></div>
      ${r.txs > 1 ? `<div class="fine over" style="margin-top:6px">A deep route sends ${r.txs} Bitcoin transactions, one per dispenser. Each is verified before signing. If a later leg can't fund yet (e.g. your BTC is one coin still confirming), earlier legs stand and you get a partial fill you can finish later.</div>` : ''}
      <div id="dispcStatus" class="statusline" hidden></div>
      <div class="wbtns"><button class="ghost" id="dispcBack">Back</button><button class="primary" id="dispcGo">Sign &amp; buy${r.txs > 1 ? ` · ${r.txs} txs` : ''}</button></div>`);
    $('#dispcBack').onclick = () => render();
    $('#dispcGo').onclick = () => executeRoute(r);
  }
  // Execute the route as sequential dispense txs (one per dispenser). No unconfirmed-change chaining —
  // each leg composes from the wallet's confirmed UTXOs and passes through the fail-closed verifier,
  // so a leg that can't fund yet stops cleanly with a reported partial fill instead of a bad sign.
  async function executeRoute(r) {
    const cs = $('#dispcStatus'), prog = $('#routeProg'), go = $('#dispcGo'), back = $('#dispcBack');
    if (go) go.disabled = true; if (back) back.disabled = true;
    const sent = [];
    for (let i = 0; i < r.slices.length; i++) {
      const s = r.slices[i];
      if (cs) { cs.hidden = false; cs.className = 'statusline load'; cs.textContent = `Composing & signing tx ${i + 1} of ${r.slices.length}…`; }
      try {
        const { compose } = await window.WonderCpFlow.composeVerify('dispense', { dispenser: s.address, quantity: s.sats, sat_per_vbyte: S.feeRate }, { dests: [s.address], allowed: [s.address], feeRatePerVb: S.feeRate });
        const { txid } = await window.WonderCpFlow.sign(compose);
        sent.push({ txid, slice: s });
        if (prog) prog.innerHTML = sent.map((x, k) => `<div class="ds-progrow">✓ tx ${k + 1}: ${nfmt(x.slice.filled)} ${esc(S.dispAsset)} — <a href="https://mempool.space/tx/${encodeURIComponent(x.txid)}" target="_blank" rel="noopener" style="color:var(--gold2)">${esc(String(x.txid).slice(0, 12))}…</a></div>`).join('');
      } catch (e) {
        if (cs) { cs.className = 'statusline err'; cs.textContent = `Stopped at tx ${i + 1}/${r.slices.length}: ${friendlyDisp(e)}.${sent.length ? ` ${sent.length} tx${sent.length > 1 ? 's' : ''} already sent — partial fill; retry the rest once your coins confirm.` : ''}`; }
        // If anything was broadcast it's irreversible — seal the screen (Close, no Back). Otherwise the
        // user can still go back and adjust, so just re-enable Back.
        if (sent.length) sealBroadcast(); else if (back) back.disabled = false;
        return;
      }
    }
    if (cs) { cs.className = 'statusline'; cs.innerHTML = `Bought ✓ — ${sent.length} tx${sent.length > 1 ? 's' : ''} sent · ${nfmt(r.totalFilled)} ${esc(S.dispAsset)}. Each dispenser sends your asset as its tx confirms.`; }
    sealBroadcast(); // broadcast done — there's no going back; swap Back→Close + add an X
  }
  // Once a tx has hit the network the action can't be undone. Replace the confirm screen's Back/Sign row
  // with a single Close, and drop an ✕ in the header — both dismiss (and reset) the session.
  function sealBroadcast() {
    const head = document.querySelector('#mktCard .cc-head');
    if (head && !head.querySelector('.mkt-x')) {
      const x = document.createElement('button');
      x.type = 'button'; x.className = 'mkt-x'; x.textContent = '×'; x.title = 'Close'; x.setAttribute('aria-label', 'Close');
      x.onclick = close; head.appendChild(x);
    }
    const btns = document.querySelector('#mktCard .wbtns');
    if (btns) { btns.innerHTML = '<button class="primary" id="dispcClose">Close</button>'; const c = document.getElementById('dispcClose'); if (c) c.onclick = close; }
  }
  function friendlyDisp(e) {
    const m = (e && e.message) || '';
    return /insufficient|funds|utxo/i.test(m) ? 'not enough spendable BTC (each dispense pays the dispenser in BTC + miner fee)' : (m || 'compose/verify error');
  }

  function renderSwap() {
    $('#mktBody').innerHTML = `
      <div class="mkt-side"><div class="mkt-lbl">Sell <button class="mini mkt-max" id="mktMax" type="button" title="Sell your full balance">Max</button></div>
        <div class="mkt-in"><input id="mktSell" class="mkt-amt" type="number" min="0" step="any" placeholder="0.0" value="${esc(S.amount)}"/>
          <input id="mktSellAsset" class="mkt-asset mkt-tokenin" style="width:auto" size="${assetSize(S.sell)}" maxlength="26" placeholder="XCP" spellcheck="false" value="${esc(S.sell)}"/></div></div>
      <div class="mkt-flip"><button id="mktFlip" title="Swap the pair">⇅</button></div>
      <div class="mkt-side"><div class="mkt-lbl">Buy</div>
        <div class="mkt-in"><input id="mktGet" class="mkt-amt" type="text" readonly placeholder="0.0"/>
          <input id="mktBuyAsset" class="mkt-asset mkt-tokenin" style="width:auto" size="${assetSize(S.buy)}" maxlength="26" placeholder="TOKEN" spellcheck="false" value="${esc(S.buy)}"/></div></div>
      <div id="mktScan" class="mkt-scan"></div>
      <div id="mktQuote" class="mkt-quote"></div>
      <div id="mktStatus" class="statusline" hidden></div>
      <div class="wbtns"><button class="ghost sm" id="mktGear" title="Slippage & fee">⚙ ${S.slippage === 'auto' ? 'Auto' : S.slippage + '%'}</button><button class="primary" id="mktGo">Review swap</button></div>`;
    const amt = $('#mktSell'), sa = $('#mktSellAsset'), ba = $('#mktBuyAsset');
    amt.oninput = () => { S.amount = amt.value; refreshQuote(); };
    sa.oninput = async () => { S.sell = sa.value.trim().toUpperCase(); sa.value = S.sell; sa.size = assetSize(S.sell); scheduleScan(); S.sellDiv = S.sell ? await divisible(S.sell) : true; refreshQuote(); };
    ba.oninput = async () => { S.buy = ba.value.trim().toUpperCase(); ba.value = S.buy; ba.size = assetSize(S.buy); scheduleScan(); S.buyDiv = S.buy ? await divisible(S.buy) : true; refreshQuote(); };
    // Middle icon swaps the two sides of the pair (not just buy/sell direction).
    $('#mktFlip').onclick = () => { const a = S.sell, d = S.sellDiv; S.sell = S.buy; S.sellDiv = S.buyDiv; S.buy = a; S.buyDiv = d; S.amount = ''; S.quote = null; render(); };
    $('#mktGear').onclick = gearMenu;
    $('#mktGo').onclick = reviewSwap;
    const mx = $('#mktMax'); if (mx) mx.onclick = maxSell;
    if (S.sell && S.buy && S.amount) refreshQuote(); else paintQuote();
    paintScan();
  }

  // Fill the sell amount with the address's full Counterparty balance of the sell asset.
  async function maxSell() {
    if (!RE_ASSET.test(S.sell)) return;
    const addr = window.WonderCpFlow && window.WonderCpFlow.activeSource();
    const btn = document.getElementById('mktMax'), amt = document.getElementById('mktSell');
    if (!addr) { if (btn) { btn.textContent = 'No wallet'; setTimeout(() => (btn.textContent = 'Max'), 1400); } return; }
    if (btn) btn.textContent = '…';
    try {
      const j = await fetch('api/cp/holdings/' + encodeURIComponent(addr)).then((r) => r.json());
      const row = (j.holdings || []).find((x) => x.asset === S.sell || x.name === S.sell);
      if (row && Number(row.qty) > 0) { S.amount = String(Number(row.qty)); if (amt) amt.value = S.amount; refreshQuote(); }
      else if (btn) { btn.textContent = 'None held'; setTimeout(() => (btn.textContent = 'Max'), 1600); return; }
    } catch (_) {}
    if (btn) btn.textContent = 'Max';
  }

  function gearMenu() {
    const box = document.getElementById('mktQuote'); if (!box) return;
    // Toggle: if the picker is already open, the gear hides it (don't stack rows).
    const open = box.querySelector('.mkt-slip'); if (open) { open.remove(); return; }
    const pick = document.createElement('div'); pick.className = 'mkt-slip';
    const slipOpts = ['auto', '0.5', '1', '2', '3'];
    const slipRow = 'Max slippage: ' + slipOpts.map((o) => `<button class="mini${String(S.slippage) === o ? ' on' : ''}" data-s="${o}">${o === 'auto' ? 'Auto' : o + '%'}</button>`).join('');
    // Miner-fee picker — the same Fast/Med/Econ + custom control as the rest of the wallet (staggered so
    // presets are strictly descending). Covers every Market tab since they all sign with S.feeRate.
    const raw = S.fees || { fastestFee: 10, halfHourFee: 6, hourFee: 3 };
    const f = window.WWFee ? window.WWFee.stagger(raw, ['fastestFee', 'halfHourFee', 'hourFee']) : raw;
    const presets = [['fastestFee', 'Fast'], ['halfHourFee', 'Med'], ['hourFee', 'Econ']];
    const onPreset = presets.some(([k]) => Number(f[k]) === Number(S.feeRate));
    const feeRow = 'Miner fee: ' + presets.map(([k, l]) => `<button class="mini${Number(f[k]) === Number(S.feeRate) ? ' on' : ''}" data-f="${f[k]}">${l} · ${f[k]}</button>`).join('')
      + `<input class="mkt-feecustom" id="mktFeeCustom" type="number" min="0.1" step="0.1" placeholder="custom" value="${onPreset ? '' : S.feeRate}" style="width:70px;background:var(--bg);border:1px solid var(--border2);border-radius:6px;color:var(--text);padding:4px 6px;font-size:12px;margin-left:4px"/> <span class="fine">sat/vB</span>`;
    pick.innerHTML = `<div>${slipRow}</div><div style="margin-top:7px">${feeRow}</div>`;
    box.prepend(pick);
    pick.querySelectorAll('[data-s]').forEach((b) => (b.onclick = () => { S.slippage = b.dataset.s; render(); gearMenu(); }));
    pick.querySelectorAll('[data-f]').forEach((b) => (b.onclick = () => { S.feeRate = Number(b.dataset.f); render(); gearMenu(); }));
    const fc = pick.querySelector('#mktFeeCustom');
    if (fc) fc.oninput = () => { const v = Number(fc.value); if (v > 0) { S.feeRate = v; pick.querySelectorAll('[data-f]').forEach((x) => x.classList.remove('on')); } };
  }

  // Decide what the #mktScan area shows: a resolved pair ⇒ that pool's analytics; otherwise the
  // pool directory (discovery). Debounced from the asset inputs so typing doesn't thrash the network.
  let _scanT = null;
  const scheduleScan = () => { clearTimeout(_scanT); _scanT = setTimeout(paintScan, 320); };
  function paintScan() {
    const el = document.getElementById('mktScan'); if (!el) return;
    const both = RE_ASSET.test(S.sell) && RE_ASSET.test(S.buy) && S.sell !== S.buy;
    if (both) renderPoolInfo(el, S.sell, S.buy); else renderPoolDir(el, pickSwap);
  }
  function pickSwap(p) {
    // Sell the XCP side by default (people usually buy the token); non-XCP pools keep asset_a→asset_b.
    if (p.b === 'XCP') { S.sell = 'XCP'; S.sellDiv = true; S.buy = p.a; S.buyDiv = p.aDiv; }
    else if (p.a === 'XCP') { S.sell = 'XCP'; S.sellDiv = true; S.buy = p.b; S.buyDiv = p.bDiv; }
    else { S.sell = p.a; S.sellDiv = p.aDiv; S.buy = p.b; S.buyDiv = p.bDiv; }
    S.amount = ''; S.quote = null; render();
  }

  // Pool directory — reused by Swap and Liquidity. onPick(pool) decides what a row-tap does.
  function renderPoolDir(el, onPick) {
    if (!el) return;
    if (!POOLS) { el.innerHTML = '<div class="fine" style="padding:6px 2px">Loading pools…</div>'; loadPools().then(() => { if (document.body.contains(el)) renderPoolDir(el, onPick); }); return; }
    if (!POOLS.length) { el.innerHTML = '<div class="dash-empty">No AMM pools found. Enter any two assets above to quote a swap.</div>'; return; }
    const rows = POOLS.slice();
    if (POOLSORT === 'new') rows.sort((a, b) => (b.block || 0) - (a.block || 0));
    else rows.sort((a, b) => { const xa = poolXcp(a), xb = poolXcp(b); return (xb == null ? -1 : xb) - (xa == null ? -1 : xa); }); // TVL: XCP-side reserve desc; non-XCP last
    const list = rows.map((p, i) => {
      const na = p.aLong || p.a, nb = p.bLong || p.b, x = poolXcp(p), funded = poolFunded(p);
      const tvl = x != null ? kfmt(x * 2) + ' XCP' + (XCPUSD ? ' · $' + kfmt(x * 2 * XCPUSD) : '') : kfmt(p.resA) + ' + ' + kfmt(p.resB);
      const tag = !funded ? '<span class="pool-tag empty">empty</span>' : x == null ? '<span class="pool-tag alt">non-XCP</span>' : '';
      return `<button class="pool-row" data-i="${i}"><span class="pool-pair">${esc(na)} <span class="ps">/</span> ${esc(nb)}${tag}</span><span class="pool-tvl">${esc(tvl)}</span></button>`;
    }).join('');
    el.innerHTML = `<div class="pool-dir-head"><span>Liquidity pools <span class="fine">(${rows.length})</span></span>
        <span class="pool-sort"><button class="mini${POOLSORT === 'tvl' ? ' on' : ''}" data-sort="tvl">Highest TVL</button><button class="mini${POOLSORT === 'new' ? ' on' : ''}" data-sort="new">Newest</button></span></div>
      <div class="pool-dir">${list}</div>
      <div class="fine" style="margin-top:4px">Tap a pool to load the pair. TVL = both reserves valued in XCP.</div>`;
    el.querySelectorAll('[data-sort]').forEach((b) => (b.onclick = () => { POOLSORT = b.dataset.sort; renderPoolDir(el, onPick); }));
    el.querySelectorAll('[data-i]').forEach((b) => (b.onclick = () => onPick(rows[+b.dataset.i])));
  }

  // Per-pair analytics panel — reused by Swap and Liquidity. Reads the trimmed pool row from POOLS.
  function renderPoolInfo(el, A, B) {
    if (!el) return;
    if (!POOLS) { el.innerHTML = '<div class="fine" style="padding:6px 2px">Loading pool…</div>'; loadPools().then(() => { if (document.body.contains(el)) renderPoolInfo(el, A, B); }); return; }
    const p = POOLS.find((x) => (x.a === A && x.b === B) || (x.a === B && x.b === A)) || null;
    if (!p) {
      el.innerHTML = `<div class="pool-info"><div class="pool-info-head">${esc(A)} <span class="ps">/</span> ${esc(B)} <span class="pool-tag alt">no pool</span></div>
        <div class="fine">No AMM pool for this pair — a swap can still fill from the DEX order book if orders exist. Check the quote below.</div></div>`;
      return;
    }
    const aIsA = p.a === A; // orient reserves to the sell/buy sides
    const resSell = Number(aIsA ? p.resA : p.resB), resBuy = Number(aIsA ? p.resB : p.resA);
    const x = poolXcp(p), funded = poolFunded(p);
    const health = !funded ? '<span class="pool-tag empty">Empty</span>' : x == null ? '<span class="pool-tag alt">Non-XCP</span>'
      : x >= 1000 ? '<span class="pool-tag deep">🟢 Deep</span>' : x >= 100 ? '<span class="pool-tag mod">🟡 Moderate</span>' : '<span class="pool-tag thin">🔴 Thin</span>';
    const tvl = x != null ? kfmt(x * 2) + ' XCP' + (XCPUSD ? '  ≈ $' + kfmt(x * 2 * XCPUSD) : '') : '—';
    const pxBperA = resSell > 0 ? resBuy / resSell : 0, pxAperB = resBuy > 0 ? resSell / resBuy : 0;
    const row = (k, v) => `<div class="mkt-qrow"><span>${k}</span><b>${v}</b></div>`;
    el.innerHTML = `<div class="pool-info">
      <div class="pool-info-head">${esc(A)} <span class="ps">/</span> ${esc(B)} ${health}</div>
      ${row('Reserves', `${cnum(resSell, 4)} ${esc(A)} · ${cnum(resBuy, 4)} ${esc(B)}`)}
      ${row('Price', `1 ${esc(A)} ≈ ${cnum(pxBperA)} ${esc(B)}`)}
      ${row('', `1 ${esc(B)} ≈ ${cnum(pxAperB)} ${esc(A)}`)}
      ${row('TVL', tvl)}
      ${row('LP token', `<span class="vmono">${esc(p.lp || '—')}</span>`)}
      ${row('Created', `block ${p.block || '—'} · ${p.time ? dateStr(p.time) + ' (' + ago(p.time) + ')' : '—'}`)}
      <div id="mktPoolIds" class="fine" style="margin-top:2px">Loading asset ids…</div>
    </div>`;
    // Numeric asset ids + supply come from a per-asset lookup (not in the pool row) — fill async.
    Promise.all([assetInfo(A), assetInfo(B)]).then(([ia, ib]) => {
      const box = document.getElementById('mktPoolIds'); if (!box) return;
      const line = (name, info) => info ? `${esc(name)}: #${esc(info.assetId || '—')}${info.supplyNorm ? ' · supply ' + kfmt(info.supplyNorm) : ''}${info.divisible === false ? ' · indivisible' : ''}${info.locked ? ' · 🔒' : ''}` : `${esc(name)}: —`;
      box.innerHTML = line(A, ia) + '<br>' + line(B, ib);
    });
  }

  async function reviewSwap() {
    const s = $('#mktStatus'); if (!s) return;
    const p = pair();
    if (!RE_ASSET.test(S.sell) || !RE_ASSET.test(S.buy) || S.sell === S.buy) { s.hidden = false; s.className = 'statusline err'; s.textContent = 'Choose two different assets to swap.'; return; }
    if (!S.quote || !(S.quote.estimated_output > 0)) { s.hidden = false; s.className = 'statusline err'; s.textContent = 'No quote yet — enter an amount for a pair with liquidity.'; return; }
    s.hidden = false; s.className = 'statusline load'; s.textContent = 'Composing & verifying…';
    try {
      const giveRaw = toRaw(S.amount, p.giveDiv);
      const minGetRaw = String(Math.floor(Number(S.quote.estimated_output) * (1 - slipPct() / 100)));
      const params = { give_asset: p.give, give_quantity: giveRaw, get_asset: p.get, get_quantity: minGetRaw, expiration: 5000, fee_required: 0, sat_per_vbyte: S.feeRate };
      const { compose, report } = await window.WonderCpFlow.composeVerify('order', params, { feeRatePerVb: S.feeRate });
      if (!BTCUSD) { try { BTCUSD = Number((await fetch('api/prices').then((r) => r.json())).bitcoin) || 0; } catch (_) {} }
      const feeSats = compose.btc_fee != null ? Number(compose.btc_fee).toLocaleString('en-US') : '—';
      const feeUsd = compose.btc_fee != null ? usd(compose.btc_fee) : '';
      const minRecv = fromRaw(minGetRaw, p.getDiv);
      modal(`<div class="cc-head"><div><h3 class="m-title" style="margin:0">Confirm swap</h3><div class="cp-addr">${esc(p.give)} → ${esc(p.get)}</div></div></div>
        <div class="m-rows">
          <div class="m-row"><span class="k">Sell</span><span class="v">${esc(S.amount)} ${esc(p.give)}</span></div>
          <div class="m-row"><span class="k">Receive ≥</span><span class="v">${typeof minRecv === 'number' ? minRecv.toLocaleString('en-US', { maximumFractionDigits: 8 }) : minRecv} ${esc(p.get)}</span></div>
          <div class="m-row"><span class="k">Miner fee</span><span class="v">${feeSats} sats${feeUsd}</span></div>
        </div>
        ${window.WonderVerify.bannerHtml(report)}
        <div class="fine" style="margin-top:8px">A market swap rests as a DEX order that fills from the pool + book at the quoted rate or better; any unfilled remainder stays as an open order.</div>
        <div id="mktcStatus" class="statusline" hidden></div>
        <div class="wbtns"><button class="ghost" id="mktcBack">Back</button><button class="primary" id="mktcGo">Sign &amp; swap</button></div>`);
      $('#mktcBack').onclick = () => render();
      $('#mktcGo').onclick = async () => {
        const cs = $('#mktcStatus'); cs.hidden = false; cs.className = 'statusline load'; cs.textContent = 'Signing & broadcasting…';
        try { const { txid } = await window.WonderCpFlow.sign(compose);
          cs.className = 'statusline'; cs.innerHTML = `Swapped ✓ — <a href="https://mempool.space/tx/${encodeURIComponent(txid)}" target="_blank" rel="noopener" style="color:var(--gold2)">${esc(String(txid).slice(0, 18))}…</a> · fills on Counterparty.`; sealBroadcast();
        } catch (e) { cs.className = 'statusline err'; cs.textContent = 'Failed: ' + (e.message || 'sign/broadcast error'); }
      };
    } catch (e) {
      s.className = 'statusline err';
      const m = e.message || '';
      // CP's "Insufficient funds for the target amount: X < Y" is about SATOSHIS (funding the tx), not the
      // asset — don't mislabel it as "not enough <asset>". A true asset shortfall names the asset instead.
      if (/target amount|insufficient funds for|not enough (btc|bitcoin|sat)|no (spendable )?utxo/i.test(m)) s.textContent = `Not enough BTC on this address to cover the swap's network fee — add a little BTC and retry.`;
      else if (/insufficient/i.test(m)) s.textContent = `Not enough ${p.give} on this address to swap.`;
      else s.textContent = m || 'Compose/verify failed.';
    }
  }

  // ── Liquidity (AMM pool deposit / withdraw) — ANY asset/asset pair, not just TOKEN/XCP ──
  const Q = { sub: 'add', a: '', aDiv: true, b: 'XCP', bDiv: true, pool: null, loaded: false, amtA: '', amtB: '', lpAmt: '' };
  const pairLbl = () => `${esc(Q.a || 'A')} / ${esc(Q.b || 'B')}`;
  async function renderLiquidity() {
    $('#mktBody').innerHTML = `
      <div class="lp-tabs" style="margin-bottom:10px"><button class="lp-tab${Q.sub === 'add' ? ' on' : ''}" data-q="add">Add</button><button class="lp-tab${Q.sub === 'remove' ? ' on' : ''}" data-q="remove">Remove</button></div>
      <div class="mkt-side"><div class="mkt-lbl">Pool pair</div><div class="mkt-in" style="gap:6px">
        <input id="liqA" class="mkt-tokenin" style="width:118px;text-align:left;font-size:15px" placeholder="TOKEN" spellcheck="false" value="${esc(Q.a)}"/>
        <span style="color:var(--muted)">/</span>
        <input id="liqB" class="mkt-tokenin" style="width:118px;text-align:left;font-size:15px" placeholder="XCP" spellcheck="false" value="${esc(Q.b)}"/>
        <button class="ghost sm" id="liqLoad">Load</button></div></div>
      <div id="liqBody" style="margin-top:14px"></div>
      <div id="mktStatus" class="statusline" hidden></div>`;
    $('#mktCard').querySelectorAll('[data-q]').forEach((b) => (b.onclick = () => { Q.sub = b.dataset.q; renderLiquidity(); }));
    const kd = (e) => { if (e.key === 'Enter') loadPool(); };
    $('#liqA').onkeydown = kd; $('#liqB').onkeydown = kd; $('#liqLoad').onclick = () => loadPool();
    if (Q.loaded) paintLiq();
    else renderPoolDir($('#liqBody'), pickLiq); // discovery: tap a pool to load it for add/remove
  }
  // Tap a pool in the Liquidity directory → load it. Keep XCP on the B side (matches the default).
  function pickLiq(p) {
    if (p.a === 'XCP') { Q.a = p.b; Q.b = 'XCP'; } else { Q.a = p.a; Q.b = p.b; }
    const ia = $('#liqA'), ib = $('#liqB'); if (ia) ia.value = Q.a; if (ib) ib.value = Q.b;
    loadPool();
  }
  function backToPools() { Q.loaded = false; Q.pool = null; Q.a = ''; Q.b = ''; Q.amtA = ''; Q.amtB = ''; Q.lpAmt = ''; renderLiquidity(); }
  async function loadPool() {
    Q.a = ($('#liqA').value || '').trim().toUpperCase(); Q.b = ($('#liqB').value || '').trim().toUpperCase();
    const body = $('#liqBody'); if (!body) return;
    if (!RE_ASSET.test(Q.a) || !RE_ASSET.test(Q.b) || Q.a === Q.b) { body.innerHTML = `<div class="dash-empty">Enter two different assets (e.g. CAPTAINDAN / STOLEYERGIRL).</div>`; return; }
    body.innerHTML = '<div class="fine">Loading pool…</div>';
    [Q.aDiv, Q.bDiv] = await Promise.all([divisible(Q.a), divisible(Q.b)]);
    try { const j = await fetch(`api/cp/pool/${encodeURIComponent(Q.a)}/${encodeURIComponent(Q.b)}`).then((r) => r.json()); Q.pool = j.result || null; } catch (_) { Q.pool = null; }
    Q.loaded = true; Q.amtA = ''; Q.amtB = ''; paintLiq();
  }
  // Map the pool's canonical asset_a/asset_b to OUR chosen A/B; reserves are normalized (human) strings.
  function poolSides() { const p = Q.pool; if (!p) return null; const aIsA = p.asset_a === Q.a; return { resA: Number(aIsA ? p.reserve_a_normalized : p.reserve_b_normalized), resB: Number(aIsA ? p.reserve_b_normalized : p.reserve_a_normalized), lpAsset: p.lp_asset }; }
  function paintLiq() {
    const body = $('#liqBody'); if (!body) return;
    if (Q.sub === 'remove') {
      if (!Q.pool) { body.innerHTML = `<div class="dash-empty">No pool for ${pairLbl()} to remove from.</div>`; return; }
      const ps = poolSides();
      body.innerHTML = `
        <div id="liqInfo"></div>
        <div class="mkt-side"><div class="mkt-lbl">Burn LP tokens</div><div class="mkt-in"><input id="liqLp" class="mkt-amt" type="number" min="0" step="any" placeholder="0.0" value="${esc(Q.lpAmt)}"/><span class="mkt-asset">LP</span></div></div>
        <div class="lp-cost">LP asset · <span class="vmono">${esc(ps.lpAsset)}</span>. Burning LP returns your share of both ${pairLbl()} reserves.</div>
        <div class="wbtns"><button class="ghost sm" id="liqBackR">← Pools</button><button class="primary" id="liqRemGo">Review remove</button></div>`;
      renderPoolInfo($('#liqInfo'), Q.a, Q.b);
      const lpEl = $('#liqLp'); lpEl.oninput = () => { Q.lpAmt = lpEl.value; };
      $('#liqBackR').onclick = backToPools;
      $('#liqRemGo').onclick = () => doPool('poolwithdraw', ps);
      return;
    }
    // ADD — existing pool ⇒ ratio-locked; no pool ⇒ CREATE (you set both amounts = the starting price).
    const ps = Q.pool ? poolSides() : null;
    const ratio = ps && ps.resA > 0 ? ps.resB / ps.resA : null; // units of B per 1 A
    body.innerHTML = `
      ${Q.pool ? '<div id="liqInfo"></div>' : ''}
      ${ps ? `<div class="lp-cost">Existing pool · 1 ${esc(Q.a)} ≈ ${ratio.toLocaleString('en-US', { maximumFractionDigits: 8 })} ${esc(Q.b)}. Both sides deposit in ratio; you receive LP tokens.</div>`
           : `<div class="warn" style="margin:2px 0 6px">No pool for ${pairLbl()} yet — you’ll <b>create</b> it. The two amounts you enter set the <b>starting price</b>; a mispriced new pool can be arbitraged. Match the real market rate.</div>`}
      <div class="mkt-side"><div class="mkt-lbl">Deposit ${esc(Q.a)}</div><div class="mkt-in"><input id="liqAmtA" class="mkt-amt" type="number" min="0" step="any" placeholder="0.0" value="${esc(Q.amtA)}"/><span class="mkt-asset">${esc(Q.a)}</span></div></div>
      <div class="mkt-flip"><span style="color:var(--muted);font-size:16px">＋</span></div>
      <div class="mkt-side"><div class="mkt-lbl">Deposit ${esc(Q.b)}</div><div class="mkt-in"><input id="liqAmtB" class="mkt-amt" type="${ps ? 'text' : 'number'}" ${ps ? 'readonly' : 'min="0" step="any"'} placeholder="0.0" value="${esc(Q.amtB)}"/><span class="mkt-asset">${esc(Q.b)}</span></div></div>
      ${!ps ? '<div id="liqCreatePx" class="fine" style="margin:6px 0 2px"></div>' : ''}
      <div class="wbtns"><button class="ghost sm" id="liqBackA">← Pools</button><button class="primary" id="liqAddGo">${ps ? 'Review add' : 'Review · create pool'}</button></div>`;
    if (Q.pool) renderPoolInfo($('#liqInfo'), Q.a, Q.b);
    const backA = $('#liqBackA'); if (backA) backA.onclick = backToPools;
    const aEl = $('#liqAmtA'), bEl = $('#liqAmtB');
    if (ps) { const upd = () => { Q.amtA = aEl.value; const a = Number(aEl.value); const b = a > 0 ? a * ratio : 0; Q.amtB = b ? String(b) : ''; bEl.value = b ? b.toLocaleString('en-US', { maximumFractionDigits: 8 }) : ''; }; aEl.oninput = upd; upd(); }
    else {
      // CREATE mode: the two amounts you enter ARE the starting price — echo it live so it's deliberate.
      const cpx = () => { const a = Number(aEl.value), b = Number(bEl.value); const el = $('#liqCreatePx'); if (!el) return;
        el.innerHTML = (a > 0 && b > 0) ? `Starting price: <b>1 ${esc(Q.a)} = ${cnum(b / a)} ${esc(Q.b)}</b> · 1 ${esc(Q.b)} = ${cnum(a / b)} ${esc(Q.a)}` : ''; };
      aEl.oninput = () => { Q.amtA = aEl.value; cpx(); }; bEl.oninput = () => { Q.amtB = bEl.value; cpx(); }; cpx();
    }
    $('#liqAddGo').onclick = () => doPool('pooldeposit', ps);
  }
  async function doPool(type, ps) {
    const s = $('#mktStatus'); if (!s) return;
    s.hidden = false; s.className = 'statusline load'; s.textContent = 'Composing & verifying…';
    try {
      let params, summary;
      if (type === 'pooldeposit') {
        const a = Number(Q.amtA), b = Number(Q.amtB);
        if (!(a > 0) || !(b > 0)) throw new Error(`Enter both ${Q.a} and ${Q.b} amounts.`);
        const rawA = String(Math.round(a * (Q.aDiv ? SATS : 1))), rawB = String(Math.round(b * (Q.bDiv ? SATS : 1)));
        // Align quantities to the pool's canonical asset_a/asset_b (existing), else our A/B (new pool).
        const assetA = Q.pool ? Q.pool.asset_a : Q.a, assetB = Q.pool ? Q.pool.asset_b : Q.b;
        const rawByAsset = { [Q.a]: rawA, [Q.b]: rawB };
        params = { asset_a: assetA, asset_b: assetB, quantity_a: rawByAsset[assetA], quantity_b: rawByAsset[assetB], sat_per_vbyte: S.feeRate };
        summary = `${a.toLocaleString('en-US', { maximumFractionDigits: 8 })} ${Q.a} + ${b.toLocaleString('en-US', { maximumFractionDigits: 8 })} ${Q.b}${Q.pool ? '' : ' · new pool'}`;
      } else {
        const lp = Number(Q.lpAmt); if (!(lp > 0)) throw new Error('Enter an LP amount.');
        params = { lp_asset: ps.lpAsset, quantity: String(Math.round(lp * SATS)), sat_per_vbyte: S.feeRate };
        summary = `Burn ${lp} LP → your share of ${pairLbl()}`;
      }
      const { compose, report } = await window.WonderCpFlow.composeVerify(type, params, { feeRatePerVb: S.feeRate });
      await ensureBtcUsd();
      const feeSats = compose.btc_fee != null ? nfmt(compose.btc_fee) : '—';
      modal(`<div class="cc-head"><div><h3 class="m-title" style="margin:0">Confirm · ${type === 'pooldeposit' ? (Q.pool ? 'Add liquidity' : 'Create pool') : 'Remove liquidity'}</h3><div class="cp-addr">${pairLbl()} pool</div></div></div>
        <div class="m-rows"><div class="m-row"><span class="k">${type === 'pooldeposit' ? 'Deposit' : 'Withdraw'}</span><span class="v">${esc(summary)}</span></div><div class="m-row"><span class="k">Miner fee</span><span class="v">${feeSats} sats${feeUsdOf(compose)}</span></div></div>
        ${window.WonderVerify.bannerHtml(report)}
        <div id="pcStatus" class="statusline" hidden></div>
        <div class="wbtns"><button class="ghost" id="pcBack">Back</button><button class="primary" id="pcGo">Sign &amp; submit</button></div>`);
      $('#pcBack').onclick = () => render();
      $('#pcGo').onclick = async () => { const cs = $('#pcStatus'); cs.hidden = false; cs.className = 'statusline load'; cs.textContent = 'Signing & broadcasting…';
        try { const { txid } = await window.WonderCpFlow.sign(compose); cs.className = 'statusline'; cs.innerHTML = `Done ✓ — <a href="https://mempool.space/tx/${encodeURIComponent(txid)}" target="_blank" rel="noopener" style="color:var(--gold2)">${esc(String(txid).slice(0, 18))}…</a>`; sealBroadcast(); }
        catch (e) { cs.className = 'statusline err'; cs.textContent = 'Failed: ' + (e.message || 'error'); } };
    } catch (e) { s.className = 'statusline err'; s.textContent = /insufficient/i.test(e.message || '') ? 'Insufficient balance for this pool action.' : (e.message || 'Compose/verify failed.'); }
  }

  window.WonderMarket = { open: async (token, opts) => { ONBACK = (opts && opts.onBack) || null; TABS = 'swap'; if (token) { S.buy = String(token).toUpperCase(); S.sell = 'XCP'; S.sellDiv = true; S.buyDiv = await divisible(S.buy); } try { const f = await fetch('api/btc/fees').then((r) => r.json()); S.fees = f; S.feeRate = f.halfHourFee || 6; } catch (_) {} try { const pr = await fetch('api/prices').then((r) => r.json()); BTCUSD = pr.bitcoin || 0; } catch (_) {} render(); } };
})();
