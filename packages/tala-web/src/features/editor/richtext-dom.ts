/**
 * Simple formatted text (PLAN-2) ↔ DOM. The contenteditable produces arbitrary HTML; this parser reduces it to
 * the contract's Block model: paragraphs, bulleted and numbered lists, bold and italic. Everything else
 * (colours, fonts, headings, tables, images) is dropped on the way in, which is also the sanitiser.
 * Works on a minimal node shape so it can be unit-tested without a DOM.
 */
import type { Block, RichText, Span } from '@hiraia/tala-core/contracts';

export interface MiniNode {
  nodeType: number;
  nodeName: string;
  nodeValue: string | null;
  childNodes: ArrayLike<MiniNode>;
}

const TEXT = 3;
const ELEMENT = 1;
const BLOCK_TAGS = new Set([
  'P',
  'DIV',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'BLOCKQUOTE',
  'PRE',
  'SECTION',
  'ARTICLE',
  'TABLE',
  'TR',
  'TD',
  'TH',
]);

interface Fmt {
  b: boolean;
  i: boolean;
}

function pushSpan(target: Span[], text: string, fmt: Fmt) {
  if (!text) return;
  const last = target[target.length - 1];
  if (last && !!last.b === fmt.b && !!last.i === fmt.i) {
    last.text += text;
    return;
  }
  const span: Span = { text };
  if (fmt.b) span.b = true;
  if (fmt.i) span.i = true;
  target.push(span);
}

function spansEmpty(spans: Span[]): boolean {
  return spans.every((s) => !s.text.replace(/ /g, ' ').trim());
}

function normalise(spans: Span[]): Span[] {
  return spans
    .map((s) => ({ ...s, text: s.text.replace(/ /g, ' ').replace(/[ \t]+/g, ' ') }))
    .filter((s) => s.text.length);
}

