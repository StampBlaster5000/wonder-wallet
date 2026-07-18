/* Wonder Wallet extension — read shim.
   The 13 UI modules call relative `api/…`. In the extension there's no local server, so we
   route those READS to the stateless proxy (no user data ever touches it; keys/signing/vault
   are 100% local). v2 will port these reads fully client-side (direct to the chains). */
(function () {
  // The stateless reader. Change this to point at your own reader if you self-host.
  var PROXY = 'https://build-1dadb019a5802eb5fee63753.emblem.build/pub/bitcoin_wallet/wonder-wallet';
  window.WW_PROXY = PROXY;
  function abs(u) { return PROXY + '/' + String(u).replace(/^\.?\//, ''); }
  function isApi(u) { return typeof u === 'string' && /^api\//.test(u); }

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
