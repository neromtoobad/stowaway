// One Watch: checks a claim against the real Zcash transaction and, only if every check
// passes, signs it. A Watch sees one output (the chit) and the maker's one-time address.
// It never holds a viewing key and never sees any other output of the payer's wallet.
import { createRequire } from 'node:module';
import { keccak256, toBytes } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { envelopeSecret, envelopePublic, open } from './envelope.js';
import { bytesToHex } from '@noble/hashes/utils.js';

const chit = createRequire(import.meta.url)('../chit/chit_wasm.js');

export const memoFor = (chainId, id, taker) => `stowaway:${chainId}:${id}:${taker.toLowerCase()}`;

export const CLAIM_TYPES = {
  Claim: [
    { name: 'id', type: 'uint256' },
    { name: 'txid', type: 'bytes32' },
    { name: 'action', type: 'uint32' },
    { name: 'zats', type: 'uint64' },
    { name: 'addrHash', type: 'bytes32' },
    { name: 'taker', type: 'address' },
    { name: 'chitHash', type: 'bytes32' },
  ],
};

export function makeWatch({ index, key, lwd, network, minConf, chainId, contract }) {
  const account = privateKeyToAccount(key);
  const secret = envelopeSecret(key);
  const domain = { name: 'Stowaway', version: '1', chainId, verifyingContract: contract };

  /** The maker's one-time address, if this Watch's copy opens and matches the on-chain hash. */
  function address(order) {
    const ua = open(order.envelope, index, secret);
    if (!ua || keccak256(toBytes(ua)) !== order.addrHash) return null;
    return ua;
  }

  /** Checks one claim. Returns { ok, steps, claim?, signature?, waiting? }. */
  async function check(order, chitText) {
    const steps = [];
    const step = (id, label, ok) => {
      steps.push({ id, label, ok });
      return ok;
    };
    const fail = (extra = {}) => ({ ok: false, watch: account.address, steps, ...extra });

    if (!step('state', 'Order is held for this taker', order.state === 2 && !!order.taker)) return fail();
    let header;
    try {
      header = JSON.parse(chit.inspect(chitText.trim()));
    } catch (e) {
      step('decode', `Chit decodes (${e.message ?? e})`, false);
      return fail();
    }
    if (!step('network', `Chit is for Zcash ${network === 'main' ? 'mainnet' : 'testnet'}`, header.network === network)) return fail();

    const ua = address(order);
    if (!step('envelope', 'Sealed address opens and matches its on-chain hash', !!ua)) return fail();

    let tx, tip;
    try {
      [tx, tip] = await Promise.all([lwd.tx(header.txid), lwd.tip()]);
    } catch (e) {
      step('fetch', `Transaction fetched from lightwalletd (${e.details ?? e.message ?? e})`, false);
      return fail({ retry: true });
    }
    step('fetch', `Transaction ${header.txid.slice(0, 12)}… fetched and re-hashed`, true);
    const conf = tx.height ? tip - tx.height + 1 : 0;
    if (!step('mined', `Mined with ${conf} of ${minConf} confirmations`, conf >= minConf)) {
      return fail({ waiting: true, confirmations: conf });
    }

    const report = JSON.parse(chit.verify(tx.hex, chitText.trim()));
    for (const s of report.steps) steps.push({ id: `chit.${s.id}`, label: s.label, ok: s.ok });
    if (!step('chit', 'Chit decrypts this output (official orchard crate)', report.valid)) return fail();
    const v = report.verified;
    if (!step('payee', "Output paid the maker's one-time address", chit.same_receiver(v.recipient, ua, network))) return fail();
    if (!step('amount', `Output carries ${v.value_zat} zats, order asks ${order.zats}`, BigInt(v.value_zat) >= BigInt(order.zats))) return fail();
    const memo = memoFor(chainId, order.id, order.taker);
    const said = v.memo.kind === 'text' ? v.memo.value.trim() : '';
    if (!step('memo', `Memo names this order and taker`, said === memo)) return fail();

    const claim = {
      id: BigInt(order.id),
      txid: `0x${header.txid}`,
      action: v.action,
      zats: BigInt(v.value_zat),
      addrHash: order.addrHash,
      taker: order.taker,
      chitHash: keccak256(toBytes(chitText.trim())),
    };
    const signature = await account.signTypedData({ domain, types: CLAIM_TYPES, primaryType: 'Claim', message: claim });
    step('sign', `Signed by Watch ${index + 1}`, true);
    return { ok: true, watch: account.address, steps, claim, signature, height: tx.height };
  }

  return {
    index,
    address: account.address,
    envelopeKey: bytesToHex(envelopePublic(secret)),
    endpoint: lwd.endpoint,
    open: address,
    check,
  };
}
