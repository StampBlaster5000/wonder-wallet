/**
 * Wonder Wallet — portable key & account engine (Phase 3). Browser-only.
 *
 * SECURITY CARDINAL RULE: seeds and private keys exist ONLY here, in memory,
 * only while unlocked. They are NEVER sent to the server, never logged. The
 * server only ever receives public addresses (for the read layer).
 *
 * Built on audited, minimal-dependency crypto (paulmillr @scure / @noble),
 * exactly per SPEC §4 ("minimal/audited dependencies, no remote code").
 * Bundled locally with esbuild → served same-origin (no CDN, CSP-safe).
 */
import { generateMnemonic as genM, mnemonicToSeedSync, validateMnemonic as valM } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { HDKey } from '@scure/bip32';
import { CW_WORDS } from './cw-words.js';
import * as btc from '@scure/btc-signer';
import { secp256k1 } from '@noble/curves/secp256k1';
import { ed25519 } from '@noble/curves/ed25519';
import { keccak_256 } from '@noble/hashes/sha3';
import { sha256 } from '@noble/hashes/sha256';
import { sha512 } from '@noble/hashes/sha512';
import { hmac } from '@noble/hashes/hmac';
import { argon2id } from '@noble/hashes/argon2';
import { base58, base58check, base64, hex } from '@scure/base';
import { concatBytes } from '@noble/hashes/utils';
import { Transaction as EvmTx } from 'micro-eth-signer';

const enc = new TextEncoder();
const b58check = base58check(sha256);

// ── BIP-39 mnemonic ──────────────────────────────────────────────────────────
function generateMnemonic(words = 24) {
  const strength = words === 24 ? 256 : 128; // 24w=256 bits, 12w=128 bits
  return genM(wordlist, strength);
}
const validateMnemonic = (m) => valM(m, wordlist);

// ── Address derivation helpers ───────────────────────────────────────────────
function ethAddress(privKey) {
  const pub = secp256k1.getPublicKey(privKey, false).slice(1); // uncompressed, drop 0x04
  const addr = hex.encode(keccak_256(pub).slice(-20));
  // EIP-55 checksum: keccak of the lowercase hex string (as ASCII bytes)
  const h = hex.encode(keccak_256(enc.encode(addr)));
  let out = '0x';
  for (let i = 0; i < addr.length; i++) out += parseInt(h[i], 16) >= 8 ? addr[i].toUpperCase() : addr[i];
  return out;
}
function toWIF(privKey, network = 'mainnet') {
  const payload = new Uint8Array(34);
  payload[0] = network === 'testnet' ? 0xEF : 0x80; payload.set(privKey, 1); payload[33] = 0x01; // version + compressed flag
  return b58check.encode(payload);
}
function fromWIF(wif) {
  const dec = b58check.decode(wif);
  if (dec[0] !== 0x80) throw new Error('not_mainnet_wif');          // SECURITY (audit L1): reject non-mainnet/garbage
  if (dec.length !== 34 && dec.length !== 33) throw new Error('bad_wif_length');
  return dec.slice(1, 33); // drop version + (optional) compression flag
}

// ── Imported keys (WIF) — a standalone private key restoring a specific address, NOT derived
// from the seed. Signs via a plain {publicKey, privateKey} node (same shape btc-signer needs). ──
function importedNode(wif) {
  const priv = fromWIF(wif);
  return { privateKey: priv, publicKey: secp256k1.getPublicKey(priv, true) };
}
// The four BTC addresses a WIF's keypair maps to (the user picks / recognises their address).
function importedAddresses(wif) {
  const node = importedNode(wif);
  const out = {};
  for (const type of Object.keys(BTC_PATHS)) out[type] = { address: btcFromPub(node.publicKey, type) };
  return out;
}

