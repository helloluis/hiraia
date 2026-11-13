import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Plan, PlanSection, BUILTIN_TEMPLATES } from '@hiraia/tala-core/contracts';
import { exportWithFallback, renderHtml } from './print';
const input = {
  plan: Plan.parse({
    id: 'plan-0001',
    title: '<unsafe> ñ',
    templateId: 'tpl.dlp.v1',
    language: 'fil',
    grades: ['3'],
    durationMinutes: 50,
  }),
  sections: [
    PlanSection.parse({
      id: 'section-001',
      planId: 'plan-0001',
      key: 'objectives',
      content: { type: 'text', blocks: [{ t: 'p', spans: [{ text: '<script> & ñ' }] }] },
    }),
  ],
  paper: 'a4' as const,
  includeImages: true,
  template: BUILTIN_TEMPLATES[0]!,
  teacherName: 'Teacher',
  lang: 'fil' as const,
};
test('print fallback retries without images then shares text; server is final fallback', async () => {
  const calls: string[] = [];
  const result = await exportWithFallback(input, {
    async print() {
      calls.push('pdf');
      throw Error();
    },
    async text() {
      calls.push('text');
    },
    async server() {
      calls.push('server');
    },
  });
  assert.equal(result, 'text');
  assert.deepEqual(calls, ['pdf', 'pdf', 'text']);
  assert.equal(
    await exportWithFallback(input, {
      async print() {
        throw Error();
      },
      async text() {
        throw Error();
      },
      async server() {},
    }),
    'server'
  );
  assert.equal(
    await exportWithFallback(
      input,
      {
        async print() {
          throw Error();
        },
        async text() {
          throw Error();
        },
      },
      () => true
    ),
    'cancelled'
  );
  assert.ok(renderHtml(input).includes('&lt;unsafe&gt;'));
  assert.ok(!renderHtml(input).includes('<script>'));
});
