# Chrome Web Store — listing pack

Everything needed to fill out the Chrome Web Store submission for Wonder Wallet. Copy-paste the fields;
the justifications are written to answer the reviewer's questions directly.

> **Website:** `https://wonder-wallet.com`
> **Privacy policy URL** (required): `https://wonder-wallet.com/privacy.html`
> (Live on the custom domain — a Cloudflare Worker proxies wonder-wallet.com to the wallet artifact.)

---

## Listing fields

**Name** (≤ 45 chars) — ⚠️ PRODUCT NAME ONLY. Appending "— BTC · Stamps · SRC-20" triggered the Spam / "Yellow Nickel" rejection (keyword-in-title). Do NOT add descriptors.
```
Wonder Wallet
```

**Summary** (≤ 132 chars) — plain-language, no stacked keyword/brand list
```
A self-custodial Bitcoin wallet for collectors. Your keys, your assets, and your data stay on your own device.
```

**Category:** `Tools`  — ⚠️ NOT "Privacy & Security" (that premium category for a wallet reads as placement manipulation → contributed to the "Spam and Placement" rejection). "Tools" matches the closest peer, XCP Wallet. Category is editable on the listing page (not from the package).

**Language:** English

**Detailed description** (paste as-is) — ⚠️ REVISED after the Spam rejection: natural prose (no keyword-stuffed lists), tagline appears ONCE (was duplicated), third-party brand names minimized (Ledger = nominative "works with"; dropped the "Emblem Vault" brand line; ecosystems named once, in context).
```
Wonder Wallet is a self-custodial Bitcoin wallet. Your keys, your assets, and your data stay on your own device — always.

Built for collectors on Bitcoin, Wonder Wallet lets you hold your own keys and manage your Bitcoin, Ethereum, and Solana from a single recovery phrase, with first-class support for Bitcoin Stamps, SRC-20, and Counterparty assets.

What you can do:
• Hold your own keys — generated and encrypted in your browser, never sent anywhere.
• View and manage your collection with full-resolution on-chain art.
• Coin control that recognizes asset-bearing coins, so you don't spend a collectible by accident.
• Send and receive Bitcoin, Ethereum, and Solana from one recovery phrase.
• Works with Ledger hardware wallets over WebHID — your keys stay on the device and you approve each transaction.
• Fee controls (replace-by-fee and child-pays-for-parent), customizable auto-lock, and dark or light themes.

Security and privacy:
• Keys are encrypted locally with Argon2id and AES-GCM and never leave your device.
• All signing happens on your device. No accounts, no trackers, and no personal data collected.
• No remotely hosted code — the extension runs under a strict Content-Security-Policy.

Wonder Wallet is beta software, provided as-is. Please use a test wallet, not your life savings.
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
