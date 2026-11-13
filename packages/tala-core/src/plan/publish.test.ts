import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Plan, PlanSection } from '../contracts/records';
import { createPublishCleaner, stripForPublish } from './index';
import { sectionPlainText } from './text';
import type { RichText, SectionContent } from '../contracts/content';
const body: RichText = [
  { t: 'p', spans: [{ text: 'Rizal ', b: true }, { text: 'Elementary School — Grade 4 - Sampaguita, November 13, 2026' }] },
  { t: 'p', spans: [{ text: 'Prepared by:' }] },
  { t: 'p', spans: [{ text: 'Ana Reyes' }] },
  { t: 'p', spans: [{ text: 'Teacher I' }] },
  { t: 'p', spans: [{ text: 'Discuss history in 1898. Grade 4 uses Manila Paper.' }] },
];
const privacy = { schoolNames: ['Rizal Elementary School'], classNames: ['Grade 4', 'Grade 4 - Sampaguita'], teacherName: 'Ana Reyes', dates: ['2026-11-13'] };
const variants: SectionContent[] = [
  { type: 'text', blocks: body },
  { type: 'list', items: body.map(b => b.t === 'p' ? b.spans.map(s => s.text).join('') : '') },
  { type: 'procedure', steps: [{ id: 'step1', title: 'Rizal Elementary School', minutes: 10, body }] },
  { type: 'weekgrid', days: [{ date: '2026-11-13', weekday: 5, body }] },
  { type: 'pergroup', groups: { group001: body } },
  { type: 'multigrade', blocks: [{ id: 'block1', label: 'Grade 4 - Sampaguita', minutes: 10, transitionMinutes: 0, teacherWith: 'all', pairedGroupIds: [], groups: { group001: { mode: 'shared', activity: body } } }] },
];
for (const content of variants) test(`shared publishing cleaner strips private details from ${content.type}`, () => {
  const output = createPublishCleaner('en', privacy).content(content);
  const text = sectionPlainText(output);
  for (const privateText of ['Rizal Elementary School', 'Sampaguita', 'November 13, 2026', 'Ana Reyes', 'Teacher I', 'Prepared by']) assert.ok(!text.includes(privateText), privateText);
  for (const preserved of ['1898', 'Grade 4', 'Manila Paper']) assert.ok(text.includes(preserved));
  assert.ok(text.includes('[school]')); assert.ok(text.includes('[section]')); assert.ok(text.includes('[date]'));
});
test('publish snapshot and title cleaner share language, opt-in and exact date replacements', () => {
  const plan = Plan.parse({ id: 'plan1', templateId: 'tpl.dlp.v1', language: 'fil', grades: ['4'], gradeGroupIds: ['group001'], durationMinutes: 50, customObjectives: ['Rizal Elementary School on 13 Nobyembre 2026'], placements: [{ classId: 'class1', assignmentId: null, dates: ['2026-11-13'] }] });
  const section = PlanSection.parse({ id: 'section1', planId: plan.id, key: 'content', content: variants[0] });
  const result = stripForPublish(plan, [section], { ...privacy, dates: [] });
  assert.equal(result.customObjectives[0], '[paaralan] on [petsa]');
  const cleaner = createPublishCleaner('fil', privacy);
  assert.equal(cleaner.text('Rizal Elementary School on 11/13/2026'), '[paaralan] on [petsa]');
  assert.equal(createPublishCleaner('en', { ...privacy, includeSchoolName: true }).text('Rizal Elementary School'), 'Rizal Elementary School');
  assert.equal(createPublishCleaner('en', { dates: ['2026-99-90'] }).text('1898'), '1898');
  assert.deepEqual(body[0], { t: 'p', spans: [{ text: 'Rizal ', b: true }, { text: 'Elementary School — Grade 4 - Sampaguita, November 13, 2026' }] });
});

test('cross-span privacy replacements retain schema-valid text lengths', async () => {
  const { SectionContent } = await import('../contracts/content');
  const content: SectionContent = { type: 'text', blocks: [{ t: 'p', spans: [{ text: 'x'.repeat(3990) + ' Rizal ' }, { text: 'Elementary School ' + 'y'.repeat(3900) }] }] };
  const result = createPublishCleaner('en', privacy).content(content);
  assert.ok(SectionContent.safeParse(result).success);
  assert.ok(!sectionPlainText(result).includes('Rizal Elementary School'));
});
