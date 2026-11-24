/**
 * An uploaded PowerPoint file as bytes: is it one at all, reading it into the pure engine in
 * `@hiraia/tala-core/pptx`, and writing the edited file back out.
 *
 * Writing is where "nothing is silently flattened" is kept: every part the edit did not touch is carried over as
 * the very bytes stored in the uploaded archive (still compressed, same CRC), and only changed or new parts are
 * compressed afresh. The uploaded file itself is never modified; it is stored and served as it arrived.
 *
 * Everything here works on a file a stranger sent, so every job has a budget for the whole of it (how much it may
 * unpack, parse and write), not only limits on its parts. And the web server never calls these functions on its
 * own thread: they run in a worker with a time limit and a memory limit of its own (upload-jobs.ts starts
 * upload-worker.mjs, which runs `runUploadJob` below). This file and what it imports are therefore written so
 * that Node can run them as they are: relative imports only, and no TypeScript-only syntax.
 */
import { createHash } from 'node:crypto';
import {
  applyEdits,
  asPptxError,
  inspectDeck,
  PptxError,
  PptxPackage,
  xmlBudget,
  type ApplyReport,
  type DeckEdits,
  type DeckInspection,
} from '@hiraia/tala-core/pptx';
import { readZip, writeZip, ZipError, type ZipArchive, type ZipInput } from './zip';

export const UPLOAD_ZIP_LIMITS = {
  /** Most an uploaded deck may inflate to (decks are mostly pictures, which barely compress). */
  inflatedBytes: 400 * 1024 * 1024,
  entries: 4000,
  /** A part the reader opens (slides, lists, notes: text, whatever its name ends in) larger than this is not a slide deck's. */
  partBytes: 8 * 1024 * 1024,
  /** Inflated bytes ÷ file bytes above which the archive is refused (what a deck of blank pictures reaches is far lower). */
  ratio: 200,
  /** What one job may unpack in all, counting a part again each time it is opened. */
  readBytes: 96 * 1024 * 1024,
  /** Nodes and characters one job may parse in all. The heaviest real deck in the corpus needs 640,000 and 7 million. */
  nodes: 2_000_000,
  chars: 64 * 1024 * 1024,
  /** New and changed parts one job may write, in bytes before they are packed. The heaviest edit of a real deck writes 7 MB. */
  writtenBytes: 24 * 1024 * 1024,
  /** The largest edited file written: the largest file taken, and room for what an edit adds. */
  outputBytes: 48 * 1024 * 1024,
} as const;

export const sha256Hex = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

export type UploadRefusal =
  | PptxError['code']
  | 'not_a_zip'
  | 'old_powerpoint'
  | 'password_protected'
  | 'pdf'
  | 'zip_bomb'
  | 'empty'
  | 'checksum_mismatch';

export class UploadRefused extends Error {
  readonly reason: UploadRefusal;
  constructor(reason: UploadRefusal) {
    super(reason);
    this.name = 'UploadRefused';
    this.reason = reason;
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
    if (err instanceof ZipError && /twice|two places|overlap/.test(err.message)) throw new UploadRefused('unsafe_part_name');
    throw new UploadRefused(err instanceof ZipError && /Encrypted/.test(err.message) ? 'password_protected' : 'not_a_zip');
  }
  if (zip.declaredBytes > Math.max(bytes.length, 1024 * 1024) * UPLOAD_ZIP_LIMITS.ratio) throw new UploadRefused('zip_bomb');
  return zip;
}

/**
 * The archive as a package for ONE job. Parts are inflated only when the engine asks for them; every part it asks
 * for is text, so every one has the same size limit whatever its name; and the job as a whole may unpack and parse
 * only so much.
 */
function packageOf(zip: ZipArchive): PptxPackage {
  let unpacked = 0;
  return new PptxPackage(
    {
      names: zip.names,
      read: (name) => {
        const size = zip.sizeOf(name);
        if (size > UPLOAD_ZIP_LIMITS.partBytes) throw new PptxError('too_large', 'A part of this file is too large to read.');
        unpacked += Math.max(0, size);
        if (unpacked > UPLOAD_ZIP_LIMITS.readBytes) throw new PptxError('too_large', 'This file is too large or too complex to read here.');
        try {
          return zip.read(name);
        } catch {
          throw new PptxError('damaged', 'A part of this file is damaged.');
        }
      },
    },
    { budget: xmlBudget(UPLOAD_ZIP_LIMITS.nodes, UPLOAD_ZIP_LIMITS.chars), writtenBytes: UPLOAD_ZIP_LIMITS.writtenBytes }
  );
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
    try {
      return { pptx: writeZip(files, { maxBytes: UPLOAD_ZIP_LIMITS.outputBytes }), report };
    } catch (err) {
      if (err instanceof ZipError && /larger than is allowed/.test(err.message)) throw new PptxError('too_large', 'These changes make the file too large to write here.');
      throw err;
    }
  } catch (err) {
    throw refusal(err);
  }
}

/* ---------------- one job, as the worker runs it ---------------- */

export type UploadJob =
  /** Read a file that has just arrived: its checksum first (when one was announced), then what it holds. */
  | { kind: 'read'; bytes: Uint8Array; sha256?: string }
  | { kind: 'write'; bytes: Uint8Array; edits: DeckEdits }
  /** Nothing to do: shows that a worker can start and load the reader. */
  | { kind: 'ping' };

export type UploadJobResult =
  /**
   * `bytes`: the file itself goes back to whoever stores it. `sha256`: its checksum taken AFTER it was read (when
   * one was announced), so that what is stored is known to be what was announced.
   */
  | { ok: true; kind: 'read'; inspection: DeckInspection; bytes: Uint8Array; sha256: string | null }
  | { ok: true; kind: 'write'; pptx: Uint8Array; report: ApplyReport }
  | { ok: true; kind: 'ping' }
  | { ok: false; reason: UploadRefusal };

/** Runs one job to a plain result. A refusal is a result, not an exception: only a fault of this code throws. */
export function runUploadJob(job: UploadJob): UploadJobResult {
  try {
    if (job.kind === 'ping') return { ok: true, kind: 'ping' };
    if (job.kind === 'read') {
      if (job.sha256 !== undefined && sha256Hex(job.bytes) !== job.sha256) return { ok: false, reason: 'checksum_mismatch' };
      const inspection = readUploadedDeck(job.bytes);
      return { ok: true, kind: 'read', inspection, bytes: job.bytes, sha256: job.sha256 !== undefined ? sha256Hex(job.bytes) : null };
    }
    return { ok: true, kind: 'write', ...writeEditedDeck(job.bytes, job.edits) };
  } catch (err) {
    if (err instanceof UploadRefused) return { ok: false, reason: err.reason };
    throw err;
  }
}
