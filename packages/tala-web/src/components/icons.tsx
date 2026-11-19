/**
 * One icon family for the whole app: 24 px grid, 1.75 px round strokes, drawn in `currentColor` so an icon always
 * takes the colour of the words beside it. No icon library (PRD §18.3): each icon is a few strokes kept here.
 * Icons are decoration beside a text label (aria-hidden); pass `title` only when an icon stands alone.
 */
import type { ReactNode, SVGProps } from 'react';

const P = (d: string) => <path d={d} />;

const ICONS = {
  /* navigation */
  calendar: (
    <>
      <rect x="3" y="4.5" width="18" height="16.5" rx="2.5" />
      {P('M8 2.5v4M16 2.5v4M3 10h18')}
    </>
  ),
  book: (
    <>
      {P('M12 6.5c-1.6-1.3-3.7-2-6.5-2H3v13.5h2.5c2.8 0 4.9.7 6.5 2 1.6-1.3 3.7-2 6.5-2H21V4.5h-2.5c-2.8 0-4.9.7-6.5 2Z')}
      {P('M12 6.5V20')}
    </>
  ),
  lessons: (
    <>
      {P('M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z')}
      {P('M14 3v5h5M9 13h6M9 17h6')}
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      {P('M2.5 20c.6-3.4 3.2-5.5 6.5-5.5s5.9 2.1 6.5 5.5')}
      {P('M16 4.8a3.5 3.5 0 0 1 0 6.4M18.5 14.9c1.6.9 2.7 2.6 3 5.1')}
    </>
  ),
  school: (
    <>
      {P('M3 21h18M5 21V10.5l7-5 7 5V21')}
      {P('M10 21v-5h4v5M12 5.5V2.5h3.5v2H12')}
      <circle cx="12" cy="11.5" r="1.4" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="2.8" />
      <circle cx="12" cy="12" r="6.6" />
      {P('M18.6 12h2.9M12 18.6v2.9M5.4 12H2.5M12 5.4V2.5M16.67 16.67l2.05 2.05M7.33 16.67l-2.05 2.05M7.33 7.33 5.28 5.28M16.67 7.33l2.05-2.05')}
    </>
  ),
  /* ideas and content */
  lightbulb: (
    <>
      {P('M9.5 18.5h5M10.5 21.5h3')}
      {P('M12 3a6 6 0 0 0-3.8 10.6c.7.6 1.3 1.5 1.3 2.4h5c0-.9.6-1.8 1.3-2.4A6 6 0 0 0 12 3Z')}
    </>
  ),
  flask: (
    <>
      {P('M9 3h6M10 3v6.5L4.8 18a2 2 0 0 0 1.7 3h11a2 2 0 0 0 1.7-3L14 9.5V3')}
      {P('M7.5 15h9')}
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.2" />
    </>
  ),
  checklist: P('M3.5 6.5 5 8l3-3M3.5 12.5 5 14l3-3M3.5 18.5 5 20l3-3M12 7h8.5M12 13h8.5M12 19h8.5'),
  speech: P('M4 5.5h16a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5h-8L7.5 21v-3.5H4A1.5 1.5 0 0 1 2.5 16V7A1.5 1.5 0 0 1 4 5.5Z'),
  learners: (
    <>
      <circle cx="12" cy="12" r="9" />
      {P('M8.5 14.5c.9 1.2 2.1 1.8 3.5 1.8s2.6-.6 3.5-1.8M9 9.6v.2M15 9.6v.2')}
    </>
  ),
  alert: (
    <>
      {P('M12 3.5 2.5 20h19L12 3.5Z')}
      {P('M12 10v4.5M12 17.1v.3')}
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      {P('M9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1.9-1.1 1.8M12 16.6v.3')}
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      {P('M12 11v5.5M12 7.4v.3')}
    </>
  ),
  pin: (
    <>
      {P('M12 21s7-6.2 7-11.5a7 7 0 1 0-14 0C5 14.8 12 21 12 21Z')}
      <circle cx="12" cy="9.5" r="2.5" />
    </>
  ),
  shield: (
    <>
      {P('M12 3 4.5 6v5.5c0 4.6 3 8 7.5 9.5 4.5-1.5 7.5-4.9 7.5-9.5V6L12 3Z')}
      {P('m8.8 12 2.4 2.4 4.2-4.6')}
    </>
  ),
  support: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3.5" />
      {P('m5.7 5.7 3.8 3.8M14.5 14.5l3.8 3.8M18.3 5.7l-3.8 3.8M9.5 14.5l-3.8 3.8')}
    </>
  ),
  challenge: P('M3 17l6-6 4 4 8-8M15 7h6v6'),
  timer: (
    <>
      {P('M10 2.5h4M12 14V9.5')}
      <circle cx="12" cy="14" r="7.5" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      {P('M12 7v5l3.5 2')}
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      {P('M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z')}
    </>
  ),
  /* slides and files */
  slides: (
    <>
      <rect x="3" y="4" width="18" height="12.5" rx="2" />
      {P('M12 16.5V20M8 20.5h8M7.5 8.5h5M7.5 12h8')}
    </>
  ),
  image: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.6" />
      {P('m4 17 5-5 4 4 2.5-2.5L20 18')}
    </>
  ),
  notes: (
    <>
      {P('M5 4h14a1 1 0 0 1 1 1v10l-5 5H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z')}
      {P('M15 20v-5h5M8 9h8M8 13h4')}
    </>
  ),
  file: (
    <>
      {P('M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z')}
      {P('M14 3v5h5')}
    </>
  ),
  download: P('M12 3.5v11.5M7 10.5l5 5 5-5M4 20h16'),
  printer: (
    <>
      {P('M7 8V3.5h10V8M7 17H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2')}
      <rect x="7" y="14" width="10" height="6.5" rx="1" />
    </>
  ),
  layers: (
    <>
      {P('m12 3 9 5-9 5-9-5 9-5Z')}
      {P('m3 12.5 9 5 9-5M3 17l9 5 9-5')}
    </>
  ),
  grid: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </>
  ),
  /* actions */
  pencil: (
    <>
      {P('M4 20l1-4.5L16.5 4a2.1 2.1 0 0 1 3 3L8 18.5 4 20Z')}
      {P('M14.5 6l3.5 3.5')}
    </>
  ),
  play: P('M7 4.5v15l12-7.5L7 4.5Z'),
  plus: P('M12 5v14M5 12h14'),
  copy: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      {P('M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2')}
    </>
  ),
  trash: P('M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5'),
  undo: (
    <>
      {P('M8 5 4 9l4 4')}
      {P('M4 9h10a6 6 0 0 1 0 12h-3')}
    </>
  ),
  restore: (
    <>
      {P('M4 4v5h5')}
      {P('M4.6 9A8 8 0 1 1 4 12.5')}
    </>
  ),
  expand: P('M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5'),
  eye: (
    <>
      {P('M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z')}
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      {P('m16 16 4.5 4.5')}
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="10" rx="2" />
      {P('M8 10.5V7.5a4 4 0 0 1 8 0v3')}
    </>
  ),
  flag: P('M5 21V4M5 4.5h11l-2 4 2 4H5'),
  star: P('m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.7l5.9-.8L12 3.5Z'),
  external: P('M14 4h6v6M20 4l-9 9M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10'),
  menu: P('M4 7h16M4 12h16M4 17h16'),
  /* marks */
  check: P('m5 12.5 4.5 4.5L19 7.5'),
  checkCircle: (
    <>
      <circle cx="12" cy="12" r="9" />
      {P('m8 12.5 3 3 5-6')}
    </>
  ),
  x: P('M6 6l12 12M18 6 6 18'),
  chevronRight: P('m9 5 7 7-7 7'),
  chevronLeft: P('m15 5-7 7 7 7'),
  chevronDown: P('m5 9 7 7 7-7'),
  chevronUp: P('m5 15 7-7 7 7'),
  arrowRight: P('M4 12h16M14 6l6 6-6 6'),
  arrowLeft: P('M20 12H4M10 6l-6 6 6 6'),
  arrowUp: P('M12 20V4M6 10l6-6 6 6'),
  arrowDown: P('M12 4v16M6 14l6 6 6-6'),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof ICONS;
