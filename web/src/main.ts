import '@fontsource/big-shoulders-stencil-display/700';
import '@fontsource/big-shoulders-stencil-display/900';
import '@fontsource-variable/instrument-sans';
import '@fontsource-variable/jetbrains-mono';
import './style.css';
import qrcode from 'qrcode-generator';
import { keccak256, toBytes, parseEventLogs, isAddress, getAddress } from 'viem';
import { ready, scan, sameReceiver, verify, inspect, type Found } from 'chit-zcash';
import * as api from './api';
import { ABI, CONTRACT, ERC20, FAUCET, USDC, ZNET, arcAddr, arcTx, zecTx } from './config';
import { h, copy, short, sleep, art } from './dom';
import { seal } from './envelope';
import { connectBrowser, connectBurner, disconnect, hasBrowserWallet, onWallet, pub, send, store, usdcBalance, wallet } from './wallet';

const app = document.getElementById('app')!;
const usd = (u: number) => (u / 1e6).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
const zec = (z: number) => (z / 1e8).toFixed(8).replace(/\.?0+$/, '');
const ago = (t: number) => {
  const s = Math.round(t - Date.now() / 1000);
  const a = Math.abs(s);
  const v = a < 120 ? `${a}s` : a < 7200 ? `${Math.round(a / 60)} min` : a < 172800 ? `${Math.round(a / 3600)} h` : `${Math.round(a / 86400)} d`;
  return s >= 0 ? `in ${v}` : `${v} ago`;
};
const STATE_LABEL: Record<api.State, string> = { open: 'Open', held: 'Held', settled: 'Settled', cancelled: 'Cancelled' };
const chip = (s: api.State) => h('span', { class: `chip ${s}` }, STATE_LABEL[s]);
const ext = (href: string, text: string) => h('a', { href, target: '_blank', rel: 'noopener' }, text);
const errBox = (e: unknown) => h('p', { class: 'err' }, e instanceof Error ? e.message : String(e));

// ---------- shell ----------

function walletChip() {
  const w = wallet();
  const box = h('div', { class: 'wallet' });
  if (!w) {
    box.append(
      h('button', { class: 'btn ghost sm', onclick: () => pickWallet() }, 'Connect Arc wallet'),
    );
    return box;
  }
  const bal = h('span', { class: 'mono dim' }, '…');
  usdcBalance(w.address).then((b) => (bal.textContent = `${b.toFixed(2)} USDC`)).catch(() => (bal.textContent = ''));
  box.append(
    h('span', { class: `dot ${w.kind}` }),
    h('a', { class: 'mono', href: arcAddr(w.address), target: '_blank', rel: 'noopener', title: w.address }, short(w.address, 6, 4)),
    bal,
    h('button', { class: 'link', onclick: () => disconnect() }, 'disconnect'),
  );
  return box;
}

function pickWallet() {
  const dlg = h('dialog', { class: 'modal' });
  const close = () => (dlg.close(), dlg.remove());
  dlg.append(
    h('h3', {}, 'Connect to Arc testnet'),
    h('p', { class: 'dim' }, 'Arc pays gas in USDC, so one faucet covers everything. Get test USDC at ', ext(FAUCET, 'faucet.circle.com'), ' (pick Arc Testnet).'),
    h('div', { class: 'row' },
      h('button', { class: 'btn', disabled: !hasBrowserWallet(), onclick: async () => { try { await connectBrowser(); close(); } catch (e) { dlg.append(errBox(e)); } } }, hasBrowserWallet() ? 'Browser wallet' : 'No browser wallet found'),
      h('button', { class: 'btn ghost', onclick: () => { connectBurner(); close(); } }, 'Burner in this tab'),
    ),
    h('p', { class: 'fine' }, 'A burner is a fresh key stored in this browser only. Testnet use only; fund it from the faucet.'),
    h('button', { class: 'link', onclick: close }, 'Cancel'),
  );
  document.body.append(dlg);
  dlg.showModal();
}

function shell(active: string, ...kids: (Node | null)[]) {
  const nav = (href: string, label: string) => h('a', { href, class: active === href ? 'on' : '' }, label);
  const header = h('header', { class: 'top' },
    h('a', { class: 'brand', href: '#/' }, h('img', { src: art('stowaway.png'), alt: '' }), h('span', {}, 'Stowaway')),
    h('nav', {}, nav('#/board', 'Board'), nav('#/new', 'Get ZEC'), nav('#/how', 'How it works'), nav('#/audit', 'Audit')),
    walletChip(),
  );
  const footer = h('footer', {},
    h('p', {}, 'Stowaway. Shielded ZEC for USDC on Arc. Built for ZECATHON (Cross-chain).'),
    h('p', { class: 'dim' }, 'Escrow ', ext(arcAddr(CONTRACT), short(CONTRACT, 6, 4)), ' on Arc testnet. ZEC moves on Zcash mainnet. Chits are checked with ', ext('https://chit.nerom.site', 'chit-zcash'), ', the official orchard crate in WebAssembly.'),
  );
  app.replaceChildren(header, h('main', {}, ...kids.filter(Boolean) as Node[]), footer);
}

