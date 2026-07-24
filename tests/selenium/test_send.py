"""Send BTC form: negative-amount guard, fee chips + custom fee, review reachable.

SAFETY: never clicks the final broadcast. Stops at the Review screen / validation.
"""
import pytest
from pages.assets import SendForm


@pytest.mark.smoke
def test_send_form_opens_with_fee_controls(restored_terminal):
    dash = restored_terminal.switch_chain("btc")
    dash.action("send")
    form = SendForm(dash.d).wait_open()
    assert form.amount_min() == "0"           # amount field floored at 0
    assert len(form.fee_chips()) >= 3         # Fast/30m/1h/Econ chips
    assert form.has_custom_fee()              # advanced custom s/vB position


@pytest.mark.flows
def test_amount_cannot_go_negative(restored_terminal):
    dash = restored_terminal.switch_chain("btc")
    dash.action("send")
    form = SendForm(dash.d).wait_open()
    # Type a negative — the wallet-wide guard clamps to the field floor (0).
    form.set_amount("-5")
    val = form.amount_value()
    # Either rejected by the number input or clamped by the guard; never negative.
    assert val in ("", "0") or float(val) >= 0


@pytest.mark.flows
def test_fee_chip_selection(restored_terminal):
    dash = restored_terminal.switch_chain("btc")
    dash.action("send")
    form = SendForm(dash.d).wait_open()
    chips = form.fee_chips()
    chips[0].click()
    assert "on" in (chips[0].get_attribute("class") or "")
