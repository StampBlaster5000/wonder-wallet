/* Wonder Wallet — client Testnet Mode.
 *
 * One small module owns the network state for the whole Terminal:
 *   • persists mainnet|testnet in localStorage
 *   • injects an `x-ww-network: testnet` header on our own `api/…` calls, so every read
 *     the server proxies (BTC testnet4 / Counterparty testnet4 / SOL devnet) is scoped
 *     without touching the hundreds of scattered fetch() call sites
 *   • maps EVM to Sepolia while in testnet
 *   • paints the persistent orange TESTNET banner + a topbar chip
 *
 * Testnet is strictly additive — default is mainnet and behaves exactly as before.
 */
(function () {
  'use strict';
  var KEY = 'ww:netmode';
  var listeners = [];

  function get() { try { return localStorage.getItem(KEY) === 'testnet' ? 'testnet' : 'mainnet'; } catch (_) { return 'mainnet'; } }
  function isTestnet() { return get() === 'testnet'; }
  function evm() { return isTestnet() ? 'sepolia' : 'ethereum'; }        // EVM network name for the active mode
  function label() { return isTestnet() ? 'Testnet' : 'Mainnet'; }

  function set(mode) {
    var m = mode === 'testnet' ? 'testnet' : 'mainnet';
    var was = get();
    try { localStorage.setItem(KEY, m); } catch (_) {}
    paint();
    if (m !== was) listeners.forEach(function (fn) { try { fn(m); } catch (_) {} });
    return m;
  }
  function toggle() { return set(isTestnet() ? 'mainnet' : 'testnet'); }
  function onChange(fn) { if (typeof fn === 'function') listeners.push(fn); }

  // ── fetch interceptor — tag our own relative api/ calls with the active network ──
  // The network rides as a QUERY PARAM (?network=testnet), not a header: it needs no CORS
  // preflight AND gives testnet its own cache-distinct URL, so a cached testnet response can
  // never be served for a mainnet request (or vice-versa). Only same-origin relative 'api/…'
  // paths are touched; external absolute URLs are never rewritten.
  var _fetch = window.fetch.bind(window);
  function addNet(url) { return url + (String(url).indexOf('?') >= 0 ? '&' : '?') + 'network=testnet'; }
  window.fetch = function (input, init) {
    try {
      if (isTestnet()) {
        var url = typeof input === 'string' ? input : (input && input.url) || '';
        var external = /^[a-z]+:\/\//i.test(url);
        if (!external && /(^|\/)api\//.test(url) && !/[?&]network=/.test(url)) {
          if (typeof input === 'string') input = addNet(input);
          else if (input && input.url) input = new Request(addNet(input.url), input);
        }
      }
    } catch (_) {}
    return _fetch(input, init);
  };

  // ── banner + topbar chip ──
  function ensureStyle() {
    if (document.getElementById('ww-net-style')) return;
    var s = document.createElement('style');
    s.id = 'ww-net-style';
    s.textContent =
      // Banner lives INSIDE the wallet window (mounted into #wwBannerMount at the top of the card) —
      // NOT across the page, because only the connected wallet is on testnet, not the whole site.
      '.ww-testnet-banner{display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:wrap;' +
      'padding:8px 14px;margin:0 0 14px;border-radius:12px;font:600 11px/1.3 "Inter",system-ui,sans-serif;' +
      'letter-spacing:.05em;text-transform:uppercase;color:#1a1206;' +
      'background:repeating-linear-gradient(45deg,#F4B740,#F4B740 14px,#E0A020 14px,#E0A020 28px);' +
      'border:1px solid rgba(0,0,0,.2)}' +
      '.ww-testnet-banner b{font-weight:800}' +
      '.ww-testnet-banner .x{cursor:pointer;text-decoration:underline;text-transform:none;letter-spacing:0;font-weight:600}' +
      '.ww-net-chip{display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:999px;cursor:pointer;' +
      'font:600 11px/1 "Inter",system-ui,sans-serif;border:1px solid transparent;user-select:none}' +
      '.ww-net-chip .dot{width:7px;height:7px;border-radius:50%}' +
      '.ww-net-chip[data-net="mainnet"]{color:#9a94a6;border-color:rgba(255,255,255,.14);background:rgba(255,255,255,.04)}' +
      '.ww-net-chip[data-net="mainnet"] .dot{background:#3ad07a}' +
      '.ww-net-chip[data-net="testnet"]{color:#1a1206;background:#F4B740;border-color:#E0A020}' +
      '.ww-net-chip[data-net="testnet"] .dot{background:#5a3d06}';
    document.head.appendChild(s);
  }

  function paint() {
    ensureStyle();
    var testnet = isTestnet();
    document.body.classList.toggle('ww-testnet', testnet);
    // The network chip lives INSIDE the wallet window (mounted by the wallet UI once a wallet
    // is open) — not in the site hero. It's only auto-mounted where a host explicitly opts in
    // via #wwNetChipMount (kept for back-compat); the Terminal/extension mount it themselves.
    var mount = document.getElementById('wwNetChipMount');
    if (mount && !mount.firstChild) mount.appendChild(chip());
    // banner — only inside the wallet window (host provides #wwBannerMount); shown when testnet.
    var mountB = document.getElementById('wwBannerMount');
    var b = document.getElementById('wwTestnetBanner');
    if (testnet && mountB) {
      if (!b) {
        b = document.createElement('div');
        b.id = 'wwTestnetBanner';
        b.className = 'ww-testnet-banner';
        b.innerHTML = '⚠ <b>Testnet Mode</b> — coins have no value · <span class="x" id="wwFaucet">🚰 get test coins</span> · <span class="x" id="wwExitTestnet">switch to Mainnet</span>';
        var x = b.querySelector('#wwExitTestnet'); if (x) x.onclick = function () { set('mainnet'); };
        var f = b.querySelector('#wwFaucet'); if (f) f.onclick = faucet;
      }
      if (b.parentNode !== mountB) mountB.insertBefore(b, mountB.firstChild);
    } else if (b) { b.remove(); }
    // topbar chip
    document.querySelectorAll('.ww-net-chip').forEach(function (chip) {
      chip.setAttribute('data-net', testnet ? 'testnet' : 'mainnet');
      chip.innerHTML = '<span class="dot"></span>' + (testnet ? 'Testnet' : 'Mainnet');
    });
  }

  // Testnet faucets — where to get free test coins for each chain.
  var FAUCETS = [
    { chain: 'Bitcoin testnet4', url: 'https://mempool.space/testnet4/faucet', note: 'signet/testnet4 tBTC' },
    { chain: 'Ethereum Sepolia', url: 'https://cloud.google.com/application/web3/faucet/ethereum/sepolia', note: 'Sepolia ETH' },
    { chain: 'Solana devnet', url: 'https://faucet.solana.com/', note: 'devnet SOL (or `solana airdrop 2`)' },
  ];
  function faucet(e) {
    if (e && e.preventDefault) e.preventDefault();
    var rows = FAUCETS.map(function (f) {
      return '<a href="' + f.url + '" target="_blank" rel="noopener" style="display:flex;justify-content:space-between;gap:12px;padding:11px 14px;border:1px solid rgba(224,180,83,.25);border-radius:10px;text-decoration:none;color:#F2EEE6;margin-bottom:8px">' +
        '<span><b style="color:#F4D58D">' + f.chain + '</b><br><span style="font-size:12px;color:#9a94a6">' + f.note + '</span></span><span style="color:#F4D58D;align-self:center">open ↗</span></a>';
    }).join('');
    var html = '<h3 class="m-title" style="margin:0 0 6px">🚰 Testnet faucets</h3>' +
      '<p class="fine" style="margin:0 0 14px;color:#9a94a6">Get free test coins, then send them to your <b>testnet</b> address in this wallet. Test coins have no real value.</p>' +
      rows + '<button class="modal-x" id="wwFaucetX" style="margin-top:6px">Close</button>';
    // Reuse the Terminal modal if present; otherwise inject a lightweight one.
    var mc = document.getElementById('modalCard'), modal = document.getElementById('modal');
    if (mc && modal) { mc.innerHTML = html; modal.hidden = false; var xb = document.getElementById('wwFaucetX'); if (xb) xb.onclick = function () { modal.hidden = true; }; return; }
    var ov = document.getElementById('wwFaucetOv');
    if (!ov) { ov = document.createElement('div'); ov.id = 'wwFaucetOv'; ov.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(6,6,10,.72);display:flex;align-items:center;justify-content:center;padding:20px'; document.body.appendChild(ov); ov.addEventListener('click', function (ev) { if (ev.target === ov) ov.remove(); }); }
    ov.innerHTML = '<div style="max-width:440px;width:100%;background:#12121a;border:1px solid rgba(224,180,83,.3);border-radius:16px;padding:22px;font-family:Inter,system-ui,sans-serif">' + html + '</div>';
    var xb2 = document.getElementById('wwFaucetX'); if (xb2) xb2.onclick = function () { ov.remove(); };
  }

  // Build a chip element the caller can drop into the topbar; clicking it toggles.
  function chip() {
    ensureStyle();
    var c = document.createElement('span');
    c.className = 'ww-net-chip';
    c.title = 'Network — click to switch between Mainnet and Testnet';
    c.onclick = function () { toggle(); };
    setTimeout(paint, 0);
    return c;
  }

  // ── auto-thread the active network into WonderCore signing/sending calls ──
  // The Terminal has many scattered send/sign call sites; rather than edit each, wrap the
  // relevant WonderCore methods so an omitted network defaults to the active one. Opts-object
  // methods get opts.network; positional signers get the network appended at its arg index.
  function patchCore() {
    var C = window.WonderCore;
    if (!C || C.__wwNetPatched) return;
    ['send', 'buildUnsignedSend'].forEach(function (fn) {
      if (typeof C[fn] !== 'function') return;
      var orig = C[fn].bind(C);
      C[fn] = function (opts) { opts = opts || {}; if (opts.network == null) opts.network = get(); return orig(opts); };
    });
    // positional network arg: [method, argIndex]
    [['signCp', 7], ['signStamp', 5], ['signMessage', 3]].forEach(function (pair) {
      var fn = pair[0], idx = pair[1];
      if (typeof C[fn] !== 'function') return;
      var orig = C[fn].bind(C);
      C[fn] = function () { var a = [].slice.call(arguments); while (a.length < idx) a.push(undefined); if (a[idx] == null) a[idx] = get(); return orig.apply(null, a); };
    });
    if (typeof C.signProvider === 'function') {
      var sp = C.signProvider.bind(C);
      C.signProvider = function (opts) { opts = opts || {}; if (opts.network == null) opts.network = get(); return sp(opts); };
    }
    C.__wwNetPatched = true;
  }
  patchCore();

  window.WWNet = { get: get, set: set, toggle: toggle, isTestnet: isTestnet, evm: evm, label: label, onChange: onChange, paint: paint, chip: chip, faucet: faucet };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', paint);
  else paint();
})();
