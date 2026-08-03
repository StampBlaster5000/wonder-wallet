/* Assemble the loadable Wonder Wallet extension into extension/dist/.
   Run: NODE_PATH=$(npm root -g) node extension/build-ext.mjs
   Then load extension/dist as an unpacked extension in Chrome. */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { execSync } from 'child_process';
const require = createRequire(import.meta.url);
const gRoot = execSync('npm root -g').toString().trim();
const { Resvg } = require(join(gRoot, '@resvg', 'resvg-js'));

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUB = join(ROOT, 'public');
const SRC = join(ROOT, 'extension', 'src');
const DIST = join(ROOT, 'extension', 'dist');

rmSync(DIST, { recursive: true, force: true });
mkdirSync(join(DIST, 'icons'), { recursive: true });
mkdirSync(join(DIST, 'shots'), { recursive: true });

// 1. Copy the shared engine + UI modules the expanded view reuses (unchanged).
const MODULES = [
  'wallet-core.js', 'net-mode.js', 'wallet-hw.js', 'styles.css', 'qrcode.js',
  'app.js', 'coin-control.js', 'cp-actions.js', 'evm.js', 'sol.js', 'emblem.js',
  // NOTE: dapps.js (the dApp dashboard + external-site directory) is intentionally NOT bundled in the
  // extension — the extension is a self-contained wallet with no external-site launching. The full dApp
  // dashboard lives on the web Terminal (wonder-wallet.com). (Chrome "single-purpose launcher" hygiene.)
  'hardware-ui.js', 'minting.js', 'src101.js', 'backup.js', 'wallet-ui.js', 'topbar.js',
];
for (const m of MODULES) copyFileSync(join(PUB, m), join(DIST, m));
if (existsSync(join(PUB, 'shots'))) for (const f of readdirSync(join(PUB, 'shots'))) copyFileSync(join(PUB, 'shots', f), join(DIST, 'shots', f));

// 2. Copy extension source (shim, popup, background). The side panel reuses the popup UI.
for (const f of ['shim.js', 'ext-session.js', 'popup.html', 'popup.css', 'popup.js', 'background.js']) copyFileSync(join(SRC, f), join(DIST, f));
copyFileSync(join(SRC, 'popup.html'), join(DIST, 'sidepanel.html'));

// 2b. dApp provider (v0.49) — copy the provider stack into dist/provider/. These inject the wallet
// connector on the ALLOWLISTED dApp sites only (see manifest content_scripts below). approval.html
// lands in dist/provider/ and links ../popup.css + ../wallet-core.js (resolve to dist root — correct).
mkdirSync(join(DIST, 'provider'), { recursive: true });
for (const f of ['protocol.js', 'permissions.js', 'broker.js', 'inpage.js', 'eth-provider.js', 'sol-provider.js',
  'content.js', 'tx-summary.js', 'proof.js', 'background-provider.js', 'background-wire.js',
  'approval.js', 'approval.css', 'approval.html', 'connected-sites.js'])
  copyFileSync(join(SRC, 'provider', f), join(DIST, 'provider', f));

// 3. Icons — render the gold seal to 16/48/128.
const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="30" fill="#0a0a0f"/>
  <defs><radialGradient id="g" cx="50%" cy="34%" r="72%">
    <stop offset="0%" stop-color="#F4D58D"/><stop offset="55%" stop-color="#E0B453"/><stop offset="100%" stop-color="#9a6f1f"/>
  </radialGradient></defs>
  <circle cx="64" cy="64" r="45" fill="url(#g)"/>
  <circle cx="64" cy="64" r="45" fill="none" stroke="#000" stroke-opacity="0.18" stroke-width="2"/>
  <path d="M40 46 L52 84 L64 58 L76 84 L88 46" fill="none" stroke="#3a2606" stroke-width="7" stroke-linejoin="round" stroke-linecap="round"/>
