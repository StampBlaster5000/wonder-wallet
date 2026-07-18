# Wonder Wallet

**The collector's command deck for Bitcoin.** A fully self-custodial **BTC · ETH · SOL** wallet built for the Counterparty / Bitcoin&nbsp;Stamps / SRC-20 community — asset-aware UTXO control, a native on-chain DEX, the full issuance suite, and Emblem&nbsp;Vault bridging to Ethereum & Solana. **Your keys, your art, your data — all local.**

> ⚠️ **Beta software.** Use a **test wallet**, not your life savings. This is community software provided as-is; audit before trusting it with real funds.

---

## Why it exists

Counterparty, Bitcoin Stamps, and SRC-20 are some of the oldest and richest asset ecosystems on Bitcoin — but the tooling has always been fragmented and often custodial. Wonder Wallet puts the entire stack behind one self-custodial key: send/receive, an asset-aware coin-control that **never accidentally spends a Stamp or asset-bearing UTXO**, the Counterparty DEX and issuance suite, SRC-20 deploy/mint, Stamp art rendering, and Emblem Vault wrapping — with keys that never leave your browser.

## Security model

- **Keys are generated and Argon2id-encrypted in your browser** and never sent anywhere. Signing happens locally.
- **The server is a stateless reader.** It holds **zero** user data — it only forwards *public* blockchain reads (mempool.space, Counterparty Core, stampchain, RPCs) and caches them briefly. No keys, balances-tied-to-identity, or secrets ever touch it. In the **browser extension** the reader disappears entirely.
- **Asset-aware UTXO protection** — coin-control classifies every output against the Counterparty + Ordinals + Stamps indexers so asset-bearing coins are never spent as plain sats.
- **Strict CSP, no remote code** in the MV3 extension; hardware signing via Ledger (WebHID).

See [`SECURITY.md`](SECURITY.md) for the full threat model and how to report vulnerabilities. *(to be added)*

## Repository layout

```
core/          Portable, chain-agnostic library (constants + asset-aware UTXO classification)
wallet-src/    The key engine — BIP-39/32 derivation, BTC/ETH/SOL signing, BIP-322 & message signing (audited core; builds to public/wallet-core.js)
hardware-src/  Ledger / hardware signing (builds to public/wallet-hw.js)
sources/       Server-side data proxies (bitcoin, counterparty, stamps, ethereum, solana, emblem, activity, …)
server.js      Express app: security headers, 30s TTL cache, server-side read proxies
public/        The hosted web app (Wonder Terminal) — HTML/CSS + UI modules
extension/     MV3 browser extension (popup + side panel) — src/ + build script
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
| `BTC_API` | Bitcoin API base (default: mempool.space) |
| `CP_API` | Counterparty Core v2 base |
| `STAMPS_API` | stampchain API base |
| `ETH_RPC` / `SOL_RPC` / `ARB_RPC` / `BASE_RPC` | EVM / Solana RPC endpoints |
| `ALCHEMY_KEY` / `HELIUS_KEY` | NFT/DAS providers (optional) |
| `EMBLEM_V2` / `EMBLEM_V3` / `EMBLEM_API_URL` | Emblem Vault endpoints |
| `PRICE_API` / `ORD_API` / `SRC101_DEPLOY` | Price feed / ordinals / SRC-101 deploy txid |

## Contributing

Issues and PRs welcome. This is a community-first project for the Counterparty / Stamps ecosystem. Please open an issue to discuss substantial changes first, and never include secrets or real seed phrases in bug reports or tests.

## License

See [`LICENSE`](LICENSE).
