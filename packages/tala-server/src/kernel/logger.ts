/**
 * Structured logger that cannot log bodies (PRD §14.4: logs contain no plan bodies, roster content,
 * prompts or model output; tokens and passwords never reach a log).
 * OWNER: workstream A.
 *
 * How that is enforced, beyond the type (`fields` may only hold primitives):
 *  - anything that is not a string, finite number, boolean or null is dropped;
 *  - a field whose NAME suggests content or a credential is replaced with "[redacted]";
 *  - strings are cut at MAX_VALUE_LENGTH and stripped of control characters, so a document cannot ride along;
 *  - the event name must be a short identifier, so content cannot be smuggled in as the event.
 */
import type { Logger } from './types';

export type LogLevel = 'info' | 'warn' | 'error';
export type LogValue = string | number | boolean | null;
export type LogFields = Record<string, LogValue>;

export interface LogEntry {
  ts: string;
  level: LogLevel;
  event: string;
  fields: LogFields;
}

export type LogSink = (entry: LogEntry) => void;

export const MAX_VALUE_LENGTH = 200;
const MAX_FIELDS = 24;
const EVENT_RE = /^[A-Za-z0-9_.:-]{1,80}$/;
const KEY_RE = /^[A-Za-z0-9_.-]{1,48}$/;

/** Field names that must never carry a value into a log line. Matched as substrings, case-insensitively. */
const SENSITIVE_KEY_PARTS = [
  'password',
  'passwd',
  'secret',
  'token',
  'authorization',
  'cookie',
  'apikey',
  'api_key',
  'credential',
  'email',
  'body',
  'prompt',
  'content',
  'output',
  'roster',
  'student',
  'learner',
  'displayname',
  'fullname',
  'familyname',
  'givenname',
  'address',
];

export function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase().replace(/-/g, '_');
  return SENSITIVE_KEY_PARTS.some((part) => k.includes(part) || k.replace(/_/g, '').includes(part));
}

function cleanString(value: string): string {
  // eslint-disable-next-line no-control-regex
  const flat = value.replace(/[\u0000-\u001f\u007f]+/g, ' ');
  return flat.length > MAX_VALUE_LENGTH ? `${flat.slice(0, MAX_VALUE_LENGTH)}…` : flat;
}

export function sanitiseFields(fields: Record<string, unknown> | undefined): LogFields {
  const out: LogFields = {};
  if (!fields) return out;
  let count = 0;
  for (const [key, value] of Object.entries(fields)) {
    if (count >= MAX_FIELDS) break;
    if (!KEY_RE.test(key)) continue;
    count++;
    if (isSensitiveKey(key)) {
      out[key] = '[redacted]';
    } else if (typeof value === 'string') {
      out[key] = cleanString(value);
    } else if (typeof value === 'number') {
      out[key] = Number.isFinite(value) ? value : null;
    } else if (typeof value === 'boolean' || value === null) {
      out[key] = value;
    }
    // objects, arrays, functions, undefined, bigint, symbols: dropped on purpose
  }
  return out;
}

export const stdoutSink: LogSink = (entry) => {
  process.stdout.write(`${JSON.stringify({ ts: entry.ts, level: entry.level, event: entry.event, ...entry.fields })}\n`);
};

export const silentSink: LogSink = () => {};

export interface LoggerOptions {
  sink?: LogSink;
  now?: () => Date;
  /** Fields added to every entry (for example requestId). Sanitised like any others. */
  base?: Record<string, unknown>;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const sink = options.sink ?? stdoutSink;
  const now = options.now ?? (() => new Date());
  const base = sanitiseFields(options.base);
  const write = (level: LogLevel, event: string, fields?: Record<string, unknown>) => {
    try {
      sink({
        ts: now().toISOString(),
        level,
        event: EVENT_RE.test(event) ? event : 'invalid_event_name',
        fields: { ...base, ...sanitiseFields(fields) },
      });
    } catch {
      // A broken sink must never break a request.
    }
  };
  return {
    info: (event, fields) => write('info', event, fields),
    warn: (event, fields) => write('warn', event, fields),
    error: (event, fields) => write('error', event, fields),
  };
}

/** A logger that adds fixed fields (used for the per-request logger). */
export function childLogger(sink: LogSink, now: () => Date, base: Record<string, unknown>): Logger {
  return createLogger({ sink, now, base });
}

/** What may be said about an unexpected error: its class and code, never its message (messages can quote input). */
export function describeError(err: unknown): LogFields {
  if (err instanceof Error) {
    const code = (err as { code?: unknown }).code;
    return { errorName: err.name, errorCode: typeof code === 'string' ? code : null };
  }
  return { errorName: typeof err, errorCode: null };
}
