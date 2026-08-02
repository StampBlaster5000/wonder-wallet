# Security Policy

Wonder Wallet is a **self-custodial** wallet: it holds keys for real assets, so security is the
first-class concern. This document explains the threat model, what we protect against, and how to
report a vulnerability.

> ⚠️ **Beta software.** Use a **test wallet**, not your life savings. Wonder Wallet is community
> software provided as-is with no warranty. Audit it before trusting it with significant funds.

## Reporting a vulnerability

**Please do not open a public issue for security vulnerabilities.** Public disclosure before a fix
puts users' funds at risk.

Instead, report privately:

- **Preferred:** GitHub → the repository's **Security** tab → **Report a vulnerability** (private
  security advisory). This keeps the report confidential until a fix ships.
- If private advisories are unavailable, contact the maintainer directly and mark the message
  **"SECURITY — Wonder Wallet"**.

Please include:

- A description of the issue and its impact (e.g. key exposure, unintended spend, asset loss).
- Steps to reproduce, or a proof-of-concept.
- The affected version/commit, browser, and platform.

**What to expect:** we aim to acknowledge a report within a few days, work with you on a fix, and
credit you (if you wish) once it's resolved. We ask for reasonable time to remediate before any
public disclosure.

## Supported versions

Wonder Wallet is in active development (pre-1.0). Security fixes are applied to the **latest** version
only. Always run the newest extension/build; older builds are not maintained.

## Threat model & guarantees

The core promise is **your keys, your art, your data — all local**. Concretely:

### Key custody
- **Keys are generated and used entirely in your browser.** They are never transmitted anywhere.
- The seed is encrypted at rest with **Argon2id → AES-GCM** behind your password. The decrypted seed
  lives only in memory while unlocked and is wiped on lock / idle auto-lock.
- **Signing is local.** The wallet builds transactions and signs them client-side; only the *signed*
  (or, for hardware, *unsigned-to-be-signed-on-device*) transaction leaves the browser, to be
  broadcast.
- **Imported private keys (WIF)** are encrypted at rest with your password, kept off the public API
  surface, and wiped from memory on lock.

### The server is a stateless reader
- The hosted server holds **zero user data**. It forwards only **public** blockchain reads
  (mempool.space, Counterparty Core, stampchain, RPC providers) and caches them briefly (~30s TTL).
- No keys, no seeds, no identity-linked balances, no secrets ever touch the server.
- **In the browser extension the server is bypassed entirely** — the extension reads directly through
  the proxy with no app server in the trust path.
- Server-side API keys / tokens are injected via environment at runtime and are **never** committed to
  this repository (see `.gitignore`).

### Asset-aware UTXO protection
- Coin-control classifies every output against the Counterparty / Ordinals / Stamps indexers so
  **asset-bearing UTXOs are never accidentally spent as plain sats**.
- **RBF fee-bumps reuse ONLY the original transaction's inputs**, so a replacement can never become a
  second, unintended payment.

### Network / SSRF hardening
- Image and stamp fetches that take a URL are **SSRF-guarded**: private/loopback/link-local ranges are
  blocked (including IPv4-mapped IPv6 and CGNAT), **every redirect hop is re-validated**, an image
  content-type is required, and response size is capped.

### Extension hardening
- The MV3 extension runs under a **strict Content-Security-Policy with no remote code** (`script-src
  'self'`). It talks only to its own proxy origin.
- **Hardware signing (Ledger, WebHID)** keeps keys on the device; the wallet builds asset-safe PSBTs
  and the device signs them. Keys never leave the Ledger.

### dApp provider (website connections)
- **Per-origin permission model.** A website gets access only after the user approves a connect
  request; the origin is authenticated from **Chrome's verified sender**, not from anything the page
  claims. Switching accounts in the wallet never silently moves an already-connected site (the grant
  pins the account).
- **No blind signing.** Every connect and every signature opens an approval dialog that shows the
  origin, a full transaction breakdown, and prioritized warnings (asset-bearing UTXOs, unusual sighash,
  high fee, a "message" that is actually transaction data). Read-only RPC calls are served without a
  prompt; anything that signs or spends requires explicit approval.
- **Keys stay in the wallet context.** The page ↔ content-script ↔ background bridge carries only
  method calls and results — never key material or API tokens. Signing happens in the approval window,
  which holds the unlocked session; the service worker holds no keys.
- **Coexistence, not impersonation.** Ethereum uses **EIP-6963** (it announces itself, it does not
  clobber `window.ethereum`) and Solana uses the **Wallet Standard**, so Wonder Wallet sits alongside
  other wallets rather than masquerading as them.

### Testnet Mode
- **Networks are cryptographically isolated.** Testnet derives Bitcoin addresses at **BIP-44 coin type
  1′** — a different key set that can never collide with mainnet. A testnet-signed transaction cannot
  target a mainnet endpoint, and a mainnet key cannot sign a testnet input (both enforced in the core
  and covered by `tests/testnet-isolation.mjs`).
- **No accidental real-value actions.** Testnet is a deliberate, clearly-indicated mode (persistent
  banner, "no value" labeling). Where a testnet has no reliable indexer (Stamps / SRC-20), those
  actions run as a **local dry run** that constructs and prices the transaction but never broadcasts.

## Out of scope

- Compromise of the **user's own device** (malware, a malicious browser extension with broad
  permissions, a keylogger, physical access to an unlocked wallet).
- **Phishing** or social engineering that tricks a user into revealing their seed/password or
  approving a malicious transaction on their own device.
- Third-party services the wallet reads from (mempool.space, indexers, RPC providers) being wrong or
  unavailable — the wallet degrades gracefully but cannot vouch for upstream data integrity.
- Loss of funds due to a **forgotten password or lost seed phrase** — by design, these are
  unrecoverable (there is no backdoor).

## Good practices for users

- Use a **strong, unique password**; it's the only thing protecting an encrypted seed on your device.
- **Back up your recovery phrase offline.** No one — including this project — can recover it for you.
- Prefer a **hardware wallet** (Ledger) for significant funds.
- Keep your browser and the extension **up to date**.
- Verify transaction details **on your hardware device's screen** before approving.
