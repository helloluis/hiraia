/**
 * Print output for a plan (PDF-1..7, PDF-4a). The HTML and text come from the SHARED templates in
 * `@hiraia/tala-core/print` (worker H), so web, mobile and the server PDF produce the same page for a revision.
 * The web "device" path is the browser's print window (Save as PDF); fallbacks are a plain page, copy as text,
 * and the server PDF when online.
 */
import {
  renderPlanHtml as sharedHtml,
  renderPlanText as sharedText,
  printOrientation,
  type RenderPlanOptions,
} from '@hiraia/tala-core/print';
import type { Competency } from '@hiraia/tala-core/contracts';

export type PrintInput = Omit<RenderPlanOptions, 'competencyLookup'> & {
  competencies?: Competency[];
};

function withLookup(input: PrintInput): RenderPlanOptions {
  const { competencies, ...rest } = input;
  const map = new Map((competencies ?? []).map((c) => [c.id, c]));
  return { ...rest, competencyLookup: (id) => map.get(id) ?? null };
}

export function renderPlanHtml(input: PrintInput): string {
  return sharedHtml(withLookup(input));
}

export function renderPlanText(input: PrintInput): string {
  return sharedText(withLookup(input));
}

export { printOrientation };

/** Open the print window on an HTML document in a same-origin iframe; resolves false if the browser refused. */
export function printHtml(html: string): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.position = 'fixed';
    frame.style.right = '0';
    frame.style.bottom = '0';
    frame.style.width = '0';
    frame.style.height = '0';
    frame.style.border = '0';
    document.body.appendChild(frame);
    const doc = frame.contentDocument;
    if (!doc) {
      frame.remove();
      return false;
    }
    doc.open();
    doc.write(html);
    doc.close();
    const win = frame.contentWindow!;
    const cleanup = () => setTimeout(() => frame.remove(), 1000);
    win.addEventListener('afterprint', cleanup, { once: true });
    setTimeout(() => {
      win.focus();
      win.print();
    }, 150);
    return true;
  } catch {
    return false;
  }
}
