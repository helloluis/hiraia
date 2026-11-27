import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DeckSlide } from '../contracts/decks';
import type { PlanSection } from '../contracts/records';
import { fixtureIds, packLikePlan } from '../plan/combine-fixtures';
import { deckDays, lessonDigestSource, lessonForSlides, lessonIsEmpty, lessonSlidesOf, packDayOfPlan } from './lesson';
import { layoutInputFromDeck } from './from-pack';
import { layoutDeck, type TextItem } from './layout';

const lesson = () => packLikePlan({ grade: '4', groupId: 'group001', topic: 'Magnets', lang: 'en', newId: fixtureIds('l') });

test('the lesson digest changes with what slides are made from, and only with that', () => {
  const { plan, sections } = lesson();
  const base = lessonDigestSource(plan, sections);
  // Same lesson, sections in another order and with other record ids: same digest.
  const shuffled = [...sections].reverse().map((s, i) => ({ ...s, id: `other${i}` }));
  assert.equal(lessonDigestSource(plan, shuffled), base);
  // Writing the after-class reflection, locking, or moving the date: not a change of the lesson.
  const reflected = sections.map((s): PlanSection => (s.key === 'reflection' ? { ...s, content: { type: 'text', blocks: [{ t: 'p', spans: [{ text: 'It went well.' }] }] } } : s));
  assert.equal(lessonDigestSource(plan, reflected), base);
  assert.equal(lessonDigestSource({ ...plan, state: 'locked', placements: [{ classId: 'c', assignmentId: null, dates: ['2027-01-04'] }] }, sections), base);
  // A changed procedure, objective or title: a change.
  const procedure = sections.map((s): PlanSection =>
    s.content.type === 'procedure' ? { ...s, content: { ...s.content, steps: s.content.steps.map((st, i) => (i === 2 ? { ...st, title: 'Group work' } : st)) } } : s
  );
  assert.notEqual(lessonDigestSource(plan, procedure), base);
  assert.notEqual(lessonDigestSource({ ...plan, title: 'Day 2: Magnets and poles' }, sections), base);
  assert.notEqual(lessonDigestSource({ ...plan, customObjectives: ['Name two poles.'] }, sections), base);
});

test('the model gets the saved lesson in plain words, never its after-class sections', () => {
  const { plan, sections } = lesson();
  const withReflection = sections.map((s): PlanSection => (s.key === 'reflection' ? { ...s, content: { type: 'text', blocks: [{ t: 'p', spans: [{ text: 'PRIVATE REFLECTION' }] }] } } : s));
  const l = lessonForSlides({ plan, sections: withReflection, competencies: [{ code: 'S4-1', text: 'Describe magnets.' }] });
  assert.equal(l.language, 'en');
  assert.equal(l.grade, '4');
  assert.deepEqual(l.objectives, ['Learners will be able to describe magnets (Grade 4).']);
  assert.equal(l.procedure.length, 5);
  assert.equal(l.procedure[0]!.title, 'Activating prior knowledge');
  assert.ok(l.procedure[0]!.text.includes('Teacher: G4 teacher line for step 1.'));
  assert.ok(l.materials.includes('notebook'));
  assert.ok(l.assessment.includes('Exit ticket'));
  assert.deepEqual(l.competencies, [{ code: 'S4-1', text: 'Describe magnets.' }]);
  assert.ok(!JSON.stringify(l).includes('PRIVATE REFLECTION'));
  assert.equal(lessonIsEmpty(l), false);
  const blank = lessonForSlides({ plan: { ...plan, customObjectives: [] }, sections: sections.map((s) => ({ ...s, content: s.content.type === 'procedure' ? { type: 'procedure', steps: [] } : s.content.type === 'list' ? { type: 'list', items: [] } : { type: 'text', blocks: [] } })) });
  assert.equal(lessonIsEmpty(blank), true);
});

test('which slides are a lesson’s, and which day of a pack a lesson is', () => {
  const slides = [
    { id: 'd0s1', day: 0, kind: 'cover' },
    { id: 'd1s1', day: 1, kind: 'day' },
    { id: 'd1s2', day: 1, kind: 'concept' },
    { id: 'd2s1', day: 2, kind: 'day' },
    { id: 'd2s2', day: 2, kind: 'check' },
    { id: 'd0s9', day: 0, kind: 'credits' },
  ] as DeckSlide[];
  assert.deepEqual(lessonSlidesOf(slides, 2).map((s) => s.id), ['d2s1', 'd2s2', 'd0s9']);
  assert.equal(lessonSlidesOf(slides, 0).length, 6);
  assert.deepEqual(deckDays(slides), [1, 2]);
  const { plan } = lesson();
  assert.equal(packDayOfPlan(plan, [1, 2, 3, 4, 5]), 2); // "Day 2: Magnets"
  assert.equal(packDayOfPlan({ ...plan, title: 'Araw 3: Mga magnet' }, [1, 2, 3, 4, 5]), 3);
  // Renamed: the weekday of its date (Tuesday 24 Nov 2026 → Day 2); no date: the whole week.
  assert.equal(packDayOfPlan({ ...plan, title: 'Magnets (my version)' }, [1, 2, 3, 4, 5]), 2);
  assert.equal(packDayOfPlan({ title: 'Magnets', placements: [] }, [1, 2, 3, 4, 5]), 0);
});

test('a lesson’s own deck says how it was made: its subject in the footer, the AI draft label, one section', () => {
  const deck = {
    language: 'en' as const, grade: '2', term: 0, week: 0, sourceApproved: false, credits: { reviewer: null, sourcesLine: '' },
    origin: 'lesson' as const, subject: 'English', title: 'Naming words',
    slides: [
      { id: 'nabcd0001', day: 0, kind: 'cover' as const, title: 'Naming words', lines: [], choices: [], revealOf: null, correctChoice: null, image: null, notes: '', sourceId: 'nabcd0001' },
      { id: 'nabcd0002', day: 0, kind: 'concept' as const, title: 'A noun names a thing', lines: ['dog', 'school'], choices: [], revealOf: null, correctChoice: null, image: null, notes: '', sourceId: 'nabcd0002' },
    ],
  };
  const layouts = layoutDeck(layoutInputFromDeck(deck));
  assert.equal(layouts[0]!.footer.text, 'Grade 2 English');
  const badge = layouts[0]!.items.find((i): i is TextItem => i.type === 'text' && i.name === 'draft label');
  assert.equal(badge?.paragraphs[0]!.runs[0]!.text, 'DRAFT — made with AI from the lesson plan');
  assert.deepEqual([...new Set(layouts.map((l) => l.section))], ['Naming words']);
  // A pack copy is laid out exactly as before.
  const pack = layoutDeck(layoutInputFromDeck({ ...deck, origin: 'pack', subject: 'Science' }));
  assert.equal(pack[0]!.footer.text, 'Grade 2 Science · Term 0 · Week 0');
  assert.equal(pack[0]!.items.find((i): i is TextItem => i.type === 'text' && i.name === 'draft label')?.paragraphs[0]!.runs[0]!.text, 'DRAFT — not yet reviewed by a teacher');
});
