/**
 * A small, strict XML reader for Office Open XML parts, written for one job: changing a few words inside a file we
 * did not write, and leaving every other byte of it alone.
 *
 * It keeps the place of every element and attribute in the source text (`start`, `end`, …), so an edit is a splice
 * of the original string rather than a re-serialisation of a tree. Everything outside the splice is byte-identical.
 *
 * It is deliberately narrow, because the input is an uploaded file:
 *   - no DTD at all (`<!DOCTYPE`, `<!ENTITY`, …) → no external entities, no entity expansion attacks;
 *   - only the five predefined entities and numeric character references;
 *   - hard limits on input size, nodes, depth and attributes;
 *   - namespace-aware, because producers other than PowerPoint do not use the `p:` / `a:` prefixes.
 * Pure TypeScript, no platform APIs: it runs unchanged on the server, in a browser and on the phone.
 */

export class XmlError extends Error {
  constructor(
    message: string,
    /** Character offset in the source where reading stopped. */
    public readonly at: number
  ) {
    super(message);
    this.name = 'XmlError';
  }
}

export interface XmlLimits {
  /** Longest source text accepted, in UTF-16 code units. */
  chars: number;
  /** Most elements, text nodes and attributes together. */
  nodes: number;
  depth: number;
  attributes: number;
}

export const XML_LIMITS: XmlLimits = {
  chars: 24 * 1024 * 1024,
  nodes: 1_500_000,
  depth: 200,
  attributes: 256,
};

export interface XmlAttr {
  /** As written, e.g. `r:embed`. */
  name: string;
  prefix: string;
  local: string;
  /** Namespace URI ('' for an unprefixed attribute). */
  ns: string;
  /** Decoded value. */
  value: string;
  /** Source range of the whole `name="value"`. */
  start: number;
  end: number;
  /** Source range of the value between the quotes. */
  valueStart: number;
  valueEnd: number;
}

export interface XmlElement {
  kind: 'el';
  /** As written, e.g. `a:p`. */
  name: string;
  prefix: string;
  local: string;
  ns: string;
  attrs: XmlAttr[];
  children: XmlNode[];
  parent: XmlElement | null;
  /** Index of the `<` that opens the element. */
  start: number;
  /** Index just after the `>` of the start tag. */
  openEnd: number;
  /** Index of the `</` of the end tag (equal to `end` for `<x/>`). */
  closeStart: number;
  /** Index just after the element's last `>`. */
  end: number;
  selfClosing: boolean;
  /** Prefix → namespace URI declared on this element (not inherited ones). */
  declared: Record<string, string> | null;
}

export interface XmlText {
  kind: 'text';
  /** Decoded text. */
  value: string;
  start: number;
  end: number;
  cdata: boolean;
}

export type XmlNode = XmlElement | XmlText;

export interface XmlDoc {
  source: string;
  root: XmlElement;
}

const isSpace = (c: number) => c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d;

/** Characters XML 1.0 allows in a document. */
function isXmlChar(c: number): boolean {
  return (
    c === 0x9 || c === 0xa || c === 0xd || (c >= 0x20 && c <= 0xd7ff) || (c >= 0xe000 && c <= 0xfffd) || (c >= 0x10000 && c <= 0x10ffff)
  );
}

const PREDEFINED: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

/** Decode character data or an attribute value. Any entity that is not predefined or numeric is refused. */
export function decodeXml(raw: string, at = 0): string {
  if (!raw.includes('&')) return raw;
  let out = '';
  let i = 0;
  for (;;) {
    const amp = raw.indexOf('&', i);
    if (amp < 0) return out + raw.slice(i);
    out += raw.slice(i, amp);
    const semi = raw.indexOf(';', amp + 1);
    if (semi < 0 || semi - amp > 12) throw new XmlError('An "&" is not followed by a known entity.', at + amp);
    const name = raw.slice(amp + 1, semi);
    if (name[0] === '#') {
      const hex = name[1] === 'x';
      const digits = name.slice(hex ? 2 : 1);
      if (!digits || !(hex ? /^[0-9a-fA-F]+$/ : /^[0-9]+$/).test(digits))
        throw new XmlError('A character reference is malformed.', at + amp);
      const code = parseInt(digits, hex ? 16 : 10);
      if (!isXmlChar(code)) throw new XmlError('A character reference names a character XML does not allow.', at + amp);
      out += String.fromCodePoint(code);
    } else {
      const ch = PREDEFINED[name];
      if (ch === undefined) throw new XmlError('This file uses an XML entity that is not allowed.', at + amp);
      out += ch;
    }
    i = semi + 1;
  }
}

