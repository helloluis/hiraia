/**
 * The Open Packaging Conventions layer of a .pptx: parts, content types and relationships.
 *
 * A package is read through a tiny interface (`PartSource`), so this file never touches a ZIP library or a file
 * system: the server hands it a reader built on node:zlib, a phone can hand it one built on anything else.
 * Parts are kept as the bytes they arrived as. A part is decoded, parsed or rewritten only when something asks,
 * which is what lets an export return every untouched part byte for byte.
 */
import { applySplices, attr, escapeXmlAttr, kids, parseXml, trimEndSpaces, type Splice, type XmlBudget, type XmlDoc, type XmlElement, type XmlLimits } from './xml';

export class PptxError extends Error {
  /** Stable reason code; the server maps it to a plain-language message. */
  readonly code: PptxErrorCode;
  constructor(code: PptxErrorCode, message: string) {
    super(message);
    this.name = 'PptxError';
    this.code = code;
  }
}

export type PptxErrorCode =
  | 'not_a_presentation'
  | 'wrong_office_file'
  | 'macros'
  | 'active_content'
  | 'strict_ooxml'
  | 'signed'
  | 'unsafe_part_name'
  | 'damaged'
  | 'too_many_parts'
  | 'too_many_slides'
  | 'too_large'
  | 'no_slides'
  | 'unreadable_text'
  | 'invalid_edit';

/** What a ZIP reader must offer. Names use forward slashes and have no leading slash. */
export interface PartSource {
  names: string[];
  read(name: string): Uint8Array;
}

export const NS = {
  P: 'http://schemas.openxmlformats.org/presentationml/2006/main',
  A: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  R: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  REL: 'http://schemas.openxmlformats.org/package/2006/relationships',
  CT: 'http://schemas.openxmlformats.org/package/2006/content-types',
  MC: 'http://schemas.openxmlformats.org/markup-compatibility/2006',
  P14: 'http://schemas.microsoft.com/office/powerpoint/2010/main',
  A14: 'http://schemas.microsoft.com/office/drawing/2010/main',
  CHART: 'http://schemas.openxmlformats.org/drawingml/2006/chart',
  DIAGRAM: 'http://schemas.openxmlformats.org/drawingml/2006/diagram',
  TABLE: 'http://schemas.openxmlformats.org/drawingml/2006/table',
  MATH: 'http://schemas.openxmlformats.org/officeDocument/2006/math',
  /** ISO "Strict" flavour: same structure, different namespace names. Not read in this version. */
  P_STRICT: 'http://purl.oclc.org/ooxml/presentationml/main',
} as const;

const REL_OFFICE_DOCUMENT = [
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument',
  'http://purl.oclc.org/ooxml/officeDocument/relationships/officeDocument',
];

export const CONTENT_TYPE = {
  presentation: 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml',
  template: 'application/vnd.openxmlformats-officedocument.presentationml.template.main+xml',
  slideshow: 'application/vnd.openxmlformats-officedocument.presentationml.slideshow.main+xml',
  slide: 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml',
  notesSlide: 'application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml',
  rels: 'application/vnd.openxmlformats-package.relationships+xml',
} as const;

export interface Relationship {
  id: string;
  /** Full relationship type URI. */
  type: string;
  /** Last path segment of the type (`slide`, `image`, `hyperlink`, `chart`, …): what the code switches on. */
  kind: string;
  /** Target exactly as written. */
  rawTarget: string;
  external: boolean;
  /** Resolved part name for an internal target; null for an external one. */
  target: string | null;
  /** Where it stands in the text of its relationships part: the whole element, and the value of its Target. */
  at: { start: number; end: number; targetStart: number; targetEnd: number };
}

