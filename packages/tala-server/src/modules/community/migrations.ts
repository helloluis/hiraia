import type { Migration } from '../../kernel/types';

/**
 * Community tables (PRD §11). Never edit a shipped migration; add a new one at the end.
 *
 * Content lives only in `community_versions.content_json` (the stripped, public snapshot). Logs and reports
 * hold no lesson text. A post returned to its author at posting time stores nothing but a log row.
 */
export const communityMigrations: Migration[] = [
  {
    id: 'community:001_init',
    sql: `
CREATE TABLE community_artifacts (
  id TEXT PRIMARY KEY,
  author_id TEXT NOT NULL,
  source_plan_id TEXT NOT NULL,
  current_version_id TEXT NOT NULL,
  -- visible | pending_check | returned | hidden | removed
  status TEXT NOT NULL,
  -- why it is hidden: 'report' (personal-data report while the check runs) | 'staff'
  hidden_by TEXT,
  copy_count INTEGER NOT NULL DEFAULT 0,
  -- Mirrors of the current version's metadata, for search and summaries.
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  author_display_name TEXT NOT NULL,
  author_school TEXT,
  tags_json TEXT NOT NULL,
  language TEXT NOT NULL,
  learning_area_id TEXT,
  subject_name TEXT NOT NULL,
  term_index INTEGER,
  duration_minutes INTEGER NOT NULL,
  region TEXT,
  multigrade TEXT,
  competency_count INTEGER NOT NULL,
  ai_drafted INTEGER NOT NULL,
  adapted INTEGER NOT NULL,
  lineage_artifact_id TEXT,
  lineage_version_id TEXT,
  lineage_title TEXT,
  lineage_author TEXT,
  -- Latest moderation decision (reasons + excerpts of the author's own text). Shown to the author only.
  last_decision_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  removed_at TEXT
);
CREATE INDEX community_artifacts_status ON community_artifacts (status, copy_count DESC);
CREATE INDEX community_artifacts_author ON community_artifacts (author_id, source_plan_id);

-- Grade and competency tags, one row each, so search can filter without scanning JSON.
CREATE TABLE community_artifact_terms (
  artifact_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (artifact_id, kind, value)
);
CREATE INDEX community_artifact_terms_value ON community_artifact_terms (kind, value);

-- Immutable snapshots. Only status changes after insert.
CREATE TABLE community_versions (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL,
  number INTEGER NOT NULL,
  -- allowed | pending | returned
  status TEXT NOT NULL,
  plan_revision INTEGER,
  revision_code TEXT,
  -- ArtifactVersion fields: templateId, gradeGroups, competencies, customObjectives, sections
  content_json TEXT NOT NULL,
  -- title, summary, authorDisplayName, authorSchool, tags, provenance, lineage at posting time
  meta_json TEXT NOT NULL,
  pending_attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (artifact_id, number)
);
CREATE INDEX community_versions_status ON community_versions (status, created_at);

-- Remix tree: which version each version was adapted from.
CREATE TABLE community_lineage (
  version_id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL,
  source_artifact_id TEXT NOT NULL,
  source_version_id TEXT NOT NULL
);
CREATE INDEX community_lineage_source ON community_lineage (source_artifact_id);

-- One row per (artifact, copier): copy_count counts distinct teachers, never the author.
CREATE TABLE community_copies (
  artifact_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (artifact_id, user_id)
);

-- Reports are flags, never shown publicly. The note is kept only for the model check and staff escalation.
CREATE TABLE community_reports (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  reporter_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  note TEXT NOT NULL,
  -- pending | done | skipped
  check_status TEXT NOT NULL,
  outcome TEXT,
  created_at TEXT NOT NULL,
  checked_at TEXT
);
CREATE INDEX community_reports_pending ON community_reports (check_status, created_at);
CREATE INDEX community_reports_reporter ON community_reports (reporter_id, artifact_id);

-- Every moderation decision (PRD §11.6 step 5). Categories and rule kinds only; never content.
CREATE TABLE community_moderation_log (
  id TEXT PRIMARY KEY,
  artifact_id TEXT,
  version_id TEXT,
  author_id TEXT,
  -- post | recheck | report | staff
  trigger TEXT NOT NULL,
  -- allow | return | pending | takedown | restore
  decision TEXT NOT NULL,
  categories TEXT NOT NULL,
  rule_kinds TEXT NOT NULL,
  guideline_version INTEGER NOT NULL,
  provider TEXT NOT NULL,
  model TEXT,
  prompt_version INTEGER,
  llm_outcome TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX community_moderation_log_artifact ON community_moderation_log (artifact_id, created_at);
`,
  },
];
