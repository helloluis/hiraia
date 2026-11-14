/**
 * node:crypto implementation of ActivityCrypto for tests, plus the STUDENT side of the protocol
 * (what packages/mobile/modules/hiraia-tala TalaCrypto.java and src/tala/manual.ts do), so a test
 * can run a whole classroom exchange in one process. Never bundled into the app: only *.test.ts
 * import it.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  createPublicKey,
  generateKeyPairSync,
  privateDecrypt,
  publicEncrypt,
  randomBytes,
  constants,
  type KeyObject,
} from 'node:crypto';
import { b64urlDecode, b64urlEncode, concat, utf8 } from './protocol';
import type { ActivityCrypto } from './crypto';

/**
 * MGF1 hash: Android's `OAEPParameterSpec("SHA-256","MGF1",MGF1ParameterSpec.SHA1,…)` uses SHA-1
 * for the mask and SHA-256 for the label hash. Node's `publicEncrypt`/`privateDecrypt` always use
 * `oaepHash` for both, so with oaepHash 'sha256' Node produces SHA-256/MGF1-SHA256 ciphertext, which
 * Android would NOT unwrap. Tests therefore do their own OAEP padding (rfc8017 §7.1) with the exact
 * hash split and hand the padded block to a raw RSA operation, so the vectors are Android-true.
 */
export const mgf1Note = 'OAEP: label hash SHA-256, MGF1 hash SHA-1 (manual padding below)';

function mgf1Sha1(seed: Uint8Array, length: number): Uint8Array {
  const out: Uint8Array[] = [];
  for (let counter = 0; out.reduce((n, p) => n + p.length, 0) < length; counter++) {
    const c = new Uint8Array(4);
    new DataView(c.buffer).setUint32(0, counter);
    out.push(new Uint8Array(createHash('sha1').update(concat(seed, c)).digest()));
  }
  return concat(...out).slice(0, length);
}

function xor(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i]! ^ b[i]!;
  return out;
}

/** RSAES-OAEP encode with lHash = SHA-256(''), MGF1-SHA1, k = 256 bytes (RSA-2048). */
export function oaepPad(message: Uint8Array, seed = new Uint8Array(randomBytes(32))): Uint8Array {
  const k = 256;
  const hLen = 32;
  const lHash = new Uint8Array(createHash('sha256').update(new Uint8Array()).digest());
  const ps = new Uint8Array(k - message.length - 2 * hLen - 2);
  const db = concat(lHash, ps, new Uint8Array([1]), message);
  const dbMask = mgf1Sha1(seed, k - hLen - 1);
  const maskedDb = xor(db, dbMask);
  const seedMask = mgf1Sha1(maskedDb, hLen);
  const maskedSeed = xor(seed, seedMask);
  return concat(new Uint8Array([0]), maskedSeed, maskedDb);
}

export function oaepUnpad(block: Uint8Array): Uint8Array {
  const k = 256;
  const hLen = 32;
  if (block.length !== k || block[0] !== 0) throw new Error('oaep');
  const maskedSeed = block.slice(1, 1 + hLen);
  const maskedDb = block.slice(1 + hLen);
  const seed = xor(maskedSeed, mgf1Sha1(maskedDb, hLen));
  const db = xor(maskedDb, mgf1Sha1(seed, k - hLen - 1));
  const lHash = new Uint8Array(createHash('sha256').update(new Uint8Array()).digest());
  for (let i = 0; i < hLen; i++) if (db[i] !== lHash[i]) throw new Error('oaep');
  let i = hLen;
  while (i < db.length && db[i] === 0) i++;
  if (db[i] !== 1) throw new Error('oaep');
  return db.slice(i + 1);
}

function rawRsa(key: KeyObject, block: Uint8Array, direction: 'public' | 'private'): Uint8Array {
  const options = { key, padding: constants.RSA_NO_PADDING };
  return new Uint8Array(
    direction === 'public' ? publicEncrypt(options, block) : privateDecrypt(options, block)
  );
}

