import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { LessonSlides, PackIndexEntry, PackStatus, PackVariant, SessionPart, SlidesJob } from '@hiraia/tala-core/contracts';
import { buildCombinedPlan, gradeLessonFromPlan } from '@hiraia/tala-core/plan';
import { fixtureClass, fixtureIds, packLikePlan } from '../../../../tala-core/src/plan/combine-fixtures';
import { rewritable, viewOfLessonSlides, viewOfSession } from '../slides/deck-model';
import { jobBusy, packChoiceForLesson, secondsSince, unsent } from './presentation-model';

const variant = (language: 'en' | 'fil', status: PackStatus, viewable = status !== 'not_built'): PackVariant => ({
  language, status, title: viewable ? `${language.toUpperCase()} title` : null, viewable, files: [], slideCount: 50, illustratedSlides: 10, review: null,
});
const entry = (packId: string, grade: string, term: number, week: number, competencyIds: string[], en: PackStatus, fil: PackStatus): PackIndexEntry => ({
  packId, grade, term, week, topic: `Topic ${packId}`, competencyIds, status: en, viewable: true, variants: { en: variant('en', en), fil: variant('fil', fil) },
});
const year = { terms: [{ index: 2, startDate: '2026-09-14', endDate: '2026-12-18' }] };

test('the pack a lesson was made from is its slides, on the day its title says', () => {
  const { plan } = packLikePlan({ grade: '4', groupId: 'group001', topic: 'Roots', lang: 'en', newId: fixtureIds('p') });
  const index = { packs: [entry('sci26-g4-t2-w10', '4', 2, 10, [], 'draft', 'not_built')] };
  const c = packChoiceForLesson({ plan, index, year });
  assert.deepEqual(c, { packId: 'sci26-g4-t2-w10', lang: 'en', day: 2, title: 'EN title', status: 'draft', otherLanguage: false, match: 'lineage' });
  // A Filipino lesson whose pack has no Filipino version yet: the English one, said so.
  const fil = packChoiceForLesson({ plan: { ...plan, language: 'fil' }, index, year });
  assert.equal(fil?.lang, 'en');
  assert.equal(fil?.otherLanguage, true);
  // Nothing to copy when the pack is not in the library (or the library has not loaded).
  assert.equal(packChoiceForLesson({ plan, index: { packs: [] }, year }), null);
  assert.equal(packChoiceForLesson({ plan, index: null, year }), null);
});

test('a Science lesson without a pack gets the pack This Week would suggest; other subjects get none', () => {
  const { plan } = packLikePlan({ grade: '4', groupId: 'group001', topic: 'Roots', lang: 'en', newId: fixtureIds('q') });
  const own = { ...plan, lineage: null, title: 'My roots lesson' };
  const index = { packs: [entry('sci26-g4-t2-w11', '4', 2, 11, Object.values(plan.competencies).flat(), 'approved', 'approved')] };
  const c = packChoiceForLesson({ plan: own, index, year });
  assert.equal(c?.packId, 'sci26-g4-t2-w11');
  assert.equal(c?.match, 'topic');
  // Tuesday 24 Nov 2026 is in week 11 of the term: the pack's Day 2.
  assert.equal(c?.day, 2);
  assert.equal(packChoiceForLesson({ plan: { ...own, subjectName: 'English', learningAreaId: 'english' }, index, year }), null);
  // The Mathematics pilot cannot be copied into Tala.
  const math = { ...plan, lineage: { ...plan.lineage!, artifactId: 'pack.math26-g4-t3-w01' } };
  assert.equal(packChoiceForLesson({ plan: math, index: { packs: [entry('math26-g4-t3-w01', '4', 3, 1, [], 'draft', 'draft')] }, year }), null);
});

test('request states, the edits still on this device, and what can be rewritten one at a time', () => {
  const job = (status: SlidesJob['status']) => ({ status }) as SlidesJob;
  assert.equal(jobBusy(job('queued')), true);
  assert.equal(jobBusy(job('running')), true);
  assert.equal(jobBusy(job('ready')), false);
  assert.equal(jobBusy(null), false);
  assert.equal(secondsSince('2026-11-27T10:00:00Z', Date.parse('2026-11-27T10:00:12Z')), 12);
  assert.equal(unsent([{ dirty: false }, null, { dirty: true }]), true);
  assert.equal(unsent([{ dirty: false }]), false);
  assert.deepEqual(['cover', 'day', 'concept', 'check', 'reveal', 'credits'].map((kind) => rewritable({ kind } as never)), [false, false, true, true, false, false]);
});

