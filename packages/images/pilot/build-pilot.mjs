import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { renderScene, AssetLibrary, setAssetLibrary } from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- 1. metadata for the pilot assets (write <id>.json next to each <id>.svg) ---
const META = {
  biology: {
    carabao: { name: 'Carabao (Kalabaw)', description: 'Philippine water buffalo, common farm mammal', tags: ['animal','mammal','farm','herbivore','philippines'], grades: ['K-3','4-6'], curriculum: ['S3LT-IIc-d-3'] },
    tilapia: { name: 'Tilapia', description: 'Common Philippine freshwater fish', tags: ['animal','fish','vertebrate','aquatic','philippines'], grades: ['K-3','4-6'], curriculum: ['S3LT-IIc-d-3'] },
    'rice-palay': { name: 'Rice plant (Palay)', description: 'Rice plant with drooping grain head, producer', tags: ['plant','crop','rice','producer','philippines'], grades: ['K-3','4-6'], curriculum: ['S3LT-IIe-f-8'] },
    'maya-bird': { name: 'Maya', description: 'Eurasian tree sparrow, common Philippine bird', tags: ['animal','bird','vertebrate','consumer','philippines'], grades: ['K-3','4-6'], curriculum: ['S3LT-IIc-d-3'] },
  },
  general: {
    'figure-stick-male': { name: 'Stick figure (male)', description: 'Male stick figure for labeling human diagrams', tags: ['human','figure','person','body','male'], grades: ['K-3','4-6'], curriculum: [] },
    'figure-stick-female': { name: 'Stick figure (female)', description: 'Female stick figure for labeling human diagrams', tags: ['human','figure','person','body','female'], grades: ['K-3','4-6'], curriculum: [] },
    thermometer: { name: 'Thermometer', description: 'Celsius lab thermometer for measuring temperature', tags: ['tool','measurement','temperature','weather','lab'], grades: ['4-6','7-9'], curriculum: [] },
  },
  physics: {
    'magnet-bar': { name: 'Bar magnet', description: 'Bar magnet with N/S poles and field lines', tags: ['magnet','force','poles','physics'], grades: ['4-6'], curriculum: [] },
  },
};

function viewBoxOf(svg) {
  const m = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
  return m ? [Number(m[1]), Number(m[2])] : [100, 100];
}

const allIds = [];
for (const [subject, items] of Object.entries(META)) {
  for (const [id, meta] of Object.entries(items)) {
    const svgPath = join(__dirname, subject, `${id}.svg`);
    const svg = readFileSync(svgPath, 'utf-8');
    const json = { id, name: meta.name, description: meta.description, subject, grades: meta.grades, tags: meta.tags, curriculum: meta.curriculum, source: 'hiraia', license: 'CC-BY-4.0', viewBox: viewBoxOf(svg) };
    writeFileSync(join(__dirname, subject, `${id}.json`), JSON.stringify(json, null, 2));
    allIds.push({ subject, id, svg, name: meta.name });
  }
}

// --- 2. load pilot library + render a composed scene (assets + drawn fallbacks) ---
const library = new AssetLibrary();
await library.load(__dirname);
setAssetLibrary(library);
console.log(`Loaded ${library.size} pilot assets`);

