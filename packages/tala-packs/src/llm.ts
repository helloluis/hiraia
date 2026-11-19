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

/** Published prices (2026-11-19), at DeepSeek's peak rate (01:00-04:00, 06:00-10:00 UTC weekdays; half off-peak,
 * applied per call by rateFactor). Qwen: Singapore list prices. */
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

/**
 * DeepSeek peak hours (published 2026-11-19): 01:00-04:00 and 06:00-10:00 UTC, Monday to Friday; off-peak is half
 * price. (Chinese public holidays are also off-peak; not modelled, so the estimate errs high on those days.)
 */
export function isDeepSeekPeak(d = new Date()): boolean {
  const day = d.getUTCDay();
  if (day === 0 || day === 6) return false;
  const h = d.getUTCHours() + d.getUTCMinutes() / 60;
  return (h >= 1 && h < 4) || (h >= 6 && h < 10);
}
/** Price factor for a call starting now: DeepSeek off-peak is half; Qwen has one price. */
export function rateFactor(spec: ModelSpec, d = new Date()): number {
  return spec.provider === 'deepseek' && !isDeepSeekPeak(d) ? 0.5 : 1;
}
/** Milliseconds until DeepSeek's next off-peak minute (0 when off-peak now). */
export function msUntilDeepSeekOffPeak(d = new Date()): number {
  if (!isDeepSeekPeak(d)) return 0;
  const h = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
  const end = h < 4 ? 4 : 10;
  return Math.ceil((end - h) * 3_600_000) + 30_000;
}

let offPeakOnly = false;
/** When set, every DeepSeek call waits for off-peak hours before it starts (the batch runs at half price). */
export function setDeepSeekOffPeakOnly(on: boolean) {
  offPeakOnly = on;
}

export class Meter {
  spentUsd = 0;
  calls = 0;
  /** Worst-case cost of calls in flight: with several workers, each must count the others' reservations. */
  reservedUsd = 0;
  constructor(
    readonly budgetUsd: number,
    readonly ledgerPath: string,
    initialSpend = 0,
    /** Written on every ledger row, e.g. { batch: 'priority-2026-11-19' }, so a cap can span restarts. */
    readonly tags: Record<string, string> = {}
  ) {
    this.spentUsd = initialSpend;
    mkdirSync(dirname(ledgerPath), { recursive: true });
  }
  /**
   * Refuse a call whose worst case (every maxTokens used, priced at the rate in force now) could pass the budget
   * together with what is spent and what the other in-flight calls might still cost. Returns the reservation,
   * to be released when the call ends.
   */
  reserve(spec: ModelSpec, approxInputTokens: number, maxTokens: number, at = new Date()): number {
    const worst = ((approxInputTokens * spec.inputPerM + maxTokens * spec.outputPerM) / 1e6) * rateFactor(spec, at);
    if (this.spentUsd + this.reservedUsd + worst > this.budgetUsd)
      throw new BudgetExceeded(
        `Budget guard: $${this.spentUsd.toFixed(2)} spent and $${this.reservedUsd.toFixed(2)} reserved by calls in flight; the next call could cost up to $${worst.toFixed(3)}; cap $${this.budgetUsd.toFixed(2)}.`
      );
    this.reservedUsd += worst;
    return worst;
  }
  release(reservation: number) {
    this.reservedUsd = Math.max(0, this.reservedUsd - reservation);
  }
  /** Spend per pack (the label's first segment), so a week's cost is its own even with several workers. */
  readonly byPack = new Map<string, number>();
  record(entry: Record<string, unknown> & { costUsd: number }) {
    this.spentUsd += entry.costUsd;
    this.calls += 1;
    const pack = String(entry.label ?? '').split(':')[0] ?? '';
    this.byPack.set(pack, (this.byPack.get(pack) ?? 0) + entry.costUsd);
    appendFileSync(this.ledgerPath, JSON.stringify({ at: new Date().toISOString(), ...this.tags, ...entry }) + '\n');
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
  if (offPeakOnly && spec.provider === 'deepseek') {
    for (let wait = msUntilDeepSeekOffPeak(); wait > 0; wait = msUntilDeepSeekOffPeak()) {
      console.log(`${new Date().toISOString()} ${o.label}: waiting ${Math.round(wait / 60000)} min for DeepSeek off-peak pricing`);
      await new Promise((r) => setTimeout(r, Math.min(wait, 15 * 60_000)));
    }
  }
  const startedAt = new Date();
  const factor = rateFactor(spec, startedAt);
  const reservation = meter.reserve(spec, approxTokens(o.messages), o.maxTokens, startedAt);
  try {
    return await callOnce(meter, o, factor);
  } finally {
    meter.release(reservation);
  }
}

async function callOnce(meter: Meter, o: CallOptions, factor: number): Promise<CallResult> {
  const { spec } = o;
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
  // Priced at the rate in force when the call started (DeepSeek off-peak is half); cache hits are not discounted,
  // so the ledger errs high.
  const costUsd = ((inputTokens * spec.inputPerM + outputTokens * spec.outputPerM) / 1e6) * factor;
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
    rate: factor === 1 ? 'list' : 'off-peak',
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