export interface PackageLimits {
  parts: number;
  /** Longest part name accepted. */
  nameLength: number;
  xml: Partial<XmlLimits>;
  /** What the whole job may parse, across every part (xml.ts). Shared and counted down; absent = no job limit. */
  budget?: XmlBudget;
  /** Nodes a relationships part or the content types may have (they are lists, not slides). */
  listNodes: number;
  /** Most characters a job may write as new or changed parts, all together. */
  writtenChars: number;
  /** The same in bytes, as the parts are stored (a character can take three). */
  writtenBytes: number;
  /** Parsed parts kept at hand. When they hold more nodes than this, the oldest are let go (and read again if asked for). */
  cachedNodes: number;
  /** The text of the parsed parts kept at hand, counted the same way: a part can be a few nodes and megabytes of text. */
  cachedChars: number;
  /** Relationships kept at hand, counted the same way. */
  cachedRels: number;
}

export const PACKAGE_LIMITS: PackageLimits = { parts: 4000, nameLength: 240, xml: {}, listNodes: 40_000, writtenChars: 32 * 1024 * 1024, writtenBytes: 24 * 1024 * 1024, cachedNodes: 200_000, cachedChars: 16 * 1024 * 1024, cachedRels: 50_000 };

export const dirOf = (part: string): string => {
  const slash = part.lastIndexOf('/');
  return slash < 0 ? '' : part.slice(0, slash);
};
export const baseOf = (part: string): string => part.slice(part.lastIndexOf('/') + 1);
export const relsNameOf = (part: string): string => {
  const dir = dirOf(part);
  return `${dir ? `${dir}/` : ''}_rels/${baseOf(part)}.rels`;
};
/** The part a `…/_rels/x.rels` file belongs to ('' for the package itself), or null when the name is not a rels part. */
export function ownerOfRels(relsName: string): string | null {
  if (!relsName.endsWith('.rels')) return null;
  const slash = relsName.lastIndexOf('/');
  const folder = slash < 0 ? '' : relsName.slice(0, slash);
  const base = relsName.slice(slash + 1, relsName.length - 5);
  if (folder !== '_rels' && !folder.endsWith('/_rels')) return null;
  const dir = folder === '_rels' ? '' : folder.slice(0, folder.length - 6);
  return base === '' ? (dir === '' ? '' : null) : dir ? `${dir}/${base}` : base;
}

/** `ppt/slides` + `../media/a.png` → `ppt/media/a.png`. Returns null when the target climbs out of the package. */
export function resolveTarget(fromPart: string, target: string): string | null {
  let t = target;
  const hash = t.indexOf('#');
  if (hash >= 0) t = t.slice(0, hash);
  const out = t.startsWith('/') ? [] : dirOf(fromPart).split('/').filter(Boolean);
  for (const seg of t.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (!out.length) return null;
      out.pop();
    } else out.push(seg);
  }
  return out.join('/');
}

/** A path from one part to another, as a relationship target (`ppt/slides/slide1.xml` → `../media/a.png`). */
export function relativeTarget(fromPart: string, toPart: string): string {
  const from = dirOf(fromPart).split('/').filter(Boolean);
  const to = toPart.split('/');
  let common = 0;
  while (common < from.length && common < to.length - 1 && from[common] === to[common]) common++;
  return [...Array<string>(from.length - common).fill('..'), ...to.slice(common)].join('/');
}

/** A part name that cannot be mistaken for anything outside the package. */
export function isSafePartName(name: string, maxLength = PACKAGE_LIMITS.nameLength): boolean {
  if (!name || name.length > maxLength) return false;
  if (name.startsWith('/') || name.endsWith('/') || name.includes('\\') || name.includes('//')) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(name)) return false;
  for (const seg of name.split('/')) if (seg === '.' || seg === '..' || seg === '') return false;
  // A drive letter or a URL scheme has no business in a part name.
  return !/^[A-Za-z]:/.test(name);
}

