# Chrome Web Store — listing pack

Everything needed to fill out the Chrome Web Store submission for Wonder Wallet. Copy-paste the fields;
the justifications are written to answer the reviewer's questions directly.

> **Privacy policy URL** (required): host `public/privacy.html` — e.g.
> `https://build-1dadb019a5802eb5fee63753.emblem.build/pub/bitcoin_wallet/wonder-wallet/privacy.html`
> (or a custom domain if you connect one). Paste that URL into the "Privacy policy" field.

---

## Listing fields

**Name** (≤ 45 chars)
```
Wonder Wallet — BTC · Stamps · SRC-20
```

**Summary** (≤ 132 chars)
```
Self-custodial Bitcoin wallet for Counterparty, Bitcoin Stamps & SRC-20 — asset-safe UTXO control, Ledger support. Keys stay local.
```

**Category:** `Productivity`  (alternative: `Developer Tools`)

**Language:** English

**Detailed description** (paste as-is):
```
Wonder Wallet is a fully self-custodial BTC · ETH · SOL wallet built for the Counterparty, Bitcoin Stamps, and SRC-20 collector community. Your keys, your art, your data — all local.

WHY WONDER WALLET
Counterparty, Bitcoin Stamps, and SRC-20 are some of the oldest asset ecosystems on Bitcoin, but the tooling has always been fragmented and often custodial. Wonder Wallet puts the whole stack behind one self-custodial key.

FEATURES
• Asset-aware coin control — never accidentally spends a Stamp or asset-bearing UTXO as plain sats.
• Bitcoin Stamps + SRC-20 + Counterparty: view, send, and manage your collection with full-resolution art.
• Send / receive BTC, ETH, and SOL from a single seed.
• Hardware wallet support — connect a Ledger (WebHID). Keys never leave the device; you approve every transaction on-screen.
• Emblem Vault bridging to Ethereum & Solana.
• Bind assets to UTXOs (attach/detach), RBF / CPFP fee-bumping, and more.
• Dark and light themes, customizable auto-lock.

SECURITY & PRIVACY
• Keys are generated and encrypted (Argon2id + AES-GCM) in your browser and never leave your device.
• Signing happens locally. We collect no personal data, have no accounts, and run no trackers.
• No remote code — strict Content-Security-Policy.

BETA SOFTWARE — use a test wallet, not your life savings. Community software provided as-is.

Your keys, your art, your data — all local.
```

---

## Single-purpose statement
```
Wonder Wallet is a self-custodial cryptocurrency wallet. Its single purpose is to let a user generate and hold their own keys locally, view their Bitcoin / Ethereum / Solana and Counterparty / Stamps / SRC-20 assets, and sign and broadcast their own transactions. It does not modify the web pages the user visits.
```

---

## Permission justifications
(Paste each into the matching "Why do you need this permission?" box.)

**`storage`**
```
Stores the user's own encrypted wallet (Argon2id + AES-GCM) and their preferences (theme, auto-lock timer, paired hardware-wallet addresses) locally on their device. No data is sent anywhere.
```

**`alarms`**
```
Drives the idle auto-lock timer that re-locks the encrypted wallet after a user-configured period of inactivity, for the user's security.
```

**`sidePanel`**
```
Lets the user open the wallet in the browser's side panel so it stays visible alongside their tabs. Also used for the hardware-wallet connection flow, which needs a persistent surface.
```

**Host permission** — `https://<your-proxy-host>/*`
```
The extension reads PUBLIC blockchain data (address balances, assets, fees) and broadcasts the transactions the user signs, through this single stateless proxy. It requests only public information and stores no user data. The extension does not access or modify any other websites.
```

**Remote code:** `No` — the extension executes no remotely-hosted code (strict CSP `script-src 'self'`).

---

## Data-collection disclosures (Privacy practices tab)
- **Does your item collect user data?** → You do **not** collect any of the listed data types. Wonder Wallet
  collects **no** personally identifiable information, financial info, authentication info, personal
  communications, location, web history, or user activity.
- Certify: **not** being sold to third parties · **not** used for purposes unrelated to the single purpose ·
  **not** used to determine creditworthiness / for lending.

> Note on wallet review: crypto wallets get extra scrutiny. Our strongest points to lean on if asked — (1) no
> remote code, (2) keys never leave the device / no server-side custody, (3) no data collection, (4) minimal
> permissions. All verifiable in the source.

---

## Visual assets (to produce)
- **Store icon** 128×128 — ✅ already in the build (`icons/icon-128.png`).
- **Screenshots** 1280×800 (or 640×400), 1–5 required — TODO (connect view, portfolio, asset detail, send,
  light theme).
- **Small promo tile** 440×280 — recommended, TODO.
- **Marquee** 1400×560 — optional, TODO.

---

## Pre-submission checklist
- [ ] Chrome Web Store developer account created ($5 one-time).
- [ ] Contact email verified.
- [ ] Privacy policy URL live (host `public/privacy.html`).
- [ ] Confirm the extension **name** isn't trademark-conflicting; confirm rights to reference "Emblem Vault".
- [ ] Screenshots + promo tile produced.
- [ ] `.zip` built fresh (`extension/build-ext.mjs` → `public/wonder-wallet-extension.zip`).
- [ ] Version in `extension/build-ext.mjs` set for release.
- [ ] Submit for review.
