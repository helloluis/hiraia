/**
 * The little of ZIP a PowerPoint file needs, on Node built-ins only (no new dependency on the host).
 *
 * Reader: central directory, stored and deflated entries, sizes and CRC-32 checked, with a ceiling on what one
 * archive may inflate to (a deck is a few megabytes; anything claiming far more is refused before it is read).
 * Writer: deflate (PNG parts are stored: they are already compressed), no folder entries (cloud drives have
 * refused decks with them), entry order kept, one fixed timestamp, so the same input always gives the same bytes.
 * No ZIP64, no encryption, no multi-disk archives: none of them occur in a deck.
 */
import { deflateRawSync, inflateRawSync } from 'node:zlib';

export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipError';
  }
}

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_END = 0x06054b50;
/** 1 January 2026, 00:00:00 in DOS date/time (the pack renderer uses the same day). */
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;
const DOS_TIME = 0;

export const ZIP_LIMITS = {
  /** Most bytes one archive may inflate to in total. */
  inflatedBytes: 80 * 1024 * 1024,
  entries: 5000,
} as const;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

interface CentralEntry {
  name: string;
  method: number;
  crc: number;
  compressedSize: number;
  size: number;
  localOffset: number;
}

export interface ZipArchive {
  /** Entry names in archive order (folder entries left out). */
  names: string[];
  has(name: string): boolean;
  /** The inflated bytes of an entry; throws ZipError for a missing or damaged one. */
  read(name: string): Uint8Array;
  /** An entry as UTF-8 text. */
  text(name: string): string;
}

/** Open an archive held in memory. Throws ZipError for anything that is not a plain, sane ZIP. */
export function readZip(
  input: Uint8Array,
  limits: { inflatedBytes?: number; entries?: number } = {}
): ZipArchive {
  const maxBytes = limits.inflatedBytes ?? ZIP_LIMITS.inflatedBytes;
  const maxEntries = limits.entries ?? ZIP_LIMITS.entries;
  const buf = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (buf.length < 22) throw new ZipError('Not a ZIP file.');
  // The end record is the last thing in the file, followed only by an optional comment (at most 65535 bytes).
  let end = -1;
  for (let i = buf.length - 22, stop = Math.max(0, buf.length - 22 - 0xffff); i >= stop; i--) {
    if (buf.readUInt32LE(i) === SIG_END && i + 22 + buf.readUInt16LE(i + 20) <= buf.length) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new ZipError('Not a ZIP file.');
  const disk = buf.readUInt16LE(end + 4);
  const diskCd = buf.readUInt16LE(end + 6);
  const count = buf.readUInt16LE(end + 10);
  const cdSize = buf.readUInt32LE(end + 12);
  const cdOffset = buf.readUInt32LE(end + 16);
  if (disk !== 0 || diskCd !== 0 || count !== buf.readUInt16LE(end + 8))
    throw new ZipError('Multi-part ZIP files are not supported.');
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff)
    throw new ZipError('ZIP64 files are not supported.');
  if (count > maxEntries) throw new ZipError('This ZIP file has too many entries.');
  if (cdOffset + cdSize > end) throw new ZipError('The ZIP directory is damaged.');

  const entries = new Map<string, CentralEntry>();
  const names: string[] = [];
  let declared = 0;
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > end || buf.readUInt32LE(p) !== SIG_CENTRAL)
      throw new ZipError('The ZIP directory is damaged.');
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const compressedSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    if (p + 46 + nameLen + extraLen + commentLen > end)
      throw new ZipError('The ZIP directory is damaged.');
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue; // a folder entry carries nothing
    if (flags & 0x1) throw new ZipError('Encrypted ZIP files are not supported.');
    if (method !== 0 && method !== 8)
      throw new ZipError('This ZIP file uses a compression method that is not supported.');
    if (compressedSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff)
      throw new ZipError('ZIP64 files are not supported.');
    declared += size;
    if (declared > maxBytes)
      throw new ZipError('This ZIP file would unpack to more than is allowed.');
    if (!entries.has(name)) names.push(name);
    entries.set(name, { name, method, crc, compressedSize, size, localOffset });
  }

  const read = (name: string): Uint8Array => {
    const e = entries.get(name);
    if (!e) throw new ZipError(`The ZIP file has no entry "${name}".`);
    const h = e.localOffset;
    if (h + 30 > buf.length || buf.readUInt32LE(h) !== SIG_LOCAL)
      throw new ZipError('A ZIP entry is damaged.');
    const start = h + 30 + buf.readUInt16LE(h + 26) + buf.readUInt16LE(h + 28);
    if (start + e.compressedSize > buf.length) throw new ZipError('A ZIP entry is damaged.');
    const raw = buf.subarray(start, start + e.compressedSize);
    let out: Buffer;
    if (e.method === 0) {
      out = Buffer.from(raw);
    } else {
      try {
        // Never inflate past what the directory declared (already counted against the archive ceiling).
        out = inflateRawSync(raw, { maxOutputLength: Math.max(1, e.size) });
      } catch {
        throw new ZipError('A ZIP entry is damaged.');
      }
    }
    if (out.length !== e.size || crc32(out) !== e.crc)
      throw new ZipError('A ZIP entry is damaged.');
    return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
  };

  return {
    names,
    has: (name) => entries.has(name),
    read,
    text: (name) => Buffer.from(read(name)).toString('utf8'),
  };
}

