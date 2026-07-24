"""Asset-detail modal + send/attach forms reached from it.

Verified selectors:
  modal card:      #wmodalCard
  tools row:       .m-act[data-act=send|dispenser|dividend|destroy|burn|attach|vault]
  attach form:     #adA (asset)  #adQ (quantity, min=0)  #adReview
  BTC send form:   #sTo  #sAmt (number,min=0)  .feeopt (chips)  #sFee  #bReview  #mc
"""
from selenium.webdriver.common.by import By
from .base import BasePage


class AssetModal(BasePage):
    CARD = "#wmodalCard"

    def wait_open(self):
        self.visible(self.CARD)
        return self

    def tool_buttons(self):
        return [e.get_attribute("data-act")
                for e in self.d.find_elements(By.CSS_SELECTOR, f"{self.CARD} .m-act[data-act]")]

    def click_tool(self, act: str):
        self.click(f'{self.CARD} .m-act[data-act="{act}"]')
        return self

    def title(self) -> str:
        return self.text_of(f"{self.CARD} .m-title")

    def close(self):
        # every asset modal has a ghost Close button
        for css in (f"{self.CARD} .wbtns .ghost", f"{self.CARD} .modal-x"):
            if self.exists(css):
                self.click(css)
                break
        return self


class AttachForm(BasePage):
    def wait_open(self):
        self.visible("#adA")
        return self

    def asset_value(self) -> str:
        return self.visible("#adA").get_attribute("value")

    def quantity_value(self) -> str:
        return self.visible("#adQ").get_attribute("value")

    def quantity_min(self) -> str:
        return self.visible("#adQ").get_attribute("min")


class SendForm(BasePage):
    def wait_open(self):
        self.visible("#sTo")
        return self

    def amount_min(self) -> str:
        return self.visible("#sAmt").get_attribute("min")

    def fee_chips(self):
        return self.d.find_elements(By.CSS_SELECTOR, ".fee-row .feeopt")

    def has_custom_fee(self) -> bool:
        return self.exists("#sFee")

    def fill_recipient(self, addr: str):
        self.fill("#sTo", addr)
        return self

    def set_amount(self, amount: str):
        self.fill("#sAmt", amount)
        return self

    def amount_value(self) -> str:
        return self.visible("#sAmt").get_attribute("value")
