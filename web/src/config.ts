import { defineChain } from 'viem';

declare const __WATCH__: string;
export const WATCH = __WATCH__;

export const ARC = defineChain({
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.testnet.arc.io'] } },
  blockExplorers: { default: { name: 'Arcscan', url: 'https://testnet.arcscan.app' } },
});
export const CONTRACT = '0xBdd7C288c48EdeCfb812E21F2d270459A2eDc752' as const;
export const USDC = '0x3600000000000000000000000000000000000000' as const;
export const ZNET = 'main' as const;
export const FAUCET = 'https://faucet.circle.com';
export const arcTx = (h: string) => `${ARC.blockExplorers.default.url}/tx/${h}`;
export const arcAddr = (a: string) => `${ARC.blockExplorers.default.url}/address/${a}`;
export const zecTx = (t: string) => `https://mainnet.zcashexplorer.app/transactions/${t}`;

export const ABI = [
  { type: 'function', name: 'post', stateMutability: 'nonpayable', inputs: [{ name: 'amount', type: 'uint96' }, { name: 'zats', type: 'uint64' }, { name: 'expiry', type: 'uint64' }, { name: 'addrHash', type: 'bytes32' }, { name: 'envelope', type: 'bytes' }], outputs: [{ name: 'id', type: 'uint256' }] },
  { type: 'function', name: 'cancel', stateMutability: 'nonpayable', inputs: [{ name: 'id', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'addrUsed', stateMutability: 'view', inputs: [{ name: '', type: 'bytes32' }], outputs: [{ type: 'bool' }] },
  { type: 'event', name: 'Posted', inputs: [{ name: 'id', type: 'uint256', indexed: true }, { name: 'maker', type: 'address', indexed: true }, { name: 'usdc', type: 'uint96', indexed: false }, { name: 'zats', type: 'uint64', indexed: false }, { name: 'expiry', type: 'uint64', indexed: false }, { name: 'addrHash', type: 'bytes32', indexed: false }, { name: 'envelope', type: 'bytes', indexed: false }] },
] as const;

export const ERC20 = [
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 's', type: 'address' }, { name: 'a', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'allowance', stateMutability: 'view', inputs: [{ name: 'o', type: 'address' }, { name: 's', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const;
