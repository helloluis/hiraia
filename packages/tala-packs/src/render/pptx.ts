/**
 * Classroom-TV slide deck (16:9, 13.333 × 7.5 in) from a pack. Editable PowerPoint built on layouts with title
 * placeholders, one section per day, speaker notes on every slide and alt text on every picture.
 *
 * Brand: Hiraia forest / cream / plate white, Tala teal as the one accent, gold and yellow as decoration
 * (packages/tala-core/src/tokens.ts). Fonts are Office-safe (Cambria headings, Calibri body) so a downloaded deck
 * looks the same offline on any school laptop; the Fraunces display face is not installed there.
 * Illustrations are embedded byte-for-byte from the Hiraia library after their SHA-256 is verified.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import PptxGenJSImport from 'pptxgenjs';
// pptxgenjs ships CommonJS; under ESM loaders the class may arrive as `.default`.
const PptxGenJS: typeof PptxGenJSImport = ((PptxGenJSImport as unknown as { default?: typeof PptxGenJSImport }).default ?? PptxGenJSImport);
type pptxgen = PptxGenJSImport;
declare namespace pptxgen { type Slide = PptxGenJSImport.Slide; }
import sharp from 'sharp';
import type { PackReview, Slide, WeeklyPackContent } from '@hiraia/tala-core/contracts';
import { REFERENCE_ROOT, REPO_ROOT } from '../paths';
import { LABELS } from './labels';

export const C = {
  forest: '1C3B2E',
  cream: 'F5ECD6',
  white: 'FFFFFF',
  teal: '2F6360',
  gold: 'BD8928',
  yellow: 'E9B949',
  brick: '7A2E22',
  sage: '8C9E6E',
  muted: '4E6B5E',
  hairline: 'D9D2BE',
  faded: '8A9A92',
} as const;
export const FONTS = { head: 'Cambria', body: 'Calibri' } as const;
const W = 13.333;
const H = 7.5;
const M = 0.6;

/** Slide-type labels come from ./labels per language. */

/** Rough line-wrapping estimate; average glyph width as a fraction of the font size. */
export function estimateHeight(lines: string[], widthIn: number, pt: number, opts: { serif?: boolean; bold?: boolean; paraGap?: number } = {}) {
  const k = (opts.serif ? 0.5 : 0.47) * (opts.bold ? 1.06 : 1);
  const perRow = Math.max(4, Math.floor((widthIn * 72) / (pt * k)));
  let rows = 0;
  for (const l of lines) {
    const words = l.split(/\s+/);
    let row = 0;
    let used = 0;
    for (const w of words) {
      const need = used ? w.length + 1 : w.length;
      if (used + need > perRow) {
        row += 1;
        used = w.length;
      } else used += need;
    }
    rows += row + 1;
  }
  return (rows * pt * 1.2) / 72 + (lines.length - 1) * ((opts.paraGap ?? 10) / 72);
}

export function pickSize(lines: string[], widthIn: number, heightIn: number, sizes: number[], opts: { serif?: boolean; bold?: boolean; paraGap?: number } = {}) {
  for (const s of sizes) if (estimateHeight(lines, widthIn, s, opts) <= heightIn) return { size: s, fits: true };
  return { size: sizes.at(-1)!, fits: false };
}

interface Img {
  data: string;
  w: number;
  h: number;
}

async function brandPng(file: string, recolor: Record<string, string>, heightPx: number): Promise<Img> {
  let svg = readFileSync(file, 'utf8');
  for (const [from, to] of Object.entries(recolor)) svg = svg.split(from).join(to);
  const buf = await sharp(Buffer.from(svg), { density: 600 }).resize({ height: heightPx }).png().toBuffer();
  const meta = await sharp(buf).metadata();
  return { data: 'image/png;base64,' + buf.toString('base64'), w: meta.width!, h: meta.height! };
}

export interface RenderReport {
  slides: number;
  fitWarnings: string[];
  images: Array<{ slug: string; sha256: string; slides: string[] }>;
}

