/**
 * Configuration loader (PRD Appendix B, §14.6 "configuration over code").
 * OWNER: workstream A.
 *
 * Everything comes from environment variables, with safe local defaults, so a value can change
 * without a client release. Secrets are never read here: a provider config carries only the NAME of
 * the variable that holds its key. Error messages name the variable and never echo its value.
 *
 * The full list of variables is in ./README.md.
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DEFAULT_PACING_PARAMS, LIMITS, LlmFeature, PacingParams } from '@hiraia/tala-core';
import type { LlmRoute } from '@hiraia/tala-core';
import type { ProviderConfig, TalaServerConfig } from './types';

export type Env = Record<string, string | undefined>;

export type DeepPartial<T> =
  T extends ReadonlyArray<unknown>
    ? T
    : T extends object
      ? { [K in keyof T]?: DeepPartial<T[K]> }
      : T;

/** A configuration mistake. The message names the variable; it never contains a value. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export interface LoadedConfig {
  config: TalaServerConfig;
  /** Things the operator should know about, logged once at startup. Never contain values. */
  warnings: string[];
}

const ROUTES: readonly LlmRoute[] = ['cloud', 'local', 'rules', 'off'];
const ROSTER_FEATURES: readonly LlmFeature[] = ['roster.columns', 'roster.names'];

/** Minimum session lifetime outside local: a signed-in phone must survive 30 days offline (OFF-5). */
const MIN_SESSION_DAYS = 31;

function reader(env: Env) {
  const raw = (name: string): string | undefined => {
    const v = env[name];
    return v === undefined || v.trim() === '' ? undefined : v.trim();
  };
  return {
    raw,
    str(name: string, fallback: string): string {
      return raw(name) ?? fallback;
    },
    int(name: string, fallback: number, min: number, max: number): number {
      const v = raw(name);
      if (v === undefined) return fallback;
      if (!/^-?\d+$/.test(v)) throw new ConfigError(`${name} must be a whole number.`);
      const n = Number(v);
      if (!Number.isSafeInteger(n) || n < min || n > max)
        throw new ConfigError(`${name} must be between ${min} and ${max}.`);
      return n;
    },
    num(name: string, fallback: number, min: number, max: number): number {
      const v = raw(name);
      if (v === undefined) return fallback;
      const n = Number(v);
      if (!Number.isFinite(n) || n < min || n > max)
        throw new ConfigError(`${name} must be a number between ${min} and ${max}.`);
      return n;
    },
    bool(name: string, fallback: boolean): boolean {
      const v = raw(name)?.toLowerCase();
      if (v === undefined) return fallback;
      if (['1', 'true', 'yes', 'on'].includes(v)) return true;
      if (['0', 'false', 'no', 'off'].includes(v)) return false;
      throw new ConfigError(`${name} must be true or false.`);
    },
    oneOf<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
      const v = raw(name)?.toLowerCase();
      if (v === undefined) return fallback;
      if (!(allowed as readonly string[]).includes(v))
        throw new ConfigError(`${name} must be one of: ${allowed.join(', ')}.`);
      return v as T;
    },
  };
}

/** `lesson.generate` → `TALA_LLM_ROUTE_LESSON_GENERATE`. */
export function routeEnvName(feature: LlmFeature): string {
  return `TALA_LLM_ROUTE_${feature.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
}

/**
 * Default local database: inside this package's own node_modules cache, so it is git-ignored and each
 * worktree gets its own file. Falls back to a per-directory folder under the OS temp dir.
 */
function defaultLocalDbPath(): string {
  const cwd = process.cwd();
  if (existsSync(join(cwd, 'node_modules')))
    return resolve(cwd, 'node_modules', '.cache', 'tala', 'local.sqlite');
  const tag = createHash('sha256').update(cwd).digest('hex').slice(0, 12);
  return join(tmpdir(), `tala-local-${tag}`, 'local.sqlite');
}

function normaliseOrigin(name: string, value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigError(`${name} must be a full origin such as https://tala.hiraia.org.`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    throw new ConfigError(`${name} must start with https:// or http://.`);
  return url.origin;
}

function parsePromptVersions(name: string, value: string | undefined): Record<string, number> {
  if (!value) return {};
  const out: Record<string, number> = {};
  // "lesson/multigrade=3, roster/names=2"
  for (const part of value.split(',')) {
    const piece = part.trim();
    if (!piece) continue;
    const m = /^([A-Za-z0-9_./-]{1,80})=(\d{1,6})$/.exec(piece);
    if (!m) throw new ConfigError(`${name} must look like "lesson/multigrade=3,roster/names=2".`);
    out[m[1]!] = Number(m[2]);
  }
  return out;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return (
    typeof v === 'object' &&
    v !== null &&
    !Array.isArray(v) &&
    Object.getPrototypeOf(v) === Object.prototype
  );
}

