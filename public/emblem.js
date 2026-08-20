/* Wonder Wallet — Phase 7c Emblem Vault bridge.
   My Vaults (inventory) · "Vault now" wrap (create → deposit → mint) · Redeem.
   No API key. Client personal_signs; server proxies Emblem + builds calldata;
   client signs+broadcasts the EVM tx via the proven pipeline. */
'use strict';
(function () {
  const C = window.WonderCore;
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const short = (a) => (a && a.length > 16 ? a.slice(0, 8) + '…' + a.slice(-6) : a);

  let ACCOUNT = 0, ETH = null, BTC = null, ASSET_CTX = null, LAST_VAULTS = [];

  // Persist created-but-unminted vaults locally so the BTC deposit address is NEVER lost
  // if the window closes or the user lacks ETH to mint right away. (The address is also
  // recoverable from Emblem's API, but this is an immediate, offline-safe backup.)
  const pendKey = (eth) => `ww:emblem:pending:${String(eth || '').toLowerCase()}`;
  function loadPending(eth) { try { return JSON.parse(localStorage.getItem(pendKey(eth)) || '[]'); } catch (_) { return []; } }
  function savePending(eth, rec) {
    const list = loadPending(eth).filter((x) => String(x.tokenId) !== String(rec.tokenId));
    list.unshift(rec); try { localStorage.setItem(pendKey(eth), JSON.stringify(list.slice(0, 50))); } catch (_) {}
  }
  function removePending(eth, tokenId) {
    try { localStorage.setItem(pendKey(eth), JSON.stringify(loadPending(eth).filter((x) => String(x.tokenId) !== String(tokenId)))); } catch (_) {}
  }
  const btcDeposit = (v) => (v.addresses || []).find((a) => /^btc$/i.test(a.coin)) || (v.addresses || []).find((a) => a.address) || null;

  // ── WW-C06: authenticate the vault deposit address before any irreversible send ──
  // The deposit address comes from the Emblem API and is prefilled into a real asset send. Wonder can't
  // derive it independently, but it CAN (a) reject anything that isn't a well-formed Bitcoin address and
  // (b) bind the send to the address captured when the vault was created — so a read response that later
  // substitutes an attacker deposit address is caught here, before the asset moves. Fail closed.
  const RE_BTC = /^((bc1|tb1)[a-z0-9]{8,87}|[123mn2][a-km-zA-HJ-NP-Z1-9]{25,39})$/;
  const validDepositAddr = (a) => typeof a === 'string' && RE_BTC.test(a.trim());
  const pendingAddr = (tokenId) => { try { return (loadPending(ETH).find((p) => String(p.tokenId) === String(tokenId)) || {}).address || null; } catch (_) { return null; } };
  function guardDeposit(tokenId, addr) {
    if (!validDepositAddr(addr)) throw new Error('The vault deposit address is not a valid Bitcoin address — refusing to send your asset there.');
    const orig = pendingAddr(tokenId);
    if (orig && String(orig).trim() !== String(addr).trim()) throw new Error('Aborted — this vault’s deposit address (' + addr + ') does not match the one saved when the vault was created (' + orig + '). It may have been substituted; nothing was sent.');
    return String(addr).trim();
  }
  // Standing notice: vaulting spans two chains.
  const TWOCHAIN_WARN = `<div class="vault-warn"><b>⚠ This is a two-chain flow — you'll need both Bitcoin and Ethereum.</b>
    <ul style="margin:6px 0 0;padding-left:18px"><li><b>Bitcoin</b> — to send your asset (a BTC tx + miner fee) to the vault's deposit address.</li>
    <li><b>Ethereum</b> — to mint the vault NFT afterwards (pays the mint price + gas).</li></ul>
    <div style="margin-top:6px">The deposit address is <b>saved under “My Vaults”</b>, so if you run out of ETH or close the window you can come back and finish — your asset is never stranded.</div></div>`;

  function modal(html) {
    let m = $('#embmodal');
    if (!m) { m = document.createElement('div'); m.id = 'embmodal'; m.className = 'modal'; m.innerHTML = '<div class="modal-card cc-card" id="embCard"></div>'; document.body.appendChild(m); m.addEventListener('click', (e) => { if (e.target.id === 'embmodal') close(); }); }
    $('#embCard').innerHTML = html; m.hidden = false; return $('#embCard');
  }
  // Hub-aware exit: Emblem can be opened from the dApp dashboard OR the portfolio; only
  // return to the hub when we came from it.
  const fromHub = () => !!(window.DappDashboard && window.DappDashboard.fromHub && window.DappDashboard.fromHub());
  const exitLabel = () => (fromHub() ? '‹ Dashboard' : 'Close');
  function close() { const m = $('#embmodal'); if (m) m.hidden = true; if (window.DappDashboard && window.DappDashboard.returnToHub) window.DappDashboard.returnToHub(); }
  async function copy(t, b) { try { await navigator.clipboard.writeText(t); if (b) { const o = b.textContent; b.textContent = 'copied ✓'; setTimeout(() => (b.textContent = o), 1200); } } catch (_) {} }

  async function open(account, ethAddress, btcAddress, startTab) {
    ACCOUNT = account; ETH = ethAddress; BTC = btcAddress;
    if (startTab !== 'wrap') ASSET_CTX = null; // generic open clears asset scope; vaultAsset keeps it
    const onWrap = startTab === 'wrap';
    modal(`<div class="cc-head"><div><h3 class="m-title" style="margin:0">Emblem Vault bridge</h3>
      <div class="cp-addr">Vaults owned by ${esc(ethAddress)}</div></div><button class="mini" id="embx">${exitLabel()}</button></div>
      <div class="cp-filters" style="margin:6px 0 12px"><button class="ccf ${onWrap ? '' : 'on'}" id="tabVaults">My Vaults</button><button class="ccf ${onWrap ? 'on' : ''}" id="tabWrap">Vault an asset</button></div>
      <div id="embBody"><div class="statusline load">Loading…</div></div>`);
    $('#embx').onclick = close;
    $('#tabVaults').onclick = myVaults;
    $('#tabWrap').onclick = wrapStart;
    onWrap ? wrapStart() : myVaults();
  }

  async function myVaults() {
    $('#tabVaults')?.classList.add('on'); $('#tabWrap')?.classList.remove('on');
    const body = $('#embBody'); body.innerHTML = '<div class="statusline load">Loading your vaults…</div>';
    let vaults = [];
    try { vaults = (await fetch(`api/emblem/vaults/${ETH}?type=created`).then((r) => r.json())).vaults || []; } catch (_) {}
    // Merge any locally-saved pending vaults the API hasn't surfaced yet (creation can lag),
    // so a freshly-created vault's deposit address is visible immediately.
    const seen = new Set(vaults.map((v) => String(v.tokenId)));
    loadPending(ETH).forEach((p) => {
      if (seen.has(String(p.tokenId))) return;
      vaults.push({ tokenId: p.tokenId, name: p.name, addresses: p.address ? [{ coin: p.coin || 'BTC', address: p.address }] : [], status: 'unminted', _local: true, _asset: p.asset });
    });
    LAST_VAULTS = vaults;
    if (!vaults.length) { body.innerHTML = '<div class="fine">No Emblem vaults found for this address. Use “Vault an asset” to wrap a Bitcoin / Counterparty asset into a vault.</div>'; return; }
    body.innerHTML = vaults.map((v) => {
      const unminted = !v.status || v.status === 'unminted' || v._local;
      const dep = btcDeposit(v);
      const nm = v.name && v.name !== 'Loading...' ? v.name : 'Vault';
      return `<div class="vault-card">
        <div class="vault-h"><span class="acct-lab">${esc(nm)}</span><span class="acct-hint">#${esc(v.tokenId)} · ${esc(v.status || 'unminted')}</span></div>
        ${dep ? `<div class="vault-dep"><span class="k">${esc(dep.coin)} deposit address — send your asset here</span>
          <div class="dep-row"><code class="dep-addr">${esc(dep.address)}</code><button class="mini" data-copy="${esc(dep.address)}">Copy</button></div></div>`
          : (unminted ? '<div class="fine">Deposit address loading… reopen My Vaults in a moment.</div>' : '')}
        <div class="vault-actions">
          ${unminted
            ? `${dep ? `<button class="mini gold" data-send="${esc(v.tokenId)}">Send asset to vault</button>` : ''}<button class="mini" data-mint="${esc(v.tokenId)}">I've deposited · Mint NFT</button>`
            : (v.claimedBy ? '<span class="fine">claimed</span>' : `<button class="mini" data-redeem="${esc(v.tokenId)}">Redeem</button>`)}
        </div></div>`;
    }).join('');
    body.querySelectorAll('[data-copy]').forEach((b) => (b.onclick = (e) => copy(b.dataset.copy, e.target)));
    body.querySelectorAll('[data-redeem]').forEach((b) => (b.onclick = () => redeem(b.dataset.redeem)));
    body.querySelectorAll('[data-mint]').forEach((b) => (b.onclick = () => resumeMint(b.dataset.mint)));
    body.querySelectorAll('[data-send]').forEach((b) => (b.onclick = () => sendToVault(b.dataset.send)));
  }
  // Resume an unminted vault: show the deposit reminder + mint button (after depositing/funding ETH).
  function resumeMint(tokenId) {
    const v = LAST_VAULTS.find((x) => String(x.tokenId) === String(tokenId)) || {};
    const dep = btcDeposit(v);
    modal(`<h3 class="m-title">Mint vault #${esc(tokenId)}</h3>
      ${dep ? `<p class="fine">Deposit address (send your asset here first if you haven't):</p><div class="cp-src">${esc(dep.address)}</div>` : ''}
      <div class="warn" style="margin-top:12px">Minting signs a message and sends an Ethereum transaction paying the mint price + gas. You need ETH in this account.</div>
      <div id="mintStatus" class="statusline" hidden></div>
      <div class="wbtns"><button class="ghost" id="mBack">Back</button><button class="primary" id="mGo">Mint NFT</button></div>`);
    $('#mBack').onclick = () => open(ACCOUNT, ETH, BTC);
    $('#mGo').onclick = () => mint(tokenId);
  }
  // Send an asset from this wallet straight to a vault's deposit address (pre-fills CP Send).
  function sendToVault(tokenId) {
    const v = LAST_VAULTS.find((x) => String(x.tokenId) === String(tokenId)) || {};
    const dep = btcDeposit(v);
    if (!dep) return;
    let addr; try { addr = guardDeposit(tokenId, dep.address); } catch (e) { modal(`<h3 class="m-title">Deposit blocked</h3><div class="warn" style="border-color:#c0392b;color:#e74c3c;margin:8px 0">⚠ ${esc(e.message)}</div><div class="wbtns"><button class="ghost" id="dbX">Close</button></div>`); const b = $('#dbX'); if (b) b.onclick = close; return; }
    const prefill = { destination: addr };
    if (v._asset) prefill.asset = v._asset;
    if (window.CpActions) window.CpActions.quick(ACCOUNT, BTC, 'send', prefill);
  }

  // ── Vault now (wrap) ──
  async function wrapStart() {
    $('#tabWrap')?.classList.add('on'); $('#tabVaults')?.classList.remove('on');
    const body = $('#embBody'); body.innerHTML = '<div class="statusline load">Loading vaultable collections…</div>';
    try {
      let cols = (await fetch('api/emblem/curated').then((r) => r.json())).filter((c) => c.mintable);
      // Vaulting a specific Counterparty/Stamp asset → only collections that deposit on Bitcoin.
      if (ASSET_CTX) { const btcCols = cols.filter((c) => /btc/i.test(c.addressChain)); if (btcCols.length) cols = btcCols; }
      body.innerHTML = `${ASSET_CTX ? `<p class="fine">Vaulting <b>${esc(ASSET_CTX.label || ASSET_CTX.asset)}</b> into an Emblem Vault NFT. Pick a collection, create the vault, then send the asset to its deposit address — all in one flow.</p>` : '<p class="fine">Wrap a Bitcoin / Counterparty / Stamps asset into an Emblem Vault NFT on Ethereum.</p>'}
        ${TWOCHAIN_WARN}
        <label class="cpf"><span>Collection</span><select id="wrapCol" class="m-in">${cols.map((c, i) => `<option value="${i}">${esc(c.name)} · ${esc(c.addressChain)} · ${esc(c.collectionType)}</option>`).join('')}</select></label>
        <div id="wrapStatus" class="statusline" hidden></div>
        <div class="wbtns"><button class="primary" id="wrapCreate">I understand — create vault</button></div>`;
      $('#wrapCreate').onclick = () => createVault(cols[Number($('#wrapCol').value)]);
    } catch (e) { body.innerHTML = `<div class="statusline err">${esc(e.message)}</div>`; }
  }

  async function createVault(col) {
    const s = $('#wrapStatus'); s.hidden = false; s.className = 'statusline load'; s.textContent = 'Creating vault & generating deposit address… (can take ~30s)';
    const chainId = Object.keys(col.contracts)[0] || '1';
    const template = { fromAddress: ETH, toAddress: ETH, chainId: Number(chainId), experimental: true,
      targetContract: { [chainId]: col.contracts[chainId], name: col.name, description: 'Vaulted via Wonder Wallet' },
      targetAsset: { image: col.image || '', name: 'Loading...' } };
    try {
      const v = await fetch('api/emblem/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ template }) }).then((r) => r.json());
      if (v.error) throw new Error(v.detail || v.error);
      // Persist immediately — the deposit address must survive a window close / lack of ETH.
      const dep = btcDeposit(v) || (v.addresses || [])[0];
      if (!dep || !validDepositAddr(dep.address)) throw new Error('Emblem returned an invalid or missing Bitcoin deposit address — not saving this vault. Please try again.');
      savePending(ETH, { tokenId: v.tokenId, coin: dep.coin || 'BTC', address: dep.address, name: col.name, createdAt: Date.now(), asset: ASSET_CTX ? ASSET_CTX.asset : null });
      depositStep(col, v);
    } catch (e) { s.className = 'statusline err'; s.textContent = e.message === 'This operation was aborted' || /create_failed/.test(e.message) ? 'Emblem’s create endpoint is slow/unavailable right now — try again shortly.' : 'Failed: ' + e.message; }
  }

  function depositStep(col, vault) {
    const dep = (vault.addresses || []).find((a) => a.coin === col.addressChain) || btcDeposit(vault) || (vault.addresses || [])[0];
    const body = $('#embBody');
    body.innerHTML = `<h3 class="m-title">Vault #${esc(vault.tokenId)}</h3>
      <div class="vault-saved">✓ Saved under <b>My Vaults</b> — this address won't be lost if you close the window.</div>
      <p class="fine">Send your <b>${esc(ASSET_CTX ? (ASSET_CTX.label || ASSET_CTX.asset) : col.name)}</b> asset to this vault deposit address (${esc(dep?.coin)}):</p>
      <div class="cp-src">${esc(dep?.address || '—')}</div>
      <div class="wbtns" style="margin:8px 0">
        <button class="mini" id="depCopy">Copy address</button>
        ${dep?.address ? `<button class="mini gold" id="depSend">Send ${esc(ASSET_CTX ? 'asset' : 'asset')} to vault →</button>` : ''}
      </div>
      <div class="warn" style="margin-top:6px">After the deposit confirms, mint the vault NFT (signs a message + sends an Ethereum tx paying the mint price + gas). No ETH yet? Come back later via <b>My Vaults</b>.</div>
      <div id="mintStatus" class="statusline" hidden></div>
      <div class="wbtns"><button class="ghost" id="depBack">My Vaults</button><button class="primary" id="depMint">I've deposited · Mint</button></div>`;
    $('#depCopy').onclick = (e) => copy(dep?.address, e.target);
    const ds = $('#depSend'); if (ds) ds.onclick = () => { let addr; try { addr = guardDeposit(vault.tokenId, dep.address); } catch (e) { const st = $('#mintStatus'); if (st) { st.hidden = false; st.className = 'statusline err'; st.textContent = e.message; } return; } const pf = { destination: addr }; if (ASSET_CTX) pf.asset = ASSET_CTX.asset; if (window.CpActions) window.CpActions.quick(ACCOUNT, BTC, 'send', pf); };
    $('#depBack').onclick = myVaults;
    $('#depMint').onclick = () => mint(vault.tokenId);
  }

  async function mint(tokenId) {
    const s = $('#mintStatus'); s.hidden = false; s.className = 'statusline load'; s.textContent = 'Signing & fetching mint authorization…';
    try {
      const signature = C.ethPersonalSign(`Curated Minting: ${tokenId}`, ACCOUNT);
      const built = await fetch('api/emblem/mint', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tokenId, signature, chainId: 1 }) }).then((r) => r.json());
      if (built.error) throw new Error(built.detail || built.error);
      await evmConfirm({ to: built.to, valueWei: built.valueWei, data: built.data, label: 'Mint vault', human: `Vault #${tokenId}`, statusEl: s, expectTo: EMBLEM_MINT, onDone: () => removePending(ETH, tokenId) });
    } catch (e) { s.className = 'statusline err'; s.textContent = 'Failed: ' + (e.message || 'mint error'); }
  }

  // ── Redeem (unvault) ──
  async function redeem(tokenId) {
    modal(`<h3 class="m-title">Redeem vault #${tokenId}</h3>
      <p class="fine">“Crack open” unwraps the vault: an Ethereum unvault transaction, then Emblem's key service releases the underlying asset's keys. This permanently ends the vault's transferability.</p>
      <div class="warn">Unvault sends an on-chain tx (pays the unvault price + gas). The underlying-key retrieval uses Emblem's Torus signer service.</div>
      <div id="redeemStatus" class="statusline" hidden></div>
      <div class="wbtns"><button class="ghost" id="rdBack">Back</button><button class="primary" id="rdGo">Sign & unvault</button></div>`);
    $('#rdBack').onclick = () => open(ACCOUNT, ETH, BTC);
    $('#rdGo').onclick = async () => {
      const s = $('#redeemStatus'); s.hidden = false; s.className = 'statusline load'; s.textContent = 'Signing & fetching unvault authorization…';
      try {
        const signature = C.ethPersonalSign(`Unvault: ${tokenId}`, ACCOUNT);
        const built = await fetch('api/emblem/unvault', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tokenId, signature, chainId: 1 }) }).then((r) => r.json());
        if (built.error) throw new Error(built.detail || built.error);
        await evmConfirm({ to: built.to, valueWei: built.valueWei, data: built.data, label: 'Unvault', human: `Vault #${tokenId}`, statusEl: s, expectTo: EMBLEM_UNVAULT });
      } catch (e) { s.className = 'statusline err'; s.textContent = 'Failed: ' + (e.message || 'unvault error'); }
    };
  }

  // shared EVM confirm+broadcast (prepare → sign → broadcast)
  // Official Emblem contracts (pinned — impersonation scams exist; §11). Verified before signing.
  const EMBLEM_MINT = '0x23859b51117dbFBcdEf5b757028B18d7759a4460';
  const EMBLEM_UNVAULT = '0x214C964bBd3640971E111d3a994CbB89b296a9ad';
  async function evmConfirm({ to, valueWei, data, label, human, statusEl, onDone, expectTo }) {
    // SECURITY: the tx is composed server-side — verify it targets the pinned Emblem contract
    // (not an attacker address) and has sane gas before we sign anything.
    if (expectTo && String(to).toLowerCase() !== expectTo.toLowerCase()) throw new Error('Aborted — transaction target is not the official Emblem contract. The compose response may have been tampered with.');
    statusEl.textContent = 'Preparing Ethereum transaction…';
    const prep = await fetch('api/eth/prepare', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from: ETH, to, valueWei, data, network: (window.WWNet ? window.WWNet.evm() : 'ethereum') }) }).then((r) => r.json());
    if (prep.error) throw new Error(prep.detail || prep.error);
    const gasLim = parseInt(prep.gasLimit, 16), maxFee = BigInt(prep.maxFeePerGas);
    if (!(gasLim > 0) || gasLim > 2000000 || maxFee > 3000000000000n) throw new Error('Aborted — abnormal gas parameters returned by the server.');
    const maxGasEth = Number(BigInt(gasLim) * maxFee) / 1e18;
    const signed = C.sendEvm({ account: ACCOUNT, to, valueWei, data, nonce: prep.nonce, chainId: prep.chainId, maxFeePerGas: prep.maxFeePerGas, maxPriorityFeePerGas: prep.maxPriorityFeePerGas, gasLimit: prep.gasLimit });
    const valEth = Number(BigInt(valueWei)) / 1e18;
    statusEl.className = 'statusline';
    statusEl.innerHTML = `<div class="prev-flow"><div class="pf"><span>${esc(label)}</span><b>${esc(human)}</b></div>
      <div class="pf"><span>Pays</span><b>${valEth.toLocaleString('en-US', { maximumFractionDigits: 8 })} ETH</b></div>
      <div class="pf"><span>Max gas</span><b>${maxGasEth.toLocaleString('en-US', { maximumFractionDigits: 8 })} ETH</b></div>
      <div class="pf"><span>To</span><b class="mono" style="font-size:11px">${esc(to)}</b></div></div>
      <button class="primary" id="embBroadcast">Broadcast</button>`;
    $('#embBroadcast').onclick = async () => {
      statusEl.className = 'statusline load'; statusEl.textContent = 'Broadcasting…';
      try {
        const r = await fetch('api/eth/broadcast', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ raw: signed.raw, network: (window.WWNet ? window.WWNet.evm() : 'ethereum') }) }).then((x) => x.json());
        if (r.error) throw new Error(r.detail || r.error);
        statusEl.className = 'statusline'; statusEl.innerHTML = `Sent ✓ — <a href="https://etherscan.io/tx/${encodeURIComponent(r.txhash)}" target="_blank" rel="noopener" style="color:var(--gold2)">${esc(String(r.txhash).slice(0, 18))}…</a>`;
        // Keep the receipt visible: turn Broadcast into Done (runs onDone on click) — no auto-return.
        const eb = $('#embBroadcast'); if (eb) { eb.textContent = 'Done'; eb.disabled = false; eb.onclick = () => { try { if (onDone) onDone(); } catch (_) {} }; }
      } catch (err) { statusEl.className = 'statusline err'; statusEl.textContent = 'Rejected: ' + (err.message || 'broadcast failed'); }
    };
  }

  // Chained "vault THIS asset" entry: open straight into the wrap flow scoped to an asset.
  function vaultAsset(account, ethAddress, btcAddress, asset, opts) {
    ASSET_CTX = { asset, label: (opts && opts.label) || asset, kind: (opts && opts.kind) || 'cp' };
    open(account, ethAddress, btcAddress, 'wrap');
  }

  window.EmblemBridge = { open, vaultAsset };
})();
