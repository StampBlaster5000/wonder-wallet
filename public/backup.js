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

  const C = window.WonderCore;
  function download(obj, name) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  // Restore the settings portion into localStorage. Accepts the full backup OR a legacy settings-only
  // file (both carry `settings`). Only ww:* keys are written. Returns how many were restored.
  function importSettings(obj) {
    const s = obj && obj.settings; if (!s || typeof s !== 'object') return 0;
    let n = 0;
    Object.entries(s).forEach(([k, v]) => {
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
    modal(`<h3 class="m-title">Backup &amp; Restore</h3>
      <div class="warn" style="margin:8px 0 4px;border-color:#c0392b">⚠ <b>Handle with care — guard it with your life.</b> This is your <b>entire wallet</b> in one file: your seed (encrypted with your password) plus your watch-list, labels, UTXO freeze flags, favorites &amp; vault deposit addresses. Anyone who gets this file <b>and</b> your password can take your funds. Store it offline like your seed phrase — never in shared cloud, chat, or email.</div>
      <div class="m-grid" style="margin:10px 0">
        <div><span class="k">Seed &amp; keys</span><span class="v">included · encrypted 🔒</span></div>
        <div><span class="k">Watch addresses</span><span class="v">${c.watch}</span></div>
        <div><span class="k">UTXO labels/locks</span><span class="v">${c.utxo}</span></div>
        <div><span class="k">Pending vaults</span><span class="v">${c.vaults}</span></div>
      </div>
      <label class="fine" for="bkPw">Wallet password — encrypts the backup, and is required to restore it</label>
      <input type="password" id="bkPw" class="m-in" placeholder="Your wallet password" autocomplete="off" spellcheck="false" />
      <div id="bkStatus" class="statusline" hidden></div>
      <div class="wbtns">
        <button class="primary" id="bkExport">Export backup</button>
        <button class="ghost" id="bkImport">Restore from file…</button>
      </div>
      <input type="file" id="bkFile" accept="application/json,.json" hidden />
      <button class="modal-x" id="bkx">Close</button>`);
    const setS = (cls, txt) => { const s = $('#bkStatus'); s.hidden = false; s.className = 'statusline ' + cls; s.innerHTML = txt; };
    $('#bkx').onclick = close;

    // EXPORT — verify the password opens the vault, then bundle the ENCRYPTED vault blob + settings.
    $('#bkExport').onclick = async () => {
      const pw = $('#bkPw').value; if (!pw) return setS('err', 'Enter your wallet password to export.');
      setS('load', 'Verifying &amp; packaging…');
      try {
        if (!C || !C.exportVaultBlob) throw new Error('Wallet core not ready — reload the page.');
        const vault = await C.exportVaultBlob(pw); // throws wrong_password / no_vault
        download({ _type: 'wonder-wallet-backup', _version: 2, exportedAt: new Date().toISOString(), vault, settings: collectSettings() }, 'wonder-wallet-backup.json');
        setS('', 'Downloaded <b>wonder-wallet-backup.json</b> ✓ — store it somewhere safe &amp; offline.');
      } catch (err) {
        setS('err', err.message === 'wrong_password' ? 'Wrong password — nothing was exported.' : err.message === 'no_vault' ? 'No wallet on this device to back up.' : ('Failed: ' + (err.message || 'export error')));
      }
    };

    // RESTORE — full backup (seed + settings) or a legacy settings-only file.
    $('#bkImport').onclick = () => $('#bkFile').click();
    $('#bkFile').onchange = (e) => {
      const f = e.target.files[0]; if (!f) return; e.target.value = '';
      setS('load', 'Reading file…');
      const rd = new FileReader();
      rd.onload = async () => {
        let obj; try { obj = JSON.parse(String(rd.result)); } catch (_) { return setS('err', 'That is not a valid backup file.'); }
        if (!obj || (obj._type !== 'wonder-wallet-backup' && obj._type !== 'wonder-wallet-settings')) return setS('err', 'Not a Wonder Wallet backup file.');
        try {
          if (obj.vault) { // full backup → restores the WALLET; needs the password; replaces any wallet here
            const pw = $('#bkPw').value; if (!pw) return setS('err', 'Enter the backup’s password above, then choose the file again.');
            if (!C || !C.importVaultBlob) throw new Error('Wallet core not ready — reload the page.');
            if ((await C.hasVault()) && !confirm('This REPLACES the wallet currently on this device with the one in the backup. If you don’t have the current wallet’s seed, it will be lost. Continue?')) return setS('', 'Restore cancelled.');
            await C.importVaultBlob(obj.vault, pw); // verifies password BEFORE overwriting
            const n = importSettings(obj);
            setS('', `Wallet restored ✓ (+${n} settings) — reloading, then unlock with your password…`);
          } else { // legacy settings-only
            const n = importSettings(obj);
            setS('', `Imported ${n} settings ✓ — reloading…`);
          }
          setTimeout(() => location.reload(), 1300);
        } catch (err) {
          setS('err', err.message === 'wrong_password' ? 'Wrong password for this backup — nothing changed.' : err.message === 'bad_backup' ? 'That backup file is corrupt or incomplete.' : ('Failed: ' + (err.message || 'restore error')));
        }
      };
      rd.readAsText(f);
    };
  }

  window.WonderBackup = { open };
  document.addEventListener('DOMContentLoaded', () => { const b = $('#backupBtn'); if (b) b.onclick = open; });
})();