const scene = {
  version: 1,
  width: 620,
  height: 380,
  title: 'Food Chain sa Palayan (Rice Field)',
  caption: 'Pre-built assets (palay, maya, kalabaw, tilapia) + drawn sun, arrows & labels',
  style: { background: '#f7fbf2' },
  elements: [
    // ground + pond drawn as primitive fallback
    { type: 'rect', x: 0, y: 300, width: 620, height: 80, style: { fill: '#cfe8b5', stroke: 'none' } },
    { type: 'ellipse', cx: 110, cy: 330, rx: 95, ry: 30, style: { fill: '#bfe3f5', stroke: '#5a9bb8' } },
    // drawn sun (fallback — no sun asset retrieved)
    { type: 'circle', cx: 60, cy: 55, r: 24, style: { fill: '#fbbf24', stroke: '#b45309', strokeWidth: 2 } },
    { type: 'line', from: [60, 18], to: [60, 28], style: { stroke: '#fbbf24', strokeWidth: 3 } },
    { type: 'line', from: [24, 55], to: [34, 55], style: { stroke: '#fbbf24', strokeWidth: 3 } },
    { type: 'line', from: [34, 29], to: [41, 36], style: { stroke: '#fbbf24', strokeWidth: 3 } },
    { type: 'line', from: [86, 29], to: [79, 36], style: { stroke: '#fbbf24', strokeWidth: 3 } },
    { type: 'text', x: 60, y: 92, content: 'Araw', anchor: 'middle', style: { fontSize: 12, fontWeight: 'bold' } },
    // assets
    { type: 'asset', assetId: 'rice-palay', x: 150, y: 165 },
    { type: 'asset', assetId: 'maya-bird', x: 380, y: 30 },
    { type: 'asset', assetId: 'carabao', x: 410, y: 195 },
    { type: 'asset', assetId: 'tilapia', x: 45, y: 300, scale: 0.8 },
    // energy/food-flow arrows (drawn)
    { type: 'arrow', from: [88, 70], to: [170, 175], style: { strokeWidth: 2, stroke: '#444' } },
    { type: 'arrow', from: [235, 200], to: [385, 95], style: { strokeWidth: 2, stroke: '#444' } },
    { type: 'arrow', from: [245, 250], to: [410, 250], style: { strokeWidth: 2, stroke: '#444' } },
    // scene-level labels (crisp layer) — assets are label-free now
    { type: 'text', x: 200, y: 300, content: 'Palay', anchor: 'middle', style: { fontSize: 13, fontWeight: 'bold' } },
    { type: 'text', x: 200, y: 316, content: '(Producer)', anchor: 'middle', style: { fontSize: 10 } },
    { type: 'text', x: 440, y: 150, content: 'Maya', anchor: 'middle', style: { fontSize: 13, fontWeight: 'bold' } },
    { type: 'text', x: 440, y: 22, content: 'Consumer', anchor: 'middle', style: { fontSize: 13, fontWeight: 'bold' } },
    { type: 'text', x: 490, y: 325, content: 'Kalabaw', anchor: 'middle', style: { fontSize: 13, fontWeight: 'bold' } },
    { type: 'text', x: 100, y: 360, content: 'Tilapia', anchor: 'middle', style: { fontSize: 12, fontWeight: 'bold' } },
  ],
};

const result = renderScene(scene);
writeFileSync(join(__dirname, 'scene-foodchain.svg'), result.svg);
console.log(`Scene rendered: ${result.elementCount} elements, ${result.renderTimeMs.toFixed(2)}ms`);
if (result.warnings.length) console.log('Warnings:', result.warnings);

// --- 3. build an HTML gallery (contact sheet + composed scene) ---
// Render each asset THROUGH renderScene so the contact sheet shows the
// hand-drawn wobble exactly as it appears in real diagrams (raw assets on
// disk are clean — the sketch effect is applied at render time).
const cells = allIds.map(a => {
  const [w, h] = viewBoxOf(a.svg);
  const out = renderScene({
    version: 1, width: w, height: h,
    style: { background: '#fcfdfe' },
    elements: [{ type: 'asset', assetId: a.id, x: 0, y: 0 }],
  });
  return `
  <figure class="cell">
    <div class="art">${out.svg}</div>
    <figcaption>${a.id}<br><span>${a.subject}</span></figcaption>
  </figure>`;
}).join('');

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  body{font-family:Arial,Helvetica,sans-serif;margin:0;padding:24px;background:#fff;color:#1f2937}
  h1{font-size:20px;margin:0 0 4px} h2{font-size:15px;color:#555;margin:24px 0 10px;font-weight:600}
  p.sub{color:#666;margin:0 0 18px;font-size:13px}
  .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
  .cell{margin:0;border:1px solid #e3e7eb;border-radius:10px;padding:10px;text-align:center;background:#fcfdfe}
  .art{height:150px;display:flex;align-items:center;justify-content:center}
  .art svg{max-width:100%;max-height:150px}
  figcaption{font-size:12px;margin-top:8px;font-weight:bold}
  figcaption span{color:#8a9099;font-weight:normal}
  .scene{border:1px solid #e3e7eb;border-radius:10px;padding:14px;display:inline-block;background:#fcfdfe;margin-top:6px}
</style></head><body>
  <h1>Hiraia — pilot asset batch</h1>
  <p class="sub">8 hand-authored assets across biology / general / physics, in the existing house style. Below: a composed scene mixing assets with drawn fallbacks (sun, arrows, labels) — the hybrid render path.</p>
  <h2>Individual assets (contact sheet)</h2>
  <div class="grid">${cells}</div>
  <h2>Composed scene — assets + drawn fallback (real renderScene output)</h2>
  <div class="scene">${result.svg}</div>
</body></html>`;

writeFileSync(join(__dirname, 'gallery.html'), html);
console.log('Wrote gallery.html');