export const ICON_NAMES = Object.keys(ICONS) as IconName[];

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  /** Pixel size (width and height). Default 20. */
  size?: number;
  /** Only for an icon that stands alone; otherwise the icon is hidden from screen readers. */
  title?: string;
}

export function Icon({ name, size = 20, title, strokeWidth = 1.75, className, ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
      className={className ? `shrink-0 ${className}` : 'shrink-0'}
      {...rest}
    >
      {ICONS[name]}
    </svg>
  );
}

/**
 * The Big Idea bulb: a drawn mark, not a UI glyph. Same stroke family as the icons, with a warm glow and rays, so
 * it reads as "the one thing to remember" at a glance. Colours come from the theme (yellow glow, forest line).
 */
export function BigIdeaBulb({ size = 64, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true" focusable="false" className={className ? `shrink-0 ${className}` : 'shrink-0'}>
      <circle cx="32" cy="32" r="31" fill="rgb(var(--c-yellow-rgb) / 0.28)" />
      <g fill="none" stroke="var(--c-gold)" strokeWidth="2.2" strokeLinecap="round">
        <path d="M32 6.5v4.5M13.6 13.6l3.2 3.2M50.4 13.6l-3.2 3.2M7 31h4.5M52.5 31H57" />
      </g>
      <path
        d="M32 15.5c-8.3 0-14.5 6.3-14.5 14 0 4.7 2.3 8.3 5.3 10.9 1.9 1.7 3.2 3.8 3.2 6.1h12c0-2.3 1.3-4.4 3.2-6.1 3-2.6 5.3-6.2 5.3-10.9 0-7.7-6.2-14-14.5-14Z"
        fill="var(--c-yellow)"
        stroke="var(--c-forest)"
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
      <path d="M27 51h10M28.5 55.5h7" fill="none" stroke="var(--c-forest)" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M27.5 39.5 30 32l2 4.5 2-4.5 2.5 7.5" fill="none" stroke="var(--c-forest)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" opacity="0.8" />
      <path d="M24.5 26.5c1-3.2 3.4-5.3 6.5-6" fill="none" stroke="var(--c-white)" strokeWidth="2.4" strokeLinecap="round" opacity="0.9" />
    </svg>
  );
}
