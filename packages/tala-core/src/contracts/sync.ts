/**
 * Sync protocol (PRD §10.4, §10.5) and the client-side sync engine surface.
 *
 * Rules the server enforces (workstream A) and the client engine mirrors (workstream H):
 *  1. Every mutation carries the `baseRev` the device last saw. `baseRev === server rev` → applied, rev+1.
 *  2. `baseRev < server rev` → `conflict`: the server record is returned and NOT overwritten.
 *     The client keeps both versions and asks the teacher (plan_section), or resolves by rule (table below).
 *  3. Mutations are idempotent by `mutationId` (RES-5): a replay returns the original result.
 *  4. Device clocks are never used for ordering; the server assigns `rev`, `updatedAt` and the pull cursor.
 *  5. A locked plan rejects mutations to its plan_section records (except sections with outsideLock) with
 *     result `locked`. The client turns the rejected edits into a new draft plan with `conflictCopyOf` set (DOC-4).
 *     section_revision records are history and are NOT subject to the lock rule.
 *  6. edit vs delete: an upsert against a server-deleted record is applied and restores it.
 *
 * Client conflict rules by entity (§10.5):
 *   plan_section                      → keep both, teacher chooses ('ask')
 *   student                           → flag row for the teacher ('ask')
 *   plan, pacing_track, assignment,
 *   class, school_year, profile, …    → field-level last-writer-wins: re-apply the device's changed fields
 *                                       onto the server record and push again ('merge_fields')
 *
 * OWNER: orchestrator.
 */
import { z } from 'zod';
import { Id, IsoDateTime } from './common';
import { EntityNameSchema, RecordEnvelopeSchema } from './records';
import type { EntityName, RecordData, RecordEnvelope } from './records';

export const Mutation = z.object({
  mutationId: Id,
  entity: EntityNameSchema,
  id: Id,
  op: z.enum(['upsert', 'delete']),
  /** rev of the record this device last saw; 0 for a record created on this device. */
  baseRev: z.number().int().min(0),
  /** Full record data for upsert; omitted for delete. */
  data: z.unknown().optional(),
});
export type Mutation = z.infer<typeof Mutation>;

export const MutationResult = z.object({
  mutationId: Id,
  status: z.enum(['applied', 'conflict', 'locked', 'invalid', 'forbidden']),
  /** Present for applied (the stored record) and for conflict/locked (the current server record). */
  record: RecordEnvelopeSchema.nullable(),
  message: z.string().optional(),
});
export type MutationResult = z.infer<typeof MutationResult>;

export const PushRequest = z.object({
  deviceId: Id,
  mutations: z.array(Mutation).max(100),
});
export const PushResponse = z.object({ results: z.array(MutationResult) });

export const PullQuery = z.object({
  /** Opaque cursor from the previous pull; omit for a first sync. */
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  /**
   * First-sync window (OFF-2): when no cursor is given, plans (and their sections) dated outside
   * [windowFrom, windowTo] are skipped unless locked in the current term. Other entities always sync fully.
   */
  windowFrom: z.string().optional(),
  windowTo: z.string().optional(),
});
/**
 * Records on the pull wire are deliberately lenient about `entity` and `data`: a newer server may send
 * entity kinds or shapes an older client does not know. The sync engine skips what it cannot parse and
 * still advances the cursor (forward compatibility), instead of the transport rejecting the whole page.
 */
export const WireRecord = z.object({
  entity: z.string(),
  id: z.string(),
  rev: z.number().int().min(0),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
  data: z.unknown(),
});
export type WireRecord = z.infer<typeof WireRecord>;

export const PullResponse = z.object({
  records: z.array(WireRecord),
  cursor: z.string(),
  hasMore: z.boolean(),
  serverTime: IsoDateTime,
});

/* ---------------- client engine (implemented in src/sync by workstream H) ---------------- */

export type ConflictPolicy = 'ask' | 'merge_fields';

export const CONFLICT_POLICY: Record<EntityName, ConflictPolicy> = {
  profile: 'merge_fields',
  school_year: 'merge_fields',
  calendar_day: 'merge_fields',
  class: 'merge_fields',
  assignment: 'merge_fields',
  pacing_track: 'merge_fields',
  pairing_override: 'merge_fields',
  plan: 'merge_fields',
  plan_section: 'ask',
  section_revision: 'merge_fields',
  unit: 'merge_fields',
  session_mark: 'merge_fields',
  day_note: 'merge_fields',
  student: 'ask',
  competency_check: 'merge_fields',
  template: 'merge_fields',
};

