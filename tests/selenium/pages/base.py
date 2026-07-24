"""Base page object: explicit waits + small helpers. All selectors are grounded in
the live Terminal DOM (public/wallet-ui.js), verified 2026-07-20."""
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

DEFAULT_TIMEOUT = 20


class BasePage:
    def __init__(self, driver, timeout: int = DEFAULT_TIMEOUT):
        self.d = driver
        self.timeout = timeout

    # ── waits ──────────────────────────────────────────────
    def wait(self, cond, timeout=None):
        return WebDriverWait(self.d, timeout or self.timeout).until(cond)

    def visible(self, css, timeout=None):
        return self.wait(EC.visibility_of_element_located((By.CSS_SELECTOR, css)), timeout)

    def clickable(self, css, timeout=None):
        return self.wait(EC.element_to_be_clickable((By.CSS_SELECTOR, css)), timeout)

    def present(self, css, timeout=None):
        return self.wait(EC.presence_of_element_located((By.CSS_SELECTOR, css)), timeout)

    def gone(self, css, timeout=None):
        return self.wait(EC.invisibility_of_element_located((By.CSS_SELECTOR, css)), timeout)

    def exists(self, css) -> bool:
        return len(self.d.find_elements(By.CSS_SELECTOR, css)) > 0

    def text_of(self, css, timeout=None) -> str:
        return self.visible(css, timeout).text

    # ── actions ────────────────────────────────────────────
    def click(self, css, timeout=None):
        self.clickable(css, timeout).click()
        return self

    def fill(self, css, value, timeout=None):
        el = self.visible(css, timeout)
        el.clear()
        el.send_keys(value)
        return self

    def wait_text_contains(self, css, needle, timeout=None):
        return self.wait(EC.text_to_be_present_in_element((By.CSS_SELECTOR, css), needle), timeout)
