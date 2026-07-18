/* Wonder Wallet — Phase 2 frontend. Relative fetch only (server-side proxied).
   SECURITY (Phase 10 audit): every interpolation of external/user data is esc()'d. */
'use strict';

const $ = (s) => document.querySelector(s);
// HTML-escape for safe innerHTML interpolation (XSS defense).
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const el = (t, c, h) => { const n = document.createElement(t); if (c) n.className = c; if (h != null) n.innerHTML = h; return n; };
const fmt = (n, d = 2) => Number(n).toLocaleString('en-US', { maximumFractionDigits: d });
const sats2btc = (n) => (Number(n) / 1e8).toLocaleString('en-US', { maximumFractionDigits: 8 });
const short = (a) => { a = String(a || ''); return a.length > 18 ? a.slice(0, 8) + '…' + a.slice(-6) : a; };
const usd = (n) => (n == null ? '' : '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 }));

// Render a stamp by MIME. Images/SVG/GIF render live (safe, lightweight). HTML stamps
// are little PROGRAMS written by the minter — we never auto-run them: the grid shows a
// static poster, and the modal runs the code only on explicit consent, in a sandboxed
// iframe (opaque origin — it can't read the wallet, keys, or this page).
function stampMedia(stampId, mime, large) {
  const id = encodeURIComponent(stampId);
  const m = String(mime || '').toLowerCase();
  if (m.includes('html')) {
    if (large) {
      // Modal: consent gate. The iframe is injected by the .m-load-frame handler on click.
      return `<div class="m-html-warn">
        <svg viewBox="0 0 24 24" class="warn-glyph" aria-hidden="true"><path d="M8 7l-4 5 4 5M16 7l4 5-4 5M13.5 4l-3 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <p><b>Interactive HTML stamp.</b> This asset is a small program written by its creator. The preview runs that code in an <b>isolated sandbox</b> — it can’t read your keys, wallet or this page — but you load it at your own discretion.</p>
        <button type="button" class="m-load-frame" data-stamp="${id}">Load interactive preview</button>
      </div>`;
    }
    // Grid: static, on-brand poster — never a live frame, never an error message.
    return `<span class="stamp-poster" title="Interactive HTML stamp">
      <svg viewBox="0 0 24 24" class="poster-glyph" aria-hidden="true"><path d="M8 7l-4 5 4 5M16 7l4 5-4 5M13.5 4l-3 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <span class="poster-tag">Interactive</span>
    </span>`;
  }
  if (m.startsWith('text/')) return large ? `<pre class="m-text" data-txt="${id}">loading…</pre>` : '<span class="stamp-badge">TXT</span>';
  if (m.startsWith('image/') || !m) return `<img loading="lazy" class="${large ? 'm-art' : ''}" src="api/stamp/${id}/content" alt="Stamp"/>`;
  return `<span class="stamp-badge">${esc((m.split('/')[1] || 'file').slice(0, 5).toUpperCase())}</span>`;
}

let PRICES = { bitcoin: null, ethereum: null, solana: null };
// ── Local-first storage (no server holds user data) ──
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };
const WATCH_KEY = 'ww:watch';
const getWatch = () => lsGet(WATCH_KEY, []);
const setWatch = (list) => lsSet(WATCH_KEY, list);
window.WWStore = { lsGet, lsSet, getWatch, setWatch }; // shared with backup/export

async function boot() {
  try {
    const cfg = await fetch('api/config').then((r) => r.json());
    $('#verTag').textContent = 'v' + cfg.version;
    $('#phaseBadge').textContent = (cfg.phase || 'Phase 2').split('·')[0].trim();
    renderChains(cfg.chains);
    renderBtcTypes(cfg.btcAddressTypes);
  } catch (_) {}
  try { PRICES = await fetch('api/prices').then((r) => r.json()); } catch (_) {}
  await loadWatch();
}

function renderChains(chains = []) {
  if (!$('#chains')) return; // dashboard (Terminal) omits the Chains & derivation card
  $('#chains').innerHTML = chains.map((c) => `
    <div class="chainc"><div class="top"><span class="sym">${esc(c.symbol)}</span>
    <span class="st ${c.status === 'live' ? 'live' : 'planned'}">${c.status === 'live' ? 'live' : 'planned'}</span></div>
    <div class="nm">${esc(c.name)}</div>${c.path ? `<div class="pa">${esc(c.path)}</div>` : `<div class="pa">multiple address types →</div>`}</div>`).join('');
}
function renderBtcTypes(types = []) {
  if (!$('#btcTypes')) return;
  $('#btcTypes').innerHTML = types.map((t) => `
    <div class="bt"><div class="l"><span class="lab">${esc(t.label)}</span><span class="pre">${esc(t.prefixHint)}</span></div>
    <div class="pa">${esc(t.path)}</div><div class="no">${esc(t.note)}</div></div>`).join('');
}

