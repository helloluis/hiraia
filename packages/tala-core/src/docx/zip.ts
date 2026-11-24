/**
 * The smallest ZIP writer a Word document needs: entries stored as they are (no compression), UTF-8 names, a fixed
 * timestamp so the same plan always gives the same bytes. Pure: runs in the browser, on the phone and in Node.
 */
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

export const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

/** 1 January 1980, midnight: the earliest date the format can say. */
const DOS_DATE = 0x0021;
const DOS_TIME = 0;

export function zipStore(entries: ZipEntry[]): Uint8Array {
  const names = entries.map((e) => utf8(e.name));
  const crcs = entries.map((e) => crc32(e.data));
  const localSize = entries.reduce((n, e, i) => n + 30 + names[i]!.length + e.data.length, 0);
  const centralSize = entries.reduce((n, _e, i) => n + 46 + names[i]!.length, 0);
  const out = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(out.buffer);
  const offsets: number[] = [];
  let at = 0;
  entries.forEach((e, i) => {
    offsets.push(at);
    view.setUint32(at, 0x04034b50, true);
    view.setUint16(at + 4, 20, true); // version needed
    view.setUint16(at + 6, 0x0800, true); // names are UTF-8
    view.setUint16(at + 8, 0, true); // stored
    view.setUint16(at + 10, DOS_TIME, true);
    view.setUint16(at + 12, DOS_DATE, true);
    view.setUint32(at + 14, crcs[i]!, true);
    view.setUint32(at + 18, e.data.length, true);
    view.setUint32(at + 22, e.data.length, true);
    view.setUint16(at + 26, names[i]!.length, true);
    view.setUint16(at + 28, 0, true);
    out.set(names[i]!, at + 30);
    out.set(e.data, at + 30 + names[i]!.length);
    at += 30 + names[i]!.length + e.data.length;
  });
  const centralStart = at;
  entries.forEach((e, i) => {
    view.setUint32(at, 0x02014b50, true);
    view.setUint16(at + 4, 20, true); // version made by
    view.setUint16(at + 6, 20, true); // version needed
    view.setUint16(at + 8, 0x0800, true);
    view.setUint16(at + 10, 0, true);
    view.setUint16(at + 12, DOS_TIME, true);
    view.setUint16(at + 14, DOS_DATE, true);
    view.setUint32(at + 16, crcs[i]!, true);
    view.setUint32(at + 20, e.data.length, true);
    view.setUint32(at + 24, e.data.length, true);
    view.setUint16(at + 28, names[i]!.length, true);
    // extra, comment, disk, internal attributes: 0
    view.setUint32(at + 38, 0, true); // external attributes
    view.setUint32(at + 42, offsets[i]!, true);
    out.set(names[i]!, at + 46);
    at += 46 + names[i]!.length;
  });
  view.setUint32(at, 0x06054b50, true);
  view.setUint16(at + 8, entries.length, true);
  view.setUint16(at + 10, entries.length, true);
  view.setUint32(at + 12, at - centralStart, true);
  view.setUint32(at + 16, centralStart, true);
  return out;
}
