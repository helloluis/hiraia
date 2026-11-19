/**
 * Reading a built deck: just enough to find its slides in order and the drawings it embeds.
 *
 * A drawing is a picture named `illustration <slug>` (the pack renderer names every drawing that way). The bytes
 * are returned exactly as embedded, which is the Hiraia-watermarked derivative: nothing here decodes, crops or
 * re-encodes an image, so the watermark always travels with it.
 */
import { createHash } from 'node:crypto';
import { readZip, ZipError, type ZipArchive } from './zip';

export interface DeckDrawing {
  slug: string;
  /** The picture's alt text in the deck. */
  alt: string;
  bytes: Uint8Array;
  sha256: string;
  width: number;
  height: number;
}

export const sha256Hex = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex');

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Pixel size from a PNG's header, or null when the bytes are not a PNG. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24 || PNG_SIGNATURE.some((b, i) => bytes[i] !== b)) return null;
  // The first chunk is always IHDR: length(4) "IHDR"(4) width(4) height(4), big-endian.
  if (String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!) !== 'IHDR') return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  return width > 0 && height > 0 && width <= 20000 && height <= 20000 ? { width, height } : null;
}

export const xmlUnescape = (s: string): string =>
  s.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|quot|apos|amp);/g, (_m, e: string) => {
    if (e === 'lt') return '<';
    if (e === 'gt') return '>';
    if (e === 'quot') return '"';
    if (e === 'apos') return "'";
    if (e === 'amp') return '&';
    const code = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  });

const attr = (tag: string, name: string): string | null => {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? xmlUnescape(m[1]!) : null;
};

/** `ppt/slides` + `../media/a.png` → `ppt/media/a.png`. */
export function resolvePart(baseDir: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const out = baseDir.split('/').filter(Boolean);
  for (const seg of target.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return out.join('/');
}

/** Relationship id → target part, for the part at `partName` (e.g. `ppt/slides/slide3.xml`). */
export function relationships(
  zip: ZipArchive,
  partName: string
): Map<string, { type: string; target: string }> {
  const slash = partName.lastIndexOf('/');
  const dir = partName.slice(0, slash);
  const relsName = `${dir}/_rels/${partName.slice(slash + 1)}.rels`;
  const out = new Map<string, { type: string; target: string }>();
  if (!zip.has(relsName)) return out;
  for (const tag of zip.text(relsName).match(/<Relationship\b[^>]*>/g) ?? []) {
    const id = attr(tag, 'Id');
    const target = attr(tag, 'Target');
    if (!id || !target || attr(tag, 'TargetMode') === 'External') continue;
    out.set(id, { type: attr(tag, 'Type') ?? '', target: resolvePart(dir, target) });
  }
  return out;
}

/** The deck's slide parts in presentation order (falls back to their numbers when the presentation part is unusual). */
export function slideParts(zip: ZipArchive): string[] {
  const byNumber = zip.names
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/(\d+)\.xml$/)![1]) - Number(b.match(/(\d+)\.xml$/)![1]));
  if (!zip.has('ppt/presentation.xml')) return byNumber;
  const rels = relationships(zip, 'ppt/presentation.xml');
  const ordered: string[] = [];
  const list =
    /<p:sldIdLst>([\s\S]*?)<\/p:sldIdLst>/.exec(zip.text('ppt/presentation.xml'))?.[1] ?? '';
  for (const tag of list.match(/<p:sldId\b[^>]*>/g) ?? []) {
    const target = rels.get(attr(tag, 'r:id') ?? '')?.target;
    if (target && zip.has(target)) ordered.push(target);
  }
  return ordered.length === byNumber.length ? ordered : byNumber;
}

/**
 * Every drawing a deck embeds, by slug: the first picture named `illustration <slug>` wins (a drawing shown on
 * several slides is embedded with the same bytes each time). Throws ZipError when the bytes are not a readable deck.
 */
export function readDeckDrawings(pptx: Uint8Array): Map<string, DeckDrawing> {
  const zip = readZip(pptx);
  const slides = slideParts(zip);
  if (!slides.length) throw new ZipError('This file has no slides.');
  const out = new Map<string, DeckDrawing>();
  for (const part of slides) {
    const xml = zip.text(part);
    let rels: ReturnType<typeof relationships> | null = null;
    for (const pic of xml.match(/<p:pic>[\s\S]*?<\/p:pic>/g) ?? []) {
      const props = /<p:cNvPr\b[^>]*>/.exec(pic)?.[0];
      const name = props ? attr(props, 'name') : null;
      if (!name?.startsWith('illustration ')) continue;
      const slug = name.slice('illustration '.length).trim();
      if (!slug || out.has(slug)) continue;
      const embed = /\br:embed="([^"]+)"/.exec(pic)?.[1];
      rels ??= relationships(zip, part);
      const target = embed ? rels.get(embed)?.target : undefined;
      if (!target || !zip.has(target)) continue;
      const bytes = zip.read(target);
      const size = pngSize(bytes);
      if (!size) continue;
      out.set(slug, {
        slug,
        alt: (props ? attr(props, 'descr') : null) ?? '',
        bytes,
        sha256: sha256Hex(bytes),
        width: size.width,
        height: size.height,
      });
    }
  }
  return out;
}
