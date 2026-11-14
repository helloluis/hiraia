/**
 * Plan revisions: whole-plan snapshots kept on the server (PRD PLAN-10, DOC-1, DOC-3).
 * OWNER: workstream A.
 *
 * A revision is the plan record and all its sections as they stood at one moment.
 *  - `lock`       taken when a plan is locked. This is "the exact revision" DOC-1 asks for: it never changes,
 *                 so the locked text can always be shown and printed again, even after an unlock.
 *  - `unlock`     taken when a locked plan is opened again: the new draft (DOC-3).
 *  - `regenerate` taken after AI rewrote a section; the revision before it holds the previous text (LLM-4).
 *  - `save`       ordinary edits. Saves that arrive within COALESCE_MS of each other share one revision,
 *                 so typing does not produce hundreds of them.
 *  - `post_class` writing in a post-class part (results, reflection) of a LOCKED plan. Kept apart from
 *                 `save` so the history shows that nothing the teacher locked was touched. Coalesced the
 *                 same way. The lock revision itself is never altered by it.
 *
 * A lock revision also carries `lock_keys`: which section keys that lock froze (see LockKeys in plan-rules.ts).
 *
 * Per-section history for one-step restore on the device is the `section_revision` synced record
 * (workstream H). These snapshots are the server's own, reachable through `plans.revisions`.
 */
import { deflateSync, inflateSync } from 'node:zlib';
import type { Id, PlanRevisionMeta, RecordEnvelope } from '@hiraia/tala-core';
import type { z } from 'zod';
import type { Db } from '../../kernel/db';
import type { LockKeys } from './plan-rules';
import { sha256 } from './stable';

/**
 * Why a revision was taken: the contract's own list (`PlanRevisionMeta.reason`), so what is stored is always
 * something a client may be told. `restore` and `conflict` are the apps' to use; the server writes the rest.
 */
export type RevisionReason = z.infer<typeof PlanRevisionMeta>['reason'];

export interface PlanSnapshotEnvelopes {
  plan: RecordEnvelope<'plan'>;
  sections: Array<RecordEnvelope<'plan_section'>>;
}

export interface RevisionMeta {
  revision: number;
  createdAt: string;
  reason: RevisionReason;
  locked: boolean;
}

export interface RevisionActor {
  sessionId: Id | null;
  deviceId: string | null;
}

/** Saves closer together than this are one revision. */
export const COALESCE_MS = 10 * 60 * 1000;
/** Ordinary save revisions kept per plan, and separately post-class ones. Lock and unlock revisions are never pruned. */
export const MAX_SAVE_REVISIONS = 20;

interface RevisionRow {
  revision: number;
  reason: RevisionReason;
  locked: number;
  created_at: string;
  updated_at: string;
  /** SHA-256 of the snapshot's JSON: tells "nothing changed" without unpacking. */
  digest: string;
  /** The snapshot, zlib-compressed JSON `{ plan, sections }`. */
  snapshot: Buffer;
}

function pack(snapshot: PlanSnapshotEnvelopes): { digest: string; packed: Buffer } {
  const json = JSON.stringify({ plan: snapshot.plan, sections: snapshot.sections });
  return { digest: sha256(json), packed: deflateSync(Buffer.from(json, 'utf8')) };
}

function unpack(packed: Buffer): PlanSnapshotEnvelopes {
  return JSON.parse(inflateSync(packed).toString('utf8')) as PlanSnapshotEnvelopes;
}

function readLockKeys(json: string): LockKeys | null {
  const strings = (value: unknown): string[] | null =>
    Array.isArray(value) && value.every((k) => typeof k === 'string') ? (value as string[]) : null;
  try {
    const raw = JSON.parse(json) as { outside?: unknown; inside?: unknown } | null;
    const outside = strings(raw?.outside);
    const inside = strings(raw?.inside);
    return outside && inside ? { outside, inside } : null;
  } catch {
    return null;
  }
}