// ---------- home ----------

async function home() {
  const stats = h('div', { class: 'stats' }, ...['Open orders', 'Settled', 'USDC settled', 'Watch'].map((l) => h('div', {}, h('b', {}, '…'), h('span', {}, l))));
  const board = h('div', { class: 'board-preview' }, h('p', { class: 'dim' }, 'Loading the board…'));
  shell(
    '#/',
    h('section', { class: 'hero' },
      h('img', { class: 'hero-art', src: art('hero.jpg'), alt: 'A cargo boat crossing a night harbor from a lighthouse to a city, a ghost hiding in a crate' }),
      h('div', { class: 'hero-text' },
        h('p', { class: 'eyebrow' }, 'ZEC ⇄ USDC · Zcash × Arc'),
        h('h1', {}, 'Cross over.', h('br'), 'Stay in the dark.'),
        h('p', { class: 'lede' }, 'Trade shielded ZEC for USDC on Arc, person to person. No bridge, no wrapped coin, no unshielding. The USDC waits in escrow. The ZEC never leaves the shielded pool. One proof of one payment releases it.'),
        h('div', { class: 'row' },
          h('a', { class: 'btn', href: '#/new' }, 'Get ZEC for USDC'),
          h('a', { class: 'btn ghost', href: '#/board' }, 'Fill an order, get USDC'),
        ),
      ),
    ),
    stats,
    crossing(),
    whoSees(),
    h('section', { class: 'block' }, h('div', { class: 'head' }, h('h2', {}, 'On the board'), h('a', { href: '#/board' }, 'All orders →')), board),
    whatsReal(),
  );
  try {
    const [os, hl] = await Promise.all([api.orders(), api.health().catch(() => null)]);
    const settled = os.filter((o) => o.state === 'settled');
    const vals = [String(os.filter((o) => o.state === 'open').length), String(settled.length), usd(settled.reduce((a, o) => a + o.usdc, 0)), hl ? `${hl.watches.length} keys` : 'offline'];
    stats.querySelectorAll('b').forEach((b, i) => (b.textContent = vals[i]));
    board.replaceChildren(ordersTable(os.slice(0, 6)));
  } catch (e) {
    board.replaceChildren(errBox(e));
  }
}

function crossing() {
  const card = (img: string, who: string, title: string, body: string) =>
    h('article', { class: 'cast' }, h('img', { src: art(img), alt: who }), h('p', { class: 'eyebrow' }, who), h('h3', {}, title), h('p', {}, body));
  return h('section', { class: 'block', id: 'crossing' },
    h('div', { class: 'head' }, h('h2', {}, 'The crossing')),
    h('div', { class: 'cast-grid' },
      card('quartermaster.png', 'The Quartermaster · wants ZEC', '1. Lock USDC, name a hidden address', 'Locks USDC on Arc and asks for ZEC at a one-time shielded address. The address is sealed to the Watch in the browser. Arc stores only its hash.'),
      card('stowaway.png', 'The Stowaway · wants USDC', '2. Hold it, pay in the dark', 'Holds the order for an hour (free, no gas, no Arc history needed) and pays the ZEC from any shielded wallet, with the order memo. The payment never touches a transparent address.'),
      card('watch.png', 'The Watch · three keys', '3. One output, checked on chain', 'Checks a chit, a proof of that one output, against the mined Zcash transaction: right address, enough ZEC, right memo. Two of three keys sign, and the escrow pays the Stowaway.'),
    ),
  );
}

function whoSees() {
  const yes = 'Sees', no = '—';
  const rows: [string, string, string, string, string][] = [
    ['The Zcash address', 'hash only', no, yes, 'the payer'],
    ['The ZEC payment', no, 'that a shielded tx exists', 'one output', 'both parties'],
    ['Who paid the ZEC', no, no, no, no],
    ['USDC amount and price', yes, no, yes, yes],
    ["The payer's wallet, balance, history", no, no, no, no],
    ['Any viewing key', no, no, no, no],
  ];
  return h('section', { class: 'block' },
    h('div', { class: 'head' }, h('h2', {}, 'Who sees what')),
    h('div', { class: 'table-wrap' },
      h('table', { class: 'sees' },
        h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, 'Arc chain'), h('th', {}, 'Zcash chain'), h('th', {}, 'The Watch'), h('th', {}, 'Counterparty'))),
        h('tbody', {}, ...rows.map((r) => h('tr', {}, h('th', {}, r[0]), ...r.slice(1).map((c) => h('td', { class: c === no ? 'no' : '' }, c))))),
      ),
    ),
    h('p', { class: 'fine' }, 'A chit opens exactly one output of one transaction. It cannot reveal other outputs, the change, the sender, or anything else in the wallet.'),
  );
}

