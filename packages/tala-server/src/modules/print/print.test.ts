import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { Plan, PlanSection, BUILTIN_TEMPLATES } from '@hiraia/tala-core';
import type { RenderPlanOptions } from '@hiraia/tala-core/print';
import { createPlanPdf, planPdf } from './index';
import type { Ctx, BinaryResponse } from '../../kernel/types';
const plan = Plan.parse({ id: 'plan0001', title: 'Mga halaman — Peña, ñ á é í ó ú', templateId: 'tpl.dlp.v1', language: 'fil', grades: ['3'], durationMinutes: 50 });
const section = PlanSection.parse({ id: 'section1', planId: plan.id, key: 'content', content: { type: 'text', blocks: [{ t: 'p', spans: [{ text: 'Obserbahan ang halaman. Ihambing ang mga dahon.' }] }] } });
const fixture: RenderPlanOptions = { plan, sections: [section], template: BUILTIN_TEMPLATES[0]!, teacherName: 'Guro Peña', paper: 'a4', lang: 'fil', includeImages: false };
test('server fallback is a valid small PDF with embedded Filipino-capable font', async () => {
  const binary = await createPlanPdf(fixture);
  assert.equal(Buffer.from(binary).subarray(0, 5).toString(), '%PDF-');
  const pdf = await PDFDocument.load(binary); assert.equal(pdf.getPageCount(), 1); assert.equal(pdf.getTitle(), plan.title);
  assert.ok(binary.length < 300 * 1024); assert.deepEqual(pdf.getPage(0).getSize(), { width: 595.276, height: 841.89 });
  assert.deepEqual(binary, await createPlanPdf(fixture));
});
test('long bond landscape honors paper dimensions and wraps long content into pages', async () => {
  const long = { ...fixture, paper: 'long' as const, template: { ...fixture.template, orientation: 'landscape' as const }, sections: [{ ...section, content: { type: 'text' as const, blocks: Array.from({ length: 100 }, () => ({ t: 'p' as const, spans: [{ text: 'Mahabang paliwanag. '.repeat(80) }] })) } }] };
  const pdf = await PDFDocument.load(await createPlanPdf(long));
  assert.ok(pdf.getPageCount() > 1); assert.deepEqual(pdf.getPage(0).getSize(), { width: 936, height: 612 });
});
function context(owner = 'owner001', found = true): Ctx {
  const envelope = <T>(entity: string, data: T) => ({ entity, id: (data as { id: string }).id, rev: 1, updatedAt: '2026-11-13T00:00:00Z', deletedAt: null, data });
  return { user: owner ? { id: owner, displayName: 'Guro Peña' } : null, services: {
    records: { planSnapshot(user: string, id: string) { assert.equal(user, 'owner001'); assert.equal(id, plan.id); return found ? { plan: envelope('plan', plan), sections: [envelope('plan_section', section)] } : null; }, get() { return null; } },
    curriculum: { getCompetencies() { return []; } },
  } } as unknown as Ctx;
}
test('handler scopes snapshot to signed-in owner and returns a downloadable PDF', async () => {
  const result = await planPdf(context(), { params: { planId: plan.id }, query: { paper: 'long', images: false }, body: undefined }) as BinaryResponse;
  assert.equal(result.contentType, 'application/pdf'); assert.equal(result.filename, 'tala-plan0001.pdf');
  const pdf = await PDFDocument.load(result.binary); assert.equal(pdf.getPage(0).getHeight(), 936);
});
test('handler denies unauthenticated and unavailable private plans', async () => {
  const args = { params: { planId: plan.id }, query: { paper: 'a4' as const, images: false }, body: undefined };
  await assert.rejects(Promise.resolve().then(() => planPdf(context(''), args)), { code: 'unauthenticated' });
  await assert.rejects(Promise.resolve().then(() => planPdf(context('owner001', false), args)), { code: 'not_found' });
});

test('bundled fallback font explicitly covers Filipino orthography', async () => {
  const { frauncesBase64 } = await import('@hiraia/tala-core/print');
  const { default: fontkit } = await import('@pdf-lib/fontkit');
  const doc = await PDFDocument.create(); doc.registerFontkit(fontkit);
  const font = await doc.embedFont(Buffer.from(frauncesBase64, 'base64'), { subset: true });
  const set = new Set(font.getCharacterSet());
  for (const char of 'ñÑáÁéÉíÍóÓúÚàÀèÈìÌòÒùÙâÂêÊîÎôÔûÛ') assert.ok(set.has(char.codePointAt(0)!), char);
});
