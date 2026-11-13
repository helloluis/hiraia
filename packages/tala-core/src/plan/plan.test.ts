import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_TEMPLATES, type SectionContent } from '../contracts/content';
import { Plan, PlanSection } from '../contracts/records';
import { blankSections, validatePlanForLock, sectionPlainText, stripForPublish, substantiallyRewritten, applyGeneratedSections, restoreSectionRevision, revisionCode } from './index';
const plan = Plan.parse({ id: 'plan0001', templateId: 'tpl.dlp.v1', language: 'fil', grades: ['3'], gradeGroupIds: ['group001'], durationMinutes: 50 });
const text = (s: string): SectionContent => ({ type: 'text', blocks: [{ t: 'p', spans: [{ text: s }] }] });
const section = PlanSection.parse({ id: 'section1', planId: plan.id, key: 'content', content: text('teacher original') });
test('blank sections follow each template and validate against schemas', () => {
  let id = 0;
  for (const template of BUILTIN_TEMPLATES) {
    const sections = blankSections(template, plan.id, [{ id: 'group001' }], () => `section${++id}`);
    assert.deepEqual(sections.map(s => s.key), template.sections.map(s => s.key));
    assert.ok(sections.every(s => PlanSection.safeParse(s).success));
    assert.equal(validatePlanForLock({ ...plan, templateId: template.id }, sections, template).ok, false);
  }
});
test('DOC-1 checks content, template, state and curriculum tags', () => {
  const template = { ...BUILTIN_TEMPLATES[0]!, sections: [{ key: 'content', label: { en: 'Content', fil: 'Nilalaman' }, required: true, contentType: 'text' as const, outsideLock: false }] };
  assert.equal(validatePlanForLock(plan, [section], template, { curriculum: 'none' }).ok, true);
  assert.equal(validatePlanForLock(plan, [section], template, { curriculum: 'deped' }).ok, false);
  assert.equal(validatePlanForLock({ ...plan, competencies: { group001: ['competency'] } }, [section], template, { curriculum: 'deped' }).ok, true);
  assert.equal(validatePlanForLock(plan, [{ ...section, content: text(' \n ') }], template).ok, false);
  assert.equal(validatePlanForLock({ ...plan, state: 'locked' }, [section], template).ok, false);
});
test('plain text covers every content variant', () => {
  const variants: SectionContent[] = [text('ñ á'), { type: 'list', items: ['one'] }, { type: 'procedure', steps: [{ id: 'step0001', title: 'Start', minutes: 2, body: [] }] }, { type: 'weekgrid', days: [{ date: null, weekday: 1, body: [] }] }, { type: 'pergroup', groups: { group001: [] } }, { type: 'multigrade', blocks: [{ id: 'block001', label: 'Start', minutes: 4, transitionMinutes: 1, teacherWith: 'all', pairedGroupIds: [], groups: { group001: { mode: 'shared', activity: [] } } }] }];
  for (const content of variants) assert.equal(typeof sectionPlainText(content), 'string');
  assert.equal(sectionPlainText(variants[0]!), 'ñ á');
});
test('publication allow-list strips private metadata, dates, remarks, IDs and generation history', () => {
  const p = { ...plan, placements: [{ classId: 'class001', assignmentId: null, dates: ['2026-11-13'] }], submitted: { date: '2026-11-13', note: 'principal private' }, competencies: { group001: ['competency1'] } };
  const sections = [section, { ...section, id: 'section2', key: 'reflection', content: text('private remark') }, { ...section, id: 'section3', key: 'weekgrid', content: { type: 'weekgrid' as const, days: [{ date: '2026-11-13', weekday: 1, body: [] }] } }];
  const output = stripForPublish(p, sections, { schoolName: 'Private school' });
  const json = JSON.stringify(output);
  for (const secret of ['class001', 'plan0001', 'group001', '2026-11-13', 'principal private', 'private remark', 'Private school', 'section1']) assert.ok(!json.includes(secret), secret);
  assert.deepEqual(output.competencies, { 'public.g1': ['competency1'] });
  assert.equal(stripForPublish(p, sections, { schoolName: 'Opt-in school', includeSchoolName: true }).schoolName, 'Opt-in school');
});
test('revision fingerprint is deterministic regardless of key insertion order', () => {
  assert.equal(revisionCode({ a: 1, b: 2 }), revisionCode({ b: 2, a: 1 }));
  assert.notEqual(revisionCode({ a: 1 }), revisionCode({ a: 2 }));
  assert.ok(revisionCode(plan).length <= 16);
});
test('substantial rewriting requires new language, not case changes, deletion or word reordering', () => {
  assert.equal(substantiallyRewritten([text('one two three four')], [text('FOUR THREE TWO ONE')]), false);
  assert.equal(substantiallyRewritten([text('one two three four')], [text('one')]), false);
  assert.equal(substantiallyRewritten([text('one two three four')], [text('new lesson words entirely')]), true);
});
test('generation requires confirmation and returns restorable previous revision without mutating inputs', () => {
  const input = { plan, sections: [section], generated: [{ key: 'content', content: text('generated') }], gen: { provider: 'fake', model: 'fake', promptId: 'lesson/dlp', promptVersion: 1, curriculumVersion: null, at: '2026-11-13T00:00:00Z' }, newId: () => 'section9' };
  assert.throws(() => applyGeneratedSections(input), /Confirm/);
  const result = applyGeneratedSections({ ...input, confirmedSectionIds: [section.id] });
  assert.equal(result.plan.aiAssisted, true); assert.equal(result.sections[0]!.origin, 'ai');
  assert.deepEqual(restoreSectionRevision(result.revisions[0]!), { ...section, editedByTeacher: true });
  assert.equal(result.revisions[0]!.reason, 'regenerate');
  assert.deepEqual(input.sections, [section]);
  assert.throws(() => applyGeneratedSections({ ...input, plan: { ...plan, state: 'locked' } }), /Unlock/);
});

