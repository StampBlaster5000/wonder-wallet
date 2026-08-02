/* Wonder Wallet — MV3 service worker.
   Intentionally minimal & remote-code-free. Key custody, signing and auto-lock all run
   in-page (wallet-core, Argon2id vault in IndexedDB). The worker exists for MV3 lifecycle
   and to open the full wallet in a tab. */
'use strict';

// dApp provider (v0.49): one importScripts pulls in the whole provider background — protocol,
// permissions store, broker, router + the message listeners (ww_provider_request / decision /
// sites). No keys here: signing + account compute happen in the approval window (which resumes the
// unlocked session); the SW only routes requests, stores per-origin grants, and serves cached reads.
try { importScripts('provider/background-wire.js'); } catch (e) { /* provider unavailable — wallet still works */ }

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('expanded.html#welcome') });
  }
});

// Keep the toolbar click showing the popup; the side panel opens on demand (popup button).
try { chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }); } catch (e) {}

// Cross-surface session (chrome.storage.session, in-RAM, cleared on browser close).
try { chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }); } catch (e) {}

// Idle backstop: even with no wallet page open, clear the session after 5 min of no activity.
const IDLE_MS = 5 * 60 * 1000;
try { chrome.alarms.create('ww-idle', { periodInMinutes: 1 }); } catch (e) {}
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name !== 'ww-idle') return;
  chrome.storage.session.get('ww:session', (o) => {
    const s = o && o['ww:session'];
    if (s && Date.now() - (s.lastActive || 0) >= IDLE_MS) chrome.storage.session.remove('ww:session');
  });
});

// Popup asks the worker to open the full-tab wallet.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'open-expanded') {
    chrome.tabs.create({ url: chrome.runtime.getURL('expanded.html' + (msg.hash || '')) });
    sendResponse({ ok: true });
  }
  return true;
});
