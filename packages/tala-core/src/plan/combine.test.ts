import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_TEMPLATES, type Block, type RichText, type SectionContent } from '../contracts/content';
import { ClassRecord, Plan, PlanSection } from '../contracts/records';
import type { GradeLevel } from '../contracts/common';
import {
  blankGradeLesson,
  buildCombinedPlan,
  checkSessionFlow,
  combineLessons,
  gradeLessonFromPlan,
  sessionMinutes,
  sharedLead,
  type GradeLesson,
} from './combine';
import { COMBINE_WORDS } from './combine-words';
import { hasSectionContent, validatePlanForLock } from './index';
import { richTextPlainText } from './text';

/* ---------- fixtures: single-grade lessons shaped like the ones a teaching pack gives a teacher ---------- */

const p = (text: string): Block => ({ t: 'p', spans: [{ text }] });
const labelled = (label: string, text: string): Block => ({ t: 'p', spans: [{ text: `${label}: `, b: true }, { text }] });

let counter = 0;
const newId = () => `id${String(++counter).padStart(5, '0')}`;

const PHASES = {
  en: ['Activating prior knowledge', 'Establishing lesson purpose', 'Developing and deepening understanding', 'Making generalizations', 'Evaluating learning'],
  fil: ['Pagkuha ng Dating Kaalaman', 'Paglalahad ng Layunin', 'Paglinang at Pagpapalalim', 'Paglalahat', 'Pagtataya'],
};

function packLikePlan(args: { grade: GradeLevel; groupId: string; topic: string; lang: 'en' | 'fil'; minutes?: number; aiDraft?: boolean }) {
  const T = args.lang === 'en' ? 'Teacher' : 'Guro';
  const L = args.lang === 'en' ? 'Learners' : 'Mga mag-aaral';
  const id = newId();
  const plan = Plan.parse({
    id,
    title: `Day 2: ${args.topic}`,
    templateId: 'tpl.dlp.v1',
    language: args.lang,
    subjectName: 'Science',
    learningAreaId: 'science',
    grades: [args.grade],
    gradeGroupIds: [args.groupId],
    competencies: { [args.groupId]: [`science-bow-2026.science.g${args.grade}.t2.6`] },
    curriculumVersion: 'science-bow-2026',
    durationMinutes: args.minutes ?? 45,
    placements: [{ classId: 'class001', assignmentId: 'assign01', dates: ['2026-11-24'] }],
    aiDraft: args.aiDraft ?? true,
    aiAssisted: true,
    lineage: { artifactId: `pack.sci26-g${args.grade}-t2-w10`, versionId: 'abcdef0123456789', title: args.topic, authorDisplayName: 'Hiraia teaching pack' },
  });
  const minutes = [5, 3, 22, 7, 8];
  const content: Record<string, SectionContent> = {
    objectives: { type: 'list', items: [`Learners will be able to describe ${args.topic.toLowerCase()} (Grade ${args.grade}).`] },
    content: { type: 'text', blocks: [p(`${args.topic} — Grade ${args.grade} Science, Term 2, Week 10, Day 2.`), p(`Big idea: ${args.topic} can be observed.`)] },
    materials: { type: 'list', items: [`ruler (G${args.grade})`, 'notebook', `Week deck "${args.topic}" (Slides 12–20)`] },
    procedure: {
      type: 'procedure',
      steps: PHASES[args.lang].map((title, i) => ({
        id: newId(),
        title,
        minutes: minutes[i]!,
        body: [labelled(T, `G${args.grade} teacher line for step ${i + 1}.`), labelled(L, `G${args.grade} learners line for step ${i + 1}.`), p(`Slides ${12 + i}`)],
      })),
    },
    assessment: { type: 'text', blocks: [labelled('Exit ticket', `What did you notice about ${args.topic.toLowerCase()}?`), labelled('Answer', `G${args.grade} answer key.`)] },
    differentiation: {
      type: 'text',
      blocks: [labelled('Support', `G${args.grade} support.`), labelled('Extension', `G${args.grade} extension task.`), labelled('Longer period', `G${args.grade} longer.`)],
    },
  };
  const template = BUILTIN_TEMPLATES.find((t) => t.id === 'tpl.dlp.v1')!;
  const sections = template.sections.map((s) =>
    PlanSection.parse({ id: newId(), planId: id, key: s.key, content: content[s.key] ?? { type: 'text', blocks: [] }, origin: content[s.key] ? 'copied' : 'manual' })
  );
  return { plan, sections };
}