function whatsReal() {
  return h('section', { class: 'block real' },
    h('div', { class: 'head' }, h('h2', {}, "What's real")),
    h('ul', {},
      h('li', {}, h('b', {}, 'Real: '), 'ZEC on Zcash mainnet, checked against mined transactions fetched from three lightwalletd servers (one per Watch key).'),
      h('li', {}, h('b', {}, 'Real: '), 'the escrow contract on Arc testnet holding real testnet USDC from Circle. It pays only with two of three Watch signatures over the exact claim.'),
      h('li', {}, h('b', {}, 'Real: '), 'chit verification with the official Zcash crates (orchard, zcash_note_encryption) compiled to WebAssembly, in the Watch and in your browser.'),
      h('li', {}, h('b', {}, 'Trusted: '), 'the Watch. Two of three keys must agree, every claim names the exact output, and anyone holding the chit can re-check a settlement on the Audit page. In this build the three keys run in one service.'),
      h('li', {}, h('b', {}, 'Testnet: '), 'the USDC side. Mainnet ZEC for testnet USDC: keep trades tiny.'),
    ),
  );
}

// ---------- board ----------

function ordersTable(os: api.Order[]) {
  if (!os.length) return h('p', { class: 'dim' }, 'No orders yet. ', h('a', { href: '#/new' }, 'Post the first one.'));
  return h('div', { class: 'table-wrap' },
    h('table', { class: 'orders' },
      h('thead', {}, h('tr', {}, h('th', {}, '#'), h('th', {}, 'Pays'), h('th', {}, 'For'), h('th', {}, 'Price'), h('th', {}, 'State'), h('th', {}, ''))),
      h('tbody', {}, ...os.map((o) =>
        h('tr', { onclick: () => (location.hash = `#/o/${o.id}`) },
          h('td', { class: 'mono' }, `${o.id}`),
          h('td', { class: 'mono' }, `${usd(o.usdc)} USDC`),
          h('td', { class: 'mono' }, `${zec(o.zats)} ZEC`),
          h('td', { class: 'mono dim' }, `${(o.usdc / 1e6 / (o.zats / 1e8)).toFixed(2)} USDC/ZEC`),
          h('td', {}, chip(o.state), o.checked ? null : h('span', { class: 'chip bad', title: "The Watch can't open this order's address" }, 'unusable')),
          h('td', {}, h('a', { href: `#/o/${o.id}` }, o.state === 'open' ? 'Fill →' : 'View →')),
        ),
      )),
    ),
  );
}

async function boardView() {
  const box = h('div', {}, h('p', { class: 'dim' }, 'Loading…'));
  shell('#/board',
    h('section', { class: 'page-head' }, h('h1', {}, 'The board'), h('p', { class: 'lede' }, 'Each order is USDC locked on Arc, waiting for ZEC. Fill one: pay the ZEC from your shielded wallet and the USDC comes to you.')),
    box,
  );
  try {
    box.replaceChildren(ordersTable(await api.orders()));
  } catch (e) {
    box.replaceChildren(errBox(e));
  }
}

// ---------- post an order (get ZEC) ----------

