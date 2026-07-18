/**
 * Wonder Wallet — portable core: chain registry & derivation paths.
 *
 * This module is intentionally CHAIN-AGNOSTIC and FRAMEWORK-FREE (no DOM, no
 * server, no wallet UI). It is the shared source of truth that both the
 * canonical browser-extension shell and this hosted preview app build on.
 * In Phase 1 it holds constants only — no key material, no signing.
 *
 * All values verified in Phase 0 (see PHASE0-API-MAP.md §8).
 */

'use strict';

// ── Bitcoin address types (one seed → all four, all selectable) ──────────────
const BTC_ADDRESS_TYPES = {
  nativeSegwit: {
    id: 'nativeSegwit',
    label: 'Native SegWit',
    prefixHint: 'bc1q…',
    path: "m/84'/0'/0'/0/x",
    note: 'Efficient default.',
  },
  legacy: {
    id: 'legacy',
    label: 'Legacy (P2PKH)',
    prefixHint: '1…',
    path: "m/44'/0'/0'/0/x",
    note: 'Required for OG Counterparty / Stamps assets.',
  },
  taproot: {
    id: 'taproot',
    label: 'Taproot',
    prefixHint: 'bc1p…',
    path: "m/86'/0'/0'/0/x",
    note: 'Selectable account — switch here to interact with Ordinals.',
  },
  nestedSegwit: {
    id: 'nestedSegwit',
    label: 'Nested SegWit (P2SH)',
    prefixHint: '3…',
    path: "m/49'/0'/0'/0/x",
    note: 'OG-asset restore support (assets stranded on 3… addresses).',
  },
};

// ── Chain registry (BTC + ETH/EVM + Solana) ──────────────────────────────────
const CHAINS = {
  bitcoin: {
    id: 'bitcoin',
    name: 'Bitcoin',
    symbol: 'BTC',
    curve: 'secp256k1',
    model: 'utxo',
    addressTypes: BTC_ADDRESS_TYPES,
    status: 'live', // Phase 1: watch-only read is live
  },
  ethereum: {
    id: 'ethereum',
    name: 'Ethereum / EVM',
    symbol: 'ETH',
    curve: 'secp256k1',
    model: 'account',
    path: "m/44'/60'/0'/0/x",
    note: 'Same address across all EVM chains (Base, Arbitrum, …).',
    status: 'live', // Phase 7 — read + EIP-1559 send live
  },
  solana: {
    id: 'solana',
    name: 'Solana',
    symbol: 'SOL',
    curve: 'ed25519',
    model: 'account',
    path: "m/44'/501'/x'/0'",
    note: 'SLIP-0010, all levels hardened. Also probe m/44\'/501\'/0\' on import.',
    status: 'live', // Phase 7b — read + SOL/SPL send live
  },
};

module.exports = { CHAINS, BTC_ADDRESS_TYPES };
