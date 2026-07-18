/* Wonder Wallet — first-party minting modules (SRC-20 + Bitcoin Stamp art).
   Compose via stampchain (returns an unsigned PSBT hex with witnessUtxo baked in) →
   sign client-side (signStamp, proven) → broadcast. Native SegWit source. */
'use strict';
(function () {
  const C = window.WonderCore;
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sat = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US') + ' sats');
  const RE_BTC = /^(bc1[a-z0-9]{8,87}|[13][a-km-zA-HJ-NP-Z1-9]{25,39})$/;
  const RE_DOTBTC = /^[a-z0-9][a-z0-9._-]{0,62}\.btc$/i;
  // Resolve a .btc name → address at submit (throws if unregistered); pass-through for addresses.
  async function resolveRecipientName(raw) {
    if (!RE_DOTBTC.test(raw)) return raw;
    const r = await fetch('api/src101/resolve/' + encodeURIComponent(raw)).then((x) => x.json()).catch(() => null);
    if (!r || !r.exists || !r.address) throw new Error('“' + raw + '” is not a registered Bitcoin Stamps name.');
    return r.address;
  }
  // Live .btc resolution banner under a recipient input.
  function wireNameResolve(inputId, bannerId) {
    const inp = $('#' + inputId), nr = $('#' + bannerId); let t = null;
    if (!inp || !nr) return;
    inp.addEventListener('input', () => {
      clearTimeout(t);
      const v = inp.value.trim();
      if (!RE_DOTBTC.test(v)) { nr.hidden = true; nr.innerHTML = ''; return; }
      nr.hidden = false; nr.className = 'name-resolve load'; nr.textContent = 'Resolving ' + v + '…';
      t = setTimeout(async () => {
        try {
          const r = await fetch('api/src101/resolve/' + encodeURIComponent(v)).then((x) => x.json());
          if (inp.value.trim() !== v) return;
          if (r && r.exists && r.address) { nr.className = 'name-resolve ok'; nr.innerHTML = '✓ <b>' + esc(r.name) + '</b> → <span class="nr-addr">' + esc(r.address) + '</span>'; }
          else { nr.className = 'name-resolve bad'; nr.textContent = (r && r.expired) ? ('⚠ ' + v + ' has expired.') : ('✕ ' + v + ' is not registered (SRC-101).'); }
        } catch (_) { nr.className = 'name-resolve bad'; nr.textContent = 'Could not resolve ' + v + '.'; }
      }, 350);
    });
  }
  const STAMP_MAX = 100 * 1024; // hard cap: a stamp is paid for byte-by-byte in BTC; also keeps us under the 512KB JSON limit
  let ACCOUNT = 0, BTC = null, FEE = 10, HOLDINGS = null, _tickT = null, BTC_USD = 0;
  const usdTag = (sats) => (BTC_USD && sats ? ` · ≈ $${((sats / 1e8) * BTC_USD).toLocaleString('en-US', { maximumFractionDigits: 2 })}` : '');

  // Inline validation: throw with a friendly message the catch blocks surface.
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : NaN; };
  function need(cond, msg) { if (!cond) throw new Error(msg); }
  function checkFee(f) { need(Number.isFinite(f) && f >= 0.1 && f <= 2000, 'Fee must be between 0.1 and 2000 sat/vB.'); return f; }

  function modal(html) {
    let m = $('#mintmodal');
    if (!m) { m = document.createElement('div'); m.id = 'mintmodal'; m.className = 'modal'; m.innerHTML = '<div class="modal-card" id="mintCard"></div>'; document.body.appendChild(m); m.addEventListener('click', (e) => { if (e.target.id === 'mintmodal') close(); }); }
    $('#mintCard').innerHTML = html; m.hidden = false; return $('#mintCard');
  }
  // Hub-aware exit (mirrors cp-actions): return to the dApp dashboard when launched from it.
  const fromHub = () => !!(window.DappDashboard && window.DappDashboard.fromHub && window.DappDashboard.fromHub());
  const exitLabel = () => (fromHub() ? '‹ Dashboard' : 'Cancel');
  function close() { const m = $('#mintmodal'); if (m) { m.hidden = true; $('#mintCard').innerHTML = ''; } if (window.DappDashboard && window.DappDashboard.returnToHub) window.DappDashboard.returnToHub(); }
  async function loadFee() { try { FEE = (await fetch('api/btc/fees').then((r) => r.json())).halfHourFee || 10; } catch (_) {} if (!BTC_USD) { try { BTC_USD = (await fetch('api/prices').then((r) => r.json())).bitcoin || 0; } catch (_) {} } }

  // ── SRC-20 deploy / mint / transfer ──
  let PREFILL_TICK = null;
  function src20(account, btcAddress) { ACCOUNT = account; BTC = btcAddress; PREFILL_TICK = null; loadFee().then(() => src20Form('deploy')); }
  // Deep-link from the portfolio: open the Transfer tab pre-selected to a held token.
  function sendSrc20(account, btcAddress, tick) { ACCOUNT = account; BTC = btcAddress; PREFILL_TICK = tick; loadFee().then(() => src20Form('transfer')); }
  function src20Form(op) {
    // Deploy/Mint: a typed ticker with a live ✓/✗ status chip. Transfer: a dropdown of the
    // wallet's own tokens (no typing — you can only send what you hold).
    const tickField = op === 'transfer'
      ? `<label class="cpf"><span>Ticker</span><select id="s_tick" class="m-in"><option value="">Loading your tokens…</option></select></label>`
      : `<label class="cpf"><span>Ticker <span id="s_tickchk" class="tickchk"></span></span><input id="s_tick" class="m-in" maxlength="5" spellcheck="false" autocomplete="off"/></label>`;
    const fields = {
      deploy: `${tickField}
        <label class="cpf"><span>Max supply</span><input id="s_max" class="m-in" type="number"/></label>
        <label class="cpf"><span>Per-mint limit</span><input id="s_lim" class="m-in" type="number"/></label>
        <label class="cpf"><span>Decimals</span><input id="s_dec" class="m-in" type="number" value="18"/></label>`,
      mint: `${tickField}
        <div id="s_mintinfo" class="mintinfo" hidden></div>
        <label class="cpf"><span>Amount</span><input id="s_amt" class="m-in" type="number"/></label>`,
      transfer: `${tickField}
        <label class="cpf"><span>Amount <span class="fine" id="s_availhint"></span></span><input id="s_amt" class="m-in" type="number"/></label>
        <label class="cpf"><span>To address or name.btc</span><input id="s_to" class="m-in" spellcheck="false" autocapitalize="off"/></label>
        <div id="s_nameres" class="name-resolve" hidden></div>`,
    };
    modal(`<h3 class="m-title">SRC-20 token</h3>
      <div class="cp-src">from ${esc(BTC)}</div>
      <div class="cp-filters" style="margin:8px 0">${['deploy', 'mint', 'transfer'].map((o) => `<button class="ccf ${o === op ? 'on' : ''}" data-op="${o}">${o}</button>`).join('')}</div>
      ${fields[op]}
      <label class="cpf"><span>Fee (sat/vB) <span class="fine">custom · sub-sat ok (e.g. 0.8)</span></span><input id="s_fee" class="m-in" type="number" min="0.1" step="0.1" value="${FEE}"/></label>
      <div id="s_status" class="statusline" hidden></div>
      <div class="wbtns"><button class="ghost" id="s_cancel">${exitLabel()}</button><button class="primary" id="s_review">Review</button></div>`);
    $('#mintCard').querySelectorAll('[data-op]').forEach((b) => (b.onclick = () => src20Form(b.dataset.op)));
    $('#s_cancel').onclick = close;
    if (op === 'transfer') { loadHoldings(); wireNameResolve('s_to', 's_nameres'); } else wireTickCheck(op);
    $('#s_review').onclick = async () => {
      const s = $('#s_status'); s.hidden = false; s.className = 'statusline load'; s.textContent = 'Composing via stampchain…';
      try {
        const tick = ($('#s_tick').value || '').trim();
        if (op === 'transfer') need(tick, 'Select a token to transfer.');
        else need(tick.length >= 1 && tick.length <= 5, 'Ticker must be 1–5 characters.');
        const fee = checkFee(num($('#s_fee').value) || FEE);
        const params = { op, tick, satsPerVB: fee };
        if (op === 'deploy') {
          const st = await fetch('api/stamps/src20/tick/' + encodeURIComponent(tick)).then((x) => x.json());
          need(!st.deployed, `Ticker "${tick}" is already registered — choose another.`);
          const max = num($('#s_max').value), lim = num($('#s_lim').value), dec = num($('#s_dec').value);
          need(max > 0, 'Max supply must be greater than 0.');
          need(lim > 0 && lim <= max, 'Per-mint limit must be > 0 and ≤ max supply.');
          need(Number.isInteger(dec) && dec >= 0 && dec <= 18, 'Decimals must be a whole number from 0 to 18.');
          params.max = String(max); params.lim = String(lim); params.dec = dec;
        } else {
          const amt = num($('#s_amt').value);
          need(amt > 0, 'Amount must be greater than 0.');
          if (op === 'mint') {
            const st = await fetch('api/stamps/src20/tick/' + encodeURIComponent(tick)).then((x) => x.json());
            need(st.deployed, `Ticker "${tick}" isn't deployed yet — nothing to mint.`);
            need(!st.complete, `"${tick}" is fully minted — no mints left.`);
          }
          if (op === 'transfer') {
            const h = (HOLDINGS || []).find((x) => x.tick === tick);
            if (h) need(amt <= parseFloat(String(h.amount).replace(/,/g, '')), `You only hold ${h.amount} ${tick}.`);
            const to = await resolveRecipientName($('#s_to').value.trim()); need(RE_BTC.test(to), 'Enter a valid Bitcoin destination address.'); params.toAddress = to;
          }
          params.amt = String(amt);
        }
        const r = await fetch('api/stamps/src20/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: BTC, params }) }).then((x) => x.json());
        if (r.error) throw new Error(r.detail || r.error);
        preview(`SRC-20 ${op} · ${esc(tick)}`, r, op === 'deploy' ? `${$('#s_max').value} max · ${$('#s_lim').value}/mint` : (op === 'mint' ? `mint ${$('#s_amt').value}` : `send ${$('#s_amt').value}`), () => src20Form(op));
      } catch (e) { s.className = 'statusline err'; s.textContent = e.message === 'compose_failed' || /No spendable/i.test(e.message) ? 'Insufficient BTC on this address to compose the mint.' : ('Failed: ' + e.message); }
    };
  }

  // Crisp inline-SVG check / cross (font glyphs like ✓✗ can tofu in the mono stack).
  const CHECK = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M3 8.5l3.2 3.2L13 5" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const CROSS = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"/></svg>';

  // Live ticker check (debounced) — drives the ✓/✗ chip on Deploy & Mint.
  function wireTickCheck(op) {
    const inp = $('#s_tick'), chk = $('#s_tickchk');
    if (!inp || !chk) return;
    const info = $('#s_mintinfo');
    const run = async () => {
      const t = inp.value.trim();
      if (!t) { chk.className = 'tickchk'; chk.textContent = ''; if (info) info.hidden = true; return; }
      chk.className = 'tickchk loading'; chk.textContent = '…';
      try {
        const r = await fetch('api/stamps/src20/tick/' + encodeURIComponent(t)).then((x) => x.json());
        if (inp.value.trim() !== t) return; // stale — user kept typing
        if (op === 'deploy') {
          chk.className = 'tickchk ' + (r.deployed ? 'bad' : 'good');
          chk.innerHTML = r.deployed ? `${CROSS} taken` : `${CHECK} available`;
        } else { // mint
          if (!r.deployed) { chk.className = 'tickchk bad'; chk.innerHTML = `${CROSS} not deployed`; if (info) info.hidden = true; }
          else if (r.complete) { chk.className = 'tickchk bad'; chk.innerHTML = `${CROSS} fully minted`; if (info) { info.hidden = false; info.className = 'mintinfo done'; info.innerHTML = '100% minted · 0 mints left'; } }
          else {
            chk.className = 'tickchk good'; chk.innerHTML = `${CHECK} mintable`;
            if (info) { info.hidden = false; info.className = 'mintinfo'; const left = r.mints_left != null ? Number(r.mints_left).toLocaleString('en-US') + ' mints left' : 'open'; info.innerHTML = `<b>${r.progress}%</b> minted · ${left} · limit ${Number(r.limit).toLocaleString('en-US')}/mint`; }
            if (r.limit && !$('#s_amt').value) $('#s_amt').value = r.limit; // prefill the per-mint amount
          }
        }
      } catch (_) { chk.className = 'tickchk'; chk.textContent = ''; }
    };
    inp.oninput = () => { clearTimeout(_tickT); _tickT = setTimeout(run, 350); };
  }

  // Populate the Transfer dropdown from the wallet's own SRC-20 holdings + show "available".
  async function loadHoldings() {
    const sel = $('#s_tick'); if (!sel) return;
    try {
      const { src20 } = await fetch('api/stamps/src20/holdings/' + encodeURIComponent(BTC)).then((r) => r.json());
      HOLDINGS = src20 || [];
      const hint = $('#s_availhint');
      if (!HOLDINGS.length) { sel.innerHTML = '<option value="">No SRC-20 tokens in this wallet</option>'; if (hint) hint.textContent = ''; return; }
      sel.innerHTML = '<option value="">Select a token…</option>' + HOLDINGS.map((t) => `<option value="${esc(t.tick)}">${esc(t.tick)} — ${esc(t.amount)}</option>`).join('');
      const upd = () => { const h = HOLDINGS.find((x) => x.tick === sel.value); if (hint) hint.textContent = h ? `available: ${h.amount}` : ''; };
      sel.onchange = upd;
      if (PREFILL_TICK && HOLDINGS.some((t) => t.tick === PREFILL_TICK)) { sel.value = PREFILL_TICK; PREFILL_TICK = null; }
      upd();
    } catch (_) { sel.innerHTML = '<option value="">Could not load tokens</option>'; }
  }

  // ── Bitcoin Stamp art ──
  function stampArt(account, btcAddress) { ACCOUNT = account; BTC = btcAddress; loadFee().then(stampForm); }
  let FILE = null;
  function stampForm() {
    modal(`<h3 class="m-title">Mint Stamp art</h3>
      <div class="cp-src">from ${esc(BTC)}</div>
      <p class="fine">Stamps are permanent on-chain art. Keep the image small (a few KB) — every byte is paid for in BTC.</p>
      <label class="cpf"><span>Image</span><input id="a_file" class="m-in" type="file" accept="image/*"/></label>
      <div id="a_prev"></div>
      <label class="cpf"><span>Supply</span><input id="a_qty" class="m-in" type="number" value="1"/></label>
      <label class="cpf-check"><input type="checkbox" id="a_lock" checked/> Lock supply</label>
      <label class="cpf-check"><input type="checkbox" id="a_div"/> Divisible</label>
      <label class="cpf"><span>Fee (sat/vB) <span class="fine">custom · sub-sat ok (e.g. 0.8)</span></span><input id="a_fee" class="m-in" type="number" min="0.1" step="0.1" value="${FEE}"/></label>
      <div id="a_status" class="statusline" hidden></div>
      <div class="wbtns"><button class="ghost" id="a_cancel">${exitLabel()}</button><button class="primary" id="a_review">Review</button></div>`);
    $('#a_cancel').onclick = close;
    $('#a_file').onchange = (e) => {
      const f = e.target.files[0]; FILE = null; if (!f) { $('#a_prev').innerHTML = ''; return; }
      if (f.size > STAMP_MAX) { $('#a_prev').innerHTML = `<div class="dapp-warn">⚠ ${(f.size / 1024).toFixed(0)} KB is too large to stamp — keep it under ${(STAMP_MAX / 1024)} KB. Every byte is paid for in BTC; a few KB is typical.</div>`; e.target.value = ''; return; }
      if (f.size > 20 * 1024) { $('#a_prev').innerHTML = `<div class="dapp-warn">⚠ ${(f.size / 1024).toFixed(1)} KB — on the large side. Stamps are usually a few KB; this will cost more in fees.</div>`; }
      const rd = new FileReader();
      rd.onload = () => { FILE = { filename: f.name, b64: String(rd.result).split(',')[1], size: f.size }; const warn = $('#a_prev').querySelector('.dapp-warn'); $('#a_prev').innerHTML = (warn ? warn.outerHTML : '') + `<img class="m-art" src="${rd.result}" alt="preview" style="max-height:120px"/><div class="fine">${esc(f.name)} · ${(f.size / 1024).toFixed(1)} KB</div>`; };
      rd.readAsDataURL(f);
    };
    $('#a_review').onclick = async () => {
      const s = $('#a_status'); s.hidden = false; s.className = 'statusline load';
      try {
        need(FILE && FILE.b64, 'Choose an image first (under 100 KB).');
        const qty = num($('#a_qty').value) || 1;
        need(Number.isInteger(qty) && qty >= 1, 'Supply must be a whole number ≥ 1.');
        const fee = checkFee(num($('#a_fee').value) || FEE);
        s.textContent = 'Composing stamp via stampchain…';
        const params = { filename: FILE.filename, file: FILE.b64, qty, locked: $('#a_lock').checked, divisible: $('#a_div').checked, satsPerVB: fee };
        const r = await fetch('api/stamps/olga/mint', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: BTC, params }) }).then((x) => x.json());
        if (r.error) throw new Error(r.detail || r.error);
        preview('Stamp · ' + esc(FILE.filename), r, `${(FILE.size / 1024).toFixed(1)} KB · supply ${qty}`, stampForm);
      } catch (e) { s.className = 'statusline err'; s.textContent = /No spendable|compose_failed/i.test(e.message) ? 'Insufficient BTC on this address to compose the stamp.' : ('Failed: ' + (e.message || 'compose error')); }
    };
  }

  // shared preview → sign PSBT → broadcast
  function preview(label, r, detail, back) {
    modal(`<button class="m-close-x" id="m_x" title="Close" aria-label="Close">✕</button><h3 class="m-title" style="padding-right:34px">Confirm · ${label}</h3>
      <div class="m-grid">
        <div><span class="k">Miner fee</span><span class="v">${sat(r.fee)}${usdTag(r.fee)}</span></div>
        <div><span class="k">Est. size</span><span class="v">${r.vsize || '—'} vB</span></div>
        ${r.cpid ? `<div><span class="k">Asset / CPID</span><span class="v">${esc(r.cpid)}</span></div>` : ''}
        ${r.change != null ? `<div><span class="k">Change</span><span class="v">${sat(r.change)}</span></div>` : ''}
      </div>
      ${detail ? `<div class="cp-data"><span class="k">Minting</span><code>${esc(detail)}</code></div>` : ''}
      <div class="warn" style="margin-top:10px">Signed locally on your device, then broadcast. This writes permanent data to Bitcoin — it cannot be undone.</div>
      <div id="m_status" class="statusline" hidden></div>
      <div class="wbtns"><button class="ghost" id="m_back">Back</button><button class="primary" id="m_go">Sign &amp; broadcast</button></div>`);
    $('#m_back').onclick = (typeof back === 'function') ? back : close;
    if ($('#m_x')) $('#m_x').onclick = close;
    $('#m_go').onclick = async () => {
      const s = $('#m_status'); s.hidden = false; s.className = 'statusline load'; s.textContent = 'Signing locally & broadcasting…';
      try {
        // Imported accounts sign with their own WIF (synthetic active account carries importedId).
        const importedId = (window.__activeAccount && window.__activeAccount.importedId) || null;
        const signed = C.signStamp(r.hex, ACCOUNT, 'nativeSegwit', {}, importedId);
        const b = await fetch('api/btc/broadcast', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ txhex: signed.txhex }) }).then((x) => x.json());
        if (b.error) throw new Error(b.detail || b.error);
        s.className = 'statusline load'; s.innerHTML = `Broadcast ✓ — <a href="https://mempool.space/tx/${encodeURIComponent(b.txid)}" target="_blank" rel="noopener" style="color:var(--gold2)">${esc(String(b.txid).slice(0, 18))}…</a>`;
        // Broadcast done — the tx is irreversible, so swap the actions for a single Done that closes.
        const bs = $('#m_back'), gs = $('#m_go');
        if (bs) bs.remove();
        if (gs) { gs.textContent = 'Done'; gs.onclick = close; }
      } catch (e) { s.className = 'statusline err'; s.textContent = 'Failed: ' + (e.message || 'sign/broadcast error'); }
    };
  }

  window.MintingModules = { src20, sendSrc20, stampArt };
})();
