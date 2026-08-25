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
  const b64hex = (b) => { const bin = atob(b); let h = ''; for (let i = 0; i < bin.length; i++) h += (bin.charCodeAt(i) & 0xff).toString(16).padStart(2, '0'); return h; };
  const conn = () => window.__connectedWallet || null; // a connected external wallet {address,name,signPsbt,pushPsbt}
  // The active signing source: a connected external wallet's address if one is paired, else the local account.
  const activeSource = () => { const cw = conn(); return cw ? cw.address : srcAddr(acct()); };

  // Compose a Counterparty tx and run it through the fail-closed verifier. Returns { compose, report,
  // source } on success; THROWS (friendly message) on compose or verification failure. Nothing is
  // signed here — the caller shows a confirm screen (with report → verify banner), then calls sign().
  async function composeVerify(type, params, intent) {
    const source = activeSource(); if (!source) throw new Error('No wallet is open to sign this — open a Wonder Wallet or connect one.');
    const c = await post('api/cp/compose/' + type, { source, params });
    if (!c || c.error) throw new Error((c && (c.detail || c.error)) || 'Counterparty rejected the transaction.');
    if (!window.WonderVerify) throw new Error('Signing verifier unavailable — refusing to sign.');
    const iv = Object.assign({ from: source }, intent || {});
    // Derive a fee ceiling from the approved rate × the tx's REAL size (catches a grossly inflated fee).
    // Counterparty's own signed_tx_estimated_size undershoots for orders paid with many small inputs
    // (esp. legacy P2PKH ≈148 vB each), so we also size the actual composed inputs/outputs and take the
    // larger — otherwise a legitimate multi-input fee trips the ceiling. Rate-based, so it still catches
    // a fee that's grossly above what the chosen sat/vB warrants.
    if (iv.feeMaxSats == null && iv.feeRatePerVb) {
      let vsize = (c.signed_tx_estimated_size && c.signed_tx_estimated_size.vsize) || 0;
      try {
        const nIn = (C().psbtInputs(c.psbt) || []).length;
        const nOut = (C().decodeTxOutputs(c.psbt) || []).length;
        const legacy = (acct() && acct().btcType) === 'legacy';
        vsize = Math.max(vsize, Math.ceil(nIn * (legacy ? 148 : 68) + nOut * 34 + 11));
      } catch (_) {}
      iv.feeMaxSats = Math.ceil(iv.feeRatePerVb * (vsize || 600) * 2.5);
    }
    const report = await window.WonderVerify.verify(c, iv); // throws on any failure — nothing proceeds
    return { compose: c, report, source };
  }

  // Sign a verified compose and broadcast. Returns { txid }. Routes to a connected external wallet
  // (UniSat/OKX/Wonder) when one is paired — it signs + finalizes; else the audited local core signer.
  async function sign(compose) {
    const cw = conn();
    if (cw && cw.signPsbt) {
      const hex = /^[0-9a-fA-F]+$/.test(compose.psbt) ? compose.psbt : b64hex(compose.psbt);
      const signed = await cw.signPsbt(hex, { autoFinalized: true });
      if (signed && typeof signed === 'object' && signed.txhex) { // Wonder connected → finalized raw tx; broadcast via our server
        const r = await post('api/btc/broadcast', { txhex: signed.txhex });
        if (!r || r.error) throw new Error((r && (r.detail || r.error)) || 'Broadcast failed.');
        return { txid: r.txid || signed.txid };
      }
      const signedStr = typeof signed === 'string' ? signed : (signed && (signed.psbt || signed.hex)) || hex;
      const txid = await cw.pushPsbt(signedStr);
      return { txid: typeof txid === 'string' ? txid : (txid && (txid.txid || txid.result)) || String(txid) };
    }
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

  window.WonderCpFlow = { composeVerify, sign, srcAddr, activeSource };
})();