const lessonSlides = (deckId: string, day: number): LessonSlides => ({
  deckId, origin: 'pack', packId: 'sci26-g4-t2-w10', language: 'en', title: 'Roots', grade: '4', term: 2, week: 10, subject: 'Science', sourceApproved: false,
  credits: { reviewer: null, sourcesLine: '' }, deckSlideCount: 50, days: [1, 2, 3, 4, 5], media: [], edited: true, rev: 3, updatedAt: '2026-11-27T00:00:00Z',
  slides: [
    { id: `d${day}s1`, day, kind: 'day', title: 'Roots', lines: [], choices: [], revealOf: null, correctChoice: null, image: null, notes: '', sourceId: `d${day}s1` },
    { id: `d${day}s2`, day, kind: 'concept', title: 'Roots hold', lines: ['Roots hold the plant.'], choices: [], revealOf: null, correctChoice: null, image: { slug: 'roots', alt: 'Roots' }, notes: '', sourceId: `d${day}s2` },
    { id: 'd0s9', day: 0, kind: 'credits', title: 'Credits', lines: [], choices: [], revealOf: null, correctChoice: null, image: null, notes: '', sourceId: 'd0s9' },
  ],
});

test('a lesson’s slides draw like the deck: its day, the credits saying the copy was edited', () => {
  const view = viewOfLessonSlides(lessonSlides('deck1', 2), (slug) => `/m/${slug}`);
  assert.equal(view.layouts.length, 3);
  assert.equal(view.layouts[1]!.picture, 'roots');
  const credits = view.layouts[2]!.items.flatMap((i) => (i.type === 'text' ? i.paragraphs.map((p) => p.runs.map((r) => r.text).join('')) : []));
  assert.ok(credits.some((x) => x.includes('edited by its teacher')), credits.join(' | '));
});

test('a session view is put together from the plan on this device: a teacher’s change shows at once', () => {
  const newId = fixtureIds('v');
  const cls = fixtureClass(['4', '5']);
  const g4 = packLikePlan({ grade: '4', groupId: 'group001', topic: 'Roots', lang: 'en', newId });
  const g5 = packLikePlan({ grade: '5', groupId: 'group002', topic: 'Weather', lang: 'en', newId });
  const built = buildCombinedPlan({
    cls, assignment: null, date: '2026-11-24', minutes: 60, language: 'en', newId,
    lessons: [g4, g5].map((l, i) => gradeLessonFromPlan({ plan: l.plan, sections: l.sections, groupId: `group00${i + 1}`, grade: l.plan.grades[0]! })),
  });
  const parts: SessionPart[] = [
    { groupId: 'group001', grade: '4', source: { planId: g4.plan.id, title: g4.plan.title, chosen: 'auto' }, link: null, slides: lessonSlides('deck-g4', 2), stale: false },
    { groupId: 'group002', grade: '5', source: { planId: g5.plan.id, title: g5.plan.title, chosen: 'auto' }, link: null, slides: null, stale: false },
  ];
  const urls = (deckId: string, slug: string) => `/decks/${deckId}/media/${slug}`;
  const one = viewOfSession({ plan: built.plan, sections: built.sections, parts }, urls);
  assert.deepEqual(one.assembled.missing, ['group002']);
  const pic = one.view.layouts.find((l) => l.picture)!.picture!;
  assert.equal(one.view.mediaUrl(pic), '/decks/deck-g4/media/roots');
  // She renames a block in the plan on this device: the session's slides follow before anything is saved.
  const sections = built.sections.map((s) =>
    s.content.type === 'multigrade' ? { ...s, content: { ...s.content, blocks: s.content.blocks.map((b, i) => (i === 1 ? { ...b, label: 'Roots with me' } : b)) } } : s
  );
  const two = viewOfSession({ plan: built.plan, sections, parts }, urls);
  assert.ok(two.assembled.layout.slides.some((s) => s.role === 'block' && s.title === 'Roots with me'));
  assert.notEqual(JSON.stringify(two.view.layouts), JSON.stringify(one.view.layouts));
});
