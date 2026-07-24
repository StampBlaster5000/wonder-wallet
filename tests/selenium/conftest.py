"""
Pytest fixtures + config for the Wonder Wallet Selenium suite.

Targets the hosted **Wonder Terminal** (the full web wallet), NOT the marketing
landing page. The Terminal is served at:  {BASE}/app.html

Env vars:
  WW_BASE_URL   base of the published artifact
                (default: https://build-1dadb019a5802eb5fee63753.emblem.build/pub/bitcoin_wallet/wonder-wallet)
  WW_HEADLESS   "1" (default) headless, "0" to watch the browser
  WW_BROWSER    "chrome" (default) | "firefox"

SECURITY: tests use the canonical BIP-39 test-vector mnemonic only (no funds you
care about, deterministic addresses). Never put a real user seed in tests. The
suite NEVER clicks a final "Broadcast" button — it stops at review/validation so
nothing is ever signed-and-sent on-chain.
"""
import os
import pytest
from selenium import webdriver
from selenium.webdriver.chrome.options import Options as ChromeOptions
from selenium.webdriver.firefox.options import Options as FirefoxOptions

# Canonical BIP-39 test vector (Trezor). Public, deterministic, throwaway.
TEST_MNEMONIC = ("abandon abandon abandon abandon abandon abandon "
                 "abandon abandon abandon abandon abandon about")
TEST_PASSWORD = "testpass1234"

DEFAULT_BASE = ("https://build-1dadb019a5802eb5fee63753.emblem.build"
                "/pub/bitcoin_wallet/wonder-wallet")


def _base_url() -> str:
    return os.environ.get("WW_BASE_URL", DEFAULT_BASE).rstrip("/")


@pytest.fixture(scope="session")
def base_url() -> str:
    return _base_url()


@pytest.fixture(scope="session")
def terminal_url(base_url) -> str:
    return f"{base_url}/app.html"


def _make_driver():
    headless = os.environ.get("WW_HEADLESS", "1") != "0"
    browser = os.environ.get("WW_BROWSER", "chrome").lower()
    if browser == "firefox":
        opts = FirefoxOptions()
        if headless:
            opts.add_argument("-headless")
        return webdriver.Firefox(options=opts)
    opts = ChromeOptions()
    if headless:
        opts.add_argument("--headless=new")
    opts.add_argument("--no-sandbox")
    opts.add_argument("--disable-dev-shm-usage")
    opts.add_argument("--window-size=460,900")   # popup-ish width; wallet is responsive
    opts.add_argument("--disable-gpu")
    return webdriver.Chrome(options=opts)


@pytest.fixture
def driver():
    """Fresh browser per test → isolated localStorage/IndexedDB (no leaked vault)."""
    d = _make_driver()
    d.set_page_load_timeout(45)
    d.implicitly_wait(0)  # we use explicit waits only (see pages/base.py)
    yield d
    d.quit()


@pytest.fixture
def fresh_terminal(driver, terminal_url):
    """Terminal loaded with a clean profile (no wallet yet)."""
    driver.get(terminal_url)
    return driver


@pytest.fixture
def restored_terminal(driver, terminal_url):
    """Terminal with the test wallet already restored + unlocked on the dashboard."""
    from pages.onboarding import OnboardingPage
    from pages.dashboard import DashboardPage
    driver.get(terminal_url)
    OnboardingPage(driver).restore(TEST_MNEMONIC, TEST_PASSWORD)
    return DashboardPage(driver).wait_loaded()
