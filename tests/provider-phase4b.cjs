/* Phase 4b: Solana provider signing algorithm (shortvec parse + place-our-sig-only + ed25519). */
const { ed25519 } = require('@noble/curves/ed25519'); const { base64 } = require('@scure/base');
// replicas of the wallet-src helpers under test
function compactU16(n){const o=[];for(;;){let b=n&0x7f;n>>=7;if(n)o.push(b|0x80);else{o.push(b);break;}}return Uint8Array.from(o);}
function readCompactU16(b,off=0){let v=0,s=0,i=off;for(;;){const x=b[i];i++;v|=(x&0x7f)<<s;if((x&0x80)===0)break;s+=7;}return [v,i-off];}
function bytesEq(a,b){if(a.length!==b.length)return false;for(let i=0;i<a.length;i++)if(a[i]!==b[i])return false;return true;}
const cat = (...a)=>{const n=a.reduce((s,x)=>s+x.length,0),o=new Uint8Array(n);let k=0;for(const x of a){o.set(x,k);k+=x.length;}return o;};
function solSignTransaction(raw, priv){ // core algorithm from wallet-src
  const pub=ed25519.getPublicKey(priv);
  const [sigCount,hdr]=readCompactU16(raw,0); const sigsStart=hdr, message=raw.slice(sigsStart+sigCount*64);
  const numReq=message[0]; const [,ao]=readCompactU16(message,3); const keysStart=3+ao;
  let our=-1; for(let i=0;i<numReq;i++) if(bytesEq(message.slice(keysStart+i*32,keysStart+(i+1)*32),pub)){our=i;break;}
  if(our<0) throw new Error('not_a_required_signer');
  const sig=ed25519.sign(message,priv);
  const sigs=[]; for(let i=0;i<sigCount;i++) sigs.push(raw.slice(sigsStart+i*64,sigsStart+(i+1)*64));
  sigs[our]=sig;
  return { raw: cat(compactU16(sigCount),...sigs,message), our, sig, message };
}
let failed=0; const ok=(c,m)=>{console.log((c?'  ✓ ':'  ✗ FAIL ')+m);if(!c)failed++;};

console.log('Phase 4b — Solana provider signing\n');
ok(JSON.stringify(readCompactU16(compactU16(1)))==='[1,1]' && JSON.stringify(readCompactU16(compactU16(300)))==='[300,2]','shortvec encode/decode round-trips (1 and 300)');

const priv = ed25519.utils.randomSecretKey ? ed25519.utils.randomSecretKey() : ed25519.utils.randomPrivateKey();
const pub = ed25519.getPublicKey(priv);
const other = ed25519.getPublicKey(ed25519.utils.randomSecretKey ? ed25519.utils.randomSecretKey() : ed25519.utils.randomPrivateKey());
// tx: 2 sigs (both zero placeholders) + message[hdr(2 req,0,0)][acctCount=2][pub@0][other@1][blockhash 32]
const msg = cat(new Uint8Array([2,0,0]), compactU16(2), pub, other, new Uint8Array(32));
const tx = cat(compactU16(2), new Uint8Array(128), msg);
const r = solSignTransaction(tx, priv);
ok(r.our===0, 'finds OUR required-signer slot (index 0)');
ok(ed25519.verify(r.sig, r.message, pub), 'our ed25519 signature verifies against the message');
const back = readCompactU16(r.raw,0); const sigsStart=back[1];
ok(bytesEq(r.raw.slice(sigsStart+64, sigsStart+128), new Uint8Array(64)), 'the OTHER signer slot is left untouched (all zero)');

// not a required signer → refuse
const msg2 = cat(new Uint8Array([1,0,0]), compactU16(1), other, new Uint8Array(32));
const tx2 = cat(compactU16(1), new Uint8Array(64), msg2);
try { solSignTransaction(tx2, priv); ok(false,'should refuse when we are not a required signer'); }
catch(e){ ok(/not_a_required_signer/.test(e.message), 'refuses to sign when our key is not a required signer'); }

console.log('\n'+(failed?`❌ ${failed} FAILED`:'✅ Phase 4b Solana signing correct (shortvec parse, sign only our slot, refuse non-signer)'));
process.exit(failed?1:0);
