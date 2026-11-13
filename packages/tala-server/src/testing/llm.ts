/**
 * A scripted stand-in for the model gateway, for tests of modules that call `ctx.services.llm`.
 * OWNER: workstream A. No network, no provider, no key.
 *
 *   const llm = createFakeLlm({ answers: { 'roster.names': { rows: [] } } });
 *   const t = createTestServer({ modules: [rosterModule], services: { llm } });
 *   …
 *   assert.equal(llm.calls.length, 1);
 *   assert.ok(!JSON.stringify(llm.calls[0].vars).includes('LRN'));   // what was sent to the "model"
 *
 * It behaves like the real gateway where callers can tell the difference: the answer is validated against
 * the request's schema and `check`, routes 'off' and 'rules' decline without calling anything, and a missing
 * or failing answer is reported as an unavailable provider. Callers must cope with every one of those.
 */
import type { Id, LlmFeature, LlmRoute } from '@hiraia/tala-core';
import type { LlmGateway, LlmRequest, LlmResult } from '../kernel/types';

export interface FakeLlmCall {
  feature: LlmFeature;
  promptId: string;
  version: number | undefined;
  /** Exactly what the caller passed for the prompt's placeholders. */
  vars: Record<string, string>;
  userId: Id | null;
  route: LlmRoute;
}

/** A value to return as the model's output, or a function that produces one from the request. */
export type FakeLlmAnswer = unknown | ((request: LlmRequest<unknown>) => unknown);

export interface FakeLlmOptions {
  /** Output per feature; `'*'` answers any feature not listed. A function that throws simulates a provider failure. */
  answers?: Partial<Record<LlmFeature | '*', FakeLlmAnswer>>;
  /** Route reported per feature. Default 'cloud'. */
  routes?: Partial<Record<LlmFeature, LlmRoute>>;
  provider?: 'deepseek' | 'qwen' | 'local';
  /** Report the answer as having come from the fallback provider. */
  fellBack?: boolean;
}

export type FakeLlm = LlmGateway & {
  /** Every request that reached a "model", in order. */
  calls: FakeLlmCall[];
  /** Change an answer mid-test. */
  answer(feature: LlmFeature | '*', value: FakeLlmAnswer): void;
};

export function createFakeLlm(options: FakeLlmOptions = {}): FakeLlm {
  const answers = new Map<string, FakeLlmAnswer>(Object.entries(options.answers ?? {}));
  const calls: FakeLlmCall[] = [];
  const routeFor = (feature: LlmFeature): LlmRoute => options.routes?.[feature] ?? 'cloud';

  return {
    calls,
    routeFor,
    answer(feature, value) {
      answers.set(feature, value);
    },
    async complete<T>(request: LlmRequest<T>): Promise<LlmResult<T>> {
      const route = request.route ?? routeFor(request.feature);
      if (route === 'off')
        return {
          ok: false,
          reason: 'disabled',
          message: 'AI help is switched off for this feature.',
        };
      if (route === 'rules')
        return {
          ok: false,
          reason: 'rules_only',
          message: 'This feature is set to work without AI.',
        };
      if (request.signal?.aborted) return { ok: false, reason: 'cancelled', message: 'Cancelled.' };

      calls.push({
        feature: request.feature,
        promptId: request.promptId,
        version: request.version,
        vars: { ...request.vars },
        userId: request.userId,
        route,
      });
      const scripted = answers.has(request.feature)
        ? answers.get(request.feature)
        : answers.get('*');
      if (scripted === undefined)
        return {
          ok: false,
          reason: 'providers_unavailable',
          message: 'No answer is scripted for this feature.',
        };

      let raw: unknown;
      try {
        raw =
          typeof scripted === 'function'
            ? (scripted as (r: LlmRequest<unknown>) => unknown)(request as LlmRequest<unknown>)
            : scripted;
      } catch {
        return {
          ok: false,
          reason: 'providers_unavailable',
          message: 'The scripted provider failed.',
        };
      }
      const parsed = request.schema.safeParse(raw);
      if (!parsed.success)
        return {
          ok: false,
          reason: 'invalid_output',
          message: 'The scripted answer does not fit the schema.',
        };
      const problems = request.check?.(parsed.data) ?? [];
      if (problems.length > 0)
        return { ok: false, reason: 'invalid_output', message: problems.join(' ') };

      return {
        ok: true,
        data: parsed.data,
        provider: options.provider ?? (route === 'local' ? 'local' : 'deepseek'),
        model: 'fake-model',
        promptId: request.promptId,
        promptVersion: request.version ?? 1,
        usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
        fellBack: options.fellBack ?? false,
      };
    },
  };
}