const utf8 = new TextDecoder('utf-8', { fatal: true });
const utf8Encoder = new TextEncoder();
export const encodeUtf8 = (text: string): Uint8Array => utf8Encoder.encode(text);
/** How many bytes a text is in UTF-8, or a little more: counted without making the bytes. */
export function utf8Length(text: string): number {
  let n = text.length;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c > 0x7f) n += c > 0x7ff ? 2 : 1;
  }
  return n;
}

/**
 * A package being read and, possibly, changed. Changes are recorded as whole new part contents; `entries()` then
 * lists what the new file holds, with `changed: false` for every part still exactly as it arrived.
 *
 * Two views of every part: as it stands now (`text`, `xml`, `rels`) and as it was uploaded, whatever has been
 * written since (`sourceText`, `sourceXml`, `sourceRels`). Writing an edit reads the uploaded view, so the order in
 * which slides are written cannot change what a later slide is copied from.
 *
 * Memory: a parsed part is large (about 280 bytes a node), so only the most recently used ones are kept. A deck of
 * hundreds of heavy slides is read one slide at a time, never held whole.
 */
export class PptxPackage {
  private readonly original: Map<string, () => Uint8Array> = new Map();
  /** Parts written or replaced since the package was opened; null = removed. */
  private readonly written: Map<string, Uint8Array | null> = new Map();
  private readonly order: string[] = [];
  /** Parsed parts, least recently used first. `u:` = as uploaded, `w:` = as written since. */
  private readonly docs: Map<string, XmlDoc> = new Map();
  private docNodes = 0;
  private docChars = 0;
  private readonly relsCache: Map<string, { list: Relationship[]; byId: Map<string, Relationship> }> = new Map();
  private relsCached = 0;
  private contentTypes: { doc: XmlDoc; defaults: Map<string, string>; overrides: Map<string, { type: string; el: XmlElement }> } | null = null;
  private charsWritten = 0;
  private bytesWritten = 0;
  readonly limits: PackageLimits;

  constructor(source: PartSource, limits: Partial<PackageLimits> = {}) {
    this.limits = { ...PACKAGE_LIMITS, ...limits };
    if (source.names.length > this.limits.parts) throw new PptxError('too_many_parts', 'This file has too many parts.');
    const folded = new Set<string>();
    for (const name of source.names) {
      if (!isSafePartName(name, this.limits.nameLength)) throw new PptxError('unsafe_part_name', 'This file has a part with an unsafe name.');
      // Part names are case-insensitive: two names that differ only in case are one part to PowerPoint.
      const key = name.toLowerCase();
      if (folded.has(key)) throw new PptxError('unsafe_part_name', 'This file has two parts with the same name.');
      folded.add(key);
      this.original.set(name, () => source.read(name));
      this.order.push(name);
    }
  }

  has(name: string): boolean {
    const w = this.written.get(name);
    return w !== undefined ? w !== null : this.original.has(name);
  }

  /** Whether the uploaded file had this part. */
  sourceHas(name: string): boolean {
    return this.original.has(name);
  }

  /** Part names as the file would hold them now, in their original order (new parts last). */
  names(): string[] {
    return this.order.filter((n) => this.has(n));
  }

  bytes(name: string): Uint8Array {
    const w = this.written.get(name);
    if (w) return w;
    const read = w === null ? undefined : this.original.get(name);
    if (!read) throw new PptxError('damaged', `This file is missing a part it refers to (${name.slice(0, 80)}).`);
    return read();
  }

  private sourceBytes(name: string): Uint8Array {
    const read = this.original.get(name);
    if (!read) throw new PptxError('damaged', `This file is missing a part it refers to (${name.slice(0, 80)}).`);
    return read();
  }

  /** Which state of a part a cache entry holds. A part that was never written is the same in both views. */
  private key(name: string, uploaded: boolean): string {
    return uploaded || !this.written.has(name) ? `u:${name}` : `w:${name}`;
  }