function loadWatch() {
  const cardsEl = $('#cards'); if (!cardsEl) return; // legacy Portfolio card retired — watch-only now lives in the dashboard
  const watch = getWatch();
  const tag = $('#dbTag'); if (tag) tag.textContent = 'local';
  cardsEl.innerHTML = '';
  const wh = $('#watchHead'); if (wh) wh.hidden = watch.length === 0;
  if (!watch.length) { recomputeTotal(); return; }
  watch.forEach(renderCard);
  recomputeTotal();
}

async function addAddress(value, label) {
  const status = $('#addStatus');
  status.hidden = false; status.className = 'statusline load'; status.textContent = 'Detecting chain…';
  const v = value.trim();
  let chain = null;
  try { chain = (await fetch('api/detect/' + encodeURIComponent(v)).then((r) => r.json())).chain; } catch (_) {}
  if (!chain) { status.className = 'statusline err'; status.textContent = 'Unrecognized address format (expected BTC, ETH 0x…, or Solana).'; return; }
  const list = getWatch();
  if (list.some((x) => x.address === v)) { status.className = 'statusline err'; status.textContent = 'That address is already in your watch list.'; return; }
  list.unshift({ id: 'w' + Date.now(), chain, address: v, label: label || '' });
  setWatch(list);
  status.hidden = true;
  $('#addrInput').value = ''; $('#labelInput').value = '';
  loadWatch();
}

function removeAddress(id) {
  setWatch(getWatch().filter((x) => x.id !== id));
  loadWatch();
}

const cardData = {};
function buildCard(entry, { removable = true } = {}) {
  const card = el('div', 'wcard');
  card.dataset.id = entry.id;
  const badge = { bitcoin: 'BTC', ethereum: 'ETH', solana: 'SOL' }[entry.chain] || '?';
  card.innerHTML = `
    <div class="wc-h">
      <div class="wc-id">
        <span class="wc-badge ${esc(entry.chain)}">${badge}</span>
        <div><div class="wc-label">${esc(entry.label || badge + ' address')}</div>
        <div class="wc-addr">${esc(short(entry.address))}</div></div>
      </div>
      ${removable ? '<button class="wc-x" title="Remove">✕</button>' : '<span class="wc-own">yours</span>'}
    </div>
    <div class="wc-body"><div class="statusline load">Reading…</div></div>`;
  if (removable) card.querySelector('.wc-x').addEventListener('click', () => removeAddress(entry.id));
  loadCardData(entry, card.querySelector('.wc-body'));
  return card;
}
function renderCard(entry) { const c = $('#cards'); if (c) c.appendChild(buildCard(entry, { removable: true })); }

function renderOwnCards(entries) {
  const c = $('#ownCards'); if (!c) return; c.innerHTML = '';
  const oh = $('#ownHead'); if (oh) oh.hidden = entries.length === 0;
  entries.forEach((e) => c.appendChild(buildCard(e, { removable: false })));
  recomputeTotal();
}
window.WW = { renderOwnCards };

async function loadCardData(entry, body) {
  try {
    if (entry.chain === 'bitcoin') await renderBtc(entry.address, body);
    else if (entry.chain === 'ethereum') await renderEth(entry.address, body);
    else if (entry.chain === 'solana') await renderSol(entry.address, body);
  } catch (e) {
    body.innerHTML = `<div class="statusline err">Couldn't read this address — ${esc(e.message)}</div>`;
  }
}

