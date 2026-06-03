import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Wrap an SVG's drawing content in a turbulence-displacement filter ("rough" wobble).
// Text is left un-filtered (displacement makes type wavy/unreadable).
let uid = 0;
function roughen(svg, { freq = 0.018, scale = 3, octaves = 2 } = {}) {
  const id = `rough${uid++}`;
  const open = svg.slice(0, svg.indexOf('>', svg.indexOf('<svg')) + 1);
  let inner = svg.slice(open.length, svg.lastIndexOf('</svg>'));
  // pull <text> elements out so they stay crisp
  const texts = [];
  inner = inner.replace(/<text[\s\S]*?<\/text>/g, (m) => { texts.push(m); return ''; });
  const filter = `<defs><filter id="${id}" x="-15%" y="-15%" width="130%" height="130%">`
    + `<feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="${octaves}" seed="7" result="n"/>`
    + `<feDisplacementMap in="SourceGraphic" in2="n" scale="${scale}" xChannelSelector="R" yChannelSelector="G"/>`
    + `</filter></defs>`;
  return open + filter + `<g filter="url(#${id})">` + inner + `</g>` + texts.join('') + '</svg>';
}

const assets = [
  ['biology', 'carabao'],
  ['biology', 'tilapia'],
  ['biology', 'maya-bird'],
  ['physics', 'magnet-bar'],
];
const scene = readFileSync(join(__dirname, 'scene-foodchain.svg'), 'utf-8');

const cell = (label, svg) => `<figure class="c"><div class="a">${svg}</div><figcaption>${label}</figcaption></figure>`;

const assetRows = assets.map(([sub, id]) => {
  const svg = readFileSync(join(__dirname, sub, `${id}.svg`), 'utf-8');
  return `<div class="row">`
    + cell(`${id} — precise`, svg)
    + cell('wobble scale 2', roughen(svg, { scale: 2 }))
    + cell('wobble scale 4', roughen(svg, { scale: 4 }))
    + `</div>`;
}).join('');

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  body{font-family:Arial;margin:0;padding:24px;background:#fff;color:#1f2937}
  h1{font-size:19px;margin:0 0 16px}
  h2{font-size:14px;color:#555;margin:22px 0 8px}
  .row{display:flex;gap:14px;margin-bottom:10px}
  .c{margin:0;flex:1;border:1px solid #e3e7eb;border-radius:10px;padding:8px;text-align:center;background:#fcfdfe}
  .a{height:130px;display:flex;align-items:center;justify-content:center}
  .a svg{max-width:100%;max-height:130px}
  figcaption{font-size:11px;margin-top:6px;color:#666}
  .scenes{display:flex;gap:16px} .scenes .c .a{height:300px}.scenes .a svg{max-height:300px}
</style></head><body>
  <h1>Hand-drawn "wobble" via SVG displacement filter — applies to embedded assets too</h1>
  <h2>Individual assets: precise (left) vs filtered</h2>
  ${assetRows}
  <h2>Composed scene: precise vs wobble (text kept crisp)</h2>
  <div class="scenes">
    ${cell('precise', scene)}
    ${cell('wobble scale 3', roughen(scene, { scale: 3, freq: 0.016 }))}
  </div>
</body></html>`;

writeFileSync(join(__dirname, 'rough-demo.html'), html);
console.log('Wrote rough-demo.html');
