/*
 * dApp provider spine tests — protocol classification, per-origin permissions, broker decisions.
 * Real modules (CommonJS), not replicas. Run: node tests/provider-spine.cjs
 */
const P = require('../extension/src/provider/protocol.js');
const PERM = require('../extension/src/provider/permissions.js');
const B = require('../extension/src/provider/broker.js');

let failed = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ FAIL ') + m); if (!c) failed++; };
const O = 'https://stampchain.io';

console.log('Provider spine\n');

console.log('protocol.classify:');
ok(P.classify('ww_requestAccounts') === 'connect', 'requestAccounts → connect');
ok(P.classify('ww_getPublicKey') === 'read', 'getPublicKey → read');
ok(P.classify('ww_signPsbt') === 'sign', 'signPsbt → sign');
ok(P.classify('ww_disconnect') === 'manage', 'disconnect → manage');
ok(P.classify('foo_bar_baz') === 'unsupported', 'unknown → unsupported');
ok(P.ERR.USER_REJECTED === 4001 && P.ERR.UNAUTHORIZED === 4100 && P.ERR.UNSUPPORTED === 4200, 'error codes match XCP-style (4001/4100/4200)');

console.log('\npermissions:');
ok(PERM.normalizeOrigin('https://stampchain.io/mint?x=1') === O, 'https URL normalizes to bare origin');
ok(PERM.normalizeOrigin('http://stampchain.io') === null, 'http (insecure) is refused');
ok(PERM.normalizeOrigin('file:///x') === null, 'file:// is refused');
let store = {};
ok(PERM.isPermitted(store, O) === false, 'unknown origin is not permitted');
store = PERM.grant(store, O, { accounts: ['bc1qabc'], accountRef: 'hd:0', chains: ['btc'] }, 1000);
ok(PERM.isPermitted(store, O) === true, 'granted origin is permitted');
ok(PERM.accountsFor(store, O)[0] === 'bc1qabc', 'accountsFor returns the pinned account');
ok(PERM.accountsFor(store, 'https://evil.com').length === 0, 'accountsFor is [] for a different origin (no leak)');
PERM.touch(store, O, 2000); ok(store[O].lastUsed === 2000, 'touch updates lastUsed');
ok(PERM.list(store).length === 1 && PERM.list(store)[0].origin === O, 'list surfaces the connected site');
const r = PERM.revoke(store, O); ok(r.existed === true && !PERM.isPermitted(r.store, O), 'revoke removes it (and reports it existed)');
ok(PERM.revoke({}, O).existed === false, 'revoking an unknown origin reports existed:false (no spurious disconnect)');

console.log('\nbroker.decide:');
const empty = {};
const conn = PERM.grant({}, O, { accounts: ['bc1qabc'] }, 1);
ok(B.decide({ method: 'zzz', origin: O, store: conn }).code === 4200, 'unknown method → reject 4200');
ok(B.decide({ method: 'ww_disconnect', origin: O, store: conn }).action === 'revoke', 'disconnect → revoke');
ok(B.decide({ method: 'ww_requestAccounts', origin: O, store: empty }).action === 'approve', 'requestAccounts (new) → approve/connect');
ok(B.decide({ method: 'ww_requestAccounts', origin: O, store: conn }).action === 'serve', 'requestAccounts (already permitted) → serve, no popup');
ok(B.decide({ method: 'ww_accounts', origin: O, store: empty }).action === 'serve' && B.decide({ method: 'ww_accounts', origin: O, store: empty }).accounts.length === 0, 'ww_accounts (not connected) → serve []');
ok(B.decide({ method: 'ww_getPublicKey', origin: O, store: empty }).code === 4100, 'getPublicKey (not connected) → reject 4100');
ok(B.decide({ method: 'ww_getPublicKey', origin: O, store: conn }).action === 'serve', 'getPublicKey (connected) → serve');
ok(B.decide({ method: 'ww_signPsbt', origin: O, store: empty }).code === 4100, 'signPsbt (not connected) → reject 4100');
const sd = B.decide({ method: 'ww_signPsbt', origin: O, store: conn });
ok(sd.action === 'approve' && sd.kind === 'sign', 'signPsbt (connected) → approve/sign (every call)');

console.log('\n' + (failed ? `❌ ${failed} check(s) FAILED` : '✅ Provider spine correct (classification, per-origin permissions, and broker routing all pass)'));
process.exit(failed ? 1 : 0);
