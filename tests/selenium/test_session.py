"""Session: lock, unlock (right + wrong password), persistence within a session."""
import pytest
from pages.onboarding import OnboardingPage
from pages.dashboard import DashboardPage
from conftest import TEST_PASSWORD


@pytest.mark.smoke
def test_lock_then_unlock(restored_terminal):
    dash = restored_terminal
    dash.lock()
    ob = OnboardingPage(dash.d)
    assert ob.is_locked()
    ob.unlock(TEST_PASSWORD)
    DashboardPage(dash.d).wait_loaded()


@pytest.mark.flows
def test_unlock_wrong_password(restored_terminal):
    dash = restored_terminal
    dash.lock()
    msg = OnboardingPage(dash.d).unlock_expect_error("wrongpassword")
    assert "wrong password" in msg.lower()


@pytest.mark.flows
def test_forget_wallet_returns_to_landing(restored_terminal):
    dash = restored_terminal
    dash.lock()
    # #bForget triggers a native confirm(); auto-accept then assert we're back at landing
    dash.d.execute_script("window.confirm = () => true;")
    OnboardingPage(dash.d).click("#bForget")
    OnboardingPage(dash.d).wait_landing()
