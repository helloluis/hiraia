import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GenerationInput } from '../contracts';
import { buildPrefilledDraft, validateGeneratedSections } from './index';
const parsed = GenerationInput.parse({
  kind: 'full',
  templateId: 'tpl.multigrade.v1',
  language: 'en',
  subjectName: 'Science',
  learningAreaId: 'science',
  timeBudgetMinutes: 30,
  gradeGroups: [
    { id: 'group-002', grade: '2' },
    { id: 'group-004', grade: '4' },
  ],
  competencies: { 'group-002': ['C2'], 'group-004': ['C4'] },
  curriculumVersion: 'test',
  classProfile: { materials: ['paper'] },
});
const input = {
  ...parsed,
  resolvedObjectives: { 'group-002': ['Describe roots.'], 'group-004': ['Compare plants.'] },
};
function valid() {
  const d = buildPrefilledDraft(input);
  const assessment = d.sections.find((s) => s.key === 'assessment')!;
  assessment.content = d.sections.find((s) => s.key === 'objectives')!.content;
  const timeline = d.sections.find((s) => s.content.type === 'multigrade')!.content;
  if (timeline.type === 'multigrade')
    for (const b of timeline.blocks)
      for (const a of Object.values(b.groups))
        a.activity = [{ t: 'p', spans: [{ text: 'Observe plants.' }] }];
  return d;
}
test('prefilled draft includes competencies and complete empty schedule', () => {
  const d = buildPrefilledDraft(input);
  assert.match(JSON.stringify(d), /Describe roots/);
  assert.match(JSON.stringify(d), /Compare plants/);
  assert.match(JSON.stringify(d), /group-004/);
  assert.ok(validateGeneratedSections(input, d.sections).some((e) => e.includes('activity')));
});
test('valid multigrade fixture passes; missing group and wrong minutes fail', () => {
  let d = valid();
  assert.deepEqual(validateGeneratedSections(input, d.sections), []);
  const c = d.sections.find((s) => s.content.type === 'multigrade')!.content;
  if (c.type === 'multigrade') {
    c.blocks[0]!.minutes = 29;
    delete c.blocks[0]!.groups['group-004'];
  }
  const errors = validateGeneratedSections(input, d.sections);
  assert.ok(errors.some((e) => e.includes('minutes')));
  assert.ok(errors.some((e) => e.includes('group-004')));
});
test('rejects unpaired direct instruction and missing competency assessment', () => {
  const d = valid();
  const c = d.sections.find((s) => s.content.type === 'multigrade')!.content;
  if (c.type === 'multigrade') {
    const b = c.blocks[0]!;
    b.teacherWith = 'group-002';
    for (const a of Object.values(b.groups)) a.mode = 'direct';
  }
  d.sections.find((s) => s.key === 'assessment')!.content = { type: 'pergroup', groups: {} };
  const errors = validateGeneratedSections(input, d.sections);
  assert.ok(errors.some((e) => e.includes('unpaired')));
  assert.ok(errors.some((e) => e.includes('assessment')));
});
test('rejects invented materials', () => {
  const d = valid();
  d.sections.find((s) => s.key === 'materials')!.content = {
    type: 'pergroup',
    groups: { 'group-002': [{ t: 'p', spans: [{ text: 'projector' }] }], 'group-004': [] },
  };
  assert.ok(validateGeneratedSections(input, d.sections).some((e) => e.includes('Materials')));
});
test('prefilled objectives use official codes and stored text, never internal IDs', () => {
  const ids = ['fixture-demo-v1.mathematics.g2.t2.3', 'fixture-demo-v1.mathematics.g4.t2.7'];
  const base = {
    ...parsed,
    competencies: { 'group-002': [ids[0]!], 'group-004': [ids[1]!] },
    resolvedCompetencies: {
      'group-002': [{ code: 'M2NS-IIa-1', text: 'Describe and compare numbers.' }],
      'group-004': [{ code: null, text: 'Compare fractions.' }],
    },
  };
  for (const templateId of ['tpl.multigrade.v1', 'tpl.dlp.v1']) {
    const draft = buildPrefilledDraft({ ...base, templateId });
    const content = JSON.stringify(draft.sections.map((s) => s.content));
    assert.ok(content.includes('M2NS-IIa-1: Describe and compare numbers.'));
    assert.ok(content.includes('Compare fractions.'));
    for (const id of ids) assert.equal(content.includes(id), false);
  }
  const unresolved = buildPrefilledDraft({ ...parsed, competencies: base.competencies });
  for (const id of ids) assert.equal(JSON.stringify(unresolved.sections).includes(id), false);
  const legacy = buildPrefilledDraft({
    ...parsed,
    competencies: base.competencies,
    resolvedObjectives: {
      'group-002': [`${ids[0]}: Describe and compare numbers.`],
      'group-004': [`${ids[1]}: Compare fractions.`],
    },
  });
  for (const id of ids) assert.equal(JSON.stringify(legacy.sections).includes(id), false);
  assert.deepEqual(base.competencies, { 'group-002': [ids[0]], 'group-004': [ids[1]] });
});

test('post-class sections stay blank in a prefilled draft and are never required from generation', () => {
  const draft = buildPrefilledDraft(input);
  for (const key of ['results', 'reflection']) {
    const section = draft.sections.find((s) => s.key === key)!;
    assert.ok(section);
    assert.equal(JSON.stringify(section.content).includes('Describe roots.'), false);
    if (section.content.type === 'text') assert.deepEqual(section.content.blocks, []);
    else if (section.content.type === 'pergroup')
      assert.ok(Object.values(section.content.groups).every((v) => v.length === 0));
    else assert.fail('post-class format');
  }
  const generated = valid().sections.filter((s) => !['results', 'reflection'].includes(s.key));
  assert.deepEqual(validateGeneratedSections(input, generated), []);
});
