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
import { createHash } from 'node:crypto';
import { UPLOAD_LIMITS } from '@hiraia/tala-core/contracts';
import type { UploadedDeck, UploadedDeckSummary, UploadRefusalReason, UploadSlideEdit } from '@hiraia/tala-core/contracts';
import { changedSlideCount, invalidEdits, noEdits, normaliseEdits, type DeckEdits, type DeckInspection } from '@hiraia/tala-core/pptx';
import type { Database } from 'better-sqlite3';
import { HttpError, requireUser, type BaseDeps, type Logger, type Migration, type ServerModule } from '../../kernel/types';
import { credentialsFile, objectStore, storageSettingFromEnv, StoreError, uploadObjectKey, type CredentialSource, type ObjectStore, type R2Settings, type StorageSetting } from './r2';
import { sha256Hex, UPLOAD_ZIP_LIMITS, UploadRefused } from './upload-file';
import { UploadWorkError, uploadWorkers, type UploadWork } from './upload-jobs';
import { RenderError, rendererFromEnv, retiredRenderSettings, type DeckRenderer } from './upload-render';

/**
 * What a server takes when nothing is set: the sizes its memory was measured to hold with room to spare under the
 * production ceiling (docs/tala/teacher-uploads/README.md). The contract's limits (30 MiB a file) are the most a
 * server may be SET to, with more memory.
 */
export const UPLOAD_DEFAULTS = { fileBytes: 15 * 1024 * 1024, accountBytes: 50 * 1024 * 1024 } as const;