const cls = (grades: GradeLevel[]) =>
  ClassRecord.parse({ id: 'class001', schoolYearId: 'year0001', name: 'Multigrade A', gradeGroups: grades.map((grade, i) => ({ id: `group00${i + 1}`, grade })) });

function lessonsFor(grades: GradeLevel[], lang: 'en' | 'fil' = 'en', minutes = 45): GradeLesson[] {
  const topics = ['Movement of objects', 'States of matter', 'Heat energy', 'Living things'];
  return grades.map((grade, i) => {
    const src = packLikePlan({ grade, groupId: `group00${i + 1}`, topic: topics[i]!, lang, minutes });
    return gradeLessonFromPlan({ plan: src.plan, sections: src.sections, groupId: `group00${i + 1}`, grade });
  });
}

const flowOf = (sections: Array<{ key: string; content: SectionContent }>) => {
  const c = sections.find((s) => s.key === 'multigrade')!.content;
  if (c.type !== 'multigrade') throw new Error('no flow');
  return c;
};
const cellText = (activity: RichText) => richTextPlainText(activity);

/* ---------- reading a lesson ---------- */

test('a pack-shaped plan is read into phases, with the teacher’s and the learners’ lines kept apart', () => {
  const [l] = lessonsFor(['4']);
  assert.deepEqual(l!.steps.map((s) => s.role), ['open', 'open', 'develop', 'close', 'assess']);
  assert.equal(cellText(l!.steps[2]!.teacher), 'G4 teacher line for step 3.');
  assert.equal(cellText(l!.steps[2]!.learners), 'G4 learners line for step 3.');
  assert.equal(cellText(l!.steps[2]!.other), 'Slides 14');
  assert.deepEqual(l!.competencyIds, ['science-bow-2026.science.g4.t2.6']);
  assert.equal(l!.materials.length, 3);
  const [f] = lessonsFor(['4'], 'fil');
  assert.deepEqual(f!.steps.map((s) => s.role), ['open', 'open', 'develop', 'close', 'assess']);
  assert.equal(cellText(f!.steps[0]!.learners), 'G4 learners line for step 1.');
});

test('a hand-written lesson with reworded steps is read by position; a one-step lesson is all teaching', () => {
  const src = packLikePlan({ grade: '5', groupId: 'group001', topic: 'Fractions', lang: 'en' });
  const procedure = src.sections.find((s) => s.key === 'procedure')!;
  if (procedure.content.type !== 'procedure') throw new Error('fixture');
  procedure.content.steps = procedure.content.steps.slice(0, 3).map((s, i) => ({ ...s, title: ['Warm-up', 'Lesson proper', 'Seatwork'][i]!, body: [p(`Plain text ${i}`)] }));
  const l = gradeLessonFromPlan({ ...src, groupId: 'group001', grade: '5' });
  assert.deepEqual(l.steps.map((s) => s.role), ['open', 'develop', 'close']);
  assert.equal(cellText(l.steps[1]!.other), 'Plain text 1');
  procedure.content.steps = procedure.content.steps.slice(0, 1);
  assert.deepEqual(gradeLessonFromPlan({ ...src, groupId: 'group001', grade: '5' }).steps.map((s) => s.role), ['develop']);
});

/* ---------- the session ---------- */

