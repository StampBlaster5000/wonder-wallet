/*
 * Wonder Wallet dApp provider — clear-signing engine (pure).
 * Phase 12 (v0.48). ACTIVE — the dApp provider ships wired into every build and injects on all sites (universal, MetaMask/Phantom model, v0.48+). See STORE_LISTING.md + docs/DAPP_PROVIDER_PLAN.md (superseded).
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

  // Human names for every sighash flag we might see on an input.
  var SIGHASH_NAME = { 0x00: 'SIGHASH_DEFAULT', 0x01: 'SIGHASH_ALL', 0x02: 'SIGHASH_NONE', 0x03: 'SIGHASH_SINGLE', 0x81: 'ALL|ANYONECANPAY', 0x82: 'NONE|ANYONECANPAY', 0x83: 'SINGLE|ANYONECANPAY' };
  // WW-B02: sighash severity for a GENERIC dApp sign (no protocol binding to trust).
  //  • 'safe'    — ALL / DEFAULT: your signature commits to EVERY input and output. Nothing can change.
  //  • 'acp'     — ALL|ANYONECANPAY: outputs are fixed, but the site can still ADD inputs after you sign
  //                (your payment can't move; the fee can rise). Acceptable with a note.
  //  • 'mutable' — SINGLE / NONE (± ANYONECANPAY): outputs you did NOT sign stay MUTABLE — the site can
  //                add or rewrite outputs, INCLUDING redirecting your change, AFTER approval. This is the
  //                post-approval change-theft vector. 0x83 was previously (wrongly) treated as safe.
  function sighashSeverity(s) {
    if (s === 0x00 || s === 0x01) return 'safe';
    if (s === 0x81) return 'acp';
    return 'mutable'; // 0x02, 0x03, 0x82, 0x83, and anything unrecognized
  }
  // Back-compat: the set still considered non-alarming (safe + acp). approval.js reads sighashTypes[].safe.
  var SAFE_SIGHASH = { 0x00: 'SIGHASH_DEFAULT', 0x01: 'SIGHASH_ALL', 0x81: 'ALL|ANYONECANPAY' };
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
      var sev = sighashSeverity(s);
      var nm = SIGHASH_NAME[s] || ('0x' + s.toString(16));
      if (sev === 'mutable') warnings.push({ level: 'danger', text: 'Unusual sighash ' + nm + ' requested — it leaves outputs you did NOT sign MUTABLE, so the site can add or rewrite outputs (including redirecting your change) AFTER you approve. Reject unless this is a marketplace/atomic-swap flow you started and can verify.' });
      else if (sev === 'acp') warnings.push({ level: 'warn', text: 'Sighash ' + nm + ' lets the site ADD more inputs after you sign, so the final network fee may be higher than shown here.' });
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
      sighashTypes: sighashList.map(function (s) { return { code: s, name: SIGHASH_NAME[s] || ('0x' + s.toString(16)), safe: sighashSeverity(s) !== 'mutable' }; }),
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

  // ── WW-B09: decode the common ERC-20 / ERC-721 / ERC-1155 calldata so token approvals and
  // transfers are NOT blind-signed. A pure 4-byte-selector + 32-byte-word reader (no ABI lib).
  var MAX_U256 = (2n ** 256n) - 1n;
  function ethAddrAt(words, i) { var w = words[i]; return w ? ('0x' + w.slice(24)) : null; } // last 20 bytes of the word
  function ethUintAt(words, i) { try { return BigInt('0x' + (words[i] || '0')); } catch (_) { return 0n; } }
  function decodeEthCall(data) {
    if (!data || data === '0x' || data.length < 10) return null;
    var hexs = String(data).replace(/^0x/, '');
    var sel = '0x' + hexs.slice(0, 8).toLowerCase();
    var body = hexs.slice(8);
    var words = []; for (var i = 0; i + 64 <= body.length; i += 64) words.push(body.slice(i, i + 64));
    switch (sel) {
      case '0x095ea7b3': // approve(address spender, uint256 amount)  — ERC-20
      case '0x39509351': { // increaseAllowance(address,uint256)
        var amt = ethUintAt(words, 1);
        // "Unlimited" in practice = the max-uint sentinel or anything astronomically large (≥ 2^128).
        var unlimited = amt >= (2n ** 128n);
        return { kind: 'approve', spender: ethAddrAt(words, 0), amount: amt.toString(), unlimited: unlimited, exact: sel === '0x095ea7b3' };
      }
      case '0xa22cb465': // setApprovalForAll(address operator, bool approved) — ERC-721/1155
        return { kind: 'setApprovalForAll', operator: ethAddrAt(words, 0), approved: ethUintAt(words, 1) !== 0n };
      case '0xa9059cbb': // transfer(address to, uint256 amount) — ERC-20
        return { kind: 'transfer', to: ethAddrAt(words, 0), amount: ethUintAt(words, 1).toString() };
      case '0x23b872dd': // transferFrom(address from, address to, uint256 amount/tokenId)
      case '0x42842e0e': // safeTransferFrom(address,address,uint256) — ERC-721
        return { kind: 'transferFrom', from: ethAddrAt(words, 0), to: ethAddrAt(words, 1), amountOrId: ethUintAt(words, 2).toString() };
      default:
        return { kind: 'unknown', selector: sel };
    }
  }

  // Ethereum eth_sendTransaction: surface recipient, ETH value, and — when it carries call data —
  // decode the token action (approve / setApprovalForAll / transfer) so the user sees spender + amount.
  function summarizeEthTx(tx, opts) {
    tx = tx || {}; var warnings = [];
    var to = tx.to || null;
    var valueWei = 0n; try { valueWei = tx.value ? BigInt(tx.value) : 0n; } catch (_) {}
    var eth = (Number(valueWei) / 1e18);
    var valueEth = eth ? eth.toFixed(8).replace(/0+$/, '').replace(/\.$/, '') + ' ETH' : '0 ETH';
    var data = tx.data || tx.input || '0x';
    var isContract = !!(data && data !== '0x' && data.length > 2);
    var decoded = isContract ? decodeEthCall(data) : null;
    if (!to) warnings.push({ level: 'danger', text: 'No recipient address — this deploys a contract.' });
    if (decoded && decoded.kind === 'approve') {
      warnings.push({ level: 'danger', text: (decoded.unlimited ? 'UNLIMITED token approval' : 'Token approval') + ': you are letting ' + (decoded.spender || 'a contract') + ' spend ' + (decoded.unlimited ? 'ALL of this token from your wallet, now and later' : 'up to ' + decoded.amount + ' (raw units)') + '. Approvals are the #1 drainer vector — only approve a contract you trust, and revoke when done.' });
    } else if (decoded && decoded.kind === 'setApprovalForAll') {
      if (decoded.approved) warnings.push({ level: 'danger', text: 'Approve-ALL for an NFT collection: ' + (decoded.operator || 'an operator') + ' will be able to move EVERY NFT you own in this collection, now and in future. Only grant this to a marketplace you trust.' });
      else warnings.push({ level: 'info', text: 'Revoking collection approval for ' + (decoded.operator || 'an operator') + '.' });
    } else if (decoded && decoded.kind === 'transfer') {
      warnings.push({ level: 'warn', text: 'ERC-20 token transfer of ' + decoded.amount + ' (raw units) to ' + (decoded.to || '—') + '. Verify the recipient.' });
    } else if (decoded && decoded.kind === 'transferFrom') {
      warnings.push({ level: 'warn', text: 'Token/NFT transfer from ' + (decoded.from || '—') + ' to ' + (decoded.to || '—') + ' (id/amount ' + decoded.amountOrId + '). Verify this is intended.' });
    } else if (isContract) {
      warnings.push({ level: 'warn', text: 'Contract interaction: this transaction carries call data' + (decoded && decoded.selector ? ' (' + decoded.selector + ')' : '') + ', so it may move tokens or approve spending — not just send ETH. Verify the contract.' });
    }
    warnings.push({ level: 'info', text: 'Wonder Wallet cannot verify what ' + (opts && opts.origin || 'the site') + ' will do with this transaction. Only sign if you trust it.' });
    return { kind: 'eth-tx', to: to, valueEth: valueEth, valueWei: valueWei.toString(), data: data, isContract: isContract, decoded: decoded, warnings: warnings };
  }

  var API = { summarizePsbt: summarizePsbt, summarizeMessage: summarizeMessage, summarizeEthTx: summarizeEthTx, decodeEthCall: decodeEthCall, sighashSeverity: sighashSeverity, SIGHASH_NAME: SIGHASH_NAME, SAFE_SIGHASH: SAFE_SIGHASH };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.WWTxSummary = API;
})(typeof self !== 'undefined' ? self : this);
