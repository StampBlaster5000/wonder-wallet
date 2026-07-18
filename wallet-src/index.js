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
function toWIF(privKey) {
  const payload = new Uint8Array(34);
  payload[0] = 0x80; payload.set(privKey, 1); payload[33] = 0x01; // mainnet, compressed
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

// ── Bitcoin address (all four types) from an HD node ─────────────────────────
function btcFromPub(pub, type) {
  if (type === 'legacy') return btc.p2pkh(pub).address;
  if (type === 'nativeSegwit') return btc.p2wpkh(pub).address;
  if (type === 'nestedSegwit') return btc.p2sh(btc.p2wpkh(pub)).address;
  if (type === 'taproot') return btc.p2tr(pub.slice(1)).address; // x-only internal key (BIP86)
  throw new Error('unknown btc type');
}
const BTC_PATHS = {
  nativeSegwit: (a, i) => `m/84'/0'/${a}'/0/${i}`,
  legacy: (a, i) => `m/44'/0'/${a}'/0/${i}`,
  taproot: (a, i) => `m/86'/0'/${a}'/0/${i}`,
  nestedSegwit: (a, i) => `m/49'/0'/${a}'/0/${i}`,
};

/** Derive display addresses (NO secrets) for one account index across all chains. */
function deriveAccounts(mnemonic, passphrase = '', account = 0, index = 0) {
  const seed = mnemonicToSeedSync(mnemonic, passphrase);
  const root = HDKey.fromMasterSeed(seed);
  const bitcoin = {};
  for (const [type, mk] of Object.entries(BTC_PATHS)) {
    const path = mk(account, index);
    bitcoin[type] = { address: btcFromPub(root.derive(path).publicKey, type), path };
  }
  const ethPath = `m/44'/60'/${account}'/0/${index}`;
  const ethNode = root.derive(ethPath);
  const ethereum = { address: ethAddress(ethNode.privateKey), path: ethPath };
  const solPath = `m/44'/501'/${account}'/0'`;
  const solana = { address: solAddress(solDerive(seed, solPath)), path: solPath };
  seed.fill(0);
  return { account, index, bitcoin, ethereum, solana };
}

/** Reveal secrets for one account (password-gated by the caller). */
function deriveSecrets(mnemonic, passphrase = '', account = 0, index = 0) {
  const seed = mnemonicToSeedSync(mnemonic, passphrase);
  const root = HDKey.fromMasterSeed(seed);
  const out = { bitcoin: {}, ethereum: null, solana: null };
  for (const [type, mk] of Object.entries(BTC_PATHS)) {
    const node = root.derive(mk(account, index));
    out.bitcoin[type] = { address: btcFromPub(node.publicKey, type), wif: toWIF(node.privateKey), path: mk(account, index) };
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
  const seed = mnemonicToSeedSync(mnemonic, passphrase);
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

// ── Bitcoin send / PSBT / fees (Phase 5) — P2WPKH, proven vs BIP-143 ─────────
// vbytes estimate for a P2WPKH spend.
// Per-input vbyte weight by source address type (P2PKH legacy is ~2× a segwit input).
const IN_VB = { legacy: 148, nestedSegwit: 91, nativeSegwit: 68, taproot: 58 };
function estimateVsize(nIn, nOut, type = 'nativeSegwit') { return Math.ceil(nIn * (IN_VB[type] || 68) + nOut * 31 + 11); }

/** Asset-safe coin selection (caller passes ONLY spendable UTXOs). Largest-first. */
function selectUtxos(utxos, targetSats, feeRate, sendMax, type = 'nativeSegwit') {
  const sorted = [...utxos].sort((a, b) => b.value - a.value);
  if (sendMax) {
    const totalIn = sorted.reduce((a, u) => a + u.value, 0);
    const fee = estimateVsize(sorted.length, 1, type) * feeRate;
    if (totalIn <= fee) throw new Error('insufficient_funds');
    return { selected: sorted, totalIn, fee: Math.ceil(fee), amount: totalIn - Math.ceil(fee), change: 0 };
  }
  const selected = []; let totalIn = 0;
  for (const u of sorted) {
    selected.push(u); totalIn += u.value;
    const fee = Math.ceil(estimateVsize(selected.length, 2, type) * feeRate);
    if (totalIn >= targetSats + fee) return { selected, totalIn, fee, amount: targetSats, change: totalIn - targetSats - fee };
  }
  throw new Error('insufficient_funds');
}

// btc-signer payment object for an address type (carries script + redeemScript/tapInternalKey).
function btcPayment(pub, type) {
  if (type === 'legacy') return btc.p2pkh(pub);
  if (type === 'nestedSegwit') return btc.p2sh(btc.p2wpkh(pub));
  if (type === 'taproot') return btc.p2tr(pub.slice(1)); // x-only internal key
  return btc.p2wpkh(pub);
}
// Add an input with the correct witness/redeem/tapKey/nonWitness fields for its address type.
// Legacy (P2PKH) is non-segwit → requires the FULL previous transaction (nonWitnessUtxo).
function addTypedInput(tx, u, type, p, sequence, prevTxs) {
  const base = { txid: hex.decode(u.txid), index: u.vout, sequence };
  if (type === 'legacy') {
    const ph = prevTxs && prevTxs[u.txid];
    if (!ph) throw new Error('missing_prevtx:' + u.txid);
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
function buildSend({ mnemonic, passphrase = '', account = 0, index = 0, type = 'nativeSegwit', wif = null, utxos, recipient, amountSats, feeRate, rbf = true, sendMax = false, sign = true, prevTxs = {} }) {
  if (!BTC_PATHS[type]) throw new Error('send_type_unsupported');
  let seed = null, node;
  if (wif) { node = importedNode(wif); } // imported key signs its own address (any of the 4 types)
  else { seed = mnemonicToSeedSync(mnemonic, passphrase); node = HDKey.fromMasterSeed(seed).derive(BTC_PATHS[type](account, index)); }
  const p = btcPayment(node.publicKey, type);
  const fromAddress = p.address;
  const sel = selectUtxos(utxos, amountSats, feeRate, sendMax, type);
  const seq = rbf ? 0xfffffffd : 0xffffffff;
  const tx = new btc.Transaction({});
  for (const u of sel.selected) addTypedInput(tx, u, type, p, seq, prevTxs);
  const outAmount = sendMax ? sel.amount : amountSats;
  tx.addOutputAddress(recipient, BigInt(outAmount)); // throws on invalid recipient
  let change = sel.change;
  if (!sendMax && change >= 294) tx.addOutputAddress(fromAddress, BigInt(change)); // change back to the same source type
  else change = 0; // dust change rolls into the fee

  const result = { fromAddress, recipient, amountSats: outAmount, change, fee: sel.totalIn - outAmount - change, inputs: sel.selected.map((u) => ({ utxo: `${u.txid}:${u.vout}`, value: u.value })), totalIn: sel.totalIn };
  if (sign) {
    tx.sign(node.privateKey); tx.finalize();
    result.txhex = hex.encode(tx.extract());
    result.txid = tx.id;
    result.vsize = tx.vsize;
  } else {
    result.psbt = base64.encode(tx.toPSBT(0)); // unsigned PSBT for export
    result.vsize = estimateVsize(sel.selected.length, change ? 2 : 1, type);
  }
  if (seed) seed.fill(0);
  return result;
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

// Decode a composed tx/PSBT's OUTPUTS so the client can verify a server-composed transaction
// pays only expected addresses (change back to source, user-entered recipients) before signing.
function decodeTxOutputs(psbtHexOrB64) {
  const s = String(psbtHexOrB64).replace(/^0x/, '');
  const bytes = /^[0-9a-fA-F]+$/.test(s) ? hex.decode(s) : base64.decode(s);
  let tx;
  try { tx = btc.Transaction.fromPSBT(bytes, { allowUnknownOutputs: true, allowUnknownInputs: true }); }
  catch (_) { tx = btc.Transaction.fromRaw(bytes, { allowUnknownOutputs: true, allowLegacyWitnessUtxo: true }); }
  const out = [];
  for (let i = 0; i < tx.outputsLength; i++) {
    const o = tx.getOutput(i);
    const script = o.script || new Uint8Array(0);
    let address = null; const opReturn = script[0] === 0x6a;
    if (!opReturn) { try { address = btc.Address().encode(btc.OutScript.decode(script)); } catch (_) { address = null; } }
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

/**
 * Sign a fully-formed PSBT whose inputs already carry witnessUtxo (stampchain
 * SRC-20 / Stamp-art mints). Segwit sources sign directly; legacy needs prevTxs.
 */
function signStampPsbt(psbtHexOrB64, mnemonic, passphrase = '', account = 0, index = 0, type = 'nativeSegwit', prevTxs = {}, wif = null) {
  if (!BTC_PATHS[type]) throw new Error('stamp_sign_type_unsupported');
  const s = String(psbtHexOrB64).replace(/^0x/, '');
  const bytes = /^[0-9a-fA-F]+$/.test(s) ? hex.decode(s) : base64.decode(s);
  let seed = null, node;
  if (wif) node = importedNode(wif);
  else { seed = mnemonicToSeedSync(mnemonic, passphrase); node = HDKey.fromMasterSeed(seed).derive(BTC_PATHS[type](account, index)); }
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

function signCpPsbt(psbtB64, inputsValues, lockScripts, mnemonic, passphrase = '', account = 0, index = 0, type = 'nativeSegwit', prevTxs = {}, wif = null) {
  if (!BTC_PATHS[type]) throw new Error('cp_sign_type_unsupported');
  let seed = null, node;
  if (wif) node = importedNode(wif);
  else { seed = mnemonicToSeedSync(mnemonic, passphrase); node = HDKey.fromMasterSeed(seed).derive(BTC_PATHS[type](account, index)); }
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
  const toSpend = new btc.Transaction({ version: 0, lockTime: 0, allowUnknownInputs: true, allowUnknownOutputs: true, allowLegacyWitnessUtxo: true });
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
  const seed = mnemonicToSeedSync(mnemonic, passphrase);
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
  const seed = mnemonicToSeedSync(mnemonic, passphrase);
  const node = HDKey.fromMasterSeed(seed).derive(`m/44'/60'/${account}'/0/${index}`);
  const sig = personalSignWithKey(message, node.privateKey);
  seed.fill(0);
  return sig;
}

function signEvm({ mnemonic, passphrase = '', account = 0, index = 0, to, valueWei = 0n, data = '0x', nonce, chainId, maxFeePerGas, maxPriorityFeePerGas, gasLimit }) {
  const seed = mnemonicToSeedSync(mnemonic, passphrase);
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

function computeBudgetIxs(units, microLamports) {
  return [
    { programId: COMPUTE_BUDGET, keys: [], data: concatBytes(new Uint8Array([2]), u32le(units)) },
    { programId: COMPUTE_BUDGET, keys: [], data: concatBytes(new Uint8Array([3]), u64le(microLamports)) },
  ];
}

function buildSolTransfer({ mnemonic, passphrase = '', account = 0, to, lamports, blockhash, microLamports = 1000, units = 200000 }) {
  const seed = mnemonicToSeedSync(mnemonic, passphrase);
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
  const seed = mnemonicToSeedSync(mnemonic, passphrase);
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
  const seed = mnemonicToSeedSync(mnemonic, passphrase);
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
  if (!validateMnemonic(mnemonic)) throw new Error('invalid_mnemonic');
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
// Restore an unlocked session from a secret the caller already holds — NO password needed.
// Used only by the extension session bridge (secret comes from chrome.storage.session, RAM).
function resumeSession(secret) {
  if (!secret || !secret.mnemonic) return false;
  SESSION = { mnemonic: secret.mnemonic, passphrase: secret.passphrase || '', imported: secret.imported || [] };
  armAutoLock();
  fireLock(true);
  return true;
}
// The current in-memory secret (unlocked only) — so the extension can persist it across surfaces.
function getSessionSecret() { return SESSION ? { mnemonic: SESSION.mnemonic, passphrase: SESSION.passphrase, imported: SESSION.imported || [] } : null; }

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
function accounts(account = 0, index = 0) { const s = requireUnlocked(); return deriveAccounts(s.mnemonic, s.passphrase, account, index); }
async function secrets(password, account = 0, index = 0) {
  const s = requireUnlocked();
  const blob = await idb('get', 'vault');
  if (blob) await decryptVault(blob, password); // SECURITY (audit H2): re-auth — throws 'wrong_password' on bad pw
  return deriveSecrets(s.mnemonic, s.passphrase, account, index);
}
function send(opts) { const s = requireUnlocked(); const wif = opts && opts.importedId ? _importedWif(opts.importedId) : null; return buildSend({ mnemonic: s.mnemonic, passphrase: s.passphrase, ...opts, wif }); }
function signMessage(message, account = 0, type = 'nativeSegwit') {
  const s = requireUnlocked();
  const seed = mnemonicToSeedSync(s.mnemonic, s.passphrase);
  const path = (BTC_PATHS[type] || BTC_PATHS.nativeSegwit)(account, 0);
  const node = HDKey.fromMasterSeed(seed).derive(path);
  try {
    const address = btcFromPub(node.publicKey, type);
    if (type === 'nativeSegwit') return { signature: bip322SignWithKey(message, node.privateKey), format: 'BIP-322', address };
    if (type === 'legacy') return { signature: bsmSignWithKey(message, node.privateKey, true), format: 'BSM', address };
    throw new Error('message_type_unsupported'); // taproot / nested: no standard verifiable scheme here
  } finally { seed.fill(0); }
}
function signCp(psbtB64, inputsValues, lockScripts, account = 0, type = 'nativeSegwit', prevTxs = {}, importedId = null) { const s = requireUnlocked(); const wif = importedId ? _importedWif(importedId) : null; return signCpPsbt(psbtB64, inputsValues, lockScripts, s.mnemonic, s.passphrase, account, 0, type, prevTxs, wif); }
function signStamp(psbtHex, account = 0, type = 'nativeSegwit', prevTxs = {}, importedId = null) { const s = requireUnlocked(); const wif = importedId ? _importedWif(importedId) : null; return signStampPsbt(psbtHex, s.mnemonic, s.passphrase, account, 0, type, prevTxs, wif); }
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
  const checks = {
    eth: a.ethereum.address === '0x9858EfFD232B4033E47d90003D41EC34EcaEda94',
    bip84: a.bitcoin.nativeSegwit.address === 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu',
    bip49: a.bitcoin.nestedSegwit.address === '37VucYSaXLCAsxYyAPfbSi9eh4iEcbShgf',
    bip86: a.bitcoin.taproot.address === 'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr',
  };
  checks.all = Object.values(checks).every(Boolean);
  return { checks, derived: a };
}

const WonderCore = {
  generateMnemonic, validateMnemonic, deriveAccounts, deriveSecrets, deriveCustom,
  fromWIF, hasVault, createVault, unlock, lock, isUnlocked, destroyVault,
  importKey, removeImportedKey, importedAccounts, importedAddresses,
  accounts, secrets, revealSeed, armAutoLock, selfTest,
  send, signMessage, signMessageImported, signCp, signStamp, psbtInputs, decodeTxOutputs, addrHash, sendEvm, sendSol, sendSpl, sendCnft, ethPersonalSign, buildSend, signMessageBIP322, bip322SignWithKey, bsmSignWithKey, signCpPsbt, signStampPsbt, signEvm,
  personalSign, personalSignWithKey, buildSolTransfer, buildSplTransfer, buildCnftTransfer, erc20TransferData, erc20ApproveData, estimateVsize, version: '0.9.0',
};

// SECURITY (audit H1/H3): expose only the minimal app API on `window` — NOT the raw-key
// primitives (personalSignWithKey/bip322SignWithKey/signEvm/buildSend/build*Transfer/…).
// Reduces blast radius if any script runs in-origin. (Strong CSP is the primary defense.)
const PUBLIC_API = {
  generateMnemonic, validateMnemonic, hasVault, createVault, unlock, lock, isUnlocked, destroyVault,
  importKey, removeImportedKey, importedAccounts, importedAddresses,
  accounts, secrets, revealSeed, deriveCustom, send, signMessage, signMessageImported, signCp, signStamp, psbtInputs, decodeTxOutputs, addrHash, sendEvm, sendSol, sendSpl, sendCnft,
  ethPersonalSign, erc20TransferData, erc20ApproveData, selfTest,
  resumeSession, getSessionSecret, onLockChange, armAutoLock, // cross-surface session (extension)
  version: WonderCore.version,
};
if (typeof window !== 'undefined') window.WonderCore = PUBLIC_API;
export default WonderCore;
