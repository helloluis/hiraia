/** Community tables: row types, reads, writes and DTO mapping. No HTTP here. */
import { ArtifactTags, LICENSE } from '@hiraia/tala-core';
import type {
  ArtifactDetail,
  ArtifactSummary,
  ArtifactVersion,
  ModerationDecision,
} from '@hiraia/tala-core';
import type { Database } from 'better-sqlite3';
import type { VersionContent, VersionMeta } from './publish';

export type ArtifactStatus = ArtifactSummary['status'];
export type VersionStatus = 'allowed' | 'pending' | 'returned';

export interface ArtifactRow {
  id: string;
  author_id: string;
  source_plan_id: string;
  current_version_id: string;
  status: ArtifactStatus;
  hidden_by: 'report' | 'staff' | null;
  copy_count: number;
  title: string;
  summary: string;
  author_display_name: string;
  author_school: string | null;
  tags_json: string;
  language: string;
  learning_area_id: string | null;
  subject_name: string;
  term_index: number | null;
  duration_minutes: number;
  region: string | null;
  multigrade: string | null;
  competency_count: number;
  ai_drafted: number;
  adapted: number;
  lineage_artifact_id: string | null;
  lineage_version_id: string | null;
  lineage_title: string | null;
  lineage_author: string | null;
  last_decision_json: string | null;
  created_at: string;
  updated_at: string;
  removed_at: string | null;
}

export interface VersionRow {
  id: string;
  artifact_id: string;
  number: number;
  status: VersionStatus;
  plan_revision: number | null;
  revision_code: string | null;
  content_json: string;
  meta_json: string;
  pending_attempts: number;
  created_at: string;
}

export const getArtifact = (db: Database, id: string) =>
  db.prepare('SELECT * FROM community_artifacts WHERE id = ?').get(id) as ArtifactRow | undefined;

export const getVersion = (db: Database, id: string) =>
  db.prepare('SELECT * FROM community_versions WHERE id = ?').get(id) as VersionRow | undefined;

export const latestVersion = (db: Database, artifactId: string) =>
  db
    .prepare('SELECT * FROM community_versions WHERE artifact_id = ? ORDER BY number DESC LIMIT 1')
    .get(artifactId) as VersionRow | undefined;

/** The author's live (not removed) artifact for a plan, if any: posting again adds a version to it. */
export const artifactForPlan = (db: Database, authorId: string, planId: string) =>
  db
    .prepare(
      "SELECT * FROM community_artifacts WHERE author_id = ? AND source_plan_id = ? AND status != 'removed' ORDER BY created_at DESC LIMIT 1"
    )
    .get(authorId, planId) as ArtifactRow | undefined;

