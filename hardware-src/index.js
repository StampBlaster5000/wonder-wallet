/**
 * Wonder Wallet — hardware-wallet adapter (Phase 8). Lazy-loaded bundle.
 *
 * Ledger via WebHID (local, no remote code — fits the security model). Keys never
 * leave the device; Wonder Wallet builds the unsigned artifacts (our CP-aware,
 * asset-safe PSBTs, EIP-1559 txs, Solana messages) and the device signs them.
 *
 * Trezor uses Trezor Connect (a remote-hosted popup) — scaffolded separately
 * because it conflicts with the extension's strict no-remote-code CSP; see notes.
 *
 * NOTE: on-device signing can only be validated with a physical Ledger. The
 * connect + address-derivation paths are exercised on connect; the signing
 * adapters follow Ledger's documented APIs.
 */
import TransportWebHID from '@ledgerhq/hw-transport-webhid';
import Btc from '@ledgerhq/hw-app-btc';
import { AppClient } from '@ledgerhq/hw-app-btc/lib-es/newops/appClient';
import { WalletPolicy } from '@ledgerhq/hw-app-btc/lib-es/newops/policy';
import { PsbtV2, psbtIn } from '@ledgerhq/psbtv2';
import Eth from '@ledgerhq/hw-app-eth';
import Solana from '@ledgerhq/hw-app-solana';
import { base58 } from '@scure/base';

let transport = null;

const isSupported = () => typeof navigator !== 'undefined' && !!navigator.hid;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const LEDGER_VID = 0x2c97; // Ledger USB vendor id (Nano S / X / S+)
async function connect() {
  if (!isSupported()) throw new Error('WebHID not available — use a Chromium browser over HTTPS.');
  // Idempotent: WebHID allows only ONE open handle per device. If we already hold a transport, REUSE it
  // instead of opening the device a second time — a second TransportWebHID.open() on the same device
  // throws "unable to claim", which previously surfaced as a false "Ledger is busy" when a caller (e.g.
  // the sign flow) re-ran connect() right after pairing. Only discard the handle if we can positively
  // tell it's closed (device unplugged → HIDDevice.opened === false).
  if (transport) {
    let dead = false;
    try { dead = transport.device && transport.device.opened === false; } catch (_) { dead = false; }
    if (!dead) return { connected: true, reused: true };
    try { await transport.close(); } catch (_) {}
    transport = null;
  }
  // Drive WebHID directly (Ledger's own request() crashes with "reading 'open'" if the picker returns
  // nothing). 1) reuse an already-granted, connected Ledger; 2) else PROMPT the browser device picker.
  let device = null;
  try {
    const granted = (await navigator.hid.getDevices().catch(() => [])) || [];
    device = granted.find((d) => d.vendorId === LEDGER_VID) || null;
  } catch (_) {}
  if (!device) {
    let picked = [];
    try { picked = await navigator.hid.requestDevice({ filters: [{ vendorId: LEDGER_VID }] }); }
    catch (e) {
      const m = String((e && e.message) || e || '');
      if (/gesture|activation/i.test(m)) throw new Error('The device prompt needs a fresh click — click Connect Ledger again.');
      throw e;
    }
    device = (picked && picked.length) ? (picked.find((d) => d.vendorId === LEDGER_VID) || picked[0]) : null;
  }
  if (!device) throw new Error('No Ledger selected. Plug in & unlock your Ledger, open the Bitcoin app, then click Connect and choose your device in the browser prompt.');
  try {
    transport = await TransportWebHID.open(device); // opens + wires the transport (same call Ledger uses)
  } catch (e) {
    const m = String((e && e.message) || e || '');
    if (/in use|already open|failed to open|access denied|notallowed|securityerror|unable to claim/i.test(m)) {
      throw new Error('Your Ledger is busy — it looks open in another app or tab. Quit Ledger Live, close other Wonder Wallet tabs, then unplug & replug the Ledger and reconnect.');
    }
    throw new Error('Could not open the Ledger (' + m + '). Make sure it’s unlocked with the Bitcoin app open, then try again.');
  }
  return { connected: true };
}
async function disconnect() { try { await transport?.close(); } catch (_) {} transport = null; }
function requireDevice() { if (!transport) throw new Error('No device connected.'); return transport; }

