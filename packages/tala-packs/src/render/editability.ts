/**
 * Teacher editability of a built deck (Luis, 19 Nov 2026: teachers must be able to edit the presentations).
 * Inspects the PPTX package itself, so it judges what PowerPoint, Google Slides or Impress will open:
 *   - every slide carries real text runs, and every learner-facing word of the pack (titles, lines, answer choices)
 *     is present as text, not as pixels;
 *   - no picture covers half the slide or more (no flattened slide images); pictures are only the drawings and the
 *     brand marks, each with alt text;
 *   - lists are native (auto-numbering / bullet characters), with no typed "•" or "1." a teacher would have to renumber;
 *   - only the deck's Office fonts (Cambria, Calibri, or the theme's) are used;
 *   - every slide has speaker notes as editable text.
 * Recorded per language in the build manifest and the inventory.
 */
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import type { WeeklyPackContent } from '@hiraia/tala-core/contracts';

export const EDITABILITY_VERSION = 'editability/1';
const FONTS_OK = new Set(['Cambria', 'Calibri', '+mj-lt', '+mn-lt']);

export interface Editability {
  version: string;
  state: 'pass' | 'fail';
  metrics: {
    slides: number;
    textRuns: number;
    minTextRunsOnASlide: number;
    textShapes: number;
    pictures: number;
    largestPictureShareOfSlide: number;
    nativeListParagraphs: number;
    fonts: string[];
    slidesWithNotes: number;
  };
  findings: string[];
}

const unescape = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const squash = (s: string) => unescape(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

export async function checkEditability(pptxFile: string, pack: WeeklyPackContent): Promise<Editability> {
  const zip = await JSZip.loadAsync(readFileSync(pptxFile));
  const findings: string[] = [];
  const pres = await zip.file('ppt/presentation.xml')!.async('string');
  const size = pres.match(/<p:sldSz cx="(\d+)" cy="(\d+)"/);
  const slideArea = size ? Number(size[1]) * Number(size[2]) : 12192000 * 6858000;
  const slideFiles = Object.keys(zip.files)
    .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  if (slideFiles.length !== pack.slides.length) findings.push(`deck has ${slideFiles.length} slides, the pack ${pack.slides.length}`);

  let textRuns = 0;
  let minRuns = Infinity;
  let textShapes = 0;
  let pictures = 0;
  let largest = 0;
  let lists = 0;
  let notes = 0;
  const fonts = new Set<string>();
  for (const [i, f] of slideFiles.entries()) {
    const xml = await zip.file(f)!.async('string');
    const s = pack.slides[i];
    const id = s?.id ?? `slide ${i + 1}`;
    // text runs inside shapes (p:sp), i.e. editable text boxes, placeholders and text-bearing shapes
    const shapes = xml.match(/<p:sp>[\s\S]*?<\/p:sp>/g) ?? [];
    const runs = shapes.flatMap((sp) => (sp.match(/<a:t>([^<]*)<\/a:t>/g) ?? []).map((t) => t.slice(5, -6))).filter((t) => t.trim());
    textShapes += shapes.filter((sp) => /<a:t>[^<]*\S[^<]*<\/a:t>/.test(sp)).length;
    textRuns += runs.length;
    minRuns = Math.min(minRuns, runs.length);
    if (!runs.length) findings.push(`${id}: no editable text on the slide`);
    const shown = squash(runs.join(' '));
    if (s) {
      const wanted = [s.title.replace(/^(Day|Araw)\s*\d+\s*[:—-]\s*/i, ''), ...s.lines, ...s.choices];
      for (const w of wanted) {
        const q = squash(w.replace(/^\s*(?:[-–•●*]\s+|step\s*\d{1,2}\s*[:.)-]\s*|\d{1,2}[.)]\s+)/i, ''));
        if (q && !shown.includes(q)) findings.push(`${id}: "${w.slice(0, 50)}" is not editable text on the slide`);
      }
    }
    // pictures: size share and alt text
    for (const pic of xml.match(/<p:pic>[\s\S]*?<\/p:pic>/g) ?? []) {
      pictures += 1;
      const ext = pic.match(/<a:ext cx="(\d+)" cy="(\d+)"/);
      const share = ext ? (Number(ext[1]) * Number(ext[2])) / slideArea : 0;
      largest = Math.max(largest, share);
      if (share >= 0.5) findings.push(`${id}: a picture covers ${(share * 100).toFixed(0)}% of the slide`);
      if (!/descr="[^"]+"/.test(pic)) findings.push(`${id}: a picture has no alt text`);
    }
    // native lists, and no typed list markers
    lists += (xml.match(/<a:buAutoNum\b|<a:buChar\b/g) ?? []).length;
    for (const r of runs) if (/^\s*(?:•|●|▪)\s|^\s*\d{1,2}\s{2,}/.test(unescape(r))) findings.push(`${id}: typed list marker "${r.slice(0, 12)}" (use a native list)`);
    for (const m of xml.matchAll(/<a:(?:latin|ea|cs) typeface="([^"]+)"/g)) fonts.add(m[1]!);
    // speaker notes
    const rels = await zip.file(f.replace('slides/', 'slides/_rels/') + '.rels')?.async('string');
    const target = rels?.match(/Target="\.\.\/notesSlides\/(notesSlide\d+\.xml)"/)?.[1];
    const notesXml = target ? await zip.file(`ppt/notesSlides/${target}`)?.async('string') : undefined;
    if (notesXml && /<a:t>[^<]*\S/.test(notesXml)) notes += 1;
    else findings.push(`${id}: no editable speaker notes`);
  }
  for (const font of fonts) if (!FONTS_OK.has(font)) findings.push(`font ${font} is not one of Cambria, Calibri or the theme fonts`);
  return {
    version: EDITABILITY_VERSION,
    state: findings.length ? 'fail' : 'pass',
    metrics: {
      slides: slideFiles.length,
      textRuns,
      minTextRunsOnASlide: Number.isFinite(minRuns) ? minRuns : 0,
      textShapes,
      pictures,
      largestPictureShareOfSlide: Number(largest.toFixed(3)),
      nativeListParagraphs: lists,
      fonts: [...fonts].sort(),
      slidesWithNotes: notes,
    },
    findings: findings.slice(0, 40),
  };
}
