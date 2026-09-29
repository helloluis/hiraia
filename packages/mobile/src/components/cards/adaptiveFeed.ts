/** Window dimensions are dp, not physical display pixels or a device-name heuristic. */
export function feedViewport(width: number, fontScale = 1, screenReader = false) {
  const horizontal = width >= 840;
  const gap = 16;
  const available = Math.max(0, width - 32);
  const minimum = 304 * Math.max(1, fontScale);
  const columns = !horizontal || screenReader ? 1
    : (available - gap * 3) / 3.5 >= minimum ? 3.5
    : (available - gap * 2) / 2.5 >= minimum ? 2.5
    : (available - gap) / 1.5 >= minimum ? 1.5 : 1;
  const cardWidth = columns === 1 ? Math.min(available, Math.max(640, minimum))
    : (available - gap * Math.floor(columns)) / columns;
  return { horizontal, columns, cardWidth, stride: cardWidth + gap,
    // Keep earlier full cards beside the current one. Only one future page is
    // knowable: a quiz, recap or branch may intercept the next turn. Never advance
    // the curriculum or invent read evidence just to fill an empty column.
    anchor: Math.max(0, Math.floor(columns) - 1) };
}

export function railOffset(index: number, stride: number, anchor: number) {
  return Math.max(0, index - anchor) * stride;
}

export function railDestination(offset: number, startOffset: number, startIndex: number,
  stride: number, count: number, canAdvance: boolean) {
  if (stride <= 0 || count <= 0 || !Number.isFinite(offset)) return { index: 0, advance: false };
  const delta = Math.round((offset - startOffset) / stride);
  const index = Math.max(0, Math.min(count - (canAdvance ? 0 : 1), startIndex + delta));
  return { index, advance: canAdvance && index === count };
}
