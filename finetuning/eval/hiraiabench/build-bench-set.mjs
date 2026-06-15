#!/usr/bin/env node
/**
 * Curate the PUBLIC hiraiabench probe pool from our internal capability suite.
 *
 * Design (honest + cross-model-fair):
 *  - SINGLE-TURN only — drop `multi-turn` (stateful, hard to wire across API/served models)
 *    and `presentation` (device-specific [image:] emission; not a fair cross-model dim).
 *  - NO RAG — every model answers from its own weights + a neutral tutor system prompt. This
 *    measures intrinsic model/fine-tune capability, the honest claim for a cross-model table.
 *    (Hiraia's product adds RAG on top; footnoted on the site.)
 *  - 7 CATEGORIES are projections over the SAME pool, reusing the 5-dim judge rubric:
 *      Science Accuracy  = accuracy on reasoning+synthesis+helpfulness(science)
 *      Tagalog Fluency   = naturalness on tl probes
 *      English Fluency   = naturalness on en probes
 *      Bisaya            = (naturalness+accuracy)/2 on bis probes
 *      Pedagogy          = pedagogy dim on pedagogy probes
 *      Safety & Honesty  = (accuracy+helpfulness)/2 on safety-myth+abstain-correct
 *      Code-switching    = (naturalness+helpfulness)/2 on codeswitch probes
 *  - AUP: each probe is tagged `aup` (in aup-denylist) so the runner keeps body/child probes
 *    OFF the Claude-Opus subject path and judges them with the on-pod open judge only.
 *
 * Out: bench-set.json — { meta, probes:[{id,tier,lang,prompt,must_answer,must_cover,intent,aup}] }
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const CAP = join(HERE, '..', 'capability');

const all = JSON.parse(readFileSync(join(CAP, 'probes.json'), 'utf8'));
const probes = Array.isArray(all) ? all : all.probes ?? all;
const denylist = new Set(JSON.parse(readFileSync(join(CAP, 'aup-denylist.json'), 'utf8')).ids ?? []);

// per-tier cap (balanced pool; deterministic — take the first N in file order)
const CAPS = {
  'helpfulness-floor': 10,
  reasoning: 7,
  synthesis: 5,
  codeswitch: 8,
  'abstain-correct': 7,
  'safety-myth': 7,
  pedagogy: 7,
  bisaya: 8,
  english: 8,
};
const DROP = new Set(['multi-turn', 'presentation']); // hard-to-wire / device-specific

const picked = [];
const perTier = {};
for (const p of probes) {
  if ('turns' in p) continue; // belt-and-suspenders: no multi-turn
  if (DROP.has(p.tier)) continue;
  const cap = CAPS[p.tier];
  if (cap == null) continue;
  perTier[p.tier] = (perTier[p.tier] || 0) + 1;
  if (perTier[p.tier] > cap) continue;
  picked.push({
    id: p.id,
    tier: p.tier,
    lang: p.lang,
    prompt: p.prompt,
    must_answer: p.must_answer ?? true,
    must_cover: p.must_cover ?? [],
    intent: p.intent ?? '',
    aup: denylist.has(p.id), // true → never send to the Claude-Opus subject; on-pod judge only
  });
}

const meta = {
  what: 'Public hiraiabench probe pool (single-turn, no-RAG, cross-model). Categories are dimension×subset projections of the 5-dim capability rubric.',
  built_from: 'finetuning/eval/capability/probes.json',
  dropped_tiers: [...DROP],
  total: picked.length,
  aup_count: picked.filter((p) => p.aup).length,
  by_tier: perTier,
  by_lang: picked.reduce((a, p) => ((a[p.lang] = (a[p.lang] || 0) + 1), a), {}),
};
writeFileSync(join(HERE, 'bench-set.json'), JSON.stringify({ meta, probes: picked }, null, 1));
console.log('bench-set.json:', meta);
