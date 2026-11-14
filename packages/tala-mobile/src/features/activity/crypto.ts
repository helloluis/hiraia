/**
 * What the session needs from the native side. `modules/tala-activity` implements it over the
 * Android keystore and javax.crypto (nativeCrypto.ts); nodeCrypto.ts implements it with node:crypto
 * for tests and also plays the student's role there. Every string is base64url without padding.
 */
export interface ActivityCrypto {
  sha256(bytes: Uint8Array): Promise<Uint8Array>;
  randomBytes(count: number): Promise<Uint8Array>;
  /** Fresh 24 random bytes, base64url (ClassIdentity.challenge). */
  challenge(): Promise<string>;
  /** Ensures the class's RSA-2048 key exists; returns the SPKI public key (base64url). */
  ensureClassKey(classId: string): Promise<string>;
  hasClassKey(classId: string): Promise<boolean>;
  deleteClassKey(classId: string): Promise<void>;
  /** RSA-OAEP SHA-256/MGF1-SHA1 unwrap; must yield 32 bytes. Throws otherwise. */
  unwrapSessionKey(classId: string, wrappedB64: string): Promise<string>;
  /** AES-256-GCM, AAD = UTF-8(challenge). Throws on a bad tag. */
  decryptEnvelope(
    sessionKeyB64: string,
    challenge: string,
    nonceB64: string,
    ciphertextB64: string
  ): Promise<string>;
  /** The outer `{"v":1,"type":…,"nonce":…,"ciphertext":…}` JSON. */
  encryptReply(
    sessionKeyB64: string,
    challenge: string,
    type: 'ready' | 'ack',
    plaintext: string
  ): Promise<string>;
  newManualCode(): Promise<string>;
  /** The `manual_key` outer JSON; throws when the proof or nonce is wrong. */
  manualRespond(
    code: string,
    challenge: string,
    clientNonceB64: string,
    proofB64: string,
    qrPayload: string
  ): Promise<string>;
}
