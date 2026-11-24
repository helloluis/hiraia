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
import { UPLOAD_ZIP_LIMITS, UploadRefused } from './upload-file';
import { UploadWorkError, uploadWorkers, type UploadWork } from './upload-jobs';
import { RenderError, rendererFromEnv, retiredRenderSettings, type DeckRenderer } from './upload-render';

export interface UploadOptions {
  /** Largest file taken, in bytes (never above the contract's limit). Default: `TALA_DECK_UPLOAD_MAX_BYTES` or the contract's. */
  maxFileBytes?: number;
  /** Total an account may keep. Default: `TALA_DECK_UPLOAD_ACCOUNT_BYTES` or the contract's. */
  maxAccountBytes?: number;
  maxUploads?: number;
  /**
   * Reads and writes the files. Default: one worker thread per job, with a time limit and a memory limit
   * (upload-jobs.ts). The server's own thread never reads an uploaded file.
   */
  work?: UploadWork;
  /** Downloads (the uploaded file, the edited file) one account may ask for in a minute. */
  downloadsPerMinute?: number;
  /**
   * Bytes of downloads and pictures that may be on their way to clients at one moment: for everybody together, and
   * for one account. An answer is held in memory until its client has taken it, however slowly; past these, the
   * next one is told to come back in a moment.
   */
  sendingBytes?: number;
  sendingBytesPerAccount?: number;
  /**
   * How long an answer may take to leave before it is cut short and its memory let go: this long in any case, ms,
   * and beyond that the time a connection of this many bytes a second needs for it.
   */
  sendGraceMs?: number;
  sendBytesPerSecond?: number;
  /**
   * Bytes of stored readings (what each file was read into: its slides' words and places) one account may keep, all
   * files together. They are kept beside the files and are not part of the file allowance.
   */
  readingBytesPerAccount?: number;
  /** Bytes of slide pictures kept for one account. The pictures of the files she opened longest ago make room. */
  pictureBytesPerAccount?: number;
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
  {
    // The size of each stored reading, so that an account's total can be had without fetching the readings.
    id: 'decks:003_upload_reading_bytes',
    sql: `
ALTER TABLE decks_uploads ADD COLUMN base_bytes INTEGER NOT NULL DEFAULT 0;
UPDATE decks_uploads SET base_bytes = LENGTH(CAST(base_json AS BLOB));
`,
  },
  {
    // A stored file is kept in pieces of 512 KiB, so that "the file I uploaded" can be sent a piece at a time and
    // is never in memory whole for a download. decks_upload_files keeps one row a file (its size); its own copy of
    // the bytes is emptied. Files stored before this are cut into pieces here.
    id: 'decks:004_upload_file_pieces',
    sql: `
CREATE TABLE decks_upload_file_pieces (
  sha256 TEXT NOT NULL,
  idx INTEGER NOT NULL,
  bytes BLOB NOT NULL,
  PRIMARY KEY (sha256, idx)
) STRICT;
INSERT INTO decks_upload_file_pieces (sha256, idx, bytes)
  WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < 4095)
  SELECT f.sha256, n.i, substr(f.bytes, 1 + n.i * 524288, 524288)
  FROM decks_upload_files f JOIN n ON n.i * 524288 < f.size;
UPDATE decks_upload_files SET bytes = x'';
`,
  },
];

/** Bytes in one piece of a stored file (decks:004). */
const FILE_PIECE_BYTES = 524288;

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
  off: 'Uploading your own slides is turned off on this server for now.',
  busy: 'Tala is busy with other files right now. Please try again in a moment.',
  notNow: 'Your file could not be read just now. Please try again in a little while.',
  tooManyDownloads: 'You have asked for many downloads. Please wait a minute and try again.',
  sendingBusy: 'Tala is sending other files right now. Please try again in a moment.',
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

/**
 * A size setting. Not set: the default. Set to anything but a plain number of bytes: null, and the server takes
 * no uploads until it is put right. It does not guess, least of all upwards.
 */
