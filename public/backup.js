/* Wonder Wallet — local Settings backup (export / import).
   Self-custodial: this file holds your ANNOTATIONS only (watch-list, labels, UTXO flags,
   favorites, vault deposit addresses) — NEVER keys or seed. Your seed phrase restores funds;
   this file restores your settings. Full state = seed phrase + this backup. */
'use strict';
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // Every key we own is prefixed ww: — collect them all (none contain keys/seed).
  function collectSettings() {
    const out = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.indexOf('ww:') === 0) { try { out[k] = JSON.parse(localStorage.getItem(k)); } catch (_) { out[k] = localStorage.getItem(k); } }
    }
    return out;
  }
  function counts(s) {
    const watch = (s['ww:watch'] || []).length;
    const utxo = Object.keys(s).filter((k) => k.indexOf('ww:utxo:') === 0).length;
    const vaults = Object.keys(s).filter((k) => k.indexOf('ww:emblem:pending:') === 0).reduce((a, k) => a + ((s[k] || []).length), 0);
    return { watch, utxo, vaults };
  }

  function exportSettings() {
    const settings = collectSettings();
    const data = { _type: 'wonder-wallet-settings', _version: 1, exportedAt: new Date().toISOString(), settings };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'wonder-wallet-settings.json';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function importSettings(obj) {
    if (!obj || obj._type !== 'wonder-wallet-settings' || typeof obj.settings !== 'object') throw new Error('Not a Wonder Wallet settings file.');
    let n = 0;
    Object.entries(obj.settings).forEach(([k, v]) => {
      if (k.indexOf('ww:') !== 0) return; // ignore anything that isn't ours
      localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); n++;
    });
    return n;
  }

  function modal(html) {
    let m = $('#bkmodal');
    if (!m) { m = document.createElement('div'); m.id = 'bkmodal'; m.className = 'modal'; m.innerHTML = '<div class="modal-card" id="bkCard"></div>'; document.body.appendChild(m); m.addEventListener('click', (e) => { if (e.target.id === 'bkmodal') close(); }); }
    $('#bkCard').innerHTML = html; m.hidden = false; return $('#bkCard');
  }
  function close() { const m = $('#bkmodal'); if (m) m.hidden = true; }

  function open() {
    const c = counts(collectSettings());
    modal(`<h3 class="m-title">Backup &amp; restore</h3>
      <p class="fine">Your <b>seed phrase</b> restores all funds &amp; accounts. This file restores your <b>settings</b> — watch-list, labels, UTXO flags, favorites &amp; vault deposit addresses. It contains <b>no keys</b>, so it's safe to store anywhere. Full restore = seed phrase + this file.</p>
      <div class="m-grid" style="margin:10px 0">
        <div><span class="k">Watch addresses</span><span class="v">${c.watch}</span></div>
        <div><span class="k">UTXO labels/locks</span><span class="v">${c.utxo}</span></div>
        <div><span class="k">Pending vaults</span><span class="v">${c.vaults}</span></div>
        <div><span class="k">Keys included</span><span class="v">none ✓</span></div>
      </div>
      <div id="bkStatus" class="statusline" hidden></div>
      <div class="wbtns">
        <button class="primary" id="bkExport">Export settings</button>
        <button class="ghost" id="bkImport">Import settings…</button>
      </div>
      <input type="file" id="bkFile" accept="application/json,.json" hidden />
      <button class="modal-x" id="bkx">Close</button>`);
    $('#bkx').onclick = close;
    $('#bkExport').onclick = () => { exportSettings(); const s = $('#bkStatus'); s.hidden = false; s.className = 'statusline load'; s.textContent = 'Downloaded wonder-wallet-settings.json ✓'; };
    $('#bkImport').onclick = () => $('#bkFile').click();
    $('#bkFile').onchange = (e) => {
      const f = e.target.files[0]; if (!f) return;
      const s = $('#bkStatus'); s.hidden = false; s.className = 'statusline load'; s.textContent = 'Reading…';
      const rd = new FileReader();
      rd.onload = () => {
        try {
          const n = importSettings(JSON.parse(String(rd.result)));
          s.className = 'statusline load'; s.textContent = `Imported ${n} settings ✓ — reloading…`;
          setTimeout(() => location.reload(), 800);
        } catch (err) { s.className = 'statusline err'; s.textContent = 'Failed: ' + (err.message || 'invalid file'); }
      };
      rd.readAsText(f);
    };
  }

  window.WonderBackup = { open, exportSettings };
  document.addEventListener('DOMContentLoaded', () => { const b = $('#backupBtn'); if (b) b.onclick = open; });
})();
