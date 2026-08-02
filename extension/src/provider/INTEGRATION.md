# dApp Provider — integration notes

> **Status: ACTIVATED (v0.49 → v0.50, live).** The provider is wired in and shipping — `build-ext.mjs`
> copies the provider stack, the manifest injects on all sites, `background.js` loads
> `background-wire.js`, and the popup's Advanced menu exposes Connected-sites. The notes below are
> retained as the design record and activation checklist.

These files under `extension/src/provider/` implement the universal dApp connector (BTC
`window.wonderWallet`, ETH EIP-1193/6963, SOL Wallet Standard) with a per-origin broker and the
no-blind-signing approval window.

## Status
- ✅ Phase 1 (spine + transport): `protocol.js`, `permissions.js`, `broker.js`, `inpage.js`, `content.js` + tests (`tests/provider-spine.cjs`). Pure logic proven in Node.
- ✅ Phase 2a (clear-signing + dialog): `tx-summary.js` (full breakdown + asset/sighash/fee/fake-message warnings, `tests/provider-tx-summary.cjs`), `WonderCore.describePsbt()` (PSBT→inputs{addr,value,sighash}+outputs, shipped in wallet-core), `approval.html`/`approval.js`/`approval.css` (Connect / Sign-message / Sign-PSBT / Broadcast dialogs — NO blind signing), `background-provider.js` (router + permission store + approval-window flow + events + Connected-sites data).
- ✅ Phase 2b (wiring): `approval.js` now computes the account on connect + SIGNS on approve via WonderCore (`accounts()`, `signMessage()`, `signProvider()`), resumes the session + shows a Locked screen if not unlocked; broadcast pushes via the SW. Core adds `signProviderPsbt` (sign only our inputs, sighash-allowlisted, `tests/provider-sign.cjs` 6/6) + `signProvider` session wrapper. Staged `background-wire.js` (all runtime listeners in one importScripts) + `connected-sites.js` (`WWConnectedSites.render` for the Advanced menu). **To ACTIVATE at v0.49:** copy the provider files (Step 1) + manifest keys (Step 2) + `background.js` adds `importScripts('provider/background-wire.js')` + `popup.js` advancedMenu gets the `data-adv="sites"` button calling `WWConnectedSites.render` (load `provider/connected-sites.js` in popup.html).
- 🟳 Phase 3 (mostly done): ✅ BIP-322 **proof-at-connect** (`proof.js` + `approval.js` connect auto-signs domain+nonce+issued; site verifies via `verifyProofClaims` + BIP-322); ✅ **paired Legacy+SegWit signing** (`signProviderPsbt` now takes `opts.types`; `signProvider` passes `['nativeSegwit','legacy']` when the grant has `pairedAddresses`; `tests/provider-phase3.cjs` green); ✅ `test-dapp.html` (harness + dev example). ⬜ REMAINING: **live per-UTXO asset tags** in the Sign dialog — `tx-summary.js` already renders DANGER when `decoded.inputs[].asset` is set; the piece left is PRODUCING those tags via coin-control/indexer (best validated against the live indexer at activation — the approval window queries per input UTXO and sets `asset:{kind,label}`). Fixed a real clear-signing bug en route: `nwOut()` handles `nonWitnessUtxo` as a decoded tx object (post-fromPSBT), so legacy/CP inputs now decode in `describePsbt`.
- 🟳 Phase 4 (discovery + reads done): ✅ `protocol.js` knows ETH (EIP-1193 names) + SOL (`sol_*`) methods; `classify` + new `chainOf()` route them; `broker` serves public reads (`eth_chainId`/`net_version`) pre-connect and `*_accounts` as `[]` when unconnected (`tests/provider-phase4.cjs` green). ✅ `eth-provider.js` = `window.ethereum` EIP-1193 + **EIP-6963 announce** (auto-discovery, no clobber). ✅ `sol-provider.js` = **Wallet Standard** registration (connect/signTransaction/signMessage/signAndSend). ✅ `content.js` injects all three; background `serveRead` is chain-aware (eth_accounts→eth addr, eth_chainId→0x1, sol_accounts→sol addr); connect grant stores `eth`/`sol` addresses. ✅ `public/developers.html` (served on the site — integration guide, not extension code). ✅ Phase 4b: ETH/SOL **sign dialogs** in `approval.js` — `renderSignEthMessage` (personal_sign, hex→utf8, `C.ethPersonalSign`), `renderSignEthTx` (eth_sendTransaction via `summarizeEthTx` → `C.sendEvm`), `renderSignSolMessage` (`C.solSignMessage`), `renderSignSolTx` (`C.solSignTransaction`). Core added `solSignMessage` + `solSignTransaction` (shortvec parse, signs ONLY our required-signer slot, `tests/provider-phase4b.cjs` green) + `summarizeEthTx`. Connect result is chain-shaped (eth→`[addr]`, sol→`{address}`, btc→`{accounts,proof}`); `sol-provider.js` derives the account pubkey via inline base58; `wallet_switchEthereumChain` is a mainnet no-op. ⬜ REMAINING polish (activation): eth_sendTransaction nonce/gas/chainId fetch via the eth proxy; `eth_signTypedData_v4` view; the Connected-sites menu button in popup.js.

