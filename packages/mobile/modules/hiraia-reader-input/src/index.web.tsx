import { createElement, type ReactNode } from 'react';
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
  return createElement(View, {
    ...props,
    // inert prevents offscreen previews from entering Tab / screen-reader traversal.
    ...(blockDescendantFocus ? { inert: '' } : {}),
    onKeyDown: (event: KeyboardEvent) => {
      const target = event.target;
      if (!enabled || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
        (target instanceof HTMLElement && (target.closest('input, textarea, select, [contenteditable="true"]') || target.closest('[role="dialog"]')))) return;
      const direction = event.key === 'ArrowRight' || event.key === 'PageDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'PageUp' ? -1 : 0;
      if (!direction) return;
      event.preventDefault();
      onNavigate?.({ nativeEvent: { direction } } as NativeSyntheticEvent<{ direction: number }>);
    },
  } as ViewProps);
}
