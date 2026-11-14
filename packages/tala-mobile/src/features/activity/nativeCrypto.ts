import { b64urlDecode, b64urlEncode } from './protocol';
import type { ActivityCrypto } from './crypto';
import type { TalaActivityNative } from '../../../modules/tala-activity/src';

/** ActivityCrypto over the TalaActivity native module. */
export function nativeCrypto(native: TalaActivityNative): ActivityCrypto {
  return {
    async sha256(bytes) {
      return b64urlDecode(native.sha256(b64urlEncode(bytes)));
    },
    async randomBytes(count) {
      return b64urlDecode(native.randomBytes(count));
    },
    async challenge() {
      return native.challenge();
    },
    ensureClassKey: (classId) => native.ensureClassKey(classId),
    async hasClassKey(classId) {
      return native.hasClassKey(classId);
    },
    async deleteClassKey(classId) {
      native.deleteClassKey(classId);
    },
    unwrapSessionKey: (classId, wrapped) => native.unwrapSessionKey(classId, wrapped),
    decryptEnvelope: (key, challenge, nonce, ciphertext) =>
      native.decryptEnvelope(key, challenge, nonce, ciphertext),
    encryptReply: (key, challenge, type, plaintext) =>
      native.encryptReply(key, challenge, type, plaintext),
    async newManualCode() {
      return native.newManualCode();
    },
    manualRespond: (code, challenge, nonce, proof, qr) =>
      native.manualRespond(code, challenge, nonce, proof, qr),
  };
}
