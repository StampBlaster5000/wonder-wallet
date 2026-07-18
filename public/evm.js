/* Wonder Wallet — Phase 7 EVM actions (Ethereum / Base / Arbitrum).
   Network switch · balances · send ETH/ERC-20 · revoke approval.
   prepare (server) → sign client-side (proven EIP-1559) → broadcast. */
'use strict';
(function () {
  const C = window.WonderCore;
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const short = (a) => (a.length > 16 ? a.slice(0, 8) + '…' + a.slice(-6) : a);
  const fmt = (n, d = 6) => Number(n).toLocaleString('en-US', { maximumFractionDigits: d });

  let ACCOUNT = 0, ADDR = null, NETWORK = 'ethereum', DATA = null;

  function toBaseUnits(amountStr, decimals) {
    const [w, f = ''] = String(amountStr).trim().split('.');
    const frac = (f + '0'.repeat(decimals)).slice(0, decimals);
    return BigInt(w || '0') * 10n ** BigInt(decimals) + BigInt(frac || '0');
  }
  const toHexWei = (bi) => '0x' + bi.toString(16);

  function modal(html) {
    let m = $('#evmodal');
    if (!m) { m = document.createElement('div'); m.id = 'evmodal'; m.className = 'modal'; m.innerHTML = '<div class="modal-card" id="evCard"></div>'; document.body.appendChild(m); m.addEventListener('click', (e) => { if (e.target.id === 'evmodal') close(); }); }
    $('#evCard').innerHTML = html; m.hidden = false; return $('#evCard');
  }
  function close() { const m = $('#evmodal'); if (m) m.hidden = true; }

  async function open(account, ethAddress, network) {
    ACCOUNT = account; ADDR = ethAddress; NETWORK = network || NETWORK;
    modal(`<h3 class="m-title">Ethereum / EVM</h3><div class="statusline load">Loading ${NETWORK}…</div>`);
    try {
      DATA = await fetch(`api/eth/${ethAddress}?network=${NETWORK}`).then((r) => r.json());
      render();
    } catch (e) { modal(`<h3 class="m-title">Ethereum / EVM</h3><div class="statusline err">${esc(e.message)}</div><button class="modal-x" id="evx">Close</button>`); $('#evx').onclick = close; }
  }

  function render() {
    const d = DATA;
    const tabs = (d.networks || ['ethereum']).map((n) => `<button class="ccf ${n === NETWORK ? 'on' : ''}" data-n="${n}">${n}</button>`).join('');
    const tokenRows = (d.tokens || []).map((t) => `<div class="acct"><div class="acct-l"><span class="acct-lab">${t.symbol}</span></div><div class="acct-r"><span class="acct-addr">${fmt(t.amount)}</span></div></div>`).join('') || '<div class="fine">No curated-token balances.</div>';
    modal(`<h3 class="m-title">Ethereum / EVM</h3>
      <div class="cp-filters" style="margin-bottom:10px">${tabs}</div>
      <div class="cp-src">${esc(d.address)}</div>
      <div class="wc-bal"><span class="big">${fmt(d.eth, 6)} ETH</span><span class="sub">${esc(d.networkName)} · chain ${d.chainId}</span></div>
      <div class="acct-list" style="margin-top:10px"><div class="acct-grp">Tokens</div>${tokenRows}</div>
      <div class="wbtns"><button class="primary" id="evSend">Send</button><button class="ghost" id="evRevoke">Revoke approval</button><button class="ghost" id="evx">Close</button></div>`);
    $('#evCard').querySelectorAll('.ccf').forEach((b) => (b.onclick = () => open(ACCOUNT, ADDR, b.dataset.n)));
    $('#evSend').onclick = sendForm;
    $('#evRevoke').onclick = revokeForm;
    $('#evx').onclick = close;
  }

  function sendForm() {
    const assets = [{ symbol: 'ETH', decimals: 18, native: true }, ...(DATA.tokens || [])];
    modal(`<h3 class="m-title">Send · ${esc(DATA.networkName)}</h3>
      <label class="cpf"><span>Asset</span><select id="evAsset" class="m-in">${assets.map((a, i) => `<option value="${i}">${esc(a.symbol)}${a.native ? '' : ' (' + esc(fmt(a.amount)) + ')'}</option>`).join('')}</select></label>
      <label class="cpf"><span>Recipient (0x…)</span><input id="evTo" class="m-in" spellcheck="false"/></label>
      <label class="cpf"><span>Amount</span><input id="evAmt" class="m-in" type="number" step="any"/></label>
      <div id="evStatus" class="statusline" hidden></div>
      <div class="wbtns"><button class="ghost" id="evBack">Back</button><button class="primary" id="evReview">Review</button></div>`);
    $('#evBack').onclick = render;
    $('#evReview').onclick = async () => {
      const s = $('#evStatus'); s.hidden = false; s.className = 'statusline load'; s.textContent = 'Preparing & signing…';
      try {
        const a = assets[Number($('#evAsset').value)];
        const to = $('#evTo').value.trim();
        if (!/^0x[0-9a-fA-F]{40}$/.test(to)) throw new Error('Enter a valid 0x recipient.');
        const amt = $('#evAmt').value.trim();
        let txTo, valueWei, data, human;
        if (a.native) { txTo = to; valueWei = toHexWei(toBaseUnits(amt, 18)); data = '0x'; human = `${amt} ETH`; }
        else { txTo = a.address; valueWei = '0x0'; data = C.erc20TransferData(to, toBaseUnits(amt, a.decimals)); human = `${amt} ${a.symbol}`; }
        await prepareSignPreview({ txTo, valueWei, data, human, to, label: 'Send' });
      } catch (err) { s.className = 'statusline err'; s.textContent = err.message || 'Failed.'; }
    };
  }

  function revokeForm() {
    modal(`<h3 class="m-title">Revoke approval</h3>
      <p class="fine">Set a spender's allowance to zero (approve(spender, 0)). Paste the token and the spender you want to revoke.</p>
      <label class="cpf"><span>Token contract (0x…)</span><input id="rvToken" class="m-in" spellcheck="false"/></label>
      <label class="cpf"><span>Spender to revoke (0x…)</span><input id="rvSpender" class="m-in" spellcheck="false"/></label>
      <div id="evStatus" class="statusline" hidden></div>
      <div class="wbtns"><button class="ghost" id="evBack">Back</button><button class="primary" id="evReview">Review</button></div>`);
    $('#evBack').onclick = render;
    $('#evReview').onclick = async () => {
      const s = $('#evStatus'); s.hidden = false; s.className = 'statusline load'; s.textContent = 'Preparing & signing…';
      try {
        const token = $('#rvToken').value.trim(), spender = $('#rvSpender').value.trim();
        if (!/^0x[0-9a-fA-F]{40}$/.test(token) || !/^0x[0-9a-fA-F]{40}$/.test(spender)) throw new Error('Enter valid 0x addresses.');
        const data = C.erc20ApproveData(spender, 0n);
        await prepareSignPreview({ txTo: token, valueWei: '0x0', data, human: `Revoke ${short(spender)}`, to: token, label: 'Revoke' });
      } catch (err) { s.className = 'statusline err'; s.textContent = err.message || 'Failed.'; }
    };
  }

  async function prepareSignPreview({ txTo, valueWei, data, human, to, label }) {
    const prep = await fetch('api/eth/prepare', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from: ADDR, to: txTo, valueWei, data, network: NETWORK }) }).then((r) => r.json());
    if (prep.error) throw new Error(prep.detail || prep.error);
    const signed = C.sendEvm({ account: ACCOUNT, to: txTo, valueWei, data, nonce: prep.nonce, chainId: prep.chainId, maxFeePerGas: prep.maxFeePerGas, maxPriorityFeePerGas: prep.maxPriorityFeePerGas, gasLimit: prep.gasLimit });
    const gasCostWei = BigInt(prep.gasLimit) * BigInt(prep.maxFeePerGas);
    const gasEth = Number(gasCostWei) / 1e18;
    modal(`<h3 class="m-title">Confirm · ${label}</h3>
      <div class="prev-flow"><div class="pf"><span>${esc(label)}</span><b>${esc(human)}</b></div>
        <div class="pf-arrow">↓</div><div class="pf"><span>To</span><b class="mono">${esc(to)}</b></div></div>
      <div class="m-grid">
        <div><span class="k">Network</span><span class="v">${esc(DATA.networkName)}</span></div>
        <div><span class="k">Max gas</span><span class="v">${fmt(gasEth, 8)} ETH</span></div>
        <div><span class="k">Nonce</span><span class="v">${prep.nonce}</span></div>
        <div><span class="k">Gas limit</span><span class="v">${parseInt(prep.gasLimit, 16).toLocaleString()}</span></div>
      </div>
      <div id="evbStatus" class="statusline" hidden></div>
      <div class="wbtns"><button class="ghost" id="evBack2">Back</button><button class="primary" id="evBroadcast">Broadcast</button></div>`);
    $('#evBack2').onclick = render;
    $('#evBroadcast').onclick = async () => {
      const s = $('#evbStatus'); s.hidden = false; s.className = 'statusline load'; s.textContent = 'Broadcasting…';
      try {
        const r = await fetch('api/eth/broadcast', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ raw: signed.raw, network: NETWORK }) }).then((x) => x.json());
        if (r.error) throw new Error(r.detail || r.error);
        s.className = 'statusline load'; s.innerHTML = `Broadcast ✓ — <a href="${esc(DATA.explorer)}/tx/${encodeURIComponent(r.txhash)}" target="_blank" rel="noopener" style="color:var(--gold2)">${esc(String(r.txhash).slice(0, 18))}…</a>`;
      } catch (err) { s.className = 'statusline err'; s.textContent = 'Rejected: ' + (err.message || 'broadcast failed'); }
    };
  }

  window.EvmActions = { open };
})();
