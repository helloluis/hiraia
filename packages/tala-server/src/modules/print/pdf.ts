import { PDFDocument, degrees, rgb, type PDFFont } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { frauncesBase64, printPageSize, renderPlanText, type RenderPlanOptions } from '@hiraia/tala-core/print';

/** Small text-first fallback: no browser, remote resources or image decoder. */
export async function createPlanPdf(options: RenderPlanOptions): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(Buffer.from(frauncesBase64, 'base64'), { subset: true });
  doc.setTitle(options.plan.title);
  doc.setAuthor(options.teacherName);
  doc.setCreator('Tala · Hiraia');
  const date = new Date(options.plan.lock?.lockedAt ?? '2000-01-01T00:00:00.000Z');
  doc.setCreationDate(date);
  doc.setModificationDate(date);
  const [width, height] = printPageSize(options);
  const margin = 36, size = 10, leading = 15;
  const supported = new Set(font.getCharacterSet());
  const printable = (s: string) => [...s.normalize('NFC')].map(c => supported.has(c.codePointAt(0)!) ? c : '?').join('');
  const lines = renderPlanText(options).split('\n').flatMap(line => wrap(printable(line), font, size, width - margin * 2));
  const capacity = Math.floor((height - margin * 2 - 36) / leading);
  const pageCount = Math.max(1, Math.ceil(lines.length / capacity));
  for (let index = 0; index < pageCount; index++) {
    const page = doc.addPage([width, height]);
    if (options.plan.state === 'draft') page.drawText('DRAFT', { x: width * .18, y: height * .42, size: 66, font, color: rgb(0, 0, 0), opacity: .1, rotate: degrees(30) });
    let y = height - margin;
    for (const line of lines.slice(index * capacity, (index + 1) * capacity)) {
      if (line) page.drawText(line, { x: margin, y, size, font, color: rgb(0, 0, 0) });
      y -= leading;
    }
    // Canonical Hiraia glyph, monochrome (same path geometry as the shared HTML asset).
    for (const path of ['M5 4Q12 2 20 11Q28 2 35 4', 'M10 14Q15 14 20 21Q25 14 30 14', 'M15 25Q18 26 20 30Q22 26 25 25']) {
      page.drawSvgPath(path, { x: margin, y: 27, scale: .4, borderWidth: 3.4, borderColor: rgb(0, 0, 0) });
    }
    page.drawCircle({ x: margin + 8, y: 27 - 37 * .4, size: .8, color: rgb(0, 0, 0) });
    const revision = options.plan.lock ? `${options.plan.lock.lockedAt.slice(0, 10)} · ${options.plan.lock.revisionCode}` : 'DRAFT';
    page.drawText(printable(`Tala · Hiraia · ${revision} · ${index + 1}/${pageCount}`), { x: margin + 23, y: 18, font, size: 8 });
  }
  return doc.save({ useObjectStreams: true, addDefaultPage: false });
}
function wrap(line: string, font: PDFFont, size: number, maxWidth: number): string[] {
  if (!line) return [''];
  const result: string[] = [];
  let current = '';
  // Character fallback also wraps long unbroken competency codes and URLs.
  for (const part of line.split(/(\s+)/)) {
    if (font.widthOfTextAtSize(current + part, size) <= maxWidth) { current += part; continue; }
    if (current.trim()) result.push(current.trimEnd());
    current = '';
    for (const char of part.trimStart()) {
      if (font.widthOfTextAtSize(current + char, size) > maxWidth && current) { result.push(current); current = ''; }
      current += char;
    }
  }
  if (current || !result.length) result.push(current.trimEnd());
  return result;
}
