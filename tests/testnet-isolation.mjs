/**
 * Testnet Mode — cross-network isolation audit (Phase 7).
 *
 * Proves the security-critical guarantees of Testnet Mode:
 *   1. Testnet uses coin type 1' → a DIFFERENT key set; addresses never collide with mainnet.
 *   2. ETH/SOL reuse the same key across networks (only the endpoint changes).
 *   3. A testnet BTC send REJECTS a mainnet recipient (address decode is network-scoped).
 *   4. The testnet key signs a testnet-locked input; the mainnet key CANNOT (no key crossover).
 */
import assert from 'node:assert';
import W from '../wallet-src/index.js';
import * as btc from '@scure/btc-signer';
import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync } from '@scure/bip39';

const M = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
let n = 0; const ok = (m) => { console.log('  ✓ ' + m); n++; };

// 1. distinct BTC key/address per network; same EVM/SOL key
const main = W.deriveAccounts(M, '', 0, 0);
const test = W.deriveAccounts(M, '', 0, 0, 'testnet');
assert(main.bitcoin.nativeSegwit.address.startsWith('bc1'), 'mainnet bc1');
assert(test.bitcoin.nativeSegwit.address.startsWith('tb1'), 'testnet tb1');
assert(main.bitcoin.nativeSegwit.address !== test.bitcoin.nativeSegwit.address, 'btc addr distinct');
assert(test.bitcoin.nativeSegwit.path.includes("/1'/"), "testnet path is coin type 1'");
ok('testnet BTC uses coin type 1′ → distinct tb1… address (no mainnet collision)');
assert.strictEqual(main.ethereum.address, test.ethereum.address, 'eth same');
assert.strictEqual(main.solana.address, test.solana.address, 'sol same');
ok('ETH & SOL reuse the same key across networks (address identical)');

// 2. testnet send rejects a mainnet recipient
const utxos = [{ txid: 'a'.repeat(64), vout: 0, value: 100000, confirmed: true }];
const tSend = W.buildSend({ mnemonic: M, utxos, recipient: test.bitcoin.nativeSegwit.address, amountSats: 40000, feeRate: 5, sign: true, network: 'testnet' });
assert(tSend.txid && tSend.fromAddress.startsWith('tb1'), 'testnet send builds');
ok('testnet BTC send builds + signs to a tb1 recipient');
assert.throws(() => W.buildSend({ mnemonic: M, utxos, recipient: main.bitcoin.nativeSegwit.address, amountSats: 40000, feeRate: 5, sign: true, network: 'testnet' }), 'mainnet recipient must be rejected on testnet');
ok('testnet send REJECTS a mainnet (bc1) recipient — address isolation enforced');

// 3. key crossover is impossible: testnet key signs a testnet-locked input, mainnet key cannot
const seed = mnemonicToSeedSync(M);
const tp = btc.p2wpkh(HDKey.fromMasterSeed(seed).derive("m/84'/1'/0'/0/0").publicKey, btc.TEST_NETWORK);
const mkPsbt = () => { const tx = new btc.Transaction({ allowUnknownOutputs: true }); tx.addInput({ txid: new Uint8Array(32).fill(7), index: 0, witnessUtxo: { script: tp.script, amount: 100000n } }); tx.addOutput({ script: new Uint8Array([0x6a, 0x04, 1, 2, 3, 4]), amount: 0n }); return Buffer.from(tx.toPSBT(0)).toString('base64'); };
const signed = W.signStampPsbt(mkPsbt(), M, '', 0, 0, 'nativeSegwit', {}, null, 'testnet');
assert(signed.txid, 'testnet key finalizes testnet-locked input');
ok('testnet key signs+finalizes a testnet-locked input');
assert.throws(() => W.signStampPsbt(mkPsbt(), M, '', 0, 0, 'nativeSegwit', {}, null, 'mainnet'), 'mainnet key must not sign testnet input');
ok('mainnet key CANNOT sign a testnet-locked input (no key crossover)');

// 4. selfTest vectors (mainnet + testnet) all green
assert(W.selfTest().checks.all, 'selfTest all');
ok('selfTest BIP vectors pass for both networks');

console.log(`\n✅ Testnet isolation audit passed (${n} checks) — networks are cryptographically separated`);