// Force a FRESH device grant via the browser picker, ignoring any already-granted (possibly stale)
// device. This is the recovery that reliably works when a silently-reused grant lands the device in a
// bad state (seen in the extension context): drop the old transport, re-prompt, open the chosen device.
// Must be called from a user gesture (a button click) so requestDevice() is allowed to show the picker.
async function forceReconnect() {
  if (!isSupported()) throw new Error('WebHID not available — use a Chromium browser over HTTPS.');
  try { await transport?.close(); } catch (_) {}
  transport = null;
  let picked = [];
  try { picked = await navigator.hid.requestDevice({ filters: [{ vendorId: LEDGER_VID }] }); }
  catch (e) { const m = String((e && e.message) || e || ''); if (/gesture|activation/i.test(m)) throw new Error('The device prompt needs a fresh click — click Reconnect again.'); throw e; }
  const device = (picked && picked.length) ? (picked.find((d) => d.vendorId === LEDGER_VID) || picked[0]) : null;
  if (!device) throw new Error('No Ledger selected. Unlock it, open the Bitcoin app, then choose your device in the browser prompt.');
  try { transport = await TransportWebHID.open(device); }
  catch (e) { const m = String((e && e.message) || e || ''); throw new Error('Could not open the Ledger (' + m + '). Make sure it’s unlocked with the Bitcoin app open.'); }
  return { connected: true };
}

// ── Ledger app management (BOLOS) ──────────────────────────────────────────
// A Ledger runs ONE app at a time. Bitcoin address/sign needs the Bitcoin app open,
// Ethereum needs the Ethereum app, Solana the Solana app — sending an instruction to
// the wrong app (or the dashboard) returns 0x6d00 INS_NOT_SUPPORTED. So before each
// chain's ops we detect the running app and switch if needed (which re-enumerates the
// USB device, so we reconnect the transport afterwards).
async function currentApp() {
  const r = await transport.send(0xb0, 0x01, 0x00, 0x00); // getAppAndVersion
  if (!r || r.length < 2) return '';
  const nameLen = r[1];
  return r.slice(2, 2 + nameLen).toString('ascii'); // 'BOLOS' on the dashboard
}
async function launchApp(name) { try { await transport.send(0xe0, 0xd8, 0x00, 0x00, Buffer.from(name, 'ascii')); } catch (_) {} }
async function exitApp() { try { await transport.send(0xb0, 0xa7, 0x00, 0x00); } catch (_) {} }
// After an app switch the device drops + re-enumerates; re-open the (already-permitted) device.
async function reopen() {
  try { await transport?.close(); } catch (_) {}
  transport = null;
  await sleep(700);
  for (let i = 0; i < 10 && !transport; i++) {
    try { transport = await TransportWebHID.openConnected(); } catch (_) {}
    if (!transport) await sleep(400);
  }
  if (!transport) transport = await TransportWebHID.create();
}
// Ensure `name` app is foregrounded. Throws a clear message if it can't be opened.
async function ensureApp(name) {
  let cur = null;
  try { cur = await currentApp(); } catch (_) { return; } // very old firmware: assume caller's app is fine
  if (cur === name) return;
  if (cur && cur !== 'BOLOS') { await exitApp(); await reopen(); }
  await launchApp(name);
  await reopen();
  let cur2 = null;
  try { cur2 = await currentApp(); } catch (_) {}
  if (cur2 && cur2 !== name) throw new Error(`Open the ${name} app on your Ledger, then try again.`);
}

const PATHS = {
  nativeSegwit: (a) => `84'/0'/${a}'/0/0`,
  legacy: (a) => `44'/0'/${a}'/0/0`,
  taproot: (a) => `86'/0'/${a}'/0/0`,
  ethereum: (a) => `44'/60'/${a}'/0/0`,
  solana: (a) => `44'/501'/${a}'`,
};

/** Derive the device's public addresses (no keys leave the device). Bitcoin is required
 *  (this is a Bitcoin-first wallet); Ethereum & Solana are best-effort — if their Ledger
 *  apps aren't installed/openable we simply skip them and note it, rather than failing. */
