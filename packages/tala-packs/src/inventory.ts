/**
 * Human-readable inventory of the library (library/INVENTORY.md), generated from the same data the server serves:
 * every DepEd week the 2026 Science BOWs print (the denominator), each language version's status and review stages,
 * illustration coverage and gaps, failures with their recorded errors, and spend.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PackReview, WeeklyPackContent, type PackLang } from '@hiraia/tala-core/contracts';
import { buildIndex } from './runner';
import { loadInputs } from './context';
import { BUILD, LIBRARY, WORK } from './paths';

const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf8')) as T;

export function writeInventory(): string {
  const index = buildIndex(true);
  const { art } = loadInputs();
  const lines: string[] = [];
  const c = index.counts;
  lines.push('# Teaching-pack library inventory', '');
  lines.push(`Generated ${new Date().toISOString()} by \`tala-packs inventory\`. Curriculum: ${index.curriculumVersion} (DepEd 2026 Three-Term Budgets of Work, Science Grades 3–10).`, '');
  lines.push('## Coverage', '');
  lines.push(`Denominator: **${index.packs.length} weeks** printed in the BOWs × 2 languages = **${c.targets} language versions**. Every printed week is listed; none is excluded.`, '');
  lines.push('| Status | Language versions | Meaning |', '|---|---:|---|');
  lines.push(`| Approved (public) | ${c.approved} | A named teacher reviewed it and Luis (or his named reviewer) published it |`);
  lines.push(`| Draft | ${c.draft} | Built; automatic checks pass; model critique left no blocker or major issue; awaiting human review |`);
  lines.push(`| Needs work | ${c.needsWork} | Built, but a check failed, the critique left an issue open, or the wording check failed |`);
  lines.push(`| Failed | ${c.failed} | Generation or rendering failed; error below; the week is retried by the next run |`);
  lines.push(`| Not built | ${c.notBuilt} | Not generated yet |`, '');
  lines.push('Human review stages: **no pack has a teacher or expert review yet** unless listed under Approved. A model critique is not a human review.', '');

  lines.push('## By grade and term', '');
  lines.push('| Grade | Term | Weeks | EN draft | EN needs work | FIL draft | FIL needs work | Failed | Not built |', '|---|---|---:|---:|---:|---:|---:|---:|---:|');
  for (const g of ['3', '4', '5', '6', '7', '8', '9', '10'])
    for (const t of [1, 2, 3]) {
      const ws = index.packs.filter((p) => p.grade === g && p.term === t);
      const n = (l: PackLang, s: string) => ws.filter((w) => w.variants[l].status === s).length;
      const failed = ws.reduce((k, w) => k + (['en', 'fil'] as const).filter((l) => w.variants[l].status === 'failed').length, 0);
      const notBuilt = ws.reduce((k, w) => k + (['en', 'fil'] as const).filter((l) => w.variants[l].status === 'not_built').length, 0);
      lines.push(`| ${g} | ${t} | ${ws.length} | ${n('en', 'draft') + n('en', 'approved')} | ${n('en', 'needs_work')} | ${n('fil', 'draft') + n('fil', 'approved')} | ${n('fil', 'needs_work')} | ${failed} | ${notBuilt} |`);
    }
  lines.push('');

  lines.push('## Built packs', '');
  lines.push('| Week | Lang | Status | Slides (illustrated) | Checks | Critique | Wording (verbiage/1) | Teacher review |', '|---|---|---|---|---|---|---|---|');
  for (const p of index.packs)
    for (const l of ['en', 'fil'] as const) {
      const v = p.variants[l];
      if (v.status === 'not_built') continue;
      const reviewFile = resolve(LIBRARY, p.packId, l, 'review.json');
      const r = existsSync(reviewFile) ? PackReview.parse(readJson(reviewFile)) : null;
      lines.push(
        `| ${p.packId} | ${l} | ${v.status} | ${v.slideCount ?? '—'} (${v.illustratedSlides ?? '—'}) | ${r?.autoChecks.state ?? '—'} | ${r ? `${r.modelCritique.state}, ${r.modelCritique.rounds} rounds, ${r.modelCritique.resolvedIssues} fixed, ${r.modelCritique.openIssues.length} open` : '—'} | ${r?.verbiage ? `${r.verbiage.state} (max ${r.verbiage.metrics.maxWordsOnSlide} words/slide)` : '—'} | ${r?.teacherReview ? `${r.teacherReview.reviewer}` : 'none'} |`
      );
    }
  lines.push('');

  lines.push('## Failures (latest attempt)', '');
  let anyFail = false;
  for (const p of index.packs) {
    const stateFile = resolve(WORK, p.packId, 'state.json');
    if (!existsSync(stateFile)) continue;
    const st = readJson<{ attempts: Array<{ at: string; outcome: string; error?: string }> }>(stateFile);
    const last = st.attempts.at(-1);
    if (last?.outcome === 'failed') {
      anyFail = true;
      lines.push(`- ${p.packId} (${last.at}): ${last.error?.replace(/\s+/g, ' ').slice(0, 300)}`);
    }
  }
  if (!anyFail) lines.push('None.');
  lines.push('');

  lines.push('## Illustration coverage', '');
  const comps = Object.entries(art.competencies);
  const thin = comps.filter(([, v]) => v.candidates.length < 5);
  lines.push(`Approved Hiraia drawings mapped per competency (data/art/competency-candidates.json, catalog from Hiraia commit ${art.referenceCommit.slice(0, 9)}): ${comps.length} competencies, all with at least one candidate; ${thin.length} with fewer than five, where suitable art is thin:`, '');
  for (const [id, v] of thin) lines.push(`- ${id} (${(v as { candidates: unknown[] }).candidates.length} candidates)`);
  lines.push('');
  const noArt: string[] = [];
  for (const p of index.packs)
    for (const l of ['en'] as const) {
      const f = resolve(LIBRARY, p.packId, l, 'pack.json');
      if (!existsSync(f)) continue;
      const pack = WeeklyPackContent.parse(readJson(f));
      const content = pack.slides.filter((s) => !['cover', 'credits', 'day', 'reveal'].includes(s.kind));
      const ill = content.filter((s) => s.image).length;
      if (ill / Math.max(1, content.length) < 0.15) noArt.push(`${p.packId}: ${ill} of ${content.length} content slides illustrated`);
    }
  lines.push('Built weeks where fewer than 15% of content slides carry a drawing (missing suitable art, reported rather than filled with unrelated pictures):', '');
  lines.push(...(noArt.length ? noArt.map((x) => `- ${x}`) : ['None among built weeks.']), '');
  lines.push('Rights: no licence is recorded for the AI-generated PNG illustrations (Hiraia docs/licensing). They are used in drafts; publishing packs publicly needs Luis’s licensing decision.', '');

  const ledger = resolve(BUILD, 'calls.jsonl');
  if (existsSync(ledger)) {
    const rows = readFileSync(ledger, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { model: string; costUsd: number });
    const by = new Map<string, number>();
    for (const r of rows) by.set(r.model, (by.get(r.model) ?? 0) + r.costUsd);
    lines.push('## Model spend so far (all attempts, list prices)', '');
    lines.push('| Model | Calls | USD |', '|---|---:|---:|');
    for (const [m, usd] of [...by.entries()].sort((a, b) => b[1] - a[1])) lines.push(`| ${m} | ${rows.filter((r) => r.model === m).length} | ${usd.toFixed(2)} |`);
    lines.push(`| **Total** | ${rows.length} | **${rows.reduce((n, r) => n + r.costUsd, 0).toFixed(2)}** |`, '');
  }
  const text = lines.join('\n') + '\n';
  writeFileSync(resolve(LIBRARY, '..', 'INVENTORY.md'), text);
  return text;
}