async function newView() {
  await ready();
  const out = h('div', { class: 'out' });
  const usdcIn = h('input', { type: 'number', min: '0.01', step: '0.01', value: '1', inputmode: 'decimal' });
  const zecIn = h('input', { type: 'number', min: '0.00001', step: '0.0001', value: '0.002', inputmode: 'decimal' });
  const uaIn = h('textarea', { rows: '3', placeholder: 'u1… (a fresh shielded address from your wallet)', spellcheck: false });
  const hours = h('select', {}, ...[6, 24, 72].map((n) => h('option', { value: String(n), selected: n === 24 }, `${n} hours`)));
  const price = h('p', { class: 'mono dim' });
  const upd = () => {
    const u = Number(usdcIn.value), z = Number(zecIn.value);
    price.textContent = u > 0 && z > 0 ? `${(u / z).toFixed(2)} USDC per ZEC` : '';
  };
  usdcIn.addEventListener('input', upd);
  zecIn.addEventListener('input', upd);
  upd();

  const go = h('button', { class: 'btn' }, 'Lock USDC and post');
  go.addEventListener('click', async () => {
    out.replaceChildren();
    go.setAttribute('disabled', '');
    try {
      const w = wallet() ?? (pickWallet(), null);
      if (!w) throw new Error('Connect an Arc wallet, then post again.');
      const ua = uaIn.value.trim();
      if (!sameReceiver(ua, ua, ZNET)) throw new Error('That is not a Zcash mainnet address with a shielded (Orchard/Ironwood) receiver.');
      const amount = BigInt(Math.round(Number(usdcIn.value) * 1e6));
      const zats = BigInt(Math.round(Number(zecIn.value) * 1e8));
      if (amount <= 0n || zats <= 0n) throw new Error('Enter both amounts.');
      const addrHash = keccak256(toBytes(ua));
      if (await pub.readContract({ address: CONTRACT, abi: ABI, functionName: 'addrUsed', args: [addrHash] })) throw new Error('This address was used for an order before. Use a fresh one.');
      const hl = await api.health();
      if (hl.zcash.network !== ZNET) throw new Error('The Watch is on a different Zcash network.');
      const envelope = seal(ua, hl.watches.map((x) => x.envelopeKey));
      const bal = await usdcBalance(w.address);
      if (bal * 1e6 < Number(amount) + 50_000) throw new Error(`This wallet has ${bal.toFixed(2)} USDC. It needs the amount plus a little for gas. Faucet: ${FAUCET}`);
      const allowance = (await pub.readContract({ address: USDC, abi: ERC20, functionName: 'allowance', args: [w.address, CONTRACT] })) as bigint;
      if (allowance < amount) {
        out.replaceChildren(h('p', { class: 'dim' }, 'Approving USDC…'));
        await send(USDC, ERC20, 'approve', [CONTRACT, amount]);
      }
      out.replaceChildren(h('p', { class: 'dim' }, 'Locking USDC in escrow…'));
      const expiry = BigInt(Math.floor(Date.now() / 1000) + Number(hours.value) * 3600);
      const rc = await send(CONTRACT, ABI, 'post', [amount, zats, expiry, addrHash, envelope]);
      const [ev] = parseEventLogs({ abi: ABI, logs: rc.logs, eventName: 'Posted' });
      const id = Number(ev.args.id);
      store.set(`stowaway:mine:${id}`, JSON.stringify({ ua }));
      location.hash = `#/o/${id}`;
    } catch (e) {
      out.replaceChildren(errBox(e));
    } finally {
      go.removeAttribute('disabled');
    }
  });

  shell('#/new',
    h('section', { class: 'page-head split' },
      h('div', {},
        h('p', { class: 'eyebrow' }, 'The Quartermaster'),
        h('h1', {}, 'Get ZEC for USDC'),
        h('p', { class: 'lede' }, 'Lock USDC on Arc. Someone pays you ZEC inside the shielded pool and takes the USDC. If nobody fills it, cancel and take your USDC back.'),
      ),
      h('img', { class: 'portrait', src: art('quartermaster.png'), alt: '' }),
    ),
    h('section', { class: 'form card' },
      h('label', {}, h('span', {}, 'You lock'), h('div', { class: 'suffix' }, usdcIn, h('em', {}, 'USDC'))),
      h('label', {}, h('span', {}, 'You get'), h('div', { class: 'suffix' }, zecIn, h('em', {}, 'ZEC'))),
      price,
      h('label', {}, h('span', {}, 'Pay the ZEC to'), uaIn),
      h('p', { class: 'fine' }, 'Use a fresh shielded address for every order. Your browser seals it to the three Watch keys before it leaves this page; Arc only ever stores its hash and the sealed copy.'),
      h('label', {}, h('span', {}, 'Order lasts'), hours),
      go,
      out,
    ),
  );
}

// ---------- one order ----------

type Hold = { taker: string; ticket: string; pay: api.Pay; lockUntil: number };
const holdKey = (id: number) => `stowaway:hold:${id}`;
const loadHold = (id: number): Hold | null => {
  try {
    return JSON.parse(store.get(holdKey(id)) ?? 'null');
  } catch {
    return null;
  }
};