async function getAddresses(account = 0) {
  requireDevice();
  const out = { account, bitcoin: {}, ethereum: null, solana: null, missing: [] };

  // Bitcoin (primary) — must succeed. Needs the Bitcoin app. The app-switch + USB re-enumeration can
  // need a second beat before the first read lands (esp. in the extension context, where it surfaced as
  // a false "open the Bitcoin app" / INS_NOT_SUPPORTED). Retry the ensureApp + first read once.
  let btcApp;
  for (let attempt = 0; ; attempt++) {
    try {
      await ensureApp('Bitcoin');
      btcApp = new Btc({ transport });
      out.bitcoin.nativeSegwit = { address: (await btcApp.getWalletPublicKey(PATHS.nativeSegwit(account), { format: 'bech32' })).bitcoinAddress, path: 'm/' + PATHS.nativeSegwit(account) };
      break;
    } catch (e) { if (attempt >= 1) throw e; await sleep(600); }
  }
  out.bitcoin.legacy = { address: (await btcApp.getWalletPublicKey(PATHS.legacy(account), { format: 'legacy' })).bitcoinAddress, path: 'm/' + PATHS.legacy(account) };
  try { out.bitcoin.taproot = { address: (await btcApp.getWalletPublicKey(PATHS.taproot(account), { format: 'bech32m' })).bitcoinAddress, path: 'm/' + PATHS.taproot(account) }; } catch (_) {}

  // Account-level pubkey + chaincode per type → lets the UI derive the WHOLE receiving-address chain
  // locally (a Ledger issues a fresh address each receive), so balances/assets beyond index 0 are
  // visible. Non-fatal: if unavailable, the wallet just falls back to the single index-0 view.
  // SINGLE attempt (best-effort). Do NOT retry here — extra reads on this btcApp interfere with the
  // AppClient master-fingerprint read below (which gates on-device signing / the Send button). If this
  // misses, we simply fall back to the index-0 view (Portfolio scan disabled), never breaking Send.
  const acctKey = async (p) => { try { const r = await btcApp.getWalletPublicKey(p, {}); return (r && r.publicKey && r.chainCode) ? { pub: r.publicKey, chainCode: r.chainCode } : null; } catch (_) { return null; } };
  try {
    out.bitcoin.nativeSegwit.acct = await acctKey(`84'/0'/${account}'`);
    out.bitcoin.legacy.acct = await acctKey(`44'/0'/${account}'`);
    if (out.bitcoin.taproot) out.bitcoin.taproot.acct = await acctKey(`86'/0'/${account}'`);
  } catch (_) {}
  // Master key fingerprint — enables on-device signing (the Send button). Retry once; a miss drops the
  // wallet to read-only. This is the LAST device read, so retrying it can't interfere with anything else.
  out.mfp = null;
  for (let i = 0; i < 2 && !out.mfp; i++) { try { const f = await new AppClient(transport).getMasterFingerprint(); if (f) out.mfp = f; } catch (_) {} if (!out.mfp) await sleep(300); }

  // Ethereum (optional) — switches to the Ethereum app.
  try { await ensureApp('Ethereum'); const ethApp = new Eth(transport); out.ethereum = { address: (await ethApp.getAddress(PATHS.ethereum(account))).address, path: 'm/' + PATHS.ethereum(account) }; }
  catch (_) { out.missing.push('Ethereum'); }

  // Solana (optional) — switches to the Solana app.
  try { await ensureApp('Solana'); const solApp = new Solana(transport); const r = await solApp.getAddress(PATHS.solana(account)); out.solana = { address: base58.encode(r.address), path: 'm/' + PATHS.solana(account) }; }
  catch (_) { out.missing.push('Solana'); }

  // Leave the device back on the Bitcoin app (primary chain) for subsequent signing.
  try { await ensureApp('Bitcoin'); } catch (_) {}
  return out;
}

