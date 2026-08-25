# Changelog

## Extension: Market + XCP-69 launchpad, native in the popup — v0.54.19 (2026-08-25)

- **The full Counterparty Market and XCP-69 launchpad are now in the extension.** Under ❖ Tools the old
  Fairminter/Fairmint buttons are replaced by **Fairmint** (a hub: Create · Mint · XCP-69 launchpad) and
  **Market** (Swap · Liquidity · Limit any-pair · Dispense — with the pool directory, order book,
  click-to-fill, Max, USD fees, sort/analytics). Same compose → verify → sign engine as the rest of the
  wallet. Local & imported accounts for now; Ledger gated with a note (on-device signing to follow).

## Extension: connect uses your current account — v0.54.18 (2026-08-25)

- **The dApp Connect approval now signs with the account the wallet is currently on** — no more account
  picker in the approval window. The sign-in signature is paired with your active session address. To
  connect a site with a different address, switch accounts in the extension first, then connect. (The
  approval still shows which address it's connecting, and the "share paired Legacy address" option stays.)


Notable changes to Wonder Wallet. The project is pre-1.0 and in active development; the extension and
the hosted Terminal version independently. Dates are approximate to the release window.

## Connected-wallet view brought up to par — Terminal (2026-08-24)

- **The connected-wallet (UniSat/OKX) dashboard now matches the main wallet.** It gained the modern
  balance strip (big USD + native), the primary Bitcoin-Stamps **name chip**, the Mainnet/Testnet
  network chip, a chain badge, and the security footer. **Receive** is now the full QR + tap-to-copy
  card (was a plain text box). Its asset list already shared the main renderer, so favorites, the
  qty-in-row collectible layout, and the address book in send boxes were already there — now the frame
  around them is consistent too.

## Market Limit tab: any-pair order book — Terminal (2026-08-24)

- **Limit orders on any pair.** The Market → Limit tab now takes a full **Base / Quote** pair (was
  TOKEN↔XCP only), so you can place resting DEX orders on any asset/asset market — including BTC pairs.
  Enter a pair to load its live order book (bids/asks/spread + AMM pool price), place buy/sell orders
  priced in the quote asset, and see your open orders across **all** pairs with one-tap Cancel. Leave
  the quote blank to browse **every market a single asset trades in**, and **tap any order-book level**
  to auto-fill the side + price + amount, ready to review. This fully folds the standalone Counterparty
  DEX tool into the Market — **the separate DEX tool has been retired**, and the Market now works for
  **connected external wallets** (UniSat/OKX) too, not just local/hardware keys.

## Address book (contacts) — Terminal + Extension v0.54.17 (2026-08-23)

- **Save recipients as named contacts.** A 📖 book icon now sits inside every send address box (Bitcoin,
  Counterparty asset, SRC-20, and ETH/SOL sends). Tap it to pick a saved address — the picker is
  **chain-aware**, so a Bitcoin send only offers each contact's Bitcoin addresses. Contacts support
  **multiple addresses each** (with sub-labels), and the chain of every address is auto-detected. Manage
  contacts (add / edit / delete) right from the picker. Everything is stored **locally** (`ww:addrbook`)
  and included in your encrypted Backup. It assists entry — always still verify the recipient.

## Favorite / pin assets — Terminal + Extension v0.54.14 (2026-08-23)

- **Star an asset to pin it to the top.** Every token *and* collectible now has a star — tap it on the
  place card / tile (or in the asset's detail window, beside the title) to favorite it. Favorites sort to
  the top of their list and show a gold star, so the assets you care about stay reachable on addresses
  with 100+ items. Works across the **Tokens** grid (Counterparty, SRC-20, ETH tokens) **and the
  Collectibles grid** (Bitcoin Stamps, .btc names, ETH/SOL NFTs). Stored locally per device (in `ww:fav`,
  included in your encrypted Backup); on both the Terminal and the extension.

## Extension: UTXO consolidation in Coin Control — v0.54.12 (2026-08-23)

- **Consolidate UTXOs from the extension.** The Coin Control panel now lets you tick spendable UTXOs
  (protected / frozen / time-locked coins are never selectable) and merge them into a single output at
  the same address. "All spendable" selects every eligible coin at once. A preview shows estimated
  vsize, the miner fee at your chosen rate (with the staggered Fast/Med/Econ presets + custom s/vB),
  and the resulting single output before you sign. Signs locally and broadcasts — same shared core
  builder as the Terminal, so per-input vsize (incl. legacy 148 vB) and the fee are exact.

## XCP-69 launchpad — sort + mint analytics — Terminal (2026-08-22)

- **Sort the mint list** — Minting out (progress toward the 69M sale), Ends soon (nearest deadline
  block), or New (recently created).
- **Richer mint cards** — each live mint now shows XCP raised (+ ~USD) and its deadline as an approx
  timeframe ("ends ~6d · blk 964635"), not just a progress bar.
- **Expanded mint analytics** — tapping a launch adds a stats grid: XCP raised (+ $ value), deadline /
  timeframe, unique **minters** (participants — accurate mid-mint, since minted tokens are escrowed,
  not yet distributed holders), creation block + date, and the **deployer address** (links to mempool).

## Swap pool discovery & analytics — Terminal (2026-08-22)

- **Pool directory in Swap.** Opening the Market → Swap tab now lists every live Counterparty AMM pool
  (read-only, via a new cached `/api/cp/pools` route). Tap a pool to load the pair. A **sort switch**
  toggles between **Highest TVL** (deepest first; non-XCP/empty pools sink) and **Newest** (by creation
  block).
- **Per-pair pool analytics.** Once a pair resolves, an analytics panel shows a health badge
  (🟢 Deep / 🟡 Moderate / 🔴 Thin / Empty from the XCP-side reserve), both reserves, price in each
  direction, **TVL in XCP (and ~USD** — XCP added to the price feed), the LP token id, creation
  block + date/age, and each asset's **numeric id + supply / divisibility / lock** state.
- **Liquidity tab: same directory + analytics.** The Liquidity tab now opens on the pool directory
  (tap to load a pool for add/remove, `← Pools` to go back) and shows the same analytics panel above
  the deposit/withdraw form, so you can see exactly what pool you're depositing into. **Create-pool**
  (adding to a pair with no pool yet) now echoes the **starting price** live as you enter both amounts.

## Encrypted Backup & security hardening — Extension v0.54.7 (2026-08-20)

- **Backup & Restore (all-in-one, encrypted).** A new Advanced-menu tool exports your whole wallet — the
  seed (encrypted) plus settings (watch-list, labels, UTXO freeze flags, favorites, vault deposit
  addresses) — into a single `wonder-wallet-backup.json`. The file has its **own password**, set at
  export and separate from the wallet password, so forgetting the wallet password never locks the backup;
  the backup password becomes the wallet password on the restored device. The seed is never serialized in
  plaintext (the vault blob stays Argon2id→AES-GCM ciphertext). **Export** runs inline in the popup;
  **Restore** opens a compact window anchored top-right (like the signing popup, reliable file picker) and
  is also offered on the fresh-wallet screen next to Create / Restore-seed. Wrong passwords are rejected on
  both export and import before anything is written.
- **dApp provider hardening (pentest Phase H).** Clear-signing flags mutable sighashes
  (`SINGLE|ANYONECANPAY`) and decodes EVM token approvals — unlimited `approve` / `setApprovalForAll` raise
  a loud danger. The generic RPC route no longer serves `eth_sendRawTransaction` to unconnected origins;
  every signature re-checks that the grant still exists and still points at the granted account + network
  before it's released; grant-store races and approval-window fan-out are bounded; the Ledger path
  re-checks input coin-control immediately before the device signs; PSBT addresses render for the active
  network on testnet.
- **Versioned download** — the beta zip is now `wonder-wallet-extension-<version>.zip`, so a stale build
  can't be served from an edge cache after an update.

## Fees, receipts & encrypted Backup — Terminal (2026-08-20)

- **Backup & Restore** — the same all-in-one encrypted backup (seed + settings, own backup password) is in
  the Terminal's Advanced menu.
- **Honest fee rate on SRC-20 / Stamp compose.** The confirm screen recomputes the true signed vsize by
  output *script type* and warns when a composer priced the fee below the sat/vB you asked for (P2WSH data
  outputs are 43 vB, not the flat 31 estimators assumed). Wonder's own send estimator (WW-C15) now sizes
  non-P2WPKH recipients correctly, so sends to taproot / legacy addresses don't underpay.
- **Connected-wallet fee display** — Counterparty sends via a connected wallet now show the real miner fee
  (the server bakes per-input `witnessUtxo` into the PSBT so external signers can compute it).
- **Persistent send receipt** — after broadcast the confirm screen stays put with a clickable
  mempool/explorer link and a **Done** button on every send type, instead of auto-closing.

## Extension v0.53.9 (2026-08-16)

- **Password floor lowered 12 → 8** on Create and Restore, matching the "8+ characters" placeholders and
  the Terminal. (No core-side floor existed; these two UI checks were the only enforcement.)
- **FreeWallet → Counterparty relabel** — imported Counterwallet accounts now label as `Counterparty · 0/i`;
  the import flow consistently calls the input a "Counterwallet / FreeWallet passphrase" (matching the Terminal).

## Send/Receive parity & dashboard polish — Terminal v0.35 (2026-08-16)

- **Send Bitcoin** — dropped the in-modal "From address" picker; Send is now paired to the account's
  selected address type (shown as a subtitle) and set on the dashboard. RBF and dispenser detection kept.
- **Receive** — a clean single-address view scoped to the current chain + account (big QR + address).
  Tap/click the address to copy (icon reveals on hover, "✓ Copied" confirmation; corner ✕ closes — no
  button row). The full multi-type/all-chains list moved to **Advanced → All addresses**.
- **Auto-lock status footer** beneath the assets: live "auto-locks in M:SS" countdown · "keys never leave
  this device" · version — mirroring the extension. The idle timer now resets on activity in all modes.
- **Top row & balance module** — Advanced moved up beside Lock; the privacy (mask) toggle moved into the
  balance module beside the amount; the ▾ dropped from the Advanced label.
- **Mobile Tools toggle** relocated into the Activity row (left of Activity) so the balance tucks directly
  under the account; it collapses on desktop where the rail is docked.
- **Stamp detail** — file **Size** now sits beside **Type** (fmtBytes B/KB/MB), matching the extension;
  the Creator line is centered and shows the full creator address.
- **Activity** — removed the duplicate "Close" button (the corner ✕ is sufficient); Coin Control clears it.

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