/** Recursive merge: plain objects merge, everything else (arrays, null, primitives) replaces. `undefined` is skipped. */
export function deepMerge<T>(base: T, override: DeepPartial<T> | undefined): T {
  if (override === undefined) return base;
  if (!isPlainObject(base) || !isPlainObject(override)) return override as T;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    out[key] = deepMerge(out[key], value as DeepPartial<unknown>);
  }
  return out as T;
}

export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

/** Rules that hold whatever the source of a value (environment or override). */
function enforce(config: TalaServerConfig, warnings: string[]): TalaServerConfig {
  const next: TalaServerConfig = {
    ...config,
    llm: { ...config.llm, routes: { ...config.llm.routes } },
    limits: { ...config.limits },
  };

  // §12.4.1: learners' names never go to a cloud model in production. Enforced here and again in the gateway.
  if (next.environment === 'production') {
    for (const feature of ROSTER_FEATURES) {
      if (next.llm.routes[feature] === 'cloud') {
        next.llm.routes[feature] = next.llm.local ? 'local' : 'rules';
        warnings.push(
          `roster route "cloud" is not allowed in production; ${feature} now uses "${next.llm.routes[feature]}" (TALA_ROSTER_LLM_ROUTE).`
        );
      }
    }
    if (!next.publicOrigin.startsWith('https://'))
      throw new ConfigError('TALA_PUBLIC_ORIGIN must be an https:// origin in production.');
  }
  for (const feature of LlmFeature.options) {
    if (next.llm.routes[feature] === 'local' && !next.llm.local) {
      warnings.push(
        `${feature} is routed to "local" but no local model is configured (TALA_LLM_LOCAL_ENDPOINT, TALA_LLM_LOCAL_MODEL).`
      );
    }
  }

  // The Page() contract caps a page at LIMITS.pageSize; a larger configured value could never validate.
  if (next.limits.pageSize > LIMITS.pageSize) next.limits.pageSize = LIMITS.pageSize;
  if (next.limits.pageSize < 1) throw new ConfigError('TALA_PAGE_SIZE must be at least 1.');

  if (next.environment !== 'local' && next.session.ttlDays < MIN_SESSION_DAYS) {
    throw new ConfigError(
      `TALA_SESSION_TTL_DAYS must be at least ${MIN_SESSION_DAYS} so a phone stays signed in through 30 days offline.`
    );
  }
  if (next.session.ttlDays < 1) throw new ConfigError('TALA_SESSION_TTL_DAYS must be at least 1.');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(next.session.cookieName))
    throw new ConfigError('TALA_SESSION_COOKIE may only contain letters, digits, "-" and "_".');
  if (next.session.cookieName.startsWith('__Host-') && !next.publicOrigin.startsWith('https://')) {
    throw new ConfigError(
      'TALA_SESSION_COOKIE may only start with "__Host-" when TALA_PUBLIC_ORIGIN is https.'
    );
  }
  return next;
}

