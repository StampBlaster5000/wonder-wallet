/*
 * Clear-signing engine tests — the Sign dialog's truth layer.
 * Run: node tests/provider-tx-summary.cjs
 */
const S = require('../extension/src/provider/tx-summary.js');

let failed = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ FAIL ') + m); if (!c) failed++; };
const has = (warns, level, frag) => warns.some(w => w.level === level && w.text.includes(frag));

console.log('Clear-signing engine\n');

console.log('PSBT — normal send (100k in → 50k out + 49k change, 1k fee):');
let r = S.summarizePsbt({
  inputs: [{ address: 'bc1qme', value: 100000, sighashType: 0x01, mine: true, asset: null }],
  outputs: [{ address: 'bc1qrecipient', value: 50000, opReturn: false, mine: false }, { address: 'bc1qme', value: 49000, opReturn: false, mine: true }],
}, { origin: 'stampchain.io' });
ok(r.fee === 1000, 'fee computed (1000 sats)');
ok(r.sends.length === 1 && r.sends[0].value === 50000, 'recipient send surfaced');
ok(r.change.length === 1 && r.change[0].value === 49000, 'change back to you surfaced');
ok(r.net === -51000 && r.youPay === 51000, 'net effect: you pay 51000 sats');
ok(r.sighashTypes[0].safe === true, 'SIGHASH_ALL flagged safe');
ok(!has(r.warnings, 'danger'), 'no danger warnings on a clean send');
ok(has(r.warnings, 'info', 'cannot verify'), 'includes the "cannot verify the site" info notice');

console.log('\nPSBT — asset-bearing input:');
r = S.summarizePsbt({ inputs: [{ address: 'bc1qme', value: 10000, sighashType: 0, mine: true, asset: { kind: 'stamp', label: 'Stamp #289216' } }], outputs: [{ address: 'bc1qother', value: 9700, opReturn: false, mine: false }] });
ok(r.assetInputs.length === 1, 'asset input detected');
ok(has(r.warnings, 'danger', 'TRANSFER or DESTROY'), 'DANGER: warns the asset can be transferred/destroyed');

console.log('\nPSBT — unusual sighash / negative fee / high fee / unknown amounts:');
ok(has(S.summarizePsbt({ inputs: [{ value: 1000, sighashType: 0x02, mine: true }], outputs: [{ value: 900, mine: false, address: 'x' }] }).warnings, 'danger', 'Unusual sighash'), 'unusual sighash (0x02 NONE) → danger');
// WW-B02: SINGLE|ANYONECANPAY (0x83) leaves outputs mutable (change theft) — must be DANGER, not "safe".
let r83 = S.summarizePsbt({ inputs: [{ value: 1000, sighashType: 0x83, mine: true }], outputs: [{ value: 900, mine: false, address: 'x' }] });
ok(has(r83.warnings, 'danger', 'MUTABLE'), 'WW-B02: 0x83 SINGLE|ANYONECANPAY → danger (outputs mutable)');
ok(r83.sighashTypes[0].safe === false, 'WW-B02: 0x83 no longer flagged safe');
// ALL|ANYONECANPAY (0x81): outputs fixed, inputs can be added → warn (not danger, not silent).
ok(has(S.summarizePsbt({ inputs: [{ value: 1000, sighashType: 0x81, mine: true }], outputs: [{ value: 900, mine: false, address: 'x' }] }).warnings, 'warn', 'ADD more inputs'), 'WW-B02: 0x81 ALL|ANYONECANPAY → warn (inputs can be added)');
ok(has(S.summarizePsbt({ inputs: [{ value: 1000, sighashType: 1, mine: true }], outputs: [{ value: 2000, mine: false, address: 'x' }] }).warnings, 'danger', 'negative fee'), 'negative fee → danger');
ok(has(S.summarizePsbt({ inputs: [{ value: 1000000, sighashType: 1, mine: true }], outputs: [{ value: 100000, mine: false, address: 'x' }] }).warnings, 'warn', 'High network fee'), 'fee > 50k sats → warn');
ok(has(S.summarizePsbt({ inputs: [{ value: null, sighashType: 1, mine: true }], outputs: [{ value: 900, mine: false, address: 'x' }] }).warnings, 'warn', 'could not be verified'), 'unknown input amount → warn');

console.log('\nMessage signing:');
let m = S.summarizeMessage('Sign in to Stampchain', { origin: 'stampchain.io' });
ok(m.text === 'Sign in to Stampchain' && !m.isHex && !m.looksLikeTransaction, 'plain text passed through verbatim, not flagged as binary');
ok(!has(m.warnings, 'danger') && has(m.warnings, 'info', 'proves you control'), 'plain message: info notice only');
m = S.summarizeMessage('deadbeef'.repeat(6));
ok(m.isHex && has(m.warnings, 'warn', 'binary/hex'), 'long hex → binary/hex warning');
m = S.summarizeMessage('70736274ff01000000'.padEnd(60, '0'));
ok(m.looksLikeTransaction && has(m.warnings, 'danger', 'looks like a Bitcoin transaction'), 'DANGER: a PSBT disguised as a message is caught');

console.log('\nEVM calldata decode (WW-B09):');
// approve(0xspender, MAX_UINT256) — unlimited ERC-20 approval
let AD = '0x095ea7b3' + '000000000000000000000000' + 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' + 'f'.repeat(64);
let e = S.summarizeEthTx({ to: '0xtoken', data: AD }, { origin: 'evil.io' });
ok(e.decoded && e.decoded.kind === 'approve' && e.decoded.unlimited === true, 'WW-B09: approve() decoded as unlimited');
ok(e.decoded.spender.toLowerCase() === '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'WW-B09: spender extracted');
ok(has(e.warnings, 'danger', 'UNLIMITED token approval'), 'WW-B09: unlimited approval → danger');
// setApprovalForAll(operator, true)
let SA = '0xa22cb465' + '000000000000000000000000' + 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' + '0'.repeat(63) + '1';
let e2 = S.summarizeEthTx({ to: '0xnft', data: SA }, {});
ok(e2.decoded.kind === 'setApprovalForAll' && e2.decoded.approved === true && has(e2.warnings, 'danger', 'Approve-ALL'), 'WW-B09: setApprovalForAll(true) → danger');
// plain ETH send (no data) stays clean
let e3 = S.summarizeEthTx({ to: '0xfriend', value: '0xde0b6b3a7640000' }, {});
ok(!e3.isContract && !has(e3.warnings, 'danger'), 'WW-B09: plain ETH send not flagged as contract');

console.log('\n' + (failed ? `❌ ${failed} check(s) FAILED` : '✅ Clear-signing engine correct (breakdown + asset/sighash/fee/fake-message + B02 mutable-sighash + B09 EVM-approval warnings)'));
process.exit(failed ? 1 : 0);