/** Escape text for element content. */
export function escapeXmlText(text: string): string {
  return text.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
}

/** Escape text for a double-quoted attribute value. */
export function escapeXmlAttr(text: string): string {
  return text.replace(/[&<>"\t\n\r]/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : c === '\t' ? '&#9;' : c === '\n' ? '&#10;' : '&#13;'
  );
}

/**
 * Drop what XML 1.0 cannot carry (control characters, lone surrogates) from text a person typed, so that what we
 * write is always well-formed. Tabs and line feeds are kept.
 */
export function cleanXmlText(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = text.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        out += text[i]! + text[i + 1]!;
        i++;
      }
      continue;
    }
    if (c >= 0xdc00 && c <= 0xdfff) continue;
    if (c === 0x9 || c === 0xa || (c >= 0x20 && c !== 0xfffe && c !== 0xffff)) out += text[i]!;
  }
  return out;
}

const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';

/** Parse one XML part. Throws XmlError for anything that is not plain, well-formed, DTD-free XML within the limits. */
export function parseXml(source: string, limits: Partial<XmlLimits> = {}): XmlDoc {
  const lim = { ...XML_LIMITS, ...limits };
  const s = source;
  const n = s.length;
  if (n > lim.chars) throw new XmlError('This part of the file is too large to read.', 0);
  let i = s.charCodeAt(0) === 0xfeff ? 1 : 0;
  let nodes = 0;
  let root: XmlElement | null = null;
  let current: XmlElement | null = null;
  let depth = 0;
  // Namespace scopes: one map per open element that declares anything, found through the parent chain.
  const scopes: Array<Record<string, string>> = [{ xml: XML_NS, xmlns: XMLNS_NS }];
  const scopeOwner: Array<XmlElement | null> = [null];
  const lookup = (prefix: string, at: number): string => {
    for (let k = scopes.length - 1; k >= 0; k--) {
      const v = scopes[k]![prefix];
      if (v !== undefined) return v;
    }
    if (prefix === '') return '';
    throw new XmlError(`The namespace prefix "${prefix}" is not declared.`, at);
  };
  const count = (at: number) => {
    if (++nodes > lim.nodes) throw new XmlError('This part of the file has too many elements.', at);
  };
  const fail = (message: string, at: number): never => {
    throw new XmlError(message, at);
  };

  const pushText = (start: number, end: number, cdata: boolean) => {
    if (end <= start) return;
    if (!current) {
      // Outside the root only white space is allowed.
      for (let k = start; k < end; k++) if (!isSpace(s.charCodeAt(k))) fail('Text is not allowed outside the root element.', k);
      return;
    }
    count(start);
    const raw = s.slice(start, end);
    current.children.push({ kind: 'text', value: cdata ? raw : decodeXml(raw, start), start, end, cdata });
  };

  while (i < n) {
    const lt = s.indexOf('<', i);
    if (lt < 0) {
      pushText(i, n, false);
      i = n;
      break;
    }
    if (lt > i) pushText(i, lt, false);
    i = lt;
    const c1 = s.charCodeAt(i + 1);
    if (c1 === 0x3f /* ? */) {
      const close = s.indexOf('?>', i + 2);
      if (close < 0) fail('A processing instruction is not closed.', i);
      i = close + 2;
      continue;
    }
    if (c1 === 0x21 /* ! */) {
      if (s.startsWith('<!--', i)) {
        const close = s.indexOf('-->', i + 4);
        if (close < 0) fail('A comment is not closed.', i);
        i = close + 3;
        continue;
      }
      if (s.startsWith('<![CDATA[', i)) {
        const close = s.indexOf(']]>', i + 9);
        if (close < 0) fail('A CDATA section is not closed.', i);
        if (!current) fail('Text is not allowed outside the root element.', i);
        pushText(i + 9, close, true);
        // The node's range is the whole section, so a splice can replace it.
        const node = current!.children[current!.children.length - 1];
        if (node && node.kind === 'text' && node.cdata && node.start === i + 9) {
          node.start = i;
          node.end = close + 3;
        }
        i = close + 3;
        continue;
      }
      // <!DOCTYPE …>, <!ENTITY …> and friends: never needed by Office files, and the root of every XML attack.
      fail('This file contains a document type declaration, which is not allowed.', i);
    }
    if (c1 === 0x2f /* / */) {
      const gt = s.indexOf('>', i + 2);
      if (gt < 0) fail('An end tag is not closed.', i);
      let e = gt;
      while (e > i + 2 && isSpace(s.charCodeAt(e - 1))) e--;
      const name = s.slice(i + 2, e);
      if (!current || current.name !== name) fail(`The end tag </${name.slice(0, 40)}> does not match its start tag.`, i);
      const el: XmlElement = current!;
      el.closeStart = i;
      el.end = gt + 1;
      if (scopeOwner[scopeOwner.length - 1] === el) {
        scopes.pop();
        scopeOwner.pop();
      }
      current = el.parent;
      depth--;
      i = gt + 1;
      continue;
    }

    // Start tag.
    if (root && !current) fail('This file has more than one root element.', i);
    let p = i + 1;
    const nameStart = p;
    while (p < n) {
      const c = s.charCodeAt(p);
      if (isSpace(c) || c === 0x2f || c === 0x3e) break;
      if (c === 0x3c || c === 0x3d || c === 0x22 || c === 0x27) fail('A tag name is malformed.', p);
      p++;
    }
    const name = s.slice(nameStart, p);
    if (!name) fail('A tag has no name.', i);
    count(i);
    if (++depth > lim.depth) fail('This part of the file is nested too deeply.', i);
    const attrs: XmlAttr[] = [];
    let declared: Record<string, string> | null = null;
    let selfClosing = false;
    for (;;) {
      while (p < n && isSpace(s.charCodeAt(p))) p++;
      if (p >= n) fail('A start tag is not closed.', i);
      const c = s.charCodeAt(p);
      if (c === 0x3e) {
        p++;
        break;
      }
      if (c === 0x2f) {
        if (s.charCodeAt(p + 1) !== 0x3e) fail('A start tag is malformed.', p);
        selfClosing = true;
        p += 2;
        break;
      }
      const aStart = p;
      while (p < n) {
        const d = s.charCodeAt(p);
        if (isSpace(d) || d === 0x3d || d === 0x2f || d === 0x3e) break;
        if (d === 0x3c || d === 0x22 || d === 0x27) fail('An attribute name is malformed.', p);
        p++;
      }
      const aName = s.slice(aStart, p);
      if (!aName) fail('An attribute has no name.', aStart);
      while (p < n && isSpace(s.charCodeAt(p))) p++;
      if (s.charCodeAt(p) !== 0x3d) fail('An attribute has no value.', p);
      p++;
      while (p < n && isSpace(s.charCodeAt(p))) p++;
      const quote = s.charCodeAt(p);
      if (quote !== 0x22 && quote !== 0x27) fail('An attribute value is not quoted.', p);
      const vStart = p + 1;
      const vEnd = s.indexOf(quote === 0x22 ? '"' : "'", vStart);
      if (vEnd < 0) fail('An attribute value is not closed.', p);
      const rawValue = s.slice(vStart, vEnd);
      if (rawValue.includes('<')) fail('An attribute value contains "<".', vStart);
      p = vEnd + 1;
      if (attrs.length >= lim.attributes) fail('An element has too many attributes.', aStart);
      count(aStart);
      const value = decodeXml(rawValue, vStart);
      const colon = aName.indexOf(':');
      const aPrefix = colon < 0 ? '' : aName.slice(0, colon);
      const aLocal = colon < 0 ? aName : aName.slice(colon + 1);
      if (aName === 'xmlns' || aPrefix === 'xmlns') {
        declared ??= {};
        declared[aName === 'xmlns' ? '' : aLocal] = value;
      }
      attrs.push({ name: aName, prefix: aPrefix, local: aLocal, ns: '', value, start: aStart, end: p, valueStart: vStart, valueEnd: vEnd });
    }
    const colon = name.indexOf(':');
    const prefix = colon < 0 ? '' : name.slice(0, colon);
    const local = colon < 0 ? name : name.slice(colon + 1);
    const el: XmlElement = {
      kind: 'el', name, prefix, local, ns: '', attrs, children: [], parent: current,
      start: i, openEnd: p, closeStart: p, end: p, selfClosing, declared,
    };
    if (declared) {
      scopes.push(declared);
      scopeOwner.push(el);
    }
    el.ns = lookup(prefix, i);
    const seen = new Set<string>();
    for (const a of attrs) {
      if (a.name === 'xmlns' || a.prefix === 'xmlns') a.ns = XMLNS_NS;
      else if (a.prefix) a.ns = lookup(a.prefix, a.start);
      const key = `${a.ns}\u0000${a.local}`;
      if (seen.has(key)) fail('An attribute appears twice on one element.', a.start);
      seen.add(key);
    }
    if (current) current.children.push(el);
    else root = el;
    if (selfClosing) {
      if (declared) {
        scopes.pop();
        scopeOwner.pop();
      }
      depth--;
    } else {
      current = el;
    }
    i = p;
  }
  if (current) throw new XmlError('This part of the file ends before its last element is closed.', n);
  if (!root) throw new XmlError('This part of the file is empty.', 0);
  return { source: s, root };
}