</svg>`;
for (const size of [16, 48, 128]) {
  const png = new Resvg(ICON_SVG, { fitTo: { mode: 'width', value: size } }).render().asPng();
  writeFileSync(join(DIST, 'icons', `icon-${size}.png`), png);
}

// 4. manifest.json (v2 — popup + expanded + dApp provider; reads via the stateless proxy).
const PROXY = 'https://build-1dadb019a5802eb5fee63753.emblem.build';
// UNIVERSAL WALLET (v0.50): the dApp provider injects on ALL websites so any BTC/ETH/SOL dApp can
// discover + connect to Wonder Wallet with zero setup — the MetaMask/Phantom model. Safety rests on the
// per-origin approval model (every connect + every signature is user-approved; origin authenticated from
// Chrome's sender), NOT on the injection allowlist. ETH uses EIP-6963 (no window.ethereum clobber) and
// SOL uses the Wallet Standard, so we coexist with other wallets. content.js runs at document_start;
// the inpage/eth/sol page scripts are web_accessible_resources.
const DAPP_HOSTS = ['http://*/*', 'https://*/*'];
const manifest = {
  manifest_version: 3,
  name: 'Wonder Wallet',
  version: '0.52.0',
  description: 'A self-custodial Bitcoin wallet for collectors. Your keys, your assets, and your data stay on your own device.',
  action: { default_title: 'Wonder Wallet', default_popup: 'popup.html' },
  background: { service_worker: 'background.js' },
  side_panel: { default_path: 'sidepanel.html' },
  permissions: ['storage', 'alarms', 'sidePanel', 'scripting'],
  host_permissions: [PROXY + '/*'],
  content_scripts: [{
    matches: DAPP_HOSTS,
    js: ['provider/content.js'],
    run_at: 'document_start',
    all_frames: false,
  }],
  web_accessible_resources: [{
    resources: ['provider/inpage.js', 'provider/eth-provider.js', 'provider/sol-provider.js'],
    matches: DAPP_HOSTS,
  }],
  content_security_policy: {
    extension_pages: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: ${PROXY}; connect-src 'self' ${PROXY}; frame-src ${PROXY}; object-src 'none'; base-uri 'self'`,
  },
  icons: { 16: 'icons/icon-16.png', 48: 'icons/icon-48.png', 128: 'icons/icon-128.png' },
};
writeFileSync(join(DIST, 'manifest.json'), JSON.stringify(manifest, null, 2));

// 5. expanded.html — the full wallet (all tools). Shim first, then core + modules. No landing.
const EXPANDED = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Wonder Wallet</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <div class="aurora"></div>
  <header class="topbar">
    <div class="brand">
      <span class="seal" aria-hidden="true"><svg viewBox="0 0 48 48" width="34" height="34"><defs><radialGradient id="g" cx="50%" cy="35%" r="70%"><stop offset="0%" stop-color="#F4D58D"/><stop offset="55%" stop-color="#E0B453"/><stop offset="100%" stop-color="#9a6f1f"/></radialGradient></defs><circle cx="24" cy="24" r="22" fill="url(#g)"/><path d="M12 17 L17.5 32 L24 21 L30.5 32 L36 17" fill="none" stroke="#3a2606" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/></svg></span>
      <div class="wordmark"><span class="name">Wonder Wallet</span><span class="attribution">Secured by Emblem Vault</span></div>
    </div>
    <div class="meta">
      <button class="dapps-btn" id="backupBtn" title="Back up / restore">Backup</button>
      <span class="badge" id="phaseBadge">Extension</span>
      <span class="ver" id="verTag"></span>
    </div>
  </header>
  <main class="wrap">
    <section class="card wallet-card" id="wallet">
      <div class="card-h"><h2>Your wallet</h2><span class="tag">keys never leave your browser</span></div>
      <div id="walletBody"><div class="statusline load">Loading key engine…</div></div>
    </section>
  </main>
  <div id="modal" class="modal" hidden><div class="modal-card" id="modalCard"></div></div>
  <script src="shim.js"></script>
  <script src="wallet-core.js"></script>
  <script src="net-mode.js"></script>
  <script src="ext-session.js"></script>
  <script src="qrcode.js"></script>
  <script src="app.js"></script>
  <script src="coin-control.js"></script>
  <script src="cp-actions.js"></script>
  <script src="evm.js"></script>
  <script src="sol.js"></script>
  <script src="emblem.js"></script>
  <script src="hardware-ui.js"></script>
  <script src="minting.js"></script>
  <script src="src101.js"></script>
  <script src="backup.js"></script>
  <script src="wallet-ui.js"></script>
  <script src="topbar.js"></script>
</body>
</html>`;
writeFileSync(join(DIST, 'expanded.html'), EXPANDED);

console.log('✓ built extension/dist (' + readdirSync(DIST).length + ' entries)');

// 6. Repackage the downloadable zip (public/wonder-wallet-extension.zip) from the fresh dist so the
//    homepage "Download the beta" link never serves a stale build. Wrapped in a top-level folder.
const { makeZip } = await import('./make-zip.mjs');
const ZIP_OUT = join(PUB, 'wonder-wallet-extension.zip');
const z = makeZip(DIST, ZIP_OUT, 'wonder-wallet-extension');
console.log('✓ repackaged ' + ZIP_OUT.replace(ROOT + '/', '') + ' (' + z.files + ' files, ' + Math.round(z.bytes / 1024) + ' KB)');
