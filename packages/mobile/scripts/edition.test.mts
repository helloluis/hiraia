import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ACTIVE_EDITION, SUPPORTED_EDITIONS, editionForCountry, editionLanguage } from '../src/config/edition';
import { DEFAULT_LANGUAGE, LANGUAGE_OPTIONS } from '../src/config/languages';
import { GRADE_OPTIONS, toGradeLevel } from '../src/config/grades';
import { voiceForLanguage } from '../src/voice/catalog';

test('the current edition is implicitly PH and keeps every supported text language bundled', () => {
  assert.deepEqual(SUPPORTED_EDITIONS.map(e => e.country), ['PH']);
  assert.equal(editionForCountry('PH'), ACTIVE_EDITION);
  assert.throws(() => editionForCountry('PE'), /Unsupported country/);
  assert.equal(ACTIVE_EDITION.textDelivery, 'bundled');
  assert.deepEqual(LANGUAGE_OPTIONS.map(l => l.lang), ['tagalog', 'english', 'cebuano']);
  assert.equal(DEFAULT_LANGUAGE, 'tagalog');
  assert.deepEqual(GRADE_OPTIONS, [3,4,5,6,7,8,9,10]);
  assert.equal(toGradeLevel('10'), 10);
  assert.equal(toGradeLevel('11'), null);
});

test('text language availability is separate from voice delivery and model identity', () => {
  assert.equal(voiceForLanguage('english')?.delivery, 'bundled');
  assert.equal(voiceForLanguage('tagalog')?.delivery, 'download');
  assert.equal(voiceForLanguage('cebuano'), null);
  assert.equal(editionLanguage('cebuano').comingSoon, undefined);
  for (const voice of [voiceForLanguage('english')!, voiceForLanguage('tagalog')!]) {
    assert.equal(voice.meta.sha256, voice.sha256);
    assert.ok(voice.filename.includes(voice.sha256.slice(0, 16)));
  }
  assert.equal(ACTIVE_EDITION.models.base.filename, 'hiraia-sft-2b-v2.Q4_K_M.gguf');
});
