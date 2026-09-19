/** Typed-code enrollment. Matches packages/tala ManualEnrollment.kt exactly. */

export const MANUAL_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const PREFIX = 'hiraia-tala-manual-v1:';

export function normalizeCode(input: string): string | null {
  const raw = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (raw.length !== 12) return null;
  if ([...raw].some((c) => !MANUAL_ALPHABET.includes(c))) return null;
  return raw;
}

export function formatCode(input: string): string {
  const raw = input.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  return raw.match(/.{1,4}/g)?.join('-') ?? raw;
}

export function b64urlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(value: string): Uint8Array {
  const pad = '='.repeat((4 - (value.length % 4)) % 4);
  const bin = atob(value.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const n = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function tagged(tag: number, challenge: string, nonce: Uint8Array): Uint8Array {
  return concat(new Uint8Array([tag]), utf8(challenge), nonce);
}

export function secretMaterial(code: string): Uint8Array {
  return concat(utf8(PREFIX), utf8(code));
}

export type ManualCrypto = {
  sha256(bytes: Uint8Array): Uint8Array | Promise<Uint8Array>;
  hmacSha256(key: Uint8Array, message: Uint8Array): Uint8Array | Promise<Uint8Array>;
};

export async function manualSecret(code: string, crypto: ManualCrypto): Promise<Uint8Array> {
  return crypto.sha256(secretMaterial(code));
}

export async function manualProof(
  secret: Uint8Array,
  challenge: string,
  clientNonce: Uint8Array,
  crypto: ManualCrypto
): Promise<Uint8Array> {
  return crypto.hmacSha256(secret, tagged(1, challenge, clientNonce));
}

export async function manualResponseKey(
  secret: Uint8Array,
  challenge: string,
  clientNonce: Uint8Array,
  crypto: ManualCrypto
): Promise<Uint8Array> {
  return crypto.hmacSha256(secret, tagged(2, challenge, clientNonce));
}

export function manualAad(challenge: string, clientNonce: Uint8Array): Uint8Array {
  return tagged(3, challenge, clientNonce);
}
