/**
 * Changing the words of a DrawingML text body (`a:txBody` in a slide, a table cell or a notes page) without
 * disturbing how they look.
 *
 * A teacher edits plain paragraphs. The file holds runs: pieces of a paragraph that each carry their own font,
 * size, colour, bold… Writing a paragraph back as one plain run would flatten that. Instead the new text is
 * compared with the old: what is the same at the start and at the end keeps its runs exactly as they are in the
 * file, and only the part in between is rewritten, in the formatting of the text it continues. Editing one word
 * in a bold sentence leaves a bold sentence; untouched paragraphs are not rewritten at all.
 */
import { NS } from './opc';
import { cleanXmlText, escapeXmlText, kid, trimEndSpaces, type Splice, type XmlDoc, type XmlElement } from './xml';

/**
 * Called with the size of what is about to be written, before it is built. New text is written in the formatting
 * of the text it continues, and that formatting comes from the file: a file may hold megabytes of it, repeated
 * for every line a teacher types. The caller's counter refuses a job that would write too much.
 */
export type Spend = (chars: number) => void;

export interface ParaToken {
  kind: 'run' | 'br';
  /** A run's text; "\n" for a line break. */
  text: string;
  el: XmlElement;
  /** The run properties element (`a:rPr`), when the run or break has one. */
  rPr: XmlElement | null;
}

export interface ParaModel {
  el: XmlElement;
  pPr: XmlElement | null;
  endRPr: XmlElement | null;
  tokens: ParaToken[];
  /** Plain text: runs joined, a line break inside the paragraph as "\n". */
  text: string;
  /** False when the paragraph holds something that is not rewritten: a field (date, slide number), maths, or markup this code does not know. */
  editable: boolean;
}

export function readParagraph(p: XmlElement): ParaModel {
  const model: ParaModel = { el: p, pPr: null, endRPr: null, tokens: [], text: '', editable: true };
  const textIn = (el: XmlElement): string => {
    const t = kid(el, NS.A, 't');
    let text = '';
    if (t) for (const n of t.children) if (n.kind === 'text') text += n.value;
    return text;
  };
  for (const c of p.children) {
    if (c.kind !== 'el') continue;
    if (c.ns !== NS.A) {
      model.editable = false;
      continue;
    }
    if (c.local === 'pPr') model.pPr = c;
    else if (c.local === 'endParaRPr') model.endRPr = c;
    else if (c.local === 'r') {
      const text = textIn(c);
      model.tokens.push({ kind: 'run', text, el: c, rPr: kid(c, NS.A, 'rPr') });
      model.text += text;
    } else if (c.local === 'br') {
      model.tokens.push({ kind: 'br', text: '\n', el: c, rPr: kid(c, NS.A, 'rPr') });
      model.text += '\n';
    } else {
      // a:fld (a field whose text PowerPoint recomputes) and anything newer than this code: shown, not rewritten.
      model.editable = false;
      if (c.local === 'fld') model.text += textIn(c);
    }
  }
  return model;
}

/** The paragraphs of a text body, in order. */
export function readTextBody(txBody: XmlElement): ParaModel[] {
  const out: ParaModel[] = [];
  for (const c of txBody.children) if (c.kind === 'el' && c.ns === NS.A && c.local === 'p') out.push(readParagraph(c));
  return out;
}

/** What a teacher may type into one paragraph: no carriage returns, nothing XML cannot carry. */
export function tidyParagraphText(text: string): string {
  return cleanXmlText(text.replace(/\r\n?/g, '\n'));
}

const isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff;
const isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff;

/** Lengths of the common start and end of two strings, never cutting a surrogate pair in half. */
export function commonEnds(a: string, b: string): { prefix: number; suffix: number } {
  const max = Math.min(a.length, b.length);
  let prefix = 0;
  while (prefix < max && a.charCodeAt(prefix) === b.charCodeAt(prefix)) prefix++;
  if (prefix > 0 && isHigh(a.charCodeAt(prefix - 1))) prefix--;
  let suffix = 0;
  while (suffix < max - prefix && a.charCodeAt(a.length - 1 - suffix) === b.charCodeAt(b.length - 1 - suffix)) suffix++;
  if (suffix > 0 && isLow(a.charCodeAt(a.length - suffix))) suffix--;
  return { prefix, suffix };
}

interface Piece {
  kind: 'run' | 'br';
  text: string;
  /** Source of the run properties to write (`<a:rPr …/>`), or '' for none. */
  rPr: string;
  /** The original token, when this piece is that token unchanged (written back verbatim). */
  from: ParaToken | null;
}

/** An element's source under another tag name (`a:endParaRPr` → `a:rPr`): same attributes and children. */
function renamed(doc: XmlDoc, el: XmlElement, local: string): string {
  const name = el.prefix ? `${el.prefix}:${local}` : local;
  const afterName = el.start + 1 + el.name.length;
  if (el.selfClosing) return `<${name}${doc.source.slice(afterName, el.end)}`;
  return `<${name}${doc.source.slice(afterName, el.closeStart)}</${name}>`;
}

