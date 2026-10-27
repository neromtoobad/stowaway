// Seals the maker's one-time Zcash address to each Watch key, so Arc stores only ciphertext
// and keccak256(address). Must match watch/src/envelope.js byte for byte.
import { x25519 } from '@noble/curves/ed25519';
import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { sha256 } from '@noble/hashes/sha256';
import { concatBytes, randomBytes, utf8ToBytes, bytesToHex, hexToBytes } from '@noble/hashes/utils';

const tag = utf8ToBytes('stowaway/envelope/v1');

export function seal(address: string, watchKeys: string[]): `0x${string}` {
  const parts: Uint8Array[] = [Uint8Array.of(1)];
  for (const k of watchKeys) {
    const pub = hexToBytes(k);
    const esk = randomBytes(32);
    const eph = x25519.getPublicKey(esk);
    const nonce = randomBytes(24);
    const key = sha256(concatBytes(tag, x25519.getSharedSecret(esk, pub), eph, pub));
    const ct = xchacha20poly1305(key, nonce).encrypt(utf8ToBytes(address));
    parts.push(eph, nonce, Uint8Array.of(ct.length >> 8, ct.length & 255), ct);
  }
  return `0x${bytesToHex(concatBytes(...parts))}`;
}
