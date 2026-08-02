/**
 * Ethereum / EVM read + tx-prep layer (Phase 2 + 7). Public RPC, network switch
 * (ETH/Base/Arbitrum). Native + curated ERC-20 (full enumeration needs an indexer).
 * Signing happens client-side; this module only reads + prepares + relays.
 */
'use strict';

const { rpc, pool, cacheGet, cacheSet, fetchJson } = require('./http');

// NFT gallery via Alchemy NFT API (enabled when ALCHEMY_KEY is set). Tolerate any env casing.
const ALCHEMY_KEY = process.env.ALCHEMY_KEY || (function () { const k = Object.keys(process.env).find((x) => x.toLowerCase() === 'alchemy_key'); return k ? process.env[k] : null; })();
const ALCHEMY_NET = { ethereum: 'eth-mainnet', base: 'base-mainnet', arbitrum: 'arb-mainnet', sepolia: 'eth-sepolia' };

const NETWORKS = {
  ethereum: { name: 'Ethereum', chainId: 1, rpc: process.env.ETH_RPC || 'https://eth.drpc.org', explorer: 'https://etherscan.io' },
  base: { name: 'Base', chainId: 8453, rpc: process.env.BASE_RPC || 'https://base.drpc.org', explorer: 'https://basescan.org' },
  arbitrum: { name: 'Arbitrum', chainId: 42161, rpc: process.env.ARB_RPC || 'https://arbitrum.drpc.org', explorer: 'https://arbiscan.io' },
  // Testnet Mode → Sepolia (chainId 11155111). Keyless public RPC; same address as mainnet.
  sepolia: { name: 'Sepolia', chainId: 11155111, rpc: process.env.SEPOLIA_RPC || 'https://sepolia.drpc.org', explorer: 'https://sepolia.etherscan.io', testnet: true },
};
const net = (n) => NETWORKS[n] || NETWORKS.ethereum;

