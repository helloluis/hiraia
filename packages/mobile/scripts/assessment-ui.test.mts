import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assessmentCopy, assessmentFeedGates, assessmentReminder, assessmentUiLanguage, canLeaveAssessmentError, type AssessmentFeedState } from '../src/assessment/uiCopy';

test('persisted language codes resolve to the pinned app language and speech copy', () => {
  for (const [persisted, app] of [['en', 'english'], ['tl', 'tagalog'], ['bis', 'cebuano']] as const) {
    assert.equal(assessmentUiLanguage(persisted), app);
    assert.ok(assessmentCopy(assessmentUiLanguage(persisted)).pick);
  }
  assert.equal(assessmentUiLanguage('bisaya'), 'cebuano');
  assert.equal(assessmentCopy('english').onboarding, 'Start with a 12-item Quiz!');
  assert.equal(assessmentCopy('english').nudge, 'Quiz time? 12 items only!');
});

test('a first assessment alternates only when eligible and the feed is quiet', () => {
  const first = { eligible: true, completed: 0, due: false, quiet: true, quizFace: false };
  assert.equal(assessmentReminder(first), null);
  assert.equal(assessmentReminder({ ...first, quizFace: true }), 'initial');
  assert.equal(assessmentReminder({ ...first, quizFace: true, eligible: false }), null);
  assert.equal(assessmentReminder({ ...first, quizFace: true, quiet: false }), null);
});

test('a completed baseline never reactivates rotation; due and new-segment entries stay static', () => {
  const returning = { eligible: true, completed: 1, due: true, quiet: true, quizFace: false };
  assert.equal(assessmentReminder(returning), 'due');
  assert.equal(assessmentReminder({ ...returning, quizFace: true }), 'due');
  assert.equal(assessmentReminder({ ...returning, due: false, quizFace: true }), null);
  assert.equal(assessmentReminder({ ...returning, quiet: false }), null);
  assert.equal(assessmentReminder({ ...returning, eligible: false }), null);
});

test('pre-start errors can close, while active or unknown sessions remain recoverable', () => {
  assert.equal(canLeaveAssessmentError(true, false, false), true);
  assert.equal(canLeaveAssessmentError(false, false, false), false);
  assert.equal(canLeaveAssessmentError(true, true, false), false);
  assert.equal(canLeaveAssessmentError(true, false, true), false);
});

test('foreground card reading is required; quizzes, chat, sheets and profile flows suppress nudges', () => {
  const reading: AssessmentFeedState = {
    foreground: true, focused: true, onboarding: false, choosingProfile: false,
    asking: false, review: false, sheet: false, assessment: false, search: false,
    memoryNotice: false, liveVisible: true, pageKind: 'fact', loaded: true, busy: false,
  };
  assert.deepEqual(assessmentFeedGates(reading), { unobstructed: true, quiet: true });
  for (const obstacle of ['onboarding', 'choosingProfile', 'asking', 'review', 'sheet', 'assessment', 'search', 'memoryNotice'] as const) {
    assert.deepEqual(assessmentFeedGates({ ...reading, [obstacle]: true }), { unobstructed: false, quiet: false }, obstacle);
  }
  for (const required of ['foreground', 'focused'] as const) {
    assert.deepEqual(assessmentFeedGates({ ...reading, [required]: false }), { unobstructed: false, quiet: false }, required);
  }
  for (const pageKind of ['quiz', 'recap', 'title', 'reward', 'response'] as const) {
    assert.equal(assessmentFeedGates({ ...reading, pageKind }).quiet, false, pageKind);
  }
  assert.equal(assessmentFeedGates({ ...reading, liveVisible: false }).quiet, false);
  assert.equal(assessmentFeedGates({ ...reading, loaded: false }).quiet, false);
  assert.equal(assessmentFeedGates({ ...reading, busy: true }).quiet, false);
});
