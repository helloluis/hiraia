/**
 * Storage for lesson presentations (27 Nov 2026), the decks module's own tables. Every statement names the owner.
 *
 *   decks_plan_links       which deck a lesson plan uses (one per plan), which day of it is the lesson's, and the
 *                          hash of the lesson as it was when its slides last matched it (staleness);
 *   decks_revisions        earlier versions of a deck, kept before AI slides are applied, a version is put back or
 *                          a copy starts over (newest 20 per deck);
 *   decks_ai_jobs          AI requests for a lesson's slides and their proposals (nothing is written into a deck
 *                          until the teacher applies one);
 *   decks_session_sources  a teacher's choice of which of her lessons is a grade's part of a multi-grade session.
 *
 * Migration decks:006 is additive: it adds three columns to decks_decks (with defaults that keep every existing row
 * a copy of a pack) and four new tables. An older release ignores them.
 */
import type { Database } from 'better-sqlite3';
import type { DeckSlide, LessonLink, SlidesAiFailure, SlidesAiScope, SlidesJob } from '@hiraia/tala-core/contracts';
import type { Migration } from '../../kernel/types';

export const lessonMigrations: Migration[] = [
  {
    id: 'decks:006_lesson_presentations',
    sql: `
ALTER TABLE decks_decks ADD COLUMN origin TEXT NOT NULL DEFAULT 'pack' CHECK (origin IN ('pack', 'lesson'));
ALTER TABLE decks_decks ADD COLUMN subject TEXT NOT NULL DEFAULT 'Science';
ALTER TABLE decks_decks ADD COLUMN source_plan_id TEXT;
CREATE TABLE decks_plan_links (
  owner_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  deck_id TEXT NOT NULL,
  -- 0: every slide of the deck is the lesson's; 1-5: that day's slides
  day INTEGER NOT NULL CHECK (day BETWEEN 0 AND 5),
  -- SHA-256 of the lesson (decks/lesson.ts lessonDigestSource) when its slides last matched it
  plan_sha256 TEXT NOT NULL,
  linked_at TEXT NOT NULL,
  matched_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, plan_id)
) STRICT;
CREATE INDEX decks_plan_links_deck ON decks_plan_links (owner_id, deck_id);
CREATE TABLE decks_revisions (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  deck_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('ai', 'restore', 'reset')),
  title TEXT NOT NULL,
  slides_json TEXT NOT NULL,
  slide_count INTEGER NOT NULL,
  deck_rev INTEGER NOT NULL,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX decks_revisions_deck ON decks_revisions (owner_id, deck_id, created_at);
CREATE TABLE decks_ai_jobs (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  deck_id TEXT,
  scope TEXT NOT NULL CHECK (scope IN ('new', 'lesson', 'slide')),
  slide_id TEXT,
  instruction TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'ready', 'failed', 'applied', 'discarded')),
  plan_sha256 TEXT,
  proposal_json TEXT,
  -- the slides the proposal replaces, as they were when it was asked for
  before_json TEXT,
  failure_json TEXT,
  created_at TEXT NOT NULL,
  finished_at TEXT
) STRICT;
CREATE INDEX decks_ai_jobs_plan ON decks_ai_jobs (owner_id, plan_id, created_at);
CREATE INDEX decks_ai_jobs_status ON decks_ai_jobs (status);
CREATE TABLE decks_session_sources (
  owner_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  source_plan_id TEXT NOT NULL,
  chosen_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, plan_id, group_id)
) STRICT;
`,
  },
];

export const REVISIONS_KEPT = 20;

interface LinkRow {
  owner_id: string;
  plan_id: string;
  deck_id: string;
  day: number;
  plan_sha256: string;
  linked_at: string;
  matched_at: string;
}
export interface StoredLink extends LessonLink {
  planSha256: string;
}
const toLink = (r: LinkRow): StoredLink => ({
  planId: r.plan_id,
  deckId: r.deck_id,
  day: r.day,
  linkedAt: r.linked_at,
  matchedAt: r.matched_at,
  planSha256: r.plan_sha256,
});

interface RevisionRow {
  id: string;
  owner_id: string;
  deck_id: string;
  reason: 'ai' | 'restore' | 'reset';
  title: string;
  slides_json: string;
  slide_count: number;
  deck_rev: number;
  created_at: string;
}

