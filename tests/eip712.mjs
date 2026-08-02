// EIP-712 (eth_signTypedData_v4) — validate against the canonical spec "Mail" vector.
import WonderCore from '../wallet-src/index.js';
import { keccak_256 } from '@noble/hashes/sha3';
import { secp256k1 } from '@noble/curves/secp256k1';

let fails = 0;
const ok = (c, m) => { console.log((c ? '✓' : '✗') + ' ' + m); if (!c) fails++; };
const hexs = (u) => '0x' + [...u].map((b) => b.toString(16).padStart(2, '0')).join('');

const typedData = {
  types: {
    EIP712Domain: [ { name: 'name', type: 'string' }, { name: 'version', type: 'string' }, { name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' } ],
    Person: [ { name: 'name', type: 'string' }, { name: 'wallet', type: 'address' } ],
    Mail: [ { name: 'from', type: 'Person' }, { name: 'to', type: 'Person' }, { name: 'contents', type: 'string' } ],
  },
  primaryType: 'Mail',
  domain: { name: 'Ether Mail', version: '1', chainId: 1, verifyingContract: '0xCcCCccccCCCCcCCCCCCCCCcCcCcCCCcCcccccccC' },
  message: {
    from: { name: 'Cow', wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826' },
    to: { name: 'Bob', wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB' },
    contents: 'Hello, Bob!',
  },
};

// 1. Digest matches the spec's published value.
const digest = hexs(WonderCore.eip712Digest(typedData));
ok(digest === '0xbe609aee343fb3c4b28e1df9e632fca64fcfaede20f02e86244efddf30957bd2', 'digest matches EIP-712 spec vector (' + digest.slice(0, 18) + '…)');

// 2. Signature with the canonical "cow" key matches the spec's published signature.
const cowKey = keccak_256(new TextEncoder().encode('cow'));
const addr = hexs(keccak_256(secp256k1.getPublicKey(cowKey, false).slice(1)).slice(-20));
ok(addr.toLowerCase() === '0xcd2a3d9f938e13cd947ec05abc7fe734df8dd826', 'cow key derives the spec signer address');
const sig = WonderCore.signTypedDataWithKey(typedData, cowKey);
ok(sig === '0x4355c47d63924e8a72e509b65029052eb6c299d53a04e167c5775fd466751c9d07299936d304c153f6443dfa05f40ff007d72911b6f72307f996231605b915621c', 'signature matches EIP-712 spec vector');

console.log(fails ? `\n✗ ${fails} EIP-712 check(s) failed` : '\n✅ EIP-712 matches the canonical spec vector');
process.exit(fails ? 1 : 0);