export function insertVersion(
  db: Database,
  v: {
    id: string;
    artifactId: string;
    number: number;
    status: VersionStatus;
    planRevision: number | null;
    revisionCode: string | null;
    content: VersionContent;
    meta: VersionMeta;
    createdAt: string;
  }
) {
  db.prepare(
    `INSERT INTO community_versions (id, artifact_id, number, status, plan_revision, revision_code, content_json, meta_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    v.id,
    v.artifactId,
    v.number,
    v.status,
    v.planRevision,
    v.revisionCode,
    JSON.stringify(v.content),
    JSON.stringify(v.meta),
    v.createdAt
  );
  if (v.meta.lineage) {
    db.prepare(
      'INSERT OR REPLACE INTO community_lineage (version_id, artifact_id, source_artifact_id, source_version_id) VALUES (?, ?, ?, ?)'
    ).run(v.id, v.artifactId, v.meta.lineage.artifactId, v.meta.lineage.versionId);
  }
}

/** Columns mirrored from a version's metadata onto its artifact. */
function metaColumns(meta: VersionMeta) {
  const t = meta.tags;
  return {
    title: meta.title,
    summary: meta.summary,
    author_display_name: meta.authorDisplayName,
    author_school: meta.authorSchool,
    tags_json: JSON.stringify(t),
    language: t.language,
    learning_area_id: t.learningAreaId,
    subject_name: t.subjectName,
    term_index: t.termIndex,
    duration_minutes: t.durationMinutes,
    region: t.region,
    multigrade: t.multigrade ? t.multigrade.join(',') : null,
    competency_count: t.competencyIds.length,
    ai_drafted: meta.provenance.aiDrafted ? 1 : 0,
    adapted: meta.provenance.adapted ? 1 : 0,
    lineage_artifact_id: meta.lineage?.artifactId ?? null,
    lineage_version_id: meta.lineage?.versionId ?? null,
    lineage_title: meta.lineage?.title ?? null,
    lineage_author: meta.lineage?.authorDisplayName ?? null,
  };
}

function writeTerms(db: Database, artifactId: string, tags: ArtifactTags) {
  db.prepare('DELETE FROM community_artifact_terms WHERE artifact_id = ?').run(artifactId);
  const ins = db.prepare(
    'INSERT OR IGNORE INTO community_artifact_terms (artifact_id, kind, value) VALUES (?, ?, ?)'
  );
  for (const g of tags.grades) ins.run(artifactId, 'grade', g);
  for (const c of tags.competencyIds) ins.run(artifactId, 'competency', c);
}

export function insertArtifact(
  db: Database,
  a: {
    id: string;
    authorId: string;
    sourcePlanId: string;
    versionId: string;
    status: ArtifactStatus;
    meta: VersionMeta;
    decision: ModerationDecision;
    now: string;
  }
) {
  const cols = metaColumns(a.meta);
  db.prepare(
    `INSERT INTO community_artifacts (id, author_id, source_plan_id, current_version_id, status, hidden_by, copy_count,
       title, summary, author_display_name, author_school, tags_json, language, learning_area_id, subject_name, term_index,
       duration_minutes, region, multigrade, competency_count, ai_drafted, adapted, lineage_artifact_id, lineage_version_id,
       lineage_title, lineage_author, last_decision_json, created_at, updated_at, removed_at)
     VALUES (@id, @author_id, @source_plan_id, @current_version_id, @status, NULL, 0,
       @title, @summary, @author_display_name, @author_school, @tags_json, @language, @learning_area_id, @subject_name, @term_index,
       @duration_minutes, @region, @multigrade, @competency_count, @ai_drafted, @adapted, @lineage_artifact_id, @lineage_version_id,
       @lineage_title, @lineage_author, @last_decision_json, @now, @now, NULL)`
  ).run({
    ...cols,
    id: a.id,
    author_id: a.authorId,
    source_plan_id: a.sourcePlanId,
    current_version_id: a.versionId,
    status: a.status,
    last_decision_json: JSON.stringify(a.decision),
    now: a.now,
  });
  writeTerms(db, a.id, a.meta.tags);
}

/** Make a version current: the artifact shows its content and metadata from now on. */
export function promoteVersion(db: Database, artifactId: string, versionId: string, now: string) {
  const v = getVersion(db, versionId);
  if (!v || v.artifact_id !== artifactId)
    throw new Error('promoteVersion: version does not belong to artifact');
  const meta = JSON.parse(v.meta_json) as VersionMeta;
  const cols = metaColumns(meta);
  const sets = Object.keys(cols)
    .map((k) => `${k} = @${k}`)
    .join(', ');
  db.prepare(
    `UPDATE community_artifacts SET ${sets}, current_version_id = @versionId, updated_at = @now WHERE id = @artifactId`
  ).run({
    ...cols,
    versionId,
    artifactId,
    now,
  });
  writeTerms(db, artifactId, meta.tags);
}

export function setVersionStatus(db: Database, versionId: string, status: VersionStatus) {
  db.prepare('UPDATE community_versions SET status = ? WHERE id = ?').run(status, versionId);
}

export function setArtifactStatus(
  db: Database,
  id: string,
  status: ArtifactStatus,
  hiddenBy: 'report' | 'staff' | null,
  now: string
) {
  db.prepare(
    'UPDATE community_artifacts SET status = ?, hidden_by = ?, updated_at = ? WHERE id = ?'
  ).run(status, hiddenBy, now, id);
}

export function setLastDecision(db: Database, id: string, decision: ModerationDecision) {
  db.prepare('UPDATE community_artifacts SET last_decision_json = ? WHERE id = ?').run(
    JSON.stringify(decision),
    id
  );
}

export interface LogEntry {
  id: string;
  artifactId: string | null;
  versionId: string | null;
  authorId: string | null;
  trigger: 'post' | 'recheck' | 'report' | 'staff';
  decision: 'allow' | 'return' | 'pending' | 'takedown' | 'restore';
  categories: string[];
  ruleKinds: string[];
  guidelineVersion: number;
  provider: string;
  model: string | null;
  promptVersion: number | null;
  llmOutcome: string;
  at: string;
}

export function logDecision(db: Database, e: LogEntry) {
  db.prepare(
    `INSERT INTO community_moderation_log (id, artifact_id, version_id, author_id, trigger, decision, categories, rule_kinds,
       guideline_version, provider, model, prompt_version, llm_outcome, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    e.id,
    e.artifactId,
    e.versionId,
    e.authorId,
    e.trigger,
    e.decision,
    [...new Set(e.categories)].sort().join(','),
    e.ruleKinds.join(','),
    e.guidelineVersion,
    e.provider,
    e.model,
    e.promptVersion,
    e.llmOutcome,
    e.at
  );
}

/* ---------------- DTOs ---------------- */

function lineageOf(db: Database, row: ArtifactRow): ArtifactSummary['lineage'] {
  if (!row.lineage_artifact_id || !row.lineage_version_id) return null;
  const src = getArtifact(db, row.lineage_artifact_id);
  const srcVersion = getVersion(db, row.lineage_version_id);
  const available =
    !!src &&
    src.status === 'visible' &&
    !!srcVersion &&
    srcVersion.artifact_id === src.id &&
    srcVersion.status === 'allowed';
  return {
    artifactId: row.lineage_artifact_id,
    versionId: row.lineage_version_id,
    // The credit line is permanent (§11.3): kept from the version metadata even when the source is gone.
    title: row.lineage_title ?? '',
    authorDisplayName: row.lineage_author ?? '',
    available,
  };
}

export function toSummary(
  db: Database,
  row: ArtifactRow,
  viewerId: string,
  overrides: Partial<ArtifactSummary> = {}
): ArtifactSummary {
  const version = getVersion(db, row.current_version_id);
  const mine = row.author_id === viewerId;
  // The latest decision (reasons and excerpts of the author's own text) goes to the author only.
  const moderation =
    mine && row.last_decision_json
      ? { moderation: JSON.parse(row.last_decision_json) as ModerationDecision }
      : {};
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    authorDisplayName: row.author_display_name,
    authorSchool: row.author_school,
    tags: ArtifactTags.parse(JSON.parse(row.tags_json)),
    license: LICENSE,
    provenance: { aiDrafted: row.ai_drafted === 1, adapted: row.adapted === 1 },
    lineage: lineageOf(db, row),
    copyCount: row.copy_count,
    currentVersionId: row.current_version_id,
    versionNumber: version?.number ?? 1,
    status: row.status,
    mine,
    ...moderation,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...overrides,
  };
}

