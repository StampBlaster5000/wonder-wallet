"""Dashboard: chain switching, asset tabs, privacy toggle, action bar per chain."""
import pytest


@pytest.mark.smoke
def test_action_bar_bitcoin(restored_terminal):
    dash = restored_terminal.switch_chain("btc")
    acts = dash.available_actions()
    for a in ("send", "receive", "cp", "coincontrol", "activity", "dapps"):
        assert a in acts, f"missing BTC action: {a} (got {acts})"


@pytest.mark.flows
def test_chain_switch_updates_actions(restored_terminal):
    dash = restored_terminal
    dash.switch_chain("eth")
    assert dash.active_chain() == "eth"
    eth_acts = dash.available_actions()
    assert "send" in eth_acts and "receive" in eth_acts
    # Counterparty/CoinControl are Bitcoin-only
    assert "cp" not in eth_acts
    dash.switch_chain("sol")
    assert dash.active_chain() == "sol"


@pytest.mark.flows
def test_asset_tabs_toggle(restored_terminal):
    dash = restored_terminal.switch_chain("btc")
    dash.open_tab("collectibles")
    assert dash.exists('.datab[data-tab="collectibles"].on')
    dash.open_tab("tokens")
    assert dash.exists('.datab[data-tab="tokens"].on')


@pytest.mark.flows
def test_privacy_toggle_masks(restored_terminal):
    dash = restored_terminal
    start = dash.privacy_on()
    dash.toggle_privacy()
    assert dash.privacy_on() != start
    dash.toggle_privacy()
    assert dash.privacy_on() == start