export function createRevisions(db: Db, now: () => Date) {
  const q = {
    latest: db.prepare(
      'SELECT * FROM core_plan_revisions WHERE owner_id = ? AND plan_id = ? ORDER BY revision DESC LIMIT 1'
    ),
    max: db.prepare(
      'SELECT COALESCE(MAX(revision), 0) AS n FROM core_plan_revisions WHERE owner_id = ? AND plan_id = ?'
    ),
    insert: db.prepare(
      `INSERT INTO core_plan_revisions (owner_id, plan_id, revision, reason, locked, created_at, updated_at, session_id, device_id, digest, snapshot, lock_keys)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ),
    overwrite: db.prepare(
      'UPDATE core_plan_revisions SET digest = ?, snapshot = ?, updated_at = ? WHERE owner_id = ? AND plan_id = ? AND revision = ?'
    ),
    list: db.prepare(
      'SELECT revision, reason, locked, created_at FROM core_plan_revisions WHERE owner_id = ? AND plan_id = ? ORDER BY revision DESC'
    ),
    one: db.prepare(
      'SELECT * FROM core_plan_revisions WHERE owner_id = ? AND plan_id = ? AND revision = ?'
    ),
    prune: db.prepare(
      `DELETE FROM core_plan_revisions
        WHERE owner_id = ? AND plan_id = ? AND reason = ? AND revision IN (
          SELECT revision FROM core_plan_revisions WHERE owner_id = ? AND plan_id = ? AND reason = ?
           ORDER BY revision DESC LIMIT -1 OFFSET ?)`
    ),
    lockKeys: db.prepare(
      `SELECT lock_keys FROM core_plan_revisions WHERE owner_id = ? AND plan_id = ? AND revision = ? AND reason = 'lock'`
    ),
    purgeOwner: db.prepare('DELETE FROM core_plan_revisions WHERE owner_id = ?'),
    purgePlan: db.prepare('DELETE FROM core_plan_revisions WHERE owner_id = ? AND plan_id = ?'),
  };

  const meta = (
    row: Pick<RevisionRow, 'revision' | 'reason' | 'locked' | 'created_at'>
  ): RevisionMeta => ({
    revision: row.revision,
    createdAt: row.created_at,
    reason: row.reason,
    locked: row.locked === 1,
  });

  function append(
    ownerId: Id,
    planId: Id,
    revision: number,
    reason: RevisionReason,
    locked: boolean,
    snapshot: PlanSnapshotEnvelopes,
    actor: RevisionActor,
    lockKeys: LockKeys | null = null
  ): void {
    const at = now().toISOString();
    const { digest, packed } = pack(snapshot);
    q.insert.run(
      ownerId,
      planId,
      revision,
      reason,
      locked ? 1 : 0,
      at,
      at,
      actor.sessionId,
      actor.deviceId,
      digest,
      packed,
      lockKeys === null ? null : JSON.stringify(lockKeys)
    );
  }

  return {
    /** The number the next revision of this plan will get. */
    nextNumber(ownerId: Id, planId: Id): number {
      return (q.max.get(ownerId, planId) as { n: number }).n + 1;
    },

    /**
     * A lock or unlock: always its own revision, with the number the caller reserved. A lock also records
     * which section keys it froze and which it left open for post-class writing.
     */
    recordEvent(
      ownerId: Id,
      planId: Id,
      revision: number,
      reason: 'lock' | 'unlock',
      locked: boolean,
      snapshot: PlanSnapshotEnvelopes,
      actor: RevisionActor,
      lockKeys: LockKeys | null = null
    ): void {
      append(ownerId, planId, revision, reason, locked, snapshot, actor, lockKeys);
    },

    /** What the lock with this revision number froze, or null if that lock has no such record (an older lock). */
    lockKeys(ownerId: Id, planId: Id, revision: number): LockKeys | null {
      const row = q.lockKeys.get(ownerId, planId, revision) as
        | { lock_keys: string | null }
        | undefined;
      return row && row.lock_keys !== null ? readLockKeys(row.lock_keys) : null;
    },

    /**
     * Ordinary edits and post-class writing: fold into the newest revision when it is a recent one of the
     * same kind, else add one. An AI rewrite always gets its own. Nothing ever folds into a lock revision.
     */
    recordSave(
      ownerId: Id,
      planId: Id,
      reason: 'save' | 'regenerate' | 'post_class',
      locked: boolean,
      snapshot: PlanSnapshotEnvelopes,
      actor: RevisionActor
    ): number {
      const latest = q.latest.get(ownerId, planId) as RevisionRow | undefined;
      const { digest, packed } = pack(snapshot);
      if (latest && latest.digest === digest) return latest.revision;
      const at = now();
      if (
        reason !== 'regenerate' &&
        latest &&
        latest.reason === reason &&
        (latest.locked === 1) === locked &&
        at.getTime() - Date.parse(latest.created_at) < COALESCE_MS
      ) {
        q.overwrite.run(digest, packed, at.toISOString(), ownerId, planId, latest.revision);
        return latest.revision;
      }
      const revision = (latest?.revision ?? 0) + 1;
      append(ownerId, planId, revision, reason, locked, snapshot, actor);
      if (reason !== 'regenerate')
        q.prune.run(ownerId, planId, reason, ownerId, planId, reason, MAX_SAVE_REVISIONS);
      return revision;
    },

    list(ownerId: Id, planId: Id): RevisionMeta[] {
      return (q.list.all(ownerId, planId) as RevisionRow[]).map(meta);
    },

    get(
      ownerId: Id,
      planId: Id,
      revision: number
    ): {
      meta: RevisionMeta;
      plan: RecordEnvelope<'plan'>;
      sections: Array<RecordEnvelope<'plan_section'>>;
    } | null {
      const row = q.one.get(ownerId, planId, revision) as RevisionRow | undefined;
      if (!row) return null;
      const snapshot = unpack(row.snapshot);
      return { meta: meta(row), plan: snapshot.plan, sections: snapshot.sections };
    },

    purgeOwner(ownerId: Id): void {
      q.purgeOwner.run(ownerId);
    },

    /** Account merge: plan history follows its plans. History of a plan id the other account also has is dropped. */
    reassignOwner(fromOwner: Id, toOwner: Id): void {
      db.prepare(
        'DELETE FROM core_plan_revisions WHERE owner_id = ? AND plan_id IN (SELECT plan_id FROM core_plan_revisions WHERE owner_id = ?)'
      ).run(fromOwner, toOwner);
      db.prepare('UPDATE core_plan_revisions SET owner_id = ? WHERE owner_id = ?').run(
        toOwner,
        fromOwner
      );
    },

    /** A deleted plan's history goes with it: the words of a deleted lesson are not kept. */
    purgePlan(ownerId: Id, planId: Id): void {
      q.purgePlan.run(ownerId, planId);
    },
  };
}

export type Revisions = ReturnType<typeof createRevisions>;
