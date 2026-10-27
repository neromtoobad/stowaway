// Sealed addresses. A maker's one-time Zcash address is sealed to each Watch's X25519 key, so
// Arc stores only ciphertext and keccak256(address). Format: 0x01, then per Watch
// [ephemeral pub 32 | nonce 24 | length u16 | ciphertext].
import { x25519 } from '@noble/curves/ed25519.js';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { concatBytes, randomBytes, utf8ToBytes, bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

const tag = utf8ToBytes('stowaway/envelope/v1');

/** The Watch's envelope secret, derived from its signing key so one secret backs both. */
export function envelopeSecret(signingKeyHex) {
  return sha256(concatBytes(tag, hexToBytes(signingKeyHex.replace(/^0x/, ''))));
}
export const envelopePublic = (secret) => x25519.getPublicKey(secret);

const keyFor = (shared, eph, pub) => sha256(concatBytes(tag, shared, eph, pub));

export function seal(address, watchPubs) {
  const parts = [Uint8Array.of(1)];
  for (const pub of watchPubs) {
    const esk = randomBytes(32);
    const eph = x25519.getPublicKey(esk);
    const nonce = randomBytes(24);
    const ct = xchacha20poly1305(keyFor(x25519.getSharedSecret(esk, pub), eph, pub), nonce).encrypt(utf8ToBytes(address));
    parts.push(eph, nonce, Uint8Array.of(ct.length >> 8, ct.length & 255), ct);
  }
  return '0x' + bytesToHex(concatBytes(...parts));
}

/** Opens this Watch's copy (slot `index`). Returns null if it does not decrypt. */
export function open(envelopeHex, index, secret) {
  const b = hexToBytes(envelopeHex.replace(/^0x/, ''));
  if (b[0] !== 1) return null;
  let at = 1;
  for (let i = 0; at + 58 <= b.length; i++) {
    const eph = b.subarray(at, at + 32);
    const nonce = b.subarray(at + 32, at + 56);
    const len = (b[at + 56] << 8) | b[at + 57];
    const ct = b.subarray(at + 58, at + 58 + len);
    at += 58 + len;
    if (i !== index) continue;
    try {
      const pub = envelopePublic(secret);
      const pt = xchacha20poly1305(keyFor(x25519.getSharedSecret(secret, eph), eph, pub), nonce).decrypt(ct);
      return new TextDecoder().decode(pt);
    } catch {
      return null;
    }
  }
  return null;
}
