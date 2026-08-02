/*
 * Wonder Wallet dApp provider — "Connected sites" manager. Phase 12 (v0.48). STAGED.
 * Slots into popup.js advancedMenu() at v0.48:
 *   '<button class="adv-opt" data-adv="sites"><b>Connected sites</b><span>dApps allowed to connect to this wallet</span></button>'
 *   ...  else if (a === 'sites') WWConnectedSites.render(overlayMount, advancedMenu);
 * Lists every origin with a live connection + a Revoke button (fires disconnect to that tab).
 */
(function (root) {
  'use strict';
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); };
  var host = function (o) { try { return new URL(o).host; } catch (_) { return o; } };
  var ago = function (ms) { if (!ms) return ''; var d = Date.now() - ms, m = Math.round(d / 60000); if (m < 1) return 'just now'; if (m < 60) return m + 'm ago'; var h = Math.round(m / 60); if (h < 24) return h + 'h ago'; return Math.round(h / 24) + 'd ago'; };

  function render(mount, back) {
    mount.innerHTML = '<div class="menu"><div class="menu-hd">Connected sites</div><div id="wwcsBody"><div class="empty">Loading…</div></div>'
      + '<div class="actions" style="margin-top:10px"><button class="btn ghost" id="wwcsBack">Back</button><button class="btn ghost" id="wwcsAll">Disconnect all</button></div></div>';
    if (back) document.getElementById('wwcsBack').onclick = back;
    document.getElementById('wwcsAll').onclick = function () { chrome.runtime.sendMessage({ type: 'ww_sites_list' }, function (list) { (list || []).forEach(function (s) { chrome.runtime.sendMessage({ type: 'ww_sites_revoke', origin: s.origin }); }); load(); }); };
    load();

    function load() {
      chrome.runtime.sendMessage({ type: 'ww_sites_list' }, function (list) {
        var body = document.getElementById('wwcsBody'); if (!body) return;
        if (!list || !list.length) { body.innerHTML = '<div class="p-hint" style="padding:8px 2px">No sites are connected. When you approve a site, it appears here — revoke any time.</div>'; return; }
        body.innerHTML = list.map(function (s) {
          return '<div class="acct-line"><span class="acct-lab">' + esc(host(s.origin))
            + '<br><span class="fine">' + esc((s.accounts && s.accounts[0]) ? (s.accounts[0].slice(0, 10) + '…') : '') + (s.pairedAddresses ? ' · paired' : '') + (s.lastUsed ? ' · ' + ago(s.lastUsed) : '') + '</span></span>'
            + '<button class="mini" data-revoke="' + esc(s.origin) + '">Revoke</button></div>';
        }).join('');
        body.querySelectorAll('[data-revoke]').forEach(function (b) { b.onclick = function () { chrome.runtime.sendMessage({ type: 'ww_sites_revoke', origin: b.getAttribute('data-revoke') }, function () { load(); }); }; });
      });
    }
  }

  root.WWConnectedSites = { render: render };
})(typeof self !== 'undefined' ? self : this);