export async function renderDeck(pack: WeeklyPackContent, review: PackReview | null, outFile: string): Promise<RenderReport> {
  const pres = new PptxGenJS();
  pres.layout = 'LAYOUT_WIDE';
  pres.author = 'Hiraia (Tala teaching packs)';
  pres.company = 'Hiraia';
  pres.title = `${pack.title} — Grade ${pack.grade} Science, Term ${pack.term}, Week ${pack.week}`;
  pres.subject = 'Philippine Science lesson slides';
  pres.theme = { headFontFace: FONTS.head, bodyFontFace: FONTS.body };
  const approved = review?.publication === 'approved';
  const L = LABELS[pack.language];
  const footer = L.footer(pack.grade, pack.term, pack.week);
  const fitWarnings: string[] = [];

  // Layouts
  const light = (name: string, titleW: number) =>
    pres.defineSlideMaster({
      title: name,
      background: { color: C.cream },
      objects: [
        { text: { text: footer, options: { x: M, y: H - 0.48, w: 7, h: 0.3, fontFace: FONTS.body, fontSize: 12, color: C.muted, margin: 0 } } },
        {
          placeholder: {
            options: { name: 'title', type: 'title', x: M, y: 1.0, w: titleW, h: 1.25, fontFace: FONTS.head, bold: true, color: C.forest, align: 'left', valign: 'top', margin: 0 },
            text: '',
          },
        },
      ],
      slideNumber: { x: W - M - 0.8, y: H - 0.48, w: 0.8, h: 0.3, fontFace: FONTS.body, fontSize: 12, color: C.muted, align: 'right' },
    });
  light('TALA_LIGHT', W - 2 * M);
  light('TALA_LIGHT_SPLIT', 6.95);
  pres.defineSlideMaster({
    title: 'TALA_DARK',
    background: { color: C.forest },
    objects: [
      { text: { text: footer, options: { x: M, y: H - 0.48, w: 7, h: 0.3, fontFace: FONTS.body, fontSize: 12, color: 'C9D3C2', margin: 0 } } },
      {
        placeholder: {
          options: { name: 'title', type: 'title', x: M, y: 2.05, w: 7.4, h: 2.0, fontFace: FONTS.head, bold: true, color: C.cream, align: 'left', valign: 'top', margin: 0 },
          text: '',
        },
      },
    ],
    slideNumber: { x: W - M - 0.8, y: H - 0.48, w: 0.8, h: 0.3, fontFace: FONTS.body, fontSize: 12, color: 'C9D3C2', align: 'right' },
  });

  // Brand marks, recoloured for the dark layout (teal → cream on forest).
  const glyph = await brandPng(resolve(REPO_ROOT, 'packages/tala-web/public/brand/hiraia-glyph.svg'), { '#BD8928': `#${C.yellow}` }, 240);
  const wordmark = await brandPng(resolve(REPO_ROOT, 'packages/tala-web/public/brand/tala-wordmark.svg'), { '#2F6360': `#${C.cream}` }, 160);

  // Illustrations: verify bytes, then embed.
  const imgCache = new Map<string, Img & { sha256: string }>();
  const used = new Map<string, string[]>();
  const image = async (slug: string): Promise<Img & { sha256: string }> => {
    const hit = imgCache.get(slug);
    if (hit) return hit;
    const rec = pack.illustrations.find((x) => x.slug === slug);
    if (!rec) throw new Error(`illustration ${slug} has no provenance record`);
    const bytes = readFileSync(resolve(REFERENCE_ROOT, rec.file));
    const sha = createHash('sha256').update(bytes).digest('hex');
    if (sha !== rec.sha256) throw new Error(`illustration ${slug}: bytes changed since it was checked (${sha.slice(0, 12)} ≠ ${rec.sha256.slice(0, 12)})`);
    const meta = await sharp(bytes).metadata();
    const v = { data: 'image/png;base64,' + bytes.toString('base64'), w: meta.width!, h: meta.height!, sha256: sha };
    imgCache.set(slug, v);
    return v;
  };

  /** White plate with the drawing centred inside, aspect kept. */
  const plate = async (s: pptxgen.Slide, slug: string, alt: string, x: number, y: number, w: number, h: number, slideId: string) => {
    const img = await image(slug);
    used.set(slug, [...(used.get(slug) ?? []), slideId]);
    s.addShape(pres.ShapeType.roundRect, {
      x, y, w, h, rectRadius: 0.12,
      fill: { color: C.white }, line: { color: C.hairline, width: 1 }, objectName: 'illustration plate',
    });
    const pad = 0.22;
    const scale = Math.min((w - 2 * pad) / img.w, (h - 2 * pad) / img.h);
    const iw = img.w * scale;
    const ih = img.h * scale;
    s.addImage({ data: img.data, x: x + (w - iw) / 2, y: y + (h - ih) / 2, w: iw, h: ih, altText: alt, objectName: `illustration ${slug}` });
  };

  const chip = (s: pptxgen.Slide, label: string, dark = false) => {
    const w = 0.32 + label.length * 0.115;
    s.addText(label.toUpperCase(), {
      shape: pres.ShapeType.roundRect, rectRadius: 0.08, x: M, y: 0.42, w, h: 0.42,
      fill: { color: dark ? C.yellow : C.teal }, color: dark ? C.forest : C.white,
      fontFace: FONTS.body, fontSize: 14, bold: true, charSpacing: 1.5, align: 'center', valign: 'middle', margin: 0,
      objectName: 'kind label', isTextBox: true,
    });
  };

  const title = (s: pptxgen.Slide, text: string, widthIn: number, dark = false) => {
    const fit = pickSize([text], widthIn, dark ? 2.0 : 1.25, dark ? [44, 40, 36] : [40, 36, 32], { serif: true, bold: true });
    if (!fit.fits) fitWarnings.push(`${text.slice(0, 40)}…: title may not fit`);
    s.addText(text, { placeholder: 'title', fontSize: fit.size });
  };

  /** The model sometimes numbers or dashes its own lines; the deck adds numbers and bullets itself. */
  const clean = (l: string) => l.replace(/^\s*(?:[-–•●*]\s+|step\s*\d{1,2}\s*[:.)-]\s*|\d{1,2}[.)]\s+)/i, '').trim();

  const body = (s: pptxgen.Slide, slideId: string, rawLines: string[], x: number, y: number, w: number, h: number, opts: { numbered?: boolean; bullets?: boolean; color?: string; sizes?: number[] } = {}) => {
    const lines = rawLines.map(clean).filter(Boolean);
    if (!lines.length) return;
    const marker = opts.numbered || opts.bullets !== false;
    const fit = pickSize(lines, w - (marker ? 0.55 : 0.05), h, opts.sizes ?? [32, 30, 28, 26, 24], { paraGap: 12 });
    if (!fit.fits) fitWarnings.push(`${slideId}: body text may overflow at ${fit.size}pt`);
    s.addText(
      lines.flatMap((l, i) => [
        ...(opts.numbered
          ? [{ text: `${i + 1}  `, options: { bold: true, color: C.teal } }]
          : opts.bullets === false
            ? []
            : [{ text: '•  ', options: { bold: true, color: C.teal } }]),
        { text: l, options: { color: opts.color ?? C.forest, breakLine: i < lines.length - 1, paraSpaceAfter: 12 } },
      ]),
      { x, y, w, h, fontFace: FONTS.body, fontSize: fit.size, valign: 'top', margin: 0, isTextBox: true, objectName: 'slide text', fit: 'none' }
    );
  };

  // Cover and day-divider pictures: taken from the explanation slides of that day (a question slide's drawing can
  // give away the answer), never the drawing on the very next slide, and no two dividers or the cover share one.
  const feature = new Map<string, Slide['image']>();
  const taken = new Set<string>();
  const calm = new Set(['concept', 'vocabulary', 'activity', 'summary']);
  for (const [i, s] of pack.slides.entries()) {
    if (s.kind !== 'day') continue;
    const next = pack.slides[i + 1]?.image?.slug;
    const pool = pack.slides.filter((x) => x.day === s.day && x.image && calm.has(x.kind) && x.image.slug !== next);
    const pick = pool.find((x) => !taken.has(x.image!.slug)) ?? null;
    feature.set(s.id, s.image ?? pick?.image ?? null);
    if (pick) taken.add(pick.image!.slug);
  }
  {
    const cover = pack.slides.find((s) => s.kind === 'cover');
    const pool = pack.slides
      .filter((x) => x.image && calm.has(x.kind) && !taken.has(x.image.slug))
      .sort((a, b) => Math.abs(a.day - 3) - Math.abs(b.day - 3));
    if (cover) feature.set(cover.id, cover.image ?? pool[0]?.image ?? null);
  }
  // A drawing is shown at most twice a day (divider included) and never on two slides in a row; a repeat gives the
  // slide the full width instead (G7 T1 W6 showed one litmus drawing on four of six Day 4 slides).
  const timesShown = new Map<string, number>();
  let lastShown: string | null = null;
  const mayShow = (day: number, slug: string | undefined) => Boolean(slug) && slug !== lastShown && (timesShown.get(`${day}:${slug}`) ?? 0) < 2;
  const markShown = (day: number, slug: string | null) => {
    lastShown = slug;
    if (slug) timesShown.set(`${day}:${slug}`, (timesShown.get(`${day}:${slug}`) ?? 0) + 1);
  };
  const sameText = (a: string, b: string) => a.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '') === b.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

  const sectionName = (s: Slide, dayTitle?: string) =>
    s.day === 0
      ? s.kind === 'credits'
        ? pack.language === 'fil' ? 'Tungkol sa deck' : 'About this deck'
        : pack.language === 'fil' ? 'Panimula' : 'Introduction'
      : `${pack.language === 'fil' ? 'Araw' : 'Day'} ${s.day}: ${dayTitle ?? ''}`.slice(0, 60);
  let currentDay = -1;
  for (const [idx, raw] of pack.slides.entries()) {
    // A line that only repeats the title is not shown twice.
    const s = { ...raw, lines: raw.lines.filter((l) => !sameText(l, raw.title)) };
    if (s.day !== currentDay) {
      currentDay = s.day;
      const dayTitle = pack.days.find((d) => d.day === s.day)?.title;
      pres.addSection({ title: sectionName(s, dayTitle) });
    }
    const section = sectionName(s, pack.days.find((d) => d.day === s.day)?.title);

    if (s.kind === 'cover' || s.kind === 'day') {
      const slide = pres.addSlide({ masterName: 'TALA_DARK', sectionTitle: section });
      slide.addImage({ data: glyph.data, x: M, y: 0.45, h: 0.55, w: (glyph.w / glyph.h) * 0.55, altText: 'Hiraia glyph' });
      slide.addImage({ data: wordmark.data, x: M + 0.75, y: 0.5, h: 0.45, w: (wordmark.w / wordmark.h) * 0.45, altText: 'Tala' });
      if (s.kind === 'day') {
        slide.addText(`${L.day} ${s.day}`, { x: M, y: 1.45, w: 4, h: 0.5, fontFace: FONTS.body, fontSize: 22, bold: true, charSpacing: 3, color: C.yellow, margin: 0, isTextBox: true });
      }
      title(slide, s.kind === 'day' ? s.title.replace(/^(Day|Araw)\s*\d+\s*[:—-]\s*/i, '') : s.title, 7.4, true);
      body(slide, s.id, s.lines, M, 4.3, 7.4, 2.2, { bullets: false, color: C.cream, sizes: [28, 26, 24] });
      const pic = feature.get(s.id);
      if (pic) await plate(slide, pic.slug, pic.alt, 8.45, 1.15, 4.28, 5.1, s.id);
      markShown(s.day, pic?.slug ?? null);
      if (s.kind === 'cover' && !approved)
        slide.addText(L.draftBadge, {
          shape: pres.ShapeType.roundRect, rectRadius: 0.08, x: M, y: 6.25, w: 4.6, h: 0.45,
          fill: { color: C.brick }, color: C.cream, fontFace: FONTS.body, fontSize: 16, bold: true, align: 'center', valign: 'middle', margin: 0, isTextBox: true,
        });
      slide.addNotes(s.notes);
      continue;
    }

    const mcq = (s.kind === 'check' && s.choices.length > 0) || (s.kind === 'reveal' && (pack.slides.find((x) => x.id === s.revealOf)?.choices.length ?? 0) > 0);
    const hasImg = Boolean(s.image) && !mcq && s.kind !== 'credits' && mayShow(s.day, s.image?.slug);
    markShown(s.day, hasImg ? s.image!.slug : null);
    const slide = pres.addSlide({ masterName: hasImg ? 'TALA_LIGHT_SPLIT' : 'TALA_LIGHT', sectionTitle: section });
    const exitCheck = s.kind === 'check' && pack.slides[idx + 1]?.kind !== 'reveal';
    const label = exitCheck ? L.chip.exit : L.chip[s.kind];
    if (label) chip(slide, label);
    const textW = hasImg ? 6.95 : W - 2 * M;

    if (s.kind === 'credits') {
      title(slide, s.title, W - 2 * M);
      const refs = pack.guide.sources.map((r) => `${r.refId}: ${r.locator}`);
      const lines = [
        ...s.lines,
        approved ? L.creditsReviewed(review?.teacherReview?.reviewer ?? '—') : L.creditsDraft,
        L.creditsArt,
      ];
      body(slide, s.id, lines, M, 2.35, W - 2 * M, 2.9, { sizes: [22, 20, 18] });
      // Whole references only; the full list is in the teacher guide.
      let sourceLine = `${L.sourcesIntro}: ${refs[0] ?? ''}`;
      for (const r of refs.slice(1)) {
        if (`${sourceLine}; ${r}`.length > 380) {
          sourceLine += '; …';
          break;
        }
        sourceLine += `; ${r}`;
      }
      body(slide, s.id, [sourceLine], M, 5.45, W - 2 * M, 1.0, { bullets: false, sizes: [14, 12], color: C.muted });
      slide.addNotes(s.notes);
      continue;
    }

    title(slide, s.title, textW);

    if (s.kind === 'check' || s.kind === 'reveal') {
      const check = s.kind === 'reveal' ? pack.slides.find((x) => x.id === s.revealOf) : s;
      const choices = check?.choices ?? [];
      if (!choices.length) {
        // Open question (or its answer): the text gets the body area, beside the drawing when there is one.
        body(slide, s.id, s.lines, M, 2.35, textW, 4.4, { bullets: false, sizes: [32, 30, 28, 26, 24] });
        if (hasImg) await plate(slide, s.image!.slug, s.image!.alt, 7.9, 0.95, 4.83, 5.55, s.id);
        slide.addNotes(s.notes);
        continue;
      }
      let y = 2.35;
      if (s.kind === 'check' && s.lines.length) {
        body(slide, s.id, s.lines, M, y, W - 2 * M, 0.95, { bullets: false, sizes: [28, 26, 24] });
        y += 1.05;
      }
      const cols = 2;
      const gap = 0.3;
      const cw = (W - 2 * M - gap) / cols;
      const rows = Math.ceil(choices.length / cols);
      const explain = s.kind === 'reveal' && s.lines.length > 0;
      // Each choice must fit its own box (the old estimate stacked all four in one box and warned on every slide).
      const fitEach = (w: number, h: number, sizes: number[]) => {
        for (const pt of sizes) if (choices.every((c) => estimateHeight([clean(c)], w, pt) <= h - 0.12)) return { size: pt, fits: true };
        return { size: sizes.at(-1)!, fits: false };
      };
      let ch = explain ? 0.85 : Math.min(1.3, (H - 0.75 - y) / rows - 0.15);
      let fit = fitEach(cw - 1.1, ch, explain ? [26, 24, 22] : [30, 28, 26, 24, 22]);
      if (explain) for (const h of [1.0, 1.15, 1.3]) if (!fit.fits) { ch = h; fit = fitEach(cw - 1.1, ch, [26, 24, 22]); }
      const below = y + rows * (ch + 0.15) + 0.15;
      const explanationFits = !explain || pickSize(s.lines.map(clean), W - 2 * M, H - 0.65 - below, [30, 28, 26, 24, 22], { paraGap: 12 }).fits;
      const choiceBox = (i: number, cx: number, cy: number, w: number, h: number, size: number) => {
        const right = s.kind === 'reveal' && s.correctChoice === i;
        const faded = s.kind === 'reveal' && !right;
        slide.addShape(pres.ShapeType.roundRect, {
          x: cx, y: cy, w, h, rectRadius: 0.1,
          fill: { color: right ? C.teal : C.white }, line: { color: right ? C.teal : C.hairline, width: 1.25 }, objectName: `choice ${'ABCD'[i]}`,
        });
        slide.addText('ABCD'[i]!, {
          shape: pres.ShapeType.ellipse, x: cx + 0.18, y: cy + (h - 0.58) / 2, w: 0.58, h: 0.58,
          fill: { color: right ? C.white : faded ? 'E4E9E6' : C.teal }, color: right ? C.teal : faded ? C.faded : C.white,
          fontFace: FONTS.body, fontSize: 22, bold: true, align: 'center', valign: 'middle', margin: 0, isTextBox: true,
        });
        slide.addText(right ? `${clean(choices[i]!)}  ✓` : clean(choices[i]!), {
          x: cx + 0.95, y: cy + 0.04, w: w - 1.1, h: h - 0.08, fontFace: FONTS.body, fontSize: size,
          color: right ? C.white : faded ? C.faded : C.forest, bold: right, valign: 'middle', margin: 0, isTextBox: true, fit: 'none',
        });
      };
      if (s.kind === 'reveal' && s.correctChoice !== null && (!fit.fits || !explanationFits)) {
        // Long answers (Filipino runs longer): the answer slide shows the right choice alone, full width, then why.
        const w = W - 2 * M;
        const one = pickSize([`${clean(choices[s.correctChoice]!)}  ✓`], w - 1.1, 1.2, [30, 28, 26, 24]);
        const h = Math.min(1.5, Math.max(0.9, estimateHeight([`${clean(choices[s.correctChoice]!)}  ✓`], w - 1.1, one.size) + 0.3));
        choiceBox(s.correctChoice, M, y, w, h, one.size);
        const top = y + h + 0.3;
        body(slide, s.id, s.lines, M, top, w, H - 0.65 - top, { bullets: false, sizes: [30, 28, 26, 24, 22] });
        slide.addNotes(s.notes);
        continue;
      }
      if (!fit.fits) fitWarnings.push(`${s.id}: a choice may not fit`);
      choices.forEach((_c, i) => choiceBox(i, M + (i % cols) * (cw + gap), y + Math.floor(i / cols) * (ch + 0.15), cw, ch, fit.size));
      if (explain) body(slide, s.id, s.lines, M, below, W - 2 * M, H - 0.65 - below, { bullets: false, sizes: [30, 28, 26, 24, 22] });
      slide.addNotes(s.notes);
      continue;
    }

    if (s.kind === 'vocabulary') {
      const rows = s.lines.map(clean).map((l) => {
        const m = l.match(/^(.{1,40}?)\s*(?:—|–|-|:)\s+(.*)$/);
        return m ? { term: m[1]!, meaning: m[2]! } : { term: '', meaning: l };
      });
      const fit = pickSize(rows.map((r) => `${r.term} — ${r.meaning}`), textW - 0.2, 4.4, [30, 28, 26, 24], { paraGap: 16 });
      if (!fit.fits) fitWarnings.push(`${s.id}: vocabulary may overflow`);
      slide.addText(
        rows.flatMap((r, i) => [
          ...(r.term ? [{ text: r.term, options: { bold: true, color: C.teal } }, { text: '  —  ', options: { color: C.muted } }] : []),
          { text: r.meaning, options: { color: C.forest, breakLine: i < rows.length - 1, paraSpaceAfter: 16 } },
        ]),
        { x: M, y: 2.35, w: textW, h: 4.4, fontFace: FONTS.body, fontSize: fit.size, valign: 'top', margin: 0, isTextBox: true, objectName: 'vocabulary' }
      );
    } else {
      body(slide, s.id, s.lines, M, 2.35, textW, 4.4, { numbered: s.kind === 'activity' || s.kind === 'summary', bullets: s.kind !== 'question' });
    }
    if (hasImg) await plate(slide, s.image!.slug, s.image!.alt, 7.9, 0.95, 4.83, 5.55, s.id);
    slide.addNotes(s.notes);
    void idx;
  }

  await pres.writeFile({ fileName: outFile });
  await applyThemeColors(outFile);
  return {
    slides: pack.slides.length,
    fitWarnings,
    images: [...used.entries()].map(([slug, slides]) => ({ slug, sha256: imgCache.get(slug)!.sha256, slides })),
  };
}

