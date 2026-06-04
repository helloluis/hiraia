/**
 * Build the Gemini image-prompt queue from our intended inventory.
 *
 * Sources:
 *   - existing per-asset metadata in ../assets/<subject>/<id>.json (caption.en)
 *   - the expansion concept list in ../expansion-1000.json (hint)
 * Output:
 *   - prompts/<topic>.json  — one file per topic so Gemini can start early
 *
 * We write PROMPTS + CAPTIONS; Gemini writes only the PNG images.
 *
 *   node gemini-queue/build-prompts.mjs
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, '..');
const SUBJECTS = ['biology', 'chemistry', 'physics', 'earth-science', 'general'];

// Shared house style, written from the concrete look of samples/cow.jpeg.
const STYLE =
  "Black-and-white hand-drawn line illustration, as if sketched by a clever child with a thick black marker: " +
  "one bold heavy black outline, any dark areas filled with loose black scribble shading, otherwise NO color, " +
  "on a flat plain white background. Simple and uncluttered, but with correct, recognizable proportions. " +
  "No text, letters, numbers, or labels anywhere in the image. The whole subject centered and fully visible, " +
  "with generous white margins. Square image.";

// --- gather items ---
const items = new Map(); // id -> {id, subject, name, content, kind, tags}

// existing assets
for (const subject of SUBJECTS) {
  const dir = join(PKG, 'assets', subject);
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const m = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    const content = (m.caption && m.caption.en) || m.description || m.name;
    const tags = m.tags || [];
    const isFig = tags.includes('animal') || tags.includes('plant');
    items.set(m.id, { id: m.id, subject: m.subject, name: m.name, content, tags, kind: isFig ? 'object' : '' });
  }
}
// expansion concepts (only if not already present)
const exp = JSON.parse(readFileSync(join(PKG, 'expansion-1000.json'), 'utf8')).concepts;
for (const c of exp) {
  if (items.has(c.id)) continue;
  items.set(c.id, { id: c.id, subject: c.subject, name: c.name, content: c.hint, tags: [], kind: c.kind });
}

// --- topic assignment (first match wins) ---
const TOPICS = [
  ['daily-life-scenes', /palengke|sari-sari|jeepney|tricycle|kitchen|cooking|kaldero|lechon|halo-halo|fiesta|market|fishing|banca|fish-pen|farm|rice-farm|harvest|drying|salt-|backyard|coop|pig-pen|store|tingi|school|classroom|terrace|livelihood|grilling|palayok/i],
  ['animals', null, (it) => it.tags.includes('animal')],
  ['plants', null, (it) => it.tags.includes('plant')],
  ['cells-life-processes', /\bcell\b|organelle|mitosis|\bdna\b|\bgene\b|chromosome|photosynthes|respiration|microbe|bacteri|punnett|hered|incomplete-dom|codominance|pedigree|evolution|natural-selection|phylogen|taxonom|kingdom|life-?cycle|lifecycle|germinat|pollinat|spore|cone-bearing|levels-of-organization|mutation/i],
  ['human-body-health', /body|organ|system-|digest|blood|heart|lung|bone|skelet|muscle|integument|skin|tooth|hygiene|food-group|vitamin|pinggang|balanced-meal|exercise|first-aid|disease|hand-palm|foot|sense-|neuron|reflex|homeostasis|nutrition|nail|brushing|handwash/i],
  ['ecosystems-environment', /habitat|ecosystem|food-chain|food-web|foodweb|foodchain|biotic|energy-pyramid|trophic|biodivers|conservation|compost|decompos|mangrove|reef|forest|rainforest|estuary|intertidal|niche|symbios|basic-needs/i],
  ['matter-chemistry', null, (it) => it.subject === 'chemistry'],
  ['forces-energy-physics', null, (it) => it.subject === 'physics'],
  ['earth-weather-space', null, (it) => it.subject === 'earth-science'],
  ['tools-figures-misc', /.*/], // catch-all (mostly general)
];

function topicFor(it) {
  const hay = `${it.id} ${it.name} ${it.tags.join(' ')} ${it.content}`.toLowerCase();
  for (const [topic, re, fn] of TOPICS) {
    if (re && re.test(hay)) return topic;
    if (fn && fn(it)) return topic;
  }
  return 'tools-figures-misc';
}

function buildPrompt(it) {
  const fig = it.kind === 'object';
  const scene = it.kind === 'scene';
  const lead = fig
    ? `Full illustration of ${it.name.toLowerCase()}`
    : scene
      ? `A simple illustration of a scene`
      : `A simple, clear, uncluttered hand-drawn picture of ${it.name.toLowerCase()}`;
  return `${lead}: ${it.content} ${STYLE}`.replace(/\s+/g, ' ').trim();
}

// --- group + write ---
const byTopic = {};
for (const it of items.values()) {
  const topic = topicFor(it);
  (byTopic[topic] ||= []).push({
    id: it.id,
    name: it.name,
    subject: it.subject,
    topic,
    output_png: `assets-png/${it.subject}/${it.id}.png`,
    status: 'todo',
    prompt: buildPrompt(it),
  });
}

const outDir = join(HERE, 'prompts');
mkdirSync(outDir, { recursive: true });
let total = 0;
const summary = [];
for (const [topic, list] of Object.entries(byTopic).sort()) {
  list.sort((a, b) => a.id.localeCompare(b.id));
  writeFileSync(join(outDir, `${topic}.json`), JSON.stringify({ topic, style: STYLE, count: list.length, images: list }, null, 2));
  total += list.length;
  summary.push([topic, list.length]);
}
console.log(`Wrote ${summary.length} topic files, ${total} image prompts total:\n`);
for (const [t, n] of summary.sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${t}.json`);
