import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveErrorOf } from './save-error';

test('27 Nov: a full device is told apart from any other failed write', () => {
  assert.equal(saveErrorOf(new DOMException('full', 'QuotaExceededError')), 'storage_full');
  assert.equal(saveErrorOf(new Error('The quota has been exceeded.')), 'storage_full');
  assert.equal(saveErrorOf(new Error('Transaction aborted')), 'write_failed');
  assert.equal(saveErrorOf(null), 'write_failed');
});
