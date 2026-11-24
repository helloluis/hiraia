/**
 * "My own slides": a teacher uploads her PowerPoint file and edits it in Tala (contracts/deck-uploads.ts).
 *
 * - The uploaded file is stored exactly as it arrived and is never changed. Edits are a small list of differences
 *   beside it; the edited download is produced from the two each time (upload-file.ts), so the original can always
 *   be had back, bit for bit.
 * - Private to its owner. Every statement that reads or writes an upload, a session, a piece or a picture names
 *   the owner; someone else's id answers `not_found`, exactly like an id that does not exist. No sharing.
 * - The file is untrusted input. It is checked before it is read (extension, size, account allowance, SHA-256,
 *   archive limits), read by the strict reader in @hiraia/tala-core/pptx (no DTDs, no macros, hard limits), and
 *   never executed, converted in place or followed to anything outside itself. Refusals are plain and specific.
 * - The file arrives in pieces (JSON + base64, like every other request), so a dropped connection resumes.
 * File names, slide text and notes are never logged.
 */
import { UPLOAD_LIMITS } from '@hiraia/tala-core/contracts';
import type { UploadedDeck, UploadedDeckSummary, UploadRefusalReason, UploadSlideEdit } from '@hiraia/tala-core/contracts';
import { changedSlideCount, invalidEdits, noEdits, normaliseEdits, type DeckEdits, type DeckInspection } from '@hiraia/tala-core/pptx';
import type { Database } from 'better-sqlite3';
import { HttpError, requireUser, type BaseDeps, type Migration, type ServerModule } from '../../kernel/types';
import { readUploadedDeck, sha256Hex, UploadRefused, writeEditedDeck } from './upload-file';
import { RenderError, rendererFromEnv, retiredRenderSettings, type DeckRenderer } from './upload-render';

export interface UploadOptions {
  /** Largest file taken, in bytes (never above the contract's limit). Default: `TALA_DECK_UPLOAD_MAX_BYTES` or the contract's. */
  maxFileBytes?: number;
  /** Total an account may keep. Default: `TALA_DECK_UPLOAD_ACCOUNT_BYTES` or the contract's. */
  maxAccountBytes?: number;
  maxUploads?: number;
  /** Draws pictures of slides. null = none. Default: from the environment (none unless the sandboxed drawing service is configured). */
  renderer?: DeckRenderer | null;
  /** After the drawing service turned out to be missing or unusable: how long before it is asked again, ms. */
  renderRetryMs?: number;
  /** How long a request waits for a drawing before it answers "busy" and lets the drawing finish on its own, ms. */
  renderWaitMs?: number;
  /** Drawing time one account may use in ten minutes, ms: the server draws one file at a time for everybody. */
  drawMsPerTenMinutes?: number;
  /** How long an unfinished upload is kept, minutes. */
  sessionMinutes?: number;
  /** Uploads one account may start per hour. */
  startsPerHour?: number;
  /** Times one account may have its slides drawn in ten minutes (the editor redraws after a save). */
  rendersPerTenMinutes?: number;
}

export const uploadsMigrations: Migration[] = [
  {
    id: 'decks:002_uploads',
    sql: `
CREATE TABLE decks_uploads (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  title TEXT NOT NULL,
  file_name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('presentation', 'template', 'slideshow')),
  -- the uploaded file, by the SHA-256 of its bytes; never changed
  original_sha256 TEXT NOT NULL,
  original_bytes INTEGER NOT NULL,
  -- what the file holds, as read at upload; never changed by a save
  base_json TEXT NOT NULL,
  -- the teacher's version, as differences from the file
  edits_json TEXT NOT NULL,
  slide_count INTEGER NOT NULL,
  changed_slides INTEGER NOT NULL,
  rev INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX decks_uploads_owner ON decks_uploads (owner_id, updated_at);
CREATE TABLE decks_upload_files (
  sha256 TEXT PRIMARY KEY,
  bytes BLOB NOT NULL,
  size INTEGER NOT NULL
) STRICT;
CREATE TABLE decks_upload_sessions (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  chunk_bytes INTEGER NOT NULL,
  chunk_count INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
) STRICT;
CREATE INDEX decks_upload_sessions_owner ON decks_upload_sessions (owner_id);
CREATE TABLE decks_upload_chunks (
  session_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  bytes BLOB NOT NULL,
  PRIMARY KEY (session_id, idx)
) STRICT;
CREATE TABLE decks_upload_previews (
  upload_id TEXT NOT NULL,
  slide_id TEXT NOT NULL,
  -- the saved version these pictures show
  rev INTEGER NOT NULL,
  bytes BLOB NOT NULL,
  PRIMARY KEY (upload_id, slide_id)
) STRICT;
`,
  },
];

