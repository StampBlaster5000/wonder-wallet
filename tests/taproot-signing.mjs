/**
 * Taproot (P2TR) key-path signing audit — mirrors wallet-src/index.js exactly:
 *   btcPayment(taproot)  = btc.p2tr(pub.slice(1))              // x-only internal key (BIP86)
 *   addTypedInput(tapr.) = { witnessUtxo, tapInternalKey: p.tapInternalKey }
 *   sign path            = tx.sign(priv); tx.finalize()
 *
 * A correct BIP86 key-path spend must produce a single-element witness whose one
 * item is a 64-byte SCHNORR signature (SIGHASH_DEFAULT).
 *
 * SCOPE (WW-C16): this suite proves the STRUCTURE of a key-path spend — the BIP86
 * address matches the published vector, the x-only tapInternalKey is present, and
 * signing yields a single 64-byte witness item. It does NOT independently verify the
 * Schnorr signature against the BIP-341 sighash: btc-signer's finalize() only ASSEMBLES
 * the witness (a forged 64-byte tapKeySig would finalize), so a green run here is a
 * structural regression, not a cryptographic proof of the signature. Independent
 * Schnorr verification (compute the BIP-341 key-path sighash with the exact
 * @scure/btc-signer preimage args + @noble/curves schnorr.verify) is a tracked
 * follow-up — do not read this suite as proving signature validity.
 *
 * Run: node tests/taproot-signing.mjs
 */
import { mnemonicToSeedSync } from '@scure/bip39';
import { HDKey } from '@scure/bip32';
import * as btc from '@scure/btc-signer';
import { hex } from '@scure/base';

const TEST_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'; // public BIP-39 test vector — NOT a secret
const KNOWN_BIP86_ADDR = 'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr'; // BIP86 m/86'/0'/0'/0/0 test vector (also asserted by WonderCore.selfTest)

let failed = 0;
const ok = (cond, msg) => { console.log((cond ? '  ✓ ' : '  ✗ FAIL ') + msg); if (!cond) failed++; };

// ── derive exactly as the wallet does: BTC_PATHS.taproot = m/86'/0'/a'/0/i ──
const seed = mnemonicToSeedSync(TEST_MNEMONIC, '');
const node = HDKey.fromMasterSeed(seed).derive("m/86'/0'/0'/0/0");
const p = btc.p2tr(node.publicKey.slice(1)); // btcPayment('taproot') — x-only internal key

console.log('Taproot key-path signing audit (BIP86)\n');
ok(p.address === KNOWN_BIP86_ADDR, `derived address is the BIP86 vector (${p.address.slice(0, 14)}…)`);
ok(!!p.tapInternalKey && p.tapInternalKey.length === 32, 'payment carries a 32-byte x-only tapInternalKey');

// ── build a self-send exactly like addTypedInput('taproot') + buildSend ──
const FAKE = { txid: 'aa'.repeat(32), vout: 0, value: 20000 };
const tx = new btc.Transaction({});
tx.addInput({
  txid: hex.decode(FAKE.txid), index: FAKE.vout, sequence: 0xfffffffd, // RBF, as the wallet default
  witnessUtxo: { script: p.script, amount: BigInt(FAKE.value) },
  tapInternalKey: p.tapInternalKey,
});
tx.addOutputAddress(p.address, BigInt(FAKE.value - 300)); // self-send minus a nominal fee

// ── sign + finalize exactly as buildSend(sign:true) ──
let signedOk = true;
try { tx.sign(node.privateKey); tx.finalize(); }
catch (e) { signedOk = false; console.log('  ✗ FAIL sign/finalize threw: ' + e.message); failed++; }

if (signedOk) {
  const raw = tx.extract();
  const parsed = btc.Transaction.fromRaw(raw, { allowUnknownOutputs: true });
  const wit = parsed.getInput(0).finalScriptWitness;
  ok(Array.isArray(wit) && wit.length === 1, `witness is a single stack item (key-path spend) — got ${wit ? wit.length : 'none'}`);
  ok(wit && wit[0] && wit[0].length === 64, `witness sig is 64 bytes = SCHNORR / SIGHASH_DEFAULT — got ${wit && wit[0] ? wit[0].length : 'n/a'} bytes`);
  ok(!!tx.id && tx.vsize > 0, `tx finalized (txid ${String(tx.id).slice(0, 12)}…, vsize ${tx.vsize})`);
}

console.log('\n' + (failed ? `❌ ${failed} check(s) FAILED` : '✅ Taproot key-path spend STRUCTURE is correct (BIP86 vector address, x-only key, single 64-byte witness item). Note: signature validity is NOT independently verified here — see SCOPE (WW-C16).'));
process.exit(failed ? 1 : 0);