async function orderView(id: number) {
  shell('#/board', h('p', { class: 'dim' }, 'Loading order…'));
  let o: api.Order;
  try {
    o = await api.order(id);
  } catch (e) {
    return shell('#/board', errBox(e));
  }
  await ready();
  const w = wallet();
  const mine = !!w && w.address.toLowerCase() === o.maker.toLowerCase();
  const myHold = loadHold(id);
  const holding = !!myHold && o.state === 'held' && o.taker?.toLowerCase() === myHold.taker.toLowerCase();

  const facts = h('dl', { class: 'facts' },
    h('dt', {}, 'Escrow holds'), h('dd', { class: 'mono' }, `${usd(o.usdc)} USDC`),
    h('dt', {}, 'Wants'), h('dd', { class: 'mono' }, `${zec(o.zats)} ZEC`),
    h('dt', {}, 'State'), h('dd', {}, chip(o.state), o.state === 'held' ? h('span', { class: 'dim' }, ` until ${new Date(o.lockUntil * 1000).toLocaleTimeString()} (${ago(o.lockUntil)})`) : null),
    h('dt', {}, 'Expires'), h('dd', {}, `${new Date(o.expiry * 1000).toLocaleString()} (${ago(o.expiry)})`),
    h('dt', {}, 'Address hash'), h('dd', { class: 'mono small' }, short(o.addrHash, 12, 8)),
  );
  const timeline = h('ol', { class: 'timeline' }, ...o.events.map((e) =>
    h('li', { class: e.kind.toLowerCase() },
      h('b', {}, { Posted: 'USDC locked', Reserved: 'Held', Settled: 'Settled', Cancelled: 'Cancelled' }[e.kind]),
      ' ', ext(arcTx(e.tx), short(e.tx, 10, 6)),
      e.zcashTxid ? h('span', {}, ' · Zcash ', ext(zecTx(e.zcashTxid), short(e.zcashTxid, 10, 6)), ` output ${e.action}`) : null,
    )));

  let action: Node;
  if (o.state === 'settled') action = settledPanel(o);
  else if (o.state === 'cancelled') action = h('p', { class: 'dim' }, 'The maker cancelled this order and took the USDC back.');
  else if (mine) action = makerPanel(o);
  else if (holding) action = takerPay(o, myHold!);
  else if (o.state === 'held' && o.lockUntil >= Date.now() / 1000) action = h('p', { class: 'dim' }, `Someone is paying this order. The hold lapses ${ago(o.lockUntil)}.`);
  else action = takerHold(o);

  shell('#/board',
    h('section', { class: 'page-head' }, h('p', { class: 'eyebrow' }, `Order #${o.id}`), h('h1', {}, `${usd(o.usdc)} USDC for ${zec(o.zats)} ZEC`)),
    h('div', { class: 'order-grid' },
      h('section', { class: 'card' }, facts, h('h3', {}, 'On Arc'), timeline),
      h('section', { class: 'card action' }, action),
    ),
  );
}

function makerPanel(o: api.Order) {
  const mine = (() => {
    try {
      return JSON.parse(store.get(`stowaway:mine:${o.id}`) ?? 'null') as { ua: string } | null;
    } catch {
      return null;
    }
  })();
  const out = h('div', {});
  const lapsed = o.state === 'open' || o.lockUntil < Date.now() / 1000;
  const cancel = h('button', { class: 'btn ghost', disabled: !lapsed, onclick: async () => {
    try {
      out.replaceChildren(h('p', { class: 'dim' }, 'Cancelling…'));
      await send(CONTRACT, [...ABI] as never, 'cancel', [BigInt(o.id)]);
      route();
    } catch (e) {
      out.replaceChildren(errBox(e));
    }
  } }, 'Cancel and take the USDC back');
  return h('div', {},
    h('p', { class: 'eyebrow' }, 'Your order'),
    h('h3', {}, o.state === 'held' ? 'Someone is paying you now' : 'Waiting for a Stowaway'),
    h('p', {}, o.state === 'held' ? 'A taker holds this order. When their ZEC lands at your address and the Watch signs, the USDC goes to them.' : 'Anyone can fill it. You will see the ZEC arrive in your shielded wallet, with the memo naming this order.'),
    mine ? h('p', { class: 'fine' }, 'Your address for this order: ', h('span', { class: 'mono small' }, short(mine.ua, 14, 10))) : null,
    cancel,
    lapsed ? null : h('p', { class: 'fine' }, 'You can cancel once the hold lapses.'),
    out,
  );
}

function takerHold(o: api.Order) {
  const out = h('div', {});
  const payout = h('input', { placeholder: '0x… your Arc address for the USDC', spellcheck: false, value: wallet()?.address ?? '' });
  const go = h('button', { class: 'btn' }, 'Hold for 60 minutes');
  go.addEventListener('click', async () => {
    try {
      const taker = payout.value.trim();
      if (!isAddress(taker)) throw new Error('Enter an Arc (EVM) address for the USDC.');
      go.setAttribute('disabled', '');
      out.replaceChildren(h('p', { class: 'dim' }, 'The Watch is placing your hold on Arc…'));
      const r = await api.hold(o.id, getAddress(taker));
      store.set(holdKey(o.id), JSON.stringify({ taker: getAddress(taker), ticket: r.ticket, pay: r.pay, lockUntil: r.lockUntil } satisfies Hold));
      route();
    } catch (e) {
      out.replaceChildren(errBox(e));
      go.removeAttribute('disabled');
    }
  });
  return h('div', {},
    h('img', { class: 'portrait sm', src: art('stowaway.png'), alt: '' }),
    h('p', { class: 'eyebrow' }, 'Fill this order'),
    h('h3', {}, `Pay ${zec(o.zats)} ZEC, get ${usd(o.usdc)} USDC`),
    o.checked ? null : h('p', { class: 'err' }, "The Watch can't open this order's address. Don't fill it."),
    h('ol', { class: 'steps' },
      h('li', {}, 'Hold the order. The Watch pays the gas, so your payout address can be brand new.'),
      h('li', {}, 'Pay the ZEC from any shielded wallet (Zodl, Zingo, Ywallet…) with the memo shown.'),
      h('li', {}, 'Send the chit for your payment. Two Watch keys sign and the USDC is yours.'),
    ),
    h('label', {}, h('span', {}, 'Send the USDC to'), payout),
    h('p', { class: 'fine' }, 'Tip: a fresh address keeps your Arc history apart from this trade. It needs no gas.'),
    go,
    out,
  );
}

