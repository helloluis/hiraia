export interface ImageEntry { slug: string; bytes: number; md5: string }
export interface ImagePack { id: string; cell: string; filename: string; bytes: number; unpackedBytes: number; md5: string; images: number }
export function headerLength(prefix: Uint8Array): number {
  if (prefix.length !== 12 || String.fromCharCode(...prefix.subarray(0, 8)) !== 'HIRAIMG1') throw new Error('Invalid image package');
  const size = new DataView(prefix.buffer, prefix.byteOffset, prefix.byteLength).getUint32(8, true);
  if (size < 2 || size > 300000) throw new Error('Invalid image header size');
  return size;
}
export function parseEntries(header: Uint8Array, pack: ImagePack): ImageEntry[] {
  let text = '';
  for (let i=0; i<header.length; i+=8192) text += String.fromCharCode(...header.subarray(i,i+8192));
  const rows: unknown = JSON.parse(text).images;
  if (!Array.isArray(rows) || rows.length !== pack.images || rows.length > 1200) throw new Error('Invalid image count');
  const seen = new Set<string>(); let total = 0;
  for (const row of rows) {
    if (!row || typeof row.slug !== 'string' || row.slug.length > 180 || !/^[\p{L}\p{N}_-]+$/u.test(row.slug) || seen.has(row.slug) ||
        !Number.isSafeInteger(row.bytes) || row.bytes < 8 || row.bytes > 2000000 || !/^[a-f0-9]{32}$/.test(row.md5)) throw new Error('Invalid image entry');
    seen.add(row.slug); total += row.bytes;
  }
  if (total !== pack.unpackedBytes || total + header.length + 12 !== pack.bytes) throw new Error('Invalid image payload length');
  return rows;
}
export function prioritize(packs: ImagePack[], grade: number): ImagePack[] {
  const rank = (p: ImagePack) => p.cell.startsWith(`g${grade}-`) ? 0 : p.cell === 'common' ? 1 : 2;
  return [...packs].sort((a,b)=>rank(a)-rank(b) || a.id.localeCompare(b.id));
}

/** Only common plus the selected grade, never the rest of the catalogue. */
export function requiredPacks(packs: ImagePack[], grade: number | null): ImagePack[] {
  return packs.filter(p => p.cell === 'common' || (grade != null && p.cell.startsWith(`g${grade}-`)))
    .sort((a,b) => Number(a.cell !== 'common') - Number(b.cell !== 'common') || a.id.localeCompare(b.id));
}
