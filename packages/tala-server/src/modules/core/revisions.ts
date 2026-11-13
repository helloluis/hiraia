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
 *
 * Per-section history for one-step restore on the device is the `section_revision` synced record
 * (workstream H). These snapshots are the server's own, reachable through `plans.revisions`.
 */
import { deflateSync, inflateSync } from 'node:zlib';
import type { Id, RecordEnvelope } from '@hiraia/tala-core';
import type { Db } from '../../kernel/db';
import { sha256 } from './stable';

export type RevisionReason = 'save' | 'lock' | 'unlock' | 'regenerate' | 'restore' | 'conflict';

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
/** Ordinary save revisions kept per plan. Lock and unlock revisions are never pruned. */
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

export function createRevisions(db: Db, now: () => Date) {
  const q = {
    latest: db.prepare('SELECT * FROM core_plan_revisions WHERE owner_id = ? AND plan_id = ? ORDER BY revision DESC LIMIT 1'),
    max: db.prepare('SELECT COALESCE(MAX(revision), 0) AS n FROM core_plan_revisions WHERE owner_id = ? AND plan_id = ?'),
    insert: db.prepare(
      `INSERT INTO core_plan_revisions (owner_id, plan_id, revision, reason, locked, created_at, updated_at, session_id, device_id, digest, snapshot)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    overwrite: db.prepare('UPDATE core_plan_revisions SET digest = ?, snapshot = ?, updated_at = ? WHERE owner_id = ? AND plan_id = ? AND revision = ?'),
    list: db.prepare('SELECT revision, reason, locked, created_at FROM core_plan_revisions WHERE owner_id = ? AND plan_id = ? ORDER BY revision DESC'),
    one: db.prepare('SELECT * FROM core_plan_revisions WHERE owner_id = ? AND plan_id = ? AND revision = ?'),
    prune: db.prepare(
      `DELETE FROM core_plan_revisions
        WHERE owner_id = ? AND plan_id = ? AND reason = 'save' AND revision IN (
          SELECT revision FROM core_plan_revisions WHERE owner_id = ? AND plan_id = ? AND reason = 'save'
           ORDER BY revision DESC LIMIT -1 OFFSET ?)`,
    ),
    purgeOwner: db.prepare('DELETE FROM core_plan_revisions WHERE owner_id = ?'),
    purgePlan: db.prepare('DELETE FROM core_plan_revisions WHERE owner_id = ? AND plan_id = ?'),
  };

  const meta = (row: Pick<RevisionRow, 'revision' | 'reason' | 'locked' | 'created_at'>): RevisionMeta => ({
    revision: row.revision,
    createdAt: row.created_at,
    reason: row.reason,
    locked: row.locked === 1,
  });

  function append(ownerId: Id, planId: Id, revision: number, reason: RevisionReason, locked: boolean, snapshot: PlanSnapshotEnvelopes, actor: RevisionActor): void {
    const at = now().toISOString();
    const { digest, packed } = pack(snapshot);
    q.insert.run(ownerId, planId, revision, reason, locked ? 1 : 0, at, at, actor.sessionId, actor.deviceId, digest, packed);
  }

  return {
    /** The number the next revision of this plan will get. */
    nextNumber(ownerId: Id, planId: Id): number {
      return (q.max.get(ownerId, planId) as { n: number }).n + 1;
    },

    /** A lock or unlock: always its own revision, with the number the caller reserved. */
    recordEvent(ownerId: Id, planId: Id, revision: number, reason: 'lock' | 'unlock', locked: boolean, snapshot: PlanSnapshotEnvelopes, actor: RevisionActor): void {
      append(ownerId, planId, revision, reason, locked, snapshot, actor);
    },

    /** Ordinary edits: fold into the newest revision when it is a recent save of the same kind, else add one. */
    recordSave(ownerId: Id, planId: Id, reason: 'save' | 'regenerate', locked: boolean, snapshot: PlanSnapshotEnvelopes, actor: RevisionActor): number {
      const latest = q.latest.get(ownerId, planId) as RevisionRow | undefined;
      const { digest, packed } = pack(snapshot);
      if (latest && latest.digest === digest) return latest.revision;
      const at = now();
      if (
        reason === 'save' &&
        latest &&
        latest.reason === 'save' &&
        (latest.locked === 1) === locked &&
        at.getTime() - Date.parse(latest.created_at) < COALESCE_MS
      ) {
        q.overwrite.run(digest, packed, at.toISOString(), ownerId, planId, latest.revision);
        return latest.revision;
      }
      const revision = (latest?.revision ?? 0) + 1;
      append(ownerId, planId, revision, reason, locked, snapshot, actor);
      if (reason === 'save') q.prune.run(ownerId, planId, ownerId, planId, MAX_SAVE_REVISIONS);
      return revision;
    },

    list(ownerId: Id, planId: Id): RevisionMeta[] {
      return (q.list.all(ownerId, planId) as RevisionRow[]).map(meta);
    },

    get(ownerId: Id, planId: Id, revision: number): { meta: RevisionMeta; plan: RecordEnvelope<'plan'>; sections: Array<RecordEnvelope<'plan_section'>> } | null {
      const row = q.one.get(ownerId, planId, revision) as RevisionRow | undefined;
      if (!row) return null;
      const snapshot = unpack(row.snapshot);
      return { meta: meta(row), plan: snapshot.plan, sections: snapshot.sections };
    },

    purgeOwner(ownerId: Id): void {
      q.purgeOwner.run(ownerId);
    },

    /** A deleted plan's history goes with it: the words of a deleted lesson are not kept. */
    purgePlan(ownerId: Id, planId: Id): void {
      q.purgePlan.run(ownerId, planId);
    },
  };
}

export type Revisions = ReturnType<typeof createRevisions>;
