/**
 * Per-request network context (mainnet | testnet).
 *
 * Testnet Mode lets the wallet operate on Bitcoin testnet4 / Counterparty testnet4 /
 * (EVM Sepolia + SOL devnet are selected explicitly by name). The proxy is STATELESS —
 * the network is a per-request choice the client sends (`?network=testnet` or the
 * `x-ww-network` header). Rather than thread a `network` argument through every route
 * and every data-source function, we carry it in an AsyncLocalStorage store: one
 * middleware sets it for the request, and the source modules read `current()` when they
 * build their upstream base URL. Context survives `await` boundaries and is isolated
 * per concurrent request, so two simultaneous mainnet/testnet callers never cross wires.
 */
'use strict';

const { AsyncLocalStorage } = require('async_hooks');

const als = new AsyncLocalStorage();
const VALID = new Set(['mainnet', 'testnet']);

function normalize(n) {
  const s = String(n || '').toLowerCase();
  return VALID.has(s) ? s : 'mainnet';
}

/** Run `fn` with the given network as the active context for the whole async subtree. */
function runWith(network, fn) {
  return als.run(normalize(network), fn);
}

/** The active network for the current request (defaults to 'mainnet' outside any context). */
function current() {
  return als.getStore() || 'mainnet';
}

const isTestnet = () => current() === 'testnet';

module.exports = { runWith, current, isTestnet, normalize };
