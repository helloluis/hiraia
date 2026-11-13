/**
 * The synced-record store: every write a device makes ends up here, and so does every server-side write.
 * OWNER: workstream A. Implements the numbered rules at the top of contracts/sync.ts and PRD §10.4–10.5.
 *
 * Storage: one row per record, `(owner_id, entity, id)`. The owner is part of the key, so each teacher has a
 * separate id space: nothing one teacher sends can read, change or even collide with another teacher's record.
 * `seq` is one counter for the whole database, assigned inside the write transaction, so a device can ask for
 * "everything of mine after seq N" and never miss a change.
 *
 * Deleting keeps a tombstone (so other devices learn of the delete) but not the words: see `scrub` below.
 */
import { BUILTIN_TEMPLATES, parseRecordData, plan as planHelpers } from '@hiraia/tala-core';
import type { EntityName, Id, Mutation, MutationResult, Plan, PlanSection, RecordData, RecordEnvelope, SectionRevision, Template } from '@hiraia/tala-core';
import { ZodError } from 'zod';
import type { Db } from '../../kernel/db';
import { describeError } from '../../kernel/logger';
import { HttpError } from '../../kernel/types';
import type { Logger, RecordStore } from '../../kernel/types';
import { effectivelyLocked, emptiedContent, isOutsideLock, lockedPlanViolations, normalisePlan } from './plan-rules';
import type { Revisions } from './revisions';
import { sha256, stableStringify } from './stable';

/** Largest single record accepted. A long lesson section is a few kilobytes. */
export const MAX_RECORD_BYTES = 256 * 1024;
/** A pull page stops growing past this many bytes of record data, whatever `limit` says (slow links, RES-7). */
export const MAX_PULL_PAGE_BYTES = 400 * 1024;
/** How long the answer to an applied mutation is remembered for replays. */
export const REPLAY_DAYS = 30;
/** How far in the future a device's lock time may be before the server's clock is used instead. */
const CLOCK_SLACK_MS = 5 * 60 * 1000;

const MESSAGES = {
  conflict: 'This was changed on another device.',
  locked: 'This lesson is locked. Unlock it to change it.',
  lockedDelete: 'This lesson is locked. Unlock it before deleting it.',
  changedElsewhere: 'This lesson was changed on another device, so it was not locked. Open it, check the changes, and lock it again.',
  invalid: 'Some details of this item were not right, so it was not saved.',
  tooLarge: 'This item is too large to save.',
  idMismatch: 'This item could not be saved because its details do not match.',
  history: 'An earlier version of a lesson part cannot be changed.',
  reused: 'This change was already sent with different content.',
  failed: 'This item could not be saved. Your copy on this device is safe.',
} as const;

interface Row {
  owner_id: string;
  entity: string;
  id: string;
  rev: number;
  seq: number;
  updated_at: string;
  deleted_at: string | null;
  data: string;
  device_id: string | null;
}

export interface WriteActor {
  ownerId: Id;
  sessionId: Id | null;
  deviceId: string | null;
  /** The teacher's name, used when a lock arrives without one. */
  displayName: string;
}

type Status = MutationResult['status'];

interface Outcome {
  status: Status;
  record: RecordEnvelope | null;
  message?: string;
  /** True when a row was written (and so the result must be remembered for replays). */
  wrote: boolean;
}

interface Scope {
  actor: WriteActor;
  /** Plans whose content changed in this batch and still need a revision snapshot. */
  touched: Map<Id, 'save' | 'regenerate'>;
}

export interface PullInput {
  cursor?: string;
  limit: number;
  windowFrom?: string;
  windowTo?: string;
  /** Comma-separated plan ids: fetch just those plans with their sections and history. */
  planIds?: string;
}

/** Most plans one on-demand request may name. */
export const MAX_PLAN_IDS_PER_PULL = 50;

export interface PullOutput {
  records: RecordEnvelope[];
  cursor: string;
  hasMore: boolean;
  serverTime: string;
}

export interface RecordEngineDeps {
  db: Db;
  now: () => Date;
  log: Logger;
  revisions: Revisions;
  /** The teacher's profile record changed: keep the account's name and language in step. */
  onProfile?: (ownerId: Id, profile: RecordData<'profile'>) => void;
}

/* ---------------- what remains of a deleted record ---------------- */

/**
 * A tombstone tells other devices "this is gone". It does not need the words, and for a learner it must not
 * keep them (PRIV-6). Clients validate every record they receive, so what is left still fits the schema.
 */
