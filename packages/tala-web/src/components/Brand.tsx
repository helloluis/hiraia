/** Hiraia glyph + Tala wordmark, from the brand assets copied into public/brand. Server-safe. */
import { colors } from '@hiraia/tala-core/tokens';

export function HiraiaGlyph({ size = 28, title = 'Hiraia' }: { size?: number; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" role="img" aria-label={title}>
      <g fill="none" stroke={colors.gold} strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 4Q12 2 20 11Q28 2 35 4" />
        <path d="M10 14Q15 14 20 21Q25 14 30 14" />
        <path d="M15 25Q18 26 20 30Q22 26 25 25" />
      </g>
      <circle cx="20" cy="37" r="2" fill={colors.gold} />
    </svg>
  );
}

export function TalaWordmark({ height = 28 }: { height?: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/brand/tala-wordmark.svg" alt="Tala" height={height} style={{ height, width: 'auto' }} />;
}

export function BrandLockup({ byline }: { byline: string }) {
  return (
    <div className="flex items-center gap-3">
      <HiraiaGlyph size={32} />
      <div className="flex flex-col leading-tight">
        <TalaWordmark height={26} />
        <span className="text-small text-forestMuted">{byline}</span>
      </div>
    </div>
  );
}