/** Write the brand palette into the deck theme (pptxgenjs writes Office's default palette). */
async function applyThemeColors(file: string) {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(readFileSync(file));
  const part = 'ppt/theme/theme1.xml';
  const xml = await zip.file(part)!.async('string');
  const slots: Array<[string, string]> = [
    ['dk1', C.forest], ['lt1', C.white], ['dk2', C.teal], ['lt2', C.cream],
    ['accent1', C.teal], ['accent2', C.gold], ['accent3', C.yellow], ['accent4', C.brick], ['accent5', C.sage], ['accent6', C.forest],
    ['hlink', C.teal], ['folHlink', C.forest],
  ];
  const scheme = `<a:clrScheme name="Tala Hiraia">${slots.map(([k, v]) => `<a:${k}><a:srgbClr val="${v}"/></a:${k}>`).join('')}</a:clrScheme>`;
  const out = xml.replace(/<a:clrScheme\b[\s\S]*?<\/a:clrScheme>/, scheme).replace(/(<a:(?:theme|fontScheme)\b[^>]*?\bname=")[^"]*"/g, '$1Tala Hiraia"');
  if (!out.includes(scheme)) throw new Error('theme part has no colour scheme to replace');
  zip.file(part, out);
  // Rebuild without folder entries: decks with them have failed to open or co-edit in cloud drives (Drive, OneDrive),
  // where many teachers will put them. Entry order is kept ([Content_Types].xml first).
  const clean = new JSZip();
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    clean.file(name, await entry.async('nodebuffer'), { createFolders: false, date: new Date('2026-01-01T00:00:00Z') });
  }
  const { writeFileSync } = await import('node:fs');
  writeFileSync(file, await clean.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}
