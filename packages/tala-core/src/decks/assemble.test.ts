import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DeckSlide } from '../contracts/decks';
import type { MultigradeBlock, SectionContent } from '../contracts/content';
import type { Plan } from '../contracts/records';
import { buildCombinedPlan, gradeLessonFromPlan } from '../plan/combine';
import { fixtureClass, fixtureIds, packLikePlan } from '../plan/combine-fixtures';
import { assembleSession, lessonPhases, sessionSourceChoices, sessionSourceFor, type SessionGradeInput, type SessionGradeSlides } from './assemble';
import { layoutDeck, type TextItem } from './layout';

const slide = (id: string, day: number, kind: DeckSlide['kind'], title: string, extra: Partial<DeckSlide> = {}): DeckSlide => ({
  id, day, kind, title, lines: [`${title} line`], choices: [], revealOf: null, correctChoice: null, image: null, notes: `${title} notes`, sourceId: id, ...extra,
});

/** A pack day's slides, as a copy of a pack holds them (with its credits slide). */
function packDay(day: number, who: string): DeckSlide[] {
  return [
    slide(`d${day}s1`, day, 'day', `${who} day`),
    slide(`d${day}s2`, day, 'question', `${who} what do you know`),
    slide(`d${day}s3`, day, 'concept', `${who} key idea`, { image: { slug: 'plant', alt: 'A plant' } }),
    slide(`d${day}s4`, day, 'check', `${who} quick check`, { choices: ['one', 'two', 'three'] }),
    slide(`d${day}s5`, day, 'reveal', `${who} answer`, { revealOf: `d${day}s4`, correctChoice: 1 }),
    slide(`d${day}s6`, day, 'summary', `${who} remember`),
    slide(`d${day}s7`, day, 'check', `${who} exit`, { choices: ['yes', 'no'] }),
    slide('d0s9', 0, 'credits', 'Credits'),
  ];
}
const gradeSlides = (deckId: string, slides: DeckSlide[], extra: Partial<SessionGradeSlides> = {}): SessionGradeSlides => ({
  deckId, origin: 'pack', language: 'en', approved: true, reviewer: 'T. Reviewer', sourcesLine: 'Sources in the teacher guide: R1', edited: false, slides, ...extra,
});

/** A real combined plan (the combine screen's own function) for these grades, and its time blocks. */
function session(grades: Array<'1' | '2' | '3' | '4' | '5'>, minutes = 60) {
  const newId = fixtureIds('s');
  const cls = fixtureClass(grades);
  const lessons = grades.map((grade, i) => {
    const src = packLikePlan({ grade, groupId: `group00${i + 1}`, topic: `Topic ${grade}`, lang: 'en', newId });
    return gradeLessonFromPlan({ plan: src.plan, sections: src.sections, groupId: `group00${i + 1}`, grade });
  });
  const built = buildCombinedPlan({ cls, assignment: { id: 'assign01', subjectName: 'English', learningAreaId: 'english' }, lessons, date: '2026-11-24', minutes, language: 'en', newId });
  const mg = built.sections.find((s) => s.key === 'multigrade')!.content as Extract<SectionContent, { type: 'multigrade' }>;
  return { plan: built.plan, blocks: mg.blocks, note: mg.note ?? '' };
}

const roles = (slides: Array<{ role: string }>) => slides.map((s) => s.role);