// Curated majors per network (address, symbol, decimals). Discovery via indexer = Phase 7+.
const TOKENS = {
  ethereum: [
    { symbol: 'USDC', addr: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
    { symbol: 'USDT', addr: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
    { symbol: 'DAI', addr: '0x6B175474E89094C44Da98b954EedeAC495271d0F', decimals: 18 },
    { symbol: 'WETH', addr: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', decimals: 18 },
  ],
  base: [{ symbol: 'USDC', addr: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 }],
  arbitrum: [{ symbol: 'USDC', addr: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6 }],
};

const BALANCE_OF = '0x70a08231';
const pad = (addr) => addr.toLowerCase().replace(/^0x/, '').padStart(64, '0');
const hexToFloat = (hex, decimals) => {
  const n = BigInt(hex || '0x0'), d = 10n ** BigInt(decimals);
  return Number(n / d) + Number(n % d) / Number(d);
};

async function getAddress(address, network = 'ethereum') {
  const N = net(network);
  const key = `eth:${network}:${address}`;
  const hit = cacheGet(key);
  if (hit) return hit;

  const balHex = await rpc(N.rpc, 'eth_getBalance', [address, 'latest']);
  const eth = hexToFloat(balHex, 18);
  const list = TOKENS[network] || [];
  const tokens = (await pool(list, async (t) => {
    const res = await rpc(N.rpc, 'eth_call', [{ to: t.addr, data: BALANCE_OF + pad(address) }, 'latest']);
    const amount = hexToFloat(res, t.decimals);
    return amount > 0 ? { symbol: t.symbol, amount, address: t.addr, decimals: t.decimals } : null;
  }, 4)).filter((x) => x && !x.__error);

  const out = { address, network, networkName: N.name, chainId: N.chainId, explorer: N.explorer, eth, tokens, networks: Object.keys(NETWORKS) };
  cacheSet(key, out, 30_000);
  return out;
}

/** Prepare an EIP-1559 tx: nonce, chainId, gas, fees. Client signs the result. */
async function prepareTx({ from, to, valueWei = '0x0', data = '0x', network = 'ethereum' }) {
  const N = net(network);
  const value = valueWei.startsWith && valueWei.startsWith('0x') ? valueWei : '0x' + BigInt(valueWei).toString(16);
  const [nonceHex, gasHex, block] = await Promise.all([
    rpc(N.rpc, 'eth_getTransactionCount', [from, 'pending']),
    rpc(N.rpc, 'eth_estimateGas', [{ from, to, value, data }]).catch(() => '0x5208'),
    rpc(N.rpc, 'eth_getBlockByNumber', ['latest', false]),
  ]);
  let maxPriority;
  try { maxPriority = BigInt(await rpc(N.rpc, 'eth_maxPriorityFeePerGas', [])); } catch { maxPriority = 1_000_000_000n; }
  const baseFee = BigInt(block.baseFeePerGas || '0x0');
  const maxFee = baseFee * 2n + maxPriority;
  const gasLimit = (BigInt(gasHex) * 12n) / 10n; // +20% buffer
  return {
    nonce: Number(BigInt(nonceHex)), chainId: N.chainId,
    maxFeePerGas: '0x' + maxFee.toString(16), maxPriorityFeePerGas: '0x' + maxPriority.toString(16),
    gasLimit: '0x' + gasLimit.toString(16), estGas: '0x' + gasLimit.toString(16),
  };
}

async function broadcast(raw, network = 'ethereum') {
  const N = net(network);
  return rpc(N.rpc, 'eth_sendRawTransaction', [raw]); // returns txhash or throws rpc error
}

// ERC-721 / 1155 gallery via Alchemy. Returns { items:[{id,name,image,contract,tokenId}], enabled }.
async function getNfts(address, network = 'ethereum') {
  if (!ALCHEMY_KEY) return { items: [], enabled: false };
  const sub = ALCHEMY_NET[network] || 'eth-mainnet';
  const key = `eth:nfts:${network}:${address}`;
  const hit = cacheGet(key);
  if (hit) return hit;
  try {
    // NB: the brackets in excludeFilters[] MUST be percent-encoded (%5B%5D) — Alchemy's edge 403s on raw "[]".
    const url = `https://${sub}.g.alchemy.com/nft/v3/${ALCHEMY_KEY}/getNFTsForOwner?owner=${encodeURIComponent(address)}&withMetadata=true&pageSize=100&excludeFilters%5B%5D=SPAM`;
    const j = await fetchJson(url, { timeout: 9000 });
    const items = (j.ownedNfts || [])
      .filter((n) => n.tokenType !== 'ERC20')
      .map((n) => {
        const img = (n.image && (n.image.thumbnailUrl || n.image.cachedUrl || n.image.pngUrl || n.image.originalUrl)) || null;
        return { id: `${(n.contract && n.contract.address) || ''}:${n.tokenId}`, name: n.name || (n.contract && n.contract.name) || `#${n.tokenId}`, image: img, contract: n.contract && n.contract.address, tokenId: n.tokenId, tokenType: n.tokenType || (n.contract && n.contract.tokenType) || 'ERC721' };
      })
      .filter((n) => n.image); // only tiles with resolvable art
    const out = { items, enabled: true };
    cacheSet(key, out, 60_000);
    return out;
  } catch (_) { return { items: [], enabled: true }; }
}

// Generic JSON-RPC passthrough so Wonder Wallet can act as a full EIP-1193 provider for dApps
// (eth_call, eth_getBalance, eth_blockNumber, eth_estimateGas, eth_getLogs, …). Read/relay only —
// signing never happens here. The provider background allowlists which methods reach this.
async function rpcCall(method, params, network = 'ethereum') {
  return rpc(net(network).rpc, method, Array.isArray(params) ? params : (params == null ? [] : [params]));
}

module.exports = { getAddress, prepareTx, broadcast, getNfts, rpcCall, NETWORKS, net };
