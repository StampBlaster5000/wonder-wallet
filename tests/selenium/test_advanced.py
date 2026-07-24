"""Advanced menu + gated secret flows.

The reveal-seed test is a full round-trip: the UI encrypted the vault on restore
(Argon2id+AES-GCM), and here it decrypts + shows the phrase — which must equal the
mnemonic we restored with. Also asserts the wrong-password gate.
"""
import pytest
from pages.base import BasePage
from conftest import TEST_MNEMONIC, TEST_PASSWORD


ADV_ITEMS = ["addresses", "sign", "hw", "custom", "reveal", "secrets"]


@pytest.mark.smoke
def test_advanced_menu_lists_all_tools(restored_terminal):
    dash = restored_terminal
    dash.open_advanced()
    p = BasePage(dash.d)
    for item in ADV_ITEMS:
        assert p.exists(f'.adv-opt[data-adv="{item}"]'), f"missing advanced tool: {item}"


@pytest.mark.flows
def test_reveal_seed_wrong_password(restored_terminal):
    dash = restored_terminal
    dash.open_advanced()
    p = BasePage(dash.d)
    p.click('.adv-opt[data-adv="reveal"]')
    p.fill("#gp", "wrongpassword")
    p.click("#bGo")
    assert "wrong password" in p.text_of("#gStatus").lower()


@pytest.mark.flows
def test_reveal_seed_correct_roundtrip(restored_terminal):
    dash = restored_terminal
    dash.open_advanced()
    p = BasePage(dash.d)
    p.click('.adv-opt[data-adv="reveal"]')
    p.fill("#gp", TEST_PASSWORD)
    p.click("#bGo")
    p.visible("#sg")          # seed grid
    p.click("#bB")            # tap to reveal (removes blur)
    from selenium.webdriver.common.by import By
    words = [w.text.split("\n")[-1].strip()
             for w in dash.d.find_elements(By.CSS_SELECTOR, "#sg .seedw")]
    assert " ".join(words) == TEST_MNEMONIC


@pytest.mark.flows
def test_sign_message_form_opens(restored_terminal):
    dash = restored_terminal
    dash.open_advanced()
    p = BasePage(dash.d)
    p.click('.adv-opt[data-adv="sign"]')
    assert p.exists("#smType")   # "Sign as <address-type>" selector
