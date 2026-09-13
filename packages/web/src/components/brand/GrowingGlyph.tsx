import geometry from './brand.generated.json';

/** Same geometry, 125px size and 2.4s seed-to-pages sequence as native TitleScreen. */
export function GrowingGlyph({ className = '' }: { className?: string }) {
  return <svg className={`brand-growing-glyph ${className}`} viewBox="0 0 40 40" aria-hidden="true">
    <circle cx="20" cy="37" r="2" fill="#E9B949" />
    {geometry.layers.map((d, index) => <path key={d} d={d} className={`brand-growth-${2 - index}`}
      fill="none" stroke="#E9B949" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />)}
  </svg>;
}

export function BrandLoadingScreen() {
  return <div className="demo-brand-loader" role="status" aria-label="Loading Hiraia">
    <GrowingGlyph /><span className="sr-only">Loading Hiraia…</span>
  </div>;
}
