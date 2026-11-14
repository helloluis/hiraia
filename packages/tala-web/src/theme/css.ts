/**
 * The theme is GENERATED from @hiraia/tala-core/tokens (BRAND-2). Components use Tailwind classes or
 * CSS variables; no colour or font literal lives anywhere in this package.
 */
import { colors, fonts, sizes } from '@hiraia/tala-core/tokens';

export function themeCss(): string {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(colors)) {
    lines.push(`--c-${k}:${v};`);
    // Channel triplet for Tailwind opacity modifiers (see tailwind.config.ts).
    const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(v);
    if (hex)
      lines.push(
        `--c-${k}-rgb:${parseInt(hex[1]!, 16)} ${parseInt(hex[2]!, 16)} ${parseInt(hex[3]!, 16)};`
      );
  }
  lines.push(`--font-display:${fonts.displayWebStack};`);
  lines.push(`--font-body:${fonts.bodyWebStack};`);
  lines.push(`--text-body:${sizes.textBody}px;`);
  lines.push(`--text-small:${sizes.textSmall}px;`);
  lines.push(`--text-title:${sizes.textTitle}px;`);
  lines.push(`--text-display:${sizes.textDisplay}px;`);
  lines.push(`--lh-body:${sizes.lineHeightBody}px;`);
  lines.push(`--touch:${sizes.touchTarget}px;`);
  lines.push(`--touch-gap:${sizes.touchGap}px;`);
  lines.push(`--radius:${sizes.radius}px;`);
  lines.push(`--radius-sm:${sizes.radiusSmall}px;`);
  lines.push(`--wide:${sizes.wideBreakpoint}px;`);
  return `:root{${lines.join('')}}`;
}

export const THEME_COLOR = colors.talaTeal;
