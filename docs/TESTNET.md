# Testnet Mode

Wonder Wallet has a global **Mainnet ⇄ Testnet** toggle so you can experiment with the full wallet —
sends, Counterparty issuance, dApp connections, EVM/Solana transactions — with **no real value** at
stake. It spans the key engine, the server proxy, the Terminal, and the extension.

## Networks

| Chain | Testnet | Notes |
|---|---|---|
| Bitcoin | **testnet4** (mempool.space/testnet4) | different addresses (`tb1…`/`m`/`n`/`2`) |
| Counterparty | **testnet4** (`testnet4.counterparty.io`) | full issuance / sends / dispensers / DEX + classic Stamp minting |
| Ethereum | **Sepolia** (chainId 11155111) | same address as mainnet; keyless public RPC |
| Solana | **devnet** | same address as mainnet |

Get test coins from the in-wallet **🚰 faucet** links (Bitcoin testnet4, Sepolia, Solana devnet).

## How it works

- **Key derivation.** Testnet Bitcoin uses **BIP-44 coin type 1′** (`m/84'/1'/…`, `m/44'/1'/…`, etc.)
  plus testnet address encoding — a *different* key set, so testnet addresses can never collide with
  mainnet. Ethereum and Solana reuse the same key on their testnets; only the network endpoint changes.
- **Request routing.** The client sends the network as a `?network=testnet` **query parameter**. A
  server middleware (`sources/netctx.js`, backed by `AsyncLocalStorage`) makes it the per-request
  context, and each data source resolves its upstream base URL from it. EVM selects its network by name
  (`ethereum` / `sepolia`). Cache keys are network-scoped, and JSON data routes are `no-store`, so a
  mainnet body can never be served for a testnet request or vice-versa.
  - *Why a query param and not a header?* The extension calls the proxy cross-origin. A custom header
    trips a CORS preflight the platform proxy rejects; a query param is a "simple" request (no
    preflight) **and** gives testnet its own cache-distinct URL.
- **Signing.** The signer derives the coin-type-1′ key on testnet, so a testnet transaction is signed
  by the matching testnet key. Cross-network signing is impossible — a mainnet key cannot sign a
  testnet input, and a testnet send rejects a mainnet recipient (`tests/testnet-isolation.mjs`).
- **UX.** A persistent orange banner lives **inside the wallet window** (not across the page — only the
  wallet is on testnet). Fiat is hidden ("no value"). On the extension the network is a global toggle
  under **Advanced → Network**; on the Terminal it's a chip in the wallet card header.

## Deliberate limits

- **Stamps / SRC-20 have no reliable public testnet indexer.** So on testnet, SRC-20 deploy / mint /
  transfer run as a **local dry run**: the wallet constructs the exact SRC-20 inscription and estimates
  its cost, but returns **no broadcastable transaction**. You can test the construction path at zero
  risk; there is nothing to broadcast.
- **Classic Stamps** (Counterparty-encoded) *can* be minted on testnet4 through the Counterparty node.
- **SRC-101 (`.btc`) names** stay on mainnet.
- The extension **dApp provider** follows a connected dApp's own chain; the global toggle governs the
  wallet's own view. A connected testnet address makes the Terminal mirror testnet automatically.

## Environment overrides

All testnet endpoints default to public nodes. To point at your own:

```
BTC_API_TESTNET   # default https://mempool.space/testnet4/api
CP_API_TESTNET    # default https://testnet4.counterparty.io:44000/v2
SEPOLIA_RPC       # default https://sepolia.drpc.org
SOL_RPC_DEVNET    # default https://api.devnet.solana.com
```
