# Changelog

Notable changes to Wonder Wallet. The project is pre-1.0 and in active development; the extension and
the hosted Terminal version independently. Dates are approximate to the release window.

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