  private decode(name: string, uploaded: boolean): string {
    const held = this.docs.get(this.key(name, uploaded));
    if (held) return held.source;
    const b = uploaded ? this.sourceBytes(name) : this.bytes(name);
    if (b.length >= 2 && ((b[0] === 0xff && b[1] === 0xfe) || (b[0] === 0xfe && b[1] === 0xff)))
      throw new PptxError('unreadable_text', 'This file stores its text in a way Tala cannot read (UTF-16).');
    try {
      return utf8.decode(b);
    } catch {
      throw new PptxError('unreadable_text', 'This file has text that is not valid UTF-8.');
    }
  }

  private parsed(name: string, uploaded: boolean): XmlDoc {
    const key = this.key(name, uploaded);
    const held = this.docs.get(key);
    if (held) {
      // Most recently used last.
      this.docs.delete(key);
      this.docs.set(key, held);
      return held;
    }
    const isList = name === '[Content_Types].xml' || ownerOfRels(name) !== null;
    const limits = isList ? { ...this.limits.xml, nodes: Math.min(this.limits.listNodes, this.limits.xml.nodes ?? this.limits.listNodes) } : this.limits.xml;
    const doc = parseXml(this.decode(name, uploaded), limits, this.limits.budget);
    this.docs.set(key, doc);
    this.docNodes += doc.nodes;
    this.docChars += doc.source.length;
    for (const [k, d] of this.docs) {
      if ((this.docNodes <= this.limits.cachedNodes && this.docChars <= this.limits.cachedChars) || k === key) break;
      this.docs.delete(k);
      this.docNodes -= d.nodes;
      this.docChars -= d.source.length;
    }
    return doc;
  }

  /** A part as text. Only UTF-8 is read (what PowerPoint, Google Slides, LibreOffice and WPS all write). */
  text(name: string): string {
    return this.decode(name, false);
  }

  /** The part as text, as it was uploaded. */
  sourceText(name: string): string {
    return this.decode(name, true);
  }

  xml(name: string): XmlDoc {
    return this.parsed(name, false);
  }

  /** The part parsed, as it was uploaded. */
  sourceXml(name: string): XmlDoc {
    return this.parsed(name, true);
  }

  /** Count what this job generates. A job that writes more than its limit is refused, before the text is built where that is known. */
  spend(chars: number): void {
    this.charsWritten += chars;
    if (this.charsWritten > this.limits.writtenChars) throw new PptxError('too_large', 'These changes make the file too large to write here.');
  }

  /** Replace or create a part. */
  write(name: string, data: Uint8Array | string): void {
    if (!isSafePartName(name, this.limits.nameLength)) throw new PptxError('unsafe_part_name', 'Refusing to write a part with an unsafe name.');
    this.spend(data.length);
    // In bytes as well: the text is not turned into bytes at all when it cannot fit (a character is three at most).
    const room = this.limits.writtenBytes - this.bytesWritten;
    if (typeof data === 'string' && data.length * 3 > room && utf8Length(data) > room) throw new PptxError('too_large', 'These changes make the file too large to write here.');
    const bytes = typeof data === 'string' ? encodeUtf8(data) : data;
    this.bytesWritten += bytes.length;
    if (this.bytesWritten > this.limits.writtenBytes) throw new PptxError('too_large', 'These changes make the file too large to write here.');
    if (!this.original.has(name) && !this.written.has(name)) this.order.push(name);
    this.forget(name);
    this.written.set(name, bytes);
  }

  /** Apply splices to an XML part's own source. */
  patch(name: string, splices: Splice[]): void {
    if (splices.length) this.write(name, applySplices(this.text(name), splices));
  }

  remove(name: string): void {
    if (!this.has(name)) return;
    this.forget(name);
    this.written.set(name, null);
  }

  /** Let go of what is held of a part as written (what is held of it as uploaded stays valid: that never changes). */
  private forget(name: string): void {
    const doc = this.docs.get(`w:${name}`);
    if (doc) {
      this.docs.delete(`w:${name}`);
      this.docNodes -= doc.nodes;
      this.docChars -= doc.source.length;
    }
    const rels = this.relsCache.get(`w:${name}`);
    if (rels) {
      this.relsCache.delete(`w:${name}`);
      this.relsCached -= rels.list.length;
    }
    if (name === '[Content_Types].xml') this.contentTypes = null;
  }