function takerPay(o: api.Order, hold: Hold) {
  const p = hold.pay;
  const q = qrcode(0, 'L');
  q.addData(p.uri);
  q.make();
  const qr = h('div', { class: 'qr' });
  qr.innerHTML = q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  const left = h('b', { class: 'mono' });
  const tick = () => (left.textContent = ago(o.lockUntil));
  tick();
  const timer = setInterval(() => (document.body.contains(left) ? tick() : clearInterval(timer)), 1000);
  const field = (label: string, value: string) => {
    const b = h('button', { class: 'link' }, 'copy');
    b.addEventListener('click', () => copy(value, b));
    return h('div', { class: 'field' }, h('span', {}, label), h('code', {}, value), b);
  };

  return h('div', {},
    h('p', { class: 'eyebrow' }, 'You hold this order'),
    h('h3', {}, 'Pay in the dark'),
    h('p', {}, 'Scan with a shielded wallet. The hold lapses ', left, '. Pay from a shielded balance; the memo must be exactly as shown.'),
    h('div', { class: 'pay' }, qr, h('div', {}, field('Amount', `${p.zec} ZEC`), field('To', p.address), field('Memo', p.memo), h('a', { class: 'btn ghost sm', href: p.uri }, 'Open in wallet'))),
    proveBox(o, hold),
  );
}

function proveBox(o: api.Order, hold: Hold) {
  const out = h('div', { class: 'out' });
  const chitIn = h('textarea', { rows: '3', placeholder: 'zout1… (a chit for your payment output)', spellcheck: false });

  // Make a chit here: the viewing key stays in this tab (the page's CSP allows no other host).
  const txIn = h('input', { placeholder: 'Zcash txid of your payment', spellcheck: false });
  const keyIn = h('input', { type: 'password', placeholder: 'uview1… your unified full viewing key (stays in this tab)', autocomplete: 'off', spellcheck: false });
  const found = h('div', {});
  const make = h('button', { class: 'btn ghost sm' }, 'Find my payment');
  make.addEventListener('click', async () => {
    found.replaceChildren(h('p', { class: 'dim' }, 'Fetching the transaction…'));
    try {
      const t = await api.rawTx(txIn.value.trim().toLowerCase());
      const outs: Found[] = scan(t.hex, keyIn.value.trim(), ZNET);
      keyIn.value = '';
      const pick = outs.filter((f) => !f.change && sameReceiver(f.recipient, hold.pay.address, ZNET));
      if (!pick.length) throw new Error(outs.length ? 'Your key opens outputs in this transaction, but none paid this order\'s address.' : 'Your key opens no output in this transaction.');
      chitIn.value = pick[0].disclosure;
      found.replaceChildren(h('p', { class: 'ok' }, `Found output ${pick[0].action}: ${zec(pick[0].value_zat)} ZEC. The chit is filled in below.`));
    } catch (e) {
      found.replaceChildren(errBox(e));
    }
  });

  const go = h('button', { class: 'btn' }, 'Send the chit to the Watch');
  let polling = false;
  const submit = async () => {
    const chit = chitIn.value.trim();
    if (!chit) return out.replaceChildren(errBox('Paste or make a chit first.'));
    try {
      const head = inspect(chit);
      if (head.network !== ZNET) throw new Error('That chit is for the wrong Zcash network.');
    } catch (e) {
      return out.replaceChildren(errBox(e));
    }
    go.setAttribute('disabled', '');
    out.replaceChildren(h('p', { class: 'dim' }, 'Three Watch keys are checking your payment on Zcash…'));
    try {
      const { status, data } = await api.claim(o.id, chit);
      if (data.settled) {
        store.set(`stowaway:chit:${o.id}`, chit);
        return route();
      }
      out.replaceChildren(reports(data));
      if (status === 202 && !polling) {
        polling = true;
        out.append(h('p', { class: 'dim' }, `Waiting for confirmations (${data.confirmations ?? 0} so far). Checking again in 30 s.`));
        await sleep(30_000);
        polling = false;
        if (document.body.contains(go)) submit();
      }
    } catch (e) {
      out.replaceChildren(errBox(e));
    } finally {
      go.removeAttribute('disabled');
    }
  };
  go.addEventListener('click', submit);

  return h('div', { class: 'prove' },
    h('h3', {}, 'Prove the payment'),
    h('p', { class: 'fine' }, 'A chit proves one output: who it paid, how much, and its memo. Nothing else in your wallet. Make one at ', ext('https://chit.nerom.site', 'chit.nerom.site'), ' or right here.'),
    h('details', {}, h('summary', {}, 'Make the chit here'), h('div', { class: 'stack' }, txIn, keyIn, make, found)),
    chitIn,
    go,
    out,
  );
}

