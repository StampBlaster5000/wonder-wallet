"""Collectibles gallery + asset-detail tools (Attach/Vault preloading, tile states).

The BIP-39 test vector address does not deterministically hold stamps, so these
tests DEGRADE GRACEFULLY: if the gallery is empty they skip with a clear reason.
To make them deterministic in CI, set WW_STAMP_ADDRESS to a stamp-holding address
and extend restored_terminal to add it as a watch-only account (note: watch-only
hides the signing tools, so Attach/Vault assertions need an OWN account with stamps).
"""
import pytest
from pages.assets import AssetModal, AttachForm


def _open_collectibles(dash):
    dash.switch_chain("btc").open_tab("collectibles")
    # let the gallery finish its fetch
    dash.visible("#dashAssets")
    return dash.collectible_tiles()


@pytest.mark.flows
def test_collectibles_gallery_renders(restored_terminal):
    dash = restored_terminal
    tiles = _open_collectibles(dash)
    if not tiles:
        pytest.skip("test address holds no stamps — set WW_STAMP_ADDRESS for deterministic coverage")
    assert len(tiles) >= 1


@pytest.mark.flows
def test_html_badge_only_on_html_stamps(restored_terminal):
    """A broken/slow IMAGE stamp must NOT get an HTML badge (mime-gated render)."""
    dash = restored_terminal
    tiles = _open_collectibles(dash)
    if not tiles:
        pytest.skip("no stamps on test address")
    # Every HTML badge must live on an iframe tile, never on an <img>/error tile.
    from selenium.webdriver.common.by import By
    for badge in dash.html_badges():
        tile = badge.find_element(By.XPATH, "./..")
        assert tile.find_elements(By.CSS_SELECTOR, "iframe.dnft-frame"), \
            "HTML badge on a non-iframe tile (image mislabelled as HTML)"


@pytest.mark.flows
def test_asset_detail_tools_present(restored_terminal):
    dash = restored_terminal
    tiles = _open_collectibles(dash)
    if not tiles:
        pytest.skip("no stamps on test address")
    dash.open_first_collectible()
    modal = AssetModal(dash.d).wait_open()
    tools = modal.tool_buttons()
    # own HD account → full tool set including Attach + Vault
    assert "send" in tools
    assert "attach" in tools
    assert "vault" in tools


@pytest.mark.flows
def test_attach_preloads_asset_and_quantity_one(restored_terminal):
    dash = restored_terminal
    tiles = _open_collectibles(dash)
    if not tiles:
        pytest.skip("no stamps on test address")
    dash.open_first_collectible()
    AssetModal(dash.d).wait_open().click_tool("attach")
    form = AttachForm(dash.d).wait_open()
    assert form.asset_value() != ""     # asset preloaded
    assert form.quantity_value() == "1" # default quantity is 1 (not max)
    assert form.quantity_min() == "0"   # cannot go negative
