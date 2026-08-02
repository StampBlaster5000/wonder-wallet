/**
 * Solana read layer via public RPC (Phase 0 §4). SOL balance + SPL fungibles.
 * NFTs + cNFTs need the Metaplex DAS API (Helius free tier) — enabled when
 * HELIUS_KEY is set; otherwise gracefully omitted. Public RPC is non-prod.
 */
'use strict';

const { rpc, fetchJson, cacheGet, cacheSet } = require('./http');
const netctx = require('./netctx');

// Public Solana RPC. Testnet Mode uses devnet (faucet-fundable, same key/signing).
const RPCS = {
  mainnet: process.env.SOL_RPC || 'https://api.mainnet-beta.solana.com',
  testnet: process.env.SOL_RPC_DEVNET || 'https://api.devnet.solana.com',
};
const rpcUrl = () => RPCS[netctx.current()] || RPCS.mainnet;
// Tolerate any casing the host used for the env var (HELIUS_KEY / Helius_Key / …).
const HELIUS_KEY = process.env.HELIUS_KEY || (function () {
  const k = Object.keys(process.env).find((x) => x.toLowerCase() === 'helius_key');
  return k ? process.env[k] : null;
})();
const SPL_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

async function getAddress(address) {
  const key = `sol:addr:${address}`;
  const hit = cacheGet(key);
  if (hit) return hit;

  const [balLamports, tokenAccounts] = await Promise.all([
    rpc(rpcUrl(), 'getBalance', [address]),
    rpc(rpcUrl(), 'getTokenAccountsByOwner', [address, { programId: SPL_PROGRAM }, { encoding: 'jsonParsed' }]),
  ]);

  const sol = (balLamports?.value ?? 0) / 1e9;
  const tokens = (tokenAccounts?.value || [])
    .map((acc) => {
      const info = acc.account?.data?.parsed?.info;
      const amt = info?.tokenAmount;
      return amt && Number(amt.uiAmount) > 0
        ? { mint: info.mint, amount: Number(amt.uiAmount), decimals: amt.decimals }
        : null;
    })
    .filter(Boolean);

  let nftCount = null;
  if (HELIUS_KEY) {
    try {
      const das = await fetchJson(`https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`, {
        method: 'POST',
        body: { jsonrpc: '2.0', id: 1, method: 'getAssetsByOwner', params: { ownerAddress: address, page: 1, limit: 1000 } },
      });
      nftCount = das?.result?.total ?? (das?.result?.items?.length ?? null);
    } catch (_) { nftCount = null; }
  }

  const out = { address, sol, tokens, nftCount, dasEnabled: !!HELIUS_KEY };
  cacheSet(key, out, 30_000);
  return out;
}

async function getBlockhash() {
  const r = await rpc(rpcUrl(), 'getLatestBlockhash', [{ commitment: 'confirmed' }]);
  return { blockhash: r.value.blockhash, lastValidBlockHeight: r.value.lastValidBlockHeight };
}

async function broadcast(txBase64) {
  return rpc(rpcUrl(), 'sendTransaction', [txBase64, { encoding: 'base64', skipPreflight: false, maxRetries: 3 }]);
}

async function simulate(txBase64) {
  const r = await rpc(rpcUrl(), 'simulateTransaction', [txBase64, { encoding: 'base64', sigVerify: true, replaceRecentBlockhash: true, commitment: 'processed' }]);
  return r.value; // { err, logs, unitsConsumed }
}

// NFT + cNFT gallery via Metaplex DAS (Helius). Returns [] without a key.
async function getNfts(address) {
  if (!HELIUS_KEY) return { items: [], dasEnabled: false };
  const key = `sol:nfts:${address}`;
  const hit = cacheGet(key);
  if (hit) return hit;
  try {
    const das = await fetchJson(`https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`, {
      method: 'POST',
      body: { jsonrpc: '2.0', id: 1, method: 'getAssetsByOwner', params: { ownerAddress: address, page: 1, limit: 50, displayOptions: { showCollectionMetadata: true } } },
    });
    const items = (das?.result?.items || []).filter((a) => a.interface !== 'FungibleToken' && a.interface !== 'FungibleAsset').map((a) => ({
      id: a.id, name: a.content?.metadata?.name || a.id.slice(0, 6),
      image: a.content?.links?.image || (a.content?.files && a.content.files[0]?.uri) || null,
      compressed: !!a.compression?.compressed,
    }));
    const out = { items, dasEnabled: true };
    cacheSet(key, out, 60_000);
    return out;
  } catch (_) { return { items: [], dasEnabled: true }; }
}

// Canopy depth from a SPL ConcurrentMerkleTree account (needed to truncate a cNFT proof).
// Header (56B): [0]=type [1]=hdrVersion [2..5]=maxBufferSize(u32le) [6..9]=maxDepth(u32le) ...
function canopyFromAccount(buf) {
  if (!buf || buf.length < 10) return 0;
  const maxBufferSize = buf.readUInt32LE(2);
  const maxDepth = buf.readUInt32LE(6);
  const HEADER = 56;
  const nodeGroup = 40 + 32 * maxDepth;               // changeLog and rightMostPath are the same size
  const cmtSize = 24 + (maxBufferSize + 1) * nodeGroup; // seq+activeIndex+bufferSize=24, then changeLogs[buffer]+rmp
  const canopyBytes = buf.length - HEADER - cmtSize;
  if (canopyBytes <= 0) return 0;
  return Math.max(0, Math.round(Math.log2(canopyBytes / 32 + 2) - 1));
}

// Everything the client needs to build a Bubblegum transfer (getAsset + getAssetProof + canopy).
async function getCnftContext(id) {
  if (!HELIUS_KEY) return { error: 'no_das' };
  const url = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`;
  const asset = (await fetchJson(url, { method: 'POST', body: { jsonrpc: '2.0', id: 1, method: 'getAsset', params: { id } } }))?.result;
  const proofR = (await fetchJson(url, { method: 'POST', body: { jsonrpc: '2.0', id: 1, method: 'getAssetProof', params: { id } } }))?.result;
  if (!asset || !proofR) return { error: 'not_found' };
  const comp = asset.compression || {};
  if (!comp.compressed) return { error: 'not_compressed' };
  const tree = proofR.tree_id || comp.tree;
  let canopyDepth = 0;
  try {
    const acc = await rpc(rpcUrl(), 'getAccountInfo', [tree, { encoding: 'base64' }]);
    const b64 = acc?.value?.data?.[0];
    if (b64) canopyDepth = canopyFromAccount(Buffer.from(b64, 'base64'));
  } catch (_) {}
  return {
    owner: asset.ownership?.owner,
    delegate: asset.ownership?.delegate || null,
    dataHash: comp.data_hash,
    creatorHash: comp.creator_hash,
    leafId: comp.leaf_id,
    tree,
    root: proofR.root,
    proof: proofR.proof || [],
    canopyDepth,
    compressed: true,
  };
}

module.exports = { getAddress, getBlockhash, broadcast, simulate, getNfts, getCnftContext, rpcUrl, get RPC() { return rpcUrl(); } };
