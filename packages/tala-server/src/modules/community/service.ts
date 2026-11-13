/**
 * Community operations: post, background recheck, report, remove, staff takedown/restore (PRD §11.2–11.6).
 * Handlers in index.ts are thin wrappers around these.
 */
import type { ArtifactSummary, ModerationDecision, PostArtifactRequest, ReportRequest } from '@hiraia/tala-core';
import type { Database } from 'better-sqlite3';
import type { z } from 'zod';
import { HttpError } from '../../kernel/types';
import type { Logger, RecordStore, Services, SessionUser, TalaServerConfig } from '../../kernel/types';
import { runModeration } from './moderate';
import type { ModerationOutcome } from './moderate';
import { preparePost } from './publish';
import type { VersionContent, VersionMeta } from './publish';
import {
  artifactForPlan,
  getArtifact,
  getVersion,
  insertArtifact,
  insertVersion,
  latestVersion,
  logDecision,
  previewSummary,
  promoteVersion,
  setArtifactStatus,
  setLastDecision,
  setVersionStatus,
  toSummary,
} from './store';
import type { ArtifactRow, LogEntry, VersionRow } from './store';
import { knownNameVariants } from '@hiraia/tala-core/moderation';

export interface CommunityDeps {
  db: Database;
  services: Services;
  config: TalaServerConfig;
  now(): Date;
  newId(): string;
  log: Logger;
}

const DAY_SECONDS = 86_400;
/** Pending versions / reports processed per background pass. */
export const RECHECK_BATCH = 20;

export function requireCommunity(config: TalaServerConfig) {
  if (!config.features.community) throw new HttpError('unavailable', 'The community is turned off right now. Your own lessons are not affected.', { reason: 'community_off' });
}

function log(deps: CommunityDeps, entry: Omit<LogEntry, 'id' | 'at' | 'guidelineVersion'> & { guidelineVersion?: number }) {
  logDecision(deps.db, { ...entry, id: deps.newId(), at: deps.now().toISOString(), guidelineVersion: entry.guidelineVersion ?? deps.config.moderation.guidelineVersion });
  // Structured log: ids, decision and provider only. Never content, excerpts or report notes.
  deps.log.info('community.moderation', {
    trigger: entry.trigger,
    decision: entry.decision,
    artifactId: entry.artifactId,
    versionId: entry.versionId,
    provider: entry.provider,
    model: entry.model,
    outcome: entry.llmOutcome,
  });
}

function outcomeLog(o: ModerationOutcome) {
  return {
    decision: o.decision.decision,
    categories: o.decision.reasons.map((r) => r.category),
    ruleKinds: o.ruleKinds,
    guidelineVersion: o.decision.guidelineVersion,
    provider: o.provider,
    model: o.model,
    promptVersion: o.promptVersion,
    llmOutcome: o.llmOutcome,
  };
}

/** Learner names from the author's own class lists, for the strict roster-name check. Empty if unavailable. */
function knownNamesOf(records: RecordStore, userId: string): string[] {
  try {
    return records
      .list(userId, 'student')
      .filter((s) => !s.deletedAt)
      .flatMap((s) => knownNameVariants(s.data));
  } catch {
    return [];
  }
}

/* ---------------- post ---------------- */

type PostBody = z.output<typeof PostArtifactRequest>;

