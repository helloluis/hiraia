import type { Config } from 'tailwindcss';
import { colors, sizes } from '../tala-core/src/tokens';

/**
 * Every colour is a CSS variable written by src/theme/css.ts from @hiraia/tala-core/tokens (BRAND-2).
 * Nothing here is a literal colour.
 */
const colorVars = Object.fromEntries(Object.keys(colors).map((k) => [k, `var(--c-${k})`]));

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    screens: { wide: `${sizes.wideBreakpoint}px` },
    colors: { transparent: 'transparent', current: 'currentColor', ...colorVars },
    fontFamily: { display: 'var(--font-display)', body: 'var(--font-body)' },
    borderRadius: { none: '0', sm: 'var(--radius-sm)', DEFAULT: 'var(--radius)', full: '9999px' },
    extend: {
      minHeight: { touch: 'var(--touch)' },
      minWidth: { touch: 'var(--touch)' },
      fontSize: {
        body: ['var(--text-body)', { lineHeight: 'var(--lh-body)' }],
        small: ['var(--text-small)', { lineHeight: '1.4' }],
        title: ['var(--text-title)', { lineHeight: '1.25' }],
        display: ['var(--text-display)', { lineHeight: '1.2' }],
      },
      spacing: { touch: 'var(--touch)', gap: 'var(--touch-gap)' },
    },
  },
  plugins: [],
} satisfies Config;