interface JobRow {
  id: string;
  owner_id: string;
  plan_id: string;
  deck_id: string | null;
  scope: SlidesAiScope;
  slide_id: string | null;
  instruction: string;
  status: SlidesJob['status'];
  plan_sha256: string | null;
  proposal_json: string | null;
  before_json: string | null;
  failure_json: string | null;
  created_at: string;
  finished_at: string | null;
}
export interface StoredJob extends SlidesJob {
  ownerId: string;
  instruction: string;
  planSha256: string | null;
  /** The slides the proposal replaces, as they were when it was asked for. */
  before: DeckSlide[] | null;
}
const toJob = (r: JobRow): StoredJob => ({
  id: r.id,
  ownerId: r.owner_id,
  planId: r.plan_id,
  deckId: r.deck_id,
  scope: r.scope,
  slideId: r.slide_id,
  status: r.status,
  createdAt: r.created_at,
  finishedAt: r.finished_at,
  proposal: r.proposal_json ? (JSON.parse(r.proposal_json) as SlidesJob['proposal']) : null,
  failure: r.failure_json ? (JSON.parse(r.failure_json) as SlidesJob['failure']) : null,
  instruction: r.instruction,
  planSha256: r.plan_sha256,
  before: r.before_json ? (JSON.parse(r.before_json) as DeckSlide[]) : null,
});
/** The job as the contract shows it (the stored extras stay on the server). */
export const publicJob = (j: StoredJob): SlidesJob => ({
  id: j.id,
  planId: j.planId,
  deckId: j.deckId,
  scope: j.scope,
  slideId: j.slideId,
  status: j.status,
  createdAt: j.createdAt,
  finishedAt: j.finishedAt,
  proposal: j.status === 'ready' ? j.proposal : null,
  failure: j.failure,
});

