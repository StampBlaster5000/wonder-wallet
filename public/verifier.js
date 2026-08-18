/* Wonder Wallet — unified signing verifier.
   Phase 0 of the XCP-69 / Market build, and the remediation for the pentest's core theme:
   "verification lives per-screen, not per-signature." This is ONE fail-closed boundary that every
   NEW Counterparty compose flow (Market swap / liquidity / limit / dispense · XCP-69 mint / create)
   MUST pass before a signature is released. It locally RE-DECODES the server-composed transaction and
   proves it matches the user's explicit intent:

     1. Outputs   — BTC leaves only to the source (change) or an address the user actually stated.
     2. Recipient — every intended Counterparty destination is truly baked into the tx: as a payment
                    output OR encoded (hash160 / witness program) in the CP data — so a tampered
                    composer cannot silently redirect an asset (covers the hidden enhanced_send case).
     3. Fee       — the miner fee is within the ceiling the user approved, and non-negative.
     4. Inputs    — every input is re-checked against FRESH coin-control: spendable, not frozen, not
                    time-locked, not asset-bearing (Counterparty/Stamps/Ordinal), not unknown. This is
                    the gap the pentest found (WW-C02 / WW-B04): the old flows verified outputs but
                    never re-validated the inputs at signing time.

   Any failure THROWS — nothing is signed. Modeled on the byte-honest, fail-closed philosophy of the
   XCP Wallet extension's re-pack verifier (MIT), adapted to Wonder's own core primitives
   (WonderCore.decodeTxOutputs / psbtInputs / addrHash) and the /coincontrol classifier.

   Dependency-injected (see `configure`) so the pure logic is unit-testable in Node (tests/verifier). */
