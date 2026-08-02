/* Phase 4: ETH + SOL method classification, chain routing, EIP-1193 broker semantics. */
const P = require('../extension/src/provider/protocol.js');
const PERM = require('../extension/src/provider/permissions.js');
const B = require('../extension/src/provider/broker.js');
let failed = 0; const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ FAIL ') + m); if (!c) failed++; };
const O = 'https://emblemvault.ai', conn = PERM.grant({}, O, { accounts: ['SoLaddr'], chains: ['sol'] }, 1), empty = {};

console.log('Phase 4 — ETH/SOL provider\n');
console.log('classify:');
ok(P.classify('eth_requestAccounts') === 'connect' && P.classify('sol_connect') === 'connect', 'requestAccounts/sol_connect → connect');
ok(P.classify('eth_accounts') === 'read' && P.classify('eth_chainId') === 'read', 'eth_accounts/eth_chainId → read');
ok(P.classify('personal_sign') === 'sign' && P.classify('eth_sendTransaction') === 'sign' && P.classify('sol_signTransaction') === 'sign', 'personal_sign / sendTransaction / sol sign → sign');
ok(P.classify('wallet_switchEthereumChain') === 'manage' && P.classify('sol_disconnect') === 'manage', 'switchChain / sol_disconnect → manage');

console.log('\nchainOf:');
ok(P.chainOf('eth_accounts') === 'eth' && P.chainOf('personal_sign') === 'eth' && P.chainOf('net_version') === 'eth' && P.chainOf('wallet_switchEthereumChain') === 'eth', 'ETH methods → eth');
ok(P.chainOf('sol_connect') === 'sol' && P.chainOf('sol_signMessage') === 'sol', 'SOL methods → sol');
ok(P.chainOf('ww_signPsbt') === 'btc' && P.chainOf('ww_accounts') === 'btc', 'ww_ methods → btc');

console.log('\nbroker.decide (EIP-1193 semantics):');
ok(B.decide({ method: 'eth_chainId', origin: O, store: empty }).action === 'serve', 'eth_chainId (not connected) → serve (public)');
ok(B.decide({ method: 'eth_accounts', origin: O, store: empty }).action === 'serve' && B.decide({ method: 'eth_accounts', origin: O, store: empty }).accounts.length === 0, 'eth_accounts (not connected) → serve []');
ok(B.decide({ method: 'eth_requestAccounts', origin: O, store: empty }).action === 'approve', 'eth_requestAccounts (new) → approve');
ok(B.decide({ method: 'sol_connect', origin: O, store: empty }).action === 'approve', 'sol_connect (new) → approve');
ok(B.decide({ method: 'personal_sign', origin: O, store: empty }).code === 4100, 'personal_sign (not connected) → reject 4100');
ok(B.decide({ method: 'sol_signTransaction', origin: O, store: conn }).action === 'approve', 'sol_signTransaction (connected) → approve');
// Generic EVM RPC is now a PUBLIC passthrough (full EIP-1193 provider) — served, not rejected, even
// before connecting (dApps fire eth_call/eth_getBalance to render their UI).
ok(B.decide({ method: 'eth_getBalance', origin: O, store: conn }).action === 'serve', 'generic eth RPC (eth_getBalance) → serve (public passthrough)');
ok(B.decide({ method: 'eth_call', origin: O, store: empty }).action === 'serve', 'eth_call (not connected) → serve (public RPC)');
ok(P.classify('eth_getBalance') === 'read' && P.classify('web3_clientVersion') === 'read' && P.classify('foo_bar_baz') === 'unsupported', 'generic eth/web3 → read; truly-unknown → unsupported');

console.log('\n' + (failed ? `❌ ${failed} FAILED` : '✅ Phase 4 protocol/broker correct (ETH EIP-1193 + SOL classification, chain routing, public/empty reads)'));
process.exit(failed ? 1 : 0);
