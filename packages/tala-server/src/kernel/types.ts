/**
 * Server kernel contracts: how modules plug into the Tala API server.
 * OWNER: orchestrator. The kernel RUNTIME (router, db, config loader, auth) is workstream A's, in this folder.
 *
 * Shape of the server:
 *   createTalaServer(overrides?) -> { handle(request: Request): Promise<Response>; close(): void }
 * `handle` takes and returns Web Fetch API objects, so it mounts unchanged in a Next.js route handler
 * and in the standalone dev server.
 *
 * A module = { name, migrations, handlers, services? }. Modules never import each other's internals;
 * they talk through `ctx.services`.
 */
import type { Database } from 'better-sqlite3';
import type { z } from 'zod';
import type {
  BodyOut,
  Competency,
  EntityName,
  Id,
  LlmFeature,
  LlmRoute,
  PacingParams,
  ParamsOf,
  Plan,
  PlanSection,
  QueryOut,
  RecordData,
  RecordEnvelope,
  ResponseOf,
  RouteName,
  ApiErrorCode,
} from '@hiraia/tala-core';

/* ---------------- errors ---------------- */

/** Throw from a handler to produce an ApiError response. `message` must be plain language (SIMPLE-6). */
export class HttpError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  invalid_input: 400,
  conflict: 409,
  locked: 423,
  rate_limited: 429,
  quota_exceeded: 429,
  unavailable: 503,
  not_implemented: 501,
  internal: 500,
};

/* ---------------- request context ---------------- */

export interface SessionUser {
  id: Id;
  email: string;
  emailVerified: boolean;
  displayName: string;
  sessionId: Id;
}

export interface Ctx {
  /** Non-null for routes with auth: 'user' (the kernel rejects the request before the handler otherwise). */
  user: SessionUser | null;
  db: Database;
  services: Services;
  config: TalaServerConfig;
  now(): Date;
  newId(): Id;
  requestId: string;
  /** Best-effort client address for abuse limits. Never logged with content. */
  ip: string | null;
  log: Logger;
}

/** Narrow ctx.user in handlers of authenticated routes. */
export function requireUser(ctx: Ctx): SessionUser {
  if (!ctx.user) throw new HttpError('unauthenticated', 'Please sign in again.');
  return ctx.user;
}

/** Structured logger. NEVER pass plan bodies, roster content, prompts or model output (PRD §14.4). */
export interface Logger {
  info(event: string, fields?: Record<string, string | number | boolean | null>): void;
  warn(event: string, fields?: Record<string, string | number | boolean | null>): void;
  error(event: string, fields?: Record<string, string | number | boolean | null>): void;
}

export type Handler<K extends RouteName> = (
  ctx: Ctx,
  input: { params: ParamsOf<K>; query: QueryOut<K>; body: BodyOut<K> }
) => Promise<ResponseOf<K> | BinaryResponse> | ResponseOf<K> | BinaryResponse;

/** For routes marked `binary` in the API table. */
export interface BinaryResponse {
  binary: Uint8Array;
  contentType: string;
  filename?: string;
}

export interface Migration {
  /** Globally unique and ordered within the module: '<module>:<nnn>_<name>', e.g. 'community:001_init'. */
  id: string;
  sql: string;
}

export interface ServerModule {
  name: string;
  /** Applied once, in array order, inside a transaction; recorded in a kernel table. Never edit a shipped migration. */
  migrations: Migration[];
  handlers: { [K in RouteName]?: Handler<K> };
  /** Services this module provides to others. Called once at startup, after all migrations ran. */
  services?: (base: BaseDeps) => Partial<Services>;
  /**
   * Remove everything this module stores for a deleted account (PRIV-6). Runs inside the deletion
   * transaction; synchronous; must not throw for a user it has no rows for.
   */
  onAccountDeleted?: (deps: BaseDeps, userId: Id) => void;
  /**
   * Move everything this module stores for `fromUserId` to `toUserId` when two accounts of the same teacher
   * are merged (PRD §13.3 case 4). Runs inside the merge transaction; synchronous. Until every module that
   * stores per-teacher rows implements it, `account.merge` refuses with `merge_not_available`.
   */
  onAccountMerged?: (deps: BaseDeps, fromUserId: Id, toUserId: Id) => void;
  /** Optional background work (job runners, cleanup timers). Must return a stop function. */
  start?: (deps: BaseDeps & { services: Services }) => () => void;
}