// Add a single chain's address on demand (e.g. user installs the Ethereum app later).
async function getChainAddress(chain, account = 0) {
  requireDevice();
  if (chain === 'ethereum') { await ensureApp('Ethereum'); const e = new Eth(transport); return { address: (await e.getAddress(PATHS.ethereum(account))).address, path: 'm/' + PATHS.ethereum(account) }; }
  if (chain === 'solana') { await ensureApp('Solana'); const s = new Solana(transport); const r = await s.getAddress(PATHS.solana(account)); return { address: base58.encode(r.address), path: 'm/' + PATHS.solana(account) }; }
  await ensureApp('Bitcoin'); const b = new Btc({ transport });
  return { address: (await b.getWalletPublicKey(PATHS.nativeSegwit(account), { format: 'bech32' })).bitcoinAddress, path: 'm/' + PATHS.nativeSegwit(account) };
}

// ── Signing adapters (device confirms on its screen) ──

// Standard single-sig policies per address type — the account purpose + the descriptor the device
// registers as its default (empty-name) wallet. Native SegWit (bc1q), Legacy 1… (OG Counterparty /
// Stamps), and Taproot bc1p all sign this way; the PSBT carries each input's derivation so the device
// knows which of its keys to use.
const SIGN_DESC = {
  nativeSegwit: ['84', 'wpkh(@0/**)'],
  legacy: ['44', 'pkh(@0/**)'],
  taproot: ['86', 'tr(@0/**)'],
};
/** Sign a (CP-aware, asset-safe) PSBT on the Ledger for the given single-sig address type. */
async function signPsbt(psbtBase64, account = 0, type = 'nativeSegwit') {
  requireDevice();
  await ensureApp('Bitcoin');
  const app = new AppClient(transport);
  const fpr = await app.getMasterFingerprint();
  const [purpose, desc] = SIGN_DESC[type] || SIGN_DESC.nativeSegwit;
  const acct = `${purpose}'/0'/${account}'`;
  const xpub = await app.getExtendedPubkey('m/' + acct);
  const policy = new WalletPolicy('', desc, [`[${fpr}/${acct}]${xpub}`]); // empty name = standard/default policy
  // The Ledger AppClient signs a PsbtV2 OBJECT — passing a base64 string makes it deref undefined
  // ("Cannot read properties of undefined (reading 'length')"). Our PSBTs are v0 (BIP-174) from
  // @scure/btc-signer, so convert v0 → PsbtV2 first (allowTxnVersion1=true, matching Ledger's own parser).
  const psbtv2 = PsbtV2.fromV0(Buffer.from(psbtBase64, 'base64'), true);
  const sigMap = await app.signPsbt(psbtv2, policy, null); // Map<inputIndex, signatureBytes>
  // Reshape to finalizeHwSend's [[idx, {pubkey, signature}]]. The device yields the signature bytes only;
  // the pubkey comes from the input's BIP32 derivation (exactly how Ledger's own BtcNew consumes it).
  const signatures = [];
  sigMap.forEach((sig, idx) => {
    const pk = psbtv2.getInputKeyDatas(idx, psbtIn.BIP32_DERIVATION);
    signatures.push([idx, { pubkey: (pk && pk.length) ? pk[0] : null, signature: sig }]);
  });
  return { signatures, policy: desc, type };
}

/** Sign an unsigned EIP-1559 tx (raw RLP hex without 0x) → {v,r,s}. */
async function signEthTx(unsignedRawHex, account = 0) {
  requireDevice();
  await ensureApp('Ethereum');
  const ethApp = new Eth(transport);
  const sig = await ethApp.signTransaction(PATHS.ethereum(account), unsignedRawHex.replace(/^0x/, ''), null);
  return sig; // { v, r, s }
}

/** Sign a Solana transaction message (bytes) → 64-byte signature. */
async function signSolMessage(messageBytes, account = 0) {
  requireDevice();
  await ensureApp('Solana');
  const solApp = new Solana(transport);
  const { signature } = await solApp.signTransaction(PATHS.solana(account), Buffer.from(messageBytes));
  return signature; // Uint8Array(64)
}

const WonderHW = { isSupported, connect, forceReconnect, disconnect, getAddresses, getChainAddress, signPsbt, signEthTx, signSolMessage, vendor: 'ledger' };
if (typeof window !== 'undefined') window.WonderHW = WonderHW;
export default WonderHW;
