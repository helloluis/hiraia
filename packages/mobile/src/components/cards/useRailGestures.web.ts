import { useEffect, useRef } from 'react';
import type { RailRef, RailGestures } from './useRailGestures';

/** RN Web emits scroll offsets but not Android drag/momentum lifecycle events. */
export function useRailGestures(ref: RailRef, enabled: boolean, height: number, handlers: RailGestures): void {
  const latest = useRef(handlers);
  latest.current = handlers;
  useEffect(() => {
    const node = ref.current?.getScrollableNode();
    if (!enabled || !(node instanceof HTMLElement)) return;
    let active = false;
    let pointer: { x: number; y: number } | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      if (!active) return;
      active = false;
      latest.current.end(node.scrollLeft);
    };
    const schedule = () => { clearTimeout(timer); timer = setTimeout(finish, 160); };
    const begin = () => { if (!active) { active = true; latest.current.begin(); } schedule(); };
    const wheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY) || (event.shiftKey && event.deltaY)) begin();
    };
    const down = (event: PointerEvent) => {
      pointer = { x: event.clientX, y: event.clientY };
      // Native scrollbar interaction has no touch-move phase.
      if (event.target === node) begin();
    };
    const move = (event: PointerEvent) => {
      if (!pointer) return;
      const x = Math.abs(event.clientX - pointer.x), y = Math.abs(event.clientY - pointer.y);
      if (x > 4 && x > y) begin();
    };
    const up = () => { pointer = null; if (active) schedule(); };
    const scroll = (event: Event) => { if (event.target === node && active) schedule(); };
    node.addEventListener('wheel', wheel, { passive: true });
    node.addEventListener('pointerdown', down, { passive: true });
    node.addEventListener('pointermove', move, { passive: true });
    node.addEventListener('pointerup', up, { passive: true });
    node.addEventListener('pointercancel', up, { passive: true });
    node.addEventListener('scroll', scroll, { passive: true });
    return () => {
      clearTimeout(timer);
      node.removeEventListener('wheel', wheel); node.removeEventListener('pointerdown', down);
      node.removeEventListener('pointermove', move); node.removeEventListener('pointerup', up);
      node.removeEventListener('pointercancel', up); node.removeEventListener('scroll', scroll);
    };
  }, [ref, enabled, height]);
}