/* ---------------- reading the tree ---------------- */

export const isEl = (node: XmlNode | undefined | null): node is XmlElement => !!node && node.kind === 'el';

/** Child elements, optionally only those with a namespace and local name. */
export function kids(el: XmlElement, ns?: string, local?: string): XmlElement[] {
  const out: XmlElement[] = [];
  for (const c of el.children) if (c.kind === 'el' && (ns === undefined || c.ns === ns) && (local === undefined || c.local === local)) out.push(c);
  return out;
}

export function kid(el: XmlElement | null | undefined, ns: string, local: string): XmlElement | null {
  if (!el) return null;
  for (const c of el.children) if (c.kind === 'el' && c.ns === ns && c.local === local) return c;
  return null;
}

/** Follow a path of (ns, local) pairs through first matching children. */
export function path(el: XmlElement | null | undefined, ...steps: Array<[ns: string, local: string]>): XmlElement | null {
  let at: XmlElement | null = el ?? null;
  for (const [ns, local] of steps) {
    at = kid(at, ns, local);
    if (!at) return null;
  }
  return at;
}

/** An attribute's decoded value: unprefixed by default, or in a namespace. */
export function attr(el: XmlElement | null | undefined, local: string, ns = ''): string | null {
  if (!el) return null;
  for (const a of el.attrs) if (a.local === local && a.ns === ns) return a.value;
  return null;
}

