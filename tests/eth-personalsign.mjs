// personal_sign (EIP-191) — the signature must recover to the signer (else SIWE/dApp logins reject it).
import WonderCore from '../wallet-src/index.js';
import { secp256k1 } from '@noble/curves/secp256k1';
import { keccak_256 } from '@noble/hashes/sha3';
const enc = new TextEncoder();
let fails = 0; const ok = (c, m) => { console.log((c ? '✓' : '✗') + ' ' + m); if (!c) fails++; };

const cow = keccak_256(enc.encode('cow'));
const addr = '0x' + Buffer.from(keccak_256(secp256k1.getPublicKey(cow, false).slice(1)).slice(-20)).toString('hex');
const bytes = enc.encode('Sign in to OpenSea');               // decoded message bytes (our fix)
const sig = WonderCore.personalSignWithKey(bytes, cow);
const prefix = enc.encode('\x19Ethereum Signed Message:\n' + bytes.length);
const h = keccak_256(new Uint8Array([...prefix, ...bytes]));
const v = parseInt(sig.slice(130, 132), 16);
const signature = new secp256k1.Signature(BigInt('0x' + sig.slice(2, 66)), BigInt('0x' + sig.slice(66, 130))).addRecoveryBit(v - 27);
const rec = '0x' + Buffer.from(keccak_256(signature.recoverPublicKey(h).toRawBytes(false).slice(1)).slice(-20)).toString('hex');
ok(rec.toLowerCase() === addr.toLowerCase(), 'personal_sign recovers to the correct signer');
ok(/^0x[0-9a-f]{130}$/i.test(sig), 'signature is 65-byte r‖s‖v hex');

console.log(fails ? `\n✗ ${fails} failed` : '\n✅ personal_sign (EIP-191) correct');
process.exit(fails ? 1 : 0);
