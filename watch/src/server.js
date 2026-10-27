// The Watch service: an order index, gasless holds, address tickets for the taker who holds
// an order, and claims checked by three Watch keys (two must sign) and relayed to Arc.
import http from 'node:http';
import { createHmac, randomBytes } from 'node:crypto';
import { createPublicClient, createWalletClient, http as rpc, defineChain, parseAbi, keccak256, toBytes, verifyMessage, isAddress, getAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { lightwalletd } from './lwd.js';
import { makeWatch, memoFor } from './watch.js';

const env = process.env;
const need = (k) => env[k] || (console.error(`missing ${k}`), process.exit(1));
const PORT = Number(env.PORT || 8790);
const RPC = env.RPC || 'https://rpc.testnet.arc.io';
const CONTRACT = getAddress(env.STOWAWAY || '0xBdd7C288c48EdeCfb812E21F2d270459A2eDc752');
const FROM_BLOCK = BigInt(env.FROM_BLOCK || 69354900);
const NETWORK = env.ZCASH_NETWORK || 'main';
const MIN_CONF = Number(env.MIN_CONF || 2);
const LWD = (env.LWD || 'zec.rocks:443,na.zec.rocks:443,eu.zec.rocks:443').split(',');
const TICKET_SECRET = env.TICKET_SECRET || randomBytes(32).toString('hex');
const ORIGINS = (env.ORIGINS || '*').split(',');

const arc = defineChain({
  id: Number(env.CHAIN_ID || 5042002),
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});
const pub = createPublicClient({ chain: arc, transport: rpc(RPC) });
const relayer = createWalletClient({ chain: arc, transport: rpc(RPC), account: privateKeyToAccount(need('WATCH1_KEY')) });

const abi = parseAbi([
  'event Posted(uint256 indexed id, address indexed maker, uint96 usdc, uint64 zats, uint64 expiry, bytes32 addrHash, bytes envelope)',
  'event Reserved(uint256 indexed id, address indexed taker, uint64 lockUntil)',
  'event Settled(uint256 indexed id, address indexed taker, bytes32 txid, uint32 action, bytes32 chitHash)',
  'event Cancelled(uint256 indexed id)',
  'function orders(uint256) view returns (address maker, uint96 usdc, uint64 zats, uint64 expiry, address taker, uint64 lockUntil, uint8 state, bytes32 addrHash)',
  'function reserve(uint256 id, address taker)',
  'function settle((uint256 id, bytes32 txid, uint32 action, uint64 zats, bytes32 addrHash, address taker, bytes32 chitHash) c, bytes[] sigs)',
  'function watches() view returns (address[3])',
]);

const watches = [1, 2, 3].map((n, i) =>
  makeWatch({
    index: i,
    key: need(`WATCH${n}_KEY`),
    lwd: lightwalletd(LWD[i % LWD.length]),
    network: NETWORK,
    minConf: MIN_CONF,
    chainId: arc.id,
    contract: CONTRACT,
  }),
);
const lwd = lightwalletd(LWD[0]);

// ---- order index (rebuilt from logs; the contract is the source of truth) ----

const orders = new Map(); // id -> order
const STATES = ['none', 'open', 'held', 'settled', 'cancelled'];
let scanned = FROM_BLOCK - 1n;

async function refresh(id) {
  const o = orders.get(id);
  const [maker, usdc, zats, expiry, taker, lockUntil, state, addrHash] = await pub.readContract({ address: CONTRACT, abi, functionName: 'orders', args: [BigInt(id)] });
  Object.assign(o, { maker, usdc: Number(usdc), zats: Number(zats), expiry: Number(expiry), taker: state === 2 ? taker : null, lockUntil: Number(lockUntil), state, addrHash });
  return o;
}

async function index() {
  const head = await pub.getBlockNumber();
  while (scanned < head) {
    const to = scanned + 10_000n < head ? scanned + 10_000n : head;
    const logs = await pub.getLogs({ address: CONTRACT, events: abi.filter((x) => x.type === 'event'), fromBlock: scanned + 1n, toBlock: to });
    for (const l of logs) {
      const id = Number(l.args.id);
      if (l.eventName === 'Posted') {
        const usable = watches.map((w) => !!w.open({ envelope: l.args.envelope, addrHash: l.args.addrHash }));
        orders.set(id, { id, envelope: l.args.envelope, postedTx: l.transactionHash, postedBlock: Number(l.blockNumber), checked: usable.filter(Boolean).length >= 2, events: [] });
      }
      const o = orders.get(id);
      if (!o) continue;
      o.events.push({ kind: l.eventName, tx: l.transactionHash, block: Number(l.blockNumber), ...(l.eventName === 'Settled' ? { zcashTxid: l.args.txid.slice(2), action: l.args.action, chitHash: l.args.chitHash, taker: l.args.taker } : {}) });
      await refresh(id);
    }
    scanned = to;
  }
}

async function loop() {
  try {
    await index();
    // Holds lapse without an event; re-read held orders now and then.
    const now = Date.now() / 1000;
    for (const o of orders.values()) if (o.state === 2 && o.lockUntil < now) await refresh(o.id);
  } catch (e) {
    console.error('index', e.shortMessage ?? e.message);
  }
  setTimeout(loop, 8000);
}

const publicOrder = (o) => ({
  id: o.id,
  maker: o.maker,
  usdc: o.usdc,
  zats: o.zats,
  expiry: o.expiry,
  state: STATES[o.state],
  taker: o.taker,
  lockUntil: o.lockUntil,
  addrHash: o.addrHash,
  checked: o.checked,
  postedTx: o.postedTx,
  events: o.events,
});

// ---- tickets: only the taker who holds an order may read the maker's address ----

const ticketFor = (o) => createHmac('sha256', TICKET_SECRET).update(`${o.id}:${o.taker.toLowerCase()}:${o.lockUntil}`).digest('hex');
const ticketMessage = (id, taker) => `Stowaway: show me the Zcash address for order ${id}, held for ${taker.toLowerCase()}`;

function paymentFor(o) {
  const ua = watches.map((w) => w.open(o)).find(Boolean);
  if (!ua) return null;
  const memo = memoFor(arc.id, o.id, o.taker);
  const zec = (o.zats / 1e8).toFixed(8).replace(/\.?0+$/, '');
  const b64 = Buffer.from(memo).toString('base64url');
  return { address: ua, zats: o.zats, zec, memo, uri: `zcash:${ua}?amount=${zec}&memo=${b64}` };
}

// ---- HTTP ----

const hits = new Map();
function limited(req, bucket, max, windowMs) {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const k = `${bucket}:${ip}`;
  const now = Date.now();
  const h = (hits.get(k) || []).filter((t) => now - t < windowMs);
  h.push(now);
  hits.set(k, h);
  return h.length > max;
}

const json = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body, (_, v) => (typeof v === 'bigint' ? v.toString() : v)));
};

