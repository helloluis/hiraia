/**
 * Ingest curated image concepts (from curate-images.workflow.js) into a NEW,
 * self-contained queue: prompts/expansion2-<subject>.json. Each entry gets the
 * shared house style baked in (same buildPrompt as append-expansion.mjs) and
 * status:"todo". Dedups against the WHOLE existing queue by exact id AND by
 * fuzzy token-overlap (so "owl" doesn't duplicate an existing "owl-kuwago").
 *
 *   node gemini-queue/ingest-image-concepts.mjs <output1.json> [<output2.json> ...] [--write]
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROMPTS = join(HERE, 'prompts');

const STYLE =
  'Black-and-white hand-drawn line illustration, as if sketched by a clever child with a thick black marker: ' +
  'one bold heavy black outline, any dark areas filled with loose black scribble shading, otherwise NO color, ' +
  'on a flat plain white background. Simple and uncluttered, but with correct, recognizable proportions. ' +
  'No text, letters, numbers, or labels anywhere in the image. The whole subject centered and fully visible, ' +
  'with generous white margins. Square image.';

function buildPrompt(it) {
  const lead =
    it.kind === 'scene'
      ? 'A simple illustration of a scene'
      : `Full illustration of ${it.name.toLowerCase()}`;
  return `${lead}: ${it.hint} ${STYLE}`.replace(/\s+/g, ' ').trim();
}

const VALID = new Set(['biology', 'chemistry', 'physics', 'earth-science', 'general']);
const STOP = new Set(['the', 'and', 'with', 'for', 'philippine', 'philippines', 'common', 'of', 'a']);
// relationship verbs/preps stripped to form a "core" key, so two pairings with the
// same two nouns but a different verb collapse (magnet-ATTRACTING-nail == magnet-LIFTING-nail).
const REL = new Set([
  'on', 'in', 'into', 'onto', 'at', 'to', 'from', 'near', 'over', 'under', 'inside', 'out',
  'attracting', 'lifting', 'picking', 'pulling', 'reaching', 'eating', 'grabbing', 'holding',
  'catching', 'feeding', 'carrying', 'clinging', 'gripping', 'hanging', 'resting', 'sitting',
  'orbiting', 'rolling', 'sprouting', 'growing', 'tunneling', 'basking', 'cracking', 'using',
  'its', 'a', 'an', 'up', 'down', 'high', 'leaves', 'leaf', 'tree-leaves',
]);
const coreKey = (s) =>
  [...toksRaw(s)].filter((t) => !REL.has(t)).sort().join('-');
const toksRaw = (s) =>
  new Set(String(s).toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2 && !STOP.has(t)));
const toks = (s) =>
  new Set(
    String(s)
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2 && !STOP.has(t))
  );
const jaccard = (a, b) => {
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const uni = a.size + b.size - inter;
  return uni ? inter / uni : 0;
};

// ---- load workflow output(s) ----
const argv = process.argv.slice(2);
const outPaths = argv.filter((a) => !a.startsWith('--'));
const PREFIX = (argv.find((a) => a.startsWith('--prefix=')) || '--prefix=expansion2-').split('=')[1];
const KIND_OVERRIDE = (argv.find((a) => a.startsWith('--kind=')) || '').split('=')[1] || null; // 'scene' for pairs
if (!outPaths.length) { console.error('usage: ingest-image-concepts.mjs <output1.json> [...] [--prefix=expansion2-] [--kind=scene] [--write]'); process.exit(2); }
const kept = [];
for (const p of outPaths) {
  const raw = JSON.parse(readFileSync(p, 'utf8'));
  kept.push(...((raw.result || raw).kept || raw.kept || []));
}
console.log(`workflow kept (merged from ${outPaths.length} file[s]): ${kept.length}`);

// ---- existing concepts (id + name token sets) for dedup ----
const existing = []; // {id, tokens}
const existingIds = new Set();
for (const f of readdirSync(PROMPTS).filter((f) => f.endsWith('.json'))) {
  for (const im of JSON.parse(readFileSync(join(PROMPTS, f), 'utf8')).images) {
    existingIds.add(im.id);
    existing.push(toks(`${im.id} ${im.name || ''}`));
  }
}

const accepted = [];
const seen = new Set();
const coreSeen = new Set();
const drops = { bad: 0, dup_id: 0, dup_batch: 0, dup_core: 0, fuzzy: 0 };
for (const it of kept) {
  if (!it || !it.id || !it.name || !it.hint) { drops.bad++; continue; }
  const id = String(it.id).toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (!id) { drops.bad++; continue; }
  if (existingIds.has(id)) { drops.dup_id++; continue; }
  if (seen.has(id)) { drops.dup_batch++; continue; }
  const ct = toks(`${id} ${it.name}`);
  // fuzzy: drop if (near-)synonym of an existing concept, or its content tokens
  // are wholly contained in an existing concept (e.g. "owl" ⊆ "owl-kuwago")
  let dup = false;
  for (const et of existing) {
    if (jaccard(ct, et) >= 0.6 || (ct.size && [...ct].every((t) => et.has(t)))) { dup = true; break; }
  }
  if (dup) { drops.fuzzy++; continue; }
  const ck = coreKey(`${id} ${it.name}`);
  if (ck && coreSeen.has(ck)) { drops.dup_core++; continue; } // verb-variant of an already-kept pairing
  coreSeen.add(ck);
  seen.add(id);
  const subject = VALID.has(it.subject) ? it.subject : 'general';
  const kind = KIND_OVERRIDE || (it.kind === 'scene' ? 'scene' : 'object');
  accepted.push({
    id, name: it.name, subject, topic: `${PREFIX}${subject}`,
    output_png: `assets-png/${subject}/${id}.png`, status: 'todo',
    prompt: buildPrompt({ name: it.name, hint: it.hint, kind }),
  });
}

console.log('dropped:', drops);
console.log(`accepted: ${accepted.length}`);
const bySubject = {};
for (const a of accepted) (bySubject[a.subject] ||= []).push(a);
for (const [s, arr] of Object.entries(bySubject)) console.log(`  expansion2-${s}: ${arr.length}`);

if (process.argv.includes('--write')) {
  for (const [s, arr] of Object.entries(bySubject)) {
    const file = join(PROMPTS, `${PREFIX}${s}.json`);
    writeFileSync(file, JSON.stringify({ topic: `${PREFIX}${s}`, style: STYLE, count: arr.length, images: arr }, null, 2) + '\n');
    console.log(`wrote ${file}`);
  }
} else {
  console.log('(dry run; pass --write to create the queue files)');
}
