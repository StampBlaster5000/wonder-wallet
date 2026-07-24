// Playwright twin of the Selenium suite's critical path — runs in CI or this
// container (Chromium is already baked in). Mirrors the flows verified live on
// 2026-07-20: restore → dashboard → chain switch → privacy → lock → unlock,
// plus the send negative-amount guard and the reveal-seed round-trip.
//
//   cd tests/playwright && npm i && npx playwright test
//
// Env: WW_BASE_URL (default = hosted artifact). SAFETY: never broadcasts.
const { test, expect } = require('@playwright/test');

const BASE = (process.env.WW_BASE_URL
  || 'https://build-1dadb019a5802eb5fee63753.emblem.build/pub/bitcoin_wallet/wonder-wallet').replace(/\/$/, '');
const TERMINAL = `${BASE}/app.html`;
const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PASSWORD = 'testpass1234';

async function restore(page) {
  await page.goto(TERMINAL);
  await page.click('#bRestore');
  await page.fill('#rSeed', MNEMONIC);
  await page.fill('#rPw1', PASSWORD);
  await page.fill('#rPw2', PASSWORD);
  await page.click('#bDo');
  await expect(page.locator('#dashActions')).toBeVisible();
}

test('restore reaches the dashboard with all chains', async ({ page }) => {
  await restore(page);
  await expect(page.locator('.dctab[data-ch="btc"]')).toBeVisible();
  await expect(page.locator('.dctab[data-ch="eth"]')).toBeVisible();
  await expect(page.locator('.dctab[data-ch="sol"]')).toBeVisible();
});

test('bitcoin action bar is complete', async ({ page }) => {
  await restore(page);
  await page.click('.dctab[data-ch="btc"]');
  for (const a of ['send', 'receive', 'cp', 'coincontrol', 'activity', 'dapps']) {
    await expect(page.locator(`#dashActions button[data-a="${a}"]`)).toBeVisible();
  }
});

test('privacy toggle flips state', async ({ page }) => {
  await restore(page);
  const btn = page.locator('#privacyBtn');
  const before = await btn.getAttribute('class');
  await btn.click();
  await expect(btn).not.toHaveClass(before || '');
});

test('lock then unlock', async ({ page }) => {
  await restore(page);
  await page.click('#bLock');
  await expect(page.locator('#unlockForm')).toBeVisible();
  await page.fill('#unlockPw', PASSWORD);
  await page.click('#unlockForm button[type=submit]');
  await expect(page.locator('#dashActions')).toBeVisible();
});

test('send amount cannot go negative', async ({ page }) => {
  await restore(page);
  await page.click('.dctab[data-ch="btc"]');
  await page.click('#dashActions button[data-a="send"]');
  await expect(page.locator('#sAmt')).toHaveAttribute('min', '0');
  await page.fill('#sAmt', '-5');
  const v = await page.locator('#sAmt').inputValue();
  expect(v === '' || parseFloat(v) >= 0).toBeTruthy();
});

test('reveal-seed round-trips to the restored mnemonic', async ({ page }) => {
  await restore(page);
  await page.click('#bAdvanced');
  await page.click('.adv-opt[data-adv="reveal"]');
  await page.fill('#gp', PASSWORD);
  await page.click('#bGo');
  await expect(page.locator('#sg')).toBeVisible();
  await page.click('#bB'); // reveal
  const words = await page.locator('#sg .seedw').allInnerTexts();
  const phrase = words.map((w) => w.split('\n').pop().trim()).join(' ');
  expect(phrase).toBe(MNEMONIC);
});
