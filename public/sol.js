/* Wonder Wallet — Phase 7b Solana actions.
   Balance · SPL tokens · NFT/cNFT gallery (DAS) · send SOL/SPL (ed25519, verified).
   get blockhash (server) → build+sign client-side → simulate → broadcast. */
'use strict';
(function () {
  const C = window.WonderCore;
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const short = (a) => (a.length > 14 ? a.slice(0, 6) + '…' + a.slice(-5) : a);
  const fmt = (n, d = 6) => Number(n).toLocaleString('en-US', { maximumFractionDigits: d });
  function toBase(amountStr, decimals) { const [w, f = ''] = String(amountStr).trim().split('.'); const frac = (f + '0'.repeat(decimals)).slice(0, decimals); return BigInt(w || '0') * 10n ** BigInt(decimals) + BigInt(frac || '0'); }

  let ACCOUNT = 0, ADDR = null, DATA = null;

  function modal(html) {
    let m = $('#solmodal');
    if (!m) { m = document.createElement('div'); m.id = 'solmodal'; m.className = 'modal'; m.innerHTML = '<div class="modal-card" id="solCard"></div>'; document.body.appendChild(m); m.addEventListener('click', (e) => { if (e.target.id === 'solmodal') close(); }); }
    $('#solCard').innerHTML = html; m.hidden = false; return $('#solCard');
  }
  function close() { const m = $('#solmodal'); if (m) m.hidden = true; }

  async function open(account, solAddress) {
    ACCOUNT = account; ADDR = solAddress;
    modal('<h3 class="m-title">Solana</h3><div class="statusline load">Loading…</div>');
    try {
      DATA = await fetch(`api/sol/${solAddress}`).then((r) => r.json());
      render();
      // lazy NFT gallery
      fetch(`api/sol/${solAddress}/nfts`).then((r) => r.json()).then(renderNfts).catch(() => {});
    } catch (e) { modal(`<h3 class="m-title">Solana</h3><div class="statusline err">${esc(e.message)}</div><button class="modal-x" id="solx">Close</button>`); $('#solx').onclick = close; }
  }

  function render() {
    const d = DATA;
    const tokenRows = (d.tokens || []).map((t) => `<div class="acct"><div class="acct-l"><span class="acct-lab">${short(t.mint)}</span></div><div class="acct-r"><span class="acct-addr">${fmt(t.amount)}</span></div></div>`).join('') || '<div class="fine">No SPL token balances.</div>';
    modal(`<h3 class="m-title">Solana</h3>
      <div class="cp-src">${esc(d.address)}</div>
      <div class="wc-bal"><span class="big">${fmt(d.sol, 5)} SOL</span><span class="sub">${d.nftCount != null ? d.nftCount + ' NFTs' : ''}</span></div>
      <div class="acct-list" style="margin-top:10px"><div class="acct-grp">SPL tokens</div>${tokenRows}</div>
      <div id="solNfts"></div>
      <div class="wbtns"><button class="primary" id="solSend">Send</button><button class="ghost" id="solx">Close</button></div>`);
    $('#solSend').onclick = sendForm;
    $('#solx').onclick = close;
  }
  function renderNfts(n) {
    const box = $('#solNfts'); if (!box) return;
    if (!n.dasEnabled) { box.innerHTML = '<div class="acct-grp" style="margin-top:14px">NFT gallery</div><div class="fine">Connect a DAS provider (Helius) to load your NFT &amp; cNFT gallery.</div>'; return; }
    if (!n.items.length) { box.innerHTML = '<div class="acct-grp" style="margin-top:14px">NFTs</div><div class="fine">No NFTs found.</div>'; return; }
    box.innerHTML = `<div class="acct-grp" style="margin-top:14px">NFTs · ${n.items.length}</div><div class="stamprow">${n.items.slice(0, 18).map((it) => `<div class="stampthumb">${it.image ? `<img loading="lazy" src="api/img?url=${encodeURIComponent(it.image)}" alt="${esc(it.name)}"/>` : '<div style="width:56px;height:56px;background:#000;border-radius:4px"></div>'}<span>${it.compressed ? 'c' : ''}${esc(it.name).slice(0, 7)}</span></div>`).join('')}</div>`;
  }

  function sendForm() {
    const assets = [{ symbol: 'SOL', decimals: 9, native: true }, ...(DATA.tokens || []).map((t) => ({ symbol: short(t.mint), mint: t.mint, decimals: t.decimals }))];
    modal(`<h3 class="m-title">Send · Solana</h3>
      <label class="cpf"><span>Asset</span><select id="solAsset" class="m-in">${assets.map((a, i) => `<option value="${i}">${esc(a.symbol)}</option>`).join('')}</select></label>
      <label class="cpf"><span>Recipient</span><input id="solTo" class="m-in" spellcheck="false"/></label>
      <label class="cpf"><span>Amount</span><input id="solAmt" class="m-in" type="number" step="any"/></label>
      <div id="solStatus" class="statusline" hidden></div>
      <div class="wbtns"><button class="ghost" id="solBack">Back</button><button class="primary" id="solReview">Review</button></div>`);
    $('#solBack').onclick = render;
    $('#solReview').onclick = async () => {
      const s = $('#solStatus'); s.hidden = false; s.className = 'statusline load'; s.textContent = 'Building & signing…';
      try {
        const a = assets[Number($('#solAsset').value)];
        const to = $('#solTo').value.trim();
        if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(to)) throw new Error('Enter a valid Solana address.');
        const amt = $('#solAmt').value.trim();
        const { blockhash } = await fetch('api/sol/blockhash').then((r) => r.json());
        let signed, human;
        if (a.native) { signed = C.sendSol({ account: ACCOUNT, to, lamports: toBase(amt, 9), blockhash }); human = `${amt} SOL`; }
        else { signed = C.sendSpl({ account: ACCOUNT, to, mint: a.mint, amount: toBase(amt, a.decimals), decimals: a.decimals, blockhash }); human = `${amt} ${a.symbol}`; }
        // simulate for a safety preview
        let sim = null; try { sim = await fetch('api/sol/simulate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ txBase64: signed.txBase64 }) }).then((r) => r.json()); } catch (_) {}
        preview(signed, human, to, sim);
      } catch (err) { s.className = 'statusline err'; s.textContent = err.message || 'Failed.'; }
    };
  }

  function preview(signed, human, to, sim) {
    const simNote = sim ? (sim.err ? `<div class="warn">Simulation: ${esc(JSON.stringify(sim.err)).slice(0, 80)} (expected if the source is unfunded — signature &amp; structure are valid).</div>` : `<div class="fine">Simulation OK · ${sim.unitsConsumed || '—'} compute units.</div>`) : '';
    modal(`<h3 class="m-title">Confirm · Send</h3>
      <div class="prev-flow"><div class="pf"><span>Send</span><b>${esc(human)}</b></div><div class="pf-arrow">↓</div><div class="pf"><span>To</span><b class="mono">${esc(to)}</b></div></div>
      ${simNote}
      <div id="solbStatus" class="statusline" hidden></div>
      <div class="wbtns"><button class="ghost" id="solBack2">Back</button><button class="primary" id="solBroadcast">Broadcast</button></div>`);
    $('#solBack2').onclick = sendForm;
    $('#solBroadcast').onclick = async () => {
      const s = $('#solbStatus'); s.hidden = false; s.className = 'statusline load'; s.textContent = 'Broadcasting…';
      try {
        const r = await fetch('api/sol/broadcast', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ txBase64: signed.txBase64 }) }).then((x) => x.json());
        if (r.error) throw new Error(r.detail || r.error);
        s.className = 'statusline load'; s.innerHTML = `Broadcast ✓ — <a href="https://solscan.io/tx/${encodeURIComponent(r.signature)}" target="_blank" rel="noopener" style="color:var(--gold2)">${esc(String(r.signature).slice(0, 18))}…</a>`;
      } catch (err) { s.className = 'statusline err'; s.textContent = 'Rejected: ' + (err.message || 'broadcast failed'); }
    };
  }

  window.SolActions = { open };
})();