export async function postArtifact(deps: CommunityDeps, user: SessionUser, body: PostBody): Promise<{ artifact: ArtifactSummary; moderation: ModerationDecision }> {
  if (!user.emailVerified) throw new HttpError('forbidden', 'Please confirm your email address before posting to the community.', { reason: 'email_unverified' });
  const { db } = deps;

  let existing: ArtifactRow | undefined;
  if (body.artifactId) {
    existing = getArtifact(db, body.artifactId);
    if (!existing || existing.author_id !== user.id || existing.status === 'removed') throw new HttpError('not_found', 'We could not find that community post.', { reason: 'artifact_not_found' });
    if (existing.source_plan_id !== body.planId) {
      throw new HttpError('conflict', 'That community post was made from a different lesson. Post this lesson as a new one instead.', { reason: 'different_plan' });
    }
  } else {
    existing = artifactForPlan(db, user.id, body.planId);
  }

  const prepared = preparePost(deps.services.records, user.id, body);
  const latest = existing ? latestVersion(db, existing.id) : undefined;

  // Same locked revision posted again (an offline-queued retry): answer with what is already there.
  if (existing && latest && latest.status !== 'returned' && latest.revision_code === prepared.revisionCode && latest.plan_revision === prepared.planRevision) {
    const last = existing.last_decision_json ? (JSON.parse(existing.last_decision_json) as ModerationDecision) : null;
    return {
      artifact: toSummary(db, existing, user.id),
      moderation: last ?? { decision: latest.status === 'pending' ? 'pending' : 'allow', reasons: [], guidelineVersion: deps.config.moderation.guidelineVersion },
    };
  }

  if (!deps.services.rateLimit.take(`community.post:${user.id}`, deps.config.abuse.postPerUserPerDay, DAY_SECONDS)) {
    throw new HttpError('rate_limited', 'You have posted many lessons today. Please try again tomorrow.', { reason: 'rate_limited' });
  }

  const outcome = await runModeration(
    { llm: deps.services.llm, config: deps.config },
    { title: prepared.meta.title, summary: prepared.meta.summary, sections: prepared.content.sections, knownNames: prepared.knownNames, userId: user.id },
  );
  const decision = outcome.decision;
  const now = deps.now().toISOString();
  const artifactId = existing?.id ?? deps.newId();
  const versionId = deps.newId();
  const number = (latest?.number ?? 0) + 1;

  if (decision.decision === 'return') {
    // Nothing is stored: the post may hold a learner's personal data. The author fixes the plan and posts again.
    log(deps, { ...outcomeLog(outcome), trigger: 'post', artifactId: existing?.id ?? null, versionId: null, authorId: user.id });
    return { artifact: previewSummary({ id: artifactId, versionId, number, meta: prepared.meta, now }), moderation: decision };
  }

  const versionStatus = decision.decision === 'allow' ? 'allowed' : 'pending';
  db.transaction(() => {
    if (!existing) {
      insertArtifact(db, {
        id: artifactId,
        authorId: user.id,
        sourcePlanId: prepared.planId,
        versionId,
        status: versionStatus === 'allowed' ? 'visible' : 'pending_check',
        meta: prepared.meta,
        decision,
        now,
      });
    }
    insertVersion(db, {
      id: versionId,
      artifactId,
      number,
      status: versionStatus,
      planRevision: prepared.planRevision,
      revisionCode: prepared.revisionCode,
      content: prepared.content,
      meta: prepared.meta,
      createdAt: now,
    });
    if (existing) {
      if (versionStatus === 'allowed') {
        promoteVersion(db, artifactId, versionId, now);
        // A new allowed version replaces whatever was wrong with the old one; staff takedowns stay.
        if (existing.hidden_by !== 'staff') setArtifactStatus(db, artifactId, 'visible', null, now);
      } else if (existing.status === 'returned') {
        setArtifactStatus(db, artifactId, 'pending_check', null, now);
      }
    }
    setLastDecision(db, artifactId, decision);
  })();
  log(deps, { ...outcomeLog(outcome), trigger: 'post', artifactId, versionId, authorId: user.id });
  return { artifact: toSummary(db, getArtifact(db, artifactId)!, user.id), moderation: decision };
}

/* ---------------- background recheck (§11.6 step 6) ---------------- */

function versionInput(v: VersionRow) {
  const content = JSON.parse(v.content_json) as VersionContent;
  const meta = JSON.parse(v.meta_json) as VersionMeta;
  return { title: meta.title, summary: meta.summary, sections: content.sections };
}

/** Decide pending versions and pending report checks. Safe to call at any time; returns what it decided. */
export async function recheckPending(deps: CommunityDeps): Promise<{ versions: number; reports: number }> {
  const { db } = deps;
  let versions = 0;
  const pending = db
    .prepare(
      `SELECT v.* FROM community_versions v JOIN community_artifacts a ON a.id = v.artifact_id
       WHERE v.status = 'pending' AND a.status != 'removed' ORDER BY v.created_at LIMIT ?`,
    )
    .all(RECHECK_BATCH) as VersionRow[];
  for (const v of pending) {
    const a = getArtifact(db, v.artifact_id)!;
    const outcome = await runModeration(
      { llm: deps.services.llm, config: deps.config },
      { ...versionInput(v), knownNames: knownNamesOf(deps.services.records, a.author_id), userId: a.author_id },
    );
    const d = outcome.decision;
    if (d.decision === 'pending') {
      db.prepare('UPDATE community_versions SET pending_attempts = pending_attempts + 1 WHERE id = ?').run(v.id);
      continue;
    }
    versions++;
    const now = deps.now().toISOString();
    db.transaction(() => {
      const current = getArtifact(db, a.id)!;
      if (d.decision === 'allow') {
        setVersionStatus(db, v.id, 'allowed');
        promoteVersion(db, a.id, v.id, now);
        if (current.status === 'pending_check' || current.status === 'returned') setArtifactStatus(db, a.id, 'visible', null, now);
      } else {
        setVersionStatus(db, v.id, 'returned');
        if (current.current_version_id === v.id) setArtifactStatus(db, a.id, 'returned', null, now);
      }
      setLastDecision(db, a.id, d);
    })();
    log(deps, { ...outcomeLog(outcome), trigger: 'recheck', artifactId: a.id, versionId: v.id, authorId: a.author_id });
  }

  let reports = 0;
  const pendingReports = db
    .prepare("SELECT id FROM community_reports WHERE check_status = 'pending' ORDER BY created_at LIMIT ?")
    .all(RECHECK_BATCH) as Array<{ id: string }>;
  for (const r of pendingReports) if ((await runReportCheck(deps, r.id)) !== 'pending') reports++;
  return { versions, reports };
}