const src = (doc: XmlDoc, el: XmlElement | null): string => (el ? doc.source.slice(el.start, el.end) : '');

function pieceXml(doc: XmlDoc, piece: Piece, prefix: string): string {
  if (piece.from) return src(doc, piece.from.el);
  const q = (local: string) => (prefix ? `${prefix}:${local}` : local);
  if (piece.kind === 'br') return piece.rPr ? `<${q('br')}>${piece.rPr}</${q('br')}>` : `<${q('br')}/>`;
  return `<${q('r')}>${piece.rPr}<${q('t')}>${escapeXmlText(piece.text)}</${q('t')}></${q('r')}>`;
}

/**
 * The paragraph's children after its text became `next`: unchanged tokens verbatim, the changed stretch as new
 * runs in the formatting of the text it continues.
 */
function retext(doc: XmlDoc, para: ParaModel, next: string): Piece[] {
  const tokens = para.tokens;
  const current = para.text;
  const { prefix, suffix } = commonEnds(current, next);
  const cutEnd = current.length - suffix;
  // The formatting new text takes: that of the character just before it, else of the first run, else the
  // paragraph's own end-of-paragraph properties (an empty placeholder has only those).
  let carrier: ParaToken | null = null;
  let at = 0;
  if (prefix > 0) {
    let runBefore: ParaToken | null = null;
    for (const t of tokens) {
      const end = at + t.text.length;
      if (t.kind === 'run') runBefore = t;
      if (prefix - 1 >= at && prefix - 1 < end) {
        // After a line break, new text continues the run before the break.
        carrier = runBefore;
        break;
      }
      at = end;
    }
  }
  carrier ??= tokens.find((t) => t.kind === 'run') ?? null;
  const carrierRPr = carrier ? src(doc, carrier.rPr) : para.endRPr ? renamed(doc, para.endRPr, 'rPr') : '';

  const inserted: Piece[] = [];
  next
    .slice(prefix, next.length - suffix)
    .split('\n')
    .forEach((segment, i) => {
      if (i > 0) inserted.push({ kind: 'br', text: '\n', rPr: carrierRPr, from: null });
      if (segment) inserted.push({ kind: 'run', text: segment, rPr: carrierRPr, from: null });
    });

  const out: Piece[] = [];
  let placed = false;
  const place = () => {
    if (!placed) out.push(...inserted);
    placed = true;
  };
  at = 0;
  for (const t of tokens) {
    const a = at;
    const b = at + t.text.length;
    at = b;
    if (b <= prefix) {
      out.push({ kind: t.kind, text: t.text, rPr: src(doc, t.rPr), from: t });
      continue;
    }
    if (a >= cutEnd) {
      place();
      out.push({ kind: t.kind, text: t.text, rPr: src(doc, t.rPr), from: t });
      continue;
    }
    // The token reaches into the stretch that changed: keep what lies before and after it.
    if (t.kind === 'run' && a < prefix) out.push({ kind: 'run', text: t.text.slice(0, prefix - a), rPr: src(doc, t.rPr), from: null });
    place();
    if (t.kind === 'run' && b > cutEnd) out.push({ kind: 'run', text: t.text.slice(cutEnd - a), rPr: src(doc, t.rPr), from: null });
  }
  place();

  // Join neighbouring runs of the same formatting when one of them is new, so typing in a run leaves one run.
  const merged: Piece[] = [];
  for (const piece of out) {
    const last = merged[merged.length - 1];
    if (last && last.kind === 'run' && piece.kind === 'run' && last.rPr === piece.rPr && (!last.from || !piece.from)) {
      merged[merged.length - 1] = { kind: 'run', text: last.text + piece.text, rPr: last.rPr, from: null };
    } else merged.push(piece);
  }
  return merged.filter((x) => x.kind === 'br' || x.text !== '' || x.from);
}

/** The whole paragraph element rewritten for new text. Everything outside its runs is copied from the file. */
export function paragraphXml(doc: XmlDoc, para: ParaModel, next: string, spend?: Spend): string {
  const el = para.el;
  const prefix = el.prefix;
  const open = el.selfClosing ? `${trimEndSpaces(doc.source.slice(el.start, el.end - 2))}>` : doc.source.slice(el.start, el.openEnd);
  const pieces = retext(doc, para, next);
  // What this paragraph will be, counted before it is built.
  let size = el.end - el.start + 64;
  for (const x of pieces) size += x.from ? x.from.el.end - x.from.el.start : x.rPr.length + x.text.length + 2 * prefix.length + 32;
  spend?.(size);
  let end = src(doc, para.endRPr);
  // A paragraph emptied of its words keeps the size and font it had, the way PowerPoint leaves it.
  if (!end && next === '' && para.tokens.length) {
    const first = para.tokens.find((t) => t.kind === 'run' && t.rPr);
    if (first?.rPr) end = renamed(doc, first.rPr, 'endParaRPr');
  }
  return `${open}${src(doc, para.pPr)}${pieces.map((x) => pieceXml(doc, x, prefix)).join('')}${end}</${el.name}>`;
}

