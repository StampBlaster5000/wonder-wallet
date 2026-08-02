/* Wonder Wallet extension — read shim.
   The 13 UI modules call relative `api/…`. In the extension there's no local server, so we
   route those READS to the stateless proxy (no user data ever touches it; keys/signing/vault
   are 100% local). v2 will port these reads fully client-side (direct to the chains). */
(function () {
  // The stateless reader. Change this to point at your own reader if you self-host.
  var PROXY = 'https://build-1dadb019a5802eb5fee63753.emblem.build/pub/bitcoin_wallet/wonder-wallet';
  window.WW_PROXY = PROXY;
  // Testnet Mode (global toggle). Persisted per-profile in localStorage. Reads carry the network
  // as a QUERY PARAM (?network=testnet), NOT a custom header — the extension calls the proxy
  // cross-origin, and a custom header would trip a CORS preflight the platform proxy rejects
  // (allow-headers is only Authorization/Content-Type). A query param is a "simple" request, so it
  // sails through CORS AND gives testnet its own cache-distinct URL (no mainnet/testnet collision).
  function netMode() { try { return localStorage.getItem('ww:netmode') === 'testnet' ? 'testnet' : 'mainnet'; } catch (e) { return 'mainnet'; } }
  function netParam(url) { return netMode() === 'testnet' ? (url + (url.indexOf('?') >= 0 ? '&' : '?') + 'network=testnet') : url; }
  function abs(u) { return netParam(PROXY + '/' + String(u).replace(/^\.?\//, '')); }
  function isApi(u) { return typeof u === 'string' && /^api\//.test(u); }
  window.WWNetMode = {
    get: netMode,
    isTestnet: function () { return netMode() === 'testnet'; },
    evm: function () { return netMode() === 'testnet' ? 'sepolia' : 'ethereum'; },
    set: function (m) { try { localStorage.setItem('ww:netmode', m === 'testnet' ? 'testnet' : 'mainnet'); } catch (e) {} return netMode(); },
  };

  var _fetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    try {
      if (isApi(input)) input = abs(input);
      else if (input && typeof input === 'object' && isApi(input.url)) input = new Request(abs(input.url), input);
    } catch (e) {}
    return _fetch(input, init);
  };

  // <img>/<iframe src="api/…"> can't be caught by the fetch shim — rewrite them to the proxy.
  function fix(el) {
    if (!el || !el.getAttribute) return;
    var s = el.getAttribute('src');
    if (s && /^api\//.test(s)) el.setAttribute('src', abs(s));
  }
  function scan(root) { if (root && root.querySelectorAll) root.querySelectorAll('img[src^="api/"],iframe[src^="api/"]').forEach(fix); }
  try {
    new MutationObserver(function (muts) {
      muts.forEach(function (m) {
        if (m.type === 'attributes') { fix(m.target); return; }
        m.addedNodes && m.addedNodes.forEach(function (n) { if (n.nodeType === 1) { fix(n); scan(n); } });
      });
    }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
  } catch (e) {}
  document.addEventListener('DOMContentLoaded', function () { scan(document); });
})();
