import geometry from './brand.generated.json';

/** Outlined Fraunces: stable proportions with no font download or layout shift. */
export function Wordmark({ className = '' }: { className?: string }) {
  return <svg role="img" aria-label="hiraia" viewBox={`0 0 ${geometry.width} ${geometry.height}`}
    className={className} style={{ display: 'inline-block', height: '0.82em', width: `${geometry.width / 100}em`, verticalAlign: 'baseline', overflow: 'visible' }}>
    <path d={geometry.wordPath} fill="currentColor" />
    <g transform={`translate(${geometry.glyphX} 0) scale(.85)`}>
      {geometry.layers.map((d) => <path key={d} d={d} fill="none" stroke="#BD8928" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />)}
      <circle cx="20" cy="37" r="2" fill="#BD8928" />
    </g>
  </svg>;
}