async function renderBtc(address, body) {
  const [d, assets] = await Promise.all([
    fetch('api/btc/' + address).then((r) => r.json()),
    fetch('api/btc/' + address + '/assets').then((r) => r.json()).catch(() => ({ counterparty: [], stamps: [], src20: [] })),
  ]);
  const valUsd = PRICES.bitcoin ? (d.balanceSats / 1e8) * PRICES.bitcoin : null;
  cardData[address] = { usd: valUsd || 0 }; recomputeTotal();

  const cp = (assets.counterparty || []).filter((a) => a.asset !== 'XCP');
  const xcp = (assets.counterparty || []).find((a) => a.asset === 'XCP');
  const stamps = assets.stamps || [];
  const src20 = assets.src20 || [];

  body.innerHTML = `
    <div class="wc-bal"><span class="big">${sats2btc(d.balanceSats)} BTC</span>
      <span class="sub">${usd(valUsd)} · ${fmt(d.txCount, 0)} txs</span></div>
    <div class="utxo-strip" id="us-${esc(address)}">
      <div class="us-head"><span>${fmt(d.utxos.counts.total, 0)} UTXOs</span>
        <div class="us-actions">
          <button class="scan-btn" data-a="${esc(address)}">Run asset-aware scan</button>
          <button class="cc-btn" data-a="${esc(address)}">Coin control</button>
        </div></div>
      <div class="us-note">UTXO safety unscanned — run the scan to classify protected vs spendable.</div>
    </div>
    ${cp.length || xcp ? `<div class="asec"><div class="asec-h">Counterparty${xcp ? ` · <span class="xcp">${fmt(xcp.quantity / 1e8)} XCP</span>` : ''}</div>
      <div class="achips">${cp.slice(0, 24).map((a) => `<button class="achip" data-asset="${esc(a.asset)}">${esc(a.name)}${a.utxo ? ' <span class="bound" title="bound to a UTXO">⛓</span>' : ''}</button>`).join('') || '<span class="fine">no named assets</span>'}</div></div>` : ''}
    ${stamps.length ? `<div class="asec"><div class="asec-h">Stamps · ${stamps.length}</div>
      <div class="stamprow">${stamps.slice(0, 12).map((s) => `<button class="stampthumb" data-stamp="${esc(s.stamp)}">${stampMedia(s.stamp, s.mime, false)}<span>#${esc(s.stamp)}</span></button>`).join('')}</div></div>` : ''}
    ${src20.length ? `<div class="asec"><div class="asec-h">SRC-20 · ${src20.length}</div>
      <div class="src20-list">${src20.slice(0, 40).map((t) => `<button type="button" class="src20-row" data-tick="${esc(t.tick)}">
        <span class="src20-ic">${t.img ? `<img loading="lazy" src="api/img?url=${encodeURIComponent(t.img)}" alt=""/>` : esc(t.tick)}</span>
        <span class="src20-tick">${esc(t.tick)}</span>
        <span class="src20-amt">${esc(t.amount)}</span></button>`).join('')}</div></div>` : ''}
  `;

  body.querySelector('.scan-btn')?.addEventListener('click', (e) => runScan(e.target.dataset.a));
  body.querySelector('.cc-btn')?.addEventListener('click', (e) => window.CoinControl && window.CoinControl.open(e.target.dataset.a));
  body.querySelectorAll('.achip[data-asset]').forEach((b) => b.addEventListener('click', () => showAsset(b.dataset.asset, address)));
  body.querySelectorAll('.stampthumb').forEach((b) => b.addEventListener('click', () => showStamp(b.dataset.stamp, address)));
  body.querySelectorAll('.src20-row[data-tick]').forEach((b) => b.addEventListener('click', () => showSrc20(b.dataset.tick, address)));
}

async function runScan(address) {
  const strip = $('#us-' + CSS.escape(address));
  if (!strip) return;
  strip.querySelector('.scan-btn').disabled = true;
  strip.querySelector('.us-note').textContent = 'Scanning against Counterparty + Ordinals…';
  try {
    const d = await fetch('api/btc/' + address + '/scan').then((r) => r.json());
    const c = d.utxos.counts, m = d.utxos.scanMeta;
    const seg = (cls, n) => n > 0 ? `<div class="seg ${cls}" style="flex:${Number(n)}" title="${cls}: ${Number(n)}"></div>` : '';
    strip.innerHTML = `
      <div class="us-head"><span>${fmt(c.total, 0)} UTXOs · asset-aware</span></div>
      <div class="segbar">${seg('spendable', c.spendable)}${seg('protected', c.protected)}${seg('dust', c.dust)}${seg('unknown', c.unknown)}</div>
      <div class="us-legend">
        <span class="lg spendable">${c.spendable} spendable</span>
        <span class="lg protected">${c.protected} protected</span>
        <span class="lg dust">${c.dust} dust</span>
        <span class="lg unknown">${c.unknown} unknown</span>
      </div>
      <div class="us-note">Counterparty: ${esc(m.counterparty)}${m.counterpartyComplete ? ' coverage' : ' — incomplete, uncleared UTXOs shown as unknown'} · Ordinals: ${Number(m.ordinalsScanned)}/${Number(m.total)} scanned${m.ordinalsCapped ? ' (capped — rest shown as unknown, never presumed spendable)' : ''}.
      ${c.protected ? ` <b>${c.protected} protected UTXOs</b> (${sats2btc(d.utxos.sats.protected)} BTC) are locked from being spent as fees.` : ''}</div>`;
  } catch (e) {
    strip.querySelector('.us-note').textContent = 'Scan failed — ' + e.message;
    strip.querySelector('.scan-btn') && (strip.querySelector('.scan-btn').disabled = false);
  }
}

