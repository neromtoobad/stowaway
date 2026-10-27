// The Watch's HTTP API. It never sees a viewing key: only orders, holds and chits.
import { WATCH } from './config';

export type State = 'open' | 'held' | 'settled' | 'cancelled';
export interface OrderEvent { kind: 'Posted' | 'Reserved' | 'Settled' | 'Cancelled'; tx: string; block: number; zcashTxid?: string; action?: number; chitHash?: string; taker?: string }
export interface Order { id: number; maker: string; usdc: number; zats: number; expiry: number; state: State; taker: string | null; lockUntil: number; addrHash: string; checked: boolean; postedTx: string; events: OrderEvent[] }
export interface Pay { address: string; zats: number; zec: string; memo: string; uri: string }
export interface Step { id: string; label: string; ok: boolean | null }
export interface WatchReport { watch: string; ok: boolean; steps: Step[]; waiting?: boolean; confirmations?: number }
export interface ClaimResult { order: Order; reports?: WatchReport[]; settled?: boolean; tx?: string; waiting?: boolean; confirmations?: number; settling?: boolean; error?: string }
export interface Health { ok: boolean; chainId: number; contract: string; zcash: { network: string; minConf: number; tip: number | null }; watches: { address: string; envelopeKey: string; lightwalletd: string }[] }

async function call<T>(path: string, init?: { body: unknown }): Promise<{ status: number; data: T }> {
  const r = await fetch(`${WATCH}${path}`, init ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(init.body) } : undefined);
  const data = await r.json().catch(() => ({ error: `Watch answered ${r.status}` }));
  if (r.status >= 400 && r.status !== 422) throw new Error((data as { error?: string }).error ?? `Watch answered ${r.status}`);
  return { status: r.status, data: data as T };
}

export const health = async () => (await call<Health>('/v1/health')).data;
export const orders = async () => (await call<{ orders: Order[] }>('/v1/orders')).data.orders;
export const order = async (id: number) => (await call<Order>(`/v1/order?id=${id}`)).data;
export const hold = async (id: number, taker: string) => (await call<{ tx: string; lockUntil: number; ticket: string; pay: Pay }>('/v1/hold', { body: { id, taker } })).data;
export const ticket = async (id: number, t: string) => (await call<{ lockUntil: number; pay: Pay }>('/v1/ticket', { body: { id, ticket: t } })).data;
export const claim = async (id: number, chit: string) => call<ClaimResult>('/v1/claim', { body: { id, chit } });
export const rawTx = async (txid: string) => (await call<{ txid: string; hex: string; height: number; tip: number }>(`/v1/tx?txid=${txid}`)).data;
