/* Regression tests for the unified signing verifier (public/verifier.js).
   Exercises each fail-closed check with PoC-style tamper cases — output redirect, recipient swap,
   fee inflation, and asset-bearing/frozen/unknown input spends — plus the happy path and the
   critical invariant: a tampered transaction is NEVER handed to the signer. Dependency-injected
   (mock core + fetch), so it runs in CI with no browser. */
const assert = require('assert');
const V = require('../public/verifier.js');

let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); pass++; } catch (e) { fail++; console.error('FAIL:', name, '—', e.message); } }
async function throws(fn, code, label) {
  try { await fn(); throw new Error(label + ': expected throw (' + code + ') but none occurred'); }
  catch (e) { if (e.code !== code) throw new Error(label + ': expected code ' + code + ', got ' + (e.code || e.message)); }
}

// Deterministic mock core: psbt is a JSON string carrying {outs, ins}; addrHash is 'hash_'+addr.
const core = {
  decodeTxOutputs: (p) => JSON.parse(p).outs || [],
  psbtInputs: (p) => JSON.parse(p).ins || [],
  addrHash: (a) => 'hash_' + a,
};
const FROM = 'bc1qsource000000000000000000000000000000';
const DEST = 'bc1qdest0000000000000000000000000000000a';
const EVIL = 'bc1qevil0000000000000000000000000000000a';
const tx = (outs, ins) => ({ psbt: JSON.stringify({ outs: outs || [], ins: ins || [] }) });

let CC = { utxos: [] };
V.configure({ core, getMeta: () => ({}), fetchFn: async () => ({ json: async () => CC }) });

(async () => {
  // ── 1. Outputs ──
  await t('outputs: change to source passes', async () => V.checks.checkOutputs(tx([{ address: FROM, value: 5000 }]), { from: FROM }));
  await t('outputs: pays stated recipient passes', async () => V.checks.checkOutputs(tx([{ address: DEST, value: 546 }, { address: FROM, value: 4000 }]), { from: FROM, dests: [DEST] }));
  await t('outputs: skips OP_RETURN data output', async () => V.checks.checkOutputs(tx([{ opReturn: true, value: 0 }, { address: FROM, value: 4000 }]), { from: FROM }));
  await t('outputs: unexpected address ABORTS (tamper PoC)', async () => throws(() => V.checks.checkOutputs(tx([{ address: EVIL, value: 9000 }]), { from: FROM }), 'bad_output', 'outputs-tamper'));

  // ── 2. Recipient ──
  await t('recipient: present as output passes', async () => V.checks.checkRecipients(tx([{ address: DEST, value: 546 }]), { dests: [DEST] }));
  await t('recipient: encoded in CP data passes (enhanced_send)', async () => V.checks.checkRecipients({ psbt: JSON.stringify({ outs: [{ address: FROM, value: 4000 }] }), data: '00hash_' + DEST + 'ff' }, { dests: [DEST] }));
  await t('recipient: absent ABORTS (redirect PoC)', async () => throws(() => V.checks.checkRecipients(tx([{ address: FROM, value: 4000 }]), { dests: [DEST] }), 'bad_recipient', 'recipient-redirect'));

  // ── 3. Fee ──
  await t('fee: within limit passes', async () => V.checks.checkFee({ btc_fee: 1200 }, { feeMaxSats: 5000 }));
  await t('fee: exceeds ceiling ABORTS', async () => throws(() => V.checks.checkFee({ btc_fee: 90000 }, { feeMaxSats: 5000 }), 'fee_exceeds', 'fee-high'));
  await t('fee: negative ABORTS', async () => throws(() => V.checks.checkFee({ btc_fee: -1 }, {}), 'bad_fee', 'fee-neg'));

  // ── 4. Inputs (coin-control re-check — the pentest gap) ──
  const IN = { txid: 'aa'.repeat(32), index: 0 };
  const key = IN.txid + ':0';
  const inTx = tx([{ address: FROM, value: 4000 }], [IN]);
  await t('inputs: all spendable passes', async () => {
    CC = { utxos: [{ utxo: key, txid: IN.txid, vout: 0, value: 5000, category: 'spendable' }] };
    assert.equal((await V.checks.checkInputs(inTx, { from: FROM })).checked, 1);
  });
  await t('inputs: asset-bearing (protected) ABORTS', async () => {
    CC = { utxos: [{ utxo: key, txid: IN.txid, vout: 0, value: 5000, category: 'protected' }] };
    await throws(() => V.checks.checkInputs(inTx, { from: FROM }), 'bad_input', 'input-protected');
  });
  await t('inputs: unknown provenance ABORTS', async () => {
    CC = { utxos: [] };
    await throws(() => V.checks.checkInputs(inTx, { from: FROM }), 'bad_input', 'input-unknown');
  });
  await t('inputs: frozen-by-user ABORTS', async () => {
    CC = { utxos: [{ utxo: key, txid: IN.txid, vout: 0, value: 5000, category: 'spendable' }] };
    V.configure({ getMeta: () => ({ [key]: { frozen: true } }) });
    await throws(() => V.checks.checkInputs(inTx, { from: FROM }), 'bad_input', 'input-frozen');
    V.configure({ getMeta: () => ({}) });
  });
  await t('inputs: allowInputs whitelist bypasses (intentional detach)', async () => {
    CC = { utxos: [{ utxo: key, txid: IN.txid, vout: 0, value: 5000, category: 'protected' }] };
    assert.equal((await V.checks.checkInputs(inTx, { from: FROM, allowInputs: [key] })).checked, 1);
  });
  await t('inputs: coin-control unavailable FAILS CLOSED', async () => {
    V.configure({ fetchFn: async () => { throw new Error('network'); } });
    await throws(() => V.checks.checkInputs(inTx, { from: FROM }), 'cc_unavailable', 'input-cc-down');
    V.configure({ fetchFn: async () => ({ json: async () => CC }) });
  });

  // ── Full boundary: happy path + the critical "never sign a tampered tx" invariant ──
  await t('verify: clean flow passes end-to-end', async () => {
    CC = { utxos: [{ utxo: key, txid: IN.txid, vout: 0, value: 5000, category: 'spendable' }] };
    const r = await V.verify({ psbt: JSON.stringify({ outs: [{ address: FROM, value: 4000 }, { opReturn: true, value: 0 }], ins: [IN] }), btc_fee: 1000 }, { from: FROM, feeMaxSats: 5000 });
    assert.equal(r.ok, true);
  });
  await t('verifyAndSign: NEVER signs a tampered tx', async () => {
    let signed = false;
    await throws(() => V.verifyAndSign(tx([{ address: EVIL, value: 9000 }]), { from: FROM }, () => { signed = true; }), 'bad_output', 'no-sign-on-tamper');
    assert.equal(signed, false, 'signFn must NOT run when verification fails');
  });

  console.log('verifier: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
