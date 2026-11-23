/**
 * One layout for a classroom deck, two back-ends. `layoutDeck` turns slides into a display list (boxes in inches on
 * a 13.333 × 7.5 in 16:9 slide); the web app draws that list as HTML (viewer, editor, presenter) and the server
 * writes the same list as editable PowerPoint shapes. What a teacher sees is what the teacher downloads.
 *
 * The rules are a port of the pack renderer (packages/tala-packs/src/render/pptx.ts): same positions, sizes,
 * colours, fonts, fitting and picture rules, so a copy of a pack looks like the pack.
 */
import type { PackLang, SlideKind } from '../contracts/packs';
import { cleanLine, estimateHeight, pickSize, sameText, stripDayPrefix } from './fit';
import { DECK_LABELS } from './labels';

/** Hex colours without '#', as PowerPoint writes them. Same palette as the pack renderer (tokens.ts + neutrals). */
export const DECK_COLORS = {
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
  fadedFill: 'E4E9E6',
  darkFooter: 'C9D3C2',
} as const;
const C = DECK_COLORS;

/** Office-safe fonts, so a downloaded deck looks the same offline on any school laptop. */
export const DECK_FONTS = { head: 'Cambria', body: 'Calibri' } as const;

export const SLIDE_W = 13.333;
export const SLIDE_H = 7.5;
const W = SLIDE_W;
const H = SLIDE_H;
const M = 0.6;

export interface LayoutSlideInput {
  id: string;
  day: number;
  kind: SlideKind;
  title: string;
  lines: string[];
  choices: string[];
  revealOf: string | null;
  correctChoice: number | null;
  image: { slug: string; alt: string } | null;
  notes: string;
}

export interface DeckLayoutInput {
  language: PackLang;
  grade: string;
  term: number;
  week: number;
  /** The content was approved by a named teacher. When false the cover carries the draft badge. */
  approved: boolean;
  reviewer: string | null;
  /** "Sources in the teacher guide: …" printed small on the credits slide; empty for none. */
  sourcesLine: string;
  /** A teacher's own copy that differs from the original: the credits say the edits were not checked. */
  personalCopy: boolean;
  slides: LayoutSlideInput[];
  /** Day titles for section names, when known. */
  dayTitles?: Record<number, string>;
  /** Editor view: keep a slide's empty text box, so a teacher has somewhere to type. */
  editing?: boolean;
}

export type EditField = { type: 'title' } | { type: 'lines' } | { type: 'choice'; index: number };

