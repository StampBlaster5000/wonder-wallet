/* Phase 3: BIP-322 sign-in proof + paired Legacy+SegWit signing. Run: node tests/provider-phase3.cjs */
const btc = require('@scure/btc-signer'); const { hex, base64 } = require('@scure/base');
const { mnemonicToSeedSync } = require('@scure/bip39'); const { HDKey } = require('@scure/bip32');
const PROOF = require('../extension/src/provider/proof.js');
const M = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const root = HDKey.fromMasterSeed(mnemonicToSeedSync(M, ''));
const segNode = root.derive("m/84'/0'/0'/0/0"), legNode = root.derive("m/44'/0'/0'/0/0");
const seg = btc.p2wpkh(segNode.publicKey), leg = btc.p2pkh(legNode.publicKey);
global.window = global; require('../public/wallet-core.js'); const WW = global.WonderCore;

let failed = 0; const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ FAIL ') + m); if (!c) failed++; };

console.log('BIP-322 Sign-In proof:\n');
const NOW = Date.parse('2026-07-31T01:00:00Z');
const msg = PROOF.buildProofMessage('https://stampchain.io', 'abc123', '2026-07-31T00:58:00Z');
const p = PROOF.parseProofMessage(msg);
ok(p.domain === 'https://stampchain.io' && p.nonce === 'abc123' && p.issued === '2026-07-31T00:58:00Z', 'message builds + parses round-trip (domain/nonce/issued)');
ok(PROOF.verifyProofClaims(msg, 'https://stampchain.io', 300000, NOW).ok, 'fresh + matching origin → ok');
ok(PROOF.verifyProofClaims(msg, 'https://evil.com', 300000, NOW).reason === 'origin_mismatch', 'wrong origin → origin_mismatch');
ok(PROOF.verifyProofClaims(PROOF.buildProofMessage('https://x.io', 'n', '2026-07-31T00:50:00Z'), 'https://x.io', 300000, NOW).reason === 'expired', 'issued > 5min ago → expired');
ok(PROOF.verifyProofClaims('garbage', 'https://x.io', 300000, NOW).reason === 'malformed', 'malformed → rejected');

console.log('\nPaired Legacy+SegWit signing:');
// prevTx paying the LEGACY address at vout 0 (legacy needs the full prev tx)
const ptx = new btc.Transaction({});
ptx.addInput({ txid: hex.decode('cc'.repeat(32)), index: 0, sequence: 0xffffffff, witnessUtxo: { script: seg.script, amount: 100000n } });
ptx.addOutputAddress(leg.address, 60000n); ptx.sign(segNode.privateKey); ptx.finalize();
const prevHex = hex.encode(ptx.extract()), prevId = ptx.id;
// PSBT: input0 = our SegWit, input1 = our Legacy (via nonWitnessUtxo)
const mk = () => { const t = new btc.Transaction({}); t.addInput({ txid: hex.decode('ab'.repeat(32)), index: 0, sequence: 0xfffffffd, witnessUtxo: { script: seg.script, amount: 55000n }, sighashType: 1 }); t.addInput({ txid: hex.decode(prevId), index: 0, sequence: 0xfffffffd, nonWitnessUtxo: hex.decode(prevHex), sighashType: 1 }); t.addOutputAddress(seg.address, 100000n); return base64.encode(t.toPSBT(0)); };
const prevTxs = {}; prevTxs[prevId] = prevHex;

let r = WW.signProviderPsbt(mk(), { types: ['nativeSegwit', 'legacy'], prevTxs: prevTxs }, M, '', 0, 0, 'nativeSegwit', prevTxs);
ok(JSON.stringify(r.signed) === '[0,1]', 'paired: signs BOTH the SegWit (0) and Legacy (1) inputs');
let back = btc.Transaction.fromPSBT(base64.decode(r.psbt), { allowUnknownInputs: true, allowUnknownOutputs: true });
ok(!!back.getInput(0).partialSig && !!back.getInput(1).partialSig, 'both inputs carry a partial signature');

let r2 = WW.signProviderPsbt(mk(), {}, M, '', 0, 0, 'nativeSegwit', prevTxs); // NOT paired → only segwit
ok(JSON.stringify(r2.signed) === '[0]', 'un-paired: signs ONLY the SegWit input (legacy left for opt-in)');

console.log('\n' + (failed ? `❌ ${failed} FAILED` : '✅ Phase 3 crypto correct (Sign-In proof format + paired Legacy+SegWit signing)'));
process.exit(failed ? 1 : 0);