export function envBytes(name: string, fallback: number, max: number, env: NodeJS.ProcessEnv = process.env): number | null {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  if (!/^\d{1,12}$/.test(raw) || Number(raw) < 1) return null;
  return Math.min(Number(raw), max);
}

export function createUploads(options: UploadOptions = {}): Pick<ServerModule, 'migrations' | 'handlers' | 'onAccountDeleted' | 'onAccountMerged' | 'start'> {
  const fileBytesSetting = options.maxFileBytes ?? envBytes('TALA_DECK_UPLOAD_MAX_BYTES', UPLOAD_LIMITS.fileBytes, UPLOAD_LIMITS.fileBytes);
  const accountBytesSetting = options.maxAccountBytes ?? envBytes('TALA_DECK_UPLOAD_ACCOUNT_BYTES', UPLOAD_LIMITS.bytesPerAccount, 100 * UPLOAD_LIMITS.bytesPerAccount);
  /** Settings that are set but cannot be read (names only). While there is one, nothing is taken. */
  const badSettings = [fileBytesSetting === null ? 'TALA_DECK_UPLOAD_MAX_BYTES' : '', accountBytesSetting === null ? 'TALA_DECK_UPLOAD_ACCOUNT_BYTES' : ''].filter(Boolean);
  const maxFileBytes = badSettings.length ? 0 : Math.min(fileBytesSetting ?? 0, UPLOAD_LIMITS.fileBytes);
  const maxAccountBytes = badSettings.length ? 0 : (accountBytesSetting ?? 0);
  const maxUploads = options.maxUploads ?? UPLOAD_LIMITS.uploadsPerAccount;
  const work = options.work ?? uploadWorkers();
  const downloadsPerMinute = options.downloadsPerMinute ?? 30;
  const sendingBytes = options.sendingBytes ?? 96 * 1024 * 1024;
  // By default never less than the largest single answer, or that answer could not be sent at all.
  const sendingBytesPerAccount = Math.min(sendingBytes, options.sendingBytesPerAccount ?? Math.max(48 * 1024 * 1024, UPLOAD_ZIP_LIMITS.outputBytes));
  /**
   * What is on its way to clients right now, in bytes: for everybody and for each account. A download or a picture
   * is a block of memory until its client has taken all of it, and a client can take as long as it likes; so each
   * is counted from before it is fetched until the kernel says it has gone (`BinaryResponse.held`).
   */
  let sending = 0;
  const sendingFor = new Map<string, number>();
  const hold = (userId: string, bytes: number): { resize(bytes: number): boolean; release(): void } | null => {
    let mine = 0;
    const set = (wanted: number): boolean => {
      const all = sending - mine + wanted;
      const hers = (sendingFor.get(userId) ?? 0) - mine + wanted;
      if (wanted > mine && (all > sendingBytes || hers > sendingBytesPerAccount)) return false;
      sending = all;
      if (hers > 0) sendingFor.set(userId, hers);
      else sendingFor.delete(userId);
      mine = wanted;
      return true;
    };
    return set(bytes) ? { resize: set, release: () => void set(0) } : null;
  };
  const noRoomToSend = () => new HttpError('unavailable', MESSAGES.sendingBusy, { reason: 'download_busy', retryAfterSeconds: 10 });
  /** How long an answer of this size may take to leave: two minutes, and time for a connection of 32 KiB a second. */
  const sendGraceMs = options.sendGraceMs ?? 120_000;
  const sendBytesPerSecond = options.sendBytesPerSecond ?? 32 * 1024;
  const sendWithinMs = (bytes: number) => sendGraceMs + Math.ceil((bytes / sendBytesPerSecond) * 1000);
  const readingBytesPerAccount = options.readingBytesPerAccount ?? 16 * 1024 * 1024;
  const pictureBytesPerAccount = options.pictureBytesPerAccount ?? 96 * 1024 * 1024;
  const sessionMinutes = options.sessionMinutes ?? 24 * 60;
  const startsPerHour = options.startsPerHour ?? 20;
  const rendersPerTenMinutes = options.rendersPerTenMinutes ?? 60;
  const renderer = options.renderer === undefined ? rendererFromEnv() : options.renderer;
  const renderRetryMs = options.renderRetryMs ?? 30_000;
  const renderWaitMs = options.renderWaitMs ?? 20_000;
  const drawMsPerTenMinutes = options.drawMsPerTenMinutes ?? 180_000;
  /**
   * The server draws one file at a time for everybody, so the one place is shared out:
   * - each account has an amount of drawing time per ten minutes, and a drawing is only started when the time it is
   *   likely to take (as long as her longest one lately) still fits;
   * - when someone who was drawn for less recently is waiting, the place is left for her.
   */
  const drawn = new Map<string, Array<{ at: number; ms: number }>>();
  const recentDrawings = (userId: string, now: number) => {
    const recent = (drawn.get(userId) ?? []).filter((d) => now - d.at < 600_000);
    if (recent.length) drawn.set(userId, recent);
    else drawn.delete(userId);
    return recent;
  };
  const timeLeftFor = (userId: string, now: number): boolean => {
    const recent = recentDrawings(userId, now);
    const likely = Math.max(0, ...recent.map((d) => d.ms));
    return recent.reduce((sum, d) => sum + d.ms, 0) + likely <= drawMsPerTenMinutes;
  };
  /** Accounts told "busy" lately (the editor asks again every few seconds), and when each was last drawn for. */
  const waiting = new Map<string, number>();
  const lastDrawnFor = new Map<string, number>();
  const someoneElseIsOwed = (userId: string, now: number): boolean => {
    const mine = lastDrawnFor.get(userId) ?? 0;
    for (const [other, askedAt] of waiting) {
      if (now - askedAt > 15_000) waiting.delete(other);
      else if (other !== userId && (lastDrawnFor.get(other) ?? 0) < mine) return true;
    }
    return false;
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
  const usage = (db: Database, ownerId: string): { bytes: number; uploads: number; reading: number } =>
    db.prepare('SELECT COALESCE(SUM(original_bytes), 0) AS bytes, COUNT(*) AS uploads, COALESCE(SUM(base_bytes), 0) AS reading FROM decks_uploads WHERE owner_id = ?').get(ownerId) as { bytes: number; uploads: number; reading: number };
  const dropSession = (db: Database, sessionId: string) => {
    db.prepare('DELETE FROM decks_upload_chunks WHERE session_id = ?').run(sessionId);
    db.prepare('DELETE FROM decks_upload_sessions WHERE id = ?').run(sessionId);
  };
  const purgeSessions = (db: Database, now: string) => {
    const expired = db.prepare('SELECT id FROM decks_upload_sessions WHERE expires_at <= ?').all(now) as Array<{ id: string }>;
    for (const s of expired) dropSession(db, s.id);
  };
  /** Stored files no upload refers to any more. */
  const sweepFiles = (db: Database) => {
    db.prepare('DELETE FROM decks_upload_file_pieces WHERE sha256 NOT IN (SELECT original_sha256 FROM decks_uploads)').run();
    db.prepare('DELETE FROM decks_upload_files WHERE sha256 NOT IN (SELECT original_sha256 FROM decks_uploads)').run();
  };
  /** A stored file whole, put together from its pieces: for a job that has to read all of it (never for a download). */
  const fileOf = (db: Database, sha256: string): Uint8Array | null => {
    const stored = db.prepare('SELECT size FROM decks_upload_files WHERE sha256 = ?').get(sha256) as { size: number } | undefined;
    if (!stored) return null;
    const whole = Buffer.allocUnsafeSlow(stored.size);
    let at = 0;
    let fits = true;
    for (const piece of db.prepare('SELECT bytes FROM decks_upload_file_pieces WHERE sha256 = ? ORDER BY idx').iterate(sha256) as Iterable<{ bytes: Buffer }>) {
      if (at + piece.bytes.length > whole.length) {
        fits = false;
        break;
      }
      piece.bytes.copy(whole, at);
      at += piece.bytes.length;
    }
    return fits && at === stored.size ? fromBlob(whole) : null;
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
        // The list needs a line per file, not what each file holds: the stored reading of a deck is not fetched.
        const rows = ctx.db
          .prepare('SELECT id, title, file_name, kind, slide_count, changed_slides, original_bytes, rev, created_at, updated_at FROM decks_uploads WHERE owner_id = ? ORDER BY updated_at DESC, rowid DESC')
          .all(user.id) as UploadRow[];
        const used = usage(ctx.db, user.id);
        return {
          decks: rows.map(summary),
          allowance: { fileBytes: maxFileBytes, remainingBytes: Math.max(0, maxAccountBytes - used.bytes), remainingUploads: Math.max(0, maxUploads - used.uploads) },
        };
      },

      'decks.uploads.begin': (ctx, { body }) => {
        const user = requireUser(ctx);
        if (!user.emailVerified) throw new HttpError('forbidden', MESSAGES.verify, { reason: 'email_not_verified' });
        if (badSettings.length) throw new HttpError('unavailable', MESSAGES.off, { reason: 'uploads_off' });
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
        // Unfinished uploads take room too. One other at most is kept, and never more than fits beside her files and
        // this one in what her account may hold: the oldest make room.
        const mine = ctx.db.prepare('SELECT id, bytes FROM decks_upload_sessions WHERE owner_id = ? ORDER BY created_at DESC, rowid DESC').all(user.id) as Array<{ id: string; bytes: number }>;
        let unfinished = 0;
        mine.forEach((old, i) => {
          if (i >= 1 || used.bytes + body.bytes + unfinished + old.bytes > maxAccountBytes) dropSession(ctx.db, old.id);
          else unfinished += old.bytes;
        });
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

      'decks.uploads.finish': async (ctx, { params }) => {
        const user = requireUser(ctx);
        const nowIso = ctx.now().toISOString();
        const session = getSession(ctx.db, user.id, params.sessionId, nowIso);
        if (!session) throw sessionGone();
        const incomplete = (received: number[]) => new HttpError('conflict', MESSAGES.incomplete, { reason: 'upload_incomplete', received });
        const received = receivedOf(ctx.db, session.id);
        if (received.length !== session.chunk_count || received.some((idx, i) => idx !== i)) throw incomplete(received);
        const fail = (reason: UploadRefusalReason, why = ''): never => {
          // A file that was refused is not kept in any form.
          dropSession(ctx.db, session.id);
          ctx.log.info('deck_upload_refused', { reason, bytes: session.bytes, ...(why ? { why } : {}) });
          throw refuse(reason);
        };
        const used = usage(ctx.db, user.id);
        if (used.uploads >= maxUploads || used.bytes + session.bytes > maxAccountBytes) fail('quota');
        // The file is read (and its checksum taken) in a worker of its own, with a time and a memory limit: whatever
        // it holds, this thread goes on answering everybody else. Its pieces are joined only when its turn has
        // come: uploads that wait their turn hold nothing in memory.
        let file: Uint8Array = new Uint8Array(0);
        const joined = (): Uint8Array => {
          if (!getSession(ctx.db, user.id, session.id, ctx.now().toISOString())) throw sessionGone();
          // One block of memory the size of the file, filled a piece at a time: the file is never in memory twice
          // on this thread. (The worker is given a copy of its own; this one is what is stored when the worker,
          // having checked that copy against the checksum, says it is a deck.)
          const whole = Buffer.allocUnsafeSlow(session.bytes);
          let at = 0;
          let count = 0;
          let fits = true;
          for (const piece of ctx.db.prepare('SELECT idx, bytes FROM decks_upload_chunks WHERE session_id = ? ORDER BY idx').iterate(session.id) as Iterable<{ idx: number; bytes: Buffer }>) {
            if (piece.idx !== count || at + piece.bytes.length > whole.length) {
              fits = false;
              break;
            }
            piece.bytes.copy(whole, at);
            at += piece.bytes.length;
            count += 1;
          }
          if (!fits || count !== session.chunk_count) throw incomplete(receivedOf(ctx.db, session.id));
          if (at !== session.bytes) fail('checksum_mismatch');
          file = fromBlob(whole);
          return file;
        };
        let inspection: DeckInspection;
        try {
          // The joined file is handed to the worker and comes back with its reading: it is in memory once.
          ({ inspection, file } = await work.take(joined, session.sha256));
        } catch (err) {
          if (err instanceof UploadRefused) return fail(err.reason as UploadRefusalReason);
          if (!(err instanceof UploadWorkError)) throw err;
          // Stopped at a limit: the file is more than is read here. That is a refusal like any other.
          if (err.kind === 'time' || err.kind === 'memory') return fail('too_large', `stopped at the ${err.kind} limit`);
          // Nothing about the file: she can try again with the same upload.
          if (err.kind === 'fault') ctx.log.error('deck_upload_reader_failed', { detail: err.detail });
          throw new HttpError('unavailable', err.kind === 'busy' ? MESSAGES.busy : MESSAGES.notNow, { reason: err.kind === 'busy' ? 'upload_busy' : 'upload_reader_unavailable' });
        }
        const id = ctx.newId();
        const base = { size: inspection.size, slides: inspection.slides, features: inspection.features, totals: inspection.totals };
        const edits = noEdits(inspection);
        const title = (inspection.title || session.file_name.replace(/\.[A-Za-z0-9]{1,8}$/, '')).slice(0, UPLOAD_LIMITS.title);
        // Time has passed while the file was read: the upload may have been finished or cancelled by another
        // request, and her allowance may have been used.
        const stillOpen = getSession(ctx.db, user.id, session.id, ctx.now().toISOString());
        if (!stillOpen) throw sessionGone();
        const usedNow = usage(ctx.db, user.id);
        const baseJson = JSON.stringify(base);
        const baseBytes = Buffer.byteLength(baseJson);
        // What the file was read into is kept too, and has a total of its own for each account.
        if (usedNow.uploads >= maxUploads || usedNow.bytes + file.length > maxAccountBytes || usedNow.reading + baseBytes > readingBytesPerAccount) fail('quota');
        ctx.db.transaction(() => {
          // Stored once for each distinct file, in pieces.
          if (!ctx.db.prepare('SELECT 1 FROM decks_upload_files WHERE sha256 = ?').get(session.sha256)) {
            ctx.db.prepare("INSERT INTO decks_upload_files (sha256, bytes, size) VALUES (?, x'', ?)").run(session.sha256, file.length);
            const put = ctx.db.prepare('INSERT INTO decks_upload_file_pieces (sha256, idx, bytes) VALUES (?, ?, ?)');
            for (let i = 0, at = 0; at < file.length; i++, at += FILE_PIECE_BYTES) put.run(session.sha256, i, toBlob(file.subarray(at, at + FILE_PIECE_BYTES)));
          }
          ctx.db
            .prepare(
              `INSERT INTO decks_uploads (id, owner_id, title, file_name, kind, original_sha256, original_bytes, base_json, base_bytes, edits_json, slide_count, changed_slides, rev, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?)`
            )
            .run(id, user.id, title, session.file_name, inspection.kind, session.sha256, file.length, baseJson, baseBytes, JSON.stringify(edits), inspection.slides.length, nowIso, nowIso);
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
        const user = requireUser(ctx);
        const row = getRow(ctx.db, user.id, params.uploadId);
        if (!row) throw notFound();
        // A download holds a whole file in memory while it is sent: one account cannot ask for them without end.
        if (!ctx.services.rateLimit.take(`deck-download:${user.id}`, downloadsPerMinute, 60)) throw new HttpError('rate_limited', MESSAGES.tooManyDownloads, { retryAfterSeconds: 60 });
        const stored = ctx.db.prepare('SELECT size FROM decks_upload_files WHERE sha256 = ?').get(row.original_sha256) as { size: number } | undefined;
        if (!stored || stored.size !== row.original_bytes) throw notFound();
        // Sent a piece at a time from the database, as her connection takes it: the file is never in memory whole
        // for a download, and a download that is not taken holds one piece.
        const held = hold(user.id, FILE_PIECE_BYTES);
        if (!held) throw noRoomToSend();
        const piece = ctx.db.prepare('SELECT bytes FROM decks_upload_file_pieces WHERE sha256 = ? AND idx = ?');
        let idx = 0;
        const next = (): Uint8Array | null => {
          const p = piece.get(row.original_sha256, idx++) as { bytes: Buffer } | undefined;
          return p ? fromBlob(p.bytes) : null;
        };
        return {
          binary: new Uint8Array(0),
          contentType: CONTENT_TYPES[row.kind],
          filename: safeFileName(row.file_name, 'slides.pptx'),
          held: { release: held.release, withinMs: sendWithinMs(stored.size), pieces: { bytes: stored.size, next } },
        };
      },

      /** The uploaded file with the saved changes written in. Always a .pptx that opens for editing. */
      'decks.uploads.pptx': async (ctx, { params }) => {
        const user = requireUser(ctx);
        const row = getRow(ctx.db, user.id, params.uploadId);
        if (!row) throw notFound();
        if (!ctx.services.rateLimit.take(`deck-download:${user.id}`, downloadsPerMinute, 60)) throw new HttpError('rate_limited', MESSAGES.tooManyDownloads, { retryAfterSeconds: 60 });
        // Room for a file the size of the uploaded one is taken before any work is done; the edited file's own
        // size takes its place when it is known.
        const held = hold(user.id, row.original_bytes);
        if (!held) throw noRoomToSend();
        let pptx: Uint8Array;
        try {
          // Written in a worker of its own, like the reading: with a time and a memory limit. The uploaded file is
          // fetched when this download's turn has come.
          ({ pptx } = await work.write(() => {
            const file = fileOf(ctx.db, row.original_sha256);
            if (!file) throw notFound();
            return file;
          }, JSON.parse(row.edits_json) as DeckEdits));
        } catch (err) {
          held.release();
          if (err instanceof HttpError) throw err;
          const reason = err instanceof UploadRefused ? err.reason : err instanceof UploadWorkError ? `stopped: ${err.kind}` : 'error';
          ctx.log.error('deck_upload_export_failed', { uploadId: row.id, reason });
          throw new HttpError('unavailable', err instanceof UploadWorkError && err.kind === 'busy' ? MESSAGES.busy : MESSAGES.cannotBuild, { reason: 'export_failed' });
        }
        if (!held.resize(pptx.length)) {
          held.release();
          throw noRoomToSend();
        }
        return {
          binary: pptx,
          contentType: CONTENT_TYPES.presentation,
          filename: `${safeFileName(row.title, 'slides').replace(/\.(pptx|potx|ppsx)$/i, '')}-tala.pptx`,
          held: { release: held.release, withinMs: sendWithinMs(pptx.length) },
        };
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
        // One drawing at a time on this server, shared out between teachers (see `timeLeftFor` and
        // `someoneElseIsOwed` above), and a ceiling on how many one teacher may ask for: drawing is the costly part
        // of this module.
        const startedAt = Date.now();
        // Her own drawing time is used up: she is told to wait, and is not counted among those the place is owed to.
        if (!timeLeftFor(user.id, startedAt)) return { state: 'busy' as const, ...current };
        if (rendering || someoneElseIsOwed(user.id, startedAt)) {
          waiting.set(user.id, startedAt);
          return { state: 'busy' as const, ...current };
        }
        waiting.delete(user.id);
        if (!ctx.services.rateLimit.take(`deck-render:${user.id}`, rendersPerTenMinutes, 600)) return { state: 'busy' as const, ...current };
        rendering = true;
        lastDrawnFor.set(user.id, startedAt);
        const { db, log } = ctx;
        const drawing = (async () => {
          try {
            // The file with her changes is written in a worker of its own, then drawn by the drawing service.
            const { pptx } = await work.write(() => {
              const file = fileOf(db, row.original_sha256);
              if (!file) throw new RenderError('failed', 'the uploaded file is gone');
              return file;
            }, edits);
            const pictures = await renderer.render(pptx, edits.slides.length);
            if (pictures.length !== edits.slides.length) throw new RenderError('failed', 'page count');
            const bytes = pictures.reduce((n, p) => n + p.length, 0);
            if (bytes > pictureBytesPerAccount) throw new RenderError('failed', 'pictures larger than an account may keep');
            db.transaction(() => {
              // Only if the upload is still this account's and still at the version that was drawn.
              const still = getRow(db, user.id, row.id);
              if (!still || still.rev !== row.rev) return;
              db.prepare('DELETE FROM decks_upload_previews WHERE upload_id = ?').run(row.id);
              // Pictures can be drawn again, so they are kept like a cache: those of the files she opened longest
              // ago make room for these.
              const kept = db
                .prepare(
                  `SELECT p.upload_id AS id, SUM(LENGTH(p.bytes)) AS bytes FROM decks_upload_previews p JOIN decks_uploads u ON u.id = p.upload_id
                   WHERE u.owner_id = ? GROUP BY p.upload_id ORDER BY u.updated_at DESC, u.rowid DESC`
                )
                .all(user.id) as Array<{ id: string; bytes: number }>;
              let total = bytes;
              for (const k of kept) {
                total += k.bytes;
                if (total > pictureBytesPerAccount) db.prepare('DELETE FROM decks_upload_previews WHERE upload_id = ?').run(k.id);
              }
              const insert = db.prepare('INSERT INTO decks_upload_previews (upload_id, slide_id, rev, bytes) VALUES (?, ?, ?, ?)');
              edits.slides.forEach((s, i) => insert.run(row.id, s.id, row.rev, toBlob(pictures[i]!)));
            })();
            return { state: 'ready' as const, ...previewInfo(db, row) };
          } catch (err) {
            // The reason is one of the renderer's or the worker's own short phrases, never text from the file.
            const kind = err instanceof RenderError ? err.kind : err instanceof UploadWorkError && err.kind === 'busy' ? 'busy' : 'failed';
            const reason = err instanceof RenderError ? err.reason : err instanceof UploadRefused ? `could not write the file (${err.reason})` : err instanceof UploadWorkError ? `could not write the file (stopped: ${err.kind})` : 'error';
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
            drawn.set(user.id, [...recentDrawings(user.id, Date.now()), { at: Date.now(), ms: Date.now() - startedAt }]);
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
        // Pictures are counted like downloads: an editor asks for many at once, and each waits for its client.
        const held = hold(row.owner_id, picture.bytes.length);
        if (!held) throw noRoomToSend();
        return { binary: fromBlob(picture.bytes), contentType: 'image/jpeg', cacheControl: 'private, max-age=3600', held: { release: held.release, withinMs: sendWithinMs(picture.bytes.length) } };
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
      // A size setting that cannot be read turns uploads off rather than being guessed.
      if (badSettings.length) deps.log.error('deck_upload_settings_unreadable', { names: badSettings.join(','), effect: 'no uploads are taken until this is a plain number of bytes' });
      // Files are read in a worker thread that runs the reader's own source: say so at once if this Node cannot.
      void work.check().then((problem) => {
        if (problem) deps.log.error('deck_upload_reader_unavailable', { problem, effect: 'uploaded files cannot be read or written out until this is fixed', needs: 'Node 22.18 or newer' });
      });
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