/** Build the configuration from the environment only. */
function fromEnv(env: Env, warnings: string[]): TalaServerConfig {
  const r = reader(env);
  const environment = r.oneOf('TALA_ENV', ['local', 'staging', 'production'] as const, 'local');
  const isLocal = environment === 'local';

  const dbPathRaw = r.raw('TALA_DB_PATH');
  if (!dbPathRaw && !isLocal)
    throw new ConfigError('TALA_DB_PATH is required outside the local environment.');
  const dbPath = dbPathRaw ?? defaultLocalDbPath();

  const originRaw = r.raw('TALA_PUBLIC_ORIGIN');
  if (!originRaw && environment === 'staging')
    throw new ConfigError('TALA_PUBLIC_ORIGIN is required in staging.');
  const publicOrigin = normaliseOrigin(
    'TALA_PUBLIC_ORIGIN',
    originRaw ??
      (environment === 'production' ? 'https://tala.hiraia.org' : 'http://localhost:3000')
  );

  const timeoutMs = r.int('TALA_LLM_TIMEOUT_MS', 60_000, 1_000, 600_000);

  // Price per million tokens, for the budget ceiling. Unknown stays null: the gateway will not make a cloud
  // call it cannot price (PRD §9.7).
  const pricing = (provider: 'PRIMARY' | 'FALLBACK' | 'LOCAL'): ProviderConfig['pricing'] => {
    const inName = `TALA_LLM_${provider}_INPUT_USD_PER_MILLION`;
    const outName = `TALA_LLM_${provider}_OUTPUT_USD_PER_MILLION`;
    const hasIn = r.raw(inName) !== undefined;
    const hasOut = r.raw(outName) !== undefined;
    if (!hasIn && !hasOut) return null;
    if (hasIn !== hasOut) {
      warnings.push(
        `${inName} and ${outName} must both be set; this provider is treated as unpriced.`
      );
      return null;
    }
    return {
      inputUsdPerMillion: r.num(inName, 0, 0, 100_000),
      outputUsdPerMillion: r.num(outName, 0, 0, 100_000),
    };
  };

  // Model identifiers are configuration (PRD §9.1): there is deliberately no built-in guess at a model name.
  const primary: ProviderConfig = {
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    baseUrl: r.str('TALA_LLM_PRIMARY_BASE_URL', 'https://api.deepseek.com'),
    model: r.str('TALA_LLM_PRIMARY_MODEL', ''),
    timeoutMs,
    pricing: pricing('PRIMARY'),
  };
  const fallback: ProviderConfig = {
    // Only the presence of the variable is checked. Its value is read by the gateway at call time.
    apiKeyEnv:
      r.raw('DASHSCOPE_API_KEY') === undefined && r.raw('ALIBABACLOUD_API_KEY') !== undefined
        ? 'ALIBABACLOUD_API_KEY'
        : 'DASHSCOPE_API_KEY',
    baseUrl: r.str(
      'TALA_LLM_FALLBACK_BASE_URL',
      'https://dashscope-intl.aliyuncs.com/compatible-mode/v1'
    ),
    model: r.str('TALA_LLM_FALLBACK_MODEL', ''),
    timeoutMs,
    pricing: pricing('FALLBACK'),
  };
  const localEndpoint = r.raw('TALA_LLM_LOCAL_ENDPOINT');
  const localModel = r.raw('TALA_LLM_LOCAL_MODEL');
  if ((localEndpoint === undefined) !== (localModel === undefined)) {
    warnings.push(
      'TALA_LLM_LOCAL_ENDPOINT and TALA_LLM_LOCAL_MODEL must both be set; the local model is treated as not configured.'
    );
  }
  const local: ProviderConfig | null =
    localEndpoint && localModel
      ? {
          apiKeyEnv: 'TALA_LLM_LOCAL_API_KEY',
          baseUrl: localEndpoint,
          model: localModel,
          timeoutMs,
          pricing: pricing('LOCAL'),
        }
      : null;

  // Roster cleaning: flagged cloud route before production, local (or rules) in production (§12.4.1).
  const rosterRoute = r.oneOf(
    'TALA_ROSTER_LLM_ROUTE',
    ROUTES,
    environment === 'production' ? (local ? 'local' : 'rules') : 'cloud'
  );
  const routes = {} as Record<LlmFeature, LlmRoute>;
  for (const feature of LlmFeature.options) {
    const base: LlmRoute = ROSTER_FEATURES.includes(feature) ? rosterRoute : 'cloud';
    routes[feature] = r.oneOf(routeEnvName(feature), ROUTES, base);
  }

  const monthlyUsd = r.num('TALA_BUDGET_MONTHLY_USD', 50, 0, 1_000_000);

  const pacingDefaults = PacingParams.safeParse({
    bufferRatio: r.num('TALA_PACING_BUFFER_RATIO', DEFAULT_PACING_PARAMS.bufferRatio, 0, 0.5),
    assessmentSessionsPerTerm: r.int(
      'TALA_PACING_ASSESSMENT_SESSIONS_PER_TERM',
      DEFAULT_PACING_PARAMS.assessmentSessionsPerTerm,
      0,
      20
    ),
    minSessionsPerCompetency: r.int(
      'TALA_PACING_MIN_SESSIONS_PER_COMPETENCY',
      DEFAULT_PACING_PARAMS.minSessionsPerCompetency,
      1,
      10
    ),
    assumeTaught: r.bool('TALA_PACING_ASSUME_TAUGHT', DEFAULT_PACING_PARAMS.assumeTaught),
    pairingRule: r.oneOf(
      'TALA_PACING_PAIRING_RULE',
      ['theme_then_sequence', 'sequence'] as const,
      DEFAULT_PACING_PARAMS.pairingRule
    ),
  });
  if (!pacingDefaults.success)
    throw new ConfigError('The TALA_PACING_* variables do not form valid pacing defaults.');

  return {
    environment,
    dbPath,
    publicOrigin,
    session: {
      // Sliding: every use extends it, so 90 idle days comfortably covers 30 days offline (OFF-5).
      ttlDays: r.int('TALA_SESSION_TTL_DAYS', 90, 1, 3650),
      cookieName: r.str(
        'TALA_SESSION_COOKIE',
        publicOrigin.startsWith('https://') ? '__Host-tala_session' : 'tala_session'
      ),
    },
    llm: {
      primary,
      fallback,
      local,
      routes,
      promptVersions: parsePromptVersions('TALA_PROMPT_VERSIONS', r.raw('TALA_PROMPT_VERSIONS')),
      // Placeholders until alpha measurements set real values (PRD §9.7).
      quotas: {
        fullPerDay: r.int('TALA_QUOTA_FULL_PER_DAY', 20, 0, 100_000),
        sectionPerDay: r.int('TALA_QUOTA_SECTION_PER_DAY', 60, 0, 100_000),
      },
      budget: {
        monthlyUsd,
        alertAtUsd: r.num(
          'TALA_BUDGET_ALERT_USD',
          Math.round(monthlyUsd * 0.8 * 100) / 100,
          0,
          1_000_000
        ),
      },
      cacheSeconds: r.int('TALA_LLM_CACHE_SECONDS', 300, 0, 86_400),
    },
    moderation: {
      enabled: r.bool('TALA_MODERATION_ENABLED', true),
      guidelineVersion: r.int('TALA_MODERATION_GUIDELINE_VERSION', 1, 1, 100_000),
      autoHideOnPersonalDataReport: r.bool('TALA_MODERATION_AUTOHIDE_PERSONAL_DATA', true),
    },
    limits: {
      rosterRows: r.int('TALA_LIMIT_ROSTER_ROWS', LIMITS.maxRosterRows, 1, LIMITS.maxRosterRows),
      rosterFileBytes: r.int(
        'TALA_LIMIT_ROSTER_FILE_BYTES',
        LIMITS.maxRosterFileBytes,
        1,
        LIMITS.maxRosterFileBytes
      ),
      attachmentBytes: r.int('TALA_LIMIT_ATTACHMENT_BYTES', 5 * 1024 * 1024, 1, 100 * 1024 * 1024),
      pageSize: r.int('TALA_PAGE_SIZE', LIMITS.pageSize, 1, LIMITS.pageSize),
    },
    offline: {
      windowWeeksBack: r.int('TALA_OFFLINE_WEEKS_BACK', 4, 0, 104),
      windowWeeksAhead: r.int('TALA_OFFLINE_WEEKS_AHEAD', 8, 0, 104),
    },
    resilience: {
      slowResponseMs: r.int('TALA_SLOW_RESPONSE_MS', 3_000, 100, 120_000),
      retryMax: r.int('TALA_RETRY_MAX', 5, 0, 20),
      retryBaseMs: r.int('TALA_RETRY_BASE_MS', 1_000, 50, 60_000),
      retryCapMs: r.int('TALA_RETRY_CAP_MS', 60_000, 1_000, 3_600_000),
    },
    abuse: {
      // Generous per-address limits: a whole school often shares one connection (teacher training days).
      registerPerIpPerHour: r.int('TALA_ABUSE_REGISTER_PER_IP_PER_HOUR', 60, 1, 100_000),
      loginPerIpPerMinute: r.int('TALA_ABUSE_LOGIN_PER_IP_PER_MINUTE', 30, 1, 100_000),
      postPerUserPerDay: r.int('TALA_ABUSE_POST_PER_USER_PER_DAY', 20, 0, 100_000),
      reportPerUserPerDay: r.int('TALA_ABUSE_REPORT_PER_USER_PER_DAY', 20, 0, 100_000),
    },
    curriculum: {
      confirmationsToMarkChecked: r.int(
        'TALA_CURRICULUM_CONFIRMATIONS_TO_MARK_CHECKED',
        1,
        1,
        1_000
      ),
      correctionsToReview: r.int('TALA_CURRICULUM_CORRECTIONS_TO_REVIEW', 2, 1, 1_000),
    },
    pacingDefaults: pacingDefaults.data,
    features: {
      generation: r.bool('TALA_FEATURE_GENERATION', true),
      community: r.bool('TALA_FEATURE_COMMUNITY', true),
      rosterAi: r.bool('TALA_FEATURE_ROSTER_AI', true),
      // Pre-production gate (PRD §13.3); the route answers not_implemented until Phase 4.
      googleSignIn: r.bool('TALA_FEATURE_GOOGLE_SIGNIN', false),
    },
    minClientVersion: r.str('TALA_MIN_CLIENT_VERSION', '0.0.0'),
  };
}

/** Environment → configuration, then `overrides` on top (deep), then the rules in `enforce`. Frozen. */
export function loadConfigWithWarnings(
  env: Env = process.env,
  overrides?: DeepPartial<TalaServerConfig>
): LoadedConfig {
  const warnings: string[] = [];
  const merged = deepMerge<TalaServerConfig>(fromEnv(env, warnings), overrides);
  const config = deepFreeze(enforce(merged, warnings));
  return { config, warnings };
}

export function loadConfig(
  env: Env = process.env,
  overrides?: DeepPartial<TalaServerConfig>
): TalaServerConfig {
  return loadConfigWithWarnings(env, overrides).config;
}
