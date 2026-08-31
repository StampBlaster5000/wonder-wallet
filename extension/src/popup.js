/* Wonder Wallet — extension popup: per-chain asset browser.
   W-seal = blockchain switcher · account picker (HD + watch-only, add more) · Tokens / Collectibles
   tabs per chain. Local signing via window.WonderCore; reads via the shim. */
'use strict';
(function () {
  var C = window.WonderCore;
  var app = document.getElementById('app');
  // ── Testnet Mode (global toggle) ──────────────────────────────────────────────
  // testnet derives coin-type-1' BTC addresses (tb1…), routes reads to testnet4/Sepolia/
  // devnet (via the shim's x-ww-network header), maps EVM to Sepolia, and hides fiat.
  var NET = function () { return (window.WWNetMode && window.WWNetMode.isTestnet()) ? 'testnet' : 'mainnet'; };
  var isTN = function () { return NET() === 'testnet'; };
  var ethNet = function () { return isTN() ? 'sepolia' : 'ethereum'; };
  // Auto-thread the active network into WonderCore send/sign calls (opts-object + positional).
  (function patchCore() {
    if (!C || C.__wwNetPatched) return;
    ['send', 'buildUnsignedSend'].forEach(function (fn) {
      if (typeof C[fn] !== 'function') return;
      var o = C[fn].bind(C);
      C[fn] = function (opts) { opts = opts || {}; if (opts.network == null) opts.network = NET(); return o(opts); };
    });
    [['signCp', 7], ['signStamp', 5], ['signMessage', 3]].forEach(function (p) {
      var fn = p[0], idx = p[1]; if (typeof C[fn] !== 'function') return;
      var o = C[fn].bind(C);
      C[fn] = function () { var a = [].slice.call(arguments); while (a.length < idx) a.push(undefined); if (a[idx] == null) a[idx] = NET(); return o.apply(null, a); };
    });
    if (typeof C.signProvider === 'function') { var sp = C.signProvider.bind(C); C.signProvider = function (opts) { opts = opts || {}; if (opts.network == null) opts.network = NET(); return sp(opts); }; }
    C.__wwNetPatched = true;
  })();
  // Persistent orange TESTNET banner (lives outside #app so it survives re-renders).
  function paintTestnetBanner() {
    var testnet = isTN();
    if (!document.getElementById('ww-tn-style')) {
      var st = document.createElement('style'); st.id = 'ww-tn-style';
      st.textContent = '#wwTnBanner{display:none;align-items:center;justify-content:center;gap:6px;padding:5px 10px;'
        + 'font:700 10px/1.3 system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:#1a1206;cursor:pointer;'
        + 'background:repeating-linear-gradient(45deg,#F4B740,#F4B740 12px,#E0A020 12px,#E0A020 24px);border-bottom:1px solid rgba(0,0,0,.25)}'
        + 'body.ww-testnet #wwTnBanner{display:flex}';
      document.head.appendChild(st);
    }
    document.body.classList.toggle('ww-testnet', testnet);
    var b = document.getElementById('wwTnBanner');
    if (!b) {
      b = document.createElement('div'); b.id = 'wwTnBanner';
      b.title = 'Testnet Mode — click for network settings';
      b.innerHTML = '⚠ Testnet — no value';
      b.onclick = function () { advNetwork(); };
      if (document.body.firstChild) document.body.insertBefore(b, document.body.firstChild); else document.body.appendChild(b);
    }
  }
  try { paintTestnetBanner(); } catch (e) {}
  // Wallet-wide safety: no numeric field (quantity, amount, fee, price…) may go below its floor.
  // The native spinner's down-arrow and pasted/typed negatives are both clamped (floor = min attr, else 0).
  document.addEventListener('input', function (e) {
    var el = e.target;
    if (!el || el.tagName !== 'INPUT' || el.type !== 'number' || el.value === '' || el.value === '-') return;
    var floor = (el.getAttribute('min') != null && el.getAttribute('min') !== '') ? parseFloat(el.getAttribute('min')) : 0;
    if (isNaN(floor)) floor = 0;
    var v = parseFloat(el.value);
    if (!isNaN(v) && v < floor) { el.value = floor; el.dispatchEvent(new Event('input', { bubbles: true })); }
  }, true);
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); };
  var short = function (a) { a = String(a || ''); return a.length > 16 ? a.slice(0, 7) + '…' + a.slice(-6) : a; };
  var fmt = function (x, d) { var n = Number(x); return isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: d }) : '0'; };
  var fmtBytes = function (n) { n = Number(n); if (!isFinite(n) || n <= 0) return '—'; if (n < 1024) return n + ' B'; if (n < 1048576) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB'; return (n / 1048576).toFixed(1) + ' MB'; };
  // Token balance display: cap to 2 decimals, but if that rounds to 0 (dust like 0.00066 WETH), keep
  // 2 significant figures so the balance never reads a misleading "0".
  var fmtTokAmt = function (v) {
    var n = Number(v); if (!isFinite(n) || n === 0) return '0';
    var two = n.toLocaleString('en-US', { maximumFractionDigits: 2 });
    if (parseFloat(two.replace(/,/g, '')) !== 0) return two;
    return Number(n.toPrecision(2)).toLocaleString('en-US', { maximumFractionDigits: 20 });
  };
  // Network-aware block-explorer links for a broadcast id → a clickable "Broadcast ✓" confirmation.
  var mempoolTx = function (txid) { return (isTN() ? 'https://mempool.space/testnet4/tx/' : 'https://mempool.space/tx/') + encodeURIComponent(String(txid || '')); };
  var explLinkHtml = function (url, id) { return 'Broadcast ✓ — <a href="' + url + '" target="_blank" rel="noopener" style="color:var(--gold2);text-decoration:underline">' + esc(String(id).slice(0, 18)) + '…</a> ↗'; };
  var txLinkHtml = function (txid) { return explLinkHtml(mempoolTx(txid), txid); }; // BTC
  var ethTxLinkHtml = function (h) { return explLinkHtml((ethNet() === 'sepolia' ? 'https://sepolia.etherscan.io/tx/' : 'https://etherscan.io/tx/') + encodeURIComponent(String(h || '')), h); };
  var solTxLinkHtml = function (sig) { return explLinkHtml('https://solscan.io/tx/' + encodeURIComponent(String(sig || '')) + (isTN() ? '?cluster=devnet' : ''), sig); };
  // " · ≈ $X" USD tag for a sats amount on the signing/confirm screens (blank until the BTC price is known).
  function usdSuffix(sats) { if (isTN()) return ''; var p = (PRICES && PRICES.bitcoin) || 0; if (!p || !sats) return ''; return ' · ≈ $' + ((sats / 1e8) * p).toLocaleString('en-US', { maximumFractionDigits: 2 }); }
  // Absolute proxy URL for images set via JS (the shim only rewrites fetch() + DOM <img src="api/…">,
  // NOT Image().src or a src assigned before insertion — so a relative "api/…" would hit chrome-extension:// and 404).
  function proxied(path) { return (window.WW_PROXY ? window.WW_PROXY + '/' : '') + path; }
  // Broadcast a signed tx, tolerating a non-JSON response. Our server always replies JSON, so an HTML
  // body means an intermediary (proxy/relay) returned an error page (transient 5xx/timeout). Re-broadcasting
  // the SAME signed tx is safe — Ledger/our signing is deterministic (RFC-6979) → identical txid, mempool
  // dedupes — so a timeout after the relay already forwarded the tx isn't a double-spend.
  async function bcast(txhex) {
    var resp = await fetch('api/btc/broadcast', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ txhex: txhex }) });
    var text = await resp.text();
    try { return JSON.parse(text); } catch (_) {
      throw new Error(resp.ok
        ? 'The relay returned an unreadable response — your transaction may already have broadcast. Check the explorer for this address before retrying (re-sending the same signed tx is safe: identical txid).'
        : 'Broadcast relay hiccup (HTTP ' + resp.status + '). Wait a moment and retry — re-broadcasting the same signed transaction is safe (identical txid).');
    }
  }
  var loadMap = function (k) { try { return JSON.parse(localStorage.getItem(k) || '{}'); } catch (e) { return {}; } };
  var lsGet = function (k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
  var lsSet = function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  // ── Asset favorites (star / pin). Stored in localStorage ww:fav (auto-captured by Backup). ──
  function favKey(t) {
    if (!t) return '';
    if (t.stamp != null) return 'st:' + t.stamp;                                              // Bitcoin Stamp
    if (t.kind === 'name') return 'nm:' + String(t.name || t.title).toUpperCase();             // .btc name
    if (t.contract) return 'e:' + String(t.contract).toLowerCase() + ':' + (t.tokenId != null ? t.tokenId : ''); // ETH NFT
    if (t.id) return 'so:' + String(t.id);                                                     // SOL NFT
    if (t.src20 || t.tick) return 's:' + String(t.tick || t.name).toUpperCase();
    if (t.asset) return 'c:' + String(t.asset).toUpperCase();
    if (t.address) return 'e:' + String(t.address).toLowerCase();
    return 'n:' + String(t.name || t.title || '').toUpperCase();
  }
  function loadFavs() { return new Set(lsGet('ww:fav', []) || []); }
  function isFav(t) { return loadFavs().has(favKey(t)); }
  function toggleFav(t) { var s = loadFavs(), k = favKey(t); if (s.has(k)) s.delete(k); else s.add(k); lsSet('ww:fav', Array.from(s)); return s.has(k); }
  function abbrevQty(q) { var n = Number(q); if (!isFinite(n)) return String(q); if (n >= 1e9) return +(n / 1e9).toFixed(1) + 'B'; if (n >= 1e6) return +(n / 1e6).toFixed(1) + 'M'; return n.toLocaleString('en-US'); } // full up to 999,999, then M/B

  // ── Address Book (contacts) — self-custodial, local (ww:addrbook, captured by Backup). Dedicated
  //    overlay #abOv so it stacks above any send form without clobbering the shared popup overlay.
  //    Assists address entry (chain-filtered picker); it never replaces verifying the recipient. ──
  var AB_KEY = 'ww:addrbook';
  var AB_BOOK = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>';
  var AB_RE = { btc: /^(bc1[a-zA-HJ-NP-Z0-9]{20,}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/, eth: /^0x[a-fA-F0-9]{40}$/, sol: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/ };
  function abDetect(a) { a = String(a || '').trim(); if (AB_RE.btc.test(a)) return 'btc'; if (AB_RE.eth.test(a)) return 'eth'; if (AB_RE.sol.test(a)) return 'sol'; return null; }
  function abShort(a) { a = String(a || ''); return a.length > 20 ? a.slice(0, 10) + '…' + a.slice(-7) : a; }
  function abLoad() { try { var v = JSON.parse(localStorage.getItem(AB_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
  function abSave(l) { try { localStorage.setItem(AB_KEY, JSON.stringify(l)); } catch (e) {} }
  function abOv(html) { var o = document.getElementById('abOv'); if (!o) { o = document.createElement('div'); o.id = 'abOv'; o.className = 'ab-modal'; document.body.appendChild(o); o.addEventListener('click', function (e) { if (e.target.id === 'abOv') abCloseOv(); }); } o.innerHTML = '<div class="ab-card">' + html + '</div>'; o.style.display = 'flex'; return o; }
  function abCloseOv() { var o = document.getElementById('abOv'); if (o) o.style.display = 'none'; }
  function abq(s) { return document.querySelector('#abOv ' + s); }
  function abOpen(chain, onPick) {
    var query = '';
    function render() {
      var list = abLoad(), ql = query.toLowerCase(), rows = [];
      list.forEach(function (c) { (c.addresses || []).forEach(function (a) {
        if (chain && abDetect(a.address) !== chain) return;
        if (ql && !((c.name || '').toLowerCase().indexOf(ql) >= 0 || String(a.address).toLowerCase().indexOf(ql) >= 0 || (a.label || '').toLowerCase().indexOf(ql) >= 0)) return;
        rows.push({ name: c.name, a: a });
      }); });
      var body = rows.length ? rows.map(function (r, i) { return '<button class="ab-row" data-pick="' + i + '"><span class="ab-nm">' + esc(r.name) + (r.a.label ? ' <span class="ab-sub">' + esc(r.a.label) + '</span>' : '') + '</span><span class="ab-ad">' + esc(abShort(r.a.address)) + '</span></button>'; }).join('')
        : '<div class="ab-empty">' + (list.length ? 'No ' + (chain ? chain.toUpperCase() + ' ' : '') + 'contacts match.' : 'No saved contacts yet.') + '</div>';
      abOv('<div class="ab-head"><b>Address book' + (chain ? ' · ' + chain.toUpperCase() : '') + '</b><button class="ab-x" id="abX">✕</button></div>'
        + '<input id="abSearch" class="ab-in" placeholder="Search name or address" value="' + esc(query) + '" spellcheck="false"/>'
        + '<div class="ab-list">' + body + '</div>'
        + '<div class="ab-foot"><button class="ab-btn" id="abManage">Manage</button><button class="ab-btn gold" id="abAdd">+ New</button></div>');
      abq('#abX').onclick = abCloseOv;
      var s = abq('#abSearch'); s.oninput = function () { query = s.value; render(); var c = s.selectionStart; s.focus(); try { s.setSelectionRange(c, c); } catch (e) {} };
      abq('#abManage').onclick = function () { abManage(function () { abOpen(chain, onPick); }); };
      abq('#abAdd').onclick = function () { abEdit(null, function () { abOpen(chain, onPick); }); };
      document.querySelectorAll('#abOv [data-pick]').forEach(function (b) { b.onclick = function () { var r = rows[+b.dataset.pick]; abCloseOv(); if (onPick && r) onPick(r.a.address); }; });
    }
    render();
  }
  function abManage(back) {
    function render() {
      var list = abLoad();
      var body = list.length ? list.map(function (c, i) { return '<div class="ab-mrow"><div class="ab-mnm">' + esc(c.name) + ' <span class="ab-sub">' + (c.addresses || []).length + ' addr</span></div><div class="ab-macts"><button class="ab-mini" data-edit="' + i + '">Edit</button><button class="ab-mini danger" data-del="' + i + '">Delete</button></div></div>'; }).join('') : '<div class="ab-empty">No contacts yet.</div>';
      abOv('<div class="ab-head"><b>Manage contacts</b><button class="ab-x" id="abX">✕</button></div><div class="ab-list">' + body + '</div><div class="ab-foot"><button class="ab-btn" id="abBack">‹ Back</button><button class="ab-btn gold" id="abAdd">+ New</button></div>');
      abq('#abX').onclick = abCloseOv; abq('#abBack').onclick = back || abCloseOv;
      abq('#abAdd').onclick = function () { abEdit(null, render); };
      document.querySelectorAll('#abOv [data-edit]').forEach(function (b) { b.onclick = function () { abEdit(+b.dataset.edit, render); }; });
      document.querySelectorAll('#abOv [data-del]').forEach(function (b) { b.onclick = function () { var l = abLoad(); l.splice(+b.dataset.del, 1); abSave(l); render(); }; });
    }
    render();
  }
  function abEdit(index, back) {
    var list = abLoad();
    var c = index != null ? JSON.parse(JSON.stringify(list[index])) : { name: '', addresses: [{ address: '', label: '' }] };
    if (!c.addresses || !c.addresses.length) c.addresses = [{ address: '', label: '' }];
    function render() {
      var rows = c.addresses.map(function (a, i) { return '<div class="ab-arow"><input class="ab-in ab-af" data-af="address" data-i="' + i + '" placeholder="Address (bc1… / 0x… / Solana)" value="' + esc(a.address) + '" spellcheck="false" autocapitalize="off"/><input class="ab-in ab-lbl" data-af="label" data-i="' + i + '" placeholder="label" value="' + esc(a.label || '') + '" maxlength="20"/><span class="ab-ct" id="abct' + i + '">' + (a.address ? (abDetect(a.address) || '?').toUpperCase() : '') + '</span><button class="ab-mini danger" data-rm="' + i + '">✕</button></div>'; }).join('');
      abOv('<div class="ab-head"><b>' + (index != null ? 'Edit' : 'New') + ' contact</b><button class="ab-x" id="abX">✕</button></div><input id="abName" class="ab-in" placeholder="Contact name" value="' + esc(c.name) + '" maxlength="40" spellcheck="false"/><div class="ab-arows">' + rows + '</div><button class="ab-btn ab-more" id="abMore">+ Add another address</button><div id="abErr" class="ab-err" hidden></div><div class="ab-foot"><button class="ab-btn" id="abBack">Cancel</button><button class="ab-btn gold" id="abSave">Save contact</button></div>');
      abq('#abX').onclick = abCloseOv; abq('#abBack').onclick = back || abCloseOv;
      var nm = abq('#abName'); nm.oninput = function () { c.name = nm.value; };
      document.querySelectorAll('#abOv .ab-af, #abOv .ab-lbl').forEach(function (el) { el.oninput = function () { var i = +el.dataset.i, f = el.dataset.af; c.addresses[i][f] = el.value; if (f === 'address') { var t = document.getElementById('abct' + i); if (t) t.textContent = el.value ? (abDetect(el.value) || '?').toUpperCase() : ''; } }; });
      document.querySelectorAll('#abOv [data-rm]').forEach(function (b) { b.onclick = function () { c.addresses.splice(+b.dataset.rm, 1); if (!c.addresses.length) c.addresses.push({ address: '', label: '' }); render(); }; });
      abq('#abMore').onclick = function () { c.addresses.push({ address: '', label: '' }); render(); };
      abq('#abSave').onclick = function () {
        var err = abq('#abErr'); c.name = (c.name || '').trim();
        c.addresses = c.addresses.map(function (a) { return { address: (a.address || '').trim(), label: (a.label || '').trim() }; }).filter(function (a) { return a.address; });
        if (!c.name) { err.hidden = false; err.textContent = 'Enter a contact name.'; return; }
        if (!c.addresses.length) { err.hidden = false; err.textContent = 'Add at least one address.'; return; }
        var bad = c.addresses.filter(function (a) { return !abDetect(a.address); })[0];
        if (bad) { err.hidden = false; err.textContent = 'Unrecognized address: ' + abShort(bad.address); return; }
        var l = abLoad(); if (index != null) l[index] = c; else l.push(c); abSave(l); (back || abCloseOv)();
      };
    }
    render();
  }
  function abAttach(input, chain) {
    if (!input || input.__ab) return; input.__ab = true;
    var wrap = document.createElement('span'); wrap.className = 'ab-wrap';
    input.parentNode.insertBefore(wrap, input); wrap.appendChild(input);
    var btn = document.createElement('button'); btn.type = 'button'; btn.className = 'ab-book'; btn.title = 'Address book'; btn.innerHTML = AB_BOOK; wrap.appendChild(btn);
    btn.onclick = function (e) { e.preventDefault(); abOpen(chain, function (addr) { input.value = addr; input.dispatchEvent(new Event('input', { bubbles: true })); input.focus(); }); };
  }
  // Apply the saved appearance skin ASAP (before first paint) so there's no dark→light flash.
  try { if (localStorage.getItem('ww:theme') === 'light') document.documentElement.classList.add('theme-light'); } catch (e) {}
  function setTheme(t) { try { localStorage.setItem('ww:theme', t === 'light' ? 'light' : 'dark'); } catch (e) {} document.documentElement.classList.toggle('theme-light', t === 'light'); }
  // SECURITY: abort before signing if a SERVER-composed tx pays BTC to any address not in `allowed`.
  function assertOutputs(psbt, allowed) {
    var outs; try { outs = C.decodeTxOutputs(psbt, NET()); } catch (e) { return; } // WW-B18: active-network encode (else testnet false-blocks)
    var set = {}; (allowed || []).forEach(function (a) { if (a) set[a] = 1; });
    for (var i = 0; i < outs.length; i++) { var o = outs[i]; if (o.opReturn || !o.value || !o.address) continue; if (!set[o.address]) throw new Error('Aborted — the composed transaction pays BTC to an unexpected address (' + o.address + '). It may have been tampered with; nothing was signed.'); }
  }
  // SECURITY (CP-data decoder): positively confirm the asset's intended recipient is the one baked
  // into the composed tx. An enhanced_send hides the recipient in the OP_RETURN Counterparty data
  // (invisible to output inspection); CP encodes the recipient's hash160/witness-program verbatim
  // there, so a swapped recipient leaves the user's own destination hash absent. Require the intended
  // destination to appear EITHER as a payment output OR inside the CP data. Returns {ok, via} | null.
  function checkCpRecipient(psbt, data, dest) {
    if (!dest) return null;
    var inData = false, h = null; try { h = C.addrHash(dest); } catch (e) {}
    if (h && String(data || '').toLowerCase().indexOf(h.toLowerCase()) >= 0) inData = true;
    var inOut = false; try { var outs = C.decodeTxOutputs(psbt, NET()); for (var i = 0; i < outs.length; i++) if (outs[i].address === dest) inOut = true; } catch (e) {} // WW-B18: active-network encode
    if (!inData && !inOut) return { ok: false };
    return { ok: true, via: inData ? 'Counterparty data' : 'payment output' };
  }
  function assertCpRecipient(psbt, data, dest) {
    var r = checkCpRecipient(psbt, data, dest);
    if (r && !r.ok) throw new Error('Aborted — the intended recipient ' + dest + ' is not present in the composed transaction (neither as a payment output nor encoded in the Counterparty data). It may redirect your asset; nothing was signed.');
  }
  // WW-C02: first-party Counterparty inputs are chosen server-side by CP Core — a tampered composer could
  // slip in an asset-bearing (Stamp/Ordinal/Counterparty), frozen, time-locked, or unknown UTXO. Re-check
  // every input against FRESH coin-control for the source address immediately before signing and require
  // each to still be spendable. `allowOutpoint` is the one intentional exception (a detach spends its own
  // attached asset UTXO). Fail closed — mirrors hwAssertInputsFresh on the Ledger path (reuses the same
  // ccApplyMeta overlay + hwSpendable classifier defined below).
  async function cpAssertInputsFresh(psbt, srcAddr, allowOutpoint) {
    if (!srcAddr) throw new Error('Could not determine the source address to re-verify inputs — nothing was signed.');
    var ins; try { ins = C.psbtInputs(psbt) || []; } catch (e) { throw new Error('Could not read the transaction inputs to re-verify them — nothing was signed.'); }
    if (!ins.length) return;
    var cc = ccApplyMeta(srcAddr, await fetch('api/btc/' + srcAddr + '/coincontrol').then(function (r) { return r.json(); }));
    var fresh = {}; (cc.utxos || []).forEach(function (u) { fresh[u.txid + ':' + u.vout] = u; });
    for (var k = 0; k < ins.length; k++) {
      var op = ins[k].txid + ':' + ins[k].index;
      if (allowOutpoint && op === allowOutpoint) continue; // intentional detach of this asset UTXO
      var u = fresh[op];
      if (!u) throw new Error('Aborted — this transaction spends a UTXO that is not in your source address’s current spendable set (unknown provenance or already spent). Nothing was signed.');
      if (!hwSpendable(u)) throw new Error('Aborted — this transaction would spend a protected UTXO (asset-bearing, frozen, or time-locked). This can burn an asset; nothing was signed.');
    }
  }

  // ── icons ──
  var SEAL = '<svg viewBox="0 0 32 32" width="18" height="18"><path d="M8 11 L12.5 22 L16 14 L19.5 22 L24 11" fill="none" stroke="#3a2606" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/></svg>';
  var BTC_IC = '<svg viewBox="0 0 32 32" width="16" height="16" fill="currentColor"><path d="M21 14c1.5-.8 2-2.3 1.6-4-.5-2.2-2.4-3-5-3.2V3h-2.4v3.6h-1.9V3H11v3.8H6.5v2.6h1.7c.9 0 1.2.5 1.2 1v9.2c0 .5-.3.8-.8.8H6.2L6 23H11v3.8h2.4V23h1.9v3.8H17V23c4-.2 6.6-1.2 7-4.7.3-2.2-.8-3.5-2-4.3zM13.4 9.3c1.3 0 4.6-.4 4.6 1.6s-3.3 1.5-4.6 1.5zm0 11v-3.5c1.6 0 5.4-.4 5.4 1.7s-3.8 1.8-5.4 1.8z"/></svg>';
  var ETH_IC = '<svg viewBox="0 0 32 32" width="14" height="14" fill="currentColor"><path d="M16 3l-8 13 8 4.5L24 16 16 3zM8 17.6L16 29l8-11.4-8 4.6-8-4.6z"/></svg>';
  var SOL_IC = '<svg viewBox="0 0 32 32" width="14" height="14" fill="currentColor"><path d="M7 9h17l-4 4H3l4-4zm0 7h17l-4 4H3l4-4zm-4 7h17l4-4H7l-4 4z"/></svg>';
  var LOCK_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/></svg>';
  var TERM_ICON = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3M13 15h4"/></svg>';
  var PANEL_ICON = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><rect x="3.5" y="5" width="17" height="14" rx="2"/><line x1="14.5" y1="5" x2="14.5" y2="19"/></svg>';
  var XFER_IC = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h13M13 7l5 5-5 5"/></svg>';
  var DISP_IC = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9"><circle cx="12" cy="12" r="8"/><path d="M9.5 14.5c.4 1 1.4 1.5 2.5 1.5 1.4 0 2.4-.7 2.4-1.9 0-2.6-4.6-1.4-4.6-3.9C9.8 9 10.8 8.4 12 8.4c1 0 1.9.4 2.4 1.3M12 7v1.4M12 15.9V17.3" stroke-linecap="round"/></svg>';
  var FIRE_IC = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><path d="M12 3c1 3-2 4-2 7 0-1-1.5-1.5-1.5-3C7 9 6 11 6 13.5 6 17 8.7 20 12 20s6-3 6-6.5c0-3.5-3-6-6-10.5z"/></svg>';
  var VAULT_IC = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><path d="M12 2l8 3.5v5.5c0 5-3.4 8.6-8 10-4.6-1.4-8-5-8-10V5.5L12 2z"/><path d="M9.2 12l2 2 3.6-4"/></svg>';
  var DIV_IC = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="7" r="3.2"/><circle cx="17" cy="17" r="3.2"/><path d="M9.5 9.5l5 5M14 8h3V11M10 16H7v-3"/></svg>';
  var ATTACH_IC = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 007 0l2-2a5 5 0 00-7-7l-1 1"/><path d="M14 11a5 5 0 00-7 0l-2 2a5 5 0 007 7l1-1"/></svg>';
  var RECV_IC = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H6M11 17l-5-5 5-5"/></svg>';
  var PLUS_IC = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
  var MINT_IC = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3l7 7-4 4M11 6l7 7M3 21l6-2 9-9-4-4-9 9-2 6z"/></svg>';
  var SWEEP_IC = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M19 5l-7 7M8 21l-4-4M6 13l5 5M4 21h6M14 3l7 7"/></svg>';
  var DEX_IC = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4v13M4 14l3 3 3-3M17 20V7M20 10l-3-3-3 3"/></svg>';
  var LINK_IC = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 01-2 2H6a2 2 0 01-2-2V8a2 2 0 012-2h4"/></svg>';
  var CH = {
    btc: { name: 'Bitcoin', sym: 'BTC', ic: BTC_IC, price: 'bitcoin' },
    eth: { name: 'Ethereum', sym: 'ETH', ic: ETH_IC, price: 'ethereum' },
    sol: { name: 'Solana', sym: 'SOL', ic: SOL_IC, price: 'solana' },
  };
  var CHORDER = ['btc', 'eth', 'sol'];
  var CHAIN_OF = { bitcoin: 'btc', ethereum: 'eth', solana: 'sol' };

  // ── state ──
  var chain = 'btc', curAccount = 0, acctKind = 'hd', watchId = null, tab = 'tokens';
  // Native Ledger (WebHID) — connected addresses live in-memory; a read-only view needs the device only
  // once (getAddresses), everything after is proxy reads. All rendered in the popup's own UI (NOT the Terminal).
  var HW = null, hwBt = 'nativeSegwit', hwViewAddr = null, hwViewIndex = null, hwAgg = false;
  var hwScanCache = null; // { bt, results:[{address,index,sum}] } — last address scan, reused by the account dropdown
  var _resName = null; // SRC-101 .btc resolution state for the send field
  var RE_DOTBTC = /^[a-z0-9][a-z0-9._-]{0,62}\.btc$/i;
  // Resolve a .btc name → address at submit time (throws if unregistered); pass-through for addresses.
  async function resolveRecipientName(raw) {
    if (!RE_DOTBTC.test(raw)) return raw;
    var r = await fetch('api/src101/resolve/' + encodeURIComponent(raw)).then(function (x) { return x.json(); }).catch(function () { return null; });
    if (!r || !r.exists || !r.address) throw new Error('“' + raw + '” is not a registered Bitcoin Stamps name.');
    return r.address;
  }
  // Live .btc resolution banner under any recipient input (reusable across send forms).
  function wireNameResolve(inputId, bannerId) {
    var inp = document.getElementById(inputId), nr = document.getElementById(bannerId), t = null;
    if (!inp || !nr) return;
    inp.addEventListener('input', function () {
      clearTimeout(t);
      var v = inp.value.trim();
      if (!RE_DOTBTC.test(v)) { nr.hidden = true; nr.innerHTML = ''; return; }
      nr.hidden = false; nr.className = 'name-resolve load'; nr.textContent = 'Resolving ' + v + '…';
      t = setTimeout(async function () {
        try {
          var r = await fetch('api/src101/resolve/' + encodeURIComponent(v)).then(function (x) { return x.json(); });
          if (inp.value.trim() !== v) return;
          if (r && r.exists && r.address) { nr.className = 'name-resolve ok'; nr.innerHTML = '✓ <b>' + esc(r.name) + '</b> → <span class="nr-addr">' + esc(r.address) + '</span>'; }
          else { nr.className = 'name-resolve bad'; nr.textContent = (r && r.expired) ? ('⚠ ' + v + ' has expired.') : ('✕ ' + v + ' is not registered (SRC-101).'); }
        } catch (e) { nr.className = 'name-resolve bad'; nr.textContent = 'Could not resolve ' + v + '.'; }
      }, 350);
    });
  }
  var ASSETS = null, loadSeq = 0, PRICES = {}, _cd = null;
  var IN_PANEL = /sidepanel/i.test(location.pathname), _winId = null;
  var IS_HW_WIN = /[?&]hw=1/.test(location.search); // dedicated top-level window for the Ledger connect (reliable WebHID)
  var IS_BACKUP_WIN = /[?&]backup=1/.test(location.search); // dedicated tab for Backup & Restore — MV3 popups close on the OS file picker, so file import/export must run in a real tab
  try { if (window.chrome && chrome.windows) chrome.windows.getCurrent(function (w) { _winId = w && w.id; }); } catch (e) {}
  if (IN_PANEL) document.documentElement.classList.add('in-panel');
  var VER = ''; try { VER = (window.chrome && chrome.runtime && chrome.runtime.getManifest && chrome.runtime.getManifest().version) || ''; } catch (e) {}

  // ── Privacy view — masks balances / token amounts / values across BTC · ETH · SOL. Local, per-device. ──
  var PRIVACY = false; try { PRIVACY = localStorage.getItem('ww:privacy') === '1'; } catch (e) {}
  var EYE_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>';
  var EYE_OFF_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
  var GEAR_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>';

  // ── Password reveal — add a show/hide eye toggle to every password field (unlock, create, restore,
  //    imported, remove, etc.). A MutationObserver catches fields in any dynamically-rendered form. ──
  function addPwReveal(inp) {
    if (!inp || inp.dataset.pweye || !inp.parentNode) return; inp.dataset.pweye = '1';
    var wrap = document.createElement('span'); wrap.className = 'pw-wrap';
    inp.parentNode.insertBefore(wrap, inp); wrap.appendChild(inp);
    var btn = document.createElement('button'); btn.type = 'button'; btn.className = 'pw-eye'; btn.tabIndex = -1; btn.setAttribute('aria-label', 'Show password'); btn.innerHTML = EYE_SVG;
    btn.addEventListener('click', function () { var showing = inp.getAttribute('type') === 'text'; inp.setAttribute('type', showing ? 'password' : 'text'); btn.innerHTML = showing ? EYE_SVG : EYE_OFF_SVG; inp.focus(); });
    wrap.appendChild(btn);
  }
  function scanPwReveal(root) { try { (root || document).querySelectorAll('input[type="password"]:not([data-pweye])').forEach(addPwReveal); } catch (e) {} }
  try {
    new MutationObserver(function (muts) { muts.forEach(function (m) { m.addedNodes && m.addedNodes.forEach(function (nd) { if (nd.nodeType !== 1) return; if (nd.matches && nd.matches('input[type="password"]')) addPwReveal(nd); scanPwReveal(nd); }); }); }).observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) {}
  function mask(v) { return PRIVACY ? '•••••' : v; }
  // Repaint the big native value + sub-label from cached ASSETS (no network) — used on load and on privacy toggle.
  function paintNative() {
    if (!ASSETS) return;
    var nv = document.getElementById('nativeVal'), nl = document.getElementById('nativeLbl');
    if (nv) nv.textContent = mask(ASSETS.usd ? '$' + fmt(ASSETS.usd, 2) : fmt(ASSETS.native, 6) + ' ' + CH[chain].sym);
    if (nl) nl.textContent = mask(fmt(ASSETS.native, 8) + ' ' + CH[chain].sym);
  }
  function togglePrivacy() {
    PRIVACY = !PRIVACY; try { localStorage.setItem('ww:privacy', PRIVACY ? '1' : '0'); } catch (e) {}
    var pb = document.getElementById('bPrivacy');
    if (pb) { pb.classList.toggle('on', PRIVACY); pb.innerHTML = PRIVACY ? EYE_OFF_SVG : EYE_SVG; pb.title = PRIVACY ? 'Privacy view ON — show balances' : 'Privacy view (hide balances)'; }
    paintNative(); if (ASSETS) renderAssetBody(); // repaint from cache, no refetch
  }

  // ── Coin-control UTXO meta (freeze / time-lock / label). Shared localStorage key with the Terminal, so
  //    freezes set in either surface protect funds everywhere. No server state. ──
  function ccKey(addr) { return 'ww:utxo:' + addr; }
  function ccGetMeta(addr) { try { return JSON.parse(localStorage.getItem(ccKey(addr)) || '{}'); } catch (e) { return {}; } }
  function ccSetMeta(addr, m) { try { localStorage.setItem(ccKey(addr), JSON.stringify(m)); } catch (e) {} }
  // Overlay local freeze/label/time-lock onto a raw coincontrol scan + recompute the freeze-dependent summary.
  function ccApplyMeta(addr, data) {
    if (!data || !data.utxos) return data;
    var meta = ccGetMeta(addr), now = Date.now();
    data.utxos.forEach(function (u) {
      var m = meta[u.utxo] || {};
      u.frozen = !!m.frozen; u.freezeUntil = m.freezeUntil || null;
      u.timelocked = !!(m.freezeUntil && new Date(m.freezeUntil).getTime() > now);
      u.label = m.label || '';
    });
    var s = data.summary || (data.summary = {});
    var live = function (u) { return u.category === 'spendable' && !u.frozen && !u.timelocked; };
    s.spendable = data.utxos.filter(live).length;
    s.frozen = data.utxos.filter(function (u) { return u.frozen || u.timelocked; }).length;
    return data;
  }

  // ── launchers ──
  function openTerminal(hash) { var rel = 'expanded.html' + (hash || ''); var url; try { url = chrome.runtime.getURL(rel); } catch (e) { url = rel; } try { chrome.windows.create({ url: url, type: 'popup', width: 1400, height: 900 }); setTimeout(function () { window.close(); }, 60); } catch (e) { window.open(url, '_blank'); } }
  function openSidePanel() { try { if (!chrome.sidePanel) return; try { chrome.sidePanel.setOptions({ path: 'sidepanel.html', enabled: true }); } catch (e) {} if (_winId != null) { chrome.sidePanel.open({ windowId: _winId }); setTimeout(function () { window.close(); }, 60); } else chrome.windows.getCurrent(function (w) { try { chrome.sidePanel.open({ windowId: w.id }); } catch (e) {} }); } catch (e) {} }
  // Hardware (Ledger/WebHID) connect needs a real browser TAB — the WebHID device chooser only enumerates
  // the device in a normal tab (the action popup, side panel, AND type:'popup' windows all open the picker
  // but list NO device). So we open the extension's OWN page in a proper tab (sidepanel.html?hw=1 — popup
  // UI, never the Terminal). A tab also STAYS OPEN, so the Ledger view isn't lost on every click.
  function openHardwareTab() {
    var url = chrome.runtime.getURL('sidepanel.html') + '?hw=1';
    try {
      // Reuse an already-open hardware tab if there is one; else open a fresh tab and focus it.
      chrome.tabs.query({}, function (tabs) {
        var existing = (tabs || []).filter(function (t) { return t.url && t.url.indexOf('sidepanel.html') >= 0 && t.url.indexOf('hw=1') >= 0; })[0];
        if (existing) { try { chrome.tabs.update(existing.id, { active: true }); if (existing.windowId != null && chrome.windows) chrome.windows.update(existing.windowId, { focused: true }); } catch (e) {} }
        else chrome.tabs.create({ url: url, active: true });
      });
    } catch (e) { try { chrome.tabs.create({ url: url, active: true }); } catch (x) { try { window.open(url, '_blank'); } catch (y) {} } }
  }
  // Backup & Restore opens in its OWN tab (like hardware): the OS file picker closes an MV3 popup, which
  // would abort a restore mid-read. A tab also gives this guard-with-your-life flow room + persistence.
  function openBackupTab() {
    var url = chrome.runtime.getURL('sidepanel.html') + '?backup=1';
    var W = 400, H = 660; // match the signing/approval window's footprint
    // A COMPACT window — not a maximized tab, and NOT the action popup (Chrome closes the popup the instant
    // the OS file picker opens, which would abort a Restore mid-read). Anchor it to the TOP-RIGHT of the
    // current browser window, under the toolbar / extension button, so it reads as dropping from the Wonder
    // Wallet icon — the same illusion the signing approval window uses.
    var make = function (win) {
      var o = { url: url, type: 'popup', width: W, height: H, focused: true };
      if (win && win.width) { o.top = Math.max(0, (win.top || 0) + 74); o.left = Math.max(0, (win.left || 0) + win.width - W - 20); }
      if (chrome.windows && chrome.windows.create) chrome.windows.create(o);
      else chrome.tabs.create({ url: url, active: true });
    };
    var anchored = function () {
      try {
        chrome.tabs.query({ active: true, lastFocusedWindow: true }, function (tabs) {
          var t = tabs && tabs[0];
          if (t && t.windowId != null && chrome.windows && chrome.windows.get) chrome.windows.get(t.windowId, function (win) { make(win); });
          else make(null);
        });
      } catch (e) { make(null); }
    };
    try {
      chrome.tabs.query({}, function (tabs) {
        var ex = (tabs || []).filter(function (t) { return t.url && t.url.indexOf('backup=1') >= 0; })[0];
        if (ex && ex.windowId != null && chrome.windows) { try { chrome.windows.update(ex.windowId, { focused: true }); chrome.tabs.update(ex.id, { active: true }); } catch (e) {} return; }
        anchored();
      });
    } catch (e) { anchored(); }
  }
  // Settings = every ww:* localStorage key (labels, watch-list, freeze flags, favorites, vault deposit
  // addrs). The vault (seed) lives in IndexedDB, NOT localStorage, so it is never swept in as "settings".
  function collectWwSettings() { var o = {}; for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k && k.indexOf('ww:') === 0) { try { o[k] = JSON.parse(localStorage.getItem(k)); } catch (e) { o[k] = localStorage.getItem(k); } } } return o; }
  function restoreWwSettings(obj) { var s = obj && obj.settings; if (!s || typeof s !== 'object') return 0; var n = 0; Object.keys(s).forEach(function (k) { if (k.indexOf('ww:') !== 0) return; var v = s[k]; localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); n++; }); return n; }
  function bkDownload(obj, name) { var b = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' }); var a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000); }
  // Full-page Backup & Restore (the ?backup=1 tab). Export packages the ENCRYPTED vault blob + settings;
  // Restore verifies the password before overwriting, then re-opens the wallet to unlock.
  // The compact window is RESTORE-only (export lives inline in the popup — see advBackup). Restore needs
  // a real window because the OS file picker closes the action popup; it's also the natural home screen
  // action (bring a wallet ONTO this device), so it's linked from the fresh-wallet screen too.
  function backupPage() {
    app.innerHTML = '<div class="hw-page"><div class="hw-card">'
      + '<div class="p-name" style="font-size:19px">Restore from Backup</div>'
      + '<div class="disp-panel" style="display:block;margin-top:10px"><div class="disp-hit">Restore your wallet from a <b>wonder-wallet-backup.json</b> file, using the <b>backup password</b> you set when you exported it (not necessarily your old wallet password — a legacy settings-only file needs no password). If a wallet already exists here, restoring <b>replaces</b> it.</div></div>'
      + '<label class="p-hint" for="bkPw" style="margin-top:10px;display:block">Backup password</label>'
      + '<input type="password" id="bkPw" class="p-in" placeholder="Backup password" autocomplete="off" spellcheck="false" />'
      + '<div id="bkMsg" style="min-height:18px;margin:6px 0"></div>'
      + '<button class="btn" id="bkRestore" style="white-space:nowrap">Choose backup file…</button>'
      + '<input type="file" id="bkFile" accept="application/json,.json" hidden />'
      + '<div class="hw-foot">🔒 Nothing changes until the password verifies the file.</div>'
      + '</div></div>';
    var msg = function (cls, t) { var m = document.getElementById('bkMsg'); if (m) { m.className = cls; m.innerHTML = t; } };
    var pwEl = document.getElementById('bkPw'); if (typeof addPwReveal === 'function') addPwReveal(pwEl);

    document.getElementById('bkRestore').onclick = function () { document.getElementById('bkFile').click(); };
    document.getElementById('bkFile').onchange = function (e) {
      var f = e.target.files[0]; if (!f) return; e.target.value = '';
      msg('p-hint', 'Reading file…');
      var rd = new FileReader();
      rd.onload = async function () {
        var obj; try { obj = JSON.parse(String(rd.result)); } catch (_) { return msg('p-err', 'That is not a valid backup file.'); }
        if (!obj || (obj._type !== 'wonder-wallet-backup' && obj._type !== 'wonder-wallet-settings')) return msg('p-err', 'Not a Wonder Wallet backup file.');
        var home = function () { location.href = chrome.runtime.getURL('sidepanel.html'); };
        if (!obj.vault) { var n0 = restoreWwSettings(obj); msg('p-hint', 'Imported ' + n0 + ' settings ✓ — opening wallet…'); setTimeout(home, 1200); return; }
        var pw = pwEl.value; if (!pw) return msg('p-err', 'Enter the backup’s password above, then choose the file again.');
        var doRestore = async function () {
          msg('p-hint', 'Restoring…');
          try { await C.importVaultBlob(obj.vault, pw); var n = restoreWwSettings(obj); msg('p-hint', 'Wallet restored ✓ (+' + n + ' settings) — opening your wallet. Unlock with this <b>backup password</b> (it’s your wallet password now).'); setTimeout(home, 1700); }
          catch (e2) { msg('p-err', e2.message === 'wrong_password' ? 'Wrong password for this backup — nothing changed.' : e2.message === 'bad_backup' ? 'That backup file is corrupt or incomplete.' : ('Failed: ' + (e2.message || 'restore error'))); }
        };
        if (await C.hasVault()) {
          msg('p-err', '⚠ This <b>replaces</b> the wallet on this device with the backup. If you don’t have the current wallet’s seed, it will be lost.<br><button class="btn danger" id="bkConfirm" style="margin-top:8px">Yes, replace my wallet</button>');
          var cb = document.getElementById('bkConfirm'); if (cb) cb.onclick = doRestore;
        } else { doRestore(); }
      };
      rd.readAsText(f);
    };
  }
  // In-popup Backup overlay (Advanced menu). EXPORT runs right here — a download doesn't need a file
  // picker, so the popup survives it. RESTORE hands off to the compact window (its file picker would
  // close the popup). Hybrid: back up where you are; restore in a window that can hold a file dialog.
  function advBackup() {
    overlay('<div class="stamp-detail"><div class="st-head"><div class="st-htitle">Backup &amp; Restore</div><button class="m-close-x" id="bkX" title="Close" aria-label="Close">✕</button></div>'
      + '<div class="disp-panel" style="display:block"><div class="disp-hit">⚠ <b>Handle with care — guard it with your life.</b> This is your <b>entire wallet</b> in one file: your seed (encrypted) plus watch-list, labels, UTXO freeze flags, favorites, address book &amp; vault deposit addresses. Anyone with this file <b>and</b> its password can take your funds. Store it offline — never in cloud, chat, or email.</div></div>'
      + '<label class="p-hint" for="bkWpw" style="margin-top:8px;display:block">Wallet password <span style="opacity:.7">— confirms it’s you</span></label>'
      + '<input type="password" id="bkWpw" class="p-in" placeholder="Wallet password" autocomplete="off" spellcheck="false" />'
      + '<label class="p-hint" for="bkFpw" style="margin-top:8px;display:block">Backup password <span style="opacity:.7">— you’ll type THIS to restore. Can differ from your wallet password. Write it down.</span></label>'
      + '<input type="password" id="bkFpw" class="p-in" placeholder="Backup password" autocomplete="off" spellcheck="false" />'
      + '<div id="bkMsg" style="min-height:16px;margin:6px 0"></div>'
      + '<div class="actions"><button class="btn" id="bkExport">Export backup</button><button class="btn ghost" id="bkRestoreWin">Restore from file…</button></div>'
      + '<button class="btn ghost" id="bkClose" style="margin-top:8px">Close</button></div>');
    var wpw = document.getElementById('bkWpw'), fpw = document.getElementById('bkFpw');
    if (typeof addPwReveal === 'function') { addPwReveal(wpw); addPwReveal(fpw); }
    var msg = function (cls, t) { var m = document.getElementById('bkMsg'); if (m) { m.className = cls; m.innerHTML = t; } };
    document.getElementById('bkX').onclick = closeOv; document.getElementById('bkClose').onclick = closeOv;
    document.getElementById('bkRestoreWin').onclick = function () { closeOv(); openBackupTab(); }; // restore = the compact window
    document.getElementById('bkExport').onclick = async function () {
      var w = wpw.value, f = fpw.value;
      if (!w) return msg('p-err', 'Enter your wallet password to confirm it’s you.');
      if (!f || f.length < 8) return msg('p-err', 'Choose a backup password of at least 8 characters.');
      msg('p-hint', 'Verifying &amp; packaging…');
      try {
        var vault = await C.exportBackup(w, f); // decrypt with wallet pw, re-encrypt under the backup pw
        bkDownload({ _type: 'wonder-wallet-backup', _version: 2, exportedAt: new Date().toISOString(), vault: vault, settings: collectWwSettings() }, 'wonder-wallet-backup.json');
        msg('p-hint', 'Downloaded <b>wonder-wallet-backup.json</b> ✓ — store it offline, and remember the <b>backup password</b>.');
      } catch (e) { msg('p-err', e.message === 'wrong_password' ? 'Wrong wallet password — nothing was exported.' : e.message === 'no_vault' ? 'No wallet on this device to back up.' : ('Failed: ' + (e.message || 'export error'))); }
    };
  }
  document.addEventListener('click', function (e) { if (!e.target.closest) return; if (e.target.closest('#bPanel')) openSidePanel(); else if (e.target.closest('#bTerm')) openTerminal(); });
  function copy(t, el) { navigator.clipboard.writeText(t).then(function () { if (el) { el.classList.add('copyok'); setTimeout(function () { el.classList.remove('copyok'); }, 1000); } }).catch(function () {}); }

  // ── overlay popover ──
  function overlay(html) { var o = document.getElementById('pop-ov'); if (!o) { o = document.createElement('div'); o.id = 'pop-ov'; o.className = 'pop-ov'; document.body.appendChild(o); o.addEventListener('click', function (e) { if (e.target.id === 'pop-ov') closeOv(); }); } o.innerHTML = '<div class="pop-pop">' + html + '</div>'; o.style.display = 'flex'; return o; }
  function closeOv() { var o = document.getElementById('pop-ov'); if (o) o.style.display = 'none'; }

  // ── auto-lock countdown ──
  function stopCd() { if (_cd) { clearInterval(_cd); _cd = null; } }
  function startCountdown() {
    stopCd(); var line = document.getElementById('lockLine'), W = window.WWSession;
    if (!line || !W || !W.idleMs) return;
    var tick = function () { if (!C.isUnlocked()) { line.textContent = ''; return; } if (W.idleMs > 1e14) { line.textContent = '🔓 auto-lock off'; return; } var la = W.lastActive(); if (!la) { line.textContent = ''; return; } var rem = W.idleMs - (Date.now() - la); if (rem <= 0) { line.textContent = 'locking…'; return; } var m = Math.floor(rem / 60000), s = Math.floor((rem % 60000) / 1000); line.textContent = 'auto-locks in ' + m + ':' + (s < 10 ? '0' : '') + s; };
    tick(); _cd = setInterval(tick, 1000);
  }

  // ── accounts ── (a LIST of HD indices, so any user-added account can be removed leaving gaps)
  var DEFAULT_ACCTS = 4; // Accounts 0–3 are always present and locked (non-removable).
  function acctList() {
    var set = {}, v = lsGet('ww:accts', null);
    if (Array.isArray(v)) v.forEach(function (x) { if (Number.isInteger(x) && x >= 0 && x <= 1000) set[x] = 1; }); // bound + integer-validate against tampering
    else { var n = Math.max(1, parseInt(localStorage.getItem('ww:acctcount') || '1', 10) || 1); for (var j = 0; j < n; j++) set[j] = 1; } // migrate old counter
    for (var i = 0; i < DEFAULT_ACCTS; i++) set[i] = 1;
    return Object.keys(set).map(Number).sort(function (a, b) { return a - b; });
  }
  function setAcctList(arr) { lsSet('ww:accts', arr.slice().sort(function (a, b) { return a - b; })); }
  function addAcct() { var l = acctList(); var next = Math.max.apply(null, l) + 1; l.push(next); setAcctList(l); return next; }
  // Accounts 0–3 are protected defaults; anything the user adds (4+) can be removed.
  function acctRemovable(i) { return acctKind === 'hd' && i >= DEFAULT_ACCTS; }
  function removeAcct(i) {
    if (i < DEFAULT_ACCTS) return false;
    setAcctList(acctList().filter(function (x) { return x !== i; }));
    var m = loadMap('ww:btctype'); delete m[i]; lsSet('ww:btctype', m);
    var nm = loadMap('ww:acctnames'); delete nm[i]; lsSet('ww:acctnames', nm);
    return true;
  }
  function watchList() { return lsGet('ww:watch', []); }
  function removeWatchFlow() {
    var w = watchList().filter(function (x) { return x.id === watchId; })[0]; if (!w) return;
    overlay('<div class="menu" style="padding:12px;display:flex;flex-direction:column;gap:9px"><div class="p-title" style="font-size:15px">Remove watch-only address?</div>'
      + '<div class="p-hint">Stop watching <b>' + esc(w.label || short(w.address)) + '</b>. This only removes it from your wallet view — nothing on-chain changes, and you can re-add it anytime.</div>'
      + '<div class="actions"><button class="btn ghost" id="rwCancel">Cancel</button><button class="btn danger" id="rwGo">Remove</button></div></div>');
    document.getElementById('rwCancel').onclick = closeOv;
    document.getElementById('rwGo').onclick = function () { lsSet('ww:watch', watchList().filter(function (x) { return x.id !== watchId; })); watchId = null; acctKind = 'hd'; curAccount = 0; closeOv(); renderMain(); };
  }
  // Per-account Bitcoin address type (native segwit / legacy / taproot / nested), persisted.
  var BTC_TYPES = [['nativeSegwit', 'Native SegWit', 'bc1q'], ['legacy', 'Legacy', '1…'], ['taproot', 'Taproot', 'bc1p'], ['nestedSegwit', 'Nested SegWit', '3…']];
  var BTC_LABEL = { nativeSegwit: 'Native SegWit', legacy: 'Legacy', taproot: 'Taproot', nestedSegwit: 'Nested SegWit' };
  function acctBtcType(i) { return loadMap('ww:btctype')[i] || 'nativeSegwit'; }
  function setAcctBtcType(i, t) { var m = loadMap('ww:btctype'); if (t === 'nativeSegwit') delete m[i]; else m[i] = t; lsSet('ww:btctype', m); }
  // ── Imported keys (WIF) — a standalone private key that restores & SIGNS its own address ──
  var impId = null, IMPORTED = [];
  function refreshImported() { try { IMPORTED = C.isUnlocked() ? C.importedAccounts() : []; } catch (e) { IMPORTED = []; } }
  function currentImported() { return IMPORTED.filter(function (x) { return x.id === impId; })[0] || null; }
  function impBtcType(id) { return loadMap('ww:imptype')[id] || 'nativeSegwit'; }
  function setImpBtcType(id, t) { var m = loadMap('ww:imptype'); if (t === 'nativeSegwit') delete m[id]; else m[id] = t; lsSet('ww:imptype', m); }
  // Unified account context — works for HD accounts AND imported keys (both can sign BTC/CP/stamps).
  function canSignBtc() { return acctKind === 'hd' || acctKind === 'imported'; }
  function curImportedId() { return acctKind === 'imported' ? impId : null; }
  function curBtcType() { return acctKind === 'imported' ? impBtcType(impId) : acctBtcType(curAccount); }
  function curBtcAddress() {
    if (acctKind === 'imported') { var im = currentImported(); return im ? (im.bitcoin[impBtcType(impId)] || im.bitcoin.nativeSegwit).address : null; }
    try { return C.accounts(curAccount, 0, NET()).bitcoin[acctBtcType(curAccount)].address; } catch (e) { return null; }
  }
  // Remember the last-used account so it's waiting on reopen.
  function saveLast() { lsSet('ww:lastacct', acctKind === 'hardware' ? 'hw' : acctKind === 'watch' ? 'watch:' + watchId : acctKind === 'imported' ? 'imp:' + impId : 'hd:' + curAccount); lsSet('ww:lastchain', chain); }
  function restoreLast() {
    try { HW = lsGet('ww:ledger', null); } catch (e) { HW = null; } // a previously-paired Ledger (public addresses only)
    var v = lsGet('ww:lastacct', null);
    if (v) {
      if (v === 'hw') { if (HW) { acctKind = 'hardware'; chain = 'btc'; } }
      else if (v.indexOf('watch:') === 0) { var id = v.slice(6); if (watchList().some(function (w) { return w.id === id; })) { acctKind = 'watch'; watchId = id; } }
      else if (v.indexOf('imp:') === 0) { var iid = v.slice(4); if (IMPORTED.some(function (x) { return x.id === iid; })) { acctKind = 'imported'; impId = iid; chain = 'btc'; } }
      else if (v.indexOf('hd:') === 0) { var i = parseInt(v.slice(3), 10); if (acctList().indexOf(i) >= 0) { acctKind = 'hd'; curAccount = i; } }
    }
    if (acctKind !== 'watch') { var lc = lsGet('ww:lastchain', null); if (lc && CH[lc]) chain = lc; }
  }
  function currentAddress() {
    if (acctKind === 'hardware') return hwAddr();
    if (acctKind === 'watch') { var w = watchList().filter(function (x) { return x.id === watchId; })[0]; return w ? w.address : null; }
    if (acctKind === 'imported') { var im = currentImported(); if (!im) return null; var t = impBtcType(impId); return (im.bitcoin[t] || im.bitcoin.nativeSegwit).address; }
    var acc; try { acc = C.accounts(curAccount, 0, NET()); } catch (e) { return null; }
    return chain === 'btc' ? acc.bitcoin[acctBtcType(curAccount)].address : chain === 'eth' ? acc.ethereum.address : acc.solana.address;
  }

  // Return to the correct dashboard from a sub-view (Activity, Send…): the Ledger view for a connected
  // hardware account, otherwise the normal wallet.
  function backToMain() { if (acctKind === 'hardware' && HW) return hwRenderMain(); return renderMain(); }
  // ── header helper (no-vault / locked screens) ──
  function header(right) {
    return '<div class="p-head"><div class="p-brand"><span class="p-seal">' + SEAL + '</span>'
      + '<div><div class="p-name">Wonder Wallet</div><div class="p-sub">self-custodial · local</div></div></div>'
      + '<div class="p-icons">' + (IN_PANEL ? '' : '<button class="p-ibtn" id="bPanel" title="Dock as side panel">' + PANEL_ICON + '</button>') + (right || '') + '</div></div>';
  }

  async function render() {
    stopCd();
    if (IS_HW_WIN || IS_BACKUP_WIN) return; // dedicated tabs drive their own pages (hwLandingPage / backupPage); don't let lock/storage events repaint the wallet over them
    if (acctKind === 'hardware' && HW) return hwRenderMain(); // a paired Ledger renders even with no seed vault
    try {
      var has = await C.hasVault();
      // Locked or vault gone → tear down any open overlay (asset detail, Tools, compose…) so it
      // can't float over the Unlock / setup screen. #pop-ov is a body sibling of #app, so the
      // app re-render alone never removes it.
      if (!has || !C.isUnlocked()) { var _ov = document.getElementById('pop-ov'); if (_ov) _ov.remove(); }
      if (!has) { if (HW) { acctKind = 'hardware'; return hwRenderMain(); } return renderNoVault(); } // hardware-only user → their Ledger
      if (!C.isUnlocked()) return renderLocked();
      refreshImported(); // imported accounts live in the (unlocked) core; refresh before rendering
      if (acctKind === 'imported' && !currentImported()) { acctKind = 'hd'; } // guard stale selection
      return renderMain();
    } catch (e) { app.innerHTML = header() + '<div class="p-card"><div class="p-err">' + esc(e.message || 'error') + '</div></div>'; }
  }

  function renderNoVault() {
    app.innerHTML = header()
      + '<div class="p-fill"><div class="p-card" style="text-align:center;display:flex;flex-direction:column;gap:11px">'
      + '<div class="p-title">Your wallet</div>'
      + '<div class="p-hint">Create a new self-custodial wallet, restore one from a seed phrase, or connect a hardware wallet. Keys are generated &amp; encrypted <b>in this browser</b> — they never leave this device.</div>'
      + '<button class="btn" id="bCreate">Create wallet</button>'
      + '<button class="btn ghost" id="bRestore">Restore from seed</button>'
      + '<button class="btn ghost" id="bRestoreFile">Restore from backup file</button>'
      + '<button class="btn ghost" id="bHardware">Connect hardware wallet</button></div>'
      + '<div class="foot-note">Self-custodial · your keys never leave this device.</div></div>';
    document.getElementById('bCreate').onclick = createChooseLen;
    document.getElementById('bRestore').onclick = restoreForm;
    document.getElementById('bRestoreFile').onclick = openBackupTab; // restore a .json backup → compact window (holds the file picker)
    // Hardware (Ledger via WebHID): connect natively in the popup UI. WebHID needs a top-level context,
    // so unless we're already in the dedicated hardware window we open one (same popup UI, not the Terminal).
    document.getElementById('bHardware').onclick = function () { if (IS_HW_WIN) hwConnect(); else openHardwareTab(); };
  }

  // ══ Native Ledger (WebHID) — connect + read-only dashboard, rendered entirely in the popup UI ══
  var HW_REFRESH = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 10-2.3 5.7M20 4v5h-5"/></svg>';
  function hwAddr() {
    if (!HW || !HW.bitcoin) return null;
    if (chain === 'btc') return hwViewAddr || (HW.bitcoin[hwBt] || HW.bitcoin.nativeSegwit || {}).address || null;
    return chain === 'eth' ? (HW.ethereum && HW.ethereum.address) : (HW.solana && HW.solana.address);
  }
  function hwLoadBundle() {
    if (window.WonderHW) return Promise.resolve(window.WonderHW);
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script'); s.src = 'wallet-hw.js';
      s.onload = function () { window.WonderHW ? resolve(window.WonderHW) : reject(new Error('hardware bundle failed to init')); };
      s.onerror = function () { reject(new Error('failed to load hardware bundle')); };
      document.head.appendChild(s);
    });
  }
  // Dedicated hardware-connect TAB page (?hw=1): a clean, centered pairing screen — the hub for hardware
  // wallets (Ledger now; Trezor slot for later). Not the stretched wallet UI + floating modal.
  function hwLandingPage() {
    var bundleP = hwLoadBundle().catch(function () { return null; }); // pre-warm the WebHID bundle
    app.innerHTML = '<div class="hw-page"><div class="hw-card">'
      + '<div class="hw-brand"><span class="p-seal">' + SEAL + '</span><div><div class="p-name">Connect a hardware wallet</div><div class="p-sub">Wonder Wallet · self-custodial</div></div></div>'
      + '<div class="p-hint">Keep your keys on a hardware device. Wonder Wallet reads your addresses and builds the transactions — you approve them on the device. <b>Keys never leave it.</b></div>'
      + '<div class="hw-devs">'
      + '<button class="hw-dev on" id="hwDevLedger"><span class="hw-dev-ic">🔐</span><span class="hw-dev-t"><b>Ledger</b><small>Nano S · X · S+ — WebHID · BTC · ETH · Solana</small></span><span class="hw-dev-go">→</span></button>'
      + '<div class="hw-dev disabled"><span class="hw-dev-ic">🔒</span><span class="hw-dev-t"><b>Trezor</b><small>via Trezor Connect — coming soon</small></span></div>'
      + '</div>'
      + '<div class="p-hint">Before connecting: <b>unlock your Ledger</b> and <b>open the Bitcoin app</b>. To add Ethereum / Solana, install those apps too — you approve each on the device.</div>'
      + '<div class="p-err" id="hwErr" style="display:none"></div>'
      + '<button class="btn" id="hwGo">Connect Ledger</button>'
      + '<div class="hw-foot">🔐 Your keys never leave your device</div>'
      + '</div></div>';
    var go = function () { hwRun(bundleP, false); };
    document.getElementById('hwGo').onclick = go;
    document.getElementById('hwDevLedger').onclick = go;
  }
  function hwSuccessPage() {
    app.innerHTML = '<div class="hw-page"><div class="hw-card" style="text-align:center">'
      + '<div class="hw-check">✓</div>'
      + '<div class="p-name" style="font-size:19px;margin-top:6px">Ledger paired</div>'
      + '<div class="p-hint" style="margin-top:8px">Your Ledger is connected to Wonder Wallet as a <b>view-only</b> account. Open the Wonder Wallet extension to see your balances, assets and portfolio — no need to reconnect.</div>'
      + '<div class="p-hint" id="hwCloseHint" style="margin-top:8px;color:var(--gold2)"></div>'
      + '<div class="actions" style="margin-top:12px"><button class="btn ghost" id="hwStay">Keep this tab</button><button class="btn" id="hwCloseNow">Close tab</button></div>'
      + '</div></div>';
    var secs = 5, hint = document.getElementById('hwCloseHint');
    var tick = function () { if (hint) hint.textContent = 'This tab closes automatically in ' + secs + 's…'; };
    tick();
    var timer = setInterval(function () { secs--; if (secs <= 0) { clearInterval(timer); hwCloseTab(); } else tick(); }, 1000);
    document.getElementById('hwStay').onclick = function () { clearInterval(timer); if (hint) hint.textContent = 'You can close this tab anytime — your Ledger is saved.'; };
    document.getElementById('hwCloseNow').onclick = function () { clearInterval(timer); hwCloseTab(); };
  }
  function hwCloseTab() { try { chrome.tabs.getCurrent(function (t) { if (t && t.id != null) chrome.tabs.remove(t.id); else { try { window.close(); } catch (e) {} } }); } catch (e) { try { window.close(); } catch (x) {} } }
  function hwConnect() {
    var bundleP = hwLoadBundle().catch(function () { return null; }); // pre-warm so the click's gesture survives to the picker
    overlay('<div class="menu" style="padding:16px;display:flex;flex-direction:column;gap:11px">'
      + '<div class="p-title" style="font-size:16px">Connect a hardware wallet</div>'
      + '<div class="p-hint">Keep your keys on a <b>Ledger</b>. Wonder Wallet reads your addresses and builds transactions — you approve them on the device. Keys never leave the Ledger.</div>'
      + '<div class="p-hint">Unlock your Ledger and <b>open the Bitcoin app</b> before connecting.</div>'
      + '<div class="p-card" style="padding:10px"><b>Ledger</b> <span class="fine">WebHID · BTC · ETH · Solana</span></div>'
      + '<div class="p-err" id="hwErr" style="display:none"></div>'
      + '<div class="actions"><button class="btn ghost" id="hwCancel">Cancel</button><button class="btn" id="hwGo">Connect Ledger</button></div></div>');
    document.getElementById('hwCancel').onclick = closeOv;
    document.getElementById('hwGo').onclick = function () { hwRun(bundleP, false); };
  }
  async function hwRun(bundleP, fresh) {
    var err = document.getElementById('hwErr'); if (err) { err.style.display = 'block'; err.className = 'p-hint'; err.textContent = fresh ? 'Choose your Ledger in the browser prompt…' : 'Loading hardware module…'; }
    try {
      var HWm = (await bundleP) || (await hwLoadBundle());
      if (!HWm.isSupported()) { if (err) { err.className = 'p-err'; err.textContent = 'WebHID needs a Chromium browser (Chrome/Brave/Edge), Ledger unlocked.'; } return; }
      if (err) err.textContent = 'Choose your Ledger in the browser prompt, then approve on the device…';
      if (fresh && HWm.forceReconnect) await HWm.forceReconnect(); else await HWm.connect();
      if (err) err.textContent = 'Reading addresses — open/allow apps on the device if it prompts…';
      var accts = await HWm.getAddresses(0);
      HW = accts; acctKind = 'hardware'; chain = 'btc';
      hwBt = HW.bitcoin && HW.bitcoin.nativeSegwit ? 'nativeSegwit' : (HW.bitcoin ? Object.keys(HW.bitcoin)[0] : 'nativeSegwit');
      hwViewAddr = null; hwViewIndex = null; hwAgg = false;
      try { lsSet('ww:ledger', HW); saveLast(); } catch (e) {} // PAIR: persist the Ledger's public addresses so every surface (popup/panel) reflects it
      try { await HWm.disconnect(); } catch (e) {} // read-only: free the device — all reads go through the proxy
      if (IS_HW_WIN) hwSuccessPage(); else { closeOv(); hwRenderMain(); } // the connect tab confirms + offers to close; elsewhere show the dashboard
    } catch (e) {
      var m = String(e && e.message || '');
      var msg = /No device selected|cancelled|user gesture/i.test(m) ? 'Connection cancelled or no device selected.'
        : /open the .* app|INS_NOT_SUPPORTED|0x6d00|6d00|6511|6e00/i.test(m) ? 'Couldn’t read the Bitcoin app — unlock the Ledger with the Bitcoin app open, then Reconnect.'
        : /locked|0x5515|5515|0x6a87|6a87|0x6b0c|6b0c/i.test(m) ? 'Your Ledger is locked — unlock it (enter your PIN) and open the Bitcoin app, then Reconnect.'
        : ('Couldn’t connect: ' + m);
      try { console.error('[WonderHW] connect failed:', e); } catch (x) {}
      if (err) { err.className = 'p-err'; err.innerHTML = esc(msg) + '<div class="fine" style="margin-top:6px;opacity:.7;word-break:break-word">details: ' + esc((m || 'unknown').slice(0, 200)) + '</div>'; }
      var go = document.getElementById('hwGo'); if (go) { go.textContent = 'Reconnect — choose device'; go.onclick = function () { hwRun(bundleP, true); }; }
    }
  }
  function hwRenderMain() {
    if (!HW) return render();
    var c = CH[chain], addr = hwAddr();
    var canScan = !!(chain === 'btc' && HW.bitcoin[hwBt] && HW.bitcoin[hwBt].acct);
    var sub = c.name + (hwAgg && chain === 'btc' ? ' · all addresses' : hwViewAddr ? ' · 0/' + hwViewIndex : '');
    app.innerHTML =
      '<div class="p-head"><button class="chain-btn" id="chainBtn" title="Switch blockchain"><span class="cs-ic ' + chain + '">' + c.ic + '</span><span class="chev">▾</span></button>'
      + '<div class="p-brand-mid"><div class="p-name">🔐 Ledger</div><div class="p-sub">' + esc(sub) + '</div></div>'
      + '<div class="p-icons"><button class="p-ibtn" id="bRefresh" title="Refresh">' + HW_REFRESH + '</button>'
      + (IN_PANEL ? '' : '<button class="p-ibtn" id="bPanel" title="Dock as side panel">' + PANEL_ICON + '</button>')
      + '<button class="p-ibtn" id="bHwSettings" title="Settings — appearance, auto-lock, Ledger">' + GEAR_SVG + '</button>'
      + '<button class="p-ibtn" id="bLock" title="Lock wallet">' + LOCK_SVG + '</button></div></div>'
      + '<div class="acct-bar"><button class="acct-sel" id="hwAcctBtn" title="Addresses, portfolio & wallets" style="flex:1;display:flex;align-items:center;justify-content:space-between;text-align:left;cursor:pointer"><span>🔐 Ledger' + esc(hwAgg && chain === 'btc' ? ' · Portfolio' : chain === 'btc' ? ' · 0/' + (hwViewIndex != null ? hwViewIndex : 0) : '') + '</span><span class="chev">▾</span></button><button class="p-ibtn acct-x" id="hwUnpair" title="Unpair this Ledger">×</button></div>'
      + '<div class="total"><div class="amt-wrap"><div class="amt" id="nativeVal">…</div><button class="priv-eye' + (PRIVACY ? ' on' : '') + '" id="bPrivacy" title="Privacy view">' + (PRIVACY ? EYE_OFF_SVG : EYE_SVG) + '</button></div><div class="lbl" id="nativeLbl">Ledger · read-only</div></div>'
      + '<div class="addr-row"><div class="addr-chip" data-copy="' + esc(addr || '') + '" title="Copy address">' + (hwAgg && chain === 'btc' ? '⊕ all addresses' : esc(short(addr || '—'))) + '</div>'
      + (chain === 'btc' ? '<button class="btctype-chip" id="btcTypeBtn" title="Bitcoin address type">' + esc(BTC_LABEL[hwBt]) + ' ▾</button>' : '')
      + (hwViewAddr ? '<button class="btctype-chip" id="hwMain" title="Back to main address">← main</button>' : '') + '</div>'
      + '<div class="util-row">'
      + (chain === 'btc' ? '<button class="cc-launch" id="bActivity" title="Transaction history">⧗ Activity</button>' : '')
      + '</div>'
      + '<div class="asset-tabs"><button class="atab ' + (tab === 'tokens' ? 'on' : '') + '" data-tab="tokens">Tokens</button><button class="atab ' + (tab === 'collectibles' ? 'on' : '') + '" data-tab="collectibles">Collectibles</button></div>'
      + '<div id="assetBody"><div class="empty">Loading ' + esc(c.name) + ' assets…</div></div>'
      + '<div class="ext-footer"><div class="actions">'
      + ((chain === 'btc' && hwBt === 'nativeSegwit' && HW.mfp) ? '<button class="btn" id="bHwSend">Send</button>' : '')
      + '<button class="btn ghost" id="bReceive">Receive</button></div>'
      + '<div class="foot-strip"><span class="foot-lock">🔐 keys stay on your Ledger</span><span class="pill"><span class="pdot"></span>' + ((chain === 'btc' && hwBt === 'nativeSegwit' && HW.mfp) ? 'sign on device' : 'read-only view') + '</span>' + (VER ? '<span class="foot-ver">v' + esc(VER) + '</span>' : '') + '</div></div>';
    document.getElementById('chainBtn').onclick = hwChainMenu;
    document.getElementById('bRefresh').onclick = function () { var b = document.getElementById('assetBody'); if (b) b.innerHTML = '<div class="empty">Refreshing…</div>'; hwLoad(); };
    document.getElementById('hwAcctBtn').onclick = hwAcctMenu; // Ledger address / portfolio / seed-wallet switcher
    var up = document.getElementById('hwUnpair'); if (up) up.onclick = hwUnpair;
    saveLast();
    var pv = document.getElementById('bPrivacy'); if (pv) pv.onclick = togglePrivacy;
    var bt = document.getElementById('btcTypeBtn'); if (bt) bt.onclick = hwBtcTypeMenu;
    var mn = document.getElementById('hwMain'); if (mn) mn.onclick = function () { hwViewAddr = null; hwViewIndex = null; hwRenderMain(); };
    var ac = document.getElementById('bActivity'); if (ac) ac.onclick = function () { renderActivity(hwAddr()); };
    var pn = document.getElementById('bPanel'); if (pn) pn.onclick = openSidePanel;
    var stg = document.getElementById('bHwSettings'); if (stg) stg.onclick = hwSettingsMenu;
    var lk = document.getElementById('bLock'); if (lk) lk.onclick = function () { C.lock(); render(); };
    var hs = document.getElementById('bHwSend'); if (hs) hs.onclick = renderHwSend;
    document.getElementById('bReceive').onclick = hwReceiveSingle;
    app.querySelectorAll('.atab').forEach(function (b) { b.onclick = function () { tab = b.dataset.tab; app.querySelectorAll('.atab').forEach(function (x) { x.classList.toggle('on', x === b); }); renderAssetBody(); }; });
    app.querySelectorAll('[data-copy]').forEach(function (el) { el.onclick = function () { copy(el.getAttribute('data-copy'), el); }; });
    hwLoad();
  }
  function hwChainMenu() {
    var chains = [['btc', 'Bitcoin']]; if (HW.ethereum) chains.push(['eth', 'Ethereum']); if (HW.solana) chains.push(['sol', 'Solana']);
    overlay('<div class="menu">' + chains.map(function (ch) { return '<button class="menu-opt' + (ch[0] === chain ? ' on' : '') + '" data-ch="' + ch[0] + '">' + esc(ch[1]) + '</button>'; }).join('') + '</div>');
    app.querySelectorAll('[data-ch]').forEach(function (b) { b.onclick = function () { chain = b.dataset.ch; hwViewAddr = null; hwViewIndex = null; hwAgg = false; closeOv(); hwRenderMain(); }; });
  }
  function hwBtcTypeMenu() {
    var types = [['nativeSegwit', 'Native SegWit · bc1q'], ['legacy', 'Legacy · 1… (Counterparty/Stamps)'], ['taproot', 'Taproot · bc1p'], ['nestedSegwit', 'Nested SegWit · 3…']].filter(function (t) { return HW.bitcoin[t[0]]; });
    overlay('<div class="menu">' + types.map(function (t) { return '<button class="menu-opt' + (t[0] === hwBt ? ' on' : '') + '" data-t="' + t[0] + '"><b>' + esc(t[1].split(' · ')[0]) + '</b> <span class="fine">' + esc(t[1].split(' · ')[1] || '') + '</span></button>'; }).join('') + '</div>');
    app.querySelectorAll('[data-t]').forEach(function (b) { b.onclick = function () { hwBt = b.dataset.t; hwViewAddr = null; hwViewIndex = null; hwAgg = false; closeOv(); hwRenderMain(); }; });
  }
  // The Ledger-view account dropdown. In Ledger-only mode it replaces the seed HD accounts (which are
  // meaningless here) with the device's OWN addresses + portfolio; if a seed vault also exists, one
  // "Switch to seed wallet" line returns to it (we never flood this list with the seed's Account 0-3).
  async function hwAcctMenu() {
    var canScan = !!(chain === 'btc' && HW.bitcoin[hwBt] && HW.bitcoin[hwBt].acct);
    var mainAddr = (HW.bitcoin[hwBt] || {}).address || null;
    var onMain = !hwAgg && (hwViewIndex == null || hwViewIndex === 0);
    var funded = (hwScanCache && hwScanCache.bt === hwBt && chain === 'btc')
      ? hwScanCache.results.filter(function (r) { return r.sum.has && r.index !== 0; }) : [];
    var html = '<div class="menu"><div class="menu-hd">🔐 Ledger · ' + esc(CH[chain].name) + '</div>';
    if (canScan) html += '<button class="menu-opt' + (hwAgg ? ' on' : '') + '" data-a="agg"><span>⊕ Portfolio · all addresses<br><span class="fine">combined balances &amp; assets</span></span></button>';
    else if (chain === 'btc') html += '<div class="menu-opt" style="opacity:.6;cursor:default"><span>⊕ Portfolio unavailable<br><span class="fine">unpair &amp; reconnect the Ledger to enable the all-address scan</span></span></div>';
    if (chain === 'btc') {
      html += '<div class="menu-hd">Addresses</div>';
      html += '<button class="menu-opt' + (onMain ? ' on' : '') + '" data-a="idx" data-i="0" data-addr="' + esc(mainAddr || '') + '"><span>0/0 · ' + esc(short(mainAddr || '—')) + '<br><span class="fine">main receiving address</span></span></button>';
      funded.forEach(function (r) {
        var meta = (r.sum.btc > 0 ? fmt(r.sum.btc, 8) + ' BTC' : '—') + (r.sum.tokens ? ' · ' + r.sum.tokens + ' token' + (r.sum.tokens === 1 ? '' : 's') : '') + (r.sum.coll ? ' · ' + r.sum.coll + ' collectible' + (r.sum.coll === 1 ? '' : 's') : '');
        html += '<button class="menu-opt' + (!hwAgg && hwViewIndex === r.index ? ' on' : '') + '" data-a="idx" data-i="' + r.index + '" data-addr="' + esc(r.address) + '"><span>0/' + r.index + ' · ' + esc(short(r.address)) + '<br><span class="fine">' + esc(meta) + '</span></span></button>';
      });
      if (canScan) html += '<button class="menu-opt" data-a="scan"><span>⧉ Browse / scan all addresses…' + (funded.length ? '' : '<br><span class="fine">find balances across the first 20</span>') + '</span></button>';
    }
    var hasSeed = false; try { hasSeed = await C.hasVault(); } catch (e) {}
    if (hasSeed) html += '<div class="menu-hd">Seed wallet</div><button class="menu-opt" data-a="seed"><span>↩ Switch to seed wallet</span></button>';
    html += '</div>';
    overlay(html);
    document.querySelectorAll('#pop-ov [data-a]').forEach(function (b) {
      b.onclick = function () {
        var a = b.dataset.a;
        if (a === 'agg') { hwAgg = true; hwViewAddr = null; hwViewIndex = null; closeOv(); hwRenderMain(); }
        else if (a === 'idx') { var i = +b.dataset.i; hwAgg = false; if (i === 0) { hwViewAddr = null; hwViewIndex = null; } else { hwViewAddr = b.dataset.addr; hwViewIndex = i; } closeOv(); hwRenderMain(); }
        else if (a === 'scan') { closeOv(); hwScan(); }
        else if (a === 'seed') { closeOv(); hwSwitchToSeed(); }
      };
    });
  }
  // Leave the Ledger view for the seed wallet WITHOUT unpairing the Ledger (it stays available under
  // the seed dropdown's "Hardware" group). render() lands on the seed dashboard, or the unlock screen if locked.
  function hwSwitchToSeed() { acctKind = 'hd'; chain = 'btc'; hwViewAddr = null; hwViewIndex = null; hwAgg = false; render(); }
  async function hwLoad() {
    var addr = hwAddr();
    if (chain !== 'btc' || !hwAgg) return loadAssets(addr); // single address (btc/eth/sol) via the normal loader
    var acct = HW.bitcoin[hwBt] && HW.bitcoin[hwBt].acct;
    if (!acct || !acct.pub || !acct.chainCode) { hwAgg = false; return loadAssets(addr); }
    var derived; try { derived = C.deriveReceiveAddrs(acct.pub, acct.chainCode, hwBt, 20, 0); } catch (e) { hwAgg = false; return loadAssets(addr); }
    if (!PRICES.bitcoin) { try { PRICES = await fetch('api/prices').then(function (r) { return r.json(); }); } catch (e) {} }
    var body = document.getElementById('assetBody');
    var aggNum = function (v) { var n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.eE+-]/g, '')); return isFinite(n) ? n : 0; };
    var btcTotal = 0, done = 0, tokMap = {}, colls = [], names = [], primaryName = null, N = 5;
    for (var i = 0; i < derived.length; i += N) {
      await Promise.all(derived.slice(i, i + N).map(async function (d) {
        try {
          var r = await Promise.all([
            fetch('api/btc/' + encodeURIComponent(d.address)).then(function (x) { return x.json(); }).catch(function () { return {}; }),
            fetch('api/btc/' + encodeURIComponent(d.address) + '/assets').then(function (x) { return x.json(); }).catch(function () { return {}; }),
          ]);
          var bal = r[0], a2 = r[1];
          btcTotal += (bal.balanceSats || 0) / 1e8;
          var stampCpids = {}; (a2.stamps || []).forEach(function (s) { if (s.cpid) stampCpids[s.cpid] = 1; });
          (a2.src20 || []).forEach(function (x) { var k = 'src20:' + (x.tick || x.name); var cur = tokMap[k] || { name: x.tick, tick: x.tick, img: x.img, src20: true, _num: 0, _n: 0, _d0: x.amount }; cur._num += aggNum(x.amount); cur._n++; tokMap[k] = cur; });
          (a2.counterparty || []).forEach(function (x) { if (stampCpids[x.asset]) return; var amt = (x.qtyNormalized != null ? x.qtyNormalized : x.quantity); var k = 'cp:' + x.asset; var cur = tokMap[k] || { name: x.name || x.asset, asset: x.asset, cp: true, divisible: !!x.divisible, _num: 0, _n: 0, _d0: amt }; cur._num += aggNum(amt); cur._n++; tokMap[k] = cur; });
          (a2.stamps || []).forEach(function (s) { colls.push({ title: '#' + s.stamp, img: 'api/stamp/' + s.stamp + '/content', stamp: s.stamp, cpid: s.cpid, mime: s.mime || null, qty: (s.quantity != null ? Number(s.quantity) : 1) }); });
          var has = ((bal.balanceSats || 0) > 0) || (a2.stamps || []).length || (a2.src20 || []).length || (a2.counterparty || []).length;
          if (has) { try { var nm = await fetch('api/src101/names/' + encodeURIComponent(d.address)).then(function (x) { return x.json(); }); if (nm && nm.primary && !primaryName) primaryName = nm.primary; (nm.names || []).filter(function (n) { return !n.expired; }).forEach(function (n) { names.push({ kind: 'name', title: n.name, name: n.name, img: n.img ? ('api/img?url=' + encodeURIComponent(n.img)) : null, primary: !!n.primary, deploy: n.deploy }); }); } catch (e) {} }
        } catch (e) {}
        done++; if (body) { var em = body.querySelector('.empty'); if (em) em.textContent = 'Scanning ' + done + ' / ' + derived.length + ' addresses…'; }
      }));
    }
    var tokens = Object.keys(tokMap).map(function (k) { var t = tokMap[k]; var amount = (t._n <= 1 ? t._d0 : t._num.toLocaleString('en-US', { maximumFractionDigits: 8 })); return t.src20 ? { name: t.name, amount: amount, img: t.img, src20: true, tick: t.tick } : { name: t.name, amount: amount, asset: t.asset, cp: true, divisible: t.divisible }; });
    ASSETS = { native: btcTotal, usd: btcTotal * (PRICES.bitcoin || 0), tokens: tokens, collectibles: names.concat(colls), note: '', primaryName: primaryName };
    paintNative(); renderAssetBody();
  }
  async function hwScan() {
    var acct = HW.bitcoin[hwBt] && HW.bitcoin[hwBt].acct;
    if (!acct || !acct.pub || !acct.chainCode) { overlay('<div class="menu" style="padding:16px"><div class="p-hint">Your Ledger didn’t return the account key needed to scan. You’re on the main address (index 0).</div><div class="actions" style="margin-top:10px"><button class="btn" id="hsX">Close</button></div></div>'); document.getElementById('hsX').onclick = closeOv; return; }
    var derived; try { derived = C.deriveReceiveAddrs(acct.pub, acct.chainCode, hwBt, 20, 0); } catch (e) { return; }
    overlay('<div class="menu" style="padding:14px"><div class="p-title" style="font-size:15px;margin-bottom:6px">Receiving addresses</div><div class="p-hint" style="margin-bottom:8px">Ledger issues a fresh address each receive — scanning the first 20. Tap one to view its holdings.</div><div id="hsBody"><div class="empty">Scanning 0 / ' + derived.length + '…</div></div><div class="actions" style="margin-top:10px"><button class="btn ghost" id="hsX">Close</button></div></div>');
    document.getElementById('hsX').onclick = closeOv;
    var results = [], done = 0, N = 5;
    for (var i = 0; i < derived.length; i += N) {
      await Promise.all(derived.slice(i, i + N).map(async function (d) {
        var sum = { btc: 0, tokens: 0, coll: 0, has: false };
        try {
          var r = await Promise.all([ fetch('api/btc/' + encodeURIComponent(d.address)).then(function (x) { return x.json(); }).catch(function () { return {}; }), fetch('api/btc/' + encodeURIComponent(d.address) + '/assets').then(function (x) { return x.json(); }).catch(function () { return {}; }) ]);
          sum.btc = (r[0].balanceSats || 0) / 1e8; var st = (r[1].stamps || []).length, s2 = (r[1].src20 || []).length, cp = (r[1].counterparty || []).length; sum.tokens = s2 + cp; sum.coll = st; sum.has = sum.btc > 0 || st > 0 || s2 > 0 || cp > 0;
        } catch (e) {}
        results.push({ address: d.address, index: d.index, sum: sum }); done++;
        var b = document.getElementById('hsBody'); if (b && b.querySelector('.empty')) b.querySelector('.empty').textContent = 'Scanning ' + done + ' / ' + derived.length + '…';
      }));
    }
    results.sort(function (a, b) { return a.index - b.index; });
    hwScanCache = { bt: hwBt, results: results }; // remember for the account dropdown (avoids re-scanning on open)
    var rows = results.map(function (r) { return '<button class="acct-line" data-view="' + esc(r.address) + '" data-i="' + r.index + '" style="width:100%;text-align:left;cursor:pointer;' + (r.sum.has ? 'border-color:var(--gold2)' : '') + '"><span class="acct-lab">0/' + r.index + ' · ' + esc(short(r.address)) + '<br><span class="fine">' + (r.sum.btc > 0 ? fmt(r.sum.btc, 8) + ' BTC' : '—') + (r.sum.tokens ? ' · ' + r.sum.tokens + ' token' + (r.sum.tokens === 1 ? '' : 's') : '') + (r.sum.coll ? ' · ' + r.sum.coll + ' collectible' + (r.sum.coll === 1 ? '' : 's') : '') + '</span></span><span>' + (r.sum.has ? '● ' : '') + '→</span></button>'; }).join('');
    var bodyEl = document.getElementById('hsBody');
    if (bodyEl) bodyEl.innerHTML = results.some(function (r) { return r.sum.has; }) ? rows : '<div class="fine" style="padding:4px">No balances or assets on the first 20 addresses (index 0–19).</div>' + rows;
    if (bodyEl) bodyEl.querySelectorAll('[data-view]').forEach(function (b) { b.onclick = function () { hwViewAddr = b.dataset.view; hwViewIndex = +b.dataset.i; hwAgg = false; closeOv(); hwRenderMain(); }; });
  }
  function hwReceive() {
    var b = HW.bitcoin || {};
    var row = function (label, addr) { return '<div class="acct-line"><span class="acct-lab">' + esc(label) + '<br><span class="fine" style="font-family:var(--mono);font-size:10px;word-break:break-all">' + esc(addr) + '</span></span><span><button class="mini" data-copy2="' + esc(addr) + '">copy</button></span></div>'; };
    overlay('<div class="menu" style="padding:14px"><div class="p-title" style="font-size:15px;margin-bottom:6px">Receive · Ledger</div><div class="p-hint" style="margin-bottom:8px">Verify the address on your device before receiving large amounts.</div>'
      + (b.nativeSegwit ? row('Native SegWit', b.nativeSegwit.address) : '') + (b.legacy ? row('Legacy · Counterparty/Stamps', b.legacy.address) : '') + (b.taproot ? row('Taproot', b.taproot.address) : '')
      + '<div class="actions" style="margin-top:10px"><button class="btn ghost" id="rvX">Close</button></div></div>');
    document.getElementById('rvX').onclick = closeOv;
    // The Receive window is an overlay (#pop-ov is a body sibling of #app), so scope to the document —
    // app.querySelectorAll would find none of these buttons and the copy would silently do nothing.
    document.querySelectorAll('#pop-ov [data-copy2]').forEach(function (el) { el.onclick = function () { copy(el.getAttribute('data-copy2'), el); }; });
  }
  // Ledger Receive: show the ONE address the user already selected on the main view (current chain + BTC
  // type / browsed index) with a QR + copy — not a list. Browsing all addresses lives under the account
  // menu (Portfolio / scan). Falls back to the type list only if there's no single selected address.
  function hwReceiveSingle() {
    var addr = hwAddr(), c = CH[chain];
    if (!addr) return hwReceive();
    var qr = window.qrcode ? qrDataUrl(addr) : null;
    var COPY_IC = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
    overlay('<div class="menu" style="padding:14px;text-align:center"><div class="p-title" style="font-size:15px;margin-bottom:6px">Receive ' + esc(c.sym) + '</div>'
      + '<div class="p-hint" style="margin-bottom:10px">Your ' + esc(c.name) + ' address. Verify it on your Ledger before receiving large amounts.</div>'
      + (qr ? '<div class="recv-qr" style="margin-bottom:10px"><img src="' + qr + '" alt="' + esc(c.name) + ' address QR" width="180" height="180"/></div>' : '')
      + '<div class="recv-addr" role="button" tabindex="0" title="Tap to copy"><span class="ra-text">' + esc(addr) + '</span><span class="ra-copy" aria-hidden="true">' + COPY_IC + '</span></div>'
      + '<div class="actions" style="margin-top:12px"><button class="btn ghost" id="rvX">Close</button></div></div>');
    document.getElementById('rvX').onclick = closeOv;
    var ra = document.querySelector('#pop-ov .recv-addr');
    if (ra) {
      var rc = ra.querySelector('.ra-copy'), orig = rc.innerHTML;
      var doCopy = function () { try { navigator.clipboard.writeText(addr); } catch (e) {} ra.classList.add('copied'); rc.innerHTML = '✓ Copied'; clearTimeout(ra._t); ra._t = setTimeout(function () { ra.classList.remove('copied'); rc.innerHTML = orig; }, 1300); };
      ra.onclick = doCopy;
      ra.onkeydown = function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); doCopy(); } };
    }
  }
  // Resolve the current source address's signing derivation (pub + relative path "0/i").
  function hwSourceEntry() {
    var bt = hwBt, acct = HW.bitcoin[bt] && HW.bitcoin[bt].acct;
    if (!acct || !acct.pub || !acct.chainCode) return null;
    var idx = hwViewIndex != null ? hwViewIndex : 0, from = hwAddr(), list;
    try { list = C.deriveReceiveAddrs(acct.pub, acct.chainCode, bt, Math.max(20, idx + 1), 0); } catch (e) { return null; }
    var e = list.find(function (d) { return d.address === from; }) || list[idx] || list[0];
    return e ? { path: e.path, pub: e.pub, address: e.address } : null;
  }
  var hwSpendable = function (u) { return u.category === 'spendable' && !u.frozen && !u.timelocked; };
  // WW-C09: re-validate the EXACT input set against FRESH coin-control immediately before the Ledger
  // signs. UTXOs are classified at build time, but an asset can land on one (or the user can freeze /
  // time-lock it) in the gap before the device signs — the hardware path never re-checked. Re-fetch
  // coincontrol + re-apply the local freeze overlay for each input's address and require every spent
  // outpoint to still exist AND still be spendable. Fail closed — nothing reaches the device otherwise.
  async function hwAssertInputsFresh(built, gutxos) {
    var ins; try { ins = C.psbtInputs(built.psbt) || []; } catch (e) { throw new Error('Could not read the transaction inputs to re-verify them — nothing was signed.'); }
    var addrByOp = {}; (gutxos || []).forEach(function (u) { addrByOp[u.txid + ':' + u.vout] = u.address; });
    var ops = ins.map(function (i) { return { op: i.txid + ':' + i.index, addr: addrByOp[i.txid + ':' + i.index] || null }; });
    var addrs = {}; ops.forEach(function (x) { if (x.addr) addrs[x.addr] = true; });
    var addrList = Object.keys(addrs);
    if (!addrList.length) throw new Error('Could not match the transaction inputs to your addresses — nothing was signed. Rebuild the transaction.');
    var fresh = {};
    await Promise.all(addrList.map(async function (a) {
      var cc = ccApplyMeta(a, await fetch('api/btc/' + a + '/coincontrol').then(function (r) { return r.json(); }));
      (cc.utxos || []).forEach(function (u) { fresh[u.txid + ':' + u.vout] = u; });
    }));
    for (var k = 0; k < ops.length; k++) {
      var u = fresh[ops[k].op];
      if (!u) throw new Error('An input this transaction spends is no longer available (spent or reorged). Nothing was signed — rebuild the transaction.');
      if (!hwSpendable(u)) throw new Error('An input this transaction spends became protected (asset-bearing, frozen, or time-locked) since you built it. Nothing was signed — rebuild the transaction.');
    }
  }
  // Gather spendable UTXOs (each tagged with its OWN pub + derivation path so the Ledger can sign each
  // input). Single-address mode → the viewed address; portfolio mode → every derived address, so the
  // wallet is "smart" and spends whatever's available across the account. Change always returns to the
  // main address (index 0). Asset-bearing / frozen / time-locked UTXOs are excluded (coin-control aware).
  async function hwGatherUtxos(agg) {
    var bt = hwBt, acct = HW.bitcoin[bt] && HW.bitcoin[bt].acct;
    if (!agg) {
      var src = hwSourceEntry(); if (!src) return null;
      var cc = ccApplyMeta(src.address, await fetch('api/btc/' + src.address + '/coincontrol').then(function (r) { return r.json(); }));
      return { utxos: (cc.utxos || []).filter(hwSpendable).map(function (u) { return { txid: u.txid, vout: u.vout, value: u.value, pub: src.pub, path: src.path, address: src.address }; }), change: src, from: src.address };
    }
    if (!acct || !acct.pub || !acct.chainCode) return null;
    var derived = C.deriveReceiveAddrs(acct.pub, acct.chainCode, bt, 20, 0);
    var all = [], N = 5;
    for (var i = 0; i < derived.length; i += N) {
      await Promise.all(derived.slice(i, i + N).map(async function (d) {
        try { var cc = ccApplyMeta(d.address, await fetch('api/btc/' + d.address + '/coincontrol').then(function (r) { return r.json(); })); (cc.utxos || []).filter(hwSpendable).forEach(function (u) { all.push({ txid: u.txid, vout: u.vout, value: u.value, pub: d.pub, path: d.path, address: d.address }); }); } catch (e) {}
      }));
    }
    return { utxos: all, change: { pub: derived[0].pub, path: derived[0].path, address: derived[0].address }, from: 'all addresses' };
  }
  async function renderHwSend() {
    stopCd();
    if (hwBt !== 'nativeSegwit' || !HW.mfp) { overlay('<div class="menu" style="padding:16px"><div class="p-hint">On-device sending is available for <b>Native SegWit</b> (bc1q…) in this version. Switch the address type, or re-pair the Ledger if there’s no device fingerprint yet.</div><div class="actions" style="margin-top:10px"><button class="btn" id="hsX">Close</button></div></div>'); document.getElementById('hsX').onclick = closeOv; return; }
    var agg = hwAgg;
    var src = agg ? null : hwSourceEntry();
    if (!agg && !src) { overlay('<div class="menu" style="padding:16px"><div class="p-hint">Couldn’t resolve the signing key for this address — re-pair your Ledger and try again.</div><div class="actions" style="margin-top:10px"><button class="btn" id="hsX">Close</button></div></div>'); document.getElementById('hsX').onclick = closeOv; return; }
    var fromLabel = agg ? '⊕ all addresses' : short(src.address);
    if (!PRICES.bitcoin) { try { PRICES = await fetch('api/prices').then(function (r) { return r.json(); }); } catch (e) {} }
    var fees = { fastestFee: 10, halfHourFee: 6, hourFee: 3 };
    try { fees = await fetch('api/btc/fees').then(function (r) { return r.json(); }); } catch (e) {}
    var feeRate = fees.halfHourFee || 6;
    app.innerHTML = '<div class="p-head"><button class="p-ibtn" id="bBack" title="Back">←</button><div class="p-brand-mid"><div class="p-name">Send Bitcoin</div><div class="p-sub">🔐 Ledger · ' + esc(fromLabel) + '</div></div><div class="p-icons"></div></div>'
      + '<div class="send-form">'
      + (agg ? '<div class="p-hint">Portfolio send — the wallet spends from <b>whatever address holds the balance</b> and returns change to your main address.</div>' : '')
      + '<input id="hTo" class="p-in" placeholder="Address or name.btc" spellcheck="false" autocomplete="off" autocapitalize="off"/>'
      + '<div id="hNameRes" class="name-resolve" hidden></div>'
      + '<div class="send-amt"><input id="hAmt" class="p-in" type="number" step="0.00000001" min="0" placeholder="Amount (BTC)"/><label class="send-max"><input type="checkbox" id="hMax"/> Max</label></div>'
      + '<div id="hAmtUsd" class="send-usd" hidden></div>'
      + feeRowHtml(fees)
      + '<div class="p-hint">You’ll confirm the exact recipient &amp; amount <b>on your Ledger</b> before it signs.</div>'
      + '<div id="hStatus" class="p-err"></div>'
      + '<button class="btn" id="hReview">Review</button></div>';
    document.getElementById('bBack').onclick = hwRenderMain;
    wireFeeRow(function (r) { feeRate = r; });
    wireNameResolve('hTo', 'hNameRes'); abAttach(document.getElementById('hTo'), 'btc');
    wireAmtUsd('hAmt', 'hMax', 'hAmtUsd');
    document.getElementById('hReview').onclick = async function () {
      var s = document.getElementById('hStatus'); s.className = 'p-hint'; s.textContent = agg ? 'Scanning your addresses & building…' : 'Selecting UTXOs & building…';
      try {
        var to = document.getElementById('hTo').value.trim();
        if (RE_DOTBTC.test(to)) { var rr = await fetch('api/src101/resolve/' + encodeURIComponent(to)).then(function (x) { return x.json(); }).catch(function () { return null; }); if (!rr || !rr.exists || !rr.address) throw new Error('“' + to + '” is not a registered Bitcoin Stamps name.'); to = rr.address; }
        if (!to) throw new Error('Enter a recipient address.');
        var sendMax = document.getElementById('hMax').checked;
        var amountSats = sendMax ? 0 : Math.round(parseFloat(document.getElementById('hAmt').value) * 1e8);
        if (!sendMax && (!amountSats || amountSats < 0)) throw new Error('Enter a valid amount.');
        var g = await hwGatherUtxos(agg);
        if (!g || !g.utxos.length) throw new Error(agg ? 'No spendable UTXOs across your addresses.' : 'No spendable UTXOs on this address.');
        var built = C.buildHwSend({ utxos: g.utxos, recipient: to, amountSats: amountSats, feeRate: feeRate, sendMax: sendMax, rbf: true, mfp: HW.mfp, accountPath: "84'/0'/" + (HW.account || 0) + "'", sourcePath: g.change.path, sourcePub: g.change.pub, type: hwBt });
        renderHwSendPreview(built, g.from, to, g.utxos);
      } catch (err) { s.className = 'p-err'; s.textContent = err.message === 'insufficient_funds' ? 'Insufficient spendable balance for that + fee.' : (err.message || 'Could not build transaction.'); }
    };
  }
  function renderHwSendPreview(built, from, to, gutxos) {
    var usd = function (sats) { var p = PRICES.bitcoin || 0; return p ? ' · ≈ $' + fmt((sats / 1e8) * p, 2) : ''; };
    app.innerHTML = '<div class="p-head"><button class="p-ibtn" id="bBack" title="Back">←</button><div class="p-brand-mid"><div class="p-name">Review · Ledger</div></div><div class="p-icons"></div></div>'
      + '<div class="p-card" style="display:flex;flex-direction:column;gap:7px">'
      + '<div class="sd-row"><span class="sd-k">Send</span><span class="sd-v">' + fmt(built.amountSats / 1e8, 8) + ' BTC' + usd(built.amountSats) + '</span></div>'
      + '<div class="sd-row"><span class="sd-k">To</span><span class="sd-v" style="font-family:var(--mono);font-size:11px">' + esc(short(to)) + '</span></div>'
      + '<div class="sd-row"><span class="sd-k">Network fee</span><span class="sd-v">' + fmt(built.fee, 0) + ' sats' + usd(built.fee) + '</span></div>'
      + '<div class="sd-row"><span class="sd-k">From</span><span class="sd-v" style="font-family:var(--mono);font-size:11px">' + esc(short(from)) + '</span></div></div>'
      + '<div class="p-warn" style="margin-top:8px">Approve on your <b>Ledger</b> — the device shows the recipient &amp; amount. Verify them there before confirming.</div>'
      + '<div id="hcStatus" class="p-err"></div>'
      + '<div class="actions"><button class="btn ghost" id="hcBack">Back</button><button class="btn" id="hcGo">Sign on Ledger</button></div>';
    document.getElementById('bBack').onclick = renderHwSend;
    document.getElementById('hcBack').onclick = renderHwSend;
    document.getElementById('hcGo').onclick = function () { hwSignBroadcast(built, to, gutxos); };
  }
  async function hwSignBroadcast(built, to, gutxos) {
    var s = document.getElementById('hcStatus'); s.className = 'p-hint'; s.textContent = 'Verifying transaction…';
    var step = 'verify', nIn = 0;
    try {
      // SECURITY: the tx must pay ONLY the recipient you entered (+ change back to the source). Verify before signing.
      var outs = C.decodeTxOutputs(built.psbt, NET()) || []; // WW-B18: active-network encode
      if (!outs.some(function (o) { return o.address === to; })) throw new Error('Safety check failed — the transaction does not pay the address you entered. Aborted.');
      // WW-C09: re-validate the input set against FRESH coin-control immediately before the device signs.
      await hwAssertInputsFresh(built, gutxos);
      try { nIn = (built.inputs && built.inputs.length) || (C.psbtInputs(built.psbt) || []).length; } catch (e) {}
      step = 'load-device';
      var HWm = await hwLoadBundle();
      s.textContent = 'Unlock your Ledger with the Bitcoin app open…';
      step = 'connect';
      await HWm.connect(); // reuse the paired grant — no picker
      s.textContent = 'Confirm on your Ledger — check the recipient & amount on the device…';
      step = 'sign';
      // The device signs AND finalizes (Ledger's signPsbtBuffer) → broadcast-ready hex. If it couldn't
      // sign the inputs as its own, signPsbtBuffer throws during finalize — surfaced via the step label.
      var res = await HWm.signPsbt(built.psbt, HW.account || 0);
      var txhex = res && res.txhex;
      if (!txhex) throw new Error('The Ledger did not return a signed transaction — re-pair from the Connect flow, then retry.');
      step = 'broadcast';
      s.textContent = 'Broadcasting…';
      var r = await bcast(txhex);
      if (r.error) throw new Error(r.detail || r.error);
      try { await HWm.disconnect(); } catch (e) {}
      s.className = 'p-hint'; s.innerHTML = '<span style="color:var(--green)">Sent ✓ — ' + esc(String(r.txid || (C.txidOf ? C.txidOf(txhex) : '')).slice(0, 20)) + '…</span>';
      setTimeout(hwRenderMain, 2200);
    } catch (err) {
      try { console.error('[WonderHW] sign/broadcast failed at [' + step + ']:', err); } catch (e) {}
      var m = String(err && err.message || '');
      s.className = 'p-err';
      var friendly = /denied|rejected|0x6985|6985|user.*declin/i.test(m) ? 'Rejected on the Ledger.'
        : /No device selected|not connected|failed to open|open the .* app|INS_NOT_SUPPORTED|6d00|access denied|in use/i.test(m) ? 'Couldn’t reach the Ledger — unlock it with the Bitcoin app open. If nothing prompts, pair again from the Connect flow (a fresh device grant may be needed for signing).'
        : /no signatures|only signed/i.test(m) ? m // our own clear guidance — show as-is
        : ('Failed at ' + step + ': ' + m);
      s.innerHTML = '<div>' + esc(friendly) + '</div>'
        + (/^Failed at/.test(friendly) ? '<div class="fine" style="margin-top:6px;opacity:.7;word-break:break-word">details: ' + esc((m || 'unknown').slice(0, 200)) + '</div>' : '');
    }
  }
  // Hardware-view settings (the gear): the globally-useful prefs + Ledger controls (no seed-only ops).
  function hwSettingsMenu() {
    overlay('<div class="stamp-detail"><div class="st-head"><div class="st-htitle">Settings</div><button class="m-close-x" id="hgX" title="Close" aria-label="Close">✕</button></div>'
      + '<div class="adv-menu">'
      + '<button class="adv-opt" data-hg="theme"><b>Appearance</b><span>Dark or light wallet skin</span></button>'
      + '<button class="adv-opt" data-hg="autolock"><b>Auto-lock timer</b><span>Change or turn off the idle lock</span></button>'
      + '<button class="adv-opt" data-hg="addresses"><b>Ledger addresses</b><span>Every receiving address type</span></button>'
      + '<button class="adv-opt" data-hg="repair"><b>Reconnect / re-pair Ledger</b><span>Refresh the device pairing</span></button>'
      + '</div><button class="btn ghost" id="hgClose">Close</button></div>');
    document.getElementById('hgX').onclick = closeOv; document.getElementById('hgClose').onclick = closeOv;
    document.querySelectorAll('[data-hg]').forEach(function (b) { b.onclick = function () {
      var a = b.dataset.hg;
      if (a === 'theme') advTheme();
      else if (a === 'autolock') advAutoLock();
      else if (a === 'addresses') { closeOv(); hwReceive(); }
      else if (a === 'repair') { closeOv(); if (IS_HW_WIN) hwConnect(); else openHardwareTab(); }
    }; });
  }
  function hwUnpair() {
    overlay('<div class="menu" style="padding:12px;display:flex;flex-direction:column;gap:9px"><div class="p-title" style="font-size:15px">Unpair this Ledger?</div>'
      + '<div class="p-hint">Removes the Ledger from Wonder Wallet on this device. Nothing on-chain changes and no keys are affected — re-pair anytime by connecting again.</div>'
      + '<div class="actions"><button class="btn ghost" id="upCancel">Cancel</button><button class="btn danger" id="upGo">Unpair</button></div></div>');
    document.getElementById('upCancel').onclick = closeOv;
    document.getElementById('upGo').onclick = function () { try { localStorage.removeItem('ww:ledger'); } catch (e) {} HW = null; hwViewAddr = null; hwViewIndex = null; hwAgg = false; acctKind = 'hd'; closeOv(); render(); };
  }

  // ── In-popup setup: Create / Restore (no more opening the full tab) ──
  var _draft = null;
  function setupHead(title, back) {
    var h = '<div class="p-head"><button class="p-ibtn" id="suBack" title="Back">←</button><div class="p-brand-mid"><div class="p-name">' + esc(title) + '</div></div><div class="p-icons"></div></div>';
    setTimeout(function () { var b = document.getElementById('suBack'); if (b) b.onclick = back || render; }, 0);
    return h;
  }
  function createChooseLen() {
    app.innerHTML = setupHead('Create wallet', render)
      + '<div class="p-fill"><div class="p-card" style="display:flex;flex-direction:column;gap:12px">'
      + '<div class="p-hint">Choose your recovery-phrase length. <b>24 words</b> is the strongest; 12 is standard.</div>'
      + '<button class="btn" data-w="24">24 words</button><button class="btn ghost" data-w="12">12 words</button></div></div>';
    app.querySelectorAll('[data-w]').forEach(function (b) { b.onclick = function () { createShowSeed(Number(b.dataset.w)); }; });
  }
  function createShowSeed(words) {
    var m = C.generateMnemonic(words);
    _draft = { mnemonic: m, words: m.split(' ') };
    var grid = _draft.words.map(function (w, i) { return '<span class="seedw"><i>' + (i + 1) + '</i>' + esc(w) + '</span>'; }).join('');
    app.innerHTML = setupHead('Recovery phrase', createChooseLen)
      + '<div class="setup-scroll"><div class="p-card" style="display:flex;flex-direction:column;gap:11px">'
      + '<div class="p-warn">Write these ' + words + ' words down and store them <b>offline</b>. Anyone with this phrase controls the funds — Wonder Wallet can never recover it for you.</div>'
      + '<div class="seed-grid">' + grid + '</div>'
      + '<button class="btn ghost sm" id="suCopy">Copy phrase</button>'
      + '<label class="p-check"><input type="checkbox" id="suSaved"/> I’ve saved my recovery phrase</label>'
      + '<button class="btn" id="suNext" disabled>Continue</button></div></div>';
    document.getElementById('suCopy').onclick = function () { copy(_draft.mnemonic, document.getElementById('suCopy')); };
    document.getElementById('suSaved').onclick = function () { document.getElementById('suNext').disabled = !this.checked; };
    document.getElementById('suNext').onclick = createSetPw;
  }
  function createSetPw() {
    app.innerHTML = setupHead('Set a password', function () { createShowSeed(_draft.words.length); })
      + '<div class="setup-scroll"><div class="p-card" style="display:flex;flex-direction:column;gap:10px">'
      + '<div class="p-hint">This password encrypts your wallet in this browser. You’ll enter it to unlock.</div>'
      + '<input class="p-in" id="suPw1" type="password" placeholder="Password (8+ characters)" autocomplete="new-password"/>'
      + '<input class="p-in" id="suPw2" type="password" placeholder="Confirm password" autocomplete="new-password"/>'
      + '<details class="p-adv"><summary>Advanced — passphrase (25th word)</summary><input class="p-in" id="suPp" type="password" placeholder="Optional BIP-39 passphrase" autocomplete="off"/><div class="p-hint">A hidden second factor. If you forget it, the funds are unrecoverable.</div></details>'
      + '<div class="p-err" id="suErr"></div><button class="btn" id="suGo">Create wallet</button></div></div>';
    var go = async function () {
      var e = document.getElementById('suErr'); e.className = 'p-err'; e.textContent = '';
      var p1 = document.getElementById('suPw1').value, p2 = document.getElementById('suPw2').value, pp = document.getElementById('suPp').value;
      if (p1.length < 8) { e.textContent = 'Use at least 8 characters.'; return; }
      if (p1 !== p2) { e.textContent = 'Passwords do not match.'; return; }
      document.getElementById('suGo').disabled = true; e.className = 'p-hint'; e.textContent = 'Encrypting…';
      try { await C.createVault(_draft.mnemonic, pp, p1); _draft = null; render(); }
      catch (err) { document.getElementById('suGo').disabled = false; e.className = 'p-err'; e.textContent = err.message || 'Could not create wallet.'; }
    };
    document.getElementById('suGo').onclick = go;
    var focus = document.getElementById('suPw1'); if (focus) focus.focus();
  }
  function restoreForm() {
    app.innerHTML = setupHead('Restore from seed', render)
      + '<div class="setup-scroll"><div class="p-card" style="display:flex;flex-direction:column;gap:10px">'
      + '<div class="p-hint">Enter your <b>12 or 24-word</b> BIP-39 recovery phrase — or a <b>12-word Counterwallet / FreeWallet</b> passphrase (we detect it automatically).</div>'
      + '<textarea class="p-in" id="rSeed" rows="3" placeholder="word1 word2 word3 …" spellcheck="false" autocapitalize="off" style="resize:none;font-family:var(--mono);font-size:12px"></textarea>'
      + '<div id="rCw" class="fine"></div>'
      + '<input class="p-in" id="rPw1" type="password" placeholder="New password (8+ characters)" autocomplete="new-password"/>'
      + '<input class="p-in" id="rPw2" type="password" placeholder="Confirm password" autocomplete="new-password"/>'
      + '<details class="p-adv"><summary>Advanced — passphrase (25th word)</summary><input class="p-in" id="rPp" type="password" placeholder="Optional BIP-39 passphrase" autocomplete="off"/></details>'
      + '<div class="p-err" id="rErr"></div><button class="btn" id="rGo">Restore wallet</button></div></div>';
    var seedEl = document.getElementById('rSeed'), cwNote = document.getElementById('rCw');
    seedEl.oninput = function () {
      var m = seedEl.value.trim().toLowerCase().replace(/\s+/g, ' ');
      if (m && !C.validateMnemonic(m) && C.isCwPhrase(m)) cwNote.innerHTML = '<span style="color:var(--gold2)">↩ Counterwallet / FreeWallet passphrase detected — restores your legacy 1… assets, plus fresh multi-chain accounts from the same seed.</span>';
      else cwNote.textContent = '';
    };
    var go = async function () {
      var e = document.getElementById('rErr'); e.className = 'p-err'; e.textContent = '';
      var m = seedEl.value.trim().toLowerCase().replace(/\s+/g, ' ');
      var isCw = !C.validateMnemonic(m) && C.isCwPhrase(m);
      if (!C.validateMnemonic(m) && !isCw) { e.textContent = 'That phrase is not a valid BIP-39 mnemonic or Counterwallet passphrase (check spelling & order).'; return; }
      var p1 = document.getElementById('rPw1').value, p2 = document.getElementById('rPw2').value;
      if (p1.length < 8) { e.textContent = 'Use a password of at least 8 characters.'; return; }
      if (p1 !== p2) { e.textContent = 'Passwords do not match.'; return; }
      document.getElementById('rGo').disabled = true; e.className = 'p-hint'; e.textContent = 'Encrypting…';
      try { await C.createVault(m, document.getElementById('rPp').value, p1); if (isCw) setAcctBtcType(0, 'legacy'); render(); } // CW assets live on legacy → default there
      catch (err) { document.getElementById('rGo').disabled = false; e.className = 'p-err'; e.textContent = err.message || 'Could not restore wallet.'; }
    };
    document.getElementById('rGo').onclick = go;
  }

  function renderLocked() {
    app.innerHTML = header()
      + '<div class="p-fill"><div class="p-card" style="display:flex;flex-direction:column;gap:10px"><div class="p-title">Unlock</div>'
      + '<input class="p-in" id="pw" type="password" placeholder="Password" autocomplete="current-password" /><div class="p-err" id="err"></div>'
      + '<button class="btn" id="bUnlock">Unlock</button></div></div>';
    var pw = document.getElementById('pw'); pw.focus();
    var go = async function () { var err = document.getElementById('err'); err.textContent = ''; try { await C.unlock(pw.value); render(); } catch (e) { err.textContent = /wrong_password/.test(e.message) ? 'Wrong password.' : (e.message || 'Unlock failed.'); } };
    document.getElementById('bUnlock').onclick = go; pw.onkeydown = function (e) { if (e.key === 'Enter') go(); };
  }

  // ── MAIN: per-chain asset browser ──
  function renderMain() {
    if (acctKind === 'watch') { var w = watchList().filter(function (x) { return x.id === watchId; })[0]; if (w) chain = CHAIN_OF[w.chain] || chain; else acctKind = 'hd'; }
    var addr = currentAddress(), c = CH[chain];
    app.innerHTML =
      '<div class="p-head"><button class="chain-btn" id="chainBtn" title="Switch blockchain"><span class="cs-ic ' + chain + '">' + c.ic + '</span><span class="chev">▾</span></button>'
      + '<div class="p-brand-mid"><div class="p-name">Wonder Wallet</div><div class="p-sub">' + esc(c.name) + '</div></div>'
      + '<div class="p-icons"><button class="p-ibtn" id="bRefresh" title="Refresh assets"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 10-2.3 5.7M20 4v5h-5"/></svg></button>'
      + (IN_PANEL ? '' : '<button class="p-ibtn" id="bPanel" title="Dock as side panel">' + PANEL_ICON + '</button>')
      + (acctKind !== 'watch' ? '<button class="p-ibtn" id="bAdv" title="Advanced — all addresses, sign message, hardware, custom derivation, reveal seed, export keys">' + GEAR_SVG + '</button>' : '')
      + '<button class="p-ibtn" id="bLock" title="Lock">' + LOCK_SVG + '</button></div></div>'
      + '<div class="acct-bar">' + accountBarBtn() + '</div>'
      + '<div class="total"><div class="amt-wrap"><div class="amt" id="nativeVal">…</div><button class="priv-eye' + (PRIVACY ? ' on' : '') + '" id="bPrivacy" title="' + (PRIVACY ? 'Privacy view ON — show balances' : 'Privacy view (hide balances)') + '">' + (PRIVACY ? EYE_OFF_SVG : EYE_SVG) + '</button></div><div class="lbl" id="nativeLbl">' + (acctKind === 'imported' ? 'imported address' : 'estimated value') + '</div></div>'
      + '<div class="addr-row"><div class="addr-chip" data-copy="' + esc(addr || '') + '" title="Copy address">' + esc(short(addr || '—')) + '</div>'
      + (chain === 'btc' && (acctKind === 'hd' || acctKind === 'imported') ? '<button class="btctype-chip" id="btcTypeBtn" title="Bitcoin address type">' + esc(BTC_LABEL[acctKind === 'imported' ? impBtcType(impId) : acctBtcType(curAccount)]) + ' ▾</button>' : '') + '</div>'
      + '<div class="util-row">'
      + (chain === 'btc' ? '<button class="cc-launch" id="bActivity" title="Transaction history + Coin Control — status, metaprotocol actions, boost stuck txs, UTXO management">⧗ Activity</button>' : '')
      + (((chain === 'btc' && canSignBtc()) || acctKind === 'hd') ? '<button class="cc-launch" id="bTools" title="Advanced Tools — Counterparty actions (send, sweep, MPMA, dispenser, dividend, destroy, issuance, fairminter, fairmint) + Emblem Vault bridge">❖ Tools</button>' : '')
      + '</div>'
      + '<div class="asset-tabs"><button class="atab ' + (tab === 'tokens' ? 'on' : '') + '" data-tab="tokens">Tokens</button><button class="atab ' + (tab === 'collectibles' ? 'on' : '') + '" data-tab="collectibles">Collectibles</button></div>'
      + '<div id="assetBody"><div class="empty">Loading ' + esc(c.name) + ' assets…</div></div>'
      + '<div class="ext-footer">'
      + '<div class="actions"><button class="btn" id="bReceive">Receive</button><button class="btn ghost" id="bSend">Send</button></div>'
      + '<div class="foot-strip"><span class="foot-lock" id="lockLine"></span><span class="pill"><span class="pdot"></span>keys never leave this device</span>' + (VER ? '<span class="foot-ver">v' + esc(VER) + '</span>' : '') + '</div>'
      + '</div>';
    document.getElementById('chainBtn').onclick = chainMenu;
    document.getElementById('bLock').onclick = function () { C.lock(); render(); };
    document.getElementById('bRefresh').onclick = function () { var b = document.getElementById('assetBody'); if (b) b.innerHTML = '<div class="empty">Refreshing…</div>'; var nv = document.getElementById('nativeVal'); if (nv) nv.textContent = '…'; loadAssets(currentAddress()); };
    var acctBtn = document.getElementById('acctBtn'); if (acctBtn) acctBtn.onclick = accountPicker;
    var btBtn = document.getElementById('btcTypeBtn'); if (btBtn) btBtn.onclick = btcTypeMenu;
    var pvBtn = document.getElementById('bPrivacy'); if (pvBtn) pvBtn.onclick = togglePrivacy;
    var acBtn = document.getElementById('bActivity'); if (acBtn) acBtn.onclick = function () { renderActivity(currentAddress()); };
    var toolsB = document.getElementById('bTools'); if (toolsB) toolsB.onclick = cpHub;
    var advB = document.getElementById('bAdv'); if (advB) advB.onclick = advancedMenu;
    saveLast(); // remember the current account + chain for next open
    wireAccountSelect();
    app.querySelectorAll('.atab').forEach(function (b) { b.onclick = function () { tab = b.dataset.tab; renderAssetBody(); app.querySelectorAll('.atab').forEach(function (x) { x.classList.toggle('on', x === b); }); }; });
    app.querySelectorAll('[data-copy]').forEach(function (el) { el.onclick = function () { copy(el.getAttribute('data-copy'), el); }; });
    document.getElementById('bReceive').onclick = renderReceive;
    document.getElementById('bSend').onclick = function () {
      if (acctKind === 'watch') { overlay('<div class="p-hint" style="padding:14px">This is a watch-only address — no keys to sign a send. Switch to one of your own accounts.</div>'); return; }
      if (chain === 'btc') renderSend(); else if (chain === 'eth') renderEvmSend(); else renderSolSend();
    };
    startCountdown();
    loadAssets(addr);
  }

  function accountSelectHtml() {
    var names = loadMap('ww:acctnames'), opts = '<optgroup label="My accounts">';
    acctList().forEach(function (i) {
      var lbl = 'Account ' + i + (names[i] ? ' · ' + esc(names[i]) : '');
      if (chain === 'btc' && acctBtcType(i) !== 'nativeSegwit') lbl += ' · ' + BTC_LABEL[acctBtcType(i)];
      opts += '<option value="hd:' + i + '"' + (acctKind === 'hd' && i === curAccount ? ' selected' : '') + '>' + lbl + '</option>';
    });
    opts += '</optgroup>';
    if (IMPORTED.length) { opts += '<optgroup label="Imported">'; IMPORTED.forEach(function (im) { opts += '<option value="imp:' + esc(im.id) + '"' + (acctKind === 'imported' && impId === im.id ? ' selected' : '') + '>' + esc(im.label || short((im.bitcoin.nativeSegwit || {}).address || im.id)) + ' · imported</option>'; }); opts += '</optgroup>'; }
    var wl = watchList();
    if (wl.length) { opts += '<optgroup label="Watching">'; wl.forEach(function (w) { opts += '<option value="watch:' + esc(w.id) + '"' + (acctKind === 'watch' && watchId === w.id ? ' selected' : '') + '>' + esc(w.label || short(w.address)) + ' · ' + esc((CH[CHAIN_OF[w.chain]] || {}).sym || '?') + '</option>'; }); opts += '</optgroup>'; }
    if (HW) { opts += '<optgroup label="Hardware"><option value="hw"' + (acctKind === 'hardware' ? ' selected' : '') + '>🔐 Ledger</option></optgroup>'; }
    return '<select class="acct-sel" id="acctSel">' + opts + '</select>';
  }
  function wireAccountSelect() {
    var sel = document.getElementById('acctSel'); if (!sel) return;
    sel.onchange = function () { var v = sel.value; if (v === 'hw') { acctKind = 'hardware'; chain = 'btc'; } else if (v.indexOf('hd:') === 0) { acctKind = 'hd'; curAccount = parseInt(v.slice(3), 10); } else if (v.indexOf('watch:') === 0) { acctKind = 'watch'; watchId = v.slice(6); } else if (v.indexOf('imp:') === 0) { acctKind = 'imported'; impId = v.slice(4); chain = 'btc'; } render(); };
  }

  // ── Custom account dropdown — replaces the native <select>. Each row has a ⋯ menu: Rename (all
  //    accounts) + Delete (imported · watch-only · added HD accounts 4+). The old external ✕ is gone. ──
  function acctDisplayName(kind, key, obj) {
    if (kind === 'hd') { var nm = loadMap('ww:acctnames'); return 'Account ' + key + (nm[key] ? ' · ' + nm[key] : ''); }
    if (kind === 'imp') { var oi = loadMap('ww:impnames'); return oi[key] || (obj && obj.label) || short(((obj && obj.bitcoin && obj.bitcoin.nativeSegwit) || {}).address || key); }
    if (kind === 'watch') { var ow = loadMap('ww:watchnames'); return ow[key] || (obj && obj.label) || short(obj && obj.address); }
    if (kind === 'hw') return '🔐 Ledger';
    return String(key);
  }
  function currentAcctName() {
    if (acctKind === 'imported') return acctDisplayName('imp', impId, currentImported()) + ' · imported';
    if (acctKind === 'watch') { var w = watchList().filter(function (x) { return x.id === watchId; })[0]; return acctDisplayName('watch', watchId, w); }
    if (acctKind === 'hardware') return '🔐 Ledger';
    return acctDisplayName('hd', curAccount);
  }
  function accountBarBtn() {
    return '<button class="acct-sel" id="acctBtn" title="Switch account" style="flex:1;display:flex;align-items:center;justify-content:space-between;gap:8px;text-align:left;cursor:pointer;overflow:hidden"><span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(currentAcctName()) + '</span><span class="chev">▾</span></button>';
  }
  var KEBAB_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>';
  function acctPickerRow(kind, key, label, sel, hasMenu) {
    return '<div class="acct-item">'
      + '<button class="acct-pick' + (sel ? ' on' : '') + '" data-sw="' + kind + ':' + esc(String(key)) + '">' + (sel ? '<span class="adot"></span>' : '') + esc(label) + '</button>'
      + (hasMenu ? '<button class="acct-kebab" data-menu="' + kind + ':' + esc(String(key)) + '" title="Rename / delete">' + KEBAB_SVG + '</button>' : '')
      + '</div>';
  }
  function accountPicker() {
    var rows = '<div class="acct-grp">My accounts</div>';
    acctList().forEach(function (i) { rows += acctPickerRow('hd', i, acctDisplayName('hd', i), acctKind === 'hd' && i === curAccount, true); });
    if (IMPORTED.length) { rows += '<div class="acct-grp">Imported</div>'; IMPORTED.forEach(function (im) { rows += acctPickerRow('imp', im.id, acctDisplayName('imp', im.id, im) + ' · imported', acctKind === 'imported' && impId === im.id, true); }); }
    var wl = watchList();
    if (wl.length) { rows += '<div class="acct-grp">Watching</div>'; wl.forEach(function (w) { rows += acctPickerRow('watch', w.id, acctDisplayName('watch', w.id, w) + ' · ' + ((CH[CHAIN_OF[w.chain]] || {}).sym || '?'), acctKind === 'watch' && watchId === w.id, true); }); }
    if (HW) { rows += '<div class="acct-grp">Hardware</div>' + acctPickerRow('hw', 'hw', '🔐 Ledger', acctKind === 'hardware', false); }
    overlay('<div class="stamp-detail"><div class="st-head"><div class="st-htitle">Accounts</div><button class="m-close-x" id="apX" title="Close" aria-label="Close">✕</button></div>'
      + '<div class="acct-picker" style="max-height:340px;overflow-y:auto">' + rows + '</div>'
      + '<button class="btn ghost" id="apAdd" style="margin-top:12px">+ Add account · import · watch-only</button></div>');
    document.getElementById('apX').onclick = closeOv;
    document.getElementById('apAdd').onclick = acctMenu;
    document.querySelectorAll('[data-sw]').forEach(function (b) { b.onclick = function () { switchAcct(b.dataset.sw); }; });
    document.querySelectorAll('[data-menu]').forEach(function (b) { b.onclick = function (e) { e.stopPropagation(); acctItemMenu(b.dataset.menu); }; });
  }
  function switchAcct(ref) {
    var p = ref.split(':'), kind = p[0], key = p.slice(1).join(':');
    if (kind === 'hw') { if (HW) { acctKind = 'hardware'; chain = 'btc'; } }
    else if (kind === 'hd') { acctKind = 'hd'; curAccount = parseInt(key, 10) || 0; }
    else if (kind === 'watch') { acctKind = 'watch'; watchId = key; }
    else if (kind === 'imp') { acctKind = 'imported'; impId = key; chain = 'btc'; }
    closeOv(); render();
  }
  function acctItemMenu(ref) {
    var p = ref.split(':'), kind = p[0], key = p.slice(1).join(':');
    var canDelete = (kind === 'imp' || kind === 'watch' || (kind === 'hd' && Number(key) >= DEFAULT_ACCTS));
    overlay('<div class="menu"><div class="menu-hd">' + esc(acctDisplayName(kind === 'imp' ? 'imp' : kind === 'watch' ? 'watch' : 'hd', key, kind === 'imp' ? IMPORTED.filter(function (x) { return x.id === key; })[0] : (kind === 'watch' ? watchList().filter(function (x) { return x.id === key; })[0] : null))) + '</div>'
      + '<button class="menu-opt" data-a="rename"><span>✎ Rename / nickname</span></button>'
      + (canDelete ? '<button class="menu-opt danger" data-a="delete"><span>🗑 Delete</span></button>' : '')
      + '<button class="btn ghost" id="aimClose" style="margin-top:8px">Back</button></div>');
    document.getElementById('aimClose').onclick = accountPicker;
    document.querySelectorAll('[data-a]').forEach(function (b) { b.onclick = function () { if (b.dataset.a === 'rename') acctRename(kind, key); else acctDelete(kind, key); }; });
  }
  function acctRename(kind, key) {
    var obj = kind === 'imp' ? IMPORTED.filter(function (x) { return x.id === key; })[0] : (kind === 'watch' ? watchList().filter(function (x) { return x.id === key; })[0] : null);
    var curNm = kind === 'hd' ? (loadMap('ww:acctnames')[key] || '') : (kind === 'imp' ? (loadMap('ww:impnames')[key] || (obj && obj.label) || '') : (loadMap('ww:watchnames')[key] || (obj && obj.label) || ''));
    overlay('<div class="menu" style="padding:14px;display:flex;flex-direction:column;gap:10px"><div class="p-title" style="font-size:15px">Rename</div>'
      + '<input class="p-in" id="rnIn" maxlength="40" placeholder="Nickname" autocomplete="off" value="' + esc(curNm) + '"/>'
      + '<div class="actions"><button class="btn ghost" id="rnCancel">Back</button><button class="btn" id="rnSave">Save</button></div></div>');
    setTimeout(function () { var el = document.getElementById('rnIn'); if (el) { el.focus(); el.select(); } }, 30);
    document.getElementById('rnCancel').onclick = accountPicker;
    document.getElementById('rnSave').onclick = function () {
      var v = (document.getElementById('rnIn').value || '').trim().slice(0, 40);
      var mk = kind === 'hd' ? 'ww:acctnames' : (kind === 'imp' ? 'ww:impnames' : 'ww:watchnames');
      var m = loadMap(mk); if (v) m[key] = v; else delete m[key]; lsSet(mk, m);
      closeOv(); renderMain();
    };
  }
  function acctDelete(kind, key) {
    if (kind === 'imp') {
      overlay('<div class="menu" style="padding:12px;display:flex;flex-direction:column;gap:9px"><div class="p-title" style="font-size:15px">Remove imported address?</div>'
        + '<div class="p-hint">This forgets the private key from this wallet. <b>Back up the WIF first</b> — it can’t be recovered from your seed.</div>'
        + '<input class="p-in" id="rmPw" type="password" placeholder="Your wallet password" autocomplete="current-password"/><div class="p-err" id="rmErr"></div>'
        + '<div class="actions"><button class="btn ghost" id="rmCancel">Back</button><button class="btn danger" id="rmGo">Remove</button></div></div>');
      document.getElementById('rmCancel').onclick = accountPicker;
      document.getElementById('rmGo').onclick = async function () {
        var err = document.getElementById('rmErr'); err.textContent = '';
        try { await C.removeImportedKey(key, document.getElementById('rmPw').value); var mm = loadMap('ww:impnames'); delete mm[key]; lsSet('ww:impnames', mm); if (impId === key) { impId = null; acctKind = 'hd'; curAccount = 0; } closeOv(); render(); }
        catch (e) { err.textContent = /wrong_password/.test(e.message) ? 'Wrong password.' : (e.message || 'Could not remove.'); }
      };
    } else if (kind === 'watch') {
      var w = watchList().filter(function (x) { return x.id === key; })[0];
      overlay('<div class="menu" style="padding:12px;display:flex;flex-direction:column;gap:9px"><div class="p-title" style="font-size:15px">Remove watch-only address?</div>'
        + '<div class="p-hint">Stop watching <b>' + esc(acctDisplayName('watch', key, w)) + '</b>. Nothing on-chain changes; re-add anytime.</div>'
        + '<div class="actions"><button class="btn ghost" id="rwCancel">Back</button><button class="btn danger" id="rwGo">Remove</button></div></div>');
      document.getElementById('rwCancel').onclick = accountPicker;
      document.getElementById('rwGo').onclick = function () { lsSet('ww:watch', watchList().filter(function (x) { return x.id !== key; })); var mw = loadMap('ww:watchnames'); delete mw[key]; lsSet('ww:watchnames', mw); if (watchId === key) { watchId = null; acctKind = 'hd'; curAccount = 0; } closeOv(); renderMain(); };
    } else if (kind === 'hd') {
      var i = Number(key);
      overlay('<div class="menu" style="padding:12px"><div class="p-title" style="font-size:15px;margin-bottom:6px">Remove ' + esc(acctDisplayName('hd', i)) + '?</div>'
        + '<div class="p-hint" style="margin-bottom:10px">This just hides it — funds are safe and it re-derives from your seed anytime.</div>'
        + '<div class="actions"><button class="btn ghost" id="rmCancel">Back</button><button class="btn danger" id="rmGo">Remove</button></div></div>');
      document.getElementById('rmCancel').onclick = accountPicker;
      document.getElementById('rmGo').onclick = function () { if (removeAcct(i) && acctKind === 'hd' && curAccount === i) { curAccount = 0; } closeOv(); renderMain(); };
    }
  }

  function chainMenu() {
    if (acctKind === 'watch') { overlay('<div class="p-hint" style="padding:4px">This is a watch-only ' + esc(CH[chain].name) + ' address. Switch to one of your accounts to change chains.</div>'); return; }
    overlay('<div class="menu">' + CHORDER.map(function (k) { var c = CH[k]; return '<button class="menu-opt' + (k === chain ? ' on' : '') + '" data-ch="' + k + '"><span class="cs-ic ' + k + '">' + c.ic + '</span> ' + c.name + '</button>'; }).join('') + '</div>');
    document.querySelectorAll('.menu-opt').forEach(function (b) { b.onclick = function () { chain = b.dataset.ch; tab = 'tokens'; closeOv(); renderMain(); }; });
  }

  function acctMenu() {
    overlay('<div class="menu"><button class="menu-opt" id="mAdd">＋ Add account</button><button class="menu-opt" id="mImport">🔑 Import address (private key)</button><button class="menu-opt" id="mCw">↩ Import a Counterwallet / FreeWallet passphrase</button><button class="menu-opt" id="mWatch">👁 Add watch-only address</button></div>');
    document.getElementById('mAdd').onclick = function () { addAccountMenu(); };
    document.getElementById('mImport').onclick = function () { closeOv(); importAddressForm(); };
    document.getElementById('mCw').onclick = function () { closeOv(); cwImportForm(); };
    document.getElementById('mWatch').onclick = function () { closeOv(); addWatch(); };
  }
  // Import a 12-word Counterwallet / FreeWallet passphrase (Electrum-v1, NOT BIP-39): derive its legacy
  // 1… addresses (m/0'/0/i), scan the first 10 for Counterparty / Stamps / SRC-20 activity, and import
  // the active ones as signable keys (encrypted in the vault, password re-auth). Assets sit on legacy.
  function cwImportForm() {
    overlay('<div class="menu" style="padding:13px;display:flex;flex-direction:column;gap:9px">'
      + '<div class="p-title" style="font-size:15px">Import a Counterwallet / FreeWallet passphrase</div>'
      + '<div class="p-hint">Paste your <b>12-word Counterwallet / FreeWallet passphrase</b>. Wonder derives your legacy <b>1…</b> addresses, scans them for Counterparty / Stamps / SRC-20 assets, and imports the active ones — signable like your own accounts. This is <b>not</b> a BIP-39 seed.</div>'
      + '<textarea class="p-in" id="cwPhrase" rows="2" placeholder="twelve words separated by spaces" spellcheck="false" autocomplete="off" style="resize:vertical;font-family:var(--mono);font-size:12px"></textarea>'
      + '<div id="cwPreview" class="fine"></div>'
      + '<input class="p-in" id="cwPw" type="password" placeholder="Your wallet password" autocomplete="current-password"/>'
      + '<div class="p-err" id="cwErr"></div>'
      + '<div class="actions"><button class="btn ghost" id="cwCancel">Cancel</button><button class="btn" id="cwGo" disabled>Scan &amp; import</button></div></div>');
    var ph = document.getElementById('cwPhrase'), pv = document.getElementById('cwPreview'), go = document.getElementById('cwGo');
    ph.oninput = function () {
      var p = ph.value.trim().replace(/\s+/g, ' '); pv.innerHTML = ''; go.disabled = true;
      if (!p) return;
      try {
        if (C.isCwPhrase(p)) { var a0 = C.cwDeriveAddrs(p, 0, 1)[0].address; pv.innerHTML = 'Primary address: <span style="font-family:var(--mono);color:var(--gold2)">' + esc(a0) + '</span>'; go.disabled = false; }
        else { var n = p.split(' ').filter(Boolean).length; pv.innerHTML = '<span style="color:var(--red)">' + (n === 12 ? 'Not a Counterwallet passphrase — unknown words (this is the 1626-word Counterwallet list, not BIP-39).' : n + ' words — a Counterwallet passphrase is 12.') + '</span>'; }
      } catch (e) { pv.innerHTML = '<span style="color:var(--red)">Could not read that passphrase.</span>'; }
    };
    document.getElementById('cwCancel').onclick = closeOv;
    go.onclick = async function () {
      var err = document.getElementById('cwErr'); err.className = 'p-err'; err.textContent = '';
      var p = ph.value.trim().replace(/\s+/g, ' '), pw = document.getElementById('cwPw').value;
      if (!C.isCwPhrase(p)) { err.textContent = 'Enter a valid 12-word Counterwallet passphrase.'; return; }
      if (!pw) { err.textContent = 'Enter your wallet password.'; return; }
      go.disabled = true; err.className = 'p-hint'; err.textContent = 'Deriving & scanning your addresses…';
      try {
        var derived = C.cwDeriveAddrs(p, 0, 10); // legacy 1… addresses at m/0'/0/i
        var active = [];
        for (var i = 0; i < derived.length; i += 4) {
          await Promise.all(derived.slice(i, i + 4).map(async function (d) {
            try {
              var r = await fetch('api/btc/' + d.address + '/assets').then(function (x) { return x.json(); });
              var has = ((r.counterparty || []).length) + ((r.stamps || []).length) + ((r.src20 || []).length);
              if (d.index === 0 || has > 0) active.push(d);
            } catch (e) { if (d.index === 0) active.push(d); }
          }));
        }
        active.sort(function (a, b) { return a.index - b.index; });
        err.textContent = 'Importing ' + active.length + ' address' + (active.length === 1 ? '' : 'es') + '…';
        var res = await C.importKeys(active.map(function (d) { return d.wif; }), pw, active.map(function (d) { return 'Counterparty · 0/' + d.index; }));
        // CP / Stamps assets live on the LEGACY address — default each import to legacy so they show.
        res.forEach(function (r) { setImpBtcType(r.id, 'legacy'); });
        refreshImported();
        impId = res[0].id; acctKind = 'imported'; chain = 'btc'; closeOv(); render();
      } catch (e2) {
        go.disabled = false; err.className = 'p-err';
        err.textContent = /wrong_password/.test(e2.message) ? 'Wrong wallet password.' : (e2.message || 'Import failed.');
      }
    };
  }
  // Import a WIF private key → restores its address; encrypted in the vault (password re-auth).
  function importAddressForm() {
    var addrs = null;
    overlay('<div class="menu" style="padding:13px;display:flex;flex-direction:column;gap:9px">'
      + '<div class="p-title" style="font-size:15px">Import address</div>'
      + '<div class="p-hint">Paste a Bitcoin <b>private key (WIF)</b> to restore that address here. It’s encrypted in your wallet and can <b>sign & send</b> — like your own accounts.</div>'
      + '<input class="p-in" id="impWif" type="password" placeholder="Private key (WIF, starts with K / L / 5)" spellcheck="false" autocomplete="off"/>'
      + '<div id="impPreview" class="fine"></div>'
      + '<input class="p-in" id="impLabel" type="text" maxlength="40" placeholder="Label (optional, e.g. Cold storage)"/>'
      + '<input class="p-in" id="impPw" type="password" placeholder="Your wallet password" autocomplete="current-password"/>'
      + '<div class="p-err" id="impErr"></div>'
      + '<div class="actions"><button class="btn ghost" id="impCancel">Cancel</button><button class="btn" id="impGo">Import</button></div></div>');
    var wifEl = document.getElementById('impWif'), pv = document.getElementById('impPreview');
    wifEl.oninput = function () {
      var w = wifEl.value.trim(); addrs = null; pv.innerHTML = '';
      if (w.length < 50) return;
      try { addrs = C.importedAddresses(w); pv.innerHTML = 'Restores: <span style="font-family:var(--mono);color:var(--gold2)">' + esc(addrs.nativeSegwit.address) + '</span><br><span class="fine">+ legacy / taproot / nested — pick the type after importing.</span>'; }
      catch (e) { pv.innerHTML = '<span style="color:var(--red)">Not a valid mainnet WIF.</span>'; }
    };
    document.getElementById('impCancel').onclick = closeOv;
    document.getElementById('impGo').onclick = async function () {
      var e = document.getElementById('impErr'); e.className = 'p-err'; e.textContent = '';
      var w = wifEl.value.trim(), pw = document.getElementById('impPw').value, label = document.getElementById('impLabel').value.trim();
      if (!w) { e.textContent = 'Paste a private key.'; return; }
      if (!pw) { e.textContent = 'Enter your wallet password.'; return; }
      document.getElementById('impGo').disabled = true; e.className = 'p-hint'; e.textContent = 'Importing…';
      try {
        var res = await C.importKey(w, pw, label);
        impId = res.id; acctKind = 'imported'; chain = 'btc'; closeOv(); render();
      } catch (err) {
        document.getElementById('impGo').disabled = false; e.className = 'p-err';
        e.textContent = /wrong_password/.test(err.message) ? 'Wrong wallet password.' : /wif/i.test(err.message) ? 'Not a valid mainnet private key (WIF).' : (err.message || 'Import failed.');
      }
    };
  }
  // Add a new HD account, choosing its Bitcoin address type up-front (Taproot / Legacy / …).
  function addAccountMenu() {
    overlay('<div class="menu"><div class="menu-hd">New account · Bitcoin address type</div>'
      + BTC_TYPES.map(function (t) { return '<button class="menu-opt" data-t="' + t[0] + '"><b>' + t[1] + '</b> · ' + t[2] + '</button>'; }).join('')
      + '</div>');
    document.querySelectorAll('.menu-opt[data-t]').forEach(function (b) { b.onclick = function () {
      var idx = addAcct();
      setAcctBtcType(idx, b.dataset.t);
      acctKind = 'hd'; curAccount = idx; chain = 'btc'; closeOv(); renderMain();
    }; });
  }
  // Switch the CURRENT account's Bitcoin address type (e.g. reach account 0's Legacy `1…`), with address previews.
  function btcTypeMenu() {
    var addrs, curType, setType, title;
    if (acctKind === 'imported') {
      var im = currentImported(); if (!im) return;
      addrs = im.bitcoin; curType = impBtcType(impId); setType = function (t) { setImpBtcType(impId, t); }; title = 'Bitcoin address type · imported';
    } else {
      var acc; try { acc = C.accounts(curAccount, 0, NET()); } catch (e) { return; }
      addrs = acc.bitcoin; curType = acctBtcType(curAccount); setType = function (t) { setAcctBtcType(curAccount, t); }; title = 'Bitcoin address type · Account ' + curAccount;
    }
    overlay('<div class="menu"><div class="menu-hd">' + title + '</div>'
      + BTC_TYPES.map(function (t) { return '<button class="menu-opt' + (t[0] === curType ? ' on' : '') + '" data-t="' + t[0] + '"><div style="display:flex;flex-direction:column;align-items:flex-start;gap:2px"><b>' + t[1] + '</b><span style="font-size:10px;color:var(--muted);font-family:var(--mono)">' + esc(short((addrs[t[0]] || {}).address || '')) + '</span></div></button>'; }).join('')
      + '</div>');
    document.querySelectorAll('.menu-opt[data-t]').forEach(function (b) { b.onclick = function () { setType(b.dataset.t); closeOv(); renderMain(); }; });
  }
  function addWatch() {
    overlay('<div class="menu" style="padding:12px"><div class="p-title" style="font-size:15px;margin-bottom:8px">Add watch-only</div>'
      + '<input class="p-in" id="waIn" placeholder="bc1… / 0x… / Solana address" spellcheck="false"/><div class="p-err" id="waErr" style="margin:6px 0"></div>'
      + '<button class="btn" id="waAdd">Add</button></div>');
    var inp = document.getElementById('waIn'); inp.focus();
    document.getElementById('waAdd').onclick = async function () {
      var v = inp.value.trim(), err = document.getElementById('waErr'), ch = null;
      try { ch = (await fetch('api/detect/' + encodeURIComponent(v)).then(function (r) { return r.json(); })).chain; } catch (e) {}
      if (!ch) { err.textContent = 'Unrecognized address format.'; return; }
      var wl = watchList(); if (wl.some(function (x) { return x.address === v; })) { err.textContent = 'Already watching this address.'; return; }
      wl.unshift({ id: 'w' + Date.now(), chain: ch, address: v, label: '' }); lsSet('ww:watch', wl);
      acctKind = 'watch'; watchId = wl[0].id; closeOv(); renderMain();
    };
    inp.onkeydown = function (e) { if (e.key === 'Enter') document.getElementById('waAdd').click(); };
  }

  async function loadAssets(addr) {
    var seq = ++loadSeq; ASSETS = null;
    var res = { native: 0, usd: 0, tokens: [], collectibles: [], note: '' };
    if (!addr) { ASSETS = res; return renderAssetBody(); }
    try { if (!PRICES.bitcoin) PRICES = await fetch('api/prices').then(function (r) { return r.json(); }); } catch (e) {}
    try {
      if (chain === 'btc') {
        var d = await fetch('api/btc/' + encodeURIComponent(addr)).then(function (r) { return r.json(); });
        res.native = (d.balanceSats || 0) / 1e8; res.usd = res.native * (PRICES.bitcoin || 0);
        var a = await fetch('api/btc/' + encodeURIComponent(addr) + '/assets').then(function (r) { return r.json(); });
        var stampCpids = {}; (a.stamps || []).forEach(function (s) { if (s.cpid) stampCpids[s.cpid] = 1; });
        // Tokens = SRC-20 + fungible Counterparty tokens (fairmints / named). The numeric cpids
        // that back stamps are excluded — those live in Collectibles (click a stamp for its cpid).
        (a.src20 || []).forEach(function (x) { res.tokens.push({ name: x.tick, amount: x.amount, img: x.img, src20: true, tick: x.tick }); });
        (a.counterparty || []).forEach(function (x) { if (stampCpids[x.asset]) return; res.tokens.push({ name: x.name || x.asset, amount: (x.qtyNormalized != null ? x.qtyNormalized : x.quantity), asset: x.asset, cp: true, divisible: !!x.divisible, owned: !!x.owned, locked: !!x.locked }); });
        // Over-commit safety: subtract in-flight committed spends (WWPending) so token balances + send forms
        // show what's actually available; reconcile prunes settled/dropped (auto-restore). No labels — just the number.
        try { if (window.WWPending) { window.WWPending.reconcile(addr); res.tokens.forEach(function (tk) { var sym = tk.asset || tk.tick; if (!sym) return; var pend = window.WWPending.pending(addr, sym); if (!(pend > 0)) return; tk.amount = Math.max(0, aggNum(tk.amount) - pend).toLocaleString('en-US', { maximumFractionDigits: 8 }); }); } } catch (e5) {}
        res.collectibles = (a.stamps || []).map(function (s) { return { title: '#' + s.stamp, img: 'api/stamp/' + s.stamp + '/content', stamp: s.stamp, cpid: s.cpid, mime: s.mime || null, qty: (s.quantity != null ? Number(s.quantity) : 1) }; });
        // SRC-101 (.btc names) — surface as collectibles + capture the primary name.
        try {
          var nm = await fetch('api/src101/names/' + encodeURIComponent(addr)).then(function (r) { return r.json(); });
          res.primaryName = nm.primary || null;
          (nm.names || []).filter(function (n) { return !n.expired; }).forEach(function (n) {
            res.collectibles.unshift({ kind: 'name', title: n.name, name: n.name, img: n.img ? ('api/img?url=' + encodeURIComponent(n.img)) : null, primary: !!n.primary, deploy: n.deploy });
          });
        } catch (e4) {}
      } else if (chain === 'eth') {
        var e = await fetch('api/eth/' + encodeURIComponent(addr)).then(function (r) { return r.json(); });
        res.native = e.eth || 0; res.usd = res.native * (PRICES.ethereum || 0);
        res.tokens = (e.tokens || []).map(function (t) { return { name: t.symbol, symbol: t.symbol, amount: t.amount, address: t.address, decimals: t.decimals, img: t.logo || null, usd: t.usd, value: t.value, eth: true }; });
        try { var enf = await fetch('api/eth/' + encodeURIComponent(addr) + '/nfts').then(function (r) { return r.json(); }); var earr = enf.items || []; res.collectibles = earr.slice(0, 60).map(function (n) { return { title: n.name || 'NFT', img: n.image ? ('api/img?url=' + encodeURIComponent(n.image)) : null, contract: n.contract, tokenId: n.tokenId, tokenType: n.tokenType }; }); if (!earr.length && enf.enabled === false) res.note = 'Ethereum NFT gallery needs a provider (ALCHEMY_KEY) set by the wallet host.'; } catch (e3) {}
      } else {
        var so = await fetch('api/sol/' + encodeURIComponent(addr)).then(function (r) { return r.json(); });
        res.native = so.sol || 0; res.usd = res.native * (PRICES.solana || 0);
        res.tokens = (so.tokens || []).filter(function (t) { return t.amount > 0; }).slice(0, 100).map(function (t) { return { name: short(t.mint), amount: t.amount }; });
        try { var nf = await fetch('api/sol/' + encodeURIComponent(addr) + '/nfts').then(function (r) { return r.json(); }); var arr = nf.items || nf.nfts || (Array.isArray(nf) ? nf : []); res.collectibles = arr.slice(0, 60).map(function (n) { return { title: n.name || 'NFT', img: n.image ? ('api/img?url=' + encodeURIComponent(n.image)) : null, id: n.id, compressed: n.compressed }; }); if (!arr.length && nf.dasEnabled === false) res.note = 'Solana NFT gallery needs a DAS provider (Helius). Ask the wallet host to set a HELIUS_KEY — then your NFTs & cNFTs appear here.'; } catch (e2) {}
      }
    } catch (e3) {}
    if (seq !== loadSeq) return; // stale
    ASSETS = res;
    paintNative(); // mask-aware (privacy view)
    renderAssetBody();
  }

  function renderAssetBody() {
    var body = document.getElementById('assetBody'); if (!body) return;
    if (!ASSETS) { body.innerHTML = '<div class="empty">Loading…</div>'; return; }
    if (tab === 'tokens') {
      if (!ASSETS.tokens.length) { body.innerHTML = '<div class="empty">No tokens on this ' + esc(CH[chain].name) + ' address.</div>'; return; }
      var favs = loadFavs();
      ASSETS.tokens.sort(function (a, b) { return (favs.has(favKey(b)) ? 1 : 0) - (favs.has(favKey(a)) ? 1 : 0); }); // favorites pinned on top
      var canXfer = chain === 'btc' && (canSignBtc() || (acctKind === 'hardware' && HW && !hwAgg)); // Ledger signs SRC-20 on-device
      var isEth = chain === 'eth';
      // On Ethereum, hide low-value / unpriced tokens (airdrop spam) by default — a footer toggle
      // reveals them. Only applies to ETH (BTC/CP/SOL tokens have no USD price to judge by).
      var spamPref = lsGet('ww:hidespam', true) !== false;
      var hideSpam = isEth && spamPref;
      var hidden = 0;
      var rows = ASSETS.tokens.map(function (t, i) {
        if (hideSpam && t.eth && !(t.value != null && t.value >= 0.01)) { hidden++; return ''; }
        var ic;
        if (t.img) ic = '<img class="tok-ic" loading="lazy" src="api/img?url=' + encodeURIComponent(t.img) + '"/>';
        else if (t.cp && t.asset) ic = '<span class="tok-ic ph" data-cpimg="' + esc(t.asset) + '">' + esc(String(t.name || '?').slice(0, 2)) + '</span>'; // placeholder; art loaded lazily below
        else ic = '<span class="tok-ic ph">' + esc(String(t.name || '?').slice(0, 2)) + '</span>';
        var xfer = (t.src20 && canXfer) ? '<button class="tok-xfer" data-x="' + i + '" title="Transfer ' + esc(t.tick) + '">' + XFER_IC + '</button>'
          : ((t.eth && acctKind === 'hd') ? '<button class="tok-xfer" data-eth="' + i + '" title="Send ' + esc(t.symbol || t.name) + '">' + XFER_IC + '</button>' : '');
        var chev = t.cp ? '<span class="tok-chev">›</span>' : '';
        var usd = (t.value != null && t.value >= 0.005) ? '<small style="display:block;color:var(--faint);font-weight:400;font-size:11px">' + esc(mask('$' + Number(t.value).toLocaleString('en-US', { maximumFractionDigits: 2 }))) + '</small>' : '';
        var amtStr = t.eth ? fmtTokAmt(t.amount) : String(t.amount); // ETH: cap to 2dp; BTC/CP/SOL keep their own formatting
        var badge = t.owned ? ' <span style="font-size:9px;font-weight:600;color:var(--gold2);border:1px solid var(--border);border-radius:999px;padding:1px 6px">issued</span>' : '';
        var favBtn = '<button class="tok-fav' + (favs.has(favKey(t)) ? ' on' : '') + '" data-fav="' + i + '" title="Pin favorite">★</button>';
        return '<div class="tok-row' + (t.cp ? ' tok-cp' : '') + '"' + (t.cp ? ' data-cp="' + i + '"' : '') + '>' + favBtn + ic + '<span class="tok-name">' + esc(t.name) + badge + '</span><span class="tok-amt">' + esc(mask(amtStr)) + usd + '</span>' + xfer + chev + '</div>';
      }).join('');
      var footer = '';
      if (isEth && (hidden > 0 || !spamPref)) {
        footer = '<div class="tok-hidetoggle" style="text-align:center;padding:11px;font-size:12px;color:var(--faint);cursor:pointer;user-select:none">'
          + (hideSpam ? ('+ ' + hidden + ' low-value token' + (hidden === 1 ? '' : 's') + ' hidden · <b style="color:var(--gold2)">show all</b>')
            : '<b style="color:var(--gold2)">↓ hide low-value tokens</b>')
          + '</div>';
      }
      body.innerHTML = '<div class="tok-list">' + rows + '</div>' + footer;
      var ht = body.querySelector('.tok-hidetoggle'); if (ht) ht.onclick = function () { lsSet('ww:hidespam', !spamPref); renderAssetBody(); };
      body.querySelectorAll('.tok-xfer[data-x]').forEach(function (b) { b.onclick = function (e) { e.stopPropagation(); var t = ASSETS.tokens[+b.dataset.x]; if (t) renderSrc20Send(t.tick, t.amount); }; });
      body.querySelectorAll('.tok-xfer[data-eth]').forEach(function (b) { b.onclick = function (e) { e.stopPropagation(); var t = ASSETS.tokens[+b.dataset.eth]; if (t) renderEvmSend(t.address); }; });
      body.querySelectorAll('.tok-fav[data-fav]').forEach(function (b) { b.onclick = function (e) { e.stopPropagation(); var t = ASSETS.tokens[+b.dataset.fav]; if (t) { toggleFav(t); renderAssetBody(); } }; });
      body.querySelectorAll('[data-cp]').forEach(function (b) { b.onclick = function () { var t = ASSETS.tokens[+b.dataset.cp]; if (t) cpTokenDetail(t); }; });
      loadCpTokenIcons(body); // swap placeholders for real artwork where it resolves
    } else {
      if (!ASSETS.collectibles.length) { body.innerHTML = '<div class="empty">' + esc(ASSETS.note || ('No collectibles on this ' + CH[chain].name + ' address.')) + '</div>'; return; }
      var cfavs = loadFavs();
      ASSETS.collectibles.sort(function (a, b) { return (cfavs.has(favKey(b)) ? 1 : 0) - (cfavs.has(favKey(a)) ? 1 : 0); }); // favorites pinned on top
      body.innerHTML = '<div class="nft-grid">' + ASSETS.collectibles.map(function (n, i) {
        var favB = '<button class="nft-fav' + (cfavs.has(favKey(n)) ? ' on' : '') + '" data-fav="' + i + '" title="Pin favorite">★</button>';
        if (n.kind === 'name') {
          var ph = '<span class="nft-ph name-ph">' + esc((n.name || '').replace('.btc', '')) + '<small>.btc</small></span>';
          var star = n.primary ? '<span class="nft-star">★</span>' : '';
          var nmSrc = n.img ? (/^api\//.test(n.img) ? proxied(n.img) : n.img) : null;
          return '<div class="nft-cell nft-name" data-i="' + i + '" title="' + esc(n.title) + '">' + favB + star + (nmSrc ? '<img loading="lazy" src="' + esc(nmSrc) + '"/>' : ph) + '<div class="nft-t"><span class="nft-tnum">' + esc(n.title) + '</span></div></div>';
        }
        var qtyTag = (n.qty != null && n.qty > 1) ? '<span class="nft-tqty" title="You hold ' + esc(String(n.qty)) + '">×' + esc(abbrevQty(n.qty)) + '</span>' : '';
        // Absolute (proxied) src so the image loads directly (a relative api/ src races the shim rewrite).
        var nftSrc = n.img ? (/^api\//.test(n.img) ? proxied(n.img) : n.img) : null;
        // Decide the render path by MIME, not by load failure: only genuine HTML / recursive stamps use
        // the sandboxed iframe (+ HTML badge). Everything else is an <img>; if it fails we show a neutral
        // "couldn't load" state — a slow/errored image is NOT an HTML stamp.
        var isHtmlStamp = n.stamp != null && n.mime && /html|javascript|text\//i.test(n.mime);
        var media, badge = '';
        if (isHtmlStamp) {
          media = '<iframe class="nft-frame" sandbox="allow-scripts" scrolling="no" loading="lazy" src="' + esc(proxied('api/stamp/' + encodeURIComponent(n.stamp) + '/content')) + '"></iframe>';
          badge = '<span class="htmlbadge">HTML</span>';
        } else if (nftSrc) {
          media = '<img loading="lazy"' + (n.stamp != null ? ' data-stamperr="' + esc(String(n.stamp)) + '"' : '') + ' src="' + esc(nftSrc) + '"/>';
        } else { media = '<span class="nft-ph"></span>'; }
        return '<div class="nft-cell" data-i="' + i + '" title="' + esc(n.title) + (n.qty != null ? ' · you hold ' + esc(String(n.qty)) : '') + '">' + favB + media + badge + '<div class="nft-t"><span class="nft-tnum">' + esc(n.title) + '</span>' + qtyTag + '</div></div>';
      }).join('') + '</div>';
      body.querySelectorAll('.nft-fav[data-fav]').forEach(function (b) { b.onclick = function (e) { e.stopPropagation(); var n = ASSETS.collectibles[+b.dataset.fav]; if (n) { toggleFav(n); renderAssetBody(); } }; });
      body.querySelectorAll('.nft-cell').forEach(function (cell) { cell.onclick = function () { var n = ASSETS.collectibles[+cell.dataset.i]; if (!n) return; if (n.kind === 'name') nameDetail(n); else if (n.stamp != null) stampDetail(n); else nftDetail(n); }; });
      // Image stamp failed to load: auto-retry once (covers slow/transient upstream), then fall back to a
      // neutral "couldn't load" placeholder — never mislabel a broken image as an HTML stamp.
      body.querySelectorAll('img[data-stamperr]').forEach(function (img) {
        var tries = 0;
        img.addEventListener('error', function () {
          var sid = img.getAttribute('data-stamperr'); if (!sid) return;
          tries++;
          if (tries === 1) { setTimeout(function () { img.src = proxied('api/stamp/' + encodeURIComponent(sid) + '/content') + '?retry=1'; }, 1400); return; }
          var ph = document.createElement('span'); ph.className = 'nft-err'; ph.title = 'Preview didn’t load — tap to open';
          ph.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 4.3 1.8 19a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg><small>Couldn’t load</small>';
          if (img.parentNode) img.parentNode.replaceChild(ph, img);
        });
      });
    }
  }

  function sdRow(k, v) { return '<div class="sd-row"><span class="sd-k">' + esc(k) + '</span><span class="sd-v">' + esc(v == null ? '—' : v) + '</span></div>'; }
  // SRC-101 .btc name detail (read-only): art / name, resolves-to, owner, expiry.
  function nameDetail(n) {
    overlay('<div class="p-hint" style="padding:18px;text-align:center">Loading ' + esc(n.name) + '…</div>');
    fetch('api/src101/resolve/' + encodeURIComponent(n.name)).then(function (r) { return r.json(); }).then(function (d) {
      var expStr = '—';
      try { if (d.expire) { var y = new Date(d.expire * 1000).getFullYear(); expStr = y > 3000 ? 'long lease' : new Date(d.expire * 1000).toISOString().slice(0, 10); } } catch (e) {}
      var pop = document.querySelector('#pop-ov .pop-pop'); if (!pop) return;
      pop.innerHTML = '<div class="stamp-detail">'
        + (n.img ? '<img class="sd-art" loading="lazy" src="' + esc(n.img) + '"/>' : '<div class="name-hero-sm">' + esc((n.name || '').replace('.btc', '')) + '<small>.btc</small></div>')
        + '<div class="sd-title">' + esc(d.name || n.name) + (n.primary ? ' ★' : '') + '</div>'
        + '<div class="sd-grid">' + sdRow('Owner', short(d.owner || '—')) + sdRow('Expires', expStr) + '</div>'
        + '<div class="sd-mono" data-copy="' + esc(d.address || '') + '" title="Copy address">→ ' + esc(short(d.address || '—')) + '</div>'
        + '<div class="sd-sub">Bitcoin Stamps SRC-101 · permanent on-chain name</div>'
        + '<button class="btn ghost" id="ndClose">Close</button></div>';
      var cp = pop.querySelector('.sd-mono'); if (cp) cp.onclick = function () { copy(cp.getAttribute('data-copy'), cp); };
      var cl = document.getElementById('ndClose'); if (cl) cl.onclick = closeOv;
    }).catch(function () { var pop = document.querySelector('#pop-ov .pop-pop'); if (pop) pop.innerHTML = '<div class="p-err" style="padding:18px">Could not load ' + esc(n.name) + '.</div>'; });
  }
  function stampDetail(n) {
    overlay('<div class="p-hint" style="padding:18px;text-align:center">Loading stamp #' + esc(String(n.stamp)) + '…</div>');
    var cpid = n.cpid;
    // Fetch the stamp (art/mime) AND the Counterparty asset state in parallel. The CP asset endpoint is
    // the AUTHORITATIVE source for lock/supply/divisible/issuer — the stamp endpoint can be flaky or omit
    // them, and defaulting "Locked: no" when the state failed to load is misleading (looked unlocked when
    // it's actually locked). Unknown → shown as "—", never a false "no".
    Promise.all([
      fetch('api/stamp/' + encodeURIComponent(n.stamp)).then(function (r) { return r.json(); }).catch(function () { return {}; }),
      cpid ? fetch('api/cp/asset/' + encodeURIComponent(cpid)).then(function (r) { return r.json(); }).catch(function () { return {}; }) : Promise.resolve({}),
    ]).then(function (arr) {
      var s = (arr[0] && !arr[0].error) ? arr[0] : {};
      var cp = (arr[1] && !arr[1].error) ? arr[1] : {};
      if (cp.locked != null) s.locked = cp.locked;
      if (cp.supply != null) s.supply = cp.supply;
      if (cp.divisible != null) s.divisible = cp.divisible;
      if (cp.owner) s.owner = cp.owner;
      if (!s.creator && cp.issuer) s.creator = cp.issuer;
      if (!s.description && cp.description) s.description = cp.description;
      s.stamp = (s.stamp != null ? s.stamp : n.stamp); s.cpid = s.cpid || cpid;
      s.mime = s.mime || n.mime || null;
      s.held = (n.qty != null ? Number(n.qty) : (s.held != null ? s.held : null)); // held by this address (balance feed)
      renderStampDetail(s);
    }).catch(function () { var pop = document.querySelector('#pop-ov .pop-pop'); if (pop) pop.innerHTML = '<div class="p-err" style="padding:18px">Could not load stamp details.</div>'; });
  }
  function renderStampDetail(s) {
    var pop = document.querySelector('#pop-ov .pop-pop'); if (!pop) return;
    // Tools launchpad — only your own accounts can sign a Counterparty action.
    var tools = (chain === 'btc' && canSignBtc() && s.cpid)
      ? '<div class="sd-tools"><div class="sd-tools-h">Tools</div><div class="sd-tools-row">'
        + '<button class="sd-tool" data-op="send">' + XFER_IC + '<span>Send</span></button>'
        + '<button class="sd-tool" data-op="dispenser">' + DISP_IC + '<span>Dispenser</span></button>'
        + '<button class="sd-tool" data-op="destroy">' + FIRE_IC + '<span>Destroy</span></button>'
        + '<button class="sd-tool" data-op="dividend">' + DIV_IC + '<span>Dividend</span></button>'
        + '<button class="sd-tool" data-op="attach">' + ATTACH_IC + '<span>Attach</span></button>'
        + (acctKind === 'hd' ? '<button class="sd-tool" data-op="vault">' + VAULT_IC + '<span>Vault</span></button>' : '')
        + '</div></div>'
      : '';
    var isHtml = /html/i.test(s.mime || '');
    pop.innerHTML = '<div class="stamp-detail">'
      + (isHtml ? '<iframe class="sd-art sd-frame" id="sdFrame" sandbox="allow-scripts" scrolling="no"></iframe>' : '<img class="sd-art" loading="lazy" src="api/stamp/' + encodeURIComponent(s.stamp) + '/content"/>')
      + '<div class="sd-title"><button class="tok-fav sd-fav' + (isFav({ stamp: s.stamp }) ? ' on' : '') + '" id="stampFav" title="Pin favorite">★</button>Stamp #' + esc(String(s.stamp)) + '</div>'
      + '<div class="sd-grid">' + (s.held != null ? sdRow('You hold', fmt(s.held, 0)) : '') + sdRow('Supply', s.supply != null ? fmt(s.supply, s.divisible ? 8 : 0) : '—') + sdRow('Locked', s.locked === true ? 'yes 🔒' : s.locked === false ? 'no' : '—') + sdRow('Divisible', s.divisible === true ? 'yes' : s.divisible === false ? 'no' : '—') + sdRow('Type', s.mime || '—') + (s.fileSize ? sdRow('Size', fmtBytes(s.fileSize)) : '') + '</div>'
      + '<div class="sd-mono" data-copy="' + esc(s.cpid || '') + '" title="Copy CPID">CPID · ' + esc(s.cpid || '—') + '</div>'
      + '<div class="sd-sub">Creator <span data-copy="' + esc(s.creator || '') + '" title="Copy creator address" style="font-family:var(--mono);cursor:pointer">' + esc(s.creator ? (s.creator.length > 24 ? s.creator.slice(0, 12) + '…' + s.creator.slice(-8) : s.creator) : '—') + '</span></div>'
      + tools
      + '<button class="btn ghost" id="sdClose">Close</button></div>';
    if (isHtml) { var sf = document.getElementById('sdFrame'); if (sf) sf.src = proxied('api/stamp/' + encodeURIComponent(s.stamp) + '/content'); }
    pop.querySelectorAll('[data-copy]').forEach(function (el) { if (el.getAttribute('data-copy')) el.onclick = function () { copy(el.getAttribute('data-copy'), el); }; });
    var cl = document.getElementById('sdClose'); if (cl) cl.onclick = closeOv;
    var sFav = document.getElementById('stampFav'); if (sFav) sFav.onclick = function () { var on = toggleFav({ stamp: s.stamp }); sFav.classList.toggle('on', on); renderAssetBody(); };
    pop.querySelectorAll('.sd-tool').forEach(function (b) { b.onclick = function () {
      if (b.dataset.op === 'vault') {
        if (window.EmblemBridge) { var a; try { a = C.accounts(curAccount, 0, NET()); } catch (e) { return; } closeOv(); window.EmblemBridge.vaultAsset(curAccount, a.ethereum.address, a.bitcoin.nativeSegwit.address, s.cpid, { label: '#' + s.stamp }); }
        else openTerminal('#vault=' + encodeURIComponent(s.cpid || '') + '&s=' + encodeURIComponent(s.stamp));
        return;
      }
      if (b.dataset.op === 'attach') { cpAttachDetach('attach', { asset: (s.name || s.cpid), qty: 1 }); return; }
      stampTool(b.dataset.op, s);
    }; });
  }

  // Lazily fetch + swap in Counterparty token artwork for the list placeholders. One request per CP
  // token (server + browser cached; 404 = no art, keeps the letter placeholder). IntersectionObserver
  // defers offscreen rows. Image().src isn't caught by the shim, so build the absolute proxy URL.
  function loadCpTokenIcons(root) {
    var els = [].slice.call(root.querySelectorAll('[data-cpimg]'));
    if (!els.length) return;
    var load = function (el) {
      var asset = el.getAttribute('data-cpimg'); if (!asset) return;
      el.removeAttribute('data-cpimg');
      var img = document.createElement('img'); img.className = 'tok-ic'; img.alt = '';
      img.onload = function () { if (el.parentNode) el.parentNode.replaceChild(img, el); };
      img.src = proxied('api/cp/assetimg/' + encodeURIComponent(asset));
    };
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) { entries.forEach(function (en) { if (en.isIntersecting) { io.unobserve(en.target); load(en.target); } }); }, { rootMargin: '120px' });
      els.forEach(function (el) { io.observe(el); });
    } else { els.forEach(load); }
  }

  // ── Counterparty token detail — same tools as a stamp (Send · Dispenser · Destroy · Dividend · Vault). ──
  function cpTokenDetail(t) {
    overlay('<div class="p-hint" style="padding:18px;text-align:center">Loading ' + esc(t.name) + '…</div>');
    fetch('api/cp/asset/' + encodeURIComponent(t.asset)).then(function (r) { return r.json(); }).then(function (info) { build(info || {}); }).catch(function () { build({}); });
    function build(info) {
      var divisible = info.divisible != null ? !!info.divisible : !!t.divisible;
      var supplyDisp = info.supply != null ? (divisible ? info.supply / 1e8 : info.supply) : null;
      renderCpTokenDetail({ cpid: t.asset, stamp: null, name: t.name, divisible: divisible, supply: supplyDisp, locked: !!info.locked, owner: info.owner || null, description: info.description || '', held: (t.amount != null ? Number(t.amount) : null) });
    }
  }
  function renderCpTokenDetail(s) {
    var pop = document.querySelector('#pop-ov .pop-pop'); if (!pop) return;
    var divisible = !!s.divisible, held = s.held, info = s;
    var supplyDisp = s.supply;
    // You control this asset (issuer == your current address) and it isn't locked → offer a re-issue
    // shortcut that jumps straight into the Name-issuance form pre-filled with this asset.
    var iOwn = chain === 'btc' && canSignBtc() && s.owner && s.owner === curBtcAddress() && !info.locked;
    var tools = (chain === 'btc' && canSignBtc())
      ? '<div class="sd-tools"><div class="sd-tools-h">Tools</div><div class="sd-tools-row">'
        + (iOwn ? '<button class="sd-tool" data-op="issue">' + PLUS_IC + '<span>Issue</span></button>' : '')
        + '<button class="sd-tool" data-op="send">' + XFER_IC + '<span>Send</span></button>'
        + '<button class="sd-tool" data-op="dispenser">' + DISP_IC + '<span>Dispenser</span></button>'
        + '<button class="sd-tool" data-op="destroy">' + FIRE_IC + '<span>Destroy</span></button>'
        + '<button class="sd-tool" data-op="dividend">' + DIV_IC + '<span>Dividend</span></button>'
        + '<button class="sd-tool" data-op="attach">' + ATTACH_IC + '<span>Attach</span></button>'
        + (acctKind === 'hd' ? '<button class="sd-tool" data-op="vault">' + VAULT_IC + '<span>Vault</span></button>' : '')
        + '</div></div>'
      : '';
    // Try to resolve the asset's artwork server-side (description → JSON metadata → image). If it
    // loads, show it; if not, fall back to showing the raw description/pointer text.
    var tryImg = !!(chain === 'btc' && s.cpid);
    pop.innerHTML = '<div class="stamp-detail">'
      + (tryImg ? '<img class="sd-art" id="cpArt" alt="' + esc(s.name || '') + '" style="display:none"/>' : '')
      + '<div class="sd-title" style="margin-top:4px"><button class="tok-fav sd-fav' + (isFav({ asset: s.cpid }) ? ' on' : '') + '" id="cpFav" title="Pin favorite">★</button>' + esc(s.name || s.cpid) + '</div>'
      + '<div class="sd-grid">' + (held != null ? sdRow('You hold', fmt(held, divisible ? 8 : 0)) : '') + sdRow('Supply', supplyDisp != null ? fmt(supplyDisp, divisible ? 8 : 0) : '—') + sdRow('Divisible', divisible ? 'yes' : 'no') + sdRow('Locked', info.locked ? 'yes 🔒' : 'no') + '</div>'
      + '<div class="sd-mono" data-copy="' + esc(s.cpid) + '" title="Copy asset name">' + esc(s.cpid) + '</div>'
      + (info.description ? '<div class="sd-sub" id="cpDesc"' + (tryImg ? ' style="display:none"' : '') + '>' + esc(String(info.description).slice(0, 160)) + '</div>' : '')
      + tools
      + '<button class="btn ghost" id="sdClose">Close</button></div>';
    if (tryImg) { var im = document.getElementById('cpArt'); if (im) { im.onload = function () { im.style.display = ''; }; im.onerror = function () { try { im.remove(); } catch (e) {} var dd = document.getElementById('cpDesc'); if (dd) dd.style.display = ''; }; im.src = proxied('api/cp/assetimg/' + encodeURIComponent(s.cpid) + '?full=1'); } } // full-res on-chain art for the large view
    var cpEl = pop.querySelector('.sd-mono'); if (cpEl) cpEl.onclick = function () { copy(cpEl.getAttribute('data-copy'), cpEl); };
    var cpFav = document.getElementById('cpFav'); if (cpFav) cpFav.onclick = function () { var on = toggleFav({ asset: s.cpid }); cpFav.classList.toggle('on', on); renderAssetBody(); };
    document.getElementById('sdClose').onclick = closeOv;
    pop.querySelectorAll('.sd-tool').forEach(function (b) { b.onclick = function () {
      if (b.dataset.op === 'vault') {
        if (window.EmblemBridge) { var a; try { a = C.accounts(curAccount, 0, NET()); } catch (e) { return; } closeOv(); window.EmblemBridge.vaultAsset(curAccount, a.ethereum.address, a.bitcoin.nativeSegwit.address, s.cpid, { label: s.name }); }
        else openTerminal('#vault=' + encodeURIComponent(s.cpid || ''));
        return;
      }
      if (b.dataset.op === 'attach') { cpAttachDetach('attach', { asset: (s.name || s.cpid), qty: 1 }); return; }
      if (b.dataset.op === 'issue') { closeOv(); CPH.src = curBtcAddress(); CPH.type = curBtcType(); cpForm('issuance', { asset: s.cpid }); return; }
      stampTool(b.dataset.op, s);
    }; });
  }

  // ETH / SOL NFT detail (read-only): art + name + contract/mint + explorer link.
  function nftDetail(n) {
    var ex = n.contract ? ('https://etherscan.io/nft/' + n.contract + '/' + encodeURIComponent(n.tokenId)) : (n.id ? ('https://solscan.io/token/' + encodeURIComponent(n.id)) : null);
    var idStr = n.contract ? (n.contract + (n.tokenId != null ? ' · #' + n.tokenId : '')) : (n.id || '');
    var canSend = acctKind === 'hd' && (n.contract ? true : !!n.id);
    overlay('<div class="stamp-detail">'
      + (n.img ? '<img class="sd-art" loading="lazy" src="' + esc(n.img) + '" alt="' + esc(n.title || 'NFT') + '"/>' : '')
      + '<div class="sd-title">' + esc(n.title || 'NFT') + '</div>'
      + (idStr ? '<div class="sd-mono" data-copy="' + esc(n.contract || n.id) + '" title="Copy">' + (n.contract ? 'Contract · ' : 'Mint · ') + esc(idStr) + '</div>' : '')
      + (n.compressed ? '<div class="sd-sub">Compressed NFT (cNFT)</div>' : '')
      + '<div class="sd-tools-row">'
      + (canSend ? '<button class="sd-tool" id="nftSend">' + XFER_IC + '<span>Send</span></button>' : '')
      + (ex ? '<a class="sd-tool" href="' + esc(ex) + '" target="_blank" rel="noopener" style="text-decoration:none">' + LINK_IC + '<span>Explorer</span></a>' : '')
      + '</div>'
      + '<button class="btn ghost" id="nftClose">Close</button></div>');
    var pop = document.querySelector('#pop-ov .pop-pop'); var cp = pop && pop.querySelector('[data-copy]'); if (cp) cp.onclick = function () { copy(cp.getAttribute('data-copy'), cp); };
    var sb = document.getElementById('nftSend'); if (sb) sb.onclick = function () { closeOv(); renderNftSend(n); };
    var cl = document.getElementById('nftClose'); if (cl) cl.onclick = closeOv;
  }
  // ── inline NFT send (ERC-721/1155 + regular SPL NFT) ──
  var _p32 = function (a) { return String(a).toLowerCase().replace(/^0x/, '').padStart(64, '0'); };
  var _h32 = function (v) { return BigInt(v).toString(16).padStart(64, '0'); };
  function erc721Data(from, to, tokenId) { return '0x42842e0e' + _p32(from) + _p32(to) + _h32(tokenId); }
  function erc1155Data(from, to, id, amt) { return '0xf242432a' + _p32(from) + _p32(to) + _h32(id) + _h32(amt) + _h32(160) + _h32(0); }
  async function renderNftSend(n) {
    stopCd();
    var acc; try { acc = C.accounts(curAccount, 0, NET()); } catch (e) { return render(); }
    var isEth = !!n.contract;
    app.innerHTML = '<div class="p-head"><button class="p-ibtn" id="bBack" title="Back">←</button><div class="p-brand-mid"><div class="p-name">Send NFT</div><div class="p-sub">' + esc(String(n.title || '').slice(0, 22)) + '</div></div><div class="p-icons"></div></div>'
      + '<div class="send-form">'
      + (n.img ? '<div class="recv-qr" style="margin-bottom:6px"><img src="' + esc(n.img) + '" style="width:96px;height:96px;border-radius:10px;padding:0;box-shadow:none" alt="nft"/></div>' : '')
      + '<div class="p-hint">Transfer this ' + (isEth ? (n.tokenType === 'ERC1155' ? 'ERC-1155' : 'ERC-721') : 'Solana') + ' NFT. Double-check the address — irreversible.</div>'
      + '<input id="nfsTo" class="p-in" placeholder="Recipient ' + (isEth ? '(0x…)' : 'address') + '" spellcheck="false" autocomplete="off"/>'
      + '<div id="nfsStatus" class="p-err"></div>'
      + '<button class="btn" id="nfsReview">Review</button></div>';
    document.getElementById('bBack').onclick = function () { renderMain(); };
    abAttach(document.getElementById('nfsTo'), isEth ? 'eth' : 'sol');
    document.getElementById('nfsReview').onclick = async function () {
      var s = document.getElementById('nfsStatus'); s.className = 'p-hint'; s.textContent = isEth ? 'Preparing & signing…' : 'Building & signing…';
      try {
        var to = document.getElementById('nfsTo').value.trim();
        if (isEth) {
          if (!RE_EVM.test(to)) throw new Error('Enter a valid 0x recipient.');
          var from = acc.ethereum.address;
          var data = n.tokenType === 'ERC1155' ? erc1155Data(from, to, n.tokenId, 1) : erc721Data(from, to, n.tokenId);
          var prep = await fetch('api/eth/prepare', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from: from, to: n.contract, valueWei: '0x0', data: data, network: ethNet() }) }).then(function (r) { return r.json(); });
          if (prep.error) throw new Error(prep.detail || prep.error);
          var signed = C.sendEvm({ account: curAccount, to: n.contract, valueWei: '0x0', data: data, nonce: prep.nonce, chainId: prep.chainId, maxFeePerGas: prep.maxFeePerGas, maxPriorityFeePerGas: prep.maxPriorityFeePerGas, gasLimit: prep.gasLimit });
          var gasEth = Number(BigInt(prep.gasLimit) * BigInt(prep.maxFeePerGas)) / 1e18;
          nftSendConfirm(n, { kind: 'eth', signed: signed, to: to, gasEth: gasEth, nonce: prep.nonce });
        } else {
          if (!RE_SOL.test(to)) throw new Error('Enter a valid Solana address.');
          var bh = await fetch('api/sol/blockhash').then(function (r) { return r.json(); });
          var ssigned;
          if (n.compressed) {
            s.textContent = 'Fetching cNFT proof…';
            var ctx = await fetch('api/sol/cnft/' + encodeURIComponent(n.id)).then(function (r) { return r.json(); });
            if (!ctx || ctx.error || !ctx.tree) throw new Error(ctx && ctx.error === 'no_das' ? 'DAS provider not configured.' : 'Could not load cNFT proof.');
            ssigned = C.sendCnft({ account: curAccount, to: to, ctx: ctx, blockhash: bh.blockhash });
          } else {
            ssigned = C.sendSpl({ account: curAccount, to: to, mint: n.id, amount: 1n, decimals: 0, blockhash: bh.blockhash });
          }
          nftSendConfirm(n, { kind: 'sol', signed: ssigned, to: to });
        }
      } catch (err) { s.className = 'p-err'; s.textContent = /insufficient/i.test(err.message || '') ? 'Insufficient balance for gas/fees.' : (err.message || 'Could not build the transfer.'); }
    };
  }
  function nftSendConfirm(n, x) {
    app.innerHTML = '<div class="p-head"><button class="p-ibtn" id="bBack" title="Back">←</button><div class="p-brand-mid"><div class="p-name">Confirm send</div></div><div class="p-icons"></div></div>'
      + '<div class="p-card" style="display:flex;flex-direction:column;gap:7px">'
      + '<div class="sd-row"><span class="sd-k">Send</span><span class="sd-v">' + esc(String(n.title || 'NFT').slice(0, 26)) + '</span></div>'
      + '<div class="sd-row"><span class="sd-k">To</span><span class="sd-v" style="font-family:var(--mono);font-size:11px">' + esc(short(x.to)) + '</span></div>'
      + (x.kind === 'eth' ? '<div class="sd-row"><span class="sd-k">Max gas</span><span class="sd-v">' + fmt(x.gasEth, 8) + ' ETH</span></div><div class="sd-row"><span class="sd-k">Nonce</span><span class="sd-v">' + x.nonce + '</span></div>' : '')
      + '</div>'
      + '<div id="nfcStatus" class="p-err"></div>'
      + '<div class="actions"><button class="btn ghost" id="nfcBack">Back</button><button class="btn" id="nfcGo">Broadcast</button></div>';
    document.getElementById('bBack').onclick = function () { renderNftSend(n); };
    document.getElementById('nfcBack').onclick = function () { renderNftSend(n); };
    document.getElementById('nfcGo').onclick = async function () {
      var s = document.getElementById('nfcStatus'); s.className = 'p-hint'; s.textContent = 'Broadcasting…';
      try {
        var r, id;
        if (x.kind === 'eth') { r = await fetch('api/eth/broadcast', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ raw: x.signed.raw, network: ethNet() }) }).then(function (z) { return z.json(); }); id = r.txhash; }
        else { r = await fetch('api/sol/broadcast', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ txBase64: x.signed.txBase64 }) }).then(function (z) { return z.json(); }); id = r.signature; }
        if (r.error) throw new Error(r.detail || r.error);
        s.className = 'p-hint'; s.innerHTML = '<span style="color:var(--green)">Sent ✓ — ' + esc(String(id).slice(0, 20)) + '…</span>';
        setTimeout(renderMain, 2000);
      } catch (err) { s.className = 'p-err'; s.textContent = 'Failed: ' + (err.message || 'broadcast error'); }
    };
  }
  function qrDataUrl(text) { try { var q = window.qrcode(0, 'M'); q.addData(String(text)); q.make(); return q.createDataURL(6, 2); } catch (e) { return null; } }
  function renderReceive() {
    stopCd();
    var addr = currentAddress(), c = CH[chain];
    var qr = (addr && window.qrcode) ? qrDataUrl(addr) : null;
    var COPY_IC = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
    app.innerHTML = '<div class="p-head"><button class="p-ibtn" id="bBack" title="Back">←</button><div class="p-brand-mid"><div class="p-name">Receive ' + esc(c.sym) + '</div></div><div class="p-icons"></div></div>'
      + '<div class="p-card"><div class="p-hint" style="margin-bottom:10px">Your ' + esc(c.name) + ' address. Only send ' + esc(c.name) + ' assets here.</div>'
      + (qr ? '<div class="recv-qr"><img src="' + qr + '" alt="' + esc(c.name) + ' address QR" width="180" height="180"/></div>' : '')
      + '<div class="recv-addr" role="button" tabindex="0" title="Tap to copy"><span class="ra-text">' + esc(addr || '—') + '</span><span class="ra-copy" aria-hidden="true">' + COPY_IC + '</span></div></div>';
    document.getElementById('bBack').onclick = renderMain;
    var ra = app.querySelector('.recv-addr');
    if (ra && addr) {
      var rc = ra.querySelector('.ra-copy'), orig = rc.innerHTML;
      var doCopy = function () { try { navigator.clipboard.writeText(addr); } catch (e) {} ra.classList.add('copied'); rc.innerHTML = '✓ Copied'; clearTimeout(ra._t); ra._t = setTimeout(function () { ra.classList.remove('copied'); rc.innerHTML = orig; }, 1300); };
      ra.onclick = doCopy;
      ra.onkeydown = function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); doCopy(); } };
    }
  }

  // ── Collectible (stamp / CP asset) tools: Send · Dispenser · Destroy · Dividend ──
  var CP_TITLE = { send: 'Send asset', dispenser: 'Create dispenser', destroy: 'Destroy / burn', dividend: 'Pay dividend' };
  var RE_BTC_ADDR = /^(bc1[a-z0-9]{8,87}|[13][a-km-zA-HJ-NP-Z1-9]{25,39})$/;
  var STAMP_FEES = null;
  async function stampTool(op, s) {
    var pop = document.querySelector('#pop-ov .pop-pop'); if (!pop) return;
    var fees = STAMP_FEES;
    if (!fees) { try { fees = STAMP_FEES = await fetch('api/btc/fees').then(function (r) { return r.json(); }); } catch (e) { fees = { fastestFee: 10, halfHourFee: 6, hourFee: 3 }; } }
    var stFeeRate = fees.halfHourFee || 6;
    // Held balance surfaced beside every quantity field so the user always sees what's spendable.
    var qd = s.divisible ? 8 : 0;
    var availHint = (s.held != null) ? ' <span class="fine avail">available ' + fmt(s.held, qd) + '</span>'
      : (s.supply != null ? ' <span class="fine">supply ' + fmt(s.supply, qd) + '</span>' : '');
    var maxAttr = (s.held != null && s.held > 0) ? ' max="' + s.held + '"' : '';
    var unit = s.stamp != null ? 'stamp' : 'asset';
    var body;
    if (op === 'send') {
      body = '<input id="stTo" class="p-in" placeholder="Address or name.btc" spellcheck="false" autocomplete="off" autocapitalize="off"/>'
        + '<div id="stNameRes" class="name-resolve" hidden></div>'
        + '<label class="stf"><span>Quantity' + availHint + '</span><input id="stQty" class="p-in" type="number" step="any" min="0"' + maxAttr + ' value="1"/></label>';
    } else if (op === 'dispenser') {
      var stepv = s.divisible ? 'any' : '1';
      body = '<div class="fine">' + (s.divisible ? '<b>Divisible</b> ' + unit + ' — enter fractional amounts (e.g. 0.5).' : '<b>Indivisible</b> ' + unit + ' — whole units only.') + '</div>'
        + '<label class="stf"><span>Give per dispense</span><input id="stGive" class="p-in" type="number" min="0" step="' + stepv + '" value="1"/></label>'
        + '<label class="stf"><span>Total to escrow' + availHint + '</span><input id="stEsc" class="p-in" type="number" min="0" step="' + stepv + '"' + maxAttr + ' value="1"/></label>'
        + '<label class="stf"><span>BTC price per dispense (sats)</span><input id="stRate" class="p-in" type="number" min="1" step="1" placeholder="e.g. 50000"/><div class="fine rate-hint" id="stRateHint"></div></label>'
        + '<div class="fine">Opens an on-chain dispenser — buyers send BTC to auto-receive the ' + unit + '.</div>';
    } else if (op === 'dividend') {
      body = '<div class="fine">Pay a dividend to every holder of <b>' + esc(s.name || s.cpid) + '</b>, proportional to how much they hold. Paid from <b>your</b> balance of the dividend asset.</div>'
        + '<label class="stf"><span>Pay in asset</span><input id="stDivAsset" class="p-in" type="text" spellcheck="false" autocomplete="off" placeholder="e.g. XCP or PEPECASH"/></label>'
        + '<label class="stf"><span>Quantity per unit held</span><input id="stDivQty" class="p-in" type="number" step="any" min="0" placeholder="paid per 1 unit of ' + esc(s.name || 'the asset') + '"/></label>'
        + '<div class="disp-panel" style="display:block"><div class="disp-hit">Consumes a small amount of <b>XCP</b> (Counterparty’s fee for dividends). Make sure you hold enough of the pay-in asset for every holder.</div></div>';
    } else { // destroy
      body = '<div class="disp-panel" style="display:block"><div class="disp-hit">Destroying permanently burns these units — they leave circulation forever. This cannot be undone.</div></div>'
        + '<label class="stf"><span>Quantity to destroy' + availHint + '</span><input id="stQty" class="p-in" type="number" step="any" min="0"' + maxAttr + ' value="1"/></label>'
        + '<label class="stf"><span>Tag <span class="fine">optional</span></span><input id="stTag" class="p-in" type="text" maxlength="34" placeholder="optional note stored on-chain" spellcheck="false" autocomplete="off"/></label>';
    }
    pop.innerHTML = '<div class="stamp-detail">'
      + '<div class="st-head"><button class="p-ibtn" id="stBack" title="Back">←</button><div class="st-htitle">' + CP_TITLE[op] + '</div></div>'
      + '<div class="st-sub">' + (s.stamp != null ? 'Stamp #' + esc(String(s.stamp)) : esc(s.name || s.cpid)) + ' · ' + esc(short(s.cpid)) + '</div>'
      + '<div class="send-form" style="gap:9px">' + body
      + '<label class="stf"><span>Miner fee rate</span></label>' + feeRowHtml(fees)
      + '<div id="stStatus" class="p-err"></div>'
      + '<button class="btn' + (op === 'destroy' ? ' danger' : '') + '" id="stReview">Review</button></div></div>';
    document.getElementById('stBack').onclick = function () { if (s.stamp != null) renderStampDetail(s); else renderCpTokenDetail(s); };
    document.getElementById('stReview').onclick = function () { stampReview(op, s, stFeeRate); };
    wireFeeRow(function (r) { stFeeRate = r; }, pop);
    if (op === 'send') { wireNameResolve('stTo', 'stNameRes'); abAttach(document.getElementById('stTo'), 'btc'); }
    if (op === 'dispenser') {
      var ri = document.getElementById('stRate'), rh = document.getElementById('stRateHint');
      if (ri && rh) ri.addEventListener('input', function () {
        var sats = parseFloat(ri.value);
        if (!(sats > 0)) { rh.innerHTML = ''; return; }
        var btc = sats / 1e8, usd = btc * (PRICES.bitcoin || 0);
        rh.innerHTML = '= <b>' + btc.toLocaleString('en-US', { maximumFractionDigits: 8 }) + ' BTC</b>' + (usd ? ' · ≈ <b>$' + usd.toLocaleString('en-US', { maximumFractionDigits: 2 }) + '</b>' : '') + ' per dispense';
      });
    }
  }
  async function stampReview(op, s, feeRate) {
    var st = document.getElementById('stStatus'); st.className = 'p-hint'; st.textContent = 'Composing via Counterparty…';
    try {
      var from = curBtcAddress(); if (!from) throw new Error('locked');
      var params = {};
      var scaleQ = function (v) { var n = parseFloat(v); return s.divisible ? Math.round(n * 1e8) : Math.round(n); };
      var qdp = s.divisible ? 8 : 0;
      if (op === 'send') {
        var to = await resolveRecipientName(document.getElementById('stTo').value.trim()), q = parseFloat(document.getElementById('stQty').value);
        if (!RE_BTC_ADDR.test(to)) throw new Error('Enter a valid Bitcoin destination address.');
        if (!(q > 0)) throw new Error('Enter a quantity greater than 0.');
        if (s.held != null && q > s.held) throw new Error('You only hold ' + fmt(s.held, qdp) + ' of this asset.');
        params = { destination: to, asset: s.cpid, quantity: scaleQ(q) };
      } else if (op === 'dispenser') {
        var give = parseFloat(document.getElementById('stGive').value), es = parseFloat(document.getElementById('stEsc').value), rate = parseInt(document.getElementById('stRate').value, 10);
        if (!(give > 0)) throw new Error('Give-per-dispense must be greater than 0.');
        if (!(es >= give)) throw new Error('Total to escrow must be ≥ give-per-dispense.');
        if (s.held != null && es > s.held) throw new Error('You only hold ' + fmt(s.held, qdp) + ' — cannot escrow more than that.');
        if (!(rate > 0)) throw new Error('Enter a BTC price per dispense (sats).');
        params = { asset: s.cpid, give_quantity: scaleQ(give), escrow_quantity: scaleQ(es), mainchainrate: rate, status: 0 };
      } else if (op === 'dividend') {
        var da = document.getElementById('stDivAsset').value.trim().toUpperCase();
        var qpu = parseFloat(document.getElementById('stDivQty').value);
        if (!da) throw new Error('Enter the asset to pay holders in.');
        if (!(qpu > 0)) throw new Error('Enter a quantity per unit greater than 0.');
        st.textContent = 'Checking the pay-in asset…';
        var dinfo = await fetch('api/cp/asset/' + encodeURIComponent(da)).then(function (r) { return r.json(); }).catch(function () { return {}; });
        var dDiv = (da === 'XCP' || da === 'BTC') ? true : !!dinfo.divisible;
        st.textContent = 'Composing via Counterparty…';
        params = { asset: s.cpid, dividend_asset: da, quantity_per_unit: (dDiv ? Math.round(qpu * 1e8) : Math.round(qpu)) };
      } else { // destroy
        var qd = parseFloat(document.getElementById('stQty').value);
        if (!(qd > 0)) throw new Error('Enter a quantity greater than 0.');
        if (s.held != null && qd > s.held) throw new Error('You only hold ' + fmt(s.held, qdp) + ' of this asset.');
        params = { asset: s.cpid, quantity: scaleQ(qd) };
        var tagEl = document.getElementById('stTag'), tagV = tagEl ? tagEl.value.trim() : '';
        if (tagV) params.tag = tagV; // optional; empty is fine — the server sends an empty tag= for CP
      }
      if (feeRate) params.sat_per_vbyte = feeRate; // custom miner-fee rate (Counterparty honors sat_per_vbyte)
      var c = await fetch('api/cp/compose/' + op, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: from, params: params }) }).then(function (r) { return r.json(); });
      if (c.error) throw new Error(c.detail || c.error);
      stampConfirm(op, s, c, params.destination || null);
    } catch (err) { st.className = 'p-err'; st.textContent = err.message === 'locked' ? 'Wallet locked.' : (/insufficient/i.test(err.message) ? 'Insufficient funds (asset balance or BTC for fees) on this address.' : (err.message || 'Compose failed.')); }
  }
  function cpRecipientBanner(c, dest) {
    var r = checkCpRecipient(c.psbt, c.data, dest);
    if (!r) return '';
    if (!r.ok) return '<div class="cp-verify bad">⚠ Recipient MISMATCH — ' + esc(dest) + ' is not encoded in this transaction. Do not sign.</div>';
    return '<div class="cp-verify ok">✓ Verified recipient <b>' + esc(dest) + '</b> <span class="sub">(via ' + r.via + ')</span></div>';
  }
  function stampConfirm(op, s, c, dest) {
    var pop = document.querySelector('#pop-ov .pop-pop'); if (!pop) return;
    var sat = function (n) { return n == null ? '—' : Number(n).toLocaleString('en-US') + ' sats'; };
    var vsz = (c.signed_tx_estimated_size && c.signed_tx_estimated_size.vsize) || null;
    // Rich row layout (mirrors the SRC-20 confirm): Asset · To · Miner fee (+ USD).
    pop.innerHTML = '<div class="stamp-detail">'
      + '<div class="st-head"><button class="p-ibtn" id="stBack" title="Back">←</button><div class="st-htitle">Confirm · ' + CP_TITLE[op] + '</div></div>'
      + '<div class="p-card" style="display:flex;flex-direction:column;gap:7px">'
      + '<div class="sd-row"><span class="sd-k">Asset</span><span class="sd-v">' + (s.stamp != null ? 'Stamp #' + esc(String(s.stamp)) : esc(s.name || s.cpid)) + '</span></div>'
      + (dest ? '<div class="sd-row"><span class="sd-k">To</span><span class="sd-v" style="font-family:var(--mono);font-size:11px">' + esc(short(dest)) + '</span></div>' : '')
      + '<div class="sd-row"><span class="sd-k">Miner fee</span><span class="sd-v">' + sat(c.btc_fee) + usdSuffix(c.btc_fee) + (vsz ? ' (' + vsz + ' vB)' : '') + '</span></div>'
      + '</div>'
      + cpRecipientBanner(c, dest)
      + (c.warnings && c.warnings.length ? '<div class="disp-panel" style="display:block"><div class="disp-hit">' + c.warnings.map(esc).join('<br>') + '</div></div>' : '')
      + '<div class="disp-panel" style="display:block"><div class="disp-hit">Signed locally on your device, then broadcast. Counterparty confirms separately.</div></div>'
      + '<div id="stbStatus" class="p-err"></div>'
      + '<div class="actions"><button class="btn ghost" id="stbBack">Back</button><button class="btn' + (op === 'destroy' ? ' danger' : '') + '" id="stbGo">Sign &amp; broadcast</button></div></div>';
    document.getElementById('stBack').onclick = function () { stampTool(op, s); };
    document.getElementById('stbBack').onclick = function () { stampTool(op, s); };
    document.getElementById('stbGo').onclick = async function () {
      var st = document.getElementById('stbStatus'); st.className = 'p-hint'; st.textContent = 'Signing locally & broadcasting…';
      try {
        var stype = curBtcType(), prevTxs = {};
        var srcAddr = curBtcAddress();
        assertOutputs(c.psbt, [srcAddr]); // stamp CP tools only pay change back to source
        assertCpRecipient(c.psbt, c.data, dest); // for a send: the recipient must be baked into the tx / CP data
        await cpAssertInputsFresh(c.psbt, srcAddr); // WW-C02: re-check inputs vs fresh coin-control (no asset-bearing/frozen/unknown)
        if (stype === 'legacy') { st.textContent = 'Fetching previous transactions…'; var uniq = [...new Set(C.psbtInputs(c.psbt).map(function (x) { return x.txid; }))]; var got = await Promise.all(uniq.map(function (t) { return fetch('api/btc/tx/' + t + '/hex').then(function (r2) { return r2.ok ? r2.text() : null; }).then(function (h) { return [t, h && h.trim()]; }).catch(function () { return [t, null]; }); })); got.forEach(function (p) { if (p[1]) prevTxs[p[0]] = p[1]; }); st.textContent = 'Signing locally & broadcasting…'; }
        var signed = C.signCp(c.psbt, c.inputs_values, c.lock_scripts, curAccount, stype, prevTxs, curImportedId());
        var r = await bcast(signed.txhex);
        if (r.error) throw new Error(r.detail || r.error);
        st.className = 'p-hint'; st.innerHTML = txLinkHtml(r.txid);
        setTimeout(function () { closeOv(); renderMain(); }, 1800);
      } catch (err) { st.className = 'p-err'; st.textContent = 'Failed: ' + (err.message || 'sign/broadcast error'); }
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  Advanced Counterparty actions hub — the full metaprotocol suite in the popup.
  //  compose (CP Core v2, server-proxied) › sign locally (same audited engine) › broadcast.
  //  Mirrors the Terminal's cp-actions module, popup-styled. BTC-signing accounts only.
  // ═══════════════════════════════════════════════════════════════════════════
  var CP_ACTIONS = {
    send: { label: 'Send asset', ic: XFER_IC, xcp: false, fields: [
      { k: 'destination', l: 'To address or name.btc', name: true }, { k: 'asset', l: 'Asset', scaleBy: 'asset', combo: true },
      { k: 'quantity', l: 'Quantity', t: 'number', scaleBy: 'asset', bal: true }, { k: 'memo', l: 'Memo (optional)', opt: true } ] },
    sweep: { label: 'Sweep', ic: SWEEP_IC, xcp: true, fields: [
      { k: 'destination', l: 'To address or name.btc', name: true },
      { k: 'flags', l: 'What to move', t: 'select', opts: [['1', 'Balances'], ['2', 'Ownership'], ['3', 'Balances + ownership']] },
      { k: 'memo', l: 'Memo (optional)', opt: true } ] },
    mpma: { label: 'MPMA send', ic: XFER_IC, xcp: false, fields: [
      { k: 'destinations', l: 'To addresses / names.btc (comma-separated)' },
      { k: 'assets', l: 'Assets (comma-separated)' },
      { k: 'quantities', l: 'Quantities (comma-separated, raw)' } ] },
    dispenser: { label: 'Dispenser', ic: DISP_IC, xcp: false, fields: [
      { k: 'asset', l: 'Asset', scaleBy: 'asset', combo: true },
      { k: 'give_quantity', l: 'Give per dispense', t: 'number', scaleBy: 'asset' },
      { k: 'escrow_quantity', l: 'Total to escrow', t: 'number', scaleBy: 'asset', bal: true },
      { k: 'mainchainrate', l: 'BTC price per dispense (sats)', t: 'number', satsRate: true },
      { k: 'status', l: 'Action', t: 'select', opts: [['0', 'Open / refill'], ['10', 'Close']] } ] },
    dispense: { label: 'Trigger dispense', ic: MINT_IC, xcp: false, fields: [
      { k: 'dispenser', l: 'Dispenser address', dispDetect: true },
      { k: 'quantity', l: 'BTC to send (sats)', t: 'number', satsRate: true } ] },
    dividend: { label: 'Dividend', ic: DIV_IC, xcp: true, fields: [
      { k: 'asset', l: 'Pay holders of asset', combo: true },
      { k: 'dividend_asset', l: 'Pay in asset' },
      { k: 'quantity_per_unit', l: 'Quantity per unit (raw)', t: 'number' } ] },
    destroy: { label: 'Destroy / burn', ic: FIRE_IC, xcp: false, danger: true, fields: [
      { k: 'asset', l: 'Asset', scaleBy: 'asset', combo: true }, { k: 'quantity', l: 'Quantity', t: 'number', scaleBy: 'asset', bal: true },
      { k: 'tag', l: 'Tag (optional)', opt: true } ] },
    issuance: { label: 'Name issuance', ic: PLUS_IC, xcp: true, fields: [
      { k: 'asset', l: 'Asset name (4–12, not starting A)', nameCheck: true },
      { k: 'quantity', l: 'Quantity', t: 'number' },
      { k: 'divisible', l: 'Divisible', t: 'check' },
      { k: 'description', l: 'Description', opt: true },
      { k: 'lock', l: 'Lock supply', t: 'check', opt: true } ] },
    fairminter: { label: 'Fairminter (create)', ic: PLUS_IC, xcp: true, fields: [
      { k: 'asset', l: 'New asset name' },
      { k: 'price', l: 'Price per mint (XCP, 0 = free)', t: 'number', scaleXcp: true },
      { k: 'quantity_by_price', l: 'Units per price (raw)', t: 'number' },
      { k: 'max_mint_per_tx', l: 'Max per mint tx (raw)', t: 'number' },
      { k: 'hard_cap', l: 'Hard cap (raw, 0 = none)', t: 'number', opt: true },
      { k: 'divisible', l: 'Divisible', t: 'check' },
      { k: 'description', l: 'Description', opt: true } ] },
    fairmint: { label: 'Fairmint (mint)', ic: MINT_IC, xcp: false, fields: [
      { k: 'asset', l: 'Fairminter asset' },
      { k: 'quantity', l: 'Quantity to mint (raw)', t: 'number' } ] },
    // Bind an asset to a UTXO (attach) / release it back to the address (detach). Custom two-tab flow,
    // not a generic form — detach is UTXO-sourced and needs an attached-UTXO scan.
    attach: { label: 'Attach / Detach', ic: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 007 0l2-2a5 5 0 00-7-7l-1 1"/><path d="M14 11a5 5 0 00-7 0l-2 2a5 5 0 007 7l1-1"/></svg>', custom: true },
    // SRC-20 deploy / mint — reuses the popup's proven src20/create → signStamp → broadcast path (same as transfer).
    src20: { label: 'SRC-20 deploy / mint', ic: MINT_IC, custom: true, src20: true },
  };
  var CP_ORDER = ['send', 'sweep', 'mpma', 'dispenser', 'dispense', 'dividend', 'destroy', 'issuance', 'attach', 'src20']; // fairminter/fairmint folded into the Fairmint hub button
  var CPH = { src: null, type: 'nativeSegwit', fee: null, last: {} };
  var CP_HUB_FEES = null;

  function cpImpAddr() { var im = currentImported(); if (!im) return null; var t = impBtcType(impId); return (im.bitcoin[t] || im.bitcoin.nativeSegwit).address; }
  function cpSources() {
    if (acctKind === 'imported') { var a = cpImpAddr(); return a ? [{ type: impBtcType(impId), address: a, label: BTC_LABEL[impBtcType(impId)] || 'Imported' }] : []; }
    var acc; try { acc = C.accounts(curAccount, 0, NET()); } catch (e) { return []; }
    return ['nativeSegwit', 'legacy', 'taproot', 'nestedSegwit'].map(function (t) { return acc.bitcoin[t] ? { type: t, address: acc.bitcoin[t].address, label: BTC_LABEL[t] || t } : null; }).filter(Boolean);
  }
  // Advanced Tools — the consolidated power-tool window: the Emblem Vault bridge (HD accounts) plus
  // the full Counterparty actions suite (BTC signing accounts). Both used to be their own util-row button.
  // ── Ported Terminal tools (Market + XCP-69 launchpad) run natively in the popup. They compose → verify
  //    → sign via WonderCpFlow, which we point at the popup's current account through window.__activeAccount
  //    (same local C.signCp engine the popup already uses). Ledger / watch can't sign these here yet. ──
  var MARKET_IC = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4v13M4 14l3 3 3-3M17 20V7M20 10l-3-3-3 3"/></svg>';
  function syncActiveAccount() {
    window.__connectedWallet = null; // the extension IS the wallet — never connected to an external one
    window.__activeAccount = (chain === 'btc' && canSignBtc())
      ? { account: curAccount, importedId: curImportedId(), btcType: curBtcType(), btcAddress: curBtcAddress() }
      : null;
  }
  function marketGate() {
    if (chain === 'btc' && canSignBtc()) return true;
    overlay('<div class="menu" style="padding:16px"><div class="p-hint">This needs a Bitcoin signing account. Switch to an HD or imported account (Ledger / watch-only can’t sign these here yet), then reopen.</div><div class="actions"><button class="btn" id="mgX">OK</button></div></div>');
    var x = document.getElementById('mgX'); if (x) x.onclick = closeOv;
    return false;
  }
  function openMarket() { if (!marketGate()) return; syncActiveAccount(); closeOv(); if (window.WonderMarket) window.WonderMarket.open(null, { onBack: cpHub }); }
  function openLaunchpad() { if (!marketGate()) return; syncActiveAccount(); closeOv(); if (window.WonderLaunchpad) window.WonderLaunchpad.open({ onBack: fairmintHub }); }
  function fairmintHub() {
    overlay('<div class="stamp-detail"><div class="st-head"><button class="p-ibtn" id="fmBack" title="Back">←</button><div class="st-htitle">Fairmint</div><button class="m-close-x" id="fmX" title="Close" aria-label="Close">✕</button></div>'
      + '<div class="menu" style="display:flex;flex-direction:column;gap:9px;margin-top:2px">'
      + '<button class="menu-opt" id="fmCreate"><span>⚒ Fairminter (create)<br><span class="fine">Launch a fair-mint pool</span></span></button>'
      + '<button class="menu-opt" id="fmMint"><span>⛏ Fairmint (mint)<br><span class="fine">Mint into an open fairminter</span></span></button>'
      + '<button class="menu-opt" id="fmX69"><span>🚀 XCP-69 launches<br><span class="fine">Browse · mint · create conformant launches</span></span></button>'
      + '</div></div>');
    document.getElementById('fmBack').onclick = cpHub;
    document.getElementById('fmX').onclick = closeOv;
    document.getElementById('fmCreate').onclick = function () { closeOv(); cpForm('fairminter'); };
    document.getElementById('fmMint').onclick = function () { closeOv(); cpForm('fairmint'); };
    document.getElementById('fmX69').onclick = openLaunchpad;
  }
  function cpHub() {
    var canCP = chain === 'btc' && canSignBtc();
    var canEmblem = acctKind === 'hd';
    if (!canCP && !canEmblem) return;
    var srcs = canCP ? cpSources() : [];
    if (canCP && srcs.length && (!CPH.src || !srcs.find(function (s) { return s.address === CPH.src; }))) { var def = srcs.find(function (s) { return s.type === curBtcType(); }) || srcs[0]; CPH.src = def.address; CPH.type = def.type; }
    var emblemBtn = canEmblem
      ? '<button class="tool-emblem" id="thEmblem"><span class="cp-ic">' + VAULT_IC + '</span><span class="tool-emblem-t"><b>Emblem Vault</b><small>Wrap BTC / Counterparty assets into vault NFTs</small></span><span class="tool-chev">›</span></button>'
      : '';
    var cpSection = '';
    if (canCP && srcs.length) {
      var grid = CP_ORDER.map(function (k) { var a = CP_ACTIONS[k]; return '<button class="cp-act' + (a.danger ? ' danger' : '') + '" data-k="' + k + '"><span class="cp-ic">' + a.ic + '</span><span>' + esc(a.label) + '</span></button>'; }).join('');
      // Fairmint hub (create · mint · XCP-69 launchpad) + Market (swap · liquidity · limit · dispense) —
      // the Terminal tools ported in, replacing the old standalone fairminter/fairmint buttons.
      grid += '<button class="cp-act" data-special="fairmint"><span class="cp-ic">' + MINT_IC + '</span><span>Fairmint</span></button>'
            + '<button class="cp-act" data-special="market"><span class="cp-ic">' + MARKET_IC + '</span><span>Market</span></button>';
      // Source is the address you opened Tools from (CPH.src/type set above) — no picker; by the time
      // you're here you've already chosen the account/address this session is paired with.
      cpSection = '<div class="tool-sec-h">Counterparty actions</div>'
        + '<div class="cph-status" id="cphStatus">Checking pending Counterparty txs…</div>'
        + '<div class="cp-grid">' + grid + '</div>';
    }
    overlay('<div class="cphub"><div class="st-head"><div class="st-htitle">Advanced Tools</div><button class="m-close-x" id="cphX" title="Close" aria-label="Close">✕</button></div>'
      + cpSection + emblemBtn + '</div>');
    document.getElementById('cphX').onclick = closeOv;
    var eb = document.getElementById('thEmblem'); if (eb) eb.onclick = function () { closeOv(); openEmblem(); };
    if (canCP && srcs.length) {
      document.querySelectorAll('.cp-act').forEach(function (b) { b.onclick = function () {
        if (b.dataset.special === 'market') return openMarket();
        if (b.dataset.special === 'fairmint') return fairmintHub();
        var a = CP_ACTIONS[b.dataset.k]; if (a && a.src20) { closeOv(); src20CreateChoose(); } else if (a && a.custom) cpAttachDetach('attach'); else cpForm(b.dataset.k);
      }; });
      cphMempool();
    }
  }
  function cphMempool() {
    var st = document.getElementById('cphStatus'); if (!st) return;
    fetch('api/cp/mempool/' + encodeURIComponent(CPH.src)).then(function (r) { return r.json(); }).then(function (m) {
      st.innerHTML = (m.pending && m.pending.length) ? '⏳ ' + m.pending.length + ' pending Counterparty tx(s) — CP confirmation differs from BTC.' : '✓ No pending Counterparty transactions.';
    }).catch(function () { st.textContent = ''; });
  }
  async function cpForm(key, prefill) {
    var a = CP_ACTIONS[key];
    if (!CP_HUB_FEES) { try { CP_HUB_FEES = await fetch('api/btc/fees').then(function (r) { return r.json(); }); } catch (e) { CP_HUB_FEES = { fastestFee: 10, halfHourFee: 6, hourFee: 3 }; } }
    if (CPH.fee == null) CPH.fee = CP_HUB_FEES.halfHourFee || 6;
    if (!PRICES.bitcoin) { try { PRICES = await fetch('api/prices').then(function (r) { return r.json(); }); } catch (e) {} }
    // Pre-fetch this source address's Counterparty holdings when the form has an asset picker or a
    // balance hint — so users pick from what they actually own and see the available quantity.
    var needsHoldings = a.fields.some(function (f) { return f.combo || f.bal; });
    var holdings = [];
    if (needsHoldings) { try { var hr = await fetch('api/cp/holdings/' + encodeURIComponent(CPH.src)).then(function (r) { return r.json(); }); holdings = hr.holdings || []; } catch (e) {} }
    CPH.holdings = holdings;
    var ownedNames = holdings.map(function (h) { return h.name || h.asset; }).filter(Boolean);
    var fieldsHtml = a.fields.map(function (f) {
      if (f.t === 'select') return '<label class="stf"><span>' + f.l + '</span><select id="cpf_' + f.k + '" data-k="' + f.k + '" class="p-in">' + f.opts.map(function (o) { return '<option value="' + o[0] + '">' + o[1] + '</option>'; }).join('') + '</select></label>';
      if (f.t === 'check') return '<label class="stf cbrow"><input type="checkbox" id="cpf_' + f.k + '" data-k="' + f.k + '"/> <span>' + f.l + '</span></label>';
      var nm = f.nameCheck ? ' <span id="cphNm" class="fine"></span>' : '';
      var bal = f.bal ? ' <span class="fine availhint" id="cpbal_' + f.k + '"></span>' : '';
      var rate = f.satsRate ? '<div class="fine rate-hint" id="cphRate_' + f.k + '"></div>' : '';
      var list = f.combo ? ' list="cpdl_' + f.k + '"' : '';
      var datalist = f.combo ? '<datalist id="cpdl_' + f.k + '">' + ownedNames.map(function (n) { return '<option value="' + esc(n) + '"></option>'; }).join('') + '</datalist>' : '';
      var nameBanner = f.name ? '<div class="name-resolve" id="cpnr_' + f.k + '" hidden></div>' : '';
      var dispPanel = f.dispDetect ? '<div class="disp-panel" id="cpdisp" style="display:none"></div>' : '';
      var ph = f.combo ? ' placeholder="type or pick an asset you hold"' : '';
      return '<label class="stf"><span>' + f.l + nm + bal + '</span><input id="cpf_' + f.k + '" data-k="' + f.k + '" class="p-in" type="' + (f.t || 'text') + '"' + (f.t === 'number' ? ' step="any"' : '') + list + ph + ' spellcheck="false" autocomplete="off"/>' + datalist + nameBanner + dispPanel + rate + '</label>';
    }).join('');
    overlay('<div class="stamp-detail"><div class="st-head"><button class="p-ibtn" id="cpfBack" title="Back">←</button><div class="st-htitle">' + esc(a.label) + '</div><button class="m-close-x" id="cpfX" title="Close" aria-label="Close">✕</button></div>'
      + '<div class="cph-from">from ' + esc(short(CPH.src)) + (needsHoldings ? ' · ' + holdings.length + ' asset' + (holdings.length === 1 ? '' : 's') + ' held' : '') + '</div>'
      + '<div class="send-form" style="gap:9px">' + fieldsHtml
      + (a.xcp ? '<div class="fine">This action consumes XCP — the XCP fee is shown on review.</div>' : '')
      + '<label class="stf"><span>Miner fee rate</span></label>' + feeRowHtml(CP_HUB_FEES)
      + '<div id="cpfStatus" class="p-err"></div>'
      + '<button class="btn' + (a.danger ? ' danger' : '') + '" id="cpfReview">Review</button></div></div>');
    document.getElementById('cpfBack').onclick = cpHub;
    var cpfX = document.getElementById('cpfX'); if (cpfX) cpfX.onclick = closeOv;
    document.getElementById('cpfReview').onclick = function () { cpReview(key); };
    var pop = document.querySelector('#pop-ov .pop-pop');
    wireFeeRow(function (r) { CPH.fee = r; }, pop);
    // Live BTC/USD readout under any sats-amount field (dispenser price, trigger amount).
    a.fields.forEach(function (f) { if (!f.satsRate) return; var ri = document.getElementById('cpf_' + f.k), rh = document.getElementById('cphRate_' + f.k); if (!ri || !rh) return; ri.addEventListener('input', function () { var sats = parseFloat(ri.value); if (!(sats > 0)) { rh.innerHTML = ''; return; } var btc = sats / 1e8, usd = btc * (PRICES.bitcoin || 0); rh.innerHTML = '= <b>' + btc.toLocaleString('en-US', { maximumFractionDigits: 8 }) + ' BTC</b>' + (usd ? ' · ≈ <b>$' + usd.toLocaleString('en-US', { maximumFractionDigits: 2 }) + '</b>' : ''); }); });
    // SRC-101 .btc name resolution + verification on destination fields.
    a.fields.forEach(function (f) { if (f.name) wireNameResolve('cpf_' + f.k, 'cpnr_' + f.k); });
    // Asset picker → live available-balance hint on the quantity/escrow field(s).
    if (needsHoldings) {
      var assetField = a.fields.find(function (f) { return f.combo; });
      var balFields = a.fields.filter(function (f) { return f.bal; });
      var updBal = function () {
        var av = assetField ? document.getElementById('cpf_' + assetField.k) : null;
        var val = av ? av.value.trim().toUpperCase() : '';
        var h = holdings.find(function (x) { return (x.name || '').toUpperCase() === val || (x.asset || '').toUpperCase() === val; });
        balFields.forEach(function (bf) { var el = document.getElementById('cpbal_' + bf.k); if (!el) return; if (h) { el.textContent = 'available ' + h.qty; el.setAttribute('data-avail', h.qty); el.setAttribute('data-div', h.divisible ? '1' : '0'); } else { el.textContent = val ? '(you don’t hold this asset)' : ''; el.removeAttribute('data-avail'); } });
      };
      if (assetField) { var af = document.getElementById('cpf_' + assetField.k); if (af) { af.addEventListener('input', updBal); af.addEventListener('change', updBal); } }
      updBal();
    }
    // Trigger-dispense: verify the entered address IS an open dispenser and show what it gives.
    a.fields.forEach(function (f) { if (f.dispDetect) wireHubDispense(f.k); });
    // Name issuance: live availability chip (✓ available / ✗ taken) as the user types the new name,
    // querying the Counterparty registry — same as the web Terminal. (Submit re-checks as a guard.)
    a.fields.forEach(function (f) { if (f.nameCheck) wireNameCheck(f.k, 'cphNm'); });
    // Pre-fill (e.g. the "Issue" shortcut from an owned asset's detail) → sets the name + fires the
    // availability check, which detects ownership → "you own this · re-issue" + locks divisibility.
    if (prefill && prefill.asset) { var pf = document.getElementById('cpf_asset'); if (pf) { pf.value = String(prefill.asset).toUpperCase(); pf.dispatchEvent(new Event('input', { bubbles: true })); } }
  }
  // Debounced Counterparty asset-name availability check → fills a small chip beside the field label.
  function wireNameCheck(fieldKey, chipId) {
    var inp = document.getElementById('cpf_' + fieldKey), chip = document.getElementById(chipId);
    if (!inp || !chip) return;
    var set = function (txt, color) { chip.textContent = txt; chip.style.color = color || ''; };
    var t = null;
    // Re-issuance can't change divisibility, so when the user owns the name we set + lock the checkbox
    // to the asset's real divisibility; a new/other name re-enables free choice.
    var setDiv = function (checked, locked) { var dv = document.getElementById('cpf_divisible'); if (dv) { if (checked != null) dv.checked = !!checked; dv.disabled = !!locked; } };
    inp.addEventListener('input', function () {
      clearTimeout(t);
      var v = inp.value.trim().toUpperCase();
      if (!v) { setDiv(null, false); return set(''); }
      // Counterparty named assets: 4–12 letters A–Z, not starting with A (numeric A-names are auto).
      if (!/^[B-Z][A-Z]{3,11}$/.test(v)) { setDiv(null, false); return set('4–12 letters, not A', 'var(--red)'); }
      set('checking…', '');
      t = setTimeout(async function () {
        try {
          var r = await fetch('api/cp/assetname/' + encodeURIComponent(v)).then(function (x) { return x.json(); });
          if (inp.value.trim().toUpperCase() !== v) return; // stale — user kept typing
          if (r && r.exists) {
            if (r.owner && r.owner === CPH.src) { set('✓ you own this · re-issue', 'var(--green)'); setDiv(r.divisible, true); }
            else { set('✗ taken', 'var(--red)'); setDiv(null, false); }
          } else { set('✓ available', 'var(--green)'); setDiv(null, false); }
        } catch (e) { set(''); }
      }, 350);
    });
  }
  // Detect + verify an open dispenser at the address the user types, and offer one-tap trigger
  // quantities that fill the sats amount (mirrors the Send-Bitcoin dispenser detection).
  function wireHubDispense(addrKey) {
    var inp = document.getElementById('cpf_' + addrKey), qInp = document.getElementById('cpf_quantity'), panel = document.getElementById('cpdisp');
    if (!inp || !panel) return;
    var sats = function (n) { return Number(n).toLocaleString('en-US'); };
    var toUsd = function (sa) { var u = (sa / 1e8) * (PRICES.bitcoin || 0); return u ? ' ≈ $' + u.toLocaleString('en-US', { maximumFractionDigits: 2 }) : ''; };
    var render = function (d) {
      panel.style.display = 'block';
      var maxDisp = Math.max(1, Math.floor(parseFloat(d.remaining) / parseFloat(d.giveQty)) || 1);
      var opts = [1, 2, 4, 6].filter(function (q) { return q <= maxDisp; }); if (!opts.length) opts.push(1);
      panel.innerHTML = '<div class="disp-hit"><span class="disp-check">✓</span> <b>Dispenser verified.</b> Gives <b>' + esc(d.giveQty) + ' ' + esc(d.asset) + '</b> per <b>' + sats(d.satoshirate) + ' sats</b>' + toUsd(d.satoshirate) + ' · <b>' + maxDisp + '</b> dispense' + (maxDisp === 1 ? '' : 's') + ' left</div>'
        + '<div class="disp-qty"><span class="disp-lbl">Trigger:</span>' + opts.map(function (q) { return '<button type="button" class="disp-q" data-q="' + q + '">' + q + '×</button>'; }).join('') + '</div>'
        + '<div class="disp-cost" id="cpDispCost">Pick how many to trigger — it fills the sats amount.</div>';
      panel.querySelectorAll('.disp-q').forEach(function (b) { b.onclick = function () {
        panel.querySelectorAll('.disp-q').forEach(function (x) { x.classList.toggle('on', x === b); });
        var q = Number(b.dataset.q), totalSats = q * d.satoshirate;
        if (qInp) { qInp.value = String(totalSats); qInp.dispatchEvent(new Event('input')); }
        var recv = (parseFloat(d.giveQty) * q).toLocaleString('en-US', { maximumFractionDigits: 8 });
        var dc = document.getElementById('cpDispCost'); if (dc) dc.innerHTML = '<b>' + q + '×</b> → send <b>' + sats(totalSats) + ' sats</b> (' + (totalSats / 1e8).toFixed(8) + ' BTC' + toUsd(totalSats) + ') + fee → receive ~<b>' + esc(recv) + ' ' + esc(d.asset) + '</b>';
      }; });
    };
    var t = null;
    inp.addEventListener('input', function () {
      clearTimeout(t);
      var v = inp.value.trim();
      if (!RE_BTC_ADDR.test(v)) { panel.style.display = 'none'; panel.innerHTML = ''; return; }
      panel.style.display = 'block'; panel.innerHTML = '<div class="disp-hit fine">Checking for an open dispenser…</div>';
      t = setTimeout(async function () {
        try { var r = await fetch('api/cp/dispensers/' + encodeURIComponent(v)).then(function (x) { return x.json(); }); if (inp.value.trim() !== v) return; if (!r.dispensers || !r.dispensers.length) { panel.innerHTML = '<div class="disp-hit bad">✕ No open dispenser found at this address.</div>'; return; } render(r.dispensers[0]); }
        catch (e) { panel.style.display = 'none'; }
      }, 400);
    });
  }
  async function cpReview(key) {
    var a = CP_ACTIONS[key];
    var st = document.getElementById('cpfStatus'); st.className = 'p-hint'; st.textContent = 'Composing via Counterparty…';
    var pop = document.querySelector('#pop-ov .pop-pop');
    try {
      var params = {};
      a.fields.forEach(function (f) {
        var elx = pop.querySelector('[data-k="' + f.k + '"]'); if (!elx) return;
        if (f.t === 'check') { if (elx.checked) params[f.k] = true; return; }
        var v = (elx.value || '').trim(); if (v !== '') params[f.k] = v;
      });
      for (var i = 0; i < a.fields.length; i++) { var f = a.fields[i]; if (!f.opt && f.t !== 'check' && (params[f.k] == null || params[f.k] === '')) throw new Error('Please fill in “' + f.l + '”.'); }
      // Map a typed asset name/longname → its canonical id (handles subassets), then guard the balance
      // against what this source address actually holds before we spend the compose round-trip.
      var comboF = a.fields.find(function (f) { return f.combo; });
      if (comboF && params[comboF.k] && CPH.holdings) { var hh = CPH.holdings.find(function (x) { return (x.name || '').toUpperCase() === String(params[comboF.k]).toUpperCase() || (x.asset || '').toUpperCase() === String(params[comboF.k]).toUpperCase(); }); if (hh) params[comboF.k] = hh.asset; }
      var balF = a.fields.find(function (f) { return f.bal; });
      if (balF && params.asset != null && params[balF.k] != null && CPH.holdings && CPH.holdings.length) { var bh = CPH.holdings.find(function (x) { return (x.asset || '').toUpperCase() === String(params.asset).toUpperCase(); }); if (bh && parseFloat(params[balF.k]) > parseFloat(bh.qty)) throw new Error('You only hold ' + bh.qty + ' ' + (bh.name || params.asset) + ' on this address.'); }
      var resolveNm = async function (nm) { st.textContent = 'Resolving ' + nm + '…'; var rr = await fetch('api/src101/resolve/' + encodeURIComponent(nm)).then(function (x) { return x.json(); }).catch(function () { return null; }); if (!rr || !rr.exists || !rr.address) throw new Error('“' + nm + '” is not a registered .btc name.'); st.textContent = 'Composing via Counterparty…'; return rr.address; };
      if (typeof params.destination === 'string' && RE_DOTBTC.test(params.destination)) params.destination = await resolveNm(params.destination);
      if (typeof params.destinations === 'string' && /\.btc/i.test(params.destinations)) { var out = [], parts = params.destinations.split(',').map(function (x) { return x.trim(); }); for (var j = 0; j < parts.length; j++) out.push(RE_DOTBTC.test(parts[j]) ? await resolveNm(parts[j]) : parts[j]); params.destinations = out.join(','); }
      var nf = a.fields.find(function (f) { return f.nameCheck; });
      if (nf && params[nf.k]) { params[nf.k] = params[nf.k].toUpperCase(); if (!/^[B-Z][A-Z]{3,11}$/.test(params[nf.k])) throw new Error('Named assets are 4–12 letters A–Z, not starting with A.'); st.textContent = 'Checking name availability…'; var chk = await fetch('api/cp/assetname/' + encodeURIComponent(params[nf.k])).then(function (r) { return r.json(); }).catch(function () { return {}; }); if (chk.exists && chk.owner !== CPH.src) throw new Error('“' + params[nf.k] + '” is registered to another address — choose another name.'); st.textContent = 'Composing via Counterparty…'; }
      if (a.fields.some(function (f) { return f.scaleBy === 'asset'; }) && params.asset) {
        var info = {}; try { info = await fetch('api/cp/asset/' + encodeURIComponent(params.asset)).then(function (r) { return r.json(); }); } catch (e) {}
        var div = (params.asset === 'XCP') ? true : !!info.divisible;
        a.fields.forEach(function (f) { if (f.scaleBy === 'asset' && f.k !== 'asset' && params[f.k] != null) params[f.k] = div ? Math.round(parseFloat(params[f.k]) * 1e8) : Math.round(parseFloat(params[f.k])); });
      }
      if (key === 'issuance' && params.divisible && params.quantity) params.quantity = Math.round(parseFloat(params.quantity) * 1e8);
      a.fields.forEach(function (f) { if (f.scaleXcp && params[f.k] != null && params[f.k] !== '') params[f.k] = Math.round(parseFloat(params[f.k]) * 1e8); });
      a.fields.forEach(function (f) { if (f.t === 'number' && params[f.k] != null && !f.scaleBy && !f.scaleXcp) { var n = Number(params[f.k]); if (!isNaN(n)) params[f.k] = Math.round(n); } });
      var xcpFee = null;
      if (a.xcp) { try { xcpFee = (await fetch('api/cp/estimate/' + key, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: CPH.src, params: params }) }).then(function (r) { return r.json(); })).xcpFee; } catch (e) {} }
      if (CPH.fee) params.sat_per_vbyte = CPH.fee;
      CPH.last = params;
      var c = await fetch('api/cp/compose/' + key, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: CPH.src, params: params }) }).then(function (r) { return r.json(); });
      if (c.error) throw new Error(c.detail || c.error);
      cpConfirm(key, c, xcpFee, params.destination || params.dispenser || null);
    } catch (err) { st.className = 'p-err'; st.textContent = /insufficient/i.test(err.message || '') ? 'Insufficient funds (asset balance or BTC for fees) on this address.' : (err.message || 'Compose failed.'); }
  }
  function cpConfirm(key, c, xcpFee, dest) {
    var a = CP_ACTIONS[key];
    var pop = document.querySelector('#pop-ov .pop-pop'); if (!pop) return;
    var sat = function (n) { return n == null ? '—' : Number(n).toLocaleString('en-US') + ' sats'; };
    var xcp = function (n) { return n == null ? null : (n / 1e8).toLocaleString('en-US', { maximumFractionDigits: 8 }) + ' XCP'; };
    var vsz = (c.signed_tx_estimated_size && c.signed_tx_estimated_size.vsize) || null;
    var recip = dest ? checkCpRecipient(c.psbt, c.data, dest) : null;
    pop.innerHTML = '<div class="stamp-detail"><div class="st-head"><button class="p-ibtn" id="cpcBack" title="Back">←</button><div class="st-htitle">Confirm · ' + esc(a.label) + '</div><button class="m-close-x" id="cpcX" title="Close" aria-label="Close">✕</button></div>'
      + '<div class="p-card" style="display:flex;flex-direction:column;gap:7px">'
      + ((key === 'issuance' && CPH.last && CPH.last.asset) ? '<div class="sd-row"><span class="sd-k">Name</span><span class="sd-v" style="font-family:var(--mono)">' + esc(CPH.last.asset) + '</span></div>' : '')
      + ((key === 'issuance' && CPH.last && CPH.last.quantity != null) ? '<div class="sd-row"><span class="sd-k">Quantity</span><span class="sd-v">' + esc((CPH.last.divisible ? CPH.last.quantity / 1e8 : CPH.last.quantity).toLocaleString('en-US', { maximumFractionDigits: 8 })) + (CPH.last.divisible ? ' <span class="sub" style="opacity:.65">divisible</span>' : '') + '</span></div>' : '')
      + '<div class="sd-row"><span class="sd-k">Action</span><span class="sd-v">' + esc(a.label) + '</span></div>'
      + (dest ? '<div class="sd-row"><span class="sd-k">To</span><span class="sd-v" style="font-family:var(--mono);font-size:11px">' + esc(short(dest)) + '</span></div>' : '')
      + (xcpFee != null ? '<div class="sd-row"><span class="sd-k">XCP fee</span><span class="sd-v">' + xcp(xcpFee) + '</span></div>' : '')
      + '<div class="sd-row"><span class="sd-k">Miner fee</span><span class="sd-v">' + sat(c.btc_fee) + usdSuffix(c.btc_fee) + (vsz ? ' (' + vsz + ' vB)' : '') + '</span></div>'
      + '</div>'
      + (recip ? (recip.ok ? '<div class="cp-verify ok">✓ Verified recipient <b>' + esc(short(dest)) + '</b> <span class="sub">(via ' + recip.via + ')</span></div>' : '<div class="cp-verify bad">⚠ Recipient MISMATCH — ' + esc(short(dest)) + ' is not encoded in this transaction. Do not sign.</div>') : '')
      + (c.data ? '<div class="disp-panel" style="display:block"><div class="disp-hit" style="font-family:var(--mono);word-break:break-all">CP: ' + esc(String(c.data).slice(0, 64)) + (String(c.data).length > 64 ? '…' : '') + '</div></div>' : '')
      + (c.warnings && c.warnings.length ? '<div class="disp-panel" style="display:block"><div class="disp-hit">' + c.warnings.map(esc).join('<br>') + '</div></div>' : '')
      + '<div class="disp-panel" style="display:block"><div class="disp-hit">Signed locally on your device, then broadcast. Counterparty confirms separately.</div></div>'
      + '<div id="cpcStatus" class="p-err"></div>'
      + '<div class="actions"><button class="btn ghost" id="cpcBack2">Back</button><button class="btn' + (a.danger ? ' danger' : '') + '" id="cpcGo">Sign &amp; broadcast</button></div></div>';
    document.getElementById('cpcBack').onclick = function () { cpForm(key); };
    var cpcX = document.getElementById('cpcX'); if (cpcX) cpcX.onclick = closeOv;
    document.getElementById('cpcBack2').onclick = function () { cpForm(key); };
    document.getElementById('cpcGo').onclick = async function () {
      var st = document.getElementById('cpcStatus'); st.className = 'p-hint'; st.textContent = 'Signing locally & broadcasting…';
      try {
        var allowed = [CPH.src];
        Object.keys(CPH.last || {}).forEach(function (k) { var v = CPH.last[k]; if (typeof v === 'string' && RE_BTC_ADDR.test(v.trim())) allowed.push(v.trim()); if (k === 'destinations' && typeof v === 'string') v.split(',').forEach(function (p) { p = p.trim(); if (RE_BTC_ADDR.test(p)) allowed.push(p); }); });
        assertOutputs(c.psbt, allowed); // only pay BTC to source or an address we explicitly named
        if (dest) assertCpRecipient(c.psbt, c.data, dest);
        await cpAssertInputsFresh(c.psbt, CPH.src); // WW-C02: re-check inputs vs fresh coin-control (CP hub actions never spend an asset UTXO)
        var prevTxs = {};
        if (CPH.type === 'legacy') { st.textContent = 'Fetching previous transactions…'; var uniq = [...new Set(C.psbtInputs(c.psbt).map(function (x) { return x.txid; }))]; var got = await Promise.all(uniq.map(function (t) { return fetch('api/btc/tx/' + t + '/hex').then(function (r) { return r.ok ? r.text() : null; }).then(function (h) { return [t, h && h.trim()]; }).catch(function () { return [t, null]; }); })); got.forEach(function (p) { if (p[1]) prevTxs[p[0]] = p[1]; }); st.textContent = 'Signing locally & broadcasting…'; }
        var signed = C.signCp(c.psbt, c.inputs_values, c.lock_scripts, curAccount, CPH.type, prevTxs, curImportedId());
        var r = await bcast(signed.txhex);
        if (r.error) throw new Error(r.detail || r.error);
        st.className = 'p-hint'; st.innerHTML = txLinkHtml(r.txid);
        var go = document.getElementById('cpcGo'), bk = document.getElementById('cpcBack2'); if (bk) bk.remove(); if (go) { go.textContent = 'Done'; go.onclick = function () { closeOv(); renderMain(); }; }
      } catch (err) { st.className = 'p-err'; st.textContent = 'Failed: ' + (err.message || 'sign/broadcast error'); }
    };
  }

  // ── Attach / Detach — bind a Counterparty asset to a specific UTXO, or release it back to the
  //    address balance (used by PSBT markets / atomic swaps). Two tabs; compose→sign→broadcast. ──
  function cpAttachDetach(tab, preload) {
    tab = tab || 'attach';
    var srcs = cpSources(); if (!srcs.length) return;
    if (!CPH.src || !srcs.find(function (s) { return s.address === CPH.src; })) { var def = srcs.find(function (s) { return s.type === curBtcType(); }) || srcs[0]; CPH.src = def.address; CPH.type = def.type; }
    overlay('<div class="cphub"><div class="st-head"><button class="p-ibtn" id="adBack" title="Back">←</button><div class="st-htitle">Attach / Detach</div><button class="m-close-x" id="adX" title="Close" aria-label="Close">✕</button></div>'
      + '<div class="p-hint">Bind a Counterparty asset to a specific UTXO (so it travels with that output — PSBT markets / swaps), or release it back to your address balance.</div>'
      + '<div class="cph-from">from ' + esc(short(CPH.src)) + '</div>'
      + '<div class="ac-filters"><button class="acf ' + (tab === 'attach' ? 'on' : '') + '" data-ad="attach">Attach to UTXO</button><button class="acf ' + (tab === 'detach' ? 'on' : '') + '" data-ad="detach">Detach to address</button></div>'
      + '<div id="adBody"><div class="empty">Loading…</div></div></div>');
    document.getElementById('adBack').onclick = cpHub;
    document.getElementById('adX').onclick = closeOv;
    document.querySelectorAll('[data-ad]').forEach(function (b) { b.onclick = function () { cpAttachDetach(b.dataset.ad); }; });
    if (tab === 'detach') adDetachList(); else adAttachForm(preload);
  }
  async function adAttachForm(preload) {
    var body = document.getElementById('adBody'); if (!body) return;
    if (!CP_HUB_FEES) { try { CP_HUB_FEES = await fetch('api/btc/fees').then(function (r) { return r.json(); }); } catch (e) { CP_HUB_FEES = { fastestFee: 10, halfHourFee: 6, hourFee: 3 }; } }
    if (CPH.fee == null) CPH.fee = CP_HUB_FEES.halfHourFee || 6;
    var holdings = []; try { holdings = (await fetch('api/cp/holdings/' + encodeURIComponent(CPH.src)).then(function (r) { return r.json(); })).holdings || []; } catch (e) {}
    CPH.holdings = holdings;
    var opts = holdings.map(function (h) { return '<option value="' + esc(h.name || h.asset) + '"></option>'; }).join('');
    body.innerHTML = '<div class="fine" style="margin:2px 0 8px">Move an asset from this address’s balance onto a dedicated UTXO.</div>'
      + '<label class="stf"><span>Asset <span class="fine availhint" id="adAvail"></span></span><input id="adA" class="p-in" list="addl" type="text" spellcheck="false" autocomplete="off" placeholder="type or pick an asset you hold"/><datalist id="addl">' + opts + '</datalist></label>'
      + '<label class="stf"><span>Quantity</span><input id="adQ" class="p-in" type="number" step="any" min="0"/></label>'
      + '<label class="stf"><span>Miner fee rate</span></label>' + feeRowHtml(CP_HUB_FEES)
      + '<div id="adStatus" class="p-err"></div>'
      + '<button class="btn" id="adReview">Review attach</button>';
    var pop = document.querySelector('#pop-ov .pop-pop');
    wireFeeRow(function (r) { CPH.fee = r; }, pop);
    var inp = document.getElementById('adA'), bal = document.getElementById('adAvail');
    var upd = function () { var v = inp.value.trim().toUpperCase(); var h = holdings.find(function (x) { return (x.name || '').toUpperCase() === v || (x.asset || '').toUpperCase() === v; }); bal.textContent = h ? ('available ' + h.qty) : (v ? '(you don’t hold this asset)' : ''); };
    inp.oninput = upd; inp.onchange = upd;
    // Preloaded from the asset-detail window: fill the asset (+ held quantity) so attach is one edit away.
    if (preload && preload.asset) { inp.value = preload.asset; if (preload.qty != null && preload.qty !== '') { var q = document.getElementById('adQ'); if (q) q.value = preload.qty; } upd(); }
    document.getElementById('adReview').onclick = adAttachReview;
  }
  async function adAttachReview() {
    var st = document.getElementById('adStatus'); st.className = 'p-hint'; st.textContent = 'Composing attach…';
    try {
      var asset = document.getElementById('adA').value.trim(), qty = document.getElementById('adQ').value.trim();
      if (!asset || !qty) throw new Error('Enter an asset and quantity.');
      if (!(parseFloat(qty) > 0)) throw new Error('Enter a quantity greater than 0.');
      var h = (CPH.holdings || []).find(function (x) { return (x.name || '').toUpperCase() === asset.toUpperCase() || (x.asset || '').toUpperCase() === asset.toUpperCase(); });
      if (h) { asset = h.asset; if (parseFloat(qty) > parseFloat(h.qty)) throw new Error('You only hold ' + h.qty + ' on this address.'); }
      var div = h ? !!h.divisible : true;
      if (!h) { try { div = !!(await fetch('api/cp/asset/' + encodeURIComponent(asset)).then(function (r) { return r.json(); })).divisible; } catch (e) {} }
      var params = { asset: asset, quantity: div ? Math.round(parseFloat(qty) * 1e8) : Math.round(parseFloat(qty)) };
      if (CPH.fee) params.sat_per_vbyte = CPH.fee;
      var c = await fetch('api/cp/compose/attach', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: CPH.src, params: params }) }).then(function (r) { return r.json(); });
      if (c.error) throw new Error(c.detail || c.error);
      adConfirm(c, 'Attach', '<div class="sd-row"><span class="sd-k">Attach</span><span class="sd-v">' + esc(qty) + ' ' + esc(asset) + ' → UTXO</span></div>', function () { cpAttachDetach('attach'); });
    } catch (err) { st.className = 'p-err'; st.textContent = /insufficient/i.test(err.message || '') ? 'Insufficient balance (asset, or BTC for the fee).' : (err.message || 'Compose failed.'); }
  }
  async function adDetachList() {
    var body = document.getElementById('adBody'); if (!body) return;
    body.innerHTML = '<div class="empty">Scanning your UTXOs for attached assets…</div>';
    try {
      var att = ((await fetch('api/cp/attached/' + encodeURIComponent(CPH.src)).then(function (r) { return r.json(); })).attached) || [];
      if (!att.length) { body.innerHTML = '<div class="fine" style="padding:6px 2px">No assets are attached to your UTXOs right now. Attach one from the other tab and it’ll show here, ready to release.</div>'; return; }
      if (!CP_HUB_FEES) { try { CP_HUB_FEES = await fetch('api/btc/fees').then(function (r) { return r.json(); }); } catch (e) { CP_HUB_FEES = { fastestFee: 10, halfHourFee: 6, hourFee: 3 }; } }
      if (CPH.fee == null) CPH.fee = CP_HUB_FEES.halfHourFee || 6;
      body.innerHTML = '<div class="fine" style="margin:2px 0 8px">These assets sit on a UTXO. Detaching releases them back to your address balance.</div>'
        + '<label class="stf"><span>Miner fee rate</span></label>' + feeRowHtml(CP_HUB_FEES)
        + '<div id="adDetStatus" class="p-err" style="margin:8px 0"></div>'
        + att.map(function (a) { return '<div class="acct-line"><div class="acct-lab">' + esc(a.asset_longname || a.asset) + ' <b>' + esc(String(a.quantity_normalized)) + '</b><br><span class="fine" style="font-family:var(--mono)">' + esc(String(a.utxo).slice(0, 20)) + '…</span></div><button class="mini" data-detach="' + esc(a.utxo) + '">Detach</button></div>'; }).join('');
      wireFeeRow(function (r) { CPH.fee = r; }, document.querySelector('#pop-ov .pop-pop'));
      body.querySelectorAll('[data-detach]').forEach(function (b) { b.onclick = function () { adDetachReview(b.dataset.detach); }; });
    } catch (e) { body.innerHTML = '<div class="p-err" style="padding:6px 2px">Could not scan for attached assets — try again.</div>'; }
  }
  async function adDetachReview(utxo) {
    var st = document.getElementById('adDetStatus'); if (st) { st.className = 'p-hint'; st.textContent = 'Composing detach…'; }
    try {
      var c = await fetch('api/cp/detach', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ utxo: utxo, destination: CPH.src, sat_per_vbyte: CPH.fee }) }).then(function (r) { return r.json(); });
      if (c.error) throw new Error(c.detail || c.error);
      adConfirm(c, 'Detach', '<div class="sd-row"><span class="sd-k">From UTXO</span><span class="sd-v" style="font-family:var(--mono);font-size:11px">' + esc(String(utxo).slice(0, 18)) + '…</span></div><div class="sd-row"><span class="sd-k">To</span><span class="sd-v">your address balance</span></div>', function () { cpAttachDetach('detach'); }, utxo); // WW-C02: detach legitimately spends this attached asset UTXO
    } catch (err) { if (st) { st.className = 'p-err'; st.textContent = err.message || 'Compose failed.'; } }
  }
  // Shared confirm + local-sign + broadcast for attach/detach. Both only ever pay BTC back to the
  // source address (attach binds to a source UTXO; detach releases to the source), so outputs are
  // asserted against [CPH.src] before signing.
  function adConfirm(c, label, rowsHtml, backFn, allowOutpoint) {
    var pop = document.querySelector('#pop-ov .pop-pop'); if (!pop) return;
    var sat = function (n) { return n == null ? '—' : Number(n).toLocaleString('en-US') + ' sats'; };
    var vsz = (c.signed_tx_estimated_size && c.signed_tx_estimated_size.vsize) || null;
    pop.innerHTML = '<div class="stamp-detail"><div class="st-head"><button class="p-ibtn" id="adcBack" title="Back">←</button><div class="st-htitle">Confirm · ' + esc(label) + '</div></div>'
      + '<div class="p-card" style="display:flex;flex-direction:column;gap:7px">' + rowsHtml
      + '<div class="sd-row"><span class="sd-k">Miner fee</span><span class="sd-v">' + sat(c.btc_fee) + usdSuffix(c.btc_fee) + (vsz ? ' (' + vsz + ' vB)' : '') + '</span></div></div>'
      + (c.data ? '<div class="disp-panel" style="display:block"><div class="disp-hit" style="font-family:var(--mono);word-break:break-all">CP: ' + esc(String(c.data).slice(0, 64)) + (String(c.data).length > 64 ? '…' : '') + '</div></div>' : '')
      + '<div class="disp-panel" style="display:block"><div class="disp-hit">Signed locally on your device, then broadcast. Counterparty confirms separately.</div></div>'
      + '<div id="adcStatus" class="p-err"></div>'
      + '<div class="actions"><button class="btn ghost" id="adcBack2">Back</button><button class="btn" id="adcGo">Sign &amp; broadcast</button></div></div>';
    document.getElementById('adcBack').onclick = backFn; document.getElementById('adcBack2').onclick = backFn;
    document.getElementById('adcGo').onclick = async function () {
      var st = document.getElementById('adcStatus'); st.className = 'p-hint'; st.textContent = 'Signing locally & broadcasting…';
      try {
        assertOutputs(c.psbt, [CPH.src]); // attach/detach only pay BTC back to the source address
        await cpAssertInputsFresh(c.psbt, CPH.src, allowOutpoint); // WW-C02: re-check inputs; a detach intentionally spends its attached asset UTXO (allowOutpoint)
        var prevTxs = {};
        if (CPH.type === 'legacy') { st.textContent = 'Fetching previous transactions…'; var uniq = [...new Set(C.psbtInputs(c.psbt).map(function (x) { return x.txid; }))]; var got = await Promise.all(uniq.map(function (t) { return fetch('api/btc/tx/' + t + '/hex').then(function (r) { return r.ok ? r.text() : null; }).then(function (h) { return [t, h && h.trim()]; }).catch(function () { return [t, null]; }); })); got.forEach(function (p) { if (p[1]) prevTxs[p[0]] = p[1]; }); st.textContent = 'Signing locally & broadcasting…'; }
        var signed = C.signCp(c.psbt, c.inputs_values, c.lock_scripts, curAccount, CPH.type, prevTxs, curImportedId());
        var r = await bcast(signed.txhex);
        if (r.error) throw new Error(r.detail || r.error);
        st.className = 'p-hint'; st.innerHTML = txLinkHtml(r.txid);
        var go = document.getElementById('adcGo'), bk = document.getElementById('adcBack2'); if (bk) bk.remove(); if (go) { go.textContent = 'Done'; go.onclick = function () { closeOv(); renderMain(); }; }
      } catch (err) { st.className = 'p-err'; st.textContent = 'Failed: ' + (err.message || 'sign/broadcast error'); }
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  Advanced account menu — all addresses · sign message · hardware · custom
  //  derivation · reveal seed · export keys. Password-gated where secrets appear.
  // ═══════════════════════════════════════════════════════════════════════════
  function pwGate(title, danger, cb) {
    overlay('<div class="stamp-detail"><div class="st-head"><div class="st-htitle">' + esc(title) + '</div><button class="m-close-x" id="pgX" title="Close" aria-label="Close">✕</button></div>'
      + '<div class="p-hint">Enter your wallet password to continue.</div>'
      + '<input class="p-in" id="pgPw" type="password" placeholder="Wallet password" autocomplete="current-password"/>'
      + '<div id="pgErr" class="p-err"></div>'
      + '<div class="actions"><button class="btn ghost" id="pgCancel">Cancel</button><button class="btn' + (danger ? ' danger' : '') + '" id="pgGo">Continue</button></div></div>');
    var pw = document.getElementById('pgPw'); if (typeof addPwReveal === 'function') addPwReveal(pw); try { pw.focus(); } catch (e) {}
    document.getElementById('pgX').onclick = closeOv; document.getElementById('pgCancel').onclick = closeOv;
    var go = async function () { var err = document.getElementById('pgErr'); err.textContent = ''; var btn = document.getElementById('pgGo'); btn.disabled = true; try { await cb(pw.value); } catch (e) { err.textContent = /wrong_password|decrypt|no_vault/i.test(e.message || '') ? 'Wrong password.' : (e.message || 'Failed.'); if (document.getElementById('pgGo')) document.getElementById('pgGo').disabled = false; } };
    document.getElementById('pgGo').onclick = go; pw.onkeydown = function (e) { if (e.key === 'Enter') go(); };
  }
  function advancedMenu() {
    var isImp = acctKind === 'imported';
    overlay('<div class="stamp-detail"><div class="st-head"><div class="st-htitle">Advanced</div><button class="m-close-x" id="advX" title="Close" aria-label="Close">✕</button></div>'
      + '<div class="adv-menu">'
      + '<button class="adv-opt" data-adv="addresses"><b>All addresses</b><span>Every derived address for this account</span></button>'
      + '<button class="adv-opt" data-adv="sign"><b>Sign message</b><span>Prove ownership of an address (BIP-322)</span></button>'
      + '<button class="adv-opt" data-adv="hw"><b>Hardware wallet</b><span>Connect a Ledger / signing device</span></button>'
      + (isImp ? '' : '<button class="adv-opt" data-adv="custom"><b>Custom derivation path</b><span>Derive an address at a specific path</span></button>'
        + '<button class="adv-opt danger" data-adv="reveal"><b>Reveal seed phrase</b><span>Show your 12/24-word recovery phrase</span></button>'
        + '<button class="adv-opt danger" data-adv="secrets"><b>Export private keys</b><span>Export raw keys for this account</span></button>')
      + '<button class="adv-opt danger" data-adv="backup"><b>Backup &amp; Restore</b><span>Full encrypted wallet backup — seed + settings in one file. Guard it like your seed.</span></button>'
      + '<button class="adv-opt" data-adv="autolock"><b>Auto-lock timer</b><span>Change or turn off the idle lock</span></button>'
      + '<button class="adv-opt" data-adv="theme"><b>Appearance</b><span>Dark or light wallet skin</span></button>'
      + '<button class="adv-opt" data-adv="network"><b>Network</b><span>Currently on <b>' + (isTN() ? 'Testnet' : 'Mainnet') + '</b> · switch for testing</span></button>'
      + '<button class="adv-opt" data-adv="reader"><b>Reader endpoint</b><span>' + (isCustomReader() ? 'Custom · ' + esc(short(readerUrl().replace(/^https:\/\//, ''))) : 'Default · wonder-wallet.com') + '</span></button>'
      + '<button class="adv-opt" data-adv="sites"><b>Connected sites</b><span>dApps allowed to connect to this wallet</span></button>'
      + '<button class="adv-opt" data-adv="terminal"><b>Wonder Terminal</b><span>Open the full wallet view in a window</span></button>'
      + '</div><button class="btn ghost" id="advClose">Close</button></div>');
    document.getElementById('advX').onclick = closeOv; document.getElementById('advClose').onclick = closeOv;
    document.querySelectorAll('[data-adv]').forEach(function (b) { b.onclick = function () {
      var a = b.dataset.adv;
      if (a === 'addresses') advAllAddresses();
      else if (a === 'sign') advSignMessage();
      else if (a === 'hw') { if (IS_HW_WIN) hwConnect(); else openHardwareTab(); }
      else if (a === 'custom') advCustomPath();
      else if (a === 'reveal') advRevealSeed();
      else if (a === 'secrets') advExportKeys();
      else if (a === 'backup') advBackup();
      else if (a === 'autolock') advAutoLock();
      else if (a === 'theme') advTheme();
      else if (a === 'network') advNetwork();
      else if (a === 'reader') advReader();
      else if (a === 'sites') { overlay('<div id="wwcsMount"></div>'); if (self.WWConnectedSites) self.WWConnectedSites.render(document.getElementById('wwcsMount'), advancedMenu); else { closeOv(); } }
      else if (a === 'terminal') { closeOv(); openTerminal(); }
    }; });
  }
  // Global network toggle — Mainnet ↔ Testnet. Switching re-derives testnet addresses (coin type 1')
  // and routes reads to testnet4 / Sepolia / devnet. Keys are the same seed; only the network changes.
  function advNetwork() {
    var cur = NET();
    var opt = function (m, name, sub) {
      return '<button class="adv-opt' + (cur === m ? ' on' : '') + '" data-nm="' + m + '"><b>' + name + (cur === m ? ' ✓' : '') + '</b><span>' + sub + '</span></button>';
    };
    overlay('<div class="stamp-detail"><div class="st-head"><button class="p-ibtn" id="nmBack" title="Back">←</button><div class="st-htitle">Network</div></div>'
      + '<div class="p-hint">Switch the whole wallet to a test network to experiment with <b>no real value</b> at stake — Bitcoin testnet4, Counterparty testnet4, Ethereum Sepolia, and Solana devnet. Your addresses change on testnet (they can never collide with mainnet). Stamps &amp; SRC-20 gallery reads are mainnet-only; SRC-20 mints run as a safe <b>dry run</b> on testnet.</div>'
      + '<div class="adv-menu">'
      + opt('mainnet', 'Mainnet', 'The real Bitcoin / Ethereum / Solana networks')
      + opt('testnet', 'Testnet', 'testnet4 · Sepolia · devnet — free test coins, no value')
      + '</div>'
      + (isTN() ? '<button class="btn" id="nmFaucet" style="margin-top:8px">🚰 Get test coins</button>' : '')
      + '<button class="btn ghost" id="nmClose" style="margin-top:8px">Close</button></div>');
    document.getElementById('nmBack').onclick = advancedMenu; document.getElementById('nmClose').onclick = closeOv;
    var fb = document.getElementById('nmFaucet'); if (fb) fb.onclick = testnetFaucet;
    document.querySelectorAll('[data-nm]').forEach(function (b) { b.onclick = function () {
      if (window.WWNetMode) window.WWNetMode.set(b.dataset.nm);
      paintTestnetBanner();
      closeOv();
      try { ASSETS = null; PRICES = null; } catch (e) {}
      render();
    }; });
  }
  // Testnet faucet links.
  function testnetFaucet() {
    var F = [['Bitcoin testnet4', 'https://mempool.space/testnet4/faucet', 'signet/testnet4 tBTC'],
      ['Ethereum Sepolia', 'https://cloud.google.com/application/web3/faucet/ethereum/sepolia', 'Sepolia ETH'],
      ['Solana devnet', 'https://faucet.solana.com/', 'devnet SOL']];
    overlay('<div class="stamp-detail"><div class="st-head"><button class="p-ibtn" id="fcBack" title="Back">←</button><div class="st-htitle">🚰 Testnet faucets</div></div>'
      + '<div class="p-hint">Get free test coins, then send them to your <b>testnet</b> address in this wallet.</div>'
      + '<div class="adv-menu">' + F.map(function (f) { return '<a class="adv-opt" href="' + f[1] + '" target="_blank" rel="noopener"><b>' + esc(f[0]) + ' ↗</b><span>' + esc(f[2]) + '</span></a>'; }).join('') + '</div>'
      + '<button class="btn ghost" id="fcClose" style="margin-top:8px">Close</button></div>');
    document.getElementById('fcBack').onclick = advNetwork; document.getElementById('fcClose').onclick = closeOv;
  }
  // ── Reader endpoint (custom backend) ─────────────────────────────────────────────────────────────
  // The extension talks to ONE origin for all reads/broadcasts. Default = wonder-wallet.com (project
  // infra). A privacy-conscious user can repoint it at their OWN server.js. The choice is stored in
  // localStorage['ww:reader'] (read by shim.js/approval.js) AND chrome.storage.local (read by the
  // service worker, which has no localStorage). The custom origin is granted via chrome.permissions.
  var READER_DEFAULT = 'https://wonder-wallet.com';
  function readerUrl() { try { var c = localStorage.getItem('ww:reader'); return (c && /^https:\/\/[^\s"'<>]+$/.test(c)) ? c.replace(/\/+$/, '') : READER_DEFAULT; } catch (e) { return READER_DEFAULT; } }
  function isCustomReader() { return readerUrl() !== READER_DEFAULT; }
  function readerOriginPattern(u) { try { return 'https://' + new URL(u).host + '/*'; } catch (e) { return null; } }
  function setReader(url, done) {
    // url === null → reset to default (clear both stores). Otherwise persist the validated https origin.
    try { if (url) localStorage.setItem('ww:reader', url); else localStorage.removeItem('ww:reader'); } catch (e) {}
    try {
      if (chrome && chrome.storage && chrome.storage.local) {
        if (url) chrome.storage.local.set({ 'ww:reader': url }, function () { done && done(); });
        else chrome.storage.local.remove('ww:reader', function () { done && done(); });
        return;
      }
    } catch (e) {}
    done && done();
  }
  function advReader() {
    var cur = readerUrl(), custom = isCustomReader();
    overlay('<div class="stamp-detail"><div class="st-head"><button class="p-ibtn" id="rdBack" title="Back">←</button><div class="st-htitle">Reader endpoint</div></div>'
      + '<div class="p-hint">Wonder Wallet reads public blockchain data (balances, assets, fees, prices) and broadcasts your signed transactions through <b>one</b> backend. Your keys and seed <b>never</b> touch it. By default that\'s the project\'s own <b>wonder-wallet.com</b>. If you run your own <code>server.js</code>, point the wallet at it here so only <b>you</b> can see which addresses are looked up.</div>'
      + '<div class="acct-line"><div class="acct-lab">Current</div><div class="acct-val"><span class="acct-addr" title="' + esc(cur) + '">' + esc(cur.replace(/^https:\/\//, '')) + (custom ? '' : ' · default') + '</span></div></div>'
      + '<label class="stf"><span>Custom endpoint (https://…)</span><input id="rdIn" class="p-in" type="url" inputmode="url" spellcheck="false" placeholder="https://my-server.example.com" value="' + (custom ? esc(cur) : '') + '"/></label>'
      + '<div class="p-hint" style="border-left:3px solid #E0B453;padding-left:8px">⚠️ <b>Trust warning.</b> Whoever runs this endpoint can see which addresses you view and the raw transactions you broadcast (the same visibility any blockchain-data provider has). Only use a server <b>you</b> run or fully trust. It must expose the same <code>/api/*</code> routes as this project\'s <code>server.js</code>.</div>'
      + '<div id="rdOut" class="sm-out" hidden></div>'
      + '<button class="btn" id="rdSave">Use this endpoint</button>'
      + (custom ? '<button class="btn ghost" id="rdReset" style="margin-top:8px">↺ Reset to default (wonder-wallet.com)</button>' : '')
      + '<button class="btn ghost" id="rdClose" style="margin-top:8px">Close</button></div>');
    document.getElementById('rdBack').onclick = advancedMenu; document.getElementById('rdClose').onclick = closeOv;
    var out = document.getElementById('rdOut');
    var say = function (msg, ok) { out.hidden = false; out.textContent = msg; out.style.color = ok ? '#7fd18a' : '#e88'; };
    document.getElementById('rdSave').onclick = function () {
      var v = (document.getElementById('rdIn').value || '').trim().replace(/\/+$/, '');
      if (!/^https:\/\/[^\s"'<>]+$/.test(v)) { say('Enter a valid https:// URL.', false); return; }
      if (/^https:\/\/(localhost|127\.|0\.0\.0\.0|\[?::1)/i.test(v)) { say('Local addresses aren\'t allowed here.', false); return; }
      var pat = readerOriginPattern(v);
      if (!pat) { say('Couldn\'t parse that URL.', false); return; }
      var apply = function () { setReader(v, function () { say('✓ Reader set to ' + v.replace(/^https:\/\//, '') + '. New reads use it immediately.', true); setTimeout(advReader, 900); }); };
      try {
        if (chrome && chrome.permissions && chrome.permissions.request) {
          chrome.permissions.request({ origins: [pat] }, function (granted) {
            if (chrome.runtime && chrome.runtime.lastError) { say('Permission error: ' + chrome.runtime.lastError.message, false); return; }
            if (!granted) { say('Permission for ' + pat + ' was denied — endpoint not changed.', false); return; }
            apply();
          });
        } else { apply(); }
      } catch (e) { say('Could not request permission: ' + (e && e.message || e), false); }
    };
    var rst = document.getElementById('rdReset');
    if (rst) rst.onclick = function () {
      var oldPat = readerOriginPattern(cur);
      setReader(null, function () {
        try { if (oldPat && chrome && chrome.permissions && chrome.permissions.remove) chrome.permissions.remove({ origins: [oldPat] }, function () {}); } catch (e) {}
        say('✓ Reset to wonder-wallet.com.', true); setTimeout(advReader, 800);
      });
    };
  }
  function advAutoLock() {
    var cur = '5'; try { cur = localStorage.getItem('ww:idlemins') || '5'; } catch (e) {}
    var opts = [['1', '1 minute'], ['5', '5 minutes'], ['15', '15 minutes'], ['30', '30 minutes'], ['60', '1 hour'], ['off', 'Never — stay unlocked']];
    overlay('<div class="stamp-detail"><div class="st-head"><button class="p-ibtn" id="alBack" title="Back">←</button><div class="st-htitle">Auto-lock timer</div></div>'
      + '<div class="p-hint">Wonder Wallet locks after this much inactivity. <b>Never</b> keeps it unlocked until you lock it manually or close the browser — use only on a device you trust.</div>'
      + '<div class="adv-menu">' + opts.map(function (o) { var sub = o[0] === cur ? '✓ current' : (o[0] === 'off' ? 'No idle lock — trusted devices only' : ''); return '<button class="adv-opt' + (o[0] === cur ? ' on' : '') + (o[0] === 'off' ? ' danger' : '') + '" data-al="' + o[0] + '"><b>' + esc(o[1]) + '</b><span>' + esc(sub) + '</span></button>'; }).join('') + '</div>'
      + '<button class="btn ghost" id="alClose" style="margin-top:8px">Close</button></div>');
    document.getElementById('alBack').onclick = (acctKind === 'hardware' && HW) ? hwSettingsMenu : advancedMenu; document.getElementById('alClose').onclick = closeOv;
    document.querySelectorAll('[data-al]').forEach(function (b) { b.onclick = function () { try { if (window.WWSession && window.WWSession.setIdle) window.WWSession.setIdle(b.dataset.al); } catch (e) {} advAutoLock(); }; });
  }
  function advTheme() {
    var cur = 'dark'; try { cur = localStorage.getItem('ww:theme') === 'light' ? 'light' : 'dark'; } catch (e) {}
    var opt = function (val, name, desc) { return '<button class="adv-opt' + (val === cur ? ' on' : '') + '" data-theme="' + val + '"><b>' + esc(name) + (val === cur ? ' ✓' : '') + '</b><span>' + esc(desc) + '</span></button>'; };
    overlay('<div class="stamp-detail"><div class="st-head"><button class="p-ibtn" id="thBack" title="Back">←</button><div class="st-htitle">Appearance</div></div>'
      + '<div class="p-hint">Choose your wallet skin — saved on this device.</div>'
      + '<div class="adv-menu">' + opt('dark', 'Midnight', 'The original deep-black gold theme') + opt('light', 'Parchment', 'A warm, light-toned skin') + '</div>'
      + '<button class="btn ghost" id="thClose" style="margin-top:8px">Close</button></div>');
    document.getElementById('thBack').onclick = (acctKind === 'hardware' && HW) ? hwSettingsMenu : advancedMenu; document.getElementById('thClose').onclick = closeOv;
    document.querySelectorAll('[data-theme]').forEach(function (b) { b.onclick = function () { setTheme(b.dataset.theme); advTheme(); }; });
  }
  function advAllAddresses() {
    var rows = [];
    if (acctKind === 'imported') {
      var im = currentImported(); if (!im) return;
      [['BTC · Native SegWit', 'nativeSegwit'], ['BTC · Taproot', 'taproot'], ['BTC · Nested SegWit', 'nestedSegwit'], ['BTC · Legacy', 'legacy']].forEach(function (p) { if (im.bitcoin[p[1]]) rows.push([p[0], im.bitcoin[p[1]].address]); });
    } else {
      var acc; try { acc = C.accounts(curAccount, 0, NET()); } catch (e) { return; }
      var b = acc.bitcoin;
      [['BTC · Native SegWit', 'nativeSegwit'], ['BTC · Taproot', 'taproot'], ['BTC · Nested SegWit', 'nestedSegwit'], ['BTC · Legacy', 'legacy']].forEach(function (p) { if (b[p[1]]) rows.push([p[0], b[p[1]].address]); });
      rows.push(['Ethereum', acc.ethereum.address]); rows.push(['Solana', acc.solana.address]);
    }
    var html = rows.map(function (r, i) { return '<div class="acct-line"><div class="acct-lab">' + esc(r[0]) + '</div><div class="acct-val"><span class="acct-addr" title="' + esc(r[1]) + '">' + esc(short(r[1])) + '</span><button class="mini" data-i="' + i + '">copy</button></div></div>'; }).join('');
    overlay('<div class="stamp-detail"><div class="st-head"><button class="p-ibtn" id="aaBack" title="Back">←</button><div class="st-htitle">All addresses</div></div>'
      + '<div class="p-hint">Account ' + esc(String(curAccount)) + ' — every chain and Bitcoin address type.</div>' + html
      + '<button class="btn ghost" id="aaClose" style="margin-top:8px">Close</button></div>');
    document.getElementById('aaBack').onclick = advancedMenu; document.getElementById('aaClose').onclick = closeOv;
    document.querySelectorAll('[data-i]').forEach(function (btn) { btn.onclick = function () { copy(rows[+btn.dataset.i][1], btn); }; });
  }
  function advSignMessage() {
    var isImp = acctKind === 'imported';
    // BIP-322 (bc1q) and the classic Bitcoin Signed Message (legacy 1…) are the two verifiable schemes.
    var types = [['nativeSegwit', 'Native SegWit · bc1q'], ['legacy', 'Legacy · 1…']];
    var defType = curBtcType() === 'legacy' ? 'legacy' : 'nativeSegwit';
    var opts = types.map(function (t) { return '<option value="' + t[0] + '"' + (t[0] === defType ? ' selected' : '') + '>' + esc(t[1]) + '</option>'; }).join('');
    overlay('<div class="stamp-detail"><div class="st-head"><button class="p-ibtn" id="smBack" title="Back">←</button><div class="st-htitle">Sign message</div></div>'
      + '<div class="p-hint">Prove you control an address. Native SegWit uses BIP-322; Legacy uses the classic Bitcoin Signed Message. Works for imported keys too.</div>'
      + '<label class="stf"><span>Sign as</span><select id="smType" class="p-in">' + opts + '</select></label>'
      + '<div class="cph-from" id="smAddr"></div>'
      + '<label class="stf"><span>Message</span><textarea id="smMsg" class="p-in" rows="3" spellcheck="false"></textarea></label>'
      + '<button class="btn" id="smGo">Sign</button><div id="smOut" class="sm-out" hidden></div>'
      + '<button class="btn ghost" id="smClose" style="margin-top:8px">Close</button></div>');
    document.getElementById('smBack').onclick = advancedMenu; document.getElementById('smClose').onclick = closeOv;
    var typeSel = document.getElementById('smType'), addrEl = document.getElementById('smAddr');
    var showAddr = function () {
      try {
        var t = typeSel.value, addr = '';
        if (isImp) { var im = currentImported(); addr = im && im.bitcoin[t] ? im.bitcoin[t].address : ''; }
        else { var acc = C.accounts(curAccount, 0, NET()); addr = acc.bitcoin[t] ? acc.bitcoin[t].address : ''; }
        addrEl.textContent = addr ? ('address: ' + addr) : '';
      } catch (e) { addrEl.textContent = ''; }
    };
    typeSel.onchange = showAddr; showAddr();
    document.getElementById('smGo').onclick = function () {
      var out = document.getElementById('smOut');
      try {
        var msg = document.getElementById('smMsg').value; if (!msg) throw new Error('Enter a message to sign.');
        var t = typeSel.value;
        var res = isImp ? C.signMessageImported(msg, impId, t) : C.signMessage(msg, curAccount, t);
        out.hidden = false;
        out.innerHTML = '<div class="fine">Signature · ' + esc(res.format) + ' · <span style="font-family:var(--mono)">' + esc(short(res.address)) + '</span></div>'
          + '<textarea class="p-in" rows="3" readonly>' + esc(res.signature) + '</textarea>'
          + '<button class="mini" id="smCopy">Copy signature</button>';
        document.getElementById('smCopy').onclick = function (e) { copy(res.signature, e.target); };
      } catch (err) { out.hidden = false; out.innerHTML = '<span class="p-err">' + esc(/unsupported/i.test(err.message || '') ? 'This address type can’t be message-signed here — use Native SegWit or Legacy.' : (err.message || 'Could not sign.')) + '</span>'; }
    };
  }
  function advCustomPath() {
    pwGate('Custom derivation path', false, async function (pw) {
      var seed = await C.revealSeed(pw); var mnemonic = seed.mnemonic, passphrase = seed.passphrase;
      overlay('<div class="stamp-detail"><div class="st-head"><button class="p-ibtn" id="cdBack" title="Back">←</button><div class="st-htitle">Custom derivation path</div></div>'
        + '<div class="p-hint">Recover assets on non-standard historical paths. Enter a BIP-32 path.</div>'
        + '<input id="cdPath" class="p-in" type="text" value="m/44\'/0\'/0\'/0/0"/>'
        + '<select id="cdChain" class="p-in"><option value="bitcoin-legacy">Bitcoin · Legacy</option><option value="bitcoin-nativeSegwit">Bitcoin · Native SegWit</option><option value="bitcoin-taproot">Bitcoin · Taproot</option><option value="bitcoin-nestedSegwit">Bitcoin · Nested SegWit</option><option value="ethereum">Ethereum</option><option value="solana">Solana</option></select>'
        + '<button class="btn" id="cdGo">Derive address</button><div id="cdOut" class="cp-out" hidden></div>'
        + '<button class="btn ghost" id="cdClose" style="margin-top:8px">Done</button></div>');
      document.getElementById('cdBack').onclick = advancedMenu; document.getElementById('cdClose').onclick = closeOv;
      document.getElementById('cdGo').onclick = function () {
        var out = document.getElementById('cdOut');
        try { var parts = document.getElementById('cdChain').value.split('-'); var addr = C.deriveCustom(mnemonic, passphrase, document.getElementById('cdPath').value.trim(), parts[0], parts[1] || 'legacy'); out.hidden = false; out.innerHTML = '<span class="acct-addr" title="' + esc(addr) + '">' + esc(addr) + '</span><button class="mini" data-copy="1">copy</button>'; out.querySelector('[data-copy]').onclick = function (e) { copy(addr, e.target); }; }
        catch (err) { out.hidden = false; out.innerHTML = '<span class="p-err">Invalid path: ' + esc(err.message || '') + '</span>'; }
      };
    });
  }
  function advRevealSeed() {
    pwGate('Reveal seed phrase', true, async function (pw) {
      var seed = await C.revealSeed(pw); var words = seed.mnemonic.split(' ');
      var grid = words.map(function (w, i) { return '<span class="seedw"><i>' + (i + 1) + '</i>' + esc(w) + '</span>'; }).join('');
      overlay('<div class="stamp-detail"><div class="st-head"><div class="st-htitle">Recovery phrase</div><button class="m-close-x" id="rsX" title="Close" aria-label="Close">✕</button></div>'
        + '<div class="disp-panel" style="display:block"><div class="disp-hit">Never share this. Anyone with it controls your funds.</div></div>'
        + '<div class="seedgrid blurred" id="rsGrid">' + grid + '</div>'
        + '<div class="actions"><button class="btn ghost" id="rsReveal">Tap to reveal</button><button class="btn" id="rsCopy">Copy</button></div>'
        + (seed.passphrase ? '<div class="fine">+ a BIP-39 passphrase is set on this wallet.</div>' : '')
        + '<button class="btn ghost" id="rsClose" style="margin-top:8px">Done</button></div>');
      var rev = false; document.getElementById('rsReveal').onclick = function () { rev = !rev; document.getElementById('rsGrid').classList.toggle('blurred', !rev); this.textContent = rev ? 'Hide' : 'Tap to reveal'; };
      document.getElementById('rsCopy').onclick = function (e) { copy(seed.mnemonic, e.target); };
      document.getElementById('rsX').onclick = closeOv; document.getElementById('rsClose').onclick = closeOv;
    });
  }
  function advExportKeys() {
    pwGate('Export private keys', true, async function (pw) {
      var sec = await C.secrets(pw, curAccount, 0);
      var items = [['BTC Native SegWit (WIF)', sec.bitcoin.nativeSegwit.wif], ['BTC Legacy (WIF)', sec.bitcoin.legacy.wif], ['BTC Taproot (WIF)', sec.bitcoin.taproot.wif], ['Ethereum (hex)', sec.ethereum.privateKey], ['Solana (base58)', sec.solana.secretKey]];
      var line = function (lab, i) { return '<div class="acct-line"><div class="acct-lab">' + esc(lab) + '</div><div class="acct-val"><span class="acct-addr secret">••••••••••••</span><button class="mini" data-i="' + i + '">copy</button></div></div>'; };
      overlay('<div class="stamp-detail"><div class="st-head"><div class="st-htitle">Private keys · account ' + esc(String(curAccount)) + '</div><button class="m-close-x" id="ekX" title="Close" aria-label="Close">✕</button></div>'
        + '<div class="disp-panel" style="display:block"><div class="disp-hit">These keys spend your funds. Copy into a trusted wallet only — never paste into a website or share.</div></div>'
        + items.map(function (it, i) { return line(it[0], i); }).join('')
        + '<button class="btn ghost" id="ekClose" style="margin-top:8px">Done</button></div>');
      document.querySelectorAll('[data-i]').forEach(function (b) { b.onclick = function () { copy(items[+b.dataset.i][1], b); }; });
      var done = function () { items.forEach(function (it) { it[1] = ''; }); closeOv(); };
      document.getElementById('ekX').onclick = done; document.getElementById('ekClose').onclick = done;
    });
  }

  // ── Activity / transaction history — metaprotocol-aware, Coin-Control-style. ──
  var ACT = { addr: null, items: null, filter: 'all' };
  function actAgo(ts) { if (!ts) return ''; var s = Math.max(0, Math.floor(Date.now() / 1000 - ts)); if (s < 60) return s + 's ago'; if (s < 3600) return Math.floor(s / 60) + 'm ago'; if (s < 86400) return Math.floor(s / 3600) + 'h ago'; return Math.floor(s / 86400) + 'd ago'; }
  // Activity USD pricing: BTC + XCP from the price feed; other tokens via their XCP pool (best-effort).
  var ACT_PX = { btc: 0, xcp: 0, pool: {} };
  async function actLoadPx() {
    try { var pr = await fetch('api/prices').then(function (r) { return r.json(); }); ACT_PX.btc = Number(pr.bitcoin) || 0; ACT_PX.xcp = Number(pr.counterparty) || 0; } catch (e) {}
    try { var j = await fetch('api/cp/pools').then(function (r) { return r.json(); }); var arr = Array.isArray(j.result) ? j.result : []; var px = {};
      arr.forEach(function (p) { var ra = Number(p.resA), rb = Number(p.resB); if (p.a === 'XCP' && rb > 0) px[p.b] = ra / rb; else if (p.b === 'XCP' && ra > 0) px[p.a] = rb / ra; });
      ACT_PX.pool = px;
    } catch (e) {}
  }
  function actUsd(asset, amt) {
    var a = Number(amt); if (!(a > 0)) return '';
    var u = 0;
    if (asset === 'BTC') u = a * ACT_PX.btc;
    else if (asset === 'XCP') u = a * ACT_PX.xcp;
    else { var px = ACT_PX.pool[asset]; if (px) u = a * px * ACT_PX.xcp; }
    return u ? ' <span class="ac-usd">≈ $' + u.toLocaleString('en-US', { maximumFractionDigits: u < 1 ? 4 : 2 }) + '</span>' : '';
  }
  function actSatsUsd(sats) { var u = (Number(sats) / 1e8) * ACT_PX.btc; return u ? ' <span class="ac-usd">≈ $' + u.toLocaleString('en-US', { maximumFractionDigits: 2 }) + '</span>' : ''; }
  function actQty(d, field) {
    if (d[field + '_normalized'] != null) return Number(d[field + '_normalized']);
    var raw = Number(d[field]); if (!isFinite(raw)) return 0;
    var info = d[field.replace(/_quantity$/, '') + '_asset_info'] || d.asset_info;
    return (info && info.divisible === false) ? raw : raw / 1e8;
  }
  function amtChip(asset, qty) { return fmt(qty, 8) + ' ' + esc(asset || '') + actUsd(asset, qty); }

  function actDescribe(it) {
    var d = it.data || {}, t = it.type;
    var det = function (s) { return s ? ' <span class="ac-det">' + s + '</span>' : ''; }; // s is pre-built HTML (assets esc'd by amtChip)
    if (it.source === 'btc') {
      if (d.amountSats == null) return { ic: XFER_IC, cls: 'cp', label: 'Bitcoin tx', detailHtml: '' };
      var line = fmt(d.amountSats / 1e8, 8) + ' BTC' + actSatsUsd(d.amountSats);
      return t === 'receive' ? { ic: RECV_IC, cls: 'in', label: 'Received', detailHtml: det(line) } : { ic: XFER_IC, cls: 'out', label: 'Sent', detailHtml: det(line) };
    }
    if (it.source === 'src20') { var op = String(d.op || 'transfer').toLowerCase(); var amt = d.amt != null ? fmt(parseFloat(d.amt), 8) : (d.max != null ? 'max ' + fmt(parseFloat(d.max), 0) : ''); return { ic: op === 'deploy' ? PLUS_IC : op === 'mint' ? MINT_IC : XFER_IC, cls: 'src20', label: 'SRC-20 ' + op, detailHtml: det(esc(d.tick || '') + (amt ? ' · ' + amt : '')) }; }
    var to = d.destination || d.address, recv = !!to && to === ACT.addr;
    switch (t) {
      case 'send': case 'enhanced_send': case 'mpma_send': {
        var who = recv ? (d.source ? ' ← ' + esc(short(d.source)) : '') : (to ? ' → ' + esc(short(to)) : '');
        return recv ? { ic: RECV_IC, cls: 'in', label: 'Received', detailHtml: det(amtChip(d.asset, actQty(d, 'quantity')) + who) }
          : { ic: XFER_IC, cls: 'out', label: t === 'mpma_send' ? 'Multi-send' : 'Sent', detailHtml: det(amtChip(d.asset, actQty(d, 'quantity')) + who) };
      }
      case 'order': return { ic: DEX_IC, cls: 'cp', label: 'Swap', detailHtml: det(amtChip(d.give_asset, actQty(d, 'give_quantity')) + ' → ' + amtChip(d.get_asset, actQty(d, 'get_quantity'))) };
      case 'dispense': { var price = d.btc_amount != null ? fmt(d.btc_amount, 0) + ' sats' + actSatsUsd(d.btc_amount) : ''; var qa = d.asset ? esc(d.asset) + (d.dispense_quantity != null ? ' × ' + fmt(actQty(d, 'dispense_quantity'), 8) : '') : ''; return { ic: DISP_IC, cls: 'in', label: 'Dispenser buy', detailHtml: det(qa + (price ? (qa ? ' · ' : '') + 'for ' + price : '')) }; }
      case 'dispenser': { var rate = d.satoshirate != null ? fmt(d.satoshirate, 0) + ' sats ea' : ''; return { ic: DISP_IC, cls: 'cp', label: 'Opened dispenser', detailHtml: det(esc(d.asset || '') + (rate ? ' @ ' + rate : '')) }; }
      case 'fairmint': { var xcp = d.xcp_paid != null ? ' · ' + amtChip('XCP', d.xcp_paid / 1e8) : ''; var earned = d.earned != null ? ' · ' + fmt(actQty(d, 'earned'), 8) : ''; return { ic: MINT_IC, cls: 'cp', label: 'Minted', detailHtml: det(esc(d.asset || '') + earned + xcp) }; }
      case 'fairminter': return { ic: PLUS_IC, cls: 'cp', label: 'Launched fairminter', detailHtml: det(esc(d.asset || '')) };
      case 'dividend': { var per = d.quantity_per_unit != null ? ' · ' + amtChip(d.dividend_asset || 'XCP', actQty(d, 'quantity_per_unit')) + ' each' : ''; return { ic: DIV_IC, cls: 'cp', label: 'Dividend', detailHtml: det(esc(d.asset || '') + per) }; }
      case 'issuance': { var qi = d.quantity != null ? ' · ' + fmt(actQty(d, 'quantity'), 8) : ''; return { ic: PLUS_IC, cls: 'cp', label: 'Issuance', detailHtml: det(esc(d.asset || '') + qi) }; }
      case 'sweep': return { ic: SWEEP_IC, cls: 'cp', label: 'Sweep', detailHtml: det(to ? '→ ' + esc(short(to)) : '') };
      case 'destroy': return { ic: FIRE_IC, cls: 'burn', label: 'Burned', detailHtml: det(amtChip(d.asset, actQty(d, 'quantity'))) };
      case 'cancel': return { ic: DEX_IC, cls: 'cp', label: 'Cancelled order', detailHtml: '' };
      case 'btcpay': return { ic: DEX_IC, cls: 'cp', label: 'BTC pay (match)', detailHtml: '' };
      case 'attach': return { ic: XFER_IC, cls: 'cp', label: 'Attach to UTXO', detailHtml: det(esc(d.asset || '')) };
      case 'detach': return { ic: XFER_IC, cls: 'cp', label: 'Detach from UTXO', detailHtml: det(esc(d.asset || '')) };
      case 'broadcast': return { ic: XFER_IC, cls: 'cp', label: 'Broadcast', detailHtml: '' };
      default: return { ic: XFER_IC, cls: 'cp', label: (t || 'Counterparty').replace(/_/g, ' '), detailHtml: det(esc(d.asset || '')) };
    }
  }
  // Expanded detail card — full per-tx breakdown (with USD), shown when a row is tapped.
  function actDetailHtml(it) {
    var d = it.data || {}, t = it.type;
    var row = function (k, v) { return v ? '<div class="acd-row"><span class="acd-k">' + esc(k) + '</span><span class="acd-v">' + v + '</span></div>' : ''; };
    var rows = '';
    if (it.source === 'btc') rows += row(t === 'receive' ? 'Received' : 'Sent', d.amountSats != null ? fmt(d.amountSats / 1e8, 8) + ' BTC' + actSatsUsd(d.amountSats) : '');
    else if (it.source === 'src20') rows += row('Op', esc(String(d.op || ''))) + row('Ticker', esc(d.tick || '')) + row('Amount', d.amt != null ? fmt(parseFloat(d.amt), 8) : (d.max != null ? 'max ' + fmt(parseFloat(d.max), 0) : '')) + row('To', d.to ? esc(short(d.to)) : '');
    else {
      var to = d.destination || d.address, recv = !!to && to === ACT.addr;
      switch (t) {
        case 'send': case 'enhanced_send': case 'mpma_send':
          rows += row('Asset', amtChip(d.asset, actQty(d, 'quantity'))) + row(recv ? 'From' : 'To', esc(short(recv ? (d.source || '') : (to || '')))) + (d.memo ? row('Memo', esc(String(d.memo))) : ''); break;
        case 'order':
          rows += row('Give', amtChip(d.give_asset, actQty(d, 'give_quantity'))) + row('Get', amtChip(d.get_asset, actQty(d, 'get_quantity'))) + row('Status', esc(d.status || '')); break;
        case 'dispense':
          rows += row('Bought', d.asset ? fmt(actQty(d, 'dispense_quantity'), 8) + ' ' + esc(d.asset) : '') + row('Paid', d.btc_amount != null ? fmt(d.btc_amount, 0) + ' sats' + actSatsUsd(d.btc_amount) : '') + row('Dispenser', d.dispenser_source ? esc(short(d.dispenser_source)) : ''); break;
        case 'dispenser':
          rows += row('Asset', esc(d.asset || '')) + row('Give / dispense', d.give_quantity != null ? fmt(actQty(d, 'give_quantity'), 8) : '') + row('Price', d.satoshirate != null ? fmt(d.satoshirate, 0) + ' sats each' : ''); break;
        case 'fairmint':
          rows += row('Token', d.earned != null ? fmt(actQty(d, 'earned'), 8) + ' ' + esc(d.asset || '') : esc(d.asset || '')) + row('XCP paid', d.xcp_paid != null ? amtChip('XCP', d.xcp_paid / 1e8) : ''); break;
        case 'dividend':
          rows += row('On asset', esc(d.asset || '')) + row('Per unit', d.quantity_per_unit != null ? amtChip(d.dividend_asset || 'XCP', actQty(d, 'quantity_per_unit')) : ''); break;
        case 'issuance':
          rows += row('Asset', esc(d.asset || '')) + row('Quantity', d.quantity != null ? fmt(actQty(d, 'quantity'), 8) : '') + (d.description ? row('Description', esc(String(d.description).slice(0, 80))) : ''); break;
        default: if (d.asset) rows += row('Asset', esc(d.asset));
      }
    }
    rows += row('Miner fee', it.fee != null ? fmt(it.fee, 0) + ' sats' + actSatsUsd(it.fee) + (it.feeRate != null ? ' · ' + it.feeRate + ' s/vB' : '') : '');
    rows += row('Status', it.confirmed ? 'Confirmed' + (it.blockHeight ? ' · block ' + fmt(it.blockHeight, 0) : '') : 'Unconfirmed');
    rows += '<div class="acd-row"><span class="acd-k">Transaction</span><span class="acd-v"><a href="https://mempool.space/tx/' + encodeURIComponent(it.txid) + '" target="_blank" rel="noopener" style="color:var(--gold2)">' + esc(it.txid.slice(0, 20)) + '…</a></span></div>';
    return '<div class="acd">' + rows + '</div>';
  }
  function actRowHtml(it) {
    var info = actDescribe(it);
    var status = it.confirmed ? '<span class="ac-badge conf">✓ Confirmed</span>' : '<span class="ac-badge unc">⏳ Unconfirmed</span>';
    var when = it.time ? actAgo(it.time) : (it.blockHeight ? 'block ' + fmt(it.blockHeight, 0) : '');
    var fee = it.fee != null ? fmt(it.fee, 0) + ' sats' + (it.feeRate != null ? ' · ' + it.feeRate + ' s/vB' : '') : '';
    // An unconfirmed tx can be accelerated if it's a signable BTC send (→ RBF) and/or has a spendable
    // output we own (→ CPFP). When so, the row's icon becomes a tap target that opens the Speed-up chooser.
    var canAccel = !it.confirmed && canSignBtc() && ((it.source === 'btc' && it.direction === 'out') || !!it.ownVout);
    var ic = '<span class="ac-ic ' + info.cls + (canAccel ? ' ac-ic-boost' : '') + '"' + (canAccel ? ' data-accel="' + esc(it.txid) + '" title="Speed up this transaction"' : '') + '>' + info.ic + (canAccel ? '<span class="ac-boltbadge">⚡</span>' : '') + '</span>';
    return '<div class="ac-item" data-tx="' + esc(it.txid) + '">'
      + '<div class="ac-row" data-expand="' + esc(it.txid) + '">'
      + ic
      + '<div class="ac-main"><div class="ac-l1">' + esc(info.label) + info.detailHtml + '</div>'
      + '<div class="ac-l2"><span class="ac-tx" data-copy="' + esc(it.txid) + '" title="Copy txid">' + esc(it.txid.slice(0, 12)) + '…</span>' + (when ? '<span>' + esc(when) + '</span>' : '') + (fee ? '<span class="ac-fee">' + esc(fee) + '</span>' : '') + '</div></div>'
      + '<div class="ac-r">' + status + '<span class="ac-chev">▾</span></div></div>'
      + '<div class="ac-detail" hidden></div></div>';
  }
  function renderActivity(addr) {
    if (!addr) return renderMain();
    ACT = { addr: addr, items: null, filter: 'all' };
    var coinBtn = canSignBtc() ? '<button class="p-ibtn" id="acCoin" title="Coin Control — UTXO management (freeze, label &amp; protect asset-bound coins)">' + GRID_ICON + '</button>' : '';
    app.innerHTML = '<div class="p-head"><button class="p-ibtn" id="bBack" title="Back">←</button><div class="p-brand-mid"><div class="p-name">Activity</div><div class="p-sub">' + esc(short(addr)) + '</div></div><div class="p-icons">' + coinBtn + '<button class="p-ibtn" id="acRefresh" title="Refresh">' + CC_REFRESH + '</button></div></div>'
      + '<div id="acBody"><div class="empty">Loading activity…</div></div>';
    document.getElementById('bBack').onclick = backToMain;
    var acCoin = document.getElementById('acCoin'); if (acCoin) acCoin.onclick = function () { renderCoinControl(addr, true); };
    document.getElementById('acRefresh').onclick = function () { ACT.items = null; loadActivity(); };
    loadActivity();
  }
  async function loadActivity() {
    var body = document.getElementById('acBody'); if (body) body.innerHTML = '<div class="empty">Loading activity…</div>';
    try {
      var res = await Promise.all([fetch('api/activity/' + encodeURIComponent(ACT.addr)).then(function (x) { return x.json(); }), actLoadPx()]);
      ACT.items = res[0].items || [];
    } catch (e) { if (body) body.innerHTML = '<div class="p-err" style="margin:14px">Could not load activity — try again.</div>'; return; }
    renderActivityList();
  }
  function renderActivityList() {
    var body = document.getElementById('acBody'); if (!body || !ACT.items) return;
    var nUnc = ACT.items.filter(function (i) { return !i.confirmed; }).length;
    var rows = ACT.items.filter(function (i) { return ACT.filter === 'all' || (ACT.filter === 'unconfirmed' ? !i.confirmed : i.confirmed); });
    var filters = [['all', 'All', ACT.items.length], ['unconfirmed', 'Unconfirmed', nUnc], ['confirmed', 'Confirmed', ACT.items.length - nUnc]];
    var filterBar = '<div class="ac-filters">' + filters.map(function (f) { return '<button class="acf ' + (ACT.filter === f[0] ? 'on' : '') + '" data-f="' + f[0] + '">' + f[1] + ' <span class="acf-n">' + f[2] + '</span></button>'; }).join('') + '</div>';
    var list = rows.length ? rows.map(actRowHtml).join('') : '<div class="empty">No ' + (ACT.filter === 'all' ? '' : ACT.filter + ' ') + 'transactions.</div>';
    body.innerHTML = filterBar + '<div class="ac-list">' + list + '</div>';
    body.querySelectorAll('.acf').forEach(function (b) { b.onclick = function () { ACT.filter = b.dataset.f; renderActivityList(); }; });
    body.querySelectorAll('[data-copy]').forEach(function (el) { el.onclick = function (e) { e.stopPropagation(); copy(el.getAttribute('data-copy'), el); }; });
    body.querySelectorAll('[data-accel]').forEach(function (b) { b.onclick = function (e) { e.stopPropagation(); var it = ACT.items.filter(function (x) { return x.txid === b.dataset.accel; })[0]; if (it) accelerateTx(it); }; });
    // Tap a row to expand its full detail card (filled lazily on first open).
    body.querySelectorAll('[data-expand]').forEach(function (r) { r.onclick = function () {
      var item = r.closest('.ac-item'); if (!item) return; var panel = item.querySelector('.ac-detail'); var it = ACT.items.filter(function (x) { return x.txid === r.dataset.expand; })[0]; if (!panel || !it) return;
      if (panel.hasAttribute('hidden')) { if (!panel.dataset.filled) { panel.innerHTML = actDetailHtml(it); panel.dataset.filled = '1'; } panel.removeAttribute('hidden'); item.classList.add('open'); }
      else { panel.setAttribute('hidden', ''); item.classList.remove('open'); }
    }; });
  }
  // Speed-up chooser — one entry point (tap the row icon) that offers whichever accelerators apply:
  // RBF replacement (your own BTC sends) and/or CPFP boost (any tx with a spendable output you own).
  function accelerateTx(it) {
    var canRbf = it.source === 'btc' && it.direction === 'out' && canSignBtc();
    var canCpfp = !!it.ownVout && canSignBtc();
    var opts = '';
    if (canRbf) opts += '<button class="adv-opt" data-accel-do="rbf"><b>⏫ Replace fee (RBF)</b><span>Replace this send with a higher-fee version — same recipient &amp; amount, extra fee comes from your change. Best for your own stuck sends.</span></button>';
    if (canCpfp) opts += '<button class="adv-opt" data-accel-do="cpfp"><b>⚡ Boost (CPFP)</b><span>Spend this transaction’s output in a high-fee child so miners pull both in together. Works for received &amp; Counterparty txs too.</span></button>';
    if (!opts) opts = '<div class="p-hint">This transaction can’t be accelerated from here — there’s no replaceable send and no spendable output to build a child from. It’ll confirm once the mempool clears.</div>';
    overlay('<div class="stamp-detail"><div class="st-head"><div class="st-htitle">Speed up transaction</div><button class="m-close-x" id="axX" title="Close" aria-label="Close">✕</button></div>'
      + '<div class="p-hint">Unconfirmed at <b>' + esc(String(it.feeRate != null ? it.feeRate : '?')) + ' s/vB</b>' + (it.fee != null ? ' · ' + fmt(it.fee, 0) + ' sats fee' : '') + '. Choose how to speed it up:</div>'
      + '<div class="adv-menu">' + opts + '</div>'
      + '<button class="btn ghost" id="axClose">Close</button></div>');
    document.getElementById('axX').onclick = closeOv;
    document.getElementById('axClose').onclick = closeOv;
    var rb = document.querySelector('[data-accel-do="rbf"]'); if (rb) rb.onclick = function () { bumpRbf(it); };
    var cb = document.querySelector('[data-accel-do="cpfp"]'); if (cb) cb.onclick = function () { boostActivity(it); };
  }
  // Shared fee picker for the accelerate windows: Fast / Med / Econ quick-chips (labelled with their
  // live mempool rates) that fill a custom input pre-set to the RECOMMENDED rate — so casual users tap a
  // preset and advanced users just type their own. onChange(rate) fires on every pick or edit.
  function accelFeeRow(fees, recommended, inputId) {
    var f = staggerFees(fees); // strictly descending → value-match can't light up two chips
    var chips = [['Fast', f.fastestFee], ['Med', f.halfHourFee], ['Econ', f.hourFee]];
    return '<div class="fee-row">' + chips.map(function (c) { return '<button type="button" class="feeopt' + (Number(c[1]) === Number(recommended) ? ' on' : '') + '" data-fr="' + c[1] + '">' + c[0] + ' · ' + c[1] + '</button>'; }).join('')
      + '<input id="' + inputId + '" class="fee-custom" type="number" min="0.1" step="0.1" value="' + recommended + '" title="Enter a custom rate"/></div>';
  }
  function wireAccelFee(inputId, onChange, root) {
    root = root || document;
    var inp = root.querySelector('#' + inputId);
    root.querySelectorAll('.feeopt[data-fr]').forEach(function (b) { b.onclick = function () { root.querySelectorAll('.feeopt[data-fr]').forEach(function (x) { x.classList.remove('on'); }); b.classList.add('on'); if (inp) inp.value = b.dataset.fr; onChange(parseFloat(b.dataset.fr)); }; });
    if (inp) inp.oninput = function () { root.querySelectorAll('.feeopt[data-fr]').forEach(function (x) { x.classList.remove('on'); }); var r = parseFloat(inp.value); if (r > 0) onChange(r); };
  }

  // RBF fee-bump: rebuild the SAME send (same recipient + same amount) spending ONLY the original tx's
  // inputs, at a higher fee — so it can only ever replace the stuck tx, never become a second payment.
  async function bumpRbf(it) {
    var self = ACT.addr; if (!self) return;
    overlay('<div class="menu" style="padding:14px"><div class="p-title" style="font-size:15px">⏫ Speed up (RBF)</div><div class="p-hint">Loading transaction…</div></div>');
    var info;
    try { info = await fetch('api/btc/tx/' + encodeURIComponent(it.txid) + '/info').then(function (r) { return r.json(); }); if (info.error) throw new Error(info.error); }
    catch (e) { overlay('<div class="menu" style="padding:14px"><div class="p-title" style="font-size:15px">⏫ Speed up (RBF)</div><div class="p-err">Could not load the transaction — try again.</div><div class="actions"><button class="btn ghost" id="rbfX">Close</button></div></div>'); var x = document.getElementById('rbfX'); if (x) x.onclick = closeOv; return; }
    var recipients = (info.vout || []).filter(function (o) { return o.address && o.address !== self; });
    var inputs = (info.vin || []).map(function (v) { return { txid: v.txid, vout: v.vout, value: v.value }; });
    var totalIn = inputs.reduce(function (a, v) { return a + (v.value || 0); }, 0);
    var hasData = (info.vout || []).some(function (o) { return !o.address && o.value != null; }); // OP_RETURN / data output
    var badReason = '';
    if (info.confirmed) badReason = 'This transaction has already confirmed.';
    else if (hasData) badReason = 'This transaction carries embedded data (Counterparty / Stamps / SRC-20), so it can’t be safely rebuilt. Use CPFP boost instead.';
    else if (recipients.length !== 1) badReason = 'Fee-bump here supports a single-recipient send (this tx has ' + recipients.length + '). CPFP boost still works if it has spendable change.';
    else if (!inputs.length || !totalIn) badReason = 'Could not read the original inputs.';
    if (badReason) { overlay('<div class="menu" style="padding:14px"><div class="p-title" style="font-size:15px">⏫ Speed up (RBF)</div><div class="p-hint">' + esc(badReason) + '</div><div class="actions"><button class="btn ghost" id="rbfX">Close</button></div></div>'); var x2 = document.getElementById('rbfX'); if (x2) x2.onclick = closeOv; return; }
    var recipient = recipients[0].address, amount = recipients[0].value;
    var oldFee = info.fee || it.fee || 0, pv = it.vsize || info.vsize || 150, oldRate = it.feeRate || (pv ? +(oldFee / pv).toFixed(2) : 1);
    var fees = { fastestFee: 20 }; try { fees = await fetch('api/btc/fees').then(function (r) { return r.json(); }); } catch (e) {}
    var minRate = Math.max(1, Math.ceil(oldRate) + 1); // must exceed the old rate to relay
    var rate = Math.max(fees.fastestFee || minRate, minRate);
    var warn = info.rbf ? '' : '<div class="disp-panel" style="display:block"><div class="disp-hit">⚠ This send didn’t opt into RBF. Replacement relies on <b>full-RBF</b> nodes (widely supported now) so it usually works, but propagation isn’t guaranteed everywhere.</div></div>';
    overlay('<div class="menu" style="padding:14px;display:flex;flex-direction:column;gap:9px">'
      + '<div class="p-title" style="font-size:15px">⏫ Speed up (RBF)</div>'
      + '<div class="p-hint">Replace this unconfirmed send (currently <b>' + esc(String(oldRate)) + ' s/vB</b>) with a higher-fee version. Same recipient, same amount — the extra fee comes out of your change.</div>'
      + warn
      + '<div class="p-card" style="display:flex;flex-direction:column;gap:6px"><div class="sd-row"><span class="sd-k">To</span><span class="sd-v" style="font-family:var(--mono);font-size:11px">' + esc(short(recipient)) + '</span></div><div class="sd-row"><span class="sd-k">Amount</span><span class="sd-v">' + fmt(amount / 1e8, 8) + ' BTC</span></div></div>'
      + '<label class="stf"><span>New fee rate <span class="fine">s/vB · recommended ' + esc(String(rate)) + ' · min ' + esc(String(minRate)) + '</span></span></label>' + accelFeeRow(fees, rate, 'rbfRate')
      + '<div id="rbfCalc" class="fine" style="margin-top:8px"></div><div id="rbfStatus" class="p-err"></div>'
      + '<div class="actions"><button class="btn ghost" id="rbfCancel">Cancel</button><button class="btn" id="rbfGo">Bump fee</button></div></div>');
    function estFee(r) { return Math.ceil((it.vsize || pv) * r); }
    function paint() { var r = parseFloat(document.getElementById('rbfRate').value) || rate; var nf = estFee(r); var below = r < minRate; document.getElementById('rbfCalc').innerHTML = 'New fee ≈ <b>' + fmt(nf, 0) + ' sats</b>' + usdSuffix(nf) + ' (was ' + fmt(oldFee, 0) + ' sats @ ' + oldRate + ' s/vB)' + (below ? ' <span style="color:var(--red)">· below the ' + minRate + ' s/vB minimum</span>' : ''); }
    paint();
    wireAccelFee('rbfRate', paint, document.querySelector('#pop-ov .pop-pop'));
    document.getElementById('rbfCancel').onclick = closeOv;
    document.getElementById('rbfGo').onclick = async function () {
      var st = document.getElementById('rbfStatus'); st.className = 'p-hint'; st.textContent = 'Rebuilding & signing…';
      try {
        var newRate = parseFloat(document.getElementById('rbfRate').value);
        if (!(newRate > oldRate)) throw new Error('New rate must be higher than the current ' + oldRate + ' s/vB.');
        var stype = curBtcType(), prevTxs = {};
        if (stype === 'legacy') { st.textContent = 'Fetching previous transactions…'; var uniq = [...new Set(inputs.map(function (x) { return x.txid; }))]; var got = await Promise.all(uniq.map(function (t) { return fetch('api/btc/tx/' + t + '/hex').then(function (r) { return r.ok ? r.text() : null; }).then(function (h) { return [t, h && h.trim()]; }).catch(function () { return [t, null]; }); })); got.forEach(function (p) { if (p[1]) prevTxs[p[0]] = p[1]; }); st.textContent = 'Rebuilding & signing…'; }
        // SAFETY: utxos = ONLY the original inputs → the replacement can spend nothing else, so it must
        // conflict with (replace) the stuck tx. Same recipient + amount preserved; higher fee eats change.
        var signed = C.send({ account: curAccount, importedId: curImportedId(), type: stype, utxos: inputs, recipient: recipient, amountSats: amount, feeRate: newRate, rbf: true, sign: true, prevTxs: prevTxs });
        if (!(signed.fee > oldFee)) throw new Error('That rate doesn’t raise the absolute fee enough to replace it — pick a higher rate.');
        var r = await bcast(signed.txhex);
        if (r.error) throw new Error(r.detail || r.error);
        st.className = 'p-hint'; st.innerHTML = '<span style="color:var(--green)">Replaced ✓ — ' + esc(String(r.txid).slice(0, 20)) + '…</span>';
        setTimeout(function () { closeOv(); ACT.items = null; loadActivity(); }, 1800);
      } catch (e) { st.className = 'p-err'; st.textContent = 'Failed: ' + (e.message === 'insufficient_funds' ? 'The original inputs can’t cover a higher fee (little/no change). Try a lower rate, or use CPFP.' : (e.message || 'replace error')); }
    };
  }
  // CPFP boost: spend the stuck tx's own output (change/receive) in a high-fee child that drags the parent in.
  async function boostActivity(it) {
    if (!it.ownVout) return;
    var from = curBtcAddress(); if (!from) return;
    var fees = { fastestFee: 20 }; try { fees = await fetch('api/btc/fees').then(function (r) { return r.json(); }); } catch (e) {}
    if (!PRICES.bitcoin) { try { PRICES = await fetch('api/prices').then(function (r) { return r.json(); }); } catch (e) {} }
    var pv = it.vsize || 200, pf = it.fee || 0, cv = 111; // parent vsize/fee, child ~1-in/1-out vsize
    var target = Math.max((fees.fastestFee || 20), Math.ceil(it.feeRate || 1) + 3); // recommended: clear the mempool + beat the parent
    function calc(rate) { var childFee = Math.max(1, Math.ceil(rate * (pv + cv) - pf)); return { childFee: childFee, childRate: Math.max(1, Math.round(childFee / cv)), pkgRate: +(((pf + childFee) / (pv + cv)).toFixed(2)) }; }
    var rate = target;
    overlay('<div class="menu" style="padding:14px;display:flex;flex-direction:column;gap:9px">'
      + '<div class="p-title" style="font-size:15px">⚡ Boost (CPFP)</div>'
      + '<div class="p-hint">This send is stuck at <b>' + (it.feeRate || '?') + ' s/vB</b>. A CPFP <b>child</b> (a small tx spending its own output back to you at a high fee) forces miners to confirm both together.</div>'
      + '<label class="stf"><span>Target package rate <span class="fine">s/vB · recommended ' + esc(String(target)) + '</span></span></label>' + accelFeeRow(fees, target, 'boRate')
      + '<div id="boCalc" class="fine" style="margin-top:8px"></div><div id="boStatus" class="p-err"></div>'
      + '<div class="actions"><button class="btn ghost" id="boCancel">Cancel</button><button class="btn" id="boGo">Boost</button></div></div>');
    function paint() { var cc = calc(Math.max(1, parseFloat(document.getElementById('boRate').value) || rate)); document.getElementById('boCalc').innerHTML = 'Child fee <b>' + fmt(cc.childFee, 0) + ' sats</b>' + usdSuffix(cc.childFee) + ' · effective package ≈ <b>' + cc.pkgRate + ' s/vB</b> (parent ' + (it.feeRate || '?') + ')'; }
    paint();
    wireAccelFee('boRate', function () { paint(); }, document.querySelector('#pop-ov .pop-pop'));
    document.getElementById('boCancel').onclick = closeOv;
    document.getElementById('boGo').onclick = async function () {
      var st = document.getElementById('boStatus'); st.className = 'p-hint'; st.textContent = 'Building CPFP child & signing…';
      try {
        var r2 = Math.max(1, parseFloat(document.getElementById('boRate').value) || rate), cc = calc(r2);
        var childRate = Math.max(1, cc.childFee / cv); // sat/vB the core needs to hit ~childFee on the child
        var stype = curBtcType(), prevTxs = {};
        if (stype === 'legacy') { var h = await fetch('api/btc/tx/' + it.txid + '/hex').then(function (x) { return x.ok ? x.text() : null; }).catch(function () { return null; }); if (h) prevTxs[it.txid] = h.trim(); }
        var signed = C.send({ account: curAccount, importedId: curImportedId(), type: stype, utxos: [{ txid: it.txid, vout: it.ownVout.vout, value: it.ownVout.value }], recipient: from, sendMax: true, feeRate: childRate, rbf: true, sign: true, prevTxs: prevTxs });
        var b = await bcast(signed.txhex);
        if (b.error) throw new Error(b.detail || b.error);
        st.className = 'p-hint'; st.innerHTML = '<span style="color:var(--green)">Boosted ✓ — child ' + esc(String(b.txid).slice(0, 16)) + '…</span>';
        setTimeout(function () { closeOv(); ACT.items = null; loadActivity(); }, 1800);
      } catch (e) { st.className = 'p-err'; st.textContent = 'Failed: ' + (e.message === 'insufficient_funds' ? 'The stuck output is too small to pay the boost fee alone.' : (e.message || 'boost error')); }
    };
  }

  // ── Coin Control (UTXO management) — compact popup mirror of the Terminal dashboard. ──
  var CC = { addr: null, data: null, filter: 'all', sel: null, consolidatable: false };
  var CC_REFRESH = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 10-2.3 5.7M20 4v5h-5"/></svg>';
  // Coin Control (UTXO set) + Activity (history) flip icons — the two share one entry point now.
  var GRID_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>';
  var ACT_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
  function renderCoinControl(addr, fromAct) {
    if (!addr) return renderMain();
    CC.addr = addr; CC.filter = 'all'; CC.data = null; CC.sel = new Set();
    var actBtn = fromAct ? '<button class="p-ibtn" id="ccAct" title="Back to Activity">' + ACT_ICON + '</button>' : '';
    app.innerHTML = '<div class="p-head"><button class="p-ibtn" id="bBack" title="Back">←</button><div class="p-brand-mid"><div class="p-name">Coin Control</div><div class="p-sub">' + esc(short(addr)) + '</div></div><div class="p-icons">' + actBtn + '<button class="p-ibtn" id="ccRefresh" title="Rescan UTXOs">' + CC_REFRESH + '</button></div></div>'
      + '<div id="ccBody"><div class="empty">Scanning UTXOs…</div></div>';
    document.getElementById('bBack').onclick = fromAct ? function () { renderActivity(addr); } : renderMain;
    var ccAct = document.getElementById('ccAct'); if (ccAct) ccAct.onclick = function () { renderActivity(addr); };
    document.getElementById('ccRefresh').onclick = function () { CC.data = null; loadCC(); };
    loadCC();
  }
  async function loadCC() {
    var body = document.getElementById('ccBody'); if (body) body.innerHTML = '<div class="empty">Scanning UTXOs…</div>';
    try { CC.data = ccApplyMeta(CC.addr, await fetch('api/btc/' + CC.addr + '/coincontrol').then(function (r) { return r.json(); })); }
    catch (e) { if (body) body.innerHTML = '<div class="p-err" style="margin:14px">Could not scan UTXOs — try again.</div>'; return; }
    renderCC();
  }
  function ccCat(u) { return u.frozen ? 'frozen' : u.timelocked ? 'time-locked' : u.category; }
  function ccSelectable(u) { return u.category === 'spendable' && !u.frozen && !u.timelocked; }
  function renderCC() {
    var body = document.getElementById('ccBody'); if (!body || !CC.data) return;
    var d = CC.data, s = d.summary || {};
    // Consolidation is offered only when THIS panel's address is the active signing account (has keys).
    CC.consolidatable = canSignBtc() && CC.addr === curBtcAddress();
    var b2 = function (sats) { return (sats / 1e8).toLocaleString('en-US', { maximumFractionDigits: 8 }); };
    var filters = ['all', 'spendable', 'protected', 'dust', 'frozen'];
    var rows = (d.utxos || []).filter(function (u) {
      if (CC.filter === 'all') return true;
      if (CC.filter === 'frozen') return u.frozen || u.timelocked;
      return u.category === CC.filter;
    });
    var counts = '<div class="cc-counts">'
      + '<span class="cc-lg spendable">' + (s.spendable || 0) + ' spendable</span>'
      + '<span class="cc-lg protected">' + (s.protected || 0) + ' protected</span>'
      + (s.dust ? '<span class="cc-lg dust">' + s.dust + ' dust</span>' : '')
      + (s.unknown ? '<span class="cc-lg unknown">' + s.unknown + ' unknown</span>' : '')
      + '<span class="cc-lg frozen">' + (s.frozen || 0) + ' frozen</span></div>';
    var filterBar = '<div class="cc-filters">' + filters.map(function (f) { return '<button class="ccf ' + (CC.filter === f ? 'on' : '') + '" data-f="' + f + '">' + f + '</button>'; }).join('') + '</div>';
    var list = rows.length ? rows.map(ccRowHtml).join('') : '<div class="empty">No UTXOs in this filter.</div>';
    body.innerHTML = '<div class="cc-summary">' + counts
      + '<div class="cc-baln">' + mask(b2(d.balanceSats || 0) + ' BTC') + ' · ' + (d.utxos ? d.utxos.length : 0) + ' UTXOs</div>'
      + '<div class="cc-note">Protected (asset-bound), frozen &amp; time-locked coins are never auto-selected when you send — your Stamps &amp; Counterparty assets stay safe.</div></div>'
      + filterBar + '<div class="cc-list">' + list + '</div>'
      + '<div id="ccFoot" class="cc-foot"></div>';
    body.querySelectorAll('.ccf').forEach(function (b) { b.onclick = function () { CC.filter = b.dataset.f; renderCC(); }; });
    ccWireRows();
    ccRenderFoot();
  }
  function ccRowHtml(u) {
    var b2 = (u.value / 1e8).toLocaleString('en-US', { maximumFractionDigits: 8 });
    var carries = (u.carries || []).map(function (c) { return '<span class="cc-carry">' + esc(c.name || c.asset) + '</span>'; }).join('');
    var lockedCls = (u.frozen || u.timelocked) ? ' islocked' : '';
    var canSel = CC.consolidatable && ccSelectable(u);
    var checked = canSel && CC.sel && CC.sel.has(u.utxo);
    var ck = !CC.consolidatable ? '' : (canSel
      ? '<input type="checkbox" class="cc-ck" data-sel="' + esc(u.utxo) + '"' + (checked ? ' checked' : '') + ' title="Select to consolidate"/>'
      : '<span class="cc-ck cc-ck-off" title="Locked / protected — not selectable"></span>');
    return '<div class="cc-row ' + u.category + lockedCls + (checked ? ' ccsel' : '') + '">' + ck + '<div class="cc-main">'
      + '<div class="cc-l1"><span class="cc-val">' + mask(b2 + ' BTC') + '</span><span class="cc-cat ' + ((u.frozen || u.timelocked) ? 'frozen' : u.category) + '">' + ccCat(u) + '</span>' + carries + '</div>'
      + '<div class="cc-l2"><span class="cc-utxo" data-copy="' + esc(u.utxo) + '" title="Copy outpoint">' + esc(u.utxo.slice(0, 10)) + '…:' + u.vout + '</span>'
      + '<span class="cc-conf">' + (u.confirmations == null ? '—' : u.confirmations + ' conf') + '</span>'
      + (u.label ? '<span class="cc-lbl">🏷 ' + esc(u.label) + '</span>' : '')
      + (u.freezeUntil ? '<span class="cc-tl">📅 ' + esc(new Date(u.freezeUntil).toLocaleDateString()) + '</span>' : '')
      + '</div></div><div class="cc-acts">'
      + '<button class="cc-mini' + (u.frozen ? ' on' : '') + '" data-act="freeze" data-u="' + esc(u.utxo) + '">' + (u.frozen ? 'Unfreeze' : 'Freeze') + '</button>'
      + '<button class="cc-mini" data-act="label" data-u="' + esc(u.utxo) + '" title="Label">🏷</button></div></div>';
  }
  function ccWireRows() {
    var body = document.getElementById('ccBody'); if (!body) return;
    body.querySelectorAll('[data-copy]').forEach(function (el) { el.onclick = function () { copy(el.getAttribute('data-copy'), el); }; });
    body.querySelectorAll('[data-act="freeze"]').forEach(function (b) { b.onclick = function () { ccToggleFreeze(b.dataset.u); }; });
    body.querySelectorAll('[data-act="label"]').forEach(function (b) { b.onclick = function () { ccLabel(b.dataset.u); }; });
    body.querySelectorAll('.cc-ck[data-sel]').forEach(function (ck) {
      ck.onchange = function () {
        var u = ck.getAttribute('data-sel');
        if (ck.checked) CC.sel.add(u); else CC.sel.delete(u);
        var row = ck.closest('.cc-row'); if (row) row.classList.toggle('ccsel', ck.checked);
        ccRenderFoot(); // update the footer count/button without a full re-render (keeps scroll)
      };
    });
  }
  function ccToggleFreeze(utxo) {
    var meta = ccGetMeta(CC.addr), cur = meta[utxo] || {};
    cur.frozen = !cur.frozen;
    if (!cur.frozen && !cur.label && !cur.freezeUntil) delete meta[utxo]; else meta[utxo] = cur;
    ccSetMeta(CC.addr, meta); ccApplyMeta(CC.addr, CC.data); renderCC();
  }
  function ccLabel(utxo) {
    var cur = (ccGetMeta(CC.addr)[utxo]) || {};
    overlay('<div class="menu" style="padding:12px;display:flex;flex-direction:column;gap:9px"><div class="p-title" style="font-size:15px">Label UTXO</div>'
      + '<input class="p-in" id="ccLblIn" maxlength="40" placeholder="e.g. cold savings" value="' + esc(cur.label || '') + '" spellcheck="false" autocomplete="off"/>'
      + '<div class="actions"><button class="btn ghost" id="ccLblCancel">Cancel</button><button class="btn" id="ccLblSave">Save</button></div></div>');
    document.getElementById('ccLblCancel').onclick = closeOv;
    document.getElementById('ccLblSave').onclick = function () {
      var v = document.getElementById('ccLblIn').value.trim(), m = ccGetMeta(CC.addr), c = m[utxo] || {};
      if (v) c.label = v; else delete c.label;
      if (!c.frozen && !c.label && !c.freezeUntil) delete m[utxo]; else m[utxo] = c;
      ccSetMeta(CC.addr, m); ccApplyMeta(CC.addr, CC.data); closeOv(); renderCC();
    };
  }

  // ── UTXO consolidation (coin control): sweep the SELECTED spendable UTXOs into one output at the same
  //    address. Only spendable/non-locked coins are selectable, so asset-bearing / frozen coins never enter.
  //    Uses the shared core send builder (correct per-input vsize incl. legacy 148 vB) → local sign → broadcast.
  function ccRenderFoot() {
    var foot = document.getElementById('ccFoot'); if (!foot) return;
    if (!CC.consolidatable) { foot.innerHTML = ''; return; }
    var spendable = (CC.data.utxos || []).filter(ccSelectable);
    if (spendable.length < 2) { foot.innerHTML = '<div class="cc-foot-hint">Consolidation needs 2 or more spendable UTXOs on this address.</div>'; return; }
    var sel = spendable.filter(function (u) { return CC.sel.has(u.utxo); });
    var total = sel.reduce(function (a, u) { return a + u.value; }, 0);
    var allSel = sel.length === spendable.length;
    foot.innerHTML = '<div class="cc-foot-bar">'
      + '<button class="cc-mini" id="ccSelAll">' + (allSel ? 'Clear' : 'All spendable (' + spendable.length + ')') + '</button>'
      + '<span class="cc-foot-info">' + (sel.length ? '<b>' + sel.length + '</b> selected · ' + mask((total / 1e8).toLocaleString('en-US', { maximumFractionDigits: 8 }) + ' BTC') : 'Tick UTXOs to merge') + '</span>'
      + '</div>'
      + (sel.length >= 2 ? '<button class="btn" id="ccConsGo" style="width:100%;margin-top:8px">Consolidate ' + sel.length + ' → 1</button>' : '');
    document.getElementById('ccSelAll').onclick = function () { if (allSel) CC.sel.clear(); else spendable.forEach(function (u) { CC.sel.add(u.utxo); }); renderCC(); };
    var go = document.getElementById('ccConsGo'); if (go) go.onclick = ccConsolidate;
  }

  async function ccConsolidate() {
    if (!CC.consolidatable) return;
    var sel = (CC.data.utxos || []).filter(function (u) { return ccSelectable(u) && CC.sel.has(u.utxo); });
    if (sel.length < 2) return;
    var inList = sel.map(function (u) { return { txid: u.utxo.split(':')[0], vout: u.vout, value: u.value }; });
    var total = sel.reduce(function (a, u) { return a + u.value; }, 0);
    var type = curBtcType(), account = curAccount, importedId = curImportedId(), addr = CC.addr;
    var fees = { fastestFee: 2, halfHourFee: 1, hourFee: 1 };
    try { fees = await fetch('api/btc/fees').then(function (r) { return r.json(); }); } catch (e) {}
    var rate = staggerFees(fees).halfHourFee;
    // Legacy inputs need the full prev-tx (nonWitnessUtxo) even to estimate — fetch once, reuse for signing.
    var prevTxs = {};
    if (type === 'legacy') {
      try {
        var uniq = [...new Set(inList.map(function (u) { return u.txid; }))];
        var got = await Promise.all(uniq.map(function (t) { return fetch('api/btc/tx/' + t + '/hex').then(function (r) { return r.ok ? r.text() : null; }).then(function (h) { return [t, h && h.trim()]; }).catch(function () { return [t, null]; }); }));
        got.forEach(function (p) { if (p[1]) prevTxs[p[0]] = p[1]; });
      } catch (e) {}
    }
    overlay('<div class="menu" style="padding:14px;display:flex;flex-direction:column;gap:10px">'
      + '<div class="p-title" style="font-size:15px">Consolidate ' + sel.length + ' → 1</div>'
      + '<div class="cc-prev-row"><span>Inputs</span><b>' + sel.length + ' · ' + mask((total / 1e8).toLocaleString('en-US', { maximumFractionDigits: 8 }) + ' BTC') + '</b></div>'
      + feeRowHtml(fees)
      + '<div id="ccCalc"></div>'
      + '<div class="p-hint">Merges into one UTXO at ' + esc(short(addr)) + ' — same address, ' + esc(BTC_LABEL[type] || type) + '.</div>'
      + '<div id="ccConsStatus" class="p-hint" style="display:none"></div>'
      + '<div class="actions"><button class="btn ghost" id="ccConsX">Cancel</button><button class="btn" id="ccConsSign">Sign &amp; broadcast</button></div></div>');
    var root = document.querySelector('#pop-ov .pop-pop') || app;
    function calc() {
      var box = document.getElementById('ccCalc'); if (!box) return;
      try {
        var r = C.send({ account: account, importedId: importedId, type: type, utxos: inList, recipient: addr, sendMax: true, feeRate: rate, rbf: true, sign: false, prevTxs: prevTxs });
        box.innerHTML = '<div class="cc-prev-row"><span>Est. size</span><b>~' + r.vsize + ' vB</b></div>'
          + '<div class="cc-prev-row"><span>Fee @ ' + rate + ' s/vB</span><b>' + mask(fmt(r.fee, 0) + ' sats') + usdSuffix(r.fee) + '</b></div>'
          + '<div class="cc-prev-row total"><span>Output (1 UTXO)</span><b>' + mask((r.amountSats / 1e8).toLocaleString('en-US', { maximumFractionDigits: 8 }) + ' BTC') + usdSuffix(r.amountSats) + '</b></div>';
      } catch (e) { box.innerHTML = '<div class="cc-prev-row" style="color:var(--red)">' + esc(e.message === 'locked' ? 'Unlock your wallet to preview.' : (e.message || 'Cannot build')) + '</div>'; }
    }
    wireFeeRow(function (r) { rate = r; calc(); }, root);
    calc();
    document.getElementById('ccConsX').onclick = closeOv;
    document.getElementById('ccConsSign').onclick = async function () {
      var st = document.getElementById('ccConsStatus'); st.style.display = 'block'; st.className = 'p-hint'; st.textContent = 'Signing locally & broadcasting…';
      try {
        var signed = C.send({ account: account, importedId: importedId, type: type, utxos: inList, recipient: addr, sendMax: true, feeRate: rate, rbf: true, sign: true, prevTxs: prevTxs });
        var b = await bcast(signed.txhex);
        if (b.error) throw new Error(b.detail || b.error);
        st.className = 'p-hint'; st.innerHTML = '<span style="color:var(--green)">' + txLinkHtml(b.txid) + ' · consolidated ' + sel.length + ' → 1</span>';
        CC.sel.clear();
        setTimeout(function () { closeOv(); CC.data = null; loadCC(); }, 2600); // rescan so the merged UTXO shows
      } catch (e) { st.className = 'p-err'; st.style.display = 'block'; st.textContent = 'Failed: ' + (e.message || 'sign/broadcast error'); }
    };
  }

  // ── Emblem Vault bridge (the module lives in emblem.js — self-contained modal) ──
  function openEmblem() {
    if (!window.EmblemBridge) return;
    if (acctKind !== 'hd') { overlay('<div class="p-hint" style="padding:14px">Emblem vaulting needs an Ethereum account. Switch to one of your HD accounts — imported BTC-only keys and watch-only addresses can’t mint vault NFTs.</div>'); return; }
    var acc; try { acc = C.accounts(curAccount, 0, NET()); } catch (e) { return; }
    window.EmblemBridge.open(curAccount, acc.ethereum.address, acc.bitcoin.nativeSegwit.address, undefined, { onBack: cpHub });
  }

  // ── Shared BTC fee-rate picker: mempool presets + a custom input that allows sub-sat (e.g. 0.8). ──
  // Strictly-descending fee presets (Fast > Med > Econ, ≥1 apart; lowest tier is the floor). The mempool
  // API often returns EQUAL rates at low load — without this, rows show tied numbers and value-match
  // highlighting lights up more than one. Mirrors the Terminal's window.WWFee.stagger (separate bundle).
  function staggerFees(fees, keys) {
    fees = fees || {}; keys = keys || ['fastestFee', 'halfHourFee', 'hourFee'];
    var num = function (v, d) { var n = Math.round(Number(v)); return (isFinite(n) && n > 0) ? n : d; };
    var out = {}, prev = num(fees[keys[keys.length - 1]], 1);
    out[keys[keys.length - 1]] = prev;
    for (var i = keys.length - 2; i >= 0; i--) { var v = Math.max(num(fees[keys[i]], prev + 1), prev + 1); out[keys[i]] = v; prev = v; }
    return out;
  }
  function feeRowHtml(fees) {
    var f = staggerFees(fees);
    return '<div class="fee-row">'
      + [['fastestFee', 'Fast'], ['halfHourFee', 'Med'], ['hourFee', 'Econ']].map(function (ff, i) { return '<button type="button" class="feeopt' + (i === 1 ? ' on' : '') + '" data-r="' + f[ff[0]] + '">' + ff[1] + ' · ' + f[ff[0]] + '</button>'; }).join('')
      + '<input id="feeCustom" class="fee-custom" type="number" min="0.1" step="0.1" placeholder="custom s/vB"/></div>'
      + '<div id="feeHint" class="fee-hint" hidden></div>';
  }
  // Wires the presets + custom input; calls setRate(n) on every change. Warns on sub-1 rates.
  // root scopes the query (BTC send forms live in #app; the stamp tools live in the overlay).
  function wireFeeRow(setRate, root) {
    root = root || app;
    var hint = root.querySelector('#feeHint');
    function showHint(r) { if (!hint) return; if (r > 0 && r < 1) { hint.hidden = false; hint.textContent = '⚠ Below 1 sat/vB may not relay on all nodes — best when the mempool is near-empty.'; } else { hint.hidden = true; } }
    root.querySelectorAll('.feeopt').forEach(function (b) { b.onclick = function () { root.querySelectorAll('.feeopt').forEach(function (x) { x.classList.remove('on'); }); b.classList.add('on'); var fc = root.querySelector('#feeCustom'); if (fc) fc.value = ''; var r = Number(b.dataset.r); setRate(r); showHint(r); }; });
    var fc = root.querySelector('#feeCustom');
    if (fc) fc.oninput = function () { if (fc.value !== '') { root.querySelectorAll('.feeopt').forEach(function (x) { x.classList.remove('on'); }); var r = Number(fc.value); if (r > 0) { setRate(r); showHint(r); } } };
    // Sync the initial rate to the highlighted (staggered) preset, so the fee actually used matches what's shown.
    var onBtn = root.querySelector('.feeopt.on[data-r]'); if (onBtn) setRate(Number(onBtn.dataset.r));
  }

  // ── inline Bitcoin send ──
  async function renderSend() {
    stopCd();
    var isImp = acctKind === 'imported', useImpId = isImp ? impId : null;
    var acc, sendType, from;
    if (isImp) { var im = currentImported(); if (!im) return render(); sendType = impBtcType(impId); from = (im.bitcoin[sendType] || im.bitcoin.nativeSegwit).address; acc = { account: 0 }; }
    else { try { acc = C.accounts(curAccount, 0, NET()); } catch (e) { return render(); } sendType = acctBtcType(curAccount); from = acc.bitcoin[sendType].address; }
    if (!PRICES.bitcoin) { try { PRICES = await fetch('api/prices').then(function (r) { return r.json(); }); } catch (e) {} }
    var fees = { fastestFee: 10, halfHourFee: 6, hourFee: 3 };
    try { fees = await fetch('api/btc/fees').then(function (r) { return r.json(); }); } catch (e) {}
    var feeRate = fees.halfHourFee || 6;
    app.innerHTML = '<div class="p-head"><button class="p-ibtn" id="bBack" title="Back">←</button><div class="p-brand-mid"><div class="p-name">Send Bitcoin</div><div class="p-sub">' + esc(short(from)) + '</div></div><div class="p-icons"></div></div>'
      + '<div class="send-form">'
      + '<input id="pTo" class="p-in" placeholder="Address or name.btc" spellcheck="false" autocomplete="off" autocapitalize="off"/>'
      + '<div id="pNameRes" class="name-resolve" hidden></div>'
      + '<div id="pDisp" class="disp-panel" hidden></div>'
      + '<div class="send-amt"><input id="pAmt" class="p-in" type="number" step="0.00000001" min="0" placeholder="Amount (BTC)"/><label class="send-max"><input type="checkbox" id="pMax"/> Max</label></div>'
      + '<div id="pAmtUsd" class="send-usd" hidden></div>'
      + feeRowHtml(fees)
      + '<div id="pStatus" class="p-err"></div>'
      + '<button class="btn" id="pReview">Review</button></div>';
    document.getElementById('bBack').onclick = renderMain;
    wireFeeRow(function (r) { feeRate = r; });
    wireDispenser();
    wireAmtUsd('pAmt', 'pMax', 'pAmtUsd');
    document.getElementById('pReview').onclick = async function () {
      var s = document.getElementById('pStatus'); s.className = 'p-hint'; s.textContent = 'Selecting safe UTXOs & signing…';
      try {
        var to = document.getElementById('pTo').value.trim();
        // Resolve a .btc name → address (confirm before sending).
        if (RE_DOTBTC.test(to)) {
          if (!_resName || _resName.name.toLowerCase() !== to.toLowerCase() || !_resName.address) {
            var rr = await fetch('api/src101/resolve/' + encodeURIComponent(to)).then(function (x) { return x.json(); }).catch(function () { return null; });
            if (!rr || !rr.exists || !rr.address) throw new Error('“' + to + '” is not a registered Bitcoin Stamps name.');
            _resName = { name: rr.name, address: rr.address };
          }
          to = _resName.address;
        }
        var sendMax = document.getElementById('pMax').checked;
        var amountSats = sendMax ? 0 : Math.round(parseFloat(document.getElementById('pAmt').value) * 1e8);
        if (!to) throw new Error('Enter a recipient address.');
        if (!sendMax && (!amountSats || amountSats < 0)) throw new Error('Enter a valid amount.');
        var cc = ccApplyMeta(from, await fetch('api/btc/' + from + '/coincontrol').then(function (r) { return r.json(); })); // overlay local freezes/time-locks
        var spendable = (cc.utxos || []).filter(function (u) { return u.category === 'spendable' && !u.frozen && !u.timelocked; }).map(function (u) { return { txid: u.txid, vout: u.vout, value: u.value }; });
        if (!spendable.length) throw new Error('No spendable UTXOs on this address.');
        var prevTxs = {};
        if (sendType === 'legacy') {
          s.textContent = 'Fetching previous transactions…';
          var uniq = [...new Set(spendable.map(function (u) { return u.txid; }))];
          var got = await Promise.all(uniq.map(function (t) { return fetch('api/btc/tx/' + t + '/hex').then(function (r) { return r.ok ? r.text() : null; }).then(function (h) { return [t, h && h.trim()]; }).catch(function () { return [t, null]; }); }));
          got.forEach(function (pair) { if (pair[1]) prevTxs[pair[0]] = pair[1]; });
        }
        var tx = C.send({ account: acc.account, importedId: useImpId, type: sendType, utxos: spendable, recipient: to, amountSats: amountSats, feeRate: feeRate, rbf: true, sendMax: sendMax, prevTxs: prevTxs });
        renderSendPreview(tx, to, _resName && _resName.name);
      } catch (err) { s.className = 'p-err'; s.textContent = err.message === 'insufficient_funds' ? 'Insufficient spendable balance for that + fee.' : (err.message || 'Could not build transaction.'); }
    };
  }
  function wireDispenser() {
    var _dt = null, to = document.getElementById('pTo'), panel = document.getElementById('pDisp'), nr = document.getElementById('pNameRes');
    abAttach(to, 'btc');
    _resName = null;
    to.oninput = function () {
      clearTimeout(_dt);
      var v = to.value.trim();
      // A .btc name → resolve via SRC-101; otherwise clear the banner + run dispenser detection.
      if (RE_DOTBTC.test(v)) {
        _resName = null; panel.style.display = 'none'; panel.innerHTML = '';
        nr.hidden = false; nr.className = 'name-resolve load'; nr.textContent = 'Resolving ' + v + '…';
        _dt = setTimeout(async function () {
          try {
            var r = await fetch('api/src101/resolve/' + encodeURIComponent(v)).then(function (x) { return x.json(); });
            if (to.value.trim() !== v) return;
            if (r && r.exists && r.address) { _resName = { name: r.name, address: r.address }; nr.className = 'name-resolve ok'; nr.innerHTML = '✓ <b>' + esc(r.name) + '</b> → <span class="nr-addr">' + esc(r.address) + '</span>'; }
            else if (r && r.expired) { nr.className = 'name-resolve bad'; nr.textContent = '⚠ ' + v + ' has expired.'; }
            else { nr.className = 'name-resolve bad'; nr.textContent = '✕ ' + v + ' is not registered (SRC-101).'; }
          } catch (e) { nr.className = 'name-resolve bad'; nr.textContent = 'Could not resolve ' + v + '.'; }
        }, 350);
        return;
      }
      _resName = null; nr.hidden = true; nr.innerHTML = '';
      _dt = setTimeout(async function () {
        if (!/^(bc1[a-z0-9]{8,87}|[13][a-km-zA-HJ-NP-Z1-9]{25,39})$/.test(v)) { panel.style.display = 'none'; panel.innerHTML = ''; return; }
        try { var r = await fetch('api/cp/dispensers/' + v).then(function (x) { return x.json(); }); if (to.value.trim() !== v) return; if (!r.dispensers || !r.dispensers.length) { panel.style.display = 'none'; return; } renderDispPanel(r.dispensers[0], panel); } catch (e) { panel.style.display = 'none'; }
      }, 400);
    };
  }
  // Live USD readout under a BTC amount input. Uses the loaded BTC price; updates as the user types and
  // when Max is toggled. Purely a display estimate — the authoritative amount/fee are shown again on Review.
  function wireAmtUsd(amtId, maxId, usdId) {
    var amt = document.getElementById(amtId), mx = document.getElementById(maxId), out = document.getElementById(usdId);
    if (!amt || !out) return;
    var upd = function () {
      var p = Number(PRICES && PRICES.bitcoin) || 0;
      if (mx && mx.checked) { out.hidden = false; out.className = 'send-usd dim'; out.textContent = 'Max — sends the entire spendable balance (minus network fee)'; return; }
      var v = parseFloat(amt.value);
      if (!p || !isFinite(v) || v <= 0) { out.hidden = true; out.textContent = ''; return; }
      out.hidden = false; out.className = 'send-usd';
      out.textContent = '≈ $' + (v * p).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' USD';
    };
    amt.addEventListener('input', upd);
    if (mx) mx.addEventListener('change', upd);
    upd();
  }
  function renderDispPanel(d, panel) {
    panel.style.display = 'block';
    var sats = function (n) { return Number(n).toLocaleString('en-US'); };
    var toUsd = function (sa) { var u = (sa / 1e8) * (PRICES.bitcoin || 0); return u ? ' ≈ $' + u.toLocaleString('en-US', { maximumFractionDigits: 2 }) : ''; };
    var maxDisp = Math.max(1, Math.floor(parseFloat(d.remaining) / parseFloat(d.giveQty)) || 1);
    var opts = [1, 2, 4, 6].filter(function (q) { return q <= maxDisp; }); if (!opts.length) opts.push(1);
    panel.innerHTML = '<div class="disp-hit"><span class="disp-check">✓</span> <b>Dispenser detected.</b> Gives <b>' + esc(d.giveQty) + ' ' + esc(d.asset) + '</b> per <b>' + sats(d.satoshirate) + ' sats</b>' + toUsd(d.satoshirate) + ' · <b>' + maxDisp + '</b> dispense' + (maxDisp === 1 ? '' : 's') + ' left</div>'
      + '<div class="disp-qty"><span class="disp-lbl">Trigger:</span>' + opts.map(function (q) { return '<button type="button" class="disp-q" data-q="' + q + '">' + q + '×</button>'; }).join('') + '</div>'
      + '<div class="disp-cost" id="pDispCost">Pick how many to trigger — it fills the amount.</div>';
    panel.querySelectorAll('.disp-q').forEach(function (b) { b.onclick = function () {
      panel.querySelectorAll('.disp-q').forEach(function (x) { x.classList.toggle('on', x === b); });
      var q = Number(b.dataset.q), totalSats = q * d.satoshirate;
      document.getElementById('pAmt').value = (totalSats / 1e8).toFixed(8); document.getElementById('pMax').checked = false;
      var recv = (parseFloat(d.giveQty) * q).toLocaleString('en-US', { maximumFractionDigits: 8 });
      document.getElementById('pDispCost').innerHTML = '<b>' + q + '×</b> → send <b>' + sats(totalSats) + ' sats</b> (' + (totalSats / 1e8).toFixed(8) + ' BTC' + toUsd(totalSats) + ') + fee → receive ~<b>' + esc(recv) + ' ' + esc(d.asset) + '</b>';
    }; });
  }
  function renderSendPreview(tx, to, named) {
    var btc = function (n) { return (n / 1e8).toLocaleString('en-US', { maximumFractionDigits: 8 }); };
    var usd = function (sa) { var u = (sa / 1e8) * (PRICES.bitcoin || 0); return u ? ' ≈ $' + u.toLocaleString('en-US', { maximumFractionDigits: 2 }) : ''; };
    var toCell = named ? '<b>' + esc(named) + '</b><br><span style="font-family:var(--mono);font-size:10px;color:var(--muted)">' + esc(short(to)) + '</span>' : '<span style="font-family:var(--mono);font-size:11px">' + esc(short(to)) + '</span>';
    app.innerHTML = '<div class="p-head"><button class="p-ibtn" id="bBack" title="Back">←</button><div class="p-brand-mid"><div class="p-name">Confirm send</div></div><div class="p-icons"></div></div>'
      + '<div class="p-card" style="display:flex;flex-direction:column;gap:7px">'
      + '<div class="sd-row"><span class="sd-k">To</span><span class="sd-v">' + toCell + '</span></div>'
      + '<div class="sd-row"><span class="sd-k">Amount</span><span class="sd-v">' + btc(tx.amountSats) + ' BTC' + usd(tx.amountSats) + '</span></div>'
      + '<div class="sd-row"><span class="sd-k">Miner fee</span><span class="sd-v">' + Number(tx.fee).toLocaleString('en-US') + ' sats' + usd(tx.fee) + ' (' + tx.vsize + ' vB)</span></div>'
      + '<div class="sd-row"><span class="sd-k">Change</span><span class="sd-v">' + btc(tx.change || 0) + ' BTC</span></div></div>'
      + '<div id="pbStatus" class="p-err"></div>'
      + '<div class="actions"><button class="btn ghost" id="pbBack">Back</button><button class="btn" id="pbSend">Sign &amp; broadcast</button></div>';
    document.getElementById('bBack').onclick = renderSend;
    document.getElementById('pbBack').onclick = renderSend;
    document.getElementById('pbSend').onclick = async function () {
      var s = document.getElementById('pbStatus'); s.className = 'p-hint'; s.textContent = 'Broadcasting…';
      try {
        var r = await bcast(tx.txhex);
        if (r.error) throw new Error(r.detail || r.error);
        s.className = 'p-hint'; s.innerHTML = txLinkHtml(r.txid);
        setTimeout(renderMain, 1800);
      } catch (err) { s.className = 'p-err'; s.textContent = 'Failed: ' + (err.message || 'broadcast error'); }
    };
  }

  // ── inline SRC-20 transfer ──
  var _availNum = function (a) { return parseFloat(String(a == null ? '' : a).replace(/,/g, '')) || 0; };
  // hex → base64 (WonderHW.signPsbt wants base64, like buildHwSend produces); loop-based for large PSBTs.
  function hex2b64(h) { h = String(h || '').replace(/^0x/, ''); var bin = ''; for (var i = 0; i < h.length; i += 2) bin += String.fromCharCode(parseInt(h.substr(i, 2), 16)); return btoa(bin); }
  async function renderSrc20Send(tick, avail) {
    stopCd();
    var isHw = acctKind === 'hardware' && HW;
    if (!isHw && !canSignBtc()) return renderMain();
    var from = isHw ? currentAddress() : curBtcAddress(); if (!from) return render();
    var fees = { fastestFee: 10, halfHourFee: 6, hourFee: 3 };
    try { fees = await fetch('api/btc/fees').then(function (r) { return r.json(); }); } catch (e) {}
    var feeRate = fees.halfHourFee || 6;
    app.innerHTML = '<div class="p-head"><button class="p-ibtn" id="bBack" title="Back">←</button><div class="p-brand-mid"><div class="p-name">Send ' + esc(tick) + '</div><div class="p-sub">SRC-20 · ' + esc(short(from)) + '</div></div><div class="p-icons"></div></div>'
      + '<div class="send-form">'
      + '<div class="src-avail">Available <b>' + esc(String(avail)) + ' ' + esc(tick) + '</b></div>'
      + '<input id="xTo" class="p-in" placeholder="Address or name.btc" spellcheck="false" autocomplete="off" autocapitalize="off"/>'
      + '<div id="xNameRes" class="name-resolve" hidden></div>'
      + '<div class="send-amt"><input id="xAmt" class="p-in" type="number" step="any" min="0" placeholder="Amount"/><button type="button" class="send-max" id="xMax">Max</button></div>'
      + feeRowHtml(fees)
      + '<div id="xStatus" class="p-err"></div>'
      + '<button class="btn" id="xReview">Review</button></div>';
    document.getElementById('bBack').onclick = backToMain;
    document.getElementById('xMax').onclick = function () { document.getElementById('xAmt').value = _availNum(avail); };
    wireNameResolve('xTo', 'xNameRes'); abAttach(document.getElementById('xTo'), 'btc');
    wireFeeRow(function (r) { feeRate = r; });
    document.getElementById('xReview').onclick = async function () {
      var s = document.getElementById('xStatus'); s.className = 'p-hint'; s.textContent = 'Composing via stampchain…';
      try {
        var to = await resolveRecipientName(document.getElementById('xTo').value.trim());
        var amt = parseFloat(document.getElementById('xAmt').value);
        if (!/^(bc1[a-z0-9]{8,87}|[13][a-km-zA-HJ-NP-Z1-9]{25,39})$/.test(to)) throw new Error('Enter a valid Bitcoin destination address.');
        if (!(amt > 0)) throw new Error('Enter an amount greater than 0.');
        var av = _availNum(avail); if (av && amt > av) throw new Error('You only hold ' + avail + ' ' + tick + '.');
        var params = { op: 'transfer', tick: tick, satsPerVB: feeRate, amt: String(amt), toAddress: to };
        var r = await fetch('api/stamps/src20/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: from, params: params }) }).then(function (x) { return x.json(); });
        if (r.error) throw new Error(r.detail || r.error);
        renderSrc20Preview(r, tick, amt, to, avail);
      } catch (err) { s.className = 'p-err'; s.textContent = /No spendable|compose_failed/i.test(err.message) ? 'Insufficient BTC on this address to compose the transfer.' : (err.message || 'Could not compose transfer.'); }
    };
  }
  function renderSrc20Preview(r, tick, amt, to, avail) {
    var sat = function (n) { return Number(n).toLocaleString('en-US') + ' sats'; };
    app.innerHTML = '<div class="p-head"><button class="p-ibtn" id="bBack" title="Back">←</button><div class="p-brand-mid"><div class="p-name">Confirm transfer</div></div><div class="p-icons"></div></div>'
      + '<div class="p-card" style="display:flex;flex-direction:column;gap:7px">'
      + '<div class="sd-row"><span class="sd-k">Send</span><span class="sd-v">' + esc(String(amt)) + ' ' + esc(tick) + '</span></div>'
      + '<div class="sd-row"><span class="sd-k">To</span><span class="sd-v" style="font-family:var(--mono);font-size:11px">' + esc(short(to)) + '</span></div>'
      + '<div class="sd-row"><span class="sd-k">Miner fee</span><span class="sd-v">' + sat(r.fee) + usdSuffix(r.fee) + (r.vsize ? ' (' + r.vsize + ' vB)' : '') + '</span></div>'
      + (r.change != null ? '<div class="sd-row"><span class="sd-k">Change</span><span class="sd-v">' + sat(r.change) + '</span></div>' : '') + '</div>'
      + '<div class="disp-panel" style="display:block"><div class="disp-hit">Signed locally, then broadcast. This writes a permanent SRC-20 transfer to Bitcoin — it can\'t be undone.</div></div>'
      + '<div id="xbStatus" class="p-err"></div>'
      + '<div class="actions"><button class="btn ghost" id="xbBack">Back</button><button class="btn" id="xbSend">Sign &amp; broadcast</button></div>';
    document.getElementById('bBack').onclick = function () { renderSrc20Send(tick, avail); };
    document.getElementById('xbBack').onclick = function () { renderSrc20Send(tick, avail); };
    document.getElementById('xbSend').onclick = async function () {
      var s = document.getElementById('xbStatus'); s.className = 'p-hint';
      var isHw = acctKind === 'hardware' && HW;
      try {
        var stype = isHw ? hwBt : curBtcType(), signed;
        // NOTE: SRC-20 uses P2WSH data outputs (not OP_RETURN), so the change→source invariant does
        // not apply — output verification is intentionally skipped here (see audit follow-up).
        if (isHw) { // Ledger: device signs + finalizes the composed stampchain PSBT → broadcast-ready hex
          s.textContent = 'Confirm on your Ledger — verify the recipient & amount on the device…';
          var HWm = await hwLoadBundle(); await HWm.connect();
          var res = await HWm.signPsbt(hex2b64(r.hex), HW.account || 0, stype);
          if (!res || !res.txhex) throw new Error('The Ledger did not return a signed transaction — re-pair and retry.');
          signed = { txhex: res.txhex };
        } else {
          s.textContent = 'Signing locally & broadcasting…';
          var prevTxs = {};
          if (stype === 'legacy') { s.textContent = 'Fetching previous transactions…'; var uniq = [...new Set(C.psbtInputs(r.hex).map(function (x) { return x.txid; }))]; var got = await Promise.all(uniq.map(function (t) { return fetch('api/btc/tx/' + t + '/hex').then(function (z) { return z.ok ? z.text() : null; }).then(function (h) { return [t, h && h.trim()]; }).catch(function () { return [t, null]; }); })); got.forEach(function (p) { if (p[1]) prevTxs[p[0]] = p[1]; }); }
          signed = C.signStamp(r.hex, curAccount, stype, prevTxs, curImportedId());
        }
        s.textContent = 'Broadcasting…';
        var b = await bcast(signed.txhex);
        if (b.error) throw new Error(b.detail || b.error);
        s.className = 'p-hint'; s.innerHTML = txLinkHtml(b.txid);
        setTimeout(backToMain, 1800);
      } catch (err) { s.className = 'p-err'; s.textContent = 'Failed: ' + (err.message || 'sign/broadcast error'); }
    };
  }
  // SRC-20 deploy / mint (first-party, native in the popup). Same compose→signStamp→broadcast path as
  // renderSrc20Send (transfer), so no new dependency and no broken-feature risk.
  function src20CreateChoose() {
    overlay('<div class="stamp-detail"><div class="st-head"><button class="p-ibtn" id="s20cBack" title="Back">←</button><div class="st-htitle">SRC-20 deploy / mint</div><button class="m-close-x" id="s20cX" title="Close" aria-label="Close">✕</button></div>'
      + '<div class="menu" style="display:flex;flex-direction:column;gap:9px;margin-top:2px">'
      + '<button class="menu-opt" data-op="deploy"><span>Deploy a new token<br><span class="fine">Register a ticker with a max supply &amp; per-mint limit</span></span></button>'
      + '<button class="menu-opt" data-op="mint"><span>Mint an existing token<br><span class="fine">Mint from a ticker that\'s already deployed</span></span></button></div></div>');
    document.getElementById('s20cBack').onclick = cpHub;
    document.getElementById('s20cX').onclick = closeOv;
    document.querySelectorAll('#pop-ov [data-op]').forEach(function (b) { b.onclick = function () { renderSrc20Create(b.dataset.op); }; });
  }
  // Live SRC-20 ticker/namespace check as the user types, mirroring the web Terminal:
  //  deploy → ✓ available / ✗ taken   ·   mint → ✓ mintable (shows per-mint limit) / not-deployed / fully-minted
  function wireSrc20TickCheck(op) {
    var inp = document.getElementById('s_tick'), chip = document.getElementById('s_tickchk'), limHint = document.getElementById('s_mintlim');
    if (!inp || !chip) return;
    var set = function (txt, color) { chip.textContent = txt; chip.style.color = color || ''; };
    var t = null;
    inp.addEventListener('input', function () {
      clearTimeout(t);
      if (limHint) { limHint.textContent = ''; }
      inp.removeAttribute('data-lim');
      var v = inp.value.trim();
      if (!v) return set('');
      if (v.length > 5) return set('max 5 characters', 'var(--red)');
      set('checking…', '');
      t = setTimeout(async function () {
        try {
          var st = await fetch('api/stamps/src20/tick/' + encodeURIComponent(v)).then(function (x) { return x.json(); });
          if (inp.value.trim() !== v) return; // stale — user kept typing
          if (op === 'deploy') {
            if (st.deployed) set('✗ taken', 'var(--red)'); else set('✓ available', 'var(--green)');
          } else {
            if (!st.deployed) set('✗ not deployed', 'var(--red)');
            else if (st.complete || Number(st.mints_left) <= 0) set('✗ fully minted', 'var(--red)');
            else {
              set('✓ mintable', 'var(--green)');
              if (st.limit) { inp.setAttribute('data-lim', st.limit); if (limHint) limHint.textContent = '· max ' + Number(st.limit).toLocaleString('en-US') + '/mint'; }
            }
          }
        } catch (e) { set(''); }
      }, 350);
    });
  }
  async function renderSrc20Create(op) {
    stopCd();
    if (!canSignBtc()) return renderMain();
    var from = curBtcAddress(); if (!from) return render();
    var fees = { fastestFee: 10, halfHourFee: 6, hourFee: 3 };
    try { fees = await fetch('api/btc/fees').then(function (r) { return r.json(); }); } catch (e) {}
    var feeRate = fees.halfHourFee || 6;
    var fields = op === 'deploy'
      ? '<label class="cpf"><span>Ticker <span id="s_tickchk" class="fine"></span></span><input id="s_tick" class="p-in" maxlength="5" spellcheck="false" autocomplete="off" placeholder="e.g. WNDR"/></label>'
        + '<label class="cpf"><span>Max supply</span><input id="s_max" class="p-in" type="number" min="0" step="any"/></label>'
        + '<label class="cpf"><span>Per-mint limit</span><input id="s_lim" class="p-in" type="number" min="0" step="any"/></label>'
        + '<label class="cpf"><span>Decimals (0–18)</span><input id="s_dec" class="p-in" type="number" min="0" max="18" step="1" value="18"/></label>'
      : '<label class="cpf"><span>Ticker <span id="s_tickchk" class="fine"></span></span><input id="s_tick" class="p-in" maxlength="5" spellcheck="false" autocomplete="off" placeholder="e.g. WNDR"/></label>'
        + '<label class="cpf"><span>Amount to mint <span id="s_mintlim" class="fine"></span></span><input id="s_amt" class="p-in" type="number" min="0" step="any"/></label>';
    overlay('<div class="stamp-detail"><div class="st-head"><button class="p-ibtn" id="s20Back" title="Back">←</button><div class="st-htitle">' + (op === 'deploy' ? 'Deploy SRC-20' : 'Mint SRC-20') + '</div><button class="m-close-x" id="s20X" title="Close" aria-label="Close">✕</button></div>'
      + '<div class="cph-from">from ' + esc(short(from)) + '</div>'
      + '<div class="send-form">' + fields + feeRowHtml(fees)
      + '<div id="xStatus" class="p-err"></div><button class="btn" id="xReview">Review</button></div></div>');
    document.getElementById('s20Back').onclick = src20CreateChoose;
    document.getElementById('s20X').onclick = closeOv;
    var s20pop = document.querySelector('#pop-ov .pop-pop');
    wireFeeRow(function (r) { feeRate = r; }, s20pop);
    wireSrc20TickCheck(op); // live ticker/namespace availability chip
    document.getElementById('xReview').onclick = async function () {
      var s = document.getElementById('xStatus'); s.className = 'p-hint'; s.textContent = 'Composing via stampchain…';
      try {
        var tick = (document.getElementById('s_tick').value || '').trim();
        if (!(tick.length >= 1 && tick.length <= 5)) throw new Error('Ticker must be 1–5 characters.');
        var params = { op: op, tick: tick, satsPerVB: feeRate }, summ;
        if (op === 'deploy') {
          var st = await fetch('api/stamps/src20/tick/' + encodeURIComponent(tick)).then(function (x) { return x.json(); });
          if (st.deployed) throw new Error('Ticker "' + tick + '" is already registered — choose another.');
          var max = parseFloat(document.getElementById('s_max').value), lim = parseFloat(document.getElementById('s_lim').value), dec = parseInt(document.getElementById('s_dec').value, 10);
          if (!(max > 0)) throw new Error('Max supply must be greater than 0.');
          if (!(lim > 0 && lim <= max)) throw new Error('Per-mint limit must be > 0 and ≤ max supply.');
          if (!(Number.isInteger(dec) && dec >= 0 && dec <= 18)) throw new Error('Decimals must be a whole number 0–18.');
          params.max = String(max); params.lim = String(lim); params.dec = dec;
          summ = 'max ' + max + ' · ' + lim + '/mint · ' + dec + ' dec';
        } else {
          var amt = parseFloat(document.getElementById('s_amt').value);
          if (!(amt > 0)) throw new Error('Amount must be greater than 0.');
          var st2 = await fetch('api/stamps/src20/tick/' + encodeURIComponent(tick)).then(function (x) { return x.json(); });
          if (!st2.deployed) throw new Error('Ticker "' + tick + '" isn\'t deployed yet — nothing to mint.');
          if (st2.complete || Number(st2.mints_left) <= 0) throw new Error('"' + tick + '" is fully minted — no mints left.');
          if (st2.limit && amt > parseFloat(st2.limit)) throw new Error('Max per mint for "' + tick + '" is ' + Number(st2.limit).toLocaleString('en-US') + '.');
          params.amt = String(amt); summ = 'mint ' + amt + ' ' + tick;
        }
        var r = await fetch('api/stamps/src20/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: from, params: params }) }).then(function (x) { return x.json(); });
        if (r.error) throw new Error(r.detail || r.error);
        if (!r.hex) throw new Error('compose_empty');
        renderSrc20CreatePreview(op, r, tick, summ);
      } catch (err) {
        var m = String(err.message || '');
        s.className = 'p-err';
        if (/No spendable|insufficient|not enough/i.test(m)) s.textContent = 'Not enough spendable BTC here to fund the ' + op + ' (asset-bearing UTXOs are protected). Add some plain BTC and retry.';
        else if (/aborted|abort|timeout|process SRC20|INTERNAL|upstream|502|500|compose_empty|Failed to process/i.test(m)) s.textContent = 'The SRC-20 compose service is temporarily unavailable — please try again in a moment.';
        else s.textContent = m || 'Could not compose the ' + op + '.';
      }
    };
  }
  function renderSrc20CreatePreview(op, r, tick, summ) {
    var sat = function (n) { return Number(n).toLocaleString('en-US') + ' sats'; };
    var pop = document.querySelector('#pop-ov .pop-pop'); if (!pop) return renderSrc20Create(op);
    pop.innerHTML = '<div class="stamp-detail"><div class="st-head"><button class="p-ibtn" id="s20pBack" title="Back">←</button><div class="st-htitle">Confirm ' + (op === 'deploy' ? 'deploy' : 'mint') + '</div><button class="m-close-x" id="s20pX" title="Close" aria-label="Close">✕</button></div>'
      + '<div class="p-card" style="display:flex;flex-direction:column;gap:7px">'
      + '<div class="sd-row"><span class="sd-k">' + (op === 'deploy' ? 'Deploy' : 'Mint') + '</span><span class="sd-v">' + esc(tick) + '</span></div>'
      + '<div class="sd-row"><span class="sd-k">Details</span><span class="sd-v">' + esc(summ) + '</span></div>'
      + '<div class="sd-row"><span class="sd-k">Miner fee</span><span class="sd-v">' + sat(r.fee) + usdSuffix(r.fee) + (r.vsize ? ' (' + r.vsize + ' vB)' : '') + '</span></div>'
      + (r.change != null ? '<div class="sd-row"><span class="sd-k">Change</span><span class="sd-v">' + sat(r.change) + '</span></div>' : '') + '</div>'
      + '<div class="disp-panel" style="display:block"><div class="disp-hit">Signed locally, then broadcast. This writes a permanent SRC-20 ' + (op === 'deploy' ? 'deployment' : 'mint') + ' to Bitcoin — it can\'t be undone.</div></div>'
      + '<div id="xbStatus" class="p-err"></div>'
      + '<div class="actions"><button class="btn ghost" id="xbBack">Back</button><button class="btn" id="xbSend">Sign &amp; broadcast</button></div></div>';
    document.getElementById('s20pBack').onclick = function () { renderSrc20Create(op); };
    document.getElementById('s20pX').onclick = closeOv;
    document.getElementById('xbBack').onclick = function () { renderSrc20Create(op); };
    document.getElementById('xbSend').onclick = async function () {
      var s = document.getElementById('xbStatus'); s.className = 'p-hint'; s.textContent = 'Signing locally & broadcasting…';
      try {
        var stype = curBtcType(), prevTxs = {};
        if (stype === 'legacy') { s.textContent = 'Fetching previous transactions…'; var uniq = [...new Set(C.psbtInputs(r.hex).map(function (x) { return x.txid; }))]; var got = await Promise.all(uniq.map(function (t) { return fetch('api/btc/tx/' + t + '/hex').then(function (z) { return z.ok ? z.text() : null; }).then(function (h) { return [t, h && h.trim()]; }).catch(function () { return [t, null]; }); })); got.forEach(function (p) { if (p[1]) prevTxs[p[0]] = p[1]; }); s.textContent = 'Signing locally & broadcasting…'; }
        var signed = C.signStamp(r.hex, curAccount, stype, prevTxs, curImportedId());
        var b = await bcast(signed.txhex);
        if (b.error) throw new Error(b.detail || b.error);
        s.className = 'p-hint'; s.innerHTML = txLinkHtml(b.txid);
        setTimeout(function () { closeOv(); renderMain(); }, 1800);
      } catch (err) { s.className = 'p-err'; s.textContent = 'Failed: ' + (err.message || 'sign/broadcast error'); }
    };
  }

  // ── inline Ethereum send (native + ERC-20) ──
  function toBaseUnits(amountStr, decimals) {
    var p = String(amountStr).trim().split('.'), w = p[0] || '0', f = p[1] || '';
    var frac = (f + '0'.repeat(decimals)).slice(0, decimals);
    return BigInt(w) * (BigInt(10) ** BigInt(decimals)) + BigInt(frac || '0');
  }
  var toHexWei = function (bi) { return '0x' + bi.toString(16); };
  var RE_EVM = /^0x[0-9a-fA-F]{40}$/, RE_SOL = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

  function sendShell(title, sub) {
    app.innerHTML = '<div class="p-head"><button class="p-ibtn" id="bBack" title="Back">←</button><div class="p-brand-mid"><div class="p-name">' + esc(title) + '</div><div class="p-sub">' + esc(sub) + '</div></div><div class="p-icons"></div></div>'
      + '<div id="sendBody"><div class="empty">Loading…</div></div>';
    document.getElementById('bBack').onclick = renderMain;
  }

  async function renderEvmSend(preAddr) {
    stopCd();
    var acc; try { acc = C.accounts(curAccount, 0, NET()); } catch (e) { return render(); }
    var addr = acc.ethereum.address;
    sendShell('Send Ethereum', short(addr));
    var data = {}; try { data = await fetch('api/eth/' + encodeURIComponent(addr) + '?network=' + ethNet() + '').then(function (r) { return r.json(); }); } catch (e) {}
    var netName = data.networkName || 'Ethereum', explorer = data.explorer || 'https://etherscan.io';
    var assets = [{ symbol: 'ETH', decimals: 18, native: true, amount: data.eth }].concat((data.tokens || []).map(function (t) { return { symbol: t.symbol, decimals: t.decimals, address: t.address, amount: t.amount }; }));
    // Pre-select the token the user tapped "send" on (from the token list), else default to ETH.
    var preIdx = 0;
    if (preAddr) { for (var pi = 0; pi < assets.length; pi++) { if (assets[pi].address && assets[pi].address.toLowerCase() === String(preAddr).toLowerCase()) { preIdx = pi; break; } } }
    var body = document.getElementById('sendBody'); if (!body) return;
    body.innerHTML = '<div class="send-form">'
      + '<label class="stf"><span>Asset</span><select id="evAsset" class="p-in">' + assets.map(function (a, i) { return '<option value="' + i + '"' + (i === preIdx ? ' selected' : '') + '>' + esc(a.symbol) + (a.native ? '' : ' (' + esc(String(a.amount)) + ')') + '</option>'; }).join('') + '</select></label>'
      + '<input id="evTo" class="p-in" placeholder="Recipient (0x…)" spellcheck="false" autocomplete="off"/>'
      + '<input id="evAmt" class="p-in" type="number" step="any" min="0" placeholder="Amount"/>'
      + '<div id="evStatus" class="p-err"></div>'
      + '<button class="btn" id="evReview">Review</button></div>';
    abAttach(document.getElementById('evTo'), 'eth');
    document.getElementById('evReview').onclick = async function () {
      var s = document.getElementById('evStatus'); s.className = 'p-hint'; s.textContent = 'Preparing & signing…';
      try {
        var a = assets[Number(document.getElementById('evAsset').value)];
        var to = document.getElementById('evTo').value.trim();
        if (!RE_EVM.test(to)) throw new Error('Enter a valid 0x recipient.');
        var amt = document.getElementById('evAmt').value.trim();
        if (!(parseFloat(amt) > 0)) throw new Error('Enter an amount greater than 0.');
        var txTo, valueWei, dataHex, human;
        if (a.native) { txTo = to; valueWei = toHexWei(toBaseUnits(amt, 18)); dataHex = '0x'; human = amt + ' ETH'; }
        else { txTo = a.address; valueWei = '0x0'; dataHex = C.erc20TransferData(to, toBaseUnits(amt, a.decimals)); human = amt + ' ' + a.symbol; }
        var prep = await fetch('api/eth/prepare', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from: addr, to: txTo, valueWei: valueWei, data: dataHex, network: ethNet() }) }).then(function (r) { return r.json(); });
        if (prep.error) throw new Error(prep.detail || prep.error);
        var signed = C.sendEvm({ account: curAccount, to: txTo, valueWei: valueWei, data: dataHex, nonce: prep.nonce, chainId: prep.chainId, maxFeePerGas: prep.maxFeePerGas, maxPriorityFeePerGas: prep.maxPriorityFeePerGas, gasLimit: prep.gasLimit });
        var gasEth = Number(BigInt(prep.gasLimit) * BigInt(prep.maxFeePerGas)) / 1e18;
        evmConfirm({ signed: signed, human: human, to: to, netName: netName, explorer: explorer, gasEth: gasEth, nonce: prep.nonce, gasLimit: parseInt(prep.gasLimit, 16) });
      } catch (err) { s.className = 'p-err'; s.textContent = /insufficient/i.test(err.message || '') ? 'Insufficient balance for that + gas.' : (err.message || 'Could not prepare transaction.'); }
    };
  }
  function evmConfirm(x) {
    app.innerHTML = '<div class="p-head"><button class="p-ibtn" id="bBack" title="Back">←</button><div class="p-brand-mid"><div class="p-name">Confirm send</div></div><div class="p-icons"></div></div>'
      + '<div class="p-card" style="display:flex;flex-direction:column;gap:7px">'
      + '<div class="sd-row"><span class="sd-k">Send</span><span class="sd-v">' + esc(x.human) + '</span></div>'
      + '<div class="sd-row"><span class="sd-k">To</span><span class="sd-v" style="font-family:var(--mono);font-size:11px">' + esc(short(x.to)) + '</span></div>'
      + '<div class="sd-row"><span class="sd-k">Network</span><span class="sd-v">' + esc(x.netName) + '</span></div>'
      + '<div class="sd-row"><span class="sd-k">Max gas</span><span class="sd-v">' + fmt(x.gasEth, 8) + ' ETH</span></div>'
      + '<div class="sd-row"><span class="sd-k">Nonce</span><span class="sd-v">' + x.nonce + '</span></div></div>'
      + '<div id="evbStatus" class="p-err"></div>'
      + '<div class="actions"><button class="btn ghost" id="evbBack">Back</button><button class="btn" id="evbGo">Broadcast</button></div>';
    document.getElementById('bBack').onclick = renderEvmSend;
    document.getElementById('evbBack').onclick = renderEvmSend;
    document.getElementById('evbGo').onclick = async function () {
      var s = document.getElementById('evbStatus'); s.className = 'p-hint'; s.textContent = 'Broadcasting…';
      try {
        var r = await fetch('api/eth/broadcast', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ raw: x.signed.raw, network: ethNet() }) }).then(function (z) { return z.json(); });
        if (r.error) throw new Error(r.detail || r.error);
        s.className = 'p-hint'; s.innerHTML = ethTxLinkHtml(r.txhash);
        setTimeout(renderMain, 2000);
      } catch (err) { s.className = 'p-err'; s.textContent = 'Rejected: ' + (err.message || 'broadcast failed'); }
    };
  }

  // ── inline Solana send (native + SPL) ──
  async function renderSolSend() {
    stopCd();
    var acc; try { acc = C.accounts(curAccount, 0, NET()); } catch (e) { return render(); }
    var addr = acc.solana.address;
    sendShell('Send Solana', short(addr));
    var data = {}; try { data = await fetch('api/sol/' + encodeURIComponent(addr)).then(function (r) { return r.json(); }); } catch (e) {}
    var assets = [{ symbol: 'SOL', decimals: 9, native: true, amount: data.sol }].concat((data.tokens || []).filter(function (t) { return t.amount > 0; }).map(function (t) { return { symbol: short(t.mint), mint: t.mint, decimals: t.decimals, amount: t.amount }; }));
    var body = document.getElementById('sendBody'); if (!body) return;
    body.innerHTML = '<div class="send-form">'
      + '<label class="stf"><span>Asset</span><select id="soAsset" class="p-in">' + assets.map(function (a, i) { return '<option value="' + i + '">' + esc(a.symbol) + (a.native ? '' : ' (' + esc(String(a.amount)) + ')') + '</option>'; }).join('') + '</select></label>'
      + '<input id="soTo" class="p-in" placeholder="Recipient Solana address" spellcheck="false" autocomplete="off"/>'
      + '<input id="soAmt" class="p-in" type="number" step="any" min="0" placeholder="Amount"/>'
      + '<div id="soStatus" class="p-err"></div>'
      + '<button class="btn" id="soReview">Review</button></div>';
    abAttach(document.getElementById('soTo'), 'sol');
    document.getElementById('soReview').onclick = async function () {
      var s = document.getElementById('soStatus'); s.className = 'p-hint'; s.textContent = 'Building & signing…';
      try {
        var a = assets[Number(document.getElementById('soAsset').value)];
        var to = document.getElementById('soTo').value.trim();
        if (!RE_SOL.test(to)) throw new Error('Enter a valid Solana address.');
        var amt = document.getElementById('soAmt').value.trim();
        if (!(parseFloat(amt) > 0)) throw new Error('Enter an amount greater than 0.');
        var bh = await fetch('api/sol/blockhash').then(function (r) { return r.json(); });
        var signed, human;
        if (a.native) { signed = C.sendSol({ account: curAccount, to: to, lamports: toBaseUnits(amt, 9), blockhash: bh.blockhash }); human = amt + ' SOL'; }
        else { signed = C.sendSpl({ account: curAccount, to: to, mint: a.mint, amount: toBaseUnits(amt, a.decimals), decimals: a.decimals, blockhash: bh.blockhash }); human = amt + ' ' + a.symbol; }
        var sim = null; try { sim = await fetch('api/sol/simulate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ txBase64: signed.txBase64 }) }).then(function (r) { return r.json(); }); } catch (e) {}
        solConfirm({ signed: signed, human: human, to: to, sim: sim });
      } catch (err) { s.className = 'p-err'; s.textContent = err.message || 'Could not build transaction.'; }
    };
  }
  function solConfirm(x) {
    var simNote = x.sim ? (x.sim.err ? '<div class="disp-panel" style="display:block"><div class="disp-hit">Simulation: ' + esc(JSON.stringify(x.sim.err)).slice(0, 70) + ' (expected if the source is unfunded — signature &amp; structure are valid).</div></div>' : '<div class="st-sub">Simulation OK · ' + esc(String(x.sim.unitsConsumed || '—')) + ' compute units.</div>') : '';
    app.innerHTML = '<div class="p-head"><button class="p-ibtn" id="bBack" title="Back">←</button><div class="p-brand-mid"><div class="p-name">Confirm send</div></div><div class="p-icons"></div></div>'
      + '<div class="p-card" style="display:flex;flex-direction:column;gap:7px">'
      + '<div class="sd-row"><span class="sd-k">Send</span><span class="sd-v">' + esc(x.human) + '</span></div>'
      + '<div class="sd-row"><span class="sd-k">To</span><span class="sd-v" style="font-family:var(--mono);font-size:11px">' + esc(short(x.to)) + '</span></div></div>'
      + simNote
      + '<div id="sobStatus" class="p-err"></div>'
      + '<div class="actions"><button class="btn ghost" id="sobBack">Back</button><button class="btn" id="sobGo">Broadcast</button></div>';
    document.getElementById('bBack').onclick = renderSolSend;
    document.getElementById('sobBack').onclick = renderSolSend;
    document.getElementById('sobGo').onclick = async function () {
      var s = document.getElementById('sobStatus'); s.className = 'p-hint'; s.textContent = 'Broadcasting…';
      try {
        var r = await fetch('api/sol/broadcast', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ txBase64: x.signed.txBase64 }) }).then(function (z) { return z.json(); });
        if (r.error) throw new Error(r.detail || r.error);
        s.className = 'p-hint'; s.innerHTML = solTxLinkHtml(r.signature);
        setTimeout(renderMain, 2000);
      } catch (err) { s.className = 'p-err'; s.textContent = 'Rejected: ' + (err.message || 'broadcast failed'); }
    };
  }

  document.addEventListener('ww-lockstate', function () { render(); });
  // Live-sync the Ledger pairing across surfaces: when the connect tab pairs (writes ww:ledger), any
  // already-open popup/side panel picks it up immediately (storage events fire in OTHER same-origin pages).
  window.addEventListener('storage', function (e) { if (e.key === 'ww:ledger') { try { HW = lsGet('ww:ledger', null); } catch (x) { HW = null; } if (HW && acctKind !== 'hardware') { /* keep current view; Ledger now available in the dropdown */ } render(); } });
  (window.WWSession ? window.WWSession.ready : Promise.resolve()).then(function () {
    try { restoreLast(); } catch (e) {}
    if (IS_HW_WIN) hwLandingPage(); else if (IS_BACKUP_WIN) backupPage(); else render(); // ?hw=1 → hardware; ?backup=1 → Backup & Restore; else the wallet
  });
})();
