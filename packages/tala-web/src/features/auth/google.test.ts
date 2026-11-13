import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TalaApiError } from '@hiraia/tala-core/contracts';
import { idTokenEmail } from './google';
import { errorKey, errorReason } from '@/data/errors';

const b64url = (s: string) => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

test('idTokenEmail reads the email claim for display only and tolerates junk', () => {
  const token = `${b64url('{"alg":"RS256"}')}.${b64url('{"email":"teacher@example.com","email_verified":true}')}.sig`;
  assert.equal(idTokenEmail(token), 'teacher@example.com');
  assert.equal(idTokenEmail('not-a-token'), '');
});

test('every Google / merge reason code maps to a plain-language string', () => {
  const reasons = ['google_sign_in_not_available', 'google_not_configured', 'google_unreachable', 'google_token_invalid', 'google_email_not_verified', 'verify_email_first', 'google_already_linked', 'google_in_use', 'no_account_to_link', 'last_sign_in_method', 'account_merged', 'other_account_not_proven', 'same_account', 'merge_proof_missing', 'wrong_password'];
  for (const reason of reasons) {
    const err = new TalaApiError('conflict', 'x', 409, { reason });
    assert.equal(errorReason(err), reason);
    assert.notEqual(errorKey(err), 'error.generic', `${reason} should have its own message`);
  }
});
