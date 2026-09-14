/** Reserve only an inward, mostly horizontal pull starting in the leftmost fifth. */
export function isHistoryPull(startX: number, dx: number, dy: number, width: number): boolean {
  'worklet';
  return width > 0 && startX >= 0 && startX <= width * 0.2 && dx > 0 && dx > Math.abs(dy);
}

/** Position on the screen, not distance travelled; velocity cannot bypass this gate. */
export function historyPullCommitted(startX: number, dx: number, width: number): boolean {
  'worklet';
  return width > 0 && startX + dx > width * 0.5;
}

/** The preview enters from the left; 70% transparent means 30% opacity. */
export function historyPreviewStyle(distance: number, width: number) {
  'worklet';
  return {
    opacity: distance > 0 ? 0.3 : 0,
    transform: [{ translateX: -width + Math.min(Math.max(distance, 0), width) }],
  };
}
