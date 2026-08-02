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
ok(has(S.summarizePsbt({ inputs: [{ value: 1000, sighashType: 0x02, mine: true }], outputs: [{ value: 900, mine: false, address: 'x' }] }).warnings, 'danger', 'Unusual sighash'), 'unusual sighash (0x02) → danger');
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

console.log('\n' + (failed ? `❌ ${failed} check(s) FAILED` : '✅ Clear-signing engine correct (full breakdown + asset/sighash/fee/fake-message warnings)'));
process.exit(failed ? 1 : 0);
