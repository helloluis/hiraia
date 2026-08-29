// Reproduces the FEED-WEIGHTING.md calibration against the bundled tags: share of weighted draws that
// carry the current cell for a Grade-5 student in Q2. Run: node_modules/.bin/tsx packages/mobile/scripts/feed-calibration.mts
import fs from 'node:fs';
import { join } from 'node:path';
// Resolved from THIS file, not from an absolute /Users/luis/Code/hiraia path: the script
// used to read another worktree's pool, so it silently reported that checkout's numbers.
const MOBILE = new URL('..', import.meta.url).pathname;
import { cardWeight, weightedPick, curriculumMultiplier } from '../../shared/src/curriculum/feedWeighting.ts';
const raw = JSON.parse(fs.readFileSync(join(MOBILE, 'src/generated/curriculumTags.generated.json'),'utf8'));
const pool = JSON.parse(fs.readFileSync(join(MOBILE, 'src/generated/cardsPool.generated.json'),'utf8')).cards as {id:string}[];
const tag = (id: string) => { const r = raw[id]; if (!r) return null; const [competency, grade, quarter, confidence, cells, codes] = r; return { competency, grade, quarter, confidence, cells: cells?.map(([g,q,s,n]: number[]) => ({grade:g, quarter:q, strength: s===2?2:1, norm: n})), codes }; };
const ctx = { studentGrade: 5 as const, currentQuarter: 2 as const, now: Date.now() };
const tagged = pool; // whole pool: untagged cards weigh offCurriculum and belong in the share
let seed = 42; const rand = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const hits = new Map<string, number>(); const N = 20000;
for (let i = 0; i < N; i++) { const c = weightedPick(tagged, x => cardWeight({ tag: tag(x.id) }, ctx), rand)!; const t = tag(c.id); const key = !t ? 'untagged' : t.cells?.some(k => k.grade===5 && k.quarter===2) ? 'has G5-Q2 cell' : (t.cells?.some(k=>k.grade===5) ? 'G5 other quarter' : 'other'); hits.set(key, (hits.get(key) ?? 0) + 1); }
const ws = tagged.map(c => [c.id, cardWeight({ tag: tag(c.id) }, ctx)] as const).sort((a,b)=>b[1]-a[1]); console.log('  heaviest card:', ws[0][0], 'x'+ws[0][1].toFixed(2), JSON.stringify(tag(ws[0][0])?.cells), '| lightest tagged: x'+Math.min(...ws.filter(([id])=>raw[id]).map(([,w])=>w)).toFixed(2), '| untagged: x'+cardWeight({tag:null},ctx).toFixed(2));
console.log('  pool', tagged.length, '(tagged', tagged.filter(c=>raw[c.id]).length+') | draws with a G5-Q2 cell:', ((hits.get('has G5-Q2 cell')??0)/N*100).toFixed(1)+'%', '| G5 other quarter:', ((hits.get('G5 other quarter')??0)/N*100).toFixed(1)+'%', '| untagged:', ((hits.get('untagged')??0)/N*100).toFixed(1)+'%');
const ex = tagged.find(c => (tag(c.id)?.cells?.length ?? 0) > 1)!; console.log('  example multi-cell tag:', JSON.stringify(tag(ex.id)), '→ ×', curriculumMultiplier(tag(ex.id), 5, 2).toFixed(2));