/* ---------------- report (§11.6 step 3, COM-8) ---------------- */

interface ReportRow {
  id: string;
  artifact_id: string;
  version_id: string;
  reporter_id: string;
  reason: string;
  note: string;
  check_status: string;
}

/** Reasons the guidelines never act on: accuracy is not moderated (§11.6), so no model call is spent on it. */
const UNMODERATED_REASONS = new Set(['inaccurate']);

export async function reportArtifact(deps: CommunityDeps, user: SessionUser, artifactId: string, body: z.output<typeof ReportRequest>) {
  const { db } = deps;
  const a = getArtifact(db, artifactId);
  const reportable = a && (a.status === 'visible' || (a.status === 'hidden' && a.hidden_by === 'report') || (a.author_id === user.id && a.status !== 'removed'));
  if (!a || !reportable) throw new HttpError('not_found', 'We could not find that community lesson.', { reason: 'artifact_not_found' });

  const open = db
    .prepare("SELECT id FROM community_reports WHERE reporter_id = ? AND artifact_id = ? AND version_id = ? AND reason = ? AND check_status = 'pending'")
    .get(user.id, a.id, a.current_version_id, body.reason);
  if (open) return { ok: true as const };

  if (!deps.services.rateLimit.take(`community.report:${user.id}`, deps.config.abuse.reportPerUserPerDay, DAY_SECONDS)) {
    throw new HttpError('rate_limited', 'You have sent many reports today. Please try again tomorrow.', { reason: 'rate_limited' });
  }

  const now = deps.now().toISOString();
  const id = deps.newId();
  const skipped = UNMODERATED_REASONS.has(body.reason);
  db.prepare(
    `INSERT INTO community_reports (id, artifact_id, version_id, reporter_id, reason, note, check_status, outcome, created_at, checked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, a.id, a.current_version_id, user.id, body.reason, body.note, skipped ? 'skipped' : 'pending', skipped ? 'not_moderated' : null, now, skipped ? now : null);
  deps.log.info('community.report', { artifactId: a.id, reason: body.reason });

  if (body.reason === 'personal_data' && deps.config.moderation.autoHideOnPersonalDataReport && a.status === 'visible') {
    setArtifactStatus(db, a.id, 'hidden', 'report', now);
  }
  if (!skipped) await runReportCheck(deps, id);
  return { ok: true as const };
}

/** A fresh moderation check of the reported version, with the reporter's reason. Returns the outcome. */
export async function runReportCheck(deps: CommunityDeps, reportId: string): Promise<'allow' | 'return' | 'pending' | 'gone'> {
  const { db } = deps;
  const r = db.prepare('SELECT * FROM community_reports WHERE id = ?').get(reportId) as ReportRow | undefined;
  if (!r || r.check_status !== 'pending') return 'gone';
  const a = getArtifact(db, r.artifact_id);
  const v = getVersion(db, r.version_id);
  const finish = (outcome: string) =>
    db.prepare("UPDATE community_reports SET check_status = 'done', outcome = ?, checked_at = ? WHERE id = ?").run(outcome, deps.now().toISOString(), r.id);
  if (!a || !v || a.status === 'removed') {
    finish('gone');
    return 'gone';
  }

  const outcome = await runModeration(
    { llm: deps.services.llm, config: deps.config },
    { ...versionInput(v), knownNames: knownNamesOf(deps.services.records, a.author_id), report: { reason: r.reason, note: r.note }, userId: null },
  );
  const d = outcome.decision;
  if (d.decision === 'pending') return 'pending';

  const now = deps.now().toISOString();
  db.transaction(() => {
    const current = getArtifact(db, a.id)!;
    if (d.decision === 'allow') {
      // Nothing found: restore what a personal-data report hid. A staff takedown is not undone here.
      if (current.status === 'hidden' && current.hidden_by === 'report') {
        const stillOpen = db
          .prepare("SELECT 1 FROM community_reports WHERE artifact_id = ? AND reason = 'personal_data' AND check_status = 'pending' AND id != ?")
          .get(a.id, r.id);
        if (!stillOpen) setArtifactStatus(db, a.id, 'visible', null, now);
      }
    } else {
      setVersionStatus(db, v.id, 'returned');
      if (current.current_version_id === v.id && current.hidden_by !== 'staff') setArtifactStatus(db, a.id, 'returned', null, now);
      setLastDecision(db, a.id, d);
    }
    finish(d.decision);
  })();
  log(deps, { ...outcomeLog(outcome), trigger: 'report', artifactId: a.id, versionId: v.id, authorId: a.author_id });
  return d.decision;
}

/* ---------------- remove (§11.5) ---------------- */

export function removeArtifact(deps: CommunityDeps, user: SessionUser, artifactId: string) {
  const a = getArtifact(deps.db, artifactId);
  if (!a || a.status === 'removed') throw new HttpError('not_found', 'We could not find that community post.', { reason: 'artifact_not_found' });
  if (a.author_id !== user.id) throw new HttpError('forbidden', 'Only the teacher who posted a lesson can remove it.', { reason: 'not_author' });
  const now = deps.now().toISOString();
  deps.db.prepare("UPDATE community_artifacts SET status = 'removed', hidden_by = NULL, removed_at = ?, updated_at = ? WHERE id = ?").run(now, now, a.id);
  deps.log.info('community.remove', { artifactId: a.id });
  return { ok: true as const };
}

/* ---------------- staff takedown / restore (§11.6 step 4) ---------------- */

export interface StaffDeps {
  db: Database;
  now(): Date;
  newId(): string;
  guidelineVersion: number;
}

function staffLog(deps: StaffDeps, a: ArtifactRow, decision: 'takedown' | 'restore') {
  logDecision(deps.db, {
    id: deps.newId(),
    artifactId: a.id,
    versionId: a.current_version_id,
    authorId: a.author_id,
    trigger: 'staff',
    decision,
    categories: [],
    ruleKinds: [],
    guidelineVersion: deps.guidelineVersion,
    provider: 'staff',
    model: null,
    promptVersion: null,
    llmOutcome: 'staff',
    at: deps.now().toISOString(),
  });
}

/** Hide an artifact from everyone but its author until a staff restore. */
export function staffTakedown(deps: StaffDeps, artifactId: string): ArtifactRow {
  const a = getArtifact(deps.db, artifactId);
  if (!a) throw new Error(`No artifact ${artifactId}`);
  if (a.status === 'removed') throw new Error('The author already removed this artifact.');
  setArtifactStatus(deps.db, a.id, 'hidden', 'staff', deps.now().toISOString());
  staffLog(deps, a, 'takedown');
  return getArtifact(deps.db, a.id)!;
}

/**
 * Make an artifact visible again: undoes a staff takedown, a report hide, or a model return (escalation
 * upheld). The current version is marked allowed. An author's removal is never undone.
 */
export function staffRestore(deps: StaffDeps, artifactId: string): ArtifactRow {
  const a = getArtifact(deps.db, artifactId);
  if (!a) throw new Error(`No artifact ${artifactId}`);
  if (a.status === 'removed') throw new Error('The author removed this artifact; it cannot be restored.');
  const now = deps.now().toISOString();
  deps.db.transaction(() => {
    setVersionStatus(deps.db, a.current_version_id, 'allowed');
    setArtifactStatus(deps.db, a.id, 'visible', null, now);
    setLastDecision(deps.db, a.id, { decision: 'allow', reasons: [], guidelineVersion: deps.guidelineVersion });
  })();
  staffLog(deps, a, 'restore');
  return getArtifact(deps.db, a.id)!;
}

/* ---------------- account deletion (PRIV-6) ---------------- */

/**
 * Remove everything the community stores for a deleted account: their artifacts with every version, tag and
 * lineage row, their reports, their copy records. Derived artifacts by other teachers keep their credit line
 * (it lives in their own version metadata) and show the source as unavailable. Decision-log rows lose the
 * author id and keep only the decision. Synchronous, idempotent, never throws for an unknown user.
 */
export function deleteAccountData(db: Database, userId: string): void {
  const own = `SELECT id FROM community_artifacts WHERE author_id = @u`;
  db.prepare(`DELETE FROM community_artifact_terms WHERE artifact_id IN (${own})`).run({ u: userId });
  db.prepare(`DELETE FROM community_lineage WHERE artifact_id IN (${own})`).run({ u: userId });
  db.prepare(`DELETE FROM community_copies WHERE artifact_id IN (${own}) OR user_id = @u`).run({ u: userId });
  db.prepare(`DELETE FROM community_reports WHERE artifact_id IN (${own}) OR reporter_id = @u`).run({ u: userId });
  db.prepare(`UPDATE community_moderation_log SET author_id = NULL WHERE author_id = @u`).run({ u: userId });
  db.prepare(`DELETE FROM community_versions WHERE artifact_id IN (${own})`).run({ u: userId });
  db.prepare(`DELETE FROM community_artifacts WHERE author_id = @u`).run({ u: userId });
}
