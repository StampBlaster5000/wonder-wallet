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
import Eth from '@ledgerhq/hw-app-eth';
import Solana from '@ledgerhq/hw-app-solana';
import { base58 } from '@scure/base';

let transport = null;

const isSupported = () => typeof navigator !== 'undefined' && !!navigator.hid;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect() {
  if (!isSupported()) throw new Error('WebHID not available — use a Chromium browser over HTTPS.');
  transport = await TransportWebHID.create(); // prompts device permission + selection
  return { connected: true };
}
async function disconnect() { try { await transport?.close(); } catch (_) {} transport = null; }
function requireDevice() { if (!transport) throw new Error('No device connected.'); return transport; }

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

  // Bitcoin (primary) — must succeed. Needs the Bitcoin app.
  await ensureApp('Bitcoin');
  const btcApp = new Btc({ transport });
  out.bitcoin.nativeSegwit = { address: (await btcApp.getWalletPublicKey(PATHS.nativeSegwit(account), { format: 'bech32' })).bitcoinAddress, path: 'm/' + PATHS.nativeSegwit(account) };
  out.bitcoin.legacy = { address: (await btcApp.getWalletPublicKey(PATHS.legacy(account), { format: 'legacy' })).bitcoinAddress, path: 'm/' + PATHS.legacy(account) };
  try { out.bitcoin.taproot = { address: (await btcApp.getWalletPublicKey(PATHS.taproot(account), { format: 'bech32m' })).bitcoinAddress, path: 'm/' + PATHS.taproot(account) }; } catch (_) {}

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

/** Sign a (CP-aware, asset-safe) PSBT on the Ledger. Native SegWit single-sig. */
async function signPsbt(psbtBase64, account = 0) {
  requireDevice();
  await ensureApp('Bitcoin');
  const app = new AppClient(transport);
  const fpr = await app.getMasterFingerprint();
  const path = `m/84'/0'/${account}'`;
  const xpub = await app.getExtendedPubkey(path);
  const policy = new WalletPolicy('', 'wpkh(@0/**)', [`[${fpr}/84'/0'/${account}']${xpub}`]); // empty name = standard/default policy
  const entries = await app.signPsbt(psbtBase64, policy, null); // [[inputIndex, PartialSig]]
  return { signatures: entries, policy: 'wpkh' };
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

const WonderHW = { isSupported, connect, disconnect, getAddresses, getChainAddress, signPsbt, signEthTx, signSolMessage, vendor: 'ledger' };
if (typeof window !== 'undefined') window.WonderHW = WonderHW;
export default WonderHW;