test('minutes always fill the period exactly, for two to four grades and short or long periods', () => {
  for (const total of [5, 10, 20, 30, 40, 45, 50, 55, 60, 90])
    for (const groups of [2, 3, 4]) {
      const t = sessionMinutes(total, groups);
      assert.equal(t.opening + t.closing + t.turns.reduce((a, b) => a + b, 0), total, `${total}/${groups}`);
      assert.ok(t.turns.every((m) => m >= 1));
      assert.ok(Math.max(...t.turns) - Math.min(...t.turns) <= 1, 'turns are even');
    }
  assert.deepEqual(sessionMinutes(45, 2), { opening: 5, closing: 5, turns: [18, 17] });
  assert.deepEqual(sessionMinutes(45, 3), { opening: 5, closing: 5, turns: [12, 12, 11] });
});

test('two grades: one session with a shared start and finish and one teacher turn each (not two plans end to end)', () => {
  const lessons = lessonsFor(['4', '5']);
  const s = combineLessons({ lessons, minutes: 45, language: 'en', newId });
  const flow = flowOf(s.sections);
  assert.deepEqual(flow.blocks.map((b) => [b.label, b.minutes, b.teacherWith]), [
    ['Start together', 5, 'all'],
    ['Grade 4 with the teacher', 18, 'group001'],
    ['Grade 5 with the teacher', 17, 'group002'],
    ['Finish together', 5, 'all'],
  ]);
  assert.deepEqual(checkSessionFlow(flow, ['group001', 'group002'], 45), []);
  // Every block has something for every grade, and the teacher is with exactly one grade in a turn.
  for (const b of flow.blocks) {
    assert.deepEqual(Object.keys(b.groups), ['group001', 'group002']);
    for (const g of Object.values(b.groups)) assert.ok(cellText(g.activity).trim(), `${b.label} has an empty box`);
    if (b.teacherWith !== 'all') assert.equal(Object.values(b.groups).filter((g) => g.mode === 'direct').length, 1);
  }
  const [open, turn4, turn5, close] = flow.blocks;
  // Opening: each grade's own starter, from its own lesson.
  assert.match(cellText(open!.groups.group001!.activity), /G4 teacher line for step 1[\s\S]*G4 learners line for step 2/);
  assert.equal(open!.groups.group002!.mode, 'shared');
  // Grade 4's turn: its teaching step; Grade 5 gets ready alone with its own goal and materials.
  assert.match(cellText(turn4!.groups.group001!.activity), /Teacher: G4 teacher line for step 3\.\nLearners: G4 learners line for step 3\./);
  assert.equal(turn4!.groups.group002!.mode, 'independent');
  assert.match(cellText(turn4!.groups.group002!.activity), /Work on your own first[\s\S]*Today’s goal: Learners will be able to describe states of matter[\s\S]*Materials: ruler \(G5\)/);
  // Grade 5's turn: Grade 4 carries on alone, then its exit ticket (question only: the answer stays with the teacher).
  assert.equal(turn5!.groups.group002!.mode, 'direct');
  const after = cellText(turn5!.groups.group001!.activity);
  assert.match(after, /Carry on by yourselves:\nG4 learners line for step 3\.\nExit ticket: G4 learners line for step 5\.\nIf you finish early: G4 extension task\./);
  assert.ok(!after.includes('answer key'));
  // Closing: Grade 5 had no time after its turn, so its exit ticket is here; Grade 4's is not repeated.
  assert.match(cellText(close!.groups.group002!.activity), /G5 teacher line for step 4[\s\S]*Exit ticket: G5 learners line for step 5\./);
  assert.ok(!cellText(close!.groups.group001!.activity).includes('Exit ticket'));
  assert.equal(s.minutesWithTeacher, 17);
  assert.deepEqual(s.warnings, []);
  assert.ok(flow.note!.includes('One plan for Grade 4 and Grade 5'));
  assert.ok(flow.note!.includes('Combined from: Grade 4: Day 2: Movement of objects; Grade 5: Day 2: States of matter'));
});

