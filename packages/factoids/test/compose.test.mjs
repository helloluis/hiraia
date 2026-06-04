import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeText, pickLang, wordCount, LEAD } from '../src/compose.mjs';

const F = {
  id: 'x',
  imageId: 'bee-bubuyog',
  subject: 'biology',
  hook: { tl: 'ang mga bubuyog ay may reyna', en: 'bees have a queen', ceb: null },
  body: { tl: 'Siya ang ina ng kolonya.', en: 'She is the mother of the colony.', ceb: null },
  verified: true,
};

test('tagalog message uses the Alam mo ba na lead and ends the hook with ?', () => {
  const { text } = composeText(F, 'tagalog');
  assert.equal(text, 'Alam mo ba na ang mga bubuyog ay may reyna? Siya ang ina ng kolonya.');
});

test('english uses the Did you know lead', () => {
  const { text } = composeText(F, 'english');
  assert.ok(text.startsWith('Did you know that bees have a queen?'));
});

test('cebuano lead is used but text falls back to tagalog when ceb missing', () => {
  const { text, usedLang } = composeText(F, 'cebuano');
  assert.ok(text.startsWith('Nahibaw-an ba nimo nga '));
  assert.equal(usedLang, 'tl', 'should report it fell back to tl');
  assert.ok(text.includes('ang mga bubuyog ay may reyna'));
});

test('pickLang follows per-language fallback order', () => {
  assert.equal(pickLang({ tl: 'T', en: 'E', ceb: 'C' }, 'cebuano').usedLang, 'ceb');
  assert.equal(pickLang({ tl: 'T', en: 'E', ceb: null }, 'cebuano').usedLang, 'tl');
  assert.equal(pickLang({ tl: 'T', en: null, ceb: null }, 'english').usedLang, 'tl');
});

test('every lead template has the {x} slot', () => {
  for (const v of Object.values(LEAD)) assert.ok(v.includes('{x}'));
});

test('wordCount counts whitespace-separated tokens', () => {
  assert.equal(wordCount('  one  two three '), 3);
});
