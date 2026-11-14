import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evaluationCases } from './cases';
import { evalRoot, liveDispatches, runEvaluationCase, type EvalProvider } from './runtime';

const live = process.argv.includes('--live');
const providerArg = process.argv.indexOf('--provider');
const selected = providerArg < 0 ? 'qwen' : process.argv[providerArg + 1];
if (!['deepseek', 'qwen', 'chain'].includes(selected ?? ''))
  throw Error('Use --provider deepseek|qwen|chain.');
// Credentials must already be in the runtime environment. Never load or copy a secret file here.
const providers: EvalProvider[] = live ? [selected as EvalProvider] : ['deepseek', 'qwen'];
const versionArg = process.argv.indexOf('--prompt-version');
const promptVersion = versionArg < 0 ? undefined : Number(process.argv[versionArg + 1]);
if (promptVersion !== undefined && (!Number.isInteger(promptVersion) || promptVersion < 1))
  throw Error('Use a positive --prompt-version.');
const filter = process.env.TALA_EVAL_CASE;
const cases = evaluationCases.filter((c) => !filter || filter.split(',').includes(c.id));
const runId = new Date().toISOString();
const rows = [];
for (const provider of providers)
  for (const fixture of cases) {
    const { result } = await runEvaluationCase(fixture, {
      live,
      provider,
      runId,
      sample: true,
      promptVersion,
    });
    rows.push(result);
  }
if (live)
  writeFileSync(
    resolve(evalRoot, `${selected}${promptVersion ? `-v${promptVersion}` : ''}-results.json`),
    JSON.stringify({ runId, provider: selected, calls: liveDispatches, results: rows }, null, 2) +
      '\n'
  );
process.exitCode = rows.every((r) => r.passed) ? 0 : 1;
