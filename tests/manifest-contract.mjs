/* Manifest contract test (audit 2026-08 findings #1/#7).
 * Asserts the BUILT extension manifest (extension/dist/manifest.json) matches an explicit, reviewed
 * permission + injection surface. If any of these drift — a new permission, a change to injection scope,
 * a different proxy origin — CI fails, forcing a conscious decision AND a matching STORE_LISTING.md update
 * (rather than the silent drift the audit found). Run AFTER `node extension/build-ext.mjs`.
 *
 * ⚠ When you deliberately change the extension's surface, update THIS contract and STORE_LISTING.md together. */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'extension', 'dist', 'manifest.json');

let m;
try { m = JSON.parse(readFileSync(DIST, 'utf8')); }
catch (_) {
  // WW-C01: a missing built manifest must FAIL, never silently pass. The audit found this test exited
  // successfully when extension/dist/manifest.json was absent, so CI could not establish that the
  // published archive was actually built from the reviewed commit. CI builds the extension before the
  // tests, so an absent manifest here means the build failed or was skipped — that is a hard failure.
  console.error('❌ manifest-contract: FAIL — extension/dist/manifest.json not found. The extension must be built (`node extension/build-ext.mjs`) before the tests so its permission/injection surface AND its provenance are proven, not skipped.');
  process.exit(1);
}

const fails = [];
const eq = (name, got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) fails.push(`${name}: got ${JSON.stringify(got)} — want ${JSON.stringify(want)}`); };

// ── THE CONTRACT (the reviewed, documented surface) ──────────────────────────────────────────────────
// Permissions: NO 'scripting' (injection is via static content_scripts; audit #7c dropped it).
eq('permissions', (m.permissions || []).slice().sort(), ['alarms', 'sidePanel', 'storage']);
// Injection scope: universal (MetaMask/Phantom model). If this ever narrows to an allowlist — or widens
// further — it must be a deliberate change reflected in STORE_LISTING.md's permission justification.
eq('content_scripts[0].matches', m.content_scripts && m.content_scripts[0] && m.content_scripts[0].matches, ['http://*/*', 'https://*/*']);
eq('content_scripts[0].js', m.content_scripts && m.content_scripts[0] && m.content_scripts[0].js, ['provider/content.js']);
eq('content_scripts[0].run_at', m.content_scripts && m.content_scripts[0] && m.content_scripts[0].run_at, 'document_start');
// Backend: exactly ONE proxy origin in host_permissions granted by DEFAULT (no surprise extra hosts).
if (!(Array.isArray(m.host_permissions) && m.host_permissions.length === 1 && /^https:\/\/.+\/\*$/.test(m.host_permissions[0]))) {
  fails.push('host_permissions: expected exactly one https proxy origin ending in /*, got ' + JSON.stringify(m.host_permissions));
}
// Custom reader endpoint (Advanced → Reader endpoint): a user-chosen backend is granted at RUNTIME via
// optional_host_permissions — never a default grant. Locked to https only.
eq('optional_host_permissions', m.optional_host_permissions, ['https://*/*']);
// CSP: script-src MUST stay strict 'self' (no remote code, ever) and object-src 'none'. img/connect/frame
// are broadened to https: so a custom reader can serve reads/art — script execution is unaffected.
const csp = (m.content_security_policy && m.content_security_policy.extension_pages) || '';
if (!/script-src 'self'/.test(csp)) fails.push("content_security_policy: script-src 'self' missing");
if (/script-src[^;]*https:/.test(csp)) fails.push("content_security_policy: script-src must NOT allow https: (remote code)");
if (!/object-src 'none'/.test(csp)) fails.push("content_security_policy: object-src 'none' missing");
if (!/connect-src 'self' https:/.test(csp)) fails.push("content_security_policy: connect-src must allow https: (custom reader)");

if (fails.length) {
  console.error('manifest-contract: FAIL — the shipped manifest drifted from the reviewed contract:\n - ' + fails.join('\n - ')
    + '\n\nIf this change is intentional, update tests/manifest-contract.mjs AND STORE_LISTING.md.');
  process.exit(1);
}
console.log('✅ manifest-contract: OK — permissions [' + (m.permissions || []).join(', ') + '], inject ['
  + ((m.content_scripts && m.content_scripts[0] && m.content_scripts[0].matches) || []).join(', ') + '], one default proxy origin, optional https reader grant, strict script-src.');
