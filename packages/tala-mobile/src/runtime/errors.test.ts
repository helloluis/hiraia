import { test } from 'node:test';
import assert from 'node:assert/strict';
import { messageForError } from './errors';
test('server reason/code select localised keys without exposing server prose', () => {
  assert.equal(
    messageForError({
      code: 'conflict',
      details: { reason: 'email_taken' },
      message: 'English server text',
    }),
    'emailTaken'
  );
  assert.equal(messageForError({ code: 'unauthenticated' }), 'signInAgain');
  assert.equal(
    messageForError({ code: 'internal', details: { reason: 'future_reason' } }),
    'failed'
  );
  assert.equal(messageForError(null), 'failed');
});
