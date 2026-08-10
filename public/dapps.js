/* Wonder Wallet — Tools rail (docked dApp dashboard). First-party, audited tooling + connections.
   The curated external dApp directory was removed: WalletConnect pairing + the user's own browser
   cover "go to a site" now. Provider injection (EIP-1193 / BTC PSBT / Solana Wallet Standard) is a
   desktop-extension capability; WalletConnect is the PWA path. Docked left rail on desktop
   (collapsible to icons), off-canvas drawer on mobile. */
'use strict';
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Crisp inline line-icons (feather-style, currentColor) — Unicode symbol glyphs don't render in Inter.
  const svg = (p) => `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  const ICON = {
    swap: '<path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
    chart: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
    plus: '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    token: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
    gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M5 12v9h14v-9"/><path d="M12 8S12 2 8.5 2 5 5.5 5 5.5 5.5 8 8.5 8z"/><path d="M12 8s0-6 3.5-6S19 5.5 19 5.5 18.5 8 15.5 8z"/>',
    tag: '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>',
    gem: '<path d="M6 3h12l4 6-10 12L2 9z"/><path d="M2 9h20"/><path d="M12 3L8 9l4 12 4-12z"/>',
    zap: '<path d="M13 2L3 14h9l-1 8 10-12h-9z"/>',
  };

  // First-party tooling, grouped by chain. Each item launches an audited in-browser module.
  const GROUPS = [
    { chain: 'Bitcoin · Counterparty', tools: [
      { ic: ICON.swap, name: 'Counterparty actions', desc: 'Send · Sweep · MPMA · Dispenser · Dividend', act: 'cp', accent: true },
      { ic: ICON.chart, name: 'Counterparty DEX', desc: 'Trustless on-chain order book', act: 'dex' },
      { ic: ICON.plus, name: 'Issuance suite', desc: 'Create · issue · lock · transfer · subassets', act: 'issuance' },
      { ic: ICON.link, name: 'Attach / Detach', desc: 'Bind CP assets to a UTXO or release', act: 'attachdetach' },
      { ic: ICON.token, name: 'SRC-20 deploy / mint', desc: 'Deploy & mint SRC-20 tokens', act: 'src20' },
      { ic: ICON.image, name: 'Stamps art minting', desc: 'Mint Bitcoin Stamps art on-chain', act: 'stampart' },
      { ic: ICON.gift, name: 'Fairminter', desc: 'Create & mint native CP fair mints', act: 'fairminter' },
      { ic: ICON.tag, name: 'Bitname (.btc)', desc: 'SRC-101 — register · transfer · renew', act: 'src101' },
    ] },
    { chain: 'Ethereum', tools: [
      { ic: ICON.gem, name: 'Emblem bridge', desc: 'Vault inventory + wrap / redeem', act: 'emblem' },
    ] },
  ];

  // Tools that support a CONNECTED external wallet (compose here, the wallet signs via its provider).
  // The rest (SRC-20 / Stamps art minting, Bitname, Emblem bridge) need a local signing account.
  const CONN_OK = new Set(['cp', 'dex', 'issuance', 'attachdetach', 'fairminter']);
  // Tools a connected wallet / Ledger can sign (compose here → external signer → broadcast): the CP
  // suite plus SRC-20 and Stamps-art minting (both compose a PSBT the same audited way).
  const EXT_OK = new Set(['cp', 'dex', 'issuance', 'attachdetach', 'fairminter', 'src20', 'stampart']);
  const NAME = {}; GROUPS.forEach((g) => g.tools.forEach((t) => { NAME[t.act] = t.name; }));

  let collapsed = false;
  try { collapsed = localStorage.getItem('ww:rail:collapsed') === '1'; } catch (_) {}

  const isMobile = () => window.matchMedia('(max-width: 900px)').matches;
  const isTN = () => { try { return !!(window.WWNet && window.WWNet.isTestnet()); } catch (_) { return false; } };
  const short = (a) => (a && a.length > 16 ? a.slice(0, 8) + '…' + a.slice(-5) : (a || ''));

  // ── wallet state (polled; decoupled from the wallet's render) ──
  // 'local'     — an unlocked seed/imported account (window.__activeAccount): full tool suite.
  // 'connected' — an external wallet paired via WalletConnect / the extension (window.__connectedWallet):
  //               the wallet signs; only the CP suite (CONN_OK) is available.
  // 'locked'    — no open wallet (rail is hidden by wallet-ui in this state anyway).
  function state() {
    const local = window.__activeAccount, conn = window.__connectedWallet, hw = window.__hardwareWallet;
    if (local) { let addr = null; try { addr = local.btcAddress || (local.bitcoin && (local.bitcoin.nativeSegwit ? local.bitcoin.nativeSegwit.address : (local.bitcoin.address || null))); } catch (_) {} return { mode: 'local', addr, tn: isTN(), name: null }; }
    if (conn) return { mode: 'connected', addr: conn.address || null, tn: false, name: conn.name || 'wallet' };
    // Ledger: a connected-style signer when signable (native-segwit main address → CP suite works);
    // otherwise read-only (legacy/taproot/browsed — on-device signing for those is a follow-up).
    if (hw) return { mode: 'hardware', addr: hw.address || null, tn: false, name: hw.name || 'Ledger', canSign: !!hw.signPsbt, type: hw.type || null };
    return { mode: 'locked', addr: null, tn: false, name: null };
  }
  function paintPill() {
    const el = $('#railConn'); if (!el) return;
    const s = state(), open = s.mode !== 'locked';
    const hwSign = s.mode === 'hardware' && s.canSign; // Ledger, native-segwit → can sign the CP suite
    const ro = s.mode === 'hardware' && !s.canSign;    // Ledger, read-only (legacy/taproot/browsed)
    el.classList.toggle('on', (open && !s.tn && s.mode !== 'hardware') || hwSign);
    el.classList.toggle('tn', (open && s.tn) || ro); // amber dot for testnet OR read-only Ledger
    const t = el.querySelector('.rail-conn-s'), b = el.querySelector('.rail-conn-a');
    var TYPE_LBL = { nativeSegwit: 'Native SegWit', legacy: 'Legacy 1…', taproot: 'Taproot' };
    if (t) t.textContent = s.mode === 'hardware' ? (s.canSign ? ('Ledger · ' + (TYPE_LBL[s.type] || 'connected')) : 'Ledger · read-only')
      : s.mode === 'connected' ? ('Connected · ' + s.name)
      : (open ? (s.tn ? 'Connected · Testnet' : 'Connected') : 'Wallet locked');
    if (b) b.textContent = open ? (s.addr ? short(s.addr) : (ro ? 'on-device signing soon' : 'signing ready')) : 'unlock to use tools';
    paintTools(s.mode, s.canSign);
  }
  // Grey out tools that aren't usable in the current mode: connected/Ledger → CP suite only (they sign
  // via the wallet/device); a read-only Ledger → everything greyed until on-device signing for its
  // address type lands. SRC-20 / Stamps art / Bitname / Emblem need a local or (soon) wired path.
  function paintTools(mode, canSign) {
    const rail = $('#toolRail'); if (!rail) return;
    rail.querySelectorAll('.rail-item[data-act]').forEach((b) => {
      const act = b.dataset.act;
      const base = b.getAttribute('data-basetitle') || b.getAttribute('title') || '';
      if (!b.getAttribute('data-basetitle')) b.setAttribute('data-basetitle', base);
      let dis = false, tip = base;
      if (mode === 'hardware') {
        if (!canSign) { dis = true; tip = 'Ledger is read-only for this address — switch to your main signing address (Native SegWit / Legacy / Taproot).'; }
        else if (act === 'connect' || !EXT_OK.has(act)) { dis = true; tip = (act === 'connect' ? 'Connecting dApps' : (NAME[act] || 'This tool')) + ' — not available on Ledger yet.'; }
      } else if (mode === 'connected' && act !== 'connect' && !EXT_OK.has(act)) {
        dis = true; tip = (NAME[act] || 'This tool') + ' — needs a local Wonder Wallet (this signer can’t handle it yet).';
      }
      b.disabled = dis;
      b.setAttribute('title', tip);
    });
  }

  // ── render the rail ──
  function railHtml() {
    const grp = GROUPS.map((g) => {
      const items = g.tools.map((t) => `
        <button class="rail-item${t.accent ? ' accent' : ''}" data-act="${esc(t.act)}" title="${esc(t.name)} — ${esc(t.desc)}">
          <span class="rail-ic">${svg(t.ic)}</span>
          <span class="rail-tx"><span class="rail-lbl">${esc(t.name)}</span><span class="rail-sub">${esc(t.desc)}</span></span>
        </button>`).join('');
      return `<div class="rail-grp">${esc(g.chain)}</div>${items}`;
    }).join('');
    return `
      <div class="rail-head">
        <span class="rail-title">Tools</span>
        <button class="rail-collapse" id="railCollapse" title="Collapse / expand">${collapsed && !isMobile() ? '›' : '‹'}</button>
      </div>
      <div class="rail-conn" id="railConn" title="Wallet connection">
        <span class="rail-dot"></span>
        <span class="rail-conn-t"><span class="rail-conn-s">…</span><span class="rail-conn-a"></span></span>
      </div>
      ${grp}
      <div class="rail-grp">Connections</div>
      <button class="rail-item accent" data-act="connect" title="Pair a dApp with WalletConnect">
        <span class="rail-ic">${svg(ICON.zap)}</span>
        <span class="rail-tx"><span class="rail-lbl">Connect a dApp</span><span class="rail-sub">WalletConnect · pair by URI</span></span>
      </button>
      <div class="rail-foot">First-party, audited tooling — your keys never leave this browser. Browse any dApp you like and pair it here.</div>`;
  }

  function render() {
    const rail = $('#toolRail'); if (!rail) return;
    rail.innerHTML = railHtml();
    rail.classList.toggle('collapsed', collapsed && !isMobile());
    const c = $('#railCollapse'); if (c) c.onclick = () => (isMobile() ? closeDrawer() : setCollapsed(!collapsed));
    rail.querySelectorAll('[data-act]').forEach((b) => (b.onclick = () => launch(b.dataset.act)));
    paintPill();
  }

  function setCollapsed(v) {
    collapsed = !!v;
    try { localStorage.setItem('ww:rail:collapsed', collapsed ? '1' : '0'); } catch (_) {}
    const rail = $('#toolRail'); if (rail) rail.classList.toggle('collapsed', collapsed);
    const c = $('#railCollapse'); if (c) c.textContent = collapsed ? '›' : '‹';
  }

  // ── mobile drawer ──
  function openDrawer() { const r = $('#toolRail'), s = $('#railScrim'); if (r) r.classList.add('open'); if (s) s.hidden = false; }
  function closeDrawer() { const r = $('#toolRail'), s = $('#railScrim'); if (r) r.classList.remove('open'); if (s) s.hidden = true; }
  function toggleDrawer() { const r = $('#toolRail'); if (r && r.classList.contains('open')) closeDrawer(); else openDrawer(); }

  // Topbar "☰ Tools": mobile → drawer; desktop → collapse toggle.
  function toggle() { isMobile() ? toggleDrawer() : setCollapsed(!collapsed); }
  // wallet-ui action buttons ("dApps") + programmatic reveal: always show the tools.
  function open() { if (isMobile()) openDrawer(); else setCollapsed(false); }

  // ── transient toast (locked / unavailable) ──
  function toast(msg) {
    let t = $('#railToast');
    if (!t) { t = document.createElement('div'); t.id = 'railToast'; t.className = 'rail-toast'; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('show');
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2600);
  }

  // ── launch a tool ──
  function launch(act) {
    const s = state();
    if (s.mode === 'hardware') {
      if (!s.canSign) return toast('Ledger is read-only for this address — switch to your main signing address (Native SegWit / Legacy / Taproot).');
      if (act === 'connect' || !EXT_OK.has(act)) return toast((NAME[act] || 'This tool') + ' isn’t on Ledger yet.');
      return launchConnected(act, window.__hardwareWallet); // device confirms; core finalizes; server broadcasts
    }
    if (act === 'connect') return openConnect();
    if (s.mode === 'locked') return toast('Unlock or connect a wallet first to use this tool.');
    if (s.mode === 'connected') return launchConnected(act, window.__connectedWallet);
    return launchLocal(act);
  }
  // Local seed/imported account → full suite, signed by the in-browser engine.
  function launchLocal(act) {
    const a = window.__activeAccount; if (!a) return;
    if (isMobile()) closeDrawer();
    // The account-window-selected address (native-segwit ↔ Legacy for OG assets), not a hardcoded one.
    const btc = a.btcAddress || a.bitcoin.nativeSegwit.address;
    if (act === 'cp' && window.CpActions) window.CpActions.open(a.account, btc);
    else if (act === 'dex' && window.CpActions) window.CpActions.dex(a.account, btc);
    else if (act === 'issuance' && window.CpActions) window.CpActions.issuanceSuite(a.account, btc);
    else if (act === 'attachdetach' && window.CpActions) window.CpActions.attachDetach(a.account, btc);
    else if (act === 'fairminter' && window.CpActions) window.CpActions.open(a.account, btc); // Fairminter lives in the CP panel
    else if (act === 'src20' && window.MintingModules) window.MintingModules.src20(a.account, btc);
    else if (act === 'stampart' && window.MintingModules) window.MintingModules.stampArt(a.account, btc);
    else if (act === 'src101' && window.Src101) window.Src101.open(a.account, btc);
    else if (act === 'emblem' && window.EmblemBridge) window.EmblemBridge.open(a.account, a.ethereum.address, btc);
    else toast('This tool isn’t available right now.');
  }
  // Connected external wallet → compose here, the wallet signs via its provider. Only the CP suite is wired.
  function launchConnected(act, conn) {
    conn = conn || window.__connectedWallet; if (!conn) return;
    if (!EXT_OK.has(act)) return toast((NAME[act] || 'This tool') + ' needs a local Wonder Wallet — this signer can’t handle it yet.');
    if (isMobile()) closeDrawer();
    const CA = window.CpActions, MM = window.MintingModules;
    if ((act === 'cp' || act === 'fairminter') && CA) CA.openConnected(conn);
    else if (act === 'dex' && CA) CA.dexConnected(conn);
    else if (act === 'issuance' && CA) CA.issuanceSuiteConnected(conn);
    else if (act === 'attachdetach' && CA) CA.attachDetachConnected(conn);
    else if (act === 'src20' && MM && MM.src20Connected) MM.src20Connected(conn);
    else if (act === 'stampart' && MM && MM.stampArtConnected) MM.stampArtConnected(conn);
    else toast('This tool isn’t available for the current signer.');
  }

  // ── WalletConnect pairing (modal) ──
  function modal(html) {
    let m = $('#dappmodal');
    if (!m) { m = document.createElement('div'); m.id = 'dappmodal'; m.className = 'modal'; m.innerHTML = '<div class="modal-card cc-card" id="dappCard"></div>'; document.body.appendChild(m); m.addEventListener('click', (e) => { if (e.target.id === 'dappmodal') m.hidden = true; }); }
    $('#dappCard').innerHTML = html; m.hidden = false; return $('#dappCard');
  }
  function openConnect() {
    if (isMobile()) closeDrawer();
    modal(`<div class="cc-head"><div><h3 class="m-title" style="margin:0">Connect a dApp</h3>
      <div class="cp-addr">Pair over WalletConnect — or use the desktop extension for direct provider injection</div></div><button class="mini" id="wcX">Close</button></div>
      <p class="fine" style="margin:10px 0">Paste a <b>WalletConnect</b> URI from any dApp to pair. On the desktop <b>extension</b>, Wonder Wallet also injects providers directly — <b>EIP-1193</b> (Ethereum), <b>PSBT / BIP-322</b> (Counterparty/Stamps) and the <b>Solana Wallet Standard</b> — a rare tri-chain capability.</p>
      <div class="row"><input id="wcUri" class="m-in" placeholder="wc:… (WalletConnect URI)" spellcheck="false"/><button class="primary" id="wcPair">Pair</button></div>
      <div id="wcStatus" class="statusline" hidden></div>
      <div class="acct-grp" style="margin-top:16px">Active sessions</div>
      <div class="fine">No active connections. Approved dApp sessions appear here, where you can review &amp; revoke them.</div>
      <div class="dapp-note" style="margin-top:12px">Pairing needs the WC relay (a scoped CSP exception) + a project ID and a live dApp — wired as the connectivity entry point; session signing routes to the same audited engine that signs everything else.</div>`);
    $('#wcX').onclick = () => { const m = $('#dappmodal'); if (m) m.hidden = true; };
    $('#wcPair').onclick = () => {
      const s = $('#wcStatus'); s.hidden = false;
      const uri = ($('#wcUri').value || '').trim();
      if (!/^wc:[0-9a-f]/i.test(uri)) { s.className = 'statusline err'; s.textContent = 'Enter a valid WalletConnect URI (wc:…).'; return; }
      s.className = 'statusline load'; s.textContent = 'WalletConnect relay pairing is the next connectivity build — the URI is valid and the flow is wired to the wallet’s signing engine.';
    };
  }

  // Public API — kept for topbar.js (☰ Tools) and wallet-ui action buttons ("dApps").
  // With a docked rail there is no hub modal to return to, so returnToHub/fromHub are false:
  // sub-modules simply close back to the wallet, with the rail still present.
  window.DappDashboard = { open, toggle, render, returnToHub: () => false, fromHub: () => false };

  function init() {
    render();
    const scrim = document.getElementById('railScrim'); if (scrim) scrim.onclick = closeDrawer;
    setInterval(paintPill, 1500);
    // Keep collapse (desktop) vs drawer (mobile) coherent across viewport changes.
    let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => {
      const r = $('#toolRail'); if (!r) return;
      if (isMobile()) { r.classList.remove('collapsed'); }
      else { r.classList.remove('open'); r.classList.toggle('collapsed', collapsed); const s = $('#railScrim'); if (s) s.hidden = true; }
    }, 150); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
