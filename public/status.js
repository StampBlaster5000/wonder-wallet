/* Wonder Wallet — landing: live chain/index sync badges + login/download wiring. */
'use strict';
(function () {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const n = (x) => (x == null ? '?' : Number(x).toLocaleString('en-US'));

  async function loadStatus() {
    const el = $('#syncBadges'); if (!el) return;
    try {
      const s = await fetch('api/status').then((r) => r.json());
      const pills = [];
      if (s.btc) pills.push(`<span class="syncpill"><span class="sdot"></span>Bitcoin · block <b>${n(s.btc.height)}</b></span>`);
      if (s.cp) pills.push(`<span class="syncpill"><span class="sdot ${s.cp.ready ? '' : 'warn'}"></span>Counterparty <b>v${esc(s.cp.version || '?')}</b>${s.cp.height ? ` · ${n(s.cp.height)}` : ''}</span>`);
      if (s.stamps) pills.push(`<span class="syncpill"><span class="sdot ${s.stamps.synced ? '' : 'warn'}"></span>Stamps · indexed <b>${n(s.stamps.indexed)}</b></span>`);
      el.innerHTML = pills.length ? pills.join('') : '<span class="syncpill warn">status unavailable</span>';
    } catch (_) { el.innerHTML = '<span class="syncpill warn">status unavailable</span>'; }
  }

  // The wallet lives on its own page now (the Wonder Terminal) — Log in / Open the wallet navigate there.
  function openWallet() { window.location.href = 'app.html'; }
  function downloadModal() {
    const ZIP = 'wonder-wallet-extension.zip';
    const html = `<h3 class="m-title">Wonder Wallet — Beta is live 🎉</h3>
      <p class="fine">The browser extension (Chrome · Brave · Edge) is now in <b>open beta</b>: self-custodial BTC · ETH · SOL, Counterparty / Stamps / SRC-20 native, isolated storage, strict CSP, local keys.</p>
      <a class="cta-gold lg dl-btn" href="${ZIP}" download>⬇ Download the beta (.zip)</a>
      <div class="dl-steps">
        <div class="dl-step"><span class="dl-n">1</span><span>Unzip the download.</span></div>
        <div class="dl-step"><span class="dl-n">2</span><span>Open <code>chrome://extensions</code> and turn on <b>Developer mode</b> (top-right).</span></div>
        <div class="dl-step"><span class="dl-n">3</span><span>Click <b>Load unpacked</b> and select the unzipped <code>wonder-wallet-extension</code> folder.</span></div>
        <div class="dl-step"><span class="dl-n">4</span><span>Pin it, open the popup, and restore with a <b>fresh test seed</b>.</span></div>
      </div>
      <p class="fine dl-warn">⚠ Beta software — please use a <b>test wallet</b>, not your main funds. To update later, re-download and hit <b>↻ reload</b> on the extension.</p>`;
    if (typeof window.openModal === 'function') window.openModal(html);
    else { const mc = $('#modalCard'); if (mc) { mc.innerHTML = html + '<button class="modal-x" id="dlx">Close</button>'; $('#modal').hidden = false; const x = $('#dlx'); if (x) x.onclick = () => { $('#modal').hidden = true; }; } }
  }

  function init() {
    loadStatus(); setInterval(loadStatus, 60000);
    ['#loginBtn', '#heroOpen'].forEach((id) => { const b = $(id); if (b) b.onclick = openWallet; });
    ['#downloadBtn', '#heroDownload', '#dlbandBtn'].forEach((id) => { const b = $(id); if (b) b.onclick = downloadModal; });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
