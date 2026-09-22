/** Native scroll offsets select history; only the single trailing slot advances the store. */
export function scrollDestination(
  offset: number,
  height: number,
  count: number,
  canAdvance: boolean
) {
  if (height <= 0 || count === 0 || !Number.isFinite(offset)) return { index: 0, advance: false };
  const index = Math.max(0, Math.min(count - (canAdvance ? 0 : 1), Math.round(offset / height)));
  return { index, advance: canAdvance && index === count };
}

export function rememberPage<T extends { key: string }>(pages: T[], page: T, limit = 31): T[] {
  const index = pages.findIndex((p) => p.key === page.key);
  if (index >= 0) return pages.map((p, i) => (i === index ? page : p));
  return [...pages, page].slice(-limit);
}
