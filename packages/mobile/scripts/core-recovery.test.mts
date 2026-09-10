import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { lessonsForGrade } from '../src/data/lessonPlan';
import { loadCards } from './load-cards-node.mts';
const read = (p: string) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const recoveryDir = new URL('../../../tools/curriculum-recovery/', import.meta.url);
const checkpoint = read('../../../tools/curriculum-recovery/checkpoint.json');
const batches = readdirSync(recoveryDir).filter((name) => /^batch-\d+\.review\.prior\.json$/.test(name)).sort();
const rows = batches.flatMap((name) =>
  readFileSync(new URL(name.replace('.prior.json', '.jsonl'), recoveryDir), 'utf8')
    .trim().split('\n').map((line) => JSON.parse(line))
);
const C = await loadCards();
const exclusions = read('../src/data/curriculumTagExclusions.json');
test('every approved recovery is a real core candidate with its reviewed competency', () => {
  const approved = rows.filter((r) => r.disposition === 'recover_core');
  assert.equal(approved.length, checkpoint.recoveredCoreFacts);
  for (const r of approved) {
    assert.ok(!Object.hasOwn(exclusions, r.factId), r.factId);
    for (const code of r.codes) {
      assert.ok(C.competencyKeys(r.id).includes(code), r.id);
      const lessons = lessonsForGrade(Number(/^G(\d+)/.exec(code)![1]));
      assert.ok(
        lessons.some((l) => l.units.some((u) => u.competency === code && u.cardIds.includes(r.id))),
        r.id
      );
    }
    for (const evidence of r.evidence) {
      const grade = Number(/^G(\d+)/.exec(evidence.unit)![1]);
      const unit = lessonsForGrade(grade).find((l) => l.key === evidence.lesson)?.units.find((u) => u.id === evidence.unit);
      assert.ok(unit?.cardIds.includes(r.id), `${r.id}: ${evidence.unit}`);
    }
    for (const lang of ['english', 'tagalog', 'cebuano'])
      assert.ok(C.cardText(C.getCard(r.id), lang), r.id);
  }
});
test('held cards remain excluded and all decisions retain content identity and reasons', () => {
  const pool = new Map(
    read('../../../rag/pipeline/cardsPool.app.json').cards.map((c: any) => [c.factId, c])
  );
  assert.equal(rows.length, checkpoint.manuallyReviewed);
  assert.equal(new Set(rows.map((r) => r.factId)).size, rows.length);
  for (const r of rows) {
    assert.ok(r.reason && r.previousExclusion);
    if (r.disposition === 'hold') assert.ok(Object.hasOwn(exclusions, r.factId), r.factId);
    const c: any = pool.get(r.factId);
    // Python's reviewed hash uses sorted keys and its standard JSON separators.
    const text =
      '{' +
      Object.keys(c.fact)
        .sort()
        .map((k) => JSON.stringify(k) + ': ' + JSON.stringify(c.fact[k]))
        .join(', ') +
      '}';
    assert.equal(createHash('sha256').update(text).digest('hex'), r.textHash, r.factId);
  }
});
test('recovered teaching parts do not impersonate the required diagram or table activity', () => {
  const units = lessonsForGrade(5).flatMap((l) => l.units);
  assert.ok(units.find((u) => u.id === 'G5-L-4:fungi')!.cardIds.includes('ffct-05866'));
  assert.ok(
    !units.find((u) => u.id === 'G5-L-4:classification-table')!.cardIds.includes('ffct-05866')
  );
  const life = lessonsForGrade(4).flatMap((l) => l.units);
  assert.ok(life.find((u) => u.id === 'G4-L-5:butterfly')!.cardIds.includes('ffct-00000'));
  assert.ok(!life.find((u) => u.id === 'G4-L-5:flow-chart')!.cardIds.includes('ffct-00000'));
  assert.ok(!life.find((u) => u.id === 'G4-L-5:human')!.cardIds.includes('ffct-00787'));
});
