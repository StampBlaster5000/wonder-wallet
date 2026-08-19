/* Regression suite for the Phase-B tx-shape hardening in the WonderVerify boundary.
   Converts the pentest PoCs for WW-B02 (SIGHASH change theft) and WW-B03 (RBF not bound to parent)
   into assertions that the boundary blocks them. Pure logic — no DOM, server, or secrets.
   The compose's psbt carries the decoded inputs/outputs the mock core returns. */
const assert = require('assert');
const V = require('../public/verifier.js');

V.configure({ core: {
  psbtInputs: (p) => (p && p.__inputs) || [],
  decodeTxOutputs: (p) => (p && p.__outputs) || [],
  addrHash: () => '',
} });
const { checkSighash, checkReplacement } = V.checks;
const compose = (inputs, outputs) => ({ psbt: { __inputs: inputs || [], __outputs: outputs || [] } });

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; } catch (e) { fail++; console.log('  ✗ ' + name + ': ' + (e && e.message)); } }
function throws(fn, code, why) { let e = null; try { fn(); } catch (err) { e = err; } assert(e, why + ' — expected a throw'); if (code) assert.strictEqual(e.code, code, why + ' — got code ' + e.code); }

// ── SIGHASH (WW-B02): only SIGHASH_ALL leaves no output mutable after approval ──
t('SIGHASH_ALL passes', () => { assert.strictEqual(checkSighash(compose([{ txid: 'a', index: 0, sighashType: 0x01 }]), {}).nonAll, 0); });
t('unspecified sighash passes (signer uses ALL)', () => { assert.strictEqual(checkSighash(compose([{ txid: 'a', index: 0 }]), {}).checked, 1); });
t('SINGLE|ANYONECANPAY 0x83 blocked — the change-theft PoC', () => throws(() => checkSighash(compose([{ txid: 'a', index: 0, sighashType: 0x83 }]), {}), 'bad_sighash', '0x83'));
t('ALL|ANYONECANPAY 0x81 blocked', () => throws(() => checkSighash(compose([{ txid: 'a', index: 0, sighashType: 0x81 }]), {}), 'bad_sighash', '0x81'));
t('NONE 0x02 blocked', () => throws(() => checkSighash(compose([{ txid: 'a', index: 0, sighashType: 0x02 }]), {}), 'bad_sighash', '0x02'));
t('SINGLE 0x03 blocked', () => throws(() => checkSighash(compose([{ txid: 'a', index: 0, sighashType: 0x03 }]), {}), 'bad_sighash', '0x03'));
t('non-ALL allowed ONLY when intent explicitly opts in', () => { assert.strictEqual(checkSighash(compose([{ txid: 'a', index: 0, sighashType: 0x83 }]), { allowSighash: [0x83] }).nonAll, 1); });
t('one bad input among many is caught', () => throws(() => checkSighash(compose([{ txid: 'a', index: 0, sighashType: 0x01 }, { txid: 'b', index: 1, sighashType: 0x83 }]), {}), 'bad_sighash', 'mixed'));

// ── Replacement / RBF (WW-B03): a bump must reuse the parent's exact inputs + keep the payment ──
const P = ['t1:0', 't2:1'];
t('no-op when not a replacement', () => { assert.ok(checkReplacement(compose([{ txid: 'x', index: 0 }]), {}).skipped); });
t('exact same inputs + preserved output passes', () => {
  const r = checkReplacement(compose([{ txid: 't1', index: 0 }, { txid: 't2', index: 1 }], [{ address: 'bc1qrecip', value: 1000 }]), { parentInputs: P, preserveOutputs: [{ address: 'bc1qrecip', value: 1000 }] });
  assert.strictEqual(r.parentInputs, 2);
});
t('extra input blocked (would become a 2nd payment)', () => throws(() => checkReplacement(compose([{ txid: 't1', index: 0 }, { txid: 't2', index: 1 }, { txid: 't9', index: 9 }]), { parentInputs: P }), 'rbf_extra_input', 'extra input'));
t('dropped parent input blocked (would not conflict)', () => throws(() => checkReplacement(compose([{ txid: 't1', index: 0 }]), { parentInputs: P }), 'rbf_missing_input', 'missing parent input'));
t('dropped/redirected recipient output blocked', () => throws(() => checkReplacement(compose([{ txid: 't1', index: 0 }, { txid: 't2', index: 1 }], [{ address: 'bc1qATTACKER', value: 1000 }]), { parentInputs: P, preserveOutputs: [{ address: 'bc1qrecip', value: 1000 }] }), 'rbf_output_dropped', 'recipient redirect'));

console.log((fail ? '❌' : '✅') + ' verifier-txshape: ' + pass + ' passed' + (fail ? ', ' + fail + ' FAILED' : ''));
process.exit(fail ? 1 : 0);