  /** Whether a part's bytes may differ from the uploaded file's (it was written, or did not exist). */
  isChanged(name: string): boolean {
    return this.written.has(name);
  }

  /** The parts of the file as it stands now. */
  entries(): Array<{ name: string; data: Uint8Array; changed: boolean }> {
    return this.names().map((name) => ({ name, data: this.bytes(name), changed: this.isChanged(name) }));
  }

  /* ---------------- content types ---------------- */

  private types() {
    if (!this.contentTypes) {
      if (!this.has('[Content_Types].xml')) throw new PptxError('not_a_presentation', 'This is not a PowerPoint file.');
      const doc = this.xml('[Content_Types].xml');
      if (doc.root.ns !== NS.CT || doc.root.local !== 'Types') throw new PptxError('not_a_presentation', 'This is not a PowerPoint file.');
      const defaults = new Map<string, string>();
      const overrides = new Map<string, { type: string; el: XmlElement }>();
      for (const el of kids(doc.root, NS.CT)) {
        if (el.local === 'Default') {
          const ext = attr(el, 'Extension');
          const type = attr(el, 'ContentType');
          if (ext && type) defaults.set(ext.toLowerCase(), type);
        } else if (el.local === 'Override') {
          const part = attr(el, 'PartName');
          const type = attr(el, 'ContentType');
          if (part && type) overrides.set((part.startsWith('/') ? part.slice(1) : part).toLowerCase(), { type, el });
        }
      }
      this.contentTypes = { doc, defaults, overrides };
    }
    return this.contentTypes;
  }

  contentType(part: string): string | null {
    const t = this.types();
    const o = t.overrides.get(part.toLowerCase());
    if (o) return o.type;
    const dot = part.lastIndexOf('.');
    return dot < 0 ? null : (t.defaults.get(part.slice(dot + 1).toLowerCase()) ?? null);
  }

  /**
   * Rewrite `[Content_Types].xml` in one pass: overrides to add or change (by part name) and parts whose overrides go.
   * The rest of the file is left exactly as it was.
   */
  editContentTypes(set: Array<{ part: string; type: string }>, drop: string[] = []): void {
    const t = this.types();
    const splices: Splice[] = [];
    let added = '';
    const dropKeys = new Set(drop.map((d) => d.toLowerCase()));
    for (const { part, type } of set) {
      const key = part.toLowerCase();
      dropKeys.delete(key);
      const existing = t.overrides.get(key);
      if (existing) {
        if (existing.type === type) continue;
        const a = existing.el.attrs.find((x) => x.local === 'ContentType' && !x.prefix)!;
        splices.push({ start: a.valueStart, end: a.valueEnd, text: escapeXmlAttr(type) });
      } else if (this.contentType(part) !== type) {
        const p = t.doc.root.prefix ? `${t.doc.root.prefix}:` : '';
        added += `<${p}Override PartName="/${escapeXmlAttr(part)}" ContentType="${escapeXmlAttr(type)}"/>`;
      }
    }
    for (const key of dropKeys) {
      const existing = t.overrides.get(key);
      if (existing) splices.push({ start: existing.el.start, end: existing.el.end, text: '' });
    }
    if (added) {
      if (t.doc.root.selfClosing) throw new PptxError('damaged', 'This file lists no content types.');
      splices.push({ start: t.doc.root.closeStart, end: t.doc.root.closeStart, text: added });
    }
    this.patch('[Content_Types].xml', splices);
  }

  /* ---------------- relationships ---------------- */

