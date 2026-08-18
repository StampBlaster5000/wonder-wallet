/* Wonder Wallet — XCP-69 standard: constants, lossless numeric handling, and the conformance predicate.
   Phase 1 (read-layer foundation) of the self-custodial XCP-69 launchpad.

   XCP-69 is a fixed-parameter fair-launch built on Counterparty `fairmint_pool` fairminters. There is
   NO on-chain "XCP-69" marker — conformance is a PREDICATE: exact equality against the standard's fixed
   raw values. A launch either passes it or is simply not XCP-69. Getting this predicate right is what
   lets Wonder badge a launch safely; getting it WRONG would mislabel a rug-capable launch as conforming.

   Two traps a naive integrator gets wrong (both enforced here):
     • minted_asset_commission MUST be 0. Counterparty otherwise lets a creator skim up to 99% of every
       mint back to itself — a stealth premine no other field catches.
     • Consensus REWRITES a launch's block_index (on open) and soft_cap_deadline_block (on early sellout).
       So the pre-announcement + exact-window checks must use the IMMUTABLE NEW_FAIRMINTER event values,
       not the mutated /fairminters row. This module takes those as explicit params.

   All quantities are raw satoshi units (×10^8) and exceed Number.MAX_SAFE_INTEGER (hard_cap = 10^16),
   so every comparison is done in BigInt. Reimplemented from the public standard (consensus, not code).
   Dependency-free and Node-testable. */