test('two grades: the slides follow the session blocks, never one deck after the other', () => {
  const s = session(['4', '5']);
  const grades: SessionGradeInput[] = [
    { groupId: 'group001', grade: '4', lessonTitle: 'Day 2: Topic 4', slides: gradeSlides('deck-g4', packDay(2, 'G4')) },
    { groupId: 'group002', grade: '5', lessonTitle: 'Day 2: Topic 5', slides: gradeSlides('deck-g5', packDay(2, 'G5')) },
  ];
  const a = assembleSession({ title: s.plan.title, language: 'en', subject: 'English', minutes: 60, note: s.note, blocks: s.blocks, grades });
  const slides = a.layout.slides;
  // Blocks of the plan: start together, Grade 4 with the teacher, Grade 5 with the teacher, finish together.
  assert.deepEqual(a.blocks.map((b) => b.label), s.blocks.map((b) => b.label));
  assert.equal(s.blocks[1]!.teacherWith, 'group001');
  assert.deepEqual(roles(slides), [
    'cover',
    'block', 'open', 'open', // start together, each grade's opening question
    'block', 'meanwhile', 'teach', 'teach', 'teach', // Grade 4's turn: Grade 5 meanwhile, then Grade 4's teaching slides
    'block', 'meanwhile', 'teach', 'teach', 'teach', // Grade 5's turn
    'block', 'close', 'close', 'close', 'close', // finish together: each grade's summary and exit check
    'credits', 'credits',
  ]);
  // Grade 4's turn shows Grade 5's task from the plan's own words for that block, then Grade 4's slides.
  const turn4 = a.blocks[1]!;
  const inTurn4 = slides.slice(turn4.first, turn4.first + turn4.count);
  assert.equal(inTurn4[1]!.title, 'Meanwhile, Grade 5');
  assert.equal(inTurn4[1]!.groupId, 'group002');
  assert.ok(inTurn4.slice(2).every((x) => x.groupId === 'group001' && x.from?.deckId === 'deck-g4'));
  assert.deepEqual(inTurn4.slice(2).map((x) => x.from?.slideId), ['d2s3', 'd2s4', 'd2s5']);
  // Every slide but the cover says whose it is, and its notes say which block and how long.
  for (const x of slides.slice(1)) assert.ok(x.tag, `${x.id} has a grade label`);
  for (const x of slides.filter((y) => y.role === 'teach' || y.role === 'meanwhile')) {
    const block = s.blocks.find((b) => b.id === x.blockId)!;
    assert.ok(x.notes.includes(`${block.label} · ${block.minutes} min`), x.notes);
  }
  assert.ok(slides.find((x) => x.role === 'teach' && x.groupId === 'group001')!.notes.includes('You are with Grade 4.'));
  // The grade's own notes are kept under the block line.
  assert.ok(slides.find((x) => x.from?.slideId === 'd2s3' && x.groupId === 'group002')!.notes.endsWith('G5 key idea notes'));
  // Ids stay unique, answer slides still point at their own question, pictures at their own deck.
  assert.equal(new Set(slides.map((x) => x.id)).size, slides.length);
  for (const x of slides.filter((y) => y.kind === 'reveal')) assert.ok(slides.some((y) => y.id === x.revealOf && y.groupId === x.groupId));
  assert.deepEqual(a.media, { 'g0:plant': { deckId: 'deck-g4', slug: 'plant' }, 'g1:plant': { deckId: 'deck-g5', slug: 'plant' } });
  assert.deepEqual(a.missing, []);
  // The cover carries the session's note for the teacher; the decks' day openers and credits are not repeated.
  assert.equal(slides[0]!.notes, s.note);
  assert.ok(!slides.some((x) => x.from?.slideId === 'd2s1'));
});

test('three grades, one without slides and one without a lesson: plain stand-in slides, and they are listed', () => {
  const s = session(['1', '2', '3']);
  const grades: SessionGradeInput[] = [
    { groupId: 'group001', grade: '1', lessonTitle: 'Reading: Sounds', slides: gradeSlides('deck-r1', packDay(1, 'R1').map((x) => ({ ...x, day: 0 })), { origin: 'lesson', approved: false, reviewer: null, sourcesLine: '' }) },
    { groupId: 'group002', grade: '2', lessonTitle: 'English: Nouns', slides: null },
    { groupId: 'group003', grade: '3', lessonTitle: null, slides: null },
  ];
  const a = assembleSession({ title: s.plan.title, language: 'en', subject: '', minutes: 60, note: s.note, blocks: s.blocks, grades });
  const slides = a.layout.slides;
  assert.deepEqual(a.missing, ['group002', 'group003']);
  const g2 = slides.find((x) => x.role === 'missing' && x.groupId === 'group002')!;
  assert.equal(g2.title, "No slides yet for Grade 2's lesson");
  // In its own turn, with the plan's words for what the teacher does with Grade 2 then.
  const turn = s.blocks.find((b) => b.teacherWith === 'group002')!;
  assert.equal(g2.blockId, turn.id);
  assert.ok(g2.lines.length > 0 && g2.lines.join(' ').includes('G2 teacher line'), g2.lines.join(' | '));
  const g3 = slides.find((x) => x.role === 'missing' && x.groupId === 'group003')!;
  assert.equal(g3.title, 'No lesson chosen for Grade 3');
  // Grade 1's slides made with AI: its credits say so; there is no credits slide for the two without slides.
  const credits = slides.filter((x) => x.role === 'credits');
  assert.equal(credits.length, 1);
  assert.deepEqual(credits[0]!.credits, { approved: false, reviewer: null, sourcesLine: '', personalCopy: false, ai: true, art: true });
  // Three turns, each with a "Meanwhile" slide for both other grades.
  for (const b of s.blocks.filter((x) => x.teacherWith !== 'all')) {
    const info = a.blocks.find((x) => x.id === b.id)!;
    const meanwhile = slides.slice(info.first, info.first + info.count).filter((x) => x.role === 'meanwhile');
    assert.equal(meanwhile.length, 2, b.label);
  }
  assert.equal(a.layout.footer, 'Grades 1, 2 and 3 · Multi-grade session');
  assert.equal(a.layout.approved, false);
  // 27 Nov (the Filipino owner's audience check): the instruction to the teacher is in the notes, never projected.
  for (const x of slides.filter((y) => y.role === 'missing' || y.role === 'meanwhile')) {
    assert.ok(!x.lines.some((l) => l.includes('Teach this part from the lesson plan')), `${x.role}: ${x.lines.join(' | ')}`);
  }
  assert.ok(g2.notes.includes('Teach this part from the lesson plan'), g2.notes);
});