  private relsOf(part: string, uploaded: boolean): { list: Relationship[]; byId: Map<string, Relationship> } {
    const name = part === '' ? '_rels/.rels' : relsNameOf(part);
    const key = this.key(name, uploaded);
    const held = this.relsCache.get(key);
    if (held) return held;
    const list: Relationship[] = [];
    const byId = new Map<string, Relationship>();
    const exists = (n: string) => (uploaded ? this.original.has(n) : this.has(n));
    if (exists(name)) {
      const doc = this.parsed(name, uploaded);
      if (doc.root.ns !== NS.REL || doc.root.local !== 'Relationships') throw new PptxError('damaged', 'A relationships part of this file is damaged.');
      for (const el of kids(doc.root, NS.REL, 'Relationship')) {
        const id = attr(el, 'Id');
        const type = attr(el, 'Type');
        const targetAttr = el.attrs.find((a) => a.local === 'Target' && !a.prefix);
        if (!id || !type || !targetAttr) continue;
        if (byId.has(id)) throw new PptxError('damaged', 'A relationships part of this file uses the same id twice.');
        const rawTarget = targetAttr.value;
        const external = attr(el, 'TargetMode') === 'External';
        let target: string | null = null;
        if (!external) {
          target = resolveTarget(part, rawTarget);
          // Targets are URIs; some writers percent-encode what the ZIP stores literally.
          if (target !== null && !exists(target) && target.includes('%')) {
            try {
              const decoded = decodeURIComponent(target);
              if (exists(decoded)) target = decoded;
            } catch {
              /* keep the literal target */
            }
          }
        }
        const r: Relationship = { id, type, kind: type.slice(type.lastIndexOf('/') + 1), rawTarget, external, target, at: { start: el.start, end: el.end, targetStart: targetAttr.valueStart, targetEnd: targetAttr.valueEnd } };
        list.push(r);
        byId.set(id, r);
      }
    }
    const entry = { list, byId };
    this.relsCache.set(key, entry);
    this.relsCached += list.length;
    for (const [k, e] of this.relsCache) {
      if (this.relsCached <= this.limits.cachedRels || k === key) break;
      this.relsCache.delete(k);
      this.relsCached -= e.list.length;
    }
    return entry;
  }

  /** Relationships of a part ('' = the package itself). A part with no relationships file has none. */
  rels(part: string): Relationship[] {
    return this.relsOf(part, false).list;
  }

  /** The part's relationships as uploaded. */
  sourceRels(part: string): Relationship[] {
    return this.relsOf(part, true).list;
  }

  rel(part: string, id: string | null | undefined): Relationship | null {
    if (!id) return null;
    return this.relsOf(part, false).byId.get(id) ?? null;
  }

