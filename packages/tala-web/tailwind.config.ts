import type { Config } from 'tailwindcss';
import { colors, sizes } from '../tala-core/src/tokens';

/**
 * Every colour is a CSS variable written by src/theme/css.ts from @hiraia/tala-core/tokens (BRAND-2).
 * Nothing here is a literal colour.
 */
// Solid (#RRGGBB) tokens are exposed as `rgb(var(--c-x-rgb) / <alpha-value>)` so Tailwind's opacity modifiers
// (`bg-cream/95`, `bg-forest/50`) actually produce a colour. With a bare `var(--c-x)` those classes compile to
// nothing, which silently dropped the header background and the sheet backdrop. Tokens that already carry
// their own alpha (rgba) stay plain variables.
const colorVars = Object.fromEntries(
  Object.entries(colors).map(([k, v]) => [
    k,
    /^#[0-9a-f]{6}$/i.test(v) ? `rgb(var(--c-${k}-rgb) / <alpha-value>)` : `var(--c-${k})`,
  ])
);

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    screens: { wide: `${sizes.wideBreakpoint}px` },
    colors: { transparent: 'transparent', current: 'currentColor', ...colorVars },
    fontFamily: { display: 'var(--font-display)', body: 'var(--font-body)' },
    borderRadius: { none: '0', sm: 'var(--radius-sm)', DEFAULT: 'var(--radius)', lg: '1.25rem', xl: '1.75rem', full: '9999px' },
    extend: {
      minHeight: { touch: 'var(--touch)' },
      minWidth: { touch: 'var(--touch)' },
      fontSize: {
        body: ['var(--text-body)', { lineHeight: 'var(--lh-body)' }],
        small: ['var(--text-small)', { lineHeight: '1.4' }],
        title: ['var(--text-title)', { lineHeight: '1.25' }],
        display: ['var(--text-display)', { lineHeight: '1.2' }],
        /* Editorial scale (library, packs, This Week): size says importance. */
        kicker: ['0.78125rem', { lineHeight: '1.2', letterSpacing: '0.12em', fontWeight: '700' }],
        read: ['1.0625rem', { lineHeight: '1.65' }],
        lead: ['1.25rem', { lineHeight: '1.5' }],
        headline: ['clamp(1.5rem, 1.2rem + 1.2vw, 2rem)', { lineHeight: '1.15' }],
        quote: ['clamp(1.375rem, 1.05rem + 1.5vw, 1.875rem)', { lineHeight: '1.25' }],
        hero: ['clamp(2rem, 1.2rem + 3.4vw, 3.25rem)', { lineHeight: '1.08' }],
      },
      boxShadow: {
        card: '0 1px 2px rgb(var(--c-forest-rgb) / 0.06), 0 6px 20px rgb(var(--c-forest-rgb) / 0.06)',
        lift: '0 2px 4px rgb(var(--c-forest-rgb) / 0.08), 0 14px 34px rgb(var(--c-forest-rgb) / 0.13)',
      },
      maxWidth: { measure: '42rem' },
      spacing: { touch: 'var(--touch)', gap: 'var(--touch-gap)' },
    },
  },
  plugins: [],
} satisfies Config;