async function renderEth(address, body) {
  const d = await fetch('api/eth/' + address).then((r) => r.json());
  const valUsd = PRICES.ethereum ? d.eth * PRICES.ethereum : null;
  cardData[address] = { usd: valUsd || 0 }; recomputeTotal();
  body.innerHTML = `
    <div class="wc-bal"><span class="big">${fmt(d.eth, 5)} ETH</span><span class="sub">${usd(valUsd)}</span></div>
    ${d.tokens.length ? `<div class="asec"><div class="asec-h">Tokens</div><div class="achips">${d.tokens.map((t) => `<span class="achip">${fmt(t.amount)} ${esc(t.symbol)}</span>`).join('')}</div></div>` : '<div class="fine">No curated-token balances.</div>'}
    <div class="us-note">${esc(d.note)}</div>`;
}
async function renderSol(address, body) {
  const d = await fetch('api/sol/' + address).then((r) => r.json());
  const valUsd = PRICES.solana ? d.sol * PRICES.solana : null;
  cardData[address] = { usd: valUsd || 0 }; recomputeTotal();
  body.innerHTML = `
    <div class="wc-bal"><span class="big">${fmt(d.sol, 4)} SOL</span><span class="sub">${usd(valUsd)}${d.nftCount != null ? ' · ' + fmt(d.nftCount, 0) + ' NFTs' : ''}</span></div>
    ${d.tokens.length ? `<div class="asec"><div class="asec-h">SPL tokens · ${d.tokens.length}</div><div class="achips">${d.tokens.slice(0, 18).map((t) => `<span class="achip" title="${esc(t.mint)}">${fmt(t.amount)} · ${esc(short(t.mint))}</span>`).join('')}</div></div>` : '<div class="fine">No SPL token balances.</div>'}
    ${!d.dasEnabled ? '<div class="us-note">SPL fungibles via public RPC. NFT/cNFT gallery needs the DAS API (Helius).</div>' : ''}`;
}

function recomputeTotal() {
  const total = Object.values(cardData).reduce((a, c) => a + (c.usd || 0), 0);
  const bar = $('#totalbar'); if (!bar) return;
  if (total > 0) { bar.hidden = false; bar.innerHTML = `<span class="tl-k">Portfolio (native)</span><span class="tl-v">${usd(total)}</span>`; }
}

// ── Modals ──
function openModal(html) { $('#modalCard').innerHTML = html + '<button class="modal-x" id="mx">Close</button>'; $('#modal').hidden = false; $('#mx').onclick = closeModal; }
function closeModal() { $('#modal').hidden = true; $('#modalCard').innerHTML = ''; }
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });

// The owning account if `address` is the user's active (unlocked) Native SegWit account —
// only then can we offer signing shortcuts (Send / Dispenser / Burn / Vault).
function ownCtx(address) {
  const acc = window.__activeAccount;
  return (acc && acc.bitcoin && address === acc.bitcoin.nativeSegwit.address) ? acc : null;
}
// Shortcut bar shown in the asset/stamp preview when it's one of your own assets.
function assetActionsBar(acc) {
  if (!acc) return '';
  return `<div class="m-actions">
    <button class="m-act" data-act="send">Send</button>
    <button class="m-act" data-act="dispenser">Dispenser</button>
    <button class="m-act danger" data-act="burn">Burn</button>
    <button class="m-act gold" data-act="vault">Vault</button>
  </div>`;
}
function wireAssetActions(asset, acc) {
  if (!acc) return;
  const btc = acc.bitcoin.nativeSegwit.address;
  $('#modalCard').querySelectorAll('.m-act').forEach((b) => (b.onclick = () => {
    const act = b.dataset.act; closeModal();
    if (act === 'send') window.CpActions && window.CpActions.quick(acc.account, btc, 'send', { asset });
    else if (act === 'dispenser') window.CpActions && window.CpActions.quick(acc.account, btc, 'dispenser', { asset });
    else if (act === 'burn') window.CpActions && window.CpActions.quick(acc.account, btc, 'destroy', { asset });
    else if (act === 'vault') window.EmblemBridge && (window.EmblemBridge.vaultAsset
      ? window.EmblemBridge.vaultAsset(acc.account, acc.ethereum.address, btc, asset, { label: asset })
      : window.EmblemBridge.open(acc.account, acc.ethereum.address, btc));
  }));
}
// SRC-20 row click → for your own account, jump straight to a pre-filled Send (Transfer) form.
function showSrc20(tick, address) {
  const acc = ownCtx(address);
  if (acc && window.MintingModules) { window.MintingModules.sendSrc20(acc.account, acc.bitcoin.nativeSegwit.address, tick); return; }
  openModal(`<h3 class="m-title">${esc(tick)}</h3><div class="fine">SRC-20 token. Unlock this as one of your own wallet accounts to send it.</div>`);
}

