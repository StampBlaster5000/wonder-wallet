/* Wonder Wallet — SRC-101 (.btc names / "Bitname") management suite.
   Register · Transfer · Set-address · Renew · Deploy. Composes an unsigned PSBT via
   stampchain (api/src101/create), signs client-side (same engine as SRC-20), broadcasts.
   NOTE: stampchain's src101/create compose is WIP upstream (rejects documented shapes),
   so submits currently fall back to a bitname.pro deep-link — the dryRun COST PREVIEW works
   today, and the native compose lights up the moment upstream is fixed. */
'use strict';
(function () {
  const C = window.WonderCore;
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const b64 = (s) => { try { return btoa(unescape(encodeURIComponent(String(s)))); } catch (_) { return ''; } };
  const REGISTRAR = 'https://bitname.pro';
  const FALLBACK_DEPLOY = '77fb147b72a551cf1e2f0b37dccf9982a1c25623a7fe8b4d5efaac566cf63fed';

  let ACCOUNT = 0, FROM = null, DEPLOY = FALLBACK_DEPLOY;
  // CONN2: a connected external wallet ({ address, name, signPsbt, pushPsbt }). When set, the composed
  // name op is signed + broadcast by IT instead of the local seed. Cleared on every local entry.
  let CONN2 = null;
  const s101hex = (b) => { const bin = atob(b); let h = ''; for (let i = 0; i < bin.length; i++) h += (bin.charCodeAt(i) & 0xff).toString(16).padStart(2, '0'); return h; };

  function modal(html) {
    let m = $('#s101modal');
    if (!m) { m = document.createElement('div'); m.id = 's101modal'; m.className = 'modal'; m.innerHTML = '<div class="modal-card" id="s101card"></div>'; document.body.appendChild(m); m.addEventListener('click', (e) => { if (e.target.id === 's101modal') close(); }); }
    $('#s101card').innerHTML = html; m.hidden = false; return $('#s101card');
  }
  const fromHub = () => !!(window.DappDashboard && window.DappDashboard.fromHub && window.DappDashboard.fromHub());
  function close() { const m = $('#s101modal'); if (m) m.hidden = true; if (window.DappDashboard && window.DappDashboard.returnToHub) window.DappDashboard.returnToHub(); }

  const RE_NAME = /^[a-z0-9][a-z0-9-]{0,62}$/i; // bare name (no .btc), conservative
  const bare = (n) => String(n || '').trim().toLowerCase().replace(/\.btc$/i, '');

  const ACTS = [
    { k: 'register', ic: '🌐', label: 'Register a name', hint: 'Claim a new .btc name' },
    { k: 'transfer', ic: '➤', label: 'Transfer', hint: 'Send a name you own to another address' },
    { k: 'setrecord', ic: '🔗', label: 'Set address', hint: 'Point a name at a BTC address' },
    { k: 'renew', ic: '♻', label: 'Renew', hint: 'Extend a name’s lease' },
    { k: 'deploy', ic: '✦', label: 'Deploy namespace', hint: 'Advanced — launch your own TLD' },
  ];

  async function open(account, fromAddress) {
    CONN2 = null; ACCOUNT = account; FROM = fromAddress;
    // Pick up the canonical .btc deploy hash from the address's names route (falls back to constant).
    try { const nm = await fetch('api/src101/names/' + encodeURIComponent(FROM)).then((r) => r.json()); if (nm.deploy) DEPLOY = nm.deploy; } catch (_) {}
    renderHub();
  }
  // Deep-link from a name's detail modal straight into an action, name pre-filled.
  function manage(account, fromAddress, action, ctx) {
    CONN2 = null; ACCOUNT = account; FROM = fromAddress; if (ctx && ctx.deploy) DEPLOY = ctx.deploy;
    const nm = ctx && ctx.name ? bare(ctx.name) : '';
    if (action === 'transfer') return formTransfer(nm);
    if (action === 'setrecord') return formSetRecord(nm);
    if (action === 'renew') return formRenew(nm);
    return renderHub();
  }
  // Connected external wallet (UniSat/OKX/Wonder) deep-link into a name action — signed by the wallet.
  function manageConnected(conn, action, ctx) {
    CONN2 = conn; ACCOUNT = 0; FROM = conn.address; if (ctx && ctx.deploy) DEPLOY = ctx.deploy;
    const nm = ctx && ctx.name ? bare(ctx.name) : '';
    if (action === 'transfer') return formTransfer(nm);
    if (action === 'setrecord') return formSetRecord(nm);
    if (action === 'renew') return formRenew(nm);
    return renderHub();
  }

  function renderHub() {
    const grid = ACTS.map((a) => `<button class="cp-act" data-k="${a.k}"><span class="cp-ic">${a.ic}</span>${esc(a.label)}<span class="cp-act-hint">${esc(a.hint)}</span></button>`).join('');
    modal(`<h3 class="m-title">Bitname · <span style="color:var(--gold2)">.btc</span> names</h3>
      <div class="fine">Human-readable Bitcoin names on <b>Bitcoin Stamps (SRC-101)</b> — permanent, on-chain, yours. Resolve them in Send anywhere in the wallet.</div>
      <div class="cp-grid">${grid}</div>
      <div class="warn" style="margin-top:12px">⚠ On-chain <b>registration/management is composed by stampchain</b>, whose SRC-101 endpoint is being finalized upstream. Cost previews work now; final signing opens shortly — until then, submits hand off to <b>bitname.pro</b> with your name pre-filled.</div>
      <button class="modal-x" id="s101x">${fromHub() ? '‹ Dashboard' : 'Close'}</button>`);
    $('#s101x').onclick = close;
    $('#s101card').querySelectorAll('.cp-act').forEach((b) => (b.onclick = () => route(b.dataset.k)));
  }
  function route(k) {
    if (k === 'register') return formRegister('');
    if (k === 'transfer') return formTransfer('');
    if (k === 'setrecord') return formSetRecord('');
    if (k === 'renew') return formRenew('');
    if (k === 'deploy') return formDeploy();
  }

  // ── shared bits ──
  function backBar(title) {
    return `<h3 class="m-title">${title}</h3><div class="cp-src">from ${esc(FROM)}</div>`;
  }
  function statusEl() { return $('#s101status'); }
  // Try native compose→sign→broadcast; on the upstream block, deep-link to the registrar.
  async function submitOp(op, params, deepLinkPath, label) {
    const s = statusEl(); s.hidden = false; s.className = 'statusline load'; s.textContent = 'Composing via stampchain…';
    try {
      const c = await fetch('api/src101/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: FROM, params: { op, ...params } }) }).then((r) => r.json());
      if (c.error || !c.hex) throw new Error(c.detail || c.error || 'compose_unavailable');
      // Connected external wallet (UniSat/OKX/Wonder): hand the composed PSBT to it to sign + broadcast.
      if (CONN2) {
        s.textContent = 'Waiting for approval in ' + (CONN2.name || 'your wallet') + '…';
        const hex = /^[0-9a-fA-F]+$/.test(c.hex) ? c.hex : s101hex(c.hex);
        const signedTx = await CONN2.signPsbt(hex, { autoFinalized: true });
        s.textContent = 'Broadcasting…';
        const signedStr = typeof signedTx === 'string' ? signedTx : (signedTx && (signedTx.psbt || signedTx.hex)) || hex;
        const pushed = await CONN2.pushPsbt(signedStr);
        const id = typeof pushed === 'string' ? pushed : (pushed && (pushed.txid || pushed.result)) || String(pushed);
        s.className = 'statusline load'; s.innerHTML = `${label} ✓ — <a href="https://mempool.space/tx/${encodeURIComponent(id)}" target="_blank" rel="noopener" style="color:var(--gold2)">${esc(String(id).slice(0, 18))}…</a>`;
        return;
      }
      s.textContent = 'Signing locally & broadcasting…';
      const signed = C.signStamp(c.hex, ACCOUNT, 'nativeSegwit');
      const r = await fetch('api/btc/broadcast', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ txhex: signed.txhex }) }).then((x) => x.json());
      if (r.error) throw new Error(r.detail || r.error);
      s.className = 'statusline load'; s.innerHTML = `${label} ✓ — <a href="https://mempool.space/tx/${encodeURIComponent(r.txid)}" target="_blank" rel="noopener" style="color:var(--gold2)">${esc(String(r.txid).slice(0, 18))}…</a>`;
    } catch (err) {
      // Upstream compose not ready → graceful hand-off with the name pre-filled.
      s.className = 'name-resolve bad'; s.style.marginTop = '10px';
      s.innerHTML = `On-chain compose isn’t available from stampchain yet. Finish this at the registrar → <a href="${REGISTRAR}${deepLinkPath || ''}" target="_blank" rel="noopener" style="color:var(--gold2)"><b>bitname.pro</b></a>. Your wallet already resolves & displays .btc names.`;
    }
  }
  // Live cost preview via the working dryRun estimate.
  async function costPreview(op, params, hostEl) {
    if (!hostEl) return;
    hostEl.innerHTML = '<span class="fine">Estimating cost…</span>';
    try {
      const c = await fetch('api/src101/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dryRun: true, params: { op, ...params } }) }).then((r) => r.json());
      if (c && c.estimate) {
        const miner = Number(c.est_miner_fee || 0), dust = Number(c.total_dust_value || 0), total = Number(c.total_cost || miner + dust);
        hostEl.innerHTML = `<div class="fine">Est. cost: <b>${total.toLocaleString('en-US')} sats</b> <span class="muted">(${miner.toLocaleString()} miner + ${dust.toLocaleString()} dust · ~${c.est_tx_size != null ? Number(c.est_tx_size) : '—'} vB)</span> + any registration price</div>`; // Number-coerce (audit #7b)
      } else hostEl.innerHTML = '';
    } catch (_) { hostEl.innerHTML = ''; }
  }

  function actionsRow(goLabel) {
    return `<div id="s101status" class="statusline" hidden></div>
      <div class="wbtns"><button class="ghost" id="s101back">Back</button><button class="primary" id="s101go">${esc(goLabel)}</button></div>`;
  }
  function wireBack() { const b = $('#s101back'); if (b) b.onclick = renderHub; }

  // ── Register (mint) ──
  function formRegister(name) {
    modal(`${backBar('🌐 Register a .btc name')}
      <label class="cpf"><span>Name <span id="s101chk" class="tickchk"></span></span>
        <div style="display:flex;align-items:center;gap:6px"><input id="s101name" class="m-in" value="${esc(name)}" placeholder="satoshi" spellcheck="false" autocapitalize="off"/><span class="fine" style="color:var(--gold2)">.btc</span></div></label>
      <label class="cpf"><span>Lease length (years)</span><input id="s101dua" class="m-in" type="number" min="1" value="999"/></label>
      <div id="s101cost" class="rate-hint fine"></div>
      ${actionsRow('Register')}`);
    wireBack();
    const nEl = $('#s101name'), chk = $('#s101chk'); let t = null;
    const check = () => {
      clearTimeout(t);
      const v = bare(nEl.value);
      if (!v) { chk.className = 'tickchk'; chk.innerHTML = ''; $('#s101cost').innerHTML = ''; return; }
      if (!RE_NAME.test(v)) { chk.className = 'tickchk bad'; chk.innerHTML = 'invalid'; return; }
      chk.className = 'tickchk loading'; chk.textContent = '…';
      t = setTimeout(async () => {
        try {
          const r = await fetch('api/src101/resolve/' + encodeURIComponent(v + '.btc')).then((x) => x.json());
          if (bare(nEl.value) !== v) return;
          if (r && r.exists) { chk.className = 'tickchk bad'; chk.innerHTML = '✕ taken'; }
          else { chk.className = 'tickchk good'; chk.innerHTML = '✓ available'; costPreview('mint', { hash: DEPLOY, toaddress: FROM, tokenid: [b64(v)], dua: $('#s101dua').value || '999', recAddress: FROM }, $('#s101cost')); }
        } catch (_) { chk.className = 'tickchk'; chk.innerHTML = ''; }
      }, 350);
    };
    nEl.oninput = check; if (name) check();
    $('#s101go').onclick = () => {
      const v = bare(nEl.value);
      if (!RE_NAME.test(v)) { const s = statusEl(); s.hidden = false; s.className = 'statusline err'; s.textContent = 'Enter a valid name (letters, numbers, hyphens).'; return; }
      submitOp('mint', { hash: DEPLOY, toaddress: FROM, tokenid: [b64(v)], dua: $('#s101dua').value || '999', recAddress: FROM }, '', 'Registered');
    };
  }

  // ── Transfer ──
  function formTransfer(name) {
    modal(`${backBar('➤ Transfer a .btc name')}
      <label class="cpf"><span>Name you own</span><div style="display:flex;align-items:center;gap:6px"><input id="s101name" class="m-in" value="${esc(name)}" placeholder="satoshi" spellcheck="false"/><span class="fine" style="color:var(--gold2)">.btc</span></div></label>
      <label class="cpf"><span>New owner address</span><input id="s101to" class="m-in" placeholder="bc1q… / 1… / bc1p…" spellcheck="false"/></label>
      ${actionsRow('Transfer name')}`);
    wireBack();
    $('#s101go').onclick = () => {
      const v = bare($('#s101name').value), to = $('#s101to').value.trim();
      const s = statusEl();
      if (!v) { s.hidden = false; s.className = 'statusline err'; s.textContent = 'Enter the name you own.'; return; }
      if (!/^(bc1[a-z0-9]{8,87}|[13][a-km-zA-HJ-NP-Z1-9]{25,39})$/.test(to)) { s.hidden = false; s.className = 'statusline err'; s.textContent = 'Enter a valid destination address.'; return; }
      submitOp('transfer', { hash: DEPLOY, tokenid: b64(v), toaddress: to }, '', 'Transferred');
    };
  }

  // ── Set address record ──
  function formSetRecord(name) {
    modal(`${backBar('🔗 Set a name’s address')}
      <label class="cpf"><span>Name you own</span><div style="display:flex;align-items:center;gap:6px"><input id="s101name" class="m-in" value="${esc(name)}" placeholder="satoshi" spellcheck="false"/><span class="fine" style="color:var(--gold2)">.btc</span></div></label>
      <label class="cpf"><span>Points to (BTC address)</span><input id="s101addr" class="m-in" value="${esc(FROM)}" spellcheck="false"/></label>
      <label class="cpf-check"><input type="checkbox" id="s101prim" checked/> Make this my primary name</label>
      ${actionsRow('Set record')}`);
    wireBack();
    $('#s101go').onclick = () => {
      const v = bare($('#s101name').value), addr = $('#s101addr').value.trim();
      const s = statusEl();
      if (!v) { s.hidden = false; s.className = 'statusline err'; s.textContent = 'Enter the name you own.'; return; }
      submitOp('setrecord', { hash: DEPLOY, tokenid: b64(v), type: 'address', data: { btc: addr }, prim: $('#s101prim').checked ? 'true' : 'false' }, '', 'Record set');
    };
  }

  // ── Renew ──
  function formRenew(name) {
    modal(`${backBar('♻ Renew a .btc name')}
      <label class="cpf"><span>Name you own</span><div style="display:flex;align-items:center;gap:6px"><input id="s101name" class="m-in" value="${esc(name)}" placeholder="satoshi" spellcheck="false"/><span class="fine" style="color:var(--gold2)">.btc</span></div></label>
      <label class="cpf"><span>Extend by (years)</span><input id="s101dua" class="m-in" type="number" min="1" value="999"/></label>
      <div id="s101cost" class="rate-hint fine"></div>
      ${actionsRow('Renew')}`);
    wireBack();
    const upd = () => { const v = bare($('#s101name').value); if (v) costPreview('renew', { hash: DEPLOY, tokenid: b64(v), dua: $('#s101dua').value || '999', recAddress: FROM }, $('#s101cost')); };
    $('#s101name').oninput = upd; if (name) upd();
    $('#s101go').onclick = () => {
      const v = bare($('#s101name').value); const s = statusEl();
      if (!v) { s.hidden = false; s.className = 'statusline err'; s.textContent = 'Enter the name you own.'; return; }
      submitOp('renew', { hash: DEPLOY, tokenid: b64(v), dua: $('#s101dua').value || '999', recAddress: FROM }, '', 'Renewed');
    };
  }

  // ── Deploy namespace (advanced) ──
  function formDeploy() {
    modal(`${backBar('✦ Deploy a namespace')}
      <div class="fine">Launching your own SRC-101 namespace (TLD) is an advanced, one-time on-chain deploy with pricing tiers, mint windows and whitelists. Wonder Wallet composes it once stampchain’s SRC-101 compose is finalized.</div>
      <div class="warn" style="margin-top:10px">For now, deploy a namespace at <a href="${REGISTRAR}" target="_blank" rel="noopener" style="color:var(--gold2)"><b>bitname.pro</b></a> — Wonder Wallet will then <b>display, resolve and manage</b> names under it automatically.</div>
      <div class="wbtns"><button class="ghost" id="s101back">Back</button><a class="primary" href="${REGISTRAR}" target="_blank" rel="noopener" style="text-decoration:none;text-align:center">Open bitname.pro ↗</a></div>`);
    wireBack();
  }

  window.Src101 = { open, manage, manageConnected };
})();
