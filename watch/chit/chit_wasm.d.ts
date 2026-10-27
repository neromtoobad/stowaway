/* tslint:disable */
/* eslint-disable */

/**
 * The Burn Book address, its published viewing key, and the three key parts, each
 * re-derived here from public strings so a reader can check nobody holds a spending key.
 */
export function burn_info(network: string): string;

/**
 * Every burn in a raw transaction: outputs to the Burn Book address, with value and memo.
 */
export function burns(tx_hex: string, network: string): string;

/**
 * Whether an address can receive Orchard/Ironwood payments that a chit can prove.
 */
export function has_orchard_receiver(address: string, network: string): boolean;

/**
 * Reads a disclosure's header (which transaction to fetch) without verifying it.
 */
export function inspect(disclosure: string): string;

/**
 * Whether two addresses share the same Orchard receiver (a disclosure's recipient against
 * an invoice's address, say). False when either has no Orchard receiver.
 */
export function same_receiver(a: string, b: string, network: string): boolean;

/**
 * Lists the outputs of a transaction that a Unified Full Viewing Key can disclose.
 */
export function scan(tx_hex: string, ufvk: string, network: string): string;

/**
 * The txid of a raw transaction, so a caller can check what it fetched.
 */
export function txid(tx_hex: string): string;

/**
 * Verifies a disclosure against the raw transaction it names, returning every check.
 * Throws only when the inputs cannot be parsed at all.
 */
export function verify(tx_hex: string, disclosure: string): string;
