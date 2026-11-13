import type { Plan, PlanSection } from '@hiraia/tala-core/contracts';
import * as sharedPrint from '@hiraia/tala-core/print';
export interface PrintInput { plan: Plan; sections: PlanSection[]; paper: 'a4' | 'long'; images: boolean }
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
/** Temporary adapter until H's renderer lands; isolated and visibly documented. */
export function renderHtml(input: PrintInput) {
  const renderer = (sharedPrint as { renderPlanHtml?: (input: PrintInput) => string }).renderPlanHtml;
  if (renderer) return renderer(input);
  return `<!doctype html><html><meta charset="utf-8"><body><h1>${escape(input.plan.title)}</h1><p>${input.plan.state === 'locked' ? escape(input.plan.lock?.revisionCode ?? '') : 'DRAFT'}</p>${input.sections.map(s => `<h2>${escape(s.key)}</h2><pre style="white-space:pre-wrap">${escape(sectionText(s))}</pre>`).join('')}</body></html>`;
}
export const sectionText = (s: PlanSection) => JSON.stringify(s.content, null, 2);
export async function exportWithFallback(input: PrintInput, io: { print(html: string): Promise<void>; text(text: string): Promise<void>; server?(): Promise<void> }, cancelled: () => boolean = () => false) {
  for (const images of [input.images, false]) {
    if (cancelled()) return 'cancelled';
    try { await io.print(renderHtml({ ...input, images })); return images ? 'pdf' : 'pdf-no-images'; } catch { /* next lighter path */ }
  }
  if (cancelled()) return 'cancelled';
  try { await io.text([input.plan.title, ...input.sections.map(sectionText)].join('\n\n')); return 'text'; }
  catch { if (!cancelled() && io.server) { await io.server(); return 'server'; } throw new Error('Export unavailable'); }
}
