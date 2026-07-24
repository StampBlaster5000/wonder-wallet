"""Onboarding: create, restore, and their validation paths."""
import pytest
from pages.onboarding import OnboardingPage
from pages.dashboard import DashboardPage
from conftest import TEST_MNEMONIC, TEST_PASSWORD


@pytest.mark.smoke
def test_landing_shows_entry_points(fresh_terminal):
    ob = OnboardingPage(fresh_terminal).wait_landing()
    assert ob.exists("#bCreate")
    assert ob.exists("#bRestore")
    assert ob.exists("#bHardware")


@pytest.mark.smoke
def test_restore_reaches_dashboard(fresh_terminal):
    OnboardingPage(fresh_terminal).restore(TEST_MNEMONIC, TEST_PASSWORD)
    dash = DashboardPage(fresh_terminal).wait_loaded()
    # BTC / ETH / SOL chain tabs all present for an HD account
    assert dash.exists('.dctab[data-ch="btc"]')
    assert dash.exists('.dctab[data-ch="eth"]')
    assert dash.exists('.dctab[data-ch="sol"]')


@pytest.mark.flows
def test_restore_rejects_bad_mnemonic(fresh_terminal):
    msg = OnboardingPage(fresh_terminal).restore_expect_error(
        "not a real seed phrase at all", TEST_PASSWORD)
    assert "not a valid" in msg.lower() or "bip-39" in msg.lower()


@pytest.mark.flows
def test_restore_rejects_short_password(fresh_terminal):
    msg = OnboardingPage(fresh_terminal).restore_expect_error(TEST_MNEMONIC, "short")
    assert "8 characters" in msg


@pytest.mark.flows
def test_restore_rejects_password_mismatch(fresh_terminal):
    msg = OnboardingPage(fresh_terminal).restore_expect_error(
        TEST_MNEMONIC, TEST_PASSWORD, confirm="different1234")
    assert "match" in msg.lower()


@pytest.mark.flows
def test_create_flow_end_to_end(fresh_terminal):
    # Generates a fresh seed, reads the revealed words to clear the confirm-quiz,
    # sets a password, and lands on the dashboard.
    OnboardingPage(fresh_terminal).create(TEST_PASSWORD, words=24)
    DashboardPage(fresh_terminal).wait_loaded()
