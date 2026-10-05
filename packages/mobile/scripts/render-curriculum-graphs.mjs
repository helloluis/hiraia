// Original instructional diagram. Coordinates come from the lesson's data table.
// Run from any directory: node packages/mobile/scripts/render-curriculum-graphs.mjs
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';
const directory = new URL('../assets/curriculum/', import.meta.url);
mkdirSync(directory, { recursive: true });
const x = (t) => 90 + t * 120;
const y = (d) => 420 - d * 50;
const paths = [
  { label: 'A', values: [0, 0, 0, 0], color: '#222222', dash: '8 5' },
  { label: 'B', values: [0, 1, 2, 3], color: '#0072B2', dash: '' },
  { label: 'C', values: [0, 2, 4, 6], color: '#C44E00', dash: '' },
];
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
<rect width="512" height="512" fill="white"/>
<g font-family="sans-serif" font-size="21" fill="#111">
<text x="256" y="38" text-anchor="middle" font-size="23">Distance–time graph</text>
${Array.from({ length: 7 }, (_, d) => `<line x1="90" y1="${y(d)}" x2="450" y2="${y(d)}" stroke="#dddddd"/><text x="77" y="${y(d) + 7}" text-anchor="end">${d}</text>`).join('')}
${[0, 1, 2, 3].map((t) => `<line x1="${x(t)}" y1="120" x2="${x(t)}" y2="420" stroke="#dddddd"/><text x="${x(t)}" y="450" text-anchor="middle">${t}</text>`).join('')}
<path d="M90 100 V420 H470" fill="none" stroke="#111" stroke-width="2"/>
<text x="270" y="486" text-anchor="middle">Time (s)</text>
<text x="29" y="267" text-anchor="middle" transform="rotate(-90 29 267)">Distance travelled (m)</text>
${paths.map(({ label, values, color, dash }) => `<polyline points="${values.map((d, t) => `${x(t)},${y(d)}`).join(' ')}" fill="none" stroke="${color}" stroke-width="4" stroke-dasharray="${dash}"/>${values.map((d, t) => `<circle cx="${x(t)}" cy="${y(d)}" r="5" fill="${color}"/>`).join('')}<text x="468" y="${y(values[3]) + 6}" fill="${color}" font-weight="bold">${label}</text>`).join('')}
<text x="100" y="78" font-size="18">A: 0 m/s   B: 1 m/s   C: 2 m/s</text>
</g></svg>`;
writeFileSync(new URL('pilot-distance-time.svg', directory), svg);
await sharp(Buffer.from(svg)).png().toFile(new URL('pilot-distance-time.png', directory).pathname);