test('three grades: three turns, the waiting grades work alone then in pairs, and the plan says the turns are short', () => {
  const lessons = lessonsFor(['3', '4', '5']);
  const s = combineLessons({ lessons, minutes: 45, language: 'en', newId });
  const flow = flowOf(s.sections);
  assert.deepEqual(flow.blocks.map((b) => b.minutes), [5, 12, 12, 11, 5]);
  assert.deepEqual(flow.blocks.map((b) => b.teacherWith), ['all', 'group001', 'group002', 'group003', 'all']);
  assert.deepEqual(checkSessionFlow(flow, ['group001', 'group002', 'group003'], 45), []);
  const modes = flow.blocks.map((b) => ['group001', 'group002', 'group003'].map((g) => b.groups[g]!.mode));
  assert.deepEqual(modes, [
    ['shared', 'shared', 'shared'],
    ['direct', 'independent', 'independent'],
    ['independent', 'direct', 'peer'],
    ['independent', 'independent', 'direct'],
    ['shared', 'shared', 'shared'],
  ]);
  // Grade 5 waits twice: first alone, then with a partner.
  assert.match(cellText(flow.blocks[2]!.groups.group003!.activity), /Work with a partner/);
  // Grade 3 has two blocks after its turn: carry on, then the exit ticket.
  assert.match(cellText(flow.blocks[2]!.groups.group001!.activity), /Carry on by yourselves/);
  assert.match(cellText(flow.blocks[3]!.groups.group001!.activity), /Exit ticket/);
  assert.deepEqual(s.warnings.map((w) => w.code), ['many_groups']);
  assert.ok(flow.note!.includes('With three or more grades'));
  assert.ok(flow.note!.length <= 600);
  for (const b of flow.blocks) for (const g of Object.values(b.groups)) assert.ok(cellText(g.activity).trim());
});

test('four grades in a 40-minute period still add up, and the short turns are flagged', () => {
  const lessons = lessonsFor(['2', '3', '4', '5'], 'en', 40);
  const s = combineLessons({ lessons, minutes: 40, language: 'en', newId });
  const flow = flowOf(s.sections);
  assert.equal(flow.blocks.reduce((n, b) => n + b.minutes, 0), 40);
  assert.deepEqual(checkSessionFlow(flow, lessons.map((l) => l.groupId), 40), []);
  assert.ok(s.warnings.some((w) => w.code === 'short_turns'));
  assert.ok(flow.note!.length <= 600);
});

test('the youngest grade goes first unless the teacher chooses the order', () => {
  // Class order is Grade 5 then Grade 2: columns follow the class, turns follow age.
  const five = packLikePlan({ grade: '5', groupId: 'group001', topic: 'Heat', lang: 'en' });
  const two = packLikePlan({ grade: '2', groupId: 'group002', topic: 'Plants', lang: 'en' });
  const lessons = [gradeLessonFromPlan({ ...five, groupId: 'group001', grade: '5' }), gradeLessonFromPlan({ ...two, groupId: 'group002', grade: '2' })];
  assert.deepEqual(flowOf(combineLessons({ lessons, minutes: 50, language: 'en', newId }).sections).blocks.map((b) => b.teacherWith), ['all', 'group002', 'group001', 'all']);
  assert.deepEqual(
    flowOf(combineLessons({ lessons, minutes: 50, language: 'en', newId, turnOrder: ['group001', 'group002'] }).sections).blocks.map((b) => b.teacherWith),
    ['all', 'group001', 'group002', 'all']
  );
});

