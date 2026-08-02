/*
 * Wonder Wallet dApp provider — clear-signing engine (pure).
 * Phase 12 (v0.48). STAGED: not wired into the build until after store approval.
 *
 * Turns a decoded PSBT (or a message) into a COMPLETE, human-readable summary of exactly what the
 * user is being asked to approve, plus prioritized warnings. This is what backs the Sign dialog —
 * the goal is "no blind signing": every input spent, every output paid, the fee, the net effect,
 * asset-bearing UTXOs, unusual sighashes, and messages that are secretly transaction data.
 *
 * Pure + dual-mode (Node require + browser global) so it unit-tests without a browser.
 * Input `decoded` is produced by the approval page from WonderCore's PSBT decode + coin-control:
 *   decoded.inputs  : [{ address, value(sats|null), sighashType(int|null), mine(bool),
 *                        asset: null | { kind:'stamp'|'src20'|'counterparty', label } }]
 *   decoded.outputs : [{ address(string|null), value(sats), opReturn(bool), mine(bool) }]
 */
(function (root) {
  'use strict';

  // Sighash flags we consider safe for a dApp to request (matches our own signing + XCP's allowlist).
  var SAFE_SIGHASH = { 0x00: 'SIGHASH_DEFAULT', 0x01: 'SIGHASH_ALL', 0x81: 'ALL|ANYONECANPAY', 0x83: 'SINGLE|ANYONECANPAY' };
  var FEE_ABS_WARN = 50000;   // sats — flag fees above this outright
  var FEE_PCT_WARN = 0.25;    // …or above this fraction of the inputs you're spending

  function sats(n) { return (n == null ? null : Number(n)); }
  function btc(n) { return n == null ? '—' : (Number(n) / 1e8).toFixed(8).replace(/0+$/, '').replace(/\.$/, '') + ' BTC'; }

  function summarizePsbt(decoded, opts) {
    opts = opts || {};
    var ins = (decoded && decoded.inputs) || [], outs = (decoded && decoded.outputs) || [];
    var warnings = [];

    var mineIns = ins.filter(function (i) { return i.mine; });
    var totalIn = 0, feeKnown = true;
    ins.forEach(function (i) { if (i.value == null) feeKnown = false; else totalIn += sats(i.value); });
    var totalOut = 0; outs.forEach(function (o) { totalOut += sats(o.value) || 0; });
    var fee = feeKnown ? (totalIn - totalOut) : null;

    var sends = outs.filter(function (o) { return !o.mine && !o.opReturn && o.address; })
      .map(function (o) { return { address: o.address, value: sats(o.value) }; });
    var change = outs.filter(function (o) { return o.mine; }).map(function (o) { return { address: o.address, value: sats(o.value) }; });
    var opReturns = outs.filter(function (o) { return o.opReturn; }).length;

    var mineInTotal = mineIns.reduce(function (a, i) { return a + (sats(i.value) || 0); }, 0);
    var mineOutTotal = change.reduce(function (a, o) { return a + (o.value || 0); }, 0);
    var net = mineOutTotal - mineInTotal; // negative = you are paying out

    // sighash types actually requested on YOUR inputs
    var sighashes = {};
    mineIns.forEach(function (i) { if (i.sighashType != null) sighashes[i.sighashType] = true; });
    var sighashList = Object.keys(sighashes).map(Number);

    // asset-bearing inputs of yours — the single most important warning for a Stamps/CP wallet
    var assetIns = mineIns.filter(function (i) { return i.asset; });

    // ── warnings, most severe first ──
    if (assetIns.length) {
      var labels = assetIns.map(function (i) { return i.asset.label || i.asset.kind; }).join(', ');
      warnings.push({ level: 'danger', text: 'This transaction spends ' + assetIns.length + ' asset-bearing UTXO' + (assetIns.length > 1 ? 's' : '') + ' (' + labels + '). Signing can TRANSFER or DESTROY that asset — only continue if that is intended.' });
    }
    sighashList.forEach(function (s) {
      if (!(s in SAFE_SIGHASH)) warnings.push({ level: 'danger', text: 'Unusual sighash type 0x' + s.toString(16) + ' requested — this can let the site rearrange or add inputs/outputs. Reject unless you understand it.' });
    });
    if (feeKnown && fee < 0) warnings.push({ level: 'danger', text: 'Invalid transaction: outputs exceed inputs (negative fee).' });
    if (feeKnown && fee >= 0 && (fee > FEE_ABS_WARN || (mineInTotal > 0 && fee > mineInTotal * FEE_PCT_WARN))) warnings.push({ level: 'warn', text: 'High network fee: ' + btc(fee) + '. Confirm this is expected.' });
    if (!feeKnown) warnings.push({ level: 'warn', text: 'Some input amounts could not be verified from the request, so the fee shown may be incomplete.' });
    if (sends.length) warnings.push({ level: 'info', text: 'Wonder Wallet cannot verify what ' + (opts.origin || 'the site') + ' will do with this signature. Only sign if you trust it.' });

    return {
      kind: 'psbt',
      totalIn: feeKnown ? totalIn : null, totalOut: totalOut, fee: fee, feeKnown: feeKnown,
      sends: sends, change: change, opReturns: opReturns,
      inputs: ins, mineInputs: mineIns, assetInputs: assetIns,
      net: net, youPay: net < 0 ? -net : 0,
      sighashTypes: sighashList.map(function (s) { return { code: s, name: SAFE_SIGHASH[s] || ('0x' + s.toString(16)), safe: s in SAFE_SIGHASH }; }),
      warnings: warnings,
      fmt: { btc: btc },
    };
  }

  // Message signing (ww_signMessage). The classic trap: a "message" that is actually raw transaction
  // or PSBT bytes, which a signature could authorize. Surface the exact text + loud warnings.
  function summarizeMessage(message, opts) {
    opts = opts || {};
    var text = message == null ? '' : String(message);
    var warnings = [];
    var compact = text.replace(/\s+/g, '');
    var isHex = /^(0x)?[0-9a-fA-F]+$/.test(compact) && compact.replace(/^0x/, '').length >= 40 && compact.replace(/^0x/, '').length % 2 === 0;
    var h = compact.replace(/^0x/, '').toLowerCase();
    var looksTx = h.indexOf('70736274ff') === 0 /* PSBT magic */ || /^0[12]000000/.test(h) /* tx version 1/2 */;

    if (looksTx) warnings.push({ level: 'danger', text: 'This "message" looks like a Bitcoin transaction or PSBT, not plain text. Signing it could authorize moving your funds. Do NOT sign unless you fully understand it.' });
    else if (isHex) warnings.push({ level: 'warn', text: 'This message is binary/hex data, not readable text. Be sure you know what it represents before signing.' });
    if (!text.length) warnings.push({ level: 'warn', text: 'The message is empty.' });
    warnings.push({ level: 'info', text: 'Signing proves you control this address. It does not move funds by itself, but the signature can be used off-chain by ' + (opts.origin || 'the site') + '.' });

    return { kind: 'message', text: text, length: text.length, isHex: isHex, looksLikeTransaction: looksTx, scheme: 'BIP-322', warnings: warnings };
  }

  // Ethereum eth_sendTransaction: surface recipient, ETH value, and whether it carries call data
  // (a contract interaction — could move tokens / approve spending, not just send ETH).
  function summarizeEthTx(tx, opts) {
    tx = tx || {}; var warnings = [];
    var to = tx.to || null;
    var valueWei = 0n; try { valueWei = tx.value ? BigInt(tx.value) : 0n; } catch (_) {}
    var eth = (Number(valueWei) / 1e18);
    var valueEth = eth ? eth.toFixed(8).replace(/0+$/, '').replace(/\.$/, '') + ' ETH' : '0 ETH';
    var data = tx.data || tx.input || '0x';
    var isContract = !!(data && data !== '0x' && data.length > 2);
    if (!to) warnings.push({ level: 'danger', text: 'No recipient address — this deploys a contract.' });
    if (isContract) warnings.push({ level: 'warn', text: 'Contract interaction: this transaction carries call data, so it may move tokens or approve spending — not just send ETH. Verify the contract.' });
    warnings.push({ level: 'info', text: 'Wonder Wallet cannot verify what ' + (opts && opts.origin || 'the site') + ' will do with this transaction. Only sign if you trust it.' });
    return { kind: 'eth-tx', to: to, valueEth: valueEth, valueWei: valueWei.toString(), data: data, isContract: isContract, warnings: warnings };
  }

  var API = { summarizePsbt: summarizePsbt, summarizeMessage: summarizeMessage, summarizeEthTx: summarizeEthTx, SAFE_SIGHASH: SAFE_SIGHASH };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.WWTxSummary = API;
})(typeof self !== 'undefined' ? self : this);