export function createLessonStore(db: Database) {
  return {
    /* ---- links ---- */
    link(ownerId: string, planId: string): StoredLink | null {
      const r = db.prepare('SELECT * FROM decks_plan_links WHERE owner_id = ? AND plan_id = ?').get(ownerId, planId) as LinkRow | undefined;
      return r ? toLink(r) : null;
    },
    linksOfDeck(ownerId: string, deckId: string): StoredLink[] {
      return (db.prepare('SELECT * FROM decks_plan_links WHERE owner_id = ? AND deck_id = ? ORDER BY matched_at DESC').all(ownerId, deckId) as LinkRow[]).map(toLink);
    },
    putLink(a: { ownerId: string; planId: string; deckId: string; day: number; planSha256: string; now: string }): void {
      db.prepare(
        `INSERT INTO decks_plan_links (owner_id, plan_id, deck_id, day, plan_sha256, linked_at, matched_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (owner_id, plan_id) DO UPDATE SET deck_id = excluded.deck_id, day = excluded.day, plan_sha256 = excluded.plan_sha256,
           linked_at = CASE WHEN decks_plan_links.deck_id = excluded.deck_id THEN decks_plan_links.linked_at ELSE excluded.linked_at END,
           matched_at = excluded.matched_at`
      ).run(a.ownerId, a.planId, a.deckId, a.day, a.planSha256, a.now, a.now);
    },
    /** The slides match the lesson as it is now (made or rewritten with AI, or checked by the teacher). */
    matched(ownerId: string, planId: string, planSha256: string, now: string): boolean {
      return db.prepare('UPDATE decks_plan_links SET plan_sha256 = ?, matched_at = ? WHERE owner_id = ? AND plan_id = ?').run(planSha256, now, ownerId, planId).changes === 1;
    },
    unlink(ownerId: string, planId: string): boolean {
      return db.prepare('DELETE FROM decks_plan_links WHERE owner_id = ? AND plan_id = ?').run(ownerId, planId).changes === 1;
    },

    /* ---- revisions ---- */
    addRevision(a: { id: string; ownerId: string; deckId: string; reason: RevisionRow['reason']; title: string; slides: DeckSlide[]; deckRev: number; now: string }): void {
      db.prepare(
        'INSERT INTO decks_revisions (id, owner_id, deck_id, reason, title, slides_json, slide_count, deck_rev, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(a.id, a.ownerId, a.deckId, a.reason, a.title, JSON.stringify(a.slides), a.slides.length, a.deckRev, a.now);
      // Newest first; anything past the kept number goes.
      db.prepare(
        `DELETE FROM decks_revisions WHERE owner_id = ? AND deck_id = ? AND id NOT IN (
           SELECT id FROM decks_revisions WHERE owner_id = ? AND deck_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ${REVISIONS_KEPT})`
      ).run(a.ownerId, a.deckId, a.ownerId, a.deckId);
    },
    revisions(ownerId: string, deckId: string) {
      return (
        db
          .prepare('SELECT id, reason, title, slide_count, created_at FROM decks_revisions WHERE owner_id = ? AND deck_id = ? ORDER BY created_at DESC, rowid DESC')
          .all(ownerId, deckId) as Array<Pick<RevisionRow, 'id' | 'reason' | 'title' | 'slide_count' | 'created_at'>>
      ).map((r) => ({ id: r.id, reason: r.reason, title: r.title, slideCount: r.slide_count, createdAt: r.created_at }));
    },
    revision(ownerId: string, deckId: string, id: string): { title: string; slides: DeckSlide[] } | null {
      const r = db.prepare('SELECT title, slides_json FROM decks_revisions WHERE owner_id = ? AND deck_id = ? AND id = ?').get(ownerId, deckId, id) as
        | Pick<RevisionRow, 'title' | 'slides_json'>
        | undefined;
      return r ? { title: r.title, slides: JSON.parse(r.slides_json) as DeckSlide[] } : null;
    },

    /* ---- AI jobs ---- */
    insertJob(a: { id: string; ownerId: string; planId: string; deckId: string | null; scope: SlidesAiScope; slideId: string | null; instruction: string; now: string }): void {
      db.prepare(
        `INSERT INTO decks_ai_jobs (id, owner_id, plan_id, deck_id, scope, slide_id, instruction, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?)`
      ).run(a.id, a.ownerId, a.planId, a.deckId, a.scope, a.slideId, a.instruction, a.now);
    },
    job(ownerId: string, planId: string, id: string): StoredJob | null {
      const r = db.prepare('SELECT * FROM decks_ai_jobs WHERE id = ? AND owner_id = ? AND plan_id = ?').get(id, ownerId, planId) as JobRow | undefined;
      return r ? toJob(r) : null;
    },
    jobById(id: string): StoredJob | null {
      const r = db.prepare('SELECT * FROM decks_ai_jobs WHERE id = ?').get(id) as JobRow | undefined;
      return r ? toJob(r) : null;
    },
    /** A request for this lesson still being worked on, if any (one at a time per lesson). */
    activeJob(ownerId: string, planId: string): StoredJob | null {
      const r = db
        .prepare("SELECT * FROM decks_ai_jobs WHERE owner_id = ? AND plan_id = ? AND status IN ('queued', 'running') ORDER BY created_at DESC, rowid DESC LIMIT 1")
        .get(ownerId, planId) as JobRow | undefined;
      return r ? toJob(r) : null;
    },
    /** The newest request for this lesson that is still being worked on or waits for the teacher. */
    openJob(ownerId: string, planId: string): StoredJob | null {
      const r = db
        .prepare("SELECT * FROM decks_ai_jobs WHERE owner_id = ? AND plan_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1")
        .get(ownerId, planId) as JobRow | undefined;
      const j = r ? toJob(r) : null;
      return j && (j.status === 'queued' || j.status === 'running' || j.status === 'ready' || j.status === 'failed') ? j : null;
    },
    nextQueued(): StoredJob | null {
      const r = db.prepare("SELECT * FROM decks_ai_jobs WHERE status = 'queued' ORDER BY created_at, rowid LIMIT 1").get() as JobRow | undefined;
      return r ? toJob(r) : null;
    },
    /** Move a job on. `from` guards the change (a discarded or applied job is never brought back). */
    setJob(
      id: string,
      from: SlidesJob['status'][],
      patch: { status: SlidesJob['status']; planSha256?: string | null; proposal?: SlidesJob['proposal']; before?: DeckSlide[] | null; failure?: { reason: SlidesAiFailure; message: string } | null; finishedAt?: string | null }
    ): boolean {
      const sets = ['status = ?'];
      const values: unknown[] = [patch.status];
      if (patch.planSha256 !== undefined) sets.push('plan_sha256 = ?'), values.push(patch.planSha256);
      if (patch.proposal !== undefined) sets.push('proposal_json = ?'), values.push(patch.proposal ? JSON.stringify(patch.proposal) : null);
      if (patch.before !== undefined) sets.push('before_json = ?'), values.push(patch.before ? JSON.stringify(patch.before) : null);
      if (patch.failure !== undefined) sets.push('failure_json = ?'), values.push(patch.failure ? JSON.stringify(patch.failure) : null);
      if (patch.finishedAt !== undefined) sets.push('finished_at = ?'), values.push(patch.finishedAt);
      return (
        db.prepare(`UPDATE decks_ai_jobs SET ${sets.join(', ')} WHERE id = ? AND status IN (${from.map(() => '?').join(', ')})`).run(...values, id, ...from).changes === 1
      );
    },
    /** A newer request replaces a proposal she has not looked at. */
    supersede(ownerId: string, planId: string, now: string): void {
      db.prepare("UPDATE decks_ai_jobs SET status = 'discarded', finished_at = COALESCE(finished_at, ?) WHERE owner_id = ? AND plan_id = ? AND status IN ('ready', 'failed')").run(now, ownerId, planId);
    },
    /** After a restart nothing is still running: say so, so the teacher can ask again (never retried by itself). */
    interruptRunning(now: string, message: string): number {
      return db
        .prepare("UPDATE decks_ai_jobs SET status = 'failed', failure_json = ?, finished_at = ? WHERE status IN ('queued', 'running')")
        .run(JSON.stringify({ reason: 'interrupted', message }), now).changes;
    },
    /** Finished requests are kept two days, then dropped (proposals are drafts, not records). */
    purge(before: string): number {
      return db.prepare("DELETE FROM decks_ai_jobs WHERE status NOT IN ('queued', 'running') AND created_at < ?").run(before).changes;
    },

    /* ---- session sources ---- */
    sources(ownerId: string, planId: string): Map<string, string> {
      const rows = db.prepare('SELECT group_id, source_plan_id FROM decks_session_sources WHERE owner_id = ? AND plan_id = ?').all(ownerId, planId) as Array<{
        group_id: string;
        source_plan_id: string;
      }>;
      return new Map(rows.map((r) => [r.group_id, r.source_plan_id]));
    },
    setSource(a: { ownerId: string; planId: string; groupId: string; sourcePlanId: string | null; now: string }): void {
      if (a.sourcePlanId === null) {
        db.prepare('DELETE FROM decks_session_sources WHERE owner_id = ? AND plan_id = ? AND group_id = ?').run(a.ownerId, a.planId, a.groupId);
        return;
      }
      db.prepare(
        `INSERT INTO decks_session_sources (owner_id, plan_id, group_id, source_plan_id, chosen_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (owner_id, plan_id, group_id) DO UPDATE SET source_plan_id = excluded.source_plan_id, chosen_at = excluded.chosen_at`
      ).run(a.ownerId, a.planId, a.groupId, a.sourcePlanId, a.now);
    },

    /* ---- a deck going away, an account going away or joining another ---- */
    forgetDeck(ownerId: string, deckId: string): void {
      db.prepare('DELETE FROM decks_plan_links WHERE owner_id = ? AND deck_id = ?').run(ownerId, deckId);
      db.prepare('DELETE FROM decks_revisions WHERE owner_id = ? AND deck_id = ?').run(ownerId, deckId);
      db.prepare("UPDATE decks_ai_jobs SET status = 'discarded' WHERE owner_id = ? AND deck_id = ? AND status IN ('queued', 'running', 'ready')").run(ownerId, deckId);
    },
    removeOwner(ownerId: string): void {
      for (const table of ['decks_plan_links', 'decks_revisions', 'decks_ai_jobs', 'decks_session_sources'])
        db.prepare(`DELETE FROM ${table} WHERE owner_id = ?`).run(ownerId);
    },
    moveOwner(fromOwnerId: string, toOwnerId: string): void {
      for (const table of ['decks_plan_links', 'decks_revisions', 'decks_ai_jobs', 'decks_session_sources']) {
        db.prepare(`UPDATE OR IGNORE ${table} SET owner_id = ? WHERE owner_id = ?`).run(toOwnerId, fromOwnerId);
        db.prepare(`DELETE FROM ${table} WHERE owner_id = ?`).run(fromOwnerId);
      }
    },
  };
}

export type LessonStore = ReturnType<typeof createLessonStore>;
