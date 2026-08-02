# Wonder Wallet — dApp Provider Build Plan (Phase 12)

**Status:** Drafted 2026-07-30 · **Queued for post-approval** (do NOT ship while extension v0.47.24 is in first Chrome Web Store review) · Target line: **v0.48.x → v0.50.x**

Goal: let websites (stampchain.io, stampscan.xyz, xcp.io, horizon.market, openstamp.io, emblem.vision, emblemvault.ai, and any EVM/Solana dApp) **request a connection to Wonder Wallet**, get accounts, and request signatures — with a **persistent per-origin permission** that lasts until the user revokes it, managed from a new **Connected Sites** tool in the Advanced menu.

This plan is written to be run as a **guided build** (phased, checkpoint after each milestone, security + UX audit at the end).

---

## 0. Non-negotiable security constraints (carry over, unchanged)

1. **Keys/seed never leave the browser.** The provider exposes *addresses, public keys, and signatures* — never private material. WIF/seed stay in the Argon2id/AES-GCM vault.
2. **Every connection is explicit + per-origin.** No auto-connect. The user approves an origin once (Connect), and approves **every** signature/transaction (Sign). No blanket "sign anything" grant.
3. **The asset-aware + RBF protections apply to dApp-initiated transactions too.** A PSBT handed in by a site is decoded and screened (asset-bearing UTXOs flagged) before the user signs — a dApp must not be able to trick the wallet into spending a Stamp/asset UTXO as plain sats.
4. **Origin is authenticated + shown prominently** (anti-phishing). The approving UI shows the real requesting origin; requests from `file://`, opaque origins, or mismatched frames are rejected.
5. **No key material or tokens over the page bridge.** The inpage↔content↔background channel carries only method calls + results; the DASHBOARD_TOKEN / API keys never cross it.
6. **Locked wallet = no signing.** A sign request on a locked wallet prompts unlock first; it never signs silently.
7. **Do NOT impersonate** `window.unisat` / `window.okxwallet`. Expose our own `window.wonderWallet` namespace + standards-based discovery (see §3).
8. **Local transaction verification** (learned from XCP Wallet). Before signing, independently **decode + verify** the tx/PSBT against independently-fetched chain data — inputs' prevout **values** (via full prev-tx), outputs, recipient, and fee — so a compromised or malicious API/proxy cannot trick the signer into over-paying fees or spending the wrong coins. **Legacy P2PKH inputs: require the full `nonWitnessUtxo` and cross-check each prevout value — legacy sighash does not commit to input amounts** (reject a bare `witnessUtxo` for legacy).

---

## 1. Architecture (MV3 provider stack)

```
   dApp page (MAIN world)                 Extension
 ┌───────────────────────────┐        ┌──────────────────────────────┐
 │ window.wonderWallet   ─┐   │        │ background.js (service worker)│
 │ window.ethereum (6963) │   │ window │  • per-origin permission store│
 │ Wallet-Standard (SOL)  ├──postMessage──►│ content.js ├──runtime──►│  • request router / broker    │
 │  (inpage.js)          ─┘   │        │ (ISOLATED)  ◄──runtime──┤  • opens approval popups      │
 └───────────────────────────┘        │             ◄──postMsg──┘  • routes signing to the core  │
                                       └──────────────┬───────────────┘
                                                      │ chrome.windows.create (approval)
                                                      ▼
                                       popup approval pages (reuse wallet-core signing engine)
                                         • Connect  (approve origin + choose accounts)
                                         • Sign     (approve each PSBT / message / tx)
```

- **inpage.js** — injected into the page's **MAIN world** (from `web_accessible_resources`). Defines the provider objects dApps call. Talks to the content script only via `window.postMessage` with a namespaced envelope (`{ __ww: true, id, method, params }`) + origin checks.
- **content.js** — runs at `document_start` in the **ISOLATED world**. (a) Injects `inpage.js` into MAIN. (b) Relays messages page↔background (`chrome.runtime.sendMessage` / `onMessage`). Never exposes anything privileged to the page.
- **background.js** (already exists — extend it) — the **broker**: validates origin, checks the permission store, opens approval windows when needed, routes approved signing to the wallet core, and emits events (`accountsChanged`, `disconnect`) back to connected tabs.
- **Approval pages** — small popup windows (`chrome.windows.create`, `type:'popup'`) reusing `popup.js` + the audited `wallet-core.js` signing engine. Two flows: **Connect** and **Sign**.

---

## 2. Permission model & storage