export interface UploadOptions {
  /** Largest file taken, in bytes (never above the contract's limit). Default: `TALA_DECK_UPLOAD_MAX_BYTES` or UPLOAD_DEFAULTS. */
  maxFileBytes?: number;
  /** Total an account may keep. Default: `TALA_DECK_UPLOAD_ACCOUNT_BYTES` or UPLOAD_DEFAULTS. */
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
  /** How long a connection may go without taking the next piece of an answer before it is let go, ms. */
  sendStallMs?: number;
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
  /**
   * Where uploaded files are kept. Default: from the environment (r2.ts, `storageSettingFromEnv`): a private
   * object-storage bucket when the TALA_R2_* settings are given; the database on a developer's machine with none;
   * no uploads at all in staging or production without them, or with any of them missing or unusable. Tests may
   * hand in a store of their own (`{ kind: 'r2', settings, store }`).
   */
  storage?: StorageSetting | { kind: 'r2'; settings: R2Settings; store: ObjectStore };
  /** How often the background work runs (objects still to be removed, files still to be moved out of the database), ms. */
  storageTickMs?: number;
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
  {
    // Files kept in object storage (r2.ts): an upload's object name, or NULL while its file is still in
    // decks_upload_file_pieces. And every object this server has started to write or still has to remove, so that
    // a crash or a failed request never leaves an object nobody knows of, nor a record without its object. Nothing
    // lists or sweeps the bucket; only an explicit delete of an upload or of an account removes an object.
    id: 'decks:005_upload_objects',
    sql: `
ALTER TABLE decks_uploads ADD COLUMN object_key TEXT;
CREATE TABLE decks_upload_objects (
  key TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  upload_id TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  -- writing: being written and checked; stored: an upload's file; removing: to be removed (retried until done)
  state TEXT NOT NULL CHECK (state IN ('writing', 'stored', 'removing')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_try_at TEXT NOT NULL,
  -- 1: a write whose outcome is not known (it may still land), so it is removed twice, ten minutes apart
  uncertain INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX decks_upload_objects_due ON decks_upload_objects (state, next_try_at);
CREATE INDEX decks_upload_objects_owner ON decks_upload_objects (owner_id);
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
  /** The file's object in storage; null while it is in the database's pieces. */
  object_key: string | null;
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

/** Whose an upload is and which file: for a picture, and for the uploaded file itself. */
type FileRow = Pick<UploadRow, 'id' | 'owner_id' | 'kind' | 'file_name' | 'original_sha256' | 'original_bytes' | 'object_key'>;

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
  storageUpload: 'The upload did not finish: the place where Tala keeps files did not answer. Nothing you sent is lost. Please try again in a few minutes.',
  storageDownload: 'This file cannot be fetched right now. It is kept safely. Please try again in a few minutes.',
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
  const fileBytesSetting = options.maxFileBytes ?? envBytes('TALA_DECK_UPLOAD_MAX_BYTES', UPLOAD_DEFAULTS.fileBytes, UPLOAD_LIMITS.fileBytes);
  const accountBytesSetting = options.maxAccountBytes ?? envBytes('TALA_DECK_UPLOAD_ACCOUNT_BYTES', UPLOAD_DEFAULTS.accountBytes, 100 * UPLOAD_LIMITS.bytesPerAccount);
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
  /** A connection that takes nothing for this long has its answer let go (the kernel's own 30 s when not set). */
  const stallMs = options.sendStallMs;
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

  /* ---------------- where the files are kept ---------------- */
  /**
   * `objects`: the private bucket, when files go there (r2.ts). Null: they stay in the database's pieces (a
   * developer's machine and the tests), or uploads are off (`storageOff` says why; staging and production with a
   * setting missing). The module is made before the server starts, so the store finds the server's log later.
   */
  const storageSetting = options.storage ?? storageSettingFromEnv();
  let moduleLog: Logger | null = null;
  /** The key file, when this module reads one itself (not when a test hands in a store): checked once at start. */
  let keys: CredentialSource | null = null;
  const objects: ObjectStore | null = (() => {
    if (storageSetting.kind !== 'r2') return null;
    if ('store' in storageSetting) return (storageSetting as { store: ObjectStore }).store;
    const { settings } = storageSetting;
    keys = credentialsFile(settings.credentialsFile, { log: () => moduleLog });
    return objectStore(settings, { credentials: keys, log: () => moduleLog });
  })();
  const objectPrefix = storageSetting.kind === 'r2' ? storageSetting.settings.prefix : '';
  const storageOff = storageSetting.kind === 'off' ? storageSetting.problems : [];
  const storageTickMs = options.storageTickMs ?? 30_000;
  /** Asks the background work to run now (an object to remove). Set when the module starts. */
  let kick = () => {};
  const keyFor = (ownerId: string, uploadId: string) => uploadObjectKey(objectPrefix, ownerId, uploadId);
  const storageUnavailable = (reason: 'upload_storage_unavailable' | 'download_storage_unavailable') =>
    new HttpError('unavailable', reason === 'upload_storage_unavailable' ? MESSAGES.storageUpload : MESSAGES.storageDownload, { reason, retryAfterSeconds: 60 });
  /** What a store failure says in the log: its kind and the store's own short code, never a name or a key. */
  const storeFailure = (err: StoreError) => ({ kind: err.kind, ...(err.status ? { status: err.status } : {}), ...(err.code ? { code: err.code } : {}) });
  interface ObjectRef {
    key: string;
    ownerId: string;
    uploadId: string;
    sha256: string;
    bytes: number;
  }
  /**
   * An object to be removed, retried until it is gone. `uncertain`: a write whose outcome is not known (it may
   * still land after the removal), so it is removed again ten minutes later.
   */
  const markRemoving = (db: Database, o: ObjectRef, uncertain: boolean, at: string) =>
    db
      .prepare(
        `INSERT INTO decks_upload_objects (key, owner_id, upload_id, sha256, bytes, state, attempts, next_try_at, uncertain, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'removing', 0, ?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET state = 'removing', next_try_at = excluded.next_try_at, uncertain = MAX(uncertain, excluded.uncertain), updated_at = excluded.updated_at`
      )
      .run(o.key, o.ownerId, o.uploadId, o.sha256, o.bytes, at, uncertain ? 1 : 0, at, at);
  /**
   * Writes a file to the bucket under a name that must be new, reads it back and checks it. Recorded first as
   * "writing", so that whatever happens from here a later run knows of the object. On any failure what may have
   * reached the store is marked for removal and the error is thrown: the caller keeps what it had (a finished
   * upload's pieces, a file still in the database).
   */
  const putChecked = async (db: Database, log: Logger, o: Omit<ObjectRef, 'bytes'> & { file: Uint8Array }, at: () => string): Promise<void> => {
    if (!objects) throw new StoreError('unavailable', undefined, 'not_configured');
    const ref: ObjectRef = { key: o.key, ownerId: o.ownerId, uploadId: o.uploadId, sha256: o.sha256, bytes: o.file.length };
    db.prepare(
      `INSERT INTO decks_upload_objects (key, owner_id, upload_id, sha256, bytes, state, attempts, next_try_at, uncertain, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'writing', 0, ?, 1, ?, ?)`
    ).run(ref.key, ref.ownerId, ref.uploadId, ref.sha256, ref.bytes, at(), at(), at());
    let existed = false;
    try {
      try {
        await objects.putNew(o.key, o.file, o.sha256);
      } catch (err) {
        if (!(err instanceof StoreError && err.kind === 'exists')) throw err;
        // The name is new for every upload, so this is our own earlier write whose answer was lost. It is taken
        // only if it is exactly this file (checked below); it is never overwritten.
        existed = true;
      }
      await objects.verify(o.key, ref.bytes, o.sha256);
    } catch (err) {
      if (existed && err instanceof StoreError && err.kind === 'damaged') {
        // Somebody else's bytes under a name that should be ours: left alone, never removed by us.
        db.prepare("DELETE FROM decks_upload_objects WHERE key = ? AND state = 'writing'").run(o.key);
        log.error('deck_upload_object_name_taken', { uploadId: o.uploadId });
        throw new StoreError('unavailable', undefined, 'name_taken');
      }
      markRemoving(db, ref, !(err instanceof StoreError && (err.kind === 'refused' || err.kind === 'damaged')), at());
      kick();
      throw err;
    }
  };
  /** A stored file whole, wherever it is: for a job that has to read all of it. The worker checks it again. */
  const wholeFile = async (db: Database, row: Pick<UploadRow, 'original_sha256' | 'original_bytes' | 'object_key'>): Promise<Uint8Array | null> => {
    if (row.object_key === null) return fileOf(db, row.original_sha256);
    if (!objects) throw new StoreError('unavailable', undefined, 'not_configured');
    return objects.readWhole(row.object_key, row.original_bytes, row.original_sha256);
  };

  /* ---------------- rows ---------------- */
  const getRow = (db: Database, ownerId: string, id: string): UploadRow | null =>
    (db.prepare('SELECT * FROM decks_uploads WHERE id = ? AND owner_id = ?').get(id, ownerId) as UploadRow | undefined) ?? null;
  /**
   * The same row without what the file was read into, which can be megabytes: for the routes that only send, write
   * or draw. A picture or a download does not fetch a deck's whole reading to find out whose it is.
   */
  const getRowWithoutReading = (db: Database, ownerId: string, id: string): Omit<UploadRow, 'base_json'> | null =>
    (db
      .prepare('SELECT id, owner_id, title, file_name, kind, original_sha256, original_bytes, edits_json, slide_count, changed_slides, rev, created_at, updated_at, object_key FROM decks_uploads WHERE id = ? AND owner_id = ?')
      .get(id, ownerId) as Omit<UploadRow, 'base_json'> | undefined) ?? null;
  /** Only whose it is and which file: for a picture, and for the uploaded file itself. */
  const getFileRow = (db: Database, ownerId: string, id: string): FileRow | null =>
    (db.prepare('SELECT id, owner_id, kind, file_name, original_sha256, original_bytes, object_key FROM decks_uploads WHERE id = ? AND owner_id = ?').get(id, ownerId) as FileRow | undefined) ?? null;
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
  /** Files in the database that no upload still kept there refers to (an upload whose file is in the bucket does not). */
  const sweepFiles = (db: Database) => {
    db.prepare('DELETE FROM decks_upload_file_pieces WHERE sha256 NOT IN (SELECT original_sha256 FROM decks_uploads WHERE object_key IS NULL)').run();
    db.prepare('DELETE FROM decks_upload_files WHERE sha256 NOT IN (SELECT original_sha256 FROM decks_uploads WHERE object_key IS NULL)').run();
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
        // A size setting that cannot be read, or nowhere private to keep the file: nothing is taken.
        if (badSettings.length || storageOff.length) throw new HttpError('unavailable', MESSAGES.off, { reason: 'uploads_off' });
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
        if (badSettings.length || storageOff.length) throw new HttpError('unavailable', MESSAGES.off, { reason: 'uploads_off' });
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
        /** What the file was read into, and her allowance checked again: time has passed while the file was read. */
        const prepared = (inspection: DeckInspection, size: number) => {
          if (!getSession(ctx.db, user.id, session.id, ctx.now().toISOString())) throw sessionGone();
          const base = { size: inspection.size, slides: inspection.slides, features: inspection.features, totals: inspection.totals };
          const baseJson = JSON.stringify(base);
          const baseBytes = Buffer.byteLength(baseJson);
          const usedNow = usage(ctx.db, user.id);
          // What the file was read into is kept too, and has a total of its own for each account.
          if (usedNow.uploads >= maxUploads || usedNow.bytes + size > maxAccountBytes || usedNow.reading + baseBytes > readingBytesPerAccount) fail('quota');
          const title = (inspection.title || session.file_name.replace(/\.[A-Za-z0-9]{1,8}$/, '')).slice(0, UPLOAD_LIMITS.title);
          return { baseJson, baseBytes, edits: noEdits(inspection), title };
        };
        /** The upload's row and the end of its session, in one transaction; in the database mode with its pieces. */
        const record = (id: string, inspection: DeckInspection, prep: ReturnType<typeof prepared>, size: number, objectKey: string | null, pieces: Uint8Array | null) => {
          const at = ctx.now().toISOString();
          ctx.db.transaction(() => {
            if (pieces && !ctx.db.prepare('SELECT 1 FROM decks_upload_files WHERE sha256 = ?').get(session.sha256)) {
              // Stored once for each distinct file, in pieces.
              ctx.db.prepare("INSERT INTO decks_upload_files (sha256, bytes, size) VALUES (?, x'', ?)").run(session.sha256, pieces.length);
              const put = ctx.db.prepare('INSERT INTO decks_upload_file_pieces (sha256, idx, bytes) VALUES (?, ?, ?)');
              for (let i = 0, off = 0; off < pieces.length; i++, off += FILE_PIECE_BYTES) put.run(session.sha256, i, toBlob(pieces.subarray(off, off + FILE_PIECE_BYTES)));
            }
            // Its object was given up meanwhile (her account was deleted while it was being written): not recorded.
            if (objectKey && ctx.db.prepare("UPDATE decks_upload_objects SET state = 'stored', uncertain = 0, updated_at = ? WHERE key = ? AND state = 'writing'").run(at, objectKey).changes !== 1) throw sessionGone();
            ctx.db
              .prepare(
                `INSERT INTO decks_uploads (id, owner_id, title, file_name, kind, original_sha256, original_bytes, base_json, base_bytes, edits_json, slide_count, changed_slides, rev, created_at, updated_at, object_key)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?, ?)`
              )
              .run(id, user.id, prep.title, session.file_name, inspection.kind, session.sha256, size, prep.baseJson, prep.baseBytes, JSON.stringify(prep.edits), inspection.slides.length, nowIso, nowIso, objectKey);
            dropSession(ctx.db, session.id);
          })();
        };
        let inspection: DeckInspection;
        let id: string;
        try {
          if (objects) {
            // Object storage: the file is written to the bucket under a name of its own, read back and checked
            // INSIDE the job's turn at the one place (one whole file in memory at a time for the whole server),
            // and only then recorded. If anything fails her pieces stay: finishing again resumes from them.
            const taken = await work.take(joined, session.sha256, user.id, async ({ inspection: read, file: bytes }) => {
              const prep = prepared(read, bytes.length);
              const newId = ctx.newId();
              const ref = { key: keyFor(user.id, newId), ownerId: user.id, uploadId: newId, sha256: session.sha256 };
              await putChecked(ctx.db, ctx.log, { ...ref, file: bytes }, () => ctx.now().toISOString());
              // Nothing is awaited from here to the record, so no other request comes between these checks and it.
              const giveUp = () => {
                markRemoving(ctx.db, { ...ref, bytes: bytes.length }, false, ctx.now().toISOString());
                kick();
              };
              if (!getSession(ctx.db, user.id, session.id, ctx.now().toISOString())) {
                giveUp();
                throw sessionGone();
              }
              const usedNow = usage(ctx.db, user.id);
              if (usedNow.uploads >= maxUploads || usedNow.bytes + bytes.length > maxAccountBytes || usedNow.reading + prep.baseBytes > readingBytesPerAccount) {
                giveUp();
                fail('quota');
              }
              try {
                record(newId, read, prep, bytes.length, ref.key, null);
              } catch (err) {
                giveUp();
                throw err;
              }
              return newId;
            });
            inspection = taken.inspection;
            // A job place that does not run `keep` has stored nothing: never recorded as if it had.
            if (taken.kept === undefined) throw new UploadWorkError('fault', 'the file was not kept');
            id = taken.kept;
          } else {
            // The joined file is handed to the worker and comes back with its reading: it is in memory once.
            ({ inspection, file } = await work.take(joined, session.sha256, user.id));
            const prep = prepared(inspection, file.length);
            id = ctx.newId();
            record(id, inspection, prep, file.length, null, file);
          }
        } catch (err) {
          if (err instanceof HttpError) throw err;
          if (err instanceof StoreError) {
            // Nothing about the file and nothing lost: her pieces are kept, and she can finish again.
            ctx.log.error('deck_upload_store_failed', storeFailure(err));
            throw storageUnavailable('upload_storage_unavailable');
          }
          if (err instanceof UploadRefused) return fail(err.reason as UploadRefusalReason);
          if (!(err instanceof UploadWorkError)) throw err;
          // Stopped at a limit: the file is more than is read here. That is a refusal like any other.
          if (err.kind === 'time' || err.kind === 'memory') return fail('too_large', `stopped at the ${err.kind} limit`);
          // Nothing about the file: she can try again with the same upload.
          if (err.kind === 'fault') ctx.log.error('deck_upload_reader_failed', { detail: err.detail });
          throw new HttpError('unavailable', err.kind === 'busy' ? MESSAGES.busy : MESSAGES.notNow, { reason: err.kind === 'busy' ? 'upload_busy' : 'upload_reader_unavailable' });
        }
        ctx.log.info('deck_uploaded', { uploadId: id, bytes: session.bytes, slides: inspection.slides.length, kind: inspection.kind, kept: objects ? 'object storage' : 'database' });
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
          const row = getFileRow(ctx.db, user.id, params.uploadId);
          if (!row) return false;
          ctx.db.prepare('DELETE FROM decks_uploads WHERE id = ? AND owner_id = ?').run(row.id, user.id);
          ctx.db.prepare('DELETE FROM decks_upload_previews WHERE upload_id = ?').run(row.id);
          // Her file in the bucket is removed with it: at once when the store answers, else retried until it is gone.
          if (row.object_key) markRemoving(ctx.db, { key: row.object_key, ownerId: user.id, uploadId: row.id, sha256: row.original_sha256, bytes: row.original_bytes }, false, ctx.now().toISOString());
          sweepFiles(ctx.db);
          return true;
        })();
        if (!removed) throw notFound();
        kick();
        ctx.log.info('deck_upload_deleted', { uploadId: params.uploadId });
        return { ok: true as const };
      },

      /** The file exactly as it was uploaded: the same bytes, the same SHA-256. */
      'decks.uploads.original': async (ctx, { params }) => {
        const user = requireUser(ctx);
        const row = getFileRow(ctx.db, user.id, params.uploadId);
        if (!row) throw notFound();
        // A download holds a whole file in memory while it is sent: one account cannot ask for them without end.
        if (!ctx.services.rateLimit.take(`deck-download:${user.id}`, downloadsPerMinute, 60)) throw new HttpError('rate_limited', MESSAGES.tooManyDownloads, { retryAfterSeconds: 60 });
        if (row.object_key !== null) {
          // From the bucket, a piece of 512 KiB at a time as her connection takes it, like from the database. The
          // first piece is fetched before answering, so a store that does not answer is a plain "try again", not a
          // download that breaks off; the whole file's SHA-256 is checked before its last piece is sent, so a
          // changed object never arrives as if it were her file.
          if (!objects) throw storageUnavailable('download_storage_unavailable');
          const store = objects;
          const key = row.object_key;
          const size = row.original_bytes;
          const held = hold(user.id, FILE_PIECE_BYTES);
          if (!held) throw noRoomToSend();
          const hash = createHash('sha256');
          let at = 0;
          const fetchPiece = async (): Promise<Uint8Array> => {
            const piece = await store.readRange(key, at, Math.min(size, at + FILE_PIECE_BYTES) - 1);
            hash.update(piece);
            at += piece.length;
            if (at === size && hash.digest('hex') !== row.original_sha256) throw new StoreError('damaged', undefined, 'checksum');
            return piece;
          };
          const { log } = ctx;
          const failed = (err: unknown) => {
            if (err instanceof StoreError && (err.kind === 'damaged' || err.kind === 'missing')) log.error('deck_upload_file_damaged', { uploadId: row.id, where: 'object storage', kind: err.kind });
            else if (err instanceof StoreError) log.warn('deck_upload_store_failed', { during: 'download', ...storeFailure(err) });
          };
          let first: Uint8Array | null;
          try {
            first = await fetchPiece();
          } catch (err) {
            held.release();
            failed(err);
            if (err instanceof StoreError && (err.kind === 'damaged' || err.kind === 'missing')) throw new HttpError('unavailable', MESSAGES.cannotBuild, { reason: 'original_unreadable' });
            if (err instanceof StoreError) throw storageUnavailable('download_storage_unavailable');
            throw err;
          }
          const next = async (): Promise<Uint8Array | null> => {
            if (first) {
              const p = first;
              first = null;
              return p;
            }
            if (at >= size) return null;
            try {
              return await fetchPiece();
            } catch (err) {
              failed(err);
              throw err;
            }
          };
          return {
            binary: new Uint8Array(0),
            contentType: CONTENT_TYPES[row.kind],
            filename: safeFileName(row.file_name, 'slides.pptx'),
            held: { release: held.release, withinMs: sendWithinMs(size), stallMs, pieces: { bytes: size, next } },
          };
        }
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
          held: { release: held.release, withinMs: sendWithinMs(stored.size), stallMs, pieces: { bytes: stored.size, next } },
        };
      },

      /** The uploaded file with the saved changes written in. Always a .pptx that opens for editing. */
      'decks.uploads.pptx': async (ctx, { params }) => {
        const user = requireUser(ctx);
        const row = getRowWithoutReading(ctx.db, user.id, params.uploadId);
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
          // The worker checks the file against its checksum before it writes from it: it was put back together
          // from stored pieces.
          ({ pptx } = await work.write(
            async () => {
              const file = await wholeFile(ctx.db, row);
              if (!file) throw notFound();
              return file;
            },
            JSON.parse(row.edits_json) as DeckEdits,
            row.original_sha256,
            user.id
          ));
        } catch (err) {
          held.release();
          if (err instanceof HttpError) throw err;
          if (err instanceof StoreError) {
            if (err.kind === 'damaged' || err.kind === 'missing') {
              ctx.log.error('deck_upload_file_damaged', { uploadId: row.id, where: 'object storage', kind: err.kind });
              throw new HttpError('unavailable', MESSAGES.cannotBuild, { reason: 'export_failed' });
            }
            ctx.log.warn('deck_upload_store_failed', { during: 'export', ...storeFailure(err) });
            throw storageUnavailable('download_storage_unavailable');
          }
          const reason = err instanceof UploadRefused ? err.reason : err instanceof UploadWorkError ? `stopped: ${err.kind}` : 'error';
          // The stored file is not the file that was uploaded any more: that is the database's, and somebody has to look.
          if (reason === 'checksum_mismatch') ctx.log.error('deck_upload_file_damaged', { uploadId: row.id });
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
          held: { release: held.release, withinMs: sendWithinMs(pptx.length), stallMs },
        };
      },

      'decks.uploads.render': async (ctx, { params }) => {
        const user = requireUser(ctx);
        const row = getRowWithoutReading(ctx.db, user.id, params.uploadId);
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
            const { pptx } = await work.write(
              async () => {
                const file = await wholeFile(db, row);
                if (!file) throw new RenderError('failed', 'the uploaded file is gone');
                return file;
              },
              edits,
              row.original_sha256,
              user.id
            );
            const pictures = await renderer.render(pptx, edits.slides.length);
            if (pictures.length !== edits.slides.length) throw new RenderError('failed', 'page count');
            const bytes = pictures.reduce((n, p) => n + p.length, 0);
            if (bytes > pictureBytesPerAccount) throw new RenderError('failed', 'pictures larger than an account may keep');
            db.transaction(() => {
              // Only if the upload is still this account's and still at the version that was drawn.
              const still = getRowWithoutReading(db, user.id, row.id);
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
            // The bucket did not answer: like a busy place, the editor asks again later. (A file that is not what was
            // recorded is logged for somebody to look at.)
            if (err instanceof StoreError) {
              if (err.kind === 'damaged' || err.kind === 'missing') log.error('deck_upload_file_damaged', { uploadId: row.id, where: 'object storage', kind: err.kind });
              else log.warn('deck_upload_store_failed', { during: 'drawing', ...storeFailure(err) });
              return { state: err.kind === 'unavailable' ? ('busy' as const) : ('failed' as const), ...current };
            }
            // The reason is one of the renderer's or the worker's own short phrases, never text from the file.
            const kind = err instanceof RenderError ? err.kind : err instanceof UploadWorkError && err.kind === 'busy' ? 'busy' : 'failed';
            const reason = err instanceof RenderError ? err.reason : err instanceof UploadRefused ? `could not write the file (${err.reason})` : err instanceof UploadWorkError ? `could not write the file (stopped: ${err.kind})` : 'error';
            if (err instanceof UploadRefused && err.reason === 'checksum_mismatch') log.error('deck_upload_file_damaged', { uploadId: row.id });
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
            // What is remembered of accounts that have not drawn for a while is let go: none of this grows with
            // the number of accounts a server has seen.
            if (drawn.size > 512) for (const other of [...drawn.keys()]) recentDrawings(other, Date.now());
            if (lastDrawnFor.size > 4096) for (const [other, at] of [...lastDrawnFor]) if (Date.now() - at > 600_000) lastDrawnFor.delete(other);
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
        const row = getFileRow(ctx.db, requireUser(ctx).id, params.uploadId);
        if (!row) throw notFound();
        const picture = ctx.db.prepare('SELECT bytes FROM decks_upload_previews WHERE upload_id = ? AND slide_id = ?').get(row.id, params.slideId) as { bytes: Buffer } | undefined;
        if (!picture) throw new HttpError('not_found', MESSAGES.noPicture, { reason: 'preview_not_found' });
        // Pictures are counted like downloads: an editor asks for many at once, and each waits for its client.
        const held = hold(row.owner_id, picture.bytes.length);
        if (!held) throw noRoomToSend();
        return { binary: fromBlob(picture.bytes), contentType: 'image/jpeg', cacheControl: 'private, max-age=3600', held: { release: held.release, withinMs: sendWithinMs(picture.bytes.length), stallMs } };
      },
    },

    /**
     * A deleted account takes its uploads, unfinished uploads and pictures with it (PRIV-6), and every object of it
     * in the bucket, those being written included: marked here, inside the deletion's transaction, and removed by
     * the background work at once and again until each is gone.
     */
    onAccountDeleted: (deps: BaseDeps, userId) => {
      const at = deps.now().toISOString();
      const ids = deps.db.prepare('SELECT id, object_key, original_sha256, original_bytes FROM decks_uploads WHERE owner_id = ?').all(userId) as Array<{ id: string; object_key: string | null; original_sha256: string; original_bytes: number }>;
      for (const u of ids) {
        deps.db.prepare('DELETE FROM decks_upload_previews WHERE upload_id = ?').run(u.id);
        if (u.object_key) markRemoving(deps.db, { key: u.object_key, ownerId: userId, uploadId: u.id, sha256: u.original_sha256, bytes: u.original_bytes }, false, at);
      }
      deps.db.prepare("UPDATE decks_upload_objects SET state = 'removing', next_try_at = ?, updated_at = ? WHERE owner_id = ? AND state <> 'removing'").run(at, at, userId);
      deps.db.prepare('DELETE FROM decks_uploads WHERE owner_id = ?').run(userId);
      const sessions = deps.db.prepare('SELECT id FROM decks_upload_sessions WHERE owner_id = ?').all(userId) as Array<{ id: string }>;
      for (const s of sessions) dropSession(deps.db, s.id);
      sweepFiles(deps.db);
      // After the deletion's transaction has been committed.
      setImmediate(() => kick());
    },
    /**
     * Two accounts of one teacher joined: the uploads follow. Their objects keep their names (under the account
     * that uploaded them); the name is only where the bytes are, and who may have them is the database's.
     */
    onAccountMerged: (deps: BaseDeps, fromUserId, toUserId) => {
      deps.db.prepare('UPDATE decks_uploads SET owner_id = ? WHERE owner_id = ?').run(toUserId, fromUserId);
      deps.db.prepare('UPDATE decks_upload_sessions SET owner_id = ? WHERE owner_id = ?').run(toUserId, fromUserId);
      deps.db.prepare('UPDATE decks_upload_objects SET owner_id = ? WHERE owner_id = ?').run(toUserId, fromUserId);
    },
    /** Unfinished uploads do not linger; objects still to be removed are removed; files still in the database move to the bucket. */
    start: (deps) => {
      moduleLog = deps.log;
      // Where files are kept, said once at start (never the endpoint: it names the account; never a key).
      if (storageSetting.kind === 'r2') deps.log.info('deck_upload_storage', { where: 'object storage', bucket: storageSetting.settings.bucket, prefix: objectPrefix || '(none)', region: storageSetting.settings.region });
      else if (storageSetting.kind === 'database') deps.log.info('deck_upload_storage', { where: 'database', note: 'a developer machine: no TALA_R2_* setting' });
      else deps.log.error('deck_upload_storage_off', { problems: storageOff.join('; '), effect: 'no uploads are taken, and files already in object storage cannot be fetched, until this is put right' });
      // The key file is read once now, so that a file this server cannot read is in the log at start, not at the
      // first teacher's upload (the problem is logged by the reader; nothing here is a value).
      try {
        (keys as CredentialSource | null)?.current();
      } catch {
        /* logged as deck_upload_storage_keys_unusable */
      }
      let stopped = false;
      let working = false;
      let saidStillDown = 0;
      /** Legacy files that could not be moved because they are not what was recorded: said once, left in place. */
      const unmovable = new Set<string>();
      const at = () => deps.now().toISOString();
      const removeDue = async () => {
        if (!objects) return;
        // A write that has been "writing" for a quarter of an hour belongs to a request that is long gone (a crash).
        deps.db
          .prepare("UPDATE decks_upload_objects SET state = 'removing', uncertain = 1, next_try_at = ?, updated_at = ? WHERE state = 'writing' AND updated_at < ?")
          .run(at(), at(), new Date(deps.now().getTime() - 15 * 60_000).toISOString());
        const due = deps.db
          .prepare("SELECT key, upload_id, uncertain, attempts FROM decks_upload_objects WHERE state = 'removing' AND next_try_at <= ? ORDER BY next_try_at LIMIT 25")
          .all(at()) as Array<{ key: string; upload_id: string; uncertain: number; attempts: number }>;
        for (const o of due) {
          if (stopped) return;
          try {
            await objects.remove(o.key);
          } catch (err) {
            if (stopped) return;
            // Resting after a failure a moment ago: nothing was asked, so nothing is counted; the next run tries.
            if (err instanceof StoreError && err.code === 'resting') return;
            const attempts = o.attempts + 1;
            const waitMs = Math.min(30_000 * 2 ** Math.min(attempts, 7), 3_600_000);
            deps.db.prepare('UPDATE decks_upload_objects SET attempts = ?, next_try_at = ?, updated_at = ? WHERE key = ?').run(attempts, new Date(deps.now().getTime() + waitMs).toISOString(), at(), o.key);
            if (attempts === 1 || attempts % 10 === 0) deps.log.warn('deck_upload_object_removal_waiting', { uploadId: o.upload_id, attempts, ...(err instanceof StoreError ? storeFailure(err) : { kind: 'error' }) });
            if (err instanceof StoreError && err.kind === 'unavailable') return;
            continue;
          }
          if (stopped) return;
          if (o.uncertain) {
            // A write whose answer was lost may still land after this removal: once more, ten minutes from now.
            deps.db.prepare("UPDATE decks_upload_objects SET uncertain = 0, attempts = 0, next_try_at = ?, updated_at = ? WHERE key = ? AND state = 'removing'").run(new Date(deps.now().getTime() + 10 * 60_000).toISOString(), at(), o.key);
          } else deps.db.prepare("DELETE FROM decks_upload_objects WHERE key = ? AND state = 'removing'").run(o.key);
          deps.log.info('deck_upload_object_removed', { uploadId: o.upload_id, again: o.uncertain === 1 });
        }
      };
      /** One file still kept in the database (an older database, or one from a developer machine) moves to the bucket. */
      const carryOver = async () => {
        if (!objects) return;
        const legacy = (deps.db.prepare('SELECT id, owner_id, original_sha256, original_bytes FROM decks_uploads WHERE object_key IS NULL ORDER BY created_at, rowid').all() as Array<{ id: string; owner_id: string; original_sha256: string; original_bytes: number }>).find((u) => !unmovable.has(u.id));
        if (!legacy) return;
        const run = work.exclusive ?? (<T>(_who: string, job: () => Promise<T>) => job());
        await run('server:carry-over', async () => {
          if (stopped) return;
          const file = fileOf(deps.db, legacy.original_sha256);
          if (!file || file.length !== legacy.original_bytes || sha256Hex(file) !== legacy.original_sha256) {
            unmovable.add(legacy.id);
            deps.log.error('deck_upload_file_damaged', { uploadId: legacy.id, where: 'database', effect: 'left where it is, not moved' });
            return;
          }
          const ref = { key: keyFor(legacy.owner_id, legacy.id), ownerId: legacy.owner_id, uploadId: legacy.id, sha256: legacy.original_sha256 };
          try {
            await putChecked(deps.db, deps.log, { ...ref, file }, at);
          } catch (err) {
            if (!stopped) deps.log.warn('deck_upload_carry_over_waiting', { uploadId: legacy.id, ...(err instanceof StoreError ? storeFailure(err) : { kind: 'error' }) });
            return;
          }
          if (stopped) return;
          deps.db.transaction(() => {
            // Deleted while it was being written: the object goes too.
            if (deps.db.prepare('UPDATE decks_uploads SET object_key = ? WHERE id = ? AND object_key IS NULL').run(ref.key, legacy.id).changes !== 1) {
              markRemoving(deps.db, { ...ref, bytes: file.length }, false, at());
              return;
            }
            deps.db.prepare("UPDATE decks_upload_objects SET state = 'stored', uncertain = 0, updated_at = ? WHERE key = ? AND state = 'writing'").run(at(), ref.key);
            // Its pieces go only now that the object has been read back, and only when no upload still kept in
            // the database needs the same bytes.
            sweepFiles(deps.db);
          })();
          deps.log.info('deck_upload_carried_over', { uploadId: legacy.id, bytes: legacy.original_bytes });
        });
      };
      const work_ = async () => {
        if (working || stopped || !objects) return;
        working = true;
        try {
          await removeDue();
          if (!stopped) await carryOver();
          const h = objects.health();
          if (!stopped && h.down && h.downSince !== null && Date.now() - saidStillDown > 5 * 60_000 && Date.now() - h.downSince > 60_000) {
            saidStillDown = Date.now();
            const count = (sql: string) => (deps.db.prepare(sql).get() as { n: number }).n;
            deps.log.warn('deck_upload_storage_still_unavailable', {
              downMinutes: Math.round((Date.now() - h.downSince) / 60_000),
              removalsWaiting: count("SELECT COUNT(*) AS n FROM decks_upload_objects WHERE state = 'removing'"),
              filesStillInDatabase: count('SELECT COUNT(*) AS n FROM decks_uploads WHERE object_key IS NULL'),
              effect: 'new uploads and downloads of uploaded files are refused with "try again"; deletes are recorded and carried out when the store answers',
            });
          }
        } catch (err) {
          if (!stopped && !(err instanceof UploadWorkError)) deps.log.error('deck_upload_storage_work_failed', { error: err instanceof Error ? err.name : 'error' });
        } finally {
          working = false;
        }
      };
      kick = () => {
        if (!stopped) setImmediate(() => void work_());
      };
      const storageTimer = setInterval(() => void work_(), storageTickMs);
      storageTimer.unref?.();
      kick();
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
      return () => {
        stopped = true;
        kick = () => {};
        clearInterval(storageTimer);
        clearInterval(timer);
      };
    },
  };
}