export interface ZipInput {
  /** Forward slashes, no leading slash, never a folder. */
  name: string;
  data: Uint8Array | string;
}

/** Build an archive. Entries are written in the order given; a name may appear only once. */
export function writeZip(files: ZipInput[]): Uint8Array {
  if (files.length > 0xfffe) throw new ZipError('Too many entries for a ZIP file.');
  const seen = new Set<string>();
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    if (
      !f.name ||
      f.name.startsWith('/') ||
      f.name.endsWith('/') ||
      f.name.includes('\\') ||
      f.name.split('/').includes('..')
    )
      throw new ZipError(`"${f.name}" is not a valid ZIP entry name.`);
    if (seen.has(f.name)) throw new ZipError(`"${f.name}" appears twice.`);
    seen.add(f.name);
    const name = Buffer.from(f.name, 'utf8');
    const data =
      typeof f.data === 'string'
        ? Buffer.from(f.data, 'utf8')
        : Buffer.from(f.data.buffer, f.data.byteOffset, f.data.byteLength);
    // PNG is already deflated inside: storing it costs no size and no time.
    const store = data.length === 0 || /\.(png|jpe?g|webp)$/i.test(f.name);
    const body = store ? data : deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    // Bit 11: the name is UTF-8 (only set when it is not plain ASCII).
    // eslint-disable-next-line no-control-regex
    const flags = /^[\x00-\x7f]*$/.test(f.name) ? 0 : 0x0800;
    const method = store ? 0 : 8;
    if (offset > 0xfffffffe || data.length > 0xfffffffe || body.length > 0xfffffffe)
      throw new ZipError('Too large for a ZIP file.');

    const local = Buffer.alloc(30);
    local.writeUInt32LE(SIG_LOCAL, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, name, body);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(SIG_CENTRAL, 0);
    dir.writeUInt16LE(20, 4); // made by: 2.0, MS-DOS attributes
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(flags, 8);
    dir.writeUInt16LE(method, 10);
    dir.writeUInt16LE(DOS_TIME, 12);
    dir.writeUInt16LE(DOS_DATE, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(body.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, name);
    offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(central);
  if (offset + cd.length > 0xfffffffe) throw new ZipError('Too large for a ZIP file.');
  const end = Buffer.alloc(22);
  end.writeUInt32LE(SIG_END, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  const out = Buffer.concat([...chunks, cd, end]);
  return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
}
