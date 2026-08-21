/* Wonder Wallet — Phase 6 Counterparty actions.
   compose (CP Core v2, server-proxied) › sign client-side (Phase 5/6 engine) › broadcast.
   v1 actions: send · sweep · MPMA · dispenser · dispense · dividend · destroy · name issuance. */
'use strict';
(function () {
  const C = window.WonderCore;
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // Field types: text | number | select | check. asset:true marks an asset whose divisibility scales `quantity`.
  const ACTIONS = {
    send: { label: 'Send asset', icon: '➤', xcp: false, wallet: true, fields: [
      { k: 'destination', l: 'To address or name.btc' }, { k: 'asset', l: 'Asset', asset: true, combo: true },
      { k: 'quantity', l: 'Quantity', t: 'number', scaleBy: 'asset', bal: true }, { k: 'memo', l: 'Memo (optional)', opt: true } ] },
    sweep: { label: 'Sweep', icon: '🧹', xcp: true, fields: [
      { k: 'destination', l: 'To address or name.btc' },
      { k: 'flags', l: 'What to move', t: 'select', opts: [[1, 'Balances'], [2, 'Ownership'], [3, 'Balances + ownership']] },
      { k: 'memo', l: 'Memo (optional)', opt: true } ] },
    mpma: { label: 'MPMA send', icon: '⇶', xcp: false, fields: [
      { k: 'destinations', l: 'To addresses or names.btc (comma-separated)' },
      { k: 'assets', l: 'Assets (comma-separated)' },
      { k: 'quantities', l: 'Quantities (comma-separated, raw)' } ] },
    dispenser: { label: 'Dispenser', icon: '🪙', xcp: false, wallet: true, fields: [
      { k: 'asset', l: 'Asset', asset: true, combo: true, divInfo: true },
      { k: 'give_quantity', l: 'Give per dispense', t: 'number', scaleBy: 'asset' },
      { k: 'escrow_quantity', l: 'Total to escrow', t: 'number', scaleBy: 'asset', bal: true },
      { k: 'mainchainrate', l: 'BTC price per dispense (sats)', t: 'number', satsRate: true },
      { k: 'status', l: 'Action', t: 'select', opts: [[0, 'Open / refill'], [10, 'Close']] } ] },
    dispense: { label: 'Trigger dispense', icon: '⛏', xcp: false, fields: [
      { k: 'dispenser', l: 'Dispenser address', dispDetect: true },
      { k: 'quantity', l: 'BTC to send (sats)', t: 'number', dispCost: true } ] },
    dividend: { label: 'Dividend', icon: '💸', xcp: true, fields: [
      { k: 'asset', l: 'Pay holders of asset', asset: true },
      { k: 'dividend_asset', l: 'Pay in asset', asset: true },
      { k: 'quantity_per_unit', l: 'Quantity per unit (raw)', t: 'number' } ] },
    destroy: { label: 'Destroy / burn', icon: '🔥', xcp: false, wallet: true, fields: [
      { k: 'asset', l: 'Asset', asset: true, combo: true }, { k: 'quantity', l: 'Quantity', t: 'number', scaleBy: 'asset', bal: true },
      { k: 'tag', l: 'Tag (optional)', opt: true } ] },
    issuance: { label: 'Name issuance', icon: '✦', xcp: true, fields: [
      { k: 'asset', l: 'Asset name (4–12 chars, not starting with A)', nameCheck: true, maxlen: 12 }, { k: 'quantity', l: 'Quantity', t: 'number' },
      { k: 'divisible', l: 'Divisible', t: 'check' }, { k: 'description', l: 'Description', opt: true },
      { k: 'lock', l: 'Lock supply', t: 'check', opt: true } ] },
    fairminter: { label: 'Fairminter (create)', icon: '⚒', xcp: true, fields: [
      { k: 'asset', l: 'New asset name' },
      { k: 'price', l: 'Price per mint (XCP, 0 = free)', t: 'number', scaleXcp: true },
      { k: 'quantity_by_price', l: 'Units minted per price (raw)', t: 'number' },
      { k: 'max_mint_per_tx', l: 'Max per mint tx (raw)', t: 'number' },
      { k: 'hard_cap', l: 'Hard cap (raw, 0 = none)', t: 'number', opt: true },
      { k: 'divisible', l: 'Divisible', t: 'check' },
      { k: 'description', l: 'Description', opt: true } ] },
    fairmint: { label: 'Fairmint (mint)', icon: '⛏', xcp: false, fields: [
      { k: 'asset', l: 'Fairminter asset' },
      { k: 'quantity', l: 'Quantity to mint (raw)', t: 'number' } ] },
  };

  let ACCOUNT = 0, FROM = null, FROM_TYPE = 'nativeSegwit', WALLET_ASSETS = null, LAST_PARAMS = {};
  // When a tool is launched from a specific place (e.g. the asset-detail window), BACK_FN is where its
  // "Back" returns — otherwise Back falls to the Counterparty actions hub. Cleared whenever the hub opens.
  let BACK_FN = null;
  // EXT: a connected external wallet ({address, name, signPsbt, pushPsbt}) from wallet-connect. When set,
  // composed CP PSBTs are signed + broadcast by IT (not the local seed). Cleared on every local entry.
  let EXT = null;
  const btcTypeOf = (a) => (/^bc1p/i.test(a) ? 'taproot' : /^bc1q/i.test(a) ? 'nativeSegwit' : /^3/.test(a) ? 'nestedSegwit' : /^1/.test(a) ? 'legacy' : 'nativeSegwit');
  const b64hex = (b) => { const bin = atob(b); let h = ''; for (let i = 0; i < bin.length; i++) h += (bin.charCodeAt(i) & 0xff).toString(16).padStart(2, '0'); return h; };
  const RE_BTC_ADDR = /^(bc1[a-z0-9]{8,87}|[13][a-km-zA-HJ-NP-Z1-9]{25,39})$/;

  // ── Custom miner-fee rate for CP composes (Counterparty accepts sat_per_vbyte, incl. sub-sat). ──
  let CP_FEES = null, CP_FEERATE = null;
  async function loadCpFees() { if (!CP_FEES) { try { CP_FEES = await fetch('api/btc/fees').then((r) => r.json()); } catch (_) { CP_FEES = { fastestFee: 10, halfHourFee: 6, hourFee: 3 }; } } if (CP_FEERATE == null) CP_FEERATE = (window.WWFee ? window.WWFee.stagger(CP_FEES).halfHourFee : (CP_FEES.halfHourFee || 6)); if (!_btcUsd) { try { _btcUsd = (await fetch('api/prices').then((r) => r.json())).bitcoin || 0; } catch (_) {} } return CP_FEES; }
  // sats → " · ≈ $X" USD tag for the confirm screens (blank until the price is known).
  const usdTag = (n) => (_btcUsd && n ? ` <span class="fine">≈ $${((n / 1e8) * _btcUsd).toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>` : '');
  function cpFeeRowHtml() {
    const f = (window.WWFee ? window.WWFee.stagger(CP_FEES || {}) : (CP_FEES || { fastestFee: 10, halfHourFee: 6, hourFee: 3 })); // strictly descending → one highlight, no ties
    const def = CP_FEERATE != null ? CP_FEERATE : f.halfHourFee;
    return `<label class="cpf"><span>Miner fee rate <span class="fine">custom · sub-sat ok (e.g. 0.8)</span></span>
      <div class="fee-row" id="cpFeeRow">${[['fastestFee', 'Fast'], ['halfHourFee', 'Med'], ['hourFee', 'Econ']].map(([k, l]) => `<button type="button" class="feeopt${f[k] === def ? ' on' : ''}" data-r="${f[k]}">${l} · ${f[k]}</button>`).join('')}<input id="cpFeeCustom" class="m-in fee-custom" type="number" min="0.1" step="0.1" placeholder="custom s/vB"/></div></label>
      <div id="cpFeeHint" class="fee-hint" hidden></div>`;
  }
  function wireCpFee() {
    const row = $('#cpFeeRow'); if (!row) return;
    const hint = (r) => { const h = $('#cpFeeHint'); if (!h) return; if (r > 0 && r < 1) { h.hidden = false; h.textContent = '⚠ Below 1 sat/vB may not relay on all nodes — best when the mempool is near-empty.'; } else { h.hidden = true; } };
    row.querySelectorAll('.feeopt').forEach((b) => (b.onclick = () => { row.querySelectorAll('.feeopt').forEach((x) => x.classList.remove('on')); b.classList.add('on'); CP_FEERATE = Number(b.dataset.r); const fc = $('#cpFeeCustom'); if (fc) fc.value = ''; hint(CP_FEERATE); }));
    const fc = $('#cpFeeCustom'); if (fc) fc.oninput = () => { if (fc.value !== '') { const r = Number(fc.value); if (r > 0) { row.querySelectorAll('.feeopt').forEach((x) => x.classList.remove('on')); CP_FEERATE = r; hint(r); } } };
  }
  // SECURITY: verify a SERVER-composed CP tx pays BTC only to the source (change) or an address the
  // user actually typed — before we sign. Blocks a tampered/compromised proxy from siphoning BTC.
  function verifyOutputs(c) {
    // Fail CLOSED: an undecodable composed tx must abort, never sign blind (WW-C01 cited this catch→return).
    let outs = null; try { outs = C.decodeTxOutputs(c.psbt); } catch (_) { throw new Error('Aborted — the composed transaction could not be decoded to verify its outputs; refusing to sign what cannot be read.'); }
    const allowed = new Set([FROM]);
    Object.values(LAST_PARAMS || {}).forEach((v) => { if (typeof v === 'string' && RE_BTC_ADDR.test(String(v).trim())) allowed.add(String(v).trim()); });
    for (const o of outs) {
      if (o.opReturn || !o.value || !o.address) continue; // skip data / undecodable outputs (no spendable recipient)
      if (!allowed.has(o.address)) throw new Error('Aborted — the composed transaction pays BTC to an unexpected address (' + o.address + '). It may have been tampered with; nothing was signed.');
    }
  }
  // SECURITY (audit H — CP-data decoder): positively confirm the asset's intended RECIPIENT is
  // actually the one baked into the composed transaction. A classic send carries the recipient as a
  // BTC output; an *enhanced_send* hides it inside the OP_RETURN Counterparty data — where output
  // inspection can't see it. CP encodes the recipient's hash160 / witness-program verbatim in that
  // data, so a tampered proxy that swaps the recipient leaves the user's own destination hash absent.
  // We require every user-entered destination to appear EITHER as a payment output OR in the CP data.
  const DEST_KEYS = ['destination', 'transfer_destination'];
  function intendedDests() {
    const out = [];
    for (const k of DEST_KEYS) { const v = LAST_PARAMS && LAST_PARAMS[k]; if (typeof v === 'string' && RE_BTC_ADDR.test(v.trim())) out.push(v.trim()); }
    const multi = LAST_PARAMS && LAST_PARAMS.destinations; // mpma: comma-separated
    if (typeof multi === 'string') multi.split(',').map((s) => s.trim()).filter((x) => RE_BTC_ADDR.test(x)).forEach((x) => out.push(x));
    return [...new Set(out)];
  }
  // → {ok:true, list:[{addr,via}]} | {ok:false, bad} | null (nothing to check)
  function checkRecipients(c) {
    const dests = intendedDests();
    if (!dests.length) return null;
    const data = String(c.data || '').toLowerCase();
    const outAddrs = new Set();
    try { for (const o of C.decodeTxOutputs(c.psbt)) if (o.address) outAddrs.add(o.address); } catch (_) {}
    const list = [];
    for (const d of dests) {
      const inOut = outAddrs.has(d);
      const h = C.addrHash(d);
      const inData = !!(h && data.includes(h.toLowerCase()));
      if (!inOut && !inData) return { ok: false, bad: d };
      list.push({ addr: d, via: inData ? 'Counterparty data' : 'payment output' });
    }
    return { ok: true, list };
  }
  function verifyRecipient(c) {
    const r = checkRecipients(c);
    if (r && !r.ok) throw new Error('Aborted — the intended recipient ' + r.bad + ' is not present in the composed transaction (neither as a payment output nor encoded in the Counterparty data). It may redirect your asset to another address; nothing was signed.');
  }
  // A green "recipient verified" (or red mismatch) banner for the confirm screen.
  function recipientBannerHtml(c) {
    let r; try { r = checkRecipients(c); } catch (_) { r = null; }
    if (!r) return '';
    if (!r.ok) return `<div class="warn" style="border-color:#c0392b;color:#e74c3c">⚠ Recipient MISMATCH — ${esc(r.bad)} is not encoded in this transaction. Do not sign.</div>`;
    return `<div class="cp-verified">${r.list.map((x) => `✓ Verified recipient <b>${esc(x.addr)}</b> <span class="fine">(via ${x.via})</span>`).join('<br>')}</div>`;
  }
  // Source address-type switching (OG assets live on Legacy 1… / P2SH 3…). Reads the active
  // account's derived addresses from the wallet; legacy signing fetches prev-txs (nonWitnessUtxo).
  const BTC_TYPES = [['nativeSegwit', 'Native SegWit · bc1q'], ['legacy', 'Legacy · 1… (OG Counterparty / Stamps)'], ['taproot', 'Taproot · bc1p'], ['nestedSegwit', 'Nested SegWit · 3…']];
  const BTC_SHORT = { nativeSegwit: 'Native SegWit', legacy: 'Legacy 1…', taproot: 'Taproot', nestedSegwit: 'Nested SegWit' };
  const acctBtc = () => { const a = window.__activeAccount; return a && a.bitcoin ? a.bitcoin : null; };
  function srcSelectorHtml() {
    const b = acctBtc();
    // Connected external wallet → one fixed address (already shown in the dashboard); nothing to show.
    if (!b) return '';
    // Local: the Bitcoin address type is chosen in the ACCOUNT WINDOW (native-segwit ↔ Legacy 1… for OG
    // Counterparty / Stamps), and the tool launches with it — so this is a READ-ONLY confirmation of the
    // active source, not a picker. To use a different address, switch type in the account window first.
    const lbl = BTC_SHORT[FROM_TYPE] || '';
    return `<div class="cp-srcline" title="Source address — change the type in the account window"><span class="cp-srck">Source</span><span class="cp-src" id="cpSrcAddr">${esc(FROM)}${lbl ? ` · ${esc(lbl)}` : ''}</span></div>`;
  }
  // Sign a composed CP PSBT for the current source type — fetch prev-txs when legacy.
  async function cpSign(c) {
    // Fail-closed universal verification (WW-C02 + the WW-C01 fail-open decode): re-decode the composed
    // tx and re-check outputs / recipient / fee / SIGHASH, AND re-validate every input against FRESH
    // coin-control before signing. Counterparty Core chose the inputs, so a frozen / asset-bearing /
    // unknown outpoint must never be signed just because it's ours. Detach legitimately spends its one
    // asset UTXO (carried on LAST_PARAMS.__detachUtxo) — that outpoint, and only it, is allowed.
    if (window.WonderVerify) {
      const allowed = [];
      Object.values(LAST_PARAMS || {}).forEach((v) => { if (typeof v === 'string' && RE_BTC_ADDR.test(String(v).trim())) allowed.push(String(v).trim()); });
      const vsize = (c.signed_tx_estimated_size && c.signed_tx_estimated_size.vsize) || 0;
      const intent = { from: FROM, allowed, dests: intendedDests(), allowInputs: (LAST_PARAMS && LAST_PARAMS.__detachUtxo) ? [String(LAST_PARAMS.__detachUtxo)] : [] };
      if (vsize && CP_FEERATE) intent.feeMaxSats = Math.ceil(CP_FEERATE * vsize * 2.5);
      await window.WonderVerify.verify(c, intent); // throws on ANY failure → nothing signed
    } else {
      verifyOutputs(c); verifyRecipient(c); // defensive fallback if the verifier module failed to load
    }
    let prevTxs = {};
    if (FROM_TYPE === 'legacy') {
      const uniq = [...new Set(C.psbtInputs(c.psbt).map((i) => i.txid))];
      const got = await Promise.all(uniq.map((t) => fetch('api/btc/tx/' + t + '/hex').then((r) => (r.ok ? r.text() : null)).then((h) => [t, h && h.trim()]).catch(() => [t, null])));
      for (const [t, h] of got) { if (h) prevTxs[t] = h; }
    }
    // Imported accounts sign with their own WIF (the synthetic active account carries importedId);
    // HD accounts derive from the seed. importedId absent → normal derivation.
    const importedId = (window.__activeAccount && window.__activeAccount.importedId) || null;
    return C.signCp(c.psbt, c.inputs_values, c.lock_scripts, ACCOUNT, FROM_TYPE, prevTxs, importedId);
  }

  function modal(html, wide) {
    let m = $('#cpmodal');
    if (!m) { m = document.createElement('div'); m.id = 'cpmodal'; m.className = 'modal'; m.innerHTML = '<div class="modal-card" id="cpCard"></div>'; document.body.appendChild(m); m.addEventListener('click', (e) => { if (e.target.id === 'cpmodal') close(); }); }
    $('#cpCard').className = 'modal-card' + (wide ? ' cc-card' : '');
    $('#cpCard').innerHTML = html; m.hidden = false; return $('#cpCard');
  }
  // Hub-aware exit: when launched from the dApp dashboard, closing returns there and the
  // exit control reads "‹ Dashboard"; otherwise it's a plain "Close".
  const fromHub = () => !!(window.DappDashboard && window.DappDashboard.fromHub && window.DappDashboard.fromHub());
  const exitLabel = () => (fromHub() ? '‹ Dashboard' : 'Close');
  function close() { const m = $('#cpmodal'); if (m) m.hidden = true; if (window.DappDashboard && window.DappDashboard.returnToHub) window.DappDashboard.returnToHub(); }
  // Back to whoever launched this tool (e.g. the asset-detail window): hide OUR modal, then run the
  // callback — which opens its own modal. No returnToHub side-effect. One-shot (clears the target).
  function goBack() { const m = $('#cpmodal'); if (m) m.hidden = true; const fn = BACK_FN; BACK_FN = null; if (fn) try { fn(); } catch (_) {} }

  function open(account, fromAddress) {
    EXT = null; ACCOUNT = account; FROM = fromAddress;
    const b = acctBtc();
    FROM_TYPE = b ? (Object.keys(b).find((t) => b[t].address === fromAddress) || 'nativeSegwit') : 'nativeSegwit';
    renderHub();
  }
  function renderHub() {
    BACK_FN = null; // opening the hub clears any per-launch back target
    const grid = Object.entries(ACTIONS).map(([k, a]) => `<button class="cp-act" data-k="${k}"><span class="cp-ic">${a.icon}</span>${a.label}</button>`).join('')
      + `<button class="cp-act" data-adhub="1"><span class="cp-ic">🔗</span>Attach / Detach</button>`; // bind an asset to a UTXO / release it
    modal(`<h3 class="m-title">Counterparty actions</h3>
      ${srcSelectorHtml()}
      <div id="cpStatus" class="cp-status">Checking pending Counterparty txs…</div>
      <div class="cp-grid">${grid}</div>
      <button class="modal-x" id="cpx">${exitLabel()}</button>`);
    $('#cpx').onclick = close;
    const sel = $('#cpSrcSel');
    if (sel) sel.onchange = () => { const bb = acctBtc(); FROM_TYPE = sel.value; FROM = bb[FROM_TYPE].address; WALLET_ASSETS = null; const a = $('#cpSrcAddr'); if (a) a.textContent = FROM; refreshMempool(); };
    $('#cpCard').querySelectorAll('.cp-act[data-k]').forEach((btn) => (btn.onclick = () => openForm(btn.dataset.k)));
    const adb = $('#cpCard').querySelector('[data-adhub]'); if (adb) adb.onclick = () => attachDetach(ACCOUNT, FROM);
    refreshMempool();
  }
  async function refreshMempool() {
    const st = $('#cpStatus'); if (!st) return;
    st.textContent = 'Checking pending Counterparty txs…';
    try {
      const m = await fetch(`api/cp/mempool/${FROM}`).then((r) => r.json());
      st.innerHTML = m.pending && m.pending.length ? `⏳ ${m.pending.length} pending Counterparty tx(s) in mempool — CP confirmation differs from BTC confirmation.` : '✓ No pending Counterparty transactions.';
    } catch (_) { st.textContent = ''; }
  }

  async function openForm(key) {
    const a = ACTIONS[key];
    await loadCpFees();
    const fields = a.fields.map((f) => {
      if (f.t === 'select') return `<label class="cpf"><span>${f.l}</span><select data-k="${f.k}" class="m-in">${f.opts.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>`;
      if (f.t === 'check') return `<label class="cpf-check"><input type="checkbox" data-k="${f.k}"/> ${f.l}</label>`;
      // combo: a text input you can TYPE into, with a datalist of the wallet's own assets.
      if (f.combo) return `<label class="cpf"><span>${f.l}</span><input data-k="${f.k}" class="m-in" list="cpdl_${f.k}" type="text" spellcheck="false" placeholder="type an asset, or pick from your wallet"/><datalist id="cpdl_${f.k}"></datalist>${f.divInfo ? `<div class="fine div-hint" id="div_${f.k}"></div>` : ''}</label>`;
      // nameCheck: a new-asset name with a live availability/format chip + a protocol length cap.
      if (f.nameCheck) return `<label class="cpf"><span>${f.l} <span id="nm_${f.k}" class="tickchk"></span></span><input data-k="${f.k}" class="m-in" type="text" maxlength="${f.maxlen || 12}" spellcheck="false" autocomplete="off"/></label>`;
      const balSpan = f.bal ? ` <span class="fine availhint" id="bal_${f.k}"></span>` : '';
      const rateHint = f.satsRate ? `<div class="fine rate-hint" id="rate_${f.k}"></div>` : '';
      const costHint = f.dispCost ? `<div class="fine rate-hint" id="dcost_${f.k}"></div>` : '';
      const dispPanel = f.dispDetect ? `<div class="disp-panel" id="dispPanel" hidden></div>` : '';
      return `<label class="cpf"><span>${f.l}${balSpan}</span><input data-k="${f.k}" class="m-in" type="${f.t || 'text'}" ${f.t === 'number' ? 'step="any"' : ''} spellcheck="false"/>${rateHint}${costHint}</label>${dispPanel}`;
    }).join('');
    modal(`<h3 class="m-title">${a.icon} ${a.label}</h3>
      <div class="cp-src">from ${esc(FROM)}</div>
      ${fields}
      ${a.xcp ? '<div class="fine" id="xcpHint">This action consumes XCP — fee shown on review.</div>' : ''}
      ${cpFeeRowHtml()}
      <div id="cpfStatus" class="statusline" hidden></div>
      <div class="wbtns"><button class="ghost" id="cpBack">Back</button><button class="primary" id="cpReview">Review</button></div>`);
    $('#cpBack').onclick = () => (BACK_FN ? goBack() : renderHub());
    $('#cpReview').onclick = () => review(key);
    wireCpFee();
    if (a.wallet) wireWalletAssets(a);
    const nf = a.fields.find((f) => f.nameCheck);
    if (nf) wireNameCheck(nf);
    const rf = a.fields.find((f) => f.satsRate);
    if (rf) wireRateHint(rf);
    const df = a.fields.find((f) => f.divInfo);
    if (df) wireDivHint(df);
    if (a.fields.find((f) => f.dispDetect)) wireDispense();
  }

  // Trigger-dispense helper — mirrors the Send tool: when the user types a dispenser address, detect
  // the open dispenser and show what it gives + a BTC/USD readout + one-tap trigger quantities that
  // fill the sats amount. Also a live "= 0.0003 BTC · ≈ $19.24 to send" under the amount field.
  async function wireDispense() {
    const inp = $('#cpCard').querySelector('[data-k="dispenser"]');
    const qInp = $('#cpCard').querySelector('[data-k="quantity"]');
    const panel = $('#dispPanel'), cost = $('#dcost_quantity');
    if (!inp || !qInp) return;
    if (!_btcUsd) { try { _btcUsd = (await fetch('api/prices').then((r) => r.json())).bitcoin || 0; } catch (_) {} }
    const nfmt = (n) => Number(n).toLocaleString('en-US');
    const toUsd = (s) => { const u = (s / 1e8) * _btcUsd; return u ? ' ≈ $' + u.toLocaleString('en-US', { maximumFractionDigits: 2 }) : ''; };
    const updCost = () => {
      const s = parseFloat(qInp.value);
      if (cost) cost.innerHTML = (s > 0) ? `= <b>${(s / 1e8).toLocaleString('en-US', { maximumFractionDigits: 8 })} BTC</b>${toUsd(s)} to send` : '';
    };
    qInp.addEventListener('input', updCost);
    function renderDisp(d) {
      if (!panel) return;
      panel.hidden = false;
      const maxDisp = Math.max(1, Math.floor(parseFloat(d.remaining) / parseFloat(d.giveQty)) || 1);
      const opts = [1, 2, 4, 6].filter((q) => q <= maxDisp); if (!opts.length) opts.push(1);
      panel.innerHTML = `<div class="disp-hit"><span class="disp-check">✓</span> <b>Dispenser detected.</b> Gives <b>${esc(d.giveQty)} ${esc(d.asset)}</b> per <b>${nfmt(d.satoshirate)} sats</b>${toUsd(d.satoshirate)} · <b>${maxDisp}</b> dispense${maxDisp === 1 ? '' : 's'} left</div>
        <div class="disp-qty"><span class="disp-lbl">Trigger:</span>${opts.map((q) => `<button type="button" class="disp-q" data-q="${q}">${q}×</button>`).join('')}</div>
        <div class="disp-cost" id="dispCostLine">Pick how many to trigger — it fills the amount for you.</div>`;
      panel.querySelectorAll('.disp-q').forEach((b) => (b.onclick = () => {
        panel.querySelectorAll('.disp-q').forEach((x) => x.classList.toggle('on', x === b));
        const q = Number(b.dataset.q), totalSats = q * d.satoshirate;
        qInp.value = String(totalSats); updCost();
        const recv = (parseFloat(d.giveQty) * q).toLocaleString('en-US', { maximumFractionDigits: 8 });
        const dc = $('#dispCostLine'); if (dc) dc.innerHTML = `<b>${q}×</b> → send <b>${nfmt(totalSats)} sats</b> (${(totalSats / 1e8).toFixed(8)} BTC${toUsd(totalSats)}) + miner fee → receive ~<b>${esc(recv)} ${esc(d.asset)}</b>`;
      }));
    }
    let t = null;
    const run = () => {
      clearTimeout(t);
      t = setTimeout(async () => {
        const to = inp.value.trim();
        if (!RE_BTC_ADDR.test(to)) { if (panel) { panel.hidden = true; panel.innerHTML = ''; } return; }
        try {
          const { dispensers } = await fetch(`api/cp/dispensers/${to}`).then((r) => r.json());
          if (inp.value.trim() !== to) return; // stale
          if (!dispensers || !dispensers.length) { if (panel) { panel.innerHTML = '<div class="disp-hit fine">No open dispenser found at this address.</div>'; panel.hidden = false; } return; }
          renderDisp(dispensers[0]);
        } catch (_) { if (panel) { panel.hidden = true; panel.innerHTML = ''; } }
      }, 400);
    };
    inp.addEventListener('input', run);
    if (inp.value.trim()) run();
  }

  // When an asset is chosen, tell the user whether amounts are whole (indivisible) or fractional
  // (divisible), and flip the give/escrow inputs' step accordingly — so "raw" never surfaces.
  let _divT;
  async function wireDivHint(f) {
    const inp = $('#cpCard').querySelector(`[data-k="${f.k}"]`), hint = $(`#div_${f.k}`);
    if (!inp || !hint) return;
    const run = async () => {
      const v = inp.value.trim().toUpperCase();
      if (!v) { hint.innerHTML = ''; return; }
      hint.className = 'fine div-hint'; hint.textContent = 'checking divisibility…';
      try {
        const info = await fetch('api/cp/asset/' + encodeURIComponent(v)).then((r) => r.json());
        if (inp.value.trim().toUpperCase() !== v) return; // stale
        const div = !!info.divisible;
        hint.innerHTML = div ? '<b>Divisible</b> — enter amounts like 0.5; up to 8 decimals.' : '<b>Indivisible</b> — whole units only.';
        ['give_quantity', 'escrow_quantity'].forEach((k) => { const el = $('#cpCard').querySelector(`[data-k="${k}"]`); if (el) { el.step = div ? 'any' : '1'; el.placeholder = div ? 'e.g. 0.5' : 'whole number'; } });
      } catch (_) { hint.innerHTML = ''; }
    };
    inp.addEventListener('input', () => { clearTimeout(_divT); _divT = setTimeout(run, 350); });
    if (inp.value.trim()) run();
  }

  // Live "= 0.0003 BTC · ≈ $19.24 per dispense" under a sats price field, so the user can sanity-check the ask.
  let _btcUsd = 0;
  async function wireRateHint(f) {
    const inp = $('#cpCard').querySelector(`[data-k="${f.k}"]`), hint = $(`#rate_${f.k}`);
    if (!inp || !hint) return;
    if (!_btcUsd) { try { _btcUsd = (await fetch('api/prices').then((r) => r.json())).bitcoin || 0; } catch (_) {} }
    const upd = () => {
      const sats = parseFloat(inp.value);
      if (!(sats > 0)) { hint.innerHTML = ''; return; }
      const btc = sats / 1e8, usd = btc * _btcUsd;
      hint.innerHTML = `= <b>${btc.toLocaleString('en-US', { maximumFractionDigits: 8 })} BTC</b>${usd ? ` · ≈ <b>$${usd.toLocaleString('en-US', { maximumFractionDigits: 2 })}</b>` : ''} per dispense`;
    };
    inp.addEventListener('input', upd); upd();
  }

  // Deep-link: jump straight to one action form with fields pre-filled (asset-preview shortcuts).
  async function quick(account, fromAddress, key, prefill, onBack) {
    if (!ACTIONS[key]) return;
    EXT = null; BACK_FN = onBack || null; // Back returns to the launcher (e.g. asset detail), not the hub
    ACCOUNT = account; FROM = fromAddress;
    const b = acctBtc(); FROM_TYPE = b ? (Object.keys(b).find((t) => b[t].address === fromAddress) || 'nativeSegwit') : 'nativeSegwit';
    await openForm(key); // async: build the form (fetches fee presets) before prefilling
    if (prefill) Object.entries(prefill).forEach(([k, v]) => {
      const el = $('#cpCard').querySelector(`[data-k="${k}"]`);
      if (el) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
    });
  }

  // Local format check for a NEW Counterparty named asset (protocol rules, verified live):
  // 4–12 chars, A–Z only, can't start with 'A' (that prefix is reserved for numeric assets).
  function namedAssetError(name) {
    if (name.length < 4) return 'min 4 chars';
    if (name.length > 12) return 'max 12 chars';
    if (name[0] === 'A') return 'can’t start with A';
    if (!/^[A-Z]+$/.test(name)) return 'A–Z only';
    return null;
  }
  // Live chip on a new-asset name: format first, then registration check (✓ available / ✗ taken).
  function wireNameCheck(f) {
    const inp = $('#cpCard').querySelector(`[data-k="${f.k}"]`), chk = $(`#nm_${f.k}`);
    if (!inp || !chk) return;
    const run = async () => {
      const t = inp.value.trim().toUpperCase();
      if (!t) { chk.className = 'tickchk'; chk.innerHTML = ''; return; }
      const fmt = namedAssetError(t);
      if (fmt) { chk.className = 'tickchk bad'; chk.innerHTML = `${ISS_CROSS} ${fmt}`; return; }
      chk.className = 'tickchk loading'; chk.textContent = '…';
      try {
        const r = await fetch('api/cp/assetname/' + encodeURIComponent(t)).then((x) => x.json());
        if (inp.value.trim().toUpperCase() !== t) return; // stale
        chk.className = 'tickchk ' + (r.exists ? 'bad' : 'good');
        chk.innerHTML = r.exists ? `${ISS_CROSS} taken` : `${ISS_CHECK} available`;
      } catch (_) { chk.className = 'tickchk'; chk.innerHTML = ''; }
    };
    inp.oninput = () => { clearTimeout(_issT); _issT = setTimeout(run, 350); };
  }

  // Populate a combo field's datalist with the wallet's CP holdings, and mirror the
  // selected asset's balance beside the quantity label. Manual typing always works.
  async function wireWalletAssets(a) {
    const af = a.fields.find((f) => f.combo), bf = a.fields.find((f) => f.bal);
    if (!af) return;
    const inp = $('#cpCard').querySelector(`[data-k="${af.k}"]`), dl = $(`#cpdl_${af.k}`);
    try {
      const { holdings } = await fetch(`api/cp/holdings/${FROM}`).then((r) => r.json());
      WALLET_ASSETS = holdings || [];
      if (dl) dl.innerHTML = WALLET_ASSETS.map((h) => `<option value="${esc(h.asset)}">${esc(h.name && h.name !== h.asset ? h.name + ' · ' : '')}${esc(h.qty)}</option>`).join('');
      if (bf && inp) {
        const bal = $(`#bal_${bf.k}`);
        const upd = () => { const v = inp.value.trim(); const h = WALLET_ASSETS.find((x) => x.asset === v || x.name === v); if (bal) { bal.textContent = h ? `available: ${h.qty}` : ''; bal.dataset.max = h ? h.qty : ''; } };
        inp.oninput = upd; inp.onchange = upd; upd();
      }
    } catch (_) {}
  }

  function collect(key) {
    const a = ACTIONS[key], params = {};
    $('#cpCard').querySelectorAll('[data-k]').forEach((el) => {
      const f = a.fields.find((x) => x.k === el.dataset.k);
      if (el.type === 'checkbox') params[el.dataset.k] = el.checked;
      else if (el.value !== '') params[el.dataset.k] = el.value.trim();
    });
    return params;
  }

  async function review(key) {
    const a = ACTIONS[key];
    const s = $('#cpfStatus'); s.hidden = false; s.className = 'statusline load'; s.textContent = 'Composing via Counterparty…';
    try {
      const params = collect(key);
      // SRC-101: resolve any `.btc` name in destination fields to its address before composing.
      const RE_DOTBTC = /^[a-z0-9][a-z0-9._-]{0,62}\.btc$/i;
      const resolveName = async (nm) => {
        s.textContent = 'Resolving ' + nm + '…';
        const rr = await fetch('api/src101/resolve/' + encodeURIComponent(nm)).then((x) => x.json()).catch(() => null);
        if (!rr || !rr.exists || !rr.address) throw new Error('“' + nm + '” is not a registered Bitcoin Stamps name — check the spelling.');
        return rr.address;
      };
      for (const dk of ['destination', 'transfer_destination']) {
        const v = params[dk]; if (typeof v === 'string' && RE_DOTBTC.test(v.trim())) params[dk] = await resolveName(v.trim());
      }
      if (typeof params.destinations === 'string' && /\.btc/i.test(params.destinations)) {
        const out = [];
        for (const p of params.destinations.split(',').map((x) => x.trim())) out.push(RE_DOTBTC.test(p) ? await resolveName(p) : p);
        params.destinations = out.join(',');
      }
      s.textContent = 'Composing via Counterparty…';
      // New-asset name guard (Name issuance): enforce the protocol format + uniqueness even
      // for manual entries, before we spend the compose round-trip.
      const nf = a.fields.find((f) => f.nameCheck);
      if (nf && params[nf.k]) {
        params[nf.k] = params[nf.k].toUpperCase();
        const fmt = namedAssetError(params[nf.k]);
        if (fmt) throw new Error(`Invalid asset name — ${fmt}. Named assets are 4–12 letters A–Z, not starting with A.`);
        s.textContent = 'Checking name availability…';
        const chk = await fetch('api/cp/assetname/' + encodeURIComponent(params[nf.k])).then((r) => r.json());
        if (chk.exists) throw new Error(`“${params[nf.k]}” is already registered — choose another name.`);
        s.textContent = 'Composing via Counterparty…';
      }
      // Friendly balance guard for wallet-asset pickers (e.g. Destroy) — checked on the
      // human amount before scaling, so it can't ask to burn more than you hold.
      const bf = a.fields.find((f) => f.bal);
      if (bf && WALLET_ASSETS && params.asset && params[bf.k] != null && params[bf.k] !== '') {
        const h = WALLET_ASSETS.find((x) => x.asset === params.asset || x.name === params.asset);
        if (h && parseFloat(params[bf.k]) > parseFloat(h.qty)) throw new Error(`You only hold ${h.qty} ${params.asset} on this address.`);
      }
      // Scale a divisible asset's quantity to raw units.
      for (const f of a.fields) {
        if (f.scaleBy === 'asset' && params[f.k] != null && params.asset) {
          try {
            const info = await fetch('api/cp/asset/' + encodeURIComponent(params.asset)).then((r) => r.json());
            if (info.divisible) params[f.k] = Math.round(parseFloat(params[f.k]) * 1e8);
            else params[f.k] = Math.round(parseFloat(params[f.k]));
          } catch (_) {}
        }
      }
      if (key === 'issuance' && params.divisible && params.quantity) params.quantity = Math.round(parseFloat(params.quantity) * 1e8);
      for (const f of a.fields) { if (f.scaleXcp && params[f.k] != null && params[f.k] !== '') params[f.k] = Math.round(parseFloat(params[f.k]) * 1e8); } // XCP price › satoshis

      let xcpFee = null;
      if (a.xcp) { try { xcpFee = (await fetch(`api/cp/estimate/${key}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: FROM, params }) }).then((r) => r.json())).xcpFee; } catch (_) {} }

      if (CP_FEERATE) params.sat_per_vbyte = CP_FEERATE; // custom miner-fee rate (Counterparty honors sat_per_vbyte)
      LAST_PARAMS = params; // for the pre-sign output verification
      const composed = await fetch(`api/cp/compose/${key}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: FROM, params }) }).then((r) => r.json());
      if (composed.error) throw new Error(composed.detail || composed.error);
      preview(key, composed, xcpFee);
    } catch (err) {
      s.className = 'statusline err';
      s.textContent = err.message === 'insufficient funds' ? 'Insufficient funds (asset balance or BTC for fees) on this address.' : (err.message || 'Compose failed.');
    }
  }

  function preview(key, c, xcpFee) {
    const a = ACTIONS[key];
    const sats = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US') + ' sats');
    const xcp = (n) => (n == null ? null : (n / 1e8).toLocaleString('en-US', { maximumFractionDigits: 8 }) + ' XCP');
    modal(`<button class="m-close-x" id="cpXclose" title="Close" aria-label="Close">✕</button><h3 class="m-title" style="padding-right:34px">Confirm · ${a.label}</h3>
      <div class="m-grid">
        <div><span class="k">Miner fee</span><span class="v">${sats(c.btc_fee)}${usdTag(c.btc_fee)}</span></div>
        <div><span class="k">BTC in / out</span><span class="v">${sats(c.btc_in)} / ${sats(c.btc_out)}</span></div>
        ${xcpFee != null ? `<div><span class="k">XCP fee</span><span class="v">${xcp(xcpFee)}</span></div>` : ''}
        <div><span class="k">Est. size</span><span class="v">${c.signed_tx_estimated_size?.vsize || '—'} vB</span></div>
      </div>
      <div class="cp-data"><span class="k">Counterparty data</span><code>${esc((c.data || '').slice(0, 64))}${(c.data || '').length > 64 ? '…' : ''}</code></div>
      ${recipientBannerHtml(c)}
      ${c.warnings && c.warnings.length ? `<div class="warn">${c.warnings.map(esc).join('<br>')}</div>` : ''}
      <div id="cpbStatus" class="statusline" hidden></div>
      <div class="wbtns"><button class="ghost" id="cpBack2">Back</button><button class="ghost" id="cpExport">Export PSBT</button><button class="primary" id="cpSign">Sign &amp; broadcast</button></div>`);
    $('#cpBack2').onclick = () => openForm(key);
    if ($('#cpXclose')) $('#cpXclose').onclick = close;
    $('#cpExport').onclick = () => { modal(`<h3 class="m-title">Unsigned PSBT</h3><p class="fine">For hardware / co-signing.</p><textarea class="m-in" rows="5" readonly>${c.psbt}</textarea><div class="wbtns"><button class="primary" id="cpCopyP">Copy</button><button class="ghost" id="cpx2">Done</button></div>`); $('#cpCopyP').onclick = (e) => { navigator.clipboard.writeText(c.psbt); e.target.textContent = 'copied ✓'; }; $('#cpx2').onclick = close; };
    // Broadcast is irreversible — collapse the actions to a single Done that closes.
    const collapse = () => { const bb = $('#cpBack2'), eb = $('#cpExport'), sb = $('#cpSign'); if (bb) bb.remove(); if (eb) eb.remove(); if (sb) { sb.textContent = 'Done'; sb.onclick = close; } };
    $('#cpSign').onclick = async () => {
      const s = $('#cpbStatus');
      // Connected external wallet (UniSat/OKX/Wonder): verify + hand off to it (same path as the DEX/panels).
      if (EXT) { await signBroadcast(c, s, 'Broadcast', collapse); return; }
      s.hidden = false; s.className = 'statusline load'; s.textContent = 'Signing locally & broadcasting…';
      try {
        const signed = await cpSign(c);
        const r = await fetch('api/btc/broadcast', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ txhex: signed.txhex }) }).then((x) => x.json());
        if (r.error) throw new Error(r.detail || r.error);
        s.className = 'statusline load'; s.innerHTML = `Broadcast ✓ — <a href="https://mempool.space/tx/${encodeURIComponent(r.txid)}" target="_blank" rel="noopener" style="color:var(--gold2)">${esc(String(r.txid).slice(0, 18))}…</a> · Counterparty will confirm separately.`;
        collapse();
      } catch (err) { s.className = 'statusline err'; s.textContent = 'Failed: ' + (err.message || 'sign/broadcast error'); }
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Shared helpers for the dedicated panels (DEX · Issuance suite · Attach/Detach)
  // ─────────────────────────────────────────────────────────────────────────
  const SATS = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US') + ' sats');

  // Divisibility for quantity scaling. BTC + XCP are divisible (1e8); others ask CP.
  async function isDivisible(asset) {
    const a = String(asset || '').toUpperCase();
    if (a === 'BTC' || a === 'XCP') return true;
    try { const i = await fetch('api/cp/asset/' + encodeURIComponent(a)).then((r) => r.json()); return !!i.divisible; }
    catch (_) { return false; }
  }
  const scale = (val, divisible) => { const n = parseFloat(val); return divisible ? Math.round(n * 1e8) : Math.round(n); };

  function feeGrid(c, extra) {
    return `<div class="m-grid">
      <div><span class="k">Miner fee</span><span class="v">${SATS(c.btc_fee)}${usdTag(c.btc_fee)}</span></div>
      <div><span class="k">BTC in / out</span><span class="v">${SATS(c.btc_in)} / ${SATS(c.btc_out)}</span></div>
      ${extra || ''}
      <div><span class="k">Est. size</span><span class="v">${c.signed_tx_estimated_size?.vsize || '—'} vB</span></div>
    </div>
    ${c.data ? `<div class="cp-data"><span class="k">CP data</span><code>${esc((c.data || '').slice(0, 64))}${(c.data || '').length > 64 ? '…' : ''}</code></div>` : ''}
    ${recipientBannerHtml(c)}
    ${c.warnings && c.warnings.length ? `<div class="warn">${c.warnings.map(esc).join('<br>')}</div>` : ''}`;
  }

  // Sign a composed CP PSBT locally and broadcast (same audited engine as everything else).
  async function signBroadcast(c, statusEl, label, onDone) {
    statusEl.hidden = false; statusEl.className = 'statusline load';
    try {
      // Connected external wallet path: verify the composed tx (same safety as local), then it signs + broadcasts.
      if (EXT) {
        verifyOutputs(c); verifyRecipient(c);
        statusEl.textContent = 'Waiting for approval in ' + (EXT.name || 'your wallet') + '…';
        const hex = /^[0-9a-fA-F]+$/.test(c.psbt) ? c.psbt : b64hex(c.psbt);
        const signed = await EXT.signPsbt(hex, { autoFinalized: true });
        statusEl.textContent = 'Broadcasting…';
        let id;
        if (signed && typeof signed === 'object' && signed.txhex) {
          // Wonder Wallet returns the finalized raw tx {txhex,txid} → broadcast via our server (one prompt).
          const r = await fetch('api/btc/broadcast', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ txhex: signed.txhex }) }).then((x) => x.json());
          if (r.error) throw new Error(r.detail || r.error);
          id = r.txid || signed.txid;
        } else {
          const signedStr = typeof signed === 'string' ? signed : (signed && (signed.psbt || signed.hex)) || hex;
          const txid = await EXT.pushPsbt(signedStr);
          id = typeof txid === 'string' ? txid : (txid && (txid.txid || txid.result)) || String(txid);
        }
        statusEl.className = 'statusline load';
        statusEl.innerHTML = `${label || 'Broadcast'} ✓ — <a href="https://mempool.space/tx/${encodeURIComponent(id)}" target="_blank" rel="noopener" style="color:var(--gold2)">${esc(String(id).slice(0, 18))}…</a> · Counterparty confirms separately.`;
        if (onDone) onDone(); return;
      }
      statusEl.textContent = 'Signing locally & broadcasting…';
      const signed = await cpSign(c);
      const r = await fetch('api/btc/broadcast', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ txhex: signed.txhex }) }).then((x) => x.json());
      if (r.error) throw new Error(r.detail || r.error);
      statusEl.className = 'statusline load';
      statusEl.innerHTML = `${label || 'Broadcast'} ✓ — <a href="https://mempool.space/tx/${encodeURIComponent(r.txid)}" target="_blank" rel="noopener" style="color:var(--gold2)">${esc(String(r.txid).slice(0, 18))}…</a> · Counterparty confirms separately.`;
      if (onDone) onDone();
    } catch (err) { statusEl.className = 'statusline err'; statusEl.textContent = 'Failed: ' + (/reject|cancel|4001|denied/i.test(err.message || '') ? 'you declined in ' + (EXT && EXT.name || 'your wallet') : (err.message || 'sign/broadcast error')); }
  }
  // Generic confirm screen (used by the panels): fee grid + Export PSBT + Sign & broadcast.
  function confirmScreen(title, c, extra, label, backFn) {
    modal(`<button class="m-close-x" id="cXclose" title="Close" aria-label="Close">✕</button><h3 class="m-title" style="padding-right:34px">${esc(title)}</h3>${feeGrid(c, extra)}
      <div id="cBcast" class="statusline" hidden></div>
      <div class="wbtns"><button class="ghost" id="cBack">Back</button><button class="ghost" id="cExp">Export PSBT</button><button class="primary" id="cGo">Sign &amp; broadcast</button></div>`, true);
    $('#cBack').onclick = backFn;
    if ($('#cXclose')) $('#cXclose').onclick = close;
    $('#cExp').onclick = () => { modal(`<h3 class="m-title">Unsigned PSBT</h3><p class="fine">For hardware / co-signing.</p><textarea class="m-in" rows="5" readonly>${c.psbt}</textarea><div class="wbtns"><button class="primary" id="cCopy">Copy</button><button class="ghost" id="cDone">Done</button></div>`); $('#cCopy').onclick = (e) => { navigator.clipboard.writeText(c.psbt); e.target.textContent = 'copied ✓'; }; $('#cDone').onclick = backFn; };
    $('#cGo').onclick = () => signBroadcast(c, $('#cBcast'), label, backFn);
  }

  // ── DEX (Counterparty order book) ────────────────────────────────────────
  function dex(account, fromAddress) { EXT = null; ACCOUNT = account; FROM = fromAddress; dexShell('new'); }
  // Counterparty DEX for a CONNECTED external wallet (UniSat/OKX/Wonder): same book/place/cancel UI,
  // composed server-side, signed + broadcast by the connected wallet. `conn` = { address, name, signPsbt, pushPsbt }.
  function dexConnected(conn) { EXT = conn; ACCOUNT = 0; FROM = conn.address; FROM_TYPE = btcTypeOf(conn.address); dexShell('new'); }
  function dexShell(tab) {
    modal(`<div class="cc-head"><div><h3 class="m-title" style="margin:0">Counterparty DEX</h3>
      <div class="cp-addr">Native, trustless on-chain order book · from ${esc(FROM)}</div></div><button class="mini" id="dxX">${exitLabel()}</button></div>
      <div class="cp-filters" style="margin:6px 0 12px"><button class="ccf ${tab === 'new' ? 'on' : ''}" data-dx="new">New order</button><button class="ccf ${tab === 'mine' ? 'on' : ''}" data-dx="mine">My open orders</button></div>
      <div id="dexBody"></div>`, true);
    $('#dxX').onclick = close;
    $('#cpCard').querySelectorAll('[data-dx]').forEach((b) => (b.onclick = () => dexShell(b.dataset.dx)));
    tab === 'mine' ? dexMine() : dexNew();
  }
  function dexNew() {
    $('#dexBody').innerHTML = `
      <div class="dex-pair">
        <label class="cpf"><span>Give asset</span><input id="dxGA" class="m-in" list="dxGAdl" placeholder="XCP" spellcheck="false"/><datalist id="dxGAdl"></datalist></label>
        <label class="cpf"><span>Give quantity <span class="fine availhint" id="dxGAvail"></span></span><input id="dxGQ" class="m-in" type="number" step="any"/></label>
      </div>
      <div class="dex-pair">
        <label class="cpf"><span>Get asset</span><input id="dxRA" class="m-in" placeholder="PEPECASH" spellcheck="false"/></label>
        <label class="cpf"><span>Get quantity</span><input id="dxRQ" class="m-in" type="number" step="any"/></label>
      </div>
      <label class="cpf"><span>Expiration (blocks, ≤ 8064)</span><input id="dxEX" class="m-in" type="number" value="1000"/></label>
      <div class="fine" id="dxFeeHint" hidden></div>
      <div id="dxStatus" class="statusline" hidden></div>
      <div class="wbtns"><button class="ghost" id="dxBook">View book</button><button class="primary" id="dxReview">Review order</button></div>
      <div id="dxBookPanel" class="dex-book"></div>`;
    const feeHint = () => { const involvesBtc = /^BTC$/i.test($('#dxGA').value.trim()) || /^BTC$/i.test($('#dxRA').value.trim()); const h = $('#dxFeeHint'); h.hidden = !involvesBtc; h.textContent = 'BTC pairs: counterparties pay the on-chain fee at match time. Asset↔asset orders settle purely on Counterparty.'; };
    const giveAvail = () => { const v = $('#dxGA').value.trim(); const h = (WALLET_ASSETS || []).find((x) => x.asset === v.toUpperCase() || x.name === v); const el = $('#dxGAvail'); if (el) el.textContent = h ? `available: ${h.qty}` : ''; };
    $('#dxGA').oninput = () => { feeHint(); giveAvail(); };
    $('#dxRA').oninput = feeHint;
    $('#dxBook').onclick = dexBook;
    $('#dxReview').onclick = dexReview;
    // Pull the wallet's CP holdings → give-asset dropdown + "available" balance.
    (async () => {
      try {
        const { holdings } = await fetch(`api/cp/holdings/${FROM}`).then((r) => r.json());
        WALLET_ASSETS = holdings || [];
        const dl = $('#dxGAdl'); if (dl) dl.innerHTML = WALLET_ASSETS.map((h) => `<option value="${esc(h.asset)}">${esc(h.name && h.name !== h.asset ? h.name + ' · ' : '')}${esc(h.qty)}</option>`).join('');
        giveAvail();
      } catch (_) {}
    })();
  }
  async function dexBook() {
    const ga = $('#dxGA').value.trim().toUpperCase(), ra = $('#dxRA').value.trim().toUpperCase();
    const panel = $('#dxBookPanel');
    if (!ga && !ra) { panel.innerHTML = '<div class="fine">Enter an asset (give and/or get) to load the book.</div>'; return; }
    panel.innerHTML = '<div class="statusline load">Loading order book…</div>';
    try {
      // Both assets → that specific market. One asset → every pair it trades in.
      const url = (ga && ra) ? `api/cp/book/${encodeURIComponent(ga)}/${encodeURIComponent(ra)}` : `api/cp/assetbook/${encodeURIComponent(ga || ra)}`;
      const heading = (ga && ra) ? `${ga} › ${ra}` : `all ${ga || ra} pairs`;
      const { orders } = await fetch(url).then((r) => r.json());
      if (!orders.length) { panel.innerHTML = `<div class="fine">No open orders for ${esc(heading)} right now.</div>`; return; }
      panel.innerHTML = `<div class="acct-grp">Open orders · ${esc(heading)}</div>` + orders.map((o) => `
        <div class="dex-row"><span>${esc(o.give_asset)} <b>${esc(String(o.give_remaining))}</b> › ${esc(o.get_asset)} <b>${esc(String(o.get_remaining))}</b></span>
        <span class="dex-rate">${esc(o.source.slice(0, 8))}… · exp ${esc(String(o.expiration))}</span></div>`).join('');
    } catch (_) { panel.innerHTML = '<div class="statusline err">Could not load the book.</div>'; }
  }
  async function dexReview() {
    const s = $('#dxStatus'); s.hidden = false; s.className = 'statusline load'; s.textContent = 'Composing order via Counterparty…';
    try {
      const ga = $('#dxGA').value.trim().toUpperCase(), ra = $('#dxRA').value.trim().toUpperCase();
      const gq = $('#dxGQ').value.trim(), rq = $('#dxRQ').value.trim(), exp = parseInt($('#dxEX').value, 10) || 1000;
      if (!ga || !ra || !gq || !rq) throw new Error('Fill in both assets and quantities.');
      const [gd, rd] = await Promise.all([isDivisible(ga), isDivisible(ra)]);
      const params = { give_asset: ga, give_quantity: scale(gq, gd), get_asset: ra, get_quantity: scale(rq, rd), expiration: Math.min(exp, 8064), fee_required: 0 };
      LAST_PARAMS = params;
      const c = await fetch('api/cp/compose/order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: FROM, params }) }).then((r) => r.json());
      if (c.error) throw new Error(c.detail || c.error);
      const extra = `<div><span class="k">Order</span><span class="v" style="font-size:13px">${esc(gq)} ${esc(ga)} › ${esc(rq)} ${esc(ra)}</span></div>`;
      confirmScreen(`Confirm order · ${ga} › ${ra}`, c, extra, 'Order placed', () => dexShell('new'));
    } catch (err) { s.className = 'statusline err'; s.textContent = err.message === 'insufficient funds' ? `Insufficient ${$('#dxGA').value.trim().toUpperCase()} balance (or BTC for the miner fee).` : (err.message || 'Compose failed.'); }
  }
  async function dexMine() {
    $('#dexBody').innerHTML = '<div class="statusline load">Loading your open orders…</div>';
    try {
      const { orders } = await fetch(`api/cp/myorders/${FROM}`).then((r) => r.json());
      if (!orders.length) { $('#dexBody').innerHTML = '<div class="fine">You have no open orders on this address.</div>'; return; }
      $('#dexBody').innerHTML = `<div id="dxMineStatus" class="statusline" hidden></div>` + orders.map((o, i) => `
        <div class="dex-row"><span>${esc(o.give_asset)} <b>${esc(String(o.give_remaining))}</b> › ${esc(o.get_asset)} <b>${esc(String(o.get_remaining))}</b><br><span class="fine">${esc(o.tx_hash.slice(0, 20))}… · exp ${esc(String(o.expiration))}</span></span>
        <button class="mini danger" data-cancel="${esc(o.tx_hash)}" data-i="${i}">Cancel</button></div>`).join('');
      $('#dexBody').querySelectorAll('[data-cancel]').forEach((b) => (b.onclick = () => dexCancel(b.dataset.cancel)));
    } catch (_) { $('#dexBody').innerHTML = '<div class="statusline err">Could not load your orders.</div>'; }
  }
  async function dexCancel(offerHash) {
    const s = $('#dxMineStatus'); s.hidden = false; s.className = 'statusline load'; s.textContent = 'Composing cancel…';
    try {
      LAST_PARAMS = {};
      const c = await fetch('api/cp/compose/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: FROM, params: { offer_hash: offerHash } }) }).then((r) => r.json());
      if (c.error) throw new Error(c.detail || c.error);
      confirmScreen('Confirm · cancel order', c, `<div><span class="k">Cancels</span><span class="v" style="font-size:12px">${esc(offerHash.slice(0, 18))}…</span></div>`, 'Order cancelled', () => dexShell('mine'));
    } catch (err) { s.className = 'statusline err'; s.textContent = err.message || 'Cancel failed.'; }
  }

  // ── Full issuance suite ──────────────────────────────────────────────────
  // Each mode maps a small form to the single CP `issuance` compose with the right params.
  const ISS_CHECK = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M3 8.5l3.2 3.2L13 5" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const ISS_CROSS = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"/></svg>';
  const need = (c, msg) => { if (!c) throw new Error(msg); };
  const RE_BTC = /^(bc1[a-z0-9]{8,87}|[13][a-km-zA-HJ-NP-Z1-9]{25,39})$/;
  let OWNED = null, _issT = null;
  const ISS = {
    create: { label: 'Create', hint: 'Create a brand-new named or numeric asset.', fields: [
      { k: 'asset', l: 'Asset name (e.g. WONDERTOKEN) or A-number', check: 'name' }, { k: 'quantity', l: 'Quantity', t: 'number', scale: true },
      { k: 'divisible', l: 'Divisible (8 decimals)', t: 'check' }, { k: 'description', l: 'Description / token URI', opt: true }, { k: 'lock', l: 'Lock supply immediately', t: 'check', opt: true } ] },
    more: { label: 'Issue more', hint: 'Mint additional supply of an asset you own.', own: true, fields: [
      { k: 'asset', l: 'Existing asset you own', combo: 'owned' }, { k: 'quantity', l: 'Additional quantity', t: 'number', scale: true } ] },
    lock: { label: 'Lock', hint: 'Permanently lock supply — no further issuance ever.', own: true, fields: [{ k: 'asset', l: 'Asset to lock', combo: 'owned' }], fixed: { quantity: 0, lock: true } },
    transfer: { label: 'Transfer', hint: 'Transfer ownership of the asset to another address.', own: true, fields: [{ k: 'asset', l: 'Asset you own', combo: 'owned' }, { k: 'transfer_destination', l: 'New owner address' }], fixed: { quantity: 0 } },
    describe: { label: 'Description', hint: 'Change the on-chain description / token URI.', own: true, fields: [{ k: 'asset', l: 'Asset you own', combo: 'owned' }, { k: 'description', l: 'New description' }], fixed: { quantity: 0 } },
    subasset: { label: 'Subasset', hint: 'Issue a subasset under a named/numeric asset you own (PARENT.child).', own: true, sub: true, fields: [
      { k: 'parent', l: 'Parent asset (you must own it)', combo: 'owned' }, { k: 'child', l: 'Subasset name (the part after the dot)' },
      { k: 'quantity', l: 'Quantity', t: 'number', scale: true }, { k: 'divisible', l: 'Divisible', t: 'check' }, { k: 'description', l: 'Description', opt: true } ] },
  };
  let ISS_MODE = 'create';
  function issuanceSuite(account, fromAddress) { EXT = null; ACCOUNT = account; FROM = fromAddress; ISS_MODE = 'create'; OWNED = null; issShell(); }
  function issShell() {
    const m = ISS[ISS_MODE];
    const fields = m.fields.map((f) => {
      if (f.t === 'check') return `<label class="cpf-check"><input type="checkbox" data-k="${f.k}"/> ${f.l}</label>`;
      // Create: live availability chip. Owned-combo: type or pick from assets you own.
      if (f.check === 'name') return `<label class="cpf"><span>${f.l} <span id="iss_namechk" class="tickchk"></span></span><input data-k="${f.k}" class="m-in" type="text" spellcheck="false" autocomplete="off"/></label>`;
      if (f.combo === 'owned') return `<label class="cpf"><span>${f.l}</span><input data-k="${f.k}" class="m-in" list="issdl_${f.k}" type="text" spellcheck="false" placeholder="type an asset, or pick one you own"/><datalist id="issdl_${f.k}"></datalist></label>`;
      return `<label class="cpf"><span>${f.l}</span><input data-k="${f.k}" class="m-in" type="${f.t || 'text'}" ${f.t === 'number' ? 'step="any"' : ''} spellcheck="false"/></label>`;
    }).join('');
    modal(`<div class="cc-head"><div><h3 class="m-title" style="margin:0">Issuance suite</h3>
      <div class="cp-addr">Counterparty asset issuance · from ${esc(FROM)}</div></div><button class="mini" id="isX">${exitLabel()}</button></div>
      <div class="cp-filters" style="margin:6px 0 10px;flex-wrap:wrap">${Object.entries(ISS).map(([k, v]) => `<button class="ccf ${k === ISS_MODE ? 'on' : ''}" data-im="${k}">${v.label}</button>`).join('')}</div>
      <div class="fine" style="margin-bottom:8px">${esc(m.hint)}</div>
      ${fields}
      <div id="isStatus" class="statusline" hidden></div>
      <div class="wbtns"><button class="primary" id="isReview">Review</button></div>`, true);
    $('#isX').onclick = close;
    $('#cpCard').querySelectorAll('[data-im]').forEach((b) => (b.onclick = () => { ISS_MODE = b.dataset.im; issShell(); }));
    $('#isReview').onclick = issReview;
    if (ISS_MODE === 'create') wireIssNameCheck();
    if (m.fields.some((f) => f.combo === 'owned')) wireIssOwned(m);
  }

  // Create: debounced asset-name availability chip (green ✓ available / red ✗ taken).
  function wireIssNameCheck() {
    const inp = $('#cpCard').querySelector('[data-k="asset"]'), chk = $('#iss_namechk');
    if (!inp || !chk) return;
    const run = async () => {
      const t = inp.value.trim().toUpperCase();
      if (!t) { chk.className = 'tickchk'; chk.innerHTML = ''; return; }
      chk.className = 'tickchk loading'; chk.textContent = '…';
      try {
        const r = await fetch('api/cp/assetname/' + encodeURIComponent(t)).then((x) => x.json());
        if (inp.value.trim().toUpperCase() !== t) return; // stale
        chk.className = 'tickchk ' + (r.exists ? 'bad' : 'good');
        chk.innerHTML = r.exists ? `${ISS_CROSS} taken` : `${ISS_CHECK} available`;
      } catch (_) { chk.className = 'tickchk'; chk.innerHTML = ''; }
    };
    inp.oninput = () => { clearTimeout(_issT); _issT = setTimeout(run, 350); };
  }
  // Issue-more / Lock / Transfer / Describe / Subasset: fill the owned-asset datalist(s).
  async function wireIssOwned(m) {
    try {
      if (!OWNED) { const { owned } = await fetch('api/cp/owned/' + FROM).then((r) => r.json()); OWNED = owned || []; }
      m.fields.filter((f) => f.combo === 'owned').forEach((f) => {
        const dl = $(`#issdl_${f.k}`);
        if (dl) dl.innerHTML = OWNED.length
          ? OWNED.map((o) => `<option value="${esc(o.asset)}">${esc(o.name && o.name !== o.asset ? o.name : o.asset)}${o.locked ? ' · locked' : ''}</option>`).join('')
          : '';
      });
    } catch (_) {}
  }
  async function issReview() {
    const m = ISS[ISS_MODE], s = $('#isStatus'); s.hidden = false; s.className = 'statusline load'; s.textContent = 'Validating…';
    try {
      const params = { ...(m.fixed || {}) };
      $('#cpCard').querySelectorAll('[data-k]').forEach((el) => { if (el.type === 'checkbox') params[el.dataset.k] = el.checked; else if (el.value.trim() !== '') params[el.dataset.k] = el.value.trim(); });
      // Subasset: combine parent (owned) + child name into PARENT.child.
      if (m.sub) {
        need(params.parent, 'Choose the parent asset you own.');
        need(params.child, 'Enter the subasset name (the part after the dot).');
        params.asset = params.parent.toUpperCase() + '.' + params.child;
        delete params.parent; delete params.child;
      }
      need(params.asset, 'Asset name is required.');

      // Authoritative checks (independent of the dropdown — manual entries are validated too).
      let assetDivisible = !!params.divisible;
      if (ISS_MODE === 'create') {
        params.asset = params.asset.toUpperCase(); // CP named assets are uppercase
        const chk = await fetch('api/cp/assetname/' + encodeURIComponent(params.asset)).then((r) => r.json());
        need(!chk.exists, `“${params.asset}” is already registered — choose another name.`);
      } else if (m.own) {
        const target = (m.sub ? params.asset.split('.')[0] : params.asset).toUpperCase();
        const chk = await fetch('api/cp/assetname/' + encodeURIComponent(target)).then((r) => r.json());
        need(chk.exists, `“${target}” doesn’t exist on Counterparty.`);
        need(chk.owner === FROM, m.sub
          ? `You don’t own “${target}” on this address — only its owner can create subassets under it.`
          : `You don’t own “${target}” on this address — only its owner can ${m.label.toLowerCase()} it.`);
        // CP issuance rejects a divisibility change — for ops on an EXISTING asset, echo its
        // real divisibility (and use it for quantity scaling). Subasset is a new asset → user's choice.
        if (!m.sub) { assetDivisible = !!chk.divisible; params.divisible = !!chk.divisible; }
      }
      if (ISS_MODE === 'transfer') need(RE_BTC.test(params.transfer_destination || ''), 'Enter a valid Bitcoin address for the new owner.');

      s.textContent = 'Composing issuance…';
      const qf = m.fields.find((f) => f.scale);
      if (qf && params[qf.k] != null) params[qf.k] = scale(params[qf.k], assetDivisible);
      LAST_PARAMS = params;
      const c = await fetch('api/cp/compose/issuance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: FROM, params }) }).then((r) => r.json());
      if (c.error) throw new Error(c.detail || c.error);
      confirmScreen(`Confirm · ${m.label} ${esc(params.asset)}`, c, '', `${m.label} broadcast`, issShell);
    } catch (err) { s.className = 'statusline err'; s.textContent = err.message || 'Compose failed.'; }
  }

  // ── Attach / Detach (CP assets UTXOs) ──────────────────────────────────
  let AD_PREFILL = null;
  function attachDetach(account, fromAddress, prefill, onBack) { EXT = null; BACK_FN = onBack || null; ACCOUNT = account; FROM = fromAddress; AD_PREFILL = prefill || null; adShell('attach'); }
  function adShell(tab) {
    modal(`<div class="cc-head"><div><h3 class="m-title" style="margin:0">Attach / Detach</h3>
      <div class="cp-addr">Bind Counterparty assets to a specific UTXO, or release them back · ${esc(FROM)}</div></div><button class="mini" id="adX">${exitLabel()}</button></div>
      <div class="cp-filters" style="margin:6px 0 12px"><button class="ccf ${tab === 'attach' ? 'on' : ''}" data-ad="attach">Attach to UTXO</button><button class="ccf ${tab === 'detach' ? 'on' : ''}" data-ad="detach">Detach to address</button></div>
      <div id="adBody"></div>`, true);
    $('#adX').onclick = close;
    $('#cpCard').querySelectorAll('[data-ad]').forEach((b) => (b.onclick = () => adShell(b.dataset.ad)));
    tab === 'detach' ? adDetach() : adAttach();
  }
  async function adAttach() {
    await loadCpFees();
    $('#adBody').innerHTML = `
      <div class="fine" style="margin-bottom:8px">Move an asset from this address's balance onto a dedicated UTXO (so it can travel with that specific output — used by PSBT marketplaces & atomic swaps).</div>
      <label class="cpf"><span>Asset</span><input id="adA" class="m-in" list="addl" type="text" spellcheck="false" placeholder="type an asset, or pick from your wallet"/><datalist id="addl"></datalist></label>
      <label class="cpf"><span>Quantity <span class="fine availhint" id="adAvail"></span></span><input id="adQ" class="m-in" type="number" step="any" min="0"/></label>
      ${cpFeeRowHtml()}
      <div id="adStatus" class="statusline" hidden></div>
      <div class="wbtns"><button class="ghost" id="adBack">Back</button><button class="primary" id="adReview">Review attach</button></div>`;
    $('#adBack').onclick = () => (BACK_FN ? goBack() : renderHub()); // match the other tool forms' bottom Back
    $('#adReview').onclick = adAttachReview;
    wireCpFee();
    // Populate the dropdown from the wallet's CP holdings + mirror the selected balance.
    (async () => {
      try {
        const { holdings } = await fetch(`api/cp/holdings/${FROM}`).then((r) => r.json());
        WALLET_ASSETS = holdings || [];
        const dl = $('#addl'), inp = $('#adA'), bal = $('#adAvail');
        if (dl) dl.innerHTML = WALLET_ASSETS.map((h) => `<option value="${esc(h.asset)}">${esc(h.name && h.name !== h.asset ? h.name + ' · ' : '')}${esc(h.qty)}</option>`).join('');
        const upd = () => { const v = inp.value.trim(); const h = WALLET_ASSETS.find((x) => x.asset === v || x.name === v); if (bal) bal.textContent = h ? `available: ${h.qty}` : ''; };
        inp.oninput = upd; inp.onchange = upd;
        // Preloaded from the asset-detail window: fill asset (+ held qty) so attach is one edit away.
        if (AD_PREFILL && AD_PREFILL.asset && inp) { inp.value = AD_PREFILL.asset; const q = $('#adQ'); if (q && AD_PREFILL.qty != null && AD_PREFILL.qty !== '') q.value = AD_PREFILL.qty; upd(); AD_PREFILL = null; }
      } catch (_) {}
    })();
  }
  async function adAttachReview() {
    const s = $('#adStatus'); s.hidden = false; s.className = 'statusline load'; s.textContent = 'Composing attach…';
    try {
      const asset = $('#adA').value.trim().toUpperCase(), qty = $('#adQ').value.trim();
      if (!asset || !qty) throw new Error('Enter an asset and quantity.');
      const h = (WALLET_ASSETS || []).find((x) => x.asset === asset || x.name === asset);
      if (h && parseFloat(qty) > parseFloat(h.qty)) throw new Error(`You only hold ${h.qty} ${asset} on this address.`);
      const params = { asset, quantity: scale(qty, h ? h.divisible : await isDivisible(asset)) };
      if (CP_FEERATE) params.sat_per_vbyte = CP_FEERATE; // custom miner-fee rate
      LAST_PARAMS = params;
      const c = await fetch('api/cp/compose/attach', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: FROM, params }) }).then((r) => r.json());
      if (c.error) throw new Error(c.detail || c.error);
      confirmScreen(`Confirm · attach ${esc(asset)}`, c, `<div><span class="k">Attaching</span><span class="v" style="font-size:13px">${esc(qty)} ${esc(asset)} to a UTXO</span></div>`, 'Attach broadcast', () => adShell('attach'));
    } catch (err) { s.className = 'statusline err'; s.textContent = err.message === 'insufficient funds' ? 'Insufficient balance (asset or BTC for the fee).' : (err.message || 'Compose failed.'); }
  }
  async function adDetach() {
    await loadCpFees();
    $('#adBody').innerHTML = '<div class="statusline load">Scanning your UTXOs for attached assets…</div>';
    try {
      const { attached } = await fetch(`api/cp/attached/${FROM}`).then((r) => r.json());
      if (!attached.length) { $('#adBody').innerHTML = '<div class="fine">No assets are currently attached to your UTXOs. Attached assets show up here, ready to release back to your address balance.</div>'; return; }
      $('#adBody').innerHTML = `<div class="fine" style="margin-bottom:8px">These assets sit on a UTXO. Detaching releases them back to your address balance.</div>
        ${cpFeeRowHtml()}
        <div id="adDetStatus" class="statusline" hidden></div>` + attached.map((a) => `
        <div class="dex-row"><span>${esc(a.asset_longname || a.asset)} <b>${esc(String(a.quantity_normalized))}</b><br><span class="fine">${esc(a.utxo.slice(0, 22))}…</span></span>
        <button class="mini" data-detach="${esc(a.utxo)}">Detach</button></div>`).join('');
      wireCpFee();
      $('#adBody').querySelectorAll('[data-detach]').forEach((b) => (b.onclick = () => adDetachReview(b.dataset.detach)));
    } catch (_) { $('#adBody').innerHTML = '<div class="statusline err">Could not scan for attached assets.</div>'; }
  }
  async function adDetachReview(utxo) {
    const s = $('#adDetStatus'); s.hidden = false; s.className = 'statusline load'; s.textContent = 'Composing detach…';
    try {
      LAST_PARAMS = { __detachUtxo: utxo }; // detach legitimately spends this one asset-bearing UTXO — the verifier allows exactly it

      const c = await fetch('api/cp/detach', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ utxo, destination: FROM, sat_per_vbyte: CP_FEERATE }) }).then((r) => r.json());
      if (c.error) throw new Error(c.detail || c.error);
      confirmScreen('Confirm · detach › address', c, `<div><span class="k">From UTXO</span><span class="v" style="font-size:12px">${esc(utxo.slice(0, 18))}…</span></div>`, 'Detach broadcast', () => adShell('detach'));
    } catch (err) { s.className = 'statusline err'; s.textContent = err.message || 'Compose failed.'; }
  }

  // ── Connected external wallet (UniSat / OKX / Wonder) — the SAME full Counterparty toolset, but the
  //    composed PSBT is signed + broadcast by the connected wallet (EXT). `conn` = { address, name, signPsbt, pushPsbt }.
  function openConnected(conn) { EXT = conn; ACCOUNT = 0; FROM = conn.address; FROM_TYPE = btcTypeOf(conn.address); WALLET_ASSETS = null; renderHub(); }
  async function quickConnected(conn, key, prefill, onBack) {
    if (!ACTIONS[key]) return;
    EXT = conn; BACK_FN = onBack || null; ACCOUNT = 0; FROM = conn.address; FROM_TYPE = btcTypeOf(conn.address); WALLET_ASSETS = null;
    await openForm(key);
    if (prefill) Object.entries(prefill).forEach(([k, v]) => {
      const el = $('#cpCard').querySelector(`[data-k="${k}"]`);
      if (el) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
    });
  }
  function issuanceSuiteConnected(conn) { EXT = conn; ACCOUNT = 0; FROM = conn.address; FROM_TYPE = btcTypeOf(conn.address); ISS_MODE = 'create'; OWNED = null; issShell(); }
  function attachDetachConnected(conn, prefill, onBack) { EXT = conn; BACK_FN = onBack || null; ACCOUNT = 0; FROM = conn.address; FROM_TYPE = btcTypeOf(conn.address); AD_PREFILL = prefill || null; adShell('attach'); }

  window.CpActions = { open, quick, dex, dexConnected, issuanceSuite, attachDetach, openConnected, quickConnected, issuanceSuiteConnected, attachDetachConnected };
})();
