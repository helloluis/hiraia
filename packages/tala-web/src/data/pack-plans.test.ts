import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Plan, PlanSection, WeeklyPackContent, type ClassRecord } from '@hiraia/tala-core/contracts';
import { planFromPackDay, weekdaysFrom } from './pack-plans';

const LIB = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../tala-packs/library/science-bow-2026');
const id = existsSync(LIB) ? readdirSync(LIB).find((d) => existsSync(resolve(LIB, d, 'en', 'pack.json'))) : undefined;

test('a pack day becomes one editable, tagged DLP plan that remembers its source', { skip: !id }, () => {
  const pack = WeeklyPackContent.parse(JSON.parse(readFileSync(resolve(LIB, id!, 'en', 'pack.json'), 'utf8')));
  let n = 0;
  const newId = () => `id-${++n}`;
  const cls = {
    id: 'class-1',
    name: 'Grade 3 and 4 Mabini',
    gradeGroups: [
      { id: 'g3', grade: '3', learnerCount: 12 },
      { id: 'g4', grade: '4', learnerCount: 15 },
    ],
  } as unknown as ClassRecord;
  const dates = weekdaysFrom('2026-11-25');
  assert.deepEqual(dates, ['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27']);
  for (const [i, day] of pack.days.entries()) {
    const { plan, sections } = planFromPackDay({ pack, review: { contentSha256: 'a'.repeat(64), publication: 'draft' }, day, cls, gradeGroupId: 'g4', assignmentId: null, date: dates[i]!, newId });
    Plan.parse(plan);
    for (const s of sections) PlanSection.parse(s);
    assert.equal(plan.templateId, 'tpl.dlp.v1');
    assert.deepEqual(plan.competencies, { g4: day.competencyIds });
    assert.equal(plan.curriculumVersion, pack.curriculumVersion);
    assert.equal(plan.lineage?.artifactId, `pack.${pack.packId}`);
    assert.equal(plan.aiDraft, true, 'an unreviewed pack arrives marked as an AI draft');
    assert.deepEqual(plan.placements[0]!.dates, [dates[i]]);
    const proc = sections.find((s) => s.key === 'procedure')!.content;
    assert.equal(proc.type, 'procedure');
    if (proc.type === 'procedure') assert.equal(proc.steps.reduce((m, s) => m + s.minutes, 0), day.minutes);
    const objectives = sections.find((s) => s.key === 'objectives')!;
    assert.equal(objectives.origin, 'copied');
    assert.deepEqual(objectives.content, { type: 'list', items: [day.objective] });
    // Post-class sections stay empty and the teacher's own.
    for (const k of ['results', 'reflection']) {
      const s = sections.find((x) => x.key === k);
      if (s) assert.equal(s.origin, 'manual');
    }
  }
});