// ── SLIP-0010 ed25519 (Solana) — all levels hardened ─────────────────────────
function ed25519Master(seed) {
  const I = hmac(sha512, enc.encode('ed25519 seed'), seed);
  return { key: I.slice(0, 32), chain: I.slice(32) };
}
function ed25519CKD(node, hardenedIndex) {
  const data = new Uint8Array(1 + 32 + 4);
  data[0] = 0; data.set(node.key, 1);
  new DataView(data.buffer).setUint32(33, (hardenedIndex | 0x80000000) >>> 0, false);
  const I = hmac(sha512, node.chain, data);
  return { key: I.slice(0, 32), chain: I.slice(32) };
}
function solDerive(seed, path) {
  let node = ed25519Master(seed);
  for (const seg of path.replace(/^m\//, '').split('/')) node = ed25519CKD(node, parseInt(seg, 10));
  return node.key;
}
function solAddress(priv) { return base58.encode(ed25519.getPublicKey(priv)); }

// ── Network selection ────────────────────────────────────────────────────────
// Testnet is strictly additive: mainnet is the default everywhere and its output
// is byte-identical to before. Testnet uses BIP-44 coin type 1' (a DIFFERENT set
// of derived keys — testnet addresses can NEVER collide with mainnet) plus the
// testnet address encoding (tb1…/m…/2…). ETH & SOL reuse the SAME key on their
// testnets (Sepolia / devnet) — only the network endpoint changes — so their
// address is identical across networks by design.
const btcNet = (network) => (network === 'testnet' ? btc.TEST_NETWORK : btc.NETWORK);

// ── Counterparty / Counterwallet / FreeWallet legacy passphrase (Electrum-v1 mnemonic) ──────────────
// NOT BIP-39. The 12-word passphrase decodes (1626-word list) → a 16-byte seed → BIP-32 → legacy
// P2PKH (1…) at m/0'/0/i — this is what Counterwallet, FreeWallet, XCP Chrome wallet, etc. use, and is
// where OG Counterparty / Stamps assets live. Verified byte-for-byte against Counterwallet's own test
// fixtures ("voice flame certainly…" → 1F2MFgLaQNLCTFCMWhffEG43GtxPxu6KWM); see selfTest.cwLegacy.
const CW_N = 1626;
const cwMod = (a, b) => ((a % b) + b) % b;
const cwWords = (passphrase) => String(passphrase || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
// Strip an optional leading 'old' (13-word legacy-sweep variant) → the 12 payload words.
function cwPayload(passphrase) { const w = cwWords(passphrase); return (w.length === 13 && w[0] === 'old') ? w.slice(1) : w; }
// True if every word is in the Electrum-v1 list and the count is 12 — used to route restore/import.
function isCwPhrase(passphrase) { const w = cwPayload(passphrase); return w.length === 12 && w.every((x) => CW_WORDS.indexOf(x) !== -1); }
// The Electrum-v1 mn_decode: 12 words → 32-char hex seed (16 bytes).
function cwSeedHex(passphrase) {
  const w = cwPayload(passphrase);
  if (!w.length || w.length % 3 !== 0) throw new Error('cw_bad_length');
  let out = '';
  for (let i = 0; i < w.length / 3; i++) {
    const i1 = CW_WORDS.indexOf(w[3 * i]), i2 = CW_WORDS.indexOf(w[3 * i + 1]), i3 = CW_WORDS.indexOf(w[3 * i + 2]);
    if (i1 < 0 || i2 < 0 || i3 < 0) throw new Error('cw_bad_word');
    const w1 = i1, w2 = i2 % CW_N, w3 = i3 % CW_N;
    const x = w1 + CW_N * cwMod(w2 - w1, CW_N) + CW_N * CW_N * cwMod(w3 - w2, CW_N);
    out += ('0000000' + (x >>> 0).toString(16)).slice(-8);
  }
  return out;
}
// Derive the legacy addresses + keys a Counterwallet/FreeWallet passphrase controls (m/0'/0/i, P2PKH).
// Returns [{ index, path, address, wif, pub }] — WIFs are compressed, matching Counterwallet.
function cwDeriveAddrs(passphrase, start = 0, count = 10, network = 'mainnet') {
  const master = HDKey.fromMasterSeed(hex.decode(cwSeedHex(passphrase)));
  const net = btcNet(network);
  const out = [];
  for (let i = start; i < start + count; i++) {
    const node = master.derive("m/0'/0/" + i);
    out.push({ index: i, path: "m/0'/0/" + i, address: btc.p2pkh(node.publicKey, net).address, wif: toWIF(node.privateKey, network), pub: hex.encode(node.publicKey) });
  }
  return out;
}

// ── Bitcoin address (all four types) from an HD node ─────────────────────────
function btcFromPub(pub, type, network = 'mainnet') {
  const net = btcNet(network);
  if (type === 'legacy') return btc.p2pkh(pub, net).address;
  if (type === 'nativeSegwit') return btc.p2wpkh(pub, net).address;
  if (type === 'nestedSegwit') return btc.p2sh(btc.p2wpkh(pub, net), net).address;
  if (type === 'taproot') return btc.p2tr(pub.slice(1), undefined, net).address; // x-only internal key (BIP86)
  throw new Error('unknown btc type');
}
const BTC_PATHS = {
  nativeSegwit: (a, i) => `m/84'/0'/${a}'/0/${i}`,
  legacy: (a, i) => `m/44'/0'/${a}'/0/${i}`,
  taproot: (a, i) => `m/86'/0'/${a}'/0/${i}`,
  nestedSegwit: (a, i) => `m/49'/0'/${a}'/0/${i}`,
};
// Testnet paths — BIP-44 coin type 1' (standard for all Bitcoin testnets/signet).
const BTC_PATHS_TESTNET = {
  nativeSegwit: (a, i) => `m/84'/1'/${a}'/0/${i}`,
  legacy: (a, i) => `m/44'/1'/${a}'/0/${i}`,
  taproot: (a, i) => `m/86'/1'/${a}'/0/${i}`,
  nestedSegwit: (a, i) => `m/49'/1'/${a}'/0/${i}`,
};
const btcPaths = (network) => (network === 'testnet' ? BTC_PATHS_TESTNET : BTC_PATHS);

// ── Counterwallet seed as a native account (Level B) ────────────────────────────────────────────────
// A restored Counterwallet/FreeWallet passphrase is stored as the "mnemonic". We detect it (CW-valid AND
// NOT a valid BIP-39 mnemonic, so genuine BIP-39 seeds are NEVER misread) and derive from the 16-byte CW
// seed, overriding only the LEGACY path to m/0'/0/account so the 1… addresses match Counterwallet exactly
// (that's where the user's assets are). All other types (segwit/taproot/nested + ETH + SOL) derive fresh
// from the same seed → the full multi-chain Wonder experience going forward.
function isCwSeed(mnemonic) { try { return isCwPhrase(mnemonic) && !valM(mnemonic, wordlist); } catch (_) { return false; } }
function masterSeed(mnemonic, passphrase) { return isCwSeed(mnemonic) ? hex.decode(cwSeedHex(mnemonic)) : mnemonicToSeedSync(mnemonic, passphrase); }
function btcPathStr(mnemonic, network, type, account, index) {
  if (type === 'legacy' && isCwSeed(mnemonic)) return "m/0'/0/" + account; // Counterwallet legacy — assets live here
  return btcPaths(network)[type](account, index);
}

/** Derive display addresses (NO secrets) for one account index across all chains. */
function deriveAccounts(mnemonic, passphrase = '', account = 0, index = 0, network = 'mainnet') {
  const seed = masterSeed(mnemonic, passphrase);
  const root = HDKey.fromMasterSeed(seed);
  const bitcoin = {};
  for (const type of Object.keys(btcPaths(network))) {
    const path = btcPathStr(mnemonic, network, type, account, index);
    bitcoin[type] = { address: btcFromPub(root.derive(path).publicKey, type, network), path };
  }
  // ETH & SOL: same key on their testnets — only the network endpoint changes.
  const ethPath = `m/44'/60'/${account}'/0/${index}`;
  const ethNode = root.derive(ethPath);
  const ethereum = { address: ethAddress(ethNode.privateKey), path: ethPath };
  const solPath = `m/44'/501'/${account}'/0'`;
  const solana = { address: solAddress(solDerive(seed, solPath)), path: solPath };
  seed.fill(0);
  return { account, index, network, bitcoin, ethereum, solana };
}

/** Reveal secrets for one account (password-gated by the caller). */
function deriveSecrets(mnemonic, passphrase = '', account = 0, index = 0, network = 'mainnet') {
  const seed = masterSeed(mnemonic, passphrase);
  const root = HDKey.fromMasterSeed(seed);
  const out = { bitcoin: {}, ethereum: null, solana: null, network };
  for (const type of Object.keys(btcPaths(network))) {
    const path = btcPathStr(mnemonic, network, type, account, index);
    const node = root.derive(path);
    out.bitcoin[type] = { address: btcFromPub(node.publicKey, type, network), wif: toWIF(node.privateKey, network), path };
  }
  const e = root.derive(`m/44'/60'/${account}'/0/${index}`);
  out.ethereum = { address: ethAddress(e.privateKey), privateKey: '0x' + hex.encode(e.privateKey) };
  const sp = solDerive(seed, `m/44'/501'/${account}'/0'`);
  out.solana = { address: solAddress(sp), secretKey: base58.encode(new Uint8Array([...sp, ...ed25519.getPublicKey(sp)])) };
  seed.fill(0);
  return out;
}

/** Custom derivation path (OG recovery) → address for a given chain. */
function deriveCustom(mnemonic, passphrase, path, chain = 'bitcoin', btcType = 'legacy') {
  const seed = masterSeed(mnemonic, passphrase);
  if (chain === 'solana') {
    // SECURITY (audit L2): SLIP-0010 ed25519 is all-hardened; silently hardening a
    // non-hardened segment would derive a DIFFERENT key than other wallets → "lost" funds.
    const segs = path.replace(/^m\//, '').split('/').filter(Boolean);
    if (!segs.every((s) => s.endsWith("'") || s.endsWith('h'))) { seed.fill(0); throw new Error('solana_path_must_be_all_hardened'); }
    const a = solAddress(solDerive(seed, path)); seed.fill(0); return a;
  }
  const node = HDKey.fromMasterSeed(seed).derive(path);
  const a = chain === 'ethereum' ? ethAddress(node.privateKey) : btcFromPub(node.publicKey, btcType);
  seed.fill(0);
  return a;
}

// Derive the first `count` receiving (or change) addresses from an ACCOUNT-level extended pubkey —
// given as a raw (compressed-or-uncompressed pubkey, chaincode) pair from a hardware device. Used to
// scan a Ledger account's whole address chain (it hands out a fresh receiving address each time), so
// we can surface balances/assets that live beyond index 0. Public (CKDpub) derivation — no secrets.
function deriveReceiveAddrs(pubHex, chainCodeHex, type = 'nativeSegwit', count = 20, chainIndex = 0) {
  let pub = hex.decode(String(pubHex).replace(/^0x/, ''));
  if (pub.length !== 33) pub = secp256k1.ProjectivePoint.fromHex(pub).toRawBytes(true); // compress if uncompressed (65B)
  const cc = hex.decode(String(chainCodeHex).replace(/^0x/, ''));
  // Serialize a standard mainnet xpub. depth/parent-fingerprint/child-index are cosmetic — BIP32 public
  // child derivation depends only on the parent pubkey + chaincode, so a synthetic header derives correctly.
  const raw = concatBytes(new Uint8Array([0x04, 0x88, 0xb2, 0x1e]), new Uint8Array([0]), new Uint8Array([0, 0, 0, 0]), new Uint8Array([0, 0, 0, 0]), cc, pub);
  const acct = HDKey.fromExtendedKey(base58check(sha256).encode(raw));
  const chain = acct.deriveChild(chainIndex);
  const out = [];
  for (let i = 0; i < count; i++) {
    const node = chain.deriveChild(i);
    out.push({ index: i, address: btcFromPub(node.publicKey, type), path: `${chainIndex}/${i}`, pub: hex.encode(node.publicKey) });
  }
  return out;
}

// ── Bitcoin send / PSBT / fees (Phase 5) — P2WPKH, proven vs BIP-143 ─────────
// vbytes estimate for a P2WPKH spend.
// Per-input vbyte weight by source address type (P2PKH legacy is ~2× a segwit input).
const IN_VB = { legacy: 148, nestedSegwit: 91, nativeSegwit: 68, taproot: 58 };
// WW-C15: serialized vbytes of ONE output by its script type — value(8) + scriptLen varint(1) + script.
// P2WPKH=31, P2SH=32, P2PKH=34, P2WSH/P2TR=43. A flat 31 (the old assumption) UNDERFUNDS any send to a
// P2TR/P2WSH/legacy recipient, so the broadcast feerate falls below what the user set.
const OUT_VB = { legacy: 34, nestedSegwit: 32, nativeSegwit: 31, taproot: 43 };
function outVbForAddr(addr, network = 'mainnet') {
  try { const spk = btc.OutScript.encode(btc.Address(btcNet(network)).decode(addr)); return 8 + (spk.length < 253 ? 1 : 3) + spk.length; }
  catch (_) { return 34; } // conservative fallback (over-, never under-estimate) if the address won't parse
}
// `outs` may be an output COUNT (back-compat: assumes P2WPKH 31 vB each) OR an ARRAY of per-output vB sizes.
function estimateVsize(nIn, outs, type = 'nativeSegwit') {
  const outVb = Array.isArray(outs) ? outs.reduce((a, b) => a + b, 0) : outs * 31;
  return Math.ceil(nIn * (IN_VB[type] || 68) + outVb + 11);
}

/** Asset-safe coin selection (caller passes ONLY spendable UTXOs). Largest-first. */
// recipVb/changeVb: the real vbyte size of the recipient + change outputs (WW-C15). Default 31 (P2WPKH)
// keeps legacy callers byte-for-byte identical; buildSend/buildUnsignedSend/buildHwSend pass true sizes.
function selectUtxos(utxos, targetSats, feeRate, sendMax, type = 'nativeSegwit', recipVb = 31, changeVb = 31) {
  const sorted = [...utxos].sort((a, b) => b.value - a.value);
  if (sendMax) {
    const totalIn = sorted.reduce((a, u) => a + u.value, 0);
    const fee = estimateVsize(sorted.length, [recipVb], type) * feeRate; // send-max: recipient only, no change
    if (totalIn <= fee) throw new Error('insufficient_funds');
    return { selected: sorted, totalIn, fee: Math.ceil(fee), amount: totalIn - Math.ceil(fee), change: 0 };
  }
  const selected = []; let totalIn = 0;
  for (const u of sorted) {
    selected.push(u); totalIn += u.value;
    const fee = Math.ceil(estimateVsize(selected.length, [recipVb, changeVb], type) * feeRate);
    if (totalIn >= targetSats + fee) return { selected, totalIn, fee, amount: targetSats, change: totalIn - targetSats - fee };
  }
  throw new Error('insufficient_funds');
}

// btc-signer payment object for an address type (carries script + redeemScript/tapInternalKey).
function btcPayment(pub, type, network = 'mainnet') {
  const net = btcNet(network);
  if (type === 'legacy') return btc.p2pkh(pub, net);
  if (type === 'nestedSegwit') return btc.p2sh(btc.p2wpkh(pub, net), net);
  if (type === 'taproot') return btc.p2tr(pub.slice(1), undefined, net); // x-only internal key
  return btc.p2wpkh(pub, net);
}
// Add an input with the correct witness/redeem/tapKey/nonWitness fields for its address type.
// Legacy (P2PKH) is non-segwit → requires the FULL previous transaction (nonWitnessUtxo).
function addTypedInput(tx, u, type, p, sequence, prevTxs) {
  const base = { txid: hex.decode(u.txid), index: u.vout, sequence };
  if (type === 'legacy') {
    const ph = prevTxs && prevTxs[u.txid];
    if (!ph) throw new Error('missing_prevtx:' + u.txid);
    verifyLegacyPrevout(ph, u.txid, u.vout, u.value); // local verification: prevtx hashes + value match the claim
    tx.addInput({ ...base, nonWitnessUtxo: hex.decode(ph) });
  } else if (type === 'nestedSegwit') {
    tx.addInput({ ...base, witnessUtxo: { script: p.script, amount: BigInt(u.value) }, redeemScript: p.redeemScript });
  } else if (type === 'taproot') {
    tx.addInput({ ...base, witnessUtxo: { script: p.script, amount: BigInt(u.value) }, tapInternalKey: p.tapInternalKey });
  } else {
    tx.addInput({ ...base, witnessUtxo: { script: p.script, amount: BigInt(u.value) } });
  }
}

/**
 * Build (and optionally sign) a P2WPKH send. Returns signed txhex OR an
 * unsigned PSBT (base64) for hardware/co-signing. RBF on by default.
 */
function buildSend({ mnemonic, passphrase = '', account = 0, index = 0, type = 'nativeSegwit', wif = null, utxos, recipient, amountSats, feeRate, rbf = true, sendMax = false, sign = true, prevTxs = {}, network = 'mainnet' }) {
  const paths = btcPaths(network);
  if (!paths[type]) throw new Error('send_type_unsupported');
  const net = btcNet(network);
  let seed = null, node;
  if (wif) { node = importedNode(wif); } // imported key signs its own address (any of the 4 types)
  else { seed = masterSeed(mnemonic, passphrase); node = HDKey.fromMasterSeed(seed).derive(btcPathStr(mnemonic, network, type, account, index)); }
  const p = btcPayment(node.publicKey, type, network);
  const fromAddress = p.address;
  const recipVb = outVbForAddr(recipient, network), changeVb = OUT_VB[type] || 31; // WW-C15: size by real script type
  const sel = selectUtxos(utxos, amountSats, feeRate, sendMax, type, recipVb, changeVb);
  const seq = rbf ? 0xfffffffd : 0xffffffff;
  const tx = new btc.Transaction({});
  for (const u of sel.selected) addTypedInput(tx, u, type, p, seq, prevTxs);
  const outAmount = sendMax ? sel.amount : amountSats;
  tx.addOutputAddress(recipient, BigInt(outAmount), net); // throws on invalid recipient
  let change = sel.change;
  if (!sendMax && change >= 294) tx.addOutputAddress(fromAddress, BigInt(change), net); // change back to the same source type
  else change = 0; // dust change rolls into the fee

  const outVbs = change ? [recipVb, changeVb] : [recipVb];
  const result = { fromAddress, recipient, amountSats: outAmount, change, fee: sel.totalIn - outAmount - change, inputs: sel.selected.map((u) => ({ utxo: `${u.txid}:${u.vout}`, value: u.value })), totalIn: sel.totalIn };
  // local verification: re-read what we built before signing (or exporting the PSBT)
  verifyBuiltOutputs(tx, { recipient, outAmount, fromAddress, change, totalIn: sel.totalIn, feeRate, expectVsize: estimateVsize(sel.selected.length, outVbs, type), network });
  if (sign) {
    tx.sign(node.privateKey); tx.finalize();
    result.txhex = hex.encode(tx.extract());
    result.txid = tx.id;
    result.vsize = tx.vsize;
  } else {
    result.psbt = base64.encode(tx.toPSBT(0)); // unsigned PSBT for export
    result.vsize = estimateVsize(sel.selected.length, outVbs, type);
  }
  if (seed) seed.fill(0);
  return result;
}

// Build an UNSIGNED BTC send PSBT from a PUBLIC KEY only (no private key) — for connected external
// wallets (UniSat/OKX/Wonder) on the web Terminal: we compose here, the connected wallet signs. Same
// selection + change + local-verification as buildSend; keyless → the caller supplies pubkey + utxos.
function buildUnsignedSend({ pubkey, type = 'nativeSegwit', utxos, recipient, amountSats, feeRate, rbf = true, sendMax = false, prevTxs = {}, network = 'mainnet' }) {
  const paths = btcPaths(network);
  if (!paths[type]) throw new Error('send_type_unsupported');
  const net = btcNet(network);
  const pub = pubkey instanceof Uint8Array ? pubkey : hex.decode(String(pubkey).replace(/^0x/, ''));
  const p = btcPayment(pub, type, network);
  const fromAddress = p.address;
  const recipVb = outVbForAddr(recipient, network), changeVb = OUT_VB[type] || 31; // WW-C15
  const sel = selectUtxos(utxos, amountSats, feeRate, sendMax, type, recipVb, changeVb);
  const seq = rbf ? 0xfffffffd : 0xffffffff;
  const tx = new btc.Transaction({});
  for (const u of sel.selected) addTypedInput(tx, u, type, p, seq, prevTxs);
  const outAmount = sendMax ? sel.amount : amountSats;
  tx.addOutputAddress(recipient, BigInt(outAmount), net); // throws on invalid recipient
  let change = sel.change;
  if (!sendMax && change >= 294) tx.addOutputAddress(fromAddress, BigInt(change), net);
  else change = 0;
  const expectVsize = estimateVsize(sel.selected.length, change ? [recipVb, changeVb] : [recipVb], type);
  verifyBuiltOutputs(tx, { recipient, outAmount, fromAddress, change, totalIn: sel.totalIn, feeRate, expectVsize, network });
  return { psbt: base64.encode(tx.toPSBT(0)), fromAddress, recipient, amountSats: outAmount, change, fee: sel.totalIn - outAmount - change, vsize: expectVsize, inputs: sel.selected.map((u) => ({ utxo: `${u.txid}:${u.vout}`, value: u.value })), totalIn: sel.totalIn };
}

// ── Hardware (Ledger) BTC send ───────────────────────────────────────────────
// Build an UNSIGNED, device-annotated PSBT for a P2WPKH send from a Ledger address, then finalize it
// with the device's partial signatures. The wallet holds NO keys — the Ledger derives + signs; we only
// assemble the tx (with BIP32 derivations so the device recognises its inputs + change) and, after the
// user approves on-device, apply the signatures. Native SegWit only for v1.
function bipPathArr(str) {
  return String(str).replace(/^m\//, '').split('/').filter(Boolean).map((p) => {
    const hard = /['h]$/.test(p); const n = parseInt(p.replace(/['h]$/, ''), 10);
    return (hard ? (n + 0x80000000) : n) >>> 0;
  });
}
function buildHwSend({ utxos, recipient, amountSats, feeRate, sendMax = false, rbf = true, mfp, accountPath, sourcePath, sourcePub, type = 'nativeSegwit' }) {
  if (type !== 'nativeSegwit') throw new Error('hw_send_type_unsupported'); // P2WPKH only for v1
  const fpr = parseInt(String(mfp).replace(/^0x/, ''), 16) >>> 0;
  const recipVb = outVbForAddr(recipient), changeVb = OUT_VB[type] || 31; // WW-C15 (source is P2WPKH; recipient may not be)
  const sel = selectUtxos(utxos, amountSats, feeRate, sendMax, type, recipVb, changeVb);
  const seq = rbf ? 0xfffffffd : 0xffffffff;
  const tx = new btc.Transaction({});
  for (const u of sel.selected) {
    const pub = hex.decode(String(u.pub || sourcePub).replace(/^0x/, ''));
    const p = btcPayment(pub, type);
    tx.addInput({
      txid: hex.decode(u.txid), index: u.vout, sequence: seq,
      witnessUtxo: { script: p.script, amount: BigInt(u.value) },
      bip32Derivation: [[pub, { fingerprint: fpr, path: bipPathArr(accountPath + '/' + (u.path || sourcePath)) }]],
    });
  }
  const outAmount = sendMax ? sel.amount : amountSats;
  tx.addOutputAddress(recipient, BigInt(outAmount)); // throws on invalid recipient
  let change = sel.change;
  if (!sendMax && change >= 294) {
    const spub = hex.decode(String(sourcePub).replace(/^0x/, ''));
    const sp = btcPayment(spub, type);
    tx.addOutput({ script: sp.script, amount: BigInt(change), bip32Derivation: [[spub, { fingerprint: fpr, path: bipPathArr(accountPath + '/' + sourcePath) }]] }); // change back to source → device shows it as its own, not a send
  } else change = 0;
  return {
    psbt: base64.encode(tx.toPSBT(0)),
    fee: sel.totalIn - outAmount - change, change, amountSats: outAmount,
    vsize: estimateVsize(sel.selected.length, change ? [recipVb, changeVb] : [recipVb], type),
    inputs: sel.selected.map((u) => ({ utxo: `${u.txid}:${u.vout}`, value: u.value })), totalIn: sel.totalIn,
  };
}
// Apply the Ledger's partial signatures (entries: [[inputIndex, {pubkey, signature}]]) → finalized raw hex.
function finalizeHwSend(psbtB64, entries) {
  const tx = btc.Transaction.fromPSBT(base64.decode(psbtB64), { allowUnknownOutputs: true, allowUnknownInputs: true });
  for (const [idx, sig] of entries) {
    const toBytes = (v) => (v instanceof Uint8Array ? v : hex.decode(String(v).replace(/^0x/, '')));
    const sigBytes = toBytes(sig.signature);
    // Taproot key-path returns a 64-byte (65 with a non-default sighash) Schnorr sig → tapKeySig.
    // ECDSA (native-segwit / legacy) is a DER sig (~70-72 bytes) → partialSig with its pubkey.
    if (sigBytes.length === 64 || sigBytes.length === 65) tx.updateInput(idx, { tapKeySig: sigBytes });
    else tx.updateInput(idx, { partialSig: [[toBytes(sig.pubkey), sigBytes]] });
  }
  tx.finalize();
  return { txhex: hex.encode(tx.extract()), txid: tx.id, vsize: tx.vsize };
}
// Compute the txid of an already-signed raw transaction hex (e.g. when the Ledger lib finalizes for us).
function txidOf(txhex) {
  const tx = btc.Transaction.fromRaw(hex.decode(String(txhex).replace(/^0x/, '')), { allowUnknownOutputs: true, allowUnknownInputs: true, allowLegacyWitnessUtxo: true, disableScriptCheck: true });
  return tx.id;
}

/**
 * Sign a Counterparty-composed PSBT (Phase 6). CP v2 returns the PSBT plus
 * inputs_values + lock_scripts (it omits witnessUtxo), so we enrich each input
 * then sign with the BIP-143-proven primitive. Native SegWit source for now.
 */
function signRawCp(psbtB64, inputsValues, lockScripts, node, type, prevTxs = {}) {
  const tx = btc.Transaction.fromPSBT(base64.decode(psbtB64), { allowUnknownOutputs: true, allowUnknownInputs: true });
  const p = btcPayment(node.publicKey, type);
  for (let i = 0; i < tx.inputsLength; i++) {
    if (type === 'legacy') {
      const inp = tx.getInput(i);
      const dtxid = hex.encode(inp.txid); // btc-signer stores/returns txid in display order
      const ph = prevTxs[dtxid];
      if (!ph) throw new Error('missing_prevtx:' + dtxid);
      verifyLegacyPrevout(ph, dtxid, inp.index, inputsValues && inputsValues[i]); // local verification vs the CP-claimed input value
      tx.updateInput(i, { nonWitnessUtxo: hex.decode(ph) });
    } else if (type === 'nestedSegwit') {
      tx.updateInput(i, { witnessUtxo: { script: hex.decode(lockScripts[i]), amount: BigInt(inputsValues[i]) }, redeemScript: p.redeemScript });
    } else if (type === 'taproot') {
      tx.updateInput(i, { witnessUtxo: { script: hex.decode(lockScripts[i]), amount: BigInt(inputsValues[i]) }, tapInternalKey: p.tapInternalKey });
    } else {
      tx.updateInput(i, { witnessUtxo: { script: hex.decode(lockScripts[i]), amount: BigInt(inputsValues[i]) } });
    }
  }
  tx.sign(node.privateKey);
  tx.finalize();
  return { txhex: hex.encode(tx.extract()), txid: tx.id, vsize: tx.vsize };
}

// The prevout (txid:vout) of every input in a composed PSBT — so the client can fetch
// the full previous transactions (nonWitnessUtxo) needed to sign a LEGACY source.
// The hash/witness-program of an address, as hex — used to verify a Counterparty send's RECIPIENT:
// CP encodes the destination's hash160 / witness-program verbatim inside the message `data`, so if a
// tampered proxy swaps the recipient, the user's own destination hash will be absent from the data.
function addrHash(address) {
  try {
    const o = btc.Address().decode(String(address));
    const h = o.hash || o.pubkey || o.pubKey || o.data || null;
    return h ? hex.encode(h) : null;
  } catch (_) { return null; }
}

// ── Local transaction verification (defence-in-depth, per XCP Wallet v0.5.2) ──
// Our read layer is a stateless proxy to public APIs (mempool / CP / stampchain). Before we
// SIGN we independently re-verify what we're about to sign, so a compromised or spoofing proxy
// cannot trick the signer into over-paying fees or spending the wrong coins.

// LEGACY (P2PKH) sighash does NOT commit to input amounts → a lying proxy could understate/inflate
// a legacy input's value. Require the FULL previous tx and cross-check it (a) hashes to the claimed
// txid and (b) its output[vout] value equals the claimed value. (SegWit amounts are BIP143-committed.)
function verifyLegacyPrevout(prevHex, txid, vout, claimedValue) {
  let ptx;
  try { ptx = btc.Transaction.fromRaw(hex.decode(String(prevHex).replace(/^0x/, '')), { allowUnknownOutputs: true, allowLegacyWitnessUtxo: true, disableScriptCheck: true }); }
  catch (_) { throw new Error('prevtx_undecodable:' + txid); }
  if (ptx.id !== txid) throw new Error('prevtx_mismatch:' + txid); // proxy handed the wrong previous transaction
  let o; try { o = ptx.getOutput(vout); } catch (_) { o = null; }
  if (!o || o.amount == null) throw new Error('prevout_missing:' + txid + ':' + vout);
  if (claimedValue != null && o.amount !== BigInt(claimedValue)) throw new Error('prevout_value_mismatch:' + txid + ':' + vout);
  return o.amount;
}

// Independently re-read the outputs of a tx we just built and confirm it pays ONLY the intended
// recipient + our own change address, with a non-negative, sane fee — so a tampered UTXO set or a
// logic slip can't slip in a surprise output or an absurd fee before we sign.
function verifyBuiltOutputs(tx, { recipient, outAmount, fromAddress, change, totalIn, feeRate, expectVsize, network = 'mainnet' }) {
  let sawRecipient = false, sawChange = false, sumOut = 0n;
  for (let i = 0; i < tx.outputsLength; i++) {
    const o = tx.getOutput(i); sumOut += o.amount;
    let a = null; try { a = btc.Address(btcNet(network)).encode(btc.OutScript.decode(o.script)); } catch (_) {}
    if (!sawRecipient && a === recipient && o.amount === BigInt(outAmount)) sawRecipient = true;
    else if (!sawChange && a === fromAddress && o.amount === BigInt(change)) sawChange = true;
    else throw new Error('verify_unexpected_output:' + (a || 'unknown'));
  }
  if (!sawRecipient) throw new Error('verify_recipient_missing');
  if (change > 0 && !sawChange) throw new Error('verify_change_missing');
  const fee = totalIn - Number(sumOut);
  if (fee < 0) throw new Error('verify_negative_fee');
  const ceiling = Math.max((feeRate || 1) * (expectVsize || 200) * 10, 50000); // generous: only catches gross anomalies, never normal sends
  if (fee > ceiling) throw new Error('verify_fee_too_high:' + fee);
}

// Decode a composed tx/PSBT's OUTPUTS so the client can verify a server-composed transaction
// pays only expected addresses (change back to source, user-entered recipients) before signing.
// WW-B18: `network` selects the address encoder (default mainnet, backward-compatible). On testnet the
// script → address encode MUST use TEST_NETWORK or every output/change renders as a mainnet bc1…/1…,
// which both misleads the Sign dialog and breaks address-equality verification against tb1… intents.
function decodeTxOutputs(psbtHexOrB64, network = 'mainnet') {
  const s = String(psbtHexOrB64).replace(/^0x/, '');
  const bytes = /^[0-9a-fA-F]+$/.test(s) ? hex.decode(s) : base64.decode(s);
  let tx;
  try { tx = btc.Transaction.fromPSBT(bytes, { allowUnknownOutputs: true, allowUnknownInputs: true }); }
  catch (_) { tx = btc.Transaction.fromRaw(bytes, { allowUnknownOutputs: true, allowLegacyWitnessUtxo: true, disableScriptCheck: true }); }
  const net = btcNet(network);
  const out = [];
  for (let i = 0; i < tx.outputsLength; i++) {
    const o = tx.getOutput(i);
    const script = o.script || new Uint8Array(0);
    let address = null; const opReturn = script[0] === 0x6a;
    if (!opReturn) { try { address = btc.Address(net).encode(btc.OutScript.decode(script)); } catch (_) { address = null; } }
    out.push({ address, value: o.amount != null ? Number(o.amount) : 0, opReturn });
  }
  return out;
}

function psbtInputs(psbtHexOrB64) {
  const s = String(psbtHexOrB64).replace(/^0x/, '');
  const bytes = /^[0-9a-fA-F]+$/.test(s) ? hex.decode(s) : base64.decode(s);
  const tx = btc.Transaction.fromPSBT(bytes, { allowUnknownOutputs: true, allowUnknownInputs: true });
  const out = [];
  for (let i = 0; i < tx.inputsLength; i++) { const inp = tx.getInput(i); out.push({ txid: hex.encode(inp.txid), index: inp.index }); }
  return out;
}

// A PSBT input's nonWitnessUtxo can be RAW bytes (freshly attached) OR an already-decoded tx object
// (after fromPSBT round-trips it) — return the referenced prevout {script, amount} for either form.
function nwOut(nw, index) {
  if (!nw) return null;
  try {
    if (nw instanceof Uint8Array) { const ptx = btc.Transaction.fromRaw(nw, { allowUnknownOutputs: true, allowLegacyWitnessUtxo: true, disableScriptCheck: true }); return ptx.getOutput(index); }
    if (nw.outputs && nw.outputs[index]) return nw.outputs[index];
  } catch (_) {}
  return null;
}

// Full decode of a PSBT for the dApp-provider Sign dialog (clear-signing): each input's prevout
// address + value + requested sighash, plus the outputs. Keyless + pure (like decodeTxOutputs) — the
// approval UI adds "mine?" (address match) and asset tags (coin-control) on top before summarizing.
function describePsbt(psbtHexOrB64, network = 'mainnet') {
  const s = String(psbtHexOrB64).replace(/^0x/, '');
  const bytes = /^[0-9a-fA-F]+$/.test(s) ? hex.decode(s) : base64.decode(s);
  const tx = btc.Transaction.fromPSBT(bytes, { allowUnknownOutputs: true, allowUnknownInputs: true });
  const net = btcNet(network); // WW-B18: encode prevout addresses for the ACTIVE network
  const inputs = [];
  for (let i = 0; i < tx.inputsLength; i++) {
    const inp = tx.getInput(i);
    let script = null, amount = null;
    if (inp.witnessUtxo) { script = inp.witnessUtxo.script; amount = inp.witnessUtxo.amount; }
    else { const o = nwOut(inp.nonWitnessUtxo, inp.index); if (o) { script = o.script; amount = o.amount; } }
    let address = null;
    if (script) { try { address = btc.Address(net).encode(btc.OutScript.decode(script)); } catch (_) {} }
    inputs.push({ txid: hex.encode(inp.txid), index: inp.index, address: address, value: amount != null ? Number(amount) : null, sighashType: inp.sighashType != null ? Number(inp.sighashType) : null });
  }
  return { inputs: inputs, outputs: decodeTxOutputs(psbtHexOrB64, network) };
}

// Sign a dApp-provided PSBT (provider `ww_signPsbt`). Signs ONLY the inputs that belong to us (or the
// explicit opts.toSignInputs indices), enforces the sighash allowlist (DEFAULT/ALL/ALL|ANYONECANPAY/
// SINGLE|ANYONECANPAY — reject NONE / bare SINGLE), and returns the PARTIALLY-signed PSBT (the site
// finalizes/combines) or a finalized tx if opts.autoFinalized. Keyless-relative (caller supplies the
// key), so it unit-tests without a session. Legacy inputs still require + cross-check the full prev-tx.
function signProviderPsbt(psbtHexOrB64, opts, mnemonic, passphrase = '', account = 0, index = 0, type = 'nativeSegwit', prevTxs = {}, wif = null, network = 'mainnet') {
  opts = opts || {};
  const paths = btcPaths(network);
  // `types`: the address types we're allowed to sign for. Default = the single connected type; the
  // paired Legacy+SegWit capability passes e.g. ['nativeSegwit','legacy'] so ONE pass can sign inputs
  // across the same-index pair (Counterparty marketplace / atomic-swap flow), opt-in + consented.
  const types = (Array.isArray(opts.types) && opts.types.length) ? opts.types : [type];
  for (const t of types) if (!paths[t]) throw new Error('provider_sign_type_unsupported:' + t);
  const SAFE = [0x00, 0x01, 0x81, 0x83];
  let seed = null;
  const wipe = () => { if (seed) seed.fill(0); };
  try {
    // One signer per allowed type (an imported WIF is a single address type).
    let signers;
    if (wif) { const n = importedNode(wif); signers = [{ t: type, node: n, p: btcPayment(n.publicKey, type, network) }]; }
    else { seed = masterSeed(mnemonic, passphrase); const root = HDKey.fromMasterSeed(seed); signers = types.map((t) => { const n = root.derive(btcPathStr(mnemonic, network, t, account, index)); return { t: t, node: n, p: btcPayment(n.publicKey, t, network) }; }); }
    const signerFor = (addr) => signers.find((sg) => sg.p.address === addr) || null;

    const s = String(psbtHexOrB64).replace(/^0x/, '');
    const bytes = /^[0-9a-fA-F]+$/.test(s) ? hex.decode(s) : base64.decode(s);
    const tx = btc.Transaction.fromPSBT(bytes, { allowUnknownOutputs: true, allowUnknownInputs: true });

    const inAddr = (inp) => {
      let script = inp.witnessUtxo && inp.witnessUtxo.script;
      if (!script) { const o = nwOut(inp.nonWitnessUtxo, inp.index); if (o) script = o.script; }
      if (!script) return null; try { return btc.Address(btcNet(network)).encode(btc.OutScript.decode(script)); } catch (_) { return null; }
    };

    let indices;
    if (Array.isArray(opts.toSignInputs) && opts.toSignInputs.length) {
      indices = opts.toSignInputs.map((x) => (typeof x === 'number' ? x : x.index)).filter((i) => Number.isInteger(i) && i >= 0 && i < tx.inputsLength);
    } else {
      indices = []; for (let i = 0; i < tx.inputsLength; i++) if (signerFor(inAddr(tx.getInput(i)))) indices.push(i);
    }
    if (!indices.length) throw new Error('no_signable_inputs');

    const chosen = {}; // input index -> signer
    for (const i of indices) {
      const inp = tx.getInput(i);
      const sg = signerFor(inAddr(inp));
      if (!sg) throw new Error('input_not_ours:' + i); // never sign an input none of our keys owns
      chosen[i] = sg;
      if (inp.sighashType != null && SAFE.indexOf(Number(inp.sighashType)) < 0) throw new Error('sighash_not_allowed:0x' + Number(inp.sighashType).toString(16));
      if (sg.t === 'legacy') { const d = hex.encode(inp.txid), ph = prevTxs[d]; if (!ph) throw new Error('missing_prevtx:' + d); verifyLegacyPrevout(ph, d, inp.index, null); tx.updateInput(i, { nonWitnessUtxo: hex.decode(ph) }); }
      else if (sg.t === 'nestedSegwit') tx.updateInput(i, { redeemScript: sg.p.redeemScript });
      else if (sg.t === 'taproot') tx.updateInput(i, { tapInternalKey: sg.p.tapInternalKey });
    }

    for (const i of indices) tx.signIdx(chosen[i].node.privateKey, i, SAFE);

    let result;
    if (opts.autoFinalized) { tx.finalize(); result = { txhex: hex.encode(tx.extract()), txid: tx.id, signed: indices }; }
    else { result = { psbt: base64.encode(tx.toPSBT(0)), signed: indices }; }
    wipe();
    return result;
  } catch (e) { wipe(); throw e; }
}

/**
 * Sign a fully-formed PSBT whose inputs already carry witnessUtxo (stampchain
 * SRC-20 / Stamp-art mints). Segwit sources sign directly; legacy needs prevTxs.
 */
function signStampPsbt(psbtHexOrB64, mnemonic, passphrase = '', account = 0, index = 0, type = 'nativeSegwit', prevTxs = {}, wif = null, network = 'mainnet') {
  if (!btcPaths(network)[type]) throw new Error('stamp_sign_type_unsupported');
  const s = String(psbtHexOrB64).replace(/^0x/, '');
  const bytes = /^[0-9a-fA-F]+$/.test(s) ? hex.decode(s) : base64.decode(s);
  let seed = null, node;
  if (wif) node = importedNode(wif);
  else { seed = masterSeed(mnemonic, passphrase); node = HDKey.fromMasterSeed(seed).derive(btcPathStr(mnemonic, network, type, account, index)); }
  const tx = btc.Transaction.fromPSBT(bytes, { allowUnknownOutputs: true, allowUnknownInputs: true });
  if (type === 'legacy') {
    for (let i = 0; i < tx.inputsLength; i++) {
      const inp = tx.getInput(i);
      const dtxid = hex.encode(inp.txid);
      const ph = prevTxs[dtxid]; if (ph) tx.updateInput(i, { nonWitnessUtxo: hex.decode(ph) });
    }
  }
  tx.sign(node.privateKey);
  tx.finalize();
  if (seed) seed.fill(0);
  return { txhex: hex.encode(tx.extract()), txid: tx.id, vsize: tx.vsize };
}

function signCpPsbt(psbtB64, inputsValues, lockScripts, mnemonic, passphrase = '', account = 0, index = 0, type = 'nativeSegwit', prevTxs = {}, wif = null, network = 'mainnet') {
  if (!btcPaths(network)[type]) throw new Error('cp_sign_type_unsupported');
  let seed = null, node;
  if (wif) node = importedNode(wif);
  else { seed = masterSeed(mnemonic, passphrase); node = HDKey.fromMasterSeed(seed).derive(btcPathStr(mnemonic, network, type, account, index)); }
  const r = signRawCp(psbtB64, inputsValues, lockScripts, node, type, prevTxs);
  if (seed) seed.fill(0);
  return r;
}

// ── BIP-322 simple message signing (P2WPKH) ──────────────────────────────────
function taggedHash(tag, msg) {
  const t = sha256(enc.encode(tag));
  return sha256(concatBytes(t, t, msg));
}
function bip322SignWithKey(message, privKey) {
  const pub = secp256k1.getPublicKey(privKey, true);
  const script = btc.p2wpkh(pub).script;
  const mhash = taggedHash('BIP0322-signed-message', enc.encode(message));

  // to_spend: output first (btc-signer locks outputs once an input is finalized),
  // then the null input with scriptSig = OP_0 PUSH32 <mhash>.
  const toSpend = new btc.Transaction({ version: 0, lockTime: 0, allowUnknownInputs: true, allowUnknownOutputs: true, allowLegacyWitnessUtxo: true, disableScriptCheck: true });
  toSpend.addOutput({ script, amount: 0n });
  toSpend.addInput({ txid: new Uint8Array(32), index: 0xffffffff, sequence: 0, finalScriptSig: concatBytes(new Uint8Array([0x00, 0x20]), mhash) });

  // to_sign: spends to_spend:0; one OP_RETURN output, value 0
  const toSign = new btc.Transaction({ version: 0, lockTime: 0, allowUnknownOutputs: true });
  toSign.addInput({ txid: hex.decode(toSpend.id), index: 0, sequence: 0, witnessUtxo: { script, amount: 0n } });
  toSign.addOutput({ script: new Uint8Array([0x6a]), amount: 0n });
  toSign.sign(privKey);
  toSign.finalize();

  const witness = toSign.getInput(0).finalScriptWitness; // [sig, pubkey]
  const parts = [new Uint8Array([witness.length])];
  for (const w of witness) parts.push(new Uint8Array([w.length]), w);
  return base64.encode(concatBytes(...parts));
}
function signMessageBIP322(message, mnemonic, passphrase = '', account = 0, index = 0, type = 'nativeSegwit') {
  if (type !== 'nativeSegwit') throw new Error('bip322_type_unsupported');
  const seed = masterSeed(mnemonic, passphrase);
  const node = HDKey.fromMasterSeed(seed).derive(BTC_PATHS.nativeSegwit(account, index));
  const sig = bip322SignWithKey(message, node.privateKey);
  seed.fill(0);
  return sig;
}

// Legacy "Bitcoin Signed Message" (BSM) — the classic P2PKH message signature every legacy verifier
// (bitcoin-core `verifymessage`, electrum, mempool.space) understands. Recoverable ECDSA over the
// magic-prefixed double-SHA256 of the message; header byte = 27 + recId (+4 for a compressed pubkey).
// This is the correct format for signing as a legacy 1… address (imported OG Counterparty keys).
function bsmSignWithKey(message, privKey, compressed = true) {
  const msgBytes = enc.encode(message);
  const L = msgBytes.length;
  let lenPrefix;
  if (L < 0xfd) lenPrefix = new Uint8Array([L]);
  else if (L <= 0xffff) lenPrefix = new Uint8Array([0xfd, L & 0xff, (L >> 8) & 0xff]);
  else lenPrefix = new Uint8Array([0xfe, L & 0xff, (L >> 8) & 0xff, (L >> 16) & 0xff, (L >>> 24) & 0xff]);
  const magic = concatBytes(new Uint8Array([0x18]), enc.encode('Bitcoin Signed Message:\n'), lenPrefix, msgBytes);
  const h = sha256(sha256(magic));
  const sig = secp256k1.sign(h, privKey); // noble: canonical (low-S), carries .recovery
  const header = 27 + sig.recovery + (compressed ? 4 : 0);
  return base64.encode(concatBytes(new Uint8Array([header]), sig.toCompactRawBytes()));
}
// Sign a message with an imported WIF, in the format its address type expects:
//   nativeSegwit (bc1q…) → BIP-322 · legacy (1…) → BSM. Returns { signature, format, address }.
function signMessageImported(message, importedId, type = 'nativeSegwit') {
  const wif = _importedWif(importedId);
  const node = importedNode(wif);
  const address = btcFromPub(node.publicKey, type);
  if (type === 'nativeSegwit') return { signature: bip322SignWithKey(message, node.privateKey), format: 'BIP-322', address };
  if (type === 'legacy') return { signature: bsmSignWithKey(message, node.privateKey, true), format: 'BSM', address };
  throw new Error('message_type_unsupported'); // taproot / nested: no standard verifiable scheme here
}

// ── EVM transactions (Phase 7) — EIP-1559, proven vs ethers ──────────────────
const pad32 = (x) => x.toLowerCase().replace(/^0x/, '').padStart(64, '0');
function erc20TransferData(to, amount) { return '0xa9059cbb' + pad32(to) + BigInt(amount).toString(16).padStart(64, '0'); }
function erc20ApproveData(spender, amount) { return '0x095ea7b3' + pad32(spender) + BigInt(amount).toString(16).padStart(64, '0'); }

// EIP-191 personal_sign (needed for the Emblem mint/unvault messages, Phase 7c).
function personalSignWithKey(message, privKey) {
  const msg = typeof message === 'string' ? enc.encode(message) : message;
  const prefix = enc.encode(`\x19Ethereum Signed Message:\n${msg.length}`);
  const hash = keccak_256(concatBytes(prefix, msg));
  const sig = secp256k1.sign(hash, privKey, { lowS: true });
  const r = sig.r.toString(16).padStart(64, '0');
  const s = sig.s.toString(16).padStart(64, '0');
  const v = (sig.recovery + 27).toString(16).padStart(2, '0');
  return '0x' + r + s + v;
}
function personalSign(message, mnemonic, passphrase = '', account = 0, index = 0) {
  const seed = masterSeed(mnemonic, passphrase);
  const node = HDKey.fromMasterSeed(seed).derive(`m/44'/60'/${account}'/0/${index}`);
  const sig = personalSignWithKey(message, node.privateKey);
  seed.fill(0);
  return sig;
}

function signEvm({ mnemonic, passphrase = '', account = 0, index = 0, to, valueWei = 0n, data = '0x', nonce, chainId, maxFeePerGas, maxPriorityFeePerGas, gasLimit }) {
  const seed = masterSeed(mnemonic, passphrase);
  const node = HDKey.fromMasterSeed(seed).derive(`m/44'/60'/${account}'/0/${index}`);
  const tx = EvmTx.prepare({
    type: 'eip1559', chainId: BigInt(chainId), nonce: BigInt(nonce),
    maxFeePerGas: BigInt(maxFeePerGas), maxPriorityFeePerGas: BigInt(maxPriorityFeePerGas),
    gasLimit: BigInt(gasLimit), to, value: BigInt(valueWei), data,
  });
  const signed = tx.signBy(node.privateKey);
  const raw = signed.toHex();
  const hash = '0x' + hex.encode(keccak_256(hex.decode(raw.slice(2))));
  seed.fill(0);
  return { raw, hash };
}

// ── EIP-712 typed-data (eth_signTypedData_v4) ────────────────────────────────
// Standard EIP-712 hash: keccak256(0x1901 ‖ domainSeparator ‖ hashStruct(primaryType, message)).
// Signed with the same secp256k1 key + r‖s‖v envelope as personal_sign. Pure — no keys here.
function eip712Digest(td) {
  const types = td.types || {};
  function deps(primary, found) {
    found = found || [];
    if (found.indexOf(primary) >= 0 || !types[primary]) return found;
    found.push(primary);
    for (const f of types[primary]) { const base = f.type.replace(/\[.*$/, ''); deps(base, found); }
    return found;
  }
  function encodeType(primary) {
    const d = deps(primary).filter((x) => x !== primary).sort();
    return [primary].concat(d).map((t) => t + '(' + (types[t] || []).map((f) => f.type + ' ' + f.name).join(',') + ')').join('');
  }
  const typeHash = (primary) => keccak_256(enc.encode(encodeType(primary)));
  function encodeData(primary, data) {
    const parts = [typeHash(primary)];
    for (const f of types[primary]) parts.push(encodeValue(f.type, data ? data[f.name] : undefined));
    return concatBytes(...parts);
  }
  const hashStruct = (primary, data) => keccak_256(encodeData(primary, data));
  function encodeValue(type, value) {
    if (types[type]) return keccak_256(encodeData(type, value || {})); // referenced struct
    const arr = type.match(/^(.*)\[(\d*)\]$/);
    if (arr) { const base = arr[1]; const items = (value || []).map((v) => encodeValue(base, v)); return keccak_256(items.length ? concatBytes(...items) : new Uint8Array(0)); }
    if (type === 'string') return keccak_256(enc.encode(String(value == null ? '' : value)));
    if (type === 'bytes') { const b = typeof value === 'string' ? hex.decode(value.replace(/^0x/, '')) : (value || new Uint8Array(0)); return keccak_256(b); }
    return atomicWord(type, value);
  }
  function atomicWord(type, value) {
    const w = new Uint8Array(32);
    if (type === 'bool') { w[31] = value ? 1 : 0; return w; }
    if (type === 'address') { const h = String(value || '').replace(/^0x/, '').padStart(40, '0'); w.set(hex.decode(h).slice(-20), 12); return w; }
    if (/^bytes\d+$/.test(type)) { const b = hex.decode(String(value || '').replace(/^0x/, '')); w.set(b.slice(0, 32), 0); return w; } // left-aligned
    if (/^u?int\d*$/.test(type)) { let v = BigInt(value == null ? 0 : value); if (v < 0n) v = (1n << 256n) + v; return hex.decode(v.toString(16).padStart(64, '0')); }
    return keccak_256(enc.encode(String(value == null ? '' : value))); // unknown → treat as string
  }
  const domainSep = hashStruct('EIP712Domain', td.domain || {});
  const structHash = hashStruct(td.primaryType, td.message || {});
  return keccak_256(concatBytes(new Uint8Array([0x19, 0x01]), domainSep, structHash));
}
function signTypedDataWithKey(td, privKey) {
  const digest = eip712Digest(td);
  const sig = secp256k1.sign(digest, privKey, { lowS: true });
  const r = sig.r.toString(16).padStart(64, '0');
  const s = sig.s.toString(16).padStart(64, '0');
  const v = (sig.recovery + 27).toString(16).padStart(2, '0');
  return '0x' + r + s + v;
}
function ethSignTypedData(typedData, account = 0) {
  const s = requireUnlocked();
  const td = typeof typedData === 'string' ? JSON.parse(typedData) : typedData;
  if (!td || !td.types || !td.primaryType) throw new Error('bad_typed_data');
  const seed = masterSeed(s.mnemonic, s.passphrase);
  const node = HDKey.fromMasterSeed(seed).derive(`m/44'/60'/${account}'/0/0`);
  const sig = signTypedDataWithKey(td, node.privateKey);
  seed.fill(0);
  return sig;
}

// ── Solana transactions (Phase 7b) — hand-rolled minimal serializer ──────────
const SYS_PROGRAM = new Uint8Array(32); // 11111111111111111111111111111111
const COMPUTE_BUDGET = base58.decode('ComputeBudget111111111111111111111111111111');
const TOKEN_PROGRAM = base58.decode('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ATA_PROGRAM = base58.decode('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

function compactU16(n) { const out = []; let v = n; for (;;) { let b = v & 0x7f; v >>= 7; if (v) out.push(b | 0x80); else { out.push(b); break; } } return new Uint8Array(out); }
function u32le(n) { const b = new Uint8Array(4); let v = n >>> 0; for (let i = 0; i < 4; i++) { b[i] = v & 0xff; v >>>= 8; } return b; }
function u64le(n) { const b = new Uint8Array(8); let v = BigInt(n); for (let i = 0; i < 8; i++) { b[i] = Number(v & 0xffn); v >>= 8n; } return b; }
const keyHex = (k) => hex.encode(k);

// Solana on-curve check for PDA derivation (a PDA must be OFF the ed25519 curve).
function isOnCurve(bytes) { try { ed25519.ExtendedPoint.fromHex(hex.encode(bytes)); return true; } catch { return false; } }
function findAta(owner, mint) {
  for (let bump = 255; bump >= 0; bump--) {
    const h = sha256(concatBytes(owner, TOKEN_PROGRAM, mint, new Uint8Array([bump]), ATA_PROGRAM, enc.encode('ProgramDerivedAddress')));
    if (!isOnCurve(h)) return h;
  }
  throw new Error('no_ata_bump');
}

// instrs: [{ programId:Uint8Array, keys:[{pubkey,isSigner,isWritable}], data:Uint8Array }]
function compileSolMessage(feePayer, instrs, blockhash) {
  const metas = new Map();
  const add = (pk, s, w) => { const k = keyHex(pk); const e = metas.get(k); if (e) { e.isSigner = e.isSigner || s; e.isWritable = e.isWritable || w; } else metas.set(k, { pubkey: pk, isSigner: s, isWritable: w }); };
  add(feePayer, true, true);
  for (const ix of instrs) { for (const km of ix.keys) add(km.pubkey, km.isSigner, km.isWritable); add(ix.programId, false, false); }
  const list = [...metas.values()];
  const grp = (m) => (m.isSigner && m.isWritable ? 0 : m.isSigner ? 1 : m.isWritable ? 2 : 3);
  list.sort((a, b) => grp(a) - grp(b)); // stable: feePayer stays first
  const keys = list.map((m) => m.pubkey);
  const idx = (pk) => keys.findIndex((k) => keyHex(k) === keyHex(pk));
  const header = new Uint8Array([
    list.filter((m) => m.isSigner).length,
    list.filter((m) => m.isSigner && !m.isWritable).length,
    list.filter((m) => !m.isSigner && !m.isWritable).length,
  ]);
  const parts = [header, compactU16(keys.length), ...keys, blockhash, compactU16(instrs.length)];
  for (const ix of instrs) {
    const acctIdx = ix.keys.map((km) => idx(km.pubkey));
    parts.push(new Uint8Array([idx(ix.programId)]), compactU16(acctIdx.length), new Uint8Array(acctIdx), compactU16(ix.data.length), ix.data);
  }
  return concatBytes(...parts);
}
function solSignTx(message, privKey) { const sig = ed25519.sign(message, privKey); return { tx: concatBytes(compactU16(1), sig, message), sig }; }

// Solana shortvec (compact-u16) decoder → [value, bytesRead]. Mirror of compactU16 (encoder).
function readCompactU16(bytes, offset = 0) {
  let val = 0, shift = 0, i = offset;
  for (;;) { const b = bytes[i]; i += 1; val |= (b & 0x7f) << shift; if ((b & 0x80) === 0) break; shift += 7; }
  return [val, i - offset];
}
function bytesEq(a, b) { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; }

// dApp-provider Solana signing (session-based). solSignMessage: ed25519 over arbitrary bytes.
function solSignMessage(msgB64, account = 0) {
  const s = requireUnlocked();
  const seed = masterSeed(s.mnemonic, s.passphrase);
  const priv = solDerive(seed, `m/44'/501'/${account}'/0'`);
  const sig = ed25519.sign(base64.decode(msgB64), priv);
  seed.fill(0);
  return base64.encode(sig);
}
// solSignTransaction: sign the message of a serialized [sigCount][sigs...][message] tx and place our
// signature in OUR required-signer slot (found by matching our pubkey) — never a slot that isn't ours.
function solSignTransaction(txB64, account = 0) {
  const s = requireUnlocked();
  const seed = masterSeed(s.mnemonic, s.passphrase);
  const priv = solDerive(seed, `m/44'/501'/${account}'/0'`);
  const pub = ed25519.getPublicKey(priv);
  const raw = base64.decode(txB64);
  const [sigCount, hdr] = readCompactU16(raw, 0);
  const sigsStart = hdr, message = raw.slice(sigsStart + sigCount * 64);
  // Versioned (v0) tx: the message starts with a version byte (high bit set) before the 3-byte header.
  // Skip it to locate the account keys. The signature covers the FULL message (version byte included).
  const vOff = (message[0] & 0x80) ? 1 : 0;
  const numReq = message[vOff];
  const [, aoBytes] = readCompactU16(message, vOff + 3);
  const keysStart = vOff + 3 + aoBytes;
  let our = -1;
  for (let i = 0; i < numReq; i++) if (bytesEq(message.slice(keysStart + i * 32, keysStart + (i + 1) * 32), pub)) { our = i; break; }
  if (our < 0) { seed.fill(0); throw new Error('not_a_required_signer'); }
  const sig = ed25519.sign(message, priv);
  const sigs = [];
  for (let i = 0; i < sigCount; i++) sigs.push(raw.slice(sigsStart + i * 64, sigsStart + (i + 1) * 64));
  sigs[our] = sig;
  seed.fill(0);
  return base64.encode(concatBytes(compactU16(sigCount), ...sigs, message));
}

function computeBudgetIxs(units, microLamports) {
  return [
    { programId: COMPUTE_BUDGET, keys: [], data: concatBytes(new Uint8Array([2]), u32le(units)) },
    { programId: COMPUTE_BUDGET, keys: [], data: concatBytes(new Uint8Array([3]), u64le(microLamports)) },
  ];
}

function buildSolTransfer({ mnemonic, passphrase = '', account = 0, to, lamports, blockhash, microLamports = 1000, units = 200000 }) {
  const seed = masterSeed(mnemonic, passphrase);
  const priv = solDerive(seed, `m/44'/501'/${account}'/0'`);
  const from = ed25519.getPublicKey(priv);
  const toPub = base58.decode(to);
  const transfer = { programId: SYS_PROGRAM, keys: [{ pubkey: from, isSigner: true, isWritable: true }, { pubkey: toPub, isSigner: false, isWritable: true }], data: concatBytes(u32le(2), u64le(lamports)) };
  const msg = compileSolMessage(from, [...computeBudgetIxs(units, microLamports), transfer], base58.decode(blockhash));
  const { tx, sig } = solSignTx(msg, priv);
  seed.fill(0);
  return { txBase64: base64.encode(tx), signature: base58.encode(sig), message: base64.encode(msg) };
}

function buildSplTransfer({ mnemonic, passphrase = '', account = 0, to, mint, amount, decimals, blockhash, microLamports = 1000, units = 200000 }) {
  const seed = masterSeed(mnemonic, passphrase);
  const priv = solDerive(seed, `m/44'/501'/${account}'/0'`);
  const from = ed25519.getPublicKey(priv);
  const toPub = base58.decode(to);
  const mintPub = base58.decode(mint);
  const srcAta = findAta(from, mintPub);
  const dstAta = findAta(toPub, mintPub);
  // createIdempotent dest ATA (ATA program instr 1) — no-op if it exists
  const createDst = { programId: ATA_PROGRAM, keys: [
    { pubkey: from, isSigner: true, isWritable: true }, { pubkey: dstAta, isSigner: false, isWritable: true },
    { pubkey: toPub, isSigner: false, isWritable: false }, { pubkey: mintPub, isSigner: false, isWritable: false },
    { pubkey: SYS_PROGRAM, isSigner: false, isWritable: false }, { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
  ], data: new Uint8Array([1]) };
  // TransferChecked (token instr 12): src, mint, dst, owner
  const transfer = { programId: TOKEN_PROGRAM, keys: [
    { pubkey: srcAta, isSigner: false, isWritable: true }, { pubkey: mintPub, isSigner: false, isWritable: false },
    { pubkey: dstAta, isSigner: false, isWritable: true }, { pubkey: from, isSigner: true, isWritable: false },
  ], data: concatBytes(new Uint8Array([12]), u64le(amount), new Uint8Array([decimals])) };
  const msg = compileSolMessage(from, [...computeBudgetIxs(units, microLamports), createDst, transfer], base58.decode(blockhash));
  const { tx, sig } = solSignTx(msg, priv);
  seed.fill(0);
  return { txBase64: base64.encode(tx), signature: base58.encode(sig), srcAta: base58.encode(srcAta), dstAta: base58.encode(dstAta) };
}

// ── Compressed NFT (Bubblegum) transfer ──────────────────────────────────────
const BUBBLEGUM = base58.decode('BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY');
const NOOP_PROGRAM = base58.decode('noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV');
const COMPRESSION_PROGRAM = base58.decode('cmtDvXumGCrqC1Age74AVPhSRVXJMd8PJS91L8KbNCK');
// Generic PDA (findProgramAddress): the address must be OFF the ed25519 curve.
function findPda(seeds, programId) {
  for (let bump = 255; bump >= 0; bump--) {
    const h = sha256(concatBytes(...seeds, new Uint8Array([bump]), programId, enc.encode('ProgramDerivedAddress')));
    if (!isOnCurve(h)) return h;
  }
  throw new Error('no_pda_bump');
}
// ctx (from the server's DAS lookup): { owner, delegate, dataHash, creatorHash, leafId, tree, root, proof:[b58…], canopyDepth }
function buildCnftTransfer({ mnemonic, passphrase = '', account = 0, to, ctx, blockhash, microLamports = 1000, units = 300000 }) {
  const seed = masterSeed(mnemonic, passphrase);
  const priv = solDerive(seed, `m/44'/501'/${account}'/0'`);
  const from = ed25519.getPublicKey(priv);
  const owner = base58.decode(ctx.owner);
  if (keyHex(owner) !== keyHex(from)) { seed.fill(0); throw new Error('not_cnft_owner'); }
  const delegate = ctx.delegate ? base58.decode(ctx.delegate) : owner;
  const newOwner = base58.decode(to);
  const merkleTree = base58.decode(ctx.tree);
  const treeAuthority = findPda([merkleTree], BUBBLEGUM);
  const disc = sha256(enc.encode('global:transfer')).slice(0, 8); // Anchor: sha256("global:transfer")[:8]
  const data = concatBytes(disc, base58.decode(ctx.root), base58.decode(ctx.dataHash), base58.decode(ctx.creatorHash), u64le(ctx.leafId), u32le(ctx.leafId));
  // Drop the top `canopyDepth` proof nodes — those are cached on-chain in the tree's canopy.
  const proofAll = Array.isArray(ctx.proof) ? ctx.proof : [];
  const proof = proofAll.slice(0, Math.max(0, proofAll.length - (ctx.canopyDepth || 0)));
  const keys = [
    { pubkey: treeAuthority, isSigner: false, isWritable: false },
    { pubkey: owner, isSigner: true, isWritable: false },
    { pubkey: delegate, isSigner: false, isWritable: false },
    { pubkey: newOwner, isSigner: false, isWritable: false },
    { pubkey: merkleTree, isSigner: false, isWritable: true },
    { pubkey: NOOP_PROGRAM, isSigner: false, isWritable: false },
    { pubkey: COMPRESSION_PROGRAM, isSigner: false, isWritable: false },
    { pubkey: SYS_PROGRAM, isSigner: false, isWritable: false },
    ...proof.map((p) => ({ pubkey: base58.decode(p), isSigner: false, isWritable: false })),
  ];
  const ix = { programId: BUBBLEGUM, keys, data };
  const msg = compileSolMessage(from, [...computeBudgetIxs(units, microLamports), ix], base58.decode(blockhash));
  const { tx, sig } = solSignTx(msg, priv);
  seed.fill(0);
  return { txBase64: base64.encode(tx), signature: base58.encode(sig) };
}

// ── Encrypted vault (Argon2id → AES-GCM) ─────────────────────────────────────
const ARGON = { t: 2, m: 19456, p: 1, dkLen: 32 }; // OWASP minimum for Argon2id
async function encryptVault(plaintext, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const dk = argon2id(enc.encode(password), salt, ARGON);
  const key = await crypto.subtle.importKey('raw', dk, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext)));
  dk.fill(0);
  return { v: 1, kdf: 'argon2id', params: ARGON, salt: hex.encode(salt), iv: hex.encode(iv), ct: hex.encode(ct) };
}
// SECURITY (audit M1): never trust KDF params weaker than our minimum (downgrade guard).
const kdfOk = (p) => p && p.t >= ARGON.t && p.m >= ARGON.m && p.p >= ARGON.p && p.dkLen >= ARGON.dkLen;
async function decryptVault(blob, password) {
  const params = kdfOk(blob.params) ? blob.params : ARGON;
  const dk = argon2id(enc.encode(password), hex.decode(blob.salt), params);
  const key = await crypto.subtle.importKey('raw', dk, 'AES-GCM', false, ['decrypt']);
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: hex.decode(blob.iv) }, key, hex.decode(blob.ct));
    return new TextDecoder().decode(pt);
  } catch (_) {
    throw new Error('wrong_password');
  } finally {
    dk.fill(0);
  }
}

