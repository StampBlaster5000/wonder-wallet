# Changelog

Notable changes to Wonder Wallet. The project is pre-1.0 and in active development; the extension and
the hosted Terminal version independently. Dates are approximate to the release window.

## Blockchain switcher & top-row redesign — Terminal v0.34 (2026-08-15)

- **Blockchain switcher, extension-style.** A logo-only coin button (solid brand-colored Bitcoin /
  Ethereum / Solana marks) at the top-left opens a **Choose blockchain** picker. The whole wallet is now
  *dedicated to the selected chain* — balance, assets, and actions all reflect only that chain. Watch-only
  and imported (single-chain) accounts show a static coin instead of a switcher.
- **Per-chain chain tabs removed** — the switcher replaces the old BTC/ETH/SOL tab row above the assets.
- **Single-chain balance module** — one panel shows just the active chain's balance (no more 3-card strip
  + total), and only that chain's balance is fetched.
- **Send / Receive moved into the balance module** (`Send BTC`/`Send ETH`/`Send SOL` + Receive), adapting
  per chain. The old separate action row is gone.
- **Coin Control folded into Activity** — the standalone Coin Control button is removed; it's now reached
  from a button inside the Activity view, sharing one entry point (mirrors the extension).
- **Top-row redesign.** A dedicated top strip holds the **blockchain toggle (left) · Mainnet/Testnet
  toggle (centered) · Lock (right)**, divided by a hairline from the account row (account selector +
  address-type on the left, privacy toggle + Advanced on the right). The Mainnet toggle relocated here
  from the old header.
- **"keys never leave your browser" header removed** — the wallet no longer opens with a security-ad line.
- Trimmed the top padding so the strip sits compactly at the top of the card. Version → v0.34.0.

## Terminal UX & mobile polish — Terminal v0.33 (2026-08-13)

- **Stay signed in + idle auto-lock** (Advanced → *Auto-lock & stay signed in*). Opt-in: a refresh no
  longer forces a re-login. Choose **Lock on refresh** (default, memory-only), **1/5/15/30/60 min**, or
  **Never**. The unlocked session is kept in `sessionStorage` (cleared on tab close) *only* when enabled;
  the core's no-password session-restore stays hard-gated to the extension unless the user opts in
  (`ww:persist`), so the audit-hardened default is preserved.
- **Refresh returns to your last account + chain** (`ww:lastacct` / `ww:lastchain`) instead of jumping to
  Account 0 — for HD, imported, and watch-only accounts.
- **"Pro" account picker** — the native `<select>` is replaced by a grouped **Accounts** modal
  (My accounts / Imported / Watching / Hardware), a selected-state dot, per-account rename/delete kebab
  menu, and an add entry — mirroring the extension.
- **Counterwallet import** relabeled to *"Import a Counterwallet / FreeWallet"* (it imports the old
  addresses' **keys** into this wallet — not a seed). Imported accounts are now labeled **Counterparty**.
  Fixed imported accounts disappearing after a refresh (the persisted-session snapshot re-syncs on
  import/remove).
- **SRC-20 send fixes** — the token-row **Send** now uses the currently-selected address type (e.g.
  Legacy), matching the loaded assets (was hardcoded to native SegWit). Quick-send from a token is
  **Transfer-only**; Deploy/Mint remain in the side-panel suite.
- **Header de-clutter** — Backup moved into Advanced; the ☰ Tools toggle moved out of the site header into
  the wallet card; Home link (no arrow) + clickable logo. Privacy (mask balances) stays in the wallet header.
- **Mobile** — account bar wraps cleanly; the three chain balances render in a compact row with the Total
  spanning full-width below; tighter controls and less edge padding.
- **No-hard-refresh dev loop** — the Terminal HTML is served `no-cache` and auto-stamps each local
  `.js`/`.css` with its file mtime, so edits appear on a normal refresh (Cloudflare was pinning a 4-hour
  browser cache TTL on assets).
- Password floor unified to **8** on create/restore; password-field padding + lock-screen eye-toggle
  alignment; the browser's native password-reveal control is hidden (we render our own).

## Testnet Mode — extension v0.51 / Terminal v0.32 (2026-08)

- **Global Mainnet ⇄ Testnet toggle** across the key engine, server proxy, Terminal, and extension.
  Bitcoin **testnet4**, Counterparty **testnet4**, Ethereum **Sepolia**, Solana **devnet**.
- Testnet Bitcoin derives at **BIP-44 coin type 1′** — cryptographically separate from mainnet;
  cross-network signing is impossible (`tests/testnet-isolation.mjs`).
- Per-request network routing via a `?network=testnet` query param + `AsyncLocalStorage` context
  (`sources/netctx.js`); network-scoped caches; `no-store` on JSON data routes.
- In-wallet testnet banner, faucet links, and fiat hidden ("no value").
- **SRC-20 dry run** on testnet (construct + price the inscription locally, never broadcast — there is
  no reliable public testnet Stamps indexer). Classic Stamps mint on testnet4; SRC-101 stays mainnet.
- The connect/approval window mirrors the extension's network (grants the `tb1…` testnet address and
  signs with the testnet key); the Terminal auto-mirrors a connected testnet wallet.
- See [`docs/TESTNET.md`](docs/TESTNET.md).

## Universal dApp provider — extension v0.48–v0.50 (2026-07 → 08)

- **Any website can connect to Wonder Wallet across all three chains.** BTC via `window.wonderWallet`
  (UniSat-shaped API), Ethereum via **EIP-1193 + EIP-6963** (announced, no `window.ethereum` clobber),
  Solana via the **Wallet Standard**.
- **Per-origin approval, no blind signing** — origin authenticated from Chrome's sender; every connect
  and signature shows origin + a full breakdown + prioritized warnings. Read-only RPC served without a
  prompt; signs/connects require approval.
- Sign-In With Bitcoin (BIP-322 proof at connect), EIP-712 typed-data, EIP-191 `personal_sign`,
  generic EVM JSON-RPC passthrough, Solana versioned (v0) transaction signing, a Connected-sites
  manager, and an integration guide served at `public/developers.html`.
- Validated live on OpenSea (connect + SIWE), Jupiter (Solana), and Counterparty/Stamps flows.

## Earlier highlights

- **Wonder Terminal** at [wonder-wallet.com](https://wonder-wallet.com) — the full wallet in the
  browser, also connecting to injected UniSat / OKX / Wonder wallets.
- **Ledger hardware wallet** (WebHID) with a multi-address browser and asset-safe PSBT signing.
- **Emblem Vault bridge** — wrap Counterparty/Stamps assets to Ethereum & Solana.
- **Asset-aware coin-control** (never spend a Stamp / asset-bearing UTXO), RBF **⏫ Bump** + CPFP
  **⚡ Boost**, the full Counterparty + Stamps + SRC-20 + SRC-101 suite, and stamp-art rendering by MIME.
- **Chrome Web Store listing** — Wonder Wallet is live in the store.