test('the slides follow the plan as it is now: a reordered turn and a rewritten task show at once', () => {
  const s = session(['4', '5']);
  const blocks = structuredClone(s.blocks) as MultigradeBlock[];
  // She moves Grade 5's turn first and rewrites what Grade 4 does meanwhile.
  [blocks[1], blocks[2]] = [blocks[2]!, blocks[1]!];
  blocks[1]!.groups.group001 = { mode: 'peer', activity: [{ t: 'p', spans: [{ text: 'Read page 12 with your buddy.' }] }] };
  const grades: SessionGradeInput[] = [
    { groupId: 'group001', grade: '4', lessonTitle: 'G4', slides: gradeSlides('deck-g4', packDay(2, 'G4')) },
    { groupId: 'group002', grade: '5', lessonTitle: 'G5', slides: gradeSlides('deck-g5', packDay(3, 'G5')) },
  ];
  const a = assembleSession({ title: 'Session', language: 'en', subject: 'English', minutes: 60, note: '', blocks, grades });
  const firstTeach = a.layout.slides.find((x) => x.role === 'teach')!;
  assert.equal(firstTeach.groupId, 'group002');
  const meanwhile = a.layout.slides.find((x) => x.role === 'meanwhile' && x.groupId === 'group001')!;
  assert.deepEqual(meanwhile.lines, ['Read page 12 with your buddy.']);
  assert.ok(meanwhile.notes.includes('Grade 4: with a partner.'));
  const divider = a.layout.slides.find((x) => x.role === 'block' && x.blockId === blocks[1]!.id)!;
  assert.equal(divider.lines[0], 'Meanwhile: Grade 4: with a partner');
});

test('the assembled session lays out through the one layout engine: grade chips, footer, each deck its own credits', () => {
  const s = session(['4', '5']);
  const grades: SessionGradeInput[] = [
    { groupId: 'group001', grade: '4', lessonTitle: 'G4', slides: gradeSlides('deck-g4', packDay(2, 'G4'), { edited: true }) },
    { groupId: 'group002', grade: '5', lessonTitle: 'G5', slides: gradeSlides('deck-g5', packDay(2, 'G5').filter((x) => x.kind !== 'credits').map((x) => ({ ...x, image: null })), { origin: 'lesson', approved: false, reviewer: null }) },
  ];
  const a = assembleSession({ title: 'Session', language: 'en', subject: 'English', minutes: 60, note: '', blocks: s.blocks, grades });
  const layouts = layoutDeck(a.layout);
  assert.equal(layouts.length, a.layout.slides.length);
  const words = (i: number) => layouts[i]!.items.filter((x): x is TextItem => x.type === 'text').map((x) => x.paragraphs.map((p) => p.runs.map((r) => r.text).join('')).join(' '));
  for (const [i, l] of layouts.entries()) {
    assert.equal(l.footer.text, 'Grades 4 and 5 · English');
    if (i === 0) continue;
    const chip = l.items.find((x): x is TextItem => x.type === 'text' && x.name === 'grade label');
    assert.ok(chip, `slide ${i + 1} has its grade chip`);
  }
  const turn = layouts.findIndex((l, i) => a.layout.slides[i]!.role === 'block' && a.layout.slides[i]!.blockId === s.blocks[1]!.id);
  assert.ok(words(turn).includes(`${s.blocks[1]!.minutes} MIN`), words(turn).join(' | '));
  const c4 = layouts.findIndex((_l, i) => a.layout.slides[i]!.role === 'credits' && a.layout.slides[i]!.groupId === 'group001');
  const c5 = layouts.findIndex((_l, i) => a.layout.slides[i]!.role === 'credits' && a.layout.slides[i]!.groupId === 'group002');
  assert.ok(words(c4).some((x) => x.includes('Reviewed by T. Reviewer') && x.includes('edited by its teacher')), words(c4).join(' | '));
  assert.ok(words(c5).some((x) => x.includes("Made with AI from the teacher's lesson plan")), words(c5).join(' | '));
  assert.ok(!words(c5).some((x) => x.includes('Drawings ©')), 'no art credit for slides without drawings');
  // A slide's picture comes from its own grade deck, by its session key.
  assert.ok(layouts.some((l) => l.picture === 'g0:plant'));
});

