#!/usr/bin/env node
/**
 * Generate / regenerate factoid text with a pluggable model.
 *
 * Two modes — both idempotent and incremental (skip what's done; --force to redo):
 *
 *   DRAFT   new factoids for image subjects not yet covered → bank/staging.json
 *           (written verified:false; a human/strong-model verify pass promotes them)
 *     node scripts/generate-factoids.mjs --mode draft --limit 20 --subject biology
 *
 *   TRANSLATE  (re)render existing VERIFIED factoids into another language. This is
 *              the path you re-run as the Filipino/Cebuano fine-tunes improve — it
 *              only touches phrasing, never the verified fact.
 *     node scripts/generate-factoids.mjs --mode translate --lang ceb --force
 *
 * Model selection is entirely via env (see scripts/llm.mjs). Point HIRAIA_LLM_*
 * at the sidecar running your best adapter. Use --mock to test plumbing offline.
 *
 * Design principle — FACT vs PHRASING:
 *   `source` holds the verified factual claim (English, language-neutral) and is
 *   the thing a verifier checks. `hook`/`body` per language are just renderings
 *   of that fact. So improving translations never requires re-verifying truth.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chatComplete, mockComplete, extractJson, LLM_CONFIG } from './llm.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, '..');
const BANK_PATH = join(PKG, 'bank', 'factoids.json');
const STAGING_PATH = join(PKG, 'bank', 'staging.json');
const INDEX_PATH = join(PKG, '..', 'images', 'index.json');

// ---- args ----
function parseArgs(argv) {
  const a = { mode: 'draft', lang: 'ceb', limit: 10, subject: null, ids: null, force: false, mock: false, temperature: 0.6 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--mode') a.mode = argv[++i];
    else if (k === '--lang') a.lang = argv[++i];
    else if (k === '--limit') a.limit = parseInt(argv[++i], 10);
    else if (k === '--subject') a.subject = argv[++i];
    else if (k === '--ids') a.ids = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (k === '--force') a.force = true;
    else if (k === '--mock') a.mock = true;
    else if (k === '--temperature') a.temperature = parseFloat(argv[++i]);
  }
  return a;
}
const args = parseArgs(process.argv.slice(2));
const complete = args.mock ? mockComplete : chatComplete;
const iso = new Date().toISOString();
const modelLabel = args.mock ? 'mock' : `${LLM_CONFIG.model}@${LLM_CONFIG.baseUrl}${LLM_CONFIG.adapter ? `+${LLM_CONFIG.adapter}` : ''}`;

const readJson = (p, fallback) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : fallback);
const factoidsOf = (file) => (Array.isArray(file) ? file : file?.factoids || []);
function writeBankFile(path, factoids) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ version: 1, builtAt: iso, count: factoids.length, factoids }, null, 2) + '\n');
}

// ---- prompts ----
const DRAFT_SYSTEM =
  'You write ONE short, TRUE, surprising science factoid for Filipino grade-school students (ages 8-16). ' +
  'Rules: (1) Only state claims you are highly confident are factually correct — when unsure, pick a safer, simpler fact. ' +
  '(2) Keep the whole Tagalog message about 50 words. (3) Be vivid and concrete. (4) No human reproduction / puberty topics. ' +
  'Output STRICT JSON only, no prose, with this exact shape: ' +
  '{"fact":"<the single factual claim, in English — a fact-checker will verify THIS>",' +
  '"hook":{"tl":"<Tagalog clause that completes \'Alam mo ba na ___?\' — start lowercase, no \'Alam mo ba\', no question mark>",' +
  '"en":"<same clause in English, completes \'Did you know that ___?\'>"},' +
  '"body":{"tl":"<1-2 sentence Tagalog follow-up explanation>","en":"<same in English>"}}';

const draftUser = (a) =>
  `Subject: ${a.name} (id: ${a.id}, ${a.subject}).\nWhat it shows: ${a.caption?.en || a.name}.\nWrite one "Alam mo ba na…?" factoid about this subject.`;

const LANG_NAME = { ceb: 'Cebuano (Bisaya)', tl: 'Tagalog/Filipino', en: 'English' };
const translateSystem = (lang) =>
  `You translate a children's science factoid into natural, conversational ${LANG_NAME[lang] || lang}. ` +
  'Translate FAITHFULLY — do not add, remove, or change any fact; keep the same meaning and reading level. ' +
  'Output STRICT JSON only: {"hook":"<translated clause, no question mark>","body":"<translated follow-up>"}';
const translateUser = (f) => {
  const src = f.hook?.en && f.body?.en ? 'en' : 'tl';
  return `Source language: ${src}. Fact (do not alter): ${f.source || f.hook?.en || f.hook?.tl}\nHOOK: ${f.hook?.[src]}\nBODY: ${f.body?.[src]}`;
};

// ---- modes ----
async function runDraft() {
  if (!existsSync(INDEX_PATH)) throw new Error(`Missing ${INDEX_PATH}. Build it: (cd packages/images && node build-index.mjs)`);
  const { assets } = JSON.parse(readFileSync(INDEX_PATH, 'utf8'));
  const bank = factoidsOf(readJson(BANK_PATH, null));
  const staging = factoidsOf(readJson(STAGING_PATH, null));
  const covered = new Set([...bank, ...staging].map((f) => f.imageId));

  let candidates = assets;
  if (args.ids) candidates = candidates.filter((a) => args.ids.includes(a.id));
  if (args.subject) candidates = candidates.filter((a) => a.subject === args.subject);
  if (!args.force) candidates = candidates.filter((a) => !covered.has(a.id));
  candidates = candidates.slice(0, args.limit);

  if (candidates.length === 0) {
    console.log('Nothing to draft (all covered, or no match). Use --force or --ids to override.');
    return;
  }
  console.log(`DRAFT · model=${modelLabel} · ${candidates.length} subject(s) → ${STAGING_PATH}\n`);

  const out = [...staging];
  let ok = 0;
  for (const a of candidates) {
    process.stdout.write(`  • ${a.id} … `);
    try {
      const text = await complete(
        [
          { role: 'system', content: DRAFT_SYSTEM },
          { role: 'user', content: draftUser(a) },
        ],
        { temperature: args.temperature, maxTokens: 500 },
      );
      const j = extractJson(text);
      if (!j || !j.fact || !j.hook?.tl || !j.body?.tl) {
        console.log('SKIP (unparseable / incomplete JSON)');
        continue;
      }
      const id = uniqueId(`${a.id}--gen`, out);
      out.push({
        id,
        imageId: a.id,
        subject: a.subject,
        hook: { tl: j.hook.tl, en: j.hook.en || null, ceb: null },
        body: { tl: j.body.tl, en: j.body.en || null, ceb: null },
        grades: [],
        tags: a.tags || [],
        source: j.fact,
        verified: false,
        provenance: { draftedBy: modelLabel, draftedAt: iso },
      });
      ok++;
      console.log('drafted');
    } catch (err) {
      console.log(`ERROR ${err.message}`);
    }
  }
  writeBankFile(STAGING_PATH, out);
  console.log(`\nDrafted ${ok}/${candidates.length} → ${STAGING_PATH} (verified:false). Next: node scripts/verify-bank.mjs`);
}

async function runTranslate() {
  const lang = args.lang;
  if (!['ceb', 'tl', 'en'].includes(lang)) throw new Error(`--lang must be ceb|tl|en (got ${lang})`);
  const bank = factoidsOf(readJson(BANK_PATH, null));
  if (bank.length === 0) throw new Error(`No bank at ${BANK_PATH}`);

  let targets = bank;
  if (args.ids) targets = targets.filter((f) => args.ids.includes(f.id) || args.ids.includes(f.imageId));
  if (args.subject) targets = targets.filter((f) => f.subject === args.subject);
  if (!args.force) targets = targets.filter((f) => !(f.hook?.[lang] && f.body?.[lang]));
  targets = targets.slice(0, args.limit);

  if (targets.length === 0) {
    console.log(`Nothing to translate to ${lang} (all present). Use --force to re-render.`);
    return;
  }
  console.log(`TRANSLATE→${lang} · model=${modelLabel} · ${targets.length} factoid(s) (faithful re-render; fact unchanged)\n`);

  const byId = new Map(bank.map((f) => [f.id, f]));
  let ok = 0;
  for (const f of targets) {
    process.stdout.write(`  • ${f.id} … `);
    try {
      const text = await complete(
        [
          { role: 'system', content: translateSystem(lang) },
          { role: 'user', content: translateUser(f) },
        ],
        { temperature: 0.3, maxTokens: 400, adapter: LLM_CONFIG.adapter },
      );
      const j = extractJson(text);
      if (!j || !j.hook || !j.body) {
        console.log('SKIP (unparseable)');
        continue;
      }
      const target = byId.get(f.id);
      target.hook = { ...target.hook, [lang]: j.hook };
      target.body = { ...target.body, [lang]: j.body };
      target.provenance = target.provenance || {};
      target.provenance.langMeta = { ...(target.provenance.langMeta || {}), [lang]: { by: modelLabel, at: iso } };
      ok++;
      console.log('rendered');
    } catch (err) {
      console.log(`ERROR ${err.message}`);
    }
  }
  writeBankFile(BANK_PATH, [...byId.values()]);
  console.log(`\nRendered ${ok}/${targets.length} into ${lang} → ${BANK_PATH}`);
}

function uniqueId(base, list) {
  const taken = new Set(list.map((f) => f.id));
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

(async () => {
  try {
    if (args.mode === 'draft') await runDraft();
    else if (args.mode === 'translate') await runTranslate();
    else throw new Error(`Unknown --mode "${args.mode}" (use draft|translate)`);
  } catch (err) {
    console.error(`\n✖ ${err.message}`);
    process.exit(1);
  }
})();
