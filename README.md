# Stowaway

**Trade shielded ZEC for USDC on Arc, person to person. No bridge, no wrapped coin, no unshielding.**

The USDC waits in an escrow contract on Arc. The ZEC goes from one shielded wallet to another and never leaves the shielded pool. What crosses between the two chains is a claim about one shielded output, signed by two of three Watch keys and backed by a proof anyone can re-check.

**Live:** https://stowaway.nerom.site. Watch API: https://stowaway-watch-production.up.railway.app/v1/health

## The crossing

| Step | Who | What happens |
| --- | --- | --- |
| **Post** | The Quartermaster (wants ZEC) | Locks USDC with `post(usdc, zats, expiry, keccak256(address), envelope)`. The envelope is their one-time Zcash address, sealed in the browser to each Watch's X25519 key. Arc stores only the hash and the sealed copies. The contract refuses an address hash it has seen before. |
| **Hold** | The Stowaway (wants USDC) | `reserve(id, taker)` holds the order for 60 minutes. The Watch relays it, so the taker needs no gas and no Arc history: the payout address can be brand new. The address is released only to the holder, through a ticket. |
| **Pay** | The Stowaway | Pays the ZEC from any shielded wallet (Zodl, Zingo, Ywallet…) to a ZIP 321 request. The memo `stowaway:<chain>:<order>:<taker>` binds the payment to one order and one payout address. |
| **Prove** | The Stowaway | Sends a **chit**: a single-output disclosure (Orchard/Ironwood, ZIP 311 style) of that payment. It can be made in the page from the payer's or payee's viewing key, which never leaves the tab, or at [chit.nerom.site](https://chit.nerom.site). |
| **Check** | The Watch, three keys | Each key independently: opens its copy of the sealed address; fetches the transaction from its **own lightwalletd** (zec.rocks, na.zec.rocks, eu.zec.rocks); re-hashes the bytes to the txid; requires 2 confirmations; decrypts the output with the official `orchard` crate (via [chit-zcash](https://github.com/neromtoobad/chit) in WebAssembly); then checks payee, amount and exact memo. Only then does it sign an EIP-712 `Claim(id, txid, action, zats, addrHash, taker, chitHash)`. |
| **Settle** | The contract | Needs two **distinct** Watch signatures (high-s rejected). It re-checks the claim against the order (taker, address hash, amount), marks `(txid, action)` spent so one output can never pay twice, and sends the USDC. |
| **Audit** | Anyone with the chit | Arc keeps the chit hash forever. The maker and the taker hold the chit, and anyone can re-verify a settlement in their own browser on `#/audit`. A Watch that signs a bad claim is caught in the open. |

## Who sees what

|  | Arc chain | Zcash chain | The Watch | Counterparty |
| --- | --- | --- | --- | --- |
| The maker's Zcash address | hash only | — | yes | the payer |
| The ZEC payment | — | that a shielded tx exists | one output | yes |
| Who paid the ZEC | — | — | — | — |
| USDC amount and price | yes | — | yes | yes |
| Payer's wallet, balance, history | — | — | — | — |
| Any viewing key | — | — | — | — |

A chit opens exactly one output of one transaction. It cannot reveal other outputs, the change, the sender, or anything else in the wallet.

## Layout

```
contracts/   Foundry. Stowaway.sol: escrow, holds, 2-of-3 EIP-712 claims, one-time addresses, spent outputs (11 tests)
watch/       Node. Order index, gasless holds, tickets, claim checks by three keys, settle relay
  src/lwd.js        lightwalletd gRPC (GetTransaction re-hashed to the txid, GetLatestBlock)
  src/envelope.js   X25519 + XChaCha20-Poly1305 sealed addresses
  src/watch.js      one Watch: every check, then an EIP-712 signature
  chit/             chit-zcash built for Node (official orchard / zcash_note_encryption crates, WASM)
web/         Vite + TypeScript, strict CSP. Board, post, hold, ZIP 321 QR, make-a-chit, audit
```

**Deployments:**
- Arc testnet (chain 5042002), Stowaway [`0xBdd7C288c48EdeCfb812E21F2d270459A2eDc752`](https://testnet.arcscan.app/address/0xBdd7C288c48EdeCfb812E21F2d270459A2eDc752), with USDC at `0x3600…0000` (Circle's native USDC).
- Watch keys `0x6b05…CbDf`, `0xB0d7…35B2`, `0x16d1…BEB5`.

```
cd contracts && forge test
cd watch && npm i && npm test && WATCH1_KEY=… WATCH2_KEY=… WATCH3_KEY=… npm start
cd web && npm i && VITE_WATCH=http://localhost:8790 npm run dev
```

## What is real, and what is not

- **Real:**
  - ZEC on **Zcash mainnet**. Claims are checked against mined transactions.
  - The escrow on **Arc testnet**, holding real testnet USDC from Circle.
  - Gasless holds and settlements relayed on Arc.
  - Chit verification with the official Zcash crates.
  - Three independent lightwalletd sources.
- **Trusted:** the Watch, two of three. Its signatures are public, every claim names one exact output, and anyone holding the chit can re-check a settlement. Cheating is provable but not yet slashable on chain. In this build the three keys run in one service. The protocol and the contract let each run separately (each key already uses its own lightwalletd).
- **Testnet:** the USDC side. Mainnet ZEC for testnet USDC, so keep trades tiny.
- **Not built:**
  - Slashing bonds for Watch keys.
  - A taker-side "ask" book: only makers post orders.
  - On-chain Zcash light-client verification. That would need Arc to follow Zcash consensus; Stowaway deliberately carries one checked claim instead.
- **Known limits:**
  - A taker who pays after their hold lapses can lose the race to a new holder.
  - Holds are free, so the Watch rate-limits them.
  - The price is public on Arc.

Built for ZECATHON, Cross-chain track. Characters are original pixel art (see `art/CREDITS.md`).

MIT OR Apache-2.0.
