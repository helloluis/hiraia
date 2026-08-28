// Headless check of the WEIGHTED draw path in src/data/cards.ts (the harness only exercises the
// un-weighted path): (1) weigher(ctx) equals the reference cardWeight formula under random seen
// records; (2) the session weight table rebuilds only when grade/quarter change; (3) a markSeen-style
// bump is visible on the very next draw; (4) timing of startCard/jumpCard.
// Run: node_modules/.bin/tsx packages/mobile/scripts/feed-weights-check.mts
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const MOBILE = new URL('..', import.meta.url).pathname;
const SHARED = join(MOBILE, '../shared/src');
const src = readFileSync(join(MOBILE, 'src/data/cards.ts'), 'utf8')
  .replace(/from '@hiraia\/shared';/, `from '${join(SHARED, 'index.ts')}';`)
  .replace("import cardsPool from '../generated/cardsPool.generated.json';", `import cardsPool from '${join(MOBILE, 'src/generated/cardsPool.generated.json')}' with { type: 'json' };`)
  .replace("import curriculumTagsJson from '../generated/curriculumTags.generated.json';", `import curriculumTagsJson from '${join(MOBILE, 'src/generated/curriculumTags.generated.json')}' with { type: 'json' };`)
  .replace("import questionsJson from './cards-questions.json';", `import questionsJson from '${join(MOBILE, 'src/data/cards-questions.json')}' with { type: 'json' };`);
