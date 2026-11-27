import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packWeeks, summarizeCurriculum, weekKey, type PackWeek } from './coverage';
import { SCIENCE_COVERAGE } from './science-coverage.generated';
import { en } from '../../i18n/en';
import { fil } from '../../i18n/fil';

const here = fileURLToPath(new URL('.', import.meta.url));
const PACKS = resolve(here, '../../../../tala-server/data/packs');
const LIBRARY_INDEX = resolve(here, '../../../../tala-packs/library/index.json');

interface RawPack {
  curriculumVersion: string;
  grade: string;
  learningAreaId: string;
  competencies: Array<{ id: string; termIndex: number; weekFrom: number | null; weekTo: number | null; source: { document: string; edition: string; page: number; url: string } }>;
}
const sciencePacks = (): RawPack[] =>
  readdirSync(PACKS)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(resolve(PACKS, f), 'utf8')) as RawPack)
    .filter((p) => p.learningAreaId === 'science');

test('the generated curriculum map is exactly what the shipped Science packs say', () => {
  assert.deepEqual(SCIENCE_COVERAGE, summarizeCurriculum(sciencePacks()), 'run `pnpm exec tsx scripts/home-coverage.mjs` after changing the Science curriculum packs');
});

test('the map adds up: every grade has its terms, and the totals are the sums', () => {
  const c = SCIENCE_COVERAGE;
  assert.equal(c.competencies, c.grades.reduce((n, g) => n + g.competencies, 0));
  assert.equal(c.weeks, c.grades.reduce((n, g) => n + g.weeks, 0));
  for (const g of c.grades) {
    assert.deepEqual(g.terms.map((t) => t.term), [1, 2, 3], `Grade ${g.grade} has three terms`);
    assert.equal(g.competencies, g.terms.reduce((n, t) => n + t.competencies, 0));
    assert.equal(g.weeks, g.terms.reduce((n, t) => n + t.weeks, 0));
  }
});

test('"each with its page" holds: every Science competency names its DepEd document, edition, page and link', () => {
  for (const pack of sciencePacks())
    for (const c of pack.competencies) {
      assert.ok(c.source.document && c.source.edition && c.source.url && Number.isInteger(c.source.page) && c.source.page >= 1, `${c.id} has a complete source`);
      assert.match(c.source.document, /^DepEd Science G\d+: 2026 Three-Term BOW$/, `${c.id} comes from the 2026 Budget of Work`);
    }
});

test('a week with no competency stops the summary instead of being drawn as mapped', () => {
  assert.throws(
    () => summarizeCurriculum([{ curriculumVersion: 'v', grade: '3', competencies: [{ termIndex: 1, weekFrom: 1, weekTo: 2 }, { termIndex: 1, weekFrom: 4, weekTo: 5 }] }]),
    /week 3 has no competency/
  );
  assert.throws(() => summarizeCurriculum([{ curriculumVersion: 'v', grade: '3', competencies: [{ termIndex: 1, weekFrom: null, weekTo: null }] }]), /has no weeks/);
});

test('the teaching-pack library lists the same weeks and competencies as the curriculum map', () => {
  const index = JSON.parse(readFileSync(LIBRARY_INDEX, 'utf8')) as { curriculumVersion: string; packs: Array<PackWeek & { competencyIds: string[] }> };
  assert.equal(index.curriculumVersion, SCIENCE_COVERAGE.curriculumVersion);
  const mapWeeks = new Set<string>();
  for (const g of SCIENCE_COVERAGE.grades) for (const t of g.terms) for (let w = 1; w <= t.weeks; w++) mapWeeks.add(weekKey(g.grade, t.term, w));
  assert.deepEqual([...new Set(index.packs.map((p) => weekKey(p.grade, p.term, p.week)))].sort(), [...mapWeeks].sort());
  assert.equal(new Set(index.packs.flatMap((p) => p.competencyIds)).size, SCIENCE_COVERAGE.competencies);
});

test('pack weeks: only built packs in the language asked for count, and never outside the map', () => {
  const week = (grade: string, term: number, n: number, en: string, fil: string): PackWeek => ({ grade, term, week: n, variants: { en: { status: en }, fil: { status: fil } } });
  const index = {
    curriculumVersion: SCIENCE_COVERAGE.curriculumVersion,
    packs: [week('3', 1, 1, 'draft', 'not_built'), week('3', 1, 2, 'needs_work', 'draft'), week('3', 1, 3, 'failed', 'failed'), week('3', 1, 4, 'approved', 'not_built'), week('3', 1, 99, 'draft', 'draft'), week('2', 1, 1, 'draft', 'draft')],
  };
  const forEn = packWeeks(index, SCIENCE_COVERAGE, 'en')!;
  assert.deepEqual([...forEn.built].sort(), ['3.1.1', '3.1.2', '3.1.4']);
  assert.equal(forEn.approved, 1);
  const forFil = packWeeks(index, SCIENCE_COVERAGE, 'fil')!;
  assert.deepEqual([...forFil.built], ['3.1.2']);
  assert.equal(forFil.approved, 0);
  assert.equal(packWeeks(null, SCIENCE_COVERAGE, 'en'), null, 'no index: nothing is said about packs');
  assert.equal(packWeeks({ ...index, curriculumVersion: 'another' }, SCIENCE_COVERAGE, 'en'), null, 'an index for another curriculum is not drawn on this map');
});

test('homepage copy carries no hard-coded counts: numbers come from the map and the live index', () => {
  for (const strings of [en, fil] as Array<Record<string, string>>)
    for (const [key, text] of Object.entries(strings)) {
      if (!key.startsWith('landing.s.')) continue;
      // "2026" (the Budget of Work's year) and grade or period numbers in a picture's description are not counts.
      const bare = text.replace(/\{\w+\}/g, '').replace(/2026/g, '');
      if (key.endsWith('.alt')) continue;
      assert.doesNotMatch(bare, /\d{2,}/, `${key} writes a number into the copy: "${text}"`);
    }
});