(function (root) {
  'use strict';

  // Injected dependencies — real globals in the browser, mockable in Node tests.
  const D = {
    core: (typeof window !== 'undefined' && window.WonderCore) || null,
    fetchFn: (typeof fetch !== 'undefined') ? ((...a) => fetch(...a)) : null,
    // Local per-UTXO freeze / time-lock overlay — same source coin-control.js writes (ww:utxo:<addr>).
    getMeta: (addr) => { try { return (typeof window !== 'undefined' && window.WWStore) ? (window.WWStore.lsGet('ww:utxo:' + addr, {}) || {}) : {}; } catch (_) { return {}; } },
  };
  function configure(overrides) { Object.assign(D, overrides || {}); return D; }

  // Mainnet + testnet Bitcoin address shapes (bech32 v0/v1, legacy 1…/3…, testnet tb1/m/n/2…).
  const RE_BTC_ADDR = /^((bc1|tb1)[a-z0-9]{8,87}|[123mn2][a-km-zA-HJ-NP-Z1-9]{25,39})$/;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const fmt = (n) => Number(n).toLocaleString('en-US');
  function vErr(code, msg) { const e = new Error(msg); e.code = code; e.verifier = true; return e; }

  const psbtOf = (c) => c && (c.psbt || c.rawtransaction || c.rawtx || c.tx);
  // Fail closed: if we cannot READ the composed tx, we refuse to sign it.
  function outputs(c) {
    const p = psbtOf(c);
    if (!p) throw vErr('no_tx', 'The composed transaction is missing — nothing to verify, so nothing is signed.');
    try { return D.core.decodeTxOutputs(p) || []; }
    catch (_) { throw vErr('decode_outputs', 'Could not decode the composed transaction’s outputs — refusing to sign what cannot be read.'); }
  }
  function inputsOf(c) {
    const p = psbtOf(c);
    try { return D.core.psbtInputs(p) || []; }
    catch (_) { throw vErr('decode_inputs', 'Could not decode the composed transaction’s inputs — refusing to sign.'); }
  }

  // ── 1. Outputs — BTC may only leave to change (source) or an explicitly-allowed / stated address ──
  function checkOutputs(c, intent) {
    const allowed = new Set();
    if (intent.from) allowed.add(String(intent.from).trim());
    (intent.allowed || []).forEach((a) => { if (a) allowed.add(String(a).trim()); });
    (intent.dests || []).forEach((a) => { if (a) allowed.add(String(a).trim()); }); // a classic send pays the dest as an output
    for (const o of outputs(c)) {
      if (o.opReturn || !o.value || !o.address) continue; // CP data / valueless / undecodable → not a spendable payment
      if (!allowed.has(o.address)) throw vErr('bad_output', 'Aborted — the composed transaction pays BTC to an unexpected address (' + o.address + '). It may have been tampered with; nothing was signed.');
    }
    return true;
  }

  // ── 2. Recipient — each intended CP destination must appear as an output OR inside the CP data ──
  function checkRecipients(c, intent) {
    const dests = [...new Set((intent.dests || []).map((d) => String(d).trim()).filter((d) => RE_BTC_ADDR.test(d)))];
    if (!dests.length) return { list: [] };
    const data = String(c.data || '').toLowerCase();
    const outAddrs = new Set(); for (const o of outputs(c)) if (o.address) outAddrs.add(o.address);
    const list = [];
    for (const d of dests) {
      const inOut = outAddrs.has(d);
      let h = ''; try { h = D.core.addrHash(d) || ''; } catch (_) {}
      const inData = !!(h && data.includes(String(h).toLowerCase()));
      if (!inOut && !inData) throw vErr('bad_recipient', 'Aborted — the intended recipient ' + d + ' is not present in the composed transaction (neither as a payment output nor encoded in the Counterparty data). It may redirect your asset; nothing was signed.');
      list.push({ addr: d, via: inData ? 'Counterparty data' : 'payment output' });
    }
    return { list };
  }

  // ── 3. Fee — non-negative, and within the ceiling the user approved ──
  function checkFee(c, intent) {
    const raw = c.btc_fee != null ? c.btc_fee : (c.fee != null ? c.fee : null);
    if (raw == null) return { fee: null };
    const fee = Number(raw);
    if (!isFinite(fee) || fee < 0) throw vErr('bad_fee', 'Aborted — the composed transaction reports an invalid miner fee; nothing was signed.');
    if (intent.feeMaxSats != null && fee > Number(intent.feeMaxSats)) throw vErr('fee_exceeds', 'Aborted — the miner fee (' + fmt(fee) + ' sats) exceeds the limit you approved (' + fmt(intent.feeMaxSats) + ' sats). Nothing was signed.');
    return { fee };
  }

  // ── 4. Inputs — re-check every input against FRESH coin-control (fail closed). The pentest gap. ──
  async function checkInputs(c, intent) {
    if (intent.checkInputs === false) return { skipped: 'input check disabled for this flow' };
    if (!intent.from) return { skipped: 'no source address' };
    const ins = inputsOf(c);
    if (!ins.length) return { checked: 0 };
    if (!D.fetchFn) throw vErr('no_fetch', 'Aborted — cannot fetch coin-control to confirm inputs are safe; failing closed.');
    let cc;
    try { cc = await D.fetchFn('api/btc/' + encodeURIComponent(intent.from) + '/coincontrol').then((r) => r.json()); }
    catch (_) { throw vErr('cc_unavailable', 'Aborted — could not fetch fresh coin-control data to confirm the inputs are safe to spend. Failing closed; nothing was signed.'); }
    if (!cc || !Array.isArray(cc.utxos)) throw vErr('cc_bad', 'Aborted — coin-control data was unreadable; failing closed. Nothing was signed.');
    const meta = D.getMeta(intent.from) || {}, now = Date.now();
    const byKey = {};
    cc.utxos.forEach((u) => {
      const m = meta[u.utxo] || {};
      u._frozen = !!m.frozen;
      u._timelocked = !!(m.freezeUntil && new Date(m.freezeUntil).getTime() > now);
      byKey[u.txid + ':' + u.vout] = u;
    });
    const allow = new Set((intent.allowInputs || []).map(String)); // e.g. an intentional detach outpoint
    for (const inp of ins) {
      const key = inp.txid + ':' + inp.index;
      if (allow.has(key)) continue;
      const u = byKey[key];
      let why = null;
      if (!u) why = 'a UTXO that isn’t in this address’s current spendable set (unknown provenance)';
      else if (u.category === 'protected') why = 'an asset-bearing UTXO (Counterparty / Stamps / Ordinal) — protected from spending';
      else if (u.category !== 'spendable') why = 'a ' + u.category + ' UTXO (never presumed safe)';
      else if (u._frozen) why = 'a UTXO you froze';
      else if (u._timelocked) why = 'a UTXO you time-locked';
      if (why) throw vErr('bad_input', 'Aborted — the composed transaction would spend ' + why + '. This can burn an asset or spend a protected coin; nothing was signed.');
    }
    return { checked: ins.length };
  }

  // ── The boundary: run every check in order, fail closed, return a report on success ──
  async function verify(c, intent) {
    intent = intent || {};
    const report = { ok: false };
    checkOutputs(c, intent); report.outputs = true;
    report.recipients = checkRecipients(c, intent);
    report.fee = checkFee(c, intent);
    report.inputs = await checkInputs(c, intent);
    report.ok = true;
    return report;
  }
  // Verify, then hand off to the caller's signer (local engine or connected wallet). Nothing signs
  // unless every check passes. Returns whatever signFn returns.
  async function verifyAndSign(c, intent, signFn) {
    await verify(c, intent);
    return signFn(c);
  }

  // A green "verified" banner for confirm screens (failures surface as thrown errors elsewhere).
  function bannerHtml(report) {
    if (!report || !report.ok) return '';
    const rows = ['✓ Outputs verified — BTC leaves only to you or your stated recipient'];
    if (report.recipients && report.recipients.list) report.recipients.list.forEach((x) => rows.push('✓ Recipient <b>' + esc(x.addr) + '</b> <span class="fine">(via ' + esc(x.via) + ')</span>'));
    if (report.inputs && report.inputs.checked) rows.push('✓ ' + report.inputs.checked + ' input' + (report.inputs.checked === 1 ? '' : 's') + ' re-checked — none frozen, asset-bearing, or unknown');
    if (report.fee && report.fee.fee != null) rows.push('✓ Miner fee within your approved limit');
    return '<div class="cp-verified">' + rows.join('<br>') + '</div>';
  }

  const API = { verify, verifyAndSign, bannerHtml, configure, RE_BTC_ADDR, checks: { checkOutputs, checkRecipients, checkFee, checkInputs } };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; // Node (regression tests)
  if (typeof window !== 'undefined') window.WonderVerify = API;              // Browser (Terminal + extension)
})(this);
