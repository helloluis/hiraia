/**
 * Append the 2500-expansion concepts (drafted in /tmp/exp/*.json) to the bottom
 * of the Gemini prompt queue, baking in the shared house style — same logic as
 * build-prompts.mjs, so the new entries are indistinguishable from existing ones.
 *
 * Each /tmp/exp/<topic>.json is a JSON array of {id,name,subject,kind,hint}.
 * The basename maps 1:1 to a prompts/<topic>.json file (two are new:
 * filipino-food.json, filipino-culture.json). New items are appended as
 * status:"todo"; existing files keep their items + order. Global dedup drops any
 * id already present in the queue or seen earlier in this run.
 *
 *   node gemini-queue/append-expansion.mjs
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROMPTS = join(HERE, 'prompts');
const EXP = '/tmp/exp';

// Shared house style — identical string to build-prompts.mjs.
const STYLE =
  "Black-and-white hand-drawn line illustration, as if sketched by a clever child with a thick black marker: " +
  "one bold heavy black outline, any dark areas filled with loose black scribble shading, otherwise NO color, " +
  "on a flat plain white background. Simple and uncluttered, but with correct, recognizable proportions. " +
  "No text, letters, numbers, or labels anywhere in the image. The whole subject centered and fully visible, " +
  "with generous white margins. Square image.";

function buildPrompt(it) {
  const fig = it.kind === 'object';
  const scene = it.kind === 'scene';
  const lead = fig
    ? `Full illustration of ${it.name.toLowerCase()}`
    : scene
      ? `A simple illustration of a scene`
      : `A simple, clear, uncluttered hand-drawn picture of ${it.name.toLowerCase()}`;
  return `${lead}: ${it.hint} ${STYLE}`.replace(/\s+/g, ' ').trim();
}

const VALID_SUBJECTS = new Set(['biology', 'chemistry', 'physics', 'earth-science', 'general']);

// Collect every id already in the queue (across all current prompt files) for dedup.
const seen = new Set();
for (const f of readdirSync(PROMPTS).filter((f) => f.endsWith('.json'))) {
  for (const im of JSON.parse(readFileSync(join(PROMPTS, f), 'utf8')).images) seen.add(im.id);
}
const startQueueSize = seen.size;

let appended = 0;
let skippedDup = 0;
let fixedSubject = 0;
const perFile = [];

for (const expFile of readdirSync(EXP).filter((f) => f.endsWith('.json')).sort()) {
  const topic = basename(expFile, '.json');
  const promptPath = join(PROMPTS, `${topic}.json`);

  // load existing topic file, or scaffold a new one for the new culture/food topics
  const data = existsSync(promptPath)
    ? JSON.parse(readFileSync(promptPath, 'utf8'))
    : { topic, style: STYLE, count: 0, images: [] };

  const concepts = JSON.parse(readFileSync(join(EXP, expFile), 'utf8'));
  let addedHere = 0;

  for (const c of concepts) {
    if (!c.id || !c.name || !c.hint) continue; // skip malformed
    if (seen.has(c.id)) { skippedDup++; continue; } // global dedup
    let subject = VALID_SUBJECTS.has(c.subject) ? c.subject : 'general';
    if (subject !== c.subject) fixedSubject++;
    const kind = c.kind === 'object' || c.kind === 'scene' ? c.kind : '';
    seen.add(c.id);
    data.images.push({
      id: c.id,
      name: c.name,
      subject,
      topic,
      output_png: `assets-png/${subject}/${c.id}.png`,
      status: 'todo',
      prompt: buildPrompt({ name: c.name, hint: c.hint, kind }),
    });
    addedHere++;
    appended++;
  }

  data.count = data.images.length;
  writeFileSync(promptPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  perFile.push([topic, addedHere, data.count]);
}

// Report
console.log(`Queue size before:  ${startQueueSize}`);
console.log(`New appended:       ${appended}`);
console.log(`Skipped duplicates: ${skippedDup}`);
console.log(`Subjects coerced→general: ${fixedSubject}`);
let total = 0;
for (const f of readdirSync(PROMPTS).filter((f) => f.endsWith('.json')).sort()) {
  const n = JSON.parse(readFileSync(join(PROMPTS, f), 'utf8')).images.length;
  total += n;
  console.log(`  ${String(n).padStart(4)}  ${f}`);
}
console.log(`Queue size after:   ${total}`);
