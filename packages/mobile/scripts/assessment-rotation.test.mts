import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { selectAssessment, resultFor } from '../src/assessment/selection.ts';
import type { AssessmentExposure, AssessmentRegistry, AssessmentResult, AssessmentSession } from '../src/assessment/types.ts';

const registry = JSON.parse(readFileSync(new URL('../src/assessment/bank.generated.json', import.meta.url), 'utf8')) as AssessmentRegistry;
const fixtures = JSON.parse(readFileSync(new URL('../../../rag/assessment-authoring/exposure-fixtures.json', import.meta.url), 'utf8')).blueprints;
const byId = new Map(registry.items.map(item => [item.id, item]));
const start = Date.parse('2026-09-28T04:00:00Z');
const fortnight = 14 * 86400000;

function finish(session: AssessmentSession, at: string, history: AssessmentResult[]) {
  return resultFor({ ...session, answers: session.items.map(item => ({ itemId: item.id, optionId: item.correctOptionId, answeredAt: at })) }, at, history);
}

// Exercise the actual app selector with many shuffles, not the Python capacity model.
// These deliberately rich synthetic exposures are not a model of ordinary app use.
for (const grade of [4, 5, 6, 7, 8, 9, 10]) {
  for (const language of ['en', 'tl', 'bis'] as const) {
    test(`grade ${grade}, ${language}: four seeds each sustain eight rich-history follow-ups`, () => {
      const blueprint = registry.blueprints.find(row => row.student_grade === grade)!;
      const groups = fixtures[blueprint.id].exposure_groups as string[][];
      for (let run = 0; run < 4; run++) {
        const context = { profileId: `rotation-${grade}-${language}-${run}`, grade, language };
        const history: AssessmentResult[] = [];
        const initial = selectAssessment(registry, context, { history, exposures: [] }, new Date(start).toISOString(), `baseline-${run}`, 'local_evaluation');
        assert.ok(initial.ok, initial.ok ? undefined : initial.reason);
        if (!initial.ok) return;
        history.push(finish(initial.session, new Date(start).toISOString(), history));
        for (let sessionNumber = 1; sessionNumber <= 8; sessionNumber++) {
          const now = new Date(start + sessionNumber * fortnight).toISOString();
          const exposures: AssessmentExposure[] = groups[(sessionNumber - 1) % groups.length]!.map(id => {
            const item = byId.get(id)!;
            const link = item.teachingLinks.find(link => !!link.hashes[language])!;
            assert.ok(link, `teaching version exists: ${id}/${language}`);
            return { cardId: link.cardId, familyId: item.familyId, language, presentedTextSha256: link.hashes[language], at: new Date(Date.parse(now) - 86400000).toISOString(), knowledgePresented: true };
          });
          const selected = selectAssessment(registry, context, { history, exposures }, now, `followup-${run}-${sessionNumber}`, 'local_evaluation');
          assert.ok(selected.ok, `${context.profileId}, session ${sessionNumber}: ${selected.ok ? '' : selected.reason}`);
          if (!selected.ok) return;
          const questions = selected.session.items;
          const previous = new Set(history.slice(-3).flatMap(result => result.session.items.map(item => item.id)));
          assert.equal(questions.length, 12);
          assert.equal(new Set(questions.map(item => item.id)).size, 12);
          assert.equal(new Set(questions.map(item => item.familyId)).size, 12);
          const sourceIds = questions.flatMap(item => item.sourceFactIds);
          assert.equal(new Set(sourceIds).size, sourceIds.length, 'no shared source identity');
          assert.equal(questions.filter(item => item.role === 'benchmark').length, 6);
          assert.equal(questions.filter(item => item.role === 'recent').length, 6, 'constructed history supports all six recent questions');
          assert.ok(questions.filter(item => previous.has(item.id)).length <= 2);
          assert.ok(!history.some(result => result.session.items.every(item => questions.some(candidate => candidate.id === item.id))), 'never repeat the whole paper');
          for (const question of questions) {
            const authored = byId.get(question.id)!;
            assert.equal(question.stem, authored.content.stem[language]);
            assert.equal(question.options.find(option => option.id === question.correctOptionId)?.text,
              authored.content.options.find(option => option.id === authored.content.correct_option_id)?.text[language]);
            assert.equal(question.productionReady, false, 'evaluation must not promote authoring approval');
          }
          history.push(finish(selected.session, now, history));
        }
      }
    });
  }
}
