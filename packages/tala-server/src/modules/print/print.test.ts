import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFPage } from 'pdf-lib';
import { Plan, PlanSection, BUILTIN_TEMPLATES } from '@hiraia/tala-core';
import type { RenderPlanOptions } from '@hiraia/tala-core/print';
import { createPlanPdf, printModule } from './index';
import { createTestServer } from '@hiraia/tala-server/testing';
const plan = Plan.parse({
  id: 'plan0001',
  title: 'Mga halaman — Peña, ñ á é í ó ú',
  templateId: 'tpl.dlp.v1',
  language: 'fil',
  grades: ['3'],
  durationMinutes: 50,
});
const section = PlanSection.parse({
  id: 'section1',
  planId: plan.id,
  key: 'content',
  content: {
    type: 'text',
    blocks: [{ t: 'p', spans: [{ text: 'Obserbahan ang halaman. Ihambing ang mga dahon.' }] }],
  },
});
const fixture: RenderPlanOptions = {
  plan,
  sections: [section],
  template: BUILTIN_TEMPLATES[0]!,
  teacherName: 'Guro Peña',
  paper: 'a4',
  lang: 'fil',
  includeImages: false,
};
test('server fallback is a valid small PDF with embedded Filipino-capable font', async () => {
  const binary = await createPlanPdf(fixture);
  assert.equal(Buffer.from(binary).subarray(0, 5).toString(), '%PDF-');
  const pdf = await PDFDocument.load(binary);
  assert.equal(pdf.getPageCount(), 1);
  assert.equal(pdf.getTitle(), plan.title);
  assert.ok(binary.length < 300 * 1024);
  assert.deepEqual(pdf.getPage(0).getSize(), { width: 595.276, height: 841.89 });
  assert.deepEqual(binary, await createPlanPdf(fixture));
});
test('long bond landscape honors paper dimensions and wraps long content into pages', async () => {
  const long = {
    ...fixture,
    paper: 'long' as const,
    template: { ...fixture.template, orientation: 'landscape' as const },
    sections: [
      {
        ...section,
        content: {
          type: 'text' as const,
          blocks: Array.from({ length: 100 }, () => ({
            t: 'p' as const,
            spans: [{ text: 'Mahabang paliwanag. '.repeat(80) }],
          })),
        },
      },
    ],
  };
  const pdf = await PDFDocument.load(await createPlanPdf(long));
  assert.ok(pdf.getPageCount() > 1);
  assert.deepEqual(pdf.getPage(0).getSize(), { width: 936, height: 612 });
});
test('real kernel serves an owner-scoped PDF and rejects anonymous, other-owner and invalid queries', async (testContext) => {
  const t = createTestServer({ modules: [printModule] });
  testContext.after(() => t.close());
  const owner = await t.registerUser({ displayName: 'Guro Peña' });
  const pushed = await t.client(owner.token).syncTransport.push({
    deviceId: 'print-test-device',
    mutations: [
      {
        mutationId: 'print-plan-create',
        entity: 'plan',
        id: plan.id,
        op: 'upsert',
        baseRev: 0,
        data: plan,
      },
      {
        mutationId: 'print-section-create',
        entity: 'plan_section',
        id: section.id,
        op: 'upsert',
        baseRev: 0,
        data: section,
      },
    ],
  });
  assert.deepEqual(
    pushed.results.map((result) => result.status),
    ['applied', 'applied']
  );
  assert.equal(t.services.records.planSnapshot(owner.id, plan.id)?.sections.length, 1);
  const other = await t.registerUser();
  const result = await t.call('print.planPdf', {
    params: { planId: plan.id },
    query: { paper: 'long', images: false },
    token: owner.token,
  });
  assert.equal(result.status, 200);
  assert.match(result.headers.get('content-type') ?? '', /application\/pdf/);
  assert.match(result.headers.get('content-disposition') ?? '', /tala-plan0001.pdf/);
  const pdf = await PDFDocument.load(result.data as ArrayBuffer);
  assert.equal(pdf.getPage(0).getHeight(), 936);
  assert.equal((await t.call('print.planPdf', { params: { planId: plan.id } })).status, 401);
  assert.equal(
    (await t.call('print.planPdf', { params: { planId: plan.id }, token: other.token })).status,
    404
  );
  const invalid = await t.request('GET', `/api/v1/plans/${plan.id}/pdf?paper=invalid`, {
    headers: { Authorization: `Bearer ${owner.token}` },
  });
  assert.equal(invalid.status, 400);
  t.services.records.remove(owner.id, 'plan', plan.id);
  assert.equal(t.services.records.get(owner.id, 'plan', plan.id), null);
  assert.equal(
    (await t.call('print.planPdf', { params: { planId: plan.id }, token: owner.token })).status,
    404
  );
  assert.deepEqual(t.errors, []);
});

test('bundled fallback font explicitly covers Filipino orthography', async () => {
  const { frauncesBase64 } = await import('@hiraia/tala-core/print');
  const { default: fontkit } = await import('@pdf-lib/fontkit');
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(Buffer.from(frauncesBase64, 'base64'), { subset: true });
  const set = new Set(font.getCharacterSet());
  for (const char of 'ñÑáÁéÉíÍóÓúÚàÀèÈìÌòÒùÙâÂêÊîÎôÔûÛ')
    assert.ok(set.has(char.codePointAt(0)!), char);
});

test('PDF draws the shared session note and post-class ruled lines without transition time', async (t) => {
  const { printFixture } = await import('../../../../tala-core/src/print/fixtures');
  const options = printFixture('multigrade');
  const lines: string[] = [];
  const draw = PDFPage.prototype.drawText;
  t.mock.method(
    PDFPage.prototype,
    'drawText',
    function (this: PDFPage, text: string, options: Parameters<PDFPage['drawText']>[1]) {
      lines.push(text);
      return draw.call(this, text, options);
    }
  );
  await createPlanPdf(options);
  const output = lines.join('\n');
  assert.ok(output.includes('Maghanda ng gawain para sa bawat pangkat.'));
  assert.ok(output.includes('Pagkatapos ng klase'));
  assert.ok(output.includes('______________________________'));
  assert.doesNotMatch(output, /transition|paglipat|group001/);
});