export interface BaseDeps {
  db: Database;
  config: TalaServerConfig;
  now(): Date;
  newId(): Id;
  log: Logger;
}

/* ---------------- services ---------------- */

export interface Services {
  /** core (A): the synced-record store. */
  records: RecordStore;
  /** core (A) */
  mailer: Mailer;
  /** core (A) */
  rateLimit: RateLimiter;
  /** llm (C): the model gateway. Default when no module provides it: every call returns { ok: false, reason: 'disabled' }. */
  llm: LlmGateway;
  /** curriculum (B) */
  curriculum: CurriculumService;
}

export interface RecordStore {
  get<E extends EntityName>(ownerId: Id, entity: E, id: Id): RecordEnvelope<E> | null;
  list<E extends EntityName>(
    ownerId: Id,
    entity: E,
    opts?: { includeDeleted?: boolean }
  ): Array<RecordEnvelope<E>>;
  /**
   * Server-side write on behalf of the owner. Validates, bumps rev, and the change reaches the owner's
   * devices on their next pull. Use sparingly: the normal path is the client writing through sync.
   */
  put<E extends EntityName>(ownerId: Id, entity: E, data: RecordData<E>): RecordEnvelope<E>;
  remove(ownerId: Id, entity: EntityName, id: Id): void;
  /** A plan with its sections, or null if missing/deleted/not the owner's. */
  planSnapshot(
    ownerId: Id,
    planId: Id
  ): { plan: RecordEnvelope<'plan'>; sections: Array<RecordEnvelope<'plan_section'>> } | null;
  /** Count of distinct owners per competency for a pack's checks (CUR-7), without exposing who. */
  checkTallies(
    curriculumVersion: string,
    competencyIds: string[]
  ): { confirmed: Record<string, number>; corrected: Record<string, number> };
}

export type PlanSnapshot = { plan: Plan; sections: PlanSection[] };

export interface Mailer {
  /** In local/staging this writes to the log and a dev outbox table instead of sending. */
  send(msg: {
    to: string;
    template: 'verify_email' | 'password_reset' | 'link_google';
    lang: 'fil' | 'en';
    vars: Record<string, string>;
  }): Promise<void>;
}

export interface RateLimiter {
  /** Returns false when the limit is exceeded. `key` examples: 'login:<ip>', 'post:<userId>'. */
  take(key: string, limit: number, windowSeconds: number): boolean;
}

export interface CurriculumService {
  /** Stored competency records by id. Unknown ids are omitted. Text always comes from here, never from a client or a model. */
  getCompetencies(curriculumVersion: string, ids: string[]): Competency[];
  /** Curriculum version in force for a grade in a school year label ('2027-2028'), or null if not loaded. */
  versionFor(schoolYearLabel: string, grade: string, learningAreaId: string): string | null;
}

/* ---------------- LLM gateway (PRD §9.1, §9.6–9.8) ---------------- */

export interface LlmRequest<T> {
  feature: LlmFeature;
  /**
   * Prompt template id, resolved to `packages/tala-server/prompts/<promptId>.v<version>.md`
   * (e.g. 'lesson/multigrade' → prompts/lesson/multigrade.v3.md). If `version` is omitted the
   * configured active version is used. Templates use {{name}} placeholders.
   */
  promptId: string;
  version?: number;
  /**
   * Values for placeholders. Anything teacher- or community-supplied must be passed here (never concatenated
   * into the template) so the gateway can delimit it as data (PRD §9.6).
   */
  vars: Record<string, string>;
  /** The gateway validates model output against this and retries once with the errors before falling back. */
  schema: z.ZodType<T, z.ZodTypeDef, unknown>;
  userId: Id | null;
  /** Force a route; otherwise the per-feature configured route is used. A caller may only make it stricter. */
  route?: LlmRoute;
  maxOutputTokens?: number;
  /** Extra validation after the schema passes; return error strings to trigger the retry/fallback path. */
  check?: (value: T) => string[];
  signal?: AbortSignal;
}