export function sha256Sync(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(createHash('sha256').update(bytes).digest());
}

export function hmacSha256Sync(key: Uint8Array, message: Uint8Array): Uint8Array {
  return new Uint8Array(createHmac('sha256', key).update(message).digest());
}

export function aesGcmEncrypt(
  key: Uint8Array,
  nonce: Uint8Array,
  aad: Uint8Array,
  plaintext: Uint8Array
): Uint8Array {
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(aad);
  const body = cipher.update(plaintext);
  cipher.final();
  return concat(new Uint8Array(body), new Uint8Array(cipher.getAuthTag()));
}

export function aesGcmDecrypt(
  key: Uint8Array,
  nonce: Uint8Array,
  aad: Uint8Array,
  ciphertext: Uint8Array
): Uint8Array {
  if (nonce.length !== 12) throw new Error('nonce');
  if (ciphertext.length < 16) throw new Error('tag');
  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAAD(aad);
  decipher.setAuthTag(ciphertext.slice(ciphertext.length - 16));
  const body = decipher.update(ciphertext.slice(0, ciphertext.length - 16));
  return concat(new Uint8Array(body), new Uint8Array(decipher.final()));
}

const MANUAL_PREFIX = 'hiraia-tala-manual-v1:';
const tagged = (tag: number, challenge: string, nonce: Uint8Array) =>
  concat(new Uint8Array([tag]), utf8(challenge), nonce);
export const manual = {
  secret: (code: string) => sha256Sync(concat(utf8(MANUAL_PREFIX), utf8(code))),
  proof: (secret: Uint8Array, challenge: string, nonce: Uint8Array) =>
    hmacSha256Sync(secret, tagged(1, challenge, nonce)),
  responseKey: (secret: Uint8Array, challenge: string, nonce: Uint8Array) =>
    hmacSha256Sync(secret, tagged(2, challenge, nonce)),
  aad: (challenge: string, nonce: Uint8Array) => tagged(3, challenge, nonce),
};

/** The teacher's keys, in memory: one RSA-2048 pair per class id, like the keystore. */
export function nodeCrypto(options: { manualCodes?: string[] } = {}): ActivityCrypto & {
  keys: Map<string, { publicKey: KeyObject; privateKey: KeyObject }>;
} {
  const keys = new Map<string, { publicKey: KeyObject; privateKey: KeyObject }>();
  const codes = [...(options.manualCodes ?? [])];
  const spki = (key: KeyObject) =>
    b64urlEncode(new Uint8Array(key.export({ type: 'spki', format: 'der' }) as Buffer));
  return {
    keys,
    async sha256(bytes) {
      return sha256Sync(bytes);
    },
    async randomBytes(count) {
      return new Uint8Array(randomBytes(count));
    },
    async challenge() {
      return b64urlEncode(new Uint8Array(randomBytes(24)));
    },
    async ensureClassKey(classId) {
      let pair = keys.get(classId);
      if (!pair) {
        pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
        keys.set(classId, pair);
      }
      return spki(pair.publicKey);
    },
    async hasClassKey(classId) {
      return keys.has(classId);
    },
    async deleteClassKey(classId) {
      keys.delete(classId);
    },
    async unwrapSessionKey(classId, wrapped) {
      const pair = keys.get(classId);
      if (!pair) throw new Error('no key');
      const key = oaepUnpad(rawRsa(pair.privateKey, b64urlDecode(wrapped), 'private'));
      if (key.length !== 32) throw new Error('session key size');
      return b64urlEncode(key);
    },
    async decryptEnvelope(sessionKey, challenge, nonce, ciphertext) {
      return new TextDecoder().decode(
        aesGcmDecrypt(
          b64urlDecode(sessionKey),
          b64urlDecode(nonce),
          utf8(challenge),
          b64urlDecode(ciphertext)
        )
      );
    },
    async encryptReply(sessionKey, challenge, type, plaintext) {
      const nonce = new Uint8Array(randomBytes(12));
      const sealed = aesGcmEncrypt(
        b64urlDecode(sessionKey),
        nonce,
        utf8(challenge),
        utf8(plaintext)
      );
      return JSON.stringify({
        v: 1,
        type,
        nonce: b64urlEncode(nonce),
        ciphertext: b64urlEncode(sealed),
      });
    },
    async newManualCode() {
      if (codes.length) return codes.shift()!;
      const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
      let code = '';
      while (code.length < 12) {
        const v = randomBytes(1)[0]!;
        if (v < 248) code += alphabet[v % alphabet.length];
      }
      return code;
    },
    async manualRespond(code, challenge, clientNonceB64, proofB64, qrPayload) {
      const clientNonce = b64urlDecode(clientNonceB64);
      if (clientNonce.length !== 16) throw new Error('client nonce');
      const secret = manual.secret(code);
      const expected = manual.proof(secret, challenge, clientNonce);
      const given = b64urlDecode(proofB64);
      let diff = expected.length ^ given.length;
      for (let i = 0; i < expected.length; i++) diff |= expected[i]! ^ (given[i] ?? 0);
      if (diff !== 0) throw new Error('proof');
      const nonce = new Uint8Array(randomBytes(12));
      const sealed = aesGcmEncrypt(
        manual.responseKey(secret, challenge, clientNonce),
        nonce,
        manual.aad(challenge, clientNonce),
        utf8(qrPayload)
      );
      return JSON.stringify({
        v: 1,
        type: 'manual_key',
        nonce: b64urlEncode(nonce),
        ciphertext: b64urlEncode(sealed),
      });
    },
  };
}