interface UploadRow {
  id: string;
  owner_id: string;
  title: string;
  file_name: string;
  kind: 'presentation' | 'template' | 'slideshow';
  original_sha256: string;
  original_bytes: number;
  base_json: string;
  edits_json: string;
  slide_count: number;
  changed_slides: number;
  rev: number;
  created_at: string;
  updated_at: string;
}
interface SessionRow {
  id: string;
  owner_id: string;
  file_name: string;
  bytes: number;
  sha256: string;
  chunk_bytes: number;
  chunk_count: number;
  created_at: string;
  expires_at: string;
}

const MESSAGES = {
  notFound: 'We could not find these slides.',
  sessionGone: 'This upload has expired. Please choose the file again.',
  verify: 'Verify your email before uploading slides.',
  tooMany: 'You have started many uploads. Please wait a while and try again.',
  quota: 'There is not enough space left for your own slides, or you have reached the limit on the number of files. Delete a file you no longer need, then try again.',
  tooLarge: 'This file, or something inside it, is larger than the limit here.',
  incomplete: 'Part of the file has not arrived yet. Please continue the upload.',
  badPiece: 'A part of the file did not arrive correctly. Please try again.',
  conflict: 'These slides were changed somewhere else after you opened them.',
  cannotApply: 'These changes do not fit the file. Reload the slides and try again.',
  cannotBuild: 'We could not prepare this download. Please try again later.',
  noPicture: 'There is no picture of this slide yet.',
} as const;

/** Plain words for every reason a file is not taken (English; the web app has its own in both languages). */
export const REFUSAL_MESSAGES: Record<UploadRefusalReason | 'invalid_edit', string> = {
  not_a_zip: 'This file looks damaged, or it is not a PowerPoint file.',
  old_powerpoint: 'This is an older PowerPoint (.ppt) file. Open it in PowerPoint and save it as .pptx, then upload that.',
  password_protected: 'This file is protected with a password. Remove the password, then upload it.',
  pdf: 'This is a PDF. Choose a PowerPoint file (.pptx, .potx or .ppsx).',
  empty: 'This file is empty.',
  zip_bomb: 'This file unpacks to far more than a slide deck should, so it was not opened.',
  not_a_presentation: 'This is not a PowerPoint file.',
  wrong_office_file: 'This is a Word or Excel file. Choose a PowerPoint file (.pptx, .potx or .ppsx).',
  macros: 'This file contains macros. Save it as a normal .pptx without macros, then upload that.',
  active_content: 'This file contains ActiveX controls, which Tala does not accept.',
  strict_ooxml: 'This file was saved as "Strict Open XML". Save it as "PowerPoint Presentation (.pptx)", then upload that.',
  signed: 'This file is digitally signed. A signed file cannot be edited without breaking its signature.',
  unsafe_part_name: 'This file is put together in an unsafe way, so it was not opened.',
  damaged: 'This file is damaged and could not be read.',
  too_many_parts: 'This file has too many parts to open here.',
  too_many_slides: 'This file has too many slides to edit here.',
  too_large: MESSAGES.tooLarge,
  no_slides: 'This file has no slides.',
  unreadable_text: 'This file stores its text in a way Tala cannot read.',
  wrong_extension: 'Choose a PowerPoint file: .pptx, .potx or .ppsx.',
  checksum_mismatch: 'The file did not arrive whole. Please upload it again.',
  quota: MESSAGES.quota,
  invalid_edit: MESSAGES.cannotApply,
};

const refuse = (reason: UploadRefusalReason) => new HttpError(reason === 'quota' ? 'quota_exceeded' : 'invalid_input', REFUSAL_MESSAGES[reason], { reason });
const notFound = () => new HttpError('not_found', MESSAGES.notFound, { reason: 'upload_not_found' });
const sessionGone = () => new HttpError('not_found', MESSAGES.sessionGone, { reason: 'upload_session_not_found' });

