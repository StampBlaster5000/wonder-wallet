/* Wonder Wallet — Phase 8 hardware-wallet UI.
   Lazy-loads the Ledger bundle (wallet-hw.js) only on demand. Connect → derive
   addresses (keys stay on-device) → view balances / receive → sign on device.
   The headline: Wonder Wallet builds CP-aware, asset-safe PSBTs the Ledger signs. */
'use strict';
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let HW = null, ACCTS = null;

  // Lazy-load the heavy hardware bundle once.
  function loadBundle() {
    if (window.WonderHW) return Promise.resolve(window.WonderHW);
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'wallet-hw.js';
      s.onload = () => (window.WonderHW ? resolve(window.WonderHW) : reject(new Error('hardware bundle failed to init')));
      s.onerror = () => reject(new Error('failed to load hardware bundle'));
      document.head.appendChild(s);
    });
  }

  function modal(html) {
    let m = $('#hwmodal');
    if (!m) { m = document.createElement('div'); m.id = 'hwmodal'; m.className = 'modal'; m.innerHTML = '<div class="modal-card" id="hwCard"></div>'; document.body.appendChild(m); m.addEventListener('click', (e) => { if (e.target.id === 'hwmodal') close(); }); }
    $('#hwCard').innerHTML = html; m.hidden = false; return $('#hwCard');
  }
  function close() { const m = $('#hwmodal'); if (m) m.hidden = true; }
  async function copy(t, b) { try { await navigator.clipboard.writeText(t); if (b) { const o = b.textContent; b.textContent = 'copied ✓'; setTimeout(() => (b.textContent = o), 1200); } } catch (_) {} }

  async function connectFlow() {
    const bundleP = loadBundle().catch(() => null); // pre-warm so the Connect click → device picker keeps its user-gesture
    modal(`<h3 class="m-title">Connect a hardware wallet</h3>
      <p class="fine">Keep your keys on a <b>Ledger</b> — Wonder Wallet builds the transactions (including <b>asset-safe, Counterparty-aware PSBTs</b>) and you approve them on the device. Keys never leave the Ledger.</p>
      <p class="fine">Unlock your Ledger and <b>open the Bitcoin app</b> before connecting. To also add Ethereum / Solana, install those apps too — the wallet will switch between them and you approve each on the device.</p>
      <div class="hw-vendors">
        <div class="hw-v"><b>Ledger</b><span>WebHID · BTC · ETH · Solana</span></div>
        <div class="hw-v disabled"><b>Trezor</b><span>via Trezor Connect — coming (no Solana message-signing)</span></div>
      </div>
      <div id="hwStatus" class="statusline" hidden></div>
      <div class="wbtns"><button class="ghost" id="hwx">Cancel</button><button class="primary" id="hwConnect">Connect Ledger</button></div>`);
    $('#hwx').onclick = close;
    // Shared connect runner. `fresh` forces the browser device picker (ignores any stale reused grant) —
    // this is the recovery that reliably works when a silently-reused device is in a bad state.
    async function runConnect(fresh) {
      const s = $('#hwStatus'); s.hidden = false; s.className = 'statusline load'; s.textContent = fresh ? 'Choose your Ledger in the browser prompt…' : 'Loading hardware module…';
      try {
        HW = (await bundleP) || (await loadBundle()); // pre-warmed above; retry if it hadn't finished
        if (!HW.isSupported()) { s.className = 'statusline err'; s.textContent = 'WebHID not available — use a Chromium browser (Chrome/Brave/Edge) over HTTPS, with the Ledger unlocked.'; return; }
        s.textContent = fresh ? 'Choose your Ledger in the browser prompt…' : 'Choose your Ledger in the browser prompt, then approve on the device…';
        if (fresh && HW.forceReconnect) await HW.forceReconnect(); else await HW.connect();
        s.textContent = 'Reading Bitcoin addresses — open/allow apps on the device if it prompts…';
        ACCTS = await HW.getAddresses(0);
        showAccounts();
      } catch (e) {
        s.className = 'statusline err';
        const m = String(e && e.message || '');
        const msg = /No device selected|cancelled|user gesture/i.test(m) ? 'Connection cancelled or no device selected.'
          : /open the .* app|INS_NOT_SUPPORTED|0x6d00|6d00|6511|6e00/i.test(m) ? 'Couldn’t read the Bitcoin app — make sure the Ledger is unlocked with the Bitcoin app open, then use Reconnect below.'
          : /locked|0x5515|5515/i.test(m) ? 'Your Ledger is locked — unlock it and open the Bitcoin app, then use Reconnect below.'
          : ('Couldn’t connect: ' + m);
        // Offer a fresh-picker reconnect: the reliable recovery when a reused grant is stale.
        // Surface the RAW device error (+ console) so a failing attempt is diagnosable from a screenshot.
        try { console.error('[WonderHW] connect failed:', e); } catch (_) {}
        s.innerHTML = `<div>${esc(msg)}</div>`
          + `<div class="fine" style="margin-top:6px;opacity:.7;word-break:break-word">details: ${esc(m || 'unknown').slice(0, 200)}</div>`
          + `<button class="primary" id="hwReconnect" style="margin-top:8px">Reconnect — choose device</button>`;
        const rb = $('#hwReconnect'); if (rb) rb.onclick = () => runConnect(true);
      }
    }
    $('#hwConnect').onclick = () => runConnect(false);
  }

  function showAccounts() {
    const a = ACCTS;
    const row = (label, addr, path) => `<div class="acct"><div class="acct-l"><span class="acct-lab">${label}</span><span class="acct-hint">${esc(path)}</span></div>
      <div class="acct-r"><span class="acct-addr" title="${esc(addr)}">${esc(addr)}</span><button class="mini" data-copy="${esc(addr)}">copy</button></div></div>`;
    modal(`<div class="cc-head"><div><h3 class="m-title" style="margin:0">Ledger connected</h3><div class="cp-addr">account ${a.account} · keys stay on device</div></div><button class="mini" id="hwClose">Close</button></div>
      <div class="acct-list">
        <div class="acct-grp">Bitcoin</div>
        ${row('Native SegWit', a.bitcoin.nativeSegwit.address, a.bitcoin.nativeSegwit.path)}
        ${row('Legacy', a.bitcoin.legacy.address, a.bitcoin.legacy.path)}
        ${a.bitcoin.taproot ? row('Taproot', a.bitcoin.taproot.address, a.bitcoin.taproot.path) : ''}
        ${a.ethereum ? `<div class="acct-grp">Ethereum</div>${row('Ethereum', a.ethereum.address, a.ethereum.path)}` : ''}
        ${a.solana ? `<div class="acct-grp">Solana</div>${row('Solana', a.solana.address, a.solana.path)}` : ''}
      </div>
      ${a.missing && a.missing.length ? `<div class="fine" style="margin-top:8px">Add ${esc(a.missing.join(' & '))} later by installing ${a.missing.length > 1 ? 'those apps' : 'that app'} on your Ledger and reconnecting.</div>` : ''}
      <div class="warn" style="margin-top:12px">When you send or run a Counterparty action from this account, Wonder Wallet builds the asset-safe transaction and you <b>confirm it on your Ledger</b> — the device holds the keys.</div>
      <div class="wbtns"><button class="primary" id="hwView">Open wallet dashboard →</button><button class="ghost" id="hwDisc">Disconnect</button></div>`);
    $('#hwClose').onclick = close;
    $('#hwDisc').onclick = async () => { try { await HW.disconnect(); } catch (_) {} ACCTS = null; connectFlow(); };
    // Open the dedicated Ledger dashboard (balances + assets + receive), which works without a seed
    // vault — the previous build only stashed watch-only entries that a hardware-only user could
    // never reach (no vault → the dashboard never rendered).
    $('#hwView').onclick = () => {
      close();
      if (window.WonderWalletUI && window.WonderWalletUI.showHardware) window.WonderWalletUI.showHardware(a);
      else if (window.WonderWalletUI && window.WonderWalletUI.render) window.WonderWalletUI.render();
    };
    $('#hwCard').querySelectorAll('[data-copy]').forEach((b) => (b.onclick = () => copy(b.dataset.copy, b)));
  }

  async function disconnect() { try { await HW.disconnect(); } catch (_) {} ACCTS = null; }
  window.HardwareWallet = { connectFlow, getAccounts: () => ACCTS, disconnect };
})();
