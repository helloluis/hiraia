#!/usr/bin/env node
/**
 * Build the web demo's card-feed subset from the mobile app's generated pool.
 *
 * The full pool (16,948 cards / 14 MB + 15.6 MB of MCQs) is far too heavy for a web
 * lightbox, so the demo ships a deterministic 600-card subset: domain-balanced, ~70%
 * MCQ-backed (so quiz interjects fire), with the cards' shared illustration PNGs copied
 * into public/demo/cards/.
 *
 *   node packages/web/scripts/build-demo-cards.mjs
 *
 * Outputs:
 *   packages/web/src/data/demo-cards.json      { cards: CardFact[] }      (subset pool)
 *   packages/web/src/data/demo-questions.json  { questions: CardQuestion[] } (subset MCQs)
 *   packages/web/public/demo/cards/<slug>.png  (illustrations used by the subset)
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = join(fileURLToPath(import.meta.url), '..', '..');
const REPO = join(WEB, '..', '..');
const POOL = join(REPO, 'packages/mobile/src/generated/cardsPool.generated.json');
const QUESTIONS = join(REPO, 'packages/mobile/src/data/cards-questions.json');
const ASSETS = join(REPO, 'packages/images/assets-png');
const OUT_DATA = join(WEB, 'src/data');
const OUT_IMG = join(WEB, 'public/demo/cards');

const PER_DOMAIN = 150;
const MCQ_TARGET = 0.7; // of each domain bucket, prefer cards that have an interject MCQ
const SEED = 20260718;

// Deterministic PRNG so the subset is reproducible (re-runs don't reshuffle content).
function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);
const shuffled = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const pool = JSON.parse(readFileSync(POOL, 'utf8')).cards;
const questions = JSON.parse(readFileSync(QUESTIONS, 'utf8')).questions;
const qByFact = new Set(questions.map((q) => q.f));

// --- pick the subset: PER_DOMAIN per domain, MCQ-backed first ---
const byDomain = new Map();
for (const c of pool) {
  const arr = byDomain.get(c.domain) ?? [];
  arr.push(c);
  byDomain.set(c.domain, arr);
}
const picked = [];
for (const [domain, cards] of byDomain) {
  const withQ = shuffled(cards.filter((c) => qByFact.has(c.factId)));
  const without = shuffled(cards.filter((c) => !qByFact.has(c.factId)));
  const wantQ = Math.min(withQ.length, Math.round(PER_DOMAIN * MCQ_TARGET));
  const take = [
    ...withQ.slice(0, wantQ),
    ...without.slice(0, PER_DOMAIN - wantQ),
    ...withQ.slice(wantQ, wantQ + Math.max(0, PER_DOMAIN - wantQ - without.length)),
  ];
  console.log(`${domain}: ${take.length} cards (${Math.min(wantQ, take.length)} with MCQ of ${cards.length})`);
  picked.push(...take);
}
// Keep the pool's original order for stability.
const pickedIds = new Set(picked.map((c) => c.id));
const subset = pool.filter((c) => pickedIds.has(c.id));
const subsetFacts = new Set(subset.map((c) => c.factId));
const subsetQuestions = questions.filter((q) => subsetFacts.has(q.f));

// --- copy the illustrations the subset uses (slug -> assets-png path) ---
const slugPath = new Map();
const walk = (dir) => {
  for (const e of readdirSync(dir)) {
    if (e === 'flagged') continue; // never ship flagged assets
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (e.endsWith('.png')) slugPath.set(e.slice(0, -4), p);
  }
};
walk(ASSETS);
mkdirSync(OUT_IMG, { recursive: true });
const slugs = new Set(subset.map((c) => c.slug));
let copied = 0;
const missing = [];
for (const s of slugs) {
  const src = slugPath.get(s);
  if (!src) { missing.push(s); continue; }
  copyFileSync(src, join(OUT_IMG, `${s}.png`));
  copied++;
}

writeFileSync(join(OUT_DATA, 'demo-cards.json'), JSON.stringify({ cards: subset }));
writeFileSync(join(OUT_DATA, 'demo-questions.json'), JSON.stringify({ questions: subsetQuestions }));

const mb = (p) => (statSync(p).size / 1e6).toFixed(2);
console.log(`\ncards: ${subset.length} -> src/data/demo-cards.json (${mb(join(OUT_DATA, 'demo-cards.json'))} MB)`);
console.log(`MCQs: ${subsetQuestions.length} -> src/data/demo-questions.json (${mb(join(OUT_DATA, 'demo-questions.json'))} MB)`);
console.log(`images: ${copied}/${slugs.size} slugs -> public/demo/cards/`);
if (missing.length) console.log('MISSING SLUGS:', missing.slice(0, 10), missing.length > 10 ? `…+${missing.length - 10}` : '');
