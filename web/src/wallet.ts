// Arc wallets: a browser wallet (EIP-1193) or a burner key kept in this tab's storage.
// Arc's gas token is USDC, so one faucet funds both the trade and the gas.
import { createPublicClient, createWalletClient, custom, http, type Abi, type WalletClient } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { ARC, ERC20, USDC } from './config';

export const pub = createPublicClient({ chain: ARC, transport: http() });

type Eip1193 = { request(a: { method: string; params?: unknown[] }): Promise<unknown>; on?(e: string, f: () => void): void };
declare global {
  interface Window {
    ethereum?: Eip1193;
  }
}

export interface Wallet {
  kind: 'browser' | 'burner';
  address: `0x${string}`;
  client: WalletClient;
}

let current: Wallet | null = null;
const subs = new Set<() => void>();
const changed = () => subs.forEach((f) => f());
export const onWallet = (f: () => void) => (subs.add(f), () => subs.delete(f));
export const wallet = () => current;

const BURNER = 'stowaway:burner';
const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* private mode: the burner lasts for this tab only */
    }
  },
};
export { store };

export const hasBrowserWallet = () => !!window.ethereum;

export async function connectBrowser() {
  const eth = window.ethereum;
  if (!eth) throw new Error('No browser wallet found. Use a burner instead.');
  const [address] = (await eth.request({ method: 'eth_requestAccounts' })) as `0x${string}`[];
  const hex = `0x${ARC.id.toString(16)}`;
  try {
    await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex }] });
  } catch {
    await eth.request({
      method: 'wallet_addEthereumChain',
      params: [{ chainId: hex, chainName: ARC.name, nativeCurrency: ARC.nativeCurrency, rpcUrls: ARC.rpcUrls.default.http, blockExplorerUrls: [ARC.blockExplorers!.default.url] }],
    });
  }
  current = { kind: 'browser', address, client: createWalletClient({ account: address, chain: ARC, transport: custom(eth) }) };
  eth.on?.('accountsChanged', () => {
    current = null;
    changed();
  });
  changed();
  return current;
}

export function connectBurner() {
  let key = store.get(BURNER) as `0x${string}` | null;
  if (!key) {
    key = generatePrivateKey();
    store.set(BURNER, key);
  }
  const account = privateKeyToAccount(key);
  current = { kind: 'burner', address: account.address, client: createWalletClient({ account, chain: ARC, transport: http() }) };
  changed();
  return current;
}

export function disconnect() {
  current = null;
  changed();
}

export async function usdcBalance(a: string) {
  return Number(await pub.readContract({ address: USDC, abi: ERC20, functionName: 'balanceOf', args: [a as `0x${string}`] })) / 1e6;
}

/** Sends a contract call and waits for it. Arc drops transactions priced under 20 gwei. */
export async function send(address: `0x${string}`, abi: Abi, functionName: string, args: unknown[]) {
  const w = current;
  if (!w) throw new Error('Connect a wallet first.');
  const hash = await w.client.writeContract({ address, abi, functionName, args, chain: ARC, account: w.client.account!, gasPrice: 30_000_000_000n } as never);
  const rc = await pub.waitForTransactionReceipt({ hash });
  if (rc.status !== 'success') throw new Error(`Transaction failed: ${hash}`);
  return rc;
}
