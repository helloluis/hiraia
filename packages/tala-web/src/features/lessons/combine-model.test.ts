/** One plan for a multi-grade class: choosing the lessons, combining them, and keeping the result (real sync, real server). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestServer } from '@hiraia/tala-server/testing';
import { createMemoryStore, createSyncEngine } from '@hiraia/tala-core/sync';
import { MULTIGRADE_TEMPLATE_ID, checkSessionFlow } from '@hiraia/tala-core/plan';
import { renderPlanDocxParts } from '@hiraia/tala-core/docx';
import { renderPlanHtml } from '@hiraia/tala-core/print';
import { BUILTIN_TEMPLATES, type ClassRecord, type Plan, type PlanSection, type SyncEngine, type TeachingAssignment } from '@hiraia/tala-core/contracts';
import { fixtureCompetency, packLikePlan } from '../../../../tala-core/src/plan/combine-fixtures';
import { en } from '@/i18n/en';
import { fil } from '@/i18n/fil';
import { combineSavedLessons, groupsFor, isMultigradeClass, lessonChoices, multigradeAssignments, periodMinutes, subjectFor, suggestedPick, timeSplit } from './combine-model';

let n = 0;
const newId = () => `mg${String(++n).padStart(6, '0')}`;
const DATE = '2026-11-24'; // a Tuesday

const cls = (grades: string[]): ClassRecord => ({
  id: 'class001',
  schoolYearId: 'year0001',
  name: 'Multigrade A',
  curriculum: 'deped',
  gradeGroups: grades.map((grade, i) => ({ id: `group00${i + 1}`, grade: grade as ClassRecord['gradeGroups'][number]['grade'], learnerCount: 8 })),
  languages: ['en'],
  profile: { materials: [], textbooks: [], electricity: null, projector: null, printing: null, outdoorSpace: null, notes: '' },
  isSample: false,
  archived: false,
});
const science = (groupIds: string[]): TeachingAssignment => ({
  id: 'assign01',
  classId: 'class001',
  learningAreaId: 'science',
  subjectName: 'Science',
  gradeGroupIds: groupIds,
  language: 'en',
  slots: [
    { id: 'slot0001', weekday: 1, startTime: '08:00', minutes: 45, rotation: null },
    { id: 'slot0002', weekday: 2, startTime: '08:00', minutes: 60, rotation: null },
  ],
});
/** A day of a teaching pack as the teacher holds it after "Add to my class": one single-grade lesson. */
const lesson = (grade: string, group: number, topic: string) => packLikePlan({ grade: grade as never, groupId: `group00${group}`, topic, lang: 'en', newId });
const flowOf = (sections: PlanSection[]) => sections.find((s) => s.content.type === 'multigrade')!;

test('which saved lessons are offered for a grade, and which one is pre-selected', () => {
  const room = cls(['3', '4', '5']);
  const g3 = lesson('3', 1, 'Movement of objects');
  const g4 = lesson('4', 2, 'States of matter');
  const g5 = lesson('5', 3, 'Heat energy');
  const g4Elsewhere: Plan = { ...lesson('4', 2, 'Living things').plan, gradeGroupIds: ['othergrp'], placements: [{ classId: 'class999', assignmentId: null, dates: ['2026-11-10'] }] };
  const archived: Plan = { ...lesson('4', 2, 'Old lesson').plan, state: 'archived' };
  const combined: Plan = { ...g4.plan, id: 'combined1', templateId: MULTIGRADE_TEMPLATE_ID, gradeGroupIds: ['group001', 'group002', 'group003'], grades: ['3', '4', '5'] };
  const math: Plan = { ...lesson('4', 2, 'Fractions').plan, subjectName: 'Mathematics' };
  const plans = [g3.plan, g5.plan, g4Elsewhere, archived, combined, math, g4.plan];

  const offered = lessonChoices({ plans, cls: room, groupId: 'group002', date: DATE, subjectName: 'Science' });
  assert.deepEqual(offered.map((c) => [c.plan.id, c.onDate, c.ownGroup]), [[g4.plan.id, true, true], [g4Elsewhere.id, false, false]]);
  assert.equal(suggestedPick(offered), g4.plan.id);
  // Without a subject every subject's lessons of that grade are offered; a combined plan and an archived one never are.
  assert.deepEqual(lessonChoices({ plans, cls: room, groupId: 'group002', date: DATE }).map((c) => c.plan.id).sort(), [g4.plan.id, g4Elsewhere.id, math.id].sort());
  // On another day nothing is pre-selected: she chooses.
  assert.equal(suggestedPick(lessonChoices({ plans, cls: room, groupId: 'group002', date: '2026-11-25', subjectName: 'Science' })), null);
  // Two lessons of the grade on the same day: she chooses.
  assert.equal(suggestedPick(lessonChoices({ plans: [g4.plan, { ...g4.plan, id: 'another1' }], cls: room, groupId: 'group002', date: DATE })), null);
  assert.deepEqual(lessonChoices({ plans, cls: room, groupId: 'nogroup', date: DATE }), []);

  assert.equal(isMultigradeClass(room), true);
  assert.equal(isMultigradeClass(cls(['4'])), false);
  assert.deepEqual(groupsFor(room, science(['group001', 'group003'])).map((g) => g.id), ['group001', 'group003']);
  assert.deepEqual(groupsFor(room, null).map((g) => g.grade), ['3', '4', '5']);
  assert.deepEqual(multigradeAssignments(room, [science(['group001', 'group002']), { ...science(['group002']), id: 'assign02' }]).map((a) => a.id), ['assign01']);
  // The period is the subject's slot on that weekday.
  assert.deepEqual([periodMinutes(science(['group001']), DATE), periodMinutes(science(['group001']), '2026-11-23'), periodMinutes(science(['group001']), null), periodMinutes(null, DATE)], [60, 45, 45, 50]);
  assert.deepEqual(timeSplit(45, 2), { opening: 5, closing: 5, turns: [18, 17] });
  // A class with one multi-grade subject starts on it, but "all grades, no subject" can be chosen and stays chosen.
  const one = [{ id: 'assign01' }];
  assert.equal(subjectFor({ assignments: one, current: '', touched: false }), 'assign01');
  assert.equal(subjectFor({ assignments: one, current: '', touched: true }), '');
  assert.equal(subjectFor({ assignments: one, current: 'assign01', touched: true }), 'assign01');
  assert.equal(subjectFor({ assignments: [...one, { id: 'assign02' }], current: '', touched: false }), '', 'two subjects: she chooses');
  assert.equal(subjectFor({ assignments: one, current: 'another-class', touched: true }), '', 'a subject of another class is dropped');
});

