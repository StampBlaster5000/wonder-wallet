/* Wonder Wallet — topbar wiring (CSP-safe: no inline handlers). */
'use strict';
document.getElementById('dappsBtn')?.addEventListener('click', () => window.DappDashboard && window.DappDashboard.toggle());
