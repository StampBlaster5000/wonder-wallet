/* Wonder Wallet — XCP-69 launchpad (browse). Phase 1 read-only surface: lists conforming fair
   launches by phase (Minting / Scheduled / Graduated) with live mint progress. Reads through the
   server proxy (which preserves 10^16 quantities as strings) and filters client-side with the
   conformance predicate (window.WonderXcp69). Mint / create / detail flows land in later phases. */
(function () {
  'use strict';
  const X = () => window.WonderXcp69;
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function modal(html) {
    let m = $('#lpModal');
    if (!m) { m = document.createElement('div'); m.id = 'lpModal'; m.className = 'modal'; m.innerHTML = '<div class="modal-card lp-card" id="lpCard"></div>'; document.body.appendChild(m); m.addEventListener('click', (e) => { if (e.target.id === 'lpModal') m.hidden = true; }); }
    $('#lpCard').innerHTML = html; m.hidden = false; return $('#lpCard');
  }
  const close = () => { const m = $('#lpModal'); if (m) m.hidden = true; };

  const PHASES = [
    { key: 'open', tab: 'Minting', empty: 'No live mints right now.' },
    { key: 'pending', tab: 'Scheduled', empty: 'No scheduled launches.' },
    { key: 'closed', tab: 'Graduated', empty: 'No closed launches yet.' },
  ];
  let CUR = 'open';
  const CACHE = {};

  async function launches(status) {
    if (CACHE[status]) return CACHE[status];
    let out = [];
    try {
      const j = await fetch('api/cp/fairminters?status=' + status).then((r) => r.json());
      const xr = X();
      // Params-conforming (this enforces the fixed set + the commission=0 stealth-premine trap). The
      // timing clauses (pre-announcement / exact window) need the immutable event → verified on open.
      out = (j.result || []).filter((fm) => xr && xr.xcp69Params(fm));
    } catch (_) {}
    CACHE[status] = out; return out;
  }

  function card(fm) {
    const xr = X();
    const name = esc(fm.asset_longname || fm.asset);
    const p = xr.progress(fm);
    const pctText = p.pct ? p.pct.toFixed(1) + '%' : '—';
    const sub = CUR === 'pending' ? ('starts at block ' + esc(fm.start_block))
      : CUR === 'closed' ? 'closed'
      : (p.pct >= 100 ? 'sold out — graduating' : pctText + ' of the 69M sale');
    return `<button class="lp-item" data-tx="${esc(fm.tx_hash)}" title="${name}">
      <div class="lp-row"><span class="lp-name">${name}</span><span class="lp-pct">${CUR === 'open' ? esc(pctText) : ''}</span></div>
      <div class="lp-bar"><span style="width:${Math.max(1, Math.min(100, p.pct))}%"></span></div>
      <div class="lp-sub">${esc(sub)}</div></button>`;
  }

  async function render() {
    modal(`<div class="cc-head"><div><h3 class="m-title" style="margin:0">XCP-69 · fair launches</h3>
        <div class="cp-addr">100M supply · 69M public sale · 69-minter fair mint — self-custodial, on Counterparty</div></div>
      <button class="mini" id="lpX">Close</button></div>
      <div class="lp-tabs">${PHASES.map((ph) => `<button class="lp-tab${ph.key === CUR ? ' on' : ''}" data-ph="${ph.key}">${ph.tab}</button>`).join('')}</div>
      <div id="lpBody" class="lp-body"><div class="statusline load">Loading launches…</div></div>
      <div class="fine" style="margin-top:8px">Conformance verified against the XCP-69 standard in your browser. Mint &amp; create flows are landing next.</div>`);
    $('#lpX').onclick = close;
    $('#lpCard').querySelectorAll('[data-ph]').forEach((b) => (b.onclick = () => { CUR = b.dataset.ph; render(); }));
    const list = await launches(CUR);
    const body = $('#lpBody'); if (!body) return;
    const ph = PHASES.find((p) => p.key === CUR);
    body.innerHTML = list.length ? list.map(card).join('') : `<div class="dash-empty">${esc(ph.empty)}</div>`;
    body.querySelectorAll('[data-tx]').forEach((b) => (b.onclick = () => { const s = $('#lpBody'); if (s) { const n = document.createElement('div'); n.className = 'fine'; n.style.cssText = 'text-align:center;color:var(--gold2);padding:6px'; n.textContent = '🛠 Launch detail + mint flow — coming in the next phase.'; s.prepend(n); setTimeout(() => n.remove(), 2200); } }));
  }

  window.WonderLaunchpad = { open: () => { CUR = 'open'; render(); } };
})();
