/* Wonder Wallet — Counterparty compose → verify → sign → broadcast pipeline for the NEW self-custodial
   flows (XCP-69 mint/create · Market swap/liquidity/limit/dispense). This is the FIRST consumer of the
   Phase-0 unified verifier (window.WonderVerify): every transaction here is re-decoded and proven
   against explicit intent BEFORE the core signer ever sees it. Reuses the audited core primitives
   (WonderCore.signCp / psbtInputs) — it does NOT touch the existing cp-actions.js sign paths. */
(function () {
  'use strict';
  const C = () => window.WonderCore;
  const acct = () => window.__activeAccount;
  const srcAddr = (a) => (a && (a.btcAddress || (a.bitcoin && a.bitcoin.nativeSegwit && a.bitcoin.nativeSegwit.address))) || null;
  const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());

  // Compose a Counterparty tx and run it through the fail-closed verifier. Returns { compose, report,
  // source } on success; THROWS (friendly message) on compose or verification failure. Nothing is
  // signed here — the caller shows a confirm screen (with report → verify banner), then calls sign().
  async function composeVerify(type, params, intent) {
    const a = acct(); if (!a) throw new Error('No local Wonder Wallet is open to sign this.');
    const source = srcAddr(a); if (!source) throw new Error('No source Bitcoin address available.');
    const c = await post('api/cp/compose/' + type, { source, params });
    if (!c || c.error) throw new Error((c && (c.detail || c.error)) || 'Counterparty rejected the transaction.');
    if (!window.WonderVerify) throw new Error('Signing verifier unavailable — refusing to sign.');
    const iv = Object.assign({ from: source }, intent || {});
    // Derive a fee ceiling from the approved rate × estimated size (catches a grossly inflated fee).
    if (iv.feeMaxSats == null && iv.feeRatePerVb) {
      const vsize = (c.signed_tx_estimated_size && c.signed_tx_estimated_size.vsize) || 600;
      iv.feeMaxSats = Math.ceil(iv.feeRatePerVb * vsize * 2.5);
    }
    const report = await window.WonderVerify.verify(c, iv); // throws on any failure — nothing proceeds
    return { compose: c, report, source };
  }

  // Sign a verified compose with the audited core signer and broadcast. Returns { txid }.
  async function sign(compose) {
    const a = acct(); if (!a) throw new Error('Wallet closed.');
    const btcType = a.btcType || 'nativeSegwit';
    let prevTxs = {};
    if (btcType === 'legacy') { // P2PKH inputs need the full previous tx (nonWitnessUtxo)
      const uniq = [...new Set(C().psbtInputs(compose.psbt).map((i) => i.txid))];
      const got = await Promise.all(uniq.map((t) => fetch('api/btc/tx/' + t + '/hex').then((r) => (r.ok ? r.text() : null)).then((h) => [t, h && h.trim()]).catch(() => [t, null])));
      for (const [t, h] of got) if (h) prevTxs[t] = h;
    }
    const signed = await C().signCp(compose.psbt, compose.inputs_values, compose.lock_scripts, a.account, btcType, prevTxs, a.importedId || null);
    const r = await post('api/btc/broadcast', { txhex: signed.txhex });
    if (!r || r.error) throw new Error((r && (r.detail || r.error)) || 'Broadcast failed.');
    return { txid: r.txid };
  }

  window.WonderCpFlow = { composeVerify, sign, srcAddr };
})();