const CONTENT_TYPES = {
  presentation: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  template: 'application/vnd.openxmlformats-officedocument.presentationml.template',
  slideshow: 'application/vnd.openxmlformats-officedocument.presentationml.slideshow',
} as const;

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();
const fromBlob = (b: Buffer) => new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
const toBlob = (b: Uint8Array) => Buffer.from(b.buffer, b.byteOffset, b.byteLength);

/** What kind of file a name claims to be. The content is checked separately; this only stops obvious mistakes early. */
function extensionProblem(fileName: string): UploadRefusalReason | null {
  const ext = /\.([A-Za-z0-9]{1,8})$/.exec(fileName)?.[1]?.toLowerCase() ?? '';
  if (ext === 'pptx' || ext === 'potx' || ext === 'ppsx') return null;
  if (ext === 'pptm' || ext === 'potm' || ext === 'ppsm' || ext === 'ppam') return 'macros';
  if (ext === 'ppt' || ext === 'pot' || ext === 'pps') return 'old_powerpoint';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'docx' || ext === 'xlsx' || ext === 'doc' || ext === 'xls') return 'wrong_office_file';
  return 'wrong_extension';
}

function envNumber(name: string, fallback: number, max: number): number {
  const raw = process.env[name];
  const n = raw && /^\d{1,12}$/.test(raw) ? Number(raw) : fallback;
  return Math.max(1, Math.min(n, max));
}

