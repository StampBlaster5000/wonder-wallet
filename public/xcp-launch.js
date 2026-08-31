/* Wonder Wallet — XCP-69 launchpad (browse). Phase 1 read-only surface: lists conforming fair
   launches by phase (Minting / Scheduled / Graduated) with live mint progress. Reads through the
   server proxy (which preserves 10^16 quantities as strings) and filters client-side with the
   conformance predicate (window.WonderXcp69). Mint / create / detail flows land in later phases. */
(function () {
  'use strict';
  const X = () => window.WonderXcp69;
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function modal(html) {
    let m = $('#lpModal');
    if (!m) { m = document.createElement('div'); m.id = 'lpModal'; m.className = 'modal'; m.innerHTML = '<div class="modal-card lp-card" id="lpCard"></div>'; document.body.appendChild(m); m.addEventListener('click', (e) => { if (e.target.id === 'lpModal') m.hidden = true; }); }
    $('#lpCard').innerHTML = html; m.hidden = false; return $('#lpCard');
  }
  const close = () => { const m = $('#lpModal'); if (m) m.hidden = true; };
  let ONBACK = null; // optional caller-supplied "‹ Back" handler (set by open); e.g. the extension's Fairmint hub

  const PHASES = [
    { key: 'open', tab: 'Minting', empty: 'No live mints right now.' },
    { key: 'pending', tab: 'Scheduled', empty: 'No scheduled launches.' },
    { key: 'closed', tab: 'Graduated', empty: 'No closed launches yet.' },
  ];
  let CUR = 'open';
  const CACHE = {};
  const BYTX = {}; // tx_hash → fairminter row, so a card click can open the full launch

  // Live-analytics state + formatters (block tip drives deadline timeframes; XCP/USD prices the raise).
  let TIP = 0, XCPUSD = 0, BTCUSD = 0;
  const usdBtc = (sats) => { const u = (Number(sats) / 1e8) * BTCUSD; return u ? ' ≈ $' + u.toLocaleString('en-US', { maximumFractionDigits: 2 }) : ''; };
  // Per-phase sort — each tab keeps its own choice; the options that make sense differ by phase.
  const SORTBY = { open: 'progress', pending: 'soon', closed: 'new' };
  const SORTS = {
    open: [['progress', 'Minting out'], ['deadline', 'Ends soon'], ['new', 'New']],
    pending: [['soon', 'Mints soon'], ['later', 'Mints later'], ['new', 'New']],
    closed: [['new', 'Newest'], ['old', 'Oldest']],
  };
  let GRADFILTER = 'graduated'; // Graduated tab filter: graduated (bonded, pool seeded) | failed (refunded) | all
  // Bonded ⇔ the sale hit its soft cap; a closed launch below soft cap refunded every minter.
  const isBonded = (fm) => { const xr = X(); return xr.big(fm.earned_quantity || '0') >= xr.big(fm.soft_cap); };
  const kfmt = (n) => { const v = Number(n); if (!isFinite(v)) return '—'; if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B'; if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M'; if (v >= 1e3) return (v / 1e3).toFixed(1) + 'k'; return v.toLocaleString('en-US', { maximumFractionDigits: 2 }); };
  const short = (a) => (a ? a.slice(0, 6) + '…' + a.slice(-4) : '—');
  const dstr = (t) => { try { return new Date(Number(t) * 1000).toISOString().slice(0, 10); } catch (_) { return ''; } };
  const blocksToDur = (blocks) => { if (!isFinite(blocks) || blocks <= 0) return null; const mins = blocks * 10, d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60); return d > 0 ? d + 'd' + (h ? ' ' + h + 'h' : '') : h > 0 ? h + 'h' : Math.max(1, Math.round(mins)) + 'm'; };
  const raisedNum = (fm) => Number(X().fromSats(fm.paid_quantity || '0', true)) || 0;
  const raisedTxt = (fm) => { const v = raisedNum(fm); return kfmt(v) + ' XCP' + (XCPUSD ? ' · $' + kfmt(v * XCPUSD) : ''); };
  function deadlineTxt(fm) {
    if (fm.status === 'pending') { const left = TIP ? fm.start_block - TIP : null, t = blocksToDur(left); return 'starts blk ' + fm.start_block + (t ? ' · ~' + t : ''); }
    if (fm.status !== 'open') return 'closed';
    const dl = fm.soft_cap_deadline_block, left = TIP ? dl - TIP : null, t = blocksToDur(left);
    return left != null && left <= 0 ? 'deadline passed · blk ' + dl : 'ends ~' + (t || '?') + ' · blk ' + dl;
  }
  async function loadMeta() {
    if (!TIP) { try { const st = await fetch('api/status').then((r) => r.json()); TIP = (st.cp && st.cp.height) || (st.btc && st.btc.height) || 0; } catch (_) {} }
    if (!XCPUSD) { try { const pr = await fetch('api/prices').then((r) => r.json()); XCPUSD = Number(pr && pr.counterparty) || 0; } catch (_) {} }
  }
  function sortList(list) {
    const xr = X(), arr = list.slice(), key = SORTBY[CUR] || 'new';
    switch (key) {
      case 'progress': arr.sort((a, b) => xr.progress(b).pct - xr.progress(a).pct); break;
      case 'deadline': arr.sort((a, b) => (a.soft_cap_deadline_block || 9e12) - (b.soft_cap_deadline_block || 9e12)); break;
      case 'soon': arr.sort((a, b) => (a.start_block || 9e12) - (b.start_block || 9e12)); break; // scheduled to mint soonest first
      case 'later': arr.sort((a, b) => (b.start_block || 0) - (a.start_block || 0)); break;
      case 'old': arr.sort((a, b) => (a.block_index || 0) - (b.block_index || 0)); break;
      default: arr.sort((a, b) => (b.block_index || 0) - (a.block_index || 0)); // 'new'
    }
    return arr;
  }

  async function launches(status) {
    if (CACHE[status]) return CACHE[status];
    let out = [];
    try {
      const j = await fetch('api/cp/fairminters?status=' + status).then((r) => r.json());
      const xr = X();
      // Params-conforming (this enforces the fixed set + the commission=0 stealth-premine trap). The
      // timing clauses (pre-announcement / exact window) need the immutable event → verified on open.
      out = (j.result || []).filter((fm) => xr && xr.xcp69Params(fm));
      out.forEach((fm) => { BYTX[fm.tx_hash] = fm; });
    } catch (_) {}
    CACHE[status] = out; return out;
  }

  function card(fm) {
    const xr = X();
    const name = esc(fm.asset_longname || fm.asset);
    const p = xr.progress(fm);
    const pctText = p.pct ? p.pct.toFixed(1) + '%' : '—';
    const sub = CUR === 'pending' ? deadlineTxt(fm)
      : CUR === 'closed' ? (isBonded(fm) ? 'graduated · pool seeded ✓' : 'failed · XCP refunded')
      : (p.pct >= 100 ? 'sold out — graduating' : pctText + ' of the 69M sale');
    const metaLine = CUR === 'open'
      ? `<div class="lp-meta"><span>${esc(raisedTxt(fm))} raised</span><span>${esc(deadlineTxt(fm))}</span></div>` : '';
    const bar = CUR === 'pending' ? '' : `<div class="lp-bar"><span style="width:${Math.max(1, Math.min(100, p.pct))}%"></span></div>`;
    return `<button class="lp-item" data-tx="${esc(fm.tx_hash)}" title="${name}">
      <div class="lp-row"><span class="lp-name">${name}</span><span class="lp-pct">${CUR === 'open' ? esc(pctText) : ''}</span></div>
      ${bar}
      <div class="lp-sub">${esc(sub)}</div>${metaLine}</button>`;
  }

  async function render() {
    modal(`<div class="cc-head">${ONBACK ? '<button class="p-ibtn" id="lpBackTop" title="Back">←</button>' : ''}<div style="flex:1;min-width:0"><h3 class="m-title" style="margin:0">XCP-69 · fair launches</h3>
        <div class="cp-addr">100M supply · 69M public sale · 69-minter fair mint — self-custodial, on Counterparty</div></div>
      <div class="cc-head-r"><button class="m-close-x" id="lpX" title="Close" aria-label="Close">✕</button></div></div>
      <div class="lp-createrow"><button class="ghost sm" id="lpCreate">＋ Create</button></div>
      <div class="lp-tabs">${PHASES.map((ph) => `<button class="lp-tab${ph.key === CUR ? ' on' : ''}" data-ph="${ph.key}">${ph.tab}</button>`).join('')}</div>
      <div class="lp-sort" id="lpSort">${(SORTS[CUR] || []).map(([k, l]) => `<button class="mini${SORTBY[CUR] === k ? ' on' : ''}" data-sort="${k}">${l}</button>`).join('')}</div>
      ${CUR === 'closed' ? `<div class="lp-sort" id="lpFilter">${[['graduated', 'Graduated'], ['failed', 'Failed'], ['all', 'All']].map(([k, l]) => `<button class="mini${GRADFILTER === k ? ' on' : ''}" data-filter="${k}">${l}</button>`).join('')}</div>` : ''}
      <div id="lpBody" class="lp-body"><div class="statusline load">Loading launches…</div></div>
      <div class="fine" style="margin-top:8px">Conformance verified against the XCP-69 standard in your browser — fixed terms, no premine, pre-announced.</div>`);
    $('#lpX').onclick = close;
    { const lb = $('#lpBackTop'); if (lb) lb.onclick = () => { close(); if (ONBACK) ONBACK(); }; }
    const cr = $('#lpCreate'); if (cr) cr.onclick = openCreate;
    $('#lpCard').querySelectorAll('[data-ph]').forEach((b) => (b.onclick = () => { CUR = b.dataset.ph; render(); }));
    $('#lpCard').querySelectorAll('[data-sort]').forEach((b) => (b.onclick = () => { SORTBY[CUR] = b.dataset.sort; render(); }));
    $('#lpCard').querySelectorAll('[data-filter]').forEach((b) => (b.onclick = () => { GRADFILTER = b.dataset.filter; render(); }));
    let [list] = await Promise.all([launches(CUR), loadMeta()]);
    if (CUR === 'closed' && GRADFILTER !== 'all') list = list.filter((fm) => (GRADFILTER === 'graduated') === isBonded(fm));
    const body = $('#lpBody'); if (!body) return;
    const ph = PHASES.find((p) => p.key === CUR);
    const emptyMsg = (CUR === 'closed' && GRADFILTER !== 'all') ? `No ${GRADFILTER} launches.` : ph.empty;
    body.innerHTML = list.length ? sortList(list).map(card).join('') : `<div class="dash-empty">${esc(emptyMsg)}</div>`;
    body.querySelectorAll('[data-tx]').forEach((b) => (b.onclick = () => openLaunch(BYTX[b.dataset.tx])));
  }

  // ── Launch detail + mint ──
  const fmtXcp = (rawStr) => { const xr = X(); return xr.fromSats(rawStr, true); };
  async function openLaunch(fm) {
    if (!fm) return; const xr = X();
    const name = esc(fm.asset_longname || fm.asset);
    const p = xr.progress(fm);
    const canMint = fm.status === 'open' && !!window.__activeAccount;
    modal(`<div class="cc-head"><div><h3 class="m-title" style="margin:0">${name}</h3>
        <div class="cp-addr" id="lpConf">Verifying XCP-69 conformance…</div></div>
      <div class="cc-head-r"><button class="mini" id="lpBack">‹ Back</button></div></div>
      <div class="lp-bar" style="margin:2px 0 7px"><span style="width:${Math.max(1, Math.min(100, p.pct))}%"></span></div>
      <div class="lp-progline"><b>${p.pct.toFixed(1)}%</b> of the 69M sale minted${fm.status === 'pending' ? ` · scheduled for block ${esc(fm.start_block)}` : fm.status === 'closed' ? (isBonded(fm) ? ' · graduated · pool seeded ✓' : ' · failed · XCP refunded') : ''}</div>
      <div class="lp-stats2">
        <div class="lp-stat"><span>XCP raised</span><b>${esc(raisedTxt(fm))}</b></div>
        <div class="lp-stat"><span>${fm.status === 'pending' ? 'Starts' : fm.status === 'open' ? 'Deadline' : 'Ended'}</span><b>${esc(deadlineTxt(fm))}</b></div>
        <div class="lp-stat"><span>Minters</span><b id="lpMinters">…</b></div>
        <div class="lp-stat"><span>Created</span><b>blk ${esc(String(fm.block_index))}${fm.block_time ? ' · ' + esc(dstr(fm.block_time)) : ''}</b></div>
        <div class="lp-stat"><span>Deployer</span><b><a href="https://mempool.space/address/${esc(fm.source)}" target="_blank" rel="noopener" style="color:var(--gold2)">${esc(short(fm.source))}</a></b></div>
      </div>
      <div class="fine lp-terms">Fixed terms · 100M supply · 69M public sale · 0.01 XCP / 1,000 · 10 XCP per-address cap</div>
      <div id="lpMint" style="margin-top:14px"></div>`);
    $('#lpBack').onclick = () => render();
    // Unique minters (participants) — meaningful mid-mint, since minted tokens sit in escrow (not yet "holders").
    fetch('api/cp/fairminters/' + encodeURIComponent(fm.tx_hash) + '/mints').then((r) => r.json()).then((j) => {
      const arr = j.result || [], uniq = new Set(arr.map((m) => m.source)); const el = $('#lpMinters');
      if (el) el.textContent = uniq.size + (arr.length >= 200 ? '+' : '');
    }).catch(() => { const el = $('#lpMinters'); if (el) el.textContent = '—'; });
    // full conformance (pre-announcement + original window) via the IMMUTABLE creation event
    fetch('api/cp/fairminter-event/' + encodeURIComponent(fm.tx_hash)).then((r) => r.json()).then((j) => {
      const ev = j.event || {}; const ok = xr.isXcp69(fm, { announceBlock: ev.block_index, originalDeadline: (ev.params && ev.params.soft_cap_deadline_block) || ev.soft_cap_deadline_block });
      const el = $('#lpConf'); if (el) el.innerHTML = ok ? '✓ XCP-69 verified — fixed terms, no premine, pre-announced' : '✓ XCP-69 parameters verified (fixed terms · no premine)';
    }).catch(() => { const el = $('#lpConf'); if (el) el.textContent = '✓ XCP-69 parameters verified'; });
    if (canMint) renderMint(fm); else { const m = $('#lpMint'); if (m) m.innerHTML = `<div class="fine">${fm.status === 'open' ? 'Open a local Wonder Wallet to mint.' : 'Minting is ' + (fm.status === 'pending' ? 'not open yet.' : 'closed.')}</div>`; }
  }

  async function renderMint(fm) {
    const xr = X(), box = $('#lpMint'); if (!box) return;
    const qbp = xr.big(fm.quantity_by_price), soft = xr.big(fm.soft_cap), earned = xr.big(fm.earned_quantity) || 0n;
    const capLots = qbp > 0n ? Number(xr.big(fm.max_mint_per_address) / qbp) : 1000; // 10 XCP / 0.01 = 1000 lots
    const leftLots = qbp > 0n ? Math.max(0, Number((soft - earned) / qbp)) : 0;
    const maxLots = Math.max(1, Math.min(capLots, leftLots || capLots));
    let fees = { halfHourFee: 6, fastestFee: 10, hourFee: 3 }; try { fees = await fetch('api/btc/fees').then((r) => r.json()); } catch (_) {}
    fees = window.WWFee ? window.WWFee.stagger(fees, ['fastestFee', 'halfHourFee', 'hourFee']) : fees; // strictly descending presets (no ties)
    let feeRate = fees.halfHourFee || 6;
    // The minter's XCP balance — MAX fills to what they can actually afford (each lot = 0.01 XCP), capped
    // by the 10-XCP per-address allocation + what's left in the sale. Also grab BTC/USD for the confirm fee.
    var src = window.WonderCpFlow && window.WonderCpFlow.activeSource(), xcpBal = 0;
    try { if (src) { const h = await fetch('api/cp/holdings/' + encodeURIComponent(src)).then((r) => r.json()); const x = (h.holdings || []).find((a) => a.asset === 'XCP'); xcpBal = x ? Number(x.qty) || 0 : 0; } } catch (_) {}
    // Subtract XCP already committed by in-flight mints (WWPending) so MAX + validation reflect what's
    // actually spendable across rapid-fire mints, not just the confirmed balance.
    if (src && window.WWPending) { window.WWPending.reconcile(src); xcpBal = window.WWPending.avail(src, 'XCP', xcpBal); }
    try { if (!BTCUSD) { const pr = await fetch('api/prices').then((r) => r.json()); BTCUSD = Number(pr && pr.bitcoin) || 0; } } catch (_) {}
    const affordableLots = Math.floor(xcpBal / 0.01 + 1e-9);
    const maxAffordable = Math.min(maxLots, affordableLots);
    box.innerHTML = `<div class="acct-grp">Mint</div>
      <div class="lp-mintrow"><input id="lpLots" class="m-in" type="number" min="1" max="${maxLots}" value="1" /><span class="lp-lotslbl">lots × 1,000 tokens</span></div>
      <div class="lp-presets">${[1, 5, 10, 'Max'].map((v) => `<button class="mini lp-pre" data-lots="${v}">${v}${v === 'Max' ? '' : '×'}</button>`).join('')}</div>
      <div class="fine" style="margin-top:6px">You hold <b>${xcpBal.toLocaleString('en-US', { maximumFractionDigits: 8 })} XCP</b> — enough for <b>${affordableLots.toLocaleString('en-US')}</b> lot${affordableLots === 1 ? '' : 's'}${affordableLots < capLots ? ' (below the 10 XCP cap)' : ''}.</div>
      <div class="fee-row" id="lpFeeRow" style="margin-top:8px">${[['fastestFee', 'Fast'], ['halfHourFee', '30m'], ['hourFee', '1h']].map(([k, l], i) => `<button class="feeopt ${i === 1 ? 'on' : ''}" data-r="${fees[k] || 5}">${l} · ${fees[k] || '–'}</button>`).join('')}</div>
      <div class="lp-cost" id="lpCost"></div>
      <div id="lpStatus" class="statusline" hidden></div>
      <div class="wbtns"><button class="primary" id="lpMintGo">Review mint</button></div>`;
    const lotsEl = $('#lpLots');
    const cost = () => { const n = Math.max(1, parseInt(lotsEl.value, 10) || 1); const over = n > maxAffordable; const el = $('#lpCost'); if (el) el.innerHTML = `<b>${n}</b> lot${n === 1 ? '' : 's'} = <b>${n * 1000}</b> tokens · costs <b>${(n * 0.01).toLocaleString('en-US', { maximumFractionDigits: 2 })} XCP</b> + a Bitcoin miner fee` + (over ? ` <span style="color:var(--red)">⚠ more than your XCP balance</span>` : ''); };
    lotsEl.oninput = cost; cost();
    box.querySelectorAll('.lp-pre').forEach((b) => (b.onclick = () => {
      if (b.dataset.lots === 'Max') {
        if (maxAffordable < 1) { const st = $('#lpStatus'); if (st) { st.hidden = false; st.className = 'statusline err'; st.textContent = `You need XCP to mint — each lot costs 0.01 XCP, and you hold ${xcpBal.toLocaleString('en-US', { maximumFractionDigits: 8 })} XCP.`; } return; }
        lotsEl.value = maxAffordable;
      } else lotsEl.value = b.dataset.lots;
      cost();
    }));
    box.querySelectorAll('.feeopt').forEach((b) => (b.onclick = () => { box.querySelectorAll('.feeopt').forEach((x) => x.classList.remove('on')); b.classList.add('on'); feeRate = Number(b.dataset.r); }));
    $('#lpMintGo').onclick = () => doMint(fm, Math.max(1, Math.min(maxLots, parseInt(lotsEl.value, 10) || 1)), feeRate);
  }

  async function doMint(fm, lots, feeRate) {
    const xr = X(), s = $('#lpStatus'); if (!s) return;
    s.hidden = false; s.className = 'statusline load'; s.textContent = 'Composing & verifying…';
    try {
      const quantity = (BigInt(lots) * xr.big(fm.quantity_by_price)).toString();
      const { compose, report } = await window.WonderCpFlow.composeVerify('fairmint', { asset: fm.asset, quantity, sat_per_vbyte: feeRate }, { feeRatePerVb: feeRate, debit: { asset: 'XCP', amount: lots * 0.01 } });
      // confirm screen — the verify report becomes a green banner; user signs from here
      if (!BTCUSD) { try { BTCUSD = Number((await fetch('api/prices').then((r) => r.json())).bitcoin) || 0; } catch (_) {} }
      const feeSats = compose.btc_fee != null ? Number(compose.btc_fee).toLocaleString('en-US') : '—';
      modal(`<div class="cc-head"><div><h3 class="m-title" style="margin:0">Confirm mint</h3><div class="cp-addr">${esc(fm.asset_longname || fm.asset)}</div></div><div class="cc-head-r"><button class="m-close-x" id="lpcX" title="Close" aria-label="Close">✕</button></div></div>
        <div class="m-rows">
          <div class="m-row"><span class="k">Mint</span><span class="v">${lots} lot${lots === 1 ? '' : 's'} · ${lots * 1000} tokens</span></div>
          <div class="m-row"><span class="k">XCP cost</span><span class="v">${(lots * 0.01).toLocaleString('en-US', { maximumFractionDigits: 2 })} XCP</span></div>
          <div class="m-row"><span class="k">Miner fee</span><span class="v">${feeSats} sats${usdBtc(compose.btc_fee)}</span></div>
        </div>
        ${window.WonderVerify.bannerHtml(report)}
        <div class="fine" style="margin-top:8px">Your XCP + minted tokens sit in escrow until the launch resolves — sold out ⇒ tokens released &amp; pool seeds; missed ⇒ your XCP is auto-refunded.</div>
        <div id="lpcStatus" class="statusline" hidden></div>
        <div class="wbtns"><button class="ghost" id="lpcBack">Back</button><button class="primary" id="lpcGo">Sign &amp; mint</button></div>`);
      $('#lpcX').onclick = close;
      $('#lpcBack').onclick = () => openLaunch(fm);
      $('#lpcGo').onclick = async () => {
        const cs = $('#lpcStatus'); cs.hidden = false; cs.className = 'statusline load'; cs.textContent = 'Signing & broadcasting…';
        try { const { txid } = await window.WonderCpFlow.sign(compose);
          cs.className = 'statusline'; cs.innerHTML = `Minted ✓ — <a href="https://mempool.space/tx/${encodeURIComponent(txid)}" target="_blank" rel="noopener" style="color:var(--gold2)">${esc(String(txid).slice(0, 18))}…</a> · Counterparty confirms separately.`;
          // Broadcast done — no going back; swap Back + Sign for a single Confirm (the ✕ stays in the corner).
          const btns = $('#lpCard .wbtns'); if (btns) { btns.innerHTML = '<button class="primary" id="lpcDone">Confirm</button>'; const d = $('#lpcDone'); if (d) d.onclick = close; }
        } catch (e) { cs.className = 'statusline err'; cs.textContent = 'Failed: ' + (e.message || 'sign/broadcast error'); }
      };
    } catch (e) {
      s.className = 'statusline err';
      s.textContent = /insufficient xcp/i.test(e.message || '') ? 'Not enough XCP on this Counterparty address to mint that many lots.' : (e.message || 'Compose/verify failed.');
    }
  }

  // ── Create an XCP-69 launch (fairminter with the fixed params + random anti-snipe lp_asset) ──
  const CR = { lead: 144, height: 0, feeRate: 6 };
  // A cryptographically-random unissued numeric Counterparty asset (numeric issuance is free; a
  // predictable lp name could be squatted between broadcast and confirmation, invalidating the launch).
  function randomLpAsset() {
    const MIN = 95428956661682177n, MAX = 18446744073709551615n, span = MAX - MIN;
    const b = new Uint8Array(8); crypto.getRandomValues(b);
    let n = 0n; for (const x of b) n = (n << 8n) | BigInt(x);
    return 'A' + (MIN + (n % span)).toString();
  }
  async function openCreate() {
    if (!window.__activeAccount) return;
    try { const st = await fetch('api/status').then((r) => r.json()); CR.height = (st.btc && st.btc.height) || 0; } catch (_) {}
    try { const f = await fetch('api/btc/fees').then((r) => r.json()); CR.feeRate = f.halfHourFee || 6; } catch (_) {}
    const LEADS = [['~6h', 36], ['~1 day', 144], ['~3 days', 432]];
    modal(`<div class="lp-createform"><div class="cc-head"><div><h3 class="m-title" style="margin:0">Create an XCP-69 launch</h3><div class="cp-addr">Fixed terms — 100M supply · 69M sale · 0.01 XCP/1,000 · 10 XCP cap · all-or-nothing</div></div><button class="m-close-x" id="crX" title="Close" aria-label="Close">✕</button></div>
      <label class="cpf"><span>Token name</span><input id="crName" class="m-in" placeholder="MYTOKEN (4–12 letters, not starting with A)" maxlength="12" spellcheck="false" autocapitalize="characters"/></label>
      <label class="cpf"><span>Info URL <span class="fine">(optional — image + metadata JSON)</span></span><input id="crDesc" class="m-in" placeholder="https://…/MYTOKEN.json" spellcheck="false"/></label>
      <div class="cpf"><span>Pre-announce &amp; start in</span><div class="lp-presets" id="crLead">${LEADS.map(([l, n]) => `<button class="mini${n === CR.lead ? ' on' : ''}" data-lead="${n}">${l}</button>`).join('')}</div></div>
      <div class="fine" id="crSched"></div>
      <div class="fine" style="margin-top:6px">Costs 0.5 XCP name registration + a pool-deposit gas fee (prepaid) + a Bitcoin miner fee. You receive <b>none</b> of the 690 XCP raise — it all seeds the permanently-locked pool.</div>
      <div id="crStatus" class="statusline" hidden></div>
      <div class="wbtns"><button class="ghost" id="crBack">Back</button><button class="primary" id="crGo">Review launch</button></div></div>`);
    $('#crX').onclick = close; $('#crBack').onclick = () => render();
    const sched = () => { const start = CR.height + CR.lead; const el = $('#crSched'); if (el) el.innerHTML = `Starts at block <b>${start}</b> (now ${CR.height}) · ~7-day mint window · deadline block ${start + 1000}`; };
    $('#lpCard').querySelectorAll('[data-lead]').forEach((b) => (b.onclick = () => { CR.lead = Number(b.dataset.lead); $('#lpCard').querySelectorAll('[data-lead]').forEach((x) => x.classList.toggle('on', x === b)); sched(); }));
    sched();
    $('#crGo').onclick = doCreate;
  }
  async function doCreate() {
    const xr = X(), s = $('#crStatus'); if (!s) return;
    const name = ($('#crName').value || '').trim().toUpperCase(); const nEl = $('#crName'); if (nEl) nEl.value = name;
    const desc = ($('#crDesc').value || '').trim();
    if (!/^[B-Z][A-Z]{3,11}$/.test(name)) { s.hidden = false; s.className = 'statusline err'; s.textContent = 'Token name must be 4–12 letters and not start with A.'; return; }
    s.hidden = false; s.className = 'statusline load'; s.textContent = 'Composing & verifying…';
    try {
      const K = xr.XCP69, start = CR.height + CR.lead;
      const params = {
        asset: name, price: K.PRICE.toString(), quantity_by_price: K.QUANTITY_BY_PRICE.toString(),
        hard_cap: K.HARD_CAP.toString(), soft_cap: K.SOFT_CAP.toString(), pool_quantity: K.POOL_QUANTITY.toString(),
        lp_asset: randomLpAsset(), max_mint_per_address: K.MAX_MINT_PER_ADDRESS.toString(), max_mint_per_tx: K.MAX_MINT_PER_TX.toString(),
        start_block: start, soft_cap_deadline_block: start + 1000, end_block: 0, premint_quantity: 0, minted_asset_commission: 0,
        burn_payment: false, lock_quantity: true, lock_description: true, divisible: true, sat_per_vbyte: CR.feeRate,
      };
      if (desc) params.description = desc;
      const { compose, report } = await window.WonderCpFlow.composeVerify('fairminter', params, { feeRatePerVb: CR.feeRate });
      const feeSats = compose.btc_fee != null ? Number(compose.btc_fee).toLocaleString('en-US') : '—';
      const leadLbl = CR.lead === 36 ? '6h' : CR.lead === 432 ? '3 days' : '1 day';
      modal(`<div class="cc-head"><div><h3 class="m-title" style="margin:0">Confirm launch</h3><div class="cp-addr">${esc(name)}</div></div></div>
        <div class="m-rows">
          <div class="m-row"><span class="k">Token</span><span class="v">${esc(name)} · 100M supply</span></div>
          <div class="m-row"><span class="k">Sale</span><span class="v">69M · 0.01 XCP / 1,000 · 10 XCP cap</span></div>
          <div class="m-row"><span class="k">Starts</span><span class="v">block ${start} (~${leadLbl})</span></div>
          <div class="m-row"><span class="k">Miner fee</span><span class="v">${feeSats} sats</span></div>
        </div>
        ${window.WonderVerify.bannerHtml(report)}
        <div class="fine" style="margin-top:8px">Pre-announced on-chain before it opens — no stealth mint. Sell out ⇒ pool seeds &amp; LP burns; miss ⇒ all minters auto-refunded.</div>
        <div id="crcStatus" class="statusline" hidden></div>
        <div class="wbtns"><button class="ghost" id="crcBack">Back</button><button class="primary" id="crcGo">Sign &amp; launch</button></div>`);
      $('#crcBack').onclick = openCreate;
      $('#crcGo').onclick = async () => {
        const cs = $('#crcStatus'); cs.hidden = false; cs.className = 'statusline load'; cs.textContent = 'Signing & broadcasting…';
        try { const { txid } = await window.WonderCpFlow.sign(compose); cs.className = 'statusline'; cs.innerHTML = `Launch created ✓ — <a href="https://mempool.space/tx/${encodeURIComponent(txid)}" target="_blank" rel="noopener" style="color:var(--gold2)">${esc(String(txid).slice(0, 18))}…</a> · it pre-announces, then opens at block ${start}.`; }
        catch (e) { cs.className = 'statusline err'; cs.textContent = 'Failed: ' + (e.message || 'sign/broadcast error'); }
      };
    } catch (e) {
      s.className = 'statusline err';
      s.textContent = /insufficient xcp/i.test(e.message || '') ? 'Not enough XCP to pay the 0.5 XCP registration + pool-deposit gas fee.'
        : /in use|already|exists/i.test(e.message || '') ? 'That token name is taken — pick another.'
        : (e.message || 'Compose/verify failed.');
    }
  }

  window.WonderLaunchpad = { open: (opts) => { ONBACK = (opts && opts.onBack) || null; CUR = 'open'; render(); }, openLaunch, openCreate };
})();