/** The student phone's half, for tests: wrap a fresh key for the QR's public key and seal a body. */
export function studentEncrypt(
  publicKeyB64: string,
  challenge: string,
  type: 'intro' | 'batch',
  body: unknown
): { outer: string; sessionKey: Uint8Array } {
  const publicKey = createPublicKey({
    key: Buffer.from(b64urlDecode(publicKeyB64)),
    format: 'der',
    type: 'spki',
  });
  const sessionKey = new Uint8Array(randomBytes(32));
  const wrapped = rawRsa(publicKey, oaepPad(sessionKey), 'public');
  const nonce = new Uint8Array(randomBytes(12));
  const sealed = aesGcmEncrypt(sessionKey, nonce, utf8(challenge), utf8(JSON.stringify(body)));
  return {
    sessionKey,
    outer: JSON.stringify({
      v: 1,
      type,
      wrapped_key: b64urlEncode(wrapped),
      nonce: b64urlEncode(nonce),
      ciphertext: b64urlEncode(sealed),
    }),
  };
}

/** The student decrypting a `ready`/`ack`. */
export function studentDecrypt(sessionKey: Uint8Array, challenge: string, outerJson: string) {
  const outer = JSON.parse(outerJson) as { nonce: string; ciphertext: string; type: string };
  const plain = aesGcmDecrypt(
    sessionKey,
    b64urlDecode(outer.nonce),
    utf8(challenge),
    b64urlDecode(outer.ciphertext)
  );
  return { type: outer.type, body: JSON.parse(new TextDecoder().decode(plain)) };
}

/** The student typing a backup code: the manual_enroll request and how to read the manual_key. */
export function studentManual(code: string, challenge: string) {
  const clientNonce = new Uint8Array(randomBytes(16));
  const secret = manual.secret(code);
  return {
    request: JSON.stringify({
      v: 1,
      type: 'manual_enroll',
      client_nonce: b64urlEncode(clientNonce),
      proof: b64urlEncode(manual.proof(secret, challenge, clientNonce)),
    }),
    open(outerJson: string): string {
      const outer = JSON.parse(outerJson) as { nonce: string; ciphertext: string };
      return new TextDecoder().decode(
        aesGcmDecrypt(
          manual.responseKey(secret, challenge, clientNonce),
          b64urlDecode(outer.nonce),
          manual.aad(challenge, clientNonce),
          b64urlDecode(outer.ciphertext)
        )
      );
    },
  };
}
