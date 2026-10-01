import { createElement, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { View, type NativeSyntheticEvent, type ViewProps } from 'react-native';
type Props = ViewProps & {
  children?: ReactNode;
  enabled?: boolean;
  blockDescendantFocus?: boolean;
  onNavigate?: (event: NativeSyntheticEvent<{ direction: number }>) => void;
};
export function dismissKeyboardAfterBlur() {
  const focused = document.activeElement;
  if (focused instanceof HTMLElement && (focused.matches('input, textarea') || focused.isContentEditable)) focused.blur();
}
export function ReaderInput({ enabled, blockDescendantFocus, onNavigate, ...props }: Props) {
  const ref = useRef<View>(null);
  // RN Web filters unknown View props, including inert and onKeyDown. Attach
  // these DOM behaviours to its host ref so previews really leave Tab order.
  useLayoutEffect(() => {
    const element = ref.current as unknown as HTMLElement | null;
    if (element) element.inert = !!blockDescendantFocus;
  }, [blockDescendantFocus]);
  useEffect(() => {
    const element = ref.current as unknown as HTMLElement | null;
    if (!element) return;
    const keydown = (event: KeyboardEvent) => {
      const target = event.target;
      if (!enabled || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
        (target instanceof HTMLElement && (target.closest('input, textarea, select, [contenteditable="true"]') ||
          // A nested dialog owns its keys. A reader inside a modal (the exam)
          // still owns its own arrows.
          (target.closest('[role="dialog"]') && element.contains(target.closest('[role="dialog"]')))))) return;
      const direction = event.key === 'ArrowRight' || event.key === 'PageDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'PageUp' ? -1 : 0;
      if (!direction) return;
      event.preventDefault();
      onNavigate?.({ nativeEvent: { direction } } as NativeSyntheticEvent<{ direction: number }>);
    };
    element.addEventListener('keydown', keydown);
    return () => element.removeEventListener('keydown', keydown);
  }, [enabled, onNavigate]);
  return createElement(View, { ...props, ref });
}