/** A new paragraph that looks like `like`: its paragraph properties and the formatting of its first run. */
export function paragraphLikeXml(doc: XmlDoc, like: ParaModel, text: string, spend?: Spend): string {
  const el = like.el;
  const q = (local: string) => (el.prefix ? `${el.prefix}:${local}` : local);
  const open = el.selfClosing ? `${trimEndSpaces(doc.source.slice(el.start, el.end - 2))}>` : doc.source.slice(el.start, el.openEnd);
  const first = like.tokens.find((t) => t.kind === 'run');
  const rPr = first ? src(doc, first.rPr) : like.endRPr ? renamed(doc, like.endRPr, 'rPr') : '';
  let lines = 1;
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) lines++;
  spend?.(open.length + (like.pPr ? like.pPr.end - like.pPr.start : 0) + text.length + 2 * lines * (rPr.length + 2 * el.prefix.length + 32) + 64);
  let body = '';
  text.split('\n').forEach((segment, i) => {
    if (i > 0) body += rPr ? `<${q('br')}>${rPr}</${q('br')}>` : `<${q('br')}/>`;
    if (segment) body += `<${q('r')}>${rPr}<${q('t')}>${escapeXmlText(segment)}</${q('t')}></${q('r')}>`;
  });
  // An added paragraph with no words yet keeps the size of the one it is modelled on.
  const end = src(doc, like.endRPr) || (!text && first?.rPr ? renamed(doc, first.rPr, 'endParaRPr') : '');
  return `${open}${src(doc, like.pPr)}${body}${end}</${el.name}>`;
}

export type ParagraphOp =
  | { kind: 'keep'; from: number }
  | { kind: 'edit'; from: number; text: string }
  /** A new paragraph, formatted like original paragraph `like`. */
  | { kind: 'add'; like: number; text: string };

/**
 * Line up the paragraphs a teacher left with the ones in the file. Paragraphs equal at the start and at the end
 * are kept; in between, paragraphs are matched in order (their words changed), extra new ones are added after the
 * last matched one, extra old ones go. Adding a bullet in the middle of a list therefore touches nothing else.
 */
export function alignParagraphs(original: string[], next: string[]): ParagraphOp[] {
  const want = next.length ? next : [''];
  const n = original.length;
  const m = want.length;
  let head = 0;
  while (head < n && head < m && original[head] === want[head]) head++;
  let tail = 0;
  while (tail < n - head && tail < m - head && original[n - 1 - tail] === want[m - 1 - tail]) tail++;
  const ops: ParagraphOp[] = [];
  for (let i = 0; i < head; i++) ops.push({ kind: 'keep', from: i });
  const oldMid = n - head - tail;
  const newMid = m - head - tail;
  const paired = Math.min(oldMid, newMid);
  for (let j = 0; j < paired; j++) ops.push({ kind: 'edit', from: head + j, text: want[head + j]! });
  const like = paired > 0 ? head + paired - 1 : head > 0 ? head - 1 : Math.min(head, n - 1);
  for (let j = paired; j < newMid; j++) ops.push({ kind: 'add', like, text: want[head + j]! });
  for (let i = n - tail; i < n; i++) ops.push({ kind: 'keep', from: i });
  return ops;
}

/**
 * The splices that make a text body read `next` (one string per paragraph). Returns an empty list when nothing
 * changes. Throws when the body holds a paragraph that cannot be rewritten: the caller offers such a body
 * read-only.
 */
export function textBodySplices(doc: XmlDoc, txBody: XmlElement, next: string[], spend?: Spend): Splice[] {
  const paras = readTextBody(txBody);
  if (!paras.length) throw new Error('A text body has no paragraphs.');
  if (paras.some((p) => !p.editable)) throw new Error('This text cannot be edited.');
  const want = next.map(tidyParagraphText);
  const ops = alignParagraphs(paras.map((p) => p.text), want);
  const splices: Splice[] = [];
  const used = new Set<number>();
  // New paragraphs go right after the last original paragraph placed before them (or before the first one).
  let cursor = paras[0]!.el.start;
  for (const op of ops) {
    if (op.kind === 'add') {
      splices.push({ start: cursor, end: cursor, text: paragraphLikeXml(doc, paras[op.like]!, op.text, spend) });
      continue;
    }
    const para = paras[op.from]!;
    used.add(op.from);
    if (op.kind === 'edit' && op.text !== para.text) splices.push({ start: para.el.start, end: para.el.end, text: paragraphXml(doc, para, op.text, spend) });
    cursor = para.el.end;
  }
  paras.forEach((para, i) => {
    if (!used.has(i)) splices.push({ start: para.el.start, end: para.el.end, text: '' });
  });
  return splices;
}

/** A text body's paragraphs as plain strings, and whether a teacher may change them. */
export function textBodyText(txBody: XmlElement): { paragraphs: string[]; editable: boolean } {
  const paras = readTextBody(txBody);
  return { paragraphs: paras.map((p) => p.text), editable: paras.length > 0 && paras.every((p) => p.editable) };
}