export function domToRichText(root: MiniNode): RichText {
  const blocks: Block[] = [];
  let current: Span[] = [];
  const flush = () => {
    const spans = normalise(current);
    if (!spansEmpty(spans)) blocks.push({ t: 'p', spans: trimEdges(spans) });
    current = [];
  };

  const walkInline = (node: MiniNode, fmt: Fmt, target: Span[]) => {
    if (node.nodeType === TEXT)
      return pushSpan(target, (node.nodeValue ?? '').replace(/\n/g, ' '), fmt);
    if (node.nodeType !== ELEMENT) return;
    const tag = node.nodeName.toUpperCase();
    if (tag === 'BR') return pushSpan(target, '\n', fmt);
    const next: Fmt = {
      b: fmt.b || tag === 'B' || tag === 'STRONG',
      i: fmt.i || tag === 'I' || tag === 'EM',
    };
    for (let k = 0; k < node.childNodes.length; k++) walkInline(node.childNodes[k]!, next, target);
  };

  const walkList = (node: MiniNode, kind: 'ul' | 'ol') => {
    const items: Span[][] = [];
    for (let k = 0; k < node.childNodes.length; k++) {
      const li = node.childNodes[k]!;
      if (li.nodeType !== ELEMENT) continue;
      const tag = li.nodeName.toUpperCase();
      if (tag === 'LI') {
        const spans: Span[] = [];
        for (let j = 0; j < li.childNodes.length; j++) {
          const c = li.childNodes[j]!;
          const ct = c.nodeType === ELEMENT ? c.nodeName.toUpperCase() : '';
          if (ct === 'UL' || ct === 'OL') {
            // Nested lists are flattened into following items (no nesting in the contract).
            if (!spansEmpty(spans)) items.push(trimEdges(normalise(spans.splice(0))));
            const nested = walkListItems(c);
            items.push(...nested);
          } else walkInline(c, { b: false, i: false }, spans);
        }
        if (!spansEmpty(spans)) items.push(trimEdges(normalise(spans)));
      } else if (tag === 'UL' || tag === 'OL') items.push(...walkListItems(li));
    }
    if (items.length) blocks.push({ t: kind, items });
  };
  const walkListItems = (node: MiniNode): Span[][] => {
    const before = blocks.length;
    walkList(node, 'ul');
    const made = blocks.splice(before);
    return made.flatMap((b) => (b.t === 'p' ? [b.spans] : b.items));
  };

  const walkBlock = (node: MiniNode, fmt: Fmt) => {
    if (node.nodeType === TEXT)
      return pushSpan(current, (node.nodeValue ?? '').replace(/\n/g, ' '), fmt);
    if (node.nodeType !== ELEMENT) return;
    const tag = node.nodeName.toUpperCase();
    if (tag === 'SCRIPT' || tag === 'STYLE') return;
    if (tag === 'UL' || tag === 'OL') {
      flush();
      walkList(node, tag === 'UL' ? 'ul' : 'ol');
      return;
    }
    if (tag === 'BR') {
      flush();
      return;
    }
    if (BLOCK_TAGS.has(tag) || tag === 'LI') {
      flush();
      const inner: Fmt = { b: fmt.b || tag === 'STRONG', i: fmt.i };
      for (let k = 0; k < node.childNodes.length; k++) walkBlock(node.childNodes[k]!, inner);
      flush();
      return;
    }
    const next: Fmt = {
      b: fmt.b || tag === 'B' || tag === 'STRONG',
      i: fmt.i || tag === 'I' || tag === 'EM',
    };
    for (let k = 0; k < node.childNodes.length; k++) walkBlock(node.childNodes[k]!, next);
  };

  for (let k = 0; k < root.childNodes.length; k++)
    walkBlock(root.childNodes[k]!, { b: false, i: false });
  flush();
  // Paragraphs may contain soft line breaks ("\n" spans) from <br>; split them into separate paragraphs.
  const out: Block[] = [];
  for (const b of blocks) {
    if (b.t !== 'p') {
      out.push(b);
      continue;
    }
    let acc: Span[] = [];
    for (const s of b.spans) {
      const parts = s.text.split('\n');
      parts.forEach((part, i) => {
        if (i > 0) {
          if (!spansEmpty(acc)) out.push({ t: 'p', spans: trimEdges(acc) });
          acc = [];
        }
        pushSpan(acc, part, { b: !!s.b, i: !!s.i });
      });
    }
    if (!spansEmpty(acc)) out.push({ t: 'p', spans: trimEdges(acc) });
  }
  return out.slice(0, 400);
}

function trimEdges(spans: Span[]): Span[] {
  const copy = spans.map((s) => ({ ...s }));
  if (copy.length) {
    copy[0]!.text = copy[0]!.text.replace(/^\s+/, '');
    copy[copy.length - 1]!.text = copy[copy.length - 1]!.text.replace(/\s+$/, '');
  }
  return copy.filter((s) => s.text.length);
}

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function spansHtml(spans: Span[]): string {
  return spans
    .map((s) => {
      let t = esc(s.text);
      if (s.b) t = `<strong>${t}</strong>`;
      if (s.i) t = `<em>${t}</em>`;
      return t;
    })
    .join('');
}

/** Render blocks for the contenteditable (and for read-only display). */
export function richTextToHtml(blocks: RichText): string {
  return blocks
    .map((b) => {
      if (b.t === 'p') return `<p>${spansHtml(b.spans) || '<br>'}</p>`;
      return `<${b.t}>${b.items.map((i) => `<li>${spansHtml(i) || '<br>'}</li>`).join('')}</${b.t}>`;
    })
    .join('');
}

export function richTextEquals(a: RichText, b: RichText): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Plain text → paragraphs (used for paste). */
export function textToRichText(text: string): RichText {
  return text
    .split(/\n{2,}|\r\n\r\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map((p) => ({ t: 'p' as const, spans: [{ text: p }] }));
}