const file = join(mkdtempSync(join(tmpdir(), 'feedw-')), 'cards.mts');
writeFileSync(file, src);
const cards = await import(file);
const shared = await import(join(SHARED, 'curriculum/feedWeighting.ts'));
const raw = JSON.parse(readFileSync(join(MOBILE, 'src/generated/curriculumTags.generated.json'), 'utf8'));
const pool = JSON.parse(readFileSync(join(MOBILE, 'src/generated/cardsPool.generated.json'), 'utf8')).cards as { id: string }[];
const tag = (id: string) => { const r = raw[id]; if (!r) return null; return { competency: r[0], grade: r[1], quarter: r[2], confidence: r[3], cells: r[4].map(([g, q, s, n]: number[]) => ({ grade: g, quarter: q, strength: s === 2 ? 2 : 1, norm: n })), codes: r[5] }; };
const codesOf = (id: string) => { const t = tag(id); return !t || t.confidence < 0.2 ? ['off'] : (t.codes ?? [t.competency]); };
let seed = 7; const rand = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const now = Date.now();
const cardSeen = new Map<string, { times: number; lastSeen: number }>(); const competencySeen = new Map<string, { times: number; lastSeen: number }>();
for (let k = 0; k < 400; k++) { const c = pool[Math.floor(rand() * pool.length)]; cardSeen.set(c.id, { times: 1 + Math.floor(rand() * 4), lastSeen: now - rand() * 20 * 864e5 }); for (const code of codesOf(c.id)) competencySeen.set(code, { times: 1 + Math.floor(rand() * 6), lastSeen: now - rand() * 20 * 864e5 }); }
const ctx = { studentGrade: 5 as const, currentQuarter: 2 as const, now, cardSeen, competencySeen };
// reference: strongest decay over the card's codes — 'off' is not a competency and never decays a group (design rule)
const ref = (id: string) => { let worst = Infinity; let rec: any; for (const code of codesOf(id)) { if (code === 'off') continue; const r = competencySeen.get(code); if (!r) continue; const m = shared.seenCompetencyMultiplier(r, now); if (m < worst) { worst = m; rec = r; } } return shared.cardWeight({ tag: tag(id), cardSeen: cardSeen.get(id), competencySeen: rec }, ctx); };
// (1) equivalence
const w = cards.weigher(ctx); let maxDiff = 0; let n = 0;
for (const c of pool) { if (rand() > 0.2) continue; n++; maxDiff = Math.max(maxDiff, Math.abs(w.of(c) - ref(c.id))); }
console.log(`  (1) equivalence on ${n} cards, ${cardSeen.size} seen cards / ${competencySeen.size} seen competencies: max |Δ| = ${maxDiff.toExponential(2)} ${maxDiff < 1e-9 ? 'OK' : 'FAIL'}`);
// (2) table rebuild only on grade/quarter change — observed through a weight that differs between contexts
const c0 = pool.find((c) => tag(c.id)?.cells?.some((k: any) => k.grade === 5 && k.quarter === 2))!;
const r0 = cards.weightTableStats.rebuilds;
const wA = cards.weigher({ ...ctx, cardSeen: new Map(), competencySeen: new Map() }).of(c0);
cards.weigher({ ...ctx, now: now + 5e6 }); cards.weigher(ctx); cards.startCard(new Set(), ctx); // now / seen-only changes
const rSame = cards.weightTableStats.rebuilds - r0;
const wB = cards.weigher({ ...ctx, cardSeen: new Map(), competencySeen: new Map(), currentQuarter: 4 }).of(c0);
const wC = cards.weigher({ ...ctx, cardSeen: new Map(), competencySeen: new Map(), studentGrade: 3 }).of(c0);
const rKeys = cards.weightTableStats.rebuilds - r0 - rSame;
console.log(`  (2) same card: G5/Q2 x${wA.toFixed(2)} → G5/Q4 x${wB.toFixed(2)} → G3/Q2 x${wC.toFixed(2)} | rebuilds on now/seen-only changes: ${rSame}, on key changes: ${rKeys} ${rSame === 0 && rKeys === 2 && wA !== wB && wA !== wC ? 'OK' : 'FAIL'}`);
// (3) a bump is visible on the next draw (maps mutated in place, as cardStore does)
const cs = new Map<string, { times: number; lastSeen: number }>(); const ks = new Map<string, { times: number; lastSeen: number }>(); const ctx3 = { ...ctx, cardSeen: cs, competencySeen: ks };
const codes0 = codesOf(c0.id).filter((k: string) => k !== 'off'); const sib = pool.find((c) => c.id !== c0.id && codesOf(c.id).includes(codes0[0]) && !codesOf(c.id).some((k: string) => codes0.slice(1).includes(k)))!;
const before = cards.weigher(ctx3).of(c0); const sibBefore = cards.weigher(ctx3).of(sib);
cs.set(c0.id, { times: 1, lastSeen: now }); for (const k of codes0) ks.set(k, { times: 1, lastSeen: now }); // what markSeen does
const after = cards.weigher(ctx3).of(c0); const sibAfter = cards.weigher(ctx3).of(sib);
console.log(`  (3) markSeen-style bump: card x${before.toFixed(2)} → x${after.toFixed(2)} (expect ×0.4), sibling sharing one code x${sibBefore.toFixed(2)} → x${sibAfter.toFixed(2)} (expect ×0.8) ${Math.abs(after - before * 0.4) < 1e-9 && Math.abs(sibAfter - sibBefore * 0.8) < 1e-9 ? 'OK' : 'FAIL'}`);
// (4) timing
let t0 = performance.now(); for (let i = 0; i < 50; i++) cards.startCard(new Set(), ctx); const tStart = (performance.now() - t0) / 50;
t0 = performance.now(); for (let i = 0; i < 50; i++) cards.jumpCard(c0.id, new Set(), ctx); const tJump = (performance.now() - t0) / 50;
t0 = performance.now(); for (let i = 0; i < 50; i++) cards.nextChoices(c0.id, new Set(), 'tagalog', ctx); const tNext = (performance.now() - t0) / 50;
console.log(`  (4) per call: startCard ${tStart.toFixed(2)} ms | jumpCard ${tJump.toFixed(2)} ms | nextChoices ${tNext.toFixed(2)} ms (old full-pool draw: ~2.0 ms here)`);
