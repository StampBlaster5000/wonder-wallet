/* Wonder Wallet — cross-surface session (extension only).
   Unlock once, stay unlocked across the popup, side panel and Terminal window. The decrypted
   seed lives in chrome.storage.session (in-RAM, extension-only, auto-cleared when the browser
   closes) with a 5-minute idle timeout, coordinated across surfaces by a shared lastActive. */
(function () {
  var C = window.WonderCore;
  var HAS = window.chrome && chrome.storage && chrome.storage.session;
  if (!C || !HAS) { window.WWSession = { ready: Promise.resolve(), touch: function () {}, lastActive: function () { return 0; }, idleMs: 0 }; return; }

  var SKEY = 'ww:session';
  // Idle timeout is user-configurable (Advanced → Auto-lock), stored in localStorage (shared across
  // surfaces). 'off' = never auto-lock. Default 5 minutes.
  function idleMs() {
    try {
      var v = localStorage.getItem('ww:idlemins');
      if (v === 'off') return 1e15; // effectively never
      var m = parseFloat(v); if (m > 0) return m * 60000;
    } catch (e) {}
    return 5 * 60 * 1000;
  }
  var ss = chrome.storage.session;
  var put = function (v) { var o = {}; o[SKEY] = v; ss.set(o); };
  var _t = 0, _last = 0; // _last = cached lastActive (for the countdown display)

  function notify() {
    try { document.dispatchEvent(new Event('ww-lockstate')); } catch (e) {}
    try { if (window.WonderWalletUI && window.WonderWalletUI.render) window.WonderWalletUI.render(); } catch (e) {}
  }
  function saveSession() { var s = C.getSessionSecret(); if (s) { _last = Date.now(); put({ secret: s, lastActive: _last }); } }
  function clearSession() { ss.remove(SKEY); }
  function neutralize() { try { if (C.armAutoLock) C.armAutoLock(Math.max(864e5, idleMs() + 60000)); } catch (e) {} } // the session owns idle-lock
  // Apply a new idle setting (minutes, or 'off') + reset the clock so a shorter timer can't lock instantly.
  function setIdle(v) { try { localStorage.setItem('ww:idlemins', v === 'off' ? 'off' : String(v)); } catch (e) {} saveSession(); neutralize(); }

  // Persist on unlock; clear on lock. Neutralize wallet-core's separate per-page timer.
  C.onLockChange(function (unlocked) { if (unlocked) { saveSession(); neutralize(); } else clearSession(); });

  // Activity refreshes the shared timer (throttled to 10s).
  function touch() {
    if (!C.isUnlocked()) return;
    var now = Date.now(); if (now - _t < 10000) return; _t = now;
    ss.get(SKEY, function (o) { var s = o && o[SKEY]; if (s) { _last = now; put({ secret: s.secret, lastActive: now }); } });
  }
  ['click', 'keydown', 'pointerdown'].forEach(function (ev) { document.addEventListener(ev, touch, true); });

  // Mirror lock/unlock/activity from other surfaces (and the service-worker sweep).
  ss.onChanged.addListener(function (ch) {
    if (!ch[SKEY]) return;
    var nv = ch[SKEY].newValue;
    if (!nv) { if (C.isUnlocked()) { C.lock(); notify(); } }
    else { _last = nv.lastActive || _last; if (nv.secret && !C.isUnlocked()) { C.resumeSession(nv.secret); neutralize(); notify(); } }
  });

  // Robust idle enforcer — a plain 2s interval (can't be killed by a transient read).
  setInterval(function () {
    if (!C.isUnlocked()) return;
    ss.get(SKEY, function (o) {
      var s = o && o[SKEY];
      if (!s) { if (C.isUnlocked()) { C.lock(); notify(); } return; } // cleared elsewhere → lock here
      _last = s.lastActive || _last;
      if (Date.now() - _last >= idleMs()) { C.lock(); notify(); } // expired → lock this surface directly
    });
  }, 2000);

  // Restore on load — before the UI renders, so no lock-screen flash.
  var ready = new Promise(function (resolve) {
    ss.get(SKEY, function (o) {
      var s = o && o[SKEY];
      if (s && s.secret && Date.now() - (s.lastActive || 0) < idleMs()) { _last = s.lastActive; C.resumeSession(s.secret); neutralize(); notify(); }
      else if (s) { ss.remove(SKEY); }
      resolve();
    });
  });
  window.WWSession = { ready: ready, touch: touch, lastActive: function () { return _last; }, setIdle: setIdle };
  try { Object.defineProperty(window.WWSession, 'idleMs', { get: idleMs }); } catch (e) { window.WWSession.idleMs = idleMs(); }
})();