test('two grades: one sound session on the multi-grade template; her own lessons are not changed', () => {
  const room = cls(['4', '5']);
  const g4 = lesson('4', 1, 'States of matter');
  const g5 = lesson('5', 2, 'Heat energy');
  const before = JSON.stringify([g4, g5]);
  const { plan, sections, warnings, minutesWithTeacher } = combineSavedLessons({
    cls: room, assignment: science(['group001', 'group002']), date: DATE, minutes: 45, language: 'en',
    picks: { group001: g4.plan.id, group002: g5.plan.id }, plans: [g4.plan, g5.plan], sections: [...g4.sections, ...g5.sections], newId,
  });
  assert.equal(JSON.stringify([g4, g5]), before);
  assert.equal(plan.templateId, MULTIGRADE_TEMPLATE_ID);
  assert.deepEqual([plan.state, plan.grades, plan.gradeGroupIds, plan.durationMinutes, plan.subjectName], ['draft', ['4', '5'], ['group001', 'group002'], 45, 'Science']);
  assert.deepEqual(plan.placements, [{ classId: 'class001', assignmentId: 'assign01', dates: [DATE] }]);
  // Curriculum references and the honest label come along.
  assert.deepEqual(plan.competencies, { group001: g4.plan.competencies.group001, group002: g5.plan.competencies.group002 });
  assert.equal(plan.curriculumVersion, 'science-bow-2026');
  assert.equal(plan.aiDraft, true);
  const flow = flowOf(sections).content;
  assert.deepEqual(checkSessionFlow(flow, plan.gradeGroupIds, 45), []);
  assert.equal(flow.type === 'multigrade' && flow.blocks.length, 4, 'start, one turn each, finish');
  assert.ok(minutesWithTeacher >= 15 && warnings.every((w) => w.code !== 'no_lesson'));
  assert.ok(JSON.stringify(flow).includes('G4 teacher line for step 3.') && JSON.stringify(flow).includes('G5 teacher line for step 3.'), 'both grades’ own words are in the one session');
  assert.throws(() => combineSavedLessons({ cls: cls(['4']), assignment: null, date: DATE, minutes: 45, language: 'en', picks: {}, plans: [], sections: [], newId }), /two grade groups/);
});

test('three grades with one left for her to write: its column is kept, empty, and she is told', () => {
  const room = cls(['3', '4', '5']);
  const g3 = lesson('3', 1, 'Movement of objects');
  const g4 = lesson('4', 2, 'States of matter');
  const { plan, sections, warnings } = combineSavedLessons({
    cls: room, assignment: null, date: DATE, minutes: 60, language: 'fil',
    picks: { group001: g3.plan.id, group002: g4.plan.id, group003: null }, plans: [g3.plan, g4.plan], sections: [...g3.sections, ...g4.sections], newId,
  });
  assert.deepEqual(plan.gradeGroupIds, ['group001', 'group002', 'group003']);
  assert.ok(warnings.some((w) => w.code === 'no_lesson' && w.groupId === 'group003'));
  const flow = flowOf(sections).content;
  assert.deepEqual(checkSessionFlow(flow, plan.gradeGroupIds, 60), []);
  assert.equal(flow.type === 'multigrade' && flow.blocks.length, 5);
  assert.equal(plan.language, 'fil');
});

