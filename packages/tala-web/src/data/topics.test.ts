import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Competency } from '@hiraia/tala-core/contracts';
import { timeLabel, topicLabel, topicTitle } from './topics';

const base: Competency = {
  id: 'science-bow-2026.science.g4.t2.6',
  code: null,
  learningAreaId: 'science',
  grade: '4',
  termIndex: 2,
  sequence: 5,
  text: 'Participate in guided activities to demonstrate that pushes and pulls can be used to change the speed and direction of an object.',
  textLang: 'en',
  contentStandard: null,
  performanceStandard: null,
  domain: 'Force, Motion and Energy in everyday life',
  weight: null,
  weightSource: 'estimated',
  source: { document: 'x', edition: null, page: null, url: null },
};

test('uses shortTitle and week labels when the pack has them', () => {
  const c = {
    ...base,
    shortTitle: 'Exploring Motion',
    shortTitleSource: 'official' as const,
    weekFrom: 1,
    weekTo: 1,
  };
  const l = topicLabel(c, 'en');
  assert.equal(l.heading, 'Term 2, Week 1: Exploring Motion');
  assert.equal(l.text, base.text, 'full competency text is kept');
  assert.equal(timeLabel({ ...c, weekFrom: 3, weekTo: 4 }, 'fil'), 'Term 2, Weeks 3–4');
});

test('falls back to the domain trimmed to four words and to "Term N" without a week', () => {
  assert.equal(topicTitle(base), 'Force, Motion and Energy');
  assert.equal(topicLabel(base, 'en').heading, 'Term 2: Force, Motion and Energy');
  assert.equal(topicTitle({ ...base, domain: null }), 'Participate in guided activities…');
});