function reports(r: api.ClaimResult) {
  if (!r.reports) return h('p', { class: 'dim' }, r.settling ? 'Settling…' : '');
  return h('div', { class: 'reports' }, ...r.reports.map((x, i) =>
    h('div', { class: `report ${x.ok ? 'ok' : x.waiting ? 'wait' : 'bad'}` },
      h('p', { class: 'eyebrow' }, `Watch ${i + 1} · ${short(x.watch, 6, 4)}`),
      h('ul', {}, ...x.steps.filter((s) => !s.id.startsWith('chit.') || s.ok === false).map((s) => h('li', { class: s.ok ? 'ok' : s.ok === false ? 'bad' : '' }, s.label))),
    )));
}

function settledPanel(o: api.Order) {
  const s = o.events.find((e) => e.kind === 'Settled');
  return h('div', {},
    h('img', { class: 'portrait sm', src: art('watch.png'), alt: '' }),
    h('p', { class: 'eyebrow' }, 'Crossed'),
    h('h3', {}, `${usd(o.usdc)} USDC released`),
    h('p', {}, 'Two Watch keys checked the ZEC payment on Zcash and signed. The escrow paid the taker.'),
    s ? h('p', {}, 'Zcash payment: ', ext(zecTx(s.zcashTxid!), short(s.zcashTxid!, 12, 8)), `, output ${s.action}. The explorer shows a shielded transaction and nothing else.`) : null,
    h('a', { class: 'btn ghost', href: `#/audit/${o.id}` }, 'Audit this settlement'),
  );
}

// ---------- audit ----------

async function auditView(id?: number) {
  await ready();
  const idIn = h('input', { type: 'number', min: '1', placeholder: 'Order #', value: id ? String(id) : '' });
  const chitIn = h('textarea', { rows: '3', placeholder: 'zout1… the chit for this settlement (the maker and the taker both have it)', spellcheck: false });
  const uaIn = h('input', { placeholder: "Optional: the order's Zcash address, to check the payee too", spellcheck: false });
  if (id) chitIn.value = store.get(`stowaway:chit:${id}`) ?? '';
  const out = h('div', { class: 'out' });
  const go = h('button', { class: 'btn' }, 'Re-check it myself');
  go.addEventListener('click', async () => {
    out.replaceChildren(h('p', { class: 'dim' }, 'Checking…'));
    try {
      const o = await api.order(Number(idIn.value));
      const s = o.events.find((e) => e.kind === 'Settled');
      if (!s) throw new Error('This order has not settled.');
      const chit = chitIn.value.trim();
      const checks: [string, boolean][] = [];
      checks.push(['The chit is the one the Watch signed (its hash is on Arc)', keccak256(toBytes(chit)) === s.chitHash]);
      const t = await api.rawTx(s.zcashTxid!);
      const r = verify(t.hex, chit);
      checks.push([`The Zcash transaction is mined (${t.tip - t.height + 1} confirmations)`, t.height > 0]);
      checks.push(['The chit decrypts that output, here in your browser', r.valid]);
      const v = r.verified;
      checks.push([`It is output ${s.action} of ${short(s.zcashTxid!, 8, 6)}`, !!v && v.txid === s.zcashTxid && v.action === s.action]);
      const ua = uaIn.value.trim() || (JSON.parse(store.get(`stowaway:mine:${o.id}`) ?? '{}').ua as string | undefined) || '';
      if (ua) {
        checks.push(["The address you gave is the order's address (its hash is on Arc)", keccak256(toBytes(ua)) === o.addrHash]);
        checks.push(['The output paid that address', !!v && sameReceiver(v.recipient, ua, ZNET)]);
      }
      checks.push([`It carried ${v ? zec(v.value_zat) : '?'} ZEC; the order asked ${zec(o.zats)}`, !!v && v.value_zat >= o.zats]);
      const memo = `stowaway:5042002:${o.id}:${(s.taker ?? '').toLowerCase()}`;
      checks.push([`Its memo names this order and the taker who was paid (${short(s.taker ?? '?', 6, 4)})`, !!v && v.memo.kind === 'text' && v.memo.value.trim() === memo]);
      out.replaceChildren(h('ul', { class: 'checks' }, ...checks.map(([l, ok]) => h('li', { class: ok ? 'ok' : 'bad' }, l))), h('p', { class: checks.every((c) => c[1]) ? 'ok' : 'err' }, checks.every((c) => c[1]) ? 'Everything the Watch signed checks out.' : 'Something does not match. See above.'));
    } catch (e) {
      out.replaceChildren(errBox(e));
    }
  });
  shell('#/audit',
    h('section', { class: 'page-head split' },
      h('div', {}, h('p', { class: 'eyebrow' }, 'Watch the Watch'), h('h1', {}, 'Audit a settlement'), h('p', { class: 'lede' }, 'Arc records the hash of every chit the Watch signed. Anyone holding that chit can re-run the check in their own browser, against the mined Zcash transaction. A Watch that signs a bad claim gets caught in the open.')),
      h('img', { class: 'portrait', src: art('watch.png'), alt: '' }),
    ),
    h('section', { class: 'form card' }, h('label', {}, h('span', {}, 'Order'), idIn), h('label', {}, h('span', {}, 'Chit'), chitIn), h('label', {}, h('span', {}, 'Address'), uaIn), go, out),
  );
}