// ── IndexedDB (single keyval store) ──────────────────────────────────────────
function idb(method, k, v) {
  return new Promise((res, rej) => {
    const open = indexedDB.open('wonder-wallet', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('kv');
    open.onerror = () => rej(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction('kv', method === 'get' ? 'readonly' : 'readwrite');
      const store = tx.objectStore('kv');
      const req = method === 'get' ? store.get(k) : method === 'del' ? store.delete(k) : store.put(v, k);
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    };
  });
}

// ── In-memory session (cleared on lock) ──────────────────────────────────────
let SESSION = null; // { mnemonic, passphrase }
let lockTimer = null;

async function hasVault() { return !!(await idb('get', 'vault')); }
// External lock-state listeners — the browser extension uses this to keep a cross-surface
// session (popup / side panel / Terminal window) in sync via chrome.storage.session.
let lockListeners = [];
function onLockChange(cb) { if (typeof cb === 'function') lockListeners.push(cb); }
function fireLock(state) { for (const cb of lockListeners) { try { cb(state); } catch (_) {} } }

async function createVault(mnemonic, passphrase, password) {
  // Accept a BIP-39 mnemonic OR a Counterwallet/FreeWallet passphrase (Electrum-v1) as the seed.
  if (!validateMnemonic(mnemonic) && !isCwPhrase(mnemonic)) throw new Error('invalid_mnemonic');
  const blob = await encryptVault(JSON.stringify({ mnemonic, passphrase: passphrase || '', imported: [] }), password);
  await idb('put', 'vault', blob);
  SESSION = { mnemonic, passphrase: passphrase || '', imported: [] };
  armAutoLock();
  fireLock(true);
  return true;
}
async function unlock(password) {
  const blob = await idb('get', 'vault');
  if (!blob) throw new Error('no_vault');
  const data = JSON.parse(await decryptVault(blob, password));
  SESSION = { mnemonic: data.mnemonic, passphrase: data.passphrase || '', imported: data.imported || [] };
  armAutoLock();
  fireLock(true);
  return true;
}
// Full-backup: move the ENCRYPTED vault blob out to / in from a user's backup file. The blob is already
// Argon2id→AES-GCM ciphertext, so the seed is NEVER serialized in plaintext. We verify the password
// actually opens it before EXPORT (guarantees the backup is restorable) and before IMPORT (so a wrong
// password / corrupt file can never clobber an existing wallet). Settings are handled by the UI layer.
async function exportVaultBlob(password) {
  const blob = await idb('get', 'vault');
  if (!blob) throw new Error('no_vault');
  await decryptVault(blob, password); // throws 'wrong_password' if it won't open
  return blob;
}
// Export a backup whose file has its OWN password, decoupled from the wallet password. `walletPassword`
// authorizes + reads the seed (re-auth, like Reveal seed); `backupPassword` is what the FILE is encrypted
// with — and what you type to restore it. So forgetting the wallet password never locks the backup: you
// restore with the backup password (which then becomes the wallet password on the restored device).
async function exportBackup(walletPassword, backupPassword) {
  const blob = await idb('get', 'vault');
  if (!blob) throw new Error('no_vault');
  const plain = await decryptVault(blob, walletPassword); // verify wallet pw + read the seed json
  return encryptVault(plain, backupPassword);             // re-encrypt under the file's own password
}
async function importVaultBlob(blob, password) {
  if (!blob || !blob.ct || !blob.salt || !blob.iv) throw new Error('bad_backup');
  await decryptVault(blob, password); // verify BEFORE touching stored state
  await idb('put', 'vault', blob);
  return true;
}
// SECURITY (audit 2026-08 finding #2): the cross-surface session bridge (resumeSession/getSessionSecret)
// is a NO-PASSWORD secret path — it only makes sense inside the browser EXTENSION (secret lives in
// chrome.storage.session). On the public Terminal (wonder-wallet.com) nothing calls it, so we hard-gate
// it to the extension context. On a normal webpage chrome.runtime.id is undefined → these are inert, so
// a future in-origin script can't call getSessionSecret() to lift the whole wallet with one bare call.
const _extCtx = () => { try { return typeof chrome !== 'undefined' && !!(chrome.runtime && chrome.runtime.id); } catch (_) { return false; } };
// On the public Terminal these stay INERT by default (audit #2 hardening). They open ONLY when the user
// EXPLICITLY enables "stay signed in" on the web — the Auto-lock timer setting sets ww:persist='1', which
// lets the Terminal persist the unlocked session in sessionStorage across refreshes. No opt-in → memory-only,
// so a random in-origin script still can't lift the secret with a bare call.
const _webPersist = () => { try { return typeof localStorage !== 'undefined' && localStorage.getItem('ww:persist') === '1'; } catch (_) { return false; } };
const _sessionOk = () => _extCtx() || _webPersist();
// Restore an unlocked session from a secret the caller already holds — NO password needed.
function resumeSession(secret) {
  if (!_sessionOk()) return false;
  if (!secret || !secret.mnemonic) return false;
  SESSION = { mnemonic: secret.mnemonic, passphrase: secret.passphrase || '', imported: secret.imported || [] };
  armAutoLock();
  fireLock(true);
  return true;
}
// The current in-memory secret (unlocked only) — so the session can be persisted across surfaces/refreshes.
function getSessionSecret() { if (!_sessionOk()) return null; return SESSION ? { mnemonic: SESSION.mnemonic, passphrase: SESSION.passphrase, imported: SESSION.imported || [] } : null; }

function lock() {
  const was = !!SESSION;
  if (SESSION) { SESSION.mnemonic = ''; SESSION.passphrase = ''; if (Array.isArray(SESSION.imported)) SESSION.imported.forEach((e) => { e.wif = ''; }); SESSION.imported = []; }
  SESSION = null;
  if (lockTimer) clearTimeout(lockTimer);
  if (was) fireLock(false);
}
const isUnlocked = () => !!SESSION;
function armAutoLock(ms = 10 * 60 * 1000) { if (lockTimer) clearTimeout(lockTimer); lockTimer = setTimeout(lock, ms); }
async function destroyVault() { lock(); await idb('del', 'vault'); }

// ── Imported keys (public API) — password re-auth required to persist (encrypted inside the vault) ──
async function importKey(wif, password, label = '') {
  const s = requireUnlocked();
  const node = importedNode(wif); // validates the WIF (throws not_mainnet_wif / bad_wif_length)
  const blob = await idb('get', 'vault');
  if (!blob) throw new Error('no_vault');
  const data = JSON.parse(await decryptVault(blob, password)); // re-auth → throws 'wrong_password'
  const id = 'imp_' + hex.encode(sha256(node.publicKey)).slice(0, 16);
  const lbl = String(label || '').slice(0, 40);
  data.imported = (data.imported || []).filter((e) => e.id !== id); // de-dup by key
  data.imported.push({ id, label: lbl, wif });
  await idb('put', 'vault', await encryptVault(JSON.stringify(data), password));
  s.imported = (s.imported || []).filter((e) => e.id !== id);
  s.imported.push({ id, label: lbl, wif });
  const bitcoin = {}; for (const t of Object.keys(BTC_PATHS)) bitcoin[t] = { address: btcFromPub(node.publicKey, t) };
  return { id, label: lbl, bitcoin };
}
// Batch-import several WIFs in ONE vault decrypt/encrypt (avoids N× argon2 — matters when restoring
// a Counterwallet/FreeWallet passphrase's several funded addresses at once). labels[] parallels wifs[].
async function importKeys(wifs, password, labels = []) {
  const s = requireUnlocked();
  const blob = await idb('get', 'vault');
  if (!blob) throw new Error('no_vault');
  const data = JSON.parse(await decryptVault(blob, password)); // re-auth ONCE
  const entries = (wifs || []).map((wif, i) => {
    const node = importedNode(wif); // validates the WIF (throws not_mainnet_wif / bad_wif_length)
    return { id: 'imp_' + hex.encode(sha256(node.publicKey)).slice(0, 16), label: String(labels[i] || '').slice(0, 40), wif, pub: node.publicKey };
  });
  const ids = new Set(entries.map((e) => e.id));
  const persisted = entries.map((e) => ({ id: e.id, label: e.label, wif: e.wif }));
  data.imported = (data.imported || []).filter((e) => !ids.has(e.id)).concat(persisted); // de-dup by key
  await idb('put', 'vault', await encryptVault(JSON.stringify(data), password));
  s.imported = (s.imported || []).filter((e) => !ids.has(e.id)).concat(persisted);
  return entries.map((e) => { const bitcoin = {}; for (const t of Object.keys(BTC_PATHS)) bitcoin[t] = { address: btcFromPub(e.pub, t) }; return { id: e.id, label: e.label, bitcoin }; });
}
async function removeImportedKey(id, password) {
  const s = requireUnlocked();
  const blob = await idb('get', 'vault');
  if (!blob) throw new Error('no_vault');
  const data = JSON.parse(await decryptVault(blob, password)); // re-auth
  data.imported = (data.imported || []).filter((e) => e.id !== id);
  await idb('put', 'vault', await encryptVault(JSON.stringify(data), password));
  s.imported = (s.imported || []).filter((e) => e.id !== id);
  return true;
}
// Imported accounts for the UI — addresses only; the WIF NEVER leaves the core.
function importedAccounts() {
  const s = requireUnlocked();
  return (s.imported || []).map((e) => ({ id: e.id, label: e.label, bitcoin: importedAddresses(e.wif) }));
}
function _importedWif(id) { const s = requireUnlocked(); const e = (s.imported || []).find((x) => x.id === id); if (!e || !e.wif) throw new Error('imported_not_found'); return e.wif; }

// Operations that require an unlocked session.
function requireUnlocked() { if (!SESSION) throw new Error('locked'); armAutoLock(); return SESSION; }
function accounts(account = 0, index = 0, network = 'mainnet') { const s = requireUnlocked(); return deriveAccounts(s.mnemonic, s.passphrase, account, index, network); }
async function secrets(password, account = 0, index = 0, network = 'mainnet') {
  const s = requireUnlocked();
  const blob = await idb('get', 'vault');
  if (blob) await decryptVault(blob, password); // SECURITY (audit H2): re-auth — throws 'wrong_password' on bad pw
  return deriveSecrets(s.mnemonic, s.passphrase, account, index, network);
}
function send(opts) { const s = requireUnlocked(); const wif = opts && opts.importedId ? _importedWif(opts.importedId) : null; return buildSend({ mnemonic: s.mnemonic, passphrase: s.passphrase, ...opts, wif }); }
// Session-based wrapper for the dApp provider's ww_signPsbt (the approval window calls this after the
// user approves). Signs only our inputs, sighash-allowlisted (see signProviderPsbt). Requires unlock.
function signProvider(opts) { const s = requireUnlocked(); const wif = opts && opts.importedId ? _importedWif(opts.importedId) : null; return signProviderPsbt(opts.psbt, opts, s.mnemonic, s.passphrase, opts.account || 0, opts.index || 0, opts.type || 'nativeSegwit', opts.prevTxs || {}, wif, opts.network || 'mainnet'); }
function signMessage(message, account = 0, type = 'nativeSegwit', network = 'mainnet') {
  const s = requireUnlocked();
  const seed = masterSeed(s.mnemonic, s.passphrase);
  const paths = btcPaths(network);
  const path = btcPathStr(s.mnemonic, network, paths[type] ? type : 'nativeSegwit', account, 0);
  const node = HDKey.fromMasterSeed(seed).derive(path);
  try {
    const address = btcFromPub(node.publicKey, type, network);
    if (type === 'nativeSegwit') return { signature: bip322SignWithKey(message, node.privateKey), format: 'BIP-322', address };
    if (type === 'legacy') return { signature: bsmSignWithKey(message, node.privateKey, true), format: 'BSM', address };
    throw new Error('message_type_unsupported'); // taproot / nested: no standard verifiable scheme here
  } finally { seed.fill(0); }
}
function signCp(psbtB64, inputsValues, lockScripts, account = 0, type = 'nativeSegwit', prevTxs = {}, importedId = null, network = 'mainnet') { const s = requireUnlocked(); const wif = importedId ? _importedWif(importedId) : null; return signCpPsbt(psbtB64, inputsValues, lockScripts, s.mnemonic, s.passphrase, account, 0, type, prevTxs, wif, network); }
function signStamp(psbtHex, account = 0, type = 'nativeSegwit', prevTxs = {}, importedId = null, network = 'mainnet') { const s = requireUnlocked(); const wif = importedId ? _importedWif(importedId) : null; return signStampPsbt(psbtHex, s.mnemonic, s.passphrase, account, 0, type, prevTxs, wif, network); }
function sendEvm(opts) { const s = requireUnlocked(); return signEvm({ mnemonic: s.mnemonic, passphrase: s.passphrase, ...opts }); }
function ethPersonalSign(message, account = 0) { const s = requireUnlocked(); return personalSign(message, s.mnemonic, s.passphrase, account, 0); }
function sendSol(opts) { const s = requireUnlocked(); return buildSolTransfer({ mnemonic: s.mnemonic, passphrase: s.passphrase, ...opts }); }
function sendSpl(opts) { const s = requireUnlocked(); return buildSplTransfer({ mnemonic: s.mnemonic, passphrase: s.passphrase, ...opts }); }
function sendCnft(opts) { const s = requireUnlocked(); return buildCnftTransfer({ mnemonic: s.mnemonic, passphrase: s.passphrase, ...opts }); }
async function revealSeed(password) {
  const blob = await idb('get', 'vault');
  if (!blob) throw new Error('no_vault');
  const data = JSON.parse(await decryptVault(blob, password)); // re-auth with password
  return { mnemonic: data.mnemonic, passphrase: data.passphrase || '' };
}

// ── Self-test against official BIP test vectors (the proof of correctness) ───
function selfTest() {
  const M = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
  const a = deriveAccounts(M, '', 0, 0);
  const t = deriveAccounts(M, '', 0, 0, 'testnet');
  const checks = {
    eth: a.ethereum.address === '0x9858EfFD232B4033E47d90003D41EC34EcaEda94',
    bip84: a.bitcoin.nativeSegwit.address === 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu',
    bip49: a.bitcoin.nestedSegwit.address === '37VucYSaXLCAsxYyAPfbSi9eh4iEcbShgf',
    bip86: a.bitcoin.taproot.address === 'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr',
    // testnet: coin type 1' → a DIFFERENT key, tb1… encoding, never colliding with mainnet
    tnetSegwit: t.bitcoin.nativeSegwit.address === 'tb1q6rz28mcfaxtmd6v789l9rrlrusdprr9pqcpvkl',
    tnetTaproot: /^tb1p/.test(t.bitcoin.taproot.address),
    tnetDistinct: t.bitcoin.nativeSegwit.address !== a.bitcoin.nativeSegwit.address,
    tnetSameEvm: t.ethereum.address === a.ethereum.address, // ETH/SOL: same key across networks
    // Counterwallet / FreeWallet legacy passphrase → the exact addresses from Counterwallet's own
    // test fixtures. If this ever fails, imported OG assets would land on the wrong address — hard stop.
    cwLegacy: cwDeriveAddrs('voice flame certainly anyone former raw limit king rhythm tumble crystal earth', 0, 3).map((x) => x.address).join(',')
      === '1F2MFgLaQNLCTFCMWhffEG43GtxPxu6KWM,16Qd1F7qYLJfvTpBueEZ3yMYhwrsanPjSN,1DD56rrRcL4yzmEVMhFEQWKepwVLJScrVA',
    cwWif: cwDeriveAddrs('voice flame certainly anyone former raw limit king rhythm tumble crystal earth', 0, 1)[0].wif === 'KzHUABaxi5d9NwNnMAkco3xG3WjcXnZrfkR2G9App71HYetoX8Jy',
    // Level B — restoring the CW passphrase as a native account: legacy (account 0) MATCHES Counterwallet
    // (their assets), while native-segwit/ETH derive fresh from the same seed. And a real BIP-39 seed is
    // NEVER misrouted as Counterwallet (masterSeed/isCwSeed guard) — bip84 above still passes.
    cwAccount: (() => { const c = deriveAccounts('voice flame certainly anyone former raw limit king rhythm tumble crystal earth', '', 0, 0);
      return c.bitcoin.legacy.address === '1F2MFgLaQNLCTFCMWhffEG43GtxPxu6KWM' && c.bitcoin.legacy.path === "m/0'/0/0"
        && /^bc1q/.test(c.bitcoin.nativeSegwit.address) && /^0x/.test(c.ethereum.address) && c.solana.address.length > 30; })(),
  };
  checks.all = Object.values(checks).every(Boolean);
  return { checks, derived: a };
}

const WonderCore = {
  generateMnemonic, validateMnemonic, deriveAccounts, deriveSecrets, deriveCustom, deriveReceiveAddrs,
  fromWIF, hasVault, createVault, unlock, lock, isUnlocked, destroyVault, exportVaultBlob, exportBackup, importVaultBlob,
  importKey, importKeys, removeImportedKey, importedAccounts, importedAddresses,
  accounts, secrets, revealSeed, armAutoLock, selfTest,
  isCwPhrase, cwSeedHex, cwDeriveAddrs, // Counterwallet / FreeWallet legacy passphrase (Electrum-v1)
  send, signMessage, signMessageImported, signCp, signStamp, psbtInputs, decodeTxOutputs, addrHash, sendEvm, sendSol, sendSpl, sendCnft, ethPersonalSign, buildSend, buildUnsignedSend, signMessageBIP322, bip322SignWithKey, bsmSignWithKey, signCpPsbt, signStampPsbt, signEvm,
  personalSign, personalSignWithKey, buildSolTransfer, buildSplTransfer, buildCnftTransfer, erc20TransferData, erc20ApproveData, estimateVsize, buildHwSend, finalizeHwSend, txidOf,
  ethSignTypedData, eip712Digest, signTypedDataWithKey, btcNet, btcPaths, version: '0.11.0', // 0.11.0: Counterwallet/FreeWallet passphrase support
};

// SECURITY (audit H1/H3): expose only the minimal app API on `window` — NOT the raw-key
// primitives (personalSignWithKey/bip322SignWithKey/signEvm/buildSend/build*Transfer/…).
// Reduces blast radius if any script runs in-origin. (Strong CSP is the primary defense.)
const PUBLIC_API = {
  generateMnemonic, validateMnemonic, hasVault, createVault, unlock, lock, isUnlocked, destroyVault, exportVaultBlob, exportBackup, importVaultBlob,
  importKey, importKeys, removeImportedKey, importedAccounts, importedAddresses,
  accounts, secrets, revealSeed, deriveCustom, deriveReceiveAddrs, isCwPhrase, cwDeriveAddrs, send, signMessage, signMessageImported, signCp, signStamp, psbtInputs, decodeTxOutputs, describePsbt, signProviderPsbt, signProvider, buildUnsignedSend, addrHash, sendEvm, sendSol, sendSpl, sendCnft, solSignMessage, solSignTransaction,
  buildHwSend, finalizeHwSend, txidOf, // hardware (Ledger) BTC send — keyless: builds an annotated PSBT, finalizes with device sigs
  ethPersonalSign, ethSignTypedData, erc20TransferData, erc20ApproveData, selfTest,
  resumeSession, getSessionSecret, onLockChange, armAutoLock, // cross-surface session (extension)
  version: WonderCore.version,
};
if (typeof window !== 'undefined') window.WonderCore = PUBLIC_API;
export default WonderCore;
