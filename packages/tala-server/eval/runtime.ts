import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GeneratedSection, type GenerationJob } from '@hiraia/tala-core';
import { buildPrefilledDraft, validateGeneratedSections } from '@hiraia/tala-core/generation';
import { createTestServer } from '../src/testing';
import type { LlmResult, ProviderConfig } from '../src/kernel/types';
import { generationModule } from '../src/modules/generation';
import {
  createLlmGateway,
  llmModule,
  ProviderHttpError,
  type AttemptDiagnostic,
  type ProviderCall,
} from '../src/modules/llm';
import { evaluationCases, objectivesFor } from './cases';
import { fakeCompactRaw } from './fixtures';

export type EvalProvider = 'deepseek' | 'qwen' | 'chain';
export const liveDispatches = { deepseek: 0, qwen: 0 };
export const evalRoot = dirname(fileURLToPath(import.meta.url));
export interface EvalOptions {
  live: boolean;
  provider: EvalProvider;
  runId: string;
  onAttempt?: (event: AttemptDiagnostic) => void;
  call?: ProviderCall;
  sample?: boolean;
}
function rate(name: string): number {
  const value = Number(process.env[name]);
  if (!process.env[name] || !Number.isFinite(value) || value < 0)
    throw Error(`Configure ${name} before live evaluation.`);
  return value;
}
export function providerConfigs(live: boolean, provider: EvalProvider) {
  const primary: ProviderConfig = {
    apiKeyEnv: live && provider !== 'qwen' ? 'DEEPSEEK_API_KEY' : 'TALA_EVAL_DISABLED_PRIMARY',
    model: process.env.TALA_LLM_PRIMARY_MODEL || 'deepseek-flash',
    baseUrl: 'https://api.deepseek.com',
    timeoutMs: 120000,
    pricing:
      live && provider !== 'qwen'
        ? {
            inputUsdPerMillion: rate('TALA_LLM_PRIMARY_INPUT_USD_PER_MILLION'),
            outputUsdPerMillion: rate('TALA_LLM_PRIMARY_OUTPUT_USD_PER_MILLION'),
          }
        : { inputUsdPerMillion: 0, outputUsdPerMillion: 0 },
  };
  const fallback: ProviderConfig = {
    apiKeyEnv:
      live && provider !== 'deepseek' ? 'DASHSCOPE_API_KEY' : 'TALA_EVAL_DISABLED_FALLBACK',
    model: process.env.TALA_LLM_FALLBACK_MODEL || 'qwen-flash',
    baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    timeoutMs: 120000,
    pricing:
      live && provider !== 'deepseek'
        ? {
            inputUsdPerMillion: rate('TALA_LLM_FALLBACK_INPUT_USD_PER_MILLION'),
            outputUsdPerMillion: rate('TALA_LLM_FALLBACK_OUTPUT_USD_PER_MILLION'),
          }
        : { inputUsdPerMillion: 0, outputUsdPerMillion: 0 },
  };
  // The adapter only uses ALIBABACLOUD_API_KEY as a fallback for the named DashScope key.
  // A pure DeepSeek sweep must never silently succeed through Qwen.
  return { primary, fallback };
}
export async function runEvaluationCase(
  fixture: (typeof evaluationCases)[number],
  options: EvalOptions
) {
  const input = { ...fixture.input, resolvedObjectives: objectivesFor(fixture.input) };
  const attempts: AttemptDiagnostic[] = [];
  const fake: ProviderCall = async (p) => {
    if (p !== (options.provider === 'chain' ? 'deepseek' : options.provider))
      throw Error('Unavailable fixture provider.');
    return {
      content: JSON.stringify(fakeCompactRaw(input)),
      inputTokens: 100,
      outputTokens: 200,
      costUsd: 0,
      httpStatus: 200,
      finishReason: 'stop',
      latencyMs: 1,
    };
  };
  const module = {
    ...llmModule,
    services: (deps: Parameters<NonNullable<typeof llmModule.services>>[0]) => {
      const llm = createLlmGateway(deps, {
        ...(options.live
          ? {
              beforeCall: (provider: 'deepseek' | 'qwen' | 'local') => {
                if (provider === 'local') throw Error('No local model in live provider eval.');
                if (liveDispatches[provider] >= (provider === 'deepseek' ? 40 : 5))
                  throw new ProviderHttpError(0, 'eval_call_limit');
                liveDispatches[provider]++;
              },
            }
          : {}),
        ...(options.call ? { call: options.call } : options.live ? {} : { call: fake }),
        onAttempt: (event) => {
          attempts.push(event);
          options.onAttempt?.(event);
          if (options.live)
            appendFileSync(
              resolve(evalRoot, `${options.provider}-attempts.jsonl`),
              JSON.stringify({ run: options.runId, case: fixture.id, ...event }) + '\n'
            );
          console.log(JSON.stringify({ case: fixture.id, ...event }));
        },
      });
      return {
        llm: {
          routeFor: llm.routeFor,
          complete: async <T>(req: Parameters<typeof llm.complete<T>>[0]) => {
            const result = await llm.complete(req);
            attribution = result;
            return result;
          },
        },
      };
    },
  };
  let attribution: LlmResult<unknown> | undefined;
  const configs = providerConfigs(options.live, options.provider);
  const t = createTestServer({
    modules: [module, generationModule],
    config: {
      features: { generation: true },
      llm: {
        ...configs,
        budget: { monthlyUsd: 3, alertAtUsd: 2.5 },
        quotas: { fullPerDay: 50, sectionPerDay: 50 },
        cacheSeconds: 0,
      },
    },
    services: {
      curriculum: {
        getCompetencies: (_version, ids) =>
          ids.map((id) => ({
            id,
            code: null,
            text:
              fixture.input.language === 'fil' ? 'Ilarawan ang mga halaman.' : 'Describe plants.',
          })) as never,
        versionFor: () => null,
      },
    },
    quiet: true,
  });
  const started = Date.now();
  try {
    const teacher = await t.registerUser();
    const created = await t.ok('generation.create', { body: fixture.input, token: teacher.token });
    let job: GenerationJob = created;
    while (job.status === 'queued' || job.status === 'running') {
      if (Date.now() - started > 510000) throw Error('Job wait exceeded.');
      await new Promise((r) => setTimeout(r, 100));
      job = await t.ok('generation.get', { params: { jobId: created.id }, token: teacher.token });
    }
    const errors = job.result
      ? validateGeneratedSections(input, job.result.sections)
      : ['generation_failed'];
    const schema =
      !!job.result && job.result.sections.every((s) => GeneratedSection.safeParse(s).success);
    const valid = (pattern: RegExp) => schema && !errors.some((e) => pattern.test(e));
    const result = {
      provider: options.provider,
      servedBy: job.result?.provider ?? null,
      model: job.result?.model ?? null,
      fellBack: attribution?.ok ? attribution.fellBack : null,
      case: fixture.id,
      mode: options.live ? 'live' : 'fake',
      status: job.status,
      schema,
      teacherFocus: valid(/unpaired|teacher|focus|Shared/i),
      everyGroupActive: valid(/activity/),
      competencyPresence: valid(/objectives|assessment|competency/),
      timeBudget: valid(/minutes|budget|Transition|Weekly|weekday/),
      materials: valid(/materials|resources/i),
      issues: errors.length ? [job.failure?.reason ?? 'structure'] : [],
      inputTokens: attempts.reduce((n, a) => n + a.inputTokens, 0),
      outputTokens: attempts.reduce((n, a) => n + a.outputTokens, 0),
      latencyMs: Date.now() - started,
      retried: attempts.some((a) => a.attempt === 2),
      repair: !!job.result?.warnings.length,
      deterministicConversion: true,
      costUsd: attempts.reduce((sum, a) => {
        const rates =
          a.provider === 'deepseek' ? configs.primary.pricing : configs.fallback.pricing;
        return (
          sum +
          (a.inputTokens * (rates?.inputUsdPerMillion ?? 0) +
            a.outputTokens * (rates?.outputUsdPerMillion ?? 0)) /
            1e6
        );
      }, 0),
      budgetLedgerUsd: (
        t.db.prepare('SELECT COALESCE(SUM(cost),0) AS n FROM llm_usage').get() as { n: number }
      ).n,
      passed:
        schema &&
        !errors.length &&
        (options.provider === 'chain' || job.result?.provider === options.provider),
    };
    if (
      options.live &&
      options.sample &&
      result.passed &&
      ['g2-g4-en', 'three-group-fil', 'weekly-dll-fil'].includes(fixture.id)
    ) {
      mkdirSync(resolve(evalRoot, 'samples'), { recursive: true });
      const suffix =
        options.provider === 'deepseek'
          ? '-deepseek'
          : options.provider === 'chain'
            ? '-chain'
            : '';
      writeFileSync(
        resolve(evalRoot, 'samples', `${fixture.id}${suffix}.json`),
        JSON.stringify(
          {
            input: fixture.input,
            plan: job.result,
            review:
              'Teacher quality review pending; structural checks do not establish scientific or pedagogical quality.',
          },
          null,
          2
        ) + '\n'
      );
    }
    const prefilled = buildPrefilledDraft(input);
    const fallback = {
      typedFailure: attribution && !attribution.ok ? attribution.reason : null,
      prefilledSectionCount: prefilled.sections.length,
      inputsPreserved: !!t.db.prepare('SELECT input FROM generation_jobs WHERE id=?').get(job.id),
    };
    console.log(JSON.stringify(result));
    return { result, attempts, fallback };
  } finally {
    t.close();
  }
}