function scrub(entity: EntityName, data: unknown): unknown {
  switch (entity) {
    case 'student': {
      const d = data as RecordData<'student'>;
      return { ...d, displayName: '—', familyName: '', givenName: '', middleName: '', suffix: '', sex: null, localId: null } satisfies RecordData<'student'>;
    }
    case 'day_note':
      return { ...(data as RecordData<'day_note'>), text: '' };
    case 'session_mark':
      return { ...(data as RecordData<'session_mark'>), remark: '' };
    case 'plan_section': {
      const d = data as PlanSection;
      return { ...d, content: emptiedContent(d.content), gen: null };
    }
    case 'section_revision': {
      const d = data as SectionRevision;
      return { ...d, content: emptiedContent(d.content), gen: null };
    }
    case 'class': {
      const d = data as RecordData<'class'>;
      return { ...d, profile: { ...d.profile, notes: '' } };
    }
    default:
      return data;
  }
}

/* ---------------- pull cursor ---------------- */

interface CursorState {
  /** Last seq this device has been given (or skipped). */
  s: number;
  /** While a first sync is still paging: the seq it runs up to, and its window. */
  u?: number;
  f?: string;
  t?: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function encodeCursor(state: CursorState): string {
  return Buffer.from(JSON.stringify({ v: 1, ...state })).toString('base64url');
}

function decodeCursor(text: string): CursorState | null {
  try {
    const raw = JSON.parse(Buffer.from(text, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (raw.v !== 1 || typeof raw.s !== 'number' || !Number.isSafeInteger(raw.s) || raw.s < 0) return null;
    const state: CursorState = { s: raw.s };
    if (raw.u !== undefined) {
      if (typeof raw.u !== 'number' || !Number.isSafeInteger(raw.u) || raw.u < 0) return null;
      state.u = raw.u;
      if (typeof raw.f === 'string' && DATE_RE.test(raw.f)) state.f = raw.f;
      if (typeof raw.t === 'string' && DATE_RE.test(raw.t)) state.t = raw.t;
    }
    return state;
  } catch {
    return null;
  }
}

function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/* ---------------- the engine ---------------- */

export function createRecordEngine(deps: RecordEngineDeps) {
  const { db, now, log, revisions } = deps;

  const q = {
    get: db.prepare('SELECT * FROM core_records WHERE owner_id = ? AND entity = ? AND id = ?'),
    put: db.prepare(
      `INSERT INTO core_records (owner_id, entity, id, rev, seq, updated_at, deleted_at, data, device_id)
       VALUES (@owner_id, @entity, @id, @rev, @seq, @updated_at, @deleted_at, @data, @device_id)
       ON CONFLICT (owner_id, entity, id) DO UPDATE SET rev = excluded.rev, seq = excluded.seq, updated_at = excluded.updated_at,
         deleted_at = excluded.deleted_at, data = excluded.data, device_id = excluded.device_id`,
    ),
    nextSeq: db.prepare('UPDATE core_seq SET value = value + 1 WHERE id = 1 RETURNING value'),
    currentSeq: db.prepare('SELECT value FROM core_seq WHERE id = 1'),
    listLive: db.prepare('SELECT * FROM core_records WHERE owner_id = ? AND entity = ? AND deleted_at IS NULL ORDER BY seq'),
    listAll: db.prepare('SELECT * FROM core_records WHERE owner_id = ? AND entity = ? ORDER BY seq'),
    // The literal entity lets SQLite use the partial index core_records_sections_by_plan.
    sectionsOfPlan: db.prepare(
      `SELECT * FROM core_records WHERE owner_id = ? AND entity = 'plan_section' AND json_extract(data, '$.planId') = ? AND deleted_at IS NULL ORDER BY seq`,
    ),
    allSectionsOfPlan: db.prepare(`SELECT * FROM core_records WHERE owner_id = ? AND entity = 'plan_section' AND json_extract(data, '$.planId') = ?`),
    historyOfPlan: db.prepare(`SELECT * FROM core_records WHERE owner_id = ? AND entity = 'section_revision' AND json_extract(data, '$.planId') = ?`),
    after: db.prepare('SELECT * FROM core_records WHERE owner_id = ? AND seq > ? ORDER BY seq LIMIT ?'),
    everything: db.prepare('SELECT * FROM core_records WHERE owner_id = ? AND deleted_at IS NULL ORDER BY entity, seq'),
    purge: db.prepare('DELETE FROM core_records WHERE owner_id = ?'),

    logGet: db.prepare('SELECT payload_hash, result FROM core_sync_mutations WHERE owner_id = ? AND mutation_id = ?'),
    logPut: db.prepare(
      'INSERT INTO core_sync_mutations (owner_id, mutation_id, entity, record_id, op, payload_hash, result, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ),
    logOfRecord: db.prepare('SELECT mutation_id, result FROM core_sync_mutations WHERE owner_id = ? AND entity = ? AND record_id = ?'),
    logRewrite: db.prepare('UPDATE core_sync_mutations SET result = ? WHERE owner_id = ? AND mutation_id = ?'),
    logPurge: db.prepare('DELETE FROM core_sync_mutations WHERE owner_id = ?'),
    logPrune: db.prepare('DELETE FROM core_sync_mutations WHERE created_at < ?'),
  };

  const envelope = <E extends EntityName = EntityName>(row: Row): RecordEnvelope<E> => ({
    entity: row.entity as E,
    id: row.id,
    rev: row.rev,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    data: JSON.parse(row.data) as RecordData<E>,
  });

  const rowOf = (ownerId: Id, entity: EntityName, id: Id): Row | null => (q.get.get(ownerId, entity, id) as Row | undefined) ?? null;
  const liveData = <E extends EntityName>(ownerId: Id, entity: E, id: Id): RecordData<E> | null => {
    const row = rowOf(ownerId, entity, id);
    return row && row.deleted_at === null ? (JSON.parse(row.data) as RecordData<E>) : null;
  };

  function store(actor: WriteActor, entity: EntityName, id: Id, previous: Row | null, data: unknown, deleted: boolean): Row {
    const at = now().toISOString();
    const row: Row = {
      owner_id: actor.ownerId,
      entity,
      id,
      rev: (previous?.rev ?? 0) + 1,
      seq: (q.nextSeq.get() as { value: number }).value,
      updated_at: at,
      deleted_at: deleted ? at : null,
      data: JSON.stringify(data),
      device_id: actor.deviceId,
    };
    q.put.run(row);
    return row;
  }

  const refuse = (status: Exclude<Status, 'applied'>, record: Row | null, message: string): Outcome => ({
    status,
    record: record ? envelope(record) : null,
    message,
    wrote: false,
  });

  /* ---- rule helpers ---- */

  function templateOf(ownerId: Id, templateId: Id): Template | null {
    return BUILTIN_TEMPLATES.find((t) => t.id === templateId) ?? liveData(ownerId, 'template', templateId);
  }

  function sectionsOf(ownerId: Id, planId: Id): Array<RecordEnvelope<'plan_section'>> {
    return (q.sectionsOfPlan.all(ownerId, planId) as Row[]).map((r) => envelope<'plan_section'>(r));
  }

  /** Rule 5: is this section, as it stands, inside the lock of a locked plan? */
  function insideLock(ownerId: Id, section: { planId: Id; key: string }): boolean {
    const plan = liveData(ownerId, 'plan', section.planId);
    if (!plan || !effectivelyLocked(plan)) return false;
    return !isOutsideLock(templateOf(ownerId, plan.templateId), section.key);
  }

  /** DOC-1, with the same shared check the apps run before they let a teacher lock. */
  function whyNotLockable(ownerId: Id, plan: Plan): string | null {
    const known = plan.placements.map((p) => liveData(ownerId, 'class', p.classId)?.curriculum).filter((c): c is 'deped' | 'none' => c !== undefined);
    const classRecord = known.length > 0 ? { curriculum: known.includes('deped') ? ('deped' as const) : ('none' as const) } : undefined;
    const template = templateOf(ownerId, plan.templateId);
    const draft: Plan = { ...plan, state: 'draft', lock: null };
    if (!template) {
      // A custom template this server has not received: the sections cannot be checked, the competency rule still can.
      const tagged = Object.values(plan.competencies).some((ids) => ids.length > 0);
      return classRecord?.curriculum === 'deped' && !tagged ? 'This lesson cannot be locked yet. Add at least one curriculum competency.' : null;
    }
    const result = planHelpers.validatePlanForLock(
      draft,
      sectionsOf(ownerId, plan.id).map((s) => s.data),
      template,
      classRecord,
    );
    return result.ok ? null : `This lesson cannot be locked yet. ${result.errors.map((e) => e.message).join(' ')}`;
  }

  /**
   * A lock is the teacher's word that the lesson is right as they saw it. When the device says which version
   * of each part it saw, the lock is only taken if the server holds exactly those versions, or newer ones
   * this same device wrote. Otherwise another device's edits would be locked in unseen.
   * Parts outside the lock (reflection) may differ freely.
   */
  function sectionsChangedElsewhere(ownerId: Id, plan: Plan, seen: Record<string, number>, deviceId: string | null): boolean {
    const template = templateOf(ownerId, plan.templateId);
    const rows = q.allSectionsOfPlan.all(ownerId, plan.id) as Row[];
    const known = new Set<string>();
    for (const row of rows) {
      known.add(row.id);
      const section = JSON.parse(row.data) as PlanSection;
      if (isOutsideLock(template, section.key)) continue;
      const wroteItItself = deviceId !== null && row.device_id === deviceId;
      if (row.deleted_at !== null) {
        // Deleted here although the locking device still counted it as part of the lesson.
        if (row.id in seen && !wroteItItself) return true;
        continue;
      }
      if (seen[row.id] !== row.rev && !wroteItItself) return true;
    }
    // A part the device locked that never reached the server.
    return Object.keys(seen).some((id) => !known.has(id));
  }

  function snapshot(ownerId: Id, planId: Id) {
    const row = rowOf(ownerId, 'plan', planId);
    if (!row || row.deleted_at !== null) return null;
    return { plan: envelope<'plan'>(row), sections: sectionsOf(ownerId, planId) };
  }

  /* ---- one write ---- */

  function writeUpsert(ownerId: Id, entity: EntityName, id: Id, raw: unknown, baseRev: number | null, scope: Scope): Outcome {
    const current = rowOf(ownerId, entity, id);
    const live = current && current.deleted_at === null ? current : null;

    let data: RecordData<EntityName>;
    try {
      data = parseRecordData(entity, raw);
    } catch (err) {
      if (!(err instanceof ZodError)) throw err;
      // Where, never what: an issue's own text can quote the value.
      const where = err.issues[0]?.path.join('.') ?? '';
      return refuse('invalid', live, where ? `${MESSAGES.invalid} (${where})` : MESSAGES.invalid);
    }
    if (data.id !== id) return refuse('invalid', live, MESSAGES.idMismatch);

    let event: 'lock' | 'unlock' | null = null;
    let lockRevision = 0;
    const storedPlan = entity === 'plan' && live ? (JSON.parse(live.data) as Plan) : null;

    if (entity === 'plan') {
      const normal = normalisePlan(data as Plan);
      if ('problem' in normal) return refuse('invalid', live, normal.problem);
      data = normal.plan;
    }

    // Sending what the server already has changes nothing: no new rev, no conflict, no lock complaint.
    if (live && stableStringify(JSON.parse(live.data)) === stableStringify(storedPlan && effectivelyLocked(storedPlan) ? withServerLockFields(data as Plan, storedPlan) : data)) {
      return { status: 'applied', record: envelope(live), wrote: false };
    }

    if (entity === 'plan_section') {
      // Rule 5 comes before the rev check: an edit to a locked plan is turned into a draft copy by the device,
      // not put to the teacher as a question that can only end the same way (DOC-4).
      const incoming = data as PlanSection;
      const stored = live ? (JSON.parse(live.data) as PlanSection) : null;
      if (insideLock(ownerId, incoming) || (stored !== null && insideLock(ownerId, stored))) return refuse('locked', live, MESSAGES.locked);
    }
    if (entity === 'section_revision' && live) return refuse('forbidden', live, MESSAGES.history);

    // Rules 1, 2 and 6: the device must have seen the current version, unless that version is a tombstone.
    if (live && baseRev !== null && baseRev !== live.rev) return refuse('conflict', live, MESSAGES.conflict);

    if (entity === 'plan') {
      let plan = data as Plan;
      const wasLocked = storedPlan !== null && effectivelyLocked(storedPlan);
      const willBeLocked = effectivelyLocked(plan);
      if (wasLocked && willBeLocked) {
        plan = withServerLockFields(plan, storedPlan!);
        if (lockedPlanViolations(storedPlan!, plan).length > 0) return refuse('locked', live, MESSAGES.locked);
      } else if (!wasLocked && willBeLocked) {
        const problem = whyNotLockable(ownerId, plan);
        if (problem) return refuse('invalid', live, problem);
        const lock = plan.lock!;
        if (lock.sectionRevs && sectionsChangedElsewhere(ownerId, plan, lock.sectionRevs, scope.actor.deviceId)) {
          return refuse('invalid', live, MESSAGES.changedElsewhere);
        }
        const tooFarAhead = Date.parse(lock.lockedAt) > now().getTime() + CLOCK_SLACK_MS;
        lockRevision = revisions.nextNumber(ownerId, id);
        plan = {
          ...plan,
          // A locked plan is the teacher's own, checked work: no longer an unreviewed AI draft (§9.4).
          aiDraft: false,
          lock: { ...lock, lockedAt: tooFarAhead ? now().toISOString() : lock.lockedAt, lockedBy: lock.lockedBy || scope.actor.displayName, revision: lockRevision },
        };
        event = 'lock';
      } else if (wasLocked && !willBeLocked) {
        // DOC-3, DOC-6: the new draft carries neither the lock nor the "submitted" note; the locked revision keeps both.
        plan = { ...plan, lock: null, submitted: null };
        lockRevision = revisions.nextNumber(ownerId, id);
        event = 'unlock';
      }
      data = plan;
    }

    const written = store(scope.actor, entity, id, current, data, false);

    if (entity === 'plan') {
      if (event) {
        const snap = snapshot(ownerId, id)!;
        revisions.recordEvent(ownerId, id, lockRevision, event, event === 'lock', snap, scope.actor);
        scope.touched.delete(id);
      } else {
        scope.touched.set(id, scope.touched.get(id) ?? 'save');
      }
    } else if (entity === 'plan_section') {
      const incoming = data as PlanSection;
      const stored = live ? (JSON.parse(live.data) as PlanSection) : null;
      const regenerated = incoming.origin === 'ai' && incoming.gen !== null && incoming.gen.at !== stored?.gen?.at;
      for (const planId of new Set([incoming.planId, stored?.planId ?? incoming.planId])) {
        scope.touched.set(planId, regenerated || scope.touched.get(planId) === 'regenerate' ? 'regenerate' : 'save');
      }
    } else if (entity === 'profile') {
      deps.onProfile?.(ownerId, data as RecordData<'profile'>);
    }
    return { status: 'applied', record: envelope(written), wrote: true };
  }

  /**
   * The same lock (same revision code) as the server holds: the server's copy of its details stands.
   * `revision` is the server's own field, and it may also have filled in the name or corrected a lock time
   * from a wrong device clock. A device that has not read those back yet must not be refused for it.
   */
  function withServerLockFields(incoming: Plan, stored: Plan): Plan {
    if (!incoming.lock || !stored.lock || incoming.lock.revisionCode !== stored.lock.revisionCode) return incoming;
    return { ...incoming, lock: stored.lock };
  }

  function writeDelete(ownerId: Id, entity: EntityName, id: Id, baseRev: number | null, scope: Scope): Outcome {
    const current = rowOf(ownerId, entity, id);
    // Nothing to delete: the device made and removed it before the server ever saw it.
    if (!current) return { status: 'applied', record: null, wrote: false };
    if (current.deleted_at !== null) return { status: 'applied', record: envelope(current), wrote: false };

    if (entity === 'plan_section') {
      if (insideLock(ownerId, JSON.parse(current.data) as PlanSection)) return refuse('locked', current, MESSAGES.locked);
    }
    if (entity === 'plan' && effectivelyLocked(JSON.parse(current.data) as Plan)) return refuse('locked', current, MESSAGES.lockedDelete);

    // Edited on one device, deleted on another: the edit wins (§10.5). The device gets the newer record back.
    if (baseRev !== null && baseRev !== current.rev) return refuse('conflict', current, MESSAGES.conflict);

    const scrubbed = scrub(entity, JSON.parse(current.data));
    const written = store(scope.actor, entity, id, current, scrubbed, true);
    // Earlier results kept for replays must not keep the words either.
    for (const entry of q.logOfRecord.all(ownerId, entity, id) as Array<{ mutation_id: string; result: string }>) {
      const result = JSON.parse(entry.result) as RecordEnvelope | { c: 1 };
      if ('c' in result) continue; // holds no content
      q.logRewrite.run(JSON.stringify({ ...result, data: scrub(entity, result.data) }), ownerId, entry.mutation_id);
    }
    if (entity === 'plan_section') {
      const planId = (JSON.parse(current.data) as PlanSection).planId;
      scope.touched.set(planId, scope.touched.get(planId) ?? 'save');
    } else if (entity === 'plan') {
      revisions.purgePlan(ownerId, id);
      scope.touched.delete(id);
    }
    return { status: 'applied', record: envelope(written), wrote: true };
  }

  function flushRevisions(scope: Scope): void {
    for (const [planId, reason] of scope.touched) {
      const snap = snapshot(scope.actor.ownerId, planId);
      // Sections can arrive before their plan; the plan's own arrival will take the snapshot.
      if (!snap) continue;
      revisions.recordSave(scope.actor.ownerId, planId, reason, effectivelyLocked(snap.plan.data), snap, scope.actor);
    }
    scope.touched.clear();
  }

  /* ---- sync.push ---- */

  /**
   * What is kept so a replay can be answered. Usually the stored record is exactly what the device sent
   * (after schema defaults), so only its rev and time are kept and the rest is rebuilt from the replay itself.
   * The whole record is kept only when the server changed it on the way in (a lock, an unlock) or deleted it.
   */
  type Remembered = RecordEnvelope | { c: 1; rev: number; updatedAt: string };

  function remember(mutation: Mutation, record: RecordEnvelope): Remembered {
    if (mutation.op === 'upsert' && record.deletedAt === null) {
      try {
        if (stableStringify(parseRecordData(mutation.entity, mutation.data)) === stableStringify(record.data)) return { c: 1, rev: record.rev, updatedAt: record.updatedAt };
      } catch {
        /* keep it whole */
      }
    }
    return record;
  }

  function recall(mutation: Mutation, kept: Remembered): RecordEnvelope {
    if (!('c' in kept)) return kept;
    return { entity: mutation.entity, id: mutation.id, rev: kept.rev, updatedAt: kept.updatedAt, deletedAt: null, data: parseRecordData(mutation.entity, mutation.data) };
  }

  function applyOne(mutation: Mutation, scope: Scope): MutationResult {
    const ownerId = scope.actor.ownerId;
    const fingerprint = sha256(stableStringify({ entity: mutation.entity, id: mutation.id, op: mutation.op, baseRev: mutation.baseRev, data: mutation.data ?? null }));

    // Rule 3: a replay gets the original answer and changes nothing.
    const earlier = q.logGet.get(ownerId, mutation.mutationId) as { payload_hash: string; result: string } | undefined;
    if (earlier) {
      if (earlier.payload_hash !== fingerprint) return { mutationId: mutation.mutationId, status: 'invalid', record: null, message: MESSAGES.reused };
      return { mutationId: mutation.mutationId, status: 'applied', record: recall(mutation, JSON.parse(earlier.result) as Remembered) };
    }

    let outcome: Outcome;
    if (mutation.op === 'upsert') {
      const size = mutation.data === undefined ? 0 : JSON.stringify(mutation.data).length;
      if (size > MAX_RECORD_BYTES) {
        const live = rowOf(ownerId, mutation.entity, mutation.id);
        outcome = refuse('invalid', live && live.deleted_at === null ? live : null, MESSAGES.tooLarge);
      } else {
        outcome = writeUpsert(ownerId, mutation.entity, mutation.id, mutation.data, mutation.baseRev, scope);
      }
    } else {
      outcome = writeDelete(ownerId, mutation.entity, mutation.id, mutation.baseRev, scope);
    }

    if (outcome.wrote && outcome.record) {
      q.logPut.run(ownerId, mutation.mutationId, mutation.entity, mutation.id, mutation.op, fingerprint, JSON.stringify(remember(mutation, outcome.record)), now().toISOString());
    }
    const result: MutationResult = { mutationId: mutation.mutationId, status: outcome.status, record: outcome.record };
    if (outcome.message) result.message = outcome.message;
    return result;
  }

  const applyBatch = db.transaction((actor: WriteActor, mutations: Mutation[]): MutationResult[] => {
    const scope: Scope = { actor, touched: new Map() };
    const results: MutationResult[] = [];
    const inBatch = new Map<string, MutationResult>();
    for (const mutation of mutations) {
      let result = inBatch.get(mutation.mutationId);
      if (!result) {
        try {
          // A savepoint per mutation: one bad item cannot take the rest of the device's work down with it.
          result = db.transaction(() => applyOne(mutation, scope))();
        } catch (err) {
          log.error('sync_mutation_failed', { entity: mutation.entity, op: mutation.op, ...describeError(err) });
          result = { mutationId: mutation.mutationId, status: 'invalid', record: null, message: MESSAGES.failed };
        }
        inBatch.set(mutation.mutationId, result);
      }
      results.push(result);
    }
    try {
      // History is secondary: a failure here must not undo the teacher's saved work.
      db.transaction(() => flushRevisions(scope))();
    } catch (err) {
      log.error('revision_snapshot_failed', describeError(err));
    }
    return results;
  });

  /* ---- server-side writes (RecordStore.put / remove) ---- */

  const serverWrite = db.transaction((actor: WriteActor, run: (scope: Scope) => Outcome): RecordEnvelope | null => {
    const scope: Scope = { actor, touched: new Map() };
    const outcome = run(scope);
    if (outcome.status !== 'applied') {
      const code = outcome.status === 'invalid' ? 'invalid_input' : outcome.status;
      throw new HttpError(code, outcome.message ?? MESSAGES.failed);
    }
    flushRevisions(scope);
    return outcome.record;
  });

  const serverActor = (ownerId: Id): WriteActor => ({ ownerId, sessionId: null, deviceId: null, displayName: '' });

  /* ---- sync.pull ---- */

  /** Plans a first sync leaves for later: dated wholly outside the window, unless locked in the term now running (OFF-2). */
  function plansOutsideWindow(ownerId: Id, from: string | undefined, to: string | undefined): Set<Id> {
    const excluded = new Set<Id>();
    if (!from && !to) return excluded;
    // "Now" in school terms is a calendar date somewhere on Earth: allow a day either side of the server's date.
    const today = now().toISOString().slice(0, 10);
    const early = shiftDate(today, -1);
    const late = shiftDate(today, 1);
    const running = (q.listLive.all(ownerId, 'school_year') as Row[])
      .flatMap((r) => (JSON.parse(r.data) as RecordData<'school_year'>).terms)
      .filter((term) => term.startDate <= late && term.endDate >= early);
    for (const row of q.listLive.all(ownerId, 'plan') as Row[]) {
      const plan = JSON.parse(row.data) as Plan;
      const dates = plan.placements.flatMap((p) => p.dates);
      if (dates.length === 0) continue; // not scheduled yet: probably being written now
      if (dates.some((d) => (!from || d >= from) && (!to || d <= to))) continue;
      if (effectivelyLocked(plan) && dates.some((d) => running.some((term) => d >= term.startDate && d <= term.endDate))) continue;
      excluded.add(row.id);
    }
    return excluded;
  }

  /**
   * On-demand fetch of named plans (an older lesson the first-sync window left out). Returns the plans, their
   * sections and their section history, deleted ones included so the device can tell. It has its own paging
   * token and never touches the device's main cursor.
   */
  function pullPlans(ownerId: Id, input: PullInput & { planIds: string }): PullOutput {
    const ids = [...new Set(input.planIds.split(',').map((s) => s.trim()).filter(Boolean))];
    if (ids.length === 0 || ids.length > MAX_PLAN_IDS_PER_PULL || ids.some((id) => !/^[A-Za-z0-9_.:-]{1,64}$/.test(id))) {
      throw new HttpError('invalid_input', 'Some of the details sent were not right. Please try again.', {
        issues: [{ path: 'query.planIds', message: `Expected 1 to ${MAX_PLAN_IDS_PER_PULL} plan ids separated by commas.` }],
      });
    }
    let after = 0;
    if (input.cursor !== undefined) {
      try {
        const raw = JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8')) as { v?: unknown; p?: unknown };
        if (raw.v === 1 && typeof raw.p === 'number' && Number.isSafeInteger(raw.p) && raw.p >= 0) after = raw.p;
      } catch {
        /* not one of ours: start this fetch from the beginning */
      }
    }
    const rows: Row[] = [];
    for (const planId of ids) {
      const plan = rowOf(ownerId, 'plan', planId);
      if (plan) rows.push(plan);
      rows.push(...(q.allSectionsOfPlan.all(ownerId, planId) as Row[]), ...(q.historyOfPlan.all(ownerId, planId) as Row[]));
    }
    rows.sort((a, b) => a.seq - b.seq);
    const records: RecordEnvelope[] = [];
    let bytes = 0;
    let hasMore = false;
    let position = after;
    for (const row of rows) {
      if (row.seq <= after) continue;
      if (records.length >= input.limit || (records.length > 0 && bytes + row.data.length > MAX_PULL_PAGE_BYTES)) {
        hasMore = true;
        break;
      }
      records.push(envelope(row));
      bytes += row.data.length;
      position = row.seq;
    }
    // The token only continues this same request. When there is nothing more it is empty.
    const cursor = hasMore ? Buffer.from(JSON.stringify({ v: 1, p: position })).toString('base64url') : '';
    return { records, cursor, hasMore, serverTime: now().toISOString() };
  }

  function pull(ownerId: Id, input: PullInput): PullOutput {
    if (input.planIds !== undefined) return pullPlans(ownerId, { ...input, planIds: input.planIds });
    let state = input.cursor === undefined ? null : decodeCursor(input.cursor);
    if (input.cursor !== undefined && state === null) {
      // A cursor we cannot read is treated as "start again" rather than an error the device cannot recover from.
      log.warn('sync_cursor_unreadable');
    }
    if (state === null) {
      for (const [name, value] of [['windowFrom', input.windowFrom], ['windowTo', input.windowTo]] as const) {
        if (value !== undefined && !DATE_RE.test(value)) throw new HttpError('invalid_input', 'Some of the details sent were not right. Please try again.', { issues: [{ path: `query.${name}`, message: 'Expected a date like 2027-06-14.' }] });
      }
      state = { s: 0, u: (q.currentSeq.get() as { value: number }).value };
      if (input.windowFrom) state.f = input.windowFrom;
      if (input.windowTo) state.t = input.windowTo;
    }

    const firstSyncUpTo = state.u ?? null;
    const excluded = firstSyncUpTo !== null ? plansOutsideWindow(ownerId, state.f, state.t) : new Set<Id>();
    const records: RecordEnvelope[] = [];
    let position = state.s;
    let bytes = 0;
    let hasMore = false;
    const CHUNK = 500;

    scan: for (;;) {
      const rows = q.after.all(ownerId, position, CHUNK) as Row[];
      for (const row of rows) {
        let deliver = true;
        if (firstSyncUpTo !== null && row.seq <= firstSyncUpTo) {
          // A new device has nothing to delete, and does not need plans far from today yet.
          if (row.deleted_at !== null) deliver = false;
          else if (excluded.size > 0) {
            if (row.entity === 'plan') deliver = !excluded.has(row.id);
            else if (row.entity === 'plan_section' || row.entity === 'section_revision') deliver = !excluded.has((JSON.parse(row.data) as { planId: Id }).planId);
          }
        }
        if (deliver) {
          if (records.length >= input.limit || (records.length > 0 && bytes + row.data.length > MAX_PULL_PAGE_BYTES)) {
            hasMore = true;
            break scan;
          }
          records.push(envelope(row));
          bytes += row.data.length;
        }
        position = row.seq;
      }
      if (rows.length < CHUNK) break;
    }

    const next: CursorState = { s: position };
    if (firstSyncUpTo !== null) {
      if (hasMore && position < firstSyncUpTo) {
        next.u = firstSyncUpTo;
        if (state.f) next.f = state.f;
        if (state.t) next.t = state.t;
      } else if (!hasMore) {
        // Everything up to the first-sync mark has been considered, including what was skipped.
        next.s = Math.max(position, firstSyncUpTo);
      }
    }
    return { records, cursor: encodeCursor(next), hasMore, serverTime: now().toISOString() };
  }

  /* ---- the service other modules see ---- */

  const service: RecordStore = {
    get<E extends EntityName>(ownerId: Id, entity: E, id: Id): RecordEnvelope<E> | null {
      const row = rowOf(ownerId, entity, id);
      return row && row.deleted_at === null ? envelope<E>(row) : null;
    },
    list<E extends EntityName>(ownerId: Id, entity: E, opts?: { includeDeleted?: boolean }): Array<RecordEnvelope<E>> {
      const rows = (opts?.includeDeleted ? q.listAll : q.listLive).all(ownerId, entity) as Row[];
      return rows.map((r) => envelope<E>(r));
    },
    put<E extends EntityName>(ownerId: Id, entity: E, data: RecordData<E>): RecordEnvelope<E> {
      const id = (data as { id: Id }).id;
      return serverWrite.immediate(serverActor(ownerId), (scope) => writeUpsert(ownerId, entity, id, data, null, scope)) as RecordEnvelope<E>;
    },
    remove(ownerId: Id, entity: EntityName, id: Id): void {
      serverWrite.immediate(serverActor(ownerId), (scope) => writeDelete(ownerId, entity, id, null, scope));
    },
    planSnapshot(ownerId: Id, planId: Id) {
      return snapshot(ownerId, planId);
    },
    checkTallies(curriculumVersion: string, competencyIds: string[]) {
      const confirmed: Record<string, number> = {};
      const corrected: Record<string, number> = {};
      const unique = [...new Set(competencyIds)];
      for (let i = 0; i < unique.length; i += 200) {
        const chunk = unique.slice(i, i + 200);
        // Counted per teacher, never listed. Only accounts with a confirmed email count, so one person
        // cannot make a competency look widely checked by signing up many times.
        const rows = db
          .prepare(
            `SELECT json_extract(r.data, '$.competencyId') AS competency, json_extract(r.data, '$.status') AS status, COUNT(DISTINCT r.owner_id) AS n
               FROM core_records r JOIN core_users u ON u.id = r.owner_id AND u.email_verified = 1
              WHERE r.entity = 'competency_check' AND r.deleted_at IS NULL
                AND json_extract(r.data, '$.curriculumVersion') = ?
                AND json_extract(r.data, '$.competencyId') IN (${chunk.map(() => '?').join(', ')})
              GROUP BY competency, status`,
          )
          .all(curriculumVersion, ...chunk) as Array<{ competency: string; status: string; n: number }>;
        for (const row of rows) {
          if (row.status === 'confirmed') confirmed[row.competency] = row.n;
          else if (row.status === 'corrected') corrected[row.competency] = row.n;
        }
      }
      return { confirmed, corrected };
    },
  };

  return {
    service,
    // IMMEDIATE: take the write lock up front, so a second process cannot slip a write in between our read and our write.
    applyBatch: (actor: WriteActor, mutations: Mutation[]): MutationResult[] => applyBatch.immediate(actor, mutations),
    pull,
    /** Every live record of one teacher, for the account export (AUTH-6). */
    exportAll(ownerId: Id): RecordEnvelope[] {
      return (q.everything.all(ownerId) as Row[]).map((r) => envelope(r));
    },
    /** Remove everything one teacher stored. Called inside the account-deletion transaction. */
    purgeOwner(ownerId: Id): void {
      q.purge.run(ownerId);
      q.logPurge.run(ownerId);
      revisions.purgeOwner(ownerId);
    },
    /**
     * Replay answers are kept for REPLAY_DAYS. A replay that arrives later is simply judged afresh: it meets a
     * newer rev, comes back as a conflict, and the device finds the server already holds what it sent.
     */
    prune(): void {
      q.logPrune.run(new Date(now().getTime() - REPLAY_DAYS * 86_400_000).toISOString());
    },
  };
}

export type RecordEngine = ReturnType<typeof createRecordEngine>;