export function attrNode(el: XmlElement, local: string, ns = ''): XmlAttr | null {
  for (const a of el.attrs) if (a.local === local && a.ns === ns) return a;
  return null;
}

/** All text inside an element, in document order. */
export function textOf(el: XmlElement): string {
  let out = '';
  for (const c of el.children) out += c.kind === 'text' ? c.value : textOf(c);
  return out;
}

/** Every descendant element (document order), the element itself not included. */
export function* descendants(el: XmlElement): Generator<XmlElement> {
  for (const c of el.children)
    if (c.kind === 'el') {
      yield c;
      yield* descendants(c);
    }
}

/** The prefix bound to `ns` where `el` stands, or null when the namespace is not in scope there. */
export function prefixFor(el: XmlElement, ns: string): string | null {
  const shadowed = new Set<string>();
  for (let at: XmlElement | null = el; at; at = at.parent) {
    if (!at.declared) continue;
    for (const [prefix, uri] of Object.entries(at.declared)) {
      if (shadowed.has(prefix)) continue;
      if (uri === ns) return prefix;
      shadowed.add(prefix);
    }
  }
  return null;
}

/** The source text of a node, exactly as it stands in the file. */
export const sourceOf = (doc: XmlDoc, node: { start: number; end: number }): string => doc.source.slice(node.start, node.end);

/* ---------------- editing by splice ---------------- */

export interface Splice {
  start: number;
  end: number;
  text: string;
}

/**
 * Apply replacements to a source text. Ranges must not overlap; two insertions at the same point keep the order
 * they were given in. Everything outside the ranges is returned untouched.
 */
export function applySplices(source: string, splices: Splice[]): string {
  if (!splices.length) return source;
  const sorted = splices.map((sp, order) => ({ ...sp, order })).sort((a, b) => a.start - b.start || a.end - b.end || a.order - b.order);
  let out = '';
  let at = 0;
  for (const sp of sorted) {
    if (sp.start < at || sp.end < sp.start || sp.end > source.length) throw new Error('Overlapping or out-of-range edits.');
    out += source.slice(at, sp.start) + sp.text;
    at = sp.end;
  }
  return out + source.slice(at);
}