export interface TextRun {
  text: string;
  bold?: boolean;
  color?: string;
}
export interface Paragraph {
  runs: TextRun[];
  /** Native list marker. */
  list: 'bullet' | 'number' | null;
  /** Space after the paragraph, points. */
  spaceAfter: number;
}
export interface BoxShape {
  kind: 'roundRect' | 'ellipse';
  /** Corner radius in inches (roundRect). */
  radius: number;
  fill: string | null;
  line: { color: string; width: number } | null;
}
interface Box {
  /** Object name, as PowerPoint's selection pane shows it. */
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface TextItem extends Box {
  type: 'text';
  paragraphs: Paragraph[];
  font: 'head' | 'body';
  /** Points. */
  size: number;
  color: string;
  bold: boolean;
  align: 'left' | 'center' | 'right';
  valign: 'top' | 'middle';
  /** Letter spacing in points. */
  spacing: number;
  /** Inner padding in points: left, right, bottom, top. */
  margin: [number, number, number, number];
  shape: BoxShape | null;
  /** The layout's title placeholder (so PowerPoint outlines and screen readers know the slide title). */
  titlePlaceholder: boolean;
  /** Which part of the slide's data this box shows, when a teacher can type into it. */
  field: EditField | null;
  /** How many leading paragraphs come from the editable field (the credits slide appends fixed lines). */
  editableParagraphs: number;
}
export interface ShapeItem extends Box {
  type: 'shape';
  shape: BoxShape;
}
export interface ImageItem extends Box {
  type: 'image';
  /** `drawing`: the box is the area to fit the picture into (aspect kept, centred). `brand`: exact box. */
  source: { kind: 'drawing'; slug: string } | { kind: 'brand'; mark: 'glyph' | 'wordmark' };
  alt: string;
}
export type LayoutItem = TextItem | ShapeItem | ImageItem;

export interface SlideLayout {
  id: string;
  index: number;
  day: number;
  kind: SlideKind;
  master: 'light' | 'lightSplit' | 'dark';
  background: string;
  footer: { text: string; color: string };
  numberColor: string;
  /** Kind label shown on the chip (also the slide's badge in lists); null for cover, day and credits slides. */
  label: string | null;
  section: string;
  items: LayoutItem[];
  notes: string;
  /** Text may not fit at the smallest size: worth a "this is a lot for one slide" hint. */
  crowded: boolean;
  /** Slug of the drawing this slide shows, if any. */
  picture: string | null;
}

const para = (text: string, list: Paragraph['list'], spaceAfter: number, color?: string): Paragraph => ({ runs: [{ text, ...(color ? { color } : {}) }], list, spaceAfter });

const textItem = (p: Partial<TextItem> & Pick<TextItem, 'name' | 'x' | 'y' | 'w' | 'h' | 'paragraphs' | 'size'>): TextItem => ({
  type: 'text',
  font: 'body',
  color: C.forest,
  bold: false,
  align: 'left',
  valign: 'top',
  spacing: 0,
  margin: [0, 0, 0, 0],
  shape: null,
  titlePlaceholder: false,
  field: null,
  editableParagraphs: 0,
  ...p,
});

/**
 * Cover and day-divider pictures come from that day's explanation slides (a question slide's drawing can give away
 * the answer), never the drawing on the very next slide, and no two dividers or the cover share one.
 */
function featurePictures(slides: LayoutSlideInput[]): Map<string, LayoutSlideInput['image']> {
  const feature = new Map<string, LayoutSlideInput['image']>();
  const taken = new Set<string>();
  const calm = new Set<SlideKind>(['concept', 'vocabulary', 'activity', 'summary']);
  for (const [i, s] of slides.entries()) {
    if (s.kind !== 'day') continue;
    const next = slides[i + 1]?.image?.slug;
    const pool = slides.filter((x) => x.day === s.day && x.image && calm.has(x.kind) && x.image.slug !== next);
    const pick = pool.find((x) => !taken.has(x.image!.slug)) ?? null;
    feature.set(s.id, s.image ?? pick?.image ?? null);
    if (pick) taken.add(pick.image!.slug);
  }
  const cover = slides.find((s) => s.kind === 'cover');
  if (cover) {
    const pool = slides.filter((x) => x.image && calm.has(x.kind) && !taken.has(x.image.slug)).sort((a, b) => Math.abs(a.day - 3) - Math.abs(b.day - 3));
    feature.set(cover.id, cover.image ?? pool[0]?.image ?? null);
  }
  return feature;
}

export function layoutDeck(input: DeckLayoutInput): SlideLayout[] {
  const L = DECK_LABELS[input.language];
  const footer = L.footer(input.grade, input.term, input.week);
  const feature = featurePictures(input.slides);
  // A drawing is shown at most twice a day (divider included) and never on two slides in a row.
  const timesShown = new Map<string, number>();
  let lastShown: string | null = null;
  const mayShow = (day: number, slug: string | undefined) => Boolean(slug) && slug !== lastShown && (timesShown.get(`${day}:${slug}`) ?? 0) < 2;
  const markShown = (day: number, slug: string | null) => {
    lastShown = slug;
    if (slug) timesShown.set(`${day}:${slug}`, (timesShown.get(`${day}:${slug}`) ?? 0) + 1);
  };
  const sectionName = (s: LayoutSlideInput) =>
    s.day === 0 ? (s.kind === 'credits' ? L.sectionAbout : L.sectionIntro) : `${L.sectionDay} ${s.day}${input.dayTitles?.[s.day] ? `: ${input.dayTitles[s.day]}` : ''}`.slice(0, 60);

  const out: SlideLayout[] = [];
  for (const [idx, raw] of input.slides.entries()) {
    // A line that only repeats the title is not shown twice.
    const s = { ...raw, lines: raw.lines.filter((l) => !sameText(l, raw.title)) };
    const items: LayoutItem[] = [];
    let crowded = false;
    let picture: string | null = null;

    const plate = (slug: string, alt: string, x: number, y: number, w: number, h: number) => {
      items.push({ type: 'shape', name: 'illustration plate', x, y, w, h, shape: { kind: 'roundRect', radius: 0.12, fill: C.white, line: { color: C.hairline, width: 1 } } });
      const pad = 0.22;
      items.push({ type: 'image', name: `illustration ${slug}`, x: x + pad, y: y + pad, w: w - 2 * pad, h: h - 2 * pad, source: { kind: 'drawing', slug }, alt });
      picture = slug;
    };
    /**
     * The slide title. A pack's own titles fit their box; a teacher's can be longer, so smaller sizes are tried
     * and, if it still runs over, the result says by how much (inches) so the text below moves down instead of
     * sitting under the title.
     */
    const title = (text: string, widthIn: number, dark = false): number => {
      const box = dark ? 2.0 : 1.25;
      const how = { serif: true, bold: true };
      let fit = pickSize([text], widthIn, box, dark ? [44, 40, 36] : [40, 36, 32], how);
      let over = 0;
      if (!fit.fits) {
        crowded = true;
        fit = pickSize([text], widthIn, box, dark ? [32, 28] : [28, 24], how);
        if (!fit.fits) over = Math.max(0, estimateHeight([text], widthIn, fit.size, how) - box);
      }
      items.push(
        textItem({
          name: 'title', x: M, y: dark ? 2.05 : 1.0, w: widthIn, h: box + over, font: 'head', bold: true, size: fit.size,
          color: dark ? C.cream : C.forest, paragraphs: [para(text, null, 0)], titlePlaceholder: true, field: { type: 'title' }, editableParagraphs: 1,
        })
      );
      return over;
    };
    /** `field: false` = fixed words (not the slide's own lines); a number = only that many leading lines are the slide's. */
    const body = (
      rawLines: string[], x: number, y: number, w: number, h: number,
      opts: { numbered?: boolean; bullets?: boolean; color?: string; sizes?: number[]; field?: number | false; name?: string } = {}
    ) => {
      const lines = rawLines.map(cleanLine).filter(Boolean);
      const isField = opts.field !== false;
      // Nothing to draw. While editing, the slide's own (empty) text box is kept so there is somewhere to type.
      if (!lines.length && !(isField && input.editing)) return;
      const marker = opts.numbered || opts.bullets !== false;
      const fit = pickSize(lines.length ? lines : [''], w - (marker ? 0.55 : 0.05), h, opts.sizes ?? [32, 30, 28, 26, 24], { paraGap: 12 });
      if (!fit.fits) crowded = true;
      const list: Paragraph['list'] = opts.numbered ? 'number' : opts.bullets === false ? null : 'bullet';
      items.push(
        textItem({
          name: opts.name ?? 'slide text', x, y, w, h, size: fit.size, color: opts.color ?? C.forest,
          paragraphs: lines.map((l) => para(l, list, 12)),
          field: isField ? { type: 'lines' } : null,
          editableParagraphs: isField ? Math.min(typeof opts.field === 'number' ? opts.field : lines.length, lines.length) : 0,
        })
      );
    };

    if (s.kind === 'cover' || s.kind === 'day') {
      items.push({ type: 'image', name: 'Hiraia glyph', x: M, y: 0.45, w: 0.55, h: 0.55, source: { kind: 'brand', mark: 'glyph' }, alt: 'Hiraia glyph' });
      items.push({ type: 'image', name: 'Tala', x: M + 0.75, y: 0.5, w: (394 / 160) * 0.45, h: 0.45, source: { kind: 'brand', mark: 'wordmark' }, alt: 'Tala' });
      if (s.kind === 'day')
        // Middle-anchored, as the pack renderer draws it (pptxgenjs centres a text box unless told otherwise).
        items.push(textItem({ name: 'day label', x: M, y: 1.45, w: 4, h: 0.5, size: 22, bold: true, spacing: 3, color: C.yellow, valign: 'middle', paragraphs: [para(`${L.day} ${s.day}`, null, 0)] }));
      const down = Math.min(1.2, title(s.kind === 'day' ? stripDayPrefix(s.title) : s.title, 7.4, true));
      body(s.lines, M, 4.3 + down, 7.4, 2.2 - down, { bullets: false, color: C.cream, sizes: [28, 26, 24] });
      const pic = feature.get(s.id);
      if (pic) plate(pic.slug, pic.alt, 8.45, 1.15, 4.28, 5.1);
      markShown(s.day, pic?.slug ?? null);
      if (s.kind === 'cover' && !input.approved)
        items.push(
          textItem({
            name: 'draft label', x: M, y: 6.25, w: 4.6, h: 0.45, size: 16, bold: true, color: C.cream, align: 'center', valign: 'middle',
            shape: { kind: 'roundRect', radius: 0.08, fill: C.brick, line: null }, paragraphs: [para(L.draftBadge, null, 0)],
          })
        );
      out.push({
        id: s.id, index: idx, day: s.day, kind: s.kind, master: 'dark', background: C.forest, footer: { text: footer, color: C.darkFooter }, numberColor: C.darkFooter,
        label: null, section: sectionName(s), items, notes: s.notes, crowded, picture,
      });
      continue;
    }

    // A question slide may offer choices too (a quick poll with no answer slide): drawn like a check, nothing marked.
    const check = s.kind === 'reveal' ? input.slides.find((x) => x.id === s.revealOf) : s;
    const choices = s.kind === 'check' || s.kind === 'question' || s.kind === 'reveal' ? (check?.choices ?? []) : [];
    const mcq = choices.length > 0;
    const hasImg = Boolean(s.image) && !mcq && s.kind !== 'credits' && mayShow(s.day, s.image?.slug);
    markShown(s.day, hasImg ? s.image!.slug : null);
    const exitCheck = s.kind === 'check' && input.slides[idx + 1]?.kind !== 'reveal';
    const label = (exitCheck ? L.chip.exit : L.chip[s.kind]) ?? null;
    if (label)
      items.push(
        textItem({
          name: 'kind label', x: M, y: 0.42, w: 0.32 + label.length * 0.115, h: 0.42, size: 14, bold: true, spacing: 1.5, color: C.white, align: 'center', valign: 'middle',
          shape: { kind: 'roundRect', radius: 0.08, fill: C.teal, line: null }, paragraphs: [para(label.toUpperCase(), null, 0)],
        })
      );
    const textW = hasImg ? 6.95 : W - 2 * M;
    const done = () =>
      out.push({
        id: s.id, index: idx, day: s.day, kind: s.kind, master: hasImg ? 'lightSplit' : 'light', background: C.cream, footer: { text: footer, color: C.muted }, numberColor: C.muted,
        label, section: sectionName(s), items, notes: s.notes, crowded, picture,
      });

    if (s.kind === 'credits') {
      const down = Math.min(1.5, title(s.title, W - 2 * M));
      const fixed = [
        input.approved ? L.creditsReviewed(input.reviewer ?? '—') : L.creditsDraft,
        ...(input.personalCopy ? [L.creditsEdited] : []),
        L.creditsArt,
      ];
      const own = s.lines.map(cleanLine).filter(Boolean);
      body([...own, ...fixed], M, 2.35 + down, W - 2 * M, 2.9 - down, { sizes: [22, 20, 18], field: own.length });
      if (input.sourcesLine) body([input.sourcesLine], M, 5.45, W - 2 * M, 1.0, { bullets: false, sizes: [14, 12], color: C.muted, field: false, name: 'sources' });
      done();
      continue;
    }

    // A long title pushes what is under it down (never more than leaves room for a few lines).
    const down = Math.min(2.2, title(s.title, textW));
    const top = 2.35 + down;
    const room = 4.4 - down;

    if (s.kind === 'check' || s.kind === 'reveal' || (s.kind === 'question' && mcq)) {
      if (!mcq) {
        // Open question (or its answer): the text gets the body area, beside the drawing when there is one.
        body(s.lines, M, top, textW, room, { bullets: false, sizes: [32, 30, 28, 26, 24] });
        if (hasImg) plate(s.image!.slug, s.image!.alt, 7.9, 0.95, 4.83, 5.55);
        done();
        continue;
      }
      const cols = 2;
      const rows = Math.ceil(choices.length / cols);
      let y = top;
      if ((s.kind === 'check' || s.kind === 'question') && s.lines.length) {
        // The question gets the height its words need at the smallest size (as the pack renderer does since the
        // Filipino revision, 21 Nov 2026), never less than before and never so much that a choice row has under an inch.
        const width = W - 2 * M;
        const minimumSize = 24;
        const measured = estimateHeight(s.lines.map(cleanLine).filter(Boolean), width - 0.05, minimumSize, { paraGap: 12 });
        const available = H - 0.75 - y - 0.1 - rows * 1.15;
        const height = Math.min(available, Math.max(0.95, measured + 0.02));
        body(s.lines, M, y, width, height, { bullets: false, sizes: [28, 26, minimumSize] });
        y += height + 0.1;
      }
      const gap = 0.3;
      const cw = (W - 2 * M - gap) / cols;
      const explain = s.kind === 'reveal' && s.lines.length > 0;
      // Each choice must fit its own box.
      const fitEach = (w: number, h: number, sizes: number[]) => {
        for (const pt of sizes) if (choices.every((c) => estimateHeight([cleanLine(c)], w, pt) <= h - 0.12)) return { size: pt, fits: true };
        return { size: sizes[sizes.length - 1]!, fits: false };
      };
      let ch = explain ? 0.85 : Math.min(1.3, (H - 0.75 - y) / rows - 0.15);
      let fit = fitEach(cw - 1.1, ch, explain ? [26, 24, 22] : [30, 28, 26, 24, 22]);
      if (explain)
        for (const h of [1.0, 1.15, 1.3])
          if (!fit.fits) {
            ch = h;
            fit = fitEach(cw - 1.1, ch, [26, 24, 22]);
          }
      const below = y + rows * (ch + 0.15) + 0.15;
      const explanationFits = !explain || pickSize(s.lines.map(cleanLine), W - 2 * M, H - 0.65 - below, [30, 28, 26, 24, 22], { paraGap: 12 }).fits;
      // One editable shape per choice (box and its words together), with the letter badge on top.
      const choiceBox = (i: number, cx: number, cy: number, w: number, h: number, size: number) => {
        const right = s.kind === 'reveal' && s.correctChoice === i;
        const faded = s.kind === 'reveal' && !right;
        items.push(
          textItem({
            name: `choice ${'ABCD'[i]}`, x: cx, y: cy, w, h, size, bold: right, color: right ? C.white : faded ? C.faded : C.forest, valign: 'middle', margin: [68, 8, 3, 3],
            shape: { kind: 'roundRect', radius: 0.1, fill: right ? C.teal : C.white, line: { color: right ? C.teal : C.hairline, width: 1.25 } },
            paragraphs: [para(right ? `${cleanLine(choices[i]!)}  ✓` : cleanLine(choices[i]!), null, 0)],
            // On an answer slide the choices belong to the question slide; they are edited there.
            field: s.kind === 'reveal' ? null : { type: 'choice', index: i }, editableParagraphs: s.kind === 'reveal' ? 0 : 1,
          })
        );
        items.push(
          textItem({
            name: `choice letter ${'ABCD'[i]}`, x: cx + 0.18, y: cy + (h - 0.58) / 2, w: 0.58, h: 0.58, size: 22, bold: true, align: 'center', valign: 'middle',
            color: right ? C.teal : faded ? C.faded : C.white, shape: { kind: 'ellipse', radius: 0, fill: right ? C.white : faded ? C.fadedFill : C.teal, line: null },
            paragraphs: [para('ABCD'[i]!, null, 0)],
          })
        );
      };
      if (s.kind === 'reveal' && s.correctChoice !== null && choices[s.correctChoice] !== undefined && (!fit.fits || !explanationFits)) {
        // Long answers (Filipino runs longer): the answer slide shows the right choice alone, full width, then why.
        const w = W - 2 * M;
        const text = `${cleanLine(choices[s.correctChoice]!)}  ✓`;
        const one = pickSize([text], w - 1.1, 1.2, [30, 28, 26, 24]);
        const h = Math.min(1.5, Math.max(0.9, estimateHeight([text], w - 1.1, one.size) + 0.3));
        choiceBox(s.correctChoice, M, y, w, h, one.size);
        const top = y + h + 0.3;
        body(s.lines, M, top, w, H - 0.65 - top, { bullets: false, sizes: [30, 28, 26, 24, 22] });
        done();
        continue;
      }
      if (!fit.fits) crowded = true;
      choices.forEach((_c, i) => choiceBox(i, M + (i % cols) * (cw + gap), y + Math.floor(i / cols) * (ch + 0.15), cw, ch, fit.size));
      if (explain) body(s.lines, M, below, W - 2 * M, H - 0.65 - below, { bullets: false, sizes: [30, 28, 26, 24, 22] });
      done();
      continue;
    }

    if (s.kind === 'vocabulary') {
      const rows = s.lines.map(cleanLine).filter(Boolean).map((l) => {
        const m = l.match(/^(.{1,40}?)\s*(?:—|–|-|:)\s+(.*)$/);
        return m ? { term: m[1]!, meaning: m[2]! } : { term: '', meaning: l };
      });
      const fit = pickSize(rows.length ? rows.map((r) => `${r.term} — ${r.meaning}`) : [''], textW - 0.2, room, [30, 28, 26, 24], { paraGap: 16 });
      if (!fit.fits) crowded = true;
      items.push(
        textItem({
          name: 'vocabulary', x: M, y: top, w: textW, h: room, size: fit.size,
          paragraphs: rows.map((r) => ({
            runs: [...(r.term ? [{ text: r.term, bold: true, color: C.teal }, { text: '  —  ', color: C.muted }] : []), { text: r.meaning, color: C.forest }],
            list: null, spaceAfter: 16,
          })),
          field: { type: 'lines' }, editableParagraphs: rows.length,
        })
      );
    } else {
      body(s.lines, M, top, textW, room, { numbered: s.kind === 'activity' || s.kind === 'summary', bullets: s.kind !== 'question' });
    }
    if (hasImg) plate(s.image!.slug, s.image!.alt, 7.9, 0.95, 4.83, 5.55);
    done();
  }
  return out;
}
