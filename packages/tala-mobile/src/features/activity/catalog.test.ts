import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ParsedCatalog, nativeCatalog, emptyCatalog } from './catalog';
import { CATALOG_FIXTURE } from './fixtures';
import type { LearningEvent } from './learning';

const view = (cardId: string): LearningEvent => ({
  name: 'card_viewed',
  occurredAt: 0,
  correct: false,
  cardId,
  questionId: '',
});
const quiz = (cardId = '', questionId = ''): LearningEvent => ({
  name: 'quiz_graded',
  occurredAt: 0,
  correct: true,
  cardId,
  questionId,
});

test('card views resolve by card id, quizzes by fact (even when legacy history carries it as card id)', async () => {
  const catalog = ParsedCatalog.parse(CATALOG_FIXTURE);
  assert.deepEqual(await catalog.subcategories([view('ffct-00001'), view('ffct-00002')]), [
    ['Insects'],
    ['Insects', 'Mammals'],
  ]);
  assert.deepEqual(await catalog.subcategories([quiz('', 'storm-g4')]), [
    ['Weather Types', 'Mammals'],
  ]);
  assert.deepEqual(await catalog.subcategories([quiz('butterfly-g5')]), [['Insects']]);
  assert.deepEqual(await catalog.subcategories([quiz('x', 'storm-g4')]), [
    ['Weather Types', 'Mammals'],
  ]);
});

test('what cannot be placed has no subcategory; same-label taxonomy ids merge', async () => {
  const catalog = ParsedCatalog.parse(CATALOG_FIXTURE);
  assert.deepEqual(
    await catalog.subcategories([
      view(''),
      view('ffct-99999'),
      quiz('', 'ffct-00001'),
      view('butterfly-g5'),
      {
        name: 'session_started',
        occurredAt: 0,
        correct: false,
        cardId: 'ffct-00001',
        questionId: '',
      },
    ]),
    [[], [], [], [], []]
  );
  assert.deepEqual(
    await catalog.subcategories([view('dcard-00005'), view('dcard-00003'), quiz('', 'rain-g4')]),
    [['Weather Types'], ['Weather Types'], ['Weather Types']]
  );
  assert.equal(catalog.labelOf('g4-weather'), 'Weather Types');
  assert.equal(catalog.labelOf('weather'), 'Weather Types');
  assert.deepEqual([...catalog.ids()].sort(), ['g4-weather', 'insects', 'mammals', 'weather']);
  assert.equal(catalog.size, 8);
  // Cards with the same subcategories share one array.
  assert.equal(catalog.cards.get('ffct-00001'), catalog.cards.get('ffct-00004'));
});

test('malformed catalogs are refused', () => {
  for (const broken of [
    '',
    '# only a comment\n',
    'T\tinsects\n',
    'X\ta\tb\n',
    'T\tinsects\tInsects\nC\tffct-00001\t1\n',
    'T\tinsects\tInsects\nC\tffct-00001\t\n',
    'T\tinsects\tInsects\nC\tffct-00001\ta\n',
  ])
    assert.throws(() => ParsedCatalog.parse(broken), broken);
});

test('the native-backed catalog sends compact events and parses label arrays; the empty one places nothing', async () => {
  let sent = '';
  const catalog = nativeCatalog({
    async catalogSubcategories(json) {
      sent = json;
      return '[["Insects"],[]]';
    },
  });
  assert.deepEqual(await catalog.subcategories([view('ffct-00001'), view('')]), [['Insects'], []]);
  assert.deepEqual(JSON.parse(sent), [
    { name: 'card_viewed', cardId: 'ffct-00001', questionId: '' },
    { name: 'card_viewed', cardId: '', questionId: '' },
  ]);
  assert.deepEqual(await catalog.subcategories([]), []);
  assert.deepEqual(await emptyCatalog.subcategories([view('a')]), [[]]);
});

test('the real 0.4.x catalog parses when present (synced from the tala-0.4.x branch)', async () => {
  const { existsSync, readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  // Tests run from the package root (pnpm --filter @hiraia/tala-mobile test).
  const path = resolve('modules/tala-activity/android/src/main/assets/card-catalog.tsv');
  if (!existsSync(path)) return; // not synced in this checkout; the Gradle build syncs it
  const started = Date.now();
  const catalog = ParsedCatalog.parse(readFileSync(path, 'utf8'));
  assert.ok(catalog.size > 70_000, `expected the full catalog, got ${catalog.size} entries`);
  assert.ok(Date.now() - started < 5000);
});