test('Filipino: block names, instructions and labels are Filipino, and the lesson’s own words are untouched', () => {
  const lessons = lessonsFor(['4', '5'], 'fil');
  const s = combineLessons({ lessons, minutes: 45, language: 'fil', newId });
  const flow = flowOf(s.sections);
  assert.deepEqual(flow.blocks.map((b) => b.label), ['Sabay-sabay na simula', 'Baitang 4 kasama ang guro', 'Baitang 5 kasama ang guro', 'Sabay-sabay na pagtatapos']);
  assert.match(cellText(flow.blocks[1]!.groups.group001!.activity), /^Guro: G4 teacher line for step 3\.\nMga mag-aaral: G4 learners line for step 3\./);
  assert.match(cellText(flow.blocks[1]!.groups.group002!.activity), /Mag-isa munang gumawa/);
  assert.ok(flow.note!.startsWith('Isang plano para sa Baitang 4 at Baitang 5.'));
  const visible = JSON.stringify(s.sections);
  for (const english of ['Start together', 'with the teacher', 'Work on your own', 'Carry on', 'Today’s goal']) assert.ok(!visible.includes(english), english);
  // Both languages define every word.
  assert.deepEqual(Object.keys(COMBINE_WORDS.fil).sort(), Object.keys(COMBINE_WORDS.en).sort());
});

test('a grade with no lesson yet keeps its column, empty, and the teacher is told which boxes to write', () => {
  const [four] = lessonsFor(['4']);
  const s = combineLessons({ lessons: [four!, blankGradeLesson('group002', '5', 45)], minutes: 45, language: 'en', newId });
  const flow = flowOf(s.sections);
  assert.deepEqual(checkSessionFlow(flow, ['group001', 'group002'], 45), []);
  assert.equal(cellText(flow.blocks[2]!.groups.group002!.activity), '', 'the blank grade’s teaching turn is hers to write');
  assert.ok(s.warnings.some((w) => w.code === 'no_lesson' && w.groupId === 'group002'));
  assert.ok(s.warnings.some((w) => w.code === 'empty_box' && w.groupId === 'group002'));
  assert.throws(() => combineLessons({ lessons: [four!], minutes: 45, language: 'en', newId }), /two to four/);
  assert.throws(() => combineLessons({ lessons: [four!, four!], minutes: 45, language: 'en', newId }), /once/);
});

/* ---------- the plan that is saved ---------- */

test('the combined plan is one multi-grade draft that keeps curriculum references, draft labels and per-grade parts', () => {
  const c = cls(['4', '5']);
  const lessons = lessonsFor(['4', '5']);
  const { plan, sections, warnings } = buildCombinedPlan({
    cls: c,
    assignment: { id: 'assign01', subjectName: 'Science', learningAreaId: 'science' },
    lessons,
    date: '2026-11-24',
    minutes: 45,
    language: 'en',
    newId,
  });
  assert.deepEqual(warnings, []);
  assert.equal(plan.templateId, 'tpl.multigrade.v1');
  assert.equal(plan.state, 'draft');
  assert.deepEqual(plan.grades, ['4', '5']);
  assert.deepEqual(plan.gradeGroupIds, ['group001', 'group002']);
  // Curriculum references: the stored competency ids of each grade, and the version they belong to.
  assert.deepEqual(plan.competencies, { group001: ['science-bow-2026.science.g4.t2.6'], group002: ['science-bow-2026.science.g5.t2.6'] });
  assert.equal(plan.curriculumVersion, 'science-bow-2026');
  // Draft labels: made from two AI-drafted lessons, so it is one too; two different packs, so no single lineage.
  assert.equal(plan.aiDraft, true);
  assert.equal(plan.aiAssisted, true);
  assert.equal(plan.lineage, null);
  assert.deepEqual(plan.placements, [{ classId: 'class001', assignmentId: 'assign01', dates: ['2026-11-24'] }]);
  assert.equal(plan.durationMinutes, 45);
  // "Day 2:" is on both lessons, so the title says it once.
  assert.equal(plan.title, 'Day 2 · Grade 4: Movement of objects · Grade 5: States of matter');
  assert.equal(sharedLead(['Day 2: Movement of objects', 'Day 2: States of matter']), 'Day 2');
  assert.equal(sharedLead(['Day 1: Movement', 'Day 2: Matter']), '', 'different days: each keeps its own');
  assert.equal(sharedLead(['Movement of objects', 'States of matter']), '');
  assert.equal(sharedLead(['Day 2: Movement']), '', 'one lesson has nothing to share');
  assert.equal(sharedLead(['Day 2: ', 'Day 2: Matter']), '', 'a title that is only the label keeps it');

  const template = BUILTIN_TEMPLATES.find((t) => t.id === 'tpl.multigrade.v1')!;
  assert.deepEqual(sections.map((s) => s.key), template.sections.map((s) => s.key));
  for (const spec of template.sections) assert.equal(sections.find((s) => s.key === spec.key)!.content.type, spec.contentType);
  const get = (key: string) => sections.find((s) => s.key === key)!.content;
  const objectives = get('objectives');
  if (objectives.type !== 'pergroup') throw new Error('objectives');
  assert.match(richTextPlainText(objectives.groups.group001!), /describe movement of objects \(Grade 4\)[\s\S]*Grade 4 Science, Term 2, Week 10, Day 2/);
  const assessment = get('assessment');
  if (assessment.type !== 'pergroup') throw new Error('assessment');
  // The answer key and the support notes stay with the teacher, per grade.
  assert.match(richTextPlainText(assessment.groups.group002!), /Exit ticket: What did you notice about states of matter\?\nAnswer: G5 answer key\.\nSupport and extension\nSupport: G5 support\./);
  const materials = get('materials');
  if (materials.type !== 'pergroup') throw new Error('materials');
  assert.equal(richTextPlainText(materials.groups.group001!), '• ruler (G4)\n• notebook\n• Week deck "Movement of objects" (Slides 12–20)');
  // After-class sections are there, empty, for writing by hand or later.
  assert.equal(hasSectionContent(get('results'), plan.gradeGroupIds), false);
  // The pre-class sections are complete enough to lock as they stand.
  assert.deepEqual(validatePlanForLock(plan, sections, template, { curriculum: 'deped' }).errors, []);
  // Everything validates against the record schemas it will be stored and synced as.
  assert.doesNotThrow(() => Plan.parse(plan));
  for (const s of sections) assert.doesNotThrow(() => PlanSection.parse(s));
});

