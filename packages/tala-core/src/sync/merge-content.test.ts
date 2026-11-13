import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SectionContent } from '../contracts/content';
import { appendContent } from './merge-content';
import { mergeChangedFields } from './index';
import { sectionPlainText } from '../plan/text';
const body = (text: string) => [{ t: 'p' as const, spans: [{ text }] }];
const examples = (text: string): SectionContent[] => [
  { type: 'text', blocks: body(text) },
  { type: 'list', items: [text] },
  { type: 'procedure', steps: [{ id: 's'.repeat(64), title: text, minutes: 1, body: body(text) }] },
  { type: 'multigrade', blocks: [{ id: 'b'.repeat(64), label: text, minutes: 1, transitionMinutes: 0, pairedGroupIds: [], teacherWith: 'all', groups: { group001: { mode: 'shared', activity: body(text) } } }] },
  { type: 'weekgrid', days: [{ weekday: 1, date: null, body: body(text) }] },
  { type: 'pergroup', groups: { group001: body(text) } },
];
for (let i = 0; i < 6; i++) test(`keep both preserves reading order for ${examples('first')[i]!.type}`, () => {
  const result = appendContent(examples('first')[i]!, examples('second')[i]!);
  assert.equal(SectionContent.safeParse(result).success, true);
  const text = sectionPlainText(result); assert.ok(text.indexOf('first') < text.indexOf('second'));
});
test('keep both can preserve different types and refuses overflow without truncation', () => {
  const mixed = appendContent(examples('first')[0]!, examples('second')[1]!);
  assert.ok(sectionPlainText(mixed).includes('second'));
  assert.throws(() => appendContent({ type: 'list', items: Array(100).fill('one') }, { type: 'list', items: ['two'] }));
});
test('field merge preserves remote nested fields, local removals and treats ordered arrays atomically', () => {
  assert.deepEqual(mergeChangedFields({ nested: { a: 1, b: 1 }, deleted: true, array: [1] }, { nested: { a: 2, b: 1 }, array: [2] }, { nested: { a: 1, b: 2 }, deleted: true, array: [3], remoteOnly: true }), { nested: { a: 2, b: 2 }, array: [2], remoteOnly: true });
});
