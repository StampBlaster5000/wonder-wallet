/* Web Terminal wallet connector — detect + connect + normalize across UniSat/OKX/Wonder shapes. */
const WC = require('../public/wallet-connect.js');
let failed = 0; const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ FAIL ') + m); if (!c) failed++; };
const mkUnisat = () => ({ requestAccounts: async () => ['bc1qunisat'], getPublicKey: async () => 'pubUni', signPsbt: async (h) => 'signed:' + h, signMessage: async (m) => 'sig:' + m, pushPsbt: async () => 'txidUni', pushTx: async () => 'txidUniRaw', on: () => {} });
const mkOkx = () => ({ bitcoin: { connect: async () => ({ address: 'bc1qokx', publicKey: 'pubOkx' }), signPsbt: async (h) => 'okx:' + h, signMessage: async () => 'okxsig', pushTx: async () => 'txidOkx' } });
const mkWonder = () => ({ requestAccounts: async () => ({ accounts: ['bc1qwonder'], proof: { signature: 'p' } }), getPublicKey: async () => 'pubW', signPsbt: async (h) => ({ psbt: 'w:' + h }), signMessage: async () => 'wsig', broadcastTransaction: async () => ({ txid: 'txidW' }) });
// Horizon: window.btc_providers discovery + request(method, params) POSITIONAL, resolves { result: <resp> }; signs only.
const mkHorizonWin = (spy) => ({
  btc_providers: [{ id: 'HorizonWalletProvider', name: 'Horizon Wallet', icon: 'data:image/svg', methods: ['getAddresses', 'signPsbt', 'signMessage'] }],
  HorizonWalletProvider: {
    request: async (method, params) => {
      if (spy) spy.push([method, params]);
      if (method === 'getAddresses') return { result: { addresses: [{ address: 'bc1qhorizon', publicKey: 'pubH', type: 'p2wpkh', uuid: 'u1' }] } };
      if (method === 'signPsbt') return { result: { signedPsbt: 'hsigned:' + params.hex } };
      if (method === 'signMessage') return { result: { signature: 'hsig:' + params.message } };
      return { error: 'unknown' };
    },
  },
});
// XCP Wallet: window.xcpwallet EIP-1193 request({ method, params }) with xcp_* methods; signs only.
const mkXcpWin = (opts) => ({
  xcpwallet: {
    request: async ({ method, params }) => {
      if (method === 'xcp_requestAccounts') return { accounts: ['bc1qxcp'], proof: { signature: 'xp' } };
      if (method === 'xcp_accounts') return ['bc1qxcp'];
      if (method === 'xcp_signPsbt') { if (opts && opts.refuseCp) throw new Error('refused: not a counterparty transaction'); return { hex: 'xsigned:' + params[0].hex }; }
      if (method === 'xcp_signBitcoinPsbt') return { hex: 'xbtc:' + params[0].hex };
      if (method === 'xcp_signMessage') return { signature: 'xsig:' + params[0] };
      if (method === 'xcp_disconnect') return true;
      throw new Error('unknown');
    },
    on: () => {},
  },
});

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

  // ── Horizon (window.btc_providers) ──
  const hspy = [];
  const hwin = mkHorizonWin(hspy);
  const hdet = WC.detect(hwin);
  ok(hdet.length === 1 && hdet[0].id === 'HorizonWalletProvider' && hdet[0].kind === 'horizon', 'detect finds Horizon via window.btc_providers');
  const h = await WC.connect('HorizonWalletProvider', hwin);
  ok(h.address === 'bc1qhorizon' && h.publicKey === 'pubH' && h.btcType === 'nativeSegwit', 'Horizon connects → address, pubkey, mapped btcType (p2wpkh→nativeSegwit)');
  ok(await h.signPsbt('AABB', { signInputs: { 'bc1qhorizon': [0] } }) === 'hsigned:AABB', 'Horizon signPsbt unwraps {result:{signedPsbt}}');
  ok(await h.signMessage('hi') === 'hsig:hi', 'Horizon signMessage unwraps {result:{signature}}');
  ok(hspy.some((c) => c[0] === 'signPsbt' && c[1].signInputs['bc1qhorizon']), 'Horizon signPsbt sends {hex, signInputs} positionally');

  // ── XCP Wallet (window.xcpwallet) ──
  const xwin = mkXcpWin();
  const xdet = WC.detect(xwin);
  ok(xdet.length === 1 && xdet[0].id === 'xcp' && xdet[0].kind === 'xcp', 'detect finds XCP Wallet via window.xcpwallet');
  const x = await WC.connect('xcp', xwin);
  ok(x.address === 'bc1qxcp' && !!x.proof, 'XCP connects → address + BIP-322 proof');
  ok(await x.signPsbt('CAFE', { signInputs: { 'bc1qxcp': [0] } }) === 'xsigned:CAFE', 'XCP signPsbt (Counterparty) returns {hex}');
  ok(await x.signMessage('yo') === 'xsig:yo', 'XCP signMessage returns {signature}');
  // Plain-BTC fallback: xcp_signPsbt refuses → retry via xcp_signBitcoinPsbt
  const xb = await WC.connect('xcp', mkXcpWin({ refuseCp: true }));
  ok(await xb.signPsbt('BEEF', { signInputs: { 'bc1qxcp': [0] } }) === 'xbtc:BEEF', 'XCP signPsbt refusal falls back to xcp_signBitcoinPsbt');
  const xr = await WC.reconnect('xcp', xwin);
  ok(xr && xr.address === 'bc1qxcp', 'XCP silent reconnect via xcp_accounts (no popup)');

  // ── finalize + broadcast (Horizon/XCP sign only; we broadcast) ──
  global.WonderCore = { finalizeSignedPsbt: (p) => ({ txhex: 'RAW(' + p + ')', txid: 'TXID(' + p + ')' }), psbtInputs: (h) => [{}, {}] };
  const bcast = [];
  global.fetch = async (url, o) => { bcast.push([url, JSON.parse(o.body)]); return { json: async () => ({ txid: 'BROADCAST_OK' }) }; };
  ok(await h.pushPsbt('SIGNEDHZ') === 'BROADCAST_OK', 'Horizon pushPsbt → finalize + server broadcast → txid');
  ok(bcast[0][0] === 'api/btc/broadcast' && bcast[0][1].txhex === 'RAW(SIGNEDHZ)', 'pushPsbt finalizes then POSTs the raw txhex to api/btc/broadcast');
  ok(await x.pushPsbt('SIGNEDXCP') === 'BROADCAST_OK', 'XCP pushPsbt → finalize + broadcast → txid');
  // signInputs auto-fills all input indices from WonderCore.psbtInputs when not supplied
  const h2 = await WC.connect('HorizonWalletProvider', mkHorizonWin(hspy)); const hspy2len = hspy.length;
  await h2.signPsbt('DEADBEEF');
  ok(hspy[hspy.length - 1][1].signInputs['bc1qhorizon'].length === 2, 'signInputs auto-fills every input index (from WonderCore.psbtInputs) when caller omits it');
  delete global.WonderCore; delete global.fetch;

  // multi-wallet detect: UniSat + Horizon + XCP all present
  const all = WC.detect(Object.assign({}, mkHorizonWin(), mkXcpWin(), { unisat: mkUnisat() }));
  ok(all.length === 3 && all.map((w) => w.kind).sort().join(',') === 'horizon,unisat,xcp', 'detect merges all three provider kinds');

  console.log('\n' + (failed ? `❌ ${failed} FAILED` : '✅ Wallet connector correct — UniSat/OKX/Wonder + Horizon (btc_providers) + XCP Wallet (xcpwallet), with finalize+broadcast for sign-only wallets'));
  process.exit(failed ? 1 : 0);
})();
