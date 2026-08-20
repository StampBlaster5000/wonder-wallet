/* Wonder Wallet — Phase 4 coin-control dashboard.
   Per-UTXO list · freeze/lock · soft time-locks · labels · manual selection · consolidation (build+sign+broadcast).
   Protected (asset-bearing) and frozen/time-locked UTXOs can NEVER be selected — the core safety. */
'use strict';
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const sat2btc = (n) => (n / 1e8).toLocaleString('en-US', { maximumFractionDigits: 8 });
  const fmt = (n) => Number(n).toLocaleString('en-US');

  let STATE = { address: null, data: null, selected: new Set(), filter: 'all' };

  function ensureModal() {
    let m = $('#ccmodal');
    if (!m) {
      m = document.createElement('div'); m.id = 'ccmodal'; m.className = 'modal'; m.hidden = true;
      m.innerHTML = '<div class="modal-card cc-card" id="ccCard"></div>';
      document.body.appendChild(m);
      m.addEventListener('click', (e) => { if (e.target.id === 'ccmodal') close(); });
    }
    return m;
  }
  function close() { const m = $('#ccmodal'); if (m) m.hidden = true; }

  async function open(address) {
    STATE = { address, data: null, selected: new Set(), filter: 'all' };
    ensureModal().hidden = false;
    $('#ccCard').innerHTML = `<h3 class="m-title">Coin Control</h3><div class="statusline load">Scanning UTXOs (Counterparty + Ordinals)…</div>`;
    try {
      STATE.data = applyMeta(await fetch(`api/btc/${address}/coincontrol`).then((r) => r.json()));
      renderCC();
    } catch (e) {
      $('#ccCard').innerHTML = `<h3 class="m-title">Coin Control</h3><div class="statusline err">Failed: ${esc(e.message)}</div><button class="modal-x" id="ccx">Close</button>`;
      $('#ccx').onclick = close;
    }
  }

  // UTXO labels / freezes / time-locks live in localStorage (no server). We overlay them onto
  // the raw scan and recompute the freeze-dependent summary client-side.
  const UKEY = (addr) => `ww:utxo:${addr}`;
  const getMeta = (addr) => (window.WWStore ? window.WWStore.lsGet(UKEY(addr), {}) : {});
  const setMeta = (addr, m) => { if (window.WWStore) window.WWStore.lsSet(UKEY(addr), m); };
  function applyMeta(data) {
    if (!data || !data.utxos) return data;
    const meta = getMeta(STATE.address), now = Date.now();
    data.utxos.forEach((u) => {
      const m = meta[u.utxo] || {};
      u.frozen = !!m.frozen;
      u.freezeUntil = m.freezeUntil || null;
      u.timelocked = !!(m.freezeUntil && new Date(m.freezeUntil).getTime() > now);
      u.label = m.label || '';
    });
    const s = data.summary || (data.summary = {});
    const live = (u) => u.category === 'spendable' && !u.frozen && !u.timelocked;
    s.spendable = data.utxos.filter(live).length;
    s.frozen = data.utxos.filter((u) => u.frozen || u.timelocked).length;
    if (s.sats) s.sats.spendable = data.utxos.filter(live).reduce((a, u) => a + u.value, 0);
    return data;
  }

  const lockedSel = (u) => u.category === 'protected' || u.frozen || u.timelocked; // never auto/checkbox-selectable
  function selectable(u) { return !lockedSel(u); }

  function renderCC() {
    const d = STATE.data;
    const s = d.summary;
    const seg = (cls, n) => (n > 0 ? `<div class="seg ${cls}" style="flex:${n}" title="${cls}: ${n}"></div>` : '');
    const filters = ['all', 'spendable', 'protected', 'dust', 'frozen'];
    const rows = d.utxos.filter((u) => {
      if (STATE.filter === 'all') return true;
      if (STATE.filter === 'frozen') return u.frozen || u.timelocked;
      return u.category === STATE.filter;
    });

    $('#ccCard').innerHTML = `
      <div class="cc-head">
        <div><h3 class="m-title" style="margin:0">Coin Control</h3><div class="cc-addr">${esc(d.address)}</div></div>
        <button class="mini" id="ccClose">Close</button>
      </div>
      <div class="cc-summary">
        <div class="segbar">${seg('spendable', s.spendable)}${seg('protected', s.protected)}${seg('dust', s.dust)}${seg('unknown', s.unknown)}${seg('frozen', s.frozen)}</div>
        <div class="cc-counts">
          <span class="lg spendable">${s.spendable} spendable</span>
          <span class="lg protected">${s.protected} protected</span>
          <span class="lg dust">${s.dust} dust</span>
          <span class="lg unknown">${s.unknown} unknown</span>
          <span class="lg frozen">${s.frozen} frozen</span>
          <span class="cc-bal">${sat2btc(d.balanceSats)} BTC</span>
        </div>
        <div class="us-note">Counterparty: full coverage · Ordinals: ${d.scanMeta.ordinalsScanned}/${d.scanMeta.total} scanned${d.scanMeta.ordinalsCapped ? ' (rest = unknown, never presumed spendable)' : ''}. Protected, frozen &amp; time-locked UTXOs are locked from selection.</div>
      </div>
      <div class="cc-tools">
        <div class="cc-filters">${filters.map((f) => `<button class="ccf ${STATE.filter === f ? 'on' : ''}" data-f="${f}">${f}</button>`).join('')}</div>
        <div class="cc-seltools"><button class="mini" id="selSpend">Select all spendable</button><button class="mini" id="selClear">Clear</button></div>
      </div>
      <div class="cc-table">${rows.map(rowHtml).join('') || '<div class="fine" style="padding:14px">No UTXOs in this filter.</div>'}</div>
      <div class="cc-foot" id="ccFoot"></div>`;

    $('#ccClose').onclick = close;
    $('#ccCard').querySelectorAll('.ccf').forEach((b) => (b.onclick = () => { STATE.filter = b.dataset.f; renderCC(); }));
    $('#selSpend').onclick = () => { d.utxos.forEach((u) => { if (u.category === 'spendable' && selectable(u)) STATE.selected.add(u.utxo); }); renderCC(); };
    $('#selClear').onclick = () => { STATE.selected.clear(); renderCC(); };
    wireRows();
    renderFoot();
  }

  function rowHtml(u) {
    const carries = (u.carries || []).map((c) => `<span class="cc-carry">${esc(c.name || c.asset)}</span>`).join('');
    const locked = lockedSel(u);
    const checked = STATE.selected.has(u.utxo) ? 'checked' : '';
    const catLabel = u.frozen ? 'frozen' : u.timelocked ? 'time-locked' : u.category;
    return `<div class="cc-row ${u.category} ${u.frozen || u.timelocked ? 'islocked' : ''}" data-u="${u.utxo}">
      <input type="checkbox" class="cc-ck" data-u="${u.utxo}" ${checked} ${locked ? 'disabled' : ''} title="${locked ? 'Locked — cannot be selected' : 'Select'}"/>
      <div class="cc-main">
        <div class="cc-line1"><span class="cc-val">${sat2btc(u.value)} BTC</span><span class="cc-sats">${fmt(u.value)} sats</span>
          <span class="cc-cat ${u.frozen || u.timelocked ? 'frozen' : u.category}">${catLabel}</span>${carries}</div>
        <div class="cc-line2"><span class="cc-utxo">${u.utxo.slice(0, 12)}…:${u.vout}</span>
          <span class="cc-conf">${u.confirmations == null ? '—' : u.confirmations + ' conf'}</span>
          ${u.label ? `<span class="cc-lbl">🏷 ${esc(u.label)}</span>` : ''}
          ${u.freezeUntil ? `<span class="cc-tl">📅 until ${new Date(u.freezeUntil).toLocaleDateString()}</span>` : ''}</div>
      </div>
      <div class="cc-acts">
        <button class="mini" data-act="freeze" data-u="${u.utxo}">${u.frozen ? 'Unfreeze' : 'Freeze'}</button>
        <button class="mini" data-act="lock" data-u="${u.utxo}">⏲</button>
        <button class="mini" data-act="label" data-u="${u.utxo}">🏷</button>
      </div></div>`;
  }

  function wireRows() {
    $('#ccCard').querySelectorAll('.cc-ck').forEach((ck) => (ck.onchange = () => {
      if (ck.checked) STATE.selected.add(ck.dataset.u); else STATE.selected.delete(ck.dataset.u);
      renderFoot();
    }));
    $('#ccCard').querySelectorAll('[data-act]').forEach((b) => (b.onclick = () => act(b.dataset.act, b.dataset.u)));
  }

  // Persist UTXO meta locally (label / freeze / time-lock) and re-render — no server call.
  async function post(body) {
    const meta = getMeta(STATE.address);
    const cur = meta[body.utxo] || {};
    if (body.label !== undefined) cur.label = String(body.label).slice(0, 60);
    if (body.frozen !== undefined) cur.frozen = !!body.frozen;
    if (body.freezeUntil !== undefined) cur.freezeUntil = body.freezeUntil || null;
    if (!cur.label && !cur.frozen && !cur.freezeUntil) delete meta[body.utxo]; else meta[body.utxo] = cur;
    setMeta(STATE.address, meta);
    applyMeta(STATE.data); renderCC();
  }
  async function refresh() { STATE.data = applyMeta(await fetch(`api/btc/${STATE.address}/coincontrol`).then((r) => r.json())); renderCC(); }

  // Small inline prompt modal (no native prompt()).
  function miniPrompt({ title, hint, value = '', type = 'text', okLabel = 'Save' }) {
    return new Promise((resolve) => {
      let mm = $('#ccmini');
      if (!mm) { mm = document.createElement('div'); mm.id = 'ccmini'; mm.className = 'modal'; mm.innerHTML = '<div class="modal-card mini-card" id="ccminiCard"></div>'; document.body.appendChild(mm); }
      mm.hidden = false;
      $('#ccminiCard').innerHTML = `<h3 class="m-title">${esc(title)}</h3>${hint ? `<p class="fine">${esc(hint)}</p>` : ''}
        <input id="ccmiIn" class="m-in" type="${type}" value="${esc(value)}" />
        <div class="wbtns"><button class="ghost" id="ccmiCancel">Cancel</button><button class="primary" id="ccmiOk">${esc(okLabel)}</button></div>`;
      const done = (v) => { mm.hidden = true; resolve(v); };
      $('#ccmiCancel').onclick = () => done(null);
      $('#ccmiOk').onclick = () => done($('#ccmiIn').value);
      const inp = $('#ccmiIn'); inp.focus();
      inp.onkeydown = (e) => { if (e.key === 'Enter') done(inp.value); if (e.key === 'Escape') done(null); };
    });
  }

  async function act(action, utxo) {
    const u = STATE.data.utxos.find((x) => x.utxo === utxo);
    if (action === 'freeze') return post({ utxo, frozen: !u.frozen }).catch(() => {});
    if (action === 'label') {
      const v = await miniPrompt({ title: 'Label UTXO', hint: 'A note to remember what this output holds.', value: u.label || '' });
      if (v != null) post({ utxo, label: v }).catch(() => {});
      return;
    }
    if (action === 'lock') {
      const v = await miniPrompt({ title: 'Soft time-lock', hint: 'Freeze this UTXO until a date (wallet-enforced). Leave blank to clear.', value: u.freezeUntil ? u.freezeUntil.slice(0, 10) : '', type: 'date', okLabel: 'Lock' });
      if (v == null) return;
      post({ utxo, freezeUntil: v ? new Date(v + 'T00:00:00Z').toISOString() : '' }).catch(() => {});
    }
  }

  function renderFoot() {
    const foot = $('#ccFoot'); if (!foot) return;
    const sel = STATE.data.utxos.filter((u) => STATE.selected.has(u.utxo));
    const total = sel.reduce((a, u) => a + u.value, 0);
    if (!sel.length) { foot.innerHTML = `<div class="fine">Select spendable UTXOs to plan a consolidation or spend. Locked UTXOs can't be selected.</div>`; return; }
    foot.innerHTML = `
      <div class="cc-selinfo"><b>${sel.length}</b> selected · <b>${sat2btc(total)} BTC</b> (${fmt(total)} sats)</div>
      ${sel.length >= 2 ? `<button class="primary sm" id="ccConsol">Consolidate ${sel.length} → 1</button>` : '<div class="fine">Select 2 or more spendable UTXOs to consolidate them into one.</div>'}`;
    const cb = $('#ccConsol'); if (cb) cb.onclick = consolidate;
  }

  // Which of the active account's address types this coin-control address is, + how to sign it.
  // Returns null for watch-only (no keys) — consolidation is then blocked.
  function signCtx() {
    const a = window.__activeAccount;
    if (!a || !a.bitcoin) return null;
    const type = Object.keys(a.bitcoin).find((t) => a.bitcoin[t] && a.bitcoin[t].address === STATE.address);
    if (!type) return null;
    return { account: a.account || 0, importedId: a.importedId || null, type };
  }

  // Real consolidation: sweep the selected (spendable-only) UTXOs into ONE output at the same
  // address. Only spendable UTXOs are selectable, so asset-bearing / frozen coins can never enter.
  async function consolidate() {
    const sel = STATE.data.utxos.filter((u) => STATE.selected.has(u.utxo));
    if (sel.length < 2) return;
    const C = window.WonderCore;
    const ctx = signCtx();
    const total = sel.reduce((a, u) => a + u.value, 0);
    const inList = sel.map((u) => ({ txid: u.utxo.split(':')[0], vout: u.vout, value: u.value }));
    let fees = { fastestFee: 2, halfHourFee: 1, hourFee: 1 };
    try { fees = await fetch('api/btc/fees').then((r) => r.json()); } catch (_) {}
    let btcUsd = 0; try { btcUsd = (await fetch('api/prices').then((r) => r.json())).bitcoin || 0; } catch (_) {}
    // Stagger the presets strictly descending (Fast > Med > Econ, ≥1 sat/vB apart). Mempool often returns
    // equal rates at low load; keeping them distinct means exactly ONE preset lights up (no tie), and Fast
    // is always a touch above Med, as users expect.
    const econ = Math.max(1, Math.round(fees.hourFee || fees.economyFee || 1));
    const med = Math.max(Math.round(fees.halfHourFee || econ), econ + 1);
    const fast = Math.max(Math.round(fees.fastestFee || med), med + 1);
    const preset = { fastestFee: fast, halfHourFee: med, hourFee: econ };
    let rate = med;
    const usd = (sats) => (btcUsd && sats ? ` <span class="fine">≈ $${((sats / 1e8) * btcUsd).toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>` : '');

    // Legacy inputs need the full prev-tx (nonWitnessUtxo) even to ESTIMATE — fetch once, reuse for sign.
    const prevTxs = {};
    if (ctx && ctx.type === 'legacy') {
      try {
        const uniq = [...new Set(inList.map((u) => u.txid))];
        const got = await Promise.all(uniq.map((t) => fetch('api/btc/tx/' + t + '/hex').then((r) => (r.ok ? r.text() : null)).then((h) => [t, h && h.trim()]).catch(() => [t, null])));
        for (const [t, h] of got) { if (h) prevTxs[t] = h; }
      } catch (_) {}
    }

    ensureModal();
    $('#ccPrev')?.remove();
    $('#ccCard').insertAdjacentHTML('beforeend', `<div class="cc-preview" id="ccPrev">
      <div class="cc-prev-h">Consolidate ${sel.length} UTXOs → 1</div>
      <div class="cc-prev-row"><span>Inputs</span><b>${sel.length} · ${sat2btc(total)} BTC</b></div>
      <div class="fee-row" id="ccFeeRow" style="margin-top:10px">${[['fastestFee', 'Fast'], ['halfHourFee', 'Med'], ['hourFee', 'Econ']].map(([k, l]) => `<button type="button" class="feeopt${preset[k] === rate ? ' on' : ''}" data-r="${preset[k]}">${l} · ${preset[k]}</button>`).join('')}<input id="ccFeeCustom" class="m-in fee-custom" type="number" min="0.1" step="0.1" placeholder="custom s/vB"/></div>
      <div id="ccFeeHint" class="fee-hint" hidden></div>
      <div id="ccPrevCalc"></div>
      <div class="fine" style="margin-top:8px">Combines into one UTXO at <b>${esc(STATE.address.slice(0, 10))}…</b> (same address).</div>
      ${ctx ? '' : '<div class="warn" style="margin-top:8px">This address isn’t one of your signing accounts (watch-only) — consolidation needs your keys.</div>'}
      <div id="ccConsStatus" class="statusline" hidden></div>
      <div class="wbtns" style="margin-top:10px"><button class="ghost" id="ccPrevClose">Dismiss</button>${ctx ? '<button class="primary" id="ccConsGo">Sign &amp; broadcast</button>' : ''}</div>
    </div>`);

    function calc() {
      const box = $('#ccPrevCalc'); if (!box) return;
      let r;
      try { r = C.send({ account: ctx ? ctx.account : 0, importedId: ctx ? ctx.importedId : null, type: ctx ? ctx.type : 'nativeSegwit', utxos: inList, recipient: STATE.address, sendMax: true, feeRate: rate, rbf: true, sign: false, prevTxs }); }
      catch (e) { box.innerHTML = `<div class="cc-prev-row" style="color:var(--red)">${esc(e.message === 'locked' ? 'Unlock your wallet to preview.' : (e.message || 'Cannot build'))}</div>`; return; }
      box.innerHTML = `<div class="cc-prev-row"><span>Est. size</span><b>~${r.vsize} vB</b></div>
        <div class="cc-prev-row"><span>Fee @ ${rate} s/vB</span><b>${fmt(r.fee)} sats${usd(r.fee)}</b></div>
        <div class="cc-prev-row total"><span>Output (1 UTXO)</span><b>${sat2btc(r.amountSats)} BTC${usd(r.amountSats)}</b></div>`;
    }
    calc();

    const row = $('#ccFeeRow');
    const hint = (rr) => { const h = $('#ccFeeHint'); if (!h) return; if (rr > 0 && rr < 1) { h.hidden = false; h.textContent = '⚠ Below 1 sat/vB may not relay on all nodes — best when the mempool is near-empty.'; } else { h.hidden = true; } };
    row.querySelectorAll('.feeopt').forEach((b) => (b.onclick = () => { row.querySelectorAll('.feeopt').forEach((x) => x.classList.remove('on')); b.classList.add('on'); rate = Number(b.dataset.r); const fc = $('#ccFeeCustom'); if (fc) fc.value = ''; hint(rate); calc(); }));
    const fc = $('#ccFeeCustom'); if (fc) fc.oninput = () => { if (fc.value !== '') { const rr = Number(fc.value); if (rr > 0) { row.querySelectorAll('.feeopt').forEach((x) => x.classList.remove('on')); rate = rr; hint(rr); calc(); } } };
    $('#ccPrevClose').onclick = () => $('#ccPrev')?.remove();
    $('#ccPrev').scrollIntoView({ block: 'nearest' });

    if (ctx) $('#ccConsGo').onclick = async () => {
      const st = $('#ccConsStatus'); st.hidden = false; st.className = 'statusline load'; st.textContent = 'Signing locally & broadcasting…';
      try {
        const signed = C.send({ account: ctx.account, importedId: ctx.importedId, type: ctx.type, utxos: inList, recipient: STATE.address, sendMax: true, feeRate: rate, rbf: true, sign: true, prevTxs });
        const b = await fetch('api/btc/broadcast', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ txhex: signed.txhex }) }).then((x) => x.json());
        if (b.error) throw new Error(b.detail || b.error);
        st.className = 'statusline load'; st.innerHTML = `Broadcast ✓ — <a href="https://mempool.space/tx/${encodeURIComponent(b.txid)}" target="_blank" rel="noopener" style="color:var(--gold2)">${esc(String(b.txid).slice(0, 18))}…</a> · consolidated ${sel.length} → 1`;
        STATE.selected.clear();
        setTimeout(() => open(STATE.address), 3500); // rescan so the merged UTXO shows
      } catch (e) { st.className = 'statusline err'; st.textContent = 'Failed: ' + (e.message || 'sign/broadcast error'); }
    };
  }

  window.CoinControl = { open };
})();
