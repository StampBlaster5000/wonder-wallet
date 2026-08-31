/* Wonder Wallet — Phase 3 wallet UI (onboarding · unlock · accounts · reveal).
   All key ops run in WonderCore (client-side). Server never sees secrets. */
'use strict';
(function () {
  const C = window.WonderCore;
  const $ = (s) => document.querySelector(s);
  // Active network (Testnet Mode) — testnet derives coin-type-1' BTC addresses and hides fiat.
  // Reads either the Terminal (WWNet) or the extension (WWNetMode) API, whichever is present.
  const isTN = () => !!((window.WWNet && window.WWNet.isTestnet()) || (window.WWNetMode && window.WWNetMode.isTestnet()));
  const NET = () => (isTN() ? 'testnet' : 'mainnet');
  // Wallet-wide safety: no numeric field (quantity, amount, fee, price…) may go below its floor.
  // One document-level guard covers every Terminal module (send, CP actions, emblem, minting…).
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (!t || t.tagName !== 'INPUT' || t.type !== 'number' || t.value === '' || t.value === '-') return;
    let floor = (t.getAttribute('min') != null && t.getAttribute('min') !== '') ? parseFloat(t.getAttribute('min')) : 0;
    if (isNaN(floor)) floor = 0;
    const v = parseFloat(t.value);
    if (!isNaN(v) && v < floor) { t.value = floor; t.dispatchEvent(new Event('input', { bubbles: true })); }
  }, true);
  const el = (t, c, h) => { const n = document.createElement(t); if (c) n.className = c; if (h != null) n.innerHTML = h; return n; };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const body = () => $('#walletBody');
  // Appearance skin (dark "Midnight" / light "Parchment") — saved per device. Apply ASAP to avoid a flash.
  try { if (localStorage.getItem('ww:theme') === 'light') document.documentElement.classList.add('theme-light'); } catch (e) {}
  function setThemeT(t) { try { localStorage.setItem('ww:theme', t === 'light' ? 'light' : 'dark'); } catch (e) {} document.documentElement.classList.toggle('theme-light', t === 'light'); }
  function themeMenu() {
    let cur = 'dark'; try { cur = localStorage.getItem('ww:theme') === 'light' ? 'light' : 'dark'; } catch (e) {}
    const opt = (val, name, desc) => `<button class="adv-opt${val === cur ? ' on' : ''}" data-theme="${val}"><b>${esc(name)}${val === cur ? ' ✓' : ''}</b><span>${esc(desc)}</span></button>`;
    modal(`<h3 class="m-title">Appearance</h3><p class="fine">Choose your wallet skin — saved on this device.</p>
      <div class="adv-menu">${opt('dark', 'Midnight', 'The original deep-black gold theme')}${opt('light', 'Parchment', 'A warm, light-toned skin')}</div>
      <div class="wbtns"><button class="ghost" id="thClose">Close</button></div>`);
    $('#thClose').onclick = closeModal;
    $('#wmodalCard').querySelectorAll('[data-theme]').forEach((b) => (b.onclick = () => { setThemeT(b.dataset.theme); themeMenu(); }));
  }
  const STAR = '<svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor" style="vertical-align:-1px"><path d="M12 2l2.9 6.3 6.9.7-5.2 4.6 1.5 6.8L12 17.8 5.9 20.4l1.5-6.8L2.2 9l6.9-.7z"/></svg>';
  const fmt2 = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
  const fmtN = (n, d = 6) => Number(n).toLocaleString('en-US', { maximumFractionDigits: d });
  // Human file size (B / KB / MB), matching the extension's fmtBytes.
  const fmtBytes = (n) => { n = Number(n); if (!isFinite(n) || n <= 0) return '—'; if (n < 1024) return n + ' B'; if (n < 1048576) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB'; return (n / 1048576).toFixed(1) + ' MB'; };
  // Parse a possibly pre-formatted amount ("1,249,078.1518") back to a Number for summing.
  const aggNum = (v) => { const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.eE+-]/g, '')); return isFinite(n) ? n : 0; };
  const shortA = (a) => { a = String(a || ''); return a.length > 16 ? a.slice(0, 7) + '…' + a.slice(-6) : a; };
  // Per-chain dashboard metadata + address resolver.
  // Chain glyphs mirror the extension popup (cs-ic) so the Terminal's blockchain switcher matches it.
  const BTC_IC = '<svg viewBox="0 0 32 32" width="16" height="16" fill="currentColor"><path d="M21 14c1.5-.8 2-2.3 1.6-4-.5-2.2-2.4-3-5-3.2V3h-2.4v3.6h-1.9V3H11v3.8H6.5v2.6h1.7c.9 0 1.2.5 1.2 1v9.2c0 .5-.3.8-.8.8H6.2L6 23H11v3.8h2.4V23h1.9v3.8H17V23c4-.2 6.6-1.2 7-4.7.3-2.2-.8-3.5-2-4.3zM13.4 9.3c1.3 0 4.6-.4 4.6 1.6s-3.3 1.5-4.6 1.5zm0 11v-3.5c1.6 0 5.4-.4 5.4 1.7s-3.8 1.8-5.4 1.8z"/></svg>';
  const ETH_IC = '<svg viewBox="0 0 32 32" width="14" height="14" fill="currentColor"><path d="M16 3l-8 13 8 4.5L24 16 16 3zM8 17.6L16 29l8-11.4-8 4.6-8-4.6z"/></svg>';
  const SOL_IC = '<svg viewBox="0 0 32 32" width="14" height="14" fill="currentColor"><path d="M7 9h17l-4 4H3l4-4zm0 7h17l-4 4H3l4-4zm-4 7h17l4-4H7l-4 4z"/></svg>';
  const GEAR_IC = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
  const LOCK_IC = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
  const DCH = { btc: { name: 'Bitcoin', sym: 'BTC', price: 'bitcoin', ic: BTC_IC }, eth: { name: 'Ethereum', sym: 'ETH', price: 'ethereum', ic: ETH_IC }, sol: { name: 'Solana', sym: 'SOL', price: 'solana', ic: SOL_IC } };
  const chAddr = (acc, ch) => (ch === 'btc' ? acc.bitcoin.nativeSegwit.address : ch === 'eth' ? acc.ethereum.address : acc.solana.address);

  let draft = null; // { mnemonic, words, account }

  // ── Modal ──
  function modal(html) {
    let m = $('#wmodal');
    if (!m) { m = el('div', 'modal'); m.id = 'wmodal'; m.innerHTML = '<div class="modal-card" id="wmodalCard"></div>'; document.body.appendChild(m); m.addEventListener('click', (e) => { if (e.target.id === 'wmodal') closeModal(); }); }
    const card = $('#wmodalCard');
    card.innerHTML = html;
    // Persistent corner ✕ close on every modal (in addition to any Cancel/Back button).
    try {
      if (getComputedStyle(card).position === 'static') card.style.position = 'relative';
      const x = document.createElement('button');
      x.type = 'button'; x.setAttribute('aria-label', 'Close'); x.title = 'Close'; x.textContent = '✕';
      Object.assign(x.style, { position: 'absolute', top: '10px', right: '12px', width: '26px', height: '26px', border: 'none', borderRadius: '7px', background: 'transparent', color: '#8b8597', fontSize: '16px', lineHeight: '1', cursor: 'pointer', zIndex: '3', padding: '0' });
      x.onmouseenter = () => { x.style.background = 'rgba(255,255,255,.08)'; x.style.color = '#ECE8E1'; };
      x.onmouseleave = () => { x.style.background = 'transparent'; x.style.color = '#8b8597'; };
      x.onclick = closeModal;
      card.appendChild(x);
    } catch (_) {}
    m.hidden = false;
    return card;
  }
  // SECURITY (audit §4): clear modal contents on close so revealed seed/keys don't linger in the DOM.
  function closeModal() { const m = $('#wmodal'); if (m) { m.hidden = true; const c = $('#wmodalCard'); if (c) c.innerHTML = ''; } }
  // Persistent post-send footer (no auto-close): swap the confirm modal's button row for a single Done,
  // so the explorer link in the status line stays clickable until the user dismisses. `after` re-renders
  // the home view on Done. Falls back to a long auto-close only if the modal has no button row.
  function sentDone(after) {
    const go = () => { closeModal(); try { if (after) after(); } catch (_) {} };
    const btns = $('#wmodalCard .wbtns');
    if (btns) { btns.innerHTML = '<button class="primary" id="wwDone">Done</button>'; const d = $('#wwDone'); if (d) d.onclick = go; }
    else setTimeout(go, 6000);
  }
  // WW-C05: on auto-lock, synchronously tear down every secret-bearing / in-progress surface so nothing
  // signable or secret survives the advertised lock boundary — the seed/private-key reveal modal (scrub
  // its DOM, which also drops the copy-button closures capturing the key), and every other tool overlay
  // (which may hold a composed/pre-signed transaction). The core already zeroes the session + keys.
  function lockPanic() {
    closeModal(); // #wmodal — clears innerHTML (seed / private keys / copy-button closures)
    ['#cpmodal', '#embmodal', '#mktModal', '#wsModal', '#modal', '#evModal', '#solModal', '#hwmodal'].forEach((sel) => {
      const m = $(sel); if (!m) return; m.hidden = true;
      const card = m.querySelector('.modal-card'); if (card) card.innerHTML = '';
    });
  }

  // ── Account names + address nicknames (local-only labels; not secret) ──
  const ACCT_NAMES = 'ww:acctnames', ADDR_NAMES = 'ww:addrnames';
  const loadMap = (k) => { try { return JSON.parse(localStorage.getItem(k) || '{}'); } catch { return {}; } };
  const saveMap = (k, m) => { try { localStorage.setItem(k, JSON.stringify(m)); } catch (_) {} };
  function namePrompt(title, current, onSave) {
    modal(`<h3 class="m-title">${esc(title)}</h3>
      <input id="npIn" class="m-in" type="text" maxlength="40" value="${esc(current || '')}" placeholder="Name (leave blank to clear)" />
      <div class="wbtns"><button class="ghost" id="npCancel">Cancel</button><button class="primary" id="npSave">Save</button></div>`);
    const inp = $('#npIn'); inp.focus(); inp.select();
    const save = () => { onSave(inp.value.trim().slice(0, 40)); closeModal(); renderUnlocked(); };
    $('#npSave').onclick = save;
    $('#npCancel').onclick = () => { closeModal(); renderUnlocked(); };
    inp.onkeydown = (e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { closeModal(); renderUnlocked(); } };
  }

  async function copy(text, btn, secret) {
    try {
      await navigator.clipboard.writeText(text);
      if (btn) { const o = btn.textContent; btn.textContent = 'copied ✓'; setTimeout(() => (btn.textContent = o), 1200); }
      // Only auto-clear SECRETS (seed / private keys) — and only if the clipboard still holds
      // the copied value, so we never wipe something the user copied afterwards. Public data
      // (addresses, txids) is left alone. 8s window for secrets.
      if (secret) setTimeout(async () => { try { if ((await navigator.clipboard.readText()) === text) await navigator.clipboard.writeText(''); } catch (_) {} }, 8000);
    } catch (_) {}
  }

  // ── Top-level render by state ──
  // The network (Mainnet/Testnet) badge lives INSIDE the wallet window — mounted into the card
  // header only once a wallet is open, and removed on the create/restore/unlock screens so the
  // hero stays clean. Clicking it toggles the network (same control as before, relocated).
  // `open` = a wallet is open (banner belongs inside the card, incl. a connected testnet wallet).
  // `withChip` = the network TOGGLE chip (local-vault only — a connected/Ledger wallet owns its own network).
  function syncNetBadge(open, withChip) {
    if (!window.WWNet) return;
    const card = $('#wallet');
    // The toggle chip mounts into the top row of the open wallet (#wwNetMount, alongside Advanced/Lock);
    // falls back to the card header if that mount isn't present.
    const head = document.getElementById('wwNetMount') || document.querySelector('#wallet .card-h');
    const existing = document.getElementById('wwNetInWallet');
    let bMount = document.getElementById('wwBannerMount');
    // toggle chip
    if (open && withChip && head) {
      if (!existing) {
        const span = document.createElement('span');
        span.id = 'wwNetInWallet';
        span.appendChild(window.WWNet.chip());
        head.appendChild(span);
      }
    } else if (existing) { existing.remove(); }
    // testnet banner mount at the very top of the wallet card (net-mode fills it only when testnet)
    if (open && card) {
      if (!bMount) { bMount = document.createElement('div'); bMount.id = 'wwBannerMount'; card.insertBefore(bMount, card.firstChild); }
    } else if (bMount) { bMount.remove(); }
    window.WWNet.paint();
  }

  async function render() {
    const card = $('#wallet');
    if (!card) return;
    window.__activeAccount = null; // cleared on lock/none; set by renderUnlocked
    window.__connectedWallet = null; // set by renderConnected — the external-wallet session for the tools rail
    window.__hardwareWallet = null; // set by renderHardware — Ledger session (read-only in the Terminal for now)
    // Network toggle is a LOCAL-VAULT feature (our own derivation). A connected UniSat/OKX wallet
    // owns its own network, and Ledger-testnet isn't validated — so hide the badge for those.
    if (acctKind === 'connected' && CONN) { setTopbarTools(true); syncNetBadge(true, false); return renderConnected(); } // external wallet (UniSat/OKX/Wonder) — no vault
    if (acctKind === 'hardware') { if (HW) { setTopbarTools(true); syncNetBadge(true, false); return renderHardware(); } acctKind = 'hd'; } // Ledger dashboard — rail shows (read-only state), tools await on-device signing
    tryResumeSession(); // restore a persisted session (opt-in) so a page refresh doesn't force a re-login
    let state = 'none';
    try { if (C.isUnlocked()) state = 'unlocked'; else if (await C.hasVault()) state = 'locked'; } catch (_) {}
    setTopbarTools(state === 'unlocked'); // dApps / Backup / privacy only make sense once a wallet is open — hide on the create/restore/unlock screens
    if (state === 'unlocked') { refreshImported(); if (acctKind === 'imported' && !currentImported()) acctKind = 'hd'; return renderUnlocked(); }
    if (state === 'locked') return renderLocked();
    // No local vault → restore a connected-wallet session across a page refresh (web Terminal only).
    // Silent (no prompt); only after confirming there's no local wallet, so a seed vault always wins.
    if (!CONN && window.WalletConnect && WalletConnect.lastConnected && WalletConnect.lastConnected()) {
      const restored = await tryReconnect();
      if (restored) { CONN = restored; acctKind = 'connected'; watchId = null; setTopbarTools(true); return renderConnected(); }
      // else keep the ww:connected flag so a locked/uninjected wallet auto-reconnects once it's ready + refreshed.
    }
    return renderNone();
  }

  function renderNone() {
    syncNetBadge(false, false); // clean hero — nothing until a wallet is open
    // "Connect an existing wallet" is a WEB-TERMINAL feature (needs wallet-connect.js, which detects
    // injected UniSat/OKX/Wonder providers). The extension IS the wallet, doesn't bundle wallet-connect.js,
    // so the button + hint only appear when WalletConnect is present.
    const canConnect = !!window.WalletConnect;
    body().innerHTML = `
      <p class="fine">Create a new self-custodial wallet, or restore one from a seed phrase. Keys are generated and encrypted <b>in your browser</b> — they never reach the server.</p>
      <div class="wbtns">
        <button id="bCreate" class="primary">Create wallet</button>
        <button id="bRestore" class="ghost">Restore from seed</button>
        <button id="bHardware" class="ghost">Connect hardware wallet</button>
        ${canConnect ? '<button id="bConnect" class="ghost">Connect an existing wallet</button>' : ''}
      </div>
      ${canConnect ? '<p class="fine" style="margin-top:8px">Already have UniSat, OKX, or the Wonder Wallet extension? <b>Connect an existing wallet</b> to use the Terminal with your keys.</p>' : ''}`;
    $('#bCreate').onclick = flowCreate;
    $('#bRestore').onclick = flowRestore;
    $('#bHardware').onclick = () => window.HardwareWallet && window.HardwareWallet.connectFlow();
    if (canConnect) $('#bConnect').onclick = connectWalletPicker;
    // Deep-link from the extension popup: #hardware auto-opens the Ledger connect flow (WebHID needs
    // this persistent full window). #restore jumps straight to the restore form.
    try {
      if (/hardware/i.test(location.hash)) { history.replaceState(null, '', location.pathname); setTimeout(() => window.HardwareWallet && window.HardwareWallet.connectFlow(), 60); }
      else if (/restore/i.test(location.hash)) { history.replaceState(null, '', location.pathname); setTimeout(flowRestore, 40); }
    } catch (_) {}
  }

  // Silent reconnect on page load: the injected provider may not be present on first paint (extensions
  // inject async), so poll detect() briefly until the saved wallet appears, then reconnect once (no prompt).
  async function tryReconnect() {
    const WC = window.WalletConnect;
    if (!(WC && WC.reconnect && WC.lastConnected)) return null;
    const id = WC.lastConnected(); if (!id) return null;
    for (let i = 0; i < 8; i++) {
      const installed = (WC.detect() || []).some((w) => w.id === id);
      if (installed) { try { return await WC.reconnect(id); } catch (_) { return null; } }
      await new Promise((r) => setTimeout(r, 150)); // provider not injected yet — wait (~1.2s max)
    }
    return null; // wallet never appeared (uninstalled/disabled)
  }

  // ── Connect an existing wallet (UniSat / OKX / Wonder Wallet) via wallet-connect.js ──
  function connectWalletPicker() {
    const found = (window.WalletConnect ? WalletConnect.detect() : []);
    const rows = found.length
      ? found.map((w) => `<button class="wc-opt ghost" data-id="${esc(w.id)}" style="display:flex;justify-content:space-between;align-items:center;width:100%;margin:6px 0"><b>${esc(w.name)}</b><span class="fine">Connect →</span></button>`).join('')
      : `<p class="fine">No supported wallet detected in this browser. Install <a href="https://horizonwallet.net" target="_blank" rel="noopener">Horizon</a>, <a href="https://github.com/XCP/extension" target="_blank" rel="noopener">XCP&nbsp;Wallet</a>, <a href="https://unisat.io" target="_blank" rel="noopener">UniSat</a>, <a href="https://www.okx.com/web3" target="_blank" rel="noopener">OKX</a>, or the Wonder Wallet extension, then reload.</p>`;
    const c = modal(`<h3 class="m-title">Connect a wallet</h3><p class="fine">Use an existing browser wallet to access your assets on the Terminal — read balances and sign transactions with your own keys.</p><div class="wc-list">${rows}</div><div class="wbtns"><button class="ghost" id="wcCancel">Cancel</button></div>`);
    c.querySelector('#wcCancel').onclick = closeModal;
    c.querySelectorAll('[data-id]').forEach((b) => (b.onclick = async () => {
      const id = b.dataset.id; c.querySelectorAll('[data-id]').forEach((x) => (x.disabled = true)); b.querySelector('.fine').textContent = 'Connecting…';
      try { CONN = await WalletConnect.connect(id); acctKind = 'connected'; watchId = null; closeModal(); render(); }
      catch (e) { c.querySelectorAll('[data-id]').forEach((x) => (x.disabled = false)); b.querySelector('.fine').textContent = 'Failed — ' + (/rejected|4001/i.test(e.message || '') ? 'you declined' : (e.message || 'error')); }
    }));
  }
  // Connected external wallet — reuse the SAME dashboard shell + loaders as the seed/hardware views, so it
  // matches the web wallet exactly (portfolio card, Tokens/Collectibles tabs, styled rows, stamp grid).
  // activeAddr() returns CONN.address for acctKind 'connected', so loadPortfolio/loadDashAssets just work.
  async function renderConnected() {
    const addr = CONN.address; dashChain = 'btc';
    window.__connectedWallet = CONN; // expose to the tools rail (dapps.js) so it reflects the connection
    // Mirror the connected wallet's network: a Wonder extension in Testnet Mode grants a testnet
    // address (tb1…/m/n/2…) — scope the Terminal to testnet so reads hit testnet4 and the banner shows.
    // (Toggling here fires onChange→render, but the guard prevents a loop once already in sync.)
    if (window.WWNet && addr) {
      const tnAddr = /^(tb1|[mn2])/.test(String(addr));
      if (tnAddr && !window.WWNet.isTestnet()) return window.WWNet.set('testnet');
      if (!tnAddr && window.WWNet.isTestnet()) return window.WWNet.set('mainnet');
    }
    body().innerHTML = `
      <div class="wallet-topbar">
        <div class="wt-left"><button class="chain-btn static" disabled title="Bitcoin · ${esc(CONN.name)}"><span class="cs-ic btc">${BTC_IC}</span></button></div>
        <div class="wt-center"><span class="net-mount" id="wwNetMount"></span></div>
        <div class="wt-right"><button class="ghost sm" id="connDisc" title="Disconnect this wallet">Disconnect</button></div>
      </div>
      <div class="dash-head">
        <div class="dash-head-l"><div class="acct-sel"><div class="hw-acct">🔌 ${esc(CONN.name)} · connected</div></div></div>
        <button class="pname-chip" id="pnameChip" hidden title="Your primary Bitcoin Stamps name"></button>
      </div>
      <div class="bal-strip" id="pfStrip">
        <div class="bal-main">
          <div class="bal-top"><span class="bal-usd" id="pfUsd-btc">…</span>${walletToolsHtml()}</div>
          <span class="bal-nat" id="pfNat-btc">—</span>
        </div>
        <div class="bal-actions" id="balActions"></div>
      </div>
      <div class="dash-actions wbtns" id="dashActions"></div>
      <div class="dash-tabs">
        <div class="dash-assettabs"><button class="datab${dashTab === 'tokens' ? ' on' : ''}" data-tab="tokens">Tokens</button><button class="datab${dashTab === 'collectibles' ? ' on' : ''}" data-tab="collectibles">Collectibles</button></div>
      </div>
      <div class="addr-row" style="margin:2px 0 8px"><span class="addr-chip" data-copy="${esc(addr)}" title="Copy address">${esc(shortA(addr))}</span></div>
      <div id="dashAssets" class="dash-assets"><div class="fine">Loading Bitcoin assets…</div></div>
      <div class="wallet-foot" id="walletFoot">
        <span class="wf-sec"><span class="wf-dot"></span>🔌 keys never leave ${esc(CONN.name)}</span>
        <span class="wf-ver" id="wfVer"></span>
      </div>`;
    $('#connDisc').onclick = () => { try { CONN && CONN.disconnect(); } catch (_) {} try { WalletConnect.forget(); } catch (_) {} CONN = null; acctKind = 'hd'; render(); };
    wireWalletTools();
    syncNetBadge(true, true); // mount the Mainnet/Testnet chip + testnet banner (connected mirrors its wallet's network)
    const vf = $('#wfVer'); if (vf) vf.textContent = (document.getElementById('verTag') || {}).textContent || '';
    body().querySelectorAll('[data-copy]').forEach((el) => (el.onclick = () => copy(el.dataset.copy, el)));
    body().querySelectorAll('.datab').forEach((b) => (b.onclick = () => { dashTab = b.dataset.tab; body().querySelectorAll('.datab').forEach((x) => x.classList.toggle('on', x === b)); renderDashAssets(null); }));
    // Same layout as the main wallet: Send/Receive inside the balance module; the below-balance row is just
    // ☰ Tools + Activity (Counterparty / Market / Issuance live in the Tools side panel; Coin Control inside Activity).
    renderBalanceActions(null);
    renderDashActions(null);
    loadPortfolio(null); loadDashAssets(null);
  }
  function connBtcType(a) { if (/^bc1p/i.test(a)) return 'taproot'; if (/^bc1q/i.test(a)) return 'nativeSegwit'; if (/^3/.test(a)) return 'nestedSegwit'; if (/^1/.test(a)) return 'legacy'; return 'nativeSegwit'; }
  function b64ToHex(b64) { const bin = atob(b64); let h = ''; for (let i = 0; i < bin.length; i++) h += (bin.charCodeAt(i) & 0xff).toString(16).padStart(2, '0'); return h; }
  function hexToB64(h) { h = String(h).replace(/^0x/, ''); let bin = ''; for (let i = 0; i < h.length; i += 2) bin += String.fromCharCode(parseInt(h.substr(i, 2), 16)); return btoa(bin); }
  // Connected-wallet BTC send: WonderCore composes an UNSIGNED PSBT from the connected pubkey (asset-safe
  // UTXO selection via coincontrol), the connected wallet signs + broadcasts. Keys never touch us.
  async function renderConnectedSend() {
    const from = CONN.address, type = connBtcType(from);
    let fees = { fastestFee: 10, halfHourFee: 6, hourFee: 3, economyFee: 2 };
    try { fees = await fetch('api/btc/fees').then((r) => r.json()); } catch (_) {}
    fees = window.WWFee ? window.WWFee.stagger(fees, ['fastestFee', 'halfHourFee', 'hourFee', 'economyFee']) : fees; // strictly descending presets (no ties)
    let feeRate = fees.halfHourFee || 6;
    // Fetch the spendable UTXO set + BTC price ONCE up front — powers the available balance, Max, and USD.
    let spendable = [], spendableSats = 0, btcUsd = 0;
    try { const cc = await fetch(`api/btc/${from}/coincontrol`).then((r) => r.json()); spendable = (cc.utxos || []).filter((u) => u.category === 'spendable' && !u.frozen && !u.timelocked).map((u) => ({ txid: u.txid, vout: u.vout, value: u.value })); spendableSats = spendable.reduce((a, u) => a + u.value, 0); } catch (_) {}
    try { if (!isTN()) btcUsd = (await fetch('api/prices').then((r) => r.json())).bitcoin || 0; } catch (_) {}
    const usd = (sats) => { const u = (Number(sats) / 1e8) * btcUsd; return u ? ' ≈ $' + u.toLocaleString('en-US', { maximumFractionDigits: 2 }) : ''; };
    const availBtc = (spendableSats / 1e8).toLocaleString('en-US', { maximumFractionDigits: 8 });
    const c = modal(`<h3 class="m-title">Send Bitcoin · ${esc(CONN.name)}</h3>
      <div class="send-from">${esc(from)}</div>
      <div class="fine" style="margin:6px 0"><b>Available:</b> ${availBtc} BTC${usd(spendableSats)} <span style="opacity:.7">· spendable</span></div>
      <div class="fine">Only spendable UTXOs are used — asset-bearing / frozen outputs are never spent. You approve the signature in ${esc(CONN.name)}.</div>
      <input id="cTo" class="m-in" placeholder="Recipient address (bc1q… / bc1p… / 1… / 3…)" spellcheck="false" autocapitalize="off" />
      <div class="send-amt"><input id="cAmt" class="m-in" type="number" step="0.00000001" min="0" placeholder="Amount (BTC)" /><label class="send-max"><input type="checkbox" id="cMax" /> Max</label></div>
      <div id="cAmtUsd" class="fine" style="min-height:16px"></div>
      <div class="fee-row" id="cFeeRow">${[['fastestFee', 'Fast'], ['halfHourFee', '30m'], ['hourFee', '1h'], ['economyFee', 'Econ']].map(([k, l], i) => `<button class="feeopt ${i === 1 ? 'on' : ''}" data-r="${fees[k] || 5}">${l} · ${fees[k] || '–'}</button>`).join('')}<input id="cFee" class="m-in fee-custom" type="number" min="0.1" step="0.1" placeholder="custom s/vB" /></div>
      <div id="cStatus" class="statusline" hidden></div>
      <div class="wbtns"><button class="ghost" id="mc">Cancel</button><button class="primary" id="cReview">Review</button></div>`);
    c.querySelector('#mc').onclick = closeModal;
    const amtUsd = () => { const el = $('#cAmtUsd'); if (!el) return; const v = parseFloat($('#cAmt').value); el.textContent = (v > 0 && btcUsd) ? '≈ $' + (v * btcUsd).toLocaleString('en-US', { maximumFractionDigits: 2 }) : ''; };
    $('#cAmt').oninput = amtUsd;
    $('#cMax').onchange = () => { const on = $('#cMax').checked; const a = $('#cAmt'); a.disabled = on; if (on) a.value = (spendableSats / 1e8).toFixed(8); amtUsd(); };
    c.querySelectorAll('.feeopt').forEach((b) => (b.onclick = () => { c.querySelectorAll('.feeopt').forEach((x) => x.classList.remove('on')); b.classList.add('on'); feeRate = Number(b.dataset.r); $('#cFee').value = ''; }));
    $('#cFee').oninput = (e) => { if (e.target.value !== '') { const r = Number(e.target.value); if (r > 0) { feeRate = r; c.querySelectorAll('.feeopt').forEach((x) => x.classList.remove('on')); } } };
    if (window.WonderBook) WonderBook.attach($('#cTo'), 'btc');
    $('#cReview').onclick = async () => {
      const s = $('#cStatus'); s.hidden = false; s.className = 'statusline load'; s.textContent = 'Composing…';
      try {
        const RE_ADDR = /^(bc1[a-z0-9]{8,87}|[13][a-km-zA-HJ-NP-Z1-9]{25,39})$/;
        const to = $('#cTo').value.trim();
        if (!RE_ADDR.test(to)) throw new Error('Enter a valid Bitcoin address.');
        const sendMax = $('#cMax').checked;
        const amountSats = sendMax ? 0 : Math.round(parseFloat($('#cAmt').value) * 1e8);
        if (!sendMax && !(amountSats > 0)) throw new Error('Enter a valid amount.');
        if (!spendable.length) throw new Error('No spendable UTXOs on this address.');
        const prevTxs = type === 'legacy' ? await fetchPrevTxs(type, spendable.map((u) => u.txid), s) : {};
        const pk = CONN.publicKey || await CONN.getPublicKey();
        if (!pk) throw new Error('Could not read your public key from ' + CONN.name + '.');
        const tx = C.buildUnsignedSend({ pubkey: pk, type, utxos: spendable, recipient: to, amountSats, feeRate, sendMax, prevTxs });
        connSendPreview(tx, to, btcUsd, feeRate);
      } catch (err) { s.className = 'statusline err'; s.textContent = err.message === 'insufficient_funds' ? 'Insufficient spendable balance for that amount + fee.' : (err.message || 'Could not build transaction.'); }
    };
  }
  function connSendPreview(tx, to, btcUsd, feeRate) {
    const btc = (n) => (n / 1e8).toLocaleString('en-US', { maximumFractionDigits: 8 });
    const usd = (sats) => { const u = (Number(sats) / 1e8) * (btcUsd || 0); return u ? ' ≈ $' + u.toLocaleString('en-US', { maximumFractionDigits: 2 }) : ''; };
    const rate = tx.vsize ? (tx.fee / tx.vsize).toFixed(1) : String(feeRate || '');
    const c = modal(`<h3 class="m-title">Confirm send</h3>
      <div class="m-rows">
        <div class="m-row"><span class="k">Send</span><span class="v">${btc(tx.amountSats)} BTC<span class="fine">${usd(tx.amountSats)}</span></span></div>
        <div class="m-row" style="flex-direction:column;align-items:flex-start;gap:3px"><span class="k">To</span><span class="v vmono" data-copy="${esc(to)}" title="Copy address" style="white-space:nowrap;overflow-x:auto;max-width:100%;font-size:11px;cursor:pointer">${esc(to)}</span></div>
        <div class="m-row"><span class="k">Network fee</span><span class="v">${tx.fee.toLocaleString('en-US')} sats${usd(tx.fee)}</span></div>
        <div class="m-row"><span class="k">Fee rate</span><span class="v">≈ ${rate} sat/vB${tx.vsize ? ' · ' + tx.vsize + ' vB' : ''}</span></div>
        <div class="m-row"><span class="k">Total (amount + fee)</span><span class="v">${btc(tx.amountSats + tx.fee)} BTC${usd(tx.amountSats + tx.fee)}</span></div>
        ${tx.change != null && tx.change > 0 ? `<div class="m-row"><span class="k">Change back</span><span class="v">${btc(tx.change)} BTC</span></div>` : ''}
        <div class="m-row"><span class="k">Inputs</span><span class="v">${(tx.inputs || []).length} UTXO${(tx.inputs || []).length === 1 ? '' : 's'}</span></div>
      </div>
      <div class="fine" style="margin-top:8px">Wonder Wallet composed this; ${esc(CONN.name)} will sign &amp; broadcast. Verify the details in ${esc(CONN.name)} too.</div>
      <div id="cbStatus" class="statusline" hidden></div>
      <div class="wbtns"><button class="ghost" id="cbBack">Back</button><button class="primary" id="cbSend">Sign in ${esc(CONN.name)}</button></div>`);
    c.querySelectorAll('[data-copy]').forEach((el) => (el.onclick = () => copy(el.dataset.copy, el)));
    c.querySelector('#cbBack').onclick = () => renderConnectedSend();
    c.querySelector('#cbSend').onclick = () => connSubmit($('#cbStatus'), tx.psbt, { from: CONN.address, dests: [to], allowed: [to], checkInputs: false });
  }
  // Shared: hand a composed PSBT (hex OR base64) to the connected wallet to sign + broadcast, show the txid.
  async function connSubmit(s, psbt, intent) {
    s.hidden = false; s.className = 'statusline load';
    // WW-B01: verify the COMPOSED tx matches the displayed intent BEFORE handing it to the external
    // signer. The connected wallet's generic prompt is not Counterparty/protocol-aware, so a compromised
    // composer could return a PSBT whose outputs/recipient/SIGHASH differ from what we showed. Fail closed
    // — Wonder never hands off a tx it can't prove matches intent. (Input coin-control is the external
    // wallet's responsibility here, so intent.checkInputs is false for connected flows.)
    if (intent && window.WonderVerify) {
      s.textContent = 'Verifying…';
      try { await window.WonderVerify.verify({ psbt, data: intent.data }, intent); }
      catch (e) { s.className = 'statusline err'; s.textContent = 'Blocked: ' + (e && e.message ? e.message : 'the composed transaction did not match what you approved'); return; }
    }
    s.textContent = 'Waiting for approval in ' + CONN.name + '…';
    try {
      const psbtHex = /^[0-9a-fA-F]+$/.test(psbt) ? psbt : b64ToHex(psbt);
      const signed = await CONN.signPsbt(psbtHex, { autoFinalized: true });
      s.textContent = 'Broadcasting…';
      let id;
      if (signed && typeof signed === 'object' && signed.txhex) {
        // Wonder Wallet's signPsbt(autoFinalized) returns the FINALIZED raw tx {txhex,txid}. Broadcast the
        // raw tx via our server — no second wallet prompt (avoids the clunky extra "Broadcast" approval).
        const r = await fetch('api/btc/broadcast', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ txhex: signed.txhex }) }).then((x) => x.json());
        if (r.error) throw new Error(r.detail || r.error);
        id = r.txid || signed.txid;
      } else {
        // UniSat / OKX return a signed PSBT hex → let the wallet finalize + broadcast (its own one prompt).
        const signedStr = typeof signed === 'string' ? signed : (signed && (signed.psbt || signed.hex)) || psbtHex;
        const pushed = await CONN.pushPsbt(signedStr);
        id = typeof pushed === 'string' ? pushed : (pushed && (pushed.txid || pushed.result)) || String(pushed);
      }
      s.className = 'statusline'; s.innerHTML = `Sent ✓ — <a href="https://mempool.space/tx/${encodeURIComponent(id)}" target="_blank" rel="noopener" style="color:var(--gold2)">${esc(String(id).slice(0, 18))}…</a>`;
      sentDone(() => { DASH_ASSETS = null; renderConnected(); });
    } catch (err) { const m = err && err.message ? err.message : String(err); s.className = 'statusline err'; s.textContent = 'Failed: ' + (/reject|cancel|4001|denied/i.test(m) ? 'you declined in ' + CONN.name : m); }
  }
  // Cached BTC price for connected-wallet confirm screens (USD on network fees).
  let _connBtcUsd = 0;
  async function connPrice() { if (isTN()) return 0; if (!_connBtcUsd) { try { _connBtcUsd = (await fetch('api/prices').then((r) => r.json())).bitcoin || 0; } catch (_) {} } return _connBtcUsd; }
  const usdSats = (sats) => { const u = (Number(sats) / 1e8) * _connBtcUsd; return u ? ` <span class="fine">≈ $${u.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>` : ''; };
  // Connected-wallet SRC-20 transfer: compose via stampchain (op:transfer) → connected wallet signs + broadcasts.
  async function renderConnectedSrc20Send(tick, avail) {
    const from = CONN.address;
    let fees = { fastestFee: 10, halfHourFee: 6, hourFee: 3, economyFee: 2 };
    try { fees = await fetch('api/btc/fees').then((r) => r.json()); } catch (_) {}
    try { await connPrice(); } catch (_) {}
    fees = window.WWFee ? window.WWFee.stagger(fees, ['fastestFee', 'halfHourFee', 'hourFee', 'economyFee']) : fees; // strictly descending presets (no ties)
    let feeRate = fees.halfHourFee || 6;
    const c = modal(`<h3 class="m-title">Send ${esc(tick)} · ${esc(CONN.name)}</h3>
      <div class="fine">SRC-20 transfer · from <span class="vmono">${esc(from.slice(0, 14))}…</span></div>
      <div class="fine" style="margin:6px 0"><b>You hold:</b> ${esc(String(avail))} ${esc(tick)}</div>
      <input id="tTo" class="m-in" placeholder="Recipient address (bc1q… / 1… )" spellcheck="false" autocapitalize="off" />
      <input id="tAmt" class="m-in" type="number" step="any" min="0" placeholder="Amount of ${esc(tick)}" />
      <div class="fee-row" id="tFeeRow">${[['fastestFee', 'Fast'], ['halfHourFee', '30m'], ['hourFee', '1h'], ['economyFee', 'Econ']].map(([k, l], i) => `<button class="feeopt ${i === 1 ? 'on' : ''}" data-r="${fees[k] || 5}">${l} · ${fees[k] || '–'}</button>`).join('')}<input id="tFee" class="m-in fee-custom" type="number" min="0.1" step="0.1" placeholder="custom s/vB" /></div>
      <div id="tStatus" class="statusline" hidden></div>
      <div class="wbtns"><button class="ghost" id="mc">Cancel</button><button class="primary" id="tReview">Review</button></div>`);
    c.querySelector('#mc').onclick = closeModal;
    c.querySelectorAll('.feeopt').forEach((b) => (b.onclick = () => { c.querySelectorAll('.feeopt').forEach((x) => x.classList.remove('on')); b.classList.add('on'); feeRate = Number(b.dataset.r); $('#tFee').value = ''; }));
    $('#tFee').oninput = (e) => { if (e.target.value !== '') { const r = Number(e.target.value); if (r > 0) { feeRate = r; c.querySelectorAll('.feeopt').forEach((x) => x.classList.remove('on')); } } };
    if (window.WonderBook) WonderBook.attach($('#tTo'), 'btc');
    $('#tReview').onclick = async () => {
      const s = $('#tStatus'); s.hidden = false; s.className = 'statusline load'; s.textContent = 'Composing via stampchain…';
      try {
        const RE_ADDR = /^(bc1[a-z0-9]{8,87}|[13][a-km-zA-HJ-NP-Z1-9]{25,39})$/;
        const to = $('#tTo').value.trim();
        if (!RE_ADDR.test(to)) throw new Error('Enter a valid Bitcoin address.');
        const amt = parseFloat($('#tAmt').value);
        if (!(amt > 0)) throw new Error('Enter an amount greater than 0.');
        const av = parseFloat(String(avail).replace(/,/g, '')); if (av && amt > av) throw new Error('You only hold ' + avail + ' ' + tick + '.');
        const params = { op: 'transfer', tick, satsPerVB: feeRate, amt: String(amt), toAddress: to };
        const r = await fetch('api/stamps/src20/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: from, params }) }).then((x) => x.json());
        if (r.error) throw new Error(r.detail || r.error);
        connSrc20Preview(r, tick, amt, to, avail);
      } catch (err) { s.className = 'statusline err'; s.textContent = /No spendable|compose_failed/i.test(err.message) ? 'Insufficient BTC on this address to compose the transfer.' : (err.message || 'Could not compose transfer.'); }
    };
  }
  function connSrc20Preview(r, tick, amt, to, avail) {
    const c = modal(`<h3 class="m-title">Confirm SRC-20 transfer</h3>
      <div class="m-rows">
        <div class="m-row"><span class="k">Send</span><span class="v">${esc(String(amt))} ${esc(tick)}</span></div>
        <div class="m-row" style="flex-direction:column;align-items:flex-start;gap:3px"><span class="k">To</span><span class="v vmono" data-copy="${esc(to)}" title="Copy address" style="white-space:nowrap;overflow-x:auto;max-width:100%;font-size:11px;cursor:pointer">${esc(to)}</span></div>
        <div class="m-row"><span class="k">Network fee</span><span class="v">${Number(r.fee).toLocaleString('en-US')} sats${r.vsize ? ' · ' + r.vsize + ' vB' : ''}${usdSats(r.fee)}</span></div>
      </div>
      <div class="fine" style="margin-top:8px">Permanent on-chain SRC-20 transfer. ${esc(CONN.name)} will sign &amp; broadcast — verify the details there too.</div>
      <div id="tbStatus" class="statusline" hidden></div>
      <div class="wbtns"><button class="ghost" id="tbBack">Back</button><button class="primary" id="tbSend">Sign in ${esc(CONN.name)}</button></div>`);
    c.querySelectorAll('[data-copy]').forEach((el) => (el.onclick = () => copy(el.dataset.copy, el)));
    c.querySelector('#tbBack').onclick = () => renderConnectedSrc20Send(tick, avail);
    // WW-B01: verify the composed SRC-20 transfer against intent (outputs only go to source/recipient,
    // recipient baked in, SIGHASH_ALL, fee sane) BEFORE the connected wallet signs. Inputs are the
    // external wallet's responsibility on connected flows, so checkInputs stays false — matching the
    // BTC (line ~360) and Counterparty (line ~506) connected paths.
    c.querySelector('#tbSend').onclick = () => connSubmit($('#tbStatus'), r.hex, { from: CONN.address, dests: [to], allowed: [to], checkInputs: false });
  }
  // Connected-wallet Counterparty asset send: compose via CP Core (server) → connected wallet signs + broadcasts.
  async function renderConnectedCpSend(t) {
    const from = CONN.address, asset = t.asset;
    let info = {}; try { info = await fetch('api/cp/asset/' + encodeURIComponent(asset)).then((r) => r.json()); } catch (_) {}
    const divisible = info.divisible != null ? !!info.divisible : !!t.divisible;
    let fees = { fastestFee: 10, halfHourFee: 6, hourFee: 3, economyFee: 2 };
    try { fees = await fetch('api/btc/fees').then((r) => r.json()); } catch (_) {}
    try { await connPrice(); } catch (_) {}
    fees = window.WWFee ? window.WWFee.stagger(fees, ['fastestFee', 'halfHourFee', 'hourFee', 'economyFee']) : fees; // strictly descending presets (no ties)
    let feeRate = fees.halfHourFee || 6;
    const c = modal(`<h3 class="m-title">Send ${esc(t.name)} · ${esc(CONN.name)}</h3>
      <div class="fine">Counterparty · from <span class="vmono">${esc(from.slice(0, 14))}…</span></div>
      <div class="fine" style="margin:6px 0"><b>You hold:</b> ${esc(String(t.amount))} ${esc(t.name)}${divisible ? '' : ' · indivisible'}</div>
      <input id="pTo" class="m-in" placeholder="Recipient address (bc1q… / 1… )" spellcheck="false" autocapitalize="off" />
      <input id="pAmt" class="m-in" type="number" step="${divisible ? 'any' : '1'}" min="0" placeholder="Quantity of ${esc(t.name)}" />
      <input id="pMemo" class="m-in" placeholder="Memo (optional)" maxlength="34" />
      <div class="fee-row" id="pFeeRow">${[['fastestFee', 'Fast'], ['halfHourFee', '30m'], ['hourFee', '1h'], ['economyFee', 'Econ']].map(([k, l], i) => `<button class="feeopt ${i === 1 ? 'on' : ''}" data-r="${fees[k] || 5}">${l} · ${fees[k] || '–'}</button>`).join('')}<input id="pFee" class="m-in fee-custom" type="number" min="0.1" step="0.1" placeholder="custom s/vB" /></div>
      <div id="pStatus" class="statusline" hidden></div>
      <div class="wbtns"><button class="ghost" id="mc">Cancel</button><button class="primary" id="pReview">Review</button></div>`);
    c.querySelector('#mc').onclick = closeModal;
    c.querySelectorAll('.feeopt').forEach((b) => (b.onclick = () => { c.querySelectorAll('.feeopt').forEach((x) => x.classList.remove('on')); b.classList.add('on'); feeRate = Number(b.dataset.r); $('#pFee').value = ''; }));
    $('#pFee').oninput = (e) => { if (e.target.value !== '') { const r = Number(e.target.value); if (r > 0) { feeRate = r; c.querySelectorAll('.feeopt').forEach((x) => x.classList.remove('on')); } } };
    if (window.WonderBook) WonderBook.attach($('#pTo'), 'btc');
    $('#pReview').onclick = async () => {
      const s = $('#pStatus'); s.hidden = false; s.className = 'statusline load'; s.textContent = 'Composing via Counterparty…';
      try {
        const RE_ADDR = /^(bc1[a-z0-9]{8,87}|[13][a-km-zA-HJ-NP-Z1-9]{25,39})$/;
        const to = $('#pTo').value.trim();
        if (!RE_ADDR.test(to)) throw new Error('Enter a valid Bitcoin address.');
        const amt = parseFloat($('#pAmt').value);
        if (!(amt > 0)) throw new Error('Enter a quantity greater than 0.');
        const av = parseFloat(String(t.amount).replace(/,/g, '')); if (av && amt > av) throw new Error('You only hold ' + t.amount + ' ' + t.name + '.');
        const quantity = divisible ? Math.round(amt * 1e8) : Math.round(amt);
        const memo = $('#pMemo').value.trim();
        const params = { destination: to, asset, quantity, sat_per_vbyte: feeRate };
        if (memo) params.memo = memo;
        const composed = await fetch('api/cp/compose/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: from, params }) }).then((r) => r.json());
        if (composed.error) throw new Error(composed.detail || composed.error);
        connCpPreview(composed, t, amt, to);
      } catch (err) { s.className = 'statusline err'; s.textContent = /insufficient/i.test(err.message || '') ? 'Insufficient balance (asset, or BTC for fees) on this address.' : (err.message || 'Compose failed.'); }
    };
  }
  function connCpPreview(cx, t, amt, to) {
    const c = modal(`<h3 class="m-title">Confirm · Send ${esc(t.name)}</h3>
      <div class="m-rows">
        <div class="m-row"><span class="k">Send</span><span class="v">${esc(String(amt))} ${esc(t.name)}</span></div>
        <div class="m-row" style="flex-direction:column;align-items:flex-start;gap:3px"><span class="k">To</span><span class="v vmono" data-copy="${esc(to)}" title="Copy address" style="white-space:nowrap;overflow-x:auto;max-width:100%;font-size:11px;cursor:pointer">${esc(to)}</span></div>
        <div class="m-row"><span class="k">Miner fee</span><span class="v">${(cx.btc_fee != null ? Number(cx.btc_fee).toLocaleString('en-US') : '—')} sats${cx.signed_tx_estimated_size && cx.signed_tx_estimated_size.vsize ? ' · ' + cx.signed_tx_estimated_size.vsize + ' vB' : ''}${cx.btc_fee != null ? usdSats(cx.btc_fee) : ''}</span></div>
      </div>
      ${cx.data ? `<div class="fine" style="margin-top:6px">Counterparty data: <code style="word-break:break-all">${esc(String(cx.data).slice(0, 48))}${String(cx.data).length > 48 ? '…' : ''}</code></div>` : ''}
      <div class="fine" style="margin-top:6px">Permanent on-chain Counterparty transfer. ${esc(CONN.name)} will sign &amp; broadcast — verify the details there too.</div>
      <div id="pbStatus" class="statusline" hidden></div>
      <div class="wbtns"><button class="ghost" id="pbBack">Back</button><button class="primary" id="pbSend">Sign in ${esc(CONN.name)}</button></div>`);
    c.querySelectorAll('[data-copy]').forEach((el) => (el.onclick = () => copy(el.dataset.copy, el)));
    c.querySelector('#pbBack').onclick = () => renderConnectedCpSend(t);
    c.querySelector('#pbSend').onclick = () => connSubmit($('#pbStatus'), cx.psbt, { from: CONN.address, dests: [to], allowed: [to], data: cx.data, checkInputs: false });
  }

  function renderLocked() {
    syncNetBadge(false, false); // clean hero — nothing on the unlock screen
    body().innerHTML = `
      <p class="fine">Your encrypted wallet is locked. Enter your password to unlock.</p>
      <form id="unlockForm" class="row">
        <input id="unlockPw" type="password" placeholder="Password" autocomplete="current-password" />
        <button type="submit">Unlock</button>
      </form>
      <div id="unlockStatus" class="statusline" hidden></div>
      <div class="wlinks"><button id="bForget" class="link danger">Forget this wallet</button></div>`;
    $('#unlockForm').onsubmit = async (e) => {
      e.preventDefault();
      const s = $('#unlockStatus'); s.hidden = false; s.className = 'statusline load'; s.textContent = 'Decrypting…';
      try { await C.unlock($('#unlockPw').value); refreshImported(); try { restoreLastAcct(); } catch (_) {} renderUnlocked(); }
      catch (err) { s.className = 'statusline err'; s.textContent = err.message === 'wrong_password' ? 'Wrong password.' : 'Unlock failed.'; }
    };
    $('#bForget').onclick = async () => { if (confirm('Remove the encrypted wallet from this browser? You can only restore it from your seed phrase.')) { await C.destroyVault(); render(); } };
  }

  // ── Dashboard state ──
  let curAccount = 0, acctKind = 'hd', watchId = null, dashChain = 'btc', dashTab = 'tokens';
  let CONN = null; // a connected external wallet (UniSat / OKX / Wonder Wallet) via wallet-connect.js
  function isConn() { return acctKind === 'connected' && !!CONN; } // connected external-wallet session (no local keys)
  let DASH_PRICES = {}, DASH_ASSETS = null, dashSeq = 0, _vaultDL = false;
  // ── Privacy view — masks balances / values across BTC · ETH · SOL. Shares the extension's key. ──
  let PRIVACY = false; try { PRIVACY = localStorage.getItem('ww:privacy') === '1'; } catch (_) {}
  let PF = { usd: {}, nat: {}, total: 0 }, DASH_ACC = null; // cached so a privacy toggle repaints without refetch
  const mask = (v) => (PRIVACY ? '•••••' : v);
  const EYE_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>';
  const EYE_OFF_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

  // ── Password reveal — a show/hide eye on every password field (unlock, create, restore, imported,
  //    remove, custom-path gate, etc.), auto-attached to any dynamically-rendered form. ──
  function addPwReveal(inp) {
    if (!inp || inp.dataset.pweye || !inp.parentNode) return; inp.dataset.pweye = '1';
    const wrap = document.createElement('span'); wrap.className = 'pw-wrap';
    inp.parentNode.insertBefore(wrap, inp); wrap.appendChild(inp);
    const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'pw-eye'; btn.tabIndex = -1; btn.setAttribute('aria-label', 'Show password'); btn.innerHTML = EYE_SVG;
    btn.addEventListener('click', () => { const showing = inp.getAttribute('type') === 'text'; inp.setAttribute('type', showing ? 'password' : 'text'); btn.innerHTML = showing ? EYE_SVG : EYE_OFF_SVG; inp.focus(); });
    wrap.appendChild(btn);
  }
  function scanPwReveal(root) { try { (root || document).querySelectorAll('input[type="password"]:not([data-pweye])').forEach(addPwReveal); } catch (e) {} }
  try {
    new MutationObserver((muts) => muts.forEach((m) => m.addedNodes && m.addedNodes.forEach((nd) => { if (nd.nodeType !== 1) return; if (nd.matches && nd.matches('input[type="password"]')) addPwReveal(nd); scanPwReveal(nd); }))).observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) {}
  function paintPortfolio() {
    Object.keys(PF.usd).forEach((ch) => {
      const u = $('#pfUsd-' + ch); if (u) u.textContent = mask(PF.usd[ch] ? '$' + fmt2(PF.usd[ch]) : '$0');
      const n = $('#pfNat-' + ch); if (n) n.textContent = mask(fmtN(PF.nat[ch] || 0, 6) + ' ' + DCH[ch].sym);
    });
    const t = $('#pfTotal'); if (t) t.textContent = mask('$' + fmt2(PF.total));
  }
  function togglePrivacy() {
    PRIVACY = !PRIVACY; try { localStorage.setItem('ww:privacy', PRIVACY ? '1' : '0'); } catch (_) {}
    const b = $('#bPrivacy'); if (b) { b.classList.toggle('on', PRIVACY); b.title = PRIVACY ? 'Privacy view ON — show balances' : 'Privacy view — hide balances'; b.innerHTML = PRIVACY ? EYE_OFF_SVG : EYE_SVG; }
    paintPortfolio(); if (DASH_ASSETS) renderDashAssets(DASH_ACC); // repaint token amounts from cache
  }
  // Wallet-only tools — privacy (mask balances) + settings backup. These belong INSIDE the wallet card
  // header (beside Advanced / Lock), not in the site topbar, since they only make sense for an open wallet.
  function walletToolsHtml() {
    return '<button class="ghost sm ic-btn' + (PRIVACY ? ' on' : '') + '" id="bPrivacy" title="' + (PRIVACY ? 'Privacy view ON — show balances' : 'Privacy view — hide balances') + '">' + (PRIVACY ? EYE_OFF_SVG : EYE_SVG) + '</button>';
    // Backup lives in the Advanced menu now (header de-clutter).
  }
  function wireWalletTools() {
    const p = $('#bPrivacy'); if (p) { p.classList.toggle('on', PRIVACY); p.onclick = togglePrivacy; }
    const d = $('#dappsBtn'); if (d) d.onclick = () => window.DappDashboard && window.DappDashboard.toggle(); // Tools now lives in the wallet card
  }
  // Inject the privacy toggle into the topbar once (works for both the web /app and the extension expanded view).
  // Show/hide the wallet-only topbar tools (dApps, Backup, privacy eye). They're meaningless before a
  // wallet is open, so they stay hidden on the create / restore / connect / unlock screens.
  function setTopbarTools(show, showRail) {
    if (showRail === undefined) showRail = show;
    // Backup + privacy now live INSIDE the wallet card header (walletToolsHtml), not the topbar.
    // The ☰ Tools button + docked rail track showRail — hidden on the create/restore/unlock landing AND
    // for a Ledger (read-only in the Terminal: Counterparty/send signing on hardware isn't wired yet, so
    // the signing-tool rail would be dead). Ledger uses its own account/portfolio view instead.
    const db = document.getElementById('dappsBtn'); if (db) db.style.display = showRail ? '' : 'none';
    const shell = document.getElementById('termShell'); if (shell) shell.classList.toggle('no-rail', !showRail);
    if (!showRail) { const r = document.getElementById('toolRail'); if (r) r.classList.remove('open'); const s = document.getElementById('railScrim'); if (s) s.hidden = true; }
  }
  function ensurePrivacyBtn() {
    if ($('#privacyBtn')) return;
    const meta = document.querySelector('.topbar .meta'); if (!meta) return;
    const b = document.createElement('button');
    b.id = 'privacyBtn'; b.className = 'dapps-btn' + (PRIVACY ? ' on' : '');
    b.title = PRIVACY ? 'Privacy view ON — show balances' : 'Privacy view — hide balances';
    b.innerHTML = PRIVACY ? EYE_OFF_SVG : EYE_SVG;
    b.addEventListener('click', togglePrivacy);
    const anchor = document.getElementById('phaseBadge');
    meta.insertBefore(b, anchor || null);
  }
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };

  // ── Web session persistence + idle auto-lock (opt-in). OFF by default: the seed stays memory-only and a
  //    refresh re-locks (the audit-hardened default). When the user picks a timer, the unlocked session is
  //    kept in sessionStorage (cleared on tab close) so a refresh restores it, and it auto-locks after the
  //    chosen idle time. The IDLE setting drives ww:persist, which is what opens the core's resume gate. ──
  const SESS_KEY = 'ww:session';
  const IDLE_KEY = 'ww:idlemins'; // 'off'(default) | '1' | '5' | '15' | '30' | '60' | 'never'
  function idleSetting() { try { return localStorage.getItem(IDLE_KEY) || 'off'; } catch (_) { return 'off'; } }
  function persistOn() { return idleSetting() !== 'off'; }
  function idleMs() { const v = idleSetting(); if (v === 'off' || v === 'never') return null; const n = parseInt(v, 10); return n > 0 ? n * 60000 : null; }
  const FOREVER = 3650 * 24 * 60 * 60 * 1000;
  function saveSession() {
    if (!persistOn()) return;
    try { const sec = C.getSessionSecret && C.getSessionSecret(); if (sec && sec.mnemonic) sessionStorage.setItem(SESS_KEY, JSON.stringify({ sec, at: Date.now() })); } catch (_) {}
  }
  function clearSession() { try { sessionStorage.removeItem(SESS_KEY); } catch (_) {} }
  let _lockAt = 0; // wall-clock ms when the wallet will auto-lock (0 = none/unknown) — drives the footer countdown
  // Effective idle window across all modes: chosen minutes, or the core's 10-min default in 'off' mode; null = 'never'.
  function effIdleMs() { const v = idleSetting(); if (v === 'never') return null; const n = parseInt(v, 10); return n > 0 ? n * 60000 : 10 * 60000; }
  function armIdle() {
    if (!C.isUnlocked()) { _lockAt = 0; return; }
    const ms = effIdleMs();
    if (ms == null) { C.armAutoLock(FOREVER); _lockAt = 0; return; } // 'never' → effectively no idle lock
    C.armAutoLock(ms); _lockAt = Date.now() + ms; // re-arm the core timer + record the deadline for the countdown
  }
  function setIdleSetting(v) {
    try { localStorage.setItem(IDLE_KEY, v); localStorage.setItem('ww:persist', v !== 'off' ? '1' : '0'); } catch (_) {}
    if (v === 'off') clearSession(); else saveSession();
    armIdle();
  }
  let _bumpAt = 0;
  function bumpActivity() {
    if (!C.isUnlocked()) return;
    const now = Date.now();
    if (persistOn()) { try { const raw = sessionStorage.getItem(SESS_KEY); if (raw) { const o = JSON.parse(raw); o.at = now; sessionStorage.setItem(SESS_KEY, JSON.stringify(o)); } } catch (_) {} }
    if (now - _bumpAt > 4000) { _bumpAt = now; armIdle(); } // reset the idle countdown (+ core timer) on activity, throttled
  }
  // ── Footer auto-lock countdown (mirrors the extension's status strip) ──
  let _footCd = null;
  function stopFootCd() { if (_footCd) { clearInterval(_footCd); _footCd = null; } }
  function startFootCountdown() {
    stopFootCd();
    if (!$('#wfLock')) return;
    if (C.isUnlocked() && idleSetting() !== 'never' && _lockAt <= Date.now()) armIdle(); // ensure a live deadline exists
    const tick = () => {
      const el = $('#wfLock'); if (!el) { stopFootCd(); return; }
      if (!C.isUnlocked()) { el.textContent = ''; return; }
      if (idleSetting() === 'never') { el.textContent = '🔓 auto-lock off'; return; }
      if (!_lockAt) { el.textContent = ''; return; }
      const rem = _lockAt - Date.now();
      if (rem <= 0) { el.textContent = 'locking…'; return; }
      const m = Math.floor(rem / 60000), s = Math.floor((rem % 60000) / 1000);
      el.textContent = 'auto-locks in ' + m + ':' + (s < 10 ? '0' : '') + s;
    };
    tick(); _footCd = setInterval(tick, 1000);
  }
  function tryResumeSession() {
    if (C.isUnlocked() || !persistOn()) return false;
    try {
      const raw = sessionStorage.getItem(SESS_KEY); if (!raw) return false;
      const o = JSON.parse(raw); const ms = idleMs();
      if (ms != null && Date.now() - (o.at || 0) > ms) { clearSession(); return false; } // idled out while the tab was away
      if (o.sec && C.resumeSession && C.resumeSession(o.sec)) { armIdle(); return true; }
    } catch (_) {}
    return false;
  }
  const CHAIN_OF = { bitcoin: 'btc', ethereum: 'eth', solana: 'sol' };
  const watchList = () => lsGet('ww:watch', []);
  // Account LIST (shared ww:accts with the extension popup) — removable, gap-friendly.
  const BTC_TYPES = [['nativeSegwit', 'Native SegWit', 'bc1q'], ['legacy', 'Legacy', '1…'], ['taproot', 'Taproot', 'bc1p'], ['nestedSegwit', 'Nested SegWit', '3…']];
  const BTC_LABEL = { nativeSegwit: 'Native SegWit', legacy: 'Legacy', taproot: 'Taproot', nestedSegwit: 'Nested SegWit' };
  const DEFAULT_ACCTS = 4; // Accounts 0–3 are always present and locked (non-removable).
  function acctList() {
    const set = {}, v = lsGet('ww:accts', null);
    if (Array.isArray(v)) v.forEach((x) => { if (Number.isInteger(x) && x >= 0 && x <= 1000) set[x] = 1; }); // bound + integer-validate against tampering
    else { const n = Math.max(1, parseInt(localStorage.getItem('ww:acctcount') || '1', 10) || 1); for (let j = 0; j < n; j++) set[j] = 1; }
    for (let i = 0; i < DEFAULT_ACCTS; i++) set[i] = 1;
    return Object.keys(set).map(Number).sort((a, b) => a - b);
  }
  function setAcctList(arr) { lsSet('ww:accts', arr.slice().sort((a, b) => a - b)); }
  function addAcct() { const l = acctList(); const next = Math.max(...l) + 1; l.push(next); setAcctList(l); return next; }
  function acctRemovable(i) { return acctKind === 'hd' && i >= DEFAULT_ACCTS; }
  function removeAcct(i) { if (i < DEFAULT_ACCTS) return false; setAcctList(acctList().filter((x) => x !== i)); const m = loadMap('ww:btctype'); delete m[i]; lsSet('ww:btctype', m); const nm = loadMap(ACCT_NAMES); delete nm[i]; saveMap(ACCT_NAMES, nm); return true; }
  const acctBtcType = (i) => loadMap('ww:btctype')[i] || 'nativeSegwit';
  function setAcctBtcType(i, t) { const m = loadMap('ww:btctype'); if (t === 'nativeSegwit') delete m[i]; else m[i] = t; lsSet('ww:btctype', m); }
  const acctBtcAddr = (acc) => acc.bitcoin[acctBtcType(curAccount)].address;
  const currentWatch = () => (acctKind === 'watch' ? watchList().find((w) => w.id === watchId) : null);
  // ── Imported keys (WIF) — signable standalone addresses, shared with the extension popup ──
  let impId = null, IMPORTED = [];
  let HW = null, hwBtcType = 'nativeSegwit'; // connected Ledger accounts (read dashboard for hardware-only users)
  let hwViewAddr = null, hwViewIndex = null; // when browsing a derived receiving address (≠ index 0), the address being viewed
  let hwAggregate = false, hwAgg = null; // Phase 2: aggregate ALL used receiving addresses into one portfolio (hwAgg caches the last scan)
  const hwAddr = (t) => (HW && HW.bitcoin && HW.bitcoin[t] ? HW.bitcoin[t].address : (HW && HW.bitcoin ? HW.bitcoin.nativeSegwit.address : null));
  function refreshImported() { try { IMPORTED = C.isUnlocked() ? C.importedAccounts() : []; } catch (_) { IMPORTED = []; } saveSession(); /* keep the persisted session snapshot in sync with imported keys — so a refresh doesn't lose freshly-imported accounts */ }
  const currentImported = () => (acctKind === 'imported' ? IMPORTED.find((x) => x.id === impId) : null);
  const impBtcType = (id) => loadMap('ww:imptype')[id] || 'nativeSegwit';
  function setImpBtcType(id, t) { const m = loadMap('ww:imptype'); if (t === 'nativeSegwit') delete m[id]; else m[id] = t; lsSet('ww:imptype', m); }
  const curImportedId = () => (acctKind === 'imported' ? impId : null);
  const curBtcType = () => (acctKind === 'imported' ? impBtcType(impId) : acctBtcType(curAccount));
  const canSignBtc = () => acctKind === 'hd' || acctKind === 'imported';
  function impBtcAddr() { const im = currentImported(); return im ? (im.bitcoin[impBtcType(impId)] || im.bitcoin.nativeSegwit).address : null; }
  function activeAddr(acc, ch) {
    if (acctKind === 'connected' && CONN) return ch === 'btc' ? CONN.address : null; // external wallet = BTC address
    if (acctKind === 'hardware') return ch === 'btc' ? (hwViewAddr || hwAddr(hwBtcType)) : (HW && HW[ch] ? HW[ch].address : null);
    const w = currentWatch(); if (w) return CHAIN_OF[w.chain] === ch ? w.address : null;
    if (acctKind === 'imported') return ch === 'btc' ? impBtcAddr() : null;
    if (!acc) return null; return ch === 'btc' ? acctBtcAddr(acc) : chAddr(acc, ch);
  }

  function renderUnlocked() {
    saveLastAcct(); // remember the current account + chain so a refresh returns here
    setTopbarTools(true); // local unlocked wallet → show the tools rail + Backup/privacy. Idempotent, but
    // essential: renderUnlocked() is called DIRECTLY after unlock / create / restore (bypassing render(),
    // which is the only other place setTopbarTools runs) — without this the rail stays hidden until reload.
    // (syncNetBadge runs after the head is built so the Mainnet/Testnet chip mounts into the top row.)
    // Resolve the active account: HD (own keys) or watch-only (read-only, no signing).
    let watch = null;
    if (acctKind === 'watch') { watch = currentWatch(); if (!watch) acctKind = 'hd'; else dashChain = CHAIN_OF[watch.chain] || dashChain; }
    if (acctKind === 'imported') { if (!currentImported()) acctKind = 'hd'; else dashChain = 'btc'; }
    let acc = null;
    if (acctKind === 'hd') { try { acc = C.accounts(curAccount, 0, NET()); } catch (_) { return render(); } }
    else if (acctKind === 'imported') { const im = currentImported(); if (im) acc = { account: 0, importedId: impId, bitcoin: im.bitcoin, ethereum: null, solana: null, imported: true }; }
    window.__activeAccount = acc; // watch-only → null; imported → synthetic {importedId, bitcoin}
    // Surface the ACCOUNT-WINDOW-selected BTC address/type so the tools rail launches with it
    // (native-segwit ↔ Legacy 1…), instead of a hardcoded native-segwit. Address selection lives in
    // the account window; the tools follow it. (Connected/Ledger have their own fixed/derived source.)
    if (acc) { acc.btcType = curBtcType(); acc.btcAddress = activeAddr(acc, 'btc'); }
    const acctNames = loadMap(ACCT_NAMES);
    const isW = acctKind === 'watch', isImp = acctKind === 'imported';
    const chainSwitchable = acctKind === 'hd'; // HD accounts span BTC/ETH/SOL; watch/imported are single-chain
    body().innerHTML = `
      <div class="wallet-topbar">
        <div class="wt-left">${chainBtnHtml(chainSwitchable)}</div>
        <div class="wt-center"><span class="net-mount" id="wwNetMount"></span></div>
        <div class="wt-right">${isW ? '' : `<button class="ghost sm ib" id="bAdvanced" title="Advanced" aria-label="Advanced settings">${GEAR_IC}</button>`}<button class="ghost sm ib" id="bLock" title="Lock wallet" aria-label="Lock wallet">${LOCK_IC}</button></div>
      </div>
      <div class="dash-head">
        <div class="dash-head-l">
          <div class="acct-sel">${acctBtnHtml()}${dashChain === 'btc' && !isW ? `<button class="mini btctype-chip" id="btcTypeBtn" title="Bitcoin address type">${BTC_LABEL[isImp ? impBtcType(impId) : acctBtcType(curAccount)]} ▾</button>` : ''}</div>
        </div>
        <button class="pname-chip" id="pnameChip" hidden title="Your primary Bitcoin Stamps name"></button>
      </div>
      <div class="bal-strip" id="pfStrip">
        <div class="bal-main">
          <div class="bal-top"><span class="bal-usd" id="pfUsd-${dashChain}">…</span>${walletToolsHtml()}</div>
          <span class="bal-nat" id="pfNat-${dashChain}">—</span>
        </div>
        <div class="bal-actions" id="balActions"></div>
      </div>
      <div class="dash-actions wbtns" id="dashActions"></div>
      <div class="dash-tabs">
        <div class="dash-assettabs"><button class="datab${dashTab === 'tokens' ? ' on' : ''}" data-tab="tokens">Tokens</button><button class="datab${dashTab === 'collectibles' ? ' on' : ''}" data-tab="collectibles">Collectibles</button></div>
      </div>
      <div id="dashAssets" class="dash-assets"><div class="fine">Loading ${esc(DCH[dashChain].name)} assets…</div></div>
      <div class="wallet-foot" id="walletFoot">
        <span class="wf-lock" id="wfLock"></span>
        <span class="wf-sec"><span class="wf-dot"></span>keys never leave this device</span>
        <span class="wf-ver" id="wfVer"></span>
      </div>`;
    if ($('#chainBtn')) $('#chainBtn').onclick = chainPicker;
    if ($('#acctBtn')) $('#acctBtn').onclick = accountPicker;
    if ($('#btcTypeBtn')) $('#btcTypeBtn').onclick = () => btcTypeMenu();
    $('#bLock').onclick = () => { C.lock(); render(); };
    if ($('#bAdvanced')) $('#bAdvanced').onclick = () => dashAdvancedMenu(acc);
    wireWalletTools();
    syncNetBadge(true, true); // mount the Mainnet/Testnet toggle chip into the top row (dash-head), plus the testnet banner
    body().querySelectorAll('.datab').forEach((b) => (b.onclick = () => { dashTab = b.dataset.tab; body().querySelectorAll('.datab').forEach((x) => x.classList.toggle('on', x === b)); renderDashAssets(acc); }));
    renderBalanceActions(acc);
    renderDashActions(acc);
    const vf = $('#wfVer'); if (vf) vf.textContent = (document.getElementById('verTag') || {}).textContent || '';
    startFootCountdown();
    loadPortfolio(acc);
    loadDashAssets(acc);
    if (!isW && !isImp && acc) checkVaultDeepLink(acc); // Emblem vaulting needs an ETH address imported keys lack
  }

  // ── Activity / transaction history (metaprotocol-aware) — modal, Coin-Control-styled. ──
  let ACT_T = { addr: null, items: null, filter: 'all' };
  const AIC = {
    send: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h13M13 7l5 5-5 5"/></svg>',
    recv: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H6M11 17l-5-5 5-5"/></svg>',
    fire: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><path d="M12 3c1 3-2 4-2 7 0-1-1.5-1.5-1.5-3C7 9 6 11 6 13.5 6 17 8.7 20 12 20s6-3 6-6.5c0-3.5-3-6-6-10.5z"/></svg>',
    disp: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9"><circle cx="12" cy="12" r="8"/><path d="M9.5 14.5c.4 1 1.4 1.5 2.5 1.5 1.4 0 2.4-.7 2.4-1.9 0-2.6-4.6-1.4-4.6-3.9C9.8 9 10.8 8.4 12 8.4c1 0 1.9.4 2.4 1.3M12 7v1.4M12 15.9V17.3" stroke-linecap="round"/></svg>',
    div: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="7" r="3.2"/><circle cx="17" cy="17" r="3.2"/><path d="M9.5 9.5l5 5M14 8h3V11M10 16H7v-3"/></svg>',
    plus: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    mint: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3l7 7-4 4M11 6l7 7M3 21l6-2 9-9-4-4-9 9-2 6z"/></svg>',
    sweep: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M19 5l-7 7M8 21l-4-4M6 13l5 5M4 21h6M14 3l7 7"/></svg>',
    dex: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4v13M4 14l3 3 3-3M17 20V7M20 10l-3-3-3 3"/></svg>',
  };
  const termAgo = (ts) => { if (!ts) return ''; const s = Math.max(0, Math.floor(Date.now() / 1000 - ts)); if (s < 60) return s + 's ago'; if (s < 3600) return Math.floor(s / 60) + 'm ago'; if (s < 86400) return Math.floor(s / 3600) + 'h ago'; return Math.floor(s / 86400) + 'd ago'; };
  // ── Activity USD pricing: BTC + XCP from the price feed; other tokens via their XCP pool (best-effort). ──
  let ACT_PX = { btc: 0, xcp: 0, pool: {} };
  async function actLoadPx() {
    try { const pr = await fetch('api/prices').then((r) => r.json()); ACT_PX.btc = Number(pr.bitcoin) || 0; ACT_PX.xcp = Number(pr.counterparty) || 0; } catch (_) {}
    try { const j = await fetch('api/cp/pools').then((r) => r.json()); const arr = Array.isArray(j.result) ? j.result : []; const px = {};
      arr.forEach((p) => { const ra = Number(p.resA), rb = Number(p.resB); if (p.a === 'XCP' && rb > 0) px[p.b] = ra / rb; else if (p.b === 'XCP' && ra > 0) px[p.a] = rb / ra; });
      ACT_PX.pool = px;
    } catch (_) {}
  }
  // USD chip for an amount of an asset (normalized units): BTC/XCP direct, other tokens via pool XCP-price. '' if unknown.
  function actUsd(asset, amt) {
    const a = Number(amt); if (!(a > 0)) return '';
    let u = 0;
    if (asset === 'BTC') u = a * ACT_PX.btc;
    else if (asset === 'XCP') u = a * ACT_PX.xcp;
    else { const px = ACT_PX.pool[asset]; if (px) u = a * px * ACT_PX.xcp; }
    return u ? ` <span class="ac-usd">≈ $${u.toLocaleString('en-US', { maximumFractionDigits: u < 1 ? 4 : 2 })}</span>` : '';
  }
  const actSatsUsd = (sats) => { const u = (Number(sats) / 1e8) * ACT_PX.btc; return u ? ` <span class="ac-usd">≈ $${u.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>` : ''; };
  // Normalized amount for a CP data field: prefer the API's <field>_normalized, else /1e8 when the asset is divisible.
  function actQty(d, field) {
    if (d[field + '_normalized'] != null) return Number(d[field + '_normalized']);
    const raw = Number(d[field]); if (!isFinite(raw)) return 0;
    const info = d[field.replace(/_quantity$/, '') + '_asset_info'] || d.asset_info;
    return (info && info.divisible === false) ? raw : raw / 1e8;
  }
  const amtChip = (asset, qty) => `${fmtN(qty, 8)} ${esc(asset || '')}${actUsd(asset, qty)}`;

  function actDesc(it) {
    const d = it.data || {}, t = it.type;
    const det = (s) => (s ? ` <span class="ac-det">${s}</span>` : ''); // s is pre-built HTML (asset names esc'd by amtChip)
    if (it.source === 'btc') {
      if (d.amountSats == null) return { ic: AIC.send, cls: 'cp', label: 'Bitcoin tx', detail: '' };
      const line = `${fmtN(d.amountSats / 1e8, 8)} BTC${actSatsUsd(d.amountSats)}`;
      return t === 'receive' ? { ic: AIC.recv, cls: 'in', label: 'Received', detail: det(line) } : { ic: AIC.send, cls: 'out', label: 'Sent', detail: det(line) };
    }
    if (it.source === 'src20') { const op = String(d.op || 'transfer').toLowerCase(); const amt = d.amt != null ? fmtN(parseFloat(d.amt), 8) : (d.max != null ? 'max ' + fmtN(parseFloat(d.max), 0) : ''); return { ic: op === 'deploy' ? AIC.plus : op === 'mint' ? AIC.mint : AIC.send, cls: 'src20', label: 'SRC-20 ' + op, detail: det(esc(d.tick || '') + (amt ? ' · ' + amt : '')) }; }
    const to = d.destination || d.address, recv = !!to && to === ACT_T.addr;
    switch (t) {
      case 'send': case 'enhanced_send': case 'mpma_send': {
        const who = recv ? (d.source ? ' ← ' + esc(shortA(d.source)) : '') : (to ? ' → ' + esc(shortA(to)) : '');
        return recv ? { ic: AIC.recv, cls: 'in', label: 'Received', detail: det(amtChip(d.asset, actQty(d, 'quantity')) + who) }
          : { ic: AIC.send, cls: 'out', label: t === 'mpma_send' ? 'Multi-send' : 'Sent', detail: det(amtChip(d.asset, actQty(d, 'quantity')) + who) };
      }
      case 'order': return { ic: AIC.dex, cls: 'cp', label: 'Swap', detail: det(`${amtChip(d.give_asset, actQty(d, 'give_quantity'))} → ${amtChip(d.get_asset, actQty(d, 'get_quantity'))}`) };
      case 'dispense': { const price = d.btc_amount != null ? `${fmtN(d.btc_amount, 0)} sats${actSatsUsd(d.btc_amount)}` : ''; const qa = d.asset ? esc(d.asset) + (d.dispense_quantity != null ? ' × ' + fmtN(actQty(d, 'dispense_quantity'), 8) : '') : ''; return { ic: AIC.disp, cls: 'in', label: 'Dispenser buy', detail: det(qa + (price ? (qa ? ' · ' : '') + 'for ' + price : '')) }; }
      case 'dispenser': { const rate = d.satoshirate != null ? fmtN(d.satoshirate, 0) + ' sats ea' : ''; return { ic: AIC.disp, cls: 'cp', label: 'Opened dispenser', detail: det(esc(d.asset || '') + (rate ? ' @ ' + rate : '')) }; }
      case 'fairmint': { const xcp = d.xcp_paid != null ? ' · ' + amtChip('XCP', d.xcp_paid / 1e8) : ''; const earned = d.earned != null ? ' · ' + fmtN(actQty(d, 'earned'), 8) : ''; return { ic: AIC.mint, cls: 'cp', label: 'Minted', detail: det(esc(d.asset || '') + earned + xcp) }; }
      case 'fairminter': return { ic: AIC.plus, cls: 'cp', label: 'Launched fairminter', detail: det(esc(d.asset || '')) };
      case 'dividend': { const per = d.quantity_per_unit != null ? ' · ' + amtChip(d.dividend_asset || 'XCP', actQty(d, 'quantity_per_unit')) + ' each' : ''; return { ic: AIC.div, cls: 'cp', label: 'Dividend', detail: det(esc(d.asset || '') + per) }; }
      case 'issuance': { const q = d.quantity != null ? ' · ' + fmtN(actQty(d, 'quantity'), 8) : ''; return { ic: AIC.plus, cls: 'cp', label: 'Issuance', detail: det(esc(d.asset || '') + q) }; }
      case 'sweep': return { ic: AIC.sweep, cls: 'cp', label: 'Sweep', detail: det(to ? '→ ' + esc(shortA(to)) : '') };
      case 'destroy': return { ic: AIC.fire, cls: 'burn', label: 'Burned', detail: det(amtChip(d.asset, actQty(d, 'quantity'))) };
      case 'order_cancel': case 'cancel': return { ic: AIC.dex, cls: 'cp', label: 'Cancelled order', detail: '' };
      case 'btcpay': return { ic: AIC.dex, cls: 'cp', label: 'BTC pay (match)', detail: '' };
      case 'attach': return { ic: AIC.send, cls: 'cp', label: 'Attach to UTXO', detail: det(esc(d.asset || '')) };
      case 'detach': return { ic: AIC.send, cls: 'cp', label: 'Detach from UTXO', detail: det(esc(d.asset || '')) };
      default: return { ic: AIC.send, cls: 'cp', label: (t || 'Counterparty').replace(/_/g, ' '), detail: det(esc(d.asset || '')) };
    }
  }
  // Expanded detail card — the full per-tx breakdown (with USD), shown when a row is tapped.
  function actDetailHtml(it) {
    const d = it.data || {}, t = it.type;
    const row = (k, v) => (v ? `<div class="acd-row"><span class="acd-k">${esc(k)}</span><span class="acd-v">${v}</span></div>` : '');
    let rows = '';
    if (it.source === 'btc') rows += row(t === 'receive' ? 'Received' : 'Sent', d.amountSats != null ? `${fmtN(d.amountSats / 1e8, 8)} BTC${actSatsUsd(d.amountSats)}` : '');
    else if (it.source === 'src20') rows += row('Op', esc(String(d.op || ''))) + row('Ticker', esc(d.tick || '')) + row('Amount', d.amt != null ? fmtN(parseFloat(d.amt), 8) : (d.max != null ? 'max ' + fmtN(parseFloat(d.max), 0) : '')) + row('To', d.to ? esc(shortA(d.to)) : '');
    else {
      const to = d.destination || d.address, recv = !!to && to === ACT_T.addr;
      switch (t) {
        case 'send': case 'enhanced_send': case 'mpma_send':
          rows += row('Asset', amtChip(d.asset, actQty(d, 'quantity'))) + row(recv ? 'From' : 'To', esc(shortA(recv ? (d.source || '') : (to || '')))) + (d.memo ? row('Memo', esc(String(d.memo))) : ''); break;
        case 'order':
          rows += row('Give', amtChip(d.give_asset, actQty(d, 'give_quantity'))) + row('Get', amtChip(d.get_asset, actQty(d, 'get_quantity'))) + row('Status', esc(d.status || '')); break;
        case 'dispense':
          rows += row('Bought', d.asset ? `${fmtN(actQty(d, 'dispense_quantity'), 8)} ${esc(d.asset)}` : '') + row('Paid', d.btc_amount != null ? `${fmtN(d.btc_amount, 0)} sats${actSatsUsd(d.btc_amount)}` : '') + row('Dispenser', d.dispenser_source ? esc(shortA(d.dispenser_source)) : ''); break;
        case 'dispenser':
          rows += row('Asset', esc(d.asset || '')) + row('Give / dispense', d.give_quantity != null ? fmtN(actQty(d, 'give_quantity'), 8) : '') + row('Price', d.satoshirate != null ? fmtN(d.satoshirate, 0) + ' sats each' : ''); break;
        case 'fairmint':
          rows += row('Token', d.earned != null ? `${fmtN(actQty(d, 'earned'), 8)} ${esc(d.asset || '')}` : esc(d.asset || '')) + row('XCP paid', d.xcp_paid != null ? amtChip('XCP', d.xcp_paid / 1e8) : ''); break;
        case 'dividend':
          rows += row('On asset', esc(d.asset || '')) + row('Per unit', d.quantity_per_unit != null ? amtChip(d.dividend_asset || 'XCP', actQty(d, 'quantity_per_unit')) : ''); break;
        case 'issuance':
          rows += row('Asset', esc(d.asset || '')) + row('Quantity', d.quantity != null ? fmtN(actQty(d, 'quantity'), 8) : '') + (d.description ? row('Description', esc(String(d.description).slice(0, 80))) : ''); break;
        default: if (d.asset) rows += row('Asset', esc(d.asset));
      }
    }
    rows += row('Miner fee', it.fee != null ? `${fmtN(it.fee, 0)} sats${actSatsUsd(it.fee)}${it.feeRate != null ? ' · ' + it.feeRate + ' s/vB' : ''}` : '');
    rows += row('Status', it.confirmed ? 'Confirmed' + (it.blockHeight ? ' · block ' + fmtN(it.blockHeight, 0) : '') : 'Unconfirmed');
    rows += `<div class="acd-row"><span class="acd-k">Transaction</span><span class="acd-v"><a href="https://mempool.space/tx/${encodeURIComponent(it.txid)}" target="_blank" rel="noopener" style="color:var(--gold2)">${esc(it.txid.slice(0, 20))}…</a></span></div>`;
    return `<div class="acd">${rows}</div>`;
  }
  function actRowT(it) {
    const info = actDesc(it);
    const status = it.confirmed ? '<span class="ac-badge conf">✓ Confirmed</span>' : '<span class="ac-badge unc">⏳ Unconfirmed</span>';
    const when = it.time ? termAgo(it.time) : (it.blockHeight ? 'block ' + fmtN(it.blockHeight, 0) : '');
    const fee = it.fee != null ? fmtN(it.fee, 0) + ' sats' + (it.feeRate != null ? ' · ' + it.feeRate + ' s/vB' : '') : '';
    const boost = (!it.confirmed && it.ownVout && canSignBtc()) ? `<button class="ac-boost" data-boost="${esc(it.txid)}">⚡ Boost</button>` : '';
    return `<div class="ac-item" data-tx="${esc(it.txid)}">
      <div class="ac-row" data-expand="${esc(it.txid)}"><span class="ac-ic ${info.cls}">${info.ic}</span>
      <div class="ac-main"><div class="ac-l1">${esc(info.label)}${info.detail}</div>
      <div class="ac-l2"><span class="ac-tx">${esc(it.txid.slice(0, 14))}…</span>${when ? `<span>${esc(when)}</span>` : ''}${fee ? `<span class="ac-fee">${esc(fee)}</span>` : ''}</div></div>
      <div class="ac-r">${status}${boost}<span class="ac-chev">▾</span></div></div>
      <div class="ac-detail" hidden></div></div>`;
  }
  function openActivity(addr) {
    if (!addr) return;
    ACT_T = { addr, items: null, filter: 'all' };
    // Coin Control lives inside Activity now (they share one entry point, mirroring the extension).
    const ccBtn = (canSignBtc() || acctKind === 'connected' || acctKind === 'hardware') ? `<button class="mini" id="acCoin" title="Coin Control — UTXO management (freeze / protect asset-bearing coins)">▦ Coin Control</button>` : '';
    modal(`<div class="cc-head"><div><h3 class="m-title" style="margin:0">Activity</h3><div class="cc-addr">${esc(addr)}</div></div><div class="cc-head-r">${ccBtn}</div></div><div id="acBody"><div class="statusline load">Loading activity…</div></div>`, true);
    const acCoin = $('#acCoin'); if (acCoin) acCoin.onclick = () => { closeModal(); if (window.CoinControl) window.CoinControl.open(addr); };
    loadActT();
  }
  async function loadActT() {
    const body = $('#acBody'); if (body) body.innerHTML = '<div class="statusline load">Loading activity…</div>';
    try {
      const [r] = await Promise.all([fetch('api/activity/' + encodeURIComponent(ACT_T.addr)).then((x) => x.json()), actLoadPx()]);
      ACT_T.items = r.items || [];
    } catch (_) { if (body) body.innerHTML = '<div class="statusline err">Could not load activity — try again.</div>'; return; }
    renderActT();
  }
  function renderActT() {
    const body = $('#acBody'); if (!body || !ACT_T.items) return;
    const nUnc = ACT_T.items.filter((i) => !i.confirmed).length;
    const rows = ACT_T.items.filter((i) => ACT_T.filter === 'all' || (ACT_T.filter === 'unconfirmed' ? !i.confirmed : i.confirmed));
    const filters = [['all', 'All', ACT_T.items.length], ['unconfirmed', 'Unconfirmed', nUnc], ['confirmed', 'Confirmed', ACT_T.items.length - nUnc]];
    body.innerHTML = `<div class="ac-filters">${filters.map((f) => `<button class="acf ${ACT_T.filter === f[0] ? 'on' : ''}" data-f="${f[0]}">${f[1]} <span class="acf-n">${f[2]}</span></button>`).join('')}</div>
      <div class="ac-list">${rows.length ? rows.map(actRowT).join('') : `<div class="fine" style="padding:14px">No ${ACT_T.filter === 'all' ? '' : ACT_T.filter + ' '}transactions.</div>`}</div>`;
    body.querySelectorAll('.acf').forEach((b) => (b.onclick = () => { ACT_T.filter = b.dataset.f; renderActT(); }));
    body.querySelectorAll('[data-boost]').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); const it = ACT_T.items.find((x) => x.txid === b.dataset.boost); if (it) termBoost(it); }));
    // Click a row to expand its full detail card (filled lazily on first open).
    body.querySelectorAll('[data-expand]').forEach((r) => (r.onclick = () => {
      const item = r.closest('.ac-item'); if (!item) return; const panel = item.querySelector('.ac-detail'); const it = ACT_T.items.find((x) => x.txid === r.dataset.expand); if (!panel || !it) return;
      if (panel.hasAttribute('hidden')) { if (!panel.dataset.filled) { panel.innerHTML = actDetailHtml(it); panel.dataset.filled = '1'; } panel.removeAttribute('hidden'); item.classList.add('open'); }
      else { panel.setAttribute('hidden', ''); item.classList.remove('open'); }
    }));
  }
  // WW-B04: a CPFP "boost" spends a specific owned output as the child input. That output can carry an
  // on-chain asset (rune / inscription / Stamp / UTXO-bound Counterparty asset) and would be BURNED if
  // spent as fee. The input is usually the UNCONFIRMED parent output (not in coin-control), so we fail
  // closed: allow a boost only for a plain Bitcoin transaction, and for a confirmed output additionally
  // require coin-control to classify the exact outpoint as spendable (not protected / frozen / locked).
  async function cpfpInputSafe(it) {
    if (it.source && it.source !== 'btc') return { ok: false, why: 'This transaction carries an on-chain asset (Counterparty / Stamps / SRC-20 / Ordinal). Boosting it via CPFP could spend and burn that asset — not supported.' };
    try {
      const cc = await fetch(`api/btc/${ACT_T.addr}/coincontrol`).then((r) => r.json());
      const u = (cc.utxos || []).find((x) => x.txid === it.txid && x.vout === it.ownVout.vout);
      if (u) {
        if (u.category === 'protected') return { ok: false, why: 'That output holds an on-chain asset — refusing to spend it as a fee.' };
        if (u.category !== 'spendable') return { ok: false, why: 'That output is not confirmed-spendable — refusing to boost.' };
        if (u.frozen) return { ok: false, why: 'That output is frozen — unfreeze it first.' };
        if (u.timelocked) return { ok: false, why: 'That output is time-locked — refusing to spend it.' };
      }
    } catch (_) { /* unconfirmed / coin-control unavailable → allowed only because the parent is plain BTC */ }
    return { ok: true };
  }
  async function termBoost(it) {
    if (!it.ownVout) return;
    const acc = window.__activeAccount;
    const type = acctKind === 'imported' ? impBtcType(impId) : (acc && acc.bitcoin ? Object.keys(acc.bitcoin).find((t) => acc.bitcoin[t].address === ACT_T.addr) : null) || 'nativeSegwit';
    let fees = { fastestFee: 20 }; try { fees = await fetch('api/btc/fees').then((r) => r.json()); } catch (_) {}
    const pv = it.vsize || 200, pf = it.fee || 0, cv = 111;
    let rate = Math.max((fees.fastestFee || 20), Math.ceil(it.feeRate || 1) + 3);
    const calc = (r) => { const childFee = Math.max(1, Math.ceil(r * (pv + cv) - pf)); return { childFee, pkgRate: +(((pf + childFee) / (pv + cv)).toFixed(1)) }; };
    const c = modal(`<h3 class="m-title">⚡ Boost stuck transaction</h3>
      <p class="fine">This tx is unconfirmed at <b>${it.feeRate || '?'} s/vB</b>. Boost it with a <b>CPFP</b> child (spends its output back to you at a high fee) so miners include both.</p>
      <label class="cpf"><span>Target rate <span class="fine">s/vB</span></span><input id="boRate" class="m-in" type="number" min="1" step="1" value="${rate}"/></label>
      <div id="boCalc" class="fine"></div><div id="boStatus" class="statusline" hidden></div>
      <div class="wbtns"><button class="ghost" id="boCancel">Cancel</button><button class="primary" id="boGo">Boost</button></div>`);
    const paint = () => { const cc = calc(Math.max(1, parseInt($('#boRate').value, 10) || rate)); $('#boCalc').innerHTML = `Child fee <b>${fmtN(cc.childFee, 0)} sats</b> · package ≈ <b>${cc.pkgRate} s/vB</b>`; };
    paint(); $('#boRate').oninput = paint; $('#boCancel').onclick = () => openActivity(ACT_T.addr);
    $('#boGo').onclick = async () => {
      const st = $('#boStatus'); st.hidden = false; st.className = 'statusline load'; st.textContent = 'Classifying the output…';
      try {
        const chk = await cpfpInputSafe(it); // WW-B04: fail closed on asset-bearing / frozen / unknown inputs
        if (!chk.ok) { st.className = 'statusline err'; st.textContent = chk.why; return; }
        st.textContent = 'Building CPFP child & signing…';
        const r2 = Math.max(1, parseInt($('#boRate').value, 10) || rate), cc = calc(r2);
        const childRate = Math.max(1, cc.childFee / cv);
        const prevTxs = {};
        if (type === 'legacy') { const h = await fetch('api/btc/tx/' + it.txid + '/hex').then((x) => (x.ok ? x.text() : null)).catch(() => null); if (h) prevTxs[it.txid] = h.trim(); }
        const signed = C.send({ account: acc ? acc.account : 0, importedId: acctKind === 'imported' ? impId : null, type, utxos: [{ txid: it.txid, vout: it.ownVout.vout, value: it.ownVout.value }], recipient: ACT_T.addr, sendMax: true, feeRate: childRate, rbf: true, sign: true, prevTxs });
        const b = await fetch('api/btc/broadcast', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ txhex: signed.txhex }) }).then((x) => x.json());
        if (b.error) throw new Error(b.detail || b.error);
        st.className = 'statusline load'; st.innerHTML = `Boosted ✓ — child <a href="https://mempool.space/tx/${encodeURIComponent(b.txid)}" target="_blank" rel="noopener" style="color:var(--gold2)">${esc(String(b.txid).slice(0, 16))}…</a>`;
        setTimeout(() => openActivity(ACT_T.addr), 2000);
      } catch (e) { st.className = 'statusline err'; st.textContent = 'Failed: ' + (e.message === 'insufficient_funds' ? 'The stuck output is too small to pay the boost fee alone.' : (e.message || 'boost error')); }
    };
  }

  // ── Hardware (Ledger) dashboard — read view for hardware-only users (no seed vault). Balances +
  //    assets load from the Ledger's addresses; the device holds the keys, so this view is read-only.
  //    On-device signing (sends / Counterparty) is wired via HW.signPsbt as a staged follow-up. ──
  function renderHardware() {
    const a = HW;
    if (!a || !a.bitcoin) { acctKind = 'hd'; return renderNone(); }
    window.__activeAccount = null; // Ledger holds the keys — no in-browser signing account
    dashChain = 'btc';
    const bt = a.bitcoin[hwBtcType] ? hwBtcType : 'nativeSegwit';
    const mainAddr = hwAddr(bt);
    const addr = hwViewAddr || mainAddr;
    // Present the Ledger to the tools rail as a connected-style signer: compose here → WonderHW.signPsbt
    // (device confirms) → core finalizes the sigs → broadcast (the same proven flow the Ledger sends use).
    // Native-segwit only for now (the device policy is wpkh on m/84'); legacy/taproot signing is a
    // follow-up (extend hardware-src + rebuild the bundle). Browsed/aggregate views stay read-only.
    const hwAcct = (HW && HW.account) || 0;
    // Native SegWit, Legacy 1… (OG Counterparty / Stamps) and Taproot all sign on-device now (wpkh /
    // pkh / tr policies). A browsed/aggregate view stays read-only (we sign the account's main address).
    const hwCanSign = (bt === 'nativeSegwit' || bt === 'legacy' || bt === 'taproot') && !hwViewAddr && !hwAggregate;
    window.__hardwareWallet = { address: addr, name: 'Ledger', type: bt, account: hwAcct,
      signPsbt: hwCanSign ? async function (psbt) {
        const HWm = window.WonderHW; if (!HWm) throw new Error('Ledger module not loaded — reconnect your device.');
        await HWm.connect(); // reuse the paired grant (no picker)
        // signBroadcast hands us the PSBT as hex; WonderHW.signPsbt wants base64.
        const b64 = /^[0-9a-fA-F]+$/.test(psbt) ? hexToB64(psbt) : psbt;
        const res = await HWm.signPsbt(b64, hwAcct, bt); // device signs + finalizes → broadcast-ready hex
        return { txhex: res.txhex, txid: (C.txidOf ? C.txidOf(res.txhex) : '') }; // connected path broadcasts it
      } : null };
    const viewing = !!hwViewAddr;
    const canScan = !!(a.bitcoin[bt] && a.bitcoin[bt].acct);
    const agg = hwAggregate && canScan; // Phase 2 aggregate portfolio (only when the account key is available)
    body().innerHTML = `
      <div class="dash-head">
        <div class="acct-sel"><div class="hw-acct">🔐 Ledger · Bitcoin${agg ? ' · All addresses' : viewing ? ' · 0/' + hwViewIndex : ''}</div>
          <button class="mini btctype-chip" id="btcTypeBtn" title="Bitcoin address type">${BTC_LABEL[bt]} ▾</button></div>
        <button class="pname-chip" id="pnameChip" hidden title="Your primary Bitcoin Stamps name"></button>
        <div class="dash-head-r"><button class="ghost sm" id="hwDisc" title="Disconnect this Ledger">Disconnect</button></div>
      </div>
      <div class="bal-strip" id="pfStrip">
        <div class="bal-main">
          <div class="bal-top"><span class="bal-usd" id="pfUsd-btc">…</span>${walletToolsHtml()}</div>
          <span class="bal-nat" id="pfNat-btc">—</span>
        </div>
        <div class="bal-actions" id="balActions"><button class="ghost sm" data-a="receive">Receive</button></div>
      </div>
      <div class="dash-tabs">
        <div class="dash-assettabs"><button class="datab${dashTab === 'tokens' ? ' on' : ''}" data-tab="tokens">Tokens</button><button class="datab${dashTab === 'collectibles' ? ' on' : ''}" data-tab="collectibles">Collectibles</button></div>
      </div>
      <div class="addr-row" style="margin:2px 0 8px">${agg
        ? `<span class="addr-chip" id="aggChip" title="Combined across every used receiving address">⊕ ${hwAgg ? hwAgg.usedCount + ' address' + (hwAgg.usedCount === 1 ? '' : 'es') + ' with holdings' : 'aggregating…'}</span><button class="mini" id="hwSingle" title="Back to the single-address view">← single</button>`
        : `<span class="addr-chip" data-copy="${esc(addr)}" title="Copy address">${esc(shortA(addr))}</span>${viewing ? `<span class="hw-idx" title="Receiving-chain index">0/${hwViewIndex}</span><button class="mini" id="hwMain" title="Back to your main address">← main</button>` : ''}`}</div>
      <div id="dashAssets" class="dash-assets"><div class="fine">${agg ? 'Scanning your Ledger addresses…' : 'Loading Bitcoin assets…'}</div></div>
      <div class="dash-actions wbtns" id="dashActions"></div>
      <div class="fine" style="margin-top:8px;opacity:.85">🔐 Keys stay on your Ledger — this is a read view. On-device signing for sends &amp; Counterparty is being validated with hardware.</div>
      <div class="wallet-foot" id="walletFoot">
        <span class="wf-sec"><span class="wf-dot"></span>🔐 keys stay on your Ledger</span>
        <span class="wf-ver" id="wfVer"></span>
      </div>`;
    $('#btcTypeBtn').onclick = hwBtcTypeMenu;
    $('#hwDisc').onclick = hwDisconnect;
    wireWalletTools();
    const vf = $('#wfVer'); if (vf) vf.textContent = (document.getElementById('verTag') || {}).textContent || '';
    const hwMainBtn = $('#hwMain'); if (hwMainBtn) hwMainBtn.onclick = () => { hwViewAddr = null; hwViewIndex = null; renderHardware(); };
    const hwSingleBtn = $('#hwSingle'); if (hwSingleBtn) hwSingleBtn.onclick = () => { hwAggregate = false; DASH_ASSETS = null; renderHardware(); };
    body().querySelectorAll('[data-copy]').forEach((el) => (el.onclick = () => copy(el.dataset.copy, el)));
    body().querySelectorAll('.datab').forEach((b) => (b.onclick = () => { dashTab = b.dataset.tab; body().querySelectorAll('.datab').forEach((x) => x.classList.toggle('on', x === b)); renderDashAssets(null); }));
    // Receive lives in the balance module now; the below-balance row is ☰ Tools + Portfolio/Addresses + Activity.
    // Coin Control moved inside Activity (mirrors the main wallet + extension).
    const recvBtn = $('#balActions') && $('#balActions').querySelector('[data-a="receive"]'); if (recvBtn) recvBtn.onclick = hwReceive;
    const bar = $('#dashActions');
    const scanBtn = canScan ? `<button class="ghost sm" data-a="scan" title="Browse the Ledger's receiving addresses one by one">⧉ Addresses</button>` : '';
    const aggBtn = canScan ? `<button class="ghost sm${agg ? ' on' : ''}" data-a="aggregate" title="Combine all used receiving addresses into one portfolio">⊕ ${agg ? 'Aggregating' : 'Portfolio'}</button>` : '';
    bar.innerHTML = `<button class="ghost sm" id="dappsBtn" title="Open the tools panel">☰ Tools</button>${aggBtn}${scanBtn}<button class="ghost sm" data-a="activity">⧗ Activity</button>`;
    bar.querySelectorAll('[data-a]').forEach((b) => (b.onclick = () => {
      const act = b.dataset.a;
      if (act === 'aggregate') { hwAggregate = !hwAggregate; hwViewAddr = null; hwViewIndex = null; DASH_ASSETS = null; renderHardware(); }
      else if (act === 'scan') hwScanAddrs();
      else if (act === 'activity') openActivity(addr);
    }));
    const dbtn = bar.querySelector('#dappsBtn'); if (dbtn) dbtn.onclick = () => window.DappDashboard && window.DappDashboard.toggle();
    if (agg) hwLoadAggregate(bt);
    else { loadPortfolio(null); loadDashAssets(null); } // activeAddr() returns the Ledger address for the hardware kind
  }
  // Phase 2 — aggregate EVERY used receiving address into one portfolio: summed BTC + merged
  // tokens/collectibles (Ledger-Live-style account total). Keys never touch this — addresses are derived
  // locally from the account key and read through the proxy. Caches into hwAgg so tab-switches don't rescan.
  async function hwLoadAggregate(bt) {
    const seq = ++dashSeq;
    const acct = HW && HW.bitcoin && HW.bitcoin[bt] && HW.bitcoin[bt].acct;
    if (!acct || !acct.pub || !acct.chainCode) { hwAggregate = false; return renderHardware(); }
    let derived; try { derived = C.deriveReceiveAddrs(acct.pub, acct.chainCode, bt, 20, 0); }
    catch (_) { hwAggregate = false; return renderHardware(); }
    if (!isTN() && (!DASH_PRICES || !DASH_PRICES.bitcoin)) { try { DASH_PRICES = await fetch('api/prices').then((r) => r.json()); } catch (_) {} }
    const box = $('#dashAssets');
    let btcTotal = 0, done = 0;
    const tokMap = new Map(); const colls = []; const used = []; let primaryName = null;
    const N = 5;
    for (let i = 0; i < derived.length; i += N) {
      if (seq !== dashSeq) return; // user switched away mid-scan
      await Promise.all(derived.slice(i, i + N).map(async (d) => {
        try {
          const [bal, a2] = await Promise.all([
            fetch('api/btc/' + encodeURIComponent(d.address)).then((r) => r.json()).catch(() => ({})),
            fetch('api/btc/' + encodeURIComponent(d.address) + '/assets').then((r) => r.json()).catch(() => ({})),
          ]);
          const btc = (bal.balanceSats || 0) / 1e8; btcTotal += btc;
          const stampCpids = {}; (a2.stamps || []).forEach((s) => { if (s.cpid) stampCpids[s.cpid] = 1; });
          // SRC-20 `amount` arrives PRE-FORMATTED (fmtSrc20 → e.g. "1,249,078.1518"), so Number() on it is
          // NaN. Parse the numeric out for summing, but keep the original formatted string so a token on a
          // single address displays with full fidelity (only reformat when it truly spans >1 address).
          (a2.src20 || []).forEach((x) => { const k = 'src20:' + (x.tick || x.name); const cur = tokMap.get(k) || { kind: 'src20', name: x.tick, tick: x.tick, img: x.img, _num: 0, _n: 0, _disp0: x.amount }; cur._num += aggNum(x.amount); cur._n += 1; tokMap.set(k, cur); });
          (a2.counterparty || []).forEach((x) => { if (stampCpids[x.asset]) return; const amt = (x.qtyNormalized != null ? x.qtyNormalized : x.quantity); const k = 'cp:' + x.asset; const cur = tokMap.get(k) || { kind: 'cp', name: x.name || x.asset, asset: x.asset, _num: 0, _n: 0, _disp0: amt }; cur._num += aggNum(amt); cur._n += 1; tokMap.set(k, cur); });
          (a2.stamps || []).forEach((s) => colls.push({ kind: 'stamp', title: '#' + s.stamp, img: 'api/stamp/' + s.stamp + '/content', stamp: s.stamp, cpid: s.cpid, mime: s.mime || null, qty: (s.quantity != null ? Number(s.quantity) : 1), _idx: d.index }));
          const hasStuff = btc > 0 || (a2.stamps || []).length || (a2.src20 || []).length || (a2.counterparty || []).length;
          if (hasStuff) {
            used.push(d.index);
            // .btc names usually live on a single address — only query where there's activity
            try { const nm = await fetch('api/src101/names/' + encodeURIComponent(d.address)).then((r) => r.json()); if (nm && nm.primary && !primaryName) primaryName = nm.primary; (nm.names || []).filter((n) => !n.expired).forEach((n) => colls.unshift({ kind: 'name', title: n.name, name: n.name, img: n.img ? ('api/img?url=' + encodeURIComponent(n.img)) : null, primary: !!n.primary, expire: n.expire, deploy: n.deploy, addressRecord: n.addressRecord, _idx: d.index })); } catch (_) {}
          }
        } catch (_) {}
        done++;
        if (box && box.querySelector('.fine')) box.querySelector('.fine').textContent = `Scanning ${done} / ${derived.length} addresses…`;
      }));
    }
    if (seq !== dashSeq) return;
    // Finalize token display: single-address → keep the exact original formatted amount; multi-address →
    // show the summed numeric (formatted). This fixes SRC-20 balances that were showing 0 in aggregate.
    const tokens = [...tokMap.values()].map((t) => ({ kind: t.kind, name: t.name, tick: t.tick, asset: t.asset, img: t.img, amount: (t._n <= 1 ? t._disp0 : t._num.toLocaleString('en-US', { maximumFractionDigits: 8 })) }));
    hwAgg = { usedCount: used.length, indices: used.sort((x, y) => x - y), btcTotal, tokenCount: tokens.length, collCount: colls.length };
    DASH_ASSETS = { tokens, collectibles: colls, primaryName, note: '' };
    const price = (DASH_PRICES && DASH_PRICES.bitcoin) || 0;
    const uEl = $('#pfUsd-btc'), nEl = $('#pfNat-btc');
    if (uEl) uEl.textContent = mask(price ? '$' + fmt2(btcTotal * price) : '—');
    if (nEl) nEl.textContent = mask(fmtN(btcTotal, 8) + ' BTC');
    const chip = $('#aggChip'); if (chip) chip.textContent = '⊕ ' + used.length + ' address' + (used.length === 1 ? '' : 'es') + ' with holdings';
    renderDashAssets(null);
  }
  function hwBtcTypeMenu() {
    if (!HW || !HW.bitcoin) return;
    const types = [['nativeSegwit', 'Native SegWit · bc1q'], ['legacy', 'Legacy · 1… (OG Counterparty / Stamps)'], ['taproot', 'Taproot · bc1p'], ['nestedSegwit', 'Nested SegWit · 3…']].filter(([t]) => HW.bitcoin[t]);
    modal(`<h3 class="m-title">Bitcoin address type · Ledger</h3><div class="acct-list">${types.map(([t, l]) => `<button class="acct" data-t="${t}" style="width:100%;text-align:left;cursor:pointer;${t === hwBtcType ? 'border-color:var(--gold)' : ''}"><div class="acct-l"><span class="acct-lab">${l.split(' · ')[0]}</span><span class="acct-hint">${esc(l.split(' · ')[1] || '')}</span></div></button>`).join('')}</div><div class="wbtns"><button class="ghost" id="htClose">Close</button></div>`);
    $('#htClose').onclick = closeModal;
    $('#wmodalCard').querySelectorAll('[data-t]').forEach((b) => (b.onclick = () => { hwBtcType = b.dataset.t; hwViewAddr = null; hwViewIndex = null; hwAggregate = false; hwAgg = null; DASH_ASSETS = null; closeModal(); renderHardware(); }));
  }
  // Ledger address browser — the device hands out a fresh receiving address each time, so funds/assets
  // can sit beyond index 0. Derive the first 20 from the account key (locally, no device), scan each,
  // and let the user open the one holding their assets.
  async function hwScanAddrs() {
    const bt = HW && HW.bitcoin && HW.bitcoin[hwBtcType] ? hwBtcType : 'nativeSegwit';
    const acct = HW && HW.bitcoin && HW.bitcoin[bt] && HW.bitcoin[bt].acct;
    if (!acct || !acct.pub || !acct.chainCode) {
      modal(`<h3 class="m-title">Receiving addresses</h3><p class="fine">Your Ledger didn't return the account key needed to scan the address chain. You're on the main address (index 0). Try reconnecting, or update the Ledger Bitcoin app.</p><div class="wbtns"><button class="ghost" id="hsClose">Close</button></div>`);
      $('#hsClose').onclick = closeModal; return;
    }
    let derived;
    try { derived = C.deriveReceiveAddrs(acct.pub, acct.chainCode, bt, 20, 0); }
    catch (e) { modal(`<h3 class="m-title">Receiving addresses</h3><div class="statusline err">Could not derive addresses: ${esc(e.message || 'error')}</div><div class="wbtns"><button class="ghost" id="hsClose">Close</button></div>`); $('#hsClose').onclick = closeModal; return; }
    modal(`<h3 class="m-title">Receiving addresses · ${esc(BTC_LABEL[bt].split(' · ')[0])}</h3>
      <p class="fine">Ledger issues a fresh address each receive — scanning the first 20 for balances &amp; assets. Tap one to view its holdings.</p>
      <div id="hsBody"><div class="statusline load">Scanning 0 / ${derived.length}…</div></div>
      <div class="wbtns"><button class="ghost" id="hsClose">Close</button></div>`);
    $('#hsClose').onclick = closeModal;
    const results = []; let done = 0; const N = 5;
    for (let i = 0; i < derived.length; i += N) {
      await Promise.all(derived.slice(i, i + N).map(async (d) => {
        const sum = { btc: 0, tokens: 0, coll: 0, has: false };
        try {
          const [bal, assets] = await Promise.all([
            fetch('api/btc/' + encodeURIComponent(d.address)).then((r) => r.json()).catch(() => ({})),
            fetch('api/btc/' + encodeURIComponent(d.address) + '/assets').then((r) => r.json()).catch(() => ({})),
          ]);
          sum.btc = (bal.balanceSats || 0) / 1e8;
          const st = (assets.stamps || []).length, s2 = (assets.src20 || []).length, cp = (assets.counterparty || []).length;
          sum.tokens = s2 + cp; sum.coll = st; sum.has = sum.btc > 0 || st > 0 || s2 > 0 || cp > 0;
        } catch (_) {}
        results.push({ ...d, sum }); done++;
        const st = $('#hsBody'); if (st && st.querySelector('.load')) st.querySelector('.load').textContent = `Scanning ${done} / ${derived.length}…`;
      }));
    }
    results.sort((a, b) => a.index - b.index);
    const anyHas = results.some((r) => r.sum.has);
    const rows = results.map((r) => `<button class="acct hw-scan-row${r.sum.has ? ' has' : ''}" data-view="${esc(r.address)}" data-i="${r.index}" style="width:100%;text-align:left;cursor:pointer">
      <div class="acct-l"><span class="acct-lab">0/${r.index} · ${esc(shortA(r.address))}</span>
      <span class="acct-hint">${r.sum.btc > 0 ? fmtN(r.sum.btc, 8) + ' BTC' : '—'}${r.sum.tokens ? ' · ' + r.sum.tokens + ' token' + (r.sum.tokens === 1 ? '' : 's') : ''}${r.sum.coll ? ' · ' + r.sum.coll + ' collectible' + (r.sum.coll === 1 ? '' : 's') : ''}</span></div>
      <div class="acct-r">${r.sum.has ? '<span class="hw-has">●</span>' : ''}→</div></button>`).join('');
    const bodyEl = $('#hsBody');
    if (bodyEl) bodyEl.innerHTML = anyHas ? rows : `<div class="fine">No balances or assets found across the first 20 addresses (index 0–19). If your holdings are on higher indices, let me know and I'll raise the scan depth.</div>` + rows;
    if (bodyEl) bodyEl.querySelectorAll('[data-view]').forEach((b) => (b.onclick = () => { hwViewAddr = b.dataset.view; hwViewIndex = +b.dataset.i; DASH_ASSETS = null; closeModal(); renderHardware(); }));
  }
  // Ledger Receive: the ONE address the user already selected on the main view (current chain + BTC type,
  // or a browsed index) with a QR + copy — not a list. Browsing all types lives under Advanced → Addresses
  // / the ⧉ Addresses scan. Mirrors receiveView + the extension.
  function hwReceive() {
    if (!HW) return;
    const ch = dashChain;
    const addr = ch === 'btc' ? (hwViewAddr || (HW.bitcoin && hwAddr(hwBtcType))) : (HW[ch] ? HW[ch].address : null);
    if (!addr) return;
    const url = window.qrcode ? qrUrl(addr) : null;
    const COPY_IC = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
    modal(`<h3 class="m-title">Receive ${esc(DCH[ch].sym)} · Ledger</h3>
      <p class="fine">Your ${esc(DCH[ch].name)} address. Verify it on your Ledger before receiving large amounts.</p>
      ${url ? `<div class="qr-wrap"><img src="${url}" alt="address QR" width="230" height="230"/></div>` : '<div class="fine">QR unavailable.</div>'}
      <div class="recv-addr" role="button" tabindex="0" title="Tap to copy"><span class="ra-text">${esc(addr)}</span><span class="ra-copy" aria-hidden="true">${COPY_IC}</span></div>`);
    const ra = $('#wmodalCard').querySelector('.recv-addr'), rc = ra.querySelector('.ra-copy'), orig = rc.innerHTML;
    const doCopy = async () => {
      try { await navigator.clipboard.writeText(addr); } catch (_) {}
      ra.classList.add('copied'); rc.innerHTML = '✓ Copied';
      clearTimeout(ra._t); ra._t = setTimeout(() => { ra.classList.remove('copied'); rc.innerHTML = orig; }, 1300);
    };
    ra.onclick = doCopy;
    ra.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); doCopy(); } };
  }
  async function hwDisconnect() {
    try { if (window.HardwareWallet && window.HardwareWallet.disconnect) await window.HardwareWallet.disconnect(); } catch (_) {}
    HW = null; hwViewAddr = null; hwViewIndex = null; hwAggregate = false; hwAgg = null; acctKind = 'hd'; render();
  }

  // Account selector: HD accounts + watch-only entries (shared localStorage with the extension popup).
  // ── Account picker (extension "Pro" format): a name button that opens a grouped Accounts modal with
  //    per-account rename/delete and an add entry — replaces the old native <select>. ──
  const KEBAB_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg>';
  function acctDisplayName(kind, key, obj) {
    if (kind === 'hd') { const nm = loadMap(ACCT_NAMES); let s = `Account ${key}${nm[key] ? ' · ' + nm[key] : ''}`; if (dashChain === 'btc' && acctBtcType(key) !== 'nativeSegwit') s += ' · ' + BTC_LABEL[acctBtcType(key)]; return s; }
    if (kind === 'imp') { const im = obj || IMPORTED.find((x) => x.id === key); return loadMap('ww:impnames')[key] || (im && im.label) || shortA((im && im.bitcoin && im.bitcoin.nativeSegwit && im.bitcoin.nativeSegwit.address) || key); }
    if (kind === 'watch') { const w = obj || watchList().find((x) => x.id === key); return loadMap('ww:watchnames')[key] || (w && w.label) || shortA(w && w.address); }
    if (kind === 'hw') return '🔐 Ledger';
    return String(key);
  }
  function currentAccountName() {
    if (acctKind === 'imported') return acctDisplayName('imp', impId) + ' · imported';
    if (acctKind === 'watch') return acctDisplayName('watch', watchId);
    if (acctKind === 'hardware') return '🔐 Ledger';
    return acctDisplayName('hd', curAccount);
  }
  function acctBtnHtml() {
    return `<button class="acct-switch" id="acctBtn" title="Switch account"><span class="acct-switch-name">${esc(currentAccountName())}</span><span class="chev">▾</span></button>`;
  }
  // Blockchain switcher (top-left) — the whole wallet is dedicated to the chosen chain. Interactive for HD
  // accounts (BTC/ETH/SOL); watch-only / imported are single-chain so it renders as a static chip.
  function chainBtnHtml(interactive) {
    const c = DCH[dashChain];
    // Logo-only (no name label), matching the extension's chain switcher.
    return `<button class="chain-btn${interactive ? '' : ' static'}" ${interactive ? 'id="chainBtn"' : 'disabled'} title="${interactive ? 'Switch blockchain · ' + esc(c.name) : esc(c.name)}"><span class="cs-ic ${dashChain}">${c.ic}</span>${interactive ? '<span class="chev">▾</span>' : ''}</button>`;
  }
  function chainPicker() {
    modal(`<h3 class="m-title">Choose blockchain</h3>
      <div class="chain-menu">${['btc', 'eth', 'sol'].map((k) => `<button class="chain-opt${k === dashChain ? ' on' : ''}" data-ch="${k}"><span class="cs-ic ${k}">${DCH[k].ic}</span><span class="chain-opt-nm">${esc(DCH[k].name)}</span><span class="chain-opt-sym">${DCH[k].sym}</span>${k === dashChain ? '<span class="adot"></span>' : ''}</button>`).join('')}</div>
      <div class="wbtns"><button class="ghost" id="chClose">Close</button></div>`);
    $('#chClose').onclick = closeModal;
    $('#wmodalCard').querySelectorAll('[data-ch]').forEach((b) => (b.onclick = () => { dashChain = b.dataset.ch; dashTab = 'tokens'; DASH_ASSETS = null; closeModal(); renderUnlocked(); }));
  }
  function acctPickerRow(kind, key, label, sel, hasMenu) {
    return `<div class="acct-item"><button class="acct-pick${sel ? ' on' : ''}" data-sw="${kind}:${esc(String(key))}">${sel ? '<span class="adot"></span>' : ''}${esc(label)}</button>${hasMenu ? `<button class="acct-kebab" data-menu="${kind}:${esc(String(key))}" title="Rename / delete">${KEBAB_SVG}</button>` : ''}</div>`;
  }
  function accountPicker() {
    let rows = '<div class="acct-grp">My accounts</div>';
    acctList().forEach((i) => { rows += acctPickerRow('hd', i, acctDisplayName('hd', i), acctKind === 'hd' && i === curAccount, true); });
    if (IMPORTED.length) { rows += '<div class="acct-grp">Imported</div>'; IMPORTED.forEach((im) => { rows += acctPickerRow('imp', im.id, acctDisplayName('imp', im.id, im) + ' · imported', acctKind === 'imported' && impId === im.id, true); }); }
    const wl = watchList();
    if (wl.length) { rows += '<div class="acct-grp">Watching</div>'; wl.forEach((w) => { rows += acctPickerRow('watch', w.id, acctDisplayName('watch', w.id, w) + ' · ' + ((DCH[CHAIN_OF[w.chain]] || {}).sym || '?'), acctKind === 'watch' && watchId === w.id, true); }); }
    if (HW) { rows += '<div class="acct-grp">Hardware</div>' + acctPickerRow('hw', 'hw', '🔐 Ledger', acctKind === 'hardware', false); }
    modal(`<h3 class="m-title">Accounts</h3><div class="acct-picker">${rows}</div>
      <div class="wbtns"><button class="ghost" id="apAdd">＋ Add account · import · watch-only</button><button class="ghost" id="apClose">Close</button></div>`);
    $('#apClose').onclick = closeModal;
    $('#apAdd').onclick = () => { closeModal(); acctAddMenu(); };
    $('#wmodalCard').querySelectorAll('[data-sw]').forEach((b) => (b.onclick = () => switchAcctRef(b.dataset.sw)));
    $('#wmodalCard').querySelectorAll('[data-menu]').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); acctItemMenu(b.dataset.menu); }));
  }
  function switchAcctRef(ref) {
    const p = ref.split(':'), kind = p[0], key = p.slice(1).join(':');
    if (kind === 'hw') { if (HW) { acctKind = 'hardware'; dashChain = 'btc'; } }
    else if (kind === 'hd') { acctKind = 'hd'; curAccount = parseInt(key, 10) || 0; }
    else if (kind === 'watch') { acctKind = 'watch'; watchId = key; }
    else if (kind === 'imp') { acctKind = 'imported'; impId = key; dashChain = 'btc'; }
    DASH_ASSETS = null; closeModal(); render();
  }
  function acctItemMenu(ref) {
    const p = ref.split(':'), kind = p[0], key = p.slice(1).join(':');
    const canDelete = kind === 'imp' || kind === 'watch' || (kind === 'hd' && Number(key) >= DEFAULT_ACCTS);
    modal(`<h3 class="m-title">${esc(acctDisplayName(kind, key))}</h3>
      <div class="adv-menu">
        <button class="adv-opt" data-a="rename"><b>✎ Rename / nickname</b><span>Give this account a label</span></button>
        ${canDelete ? '<button class="adv-opt danger" data-a="delete"><b>🗑 Delete</b><span>Remove from this device (nothing on-chain changes)</span></button>' : ''}
      </div><div class="wbtns"><button class="ghost" id="aimBack">Back</button></div>`);
    $('#aimBack').onclick = accountPicker;
    $('#wmodalCard').querySelectorAll('[data-a]').forEach((b) => (b.onclick = () => { if (b.dataset.a === 'rename') acctItemRename(kind, key); else acctItemDelete(kind, key); }));
  }
  function acctItemRename(kind, key) {
    const map = kind === 'hd' ? ACCT_NAMES : kind === 'imp' ? 'ww:impnames' : 'ww:watchnames';
    namePrompt('Rename / nickname', loadMap(map)[key] || '', (v) => { const m = loadMap(map); if (v) m[key] = v; else delete m[key]; saveMap(map, m); accountPicker(); });
  }
  function acctItemDelete(kind, key) {
    closeModal();
    if (kind === 'hd') removeAccountFlow(Number(key));
    else if (kind === 'imp') { impId = key; acctKind = 'imported'; importedRemoveFlow(); }
    else if (kind === 'watch') { watchId = key; acctKind = 'watch'; removeWatchFlow(); }
  }
  // Remember the last-selected account + chain so a refresh returns to where you were (not Account 0).
  function saveLastAcct() {
    try {
      localStorage.setItem('ww:lastacct', acctKind === 'hardware' ? 'hw' : acctKind === 'watch' ? 'watch:' + watchId : acctKind === 'imported' ? 'imp:' + impId : 'hd:' + curAccount);
      localStorage.setItem('ww:lastchain', dashChain);
    } catch (_) {}
  }
  function restoreLastAcct() {
    let v = null, lc = null;
    try { v = localStorage.getItem('ww:lastacct'); lc = localStorage.getItem('ww:lastchain'); } catch (_) {}
    if (v) {
      if (v.indexOf('watch:') === 0) { const id = v.slice(6); if (watchList().some((w) => w.id === id)) { acctKind = 'watch'; watchId = id; } }
      else if (v.indexOf('imp:') === 0) { const iid = v.slice(4); if (IMPORTED.some((x) => x.id === iid)) { acctKind = 'imported'; impId = iid; dashChain = 'btc'; } }
      else if (v.indexOf('hd:') === 0) { const i = parseInt(v.slice(3), 10); if (acctList().indexOf(i) >= 0) { acctKind = 'hd'; curAccount = i; } }
    }
    if (acctKind !== 'watch' && lc && DCH[lc]) dashChain = lc; // watch-only is single-chain
  }
  function acctAddMenu() {
    modal(`<h3 class="m-title">Add account</h3>
      <p class="fine">New Bitcoin account — pick its default address type (Ethereum / Solana addresses are the same regardless). You can switch it later.</p>
      <div class="adv-menu">
        ${BTC_TYPES.map(([t, l, p]) => `<button class="adv-opt" data-add="${t}"><b>${l} · ${p}</b><span>New Bitcoin account</span></button>`).join('')}
        <button class="adv-opt" data-add="import"><b>🔑 Import address (private key)</b><span>Restore & sign from a WIF private key</span></button>
        <button class="adv-opt" data-add="cw"><b>↩ Import a Counterwallet / FreeWallet</b><span>Add its legacy 1… addresses (Stamps · Counterparty · SRC-20) to this wallet — imports keys, not a new seed</span></button>
        <button class="adv-opt" data-add="watch"><b>👁 Add watch-only</b><span>Track any BTC / ETH / SOL address — no keys</span></button>
      </div><div class="wbtns"><button class="ghost" id="aamClose">Close</button></div>`);
    $('#aamClose').onclick = closeModal;
    $('#wmodalCard').querySelectorAll('[data-add]').forEach((b) => (b.onclick = () => {
      const a = b.dataset.add;
      if (a === 'watch') { closeModal(); addWatchFlow(); return; }
      if (a === 'import') { closeModal(); importAddressFlow(); return; }
      if (a === 'cw') { closeModal(); cwImportFlow(); return; }
      const idx = addAcct(); setAcctBtcType(idx, a); acctKind = 'hd'; curAccount = idx; dashChain = 'btc'; DASH_ASSETS = null; closeModal(); renderUnlocked();
    }));
  }
  // Import a WIF private key → restores its address; encrypted in the vault (password re-auth).
  function importAddressFlow() {
    let addrs = null;
    modal(`<h3 class="m-title">Import address</h3>
      <p class="fine">Paste a Bitcoin <b>private key (WIF)</b> to restore that address here. It’s encrypted in your wallet and can <b>sign &amp; send</b> — like your own accounts.</p>
      <input id="imWif" class="m-in" type="password" placeholder="Private key (WIF, starts with K / L / 5)" spellcheck="false" autocomplete="off"/>
      <div id="imPrev" class="fine"></div>
      <input id="imLabel" class="m-in" type="text" maxlength="40" placeholder="Label (optional, e.g. Cold storage)"/>
      <input id="imPw" class="m-in" type="password" placeholder="Your wallet password" autocomplete="current-password"/>
      <div id="imErr" class="statusline err" hidden></div>
      <div class="wbtns"><button class="ghost" id="imCancel">Cancel</button><button class="primary" id="imGo">Import</button></div>`);
    const wifEl = $('#imWif'), pv = $('#imPrev');
    wifEl.oninput = () => { const w = wifEl.value.trim(); pv.innerHTML = ''; if (w.length < 50) return; try { addrs = C.importedAddresses(w); pv.innerHTML = `Restores: <span class="vmono" style="color:var(--gold2)">${esc(addrs.nativeSegwit.address)}</span> <span class="fine">(+ legacy / taproot / nested — pick after import)</span>`; } catch (_) { pv.innerHTML = '<span style="color:var(--red)">Not a valid mainnet WIF.</span>'; } };
    $('#imCancel').onclick = closeModal;
    $('#imGo').onclick = async () => {
      const e = $('#imErr'); e.hidden = true;
      const w = wifEl.value.trim(), pw = $('#imPw').value, label = $('#imLabel').value.trim();
      if (!w) { e.hidden = false; e.textContent = 'Paste a private key.'; return; }
      if (!pw) { e.hidden = false; e.textContent = 'Enter your wallet password.'; return; }
      $('#imGo').disabled = true;
      try { const res = await C.importKey(w, pw, label); impId = res.id; acctKind = 'imported'; dashChain = 'btc'; DASH_ASSETS = null; closeModal(); refreshImported(); renderUnlocked(); }
      catch (err) { $('#imGo').disabled = false; e.hidden = false; e.textContent = /wrong_password/.test(err.message) ? 'Wrong wallet password.' : /wif/i.test(err.message) ? 'Not a valid mainnet private key (WIF).' : (err.message || 'Import failed.'); }
    };
  }
  // Import a 12-word Counterwallet / FreeWallet passphrase (Electrum-v1, NOT BIP-39): derive its legacy
  // 1… addresses (m/0'/0/i), scan the first 10 for Counterparty / Stamps / SRC-20 activity, import the
  // active ones as signable keys, and default them to the legacy type (where the assets live).
  function cwImportFlow() {
    modal(`<h3 class="m-title">Import a Counterwallet / FreeWallet</h3>
      <p class="fine">Bring an <b>old Counterwallet / FreeWallet</b> into <b>this</b> wallet — it does <b>not</b> replace your seed. Paste its <b>12-word passphrase</b>; Wonder derives the legacy <b>1…</b> addresses, scans them for Counterparty / Stamps / SRC-20, and imports the active ones' <b>keys</b> — signable alongside your own accounts (just like importing a private key). This is <b>not</b> a BIP-39 seed. <i>To use a Counterwallet as your MAIN wallet instead, forget this wallet and Restore it from the sign-in screen.</i></p>
      <textarea id="cwPhrase" class="m-in" rows="2" placeholder="twelve words separated by spaces" spellcheck="false" autocomplete="off" style="resize:vertical;font-family:var(--mono);font-size:12px"></textarea>
      <div id="cwPrev" class="fine"></div>
      <input id="cwPw" class="m-in" type="password" placeholder="Your wallet password" autocomplete="current-password"/>
      <div id="cwErr" class="statusline" hidden></div>
      <div class="wbtns"><button class="ghost" id="cwCancel">Cancel</button><button class="primary" id="cwGo" disabled>Scan &amp; import</button></div>`);
    const ph = $('#cwPhrase'), pv = $('#cwPrev'), go = $('#cwGo');
    ph.oninput = () => {
      const p = ph.value.trim().replace(/\s+/g, ' '); pv.innerHTML = ''; go.disabled = true;
      if (!p) return;
      try {
        if (C.isCwPhrase(p)) { const a0 = C.cwDeriveAddrs(p, 0, 1)[0].address; pv.innerHTML = `Primary address: <span class="vmono" style="color:var(--gold2)">${esc(a0)}</span>`; go.disabled = false; }
        else { const n = p.split(' ').filter(Boolean).length; pv.innerHTML = `<span style="color:var(--red)">${n === 12 ? 'Not a Counterwallet passphrase — unknown words (this is the 1626-word Counterwallet list, not BIP-39).' : n + ' words — a Counterwallet passphrase is 12.'}</span>`; }
      } catch (_) { pv.innerHTML = '<span style="color:var(--red)">Could not read that passphrase.</span>'; }
    };
    $('#cwCancel').onclick = closeModal;
    go.onclick = async () => {
      const e = $('#cwErr'); e.hidden = false; e.className = 'statusline load';
      const p = ph.value.trim().replace(/\s+/g, ' '), pw = $('#cwPw').value;
      if (!C.isCwPhrase(p)) { e.className = 'statusline err'; e.textContent = 'Enter a valid 12-word Counterwallet passphrase.'; return; }
      if (!pw) { e.className = 'statusline err'; e.textContent = 'Enter your wallet password.'; return; }
      go.disabled = true; e.textContent = 'Deriving & scanning your addresses…';
      try {
        const derived = C.cwDeriveAddrs(p, 0, 10); // legacy 1… addresses at m/0'/0/i
        const active = [];
        for (let i = 0; i < derived.length; i += 4) {
          await Promise.all(derived.slice(i, i + 4).map(async (d) => {
            try { const r = await fetch('api/btc/' + d.address + '/assets').then((x) => x.json()); const has = (r.counterparty || []).length + (r.stamps || []).length + (r.src20 || []).length; if (d.index === 0 || has > 0) active.push(d); }
            catch (_) { if (d.index === 0) active.push(d); }
          }));
        }
        active.sort((a, b) => a.index - b.index);
        e.textContent = `Importing ${active.length} address${active.length === 1 ? '' : 'es'}…`;
        const res = await C.importKeys(active.map((d) => d.wif), pw, active.map((d) => 'Counterparty · 0/' + d.index));
        res.forEach((r) => setImpBtcType(r.id, 'legacy')); // CP/Stamps assets live on the legacy address
        impId = res[0].id; acctKind = 'imported'; dashChain = 'btc'; DASH_ASSETS = null; closeModal(); refreshImported(); renderUnlocked();
      } catch (err) { go.disabled = false; e.className = 'statusline err'; e.textContent = /wrong_password/.test(err.message) ? 'Wrong wallet password.' : (err.message || 'Import failed.'); }
    };
  }
  // Switch the current account's Bitcoin address type (reach account 0's Legacy `1…`, etc.) with previews.
  function btcTypeMenu() {
    let addrs, curType, setType, title;
    if (acctKind === 'imported') { const im = currentImported(); if (!im) return; addrs = im.bitcoin; curType = impBtcType(impId); setType = (t) => setImpBtcType(impId, t); title = 'Bitcoin address type · imported'; }
    else { let acc; try { acc = C.accounts(curAccount, 0, NET()); } catch (_) { return; } addrs = acc.bitcoin; curType = acctBtcType(curAccount); setType = (t) => setAcctBtcType(curAccount, t); title = `Bitcoin address type · Account ${curAccount}`; }
    modal(`<h3 class="m-title">${title}</h3>
      <div class="adv-menu">${BTC_TYPES.map(([t, l]) => `<button class="adv-opt${t === curType ? ' on' : ''}" data-t="${t}"><b>${l}</b><span class="vmono">${esc((addrs[t] || {}).address || '')}</span></button>`).join('')}</div>
      <div class="wbtns"><button class="ghost" id="btClose">Close</button></div>`);
    $('#btClose').onclick = closeModal;
    $('#wmodalCard').querySelectorAll('[data-t]').forEach((b) => (b.onclick = () => { setType(b.dataset.t); DASH_ASSETS = null; closeModal(); renderUnlocked(); }));
  }
  // Remove an imported key (password re-auth).
  function importedRemoveFlow() {
    modal(`<h3 class="m-title">Remove imported address?</h3>
      <p class="fine">This forgets the private key from this wallet. <b>Back up the WIF first</b> — it can’t be recovered from your seed phrase.</p>
      <input id="irPw" class="m-in" type="password" placeholder="Your wallet password" autocomplete="current-password"/>
      <div id="irErr" class="statusline err" hidden></div>
      <div class="wbtns"><button class="ghost" id="irCancel">Cancel</button><button class="primary danger" id="irGo">Remove</button></div>`);
    $('#irCancel').onclick = closeModal;
    $('#irGo').onclick = async () => {
      const e = $('#irErr'); e.hidden = true;
      try { await C.removeImportedKey(impId, $('#irPw').value); impId = null; acctKind = 'hd'; curAccount = 0; DASH_ASSETS = null; closeModal(); render(); }
      catch (err) { e.hidden = false; e.textContent = /wrong_password/.test(err.message) ? 'Wrong password.' : (err.message || 'Could not remove.'); }
    };
  }
  function removeAccountFlow(i) {
    modal(`<h3 class="m-title">Remove Account ${i}?</h3>
      <p class="fine">This hides it from your wallet — its funds are safe and it can be re-added anytime (it derives from your seed). Accounts 0–3 are locked defaults and can't be removed.</p>
      <div class="wbtns"><button class="ghost" id="raCancel">Cancel</button><button class="primary danger" id="raGo">Remove</button></div>`);
    $('#raCancel').onclick = closeModal;
    $('#raGo').onclick = () => { if (removeAcct(i)) { acctKind = 'hd'; curAccount = 0; DASH_ASSETS = null; } closeModal(); renderUnlocked(); };
  }
  function removeWatchFlow() {
    const w = currentWatch(); if (!w) return;
    modal(`<h3 class="m-title">Remove watch-only address?</h3>
      <p class="fine">Stop watching <b>${esc(w.label || shortA(w.address))}</b>${w.label ? ` <span class="mono">(${esc(shortA(w.address))})</span>` : ''}. This only removes it from your wallet view — nothing on-chain changes, and you can re-add it anytime.</p>
      <div class="wbtns"><button class="ghost" id="rwCancel">Cancel</button><button class="primary danger" id="rwGo">Remove</button></div>`);
    $('#rwCancel').onclick = closeModal;
    $('#rwGo').onclick = () => { lsSet('ww:watch', watchList().filter((x) => x.id !== watchId)); watchId = null; acctKind = 'hd'; DASH_ASSETS = null; closeModal(); renderUnlocked(); };
  }
  function addWatchFlow() {
    modal(`<h3 class="m-title">Add watch-only address</h3>
      <p class="fine">Track any Bitcoin, Ethereum or Solana address read-only. Stored locally in your browser; no keys required.</p>
      <input id="waIn" class="m-in" placeholder="bc1… / 1… / 0x… / Solana address" spellcheck="false"/>
      <input id="waLabel" class="m-in" placeholder="Label (optional)" style="margin-top:8px"/>
      <div id="waErr" class="statusline err" hidden></div>
      <div class="wbtns"><button class="ghost" id="waCancel">Cancel</button><button class="primary" id="waAdd">Add</button></div>`);
    const inp = $('#waIn'); inp.focus();
    $('#waCancel').onclick = closeModal;
    $('#waAdd').onclick = async () => {
      const v = inp.value.trim(), err = $('#waErr'); err.hidden = true;
      let ch = null; try { ch = (await fetch('api/detect/' + encodeURIComponent(v)).then((r) => r.json())).chain; } catch (_) {}
      if (!ch) { err.hidden = false; err.textContent = 'Unrecognized address format.'; return; }
      const wl = watchList(); if (wl.some((x) => x.address === v)) { err.hidden = false; err.textContent = 'Already watching this address.'; return; }
      const id = 'w' + Date.now(); wl.unshift({ id, chain: ch, address: v, label: $('#waLabel').value.trim() }); lsSet('ww:watch', wl);
      acctKind = 'watch'; watchId = id; DASH_ASSETS = null; closeModal(); renderUnlocked();
    };
    inp.onkeydown = (e) => { if (e.key === 'Enter') $('#waAdd').click(); };
  }

  // Portfolio strip — native balance + USD per chain (or the single watched chain), plus a grand total.
  async function loadPortfolio(acc) {
    try { if (!isTN() && !DASH_PRICES.bitcoin) DASH_PRICES = await fetch('api/prices').then((r) => r.json()); } catch (_) {}
    const chains = [dashChain]; // the wallet is dedicated to the switched-to chain — only its balance is shown
    const natOf = (ch, addr) => {
      if (!addr) return Promise.resolve(0);
      if (ch === 'btc') return fetch('api/btc/' + encodeURIComponent(addr)).then((r) => r.json()).then((d) => (d.balanceSats || 0) / 1e8).catch(() => 0);
      if (ch === 'eth') return fetch('api/eth/' + encodeURIComponent(addr)).then((r) => r.json()).then((d) => d.eth || 0).catch(() => 0);
      return fetch('api/sol/' + encodeURIComponent(addr)).then((r) => r.json()).then((d) => d.sol || 0).catch(() => 0);
    };
    let total = 0; PF = { usd: {}, nat: {}, total: 0 };
    await Promise.all(chains.map(async (ch) => {
      const nat = await natOf(ch, activeAddr(acc, ch)); const usd = nat * (DASH_PRICES[DCH[ch].price] || 0); total += usd;
      PF.usd[ch] = usd; PF.nat[ch] = nat;
    }));
    PF.total = total;
    paintPortfolio(); // mask-aware (privacy view)
  }

  // Emblem vault deep-link from the extension popup: #vault=<cpid>&s=<stamp> → open the bridge scoped to that asset.
  function checkVaultDeepLink(acc) {
    if (_vaultDL) return;
    const h = location.hash || ''; const m = /[#&]vault=([^&]*)/.exec(h); if (!m) return;
    _vaultDL = true;
    const cpid = decodeURIComponent(m[1] || ''); const sm = /[#&]s=([^&]*)/.exec(h); const label = sm ? ('#' + decodeURIComponent(sm[1])) : (cpid || 'asset');
    try { history.replaceState(null, '', location.pathname + location.search); } catch (_) { try { location.hash = ''; } catch (e) {} }
    if (!cpid) return;
    const btc = acc.bitcoin.nativeSegwit.address;
    if (window.EmblemBridge && window.EmblemBridge.vaultAsset) window.EmblemBridge.vaultAsset(acc.account, acc.ethereum.address, btc, cpid, { label });
  }

  // Per-chain asset loader (mirrors the extension popup's shapes for parity).
  async function loadDashAssets(acc) {
    const seq = ++dashSeq; DASH_ASSETS = null;
    const ch = dashChain, addr = activeAddr(acc, ch);
    const res = { tokens: [], collectibles: [], note: '' };
    if (!addr) { DASH_ASSETS = res; return renderDashAssets(acc); }
    try {
      if (ch === 'btc') {
        const a = await fetch('api/btc/' + encodeURIComponent(addr) + '/assets').then((r) => r.json());
        const stampCpids = {}; (a.stamps || []).forEach((s) => { if (s.cpid) stampCpids[s.cpid] = 1; });
        (a.src20 || []).forEach((x) => res.tokens.push({ kind: 'src20', name: x.tick, amount: x.amount, img: x.img, tick: x.tick }));
        (a.counterparty || []).forEach((x) => { if (stampCpids[x.asset]) return; res.tokens.push({ kind: 'cp', name: x.name || x.asset, amount: (x.qtyNormalized != null ? x.qtyNormalized : x.quantity), asset: x.asset }); });
        res.collectibles = (a.stamps || []).map((s) => ({ kind: 'stamp', title: '#' + s.stamp, img: 'api/stamp/' + s.stamp + '/content', stamp: s.stamp, cpid: s.cpid, mime: s.mime || null, qty: (s.quantity != null ? Number(s.quantity) : 1) }));
        // SRC-101 (.btc names) — surface the account's names as collectibles + capture the primary name.
        try {
          const nm = await fetch('api/src101/names/' + encodeURIComponent(addr)).then((r) => r.json());
          res.primaryName = nm.primary || null;
          (nm.names || []).filter((n) => !n.expired).forEach((n) => res.collectibles.unshift({
            kind: 'name', title: n.name, name: n.name, img: n.img ? ('api/img?url=' + encodeURIComponent(n.img)) : null,
            primary: !!n.primary, expire: n.expire, deploy: n.deploy, addressRecord: n.addressRecord,
          }));
        } catch (_) {}
      } else if (ch === 'eth') {
        const e = await fetch('api/eth/' + encodeURIComponent(addr)).then((r) => r.json());
        res.tokens = (e.tokens || []).map((t) => ({ kind: 'erc20', name: t.symbol, amount: t.amount, address: t.address, decimals: t.decimals }));
        try {
          const nf = await fetch('api/eth/' + encodeURIComponent(addr) + '/nfts').then((r) => r.json());
          const arr = nf.items || [];
          res.collectibles = arr.slice(0, 60).map((n) => ({ kind: 'ethnft', title: n.name || 'NFT', img: n.image ? ('api/img?url=' + encodeURIComponent(n.image)) : null, contract: n.contract, tokenId: n.tokenId, tokenType: n.tokenType }));
          if (!arr.length && nf.enabled === false) res.note = 'Ethereum NFT gallery needs a provider — ask the wallet host to set an ALCHEMY_KEY (like Solana’s HELIUS_KEY).';
        } catch (_) {}
      } else {
        const so = await fetch('api/sol/' + encodeURIComponent(addr)).then((r) => r.json());
        res.tokens = (so.tokens || []).filter((t) => t.amount > 0).slice(0, 100).map((t) => ({ kind: 'spl', name: shortA(t.mint), amount: t.amount, mint: t.mint, decimals: t.decimals }));
        try { const nf = await fetch('api/sol/' + encodeURIComponent(addr) + '/nfts').then((r) => r.json()); const arr = nf.items || []; res.collectibles = arr.slice(0, 60).map((n) => ({ kind: 'solnft', title: n.name || 'NFT', img: n.image ? ('api/img?url=' + encodeURIComponent(n.image)) : null, compressed: n.compressed, id: n.id })); if (!arr.length && nf.dasEnabled === false) res.note = 'Solana NFT gallery needs a DAS provider (HELIUS_KEY).'; } catch (_) {}
      }
    } catch (_) {}
    if (seq !== dashSeq) return; // stale
    // Over-commit safety: subtract in-flight committed spends (WWPending) so every readout of DASH_ASSETS
    // (the token list AND the send forms that read t.amount) shows what's actually available. Reconcile in
    // the background to auto-restore amounts whose tx confirmed (already reflected) or dropped/failed.
    try {
      if (ch === 'btc' && window.WWPending) {
        window.WWPending.reconcile(addr);
        res.tokens.forEach((tk) => {
          const sym = tk.asset || tk.tick; if (!sym) return;
          const pend = window.WWPending.pending(addr, sym); if (!(pend > 0)) return;
          tk.amount = Math.max(0, aggNum(tk.amount) - pend).toLocaleString('en-US', { maximumFractionDigits: 8 });
        });
      }
    } catch (_) {}
    DASH_ASSETS = res; renderDashAssets(acc);
  }

  // ── Asset favorites (star / pin). Stored per-origin in localStorage ww:fav (auto-captured by Backup). ──
  function favKey(t) {
    if (!t) return '';
    if (t.stamp != null) return 'st:' + t.stamp;                                              // Bitcoin Stamp
    if (t.kind === 'name') return 'nm:' + String(t.name || t.title).toUpperCase();             // .btc name
    if (t.contract) return 'e:' + String(t.contract).toLowerCase() + ':' + (t.tokenId != null ? t.tokenId : ''); // ETH NFT
    if (t.id) return 'so:' + String(t.id);                                                     // SOL NFT
    if (t.tick || t.kind === 'src20' || t.src20) return 's:' + String(t.tick || t.name).toUpperCase();
    if (t.asset) return 'c:' + String(t.asset).toUpperCase();
    if (t.address) return 'e:' + String(t.address).toLowerCase();
    return 'n:' + String(t.name || t.title || '').toUpperCase();
  }
  function loadFavs() { try { return new Set(JSON.parse(localStorage.getItem('ww:fav') || '[]')); } catch (_) { return new Set(); } }
  function isFav(t) { return loadFavs().has(favKey(t)); }
  function toggleFav(t) { const s = loadFavs(), k = favKey(t); if (s.has(k)) s.delete(k); else s.add(k); try { localStorage.setItem('ww:fav', JSON.stringify([...s])); } catch (_) {} return s.has(k); }
  const FAV_STAR = '★';
  const abbrevQty = (q) => { const n = Number(q); if (!isFinite(n)) return String(q); if (n >= 1e9) return +(n / 1e9).toFixed(1) + 'B'; if (n >= 1e6) return +(n / 1e6).toFixed(1) + 'M'; return n.toLocaleString('en-US'); }; // full up to 999,999, then M/B

  function renderDashAssets(acc) {
    DASH_ACC = acc; // cache for privacy-toggle repaint
    const chip = $('#pnameChip');
    if (chip) {
      if (dashChain === 'btc' && DASH_ASSETS && DASH_ASSETS.primaryName) {
        chip.hidden = false; chip.innerHTML = STAR + ' ' + esc(DASH_ASSETS.primaryName);
        chip.onclick = () => { const nm = (DASH_ASSETS.collectibles || []).find((c) => c.kind === 'name' && c.primary) || (DASH_ASSETS.collectibles || []).find((c) => c.kind === 'name'); if (nm) nameDetailModal(nm, acc); };
      } else { chip.hidden = true; chip.onclick = null; }
    }
    const box = $('#dashAssets'); if (!box) return;
    if (!DASH_ASSETS) { box.innerHTML = '<div class="fine">Loading…</div>'; return; }
    if (dashTab === 'tokens') {
      if (!DASH_ASSETS.tokens.length) { box.innerHTML = `<div class="dash-empty">No tokens on this ${esc(DCH[dashChain].name)} address.</div>`; return; }
      const favs = loadFavs();
      DASH_ASSETS.tokens.sort((a, b) => (favs.has(favKey(b)) ? 1 : 0) - (favs.has(favKey(a)) ? 1 : 0)); // favorites pinned on top (stable sort keeps the rest)
      const nTok = DASH_ASSETS.tokens.length;
      box.innerHTML = `<div class="tok-grid-wrap" style="max-height:430px;overflow-y:auto;padding-right:2px">
        <div class="tok-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:6px">${DASH_ASSETS.tokens.map((t, i) => {
        const ic = t.img ? `<img class="at-ic" loading="lazy" src="api/img?url=${encodeURIComponent(t.img)}"/>`
          : (t.kind === 'cp' && t.asset ? `<img class="at-ic" loading="lazy" alt="" src="api/cp/assetimg/${encodeURIComponent(t.asset)}" data-cpic="${esc(String(t.name || '?').slice(0, 2))}"/>`
            : `<span class="at-ic ph">${esc(String(t.name || '?').slice(0, 2))}</span>`);
        const act = ((acc || acctKind === 'connected') && t.kind === 'src20') ? `<button class="mini" data-send="${i}">Send</button>` : (t.kind === 'cp' ? (acctKind === 'connected' ? `<button class="mini" data-cpsend="${i}">Send</button>` : `<button class="mini" data-cp="${i}">View</button>`) : '');
        const nameAttr = t.kind === 'cp' ? ` data-cprow="${i}" title="View asset" style="cursor:pointer;display:flex;align-items:center;gap:8px;flex:1;min-width:0"` : ` style="display:flex;align-items:center;gap:8px;flex:1;min-width:0"`;
        return `<div class="tok-cell" style="background:var(--surface2,#17131f);border:1px solid var(--border,#2a2436);border-radius:9px;padding:8px 10px;min-width:0">
          <div style="display:flex;align-items:center;gap:6px"><button class="fav-star${favs.has(favKey(t)) ? ' on' : ''}" data-fav="${i}" title="Pin favorite">${FAV_STAR}</button><span${nameAttr}>${ic}<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.name)}</span></span>${act}</div>
          <div class="at-amt" style="font-weight:600;font-size:13px;margin-top:4px;word-break:break-all;opacity:.92">${esc(mask(String(t.amount)))}</div></div>`;
      }).join('')}</div></div>
        ${nTok > 20 ? `<button class="ghost sm" id="tokExpand" style="margin-top:8px;width:100%">Show all ${nTok}</button>` : ''}`;
      const assetFrom = acctKind === 'imported' ? impBtcAddr() : (acc && acc.bitcoin ? acctBtcAddr(acc) : null); // the CURRENTLY-SELECTED btc type (Legacy/Taproot/…), not hardcoded native segwit — matches the loaded assets
      box.querySelectorAll('[data-send]').forEach((b) => (b.onclick = () => {
        const t = DASH_ASSETS.tokens[+b.dataset.send]; if (!t) return;
        if (acctKind === 'connected') { renderConnectedSrc20Send(t.tick, t.amount); return; }
        if (acctKind === 'hardware') { // Ledger: compose here, sign on-device via the connected-style signer
          const hw = window.__hardwareWallet;
          if (hw && hw.signPsbt && window.MintingModules) window.MintingModules.sendSrc20Connected(hw, t.tick);
          else { const c = modal(`<h3 class="m-title">Send ${esc(t.name)}</h3><p class="fine">Switch your Ledger to its main <b>Native SegWit</b> address to send SRC-20 — browsed / aggregate views are read-only.</p><div class="wbtns"><button class="ghost" id="hwx">Close</button></div>`); c.querySelector('#hwx').onclick = closeModal; }
          return;
        }
        if (window.MintingModules) window.MintingModules.sendSrc20(acc.account, assetFrom, t.tick);
      }));
      box.querySelectorAll('[data-fav]').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); const t = DASH_ASSETS.tokens[+b.dataset.fav]; if (!t) return; toggleFav(t); renderDashAssets(acc); }));
      const openCp = (i) => { const t = DASH_ASSETS.tokens[+i]; if (t) cpTokenDetailModal(t, acc); };
      box.querySelectorAll('[data-cp]').forEach((b) => (b.onclick = () => openCp(b.dataset.cp)));
      box.querySelectorAll('[data-cprow]').forEach((el) => (el.onclick = () => openCp(el.dataset.cprow)));
      const tExp = $('#tokExpand'); if (tExp) tExp.onclick = () => { const w = box.querySelector('.tok-grid-wrap'); if (!w) return; const collapsed = w.style.maxHeight !== 'none'; w.style.maxHeight = collapsed ? 'none' : '430px'; tExp.textContent = collapsed ? 'Collapse' : 'Show all ' + DASH_ASSETS.tokens.length; };
      box.querySelectorAll('[data-cpsend]').forEach((b) => (b.onclick = () => { const t = DASH_ASSETS.tokens[+b.dataset.cpsend]; if (t) renderConnectedCpSend(t); }));
      // CP token icons are embedded <img> so the extension shim can rewrite the relative api/ src
      // (a JS-set new Image().src is invisible to the shim). If art doesn't resolve, drop back to the
      // 2-letter placeholder. Handle the already-errored case for fast 404s.
      box.querySelectorAll('img[data-cpic]').forEach((img) => {
        const ph = img.getAttribute('data-cpic') || '';
        const fail = () => { if (!img.parentNode) return; const s = el('span', 'at-ic ph'); s.textContent = ph; img.parentNode.replaceChild(s, img); };
        img.onerror = fail;
        if (img.complete && !img.naturalWidth) fail();
      });
    } else {
      if (!DASH_ASSETS.collectibles.length) { box.innerHTML = `<div class="dash-empty">${esc(DASH_ASSETS.note || ('No collectibles on this ' + DCH[dashChain].name + ' address.'))}</div>`; return; }
      const cfavs = loadFavs();
      DASH_ASSETS.collectibles.sort((a, b) => (cfavs.has(favKey(b)) ? 1 : 0) - (cfavs.has(favKey(a)) ? 1 : 0)); // favorites pinned on top
      box.innerHTML = `<div class="dash-nft-grid">${DASH_ASSETS.collectibles.map((n, i) => {
        const nameCls = n.kind === 'name' ? ' dnft-name' : '';
        const ph = n.kind === 'name' ? `<span class="dnft-ph name-ph">${esc((n.name || '').replace('.btc', ''))}<small>.btc</small></span>` : '<span class="dnft-ph"></span>';
        const star = n.kind === 'name' && n.primary ? `<span class="dnft-star" title="Primary name">${STAR}</span>` : '';
        const favB = `<button class="dnft-fav${cfavs.has(favKey(n)) ? ' on' : ''}" data-fav="${i}" title="Pin favorite">${FAV_STAR}</button>`;
        const qtyTag = (n.qty != null && n.qty > 1) ? `<span class="dnft-tqty" title="You hold ${esc(String(n.qty))}">×${esc(abbrevQty(n.qty))}</span>` : '';
        // Render by MIME, not by load failure: only genuine HTML / recursive stamps get the iframe + HTML
        // badge. Image stamps use <img>; a slow/errored image falls back to a neutral "couldn't load" state.
        const isHtmlStamp = n.stamp != null && n.mime && /html|javascript|text\//i.test(n.mime);
        let media = ph, badge = '';
        if (isHtmlStamp) {
          media = `<iframe class="dnft-frame" sandbox="allow-scripts" scrolling="no" loading="lazy" src="api/stamp/${encodeURIComponent(n.stamp)}/content"></iframe>`;
          badge = '<span class="htmlbadge">HTML</span>';
        } else if (n.img) {
          media = `<img loading="lazy"${n.stamp != null ? ` data-stamperr="${esc(String(n.stamp))}"` : ''} src="${esc(n.img)}"/>`;
        }
        return `<div class="dnft${nameCls}" data-i="${i}" title="${esc(n.title)}${n.qty != null ? ' · you hold ' + esc(String(n.qty)) : ''}">${favB}${star}${media}${badge}<div class="dnft-t"><span class="dnft-tnum">${n.compressed ? 'c·' : ''}${esc(n.title)}</span>${qtyTag}</div></div>`;
      }).join('')}</div>`;
      box.querySelectorAll('.dnft-fav[data-fav]').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); const n = DASH_ASSETS.collectibles[+b.dataset.fav]; if (!n) return; toggleFav(n); renderDashAssets(acc); }));
      box.querySelectorAll('.dnft').forEach((cell) => (cell.onclick = () => { const n = DASH_ASSETS.collectibles[+cell.dataset.i]; if (!n) return; if (n.kind === 'name') nameDetailModal(n, acc); else if (n.stamp != null) stampDetailModal(n, acc); else nftDetailModal(n, acc); }));
      // Image stamp failed: auto-retry once (slow/transient upstream), then a neutral "couldn't load"
      // placeholder — never mislabel a broken image as an HTML stamp.
      box.querySelectorAll('img[data-stamperr]').forEach((img) => {
        let tries = 0;
        img.addEventListener('error', () => {
          const sid = img.getAttribute('data-stamperr'); if (!sid) return;
          tries++;
          if (tries === 1) { setTimeout(() => { img.src = 'api/stamp/' + encodeURIComponent(sid) + '/content?retry=1'; }, 1400); return; }
          const el2 = document.createElement('span'); el2.className = 'dnft-err'; el2.title = 'Preview didn’t load — click to open';
          el2.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 4.3 1.8 19a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg><small>Couldn’t load</small>';
          if (img.parentNode) img.parentNode.replaceChild(el2, img);
        });
      });
    }
  }

  // Stamp collectible detail — large art + metadata + power tools (Send/Dispenser/Burn/Vault),
  // mirroring the extension popup but with the Terminal's full Cp + Emblem modules behind it.
  // SRC-101 .btc name detail — image, resolution target, owner, expiry + manage actions.
  function nameDetailModal(n, acc) {
    const btc = activeAddr(acc, 'btc'); // account-window-selected source (connected → CONN.address)
    modal(`<div class="statusline load">Loading ${esc(n.name)}…</div>`);
    fetch('api/src101/resolve/' + encodeURIComponent(n.name)).then((r) => r.json()).then((d) => {
      let expStr = '—';
      try { if (d.expire) { const y = new Date(d.expire * 1000).getFullYear(); expStr = y > 3000 ? 'never (long lease)' : new Date(d.expire * 1000).toISOString().slice(0, 10); } } catch (_) {}
      modal(`<h3 class="m-title">${esc(d.name || n.name)}${n.primary ? ` <span class="name-badge">${STAR} primary</span>` : ''}</h3>
        <div class="stampd">
          ${n.img ? `<img class="stampd-art" loading="lazy" src="${esc(n.img)}" alt="${esc(n.name)}"/>` : `<div class="name-hero">${esc((n.name || '').replace('.btc', ''))}<small>.btc</small></div>`}
          <div class="m-row" data-copy="${esc(d.address || '')}" title="Copy address"><span class="k">Resolves to</span><span class="vmono">${esc(d.address || '—')}</span></div>
          <div class="m-grid">
            <div><span class="k">Owner</span><span class="v mono">${esc(shortA(d.owner || '—'))}</span></div>
            <div><span class="k">Expires</span><span class="v">${esc(expStr)}</span></div>
          </div>
          <div class="fine">Bitcoin Stamps SRC-101 · permanent on-chain name</div>
          ${(acc || isConn()) ? `<div class="m-actions">
            <button class="m-act" data-act="transfer">Transfer</button>
            <button class="m-act" data-act="setrecord">Set address</button>
          </div>` : '<div class="fine" style="margin-top:6px">Watch-only — switch to your own account to manage.</div>'}
        </div>
        <div class="wbtns"><button class="ghost" id="ndmClose">Close</button></div>`);
      const card = $('#wmodalCard');
      const cp = card.querySelector('[data-copy]'); if (cp) cp.onclick = () => copy(cp.dataset.copy);
      $('#ndmClose').onclick = closeModal;
      if (acc || isConn()) card.querySelectorAll('.m-act').forEach((b) => (b.onclick = () => {
        const act = b.dataset.act; closeModal();
        if (isConn()) { if (window.Src101 && window.Src101.manageConnected) window.Src101.manageConnected(CONN, act, { name: n.name, deploy: n.deploy }); else window.open('https://bitname.pro', '_blank', 'noopener'); return; }
        if (window.Src101 && window.Src101.manage) window.Src101.manage(acc.account, btc, act, { name: n.name, deploy: n.deploy });
        else window.open('https://bitname.pro', '_blank', 'noopener');
      }));
    }).catch(() => { modal(`<h3 class="m-title">${esc(n.name)}</h3><div class="statusline err">Could not load name details.</div><div class="wbtns"><button class="ghost" id="ndmClose">Close</button></div>`); $('#ndmClose').onclick = closeModal; });
  }

  function stampDetailModal(n, acc) {
    const btc = activeAddr(acc, 'btc'); // account-window-selected source (native-segwit ↔ Legacy), connected/Ledger handled inside
    modal(`<div class="statusline load">Loading stamp #${esc(String(n.stamp))}…</div>`);
    Promise.all([
      fetch('api/stamp/' + encodeURIComponent(n.stamp)).then((r) => r.json()).catch(() => ({})),
      n.cpid ? fetch('api/cp/asset/' + encodeURIComponent(n.cpid)).then((r) => r.json()).catch(() => ({})) : Promise.resolve({}),
    ]).then(([s0, cp0]) => {
      const s = (s0 && !s0.error) ? s0 : {};
      const cpInfo = (cp0 && !cp0.error) ? cp0 : {};
      // Authoritative Counterparty state (lock/supply/divisible/issuer) from the asset endpoint — the stamp
      // endpoint can be flaky/omit these, and defaulting "Locked: no" when unknown is misleading.
      if (cpInfo.locked != null) s.locked = cpInfo.locked;
      if (cpInfo.supply != null) s.supply = cpInfo.supply;
      if (cpInfo.divisible != null) s.divisible = cpInfo.divisible;
      if (!s.creator && cpInfo.issuer) s.creator = cpInfo.issuer;
      const cpid = s.cpid || n.cpid || '';
      const stampNo = s.stamp != null ? s.stamp : n.stamp;
      const isHtml = /html/i.test(s.mime || n.mime || '');
      modal(`<h3 class="m-title"><button class="fav-star fav-title${isFav(n) ? ' on' : ''}" id="stampFav" title="Pin favorite">${FAV_STAR}</button> Stamp #${esc(String(stampNo))}</h3>
        <div class="stampd">
          ${isHtml
            ? `<iframe class="stampd-art stampd-frame" sandbox="allow-scripts" scrolling="no" src="api/stamp/${encodeURIComponent(n.stamp)}/content"></iframe>`
            : `<img class="stampd-art" loading="lazy" src="api/stamp/${encodeURIComponent(n.stamp)}/content" alt="stamp #${esc(String(stampNo))}"/>`}
          <div class="m-grid">
            ${n.qty != null ? `<div><span class="k">You hold</span><span class="v">${fmtN(n.qty, 0)}</span></div>` : ''}
            <div><span class="k">Supply</span><span class="v">${s.supply != null ? fmtN(s.supply, s.divisible ? 8 : 0) : '—'}</span></div>
            <div><span class="k">Locked</span><span class="v">${s.locked === true ? 'yes 🔒' : s.locked === false ? 'no' : '—'}</span></div>
            <div><span class="k">Divisible</span><span class="v">${s.divisible === true ? 'yes' : s.divisible === false ? 'no' : '—'}</span></div>
            <div><span class="k">Type</span><span class="v">${esc(s.mime || '—')}</span></div>
            ${s.fileSize ? `<div><span class="k">Size</span><span class="v">${esc(fmtBytes(s.fileSize))}</span></div>` : ''}
          </div>
          <div class="m-row" data-copy="${esc(cpid)}" title="Copy CPID"><span class="k">CPID</span><span class="vmono">${esc(cpid || '—')}</span></div>
          <div class="fine" style="text-align:center;word-break:break-all">Creator ${esc(s.creator || '—')}</div>
          ${(acc || isConn()) ? `<div class="m-actions">
            <button class="m-act" data-act="send">Send</button>
            <button class="m-act" data-act="dispenser">Dispenser</button>
            <button class="m-act" data-act="dividend">Dividend</button>
            <button class="m-act danger" data-act="burn">Burn</button>
            <button class="m-act" data-act="attach">Attach</button>
            ${(acctKind === 'imported' || isConn()) ? '' : '<button class="m-act gold" data-act="vault">Vault</button>'}
          </div>` : '<div class="fine" style="margin-top:6px">Watch-only — switch to your own account for Send / Dispenser / Dividend / Burn / Attach / Vault.</div>'}
        </div>
        <div class="wbtns"><button class="ghost" id="sdmClose">Close</button></div>`);
      const card = $('#wmodalCard');
      const cp = card.querySelector('[data-copy]'); if (cp) cp.onclick = () => copy(cp.dataset.copy);
      const sfb = $('#stampFav'); if (sfb) sfb.onclick = () => { const on = toggleFav(n); sfb.classList.toggle('on', on); renderDashAssets(DASH_ACC); };
      $('#sdmClose').onclick = closeModal;
      if (acc || isConn()) card.querySelectorAll('.m-act').forEach((b) => (b.onclick = () => {
        const act = b.dataset.act; closeModal();
        const back = () => stampDetailModal(n, acc); // a tool's Back returns to THIS stamp detail, not the CP hub
        if (isConn()) { // connected external wallet signs (Burn maps to the CP destroy compose)
          if (act === 'attach') { if (window.CpActions) window.CpActions.attachDetachConnected(CONN, { asset: cpid, qty: 1 }, back); }
          else if (window.CpActions) window.CpActions.quickConnected(CONN, act === 'burn' ? 'destroy' : act, { asset: cpid }, back);
          return;
        }
        if (act === 'send') window.CpActions && window.CpActions.quick(acc.account, btc, 'send', { asset: cpid }, back);
        else if (act === 'dispenser') window.CpActions && window.CpActions.quick(acc.account, btc, 'dispenser', { asset: cpid }, back);
        else if (act === 'dividend') window.CpActions && window.CpActions.quick(acc.account, btc, 'dividend', { asset: cpid }, back);
        else if (act === 'burn') window.CpActions && window.CpActions.quick(acc.account, btc, 'destroy', { asset: cpid }, back);
        else if (act === 'attach') window.CpActions && window.CpActions.attachDetach(acc.account, btc, { asset: cpid, qty: 1 }, back);
        else if (act === 'vault') window.EmblemBridge && (window.EmblemBridge.vaultAsset
          ? window.EmblemBridge.vaultAsset(acc.account, acc.ethereum.address, btc, cpid, { label: '#' + stampNo })
          : window.EmblemBridge.open(acc.account, acc.ethereum.address, btc));
      }));
    }).catch(() => {
      modal(`<h3 class="m-title">Stamp #${esc(String(n.stamp))}</h3><div class="statusline err">Could not load stamp details.</div><div class="wbtns"><button class="ghost" id="sdmClose">Close</button></div>`);
      $('#sdmClose').onclick = closeModal;
    });
  }

  // Counterparty token detail — full-res art preview + metadata + the same power tools a stamp gets
  // (Send · Dispenser · Dividend · Destroy · Vault). Mirrors the extension popup's asset-detail window.
  function cpTokenDetailModal(t, acc) {
    const btc = activeAddr(acc, 'btc'); // account-window-selected source (native-segwit ↔ Legacy), connected/Ledger handled inside
    const cpid = t.asset;
    const held = (t.amount != null ? Number(t.amount) : null);
    modal(`<div class="statusline load">Loading ${esc(t.name || cpid)}…</div>`);
    fetch('api/cp/asset/' + encodeURIComponent(cpid)).then((r) => r.json()).then((info) => build(info || {})).catch(() => build({}));
    function build(info) {
      const divisible = info.divisible != null ? !!info.divisible : !!t.divisible;
      const supplyDisp = info.supply != null ? (divisible ? info.supply / 1e8 : info.supply) : null;
      const qd = divisible ? 8 : 0;
      const desc = info.description ? String(info.description).slice(0, 200) : '';
      modal(`<h3 class="m-title"><button class="fav-star fav-title${isFav(t) ? ' on' : ''}" id="cpTokFav" title="Pin favorite">${FAV_STAR}</button> ${esc(t.name || cpid)}</h3>
        <div class="stampd">
          <img class="stampd-art" id="cpTokArt" loading="lazy" src="api/cp/assetimg/${encodeURIComponent(cpid)}?full=1" alt="${esc(t.name || cpid)}"/>
          ${desc ? `<div class="fine cp-desc" id="cpTokDesc" style="display:none;text-align:center;word-break:break-word">${esc(desc)}</div>` : ''}
          <div class="m-grid">
            ${held != null ? `<div><span class="k">You hold</span><span class="v">${mask(fmtN(held, qd))}</span></div>` : ''}
            <div><span class="k">Supply</span><span class="v">${supplyDisp != null ? fmtN(supplyDisp, qd) : '—'}</span></div>
            <div><span class="k">Divisible</span><span class="v">${divisible ? 'yes' : 'no'}</span></div>
            <div><span class="k">Locked</span><span class="v">${info.locked ? 'yes 🔒' : 'no'}</span></div>
          </div>
          <div class="m-row" data-copy="${esc(cpid)}" title="Copy asset name"><span class="k">Asset</span><span class="vmono">${esc(cpid)}</span></div>
          <div class="fine">Counterparty asset</div>
          ${(acc || isConn()) ? `<div class="m-actions">
            <button class="m-act" data-act="send">Send</button>
            <button class="m-act" data-act="dispenser">Dispenser</button>
            <button class="m-act" data-act="dividend">Dividend</button>
            <button class="m-act danger" data-act="destroy">Destroy</button>
            <button class="m-act" data-act="attach">Attach</button>
            ${(acctKind === 'imported' || isConn()) ? '' : '<button class="m-act gold" data-act="vault">Vault</button>'}
          </div>` : '<div class="fine" style="margin-top:6px">Watch-only — switch to your own account for Send / Dispenser / Dividend / Destroy / Attach / Vault.</div>'}
        </div>
        <div class="wbtns"><button class="ghost" id="ctmClose">Close</button></div>`);
      const card = $('#wmodalCard');
      // Show the art if it resolves; otherwise drop it and surface the on-chain description instead.
      const art = $('#cpTokArt'), dsc = $('#cpTokDesc');
      if (art) { const fail = () => { try { art.remove(); } catch (e) {} if (dsc) dsc.style.display = ''; }; art.onerror = fail; if (art.complete && !art.naturalWidth) fail(); }
      const cp = card.querySelector('[data-copy]'); if (cp) cp.onclick = () => copy(cp.dataset.copy);
      const fvb = $('#cpTokFav'); if (fvb) fvb.onclick = () => { const on = toggleFav(t); fvb.classList.toggle('on', on); renderDashAssets(DASH_ACC); };
      $('#ctmClose').onclick = closeModal;
      if (acc || isConn()) card.querySelectorAll('.m-act').forEach((b) => (b.onclick = () => {
        const act = b.dataset.act; closeModal();
        const back = () => cpTokenDetailModal(t, acc); // a tool's Back returns HERE, not the CP actions hub
        if (isConn()) { // connected external wallet signs — route through the EXT-aware CP entries
          if (act === 'attach') { if (window.CpActions) window.CpActions.attachDetachConnected(CONN, { asset: cpid, qty: 1 }, back); }
          else if (window.CpActions) window.CpActions.quickConnected(CONN, act, { asset: cpid }, back);
          return;
        }
        if (act === 'vault') {
          if (window.EmblemBridge) (window.EmblemBridge.vaultAsset
            ? window.EmblemBridge.vaultAsset(acc.account, acc.ethereum.address, btc, cpid, { label: t.name || cpid })
            : window.EmblemBridge.open(acc.account, acc.ethereum.address, btc));
        } else if (act === 'attach') { if (window.CpActions) window.CpActions.attachDetach(acc.account, btc, { asset: cpid, qty: 1 }, back); }
        else if (window.CpActions) window.CpActions.quick(acc.account, btc, act, { asset: cpid }, back);
      }));
    }
  }

  // ETH / SOL NFT detail: large art + name + contract/mint + explorer link + Send (own accounts).
  function nftDetailModal(n, acc) {
    const ex = n.contract ? `https://etherscan.io/nft/${n.contract}/${encodeURIComponent(n.tokenId)}` : (n.id ? `https://solscan.io/token/${encodeURIComponent(n.id)}` : null);
    const idStr = n.contract ? `${n.contract}${n.tokenId != null ? ' · #' + n.tokenId : ''}` : (n.id || '');
    const canSend = !!acc && (n.contract ? true : !!n.id);
    modal(`<h3 class="m-title">${esc(n.title || 'NFT')}</h3>
      <div class="stampd">
        ${n.img ? `<img class="stampd-art" loading="lazy" src="${esc(n.img)}" alt="${esc(n.title || 'NFT')}"/>` : '<div class="fine" style="text-align:center;padding:30px">No image available.</div>'}
        ${idStr ? `<div class="m-row" data-copy="${esc(n.contract || n.id)}" title="Copy"><span class="k">${n.contract ? 'Contract' : 'Mint'}</span><span class="vmono">${esc(idStr)}</span></div>` : ''}
        ${n.compressed ? '<div class="fine">Compressed NFT (cNFT)</div>' : ''}
        <div class="m-actions">
          ${canSend ? '<button class="m-act" data-act="send">Send</button>' : ''}
          ${ex ? `<a class="m-act" href="${esc(ex)}" target="_blank" rel="noopener" style="text-decoration:none;text-align:center;line-height:1.6">Explorer ↗</a>` : ''}
        </div>
      </div>
      <div class="wbtns"><button class="ghost" id="nftClose">Close</button></div>`);
    const c = $('#wmodalCard'); const cp = c.querySelector('[data-copy]'); if (cp) cp.onclick = () => copy(cp.dataset.copy);
    const sb = c.querySelector('[data-act="send"]'); if (sb) sb.onclick = () => nftSendForm(n, acc);
    $('#nftClose').onclick = closeModal;
  }

  // NFT transfer — ERC-721/1155 via the EVM prepare→sign→broadcast path; regular SPL NFT via sendSpl.
  const _p32 = (a) => String(a).toLowerCase().replace(/^0x/, '').padStart(64, '0');
  const _h32 = (v) => BigInt(v).toString(16).padStart(64, '0');
  function erc721Data(from, to, tokenId) { return '0x42842e0e' + _p32(from) + _p32(to) + _h32(tokenId); }
  function erc1155Data(from, to, id, amount) { return '0xf242432a' + _p32(from) + _p32(to) + _h32(id) + _h32(amount) + _h32(160) + _h32(0); }
  function nftSendForm(n, acc) {
    const isEth = !!n.contract;
    modal(`<h3 class="m-title">Send · ${esc(n.title || 'NFT')}</h3>
      <p class="fine">Transfer this ${isEth ? (n.tokenType === 'ERC1155' ? 'ERC-1155' : 'ERC-721') : 'Solana'} NFT. Double-check the destination — this is irreversible.</p>
      <label class="cpf"><span>Recipient ${isEth ? '(0x…)' : 'address'}</span><input id="nfsTo" class="m-in" spellcheck="false" autocomplete="off"/></label>
      <div id="nfsStatus" class="statusline" hidden></div>
      <div class="wbtns"><button class="ghost" id="nfsBack">Back</button><button class="primary" id="nfsReview">Review</button></div>`);
    if (window.WonderBook) WonderBook.attach($('#nfsTo'), isEth ? 'eth' : 'sol');
    $('#nfsBack').onclick = () => nftDetailModal(n, acc);
    $('#nfsReview').onclick = async () => {
      const s = $('#nfsStatus'); s.hidden = false; s.className = 'statusline load'; s.textContent = isEth ? 'Preparing & signing…' : 'Building & signing…';
      try {
        const to = $('#nfsTo').value.trim();
        if (isEth) {
          if (!/^0x[0-9a-fA-F]{40}$/.test(to)) throw new Error('Enter a valid 0x recipient.');
          const from = acc.ethereum.address;
          const data = n.tokenType === 'ERC1155' ? erc1155Data(from, to, n.tokenId, 1) : erc721Data(from, to, n.tokenId);
          const prep = await fetch('api/eth/prepare', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from, to: n.contract, valueWei: '0x0', data, network: (window.WWNet ? window.WWNet.evm() : 'ethereum') }) }).then((r) => r.json());
          if (prep.error) throw new Error(prep.detail || prep.error);
          const signed = C.sendEvm({ account: acc.account, to: n.contract, valueWei: '0x0', data, nonce: prep.nonce, chainId: prep.chainId, maxFeePerGas: prep.maxFeePerGas, maxPriorityFeePerGas: prep.maxPriorityFeePerGas, gasLimit: prep.gasLimit });
          const gasEth = Number(BigInt(prep.gasLimit) * BigInt(prep.maxFeePerGas)) / 1e18;
          nftSendConfirm(n, acc, { kind: 'eth', signed, to, gasEth, nonce: prep.nonce });
        } else {
          if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(to)) throw new Error('Enter a valid Solana address.');
          const bh = await fetch('api/sol/blockhash').then((r) => r.json());
          let signed;
          if (n.compressed) {
            s.textContent = 'Fetching cNFT proof…';
            const ctx = await fetch('api/sol/cnft/' + encodeURIComponent(n.id)).then((r) => r.json());
            if (!ctx || ctx.error || !ctx.tree) throw new Error(ctx && ctx.error === 'no_das' ? 'DAS provider not configured.' : 'Could not load cNFT proof.');
            signed = C.sendCnft({ account: acc.account, to, ctx, blockhash: bh.blockhash });
          } else {
            signed = C.sendSpl({ account: acc.account, to, mint: n.id, amount: 1n, decimals: 0, blockhash: bh.blockhash });
          }
          let sim = null; try { sim = await fetch('api/sol/simulate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ txBase64: signed.txBase64 }) }).then((r) => r.json()); } catch (_) {}
          nftSendConfirm(n, acc, { kind: 'sol', signed, to, sim });
        }
      } catch (err) { s.className = 'statusline err'; s.textContent = /insufficient/i.test(err.message || '') ? 'Insufficient balance for gas/fees.' : (err.message || 'Could not build the transfer.'); }
    };
  }
  function nftSendConfirm(n, acc, x) {
    const simNote = x.kind === 'sol' && x.sim ? (x.sim.err ? `<div class="warn">Simulation: ${esc(JSON.stringify(x.sim.err)).slice(0, 70)} (may be expected if unfunded).</div>` : `<div class="fine">Simulation OK.</div>`) : '';
    modal(`<h3 class="m-title">Confirm · Send NFT</h3>
      <div class="prev-flow"><div class="pf"><span>Send</span><b>${esc(n.title || 'NFT')}</b></div><div class="pf-arrow">↓</div><div class="pf"><span>To</span><b class="mono">${esc(short(x.to))}</b></div></div>
      ${x.kind === 'eth' ? `<div class="m-grid"><div><span class="k">Max gas</span><span class="v">${fmtN(x.gasEth, 8)} ETH</span></div><div><span class="k">Nonce</span><span class="v">${x.nonce}</span></div></div>` : simNote}
      <div id="nfcStatus" class="statusline" hidden></div>
      <div class="wbtns"><button class="ghost" id="nfcBack">Back</button><button class="primary" id="nfcGo">Broadcast</button></div>`);
    $('#nfcBack').onclick = () => nftSendForm(n, acc);
    $('#nfcGo').onclick = async () => {
      const s = $('#nfcStatus'); s.hidden = false; s.className = 'statusline load'; s.textContent = 'Broadcasting…';
      try {
        let r, id;
        if (x.kind === 'eth') { r = await fetch('api/eth/broadcast', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ raw: x.signed.raw, network: (window.WWNet ? window.WWNet.evm() : 'ethereum') }) }).then((z) => z.json()); id = r.txhash; }
        else { r = await fetch('api/sol/broadcast', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ txBase64: x.signed.txBase64 }) }).then((z) => z.json()); id = r.signature; }
        if (r.error) throw new Error(r.detail || r.error);
        const exUrl = x.kind === 'eth' ? `https://etherscan.io/tx/${encodeURIComponent(id)}` : `https://solscan.io/tx/${encodeURIComponent(id)}`;
        s.className = 'statusline'; s.innerHTML = `Sent ✓ — <a href="${exUrl}" target="_blank" rel="noopener" style="color:var(--gold2)">${esc(String(id).slice(0, 20))}…</a>`;
        sentDone(() => renderUnlocked());
      } catch (err) { s.className = 'statusline err'; s.textContent = 'Failed: ' + (err.message || 'broadcast error'); }
    };
  }

  // Send / Receive now live inside the balance module. HD & imported accounts can sign; watch-only can't.
  function renderBalanceActions(acc) {
    const bar = $('#balActions'); if (!bar) return;
    if (acctKind === 'watch') { bar.innerHTML = ''; return; } // read-only, no keys to sign
    const sym = acctKind === 'imported' ? 'BTC' : DCH[dashChain].sym;
    bar.innerHTML = `<button class="primary sm" data-a="send">Send ${sym}</button><button class="ghost sm" data-a="receive">Receive</button>`;
    bar.querySelectorAll('[data-a]').forEach((btn) => (btn.onclick = () => dashAction(btn.dataset.a, acc)));
  }
  // Below-balance row: only BTC keeps an Activity entry — Coin Control is reached from inside Activity
  // (mirrors the extension, where the two share one entry point). Send/Receive moved into the balance module.
  function renderDashActions(acc) {
    const bar = $('#dashActions'); if (!bar) return;
    // ☰ Tools is the mobile drawer toggle (hidden on desktop, where the rail is docked). It lives here,
    // to the LEFT of Activity, so the balance module tucks straight under the account row.
    const tools = '<button class="ghost sm" id="dappsBtn" title="Open the tools panel">☰ Tools</button>';
    const wireBar = () => {
      bar.querySelectorAll('[data-a]').forEach((btn) => (btn.onclick = () => dashAction(btn.dataset.a, acc)));
      const d = bar.querySelector('#dappsBtn'); if (d) d.onclick = () => window.DappDashboard && window.DappDashboard.toggle();
    };
    if (acctKind === 'watch') {
      const w = currentWatch(); const isBtc = w && CHAIN_OF[w.chain] === 'btc';
      bar.innerHTML = `<div class="watch-note">👁 Watch-only — read-only, no keys to sign. <button class="mini" data-copy2="${esc(w ? w.address : '')}">copy address</button></div><div class="dash-actrow">${tools}${isBtc ? '<button class="ghost sm" data-a="activity">⧗ Activity</button>' : ''}</div>`;
      const c = bar.querySelector('[data-copy2]'); if (c) c.onclick = () => copy(c.dataset.copy2, c);
      bar.classList.remove('tools-only'); bar.style.display = ''; wireBar();
      return;
    }
    const isBtc = acctKind === 'imported' || dashChain === 'btc';
    const activity = isBtc ? '<button class="ghost sm" data-a="activity">⧗ Activity</button>' : '';
    bar.innerHTML = tools + activity;
    bar.classList.toggle('tools-only', !activity); // ETH/SOL: only the mobile Tools btn → collapse the row on desktop
    bar.style.display = ''; wireBar();
  }
  function dashAction(a, acc) {
    if (a === 'send') { if (acctKind === 'connected') return renderConnectedSend(); if (dashChain === 'btc') flowSend(acc); else if (dashChain === 'eth') window.EvmActions && window.EvmActions.open(acc.account, acc.ethereum.address, 'ethereum'); else window.SolActions && window.SolActions.open(acc.account, acc.solana.address); }
    else if (a === 'receive') receiveView(acc);
    else if (a === 'cp') window.CpActions && window.CpActions.open(acc.account, acctKind === 'imported' ? impBtcAddr() : acctBtcAddr(acc));
    else if (a === 'coincontrol') window.CoinControl && window.CoinControl.open(acctKind === 'imported' ? impBtcAddr() : acctBtcAddr(acc));
    else if (a === 'activity') openActivity(activeAddr(acc, 'btc') || (acctKind === 'imported' ? impBtcAddr() : acc && acctBtcAddr(acc)));
    else if (a === 'dapps') { const db = document.getElementById('dappsBtn'); if (db) db.click(); }
    else if (a === 'emblem') window.EmblemBridge && window.EmblemBridge.open(acc.account, acc.ethereum.address, acctBtcAddr(acc));
  }

  // Receive / all-addresses — keeps every BTC address type reachable (Legacy for CP/Stamps, etc.).
  // Clean, extension-style Receive: the ONE address for the chain + account you're on — big QR + copy.
  function receiveView(acc) {
    const ch = dashChain;
    const addr = acctKind === 'imported' ? impBtcAddr() : activeAddr(acc, ch);
    if (!addr) return;
    const url = window.qrcode ? qrUrl(addr) : null;
    const typeLabel = ch === 'btc' ? (BTC_LABEL[acctKind === 'connected' ? connBtcType(addr) : curBtcType()] || '') + ' · ' : '';
    const COPY_IC = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
    // No button row — the corner ✕ closes; tap/click the address to copy (icon reveals on hover, confirms on tap).
    modal(`<h3 class="m-title">Receive ${esc(DCH[ch].sym)}</h3>
      <p class="fine">Your ${esc(typeLabel)}${esc(DCH[ch].name)} address. Only send ${esc(DCH[ch].name)} assets here.</p>
      ${url ? `<div class="qr-wrap"><img src="${url}" alt="address QR" width="230" height="230"/></div>` : '<div class="fine">QR unavailable.</div>'}
      <div class="recv-addr" role="button" tabindex="0" title="Tap to copy"><span class="ra-text">${esc(addr)}</span><span class="ra-copy" aria-hidden="true">${COPY_IC}</span></div>`);
    const ra = $('#wmodalCard').querySelector('.recv-addr'), rc = ra.querySelector('.ra-copy'), orig = rc.innerHTML;
    const doCopy = async () => {
      try { await navigator.clipboard.writeText(addr); } catch (_) {}
      ra.classList.add('copied'); rc.innerHTML = '✓ Copied';
      clearTimeout(ra._t); ra._t = setTimeout(() => { ra.classList.remove('copied'); rc.innerHTML = orig; }, 1300);
    };
    ra.onclick = doCopy;
    ra.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); doCopy(); } };
  }
  // Advanced → All addresses: every derived address (all BTC types + ETH + SOL), with copy / QR / UTXO / nickname.
  function allAddressesView(acc) {
    const addrNames = loadMap(ADDR_NAMES);
    const row = (label, addr, hint, cc) => {
      const nick = addrNames[addr] || '';
      return `<div class="acct"><div class="acct-l"><span class="acct-lab">${esc(label)}${nick ? ` · <span class="acct-nick">${esc(nick)}</span>` : ''}</span>${hint ? `<span class="acct-hint">${esc(hint)}</span>` : ''}</div>
        <div class="acct-r"><span class="acct-addr" title="${esc(addr)}">${esc(addr)}</span><button class="mini" data-copy="${esc(addr)}">copy</button><button class="mini" data-qr="${esc(addr)}" title="Show QR">QR</button>${cc ? `<button class="mini" data-cc="${esc(addr)}" title="UTXO / coin control">UTXOs</button>` : ''}<button class="mini" data-nick="${esc(addr)}" title="Nickname">✎</button></div></div>`;
    };
    if (acctKind === 'imported') {
      const im = currentImported(); if (!im) return;
      const ibtc = `<div class="acct-grp">Bitcoin · imported</div>${row('Native SegWit', im.bitcoin.nativeSegwit.address, 'bc1q', true)}${row('Legacy', im.bitcoin.legacy.address, '1…', true)}${row('Taproot', im.bitcoin.taproot.address, 'bc1p', true)}${row('Nested SegWit', im.bitcoin.nestedSegwit.address, '3…', true)}`;
      modal(`<h3 class="m-title">Receive · imported</h3><p class="fine">All Bitcoin address types share this imported key.</p><div class="acct-list">${ibtc}</div><div class="wbtns"><button class="ghost" id="rvClose">Close</button></div>`);
      const cc = $('#wmodalCard');
      cc.querySelectorAll('[data-copy]').forEach((b) => (b.onclick = () => copy(b.dataset.copy, b)));
      cc.querySelectorAll('[data-qr]').forEach((b) => (b.onclick = () => qrModal(b.dataset.qr, null)));
      cc.querySelectorAll('[data-cc]').forEach((b) => (b.onclick = () => { closeModal(); if (window.CoinControl) window.CoinControl.open(b.dataset.cc); }));
      cc.querySelectorAll('[data-nick]').forEach((b) => (b.onclick = () => namePrompt('Nickname this address', addrNames[b.dataset.nick] || '', (v) => { const m = loadMap(ADDR_NAMES); if (v) m[b.dataset.nick] = v; else delete m[b.dataset.nick]; saveMap(ADDR_NAMES, m); })));
      $('#rvClose').onclick = closeModal;
      return;
    }
    const btc = `<div class="acct-grp">Bitcoin</div>${row('Native SegWit', acc.bitcoin.nativeSegwit.address, 'bc1q · default', true)}${row('Legacy', acc.bitcoin.legacy.address, '1 · Counterparty/Stamps', true)}${row('Taproot', acc.bitcoin.taproot.address, 'bc1p · Ordinals', true)}${row('Nested SegWit', acc.bitcoin.nestedSegwit.address, '3 · OG restore', true)}`;
    const eth = `<div class="acct-grp">Ethereum / EVM</div>${row('Ethereum', acc.ethereum.address, acc.ethereum.path)}`;
    const sol = `<div class="acct-grp">Solana</div>${row('Solana', acc.solana.address, acc.solana.path)}`;
    const which = dashChain === 'btc' ? btc : dashChain === 'eth' ? eth : sol;
    modal(`<h3 class="m-title">Receive · ${esc(DCH[dashChain].name)}</h3>
      <p class="fine">Your receiving addresses. Only send matching-chain assets to each.</p>
      <div class="acct-list">${which}</div>
      <details class="recv-all"><summary>Show all chains</summary><div class="acct-list" style="margin-top:8px">${btc}${eth}${sol}</div></details>
      <div class="wbtns"><button class="ghost" id="rvClose">Close</button></div>`);
    const c = $('#wmodalCard');
    c.querySelectorAll('[data-copy]').forEach((b) => (b.onclick = () => copy(b.dataset.copy, b)));
    c.querySelectorAll('[data-nick]').forEach((b) => (b.onclick = () => namePrompt('Nickname this address', addrNames[b.dataset.nick] || '', (v) => {
      const m = loadMap(ADDR_NAMES); if (v) m[b.dataset.nick] = v; else delete m[b.dataset.nick]; saveMap(ADDR_NAMES, m);
    })));
    c.querySelectorAll('[data-cc]').forEach((b) => (b.onclick = () => { closeModal(); if (window.CoinControl) window.CoinControl.open(b.dataset.cc); }));
    c.querySelectorAll('[data-qr]').forEach((b) => (b.onclick = () => qrModal(b.dataset.qr, acc)));
    $('#rvClose').onclick = closeModal;
  }

  // QR for a receiving address (client-side; no external calls). Back-arrow returns to Receive.
  function qrUrl(text) { try { const q = window.qrcode(0, 'M'); q.addData(String(text)); q.make(); return q.createDataURL(6, 2); } catch (_) { return null; } }
  function qrModal(addr, acc) {
    const url = window.qrcode ? qrUrl(addr) : null;
    modal(`<h3 class="m-title">Scan to receive</h3>
      ${url ? `<div class="qr-wrap"><img src="${url}" alt="address QR" width="230" height="230"/></div>` : '<div class="fine">QR unavailable.</div>'}
      <div class="recv-addr" data-copy="${esc(addr)}" title="Copy">${esc(addr)}</div>
      <div class="wbtns"><button class="ghost" id="qrBack">Back</button></div>`);
    const c = $('#wmodalCard');
    c.querySelectorAll('[data-copy]').forEach((b) => (b.onclick = () => copy(b.dataset.copy, b)));
    $('#qrBack').onclick = () => allAddressesView(acc);
  }

  // Advanced ▾ — the power tools tucked out of the main view.
  function dashAdvancedMenu(acc) {
    modal(`<h3 class="m-title">Advanced</h3>
      <div class="adv-menu">
        <button class="adv-opt" data-adv="addresses"><b>All addresses</b><span>Every derived address for this account</span></button>
        <button class="adv-opt" data-adv="sign"><b>Sign message</b><span>Prove ownership of an address</span></button>
        <button class="adv-opt" data-adv="hw"><b>Hardware wallet</b><span>Connect a Ledger / signing device</span></button>
        <button class="adv-opt" data-adv="custom"><b>Custom derivation path</b><span>Derive an address at a specific path</span></button>
        <button class="adv-opt" data-adv="theme"><b>Appearance</b><span>Dark or light wallet skin</span></button>
        <button class="adv-opt" data-adv="autolock"><b>Auto-lock &amp; stay signed in</b><span>Keep the wallet unlocked across refreshes; set an idle timer</span></button>
        <button class="adv-opt" data-adv="backup"><b>Backup &amp; Restore</b><span>Full encrypted wallet backup — seed + settings in one file. Guard it like your seed.</span></button>
        <button class="adv-opt danger" data-adv="reveal"><b>Reveal seed phrase</b><span>Show your 12/24-word recovery phrase</span></button>
        <button class="adv-opt danger" data-adv="secrets"><b>Export private keys</b><span>Export raw keys for this account</span></button>
      </div>
      <div class="wbtns"><button class="ghost" id="advClose">Close</button></div>`);
    $('#advClose').onclick = closeModal;
    $('#wmodalCard').querySelectorAll('[data-adv]').forEach((b) => (b.onclick = () => {
      const a = b.dataset.adv; closeModal();
      if (a === 'addresses') allAddressesView(acc);
      else if (a === 'sign') flowSignMessage();
      else if (a === 'hw') window.HardwareWallet && window.HardwareWallet.connectFlow();
      else if (a === 'theme') themeMenu();
      else if (a === 'autolock') autoLockMenu();
      else if (a === 'backup') { if (window.WonderBackup) window.WonderBackup.open(); }
      else if (a === 'custom') customPath();
      else if (a === 'reveal') gatedRevealSeed();
      else if (a === 'secrets') gatedSecrets(curAccount);
    }));
  }
  function autoLockMenu() {
    const cur = idleSetting();
    const opts = [['off', 'Lock on refresh', 'Most secure — re-enter your password after every reload'],
      ['1', '1 minute', 'Stay signed in; auto-lock after 1 min idle'], ['5', '5 minutes', 'Stay signed in; auto-lock after 5 min idle'],
      ['15', '15 minutes', 'Stay signed in; auto-lock after 15 min idle'], ['30', '30 minutes', 'Stay signed in; auto-lock after 30 min idle'],
      ['60', '1 hour', 'Stay signed in; auto-lock after 1 hr idle'], ['never', 'Never', 'Stay unlocked until you lock it or close the tab']];
    const rows = opts.map(([v, label, sub]) => `<button class="adv-opt${v === cur ? ' on' : ''}${v === 'never' ? ' danger' : ''}" data-al="${v}"><b>${esc(label)}${v === cur ? ' ✓' : ''}</b><span>${esc(sub)}</span></button>`).join('');
    modal(`<h3 class="m-title">Auto-lock &amp; stay signed in</h3>
      <p class="fine">Keep the Terminal unlocked across page refreshes and auto-lock it after inactivity. While enabled, your unlocked session is kept in this tab's storage (wiped when you close the tab) — a small convenience-for-security tradeoff. <b>Lock on refresh</b> keeps your seed memory-only.</p>
      <div class="adv-menu">${rows}</div>
      <div class="wbtns"><button class="ghost" id="alClose">Close</button></div>`);
    $('#alClose').onclick = closeModal;
    $('#wmodalCard').querySelectorAll('[data-al]').forEach((b) => (b.onclick = () => { setIdleSetting(b.dataset.al); autoLockMenu(); }));
  }

  // ── Create flow ──
  function flowCreate() {
    const c = modal(`<h3 class="m-title">Create wallet</h3>
      <p class="fine">Choose your recovery phrase length. 24 words is the strongest.</p>
      <div class="wbtns"><button class="primary" data-w="24">24 words</button><button class="ghost" data-w="12">12 words</button></div>
      <button class="modal-x" id="mc">Cancel</button>`);
    c.querySelectorAll('[data-w]').forEach((b) => (b.onclick = () => showMnemonic(Number(b.dataset.w))));
    $('#mc').onclick = closeModal;
  }
  function showMnemonic(words) {
    const m = C.generateMnemonic(words);
    draft = { mnemonic: m, words: m.split(' '), account: 0 };
    const grid = draft.words.map((w, i) => `<span class="seedw"><i>${i + 1}</i>${esc(w)}</span>`).join('');
    const c = modal(`<h3 class="m-title">Your recovery phrase</h3>
      <div class="warn">Write these ${words} words down and store them offline. Anyone with this phrase controls the funds. Wonder Wallet can never recover it for you.</div>
      <div class="seedgrid blurred" id="seedGrid">${grid}</div>
      <button class="ghost sm" id="bBlur">Tap to reveal</button>
      <button class="mini" id="bCopy" style="margin-left:8px">Copy</button>
      <div class="wbtns"><button class="primary" id="bNext" disabled>I've saved it →</button></div>
      <button class="modal-x" id="mc">Cancel</button>`);
    let revealed = false;
    $('#bBlur').onclick = () => { revealed = !revealed; $('#seedGrid').classList.toggle('blurred', !revealed); $('#bBlur').textContent = revealed ? 'Hide' : 'Tap to reveal'; $('#bNext').disabled = !revealed; };
    $('#bCopy').onclick = (e) => copy(draft.mnemonic, e.target, true);
    $('#bNext').onclick = confirmMnemonic;
    $('#mc').onclick = () => { draft = null; closeModal(); };
  }
  function confirmMnemonic() {
    // Ask the user to pick 3 words at random positions (lightweight backup check).
    const idxs = [...Array(draft.words.length).keys()].sort(() => 0.5 - hashRand()).slice(0, 3).sort((a, b) => a - b);
    const picks = {};
    const blocks = idxs.map((i) => {
      const correct = draft.words[i];
      const opts = [correct, ...sampleWrong(correct, 3)].sort(() => 0.5 - hashRand());
      return `<div class="confirm-q" data-i="${i}"><div class="cq-h">Word #${i + 1}</div><div class="cq-opts">${opts.map((o) => `<button class="cq-opt" data-i="${i}" data-w="${esc(o)}">${esc(o)}</button>`).join('')}</div></div>`;
    }).join('');
    const c = modal(`<h3 class="m-title">Confirm your backup</h3><p class="fine">Select the correct word for each position.</p>${blocks}
      <div id="cfStatus" class="statusline" hidden></div>
      <div class="wbtns"><button class="ghost" id="bBack">Back</button><button class="primary" id="bToPw" disabled>Continue</button></div>`);
    c.querySelectorAll('.cq-opt').forEach((b) => (b.onclick = () => {
      const i = b.dataset.i;
      c.querySelectorAll(`.cq-opt[data-i="${i}"]`).forEach((x) => x.classList.remove('sel'));
      b.classList.add('sel'); picks[i] = b.dataset.w;
      const ok = idxs.every((ii) => picks[ii] === draft.words[ii]);
      $('#bToPw').disabled = Object.keys(picks).length < 3;
      if (Object.keys(picks).length >= 3) { const s = $('#cfStatus'); s.hidden = false; s.className = ok ? 'statusline load' : 'statusline err'; s.textContent = ok ? 'Looks good.' : 'One or more words are wrong — check your written copy.'; $('#bToPw').disabled = !ok; }
    }));
    $('#bBack').onclick = () => showMnemonic(draft.words.length);
    $('#bToPw').onclick = setPassword;
  }
  function setPassword() {
    const c = modal(`<h3 class="m-title">Set a password</h3>
      <p class="fine">This encrypts your seed on this device (Argon2id + AES-GCM). It can't be reset — only your seed phrase can restore the wallet.</p>
      <input id="pw1" class="m-in" type="password" placeholder="Password (min 8 chars)" autocomplete="new-password" />
      <input id="pw2" class="m-in" type="password" placeholder="Confirm password" autocomplete="new-password" />
      <details class="adv"><summary>Advanced · BIP-39 passphrase (25th word)</summary>
        <input id="pp" class="m-in" type="text" placeholder="Optional passphrase — changes all addresses" />
        <div class="fine">A passphrase adds a hidden second factor. If you forget it, the funds are unrecoverable.</div></details>
      <div id="pwStatus" class="statusline" hidden></div>
      <div class="wbtns"><button class="ghost" id="bBack">Back</button><button class="primary" id="bCreate2">Create wallet</button></div>`);
    $('#bBack').onclick = confirmMnemonic;
    $('#bCreate2').onclick = async () => {
      const p1 = $('#pw1').value, p2 = $('#pw2').value, pp = $('#pp').value;
      const s = $('#pwStatus'); s.hidden = false; s.className = 'statusline err';
      if (p1.length < 8) return (s.textContent = 'Password must be at least 8 characters.');
      if (p1 !== p2) return (s.textContent = 'Passwords do not match.');
      s.className = 'statusline load'; s.textContent = 'Encrypting (Argon2id)…';
      try { await C.createVault(draft.mnemonic, pp, p1); draft = null; closeModal(); renderUnlocked(); }
      catch (err) { s.className = 'statusline err'; s.textContent = 'Failed: ' + err.message; }
    };
  }

  // ── Restore flow ──
  function flowRestore() {
    const c = modal(`<h3 class="m-title">Restore from seed</h3>
      <p class="fine">Enter your 12 or 24-word BIP-39 recovery phrase — or a <b>12-word Counterwallet / FreeWallet</b> passphrase (we detect it automatically).</p>
      <textarea id="rSeed" class="m-in" rows="3" placeholder="word1 word2 word3 …" spellcheck="false"></textarea>
      <div id="rCw" class="fine"></div>
      <details class="adv"><summary>Advanced · BIP-39 passphrase</summary>
        <input id="rPp" class="m-in" type="text" placeholder="Passphrase (if you used one)" /></details>
      <input id="rPw1" class="m-in" type="password" placeholder="New password (min 8)" autocomplete="new-password" />
      <input id="rPw2" class="m-in" type="password" placeholder="Confirm password" autocomplete="new-password" />
      <div id="rStatus" class="statusline" hidden></div>
      <div class="wbtns"><button class="ghost" id="mc">Cancel</button><button class="primary" id="bDo">Restore</button></div>`);
    $('#mc').onclick = closeModal;
    $('#rSeed').oninput = () => {
      const m = $('#rSeed').value.trim().replace(/\s+/g, ' ').toLowerCase(); const n = $('#rCw');
      if (m && !C.validateMnemonic(m) && C.isCwPhrase(m)) n.innerHTML = '<span style="color:var(--gold2)">↩ Counterwallet / FreeWallet passphrase detected — restores your legacy 1… assets, plus fresh multi-chain accounts from the same seed.</span>';
      else n.textContent = '';
    };
    $('#bDo').onclick = async () => {
      const m = $('#rSeed').value.trim().replace(/\s+/g, ' ').toLowerCase();
      const s = $('#rStatus'); s.hidden = false; s.className = 'statusline err';
      const isCw = !C.validateMnemonic(m) && C.isCwPhrase(m);
      if (!C.validateMnemonic(m) && !isCw) return (s.textContent = 'That phrase is not a valid BIP-39 mnemonic or Counterwallet passphrase (check spelling & order).');
      if ($('#rPw1').value.length < 8) return (s.textContent = 'Password must be at least 8 characters.');
      if ($('#rPw1').value !== $('#rPw2').value) return (s.textContent = 'Passwords do not match.');
      s.className = 'statusline load'; s.textContent = 'Encrypting…';
      try { await C.createVault(m, $('#rPp').value, $('#rPw1').value); if (isCw) setAcctBtcType(0, 'legacy'); closeModal(); renderUnlocked(); } // CW assets live on legacy → default there
      catch (err) { s.className = 'statusline err'; s.textContent = 'Failed: ' + err.message; }
    };
  }

  // ── Gated reveal seed / secrets / custom path ──
  function passwordGate(title, onOk) {
    const c = modal(`<h3 class="m-title">${title}</h3><p class="fine">Re-enter your password to continue.</p>
      <input id="gp" class="m-in" type="password" placeholder="Password" autocomplete="current-password" />
      <div id="gStatus" class="statusline" hidden></div>
      <div class="wbtns"><button class="ghost" id="mc">Cancel</button><button class="primary" id="bGo">Continue</button></div>`);
    $('#mc').onclick = closeModal;
    $('#bGo').onclick = async () => {
      const s = $('#gStatus'); s.hidden = false; s.className = 'statusline load'; s.textContent = 'Verifying…';
      try { await onOk($('#gp').value); } catch (err) { s.className = 'statusline err'; s.textContent = err.message === 'wrong_password' ? 'Wrong password.' : 'Failed: ' + err.message; }
    };
  }
  function gatedRevealSeed() {
    passwordGate('Reveal recovery phrase', async (pw) => {
      const { mnemonic, passphrase } = await C.revealSeed(pw);
      const grid = mnemonic.split(' ').map((w, i) => `<span class="seedw"><i>${i + 1}</i>${esc(w)}</span>`).join('');
      const c = modal(`<h3 class="m-title">Recovery phrase</h3>
        <div class="warn">Never share this. Anyone with it controls your funds.</div>
        <div class="seedgrid blurred" id="sg">${grid}</div>
        <button class="ghost sm" id="bB">Tap to reveal</button><button class="mini" id="bC" style="margin-left:8px">Copy</button>
        ${passphrase ? '<div class="fine">+ a BIP-39 passphrase is set on this wallet.</div>' : ''}
        <button class="modal-x" id="mc">Done</button>`);
      let r = false; $('#bB').onclick = () => { r = !r; $('#sg').classList.toggle('blurred', !r); $('#bB').textContent = r ? 'Hide' : 'Tap to reveal'; };
      $('#bC').onclick = (e) => copy(mnemonic, e.target, true); $('#mc').onclick = closeModal;
    });
  }
  function gatedSecrets(account) {
    passwordGate('Export private keys', async (pw) => {
      const sec = await C.secrets(pw, account, 0); // SECURITY (audit H2): secrets() now verifies the password
      // SECURITY (audit §4): keep raw keys in a closure, NOT in the DOM/data-attributes.
      const items = [
        ['BTC Native SegWit (WIF)', sec.bitcoin.nativeSegwit.wif],
        ['BTC Legacy (WIF)', sec.bitcoin.legacy.wif],
        ['BTC Taproot (WIF)', sec.bitcoin.taproot.wif],
        ['Ethereum (hex)', sec.ethereum.privateKey],
        ['Solana (base58)', sec.solana.secretKey],
      ];
      const line = (lab, i) => `<div class="acct"><div class="acct-l"><span class="acct-lab">${esc(lab)}</span></div><div class="acct-r"><span class="acct-addr secret" title="hidden">••••••••••••••••</span><button class="mini" data-i="${i}">copy</button></div></div>`;
      const c = modal(`<h3 class="m-title">Private keys · account ${esc(account)}</h3>
        <div class="warn">These keys spend your funds. Copy into a trusted wallet only — never paste into a website or share.</div>
        ${items.map((it, i) => line(it[0], i)).join('')}
        <button class="modal-x" id="mc">Done</button>`);
      c.querySelectorAll('[data-i]').forEach((b) => (b.onclick = () => copy(items[Number(b.dataset.i)][1], b, true)));
      $('#mc').onclick = () => { items.forEach((it) => (it[1] = '')); closeModal(); }; // scrub on close
    });
  }
  function customPath() {
    passwordGate('Derive custom path (OG recovery)', async (pw) => {
      const { mnemonic, passphrase } = await C.revealSeed(pw);
      const c = modal(`<h3 class="m-title">Custom derivation path</h3>
        <p class="fine">For recovering assets on non-standard historical paths. Enter a BIP-32 path.</p>
        <input id="cpPath" class="m-in" type="text" value="m/44'/0'/0'/0/0" />
        <select id="cpChain" class="m-in"><option value="bitcoin-legacy">Bitcoin · Legacy</option><option value="bitcoin-nativeSegwit">Bitcoin · Native SegWit</option><option value="bitcoin-taproot">Bitcoin · Taproot</option><option value="bitcoin-nestedSegwit">Bitcoin · Nested SegWit</option><option value="ethereum">Ethereum</option><option value="solana">Solana</option></select>
        <div class="wbtns"><button class="primary" id="bDeriveP">Derive address</button></div>
        <div id="cpOut" class="cp-out" hidden></div>
        <button class="modal-x" id="mc">Done</button>`);
      $('#mc').onclick = closeModal;
      $('#bDeriveP').onclick = () => {
        try {
          const [chain, btcType] = $('#cpChain').value.split('-');
          const addr = C.deriveCustom(mnemonic, passphrase, $('#cpPath').value.trim(), chain, btcType || 'legacy');
          const out = $('#cpOut'); out.hidden = false; out.innerHTML = `<span class="acct-addr">${esc(addr)}</span><button class="mini" data-copy="${esc(addr)}">copy</button>`; // esc: audit #7b
          out.querySelector('[data-copy]').onclick = (e) => copy(addr, e.target);
        } catch (err) { const out = $('#cpOut'); out.hidden = false; out.innerHTML = `<span class="statusline err">Invalid path: ${esc(err.message)}</span>`; }
      };
    });
  }

  // ── Send BTC (asset-safe; signs client-side, broadcasts via server) ──
  // Legacy (P2PKH) inputs need the full previous tx (nonWitnessUtxo) to sign — fetch them.
  async function fetchPrevTxs(type, txids, statusEl) {
    if (type !== 'legacy') return {};
    if (statusEl) statusEl.textContent = 'Fetching previous transactions…';
    const uniq = [...new Set(txids)];
    const got = await Promise.all(uniq.map((t) => fetch('api/btc/tx/' + t + '/hex').then((r) => (r.ok ? r.text() : null)).then((h) => [t, h && h.trim()]).catch(() => [t, null])));
    const out = {};
    for (const [t, h] of got) { if (h) out[t] = h; }
    return out;
  }
  async function flowSend(acc) {
    const isImp = acctKind === 'imported', useImpId = isImp ? impId : null;
    let sendType = curBtcType(), from = isImp ? impBtcAddr() : acc.bitcoin[sendType].address;
    let fees = { fastestFee: 10, halfHourFee: 6, hourFee: 3, economyFee: 2 };
    try { fees = await fetch('api/btc/fees').then((r) => r.json()); } catch (_) {}
    const c = modal(`<h3 class="m-title">Send Bitcoin</h3>
      <div class="send-from" id="sFromAddr" title="Sending from your ${esc(BTC_LABEL[sendType] || 'Bitcoin')} address — set the address type on the wallet dashboard"><span class="sf-type">${esc(BTC_LABEL[sendType] || 'Bitcoin')}</span><span class="sf-addr">${esc(from)}</span></div>
      <div class="fine">Only <b>spendable</b> UTXOs are used — asset-bearing, frozen &amp; time-locked outputs are never spent.</div>
      <input id="sTo" class="m-in" placeholder="Address or name (bc1q… / 1… / bc1p… / satoshi.btc)" spellcheck="false" autocapitalize="off" />
      <div id="nameResolve" class="name-resolve" hidden></div>
      <div class="send-amt"><input id="sAmt" class="m-in" type="number" step="0.00000001" min="0" placeholder="Amount (BTC)" />
        <label class="send-max"><input type="checkbox" id="sMax" /> Max</label></div>
      <div id="dispPanel" class="disp-panel" hidden></div>
      <div class="fee-row" id="feeRow">
        ${[['fastestFee', 'Fast'], ['halfHourFee', '30m'], ['hourFee', '1h'], ['economyFee', 'Econ']].map(([k, l], i) => `<button class="feeopt ${i === 1 ? 'on' : ''}" data-r="${fees[k] || 5}">${l} · ${fees[k] || '–'}</button>`).join('')}
        <input id="sFee" class="m-in fee-custom" type="number" min="0.1" step="0.1" placeholder="custom s/vB" />
      </div>
      <div id="feeHint" class="fee-hint" hidden></div>
      <label class="send-rbf"><input type="checkbox" id="sRbf" checked /> Enable RBF (replaceable)</label>
      <div id="sStatus" class="statusline" hidden></div>
      <div class="wbtns"><button class="ghost" id="mc">Cancel</button><button class="primary" id="bReview">Review</button></div>`);
    fees = window.WWFee ? window.WWFee.stagger(fees, ['fastestFee', 'halfHourFee', 'hourFee', 'economyFee']) : fees; // strictly descending presets (no ties)
    let feeRate = fees.halfHourFee || 6;
    // Send is paired to the account's currently-selected address type (set on the dashboard) — no in-modal picker.
    const feeHint = (r) => { const h = $('#feeHint'); if (!h) return; if (r > 0 && r < 1) { h.hidden = false; h.textContent = '⚠ Below 1 sat/vB may not relay on all nodes — best when the mempool is near-empty.'; } else { h.hidden = true; } };
    c.querySelectorAll('.feeopt').forEach((b) => (b.onclick = () => { c.querySelectorAll('.feeopt').forEach((x) => x.classList.remove('on')); b.classList.add('on'); feeRate = Number(b.dataset.r); $('#sFee').value = ''; feeHint(feeRate); }));
    $('#sFee').oninput = (e) => { if (e.target.value !== '') { const r = Number(e.target.value); if (r > 0) { feeRate = r; c.querySelectorAll('.feeopt').forEach((x) => x.classList.remove('on')); feeHint(r); } } };
    // Dispenser detection: if the recipient runs an open Counterparty dispenser, offer trigger quantities.
    let _dispT = null, btcUsd = 0, dispPromise = null; // WW-B20: the asset a dispense should return, carried to the final confirm
    try { if (!isTN()) btcUsd = (await fetch('api/prices').then((r) => r.json())).bitcoin || 0; } catch (_) {}
    const sats = (n) => Number(n).toLocaleString('en-US');
    const toUsd = (satsAmt) => { const u = (satsAmt / 1e8) * btcUsd; return u ? ' ≈ $' + u.toLocaleString('en-US', { maximumFractionDigits: 2 }) : ''; };
    function renderDisp(d) {
      const panel = $('#dispPanel'); panel.hidden = false;
      const maxDisp = Math.max(1, Math.floor(parseFloat(d.remaining) / parseFloat(d.giveQty)) || 1); // remaining is asset units → dispense count
      const opts = [1, 2, 4, 6].filter((q) => q <= maxDisp);
      if (!opts.length) opts.push(1);
      panel.innerHTML = `<div class="disp-hit"><span class="disp-check">✓</span> <b>Dispenser detected.</b> Gives <b>${esc(d.giveQty)} ${esc(d.asset)}</b> per <b>${sats(d.satoshirate)} sats</b>${toUsd(d.satoshirate)} · <b>${maxDisp}</b> dispense${maxDisp === 1 ? '' : 's'} left</div>
        <div class="disp-qty"><span class="disp-lbl">Trigger:</span>${opts.map((q) => `<button type="button" class="disp-q" data-q="${q}">${q}×</button>`).join('')}</div>
        <div class="disp-cost" id="dispCost">Pick how many to trigger — it fills the amount for you.</div>`;
      panel.querySelectorAll('.disp-q').forEach((b) => (b.onclick = () => {
        panel.querySelectorAll('.disp-q').forEach((x) => x.classList.toggle('on', x === b));
        const q = Number(b.dataset.q), totalSats = q * d.satoshirate;
        $('#sAmt').value = (totalSats / 1e8).toFixed(8); $('#sMax').checked = false;
        const recv = (parseFloat(d.giveQty) * q).toLocaleString('en-US', { maximumFractionDigits: 8 });
        dispPromise = { asset: d.asset, recv, disp: q, sats: totalSats }; // carried to the irreversible confirm (WW-B20)
        $('#dispCost').innerHTML = `<b>${q}×</b> → send <b>${sats(totalSats)} sats</b> (${(totalSats / 1e8).toFixed(8)} BTC${toUsd(totalSats)}) + miner fee → receive ~<b>${esc(recv)} ${esc(d.asset)}</b>`;
      }));
    }
    // SRC-101 name resolution: typing "satoshi.btc" resolves to the owner/record address (first
    // wallet to natively resolve Bitcoin Stamps names). `resolvedName` holds the confirmed target.
    let resolvedName = null;
    const RE_ADDR = /^(bc1[a-z0-9]{8,87}|[13][a-km-zA-HJ-NP-Z1-9]{25,39})$/;
    const RE_DOTBTC = /^[a-z0-9][a-z0-9._-]{0,62}\.btc$/i;
    if (window.WonderBook) WonderBook.attach($('#sTo'), 'btc');
    $('#sTo').oninput = () => {
      clearTimeout(_dispT); dispPromise = null; // recipient changed → any prior dispenser promise is stale
      const panel = $('#dispPanel'), nr = $('#nameResolve');
      const raw = $('#sTo').value.trim();
      // A .btc name → resolve it; otherwise clear the name banner and run dispenser detection.
      if (RE_DOTBTC.test(raw)) {
        resolvedName = null; panel.hidden = true; panel.innerHTML = '';
        nr.hidden = false; nr.className = 'name-resolve load'; nr.textContent = 'Resolving ' + raw + ' via Bitcoin Stamps…';
        _dispT = setTimeout(async () => {
          try {
            const r = await fetch('api/src101/resolve/' + encodeURIComponent(raw)).then((x) => x.json());
            if ($('#sTo').value.trim() !== raw) return; // stale
            if (r && r.exists && r.address) {
              resolvedName = { name: r.name, address: r.address };
              nr.className = 'name-resolve ok';
              nr.innerHTML = '✓ <b>' + esc(r.name) + '</b> → <span class="nr-addr">' + esc(r.address) + '</span> <span class="nr-src">· Bitcoin Stamps SRC-101</span>';
            } else if (r && r.expired) {
              nr.className = 'name-resolve bad'; nr.textContent = '⚠ ' + raw + ' has expired — not safe to send to.';
            } else {
              nr.className = 'name-resolve bad'; nr.textContent = '✕ ' + raw + ' is not registered on Bitcoin Stamps (SRC-101).';
            }
          } catch (_) { nr.className = 'name-resolve bad'; nr.textContent = 'Could not resolve ' + raw + '.'; }
        }, 350);
        return;
      }
      resolvedName = null; nr.hidden = true; nr.innerHTML = '';
      _dispT = setTimeout(async () => {
        const to = raw;
        if (!RE_ADDR.test(to)) { panel.hidden = true; panel.innerHTML = ''; return; }
        try {
          const { dispensers } = await fetch(`api/cp/dispensers/${to}`).then((r) => r.json());
          if ($('#sTo').value.trim() !== to) return; // stale
          if (!dispensers || !dispensers.length) { panel.hidden = true; panel.innerHTML = ''; return; }
          renderDisp(dispensers[0]);
        } catch (_) { panel.hidden = true; }
      }, 400);
    };
    $('#mc').onclick = closeModal;
    $('#bReview').onclick = async () => {
      const s = $('#sStatus'); s.hidden = false; s.className = 'statusline load'; s.textContent = 'Selecting safe UTXOs & signing…';
      try {
        let to = $('#sTo').value.trim();
        // Resolve a .btc name to its address (must be confirmed-resolved before sending).
        if (RE_DOTBTC.test(to)) {
          if (!resolvedName || resolvedName.name.toLowerCase() !== to.toLowerCase() || !resolvedName.address) {
            const r = await fetch('api/src101/resolve/' + encodeURIComponent(to)).then((x) => x.json()).catch(() => null);
            if (!r || !r.exists || !r.address) throw new Error('“' + to + '” is not a registered Bitcoin Stamps name — check the spelling.');
            resolvedName = { name: r.name, address: r.address };
          }
          to = resolvedName.address;
        }
        const sendMax = $('#sMax').checked;
        const amountSats = sendMax ? 0 : Math.round(parseFloat($('#sAmt').value) * 1e8);
        if (!to) throw new Error('Enter a recipient address.');
        if (!sendMax && (!amountSats || amountSats < 0)) throw new Error('Enter a valid amount.');
        const cc = await fetch(`api/btc/${from}/coincontrol`).then((r) => r.json());
        const spendable = cc.utxos.filter((u) => u.category === 'spendable' && !u.frozen && !u.timelocked).map((u) => ({ txid: u.txid, vout: u.vout, value: u.value }));
        if (!spendable.length) throw new Error('No spendable UTXOs on this address.');
        const prevTxs = await fetchPrevTxs(sendType, spendable.map((u) => u.txid), s);
        const tx = C.send({ account: acc ? acc.account : 0, importedId: useImpId, type: sendType, utxos: spendable, recipient: to, amountSats, feeRate, rbf: $('#sRbf').checked, sendMax, prevTxs });
        showSendPreview(acc, tx, to, sendType, prevTxs, resolvedName, from, (dispPromise && dispPromise.sats === amountSats) ? dispPromise : null);
      } catch (err) {
        s.className = 'statusline err';
        s.textContent = err.message === 'insufficient_funds' ? 'Insufficient spendable balance for that amount + fee.' : (err.message || 'Could not build transaction.');
      }
    };
  }
  function showSendPreview(acc, tx, to, sendType = 'nativeSegwit', prevTxs = {}, named = null, from = null, disp = null) {
    const btc = (n) => (n / 1e8).toLocaleString('en-US', { maximumFractionDigits: 8 });
    const usd = (sats) => { const p = DASH_PRICES.bitcoin || 0; return p && sats ? ` <span class="fine">≈ $${((sats / 1e8) * p).toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>` : ''; };
    const toDisplay = named && named.name ? `<b>${esc(named.name)}</b><br><span class="mono fine">${esc(to)}</span>` : `<b class="mono">${esc(to)}</b>`;
    const c = modal(`<h3 class="m-title">Confirm send</h3>
      <div class="prev-flow"><div class="pf"><span>You send</span><b>${btc(tx.amountSats)} BTC${usd(tx.amountSats)}</b></div>
        <div class="pf-arrow">↓</div><div class="pf"><span>To</span>${toDisplay}</div></div>
      <div class="m-grid">
        <div><span class="k">Network fee</span><span class="v">${tx.fee.toLocaleString()} sats${usd(tx.fee)}</span></div>
        <div><span class="k">Size</span><span class="v">${tx.vsize} vB</span></div>
        <div><span class="k">Inputs</span><span class="v">${tx.inputs.length}</span></div>
        <div><span class="k">Change back</span><span class="v">${btc(tx.change)} BTC</span></div>
      </div>
      ${disp ? `<div class="warn" style="margin-top:8px;border-color:#b8860b">⚠ <b>Dispenser payment.</b> You should receive ~<b>${esc(disp.recv)} ${esc(disp.asset)}</b> (${esc(String(disp.disp))} dispense${disp.disp === 1 ? '' : 's'}) — but this is enforced by the dispenser, <b>not</b> by Bitcoin. Wonder cannot guarantee it; only send if you trust this dispenser is genuine. The asset is delivered in a separate Counterparty transaction after your BTC confirms.</div>` : ''}
      <div class="fine" style="margin-top:8px">Signed locally. ${tx.txid ? 'TXID ' + tx.txid.slice(0, 16) + '…' : ''}</div>
      <div id="bcStatus" class="statusline" hidden></div>
      <div class="wbtns"><button class="ghost" id="bBack">Back</button><button class="ghost" id="bPsbt">Export PSBT</button><button class="primary" id="bBroadcast">Broadcast</button></div>`);
    $('#bBack').onclick = () => flowSend(acc);
    $('#bPsbt').onclick = () => {
      const un = C.send({ account: acc ? acc.account : 0, importedId: (acctKind === 'imported' ? impId : null), type: sendType, utxos: tx.inputs.map((i) => ({ txid: i.utxo.split(':')[0], vout: +i.utxo.split(':')[1], value: i.value })), recipient: to, amountSats: tx.amountSats, feeRate: Math.max(1, Math.round(tx.fee / tx.vsize)), rbf: true, sendMax: false, sign: false, prevTxs });
      modal(`<h3 class="m-title">Unsigned PSBT</h3><p class="fine">For hardware wallets / co-signing. Base64:</p>
        <textarea class="m-in" rows="5" readonly>${un.psbt}</textarea>
        <div class="wbtns"><button class="primary" id="bCopyP">Copy</button><button class="ghost" id="mc">Done</button></div>`);
      $('#bCopyP').onclick = (e) => copy(un.psbt, e.target); $('#mc').onclick = closeModal;
    };
    $('#bBroadcast').onclick = async () => {
      const s = $('#bcStatus'); s.hidden = false; s.className = 'statusline load'; s.textContent = 'Verifying…';
      try {
        // WW-C05: never push a tx signed in a session that has since auto-locked — discard it.
        if (!C.isUnlocked()) throw new Error('Wallet locked — this transaction was discarded. Unlock and rebuild it.');
        // Fail-closed re-verification before the tx leaves the wallet: re-decode an unsigned twin of the
        // exact reviewed tx (same inputs/outputs) and run outputs + fee + SIGHASH + fresh coin-control
        // input checks. BTC leaves only to the recipient or change; a UTXO frozen/asset-bearing since the
        // preview is caught here. (The checks don't depend on rbf sequence, so the twin is representative.)
        if (window.WonderVerify && from) {
          const feeRate = Math.max(1, Math.round(tx.fee / tx.vsize));
          const un = C.send({ account: acc ? acc.account : 0, importedId: (acctKind === 'imported' ? impId : null), type: sendType, utxos: tx.inputs.map((i) => ({ txid: i.utxo.split(':')[0], vout: +i.utxo.split(':')[1], value: i.value })), recipient: to, amountSats: tx.amountSats, feeRate, rbf: true, sendMax: false, sign: false, prevTxs });
          await window.WonderVerify.verify(un, { from, dests: [to], allowed: [to], feeMaxSats: Math.ceil(tx.fee * 1.05) });
        }
        s.textContent = 'Broadcasting…';
        const r = await fetch('api/btc/broadcast', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ txhex: tx.txhex }) }).then((x) => x.json());
        if (r.error) throw new Error(r.detail || r.error);
        s.className = 'statusline'; s.innerHTML = `Sent ✓ — <a href="https://mempool.space/tx/${encodeURIComponent(r.txid)}" target="_blank" rel="noopener" style="color:var(--gold2)">${esc(String(r.txid).slice(0, 18))}…</a>`;
        sentDone(() => renderUnlocked());
      } catch (err) { s.className = 'statusline err'; s.textContent = 'Rejected: ' + (err.message || 'broadcast failed'); }
    };
  }

  // ── Sign message — BIP-322 for Native SegWit (bc1q), classic Bitcoin Signed Message for Legacy
  //    (1…). Works for HD and imported keys; imported OG Counterparty 1… addresses use BSM. ──
  function flowSignMessage() {
    const isImp = acctKind === 'imported';
    const defType = curBtcType() === 'legacy' ? 'legacy' : 'nativeSegwit';
    const types = [['nativeSegwit', 'Native SegWit · bc1q'], ['legacy', 'Legacy · 1…']];
    modal(`<h3 class="m-title">Sign message</h3>
      <p class="fine">Prove you control an address without spending. Native SegWit uses BIP-322; Legacy uses the classic Bitcoin Signed Message. Works for imported keys too.</p>
      <label class="cpf"><span>Sign as</span><select id="smType" class="m-in">${types.map((t) => `<option value="${t[0]}"${t[0] === defType ? ' selected' : ''}>${t[1]}</option>`).join('')}</select></label>
      <div class="fine mono" id="smAddr" style="margin:2px 0 8px;word-break:break-all"></div>
      <textarea id="smMsg" class="m-in" rows="3" placeholder="Message to sign…"></textarea>
      <div id="smStatus" class="statusline" hidden></div>
      <div id="smOut" hidden><div class="fine" id="smOutLbl" style="margin-top:10px">Signature</div>
        <textarea id="smSig" class="m-in" rows="3" readonly></textarea>
        <button class="mini" id="smCopy" style="margin-top:6px">Copy signature</button></div>
      <div class="wbtns"><button class="ghost" id="mc">Close</button><button class="primary" id="bSignIt">Sign</button></div>`);
    $('#mc').onclick = closeModal;
    const typeSel = $('#smType'), addrEl = $('#smAddr');
    const showAddr = () => { try { const t = typeSel.value; let addr; if (isImp) { const im = currentImported(); addr = im && im.bitcoin[t] ? im.bitcoin[t].address : ''; } else { const acc = C.accounts(curAccount, 0, NET()); addr = acc.bitcoin[t] ? acc.bitcoin[t].address : ''; } addrEl.textContent = addr ? ('address: ' + addr) : ''; } catch (e) { addrEl.textContent = ''; } };
    typeSel.onchange = showAddr; showAddr();
    $('#bSignIt').onclick = () => {
      try {
        const msg = $('#smMsg').value; if (!msg) throw new Error('Enter a message to sign.');
        const t = typeSel.value;
        const res = isImp ? C.signMessageImported(msg, impId, t) : C.signMessage(msg, curAccount, t);
        $('#smSig').value = res.signature; $('#smOut').hidden = false;
        $('#smOutLbl').textContent = 'Signature · ' + res.format + ' · ' + shortA(res.address);
        $('#smCopy').onclick = (e) => copy(res.signature, e.target);
      } catch (err) { const s = $('#smStatus'); s.hidden = false; s.className = 'statusline err'; s.textContent = /unsupported/i.test(err.message || '') ? 'This address type can’t be message-signed here — use Native SegWit or Legacy.' : ('Failed: ' + err.message); }
    };
  }

  // ── View derived accounts in the portfolio (reuses Phase 2 read layer) ──
  function viewInPortfolio(acc) {
    if (!window.WW || !window.WW.renderOwnCards) return;
    window.WW.renderOwnCards([
      { id: 'own-btc', chain: 'bitcoin', address: acc.bitcoin.nativeSegwit.address, label: 'My BTC (account ' + acc.account + ')' },
      { id: 'own-eth', chain: 'ethereum', address: acc.ethereum.address, label: 'My ETH (account ' + acc.account + ')' },
      { id: 'own-sol', chain: 'solana', address: acc.solana.address, label: 'My SOL (account ' + acc.account + ')' },
    ]);
    document.querySelector('.portfolio')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // helpers (no Math.random dependency for determinism-friendliness)
  let _seedctr = 1;
  function hashRand() { _seedctr = (_seedctr * 1103515245 + 12345) & 0x7fffffff; return _seedctr / 0x7fffffff; }
  const WL = 'abandon ability able about above absent absorb abstract absurd abuse access accident account accuse achieve acid acoustic acquire across act action actor actress actual'.split(' ');
  function sampleWrong(correct, n) { const out = []; while (out.length < n) { const w = WL[Math.floor(hashRand() * WL.length)]; if (w !== correct && !out.includes(w)) out.push(w); } return out; }

  // Enter the Ledger dashboard (called by hardware-ui after a successful connect).
  function showHardware(accts) { HW = accts; hwBtcType = 'nativeSegwit'; acctKind = 'hardware'; dashChain = 'btc'; dashTab = 'tokens'; DASH_ASSETS = null; render(); }

  // boot
  // Session persistence + idle auto-lock (opt-in). Save the session on unlock; on lock (manual or idle),
  // wipe it and re-render to the lock screen. Reset the idle countdown on user activity.
  try { C.onLockChange((unlocked) => { if (unlocked) saveSession(); else { clearSession(); lockPanic(); render(); } }); } catch (_) {}
  ['mousemove', 'keydown', 'mousedown', 'touchstart', 'scroll'].forEach((e) => window.addEventListener(e, bumpActivity, { passive: true }));

  // Boot: resume a persisted session (opt-in), restore the last-selected account, then render.
  function boot() { try { tryResumeSession(); refreshImported(); if (C.isUnlocked()) restoreLastAcct(); } catch (_) {} render(); }
  if (document.readyState !== 'loading') boot(); else document.addEventListener('DOMContentLoaded', boot);
  // Switching network from the in-wallet badge re-renders so balances/addresses re-derive for the
  // new network (clear cached assets first so mainnet holdings don't flash under a testnet address).
  if (window.WWNet && window.WWNet.onChange) window.WWNet.onChange(() => { DASH_ASSETS = null; DASH_PRICES = {}; render(); });
  window.WonderWalletUI = { render, showHardware };
})();
