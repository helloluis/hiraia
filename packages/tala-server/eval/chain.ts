import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evaluationCases } from './cases';
import { evalRoot, runEvaluationCase } from './runtime';
import { ProviderHttpError, type AttemptDiagnostic } from '../src/modules/llm';

const fixture = evaluationCases.find((c) => c.id === 'single-dlp-en')!;
const runId = new Date().toISOString();
const counts = { deepseek: 0, qwen: 0 };
const count = (event: AttemptDiagnostic) => {
  if (event.attempt > 0 && (event.provider === 'deepseek' || event.provider === 'qwen'))
    counts[event.provider]++;
};
const primary = await runEvaluationCase(fixture, {
  live: true,
  provider: 'chain',
  runId: `${runId}:primary`,
  onAttempt: count,
});
assert.equal(primary.result.passed, true);
assert.equal(primary.result.servedBy, 'deepseek');
assert.equal(primary.result.fellBack, false);
assert.equal(
  primary.attempts.filter((a) => a.provider === 'deepseek' && a.attempt > 0).length,
  1,
  'Primary proof must use one live completion.'
);
const original = process.env.TALA_LLM_PRIMARY_MODEL;
let fallback;
try {
  // A deliberate invalid model exercises the real primary HTTP failure; credentials are never modified.
  process.env.TALA_LLM_PRIMARY_MODEL = 'tala-eval-deliberately-unavailable-model';
  fallback = await runEvaluationCase(fixture, {
    live: true,
    provider: 'chain',
    runId: `${runId}:fallback`,
    onAttempt: count,
  });
} finally {
  if (original === undefined) delete process.env.TALA_LLM_PRIMARY_MODEL;
  else process.env.TALA_LLM_PRIMARY_MODEL = original;
}
assert.equal(fallback.result.passed, true);
assert.equal(fallback.result.servedBy, 'qwen');
assert.equal(fallback.result.fellBack, true);
assert.equal(
  fallback.attempts.filter((a) => a.provider === 'qwen' && a.attempt > 0).length,
  1,
  'Fallback proof must use one live completion.'
);
assert.ok(
  fallback.attempts.some(
    (a) =>
      a.provider === 'deepseek' &&
      a.stage === 'provider' &&
      a.httpStatus !== null &&
      a.httpStatus >= 400
  )
);
const unavailable = await runEvaluationCase(fixture, {
  live: false,
  provider: 'chain',
  runId: `runId:unavailable`,
  call: async () => {
    throw new ProviderHttpError(503, 'controlled_unavailable');
  },
});
assert.equal(unavailable.fallback.typedFailure, 'providers_unavailable');
assert.equal(unavailable.result.status, 'failed');
assert.ok(unavailable.fallback.prefilledSectionCount > 0);
assert.equal(unavailable.fallback.inputsPreserved, true);
const report = {
  runId,
  liveDispatches: counts,
  primary: primary.result,
  fallback: fallback.result,
  bothUnavailable: {
    mode: 'controlled providers; no live calls',
    ...unavailable.fallback,
    passed: true,
  },
  passed: true,
};
writeFileSync(resolve(evalRoot, 'chain-proof.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ chainProof: true, ...counts, bothUnavailable: true }));