export function toVersion(v: VersionRow): ArtifactVersion {
  const content = JSON.parse(v.content_json) as VersionContent;
  return {
    id: v.id,
    artifactId: v.artifact_id,
    number: v.number,
    ...content,
    createdAt: v.created_at,
  };
}

export function toDetail(
  db: Database,
  row: ArtifactRow,
  version: VersionRow,
  viewerId: string
): ArtifactDetail {
  return { ...toSummary(db, row, viewerId), version: toVersion(version) };
}

/** A summary for a post that was returned at posting time and therefore never stored. */
export function previewSummary(input: {
  id: string;
  versionId: string;
  number: number;
  meta: VersionMeta;
  now: string;
  decision?: ModerationDecision;
}): ArtifactSummary {
  const m = input.meta;
  return {
    id: input.id,
    title: m.title,
    summary: m.summary,
    authorDisplayName: m.authorDisplayName,
    authorSchool: m.authorSchool,
    tags: m.tags,
    license: LICENSE,
    provenance: m.provenance,
    lineage: m.lineage ? { ...m.lineage, available: false } : null,
    copyCount: 0,
    currentVersionId: input.versionId,
    versionNumber: input.number,
    status: 'returned',
    mine: true,
    ...(input.decision ? { moderation: input.decision } : {}),
    createdAt: input.now,
    updatedAt: input.now,
  };
}
