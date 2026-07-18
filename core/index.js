/**
 * Wonder Wallet — portable core barrel.
 * Chain-agnostic, framework-free. Reused by the canonical extension shell
 * and this hosted preview app. Phase 1: constants + UTXO classification only.
 */
'use strict';

const { CHAINS, BTC_ADDRESS_TYPES } = require('./chains');
const { DUST, PROTECT_REASONS, classifyUtxos } = require('./utxo');

const CORE_VERSION = '0.1.0';

module.exports = {
  CORE_VERSION,
  CHAINS,
  BTC_ADDRESS_TYPES,
  DUST,
  PROTECT_REASONS,
  classifyUtxos,
};
