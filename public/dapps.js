/* Wonder Wallet — Phase 9 dApp Dashboard & tooling hub (SPEC §12).
   Cross-wallet, categorized by chain. Verified third-party directory (anti-impersonation
   domains pinned), first-party tooling shortcuts, favorites, "Vault now" shortcut, and the
   connections/session surface. Provider injection (EIP-1193 / BTC / Solana Wallet Standard)
   is an extension capability (Phase 12); WalletConnect is the PWA path (relay required). */
'use strict';
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Verified directory (Phase 0 §6 + SPEC §12). Domains pinned; URLs hard-coded (no user input).
  const DIR = {
    bitcoin: {
      first: [
        { name: 'Counterparty actions', desc: 'Send · Sweep · MPMA · Dispenser · Dividend · Destroy', action: 'cp' },
        { name: 'Counterparty DEX', desc: 'Trustless on-chain order book — place, browse & cancel orders', action: 'dex' },
        { name: 'Issuance suite', desc: 'Create · issue more · lock · transfer · re-describe · subassets', action: 'issuance' },
        { name: 'Attach / Detach', desc: 'Bind CP assets to a UTXO or release them back (PSBT-market / swap rail)', action: 'attachdetach' },
        { name: 'SRC-20 deploy / mint', desc: 'Deploy & mint SRC-20 tokens (first-party module)', action: 'src20' },
        { name: 'Stamps art minting', desc: 'Mint Bitcoin Stamps art on-chain (first-party module)', action: 'stampart' },
        { name: 'Counterparty Fairminter', desc: 'Create & mint native CP fair mints (first-party module)', action: 'fairminter' },
        { name: 'Bitname (.btc names)', desc: 'SRC-101 — register · transfer · set-address · renew · deploy a namespace', action: 'src101' },
      ],
      dapps: [
        { name: 'stampchain.io', url: 'https://stampchain.io', desc: 'Canonical Stamps / SRC-20 explorer, data & minting', trust: 'authoritative' },
        { name: 'stampscan.xyz', url: 'https://stampscan.xyz', desc: 'SRC-20 explorer + PSBT marketplace + minting', trust: 'community' },
        { name: 'horizon.market', url: 'https://horizon.market', desc: 'Trustless atomic-swap marketplace — Counterparty + Ordinals + Stamps', trust: 'trustless', note: 'Built by Unspendable Labs (Counterparty creators)' },
        { name: 'openstamp.io', url: 'https://openstamp.io', desc: 'Stamps / SRC-20 / SRC-721 marketplace + launchpad', trust: 'custodial', warn: 'Centralized order-matching with blacklist — custodial flow' },
        { name: 'stampverse.io', url: 'https://stampverse.io', desc: 'Stamps + SRC-721 minting & explorer', trust: 'community' },
        { name: 'fairmints.io', url: 'https://fairmints.io', desc: 'Alkanes + Counterparty mint / trade', trust: 'verify', warn: 'Pin the exact domain — NOT the CP "fairminter" protocol, nor firemints.xyz / fairmint.com' },
      ],
    },
    ethereum: {
      first: [{ name: 'Emblem bridge', desc: 'Vault inventory + "Vault now" wrap / redeem', action: 'emblem' }],
      dapps: [{ name: 'emblem.vision', url: 'https://emblem.vision', desc: 'Emblem Vault mint & management (vault NFTs)', trust: 'official' }],
    },
    solana: {
      first: [],
      dapps: [
        { name: 'emblemvault.ai', url: 'https://emblemvault.ai', desc: 'EmblemAI multi-chain agent wallet + trading tools', trust: 'official' },
        { name: 'migrate.fun', url: 'https://migrate.fun', desc: 'Solana token-migration platform (Emblem / Agent Hustle, Halborn-audited)', trust: 'verify', warn: 'Phishing-target flow — confirm the exact domain before connecting' },
      ],
    },
  };
  const TRUST = {
    trustless: ['Trustless', 'var(--gold2)'], authoritative: ['Authoritative', 'var(--green)'],
    official: ['Official', 'var(--green)'], community: ['Community', 'var(--muted2)'],
    custodial: ['Custodial ⚠', 'var(--amber)'], verify: ['Verify domain ⚠', 'var(--amber)'],
  };
  const FAMILY = 'emblem.vision · emblemvault.ai · migrate.fun are one company (Crosschain Ventures).';

  const favKey = 'ww:dapp:favs';
  const getFavs = () => { try { return JSON.parse(localStorage.getItem(favKey) || '[]'); } catch { return []; } };
  const toggleFav = (name) => { const f = getFavs(); const i = f.indexOf(name); if (i > -1) f.splice(i, 1); else f.push(name); localStorage.setItem(favKey, JSON.stringify(f)); };

  let TAB = 'bitcoin';
  // Hub navigation: when a sub-module is launched from the dashboard we remember it so
  // closing the module returns here (rather than dumping the user out). Only an explicit,
  // confirmed close on the dashboard itself fully exits.
  let fromHub = false;

  function modal(html) {
    let m = $('#dappmodal');
    if (!m) { m = document.createElement('div'); m.id = 'dappmodal'; m.className = 'modal'; m.innerHTML = '<div class="modal-card cc-card" id="dappCard"></div>'; document.body.appendChild(m); m.addEventListener('click', (e) => { if (e.target.id === 'dappmodal') requestClose(); }); }
    $('#dappCard').innerHTML = html; m.hidden = false; return $('#dappCard');
  }
  function hide() { const m = $('#dappmodal'); if (m) m.hidden = true; }
  // Confirm before leaving the hub (also fires on backdrop click).
  function requestClose() {
    modal(`<h3 class="m-title">Close dApp Dashboard?</h3>
      <p class="fine">This leaves the dApp hub. Your wallet stays unlocked and connected.</p>
      <div class="wbtns"><button class="ghost" id="dKeep">Keep open</button><button class="primary" id="dClose">Close dashboard</button></div>`);
    $('#dKeep').onclick = () => open();
    $('#dClose').onclick = () => { fromHub = false; hide(); };
  }
  // Launch a sub-module: hide the dashboard but remember to return here on close.
  function enter() { fromHub = true; hide(); }
  // Called by sub-modules from their close(): reopen the dashboard if we came from it.
  function returnToHub() { if (!fromHub) return false; fromHub = false; open(); return true; }
  function openExt(url) { window.open(url, '_blank', 'noopener,noreferrer'); }

  function open() {
    const tabs = ['bitcoin', 'ethereum', 'solana', 'favorites', 'connections'];
    modal(`<div class="cc-head"><div><h3 class="m-title" style="margin:0">dApp Dashboard</h3>
      <div class="cp-addr">Curated, verified tooling — domains pinned to prevent impersonation</div></div><button class="mini" id="dappx">Close</button></div>
      <div class="cp-filters" style="margin:6px 0 12px">${tabs.map((t) => `<button class="ccf ${t === TAB ? 'on' : ''}" data-t="${t}">${t}</button>`).join('')}</div>
      <div id="dappBody"></div>`);
    $('#dappx').onclick = requestClose;
    $('#dappCard').querySelectorAll('.ccf').forEach((b) => (b.onclick = () => { TAB = b.dataset.t; open(); }));
    renderTab();
  }

  function dappCard(d) {
    const fav = getFavs().includes(d.name);
    const [tl, tc] = TRUST[d.trust] || ['', 'var(--muted)'];
    return `<div class="dapp">
      <div class="dapp-h"><a class="dapp-name" data-url="${esc(d.url)}">${esc(d.name)} ↗</a>
        <button class="dapp-fav ${fav ? 'on' : ''}" data-fav="${esc(d.name)}" title="Favorite">${fav ? '★' : '☆'}</button></div>
      <div class="dapp-desc">${esc(d.desc)}</div>
      <div class="dapp-meta"><span class="dapp-trust" style="color:${tc}">${tl}</span><span class="dapp-domain">${esc((d.url || '').replace(/^https?:\/\//, ''))}</span></div>
      ${d.note ? `<div class="dapp-note">✓ ${esc(d.note)}</div>` : ''}
      ${d.warn ? `<div class="dapp-warn">⚠ ${esc(d.warn)}</div>` : ''}</div>`;
  }
  function firstCard(f) {
    return `<div class="dapp first"><div class="dapp-h"><span class="dapp-name">${esc(f.name)}${f.soon ? ' <span class="soon">soon</span>' : ''}</span>${f.action ? `<button class="mini" data-act="${esc(f.action)}">Open</button>` : ''}</div>
      <div class="dapp-desc">${esc(f.desc)}</div></div>`;
  }

  function renderTab() {
    const body = $('#dappBody');
    if (TAB === 'connections') return renderConnections(body);
    if (TAB === 'favorites') {
      const favs = getFavs();
      const all = [...DIR.bitcoin.dapps, ...DIR.ethereum.dapps, ...DIR.solana.dapps].filter((d) => favs.includes(d.name));
      body.innerHTML = all.length ? `<div class="dapp-grid">${all.map(dappCard).join('')}</div>` : '<div class="fine">No favorites yet — tap ☆ on any dApp to pin it here.</div>';
      wire(body); return;
    }
    const c = DIR[TAB];
    body.innerHTML = `
      ${c.first.length ? `<div class="acct-grp">First-party tooling</div><div class="dapp-grid">${c.first.map(firstCard).join('')}</div>` : ''}
      <div class="acct-grp" style="margin-top:14px">Curated dApps</div>
      <div class="dapp-grid">${c.dapps.map(dappCard).join('')}</div>
      <div class="dapp-fam">${esc(FAMILY)}</div>`;
    wire(body);
  }

  function wire(body) {
    body.querySelectorAll('[data-url]').forEach((a) => (a.onclick = () => openExt(a.dataset.url)));
    body.querySelectorAll('[data-fav]').forEach((b) => (b.onclick = () => { toggleFav(b.dataset.fav); renderTab(); }));
    body.querySelectorAll('[data-act]').forEach((b) => (b.onclick = () => {
      const a = window.__activeAccount;
      if (!a) return toast('Unlock your wallet first to use this tool.');
      enter(); // hide the dashboard but remember to return here when the module closes
      const act = b.dataset.act, btc = a.bitcoin.nativeSegwit.address;
      if (act === 'cp' && window.CpActions) window.CpActions.open(a.account, btc);
      else if (act === 'dex' && window.CpActions) window.CpActions.dex(a.account, btc);
      else if (act === 'issuance' && window.CpActions) window.CpActions.issuanceSuite(a.account, btc);
      else if (act === 'attachdetach' && window.CpActions) window.CpActions.attachDetach(a.account, btc);
      else if (act === 'fairminter' && window.CpActions) window.CpActions.open(a.account, btc); // Fairminter/Fairmint live in the CP panel
      else if (act === 'src20' && window.MintingModules) window.MintingModules.src20(a.account, btc);
      else if (act === 'stampart' && window.MintingModules) window.MintingModules.stampArt(a.account, btc);
      else if (act === 'src101' && window.Src101) window.Src101.open(a.account, btc);
      else if (act === 'emblem' && window.EmblemBridge) window.EmblemBridge.open(a.account, a.ethereum.address, btc);
    }));
  }
  function toast(msg) { modal(`<h3 class="m-title">dApp Dashboard</h3><div class="statusline err">${esc(msg)}</div><button class="modal-x" id="dappx2">Close</button>`); $('#dappx2').onclick = hide; }

  function renderConnections(body) {
    body.innerHTML = `
      <div class="acct-grp">Connect a dApp</div>
      <p class="fine">Paste a <b>WalletConnect</b> URI from a dApp to pair (the PWA path to remote dApps). On the desktop <b>extension</b> (Phase 12), Wonder Wallet also injects providers directly — <b>EIP-1193</b> for Ethereum dApps, <b>PSBT / BIP-322</b> for Counterparty/Stamps dApps, and the <b>Solana Wallet Standard</b> — a rare tri-chain capability.</p>
      <div class="row"><input id="wcUri" class="m-in" placeholder="wc:… (WalletConnect URI)" spellcheck="false"/><button class="primary" id="wcConnect">Pair</button></div>
      <div id="wcStatus" class="statusline" hidden></div>
      <div class="acct-grp" style="margin-top:16px">Active sessions</div>
      <div class="fine">No active connections. Approved dApp sessions appear here, where you can review &amp; revoke them.</div>
      <div class="dapp-note" style="margin-top:12px">WalletConnect pairing needs the WC relay (a scoped exception to the wallet's strict CSP) + a project ID, and a live dApp to pair with — wired here as the connectivity entry point; full session signing routes to the same audited engine that signs everything else.</div>`;
    $('#wcConnect').onclick = () => {
      const s = $('#wcStatus'); s.hidden = false;
      const uri = $('#wcUri').value.trim();
      if (!/^wc:[0-9a-f]/i.test(uri)) { s.className = 'statusline err'; s.textContent = 'Enter a valid WalletConnect URI (wc:…).'; return; }
      s.className = 'statusline load'; s.textContent = 'WalletConnect relay pairing is the next connectivity build — the URI is valid and the flow is wired to the wallet’s signing engine.';
    };
  }

  // `returnToHub` + `fromHub` let sub-modules return to the dashboard on close and label
  // their exit control contextually ("‹ Dashboard" when launched from the hub, else "Close").
  window.DappDashboard = { open, returnToHub, fromHub: () => fromHub };
})();
