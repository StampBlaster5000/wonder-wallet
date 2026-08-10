# Chrome Web Store submission — v0.53.8 (update from v0.47.x)

Paste-ready copy for the CWS dashboard. The store item in first review was **v0.47.24**; this is a
substantial update, so expect a closer review (see the reviewer note — the permission surface grew).

---

## "What's new" (release-notes field)

> **Hardware wallet + Counterwallet migration + your own reader.**
>
> - **Ledger on-device signing** for Bitcoin sends — single address *and* portfolio mode (spend across
>   all your receiving addresses). You approve the exact recipient, amount, and fee on the device; keys
>   never leave the Ledger.
> - **Restore a Counterwallet / FreeWallet passphrase** — import your old seed, or restore it as a
>   modern multi-chain account (legacy address front-and-centre).
> - **Live USD value** on the Send screen as you type.
> - **Custom reader endpoint** (Advanced → Reader endpoint): point the wallet's read/broadcast backend
>   at your *own* server for privacy — no rebuild.
> - **Independent infrastructure** — reads/broadcasts now go through the project's own `wonder-wallet.com`.
> - Testnet mode (BTC testnet4 / ETH Sepolia / SOL devnet), RBF/CPFP fee bumps, and a hardened SSRF-safe
>   image proxy.
> - Numerous reliability and clarity fixes (clearer Ledger errors, safer broadcast handling).

---

## Reviewer note (the "anything else?" / permission-justification box)

> Wonder Wallet is a self-custodial BTC/ETH/SOL wallet. Keys are generated and used **only** in the
> browser (Argon2id → AES-GCM at rest); nothing is remotely hosted (`script-src 'self'`).
>
> **Why the permission surface changed since the prior version:**
>
> 1. **Content script on all sites (`<all_urls>`):** the wallet injects a standards-based connector
>    (EIP-6963 / EIP-1193, Solana Wallet Standard, a Bitcoin provider) so any decentralized app the user
>    visits can offer to connect — the same model as MetaMask/Phantom. **Every** connection and signature
>    requires explicit, per-origin approval in the wallet's own UI; the origin is taken from Chrome's
>    verified sender, never from the page. The connector reads no page content and has no access to keys.
>
> 2. **`optional_host_permissions: https://*/*`:** a privacy feature. By default the wallet contacts only
>    `wonder-wallet.com` (its single `host_permissions` entry). A user who runs their own read/broadcast
>    server can point the wallet at it via Advanced → Reader endpoint; that origin is granted **at runtime**
>    with `chrome.permissions.request` (never on install), and reset revokes it. It carries only public
>    blockchain reads and the user's own signed-transaction broadcasts — no keys, no personal data.
>
> 3. **CSP:** `script-src` stays strict `'self'` (no remote code). Only `connect-src` / `img-src` /
>    `frame-src` allow `https:`, so a user-chosen custom reader can serve blockchain data and stamp
>    artwork — never executable script.
>
> No `scripting` permission is used (injection is via a static content script). Full source, including the
> stateless proxy, is public: https://github.com/StampBlaster5000/wonder-wallet

---

## Pre-submission checklist

- [ ] `chrome://extensions` shows the loaded build at the version being uploaded (0.53.8).
- [ ] Zip the **`extension/dist/`** contents (the built manifest, not the repo). `wonder-wallet-b23.zip`
      on wonder-wallet.com is exactly this build if you'd rather grab it there.
- [ ] Confirm the store item's **current review has cleared** before uploading a much larger version on top.
- [ ] Single-purpose description ≤ 132 chars (manifest `description` is already within the cap).
- [ ] Privacy practices: declares no data collection; link the privacy policy `wonder-wallet.com/privacy.html`.
- [ ] Screenshots current (1280×800 or 640×400).
- [ ] Secrets scan clean ✓ (done: no keys/tokens/WIFs in the tree).

_Sources: STORE_LISTING.md (full field copy + host-permission justifications), SECURITY.md (threat model
+ custom-reader guardrails)._
