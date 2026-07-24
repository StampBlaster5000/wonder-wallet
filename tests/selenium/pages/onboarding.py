"""Onboarding + session flows: create, restore, unlock, lock, forget.

Selectors verified live against public/wallet-ui.js:
  landing:  #bCreate #bRestore #bHardware
  create:   [data-w] #seedGrid #bBlur #bNext  .cq-opt[data-i][data-w] #bToPw  #pw1 #pw2 #pp #bCreate2
  restore:  #rSeed #rPp #rPw1 #rPw2 #bDo
  locked:   #unlockForm #unlockPw (submit) #unlockStatus #bForget
"""
from selenium.webdriver.common.by import By
from .base import BasePage


class OnboardingPage(BasePage):
    # ── landing (no wallet yet) ──
    def wait_landing(self):
        self.visible("#bCreate")
        return self

    def start_create(self):
        self.click("#bCreate")
        return self

    def start_restore(self):
        self.click("#bRestore")
        return self

    # ── restore (deterministic; used by most tests) ──
    def restore(self, mnemonic: str, password: str, passphrase: str = ""):
        self.wait_landing().start_restore()
        self.fill("#rSeed", mnemonic)
        if passphrase:
            self.fill("#rPp", passphrase)
        self.fill("#rPw1", password)
        self.fill("#rPw2", password)
        self.click("#bDo")
        # success → modal closes and the dashboard account selector appears
        self.gone("#rSeed")
        return self

    def restore_expect_error(self, mnemonic: str, password: str, confirm: str = None):
        self.wait_landing().start_restore()
        self.fill("#rSeed", mnemonic)
        self.fill("#rPw1", password)
        self.fill("#rPw2", confirm if confirm is not None else password)
        self.click("#bDo")
        return self.text_of("#rStatus")

    # ── create (24-word) — reads the revealed words to pass the confirm-quiz ──
    def create(self, password: str, words: int = 24):
        self.wait_landing().start_create()
        self.click(f'[data-w="{words}"]')
        self.visible("#seedGrid")
        self.click("#bBlur")                       # reveal
        seed_words = [e.text for e in self.d.find_elements(By.CSS_SELECTOR, "#seedGrid .seedw")]
        # #seedw renders "<i>1</i>word" — strip the index prefix
        seed_words = [w.split("\n")[-1].strip() for w in seed_words]
        self.click("#bNext")                       # "I've saved it"
        # confirm-quiz: pick the correct word for each asked position
        for q in self.d.find_elements(By.CSS_SELECTOR, ".confirm-q"):
            idx = int(q.get_attribute("data-i"))
            correct = seed_words[idx]
            q.find_element(By.CSS_SELECTOR, f'.cq-opt[data-w="{correct}"]').click()
        self.click("#bToPw")
        self.fill("#pw1", password)
        self.fill("#pw2", password)
        self.click("#bCreate2")
        self.gone("#pw1")
        return self

    # ── session ──
    def unlock(self, password: str):
        self.fill("#unlockPw", password)
        self.click("#unlockForm button[type=submit]")
        return self

    def unlock_expect_error(self, password: str) -> str:
        self.fill("#unlockPw", password)
        self.click("#unlockForm button[type=submit]")
        return self.text_of("#unlockStatus")

    def is_locked(self) -> bool:
        return self.exists("#unlockForm")