test('Filipino sessions use the combined plan’s own grade words', () => {
  const s = session(['4', '5']);
  const grades: SessionGradeInput[] = [
    { groupId: 'group001', grade: '4', lessonTitle: 'G4', slides: null },
    { groupId: 'group002', grade: '5', lessonTitle: null, slides: null },
  ];
  const a = assembleSession({ title: 'Sesyon', language: 'fil', subject: 'Science', minutes: 60, note: '', blocks: s.blocks, grades });
  assert.ok(a.layout.slides.some((x) => x.title === 'Samantala, Baitang 5'));
  assert.ok(a.layout.slides.some((x) => x.title === 'Wala pang slides ang aralin ng Baitang 4'));
  assert.equal(a.layout.footer, 'Baitang 4 at 5 · Science');
});

test('a lesson is cut into opening questions, teaching, and its summary and exit check', () => {
  const p = lessonPhases(packDay(2, 'G'));
  assert.deepEqual(p.open.map((s) => s.id), ['d2s2']);
  assert.deepEqual(p.teach.map((s) => s.id), ['d2s3', 'd2s4', 'd2s5']);
  assert.deepEqual(p.close.map((s) => s.id), ['d2s6', 'd2s7']);
  // A lesson that ends with a check and its answer slide (as AI decks do): that pair and the summary before it close.
  const ai = [
    slide('na0000001', 0, 'question', 'Q'),
    slide('na0000002', 0, 'concept', 'C'),
    slide('na0000003', 0, 'summary', 'S'),
    slide('na0000004', 0, 'check', 'K', { choices: ['a', 'b'] }),
    slide('na0000005', 0, 'reveal', 'R', { revealOf: 'na0000004', correctChoice: 0 }),
  ];
  assert.deepEqual(lessonPhases(ai).close.map((s) => s.id), ['na0000003', 'na0000004', 'na0000005']);
  assert.deepEqual(lessonPhases(ai).teach.map((s) => s.id), ['na0000002']);
  // A check in the middle stays in the teaching.
  const mid = [slide('nb0000001', 0, 'concept', 'C'), slide('nb0000002', 0, 'check', 'K', { choices: ['a', 'b'] }), slide('nb0000003', 0, 'reveal', 'R', { revealOf: 'nb0000002' }), slide('nb0000004', 0, 'summary', 'S')];
  assert.deepEqual(lessonPhases(mid).close.map((s) => s.id), ['nb0000004']);
  // Only questions: all of it is taught.
  const q = [slide('n0001aaaa', 0, 'question', 'Q1'), slide('n0002aaaa', 0, 'question', 'Q2')];
  assert.deepEqual(lessonPhases(q).teach.length, 2);
});

test('each grade’s own lesson is found the way the combine screen picks it, or left for the teacher', () => {
  const newId = fixtureIds('f');
  const cls = fixtureClass(['4', '5']);
  const g4 = packLikePlan({ grade: '4', groupId: 'group001', topic: 'A', lang: 'en', newId }).plan;
  const g5 = packLikePlan({ grade: '5', groupId: 'group002', topic: 'B', lang: 'en', newId }).plan;
  const g5other: Plan = { ...g5, id: 'other005', placements: [{ classId: cls.id, assignmentId: null, dates: ['2026-11-25'] }], competencies: { group002: ['x'] } };
  const built = buildCombinedPlan({
    cls, assignment: null, date: '2026-11-24', minutes: 50, language: 'en', newId,
    lessons: [g4, g5].map((p, i) => gradeLessonFromPlan({ plan: p, sections: [], groupId: `group00${i + 1}`, grade: p.grades[0]! })),
  });
  const plans = [g4, g5, g5other, built.plan];
  assert.equal(sessionSourceFor({ session: built.plan, groupId: 'group001', grade: '4', plans })?.id, g4.id);
  assert.equal(sessionSourceFor({ session: built.plan, groupId: 'group002', grade: '5', plans })?.id, g5.id);
  assert.deepEqual(sessionSourceChoices({ session: built.plan, groupId: 'group002', grade: '5', plans }).map((p) => p.id), [g5.id, 'other005']);
  // Two lessons of the grade on that day: no guess.
  const twin: Plan = { ...g5, id: 'twin0005' };
  assert.equal(sessionSourceFor({ session: built.plan, groupId: 'group002', grade: '5', plans: [...plans, twin] }), null);
  // Moved to another day: found by the competencies the session copied from it.
  const moved: Plan = { ...g4, placements: [{ classId: cls.id, assignmentId: null, dates: ['2026-12-01'] }] };
  assert.equal(sessionSourceFor({ session: built.plan, groupId: 'group001', grade: '4', plans: [moved, g5, built.plan] })?.id, g4.id);
  // A session plan is never a grade's lesson.
  assert.ok(!sessionSourceChoices({ session: built.plan, groupId: 'group001', grade: '4', plans }).some((p) => p.id === built.plan.id));
});
