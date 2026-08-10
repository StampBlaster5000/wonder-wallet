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
catch (_) { console.error('manifest-contract: SKIP — extension/dist/manifest.json not found (run `node extension/build-ext.mjs` first).'); process.exit(0); }

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
// Backend: exactly ONE proxy origin in host_permissions (no surprise extra hosts).
if (!(Array.isArray(m.host_permissions) && m.host_permissions.length === 1 && /^https:\/\/.+\/\*$/.test(m.host_permissions[0]))) {
  fails.push('host_permissions: expected exactly one https proxy origin ending in /*, got ' + JSON.stringify(m.host_permissions));
}
// CSP must stay strict (script-src 'self', object-src 'none').
const csp = (m.content_security_policy && m.content_security_policy.extension_pages) || '';
if (!/script-src 'self'/.test(csp)) fails.push("content_security_policy: script-src 'self' missing");
if (!/object-src 'none'/.test(csp)) fails.push("content_security_policy: object-src 'none' missing");

if (fails.length) {
  console.error('manifest-contract: FAIL — the shipped manifest drifted from the reviewed contract:\n - ' + fails.join('\n - ')
    + '\n\nIf this change is intentional, update tests/manifest-contract.mjs AND STORE_LISTING.md.');
  process.exit(1);
}
console.log('manifest-contract: OK — permissions [' + (m.permissions || []).join(', ') + '], inject ['
  + ((m.content_scripts && m.content_scripts[0] && m.content_scripts[0].matches) || []).join(', ') + '], one proxy origin, strict CSP.');