(function (root) {
  'use strict';

  // Fixed XCP-69 parameter set — raw sats (×10^8), as BigInt.
  const XCP69 = {
    HARD_CAP: 10000000000000000n,        // 100M supply
    SOFT_CAP: 6900000000000000n,         // 69M public sale — reaching it IS selling out (all-or-nothing)
    POOL_QUANTITY: 3100000000000000n,    // 31M seeded into the TOKEN/XCP pool, LP burned
    QUANTITY_BY_PRICE: 100000000000n,    // 1,000-token lot
    PRICE: 1000000n,                     // 0.01 XCP per lot
    MAX_MINT_PER_ADDRESS: 100000000000000n, // 1M tokens = 10 XCP per address; 69M / 1M = 69 participants
    MAX_MINT_PER_TX: 100000000000000n,
    DEADLINE_BLOCKS: 1000n,              // mint window = soft_cap_deadline_block − start_block, exactly (~7d)
  };
  const MEMPOOL_BLOCK_INDEX = 9999999n;  // core's block_index sentinel for unconfirmed txs
  const SATS = 100000000n;

  // ── Lossless numerics — Counterparty serializes quantities as BARE JSON numbers; anything > 2^53
  //    loses precision under JSON.parse before we can BigInt it. Quote 16+-digit integers first. ──
  function parseLossless(text) {
    return JSON.parse(String(text).replace(/:\s*(-?\d{16,})(?=\s*[,}\]])/g, ':"$1"'));
  }
  // Coerce number|string|bigint|null → BigInt, or null if not a whole-number value.
  function big(v) {
    if (v == null) return null;
    if (typeof v === 'bigint') return v;
    if (typeof v === 'number') { if (!Number.isFinite(v) || Math.floor(v) !== v) return null; return BigInt(v); }
    const s = String(v).trim(); if (!/^-?\d+$/.test(s)) return null; try { return BigInt(s); } catch (_) { return null; }
  }
  const rawEq = (v, target) => { const b = big(v); return b != null && b === target; };
  // Raw sats → human string (exact, no float): divisible = /10^8 with 8 decimals; indivisible passes through.
  function fromSats(raw, divisible) {
    const b = big(raw); if (b == null) return '0';
    if (!divisible) return b.toString();
    const neg = b < 0n, n = neg < 0 ? -b : (b < 0n ? -b : b);
    const w = (n / SATS).toString(), f = (n % SATS).toString().padStart(8, '0').replace(/0+$/, '');
    return (neg ? '-' : '') + w + (f ? '.' + f : '');
  }
  const bool = (v) => v === true || v === 1 || v === '1' || v === 'true';

  // ── Conformance: exact-equality on every fixed field readable from the fairminter row alone.
  //    Does NOT include the two timing clauses (they need the immutable NEW_FAIRMINTER event). ──
  function xcp69Params(fm) {
    if (!fm || typeof fm !== 'object') return false;
    const asset = String(fm.asset || '');
    return (
      (fm.status === 'pending' || fm.status === 'open' || fm.status === 'closed') &&
      rawEq(fm.hard_cap, XCP69.HARD_CAP) &&
      rawEq(fm.soft_cap, XCP69.SOFT_CAP) &&
      rawEq(fm.pool_quantity, XCP69.POOL_QUANTITY) &&
      rawEq(fm.quantity_by_price, XCP69.QUANTITY_BY_PRICE) &&
      rawEq(fm.price, XCP69.PRICE) &&
      rawEq(fm.max_mint_per_address, XCP69.MAX_MINT_PER_ADDRESS) &&
      rawEq(fm.max_mint_per_tx, XCP69.MAX_MINT_PER_TX) &&
      rawEq(fm.premint_quantity, 0n) &&
      rawEq(fm.minted_asset_commission_int != null ? fm.minted_asset_commission_int : (fm.minted_asset_commission != null ? fm.minted_asset_commission : 0), 0n) && // stealth-premine trap
      bool(fm.lock_quantity) && bool(fm.lock_description) && bool(fm.divisible) &&
      !bool(fm.burn_payment) &&
      asset.length > 0 && !asset.startsWith('A') && // named assets only (no numeric A… names)
      (big(fm.start_block) || 0n) > 0n &&
      rawEq(fm.end_block, 0n)
    );
  }

  // Pre-announcement clause: the launch confirmed STRICTLY before its start (consensus doesn't require
  // this; it guarantees a mint-proof announcement window). `announceBlock` = NEW_FAIRMINTER event block.
  function announcedBeforeStart(fm, announceBlock) {
    const start = big(fm.start_block), ann = big(announceBlock), bi = big(fm.block_index);
    if (start == null) return false;
    if (fm.confirmed === false || (bi != null && bi >= MEMPOOL_BLOCK_INDEX)) return true; // unconfirmed can't have opened
    if (ann != null) return start > ann;
    return bi != null ? start > bi : false; // fallback to (possibly-rewritten) row block_index
  }
  // Exact mint window. While pending/open the row is trustworthy (== start+1000); once closed core may
  // have rewritten the deadline on early sellout, so verify against the ORIGINAL composed deadline.
  function windowExact(fm, originalDeadline) {
    const start = big(fm.start_block), dl = big(fm.status === 'closed' && originalDeadline != null ? originalDeadline : fm.soft_cap_deadline_block);
    if (start == null || dl == null) return false;
    return dl === start + XCP69.DEADLINE_BLOCKS;
  }
  // Full predicate: params + both timing clauses. Pass the immutable NEW_FAIRMINTER event values.
  function isXcp69(fm, opts) {
    opts = opts || {};
    return xcp69Params(fm) && announcedBeforeStart(fm, opts.announceBlock) && windowExact(fm, opts.originalDeadline);
  }

  // Lifecycle phase. Both success and failure end at status "closed"; a seeded TOKEN/XCP pool is the oracle.
  function launchPhase(fm, hasPool) {
    if (!fm) return 'unknown';
    if (fm.status === 'pending') return 'scheduled';
    if (fm.status === 'open') return 'minting';
    if (fm.status === 'closed') return hasPool ? 'graduated' : 'refunded';
    return 'unknown';
  }
  // Mint progress toward the soft cap (all-or-nothing) as a 0..1 fraction and a percent.
  function progress(fm) {
    const earned = big(fm && fm.earned_quantity) || 0n; // null when no mints yet
    if (XCP69.SOFT_CAP === 0n) return { earned, pct: 0 };
    const pct = Number((earned * 10000n) / XCP69.SOFT_CAP) / 100; // 2-dp percent without float overflow
    return { earned, pct: Math.min(100, pct) };
  }

  const API = { XCP69, MEMPOOL_BLOCK_INDEX, parseLossless, big, rawEq, fromSats, xcp69Params, announcedBeforeStart, windowExact, isXcp69, launchPhase, progress };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; // Node (regression tests)
  if (typeof window !== 'undefined') window.WonderXcp69 = API;               // Browser (Terminal)
})(this);
