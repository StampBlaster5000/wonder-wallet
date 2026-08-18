/* Regression suite for the WonderSign universal boundary (public/wonder-sign.js).
   Locks the ONE guarantee the pentest's core theme depends on: verify() must pass BEFORE sign() is
   ever called, and sign() before broadcast(). If this suite ever goes red, the signing boundary is
   no longer mandatory. Pure logic — no DOM, no server, no secrets. */
const assert = require('assert');
const WS = require('../public/wonder-sign.js');

let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); pass++; } catch (e) { fail++; console.log('  ✗ ' + name + ': ' + (e && e.message)); } }
async function rejects(p, why) { let threw = false; try { await p; } catch (_) { threw = true; } assert(threw, why); }

(async () => {
  // 1. verify() throws → sign() must never run (fail-closed on a tampered/undecodable tx)
  await t('verify-throws blocks sign', async () => {
    let signed = false;
    await rejects(WS.run({ verify: () => { throw new Error('bad output'); }, sign: () => { signed = true; }, broadcast: () => {} }), 'run should reject when verify throws');
    assert.strictEqual(signed, false, 'sign must NOT run when verify throws');
  });

  // 2. verify() returns not-ok → sign() must never run
  await t('verify not-ok blocks sign', async () => {
    let signed = false;
    await rejects(WS.run({ verify: async () => ({ ok: false }), sign: () => { signed = true; }, broadcast: () => {} }), 'run should reject when verify not ok');
    assert.strictEqual(signed, false, 'sign must NOT run when verify not ok');
  });

  // 3. happy path: verify → sign → broadcast, strict order + payload threading
  await t('ok verify → sign → broadcast, in order', async () => {
    const seq = [];
    const res = await WS.run({
      verify: async () => { seq.push('verify'); return { ok: true, tag: 'r' }; },
      sign: async (report) => { seq.push('sign'); assert.strictEqual(report.tag, 'r', 'sign receives the verify report'); return { txhex: 'deadbeef' }; },
      broadcast: async (signed) => { seq.push('broadcast'); assert.strictEqual(signed.txhex, 'deadbeef', 'broadcast receives the signed tx'); return { txid: 'abc123' }; },
    });
    assert.deepStrictEqual(seq, ['verify', 'sign', 'broadcast'], 'strict verify→sign→broadcast order');
    assert.strictEqual(res.txid, 'abc123');
    assert.strictEqual(res.report.tag, 'r');
  });

  // 4. no verifier supplied → refuse, nothing signs (can't accidentally bypass the boundary)
  await t('missing verifier refuses', async () => {
    let signed = false;
    await rejects(WS.run({ sign: () => { signed = true; } }), 'missing verify should reject');
    assert.strictEqual(signed, false);
  });

  // 5. no signer supplied → refuse after verify
  await t('missing signer refuses', async () => {
    await rejects(WS.run({ verify: async () => ({ ok: true }) }), 'missing sign should reject');
  });

  // 6. broadcast optional (message signing / offline sign) → returns signed, no broadcast
  await t('broadcast optional (message signing)', async () => {
    const res = await WS.run({ verify: async () => ({ ok: true }), sign: async () => ({ sig: '0xsig' }) });
    assert.strictEqual(res.signed.sig, '0xsig');
  });

  // 7. sign() failure (e.g. user rejects on device) propagates as a reject, no broadcast
  await t('sign failure propagates, no broadcast', async () => {
    let broadcast = false;
    await rejects(WS.run({ verify: async () => ({ ok: true }), sign: async () => { throw new Error('user rejected'); }, broadcast: () => { broadcast = true; } }), 'sign failure should reject');
    assert.strictEqual(broadcast, false, 'broadcast must NOT run if sign failed');
  });

  console.log((fail ? '❌' : '✅') + ' wonder-sign: ' + pass + ' passed' + (fail ? ', ' + fail + ' FAILED' : ''));
  process.exit(fail ? 1 : 0);
})();
