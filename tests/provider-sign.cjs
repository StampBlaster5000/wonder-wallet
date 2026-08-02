/* signProviderPsbt tests — sign only our inputs, sighash allowlist, refuse foreign. Run: node tests/provider-sign.cjs */
const btc = require('@scure/btc-signer'); const { hex, base64 } = require('@scure/base');
const { mnemonicToSeedSync } = require('@scure/bip39'); const { HDKey } = require('@scure/bip32');
const M = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const root = HDKey.fromMasterSeed(mnemonicToSeedSync(M, ''));
const mine = btc.p2wpkh(root.derive("m/84'/0'/0'/0/0").publicKey);      // index 0 = signer's address
const other = btc.p2wpkh(root.derive("m/84'/0'/0'/0/5").publicKey);     // index 5 = "foreign"
global.window = global; require('../public/wallet-core.js'); const WW = global.WonderCore;

let failed = 0; const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ FAIL ') + m); if (!c) failed++; };
const mkPsbt = (inputs, sighash) => { const t = new btc.Transaction({}); inputs.forEach((pay, i) => t.addInput({ txid: hex.decode((i + 11).toString(16).padStart(2, '0').repeat(32)), index: 0, sequence: 0xfffffffd, witnessUtxo: { script: pay.script, amount: 60000n }, sighashType: sighash })); t.addOutputAddress('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu', 40000n); return base64.encode(t.toPSBT(0)); };

console.log('signProviderPsbt\n');
// 1. two inputs (mine + foreign) → sign ONLY mine, return partial psbt
let r = WW.signProviderPsbt(mkPsbt([mine, other], 1), {}, M, '', 0, 0, 'nativeSegwit');
ok(JSON.stringify(r.signed) === '[0]', 'signs only OUR input index (0), not the foreign one');
let back = btc.Transaction.fromPSBT(base64.decode(r.psbt), { allowUnknownInputs: true, allowUnknownOutputs: true });
ok(!!back.getInput(0).partialSig && back.getInput(0).partialSig.length > 0, 'our input carries a partial signature');
ok(!back.getInput(1).partialSig, 'the foreign input is left UNSIGNED');

// 2. sighash allowlist
try { WW.signProviderPsbt(mkPsbt([mine], 0x02), {}, M, '', 0, 0, 'nativeSegwit'); ok(false, 'SIGHASH_NONE (0x02) should be rejected'); }
catch (e) { ok(/sighash_not_allowed/.test(e.message), 'SIGHASH_NONE rejected → ' + e.message); }

// 3. explicit toSignInputs pointing at the FOREIGN input → refused
try { WW.signProviderPsbt(mkPsbt([mine, other], 1), { toSignInputs: [{ index: 1 }] }, M, '', 0, 0, 'nativeSegwit'); ok(false, 'signing a foreign input should be refused'); }
catch (e) { ok(/input_not_ours/.test(e.message), 'explicit foreign-input request refused → ' + e.message); }

// 4. autoFinalized single all-ours input → valid finalized tx
let f = WW.signProviderPsbt(mkPsbt([mine], 1), { autoFinalized: true }, M, '', 0, 0, 'nativeSegwit');
ok(!!f.txhex && !!f.txid, 'autoFinalized → finalized txhex + txid');

console.log('\n' + (failed ? `❌ ${failed} FAILED` : '✅ signProviderPsbt correct (only-our-inputs, sighash allowlist, foreign refused, finalize)'));
process.exit(failed ? 1 : 0);
