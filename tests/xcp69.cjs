/* Regression tests for the XCP-69 conformance predicate + lossless numerics (public/xcp69.js).
   Covers the two traps a naive integrator gets wrong (commission != 0 stealth premine; the
   pre-announcement timing clause), bigint precision at 10^16 magnitude, and lossless JSON parsing.
   Pure logic — runs in CI with no browser. */
const assert = require('assert');
const X = require('../public/xcp69.js');

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; } catch (e) { fail++; console.error('FAIL:', name, '—', e.message); } }

// A fully-conforming pending launch (raw sats as strings, as the lossless parser yields).
const good = {
  status: 'pending', asset: 'MYTOKEN',
  hard_cap: '10000000000000000', soft_cap: '6900000000000000', pool_quantity: '3100000000000000',
  quantity_by_price: '100000000000', price: '1000000',
  max_mint_per_address: '100000000000000', max_mint_per_tx: '100000000000000',
  premint_quantity: 0, minted_asset_commission_int: 0,
  lock_quantity: true, lock_description: true, divisible: true, burn_payment: false,
  start_block: 900000, end_block: 0, block_index: 899990, soft_cap_deadline_block: 901000,
  confirmed: true, earned_quantity: null,
};
const OPTS = { announceBlock: 899990, originalDeadline: 901000 };
const clone = (o) => Object.assign({}, good, o);

// ── conformance ──
t('conforming launch passes params', () => assert.equal(X.xcp69Params(good), true));
t('conforming launch passes full isXcp69', () => assert.equal(X.isXcp69(good, OPTS), true));
t('TRAP: commission != 0 fails (stealth premine)', () => assert.equal(X.xcp69Params(clone({ minted_asset_commission_int: 1 })), false));
t('TRAP: commission via legacy field fails', () => assert.equal(X.xcp69Params(clone({ minted_asset_commission_int: undefined, minted_asset_commission: 5 })), false));
t('off-by-one soft_cap fails (bigint precision)', () => assert.equal(X.xcp69Params(clone({ soft_cap: '6900000000000001' })), false));
t('wrong hard_cap fails', () => assert.equal(X.xcp69Params(clone({ hard_cap: '9999999999999999' })), false));
t('wrong pool_quantity fails', () => assert.equal(X.xcp69Params(clone({ pool_quantity: '3000000000000000' })), false));
t('numeric asset (A…) fails — named only', () => assert.equal(X.xcp69Params(clone({ asset: 'A95428956661682177' })), false));
t('not lock_quantity fails', () => assert.equal(X.xcp69Params(clone({ lock_quantity: false })), false));
t('end_block != 0 fails', () => assert.equal(X.xcp69Params(clone({ end_block: 905000 })), false));

// ── timing clauses (the immutable-event traps) ──
t('announced-before-start: confirmed before start passes', () => assert.equal(X.announcedBeforeStart(good, 899990), true));
t('TRAP: announced AT/AFTER start fails (no mint-proof window)', () => assert.equal(X.announcedBeforeStart(good, 900000), false));
t('unconfirmed launch passes announce clause (sentinel)', () => assert.equal(X.announcedBeforeStart(clone({ confirmed: false, block_index: 9999999 }), null), true));
t('full isXcp69 fails when announced too late', () => assert.equal(X.isXcp69(good, { announceBlock: 900001, originalDeadline: 901000 }), false));
t('window must equal start+1000', () => assert.equal(X.windowExact(good), true));
t('wrong window fails', () => assert.equal(X.windowExact(clone({ soft_cap_deadline_block: 902000 })), false));

// ── lossless numerics / bigint ──
t('parseLossless preserves 16+ digit integers as strings', () => {
  const o = X.parseLossless('{"q": 6900000000000123, "s": "x", "n": 42}');
  assert.equal(o.q, '6900000000000123'); assert.equal(o.n, 42);
});
t('big() exact for string beyond 2^53', () => assert.equal(X.big('6900000000000001'), 6900000000000001n));
t('big() rejects non-integers', () => { assert.equal(X.big('12.5'), null); assert.equal(X.big('abc'), null); assert.equal(X.big(null), null); });
t('fromSats divisible formats to 8dp trimmed', () => { assert.equal(X.fromSats('150000000', true), '1.5'); assert.equal(X.fromSats('6900000000000000', true), '69000000'); });
t('fromSats indivisible passes through', () => assert.equal(X.fromSats('1000', false), '1000'));

// ── phase + progress ──
t('launchPhase mapping', () => {
  assert.equal(X.launchPhase({ status: 'pending' }), 'scheduled');
  assert.equal(X.launchPhase({ status: 'open' }), 'minting');
  assert.equal(X.launchPhase({ status: 'closed' }, true), 'graduated');
  assert.equal(X.launchPhase({ status: 'closed' }, false), 'refunded');
});
t('progress: half the soft cap = 50%', () => assert.equal(X.progress({ earned_quantity: '3450000000000000' }).pct, 50));
t('progress: no mints = 0%', () => assert.equal(X.progress({ earned_quantity: null }).pct, 0));

console.log((fail ? '❌' : '✅') + ' xcp69: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
