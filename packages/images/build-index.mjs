/**
 * Build a compact runtime retrieval index from the per-asset JSON metadata.
 *
 * Authoring source of truth = assets/<subject>/<id>.json (per file).
 * Runtime artifact = index.json (one bundled file the app loads once).
 * Embeddings (embeddings.bin) are added in a later step; for now the index
 * carries the searchText so a TF-IDF gate can run with zero model deps.
 *
 *   node build-index.mjs
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), 'assets');
const SUBJECTS = ['biology', 'chemistry', 'physics', 'earth-science', 'general'];

// Pure connector/symbol primitives are building blocks for composition, not
// standalone retrieval targets — keep them on disk but out of the search index.
const EXCLUDE = new Set([
  'arrow-single', 'arrow-double', 'arrow-cycle', 'arrow-curved',
  'sign-plus', 'sign-equals', 'label-callout', 'zoom-callout',
]);

const assets = [];
let excluded = 0;
for (const subject of SUBJECTS) {
  const dir = join(ROOT, subject);
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const m = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    if (EXCLUDE.has(m.id)) { excluded++; continue; }
    // caption/parts are {en,tl,bis}; matching text concatenates ALL languages
    // so an in-language (Tagalog/Bisaya) response matches its in-language caption.
    const cap = m.caption || {};
    const prt = m.parts || {};
    const capAll = [cap.en, cap.tl, cap.bis].filter(Boolean);
    const partsAll = [].concat(prt.en || [], prt.tl || [], prt.bis || []);
    const searchText = [m.name, ...capAll, partsAll.join(' '), (m.tags || []).join(' '), m.description]
      .filter(Boolean).join('. ');
    assets.push({
      id: m.id, subject: m.subject, name: m.name,
      caption: m.caption, parts: m.parts,
      tags: m.tags || [], grades: m.grades || [], curriculum: m.curriculum || [],
      viewBox: m.viewBox, searchText,
    });
  }
}

const index = { version: 1, builtAt: new Date().toISOString(), count: assets.length, assets };
const outPath = join(dirname(fileURLToPath(import.meta.url)), 'index.json');
writeFileSync(outPath, JSON.stringify(index, null, 0));
console.log(`Wrote index.json — ${assets.length} assets indexed (${excluded} connector primitives excluded), ${(JSON.stringify(index).length / 1024).toFixed(0)} KB`);
const noCap = assets.filter((a) => !a.caption).length;
if (noCap) console.warn(`WARNING: ${noCap} assets missing caption`);