  /**
   * Rewrite a part's relationships in one pass: relationships to add (an id is chosen and returned for each) and
   * ids to remove. Creates the relationships part when the part had none.
   */
  editRels(part: string, add: Array<{ type: string; target: string; external?: boolean }>, removeIds: string[] = []): string[] {
    const name = part === '' ? '_rels/.rels' : relsNameOf(part);
    const existing = this.rels(part);
    const used = new Set(existing.map((r) => r.id));
    const ids: string[] = [];
    let n = existing.length;
    let added = '';
    const hasDoc = this.has(name);
    const prefix = hasDoc && this.xml(name).root.prefix ? `${this.xml(name).root.prefix}:` : '';
    for (const a of add) {
      let id: string;
      do id = `rId${++n}`;
      while (used.has(id));
      used.add(id);
      ids.push(id);
      const rawTarget = a.external ? a.target : relativeTarget(part, a.target);
      added += `<${prefix}Relationship Id="${id}" Type="${escapeXmlAttr(a.type)}" Target="${escapeXmlAttr(rawTarget)}"${a.external ? ' TargetMode="External"' : ''}/>`;
    }
    if (!hasDoc) {
      if (added) {
        this.write(name, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${NS.REL}">${added}</Relationships>`);
        this.ensureRelsContentType();
      }
      return ids;
    }
    const doc = this.xml(name);
    const splices: Splice[] = [];
    const gone = new Set(removeIds);
    for (const r of existing) if (gone.has(r.id)) splices.push({ start: r.at.start, end: r.at.end, text: '' });
    if (added) {
      if (doc.root.selfClosing) {
        // <Relationships …/> → open it up.
        const open = trimEndSpaces(doc.source.slice(doc.root.start, doc.root.end - 2));
        this.write(name, `${doc.source.slice(0, doc.root.start)}${open}>${added}</${doc.root.name}>${doc.source.slice(doc.root.end)}`);
        return ids;
      }
      splices.push({ start: doc.root.closeStart, end: doc.root.closeStart, text: added });
    }
    this.patch(name, splices);
    return ids;
  }

  /** Point an existing relationship somewhere else. */
  retargetRel(part: string, id: string, newTarget: string): void {
    const r = this.rel(part, id);
    if (!r) return;
    this.patch(part === '' ? '_rels/.rels' : relsNameOf(part), [{ start: r.at.targetStart, end: r.at.targetEnd, text: escapeXmlAttr(relativeTarget(part, newTarget)) }]);
  }

  private ensureRelsContentType(): void {
    const t = this.types();
    if (t.defaults.get('rels') === CONTENT_TYPE.rels) return;
    const p = t.doc.root.prefix ? `${t.doc.root.prefix}:` : '';
    const first = kids(t.doc.root)[0];
    const at = first ? first.start : t.doc.root.closeStart;
    this.patch('[Content_Types].xml', [{ start: at, end: at, text: `<${p}Default Extension="rels" ContentType="${CONTENT_TYPE.rels}"/>` }]);
  }

  /** The presentation part named by the package's own relationships, and what kind of file this is. */
  mainPart(): { part: string; contentType: string } {
    const rel = this.rels('').find((r) => !r.external && REL_OFFICE_DOCUMENT.includes(r.type));
    if (!rel?.target || !this.has(rel.target)) throw new PptxError('not_a_presentation', 'This is not a PowerPoint file.');
    const contentType = this.contentType(rel.target) ?? '';
    return { part: rel.target, contentType };
  }

  /**
   * Every part reachable from the package's own relationships (and the bookkeeping parts that are never targets).
   * Used after slides are deleted, to leave nothing behind that the new file no longer refers to.
   */
  reachable(): Set<string> {
    const seen = new Set<string>();
    const queue: string[] = [''];
    while (queue.length) {
      const part = queue.pop()!;
      for (const r of this.rels(part)) {
        if (r.external || !r.target || seen.has(r.target) || !this.has(r.target)) continue;
        seen.add(r.target);
        queue.push(r.target);
      }
    }
    const keep = new Set<string>();
    for (const name of this.names()) {
      if (name === '[Content_Types].xml') {
        keep.add(name);
        continue;
      }
      const owner = ownerOfRels(name);
      if (owner !== null ? owner === '' || seen.has(owner) : seen.has(name)) keep.add(name);
    }
    return keep;
  }
}

/** The next free `…/name<N>.ext` in a folder (`ppt/slides/slide`, `.xml` → `ppt/slides/slide12.xml`). */
export function nextPartName(pkg: PptxPackage, stem: string, ext: string, taken: Set<string> = new Set()): string {
  let max = 0;
  const lowerStem = stem.toLowerCase();
  for (const name of [...pkg.names(), ...taken]) {
    const lower = name.toLowerCase();
    if (!lower.startsWith(lowerStem) || !lower.endsWith(ext.toLowerCase())) continue;
    const mid = name.slice(stem.length, name.length - ext.length);
    if (/^\d{1,9}$/.test(mid)) max = Math.max(max, Number(mid));
  }
  let n = max + 1;
  while (pkg.has(`${stem}${n}${ext}`) || taken.has(`${stem}${n}${ext}`)) n++;
  return `${stem}${n}${ext}`;
}
