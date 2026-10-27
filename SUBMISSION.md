# ZECATHON submission: Stowaway

- **Name:** Stowaway
- **Track:** Cross-chain
- **Demo:** https://stowaway.nerom.site
- **Repo:** https://github.com/neromtoobad/stowaway (public by the deadline)
- **Video:** (YouTube link)

## Description (paste into the form)

Stowaway lets you trade shielded ZEC for USDC on Arc, person to person, with no bridge, no wrapped coin and no unshielding.

1. A maker locks USDC in an escrow on Arc and asks for ZEC at a one-time shielded address. The browser seals that address to the Watch's keys, so Arc stores only its hash.
2. A taker holds the order. The Watch relays the hold, so the taker needs no gas and no Arc history. The taker then pays the ZEC from any shielded wallet, such as Zodl, with a memo that binds the payment to the order and to the payout address.
3. The taker sends a chit: a disclosure of that single output.
4. Three Watch keys each fetch the mined transaction from their own lightwalletd and decrypt the output with the official orchard crate (WASM). Each checks the payee, the amount and the memo, then signs an EIP-712 claim.
5. The contract releases the USDC on 2 of 3 distinct signatures and marks the output spent, so it can never pay twice.

Privacy: the ZEC never leaves the shielded pool, and no viewing key leaves the user's tab. Arc never sees a Zcash address, only its hash. The chit's hash stays on Arc, and anyone holding the chit can re-check the settlement in their browser.

Real:
- the Zcash MAINNET payments;
- the escrow on Arc testnet, holding Circle's testnet USDC;
- the gasless relays;
- the 2-of-3 signatures;
- the chit verification against mined transactions.

Trusted: the Watch (2 of 3). Its signatures are public and its claims can be re-checked, but there is no slashing yet, and in this build the three keys run in one service.

Testnet: the USDC side.

Tests: 11 Foundry tests (quorum, forged and duplicate signatures, mismatched claims, one-output-one-order, holds, cancel) plus Watch tests.