test('three grades from one pack keep that pack as the plan’s source; columns follow the class, not the caller', () => {
  const c = cls(['3', '4', '5']);
  const lessons = lessonsFor(['3', '4', '5']).map((l) => ({ ...l, source: { ...l.source, lineage: { artifactId: 'pack.shared', versionId: 'v1', title: 'Shared theme', authorDisplayName: 'Hiraia teaching pack' } } }));
  const { plan, sections } = buildCombinedPlan({ cls: c, assignment: null, lessons: [lessons[2]!, lessons[0]!, lessons[1]!], date: null, minutes: 60, language: 'fil', newId });
  assert.deepEqual(plan.gradeGroupIds, ['group001', 'group002', 'group003']);
  assert.equal(plan.lineage?.artifactId, 'pack.shared');
  assert.deepEqual(plan.placements, [{ classId: 'class001', assignmentId: null, dates: [] }]);
  const flow = sections.find((s) => s.key === 'multigrade')!.content;
  assert.deepEqual(checkSessionFlow(flow, plan.gradeGroupIds, 60), []);
});

test('a teacher’s edits to the session are checked by the same rules', () => {
  const lessons = lessonsFor(['4', '5']);
  const flow = flowOf(combineLessons({ lessons, minutes: 45, language: 'en', newId }).sections);
  const edited = structuredClone(flow);
  edited.blocks[1]!.minutes = 25;
  assert.deepEqual(checkSessionFlow(edited, ['group001', 'group002'], 45), ['minutes_do_not_add_up']);
  const both = structuredClone(flow);
  both.blocks[1]!.groups.group002!.mode = 'direct';
  assert.ok(checkSessionFlow(both, ['group001', 'group002'], 45).some((p) => p.startsWith('teacher_with_two_groups')));
  both.blocks[1]!.pairedGroupIds = ['group001', 'group002'];
  assert.deepEqual(checkSessionFlow(both, ['group001', 'group002'], 45), []);
});
