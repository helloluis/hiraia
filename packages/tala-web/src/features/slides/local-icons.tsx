/**
 * A few marks the slides screens need that the shared icon family (@/components/icons) does not have yet.
 * Same grid and stroke (24 px, 1.75 px round strokes, currentColor) so they can be folded into it later.
 */
import type { ReactNode } from 'react';

const MARKS = {
  redo: (
    <>
      <path d="m16 5 4 4-4 4" />
      <path d="M20 9H10a6 6 0 0 0 0 12h3" />
    </>
  ),
  dots: (
    <>
      <circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none" />
    </>
  ),
  cloudOff: (
    <>
      <path d="M8.5 18.5H7a4.5 4.5 0 0 1-1.6-8.7M10 6.1a6 6 0 0 1 7.6 4.45A4 4 0 0 1 19.6 17.6" />
      <path d="M4 4l16 16" />
    </>
  ),
  spinner: <path d="M12 3a9 9 0 1 0 9 9" />,
} satisfies Record<string, ReactNode>;

export type LocalIconName = keyof typeof MARKS;

export function LocalIcon({ name, size = 20, className }: { name: LocalIconName; size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className ? `shrink-0 ${className}` : 'shrink-0'}
    >
      {MARKS[name]}
    </svg>
  );
}