async function body(req) {
  let s = '';
  for await (const c of req) {
    s += c;
    if (s.length > 16_384) throw new Error('body too large');
  }
  return s ? JSON.parse(s) : {};
}

const settling = new Set();

const routes = {
  'GET /v1/health': async () => [
    200,
    {
      ok: true,
      chainId: arc.id,
      contract: CONTRACT,
      zcash: { network: NETWORK, minConf: MIN_CONF, tip: await lwd.tip().catch(() => null) },
      watches: watches.map((w) => ({ address: w.address, envelopeKey: w.envelopeKey, lightwalletd: w.endpoint })),
      indexed: Number(scanned),
    },
  ],
  'GET /v1/orders': async () => [200, { orders: [...orders.values()].sort((a, b) => b.id - a.id).map(publicOrder) }],
  'GET /v1/order': async (_req, q) => {
    const o = orders.get(Number(q.get('id')));
    return o ? [200, publicOrder(await refresh(o.id))] : [404, { error: 'no such order' }];
  },
  'POST /v1/hold': async (req) => {
    if (limited(req, 'hold', 6, 3600_000)) return [429, { error: 'Too many holds from here. Try again later.' }];
    const { id, taker } = await body(req);
    if (!isAddress(taker ?? '')) return [400, { error: 'Payout address must be an Arc (EVM) address.' }];
    const o = orders.get(Number(id));
    if (!o) return [404, { error: 'No such order.' }];
    if (!o.checked) return [409, { error: "The Watch can't open this order's address, so nobody should pay it." }];
    await refresh(o.id);
    const now = Date.now() / 1000;
    if (o.state === 2 && o.lockUntil >= now) return [409, { error: 'Someone holds this order. Try again when the hold lapses.' }];
    if (o.state !== 1 && o.state !== 2) return [409, { error: `Order is ${STATES[o.state]}.` }];
    const hash = await relayer.writeContract({ address: CONTRACT, abi, functionName: 'reserve', args: [BigInt(o.id), getAddress(taker)], gasPrice: 30_000_000_000n });
    const rc = await pub.waitForTransactionReceipt({ hash });
    if (rc.status !== 'success') return [502, { error: 'Hold transaction failed.', tx: hash }];
    await refresh(o.id);
    return [200, { tx: hash, lockUntil: o.lockUntil, ticket: ticketFor(o), pay: paymentFor(o) }];
  },
  'POST /v1/ticket': async (req) => {
    const { id, ticket, signature } = await body(req);
    const o = orders.get(Number(id));
    if (!o) return [404, { error: 'No such order.' }];
    await refresh(o.id);
    if (o.state !== 2) return [409, { error: 'Order is not held.' }];
    const okTicket = ticket && ticket === ticketFor(o);
    const okSig = signature && (await verifyMessage({ address: o.taker, message: ticketMessage(o.id, o.taker), signature }).catch(() => false));
    if (!okTicket && !okSig) return [403, { error: 'Only the taker holding this order can see its address.' }];
    return [200, { lockUntil: o.lockUntil, pay: paymentFor(o) }];
  },
  'POST /v1/claim': async (req) => {
    if (limited(req, 'claim', 30, 600_000)) return [429, { error: 'Slow down.' }];
    const { id, chit } = await body(req);
    const o = orders.get(Number(id));
    if (!o || typeof chit !== 'string' || chit.length > 4000) return [400, { error: 'Send { id, chit }.' }];
    await refresh(o.id);
    if (o.state === 3) return [200, { settled: true, order: publicOrder(o) }];
    const reports = await Promise.all(watches.map((w) => w.check(o, chit)));
    const signed = reports.filter((r) => r.ok);
    const result = { order: publicOrder(o), reports: reports.map(({ watch, steps, ok, waiting, confirmations }) => ({ watch, ok, steps, waiting, confirmations })) };
    if (signed.length < 2) {
      const waiting = reports.find((r) => r.waiting);
      return [waiting ? 202 : 422, { ...result, waiting: !!waiting, confirmations: waiting?.confirmations }];
    }
    if (settling.has(o.id)) return [202, { ...result, settling: true }];
    settling.add(o.id);
    try {
      const claim = signed[0].claim;
      const sigs = signed.map((r) => r.signature);
      const hash = await relayer.writeContract({ address: CONTRACT, abi, functionName: 'settle', args: [claim, sigs], gasPrice: 30_000_000_000n });
      const rc = await pub.waitForTransactionReceipt({ hash });
      await refresh(o.id);
      return [rc.status === 'success' ? 200 : 502, { ...result, order: publicOrder(o), settled: rc.status === 'success', tx: hash, claim, sigs }];
    } finally {
      settling.delete(o.id);
    }
  },
  'GET /v1/tx': async (_req, q) => {
    const txid = (q.get('txid') || '').toLowerCase();
    const t = await lwd.tx(txid);
    return [200, { txid, ...t, tip: await lwd.tip() }];
  },
};

http
  .createServer(async (req, res) => {
    const origin = req.headers.origin;
    if (origin && (ORIGINS.includes('*') || ORIGINS.includes(origin))) {
      res.setHeader('access-control-allow-origin', ORIGINS.includes('*') ? '*' : origin);
      res.setHeader('access-control-allow-headers', 'content-type');
      res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    }
    if (req.method === 'OPTIONS') return res.writeHead(204).end();
    const url = new URL(req.url, 'http://x');
    const route = routes[`${req.method} ${url.pathname}`];
    if (!route) return json(res, 404, { error: 'not found' });
    try {
      const [code, out] = await route(req, url.searchParams);
      json(res, code, out);
    } catch (e) {
      console.error(req.url, e);
      json(res, 500, { error: e.shortMessage ?? e.details ?? e.message ?? 'error' });
    }
  })
  .listen(PORT, () => {
    console.log(`watch on :${PORT}, contract ${CONTRACT}, zcash ${NETWORK} via ${LWD.join(', ')}`);
    loop();
  });

export { ticketMessage };
