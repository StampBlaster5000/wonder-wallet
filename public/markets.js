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
    if (!m) { m = document.createElement('div'); m.id = 'mktModal'; m.className = 'modal'; m.innerHTML = '<div class="modal-card mkt-card" id="mktCard"></div>'; document.body.appendChild(m); m.addEventListener('click', (e) => { if (e.target.id === 'mktModal') m.hidden = true; }); }
    $('#mktCard').innerHTML = html; m.hidden = false; return $('#mktCard');
  }
  const close = () => { const m = $('#mktModal'); if (m) m.hidden = true; };

  // Swap state: one side is always XCP (XCP-69 pools are TOKEN/XCP); `dir` = which way.
  const S = { dir: 'buy', token: '', tokenDiv: true, amount: '', quote: null, slippage: 'auto', feeRate: 6, dispMode: 'buy', dispAsset: '', dispensers: null, dispPick: 0, dispCount: 1, sellAsset: '', sellComp: null };
  const DIVCACHE = { XCP: true, BTC: true };
  let TABS = 'swap', BTCUSD = 0;
  const nfmt = (n) => Number(n).toLocaleString('en-US');
  const usd = (sats) => { const u = (Number(sats) / SATS) * BTCUSD; return u ? ' ≈ $' + u.toLocaleString('en-US', { maximumFractionDigits: 2 }) : ''; };

  async function divisible(asset) {
    if (asset in DIVCACHE) return DIVCACHE[asset];
    let d = true; try { const i = await fetch('api/cp/asset/' + encodeURIComponent(asset)).then((r) => r.json()); d = i && i.divisible != null ? !!i.divisible : true; } catch (_) {}
    DIVCACHE[asset] = d; return d;
  }
  const pair = () => (S.dir === 'buy' ? { give: 'XCP', giveDiv: true, get: S.token, getDiv: S.tokenDiv } : { give: S.token, giveDiv: S.tokenDiv, get: 'XCP', getDiv: true });

  let _qt = null;
  async function refreshQuote() {
    clearTimeout(_qt);
    S.quote = null; paintQuote();
    const p = pair(); if (!p.get || !p.give || !RE_ASSET.test(S.token)) return;
    const raw = toRaw(S.amount, p.giveDiv); if (!raw) return;
    _qt = setTimeout(async () => {
      const q = document.getElementById('mktQuote'); if (q) q.innerHTML = '<span class="fine">Quoting…</span>';
      try {
        const j = await fetch(`api/cp/pool/${encodeURIComponent(p.give)}/${encodeURIComponent(p.get)}/quote?quantity=${raw}`).then((r) => r.json());
        S.quote = j.result || null;
      } catch (_) { S.quote = null; }
      paintQuote();
    }, 280);
  }

  function autoSlip() { const imp = S.quote && S.quote.price_impact ? Number(S.quote.price_impact) : 0; return Math.min(5, Math.max(0.5, Math.ceil(imp * 10) / 10)); }
  const slipPct = () => (S.slippage === 'auto' ? autoSlip() : Number(S.slippage));

  function paintQuote() {
    const box = document.getElementById('mktQuote'); const out = document.getElementById('mktGet'); if (!box) return;
    const p = pair(), q = S.quote;
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
    modal(`<div class="cc-head"><div><h3 class="m-title" style="margin:0">Market</h3><div class="cp-addr">Counterparty AMM · self-custodial swaps over pool + order book</div></div><button class="mini" id="mktX">Close</button></div>
      <div class="lp-tabs">${[['swap', 'Swap'], ['liquidity', 'Liquidity'], ['limit', 'Limit'], ['dispense', 'Dispense']].map(([k, l]) => `<button class="lp-tab${k === TABS ? ' on' : ''}" data-tab="${k}">${l}</button>`).join('')}</div>
      <div id="mktBody"></div>`);
    $('#mktX').onclick = close;
    $('#mktCard').querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => { TABS = b.dataset.tab; render(); }));
    if (TABS === 'swap') renderSwap();
    else if (TABS === 'dispense') renderDispense();
    else if (TABS === 'limit') renderLimit();
    else if (TABS === 'liquidity') renderLiquidity();
  }

  // ── Limit orders (resting DEX order at a chosen price + cancel) ──
  const L = { dir: 'buy', token: '', tokenDiv: true, price: '', amount: '' };
  function renderLimit() {
    $('#mktBody').innerHTML = `
      <div class="lp-tabs" style="margin-bottom:10px"><button class="lp-tab${L.dir === 'buy' ? ' on' : ''}" data-d="buy">Buy</button><button class="lp-tab${L.dir === 'sell' ? ' on' : ''}" data-d="sell">Sell</button></div>
      <div class="mkt-side"><div class="mkt-lbl">Token</div><div class="mkt-in"><input id="limTok" class="mkt-tokenin" style="width:160px;text-align:left;font-size:15px" placeholder="TOKEN" spellcheck="false" value="${esc(L.token)}"/></div></div>
      <div id="limBook" class="ob-box"></div>
      <div class="mkt-side"><div class="mkt-lbl">Price <button class="mini" id="limMkt" style="margin-left:6px" title="Fill best market price">Market</button></div><div class="mkt-in"><input id="limPrice" class="mkt-amt" type="number" min="0" step="any" placeholder="0.0" value="${esc(L.price)}"/><span class="mkt-asset">XCP each</span></div></div>
      <div class="mkt-side"><div class="mkt-lbl">Amount</div><div class="mkt-in"><input id="limAmt" class="mkt-amt" type="number" min="0" step="any" placeholder="0.0" value="${esc(L.amount)}"/><span class="mkt-asset" id="limTokLbl">${esc(L.token || 'TOKEN')}</span></div></div>
      <div id="limTotal" class="lp-cost"></div>
      <div id="mktStatus" class="statusline" hidden></div>
      <div class="wbtns"><button class="primary" id="limGo">Review ${L.dir === 'buy' ? 'buy' : 'sell'} order</button></div>
      <div id="limOrders" style="margin-top:14px"></div>`;
    const tok = $('#limTok'), pr = $('#limPrice'), am = $('#limAmt');
    const total = () => { const p = Number(pr.value), a = Number(am.value); const el = $('#limTotal'); if (el) el.innerHTML = (p > 0 && a > 0) ? `${L.dir === 'buy' ? 'Pay' : 'Receive'} <b>${(p * a).toLocaleString('en-US', { maximumFractionDigits: 8 })} XCP</b> for <b>${a.toLocaleString('en-US', { maximumFractionDigits: 8 })} ${esc(L.token)}</b> — rests until filled at your price or better` : ''; };
    // Update in place — do NOT re-render on every keystroke (that destroys the input mid-typing,
    // truncating the token and firing loadBook on a partial name). Debounce the book/divisibility lookup.
    let bookT;
    tok.oninput = () => {
      const up = tok.value.toUpperCase(); if (tok.value !== up) { const p = tok.selectionStart; tok.value = up; try { tok.setSelectionRange(p, p); } catch (_) {} }
      L.token = up.trim();
      const lbl = $('#limTokLbl'); if (lbl) lbl.textContent = L.token || 'TOKEN';
      total();
      clearTimeout(bookT);
      bookT = setTimeout(() => { if (RE_ASSET.test(L.token)) { loadBook(); divisible(L.token).then((d) => { L.tokenDiv = d; }); } else { const b = $('#limBook'); if (b) b.innerHTML = ''; } }, 350);
    };
    pr.oninput = () => { L.price = pr.value; total(); }; am.oninput = () => { L.amount = am.value; total(); }; total();
    $('#mktCard').querySelectorAll('[data-d]').forEach((b) => (b.onclick = () => { L.dir = b.dataset.d; render(); }));
    $('#limGo').onclick = reviewLimit;
    const mk = $('#limMkt'); if (mk) mk.onclick = () => { const px = (L.dir === 'buy' ? L.bestAsk : L.bestBid) ?? L.pool; if (px && pr) { pr.value = Number(px).toFixed(8); L.price = pr.value; total(); } };
    if (RE_ASSET.test(L.token)) loadBook();
    loadOrders();
  }
  // Live order book + spread + AMM pool price for TOKEN/XCP. Click a level to fill the price.
  async function loadBook() {
    const box = $('#limBook'); if (!box) return;
    box.innerHTML = '<div class="fine">Loading order book…</div>';
    let orders = [];
    try { const j = await fetch(`api/cp/book/${encodeURIComponent(L.token)}/XCP`).then((r) => r.json()); orders = j.orders || []; } catch (_) {}
    const bids = [], asks = [];
    for (const o of orders) {
      const gq = Number(o.give_quantity_normalized), tq = Number(o.get_quantity_normalized); // fixed order rate
      if (!(gq > 0) || !(tq > 0)) continue;
      if (o.give_asset === 'XCP' && o.get_asset === L.token) {          // bid: pay XCP for TOKEN
        const rem = Number(o.get_remaining != null ? o.get_remaining : tq); if (rem > 0) bids.push({ price: gq / tq, amount: rem });
      } else if (o.give_asset === L.token && o.get_asset === 'XCP') {   // ask: sell TOKEN for XCP
        const rem = Number(o.give_remaining != null ? o.give_remaining : gq); if (rem > 0) asks.push({ price: tq / gq, amount: rem });
      }
    }
    bids.sort((a, b) => b.price - a.price); asks.sort((a, b) => a.price - b.price);
    L.bestBid = bids[0] ? bids[0].price : null; L.bestAsk = asks[0] ? asks[0].price : null;
    const spread = (L.bestBid && L.bestAsk) ? (L.bestAsk - L.bestBid) : null;
    const spreadPct = (spread != null && L.bestBid && L.bestAsk) ? (spread / ((L.bestBid + L.bestAsk) / 2)) * 100 : null;
    let pool = null;
    try { const p = await fetch(`api/cp/pool/${encodeURIComponent(L.token)}/XCP`).then((r) => r.json()); if (p.result) { const pr = p.result, aX = pr.asset_a === 'XCP'; const xr = Number(aX ? pr.reserve_a_normalized : pr.reserve_b_normalized), tr = Number(aX ? pr.reserve_b_normalized : pr.reserve_a_normalized); pool = tr > 0 ? xr / tr : null; } } catch (_) {}
    L.pool = pool;
    const px = (v) => (v != null ? Number(v).toFixed(8) : '—');
    const lvl = (r, cls) => `<button class="ob-row ${cls}" data-p="${r.price}"><span>${px(r.price)}</span><span>${r.amount.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span></button>`;
    box.innerHTML = `<div class="acct-grp">Order book · ${esc(L.token)} / XCP</div>
      <div class="ob-sum"><span>Bid <b class="up">${px(L.bestBid)}</b></span><span>Ask <b class="dn">${px(L.bestAsk)}</b></span><span>Spread <b>${spread != null ? px(spread) + (spreadPct != null ? ` (${spreadPct.toFixed(1)}%)` : '') : '—'}</b></span>${pool != null ? `<span>Pool <b>${px(pool)}</b></span>` : ''}</div>
      <div class="ob-levels">
        <div class="ob-asks">${asks.slice(0, 4).reverse().map((a) => lvl(a, 'ask')).join('') || '<div class="fine ob-none">no asks</div>'}</div>
        <div class="ob-bids">${bids.slice(0, 4).map((b) => lvl(b, 'bid')).join('') || '<div class="fine ob-none">no bids</div>'}</div>
      </div>`;
    box.querySelectorAll('[data-p]').forEach((r) => (r.onclick = () => { const pr = $('#limPrice'); if (pr) { pr.value = Number(r.dataset.p).toFixed(8); L.price = pr.value; const el = $('#limTotal'); if (el && $('#limAmt')) { const a = Number($('#limAmt').value), p = Number(pr.value); if (p > 0 && a > 0) el.innerHTML = `${L.dir === 'buy' ? 'Pay' : 'Receive'} <b>${(p * a).toLocaleString('en-US', { maximumFractionDigits: 8 })} XCP</b>`; } } }));
  }
  async function loadOrders() {
    const box = $('#limOrders'); if (!box) return;
    const a = window.__activeAccount; const src = window.WonderCpFlow && window.WonderCpFlow.srcAddr(a); if (!src) return;
    try {
      const j = await fetch('api/cp/myorders/' + encodeURIComponent(src)).then((r) => r.json());
      const orders = (j.orders || []).filter((o) => o.give_asset === 'XCP' || o.get_asset === 'XCP');
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
    const p = Number(L.price), a = Number(L.amount);
    if (!RE_ASSET.test(L.token)) { s.hidden = false; s.className = 'statusline err'; s.textContent = 'Enter a token symbol.'; return; }
    if (!(p > 0) || !(a > 0)) { s.hidden = false; s.className = 'statusline err'; s.textContent = 'Enter a price and amount.'; return; }
    s.hidden = false; s.className = 'statusline load'; s.textContent = 'Composing & verifying…';
    try {
      const tokRaw = String(Math.round(a * (L.tokenDiv ? SATS : 1)));
      const xcpRaw = String(Math.round(p * a * SATS));
      const params = L.dir === 'buy'
        ? { give_asset: 'XCP', give_quantity: xcpRaw, get_asset: L.token, get_quantity: tokRaw, expiration: 8064, fee_required: 0, sat_per_vbyte: S.feeRate }
        : { give_asset: L.token, give_quantity: tokRaw, get_asset: 'XCP', get_quantity: xcpRaw, expiration: 8064, fee_required: 0, sat_per_vbyte: S.feeRate };
      const { compose, report } = await window.WonderCpFlow.composeVerify('order', params, { feeRatePerVb: S.feeRate });
      const feeSats = compose.btc_fee != null ? nfmt(compose.btc_fee) : '—';
      modal(`<div class="cc-head"><div><h3 class="m-title" style="margin:0">Confirm ${L.dir} order</h3><div class="cp-addr">${esc(L.token)} · limit</div></div></div>
        <div class="m-rows">
          <div class="m-row"><span class="k">${L.dir === 'buy' ? 'Buy' : 'Sell'}</span><span class="v">${a.toLocaleString('en-US', { maximumFractionDigits: 8 })} ${esc(L.token)}</span></div>
          <div class="m-row"><span class="k">Price</span><span class="v">${p.toLocaleString('en-US', { maximumFractionDigits: 8 })} XCP each</span></div>
          <div class="m-row"><span class="k">${L.dir === 'buy' ? 'Pay' : 'Receive'}</span><span class="v">${(p * a).toLocaleString('en-US', { maximumFractionDigits: 8 })} XCP</span></div>
          <div class="m-row"><span class="k">Miner fee</span><span class="v">${feeSats} sats</span></div>
        </div>
        ${window.WonderVerify.bannerHtml(report)}
        <div class="fine" style="margin-top:8px">Rests on the Counterparty DEX; the AMM pool fills it automatically if its price crosses yours.</div>
        <div id="limcStatus" class="statusline" hidden></div>
        <div class="wbtns"><button class="ghost" id="limcBack">Back</button><button class="primary" id="limcGo">Sign &amp; place</button></div>`);
      $('#limcBack').onclick = () => render();
      $('#limcGo').onclick = async () => {
        const cs = $('#limcStatus'); cs.hidden = false; cs.className = 'statusline load'; cs.textContent = 'Signing & broadcasting…';
        try { const { txid } = await window.WonderCpFlow.sign(compose); cs.className = 'statusline'; cs.innerHTML = `Order placed ✓ — <a href="https://mempool.space/tx/${encodeURIComponent(txid)}" target="_blank" rel="noopener" style="color:var(--gold2)">${esc(String(txid).slice(0, 18))}…</a>`; }
        catch (e) { cs.className = 'statusline err'; cs.textContent = 'Failed: ' + (e.message || 'sign/broadcast error'); }
      };
    } catch (e) { s.className = 'statusline err'; s.textContent = /insufficient/i.test(e.message || '') ? `Not enough ${L.dir === 'buy' ? 'XCP' : L.token} to place this order.` : (e.message || 'Compose/verify failed.'); }
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
      <div id="dispList"></div><div id="dispBuy"></div>`;
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
      const feeSats = compose.btc_fee != null ? nfmt(compose.btc_fee) : '—';
      const dispenses = Math.floor(escrow / give) || 0;
      modal(`<div class="cc-head"><div><h3 class="m-title" style="margin:0">Confirm dispenser</h3><div class="cp-addr">Selling ${esc(asset)}</div></div></div>
        <div class="m-rows">
          <div class="m-row"><span class="k">Give per dispense</span><span class="v">${give.toLocaleString('en-US', { maximumFractionDigits: 8 })} ${esc(asset)}</span></div>
          <div class="m-row"><span class="k">Escrow</span><span class="v">${escrow.toLocaleString('en-US', { maximumFractionDigits: 8 })} ${esc(asset)} (~${dispenses} dispenses)</span></div>
          <div class="m-row"><span class="k">Price</span><span class="v">${nfmt(rate)} sats each${usd(rate)}</span></div>
          <div class="m-row"><span class="k">Miner fee</span><span class="v">${feeSats} sats</span></div>
        </div>
        ${window.WonderVerify.bannerHtml(report)}
        <div class="fine" style="margin-top:8px">Buyers send BTC to your address to trigger a dispense. You can close it anytime to reclaim the escrow.</div>
        <div id="selcStatus" class="statusline" hidden></div>
        <div class="wbtns"><button class="ghost" id="selcBack">Back</button><button class="primary" id="selcGo">Sign &amp; create</button></div>`);
      $('#selcBack').onclick = () => render();
      $('#selcGo').onclick = async () => {
        const cs = $('#selcStatus'); cs.hidden = false; cs.className = 'statusline load'; cs.textContent = 'Signing & broadcasting…';
        try { const { txid } = await window.WonderCpFlow.sign(compose); cs.className = 'statusline'; cs.innerHTML = `Dispenser created ✓ — <a href="https://mempool.space/tx/${encodeURIComponent(txid)}" target="_blank" rel="noopener" style="color:var(--gold2)">${esc(String(txid).slice(0, 18))}…</a>`; }
        catch (e) { cs.className = 'statusline err'; cs.textContent = 'Failed: ' + (e.message || 'sign/broadcast error'); }
      };
    } catch (e) { s.className = 'statusline err'; s.textContent = /insufficient|doesn.?t have|does not have/i.test(e.message || '') ? `You don't hold enough ${asset} to escrow that amount.` : (e.message || 'Compose/verify failed.'); }
  }
  async function findDispensers() {
    const el = $('#dispAsset'); S.dispAsset = (el.value || '').trim().toUpperCase(); el.value = S.dispAsset;
    if (!RE_ASSET.test(S.dispAsset)) return;
    const list = $('#dispList'); if (list) list.innerHTML = '<div class="fine">Finding dispensers…</div>';
    try { const j = await fetch('api/cp/asset-dispensers/' + encodeURIComponent(S.dispAsset)).then((r) => r.json()); S.dispensers = j.dispensers || []; } catch (_) { S.dispensers = []; }
    S.dispPick = 0; S.dispCount = 1; paintDispensers();
  }
  function paintDispensers() {
    const list = $('#dispList'); if (!list) return;
    if (!S.dispensers || !S.dispensers.length) { list.innerHTML = `<div class="dash-empty">No open dispensers for ${esc(S.dispAsset)} right now. A dispenser sends you this asset when you pay BTC to its address — none are open for it at the moment (oracle-priced dispensers are hidden here). You can also check the AMM pool + DEX via <b>Swap</b>.</div>`; const b = $('#dispBuy'); if (b) b.innerHTML = ''; return; }
    list.innerHTML = `<div class="acct-grp">Dispensers · cheapest first</div>` + S.dispensers.slice(0, 6).map((d, i) => `
      <button class="disp-opt${i === S.dispPick ? ' on' : ''}" data-i="${i}">
        <span class="disp-give">${esc(d.giveQty)} ${esc(S.dispAsset)}</span>
        <span class="disp-rate">${nfmt(d.satoshirate)} sats${usd(d.satoshirate)}</span>
        <span class="disp-rem">${esc(d.remaining)} left</span></button>`).join('');
    list.querySelectorAll('[data-i]').forEach((b) => (b.onclick = () => { S.dispPick = Number(b.dataset.i); paintDispensers(); }));
    paintDispBuy();
  }
  function paintDispBuy() {
    const box = $('#dispBuy'); if (!box) return;
    const d = S.dispensers[S.dispPick]; if (!d) { box.innerHTML = ''; return; }
    const maxN = Math.max(1, Math.floor(Number(d.remaining) / Number(d.giveQty)) || 1);
    box.innerHTML = `<div class="lp-mintrow" style="margin-top:10px"><input id="dispN" class="m-in" type="number" min="1" max="${maxN}" value="${S.dispCount || 1}"/><span class="lp-lotslbl">dispenses · ${esc(d.giveQty)} ${esc(S.dispAsset)} each</span></div>
      <div class="lp-cost" id="dispCost"></div>
      <div class="fine">Deep-route note: cheapest-first shown; you buy from the selected dispenser. Miner fees can make a deep cheap route beat a shallow one.</div>
      <div class="wbtns" style="margin-top:8px"><button class="primary" id="dispGo">Review buy</button></div>`;
    const nEl = $('#dispN');
    const cost = () => { const n = Math.max(1, parseInt(nEl.value, 10) || 1); const el = $('#dispCost'); if (el) el.innerHTML = `<b>${n}</b> dispense${n === 1 ? '' : 's'} → receive <b>${(Number(d.giveQty) * n).toLocaleString('en-US', { maximumFractionDigits: 8 })} ${esc(S.dispAsset)}</b> · costs <b>${nfmt(n * d.satoshirate)} sats</b> BTC${usd(n * d.satoshirate)} + miner fee`; };
    nEl.oninput = () => { S.dispCount = nEl.value; cost(); }; cost();
    $('#dispGo').onclick = () => doDispense(d, Math.max(1, Math.min(maxN, parseInt(nEl.value, 10) || 1)));
  }
  async function doDispense(d, n) {
    const s = $('#mktStatus'); if (!s) return;
    s.hidden = false; s.className = 'statusline load'; s.textContent = 'Composing & verifying…';
    try {
      const sats = n * d.satoshirate;
      const { compose, report } = await window.WonderCpFlow.composeVerify('dispense', { dispenser: d.address, quantity: sats, sat_per_vbyte: S.feeRate }, { dests: [d.address], allowed: [d.address], feeRatePerVb: S.feeRate });
      const feeSats = compose.btc_fee != null ? nfmt(compose.btc_fee) : '—';
      modal(`<div class="cc-head"><div><h3 class="m-title" style="margin:0">Confirm buy</h3><div class="cp-addr">${esc(S.dispAsset)} · from dispenser</div></div></div>
        <div class="m-rows">
          <div class="m-row"><span class="k">Receive</span><span class="v">${(Number(d.giveQty) * n).toLocaleString('en-US', { maximumFractionDigits: 8 })} ${esc(S.dispAsset)}</span></div>
          <div class="m-row"><span class="k">Pay</span><span class="v">${nfmt(sats)} sats${usd(sats)}</span></div>
          <div class="m-row" style="flex-direction:column;align-items:flex-start;gap:3px"><span class="k">Dispenser</span><span class="v vmono" style="font-size:11px;word-break:break-all">${esc(d.address)}</span></div>
          <div class="m-row"><span class="k">Miner fee</span><span class="v">${feeSats} sats</span></div>
        </div>
        ${window.WonderVerify.bannerHtml(report)}
        <div id="dispcStatus" class="statusline" hidden></div>
        <div class="wbtns"><button class="ghost" id="dispcBack">Back</button><button class="primary" id="dispcGo">Sign &amp; buy</button></div>`);
      $('#dispcBack').onclick = () => render();
      $('#dispcGo').onclick = async () => {
        const cs = $('#dispcStatus'); cs.hidden = false; cs.className = 'statusline load'; cs.textContent = 'Signing & broadcasting…';
        try { const { txid } = await window.WonderCpFlow.sign(compose);
          cs.className = 'statusline'; cs.innerHTML = `Bought ✓ — <a href="https://mempool.space/tx/${encodeURIComponent(txid)}" target="_blank" rel="noopener" style="color:var(--gold2)">${esc(String(txid).slice(0, 18))}…</a> · the dispenser sends your asset.`;
        } catch (e) { cs.className = 'statusline err'; cs.textContent = 'Failed: ' + (e.message || 'sign/broadcast error'); }
      };
    } catch (e) {
      s.className = 'statusline err';
      s.textContent = /insufficient|funds|utxo/i.test(e.message || '') ? 'Not enough BTC on this address to buy that many (dispensing pays the dispenser in BTC).' : (e.message || 'Compose/verify failed.');
    }
  }

  function renderSwap() {
    const p = pair();
    $('#mktBody').innerHTML = `
      <div class="mkt-side"><div class="mkt-lbl">Sell</div>
        <div class="mkt-in"><input id="mktSell" class="mkt-amt" type="number" min="0" step="any" placeholder="0.0" value="${esc(S.amount)}"/>
          <span class="mkt-asset">${esc(p.give)}</span></div></div>
      <div class="mkt-flip"><button id="mktFlip" title="Flip direction">↓↑</button></div>
      <div class="mkt-side"><div class="mkt-lbl">Buy</div>
        <div class="mkt-in"><input id="mktGet" class="mkt-amt" type="text" readonly placeholder="0.0"/>
          <input id="mktToken" class="mkt-asset mkt-tokenin" placeholder="TOKEN" spellcheck="false" value="${esc(S.token)}"/></div></div>
      <div id="mktQuote" class="mkt-quote"></div>
      <div id="mktStatus" class="statusline" hidden></div>
      <div class="wbtns"><button class="ghost sm" id="mktGear" title="Slippage & fee">⚙ ${S.slippage === 'auto' ? 'Auto' : S.slippage + '%'}</button><button class="primary" id="mktGo">Review swap</button></div>`;
    const sell = $('#mktSell'), tok = $('#mktToken');
    sell.oninput = () => { S.amount = sell.value; refreshQuote(); };
    tok.oninput = async () => { S.token = tok.value.trim().toUpperCase(); tok.value = S.token; S.tokenDiv = S.token ? await divisible(S.token) : true; refreshQuote(); };
    $('#mktFlip').onclick = () => { S.dir = S.dir === 'buy' ? 'sell' : 'buy'; S.amount = ''; S.quote = null; render(); };
    $('#mktGear').onclick = gearMenu;
    $('#mktGo').onclick = reviewSwap;
    if (S.token && S.amount) refreshQuote(); else paintQuote();
  }

  function gearMenu() {
    const opts = ['auto', '0.5', '1', '2', '3'];
    const box = document.getElementById('mktQuote');
    // lightweight inline slippage picker
    const pick = document.createElement('div'); pick.className = 'mkt-slip';
    pick.innerHTML = 'Max slippage: ' + opts.map((o) => `<button class="mini${String(S.slippage) === o ? ' on' : ''}" data-s="${o}">${o === 'auto' ? 'Auto' : o + '%'}</button>`).join('');
    if (box) { box.prepend(pick); pick.querySelectorAll('[data-s]').forEach((b) => (b.onclick = () => { S.slippage = b.dataset.s; render(); })); }
  }

  async function reviewSwap() {
    const s = $('#mktStatus'); if (!s) return;
    const p = pair();
    if (!RE_ASSET.test(S.token)) { s.hidden = false; s.className = 'statusline err'; s.textContent = 'Enter a token symbol to swap.'; return; }
    if (!S.quote || !(S.quote.estimated_output > 0)) { s.hidden = false; s.className = 'statusline err'; s.textContent = 'No quote yet — enter an amount for a pair with liquidity.'; return; }
    s.hidden = false; s.className = 'statusline load'; s.textContent = 'Composing & verifying…';
    try {
      const giveRaw = toRaw(S.amount, p.giveDiv);
      const minGetRaw = String(Math.floor(Number(S.quote.estimated_output) * (1 - slipPct() / 100)));
      const params = { give_asset: p.give, give_quantity: giveRaw, get_asset: p.get, get_quantity: minGetRaw, expiration: 5000, fee_required: 0, sat_per_vbyte: S.feeRate };
      const { compose, report } = await window.WonderCpFlow.composeVerify('order', params, { feeRatePerVb: S.feeRate });
      const feeSats = compose.btc_fee != null ? Number(compose.btc_fee).toLocaleString('en-US') : '—';
      const minRecv = fromRaw(minGetRaw, p.getDiv);
      modal(`<div class="cc-head"><div><h3 class="m-title" style="margin:0">Confirm swap</h3><div class="cp-addr">${esc(p.give)} → ${esc(p.get)}</div></div></div>
        <div class="m-rows">
          <div class="m-row"><span class="k">Sell</span><span class="v">${esc(S.amount)} ${esc(p.give)}</span></div>
          <div class="m-row"><span class="k">Receive ≥</span><span class="v">${typeof minRecv === 'number' ? minRecv.toLocaleString('en-US', { maximumFractionDigits: 8 }) : minRecv} ${esc(p.get)}</span></div>
          <div class="m-row"><span class="k">Miner fee</span><span class="v">${feeSats} sats</span></div>
        </div>
        ${window.WonderVerify.bannerHtml(report)}
        <div class="fine" style="margin-top:8px">A market swap rests as a DEX order that fills from the pool + book at the quoted rate or better; any unfilled remainder stays as an open order.</div>
        <div id="mktcStatus" class="statusline" hidden></div>
        <div class="wbtns"><button class="ghost" id="mktcBack">Back</button><button class="primary" id="mktcGo">Sign &amp; swap</button></div>`);
      $('#mktcBack').onclick = () => render();
      $('#mktcGo').onclick = async () => {
        const cs = $('#mktcStatus'); cs.hidden = false; cs.className = 'statusline load'; cs.textContent = 'Signing & broadcasting…';
        try { const { txid } = await window.WonderCpFlow.sign(compose);
          cs.className = 'statusline'; cs.innerHTML = `Swapped ✓ — <a href="https://mempool.space/tx/${encodeURIComponent(txid)}" target="_blank" rel="noopener" style="color:var(--gold2)">${esc(String(txid).slice(0, 18))}…</a> · fills on Counterparty.`;
        } catch (e) { cs.className = 'statusline err'; cs.textContent = 'Failed: ' + (e.message || 'sign/broadcast error'); }
      };
    } catch (e) {
      s.className = 'statusline err';
      s.textContent = /insufficient/i.test(e.message || '') ? `Not enough ${p.give} on this address to swap.` : (e.message || 'Compose/verify failed.');
    }
  }

  // ── Liquidity (AMM pool deposit / withdraw) ──
  const Q = { sub: 'add', token: '', pool: null, tokenDiv: true, amtA: '', lpAmt: '' };
  async function renderLiquidity() {
    $('#mktBody').innerHTML = `
      <div class="lp-tabs" style="margin-bottom:10px"><button class="lp-tab${Q.sub === 'add' ? ' on' : ''}" data-q="add">Add</button><button class="lp-tab${Q.sub === 'remove' ? ' on' : ''}" data-q="remove">Remove</button></div>
      <div class="mkt-side"><div class="mkt-lbl">Pool · TOKEN / XCP</div><div class="mkt-in"><input id="liqTok" class="mkt-tokenin" style="width:160px;text-align:left;font-size:15px" placeholder="TOKEN" spellcheck="false" value="${esc(Q.token)}"/><button class="ghost sm" id="liqLoad">Load</button></div></div>
      <div id="liqBody"></div>
      <div id="mktStatus" class="statusline" hidden></div>`;
    $('#mktCard').querySelectorAll('[data-q]').forEach((b) => (b.onclick = () => { Q.sub = b.dataset.q; renderLiquidity(); }));
    const tok = $('#liqTok');
    $('#liqLoad').onclick = loadPool; tok.onkeydown = (e) => { if (e.key === 'Enter') loadPool(); };
    if (Q.token && Q.pool) paintLiq();
  }
  async function loadPool() {
    const tok = $('#liqTok'); Q.token = (tok.value || '').trim().toUpperCase(); tok.value = Q.token;
    if (!RE_ASSET.test(Q.token)) return;
    const body = $('#liqBody'); if (body) body.innerHTML = '<div class="fine">Loading pool…</div>';
    Q.tokenDiv = await divisible(Q.token);
    try { const j = await fetch(`api/cp/pool/${encodeURIComponent(Q.token)}/XCP`).then((r) => r.json()); Q.pool = j.result || null; } catch (_) { Q.pool = null; }
    paintLiq();
  }
  function poolSides() { const p = Q.pool; if (!p) return null; const aIsXcp = p.asset_a === 'XCP'; return { xcpReserve: Number(aIsXcp ? p.reserve_a : p.reserve_b), tokReserve: Number(aIsXcp ? p.reserve_b : p.reserve_a), lpAsset: p.lp_asset, aIsXcp }; }
  function paintLiq() {
    const body = $('#liqBody'); if (!body) return;
    if (!Q.pool) { body.innerHTML = `<div class="dash-empty">No AMM pool for ${esc(Q.token)} / XCP.</div>`; return; }
    const ps = poolSides();
    if (Q.sub === 'add') {
      body.innerHTML = `
        <div class="mkt-side"><div class="mkt-lbl">Deposit XCP</div><div class="mkt-in"><input id="liqXcp" class="mkt-amt" type="number" min="0" step="any" placeholder="0.0" value="${esc(Q.amtA)}"/><span class="mkt-asset">XCP</span></div></div>
        <div class="mkt-flip"><span style="color:var(--muted);font-size:16px">＋</span></div>
        <div class="mkt-side"><div class="mkt-lbl">Paired ${esc(Q.token)}</div><div class="mkt-in"><input id="liqTokAmt" class="mkt-amt" type="text" readonly placeholder="0.0"/><span class="mkt-asset">${esc(Q.token)}</span></div></div>
        <div class="lp-cost">Pool ratio · 1 XCP ≈ ${(ps.tokReserve / ps.xcpReserve).toLocaleString('en-US', { maximumFractionDigits: 6 })} ${esc(Q.token)}. Deposit both sides in ratio; you receive LP tokens (liquidity is locked).</div>
        <div class="wbtns"><button class="primary" id="liqAddGo">Review add</button></div>`;
      const xEl = $('#liqXcp'), tEl = $('#liqTokAmt');
      const upd = () => { Q.amtA = xEl.value; const x = Number(xEl.value); const t = x > 0 ? x * (ps.tokReserve / ps.xcpReserve) : 0; tEl.value = t ? t.toLocaleString('en-US', { maximumFractionDigits: 8 }) : ''; };
      xEl.oninput = upd; upd();
      $('#liqAddGo').onclick = () => doPool('pooldeposit', ps);
    } else {
      body.innerHTML = `
        <div class="mkt-side"><div class="mkt-lbl">Burn LP tokens</div><div class="mkt-in"><input id="liqLp" class="mkt-amt" type="number" min="0" step="any" placeholder="0.0" value="${esc(Q.lpAmt)}"/><span class="mkt-asset">LP</span></div></div>
        <div class="lp-cost">LP asset · <span class="vmono">${esc(ps.lpAsset)}</span>. Burning LP returns your share of both reserves.</div>
        <div class="wbtns"><button class="primary" id="liqRemGo">Review remove</button></div>`;
      const lpEl = $('#liqLp'); lpEl.oninput = () => { Q.lpAmt = lpEl.value; };
      $('#liqRemGo').onclick = () => doPool('poolwithdraw', ps);
    }
  }
  async function doPool(type, ps) {
    const s = $('#mktStatus'); if (!s) return;
    s.hidden = false; s.className = 'statusline load'; s.textContent = 'Composing & verifying…';
    try {
      let params, summary;
      if (type === 'pooldeposit') {
        const x = Number(Q.amtA); if (!(x > 0)) throw new Error('Enter an XCP amount.');
        const tok = x * (ps.tokReserve / ps.xcpReserve);
        const xcpRaw = String(Math.round(x * SATS)), tokRaw = String(Math.round(tok * (Q.tokenDiv ? SATS : 1)));
        const p = Q.pool;
        params = { asset_a: p.asset_a, asset_b: p.asset_b, quantity_a: ps.aIsXcp ? xcpRaw : tokRaw, quantity_b: ps.aIsXcp ? tokRaw : xcpRaw, sat_per_vbyte: S.feeRate };
        summary = `${x} XCP + ${tok.toLocaleString('en-US', { maximumFractionDigits: 8 })} ${Q.token}`;
      } else {
        const lp = Number(Q.lpAmt); if (!(lp > 0)) throw new Error('Enter an LP amount.');
        params = { lp_asset: ps.lpAsset, quantity: String(Math.round(lp * SATS)), sat_per_vbyte: S.feeRate };
        summary = `Burn ${lp} LP → your share of ${Q.token} / XCP`;
      }
      const { compose, report } = await window.WonderCpFlow.composeVerify(type, params, { feeRatePerVb: S.feeRate });
      const feeSats = compose.btc_fee != null ? nfmt(compose.btc_fee) : '—';
      modal(`<div class="cc-head"><div><h3 class="m-title" style="margin:0">Confirm · ${type === 'pooldeposit' ? 'Add liquidity' : 'Remove liquidity'}</h3><div class="cp-addr">${esc(Q.token)} / XCP pool</div></div></div>
        <div class="m-rows"><div class="m-row"><span class="k">${type === 'pooldeposit' ? 'Deposit' : 'Withdraw'}</span><span class="v">${esc(summary)}</span></div><div class="m-row"><span class="k">Miner fee</span><span class="v">${feeSats} sats</span></div></div>
        ${window.WonderVerify.bannerHtml(report)}
        <div id="pcStatus" class="statusline" hidden></div>
        <div class="wbtns"><button class="ghost" id="pcBack">Back</button><button class="primary" id="pcGo">Sign &amp; submit</button></div>`);
      $('#pcBack').onclick = () => render();
      $('#pcGo').onclick = async () => { const cs = $('#pcStatus'); cs.hidden = false; cs.className = 'statusline load'; cs.textContent = 'Signing & broadcasting…';
        try { const { txid } = await window.WonderCpFlow.sign(compose); cs.className = 'statusline'; cs.innerHTML = `Done ✓ — <a href="https://mempool.space/tx/${encodeURIComponent(txid)}" target="_blank" rel="noopener" style="color:var(--gold2)">${esc(String(txid).slice(0, 18))}…</a>`; }
        catch (e) { cs.className = 'statusline err'; cs.textContent = 'Failed: ' + (e.message || 'error'); } };
    } catch (e) { s.className = 'statusline err'; s.textContent = /insufficient/i.test(e.message || '') ? 'Insufficient balance for this pool action.' : (e.message || 'Compose/verify failed.'); }
  }

  window.WonderMarket = { open: async (token) => { TABS = 'swap'; if (token) { S.token = String(token).toUpperCase(); S.dir = 'buy'; S.tokenDiv = await divisible(S.token); } try { const f = await fetch('api/btc/fees').then((r) => r.json()); S.feeRate = f.halfHourFee || 6; } catch (_) {} try { const pr = await fetch('api/prices').then((r) => r.json()); BTCUSD = pr.bitcoin || 0; } catch (_) {} render(); } };
})();