test('shared revision records support restore, bounded history and conservative provenance', async () => {
  const { sectionRevision, boundSectionHistory, planProvenance } = await import('./index');
  const ai = { ...section, origin: 'ai' as const, content: text('one two three four') };
  const revision = sectionRevision(ai, { id: 'revision1', savedAt: '2026-11-13T00:00:00Z', reason: 'edit' });
  assert.equal(restoreSectionRevision(revision).id, section.id);
  assert.equal(boundSectionHistory([revision, { ...revision, id: 'revision2' }], 1).remove.length, 1);
  const edited = { ...ai, editedByTeacher: true, content: text('new words entirely rewritten') };
  assert.equal(planProvenance({ plan: { ...plan, aiAssisted: true }, sections: [edited], revisions: [] }).aiDrafted, true);
  assert.equal(planProvenance({ plan: { ...plan, aiAssisted: true }, sections: [edited], revisions: [revision] }).aiDrafted, false);
});
test('lock records actor, time and exact content revision code', async () => {
  const { lockPlan } = await import('./index');
  const template = { ...BUILTIN_TEMPLATES[0]!, sections: [{ key: 'content', label: { en: 'Content', fil: 'Nilalaman' }, required: true, contentType: 'text' as const, outsideLock: false }] };
  const args = { plan, sections: [section], template, class: { curriculum: 'none' as const }, teacherName: 'Teacher', at: '2026-11-13T00:00:00Z', revision: null };
  const locked = lockPlan(args);
  assert.equal(locked.lock?.lockedBy, 'Teacher'); assert.equal(locked.lock?.lockedAt, args.at); assert.equal(locked.state, 'locked');
  assert.notEqual(locked.lock?.revisionCode, lockPlan({ ...args, sections: [{ ...section, content: text('Changed lesson') }] }).lock?.revisionCode);
});
