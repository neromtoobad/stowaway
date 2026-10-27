/* tslint:disable */
/* eslint-disable */
export const memory: WebAssembly.Memory;
export const burn_info: (a: number, b: number) => [number, number, number, number];
export const burns: (a: number, b: number, c: number, d: number) => [number, number, number, number];
export const has_orchard_receiver: (a: number, b: number, c: number, d: number) => [number, number, number];
export const inspect: (a: number, b: number) => [number, number, number, number];
export const same_receiver: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
export const scan: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
export const txid: (a: number, b: number) => [number, number, number, number];
export const verify: (a: number, b: number, c: number, d: number) => [number, number, number, number];
export const rustsecp256k1_v0_14_context_create: (a: number) => number;
export const rustsecp256k1_v0_14_context_destroy: (a: number) => void;
export const rustsecp256k1_v0_14_default_error_callback_fn: (a: number, b: number) => void;
export const rustsecp256k1_v0_14_default_illegal_callback_fn: (a: number, b: number) => void;
export const __wbindgen_externrefs: WebAssembly.Table;
export const __wbindgen_malloc: (a: number, b: number) => number;
export const __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
export const __externref_table_dealloc: (a: number) => void;
export const __wbindgen_free: (a: number, b: number, c: number) => void;
export const __wbindgen_start: () => void;