export function createUploads(options: UploadOptions = {}): Pick<ServerModule, 'migrations' | 'handlers' | 'onAccountDeleted' | 'onAccountMerged' | 'start'> {
  const maxFileBytes = Math.min(options.maxFileBytes ?? envNumber('TALA_DECK_UPLOAD_MAX_BYTES', UPLOAD_LIMITS.fileBytes, UPLOAD_LIMITS.fileBytes), UPLOAD_LIMITS.fileBytes);
  const maxAccountBytes = options.maxAccountBytes ?? envNumber('TALA_DECK_UPLOAD_ACCOUNT_BYTES', UPLOAD_LIMITS.bytesPerAccount, 100 * UPLOAD_LIMITS.bytesPerAccount);
  const maxUploads = options.maxUploads ?? UPLOAD_LIMITS.uploadsPerAccount;
  const sessionMinutes = options.sessionMinutes ?? 24 * 60;
  const startsPerHour = options.startsPerHour ?? 20;
  const rendersPerTenMinutes = options.rendersPerTenMinutes ?? 60;
  const renderer = options.renderer === undefined ? rendererFromEnv() : options.renderer;
  const renderRetryMs = options.renderRetryMs ?? 30_000;
  const renderWaitMs = options.renderWaitMs ?? 20_000;
  const drawMsPerTenMinutes = options.drawMsPerTenMinutes ?? 180_000;
  /** How long each account's drawings took in the last ten minutes. A few slow decks must not keep the one drawing place from everybody else. */
  const drawn = new Map<string, Array<{ at: number; ms: number }>>();
  const drawnMs = (userId: string, now: number): number => {
    const recent = (drawn.get(userId) ?? []).filter((d) => now - d.at < 600_000);
    if (recent.length) drawn.set(userId, recent);
    else drawn.delete(userId);
    return recent.reduce((sum, d) => sum + d.ms, 0);
  };
  let rendering = false;
  /** Until when this server says it draws no pictures, because the drawing service was missing or unusable. */
  let noPicturesUntil = 0;
  const draws = () => renderer !== null && Date.now() >= noPicturesUntil;

  /* ---------------- rows ---------------- */
  const getRow = (db: Database, ownerId: string, id: string): UploadRow | null =>
    (db.prepare('SELECT * FROM decks_uploads WHERE id = ? AND owner_id = ?').get(id, ownerId) as UploadRow | undefined) ?? null;
  const getSession = (db: Database, ownerId: string, id: string, now: string): SessionRow | null =>
    (db.prepare('SELECT * FROM decks_upload_sessions WHERE id = ? AND owner_id = ? AND expires_at > ?').get(id, ownerId, now) as SessionRow | undefined) ?? null;
  const receivedOf = (db: Database, sessionId: string): number[] =>
    (db.prepare('SELECT idx FROM decks_upload_chunks WHERE session_id = ? ORDER BY idx').all(sessionId) as Array<{ idx: number }>).map((r) => r.idx);
  const usage = (db: Database, ownerId: string): { bytes: number; uploads: number } =>
    db.prepare('SELECT COALESCE(SUM(original_bytes), 0) AS bytes, COUNT(*) AS uploads FROM decks_uploads WHERE owner_id = ?').get(ownerId) as { bytes: number; uploads: number };
  const dropSession = (db: Database, sessionId: string) => {
    db.prepare('DELETE FROM decks_upload_chunks WHERE session_id = ?').run(sessionId);
    db.prepare('DELETE FROM decks_upload_sessions WHERE id = ?').run(sessionId);
  };
  const purgeSessions = (db: Database, now: string) => {
    const expired = db.prepare('SELECT id FROM decks_upload_sessions WHERE expires_at <= ?').all(now) as Array<{ id: string }>;
    for (const s of expired) dropSession(db, s.id);
  };
  /** Stored files no upload refers to any more. */
  const sweepFiles = (db: Database) => db.prepare('DELETE FROM decks_upload_files WHERE sha256 NOT IN (SELECT original_sha256 FROM decks_uploads)').run();
  const fileOf = (db: Database, sha256: string): Uint8Array | null => {
    const row = db.prepare('SELECT bytes FROM decks_upload_files WHERE sha256 = ?').get(sha256) as { bytes: Buffer } | undefined;
    return row ? fromBlob(row.bytes) : null;
  };
  /** Which slides have a stored picture (in deck order) and the saved version those pictures show. */
  const previewInfo = (db: Database, row: Pick<UploadRow, 'id' | 'edits_json'>): { rev: number | null; slideIds: string[] } => {
    const rows = db.prepare('SELECT slide_id, rev FROM decks_upload_previews WHERE upload_id = ?').all(row.id) as Array<{ slide_id: string; rev: number }>;
    if (!rows.length) return { rev: null, slideIds: [] };
    const have = new Set(rows.map((r) => r.slide_id));
    const order = (JSON.parse(row.edits_json) as DeckEdits).slides.map((s) => s.id);
    return { rev: Math.min(...rows.map((r) => r.rev)), slideIds: [...order.filter((id) => have.has(id)), ...rows.map((r) => r.slide_id).filter((id) => !order.includes(id))] };
  };

  const summary = (row: UploadRow): UploadedDeckSummary => ({
    id: row.id,
    title: row.title,
    fileName: row.file_name,
    kind: row.kind,
    slideCount: row.slide_count,
    changedSlides: row.changed_slides,
    bytes: row.original_bytes,
    rev: row.rev,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
  const detail = (db: Database, row: UploadRow): UploadedDeck => {
    const base = JSON.parse(row.base_json) as Pick<DeckInspection, 'size' | 'slides' | 'features' | 'totals'>;
    return {
      ...summary(row),
      originalSha256: row.original_sha256,
      size: base.size,
      base: { slides: base.slides, features: base.features, totals: base.totals },
      edits: JSON.parse(row.edits_json) as { slides: UploadSlideEdit[] },
      previews: { available: draws(), ...previewInfo(db, row) },
    };
  };
  /** A download name from words a teacher chose: letters, digits and single dashes (the kernel allows nothing else through). */
  const safeFileName = (name: string, fallback: string) =>
    oneLine(name)
      .normalize('NFKD')
      .replace(/[^A-Za-z0-9.]+/g, '-')
      .replace(/^[-.]+|[-.]+$/g, '')
      .slice(0, 100) || fallback;

  return {
    migrations: uploadsMigrations,
    handlers: {
      'decks.uploads.list': (ctx) => {
        const user = requireUser(ctx);
        const rows = ctx.db.prepare('SELECT * FROM decks_uploads WHERE owner_id = ? ORDER BY updated_at DESC, rowid DESC').all(user.id) as UploadRow[];
        const used = usage(ctx.db, user.id);
        return {
          decks: rows.map(summary),
          allowance: { fileBytes: maxFileBytes, remainingBytes: Math.max(0, maxAccountBytes - used.bytes), remainingUploads: Math.max(0, maxUploads - used.uploads) },
        };
      },

      'decks.uploads.begin': (ctx, { body }) => {
        const user = requireUser(ctx);
        if (!user.emailVerified) throw new HttpError('forbidden', MESSAGES.verify, { reason: 'email_not_verified' });
        const fileName = oneLine(body.fileName).slice(0, UPLOAD_LIMITS.fileName);
        const wrong = extensionProblem(fileName);
        if (wrong) throw refuse(wrong);
        if (body.bytes > maxFileBytes) throw new HttpError('invalid_input', MESSAGES.tooLarge, { reason: 'too_large', maxBytes: maxFileBytes });
        const now = ctx.now();
        const nowIso = now.toISOString();
        purgeSessions(ctx.db, nowIso);
        const used = usage(ctx.db, user.id);
        if (used.uploads >= maxUploads || used.bytes + body.bytes > maxAccountBytes) throw refuse('quota');
        // The same file again (a page reload, a dropped connection): carry on where it stopped.
        const open = ctx.db
          .prepare('SELECT * FROM decks_upload_sessions WHERE owner_id = ? AND sha256 = ? AND bytes = ? AND expires_at > ? ORDER BY created_at DESC LIMIT 1')
          .get(user.id, body.sha256, body.bytes, nowIso) as SessionRow | undefined;
        if (open) return { sessionId: open.id, chunkBytes: open.chunk_bytes, chunkCount: open.chunk_count, received: receivedOf(ctx.db, open.id), expiresAt: open.expires_at };
        if (!ctx.services.rateLimit.take(`deck-upload:${user.id}`, startsPerHour, 3600)) throw new HttpError('rate_limited', MESSAGES.tooMany, { retryAfterSeconds: 600 });
        // A few unfinished uploads at most: the oldest make room.
        const mine = ctx.db.prepare('SELECT id FROM decks_upload_sessions WHERE owner_id = ? ORDER BY created_at DESC').all(user.id) as Array<{ id: string }>;
        for (const old of mine.slice(2)) dropSession(ctx.db, old.id);
        const id = ctx.newId();
        const chunkBytes = UPLOAD_LIMITS.chunkBytes;
        const chunkCount = Math.ceil(body.bytes / chunkBytes);
        const expiresAt = new Date(now.getTime() + sessionMinutes * 60_000).toISOString();
        ctx.db
          .prepare('INSERT INTO decks_upload_sessions (id, owner_id, file_name, bytes, sha256, chunk_bytes, chunk_count, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(id, user.id, fileName, body.bytes, body.sha256, chunkBytes, chunkCount, nowIso, expiresAt);
        return { sessionId: id, chunkBytes, chunkCount, received: [], expiresAt };
      },

      'decks.uploads.chunk': (ctx, { params, body }) => {
        const user = requireUser(ctx);
        const session = getSession(ctx.db, user.id, params.sessionId, ctx.now().toISOString());
        if (!session) throw sessionGone();
        if (!/^\d{1,6}$/.test(params.index)) throw new HttpError('invalid_input', MESSAGES.badPiece, { reason: 'bad_chunk' });
        const index = Number(params.index);
        if (index >= session.chunk_count || !/^[A-Za-z0-9+/]+={0,2}$/.test(body.data)) throw new HttpError('invalid_input', MESSAGES.badPiece, { reason: 'bad_chunk' });
        const piece = Buffer.from(body.data, 'base64');
        const expected = index === session.chunk_count - 1 ? session.bytes - session.chunk_bytes * (session.chunk_count - 1) : session.chunk_bytes;
        if (piece.length !== expected) throw new HttpError('invalid_input', MESSAGES.badPiece, { reason: 'bad_chunk' });
        ctx.db.prepare('INSERT OR REPLACE INTO decks_upload_chunks (session_id, idx, bytes) VALUES (?, ?, ?)').run(session.id, index, piece);
        const received = (ctx.db.prepare('SELECT COUNT(*) AS n FROM decks_upload_chunks WHERE session_id = ?').get(session.id) as { n: number }).n;
        return { received, complete: received === session.chunk_count };
      },

      'decks.uploads.finish': (ctx, { params }) => {
        const user = requireUser(ctx);
        const nowIso = ctx.now().toISOString();
        const session = getSession(ctx.db, user.id, params.sessionId, nowIso);
        if (!session) throw sessionGone();
        const pieces = ctx.db.prepare('SELECT idx, bytes FROM decks_upload_chunks WHERE session_id = ? ORDER BY idx').all(session.id) as Array<{ idx: number; bytes: Buffer }>;
        if (pieces.length !== session.chunk_count || pieces.some((p, i) => p.idx !== i))
          throw new HttpError('conflict', MESSAGES.incomplete, { reason: 'upload_incomplete', received: pieces.map((p) => p.idx) });
        // One copy of the file in memory, not two: the joined pieces are used as they are.
        const file = fromBlob(Buffer.concat(pieces.map((p) => p.bytes)));
        const fail = (reason: UploadRefusalReason): never => {
          // A file that was refused is not kept in any form.
          dropSession(ctx.db, session.id);
          ctx.log.info('deck_upload_refused', { reason, bytes: session.bytes });
          throw refuse(reason);
        };
        if (file.length !== session.bytes || sha256Hex(file) !== session.sha256) fail('checksum_mismatch');
        const used = usage(ctx.db, user.id);
        if (used.uploads >= maxUploads || used.bytes + file.length > maxAccountBytes) fail('quota');
        let inspection: DeckInspection;
        try {
          inspection = readUploadedDeck(file);
        } catch (err) {
          if (!(err instanceof UploadRefused)) throw err;
          return fail(err.reason as UploadRefusalReason);
        }
        const id = ctx.newId();
        const base = { size: inspection.size, slides: inspection.slides, features: inspection.features, totals: inspection.totals };
        const edits = noEdits(inspection);
        const title = (inspection.title || session.file_name.replace(/\.[A-Za-z0-9]{1,8}$/, '')).slice(0, UPLOAD_LIMITS.title);
        ctx.db.transaction(() => {
          ctx.db.prepare('INSERT OR IGNORE INTO decks_upload_files (sha256, bytes, size) VALUES (?, ?, ?)').run(session.sha256, toBlob(file), file.length);
          ctx.db
            .prepare(
              `INSERT INTO decks_uploads (id, owner_id, title, file_name, kind, original_sha256, original_bytes, base_json, edits_json, slide_count, changed_slides, rev, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?)`
            )
            .run(id, user.id, title, session.file_name, inspection.kind, session.sha256, file.length, JSON.stringify(base), JSON.stringify(edits), inspection.slides.length, nowIso, nowIso);
          dropSession(ctx.db, session.id);
        })();
        ctx.log.info('deck_uploaded', { uploadId: id, bytes: file.length, slides: inspection.slides.length, kind: inspection.kind });
        return detail(ctx.db, getRow(ctx.db, user.id, id)!);
      },

      'decks.uploads.cancel': (ctx, { params }) => {
        const user = requireUser(ctx);
        const session = getSession(ctx.db, user.id, params.sessionId, ctx.now().toISOString());
        if (!session) throw sessionGone();
        dropSession(ctx.db, session.id);
        return { ok: true as const };
      },

      'decks.uploads.get': (ctx, { params }) => {
        const row = getRow(ctx.db, requireUser(ctx).id, params.uploadId);
        if (!row) throw notFound();
        return detail(ctx.db, row);
      },

      'decks.uploads.save': (ctx, { params, body }) => {
        const user = requireUser(ctx);
        const row = getRow(ctx.db, user.id, params.uploadId);
        if (!row) throw notFound();
        const stale = () => new HttpError('conflict', MESSAGES.conflict, { reason: 'deck_changed_elsewhere', rev: row.rev, updatedAt: row.updated_at });
        if (!body.force && body.baseRev !== row.rev) throw stale();
        const base = JSON.parse(row.base_json) as Pick<DeckInspection, 'slides'>;
        const wanted: DeckEdits = { slides: body.slides };
        const problem = invalidEdits(base, wanted);
        if (problem) throw new HttpError('invalid_input', MESSAGES.cannotApply, { reason: problem });
        const edits = normaliseEdits(base, wanted);
        const title = (body.title !== undefined && oneLine(body.title)) || row.title;
        const changed = changedSlideCount(edits);
        const rev = row.rev + 1;
        const now = ctx.now().toISOString();
        const sql = 'UPDATE decks_uploads SET title = ?, edits_json = ?, slide_count = ?, changed_slides = ?, rev = ?, updated_at = ? WHERE id = ? AND owner_id = ?';
        const values = [title, JSON.stringify(edits), edits.slides.length, changed, rev, now, row.id, user.id];
        const done = body.force ? ctx.db.prepare(sql).run(...values) : ctx.db.prepare(`${sql} AND rev = ?`).run(...values, row.rev);
        if (done.changes !== 1) throw stale();
        return { rev, updatedAt: now, changedSlides: changed, slideCount: edits.slides.length };
      },

      'decks.uploads.delete': (ctx, { params }) => {
        const user = requireUser(ctx);
        const removed = ctx.db.transaction(() => {
          const done = ctx.db.prepare('DELETE FROM decks_uploads WHERE id = ? AND owner_id = ?').run(params.uploadId, user.id).changes === 1;
          if (done) {
            ctx.db.prepare('DELETE FROM decks_upload_previews WHERE upload_id = ?').run(params.uploadId);
            sweepFiles(ctx.db);
          }
          return done;
        })();
        if (!removed) throw notFound();
        ctx.log.info('deck_upload_deleted', { uploadId: params.uploadId });
        return { ok: true as const };
      },

      /** The file exactly as it was uploaded: the same bytes, the same SHA-256. */
      'decks.uploads.original': (ctx, { params }) => {
        const row = getRow(ctx.db, requireUser(ctx).id, params.uploadId);
        const file = row ? fileOf(ctx.db, row.original_sha256) : null;
        if (!row || !file) throw notFound();
        return { binary: file, contentType: CONTENT_TYPES[row.kind], filename: safeFileName(row.file_name, 'slides.pptx') };
      },

      /** The uploaded file with the saved changes written in. Always a .pptx that opens for editing. */
      'decks.uploads.pptx': (ctx, { params }) => {
        const row = getRow(ctx.db, requireUser(ctx).id, params.uploadId);
        const file = row ? fileOf(ctx.db, row.original_sha256) : null;
        if (!row || !file) throw notFound();
        try {
          const { pptx } = writeEditedDeck(file, JSON.parse(row.edits_json) as DeckEdits);
          return { binary: pptx, contentType: CONTENT_TYPES.presentation, filename: `${safeFileName(row.title, 'slides').replace(/\.(pptx|potx|ppsx)$/i, '')}-tala.pptx` };
        } catch (err) {
          ctx.log.error('deck_upload_export_failed', { uploadId: row.id, reason: err instanceof UploadRefused ? err.reason : 'error' });
          throw new HttpError('unavailable', MESSAGES.cannotBuild, { reason: 'export_failed' });
        }
      },

      'decks.uploads.render': async (ctx, { params }) => {
        const user = requireUser(ctx);
        const row = getRow(ctx.db, user.id, params.uploadId);
        if (!row) throw notFound();
        const current = previewInfo(ctx.db, row);
        const edits = JSON.parse(row.edits_json) as DeckEdits;
        if (current.rev === row.rev && current.slideIds.length === edits.slides.length) return { state: 'ready' as const, ...current };
        // No drawing service, or one that was just found missing or unusable: the editor works without pictures.
        if (!renderer || !draws()) return { state: 'unavailable' as const, ...current };
        // One drawing at a time on this server, and two ceilings per teacher (how many, and how long they took):
        // drawing is the costly part of this module.
        const startedAt = Date.now();
        if (rendering || drawnMs(user.id, startedAt) >= drawMsPerTenMinutes || !ctx.services.rateLimit.take(`deck-render:${user.id}`, rendersPerTenMinutes, 600)) return { state: 'busy' as const, ...current };
        const file = fileOf(ctx.db, row.original_sha256);
        if (!file) throw notFound();
        rendering = true;
        const { db, log } = ctx;
        const drawing = (async () => {
          try {
            const { pptx } = writeEditedDeck(file, edits);
            const pictures = await renderer.render(pptx, edits.slides.length);
            if (pictures.length !== edits.slides.length) throw new RenderError('failed', 'page count');
            db.transaction(() => {
              // Only if the upload is still this account's and still at the version that was drawn.
              const still = getRow(db, user.id, row.id);
              if (!still || still.rev !== row.rev) return;
              db.prepare('DELETE FROM decks_upload_previews WHERE upload_id = ?').run(row.id);
              const insert = db.prepare('INSERT INTO decks_upload_previews (upload_id, slide_id, rev, bytes) VALUES (?, ?, ?, ?)');
              edits.slides.forEach((s, i) => insert.run(row.id, s.id, row.rev, toBlob(pictures[i]!)));
            })();
            return { state: 'ready' as const, ...previewInfo(db, row) };
          } catch (err) {
            // The reason is one of the renderer's own short phrases, never text from the file.
            const kind = err instanceof RenderError ? err.kind : 'failed';
            const reason = err instanceof RenderError ? err.reason : 'error';
            if (kind === 'unavailable') {
              // Nothing is drawn another way. The server says so for a while instead of trying on every request.
              noPicturesUntil = Date.now() + renderRetryMs;
              log.error('deck_upload_render_unavailable', { uploadId: row.id, reason });
              return { state: 'unavailable' as const, ...current };
            }
            log.warn('deck_upload_render_failed', { uploadId: row.id, kind, reason });
            return { state: kind === 'busy' ? ('busy' as const) : ('failed' as const), ...current };
          } finally {
            rendering = false;
            drawn.set(user.id, [...(drawn.get(user.id) ?? []), { at: Date.now(), ms: Date.now() - startedAt }]);
          }
        })();
        // A large deck can take longer to draw than a request should stay open. Past this point the editor is told
        // "busy" and asks again; the drawing carries on, and its pictures are there when it does.
        let waitTimer: ReturnType<typeof setTimeout> | undefined;
        const waitedLongEnough = new Promise<{ state: 'busy'; rev: number | null; slideIds: string[] }>((resolve) => {
          waitTimer = setTimeout(() => resolve({ state: 'busy' as const, ...current }), renderWaitMs);
        });
        try {
          return await Promise.race([drawing, waitedLongEnough]);
        } finally {
          clearTimeout(waitTimer);
        }
      },

      'decks.uploads.preview': (ctx, { params }) => {
        const row = getRow(ctx.db, requireUser(ctx).id, params.uploadId);
        if (!row) throw notFound();
        const picture = ctx.db.prepare('SELECT bytes FROM decks_upload_previews WHERE upload_id = ? AND slide_id = ?').get(row.id, params.slideId) as { bytes: Buffer } | undefined;
        if (!picture) throw new HttpError('not_found', MESSAGES.noPicture, { reason: 'preview_not_found' });
        return { binary: fromBlob(picture.bytes), contentType: 'image/jpeg', cacheControl: 'private, max-age=3600' };
      },
    },

    /** A deleted account takes its uploads, unfinished uploads and pictures with it (PRIV-6). */
    onAccountDeleted: (deps: BaseDeps, userId) => {
      const ids = deps.db.prepare('SELECT id FROM decks_uploads WHERE owner_id = ?').all(userId) as Array<{ id: string }>;
      for (const { id } of ids) deps.db.prepare('DELETE FROM decks_upload_previews WHERE upload_id = ?').run(id);
      deps.db.prepare('DELETE FROM decks_uploads WHERE owner_id = ?').run(userId);
      const sessions = deps.db.prepare('SELECT id FROM decks_upload_sessions WHERE owner_id = ?').all(userId) as Array<{ id: string }>;
      for (const s of sessions) dropSession(deps.db, s.id);
      sweepFiles(deps.db);
    },
    /** Two accounts of one teacher joined: the uploads follow. */
    onAccountMerged: (deps: BaseDeps, fromUserId, toUserId) => {
      deps.db.prepare('UPDATE decks_uploads SET owner_id = ? WHERE owner_id = ?').run(toUserId, fromUserId);
      deps.db.prepare('UPDATE decks_upload_sessions SET owner_id = ? WHERE owner_id = ?').run(toUserId, fromUserId);
    },
    /** Unfinished uploads do not linger. */
    start: (deps) => {
      // Settings of the earlier drawing, which ran LibreOffice from this process: they do nothing any more.
      const retired = retiredRenderSettings();
      if (retired.length) deps.log.warn('deck_upload_render_settings_ignored', { names: retired.join(','), use: 'TALA_DECKS_PREVIEW_SOCKET' });
      const timer = setInterval(() => {
        try {
          purgeSessions(deps.db, deps.now().toISOString());
        } catch {
          /* the next tick tries again */
        }
      }, 10 * 60_000);
      timer.unref?.();
      return () => clearInterval(timer);
    },
  };
}