// ---------- how it works ----------

function howView() {
  shell('#/how',
    h('section', { class: 'page-head' }, h('h1', {}, 'How it works'), h('p', { class: 'lede' }, 'Two chains that cannot read each other. One proof of one shielded output carries the fact across.')),
    crossing(),
    h('section', { class: 'block prose' },
      h('h2', {}, 'The protocol'),
      h('ol', {},
        h('li', {}, h('b', {}, 'Post. '), 'The maker calls ', h('code', {}, 'post(usdc, zats, expiry, keccak256(address), envelope)'), '. The envelope is the address sealed to each Watch X25519 key (XChaCha20-Poly1305). Addresses are one-time: the contract refuses a hash it has seen.'),
        h('li', {}, h('b', {}, 'Hold. '), h('code', {}, 'reserve(id, taker)'), ' locks the order for 60 minutes. Anyone may call it; the Watch relays it so the taker needs no gas and no Arc history. A lapsed hold can be taken over, and the maker can cancel only when no hold is live.'),
        h('li', {}, h('b', {}, 'Pay. '), 'The taker gets the address through a ticket only the holder receives, and pays it from any shielded wallet with the memo ', h('code', {}, 'stowaway:<chain>:<order>:<taker>'), '. The memo binds the payment to one order and one payout address.'),
        h('li', {}, h('b', {}, 'Prove. '), 'The taker sends a chit: a ZIP 311-style disclosure of that single output. Each Watch fetches the transaction from its own lightwalletd, re-hashes it to the txid, waits for confirmations, decrypts the output with the official orchard crate, and checks address, amount and memo.'),
        h('li', {}, h('b', {}, 'Settle. '), 'Each Watch signs an EIP-712 ', h('code', {}, 'Claim(id, txid, action, zats, addrHash, taker, chitHash)'), '. The contract needs two distinct Watch signatures, re-checks the claim against the order, marks the (txid, output) as spent so it can never pay twice, and sends the USDC.'),
        h('li', {}, h('b', {}, 'Audit. '), 'The chit hash is on Arc forever. The maker and taker hold the chit; either can show it to anyone, who can re-verify it on the Audit page without trusting the Watch.'),
      ),
      h('h2', {}, 'Why no bridge'),
      h('p', {}, 'A bridge would need Arc to follow Zcash consensus, or ZEC to leave the shielded pool to sit in a wrapper. Stowaway does neither: ZEC goes from one shielded wallet to another, and the USDC never leaves Arc. Only a claim about one output crosses.'),
      h('h2', {}, 'Limits, plainly'),
      h('ul', {},
        h('li', {}, 'The Watch is trusted for liveness and honesty (two of three). Its signatures are public and every claim is re-checkable, so cheating is provable, but not yet slashable on chain.'),
        h('li', {}, 'A taker who pays after the hold lapses can lose the race to a new holder. Pay inside the hour.'),
        h('li', {}, 'Holds cost nothing, so a griefer could hold orders repeatedly; the Watch rate-limits holds.'),
        h('li', {}, 'The price and USDC amount are public on Arc. The ZEC side is not.'),
      ),
    ),
  );
}

// ---------- router ----------

function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  window.scrollTo(0, 0);
  switch (parts[0]) {
    case 'board':
      return boardView();
    case 'new':
      return newView();
    case 'o':
      return orderView(Number(parts[1]));
    case 'audit':
      return auditView(parts[1] ? Number(parts[1]) : undefined);
    case 'how':
      return howView();
    default:
      return home();
  }
}

window.addEventListener('hashchange', route);
onWallet(route);
route();
