# Wonder Wallet

[![CI](https://github.com/StampBlaster5000/wonder-wallet/actions/workflows/ci.yml/badge.svg)](https://github.com/StampBlaster5000/wonder-wallet/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-E0B453.svg)](LICENSE)
[![Website](https://img.shields.io/badge/website-wonder--wallet.com-E0B453.svg)](https://wonder-wallet.com)
[![Chrome Web Store](https://img.shields.io/badge/Chrome-Add%20to%20Chrome-E0B453.svg)](https://chromewebstore.google.com/detail/wonder-wallet/jbdjhkopmpiihcnemgacddimdopbnnin)

🌐 **[wonder-wallet.com](https://wonder-wallet.com)**  ·  🧩 **[Add to Chrome](https://chromewebstore.google.com/detail/wonder-wallet/jbdjhkopmpiihcnemgacddimdopbnnin)** (live)  ·  💬 **[Telegram community](https://t.me/TryWonderWallet)**

**One self-custodial wallet for BTC · ETH · SOL — on every dApp.** Built for the Counterparty / Bitcoin&nbsp;Stamps / SRC-20 community: asset-aware UTXO control, a native on-chain DEX, the full issuance suite, Emblem&nbsp;Vault bridging, and a **universal dApp connector** that lets any website connect to your wallet across all three chains. **Your keys, your art, your data — all local.**

> ⚠️ **Beta software.** Use a **test wallet**, not your life savings. This is community software provided as-is; audit before trusting it with real funds.

---

## Why it exists

Counterparty, Bitcoin Stamps, and SRC-20 are some of the oldest and richest asset ecosystems on Bitcoin — but the tooling has always been fragmented and often custodial. Wonder Wallet puts the entire stack behind one self-custodial key: send/receive, an asset-aware coin-control that **never accidentally spends a Stamp or asset-bearing UTXO**, the Counterparty DEX and issuance suite, SRC-20 deploy/mint, Stamp art rendering, Emblem Vault wrapping — plus Ethereum and Solana as first-class chains — with keys that never leave your browser.

## Features

- **Multi-chain self-custody** — BTC (Native SegWit / Taproot / Legacy / Nested), Ethereum, and Solana from one seed. Import standalone keys (WIF), watch-only accounts, and multiple HD accounts.
- **Asset-aware coin-control** — every UTXO is classified against the Counterparty / Ordinals / Stamps indexers, so Stamps and asset-bearing coins are never spent as plain sats. RBF **⏫ Bump** + CPFP **⚡ Boost** fee tools.
- **The full Counterparty & Stamps suite** — send, DEX, dispensers, dividends, issuance, fairminters, SRC-20 deploy/mint/transfer, classic Stamp + OLGA art minting, SRC-101 (`.btc`) names, and Emblem Vault wrapping to ETH/SOL.
- **Universal dApp connector** — any website can connect to Wonder Wallet across **all three chains**: `window.wonderWallet` (UniSat-shaped BTC API), **EIP-1193 + EIP-6963** for Ethereum, and the **Wallet Standard** for Solana. Every connect and every signature is user-approved with **no blind signing** — the connect/sign dialog shows origin, a full transaction breakdown, and prioritized warnings. See [`public/developers.html`](public/developers.html) for the integration guide.
- **Testnet Mode** — a global Mainnet ⇄ Testnet toggle: Bitcoin **testnet4**, Counterparty **testnet4**, Ethereum **Sepolia**, and Solana **devnet**, with faucet links and a clear in-wallet banner. Testnet uses BIP-44 coin type 1′ so its addresses can never collide with mainnet. See [`docs/TESTNET.md`](docs/TESTNET.md).
- **Hardware wallet** — Ledger over WebHID; keys stay on the device, the wallet builds asset-safe PSBTs, the device signs.
- **Two surfaces** — the hosted **Wonder Terminal** ([wonder-wallet.com](https://wonder-wallet.com), also connects to UniSat/OKX/Wonder) and the **MV3 Chrome extension** (popup + side panel + dApp provider).

## Security model

- **Keys are generated and Argon2id-encrypted in your browser** and never sent anywhere. Signing happens locally.
- **The server is a stateless reader.** It holds **zero** user data — it only forwards *public* blockchain reads (mempool.space, Counterparty Core, stampchain, RPCs) and caches them briefly. No keys, balances-tied-to-identity, or secrets ever touch it. In the **browser extension** the reader disappears entirely.
- **Per-origin dApp approval, no blind signing** — the provider grants access per website (origin authenticated from Chrome's sender); every connect and signature is explicitly approved, with the full payload shown. Reads are served without a prompt; signs and connects require approval.
- **Asset-aware UTXO protection** — coin-control classifies every output against the Counterparty + Ordinals + Stamps indexers so asset-bearing coins are never spent as plain sats.
- **Testnet isolation** — testnet keys/addresses are cryptographically separate (coin type 1′); a testnet-signed transaction can never target a mainnet endpoint, and vice-versa.
- **Strict CSP, no remote code** in the MV3 extension; hardware signing via Ledger (WebHID).

See [`SECURITY.md`](SECURITY.md) for the full threat model and how to report vulnerabilities.

## Repository layout

```
core/                   Portable, chain-agnostic library (constants + asset-aware UTXO classification)
wallet-src/             The key engine — BIP-39/32 derivation, network-aware BTC/ETH/SOL signing,
                        BIP-322 & message signing, EIP-712 (audited core; builds to public/wallet-core.js)
hardware-src/           Ledger / hardware signing (builds to public/wallet-hw.js)
sources/                Server-side data proxies (bitcoin, counterparty, stamps, ethereum, solana,
                        emblem, activity, …) + netctx.js (per-request mainnet/testnet context)
server.js               Express app: security headers, TTL cache, network-scoped read proxies
public/                 The hosted web app (Wonder Terminal) — HTML/CSS + UI modules
  net-mode.js           Client Testnet Mode (network state + banner + request scoping)
extension/src/          MV3 extension — popup, side panel, background service worker, shim
  provider/             The dApp provider: window.wonderWallet (BTC), EIP-1193/6963 (ETH),
                        Wallet Standard (SOL), the per-origin broker + approval window
extension/build-ext.mjs Assembles extension/dist/ + the downloadable zip
docs/                   Design & feature docs (TESTNET.md, DAPP_PROVIDER_PLAN.md)
tests/                  Node test suites (signing, provider, EIP-712, testnet isolation, e2e)
```

## Build & run

Requires **Node 18+**.

```bash
npm install

# Build the engine bundles (source of truth: wallet-src/ and hardware-src/)
npm run build:core     # → public/wallet-core.js
npm run build:hw       # → public/wallet-hw.js

# Run the web app
npm start              # serves on $PORT (default 3000)
```

Build the browser extension (output in `extension/dist/`, load it unpacked):

```bash
node extension/build-ext.mjs
```

### Configuration (environment)

All config is injected via environment variables — **no secrets are committed**. Data sources default to public endpoints; set these to use your own providers / keys:

| Var | Purpose |
|---|---|
| `PORT` | Web server port |
| `BTC_API` / `BTC_API_TESTNET` | Bitcoin API base — mainnet / testnet4 (default: mempool.space) |
| `CP_API` / `CP_API_TESTNET` | Counterparty Core v2 base — mainnet / testnet4 |
| `STAMPS_API` | stampchain API base (mainnet only) |
| `ETH_RPC` / `SEPOLIA_RPC` / `ARB_RPC` / `BASE_RPC` | EVM RPC endpoints (Ethereum / Sepolia / Arbitrum / Base) |
| `SOL_RPC` / `SOL_RPC_DEVNET` | Solana RPC — mainnet-beta / devnet |
| `ALCHEMY_KEY` / `HELIUS_KEY` | NFT/DAS providers (optional) |
| `EMBLEM_V2` / `EMBLEM_V3` / `EMBLEM_API_URL` | Emblem Vault endpoints |
| `PRICE_API` / `ORD_API` / `SRC101_DEPLOY` | Price feed / ordinals / SRC-101 deploy txid |

The client selects the network per request via a `?network=testnet` query parameter; the source modules
route to the matching testnet upstream. All testnet endpoints default to public nodes — no key required.

## Contributing

Issues and PRs welcome. This is a community-first project for the Counterparty / Stamps ecosystem. Please open an issue to discuss substantial changes first, and never include secrets or real seed phrases in bug reports or tests.

## License

See [`LICENSE`](LICENSE).
