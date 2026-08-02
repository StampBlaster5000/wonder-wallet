/*
 * Wonder Wallet dApp provider — "Sign-In With Bitcoin" proof (BIP-322). Phase 12 (v0.48). STAGED.
 *
 * At connect, the wallet auto-signs a wallet-generated message (domain + nonce + issued-at) so a site
 * gets proof-of-address-control in ONE round trip (no extra signMessage prompt) — mirrors XCP Wallet.
 * The SITE verifies: message parses, Domain == its own origin, Issued At is recent (< 5 min), and the
 * BIP-322 signature is valid for the returned address. This module is the shared message format +
 * a claims verifier (freshness/origin) both sides use. Pure + dual-mode → unit-testable.
 */
(function (root) {
  'use strict';
  var PREFIX = 'Wonder Wallet: sign in to prove you control this Bitcoin address.';

  function buildProofMessage(origin, nonce, issuedISO) {
    return PREFIX + '\n\nDomain: ' + origin + '\nNonce: ' + nonce + '\nIssued At: ' + issuedISO;
  }
  function parseProofMessage(msg) {
    var out = {};
    String(msg == null ? '' : msg).split('\n').forEach(function (line) {
      var m = /^(Domain|Nonce|Issued At):\s*(.*)$/.exec(line.trim());
      if (m) out[m[1]] = m[2];
    });
    return { domain: out.Domain || null, nonce: out.Nonce || null, issued: out['Issued At'] || null };
  }
  // Verify the CLAIMS (origin + freshness). The signature itself is verified separately (BIP-322).
  // `nowMs` is injected so tests are deterministic (Date.now() is unavailable in some contexts).
  function verifyProofClaims(msg, expectedOrigin, maxAgeMs, nowMs) {
    var p = parseProofMessage(msg);
    if (!p.domain || !p.nonce || !p.issued) return { ok: false, reason: 'malformed' };
    if (expectedOrigin && p.domain !== expectedOrigin) return { ok: false, reason: 'origin_mismatch' };
    var t = Date.parse(p.issued);
    if (isNaN(t)) return { ok: false, reason: 'bad_timestamp' };
    if (nowMs && maxAgeMs && (nowMs - t) > maxAgeMs) return { ok: false, reason: 'expired' };
    if (nowMs && (t - nowMs) > 60000) return { ok: false, reason: 'future' };
    return { ok: true, domain: p.domain, nonce: p.nonce, issued: p.issued };
  }

  var API = { PREFIX: PREFIX, buildProofMessage: buildProofMessage, parseProofMessage: parseProofMessage, verifyProofClaims: verifyProofClaims };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.WWProof = API;
})(typeof self !== 'undefined' ? self : this);
