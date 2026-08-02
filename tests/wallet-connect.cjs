/* Web Terminal wallet connector — detect + connect + normalize across UniSat/OKX/Wonder shapes. */
const WC = require('../public/wallet-connect.js');
let failed = 0; const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ FAIL ') + m); if (!c) failed++; };
const mkUnisat = () => ({ requestAccounts: async () => ['bc1qunisat'], getPublicKey: async () => 'pubUni', signPsbt: async (h) => 'signed:' + h, signMessage: async (m) => 'sig:' + m, pushPsbt: async () => 'txidUni', pushTx: async () => 'txidUniRaw', on: () => {} });
const mkOkx = () => ({ bitcoin: { connect: async () => ({ address: 'bc1qokx', publicKey: 'pubOkx' }), signPsbt: async (h) => 'okx:' + h, signMessage: async () => 'okxsig', pushTx: async () => 'txidOkx' } });
const mkWonder = () => ({ requestAccounts: async () => ({ accounts: ['bc1qwonder'], proof: { signature: 'p' } }), getPublicKey: async () => 'pubW', signPsbt: async (h) => ({ psbt: 'w:' + h }), signMessage: async () => 'wsig', broadcastTransaction: async () => ({ txid: 'txidW' }) });

(async () => {
  console.log('Wallet connector\n');
  const win = { unisat: mkUnisat(), wonderWallet: mkWonder() };
  const det = WC.detect(win);
  ok(det.length === 2 && det[0].id === 'wonder' && det[1].id === 'unisat', 'detect finds installed wallets in order (Wonder, UniSat)');
  ok(WC.detect({}).length === 0, 'detect with no wallets → empty');

  const u = await WC.connect('unisat', win);
  ok(u.address === 'bc1qunisat' && u.name === 'UniSat', 'UniSat connects → address + name');
  ok(await u.getPublicKey() === 'pubUni', 'UniSat getPublicKey resolves');
  ok(await u.signPsbt('AABB') === 'signed:AABB', 'UniSat signPsbt maps through');

  const oc = await WC.connect('okx', { okxwallet: mkOkx() });
  ok(oc.address === 'bc1qokx' && oc.publicKey === 'pubOkx', 'OKX connect() → address + publicKey');
  ok(await oc.signPsbt('CC') === 'okx:CC', 'OKX signPsbt maps through');

  const w = await WC.connect('wonder', { wonderWallet: mkWonder() });
  ok(w.address === 'bc1qwonder' && !!w.proof, 'Wonder connect → address + BIP-322 proof');
  ok((await w.signPsbt('DD')).psbt === 'w:DD', 'Wonder signPsbt maps through');

  // pushPsbt fallback: provider without pushPsbt → signPsbt(autoFinalized) + pushTx
  const noPush = WC.wrap('unisat', { signPsbt: async (h, o) => (o.autoFinalized ? 'rawfinal' : 'x'), pushTx: async (r) => 'TXID:' + r });
  ok(await noPush.pushPsbt('EE') === 'TXID:rawfinal', 'pushPsbt falls back to signPsbt(autoFinalized)+pushTx');

  let threw = false; try { await WC.connect('unisat', {}); } catch (e) { threw = /not_installed/.test(e.message); }
  ok(threw, 'connecting an uninstalled wallet → not_installed');

  console.log('\n' + (failed ? `❌ ${failed} FAILED` : '✅ Wallet connector correct (detect + connect + normalized signing for UniSat/OKX/Wonder)'));
  process.exit(failed ? 1 : 0);
})();
