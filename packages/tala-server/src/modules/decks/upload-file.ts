/**
 * An uploaded PowerPoint file as bytes: is it one at all, reading it into the pure engine in
 * `@hiraia/tala-core/pptx`, and writing the edited file back out.
 *
 * Writing is where "nothing is silently flattened" is kept: every part the edit did not touch is carried over as
 * the very bytes stored in the uploaded archive (still compressed, same CRC), and only changed or new parts are
 * compressed afresh. The uploaded file itself is never modified; it is stored and served as it arrived.
 */
import { createHash } from 'node:crypto';
import {
  applyEdits,
  asPptxError,
  inspectDeck,
  PptxError,
  PptxPackage,
  type ApplyReport,
  type DeckEdits,
  type DeckInspection,
} from '@hiraia/tala-core/pptx';
import { readZip, writeZip, ZipError, type ZipArchive, type ZipInput } from './zip';

export const UPLOAD_ZIP_LIMITS = {
  /** Most an uploaded deck may inflate to (decks are mostly pictures, which barely compress). */
  inflatedBytes: 400 * 1024 * 1024,
  entries: 4000,
  /** A text part (XML, relationships) larger than this is not a slide deck's. */
  xmlPartBytes: 24 * 1024 * 1024,
  /** Inflated bytes ÷ file bytes above which the archive is refused (what a deck of blank pictures reaches is far lower). */
  ratio: 200,
} as const;

export const sha256Hex = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

export type UploadRefusal =
  | PptxError['code']
  | 'not_a_zip'
  | 'old_powerpoint'
  | 'password_protected'
  | 'pdf'
  | 'zip_bomb'
  | 'empty';

export class UploadRefused extends Error {
  constructor(public readonly reason: UploadRefusal) {
    super(reason);
    this.name = 'UploadRefused';
  }
}

/** What the first bytes say the file is, before anything is unpacked. */
function sniff(bytes: Uint8Array): void {
  if (bytes.length < 4) throw new UploadRefused('empty');
  const b = bytes;
  if (b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05) && (b[3] === 0x04 || b[3] === 0x06)) return;
  // OLE2 compound file: a .ppt from PowerPoint 97–2003, or a password-protected .pptx (which is wrapped in one).
  if (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) {
    const head = Buffer.from(b.buffer, b.byteOffset, Math.min(b.byteLength, 1 << 16)).toString('latin1');
    // Stream names in a compound file are UTF-16: "EncryptedPackage" appears with a zero byte after each letter.
    throw new UploadRefused(head.includes('E\u0000n\u0000c\u0000r\u0000y\u0000p\u0000t\u0000e\u0000d\u0000P\u0000a\u0000c\u0000k\u0000a\u0000g\u0000e') ? 'password_protected' : 'old_powerpoint');
  }
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) throw new UploadRefused('pdf');
  throw new UploadRefused('not_a_zip');
}

function openArchive(bytes: Uint8Array): ZipArchive {
  sniff(bytes);
  let zip: ZipArchive;
  try {
    zip = readZip(bytes, { inflatedBytes: UPLOAD_ZIP_LIMITS.inflatedBytes, entries: UPLOAD_ZIP_LIMITS.entries });
  } catch (err) {
    if (err instanceof ZipError && /unpack to more/.test(err.message)) throw new UploadRefused('zip_bomb');
    if (err instanceof ZipError && /too many entries/.test(err.message)) throw new UploadRefused('too_many_parts');
    throw new UploadRefused(err instanceof ZipError && /Encrypted/.test(err.message) ? 'password_protected' : 'not_a_zip');
  }
  if (zip.declaredBytes > Math.max(bytes.length, 1024 * 1024) * UPLOAD_ZIP_LIMITS.ratio) throw new UploadRefused('zip_bomb');
  return zip;
}

/** The archive as a package: parts are inflated only when the engine asks for them, and text parts are size-capped. */
function packageOf(zip: ZipArchive): PptxPackage {
  return new PptxPackage({
    names: zip.names,
    read: (name) => {
      const isText = /\.(xml|rels|vml)$/i.test(name);
      if (isText && zip.raw(name).size > UPLOAD_ZIP_LIMITS.xmlPartBytes) throw new PptxError('too_large', 'A part of this file is too large to read.');
      try {
        return zip.read(name);
      } catch {
        throw new PptxError('damaged', 'A part of this file is damaged.');
      }
    },
  });
}

const refusal = (err: unknown): UploadRefused => (err instanceof UploadRefused ? err : new UploadRefused(asPptxError(err).code));

/** Read an uploaded file. Throws UploadRefused (with a reason) for anything that is not a deck this version takes. */
export function readUploadedDeck(bytes: Uint8Array): DeckInspection {
  try {
    return inspectDeck(packageOf(openArchive(bytes)));
  } catch (err) {
    throw refusal(err);
  }
}

/**
 * The uploaded file with the edits applied. Deterministic: the same file and edits always give the same bytes.
 * With no edits at all the result has exactly the uploaded parts (same names, order, stored bytes).
 */
export function writeEditedDeck(bytes: Uint8Array, edits: DeckEdits): { pptx: Uint8Array; report: ApplyReport } {
  try {
    const zip = openArchive(bytes);
    const pkg = packageOf(zip);
    const report = applyEdits(pkg, edits);
    const files: ZipInput[] = pkg.names().map((name) => (pkg.isChanged(name) ? { name, data: pkg.bytes(name) } : { name, raw: zip.raw(name) }));
    // `[Content_Types].xml` first, as Office writes it (some viewers insist on it).
    files.sort((a, b) => Number(b.name === '[Content_Types].xml') - Number(a.name === '[Content_Types].xml'));
    return { pptx: writeZip(files), report };
  } catch (err) {
    throw refusal(err);
  }
}
