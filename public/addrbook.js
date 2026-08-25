/* Wonder Wallet — Address Book (contacts). Self-custodial, local-only (localStorage ww:addrbook,
   captured by Backup). A reusable picker + manager, attachable to any address input via WonderBook.attach.
   Multiple addresses per contact; each address's chain is auto-detected so a send box shows only the
   matching-chain entries. This ASSISTS address entry — it never replaces verifying the recipient. */
(function () {
  'use strict';
  const KEY = 'ww:addrbook';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const BOOK = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>';

  const RE_BTC = /^(bc1[a-zA-HJ-NP-Z0-9]{20,}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/;
  const RE_ETH = /^0x[a-fA-F0-9]{40}$/;
  const RE_SOL = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  function detectChain(a) { a = String(a || '').trim(); if (RE_BTC.test(a)) return 'btc'; if (RE_ETH.test(a)) return 'eth'; if (RE_SOL.test(a)) return 'sol'; return null; }
  const short = (a) => { a = String(a || ''); return a.length > 20 ? a.slice(0, 10) + '…' + a.slice(-7) : a; };

  function load() { try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (_) { return []; } }
  function save(list) { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (_) {} }

  function overlay(html) {
    let m = document.getElementById('abModal');
    if (!m) { m = document.createElement('div'); m.id = 'abModal'; m.className = 'ab-modal'; document.body.appendChild(m); m.addEventListener('click', (e) => { if (e.target.id === 'abModal') close(); }); }
    m.innerHTML = '<div class="ab-card">' + html + '</div>'; m.style.display = 'flex'; return m;
  }
  function close() { const m = document.getElementById('abModal'); if (m) m.style.display = 'none'; }
  const q = (s) => document.querySelector('#abModal ' + s);

  // Picker — list contacts (filtered to `chain`), pick an address → onPick(address).
  function open(chain, onPick) {
    let query = '';
    function render() {
      const list = load(), ql = query.toLowerCase(), rows = [];
      list.forEach((c) => {
        (c.addresses || []).forEach((a) => {
          if (chain && detectChain(a.address) !== chain) return;
          if (ql && !((c.name || '').toLowerCase().includes(ql) || String(a.address).toLowerCase().includes(ql) || (a.label || '').toLowerCase().includes(ql))) return;
          rows.push({ name: c.name, a });
        });
      });
      const body = rows.length ? rows.map((r, i) => `<button class="ab-row" data-pick="${i}">
          <span class="ab-nm">${esc(r.name)}${r.a.label ? ` <span class="ab-sub">${esc(r.a.label)}</span>` : ''}</span>
          <span class="ab-ad">${esc(short(r.a.address))}</span></button>`).join('')
        : `<div class="ab-empty">${list.length ? ('No ' + (chain ? chain.toUpperCase() + ' ' : '') + 'contacts match.') : 'No saved contacts yet. Add one to get started.'}</div>`;
      overlay(`<div class="ab-head"><b>Address book${chain ? ' · ' + chain.toUpperCase() : ''}</b><button class="ab-x" id="abX">✕</button></div>
        <input id="abSearch" class="ab-in" placeholder="Search name or address" value="${esc(query)}" spellcheck="false"/>
        <div class="ab-list">${body}</div>
        <div class="ab-foot"><button class="ab-btn" id="abManage">Manage</button><button class="ab-btn gold" id="abAdd">+ New contact</button></div>`);
      q('#abX').onclick = close;
      const s = q('#abSearch'); s.oninput = () => { query = s.value; render(); const c = s.selectionStart; s.focus(); try { s.setSelectionRange(c, c); } catch (_) {} };
      q('#abManage').onclick = () => manage(() => open(chain, onPick));
      q('#abAdd').onclick = () => editContact(null, () => open(chain, onPick));
      document.querySelectorAll('#abModal [data-pick]').forEach((b) => (b.onclick = () => { const r = rows[+b.dataset.pick]; close(); if (onPick && r) onPick(r.a.address); }));
    }
    render();
  }

  // Manage — full contact list with edit/delete.
  function manage(back) {
    function render() {
      const list = load();
      const body = list.length ? list.map((c, i) => `<div class="ab-mrow"><div class="ab-mnm">${esc(c.name)} <span class="ab-sub">${(c.addresses || []).length} addr</span></div>
          <div class="ab-macts"><button class="ab-mini" data-edit="${i}">Edit</button><button class="ab-mini danger" data-del="${i}">Delete</button></div></div>`).join('')
        : '<div class="ab-empty">No contacts yet.</div>';
      overlay(`<div class="ab-head"><b>Manage contacts</b><button class="ab-x" id="abX">✕</button></div>
        <div class="ab-list">${body}</div>
        <div class="ab-foot"><button class="ab-btn" id="abBack">‹ Back</button><button class="ab-btn gold" id="abAdd">+ New contact</button></div>`);
      q('#abX').onclick = close;
      q('#abBack').onclick = back || close;
      q('#abAdd').onclick = () => editContact(null, render);
      document.querySelectorAll('#abModal [data-edit]').forEach((b) => (b.onclick = () => editContact(+b.dataset.edit, render)));
      document.querySelectorAll('#abModal [data-del]').forEach((b) => (b.onclick = () => { const l = load(); l.splice(+b.dataset.del, 1); save(l); render(); }));
    }
    render();
  }

  // Create / edit one contact with any number of addresses.
  function editContact(index, back) {
    const list = load();
    const c = index != null ? JSON.parse(JSON.stringify(list[index])) : { name: '', addresses: [{ address: '', label: '' }] };
    if (!c.addresses || !c.addresses.length) c.addresses = [{ address: '', label: '' }];
    function render() {
      const rows = c.addresses.map((a, i) => `<div class="ab-arow">
          <input class="ab-in ab-af" data-af="address" data-i="${i}" placeholder="Address (bc1… / 0x… / Solana)" value="${esc(a.address)}" spellcheck="false" autocapitalize="off"/>
          <input class="ab-in ab-lbl" data-af="label" data-i="${i}" placeholder="label" value="${esc(a.label || '')}" maxlength="20"/>
          <span class="ab-ct" id="abct${i}">${a.address ? (detectChain(a.address) || '?').toUpperCase() : ''}</span>
          <button class="ab-mini danger" data-rm="${i}" title="Remove address">✕</button></div>`).join('');
      overlay(`<div class="ab-head"><b>${index != null ? 'Edit' : 'New'} contact</b><button class="ab-x" id="abX">✕</button></div>
        <input id="abName" class="ab-in" placeholder="Contact name" value="${esc(c.name)}" maxlength="40" spellcheck="false"/>
        <div class="ab-arows">${rows}</div>
        <button class="ab-btn ab-more" id="abMore">+ Add another address</button>
        <div id="abErr" class="ab-err" hidden></div>
        <div class="ab-foot"><button class="ab-btn" id="abBack">Cancel</button><button class="ab-btn gold" id="abSave">Save contact</button></div>`);
      q('#abX').onclick = close;
      q('#abBack').onclick = back || close;
      const nm = q('#abName'); nm.oninput = () => { c.name = nm.value; };
      document.querySelectorAll('#abModal .ab-af, #abModal .ab-lbl').forEach((el) => (el.oninput = () => {
        const i = +el.dataset.i, f = el.dataset.af; c.addresses[i][f] = el.value;
        if (f === 'address') { const t = document.getElementById('abct' + i); if (t) t.textContent = el.value ? (detectChain(el.value) || '?').toUpperCase() : ''; }
      }));
      document.querySelectorAll('#abModal [data-rm]').forEach((b) => (b.onclick = () => { c.addresses.splice(+b.dataset.rm, 1); if (!c.addresses.length) c.addresses.push({ address: '', label: '' }); render(); }));
      q('#abMore').onclick = () => { c.addresses.push({ address: '', label: '' }); render(); };
      q('#abSave').onclick = () => {
        const err = q('#abErr');
        c.name = (c.name || '').trim();
        c.addresses = c.addresses.map((a) => ({ address: (a.address || '').trim(), label: (a.label || '').trim() })).filter((a) => a.address);
        if (!c.name) { err.hidden = false; err.textContent = 'Enter a contact name.'; return; }
        if (!c.addresses.length) { err.hidden = false; err.textContent = 'Add at least one address.'; return; }
        const bad = c.addresses.find((a) => !detectChain(a.address));
        if (bad) { err.hidden = false; err.textContent = 'Unrecognized address: ' + short(bad.address); return; }
        const l = load(); if (index != null) l[index] = c; else l.push(c); save(l);
        (back || close)();
      };
    }
    render();
  }

  // Attach a book icon inside an address input; picking fills the input (chain-filtered).
  function attach(input, chain) {
    if (!input || input.__ab) return; input.__ab = true;
    const wrap = document.createElement('span'); wrap.className = 'ab-wrap';
    input.parentNode.insertBefore(wrap, input); wrap.appendChild(input);
    const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'ab-book'; btn.title = 'Address book'; btn.setAttribute('aria-label', 'Address book'); btn.innerHTML = BOOK;
    wrap.appendChild(btn);
    btn.onclick = (e) => { e.preventDefault(); open(chain, (addr) => { input.value = addr; input.dispatchEvent(new Event('input', { bubbles: true })); input.focus(); }); };
  }

  window.WonderBook = { open, manage, attach, detectChain, load, save };
})();
