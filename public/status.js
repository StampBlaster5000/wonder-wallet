/* Wonder Wallet — landing: live chain/index sync badges + the "beta build" modal. */
'use strict';
(function () {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const n = (x) => (x == null ? '?' : Number(x).toLocaleString('en-US'));
  const STORE = 'https://chromewebstore.google.com/detail/wonder-wallet/jbdjhkopmpiihcnemgacddimdopbnnin';

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

  // Latest unpacked build info (version + freshness), stamped by build-ext.mjs into build-info.json.
  let BUILD = null;
  const DL_ZIP = 'wonder-wallet-extension.zip';
  async function loadBuild() { try { BUILD = await fetch('build-info.json', { cache: 'no-store' }).then((r) => r.json()); } catch (_) {} return BUILD; }
  function relTime(iso) {
    try { const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
      if (s < 90) return 'just now';
      if (s < 3600) return Math.round(s / 60) + ' min ago';
      if (s < 86400) return Math.round(s / 3600) + ' h ago';
      return Math.round(s / 86400) + ' d ago';
    } catch (_) { return ''; }
  }
  function dlLabel() {
    if (!BUILD || !BUILD.version) return '⬇ Download the latest build (.zip)';
    return `⬇ Download build v${BUILD.version} · built ${relTime(BUILD.builtAt)}${BUILD.commit ? ' · ' + BUILD.commit : ''}`;
  }
  const dlHref = () => (BUILD && BUILD.zip) || DL_ZIP;

  // "Get the latest beta build" — the newest unpacked build (ahead of the Chrome Web Store version).
  function betaModal(e) {
    if (e) e.preventDefault();
    const html = `<h3 class="m-title">Latest beta build</h3>
      <p class="fine">The <b>Chrome Web Store</b> version is the easiest install — but power users can run the very latest unpacked build (newest multi-chain dApp features) here.</p>
      <a class="btn btn-gold" href="${STORE}" target="_blank" rel="noopener">Get it from the Chrome Web Store →</a>
      <p class="fine" style="margin-top:16px"><b>Or load the latest unpacked build:</b></p>
      <a class="btn btn-ghost" id="dlZip" href="${dlHref()}" download>${dlLabel()}</a>
      <div class="dl-steps">
        <div class="dl-step"><span class="dl-n">1</span><span>Unzip the download.</span></div>
        <div class="dl-step"><span class="dl-n">2</span><span>Open <code>chrome://extensions</code> and turn on <b>Developer mode</b> (top-right).</span></div>
        <div class="dl-step"><span class="dl-n">3</span><span>Click <b>Load unpacked</b> and select the unzipped <code>wonder-wallet-extension</code> folder.</span></div>
        <div class="dl-step"><span class="dl-n">4</span><span>Pin it, open the popup, and create or restore a wallet.</span></div>
      </div>
      <p class="fine dl-warn">⚠ Beta software — please use a <b>test wallet</b> until you've kicked the tires. To update later, re-download and hit <b>↻ reload</b> on the extension.</p>
      <button class="modal-x" id="dlx">Close</button>`;
    const mc = $('#modalCard'); if (!mc) return;
    mc.innerHTML = html; $('#modal').hidden = false;
    const x = $('#dlx'); if (x) x.onclick = () => { $('#modal').hidden = true; };
    // Refresh the download label/href once build-info lands (in case it wasn't cached yet).
    loadBuild().then(() => { const a = $('#dlZip'); if (a) { a.href = dlHref(); a.textContent = dlLabel(); } });
  }

  function init() {
    loadStatus(); setInterval(loadStatus, 60000);
    loadBuild(); // pre-fetch so the beta modal shows the live version + freshness immediately
    const b = $('#betaBtn'); if (b) b.onclick = betaModal;
    const m = $('#modal'); if (m) m.addEventListener('click', (e) => { if (e.target.id === 'modal') m.hidden = true; });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
