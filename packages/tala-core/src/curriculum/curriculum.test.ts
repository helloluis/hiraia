import test from 'node:test';
import assert from 'node:assert/strict';
import { Competency } from '../contracts/curriculum';
import { CompetencyCheck } from '../contracts/records';
import { applyChecks, domainKey, packId, parsePackId, searchCompetencies } from './index';
const competency = Competency.parse({
  id: 'fixture.science.g4.t1.1',
  grade: '4',
  learningAreaId: 'science',
  code: null,
  termIndex: 1,
  sequence: 1,
  text: 'SAMPLE DATA: objects',
  textLang: 'en',
  contentStandard: null,
  performanceStandard: null,
  domain: 'Matter',
  weight: null,
  weightSource: 'estimated',
  source: { document: 'Fixture', edition: null, page: null, url: null },
});
test('teacher correction is scoped to version, does not mutate published records, and affects search', () => {
  const check = CompetencyCheck.parse({
    id: 'check001',
    competencyId: competency.id,
    curriculumVersion: 'fixture',
    status: 'corrected',
    correction: { text: 'SAMPLE DATA: corrected', termIndex: 2, sequence: 3 },
  });
  assert.deepEqual(applyChecks([competency], [check], 'other'), [competency]);
  const corrected = applyChecks([competency], [check], 'fixture');
  assert.equal(competency.termIndex, 1);
  assert.equal(corrected[0]!.termIndex, 2);
  assert.equal(searchCompetencies(corrected, { keyword: 'CORRECTED', termIndex: 2 }).length, 1);
});
test('pack identity roundtrip and domain normalization', () => {
  assert.deepEqual(parsePackId(packId('v1', '4', 'science')), {
    curriculumVersion: 'v1',
    grade: '4',
    learningAreaId: 'science',
  });
  assert.throws(() => packId('v:1', '4', 'science'));
  assert.throws(() => parsePackId('missing'));
  assert.equal(domainKey('  Life   Science  '), 'life science');
  assert.equal(domainKey(' '), null);
});