/** A record as held on a device. */
export interface LocalRecord<E extends EntityName = EntityName> extends RecordEnvelope<E> {
  /** Unsent local change exists. */
  dirty: boolean;
  /** Snapshot of `data` as of `rev` (the last server version seen), kept while dirty for field-level merge. */
  base: RecordData<E> | null;
  /** Set when the server version diverged and the teacher must choose (policy 'ask'). */
  conflict: { server: RecordEnvelope<E> } | null;
}

export interface OutboxItem {
  mutationId: Id;
  entity: EntityName;
  id: Id;
  op: 'upsert' | 'delete';
  baseRev: number;
  createdAt: IsoDateTime;
  attempts: number;
}

/**
 * Persistence adapter. Mobile implements it on SQLite (workstream E); web on IndexedDB or memory (workstream D).
 * All methods are async and must be durable before resolving (PRD §14.6: no acknowledged save is lost).
 */
export interface LocalStore {
  get(entity: EntityName, id: Id): Promise<LocalRecord | null>;
  list(entity: EntityName, opts?: { includeDeleted?: boolean }): Promise<LocalRecord[]>;
  /** Atomically write records and outbox changes. */
  commit(batch: {
    put?: LocalRecord[];
    outboxAdd?: OutboxItem[];
    outboxRemove?: Id[];
    meta?: Record<string, string | null>;
  }): Promise<void>;
  outbox(): Promise<OutboxItem[]>;
  getMeta(key: string): Promise<string | null>;
  /** Remove everything (sign-out, account deletion). */
  clear(): Promise<void>;
}

/** The slice of the API client the engine needs; satisfied by createTalaClient(). */
export interface SyncTransport {
  push(body: z.infer<typeof PushRequest>): Promise<z.infer<typeof PushResponse>>;
  pull(query: { cursor?: string; limit?: number; windowFrom?: string; windowTo?: string }): Promise<z.infer<typeof PullResponse>>;
}

export interface SyncReport {
  ok: boolean;
  pushed: number;
  pulled: number;
  conflicts: number;
  /** Plans duplicated as draft copies because the original was locked elsewhere. */
  lockCopies: Id[];
  /** Writes the server refused for good (invalid/forbidden). Taken out of the queue; the local text is kept and marked. */
  rejected: number;
  /** Pulled records this client version could not read and skipped. */
  skipped: number;
  error: 'offline' | 'unauthenticated' | 'server' | null;
  at: IsoDateTime;
}

export interface SyncStatus {
  state: 'idle' | 'syncing' | 'offline' | 'error';
  pending: number;
  conflicts: number;
  lastSyncedAt: IsoDateTime | null;
}

export interface SyncEngine {
  get<E extends EntityName>(entity: E, id: Id): Promise<LocalRecord<E> | null>;
  list<E extends EntityName>(entity: E): Promise<LocalRecord<E>[]>;
  /** Validate, write locally, queue for upload. Resolves once durable on the device. */
  put<E extends EntityName>(entity: E, data: RecordData<E>): Promise<LocalRecord<E>>;
  remove(entity: EntityName, id: Id): Promise<void>;
  /** Resolve an 'ask' conflict: keep the device version, take the server version, or keep both (second appended). */
  resolveConflict(entity: EntityName, id: Id, choice: 'mine' | 'theirs' | 'both'): Promise<void>;
  /** One push+pull cycle. Never throws for network trouble; reports it. Retries/backoff are the caller's schedule. */
  sync(opts?: { windowFrom?: string; windowTo?: string }): Promise<SyncReport>;
  status(): Promise<SyncStatus>;
  /** Called after any local or remote change; returns an unsubscribe function. */
  subscribe(listener: (changed: Array<{ entity: EntityName; id: Id }>) => void): () => void;
}

export interface SyncEngineDeps {
  store: LocalStore;
  transport: SyncTransport;
  deviceId: Id;
  now: () => Date;
  newId: () => Id;
}

export type CreateSyncEngine = (deps: SyncEngineDeps) => SyncEngine;