test('the combined plan is kept: it reaches another device through the real server, and so does what she changes', async () => {
  const t = createTestServer({ quiet: true });
  try {
    const teacher = await t.registerUser();
    const device = (label: string): SyncEngine =>
      createSyncEngine({ store: createMemoryStore(), transport: t.client(teacher.token).syncTransport, deviceId: label, now: () => new Date(), newId });
    const laptop = device('laptop');
    const phone = device('phone');
    const room = cls(['3', '4', '5']);
    const sources = [lesson('3', 1, 'Movement of objects'), lesson('4', 2, 'States of matter'), lesson('5', 3, 'Heat energy')];
    await laptop.batch([
      { op: 'put', entity: 'class', data: room },
      ...sources.flatMap((s) => [{ op: 'put' as const, entity: 'plan' as const, data: s.plan }, ...s.sections.map((x) => ({ op: 'put' as const, entity: 'plan_section' as const, data: x }))]),
    ]);
    // What the screen does: read the chosen lessons' sections from the device, combine, save in one batch.
    const stored = (await laptop.list('plan_section')).map((r) => r.data);
    const made = combineSavedLessons({
      cls: room, assignment: null, date: DATE, minutes: 60, language: 'en',
      picks: Object.fromEntries(sources.map((s, i) => [`group00${i + 1}`, s.plan.id])), plans: sources.map((s) => s.plan), sections: stored, newId,
    });
    await laptop.batch([{ op: 'put', entity: 'plan', data: made.plan }, ...made.sections.map((s) => ({ op: 'put' as const, entity: 'plan_section' as const, data: s }))]);
    for (let i = 0; i < 6 && (await laptop.status()).pending; i++) await laptop.sync();
    assert.equal((await laptop.status()).pending, 0, 'everything was accepted by the server');

    for (let i = 0; i < 6; i++) await phone.sync();
    const onPhone = (await phone.get('plan', made.plan.id))?.data;
    assert.deepEqual(onPhone, made.plan);
    const phoneSections = (await phone.list('plan_section')).map((r) => r.data).filter((s) => s.planId === made.plan.id);
    const byKey = (list: PlanSection[]) => [...list].sort((a, b) => a.key.localeCompare(b.key));
    assert.deepEqual(byKey(phoneSections), byKey(made.sections));
    // The lessons it was made from are still there, unchanged.
    assert.deepEqual((await phone.get('plan', sources[0]!.plan.id))?.data, sources[0]!.plan);

    // She edits a box and the note on her phone.
    const flow = flowOf(phoneSections);
    assert.equal(flow.content.type, 'multigrade');
    if (flow.content.type !== 'multigrade') return;
    const blocks = flow.content.blocks.map((b, i) =>
      i === 1 ? { ...b, groups: { ...b.groups, group001: { ...b.groups.group001!, activity: [{ t: 'p' as const, spans: [{ text: 'Edited by the teacher on her phone: measure the classroom door.' }] }] } } } : b
    );
    const edited: PlanSection = { ...flow, content: { ...flow.content, note: 'My own note for Tuesday.', blocks }, editedByTeacher: true };
    await phone.put('plan_section', edited);
    for (let i = 0; i < 6 && (await phone.status()).pending; i++) await phone.sync();
    for (let i = 0; i < 6; i++) await laptop.sync();
    const back = (await laptop.get('plan_section', flow.id))?.data;
    assert.deepEqual(back, edited);

    // What she prints and what she downloads as Word are made from what is kept, edits included.
    const laptopSections = (await laptop.list('plan_section')).map((r) => r.data).filter((s) => s.planId === made.plan.id);
    const options = {
      plan: made.plan, sections: laptopSections, template: BUILTIN_TEMPLATES.find((x) => x.id === made.plan.templateId)!, class: room,
      teacherName: 'Teacher (test)', paper: 'long' as const, lang: 'en' as const, competencyLookup: fixtureCompetency, layout: 'table' as const,
    };
    const word = renderPlanDocxParts(options)['word/document.xml']!;
    const page = renderPlanHtml(options);
    for (const words of ['Edited by the teacher on her phone: measure the classroom door.', 'My own note for Tuesday.', 'G4 teacher line for step 3.', 'DepEd Science G5: 2026 Three-Term BOW']) {
      assert.ok(word.includes(words), `Word: ${words}`);
      assert.ok(page.includes(words), `print: ${words}`);
    }
    assert.ok(word.includes('w:orient="landscape"') && word.includes('<w:pgSz w:w="18720" w:h="12240"'), 'three grades on long bond: landscape');
    assert.ok(page.includes('<table class="flow">'), 'the print is the table layout');
  } finally {
    t.close();
  }
});

test('every string of the screen exists in English and Filipino with the same blanks to fill', () => {
  const blanks = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  const keys = Object.keys(en).filter((k) => k.startsWith('mg.'));
  assert.ok(keys.length >= 30, `${keys.length} keys`);
  for (const key of keys) {
    const a = (en as Record<string, string>)[key]!;
    const b = (fil as Record<string, string>)[key]!;
    assert.ok(b && b.trim(), key);
    assert.equal(blanks(b), blanks(a), key);
  }
});
