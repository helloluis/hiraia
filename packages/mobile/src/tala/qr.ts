import { CLASS_UUID, QR_KIND, cleanClassName, type TeacherQr } from './protocol';

const MAX_QR = 4096;
const RSA_OID = new Uint8Array([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01]);

export class QrError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QrError';
  }
}

function b64urlDecode(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length > 2048) throw new QrError('key encoding');
  const pad = '='.repeat((4 - (value.length % 4)) % 4);
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const bin = globalThis.atob(b64);
  if (!bin.length) throw new QrError('key encoding');
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** SPKI DER of an RSA public key: SEQUENCE, rsaEncryption OID, 2048-bit modulus. */
export function assertRsa2048Spki(der: Uint8Array): void {
  if (der.length < 270 || der.length > 400 || der[0] !== 0x30) throw new QrError('key type');
  const oidAt = indexOf(der, RSA_OID);
  if (oidAt < 0) throw new QrError('key type');
  // BIT STRING of the PKCS#1 key; 2048-bit n is 257 bytes including the 0x00 prefix.
  if (der.length < 290) throw new QrError('key length');
}

function indexOf(hay: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

export function parseTeacherQr(text: string): TeacherQr {
  if (typeof text !== 'string' || !text.trim() || text.length > MAX_QR)
    throw new QrError('unrelated or oversized');
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new QrError('unrelated or oversized');
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new QrError('malformed');
  const o = raw as Record<string, unknown>;
  if (o.v !== 1 || o.kind !== QR_KIND) throw new QrError('malformed');
  if (typeof o.class_id !== 'string' || !CLASS_UUID.test(o.class_id)) throw new QrError('class id');
  if (typeof o.public_key !== 'string') throw new QrError('key encoding');
  const der = b64urlDecode(o.public_key);
  assertRsa2048Spki(der);
  // Display-only, so a bad or absent name must never reject an otherwise valid class QR.
  const class_name = cleanClassName(o.class_name);
  return {
    v: 1,
    kind: QR_KIND,
    class_id: o.class_id,
    public_key: o.public_key,
    ...(class_name ? { class_name } : {}),
  };
}

export function sameBinding(a: TeacherQr, b: { class_id: string; public_key: string }): boolean {
  return a.class_id === b.class_id && a.public_key === b.public_key;
}