### Phase 2b — background.js listeners (add at v0.49)
```js
importScripts('provider/protocol.js','provider/permissions.js','provider/broker.js','provider/background-provider.js');
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'ww_provider_request') {
    const origin = sender.origin || (sender.url && new URL(sender.url).origin); // TRUE origin from Chrome
    WWProviderBg.handleProviderRequest(origin, msg.method, msg.params, sender.tab?.id).then(sendResponse);
    return true;
  }
  if (msg?.type === 'ww_get_pending') { WWProviderBg.getPending(msg.id, sendResponse); return true; }
  if (msg?.type === 'ww_decision')   { WWProviderBg.onDecision(msg.id, msg.approved, msg.extra, sendResponse); return true; }
  if (msg?.type === 'ww_sites_list') { WWProviderBg.listSites(sendResponse); return true; }
  if (msg?.type === 'ww_sites_revoke'){ WWProviderBg.revokeSite(msg.origin, sendResponse); return true; }
});
```

### Phase 2b — approval.js compute/sign contract (the window holds the keys, not the SW)
- On CONNECT approve: `WonderCore.resumeSession()`; derive the active account's `{address, publicKey, addresses:{legacy,segwit,taproot}}`; optionally auto-sign a BIP-322 proof (origin+nonce+issued) → send via `decide(true, { accounts:[address], accountRef, publicKey, addresses, myAddresses, pairedAddresses, proof })`.
- On SIGN approve: resume session, then `WonderCore.signMessage(...)` / build+`send(...)` / `signCp(...)` as appropriate → `decide(true, { result })` (or `{ error:{code,message} }`). If `WonderCore.isUnlocked()` is false at load, `getPending`/route shows the Locked screen (set `locked:true`).

## Step 1 — build-ext.mjs
Copy the provider files into `dist/provider/`:
```js
// after the src copy loop (step 2):
mkdirSync(join(DIST, 'provider'), { recursive: true });
for (const f of ['protocol.js','permissions.js','broker.js','inpage.js','eth-provider.js','sol-provider.js','content.js','tx-summary.js','proof.js',
                 'background-provider.js','background-wire.js','approval.js','approval.css','approval.html','connected-sites.js','test-dapp.html'])
  copyFileSync(join(SRC, 'provider', f), join(DIST, 'provider', f));
```
(`approval.html` links `../popup.css` + `../wallet-core.js`; keep those relative paths correct when it lands in `dist/provider/` — adjust to `../popup.css`, `../wallet-core.js` at copy time or move approval.html to dist root.)

## Step 2 — manifest (in build-ext.mjs), ALLOWLIST-scoped (locked decision #1)
```js
const DAPP_HOSTS = [
  'https://stampchain.io/*','https://stampscan.xyz/*','https://xcp.io/*','https://horizon.market/*',
  'https://openstamp.io/*','https://stampverse.io/*','https://emblem.vision/*','https://emblemvault.ai/*',
];
manifest.permissions = ['storage','alarms','sidePanel','scripting'];
manifest.content_scripts = [{
  matches: DAPP_HOSTS,
  js: ['provider/content.js'],
  run_at: 'document_start',
  all_frames: false,
}];
manifest.web_accessible_resources = [{ resources: ['provider/inpage.js', 'provider/eth-provider.js', 'provider/sol-provider.js'], matches: DAPP_HOSTS }];
```
Bump `version` to `0.49.0`. Store note: justify the new host access as "inject the wallet connector on the listed dApp sites." Screenshots + a "Connected sites" shot recommended.

## Step 3 — background.js wiring (Phase 2)
```js
importScripts('provider/protocol.js','provider/permissions.js','provider/broker.js'); // classic SW
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== 'ww_provider_request') return;
  const origin = sender.origin || (sender.url && new URL(sender.url).origin); // TRUE origin from Chrome
  handleProviderRequest(origin, msg.method, msg.params, sender.tab?.id).then(sendResponse);
  return true; // async
});
// handleProviderRequest: load store from chrome.storage.local[WWPermissions.STORAGE_KEY],
// call WWBroker.decide({method,origin,store}); on 'serve' compute via wallet-core; on 'approve'
// open popup.html?connect=… / ?sign=… via chrome.windows.create and await the user's decision;
// on 'revoke' delete + emit 'disconnect'; on 'reject' return { error:{code,message} }.
```

## Invariants to preserve
Keys never leave the browser · every connection + every signature is user-approved in the extension UI ·
origin authenticated from Chrome sender info (never the page) · locked wallet cannot sign · the
asset-aware coin-control + local tx verification screen every dApp PSBT before signing.
