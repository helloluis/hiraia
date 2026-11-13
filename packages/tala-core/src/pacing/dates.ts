/** Gregorian civil arithmetic. No platform Date APIs or timezone conversions. */
export function ordinal(date: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error(`Invalid calendar date: ${date}`);
  const y = Number(match[1]), m = Number(match[2]), d = Number(match[3]);
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const lengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (y < 1 || m < 1 || m > 12 || d < 1 || d > lengths[m - 1]!) throw new Error(`Invalid calendar date: ${date}`);
  const p = y - 1;
  return 365 * p + Math.floor(p / 4) - Math.floor(p / 100) + Math.floor(p / 400) + lengths.slice(0, m - 1).reduce((a, b) => a + b, 0) + d - 1;
}
export function civil(day: number): string {
  let y = Math.max(1, Math.floor(day / 365.2425) + 1);
  while (ordinal(`${String(y).padStart(4, '0')}-01-01`) > day) y--;
  while (ordinal(`${String(y + 1).padStart(4, '0')}-01-01`) <= day) y++;
  let m = 1;
  while (m < 12 && ordinal(`${String(y).padStart(4, '0')}-${String(m + 1).padStart(2, '0')}-01`) <= day) m++;
  const prefix = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`;
  return `${prefix}-${String(day - ordinal(`${prefix}-01`) + 1).padStart(2, '0')}`;
}
export function weekday(date: string): number { return ordinal(date) % 7 + 1; }
export function datesBetween(from: string, to: string): string[] {
  const start = ordinal(from), end = ordinal(to);
  if (end - start > 3660) throw new Error('Calendar range exceeds ten years.');
  return Array.from({ length: Math.max(0, end - start + 1) }, (_, i) => civil(start + i));
}
