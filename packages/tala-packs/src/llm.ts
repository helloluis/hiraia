/**
 * Direct model calls for offline pack production. Approved providers only, called on their own APIs:
 * DeepSeek (api.deepseek.com) and Alibaba Model Studio (dashscope-intl.aliyuncs.com, Singapore). Never an
 * aggregator. Keys come from the environment (`DEEPSEEK_API_KEY`, `DASHSCOPE_API_KEY` / `ALIBABACLOUD_API_KEY`)
 * and are never written anywhere.
 *
 * Every call is metered against a hard budget (USD) and appended to a call ledger (no prompt or key content,
 * only model, tokens, cost, latency and outcome). Prices are explicit configuration checked against the
 * providers' published price pages on 2026-11-19; an unpriced model is refused.
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type Provider = 'deepseek' | 'qwen';
export interface ModelSpec {
  provider: Provider;
  model: string;
  /** USD per 1M tokens. */
  inputPerM: number;
  outputPerM: number;
  /** DeepSeek charges half outside its peak windows; the cheaper rate is never assumed. */
  note?: string;
}

/** Published prices (2026-11-19). DeepSeek: peak rates (01:00-04:00, 06:00-10:00 UTC weekdays) used as the
 * conservative estimate; off-peak is half. Qwen: Singapore list prices. */
export const MODELS = {
  writer: { provider: 'deepseek', model: 'deepseek-v4-pro', inputPerM: 1.32, outputPerM: 3.96 },
  writerFlash: { provider: 'deepseek', model: 'deepseek-flash', inputPerM: 0.3, outputPerM: 1.2 },
  critic: { provider: 'qwen', model: 'qwen4-max', inputPerM: 1.5, outputPerM: 4.5 },
  vision: { provider: 'qwen', model: 'qwen3-vl-plus', inputPerM: 0.2, outputPerM: 1.6 },
} as const satisfies Record<string, ModelSpec>;

const ENDPOINT: Record<Provider, string> = {
  deepseek: 'https://api.deepseek.com/chat/completions',
  qwen: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
};

function keyFor(p: Provider): string {
  const key =
    p === 'deepseek'
      ? process.env.DEEPSEEK_API_KEY
      : process.env.DASHSCOPE_API_KEY || process.env.ALIBABACLOUD_API_KEY;
  if (!key) throw new Error(`No key in the environment for ${p}.`);
  return key;
}

export type Content = string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: Content;
}

export interface CallOptions {
  spec: ModelSpec;
  messages: ChatMessage[];
  maxTokens: number;
  /** Model reasoning before answering (billed as output). */
  thinking?: boolean;
  /** Label for the ledger, e.g. `sci26-g4-t1-w03:outline`. */
  label: string;
  timeoutMs?: number;
}

export interface CallResult {
  content: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  costUsd: number;
  finishReason: string;
  latencyMs: number;
}

export class BudgetExceeded extends Error {}
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean
  ) {
    super(message);
  }
}

export class Meter {
  spentUsd = 0;
  calls = 0;
  constructor(
    readonly budgetUsd: number,
    readonly ledgerPath: string,
    initialSpend = 0
  ) {
    this.spentUsd = initialSpend;
    mkdirSync(dirname(ledgerPath), { recursive: true });
  }
  /** Refuse a call whose worst case (all maxTokens used) could pass the budget. */
  reserve(spec: ModelSpec, approxInputTokens: number, maxTokens: number) {
    const worst = (approxInputTokens * spec.inputPerM + maxTokens * spec.outputPerM) / 1e6;
    if (this.spentUsd + worst > this.budgetUsd)
      throw new BudgetExceeded(
        `Budget guard: $${this.spentUsd.toFixed(2)} spent, next call could cost up to $${worst.toFixed(3)}, cap $${this.budgetUsd}.`
      );
  }
  record(entry: Record<string, unknown> & { costUsd: number }) {
    this.spentUsd += entry.costUsd;
    this.calls += 1;
    appendFileSync(this.ledgerPath, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n');
  }
}

const approxTokens = (messages: ChatMessage[]) =>
  Math.ceil(
    messages.reduce(
      (n, m) =>
        n +
        (typeof m.content === 'string'
          ? m.content.length
          : m.content.reduce((k, part) => k + (part.type === 'text' ? part.text.length : 1200), 0)),
      0
    ) / 3.2
  );

export async function chat(meter: Meter, o: CallOptions): Promise<CallResult> {
  const { spec } = o;
  meter.reserve(spec, approxTokens(o.messages), o.maxTokens);
  const body: Record<string, unknown> = {
    model: spec.model,
    messages: o.messages,
    response_format: { type: 'json_object' },
    max_tokens: o.maxTokens,
  };
  if (spec.provider === 'deepseek') body.thinking = { type: o.thinking ? 'enabled' : 'disabled' };
  if (spec.provider === 'qwen') body.enable_thinking = Boolean(o.thinking);
  const started = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), o.timeoutMs ?? 600_000);
  let res: Response;
  try {
    res = await fetch(ENDPOINT[spec.provider], {
      method: 'POST',
      signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${keyFor(spec.provider)}` },
      body: JSON.stringify(body),
    });
  } catch (e) {
    clearTimeout(timer);
    meter.record({ label: o.label, model: spec.model, outcome: 'network_error', costUsd: 0, latencyMs: Date.now() - started });
    throw new ProviderError(`Network error calling ${spec.model}: ${(e as Error).name}`, 0, true);
  }
  clearTimeout(timer);
  let j: any;
  try {
    j = await res.json();
  } catch {
    meter.record({ label: o.label, model: spec.model, outcome: `http_${res.status}_nonjson`, costUsd: 0 });
    throw new ProviderError(`${spec.model} returned a non-JSON envelope (HTTP ${res.status}).`, res.status, res.status >= 500);
  }
  if (!res.ok) {
    const code = String(j?.error?.code ?? j?.code ?? 'error');
    meter.record({ label: o.label, model: spec.model, outcome: `http_${res.status}:${code}`, costUsd: 0 });
    throw new ProviderError(`${spec.model} HTTP ${res.status} (${code}).`, res.status, res.status === 429 || res.status >= 500);
  }
  const usage = j.usage ?? {};
  const inputTokens = usage.prompt_tokens ?? approxTokens(o.messages);
  const outputTokens = usage.completion_tokens ?? o.maxTokens;
  const reasoningTokens = usage.completion_tokens_details?.reasoning_tokens ?? 0;
  const costUsd = (inputTokens * spec.inputPerM + outputTokens * spec.outputPerM) / 1e6;
  const finishReason = j.choices?.[0]?.finish_reason ?? 'unknown';
  const latencyMs = Date.now() - started;
  meter.record({
    label: o.label,
    model: spec.model,
    outcome: finishReason,
    inputTokens,
    outputTokens,
    reasoningTokens,
    costUsd: Number(costUsd.toFixed(6)),
    latencyMs,
  });
  return {
    content: j.choices?.[0]?.message?.content ?? '',
    inputTokens,
    outputTokens,
    reasoningTokens,
    costUsd,
    finishReason,
    latencyMs,
  };
}

/** Parse a model's JSON object reply; tolerate a fenced block but nothing else. */
export function parseJsonObject(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  return JSON.parse(trimmed);
}
