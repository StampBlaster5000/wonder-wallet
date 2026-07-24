"""Unlocked dashboard: account select, chain/asset tabs, privacy, action bar.

Verified selectors (public/wallet-ui.js renderUnlocked / renderActions):
  #acctIdx  #bLock  #bAdvanced  #privacyBtn
  chain tabs:  .dctab[data-ch=btc|eth|sol]   portfolio cards: .pf-card[data-ch]
  asset tabs:  .datab[data-tab=tokens|collectibles]
  assets host: #dashAssets
  actions:     #dashActions button[data-a=send|receive|cp|coincontrol|activity|dapps]
"""
from selenium.webdriver.support.ui import Select
from .base import BasePage


class DashboardPage(BasePage):
    def wait_loaded(self):
        self.visible("#dashActions")
        self.visible("#acctIdx")
        return self

    # ── account ──
    def select_account(self, index: int):
        Select(self.visible("#acctIdx")).select_by_value(str(index))
        return self.wait_loaded()

    # ── chains / tabs ──
    def switch_chain(self, ch: str):
        assert ch in ("btc", "eth", "sol")
        self.click(f'.dctab[data-ch="{ch}"]')
        return self.wait_loaded()

    def open_tab(self, name: str):
        assert name in ("tokens", "collectibles")
        self.click(f'.datab[data-tab="{name}"]')
        return self

    def active_chain(self) -> str:
        return self.visible(".dctab.on").get_attribute("data-ch")

    # ── privacy ──
    def toggle_privacy(self):
        self.click("#privacyBtn")
        return self

    def privacy_on(self) -> bool:
        return "on" in (self.visible("#privacyBtn").get_attribute("class") or "")

    # ── actions ──
    def action(self, a: str):
        self.click(f'#dashActions button[data-a="{a}"]')
        return self

    def available_actions(self):
        from selenium.webdriver.common.by import By
        self.visible("#dashActions")
        return [e.get_attribute("data-a")
                for e in self.d.find_elements(By.CSS_SELECTOR, '#dashActions button[data-a]')]

    # ── lock / advanced ──
    def lock(self):
        self.click("#bLock")
        self.visible("#unlockForm")
        return self

    def open_advanced(self):
        self.click("#bAdvanced")
        return self

    # ── collectibles gallery introspection ──
    def collectible_tiles(self):
        from selenium.webdriver.common.by import By
        return self.d.find_elements(By.CSS_SELECTOR, "#dashAssets .dnft")

    def html_badges(self):
        from selenium.webdriver.common.by import By
        return self.d.find_elements(By.CSS_SELECTOR, "#dashAssets .htmlbadge")

    def open_first_collectible(self):
        tiles = self.collectible_tiles()
        assert tiles, "no collectibles rendered"
        tiles[0].click()
        return self