`chrome.storage.local` key `ww:connections`:
```jsonc
{
  "https://stampchain.io": {
    "accounts": ["bc1q…"],          // addresses granted (usually the active account's)
    "chains": ["btc"],              // btc | eth | sol
    "accountRef": "hd:0",           // which WW account is bound (hd:i | imp:id | hardware)
    "grantedAt": 1785370000000,
    "lastUsed": 1785370500000
  }
}
```
- **Connect** writes the entry; **Revoke** deletes it and notifies the tab (`disconnect`).
- Switching the active account while a site is connected → emit `accountsChanged` to that origin (respecting what it's allowed to see).
- Persistence = the entry simply survives; there is **no expiry** (matches the "until revoked" requirement). Optional later: "forget after N days idle."

---

## 3. The provider APIs (one per ecosystem — no single standard)

### 3a. Bitcoin / Stamps / SRC-20 / Counterparty — `window.wonderWallet` (UniSat-shaped)
De-facto standard is UniSat's `window.unisat`; OKX/TapWallet mirror it. We expose the **same method surface** under our own namespace so integration is one familiar line for site devs, and we **register for sats-connect / Wallet-Standard-for-Bitcoin** so Leather/Xverse-style discovery finds us without impersonation.

Method surface (mirrors UniSat):
- `requestAccounts()` → `string[]` (triggers Connect approval if origin not permitted)
- `getAccounts()` → `string[]` (permitted origins only; else `[]`)
- `getPublicKey()` → hex string
- `getNetwork()` / `switchNetwork()` (mainnet only for v1)
- `getBalance()` → `{ confirmed, unconfirmed, total }`
- `signMessage(msg, type?)` → signature (BIP-322 / ECDSA) — **Sign approval**
- **`signPsbt(psbtHex, { autoFinalized, toSignInputs:[{ index, address|publicKey, sighashTypes, disableTweakSigner }] })`** → signed psbt hex — **Sign approval + asset-aware screen**
- `signPsbts(psbtHexs, options)` → `string[]`
- `pushPsbt(psbtHex)` / `pushTx(rawtx)` → txid (broadcast via our proxy)
- Events: `accountsChanged`, `networkChanged`, `disconnect`
- **`getStamps()` / `getSrc20()`** (WW extension methods) — Stamps/SRC-20 holdings for the connected address (nice-to-have; sites can also read their own indexers).

> This is exactly what stampchain/stampscan/OpenStamp/horizon need: **the site builds the CP/Stamp/SRC-20 tx and hands us a PSBT; we screen + sign + broadcast.**

### 3b. Ethereum — EIP-1193 + **EIP-6963**
- `window.ethereum` with `request({ method, params })` (`eth_requestAccounts`, `eth_accounts`, `eth_chainId`, `personal_sign`, `eth_sendTransaction`, `eth_signTypedData_v4`, `wallet_switchEthereumChain`).
- **EIP-6963** multi-provider announcement (`eip6963:announceProvider`) → collision-free auto-discovery; WW appears alongside MetaMask etc. **with no site changes.**

### 3c. Solana — **Wallet Standard**
- Register a Wallet-Standard wallet (`connect`, `disconnect`, `signTransaction`, `signAllTransactions`, `signMessage`, `signIn`) via `window.navigator.wallets` / `registerWallet`.
- Auto-discovered by `@solana/wallet-adapter` → **emblemvault.ai and any Solana dApp show "Wonder Wallet" automatically, no site changes.**

### 3d. Refinements adopted from XCP Wallet v0.5.2 (peer review, 2026-07-30)
XCP Wallet (the leading Counterparty extension) injects its **own** `window.xcpwallet` — validating our decision #2 (own namespace, no impersonation). Adopt these specific patterns so a dApp that already integrated `xcpwallet` can add Wonder Wallet with near-identical code:

- **Use the EIP-1193-style `request({ method, params })` + `on`/`removeListener` envelope** for `window.wonderWallet` (not just flat UniSat methods), with **`ww_`-prefixed** methods that **mirror xcp's shape** (`ww_requestAccounts`, `ww_accounts`, `ww_disconnect`, `ww_signMessage`, `ww_signPsbt`, `ww_signTransaction`, `ww_broadcastTransaction`, `ww_getAddresses`, `ww_getBalances`). Also keep a thin UniSat-flat alias surface for sites that only speak `unisat`-style. Provide the same numeric **error codes** (`4001` user-reject, `4100` locked/not-connected, `4200` unsupported, `4900` background-unavailable-retry, `-32603` internal).
- **BIP-322 proof at connect ("Sign-In With Bitcoin").** `ww_requestAccounts` returns `{ address, message, signature, verification }` — an extension-generated message containing **origin + nonce + issued-timestamp**, auto-signed at approval (no extra prompt). Sites verify origin match, freshness (<5 min), the BIP-322 sig, and optionally store the nonce for replay prevention. One round-trip auth.
- **Paired Legacy+SegWit signing capability (opt-in, scoped).** Counterparty assets live on **Legacy (1…)** addresses while users hold SegWit — marketplace/atomic-swap flows need to sign across the **same-index Legacy+SegWit pair in one pass**. Add an opt-in `capabilities:{ pairedAddresses:true }` at connect, gated by an explicit consent checkbox, **scoped to origin+wallet+address-index and revoked on disconnect**; it may disclose the pair and sign **only explicitly identified inputs**, never other derivation indices. (Privacy note surfaced to the user: links the two addresses to one wallet.)
- **Sighash allowlist.** Accept only `SIGHASH_DEFAULT (0x00)`, `ALL (0x01)`, `ALL|ANYONECANPAY (0x81)`, `SINGLE|ANYONECANPAY (0x83)` for dApp-requested signing; **reject `NONE` and bare `SINGLE`**.
- **Fail-closed input validation before the approval UI:** reject unrelated derivation indices, duplicate/out-of-range input indices, unsupported sighashes, and malformed layouts. `signInputs` must be ≥1, unique, in-range, and match each input's prevout address.
- **Event semantics:** `accountsChanged []` on **lock** (connection retained; unlock re-emits); `disconnect` **only** on explicit revoke. Re-check the grant immediately before signing; **replay protection on broadcast**.
- **Ship a small SDK** (like their `lib/wallet/sdk`) alongside `developers.html`, not just a snippet — a tiny `wonder-wallet-connect` npm/ESM module wrapping detection + `request()`.
- **Taproot key-path correctness** (they just fixed this): P2TR inputs need `tapInternalKey` (x-only) + `SIGHASH_DEFAULT` so the library applies the BIP341 tweak → assert a **64-byte schnorr witness** in tests. Verify Wonder Wallet's own Taproot signing matches before exposing it via the provider.

---

## 4. Manifest changes (⚠️ triggers heavier store re-review)

```jsonc
// add:
"content_scripts": [{
  "matches": [ /* v1: ALLOWLIST the verified directory domains, not <all_urls> */
    "https://stampchain.io/*","https://stampscan.xyz/*","https://xcp.io/*",
    "https://horizon.market/*","https://openstamp.io/*","https://stampverse.io/*",
    "https://emblem.vision/*","https://emblemvault.ai/*"
  ],
  "js": ["content.js"],
  "run_at": "document_start",
  "all_frames": false
}],
"web_accessible_resources": [{
  "resources": ["inpage.js"],
  "matches": ["https://stampchain.io/*", /* …same allowlist… */ ]
}],
// permissions: add "scripting" (to inject inpage into MAIN world) if not using world:"MAIN"
```
- **Allowlist-first is the security + reviewability posture** (matches our "verified directory" ethos): the provider only injects on trusted ecosystem sites at launch. A later **Advanced toggle** ("Inject on all sites") can broaden to `<all_urls>` for power users.
- CSP for extension pages is unchanged (approval pages are our own pages). The **page's** CSP is the site's concern — our inpage script is injected by us, not fetched by them.
- **Store note:** new `content_scripts` + `scripting` = new permission warnings ("read and change data on [sites]") → justify in the listing as "inject the wallet connector on the listed dApp sites." Expect a slower re-review than a normal update. This is *the* reason to keep it off the in-review v0.47.24.

---

## 5. UX — approval pages + Connected Sites manager

- **Connect approval** (mirrors the OKX dialog the user shared): favicon + **origin**, "Allow this dApp to connect", the account/address(es) it will see, an account picker (reuse `accountSelectHtml`), **Cancel / Connect**. On approve → write `ww:connections[origin]`, resolve `requestAccounts`.
- **Sign approval** — for `signPsbt`/`signMessage`/`eth_sendTransaction`/Solana `signTransaction`: show origin + a **decoded, human-readable summary**. For BTC PSBTs, run the **coin-control classifier** and **warn if any input carries a Stamp/CP asset**; show inputs/outputs, fee, net change. **Cancel / Sign.** Locked → unlock first.
- **Connected Sites manager** — new Advanced-menu entry. In `advancedMenu()` (popup.js:1849) add:
  `'<button class="adv-opt" data-adv="sites"><b>Connected sites</b><span>dApps allowed to connect to this wallet</span></button>'`
  and a handler → list each origin (favicon, domain, account bound, last used) with a **Revoke** button (deletes the store entry + emits `disconnect`). A global "Disconnect all."

---

## 6. File-by-file work breakdown (maps to the real tree)

| File | New/Change | Purpose |
|---|---|---|
| `extension/src/inpage.js` | **new** | MAIN-world provider objects (BTC/ETH/SOL) + postMessage client |
| `extension/src/content.js` | **new** | document_start bridge; inject inpage; relay page↔background |
| `extension/src/background.js` | **change** | permission store, request router, approval-window opener, event emitter |
| `extension/src/provider-btc.js` | **new** | UniSat-shaped BTC methods + sats-connect/Wallet-Standard registration |
| `extension/src/provider-eth.js` | **new** | EIP-1193 + EIP-6963 announce |
| `extension/src/provider-sol.js` | **new** | Wallet Standard registration |
| `extension/src/popup.js` | **change** | `renderConnectApproval()`, `renderSignApproval()`, Connected Sites manager in `advancedMenu()`, `?connect=`/`?sign=` route handling |
| `extension/src/popup.css` | **change** | approval + connected-sites styles |
| `wallet-src/index.js` | **reuse/extend** | signing primitives (already have PSBT build/sign, finalize, BIP-322); add a "screen PSBT for assets" helper if not present |
| `extension/manifest.json` + `build-ext.mjs` | **change** | content_scripts (allowlist), web_accessible_resources, `scripting` perm |
| `public/developers.html` | **new** | dev docs + copy-paste connector snippet, served at wonder-wallet.com/developers |
| `extension/test-dapp.html` (or a public harness) | **new** | local test page exercising requestAccounts/signPsbt/etc. |

---

## 7. Phased milestones (checkpoint after each)

- **v0.48.0 — BTC provider MVP.** background broker + permission store + content/inpage bridge + `window.wonderWallet` (UniSat-shaped) + **Connect** & **Sign(PSBT, asset-screened)** approvals + **Connected Sites** manager. Allowlist = verified directory. → build, security pass, **re-submit** (expect slower review).
- **v0.48.1 — Discovery + docs.** sats-connect / Wallet-Standard-for-BTC registration; publish `developers.html` + connector snippet; reach out to stampchain/stampscan to add a "Wonder Wallet" button.
- **v0.49.0 — Ethereum.** EIP-1193 + EIP-6963 (auto-discovery; works on EVM dApps with no site changes).
- **v0.49.1 — Solana.** Wallet Standard (emblemvault.ai + Solana dApps auto-list WW).
- **v0.50.0 — Power features.** Advanced "inject on all sites" toggle (→ `<all_urls>`, another review), dApp message signing (BIP-322), and **Ledger signing via the provider** (route Sign approval to on-device signing).

---

## 8. Testing

- **Local test dApp** (`test-dapp.html`) — buttons for connect / getPublicKey / signPsbt / signMessage / pushTx; run against the extension loaded unpacked.
- **Playwright** e2e (extend `tests/`): load extension, drive a test page, assert the Connect approval opens, approve, assert accounts returned; assert a PSBT with an asset input raises the warning.
- **Manual**: connect to a real site (stampchain testnet flow) end-to-end once the connector button exists.
- **Adversarial**: malicious-origin spoofing, PSBT that hides an asset UTXO, locked-wallet sign attempt, revoked-origin re-request, cross-frame request.

## 9. Locked decisions (confirmed 2026-07-30)
1. **Injection scope → ALLOWLIST at launch.** v1 content_scripts match only the verified directory domains; an Advanced "inject on all sites" toggle broadens to `<all_urls>` in v0.50 (separate review).
2. **Namespace → `window.wonderWallet` + sats-connect / Wallet-Standard discovery. NO impersonation** of `window.unisat`/`window.okxwallet`.
3. **Account a site sees → PIN the account chosen in the Connect dialog.** Provide an explicit per-site "switch account" that re-emits `accountsChanged`; do not silently follow the wallet's active-account switches.
4. **Hardware (Ledger) via provider → v0.50** (route the Sign approval to on-device signing after the seed-based flows are proven).

## 10. Risk register
- **Security surface ↑↑** — mitigated by allowlist, per-origin + per-signature approval, asset screening, origin authentication, no key/token over the bridge.
- **Store re-review friction** — mitigated by allowlist scoping + clear permission justification; keep off the in-review build.
- **BTC discovery fragmentation** — mitigated by shipping our namespace + sats-connect and courting the (community, reachable) Stamps sites for a native button.
- **Standing invariants preserved** — asset-aware coin-control, RBF-reuses-only-original-inputs, keys-local, and the audited signing core are all *reused*, not bypassed.
