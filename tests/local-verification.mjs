/**
 * Local transaction verification tests — the defence-in-depth guards added to
 * wallet-src/index.js (verifyLegacyPrevout + verifyBuiltOutputs), per XCP Wallet v0.5.2.
 * The two functions below are COPIES kept in sync with wallet-src/index.js.
 * Run: node tests/local-verification.mjs
 */
import { mnemonicToSeedSync } from '@scure/bip39';
import { HDKey } from '@scure/bip32';
import * as btc from '@scure/btc-signer';
import { hex } from '@scure/base';

// ── functions under test (verbatim from wallet-src/index.js) ──
function verifyLegacyPrevout(prevHex, txid, vout, claimedValue) {
  let ptx;
  try { ptx = btc.Transaction.fromRaw(hex.decode(String(prevHex).replace(/^0x/, '')), { allowUnknownOutputs: true, allowLegacyWitnessUtxo: true }); }
  catch (_) { throw new Error('prevtx_undecodable:' + txid); }
  if (ptx.id !== txid) throw new Error('prevtx_mismatch:' + txid);
  let o; try { o = ptx.getOutput(vout); } catch (_) { o = null; }
  if (!o || o.amount == null) throw new Error('prevout_missing:' + txid + ':' + vout);
  if (claimedValue != null && o.amount !== BigInt(claimedValue)) throw new Error('prevout_value_mismatch:' + txid + ':' + vout);
  return o.amount;
}
function verifyBuiltOutputs(tx, { recipient, outAmount, fromAddress, change, totalIn, feeRate, expectVsize }) {
  let sawRecipient = false, sawChange = false, sumOut = 0n;
  for (let i = 0; i < tx.outputsLength; i++) {
    const o = tx.getOutput(i); sumOut += o.amount;
    let a = null; try { a = btc.Address().encode(btc.OutScript.decode(o.script)); } catch (_) {}
    if (!sawRecipient && a === recipient && o.amount === BigInt(outAmount)) sawRecipient = true;
    else if (!sawChange && a === fromAddress && o.amount === BigInt(change)) sawChange = true;
    else throw new Error('verify_unexpected_output:' + (a || 'unknown'));
  }
  if (!sawRecipient) throw new Error('verify_recipient_missing');
  if (change > 0 && !sawChange) throw new Error('verify_change_missing');
  const fee = totalIn - Number(sumOut);
  if (fee < 0) throw new Error('verify_negative_fee');
  const ceiling = Math.max((feeRate || 1) * (expectVsize || 200) * 10, 50000);
  if (fee > ceiling) throw new Error('verify_fee_too_high:' + fee);
}

let failed = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ FAIL ') + m); if (!c) failed++; };
const throws = (fn, frag, m) => { try { fn(); ok(false, m + ' (did NOT throw)'); } catch (e) { ok(String(e.message).includes(frag), m + ` → ${e.message}`); } };

const seed = mnemonicToSeedSync('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about', '');
const seg = HDKey.fromMasterSeed(seed).derive("m/84'/0'/0'/0/0");
const SEGWIT = btc.p2wpkh(seg.publicKey).address;      // bc1q…
const LEGACY = btc.p2pkh(HDKey.fromMasterSeed(seed).derive("m/44'/0'/0'/0/0").publicKey).address; // 1…
const RECIP = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';

console.log('Local transaction verification\n');
console.log('verifyLegacyPrevout — cross-check prevtx hash + value:');
// Build a real signed prev-tx that pays 30000 sats to LEGACY at vout 0.
const ptx = new btc.Transaction({});
ptx.addInput({ txid: hex.decode('bb'.repeat(32)), index: 0, sequence: 0xffffffff, witnessUtxo: { script: btc.p2wpkh(seg.publicKey).script, amount: 100000n } });
ptx.addOutputAddress(LEGACY, 30000n);
ptx.addOutputAddress(SEGWIT, 69000n); // change
ptx.sign(seg.privateKey); ptx.finalize();
const prevHex = hex.encode(ptx.extract()); const prevId = ptx.id;

ok(verifyLegacyPrevout(prevHex, prevId, 0, 30000) === 30000n, 'clean prevout (correct txid + value) passes');
throws(() => verifyLegacyPrevout(prevHex, prevId, 0, 30001), 'prevout_value_mismatch', 'inflated claimed value is rejected');
throws(() => verifyLegacyPrevout(prevHex, 'cc'.repeat(32), 0, 30000), 'prevtx_mismatch', 'wrong previous tx (txid mismatch) is rejected');
throws(() => verifyLegacyPrevout('deadbeef', prevId, 0, 30000), 'prevtx_undecodable', 'garbage prevtx is rejected');

console.log('\nverifyBuiltOutputs — outputs pay only recipient + own change, sane fee:');
const mk = (outs) => { const t = new btc.Transaction({}); for (const [a, v] of outs) t.addOutputAddress(a, BigInt(v)); return t; };
const base = { recipient: RECIP, outAmount: 50000, fromAddress: SEGWIT, change: 20000, totalIn: 71000, feeRate: 10, expectVsize: 141 };
ok((() => { verifyBuiltOutputs(mk([[RECIP, 50000], [SEGWIT, 20000]]), base); return true; })(), 'clean recipient + change passes (fee 1000)');
ok((() => { verifyBuiltOutputs(mk([[RECIP, 50000]]), { ...base, change: 0, totalIn: 50300 }); return true; })(), 'sendMax single output passes');
throws(() => verifyBuiltOutputs(mk([[RECIP, 50000], [SEGWIT, 20000], [RECIP, 500]]), base), 'verify_unexpected_output', 'a surprise third output is rejected');
throws(() => verifyBuiltOutputs(mk([[SEGWIT, 20000]]), base), 'verify_recipient_missing', 'missing recipient output is rejected');
throws(() => verifyBuiltOutputs(mk([[RECIP, 50000]]), { ...base, change: 0, totalIn: 5_000_000 }), 'verify_fee_too_high', 'an absurd fee (inflated inputs) is rejected');

console.log('\n' + (failed ? `❌ ${failed} check(s) FAILED` : '✅ Local transaction verification guards work (tamper caught, clean sends pass)'));
process.exit(failed ? 1 : 0);
