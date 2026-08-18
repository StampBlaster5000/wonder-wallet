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
  const S = { dir: 'buy', token: '', tokenDiv: true, amount: '', quote: null, slippage: 'auto', feeRate: 6 };
  const DIVCACHE = { XCP: true, BTC: true };
  let TABS = 'swap';

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
    if (TABS === 'swap') renderSwap(); else renderSoon();
  }

  function renderSoon() {
    $('#mktBody').innerHTML = `<div class="dash-empty">🛠 ${TABS === 'liquidity' ? 'Liquidity (add / remove)' : TABS === 'limit' ? 'Limit orders' : 'Dispensers'} — building next. Swap is live now.</div>`;
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

  window.WonderMarket = { open: async (token) => { TABS = 'swap'; if (token) { S.token = String(token).toUpperCase(); S.dir = 'buy'; S.tokenDiv = await divisible(S.token); } try { const f = await fetch('api/btc/fees').then((r) => r.json()); S.feeRate = f.halfHourFee || 6; } catch (_) {} render(); } };
})();