async function showAsset(asset, address) {
  openModal('<div class="statusline load">Loading asset intelligence…</div>');
  try {
    const a = await fetch('api/cp/asset/' + encodeURIComponent(asset)).then((r) => r.json());
    const isImg = a.description && /^https?:\/\/\S+\.(png|jpe?g|gif|webp|svg)(\?\S*)?$/i.test(a.description);
    const acc = ownCtx(address);
    openModal(`<h3 class="m-title">${esc(a.name)}</h3>
      ${assetActionsBar(acc)}
      <div class="m-grid">
        <div><span class="k">Supply</span><span class="v">${fmt(a.supply, a.divisible ? 8 : 0)}</span></div>
        <div><span class="k">Divisible</span><span class="v">${a.divisible ? 'yes' : 'no'}</span></div>
        <div><span class="k">Locked</span><span class="v">${a.locked ? 'yes 🔒' : 'no'}</span></div>
        <div><span class="k">First issuance</span><span class="v">#${esc(a.firstIssuance ?? '—')}</span></div>
      </div>
      <div class="m-row"><span class="k">Issuer</span><span class="vmono">${esc(short(a.issuer || '—'))}</span></div>
      ${a.description ? (isImg
        ? `<img class="m-art" src="api/img?url=${encodeURIComponent(a.description)}" alt="${esc(a.name)}"/>`
        : `<div class="m-desc">${esc(a.description)}</div>`) : ''}`);
    wireAssetActions(asset, acc);
  } catch (e) { openModal('<div class="statusline err">Failed: ' + esc(e.message) + '</div>'); }
}

async function showStamp(id, address) {
  openModal('<div class="statusline load">Loading stamp…</div>');
  try {
    const s = await fetch('api/stamp/' + encodeURIComponent(id)).then((r) => r.json());
    const acc = ownCtx(address);
    openModal(`<h3 class="m-title">Stamp #${esc(s.stamp)}</h3>
      ${stampMedia(s.stamp, s.mime, true)}
      ${assetActionsBar(acc)}
      <div class="m-grid">
        <div><span class="k">Supply</span><span class="v">${fmt(s.supply, 0)}</span></div>
        <div><span class="k">Locked</span><span class="v">${s.locked ? 'yes 🔒' : 'no'}</span></div>
        <div><span class="k">Type</span><span class="v">${esc(s.mime || '—')}</span></div>
        <div><span class="k">Size</span><span class="v">${s.fileSize ? fmt(s.fileSize, 0) + ' B' : '—'}</span></div>
      </div>
      <div class="m-row"><span class="k">Creator</span><span class="vmono">${esc(short(s.creator || '—'))}</span></div>`);
    wireAssetActions(s.cpid, acc); // stamps act on their Counterparty asset id (cpid)
    // text stamps: load and show the content (escaped)
    const pre = $('#modalCard .m-text');
    if (pre) {
      try { const txt = await fetch('api/stamp/' + encodeURIComponent(s.stamp) + '/content').then((r) => r.text()); pre.textContent = txt.slice(0, 4000); }
      catch (_) { pre.textContent = '(could not load text)'; }
    }
  } catch (e) { openModal('<div class="statusline err">Failed: ' + esc(e.message) + '</div>'); }
}

// Consent gate: only when the user clicks "Load interactive preview" do we inject the
// sandboxed iframe that actually runs the stamp's code (delegated — the modal re-renders).
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.m-load-frame');
  if (!btn) return;
  const id = btn.dataset.stamp;
  const box = btn.closest('.m-html-warn');
  if (box) box.outerHTML = `<iframe class="m-frame" sandbox="allow-scripts" loading="lazy" src="api/stamp/${id}/content" title="HTML stamp"></iframe>`;
});

const _addForm = $('#addForm');
if (_addForm) _addForm.addEventListener('submit', (e) => { e.preventDefault(); const a = $('#addrInput').value.trim(); if (a) addAddress(a, $('#labelInput').value.trim()); });
document.querySelectorAll('.sample').forEach((b) => b.addEventListener('click', () => addAddress(b.dataset.a, b.dataset.l || '')));

boot();
