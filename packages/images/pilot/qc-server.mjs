/**
 * Live QC gallery for Hiraia assets.
 *
 * Renders EVERY asset through renderScene (so you see the real hand-drawn
 * output, not the clean source), grouped by subject, with metadata + warnings.
 * Auto-reloads the browser the instant any .svg/.json changes — so you can
 * hand-edit an SVG in Boxy SVG / Inkscape and watch it update live.
 *
 *   npx tsx pilot/qc-server.mjs            # scans assets/ + pilot/
 *   npx tsx pilot/qc-server.mjs ../assets  # scan a specific root
 *
 * Then open http://localhost:5173
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, existsSync, watch, statSync } from 'node:fs';
import { join, dirname, basename, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { optimize } from 'svgo';
import { renderScene, AssetLibrary, setAssetLibrary } from '../src/index.js';
import svgoConfig from '../svgo.config.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(__dirname, '..');
const SUBJECTS = ['biology', 'chemistry', 'physics', 'earth-science', 'general'];
const PORT = 5173;

// Roots to scan: CLI arg, else both the curated library and the pilot batch.
const roots = process.argv.slice(2).map((p) => join(process.cwd(), p));
if (roots.length === 0) {
  for (const r of [join(pkgRoot, 'assets'), __dirname]) if (existsSync(r)) roots.push(r);
}

function viewBox(svg) {
  const m = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  return m ? [Number(m[1]), Number(m[2])] : [100, 100];
}

/** Scan every root for .svg files and pair them with metadata. */
function scan() {
  const items = [];
  for (const root of roots) {
    for (const subject of SUBJECTS) {
      const dir = join(root, subject);
      if (!existsSync(dir)) continue;
      for (const f of readdirSync(dir).filter((f) => f.endsWith('.svg'))) {
        const id = basename(f, '.svg');
        const svgPath = join(dir, f);
        const jsonPath = join(dir, `${id}.svg`.replace('.svg', '.json'));
        let meta = null, metaError = null;
        if (existsSync(jsonPath)) {
          try { meta = JSON.parse(readFileSync(jsonPath, 'utf8')); }
          catch (e) { metaError = String(e.message || e); }
        }
        items.push({ id, subject, svgPath, jsonPath, svg: readFileSync(svgPath, 'utf8'), meta, metaError,
          rel: relative(pkgRoot, svgPath) });
      }
    }
  }
  return items.sort((a, b) => a.subject.localeCompare(b.subject) || a.id.localeCompare(b.id));
}

/** Run SVGO over every asset in place (same config as `pnpm normalize`). */
function normalizeAll() {
  let changed = 0, total = 0;
  for (const it of scan()) {
    total++;
    try {
      const { data } = optimize(it.svg, { ...svgoConfig, path: it.svgPath });
      if (data && data !== it.svg) { writeFileSync(it.svgPath, data); changed++; }
    } catch (e) { console.error('normalize failed:', it.rel, e.message); }
  }
  return { changed, total };
}

