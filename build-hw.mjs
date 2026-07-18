/* Builds the lazy-loaded hardware-wallet bundle (Ledger WebHID + node polyfills).
   Run: node build-hw.mjs  → public/wallet-hw.js (loaded only when the user connects). */
import { build } from 'esbuild';
import { polyfillNode } from 'esbuild-plugin-polyfill-node';

await build({
  entryPoints: ['hardware-src/index.js'],
  bundle: true, format: 'iife', target: 'es2020', minify: true,
  outfile: 'public/wallet-hw.js', logLevel: 'error',
  define: { global: 'globalThis' },
  plugins: [polyfillNode({ polyfills: { buffer: true, crypto: false, fs: false } })],
}).then(() => console.log('[build:hw] public/wallet-hw.js built'))
  .catch((e) => { console.error('[build:hw] FAILED', e.message); process.exit(1); });
