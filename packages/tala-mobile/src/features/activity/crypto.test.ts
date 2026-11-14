import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPublicKey } from 'node:crypto';
import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  manual,
  nodeCrypto,
  oaepPad,
  oaepUnpad,
  studentDecrypt,
  studentEncrypt,
  studentManual,
} from './nodeCrypto';
import { b64urlDecode, b64urlEncode, utf8 } from './protocol';

test('manual OAEP padding (SHA-256 label, MGF1-SHA1) round-trips and detects tampering', () => {
  const message = new Uint8Array(32).map((_, i) => i);
  const block = oaepPad(message);
  assert.equal(block.length, 256);
  assert.deepEqual([...oaepUnpad(block)], [...message]);
  const tampered = new Uint8Array(block);
  tampered[40]! ^= 1;
  assert.throws(() => oaepUnpad(tampered));
  assert.throws(() => oaepUnpad(block.slice(1)));
});

test('the teacher unwraps what the student wrapped, and a wrong class key fails', async () => {
  const teacher = nodeCrypto();
  const publicKey = await teacher.ensureClassKey('class-a');
  await teacher.ensureClassKey('class-b');
  const { outer, sessionKey } = studentEncrypt(publicKey, 'chal', 'intro', { hello: 1 });
  const envelope = JSON.parse(outer) as { wrapped_key: string; nonce: string; ciphertext: string };
  const unwrapped = await teacher.unwrapSessionKey('class-a', envelope.wrapped_key);
  assert.equal(unwrapped, b64urlEncode(sessionKey));
  await assert.rejects(teacher.unwrapSessionKey('class-b', envelope.wrapped_key));
  const plain = await teacher.decryptEnvelope(
    unwrapped,
    'chal',
    envelope.nonce,
    envelope.ciphertext
  );
  assert.deepEqual(JSON.parse(plain), { hello: 1 });
  await assert.rejects(
    teacher.decryptEnvelope(unwrapped, 'other', envelope.nonce, envelope.ciphertext)
  );
  const reply = await teacher.encryptReply(unwrapped, 'chal', 'ready', '{"ok":true}');
  assert.deepEqual(studentDecrypt(sessionKey, 'chal', reply), {
    type: 'ready',
    body: { ok: true },
  });
  assert.throws(() => studentDecrypt(sessionKey, 'other', reply));
});

test('the public key is a 2048-bit SPKI the student QR parser would accept', async () => {
  const teacher = nodeCrypto();
  const der = b64urlDecode(await teacher.ensureClassKey('class-a'));
  assert.ok(der.length >= 290 && der.length <= 400 && der[0] === 0x30);
  const key = createPublicKey({ key: Buffer.from(der), format: 'der', type: 'spki' });
  assert.equal(key.asymmetricKeyDetails?.modulusLength, 2048);
});

test('AES-GCM rejects a bad tag, a bad AAD and a bad nonce length', () => {
  const key = new Uint8Array(32).fill(7);
  const nonce = new Uint8Array(12).fill(1);
  const sealed = aesGcmEncrypt(key, nonce, utf8('aad'), utf8('hi'));
  assert.equal(new TextDecoder().decode(aesGcmDecrypt(key, nonce, utf8('aad'), sealed)), 'hi');
  const tampered = new Uint8Array(sealed);
  tampered[0]! ^= 1;
  assert.throws(() => aesGcmDecrypt(key, nonce, utf8('aad'), tampered));
  assert.throws(() => aesGcmDecrypt(key, nonce, utf8('bad'), sealed));
  assert.throws(() => aesGcmDecrypt(key, new Uint8Array(11), utf8('aad'), sealed));
});

test('typed-code enrolment: proof, response key and AAD agree between student and teacher', async () => {
  const teacher = nodeCrypto({ manualCodes: ['ABCDEFGHJKMN'] });
  const code = await teacher.newManualCode();
  const challenge = 'c'.repeat(32);
  const student = studentManual(code, challenge);
  const request = JSON.parse(student.request) as { client_nonce: string; proof: string };
  const qr = '{"v":1,"kind":"hiraia-tala"}';
  const reply = await teacher.manualRespond(
    code,
    challenge,
    request.client_nonce,
    request.proof,
    qr
  );
  assert.equal(JSON.parse(reply).type, 'manual_key');
  assert.equal(student.open(reply), qr);
  // Wrong code, wrong challenge, short nonce: all refused.
  await assert.rejects(
    teacher.manualRespond('ABCDEFGHJKMP', challenge, request.client_nonce, request.proof, qr)
  );
  await assert.rejects(
    teacher.manualRespond(code, 'x'.repeat(32), request.client_nonce, request.proof, qr)
  );
  await assert.rejects(
    teacher.manualRespond(code, challenge, b64urlEncode(new Uint8Array(15)), request.proof, qr)
  );
  // The derivation matches the documented formulas byte for byte.
  const secret = manual.secret(code);
  const nonce = b64urlDecode(request.client_nonce);
  assert.equal(b64urlEncode(manual.proof(secret, challenge, nonce)), request.proof);
  assert.equal(manual.aad(challenge, nonce)[0], 3);
});