export type LlmResult<T> =
  | {
      ok: true;
      data: T;
      provider: 'deepseek' | 'qwen' | 'local';
      model: string;
      promptId: string;
      promptVersion: number;
      usage: { inputTokens: number; outputTokens: number; costUsd: number | null };
      /** True when served by the fallback provider. */
      fellBack: boolean;
    }
  | {
      ok: false;
      reason:
        | 'disabled'
        | 'rules_only'
        | 'providers_unavailable'
        | 'invalid_output'
        | 'quota_exceeded'
        | 'budget_exceeded'
        | 'cancelled';
      message: string;
    };

export interface LlmGateway {
  complete<T>(req: LlmRequest<T>): Promise<LlmResult<T>>;
  /** Route currently configured for a feature, after environment rules (e.g. cloud roster route blocked in production). */
  routeFor(feature: LlmFeature): LlmRoute;
}

/* ---------------- configuration (PRD Appendix B) ---------------- */

export interface ProviderConfig {
  /** NAME of the environment variable holding the key. The value is read at call time and never logged or stored. */
  apiKeyEnv: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  /**
   * Price used for budget metering, USD per million tokens. From TALA_LLM_<PRIMARY|FALLBACK|LOCAL>_INPUT_USD_PER_MILLION
   * and ..._OUTPUT_USD_PER_MILLION. null/absent = unknown: the gateway refuses cloud calls it cannot price, so an
   * unknown cost can never bypass the monthly ceiling. A local model may be priced at 0.
   */
  pricing?: { inputUsdPerMillion: number; outputUsdPerMillion: number } | null;
}

export interface TalaServerConfig {
  environment: 'local' | 'staging' | 'production';
  /** SQLite file path (TALA_DB_PATH). ':memory:' in tests. */
  dbPath: string;
  publicOrigin: string; // e.g. https://tala.hiraia.org
  session: { ttlDays: number; cookieName: string };
  /** Reverse proxies in front of the server whose X-Forwarded-For entry is trusted (TALA_TRUSTED_PROXY_HOPS). */
  network?: { trustedProxyHops: number };
  llm: {
    /** DeepSeek v4.1 Flash, direct API. Key env: DEEPSEEK_API_KEY. Model from TALA_LLM_PRIMARY_MODEL. */
    primary: ProviderConfig;
    /** Qwen on Alibaba Cloud's own API. Key env: DASHSCOPE_API_KEY (falls back to ALIBABACLOUD_API_KEY). Model from TALA_LLM_FALLBACK_MODEL. */
    fallback: ProviderConfig;
    /** Hiraia-hosted model. TALA_LLM_LOCAL_ENDPOINT / TALA_LLM_LOCAL_MODEL. null when not configured. */
    local: ProviderConfig | null;
    /** Route per feature. `roster.names`/`roster.columns` come from TALA_ROSTER_LLM_ROUTE; 'cloud' is refused when environment === 'production' (§12.4.1). */
    routes: Record<LlmFeature, LlmRoute>;
    /** Active prompt version per promptId; absent = highest version on disk. */
    promptVersions: Record<string, number>;
    quotas: { fullPerDay: number; sectionPerDay: number };
    budget: { monthlyUsd: number; alertAtUsd: number };
    cacheSeconds: number;
  };
  moderation: { enabled: boolean; guidelineVersion: number; autoHideOnPersonalDataReport: boolean };
  limits: {
    rosterRows: number;
    rosterFileBytes: number;
    attachmentBytes: number;
    pageSize: number;
  };
  offline: { windowWeeksBack: number; windowWeeksAhead: number };
  resilience: { slowResponseMs: number; retryMax: number; retryBaseMs: number; retryCapMs: number };
  abuse: {
    registerPerIpPerHour: number;
    loginPerIpPerMinute: number;
    postPerUserPerDay: number;
    reportPerUserPerDay: number;
  };
  curriculum: { confirmationsToMarkChecked: number; correctionsToReview: number };
  pacingDefaults: PacingParams;
  features: { generation: boolean; community: boolean; rosterAi: boolean; googleSignIn: boolean };
  minClientVersion: string;
}
