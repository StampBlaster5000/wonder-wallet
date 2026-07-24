# Wonder Wallet — frontend test suites

Two twins that cover the **hosted Wonder Terminal** (the full web wallet at
`{BASE}/app.html`):

- **`selenium/`** — Python + Selenium (pytest, page-object model). The suite you asked
  for; drops straight into a CI pipeline with a Selenium Grid / chromedriver.
- **`playwright/`** — a Playwright twin of the critical path that runs green in CI **or
  this sandbox** (Chromium is already baked in). Use it for fast local validation.

Every selector was grounded against the live Terminal DOM (`public/wallet-ui.js`),
verified 2026-07-20 by driving the real app.

## Safety model (important)

- Tests use the **canonical BIP-39 test-vector mnemonic** only
  (`abandon abandon … about`). Deterministic addresses, nothing you care about.
  **Never** put a real user seed in a test.
- The suites **never click a final "Broadcast"** button. Send/attach flows are exercised
  only up to the **Review / validation** step — nothing is signed-and-sent on-chain.
- Each test gets a **fresh browser profile** → isolated `localStorage`/IndexedDB, so no
  encrypted vault leaks between tests.

## Run — Selenium (Python)

```bash
cd tests/selenium
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt          # selenium, pytest (+ optional chromedriver mgr)
# needs a chromedriver on PATH (or `pip install webdriver-manager` and wire it in)
pytest                     # all flows, headless
pytest -m smoke            # fast critical path only
WW_HEADLESS=0 pytest -m smoke   # watch it in a real window
```

Env knobs (see `conftest.py`): `WW_BASE_URL`, `WW_HEADLESS`, `WW_BROWSER` (chrome|firefox).

## Run — Playwright (JS, runs here)

```bash
cd tests/playwright
npm i
npx playwright install chromium   # skip if Chromium already present
npx playwright test
```

## Coverage

| Area | Selenium file | What's asserted |
|---|---|---|
| Onboarding | `test_onboarding.py` | landing entry points; **restore→dashboard**; **create** (reads revealed seed → clears confirm-quiz → password); bad-mnemonic / short-password / mismatch validation |
| Session | `test_session.py` | lock→unlock; **wrong-password** rejected; forget-wallet returns to landing |
| Dashboard | `test_dashboard.py` | BTC/ETH/SOL action bars; chain switch updates actions (CP is BTC-only); Tokens/Collectibles tabs; **privacy** mask toggle |
| Send | `test_send.py` | fee chips + custom-fee position; **amount floored at 0 / negative guard**; fee-chip selection (no broadcast) |
| Assets | `test_assets.py` | collectibles render; **HTML badge only on real HTML stamps** (image ≠ HTML); detail tools include **Attach + Vault**; **Attach preloads asset + quantity=1, min=0** |
| Advanced | `test_advanced.py` | advanced menu lists all tools; reveal-seed **wrong-password** gate; **reveal-seed round-trips to the restored mnemonic** (vault encrypt/decrypt); sign-message form opens |

`test_assets.py` **skips gracefully** when the test address holds no stamps. To make it
deterministic in CI, point it at a stamp-holding **own** account (a watch-only address
renders the gallery but hides the signing tools by design).

## Not covered here (and why)

- **Extension popup** — Selenium can load an unpacked extension, but Playwright's
  `launchPersistentContext` handles MV3 far better; if you want popup coverage, add it to
  the Playwright twin, not Selenium.
- **On-chain broadcast / signing correctness** — belongs in unit tests against
  `wallet-core.js` (deterministic vectors), not a UI e2e suite.
- **Hardware (Ledger) connect** — needs a physical device / WebHID; not automatable in
  headless CI.

---

## Appendix — Cold storage on a mobile build

The extension's cold-storage path is **Ledger over WebHID**, which **no mobile browser
supports**. Mobile cold storage is still very achievable, via three routes:

| Transport | iOS (Safari/PWA) | Android (Chrome) | Native (Expo/RN) |
|---|---|---|---|
| WebHID (extension's current path) | ❌ | ❌ | — |
| WebUSB (Ledger USB-OTG) | ❌ | ✅ | — |
| Web Bluetooth | ❌ | ⚠️ flaky | — |
| Native BLE (Ledger Nano X) | — | — | ✅ `@ledgerhq/react-native-hw-transport-ble` |
| NFC card (Tapsigner/Satscard) | ✅ native | ✅ native | ✅ |
| **QR air-gap (PSBT via BC-UR)** | ✅ | ✅ | ✅ |

**Recommended:** ship **QR-code air-gapped PSBT signing** first — it works on every mobile
platform (web or native), needs no USB/BLE, and is compatible with SeedSigner / Keystone /
Passport / Specter. Wonder Wallet already builds asset-safe, Counterparty-aware PSBTs, so
it's mostly an export-as-animated-QR + scan-signed-PSBT-back UI. For a native build, add
**BLE** (real Ledger Nano X on iOS+Android) and optionally **NFC**. A pure Android web
build could also get a quick win by swapping WebHID → **WebUSB**.
