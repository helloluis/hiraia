/** Client-generated ids (records are created offline; ids never come from the server). */
export function newId(): string {
  const c: Crypto | undefined = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c) c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

/** `YYYY-MM-DD` of a Date in local time (the school's local time on the teacher's device). */
export function isoDate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + n, 12));
  return dt.toISOString().slice(0, 10);
}

/** ISO weekday 1 = Monday … 7 = Sunday. */
export function weekdayOf(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  const w = new Date(Date.UTC(y!, m! - 1, d!, 12)).getUTCDay();
  return w === 0 ? 7 : w;
}

export function mondayOf(iso: string): string {
  return addDays(iso, 1 - weekdayOf(iso));
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function monthStart(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}
export function monthEnd(iso: string): string {
  const [y, m] = iso.split('-').map(Number);
  const last = new Date(Date.UTC(y!, m!, 0, 12)).getUTCDate();
  return `${iso.slice(0, 7)}-${String(last).padStart(2, '0')}`;
}
