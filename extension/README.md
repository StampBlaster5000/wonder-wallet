# Wonder Wallet — browser extension (v1)

Self-custodial BTC · ETH · SOL wallet, packaged as an MV3 extension. Keys are generated and
Argon2id-encrypted **in the browser** (IndexedDB) and never leave the device. In this first
version, public blockchain **reads** go through the stateless proxy (no user data touches it);
a later version ports reads fully client-side (direct to the chains).

## Build

```bash
NODE_PATH=$(npm root -g) node extension/build-ext.mjs
```

This assembles the loadable extension into **`extension/dist/`** (manifest, popup, expanded
full-wallet page, the shared engine + UI modules, icons).

## Load it (Chrome / Brave / Edge)

1. Go to `chrome://extensions`
2. Toggle **Developer mode** (top-right)
3. Click **Load unpacked** and select the **`extension/dist`** folder
4. Pin **Wonder Wallet** and click the toolbar icon

- **Popup** — compact wallet: unlock, account switcher, balances, receive/send.
- **Open full wallet** (or Send) opens the **expanded** tab with the full toolset (Counterparty
  DEX, issuance suite, coin-control, SRC-20 / Stamp minting, Emblem Vault bridge, dApp hub).

## Architecture

- `popup.html` / `popup.js` — compact popup (uses `window.WonderCore` + the read shim).
- `expanded.html` — full wallet; reuses the exact web-app modules unchanged.
- `shim.js` — rewrites the modules' relative `api/…` calls (and stamp-art `<img>`/`<iframe>`)
  to the stateless proxy. Change `PROXY` in `extension/src/shim.js` to self-host the reader.
- `background.js` — MV3 service worker (lifecycle + open-full-tab). No remote code.
- `wallet-core.js` — the audited signing engine (BIP-39/32, @scure/@noble). Local only.

## Security notes

- Keys, seed, and the encrypted vault live only in this browser (IndexedDB). The proxy holds
  **zero** user data and never sees keys.
- Strict CSP (`script-src 'self'`, no remote code). Fonts from Google Fonts only.
- Auto-lock is enforced in-page by `wallet-core`.