function buildPage() {
  const items = scan();

  // Load a library across all roots so renderScene can embed assets.
  const lib = new AssetLibrary();
  // AssetLibrary.load scans one root; load each root's subjects via loadFromData-free path:
  return Promise.all(roots.map((r) => lib.load(r))).then(() => {
    setAssetLibrary(lib);

    const cardsBySubject = {};
    let issues = 0;
    for (const it of items) {
      const [w, h] = viewBox(it.svg);
      let rendered = '', warn = [];
      try {
        const out = renderScene({ version: 1, width: w, height: h, style: { background: '#fff' },
          elements: [{ type: 'asset', assetId: it.id, x: 0, y: 0 }] });
        rendered = out.svg; warn = out.warnings;
      } catch (e) { warn = [String(e.message || e)]; }

      const badges = [];
      if (!it.meta) badges.push('<b class="bad">no metadata</b>');
      if (it.metaError) badges.push('<b class="bad">bad json</b>');
      if (warn.length) badges.push('<b class="bad">render warn</b>');
      if (badges.length) issues++;

      const grades = it.meta?.grades?.join(' ') ?? '';
      const tags = it.meta?.tags?.slice(0, 4).join(', ') ?? '';
      const card = `
        <figure class="card${badges.length ? ' flag' : ''}">
          <div class="art rendered">${rendered}</div>
          <div class="art raw" hidden>${it.svg}</div>
          <figcaption>
            <div class="id">${it.id}</div>
            <div class="meta">${grades}${grades && tags ? ' · ' : ''}${tags}</div>
            ${badges.join(' ')}
            <a class="open" href="#" data-file="${encodeURIComponent(it.rel)}">open in Illustrator ↗</a>
            <code class="path" data-abs="${it.svgPath}" title="click to copy full path">${it.rel}</code>
          </figcaption>
        </figure>`;
      (cardsBySubject[it.subject] ||= []).push(card);
    }

    const sections = Object.entries(cardsBySubject).map(([s, cards]) =>
      `<h2>${s} <span>(${cards.length})</span></h2><div class="grid">${cards.join('')}</div>`).join('');

    return `<!doctype html><html><head><meta charset="utf-8"><title>Hiraia QC</title><style>
      body{font-family:Arial;margin:0;padding:20px 24px 60px;background:#fafbfc;color:#1f2937}
      header{position:sticky;top:0;background:#fafbfc;padding:6px 0 12px;border-bottom:1px solid #e3e7eb;z-index:9;display:flex;gap:18px;align-items:center}
      h1{font-size:18px;margin:0} h2{font-size:14px;margin:26px 0 10px;text-transform:capitalize}
      h2 span{color:#9aa0a6;font-weight:400}
      .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:12px}
      .card{margin:0;border:1px solid #e3e7eb;border-radius:10px;padding:8px;background:#fff;text-align:center}
      .card.flag{border-color:#f0a; box-shadow:0 0 0 2px #ffe0f0}
      .art{height:150px;display:flex;align-items:center;justify-content:center}
      .art[hidden]{display:none}
      .art svg{max-width:100%;max-height:150px}
      figcaption{font-size:11px;margin-top:6px}
      .id{font-weight:bold} .meta{color:#8a9099;margin:2px 0}
      .bad{color:#c026a6;font-weight:700}
      .open{display:inline-block;margin:4px 0;color:#2563eb;text-decoration:none;font-weight:600}
      .path{display:block;color:#b5bcc4;font-size:9px;word-break:break-all}
      label.toggle{font-size:13px;cursor:pointer} .count{color:#666;font-size:13px}
      .btn{font:600 12px Arial;padding:5px 10px;border:1px solid #c7ccd1;border-radius:6px;background:#fff;cursor:pointer}
      .btn:hover{background:#f0f3f6} .btn:disabled{opacity:.6;cursor:default}
    </style></head><body>
      <header>
        <h1>Hiraia asset QC</h1>
        <span class="count">${items.length} assets · ${issues} flagged</span>
        <label class="toggle"><input type="checkbox" id="raw"> show clean source (no wobble)</label>
        <button id="norm" class="btn" title="Run SVGO over every asset in place">normalize all</button>
        <span class="count" id="live">● live</span>
      </header>
      ${sections}
      <script>
        const cb=document.getElementById('raw');
        cb.onchange=()=>document.querySelectorAll('.card').forEach(c=>{
          c.querySelector('.rendered').hidden=cb.checked;
          c.querySelector('.raw').hidden=!cb.checked;
        });
        // one-click open in Illustrator (server shells out to macOS open)
        document.querySelectorAll('.open').forEach(a=>a.onclick=async e=>{
          e.preventDefault(); const t=a.textContent; a.textContent='opening…';
          const r=await fetch('/open?file='+a.dataset.file);
          a.textContent=r.ok?'opened ✓':'error'; setTimeout(()=>a.textContent=t,1500);
        });
        // click path to copy absolute path
        document.querySelectorAll('.path').forEach(c=>c.onclick=()=>{
          navigator.clipboard.writeText(c.dataset.abs); const t=c.textContent;
          c.textContent='copied!'; setTimeout(()=>c.textContent=t,900);
        });
        // normalize all assets in place (SVGO)
        document.getElementById('norm').onclick=async e=>{
          if(!confirm('Run SVGO over every asset, rewriting files in place?\\n\\nSave & close anything open in Illustrator first.')) return;
          const b=e.target; b.disabled=true; const t=b.textContent; b.textContent='normalizing…';
          try{ const r=await fetch('/normalize'); const j=await r.json();
            b.textContent='normalized '+j.changed+'/'+j.total; setTimeout(()=>location.reload(),700);
          }catch(_){ b.textContent='error'; b.disabled=false; }
        };
        // live reload
        const es=new EventSource('/events');
        es.onmessage=()=>location.reload();
        es.onerror=()=>{document.getElementById('live').textContent='○ disconnected';};
      </script>
    </body></html>`;
  });
}

// --- SSE clients for live reload ---
const clients = new Set();
let debounce;
for (const root of roots) {
  try {
    watch(root, { recursive: true }, (_e, file) => {
      if (file && !/\.(svg|json)$/.test(file)) return;
      clearTimeout(debounce);
      debounce = setTimeout(() => { for (const c of clients) c.write('data: reload\n\n'); }, 120);
    });
  } catch { /* recursive watch unsupported — ignore */ }
}

createServer(async (req, res) => {
  if (req.url === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write('retry: 1000\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (req.url.startsWith('/open?')) {
    const file = decodeURIComponent(new URL(req.url, 'http://localhost').searchParams.get('file') || '');
    const abs = join(pkgRoot, file);
    const ok = file && abs.endsWith('.svg') && existsSync(abs) && roots.some((r) => abs.startsWith(r));
    if (!ok) { res.writeHead(400); return res.end('bad path'); }
    spawn('open', ['-b', 'com.adobe.illustrator', abs], { stdio: 'ignore', detached: true }).unref();
    res.writeHead(200); return res.end('ok');
  }
  if (req.url === '/normalize') {
    const result = normalizeAll();
    console.log(`normalize: rewrote ${result.changed}/${result.total} assets`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(result));
  }
  try {
    const html = await buildPage();
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  } catch (e) {
    res.writeHead(500); res.end('QC error: ' + (e.stack || e));
  }
}).listen(PORT, () => {
  console.log(`QC gallery: http://localhost:${PORT}`);
  console.log(`Watching: ${roots.map((r) => relative(pkgRoot, r) || '.').join(', ')}`);
  console.log('Click "open in Illustrator" on any card (or copy its path). Save in AI → page auto-reloads.');
});
