/**
 * A teacher's own PowerPoint file, uploaded to edit in Tala ("My own slides").
 *
 * The uploaded file is kept exactly as it arrived and is never changed. What the teacher edits is a small list of
 * differences (changed words, changed notes, slide order, copies, removals) stored beside it; the file she
 * downloads is the uploaded one with those differences written in (packages/tala-core/src/pptx). An upload is
 * private to the account that made it: there is no sharing, and every read, write, picture and download is checked
 * against the owner on the server.
 *
 * Tala does not pretend to understand everything in a PowerPoint file. `base.features` counts what is in the file
 * that this version only carries along (charts, diagrams, animations, video…), so the screen can say so plainly.
 *
 * OWNER: teacher slide uploads (branch tala-v1-teacher-uploads; docs/tala/teacher-uploads).
 */
import { z } from 'zod';
import { Id, IsoDateTime } from './common';

export const UPLOAD_LIMITS = {
  /** Largest file accepted. The server may be configured lower. */
  fileBytes: 30 * 1024 * 1024,
  /** Bytes of the file sent per request (before base64): small enough for a weak connection and the JSON body limit. */
  chunkBytes: 512 * 1024,
  fileName: 160,
  title: 160,
  slides: 400,
  blocksPerSlide: 600,
  paragraphsPerBlock: 400,
  paragraphChars: 8000,
  /** Uploads one account may keep, and their total size. */
  uploadsPerAccount: 40,
  bytesPerAccount: 200 * 1024 * 1024,
} as const;

const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);

/** A rectangle in fractions of the slide. */
export const UploadBox = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });

export const UploadBlock = z.object({
  /** `b<n>`: the block's place in the uploaded slide. Stable, because the uploaded file never changes. */
  id: z.string().regex(/^b\d{1,4}$/),
  role: z.enum(['title', 'subtitle', 'body', 'text', 'cell']),
  name: z.string().max(120),
  /** One string per paragraph; a line break inside a paragraph is "\n". */
  paragraphs: z.array(z.string()),
  /** False for text Tala shows but does not change (a date or slide-number field, maths). */
  editable: z.boolean(),
  box: UploadBox.nullable(),
});
export type UploadBlock = z.infer<typeof UploadBlock>;

export const UploadKeptKind = z.enum(['picture', 'chart', 'diagram', 'table', 'embedded', 'video', 'audio', 'equation', 'special', 'ink', 'graphic', 'footer']);

export const UploadSlide = z.object({
  /** `s<number>` from the file's own slide list. */
  id: z.string().regex(/^s\d{1,10}$/),
  /** 1-based position in the uploaded file. */
  number: z.number().int().min(1),
  title: z.string(),
  hidden: z.boolean(),
  layoutName: z.string(),
  blocks: z.array(UploadBlock),
  /** Things on the slide that are kept exactly as they are. */
  objects: z.array(z.object({ kind: UploadKeptKind, name: z.string(), box: UploadBox.nullable() })),
  notes: z.object({ exists: z.boolean(), paragraphs: z.array(z.string()), editable: z.boolean() }),
  /** Empty when the slide can be copied; otherwise the kinds of linked content that stop it. */
  duplicateBlockers: z.array(z.string()),
  animations: z.boolean(),
  transition: z.boolean(),
});
export type UploadSlide = z.infer<typeof UploadSlide>;

export const UploadFeature = z.object({
  feature: z.string(),
  count: z.number().int(),
  /** 1-based slide numbers in the uploaded file (0 = the deck as a whole). */
  slides: z.array(z.number().int()),
});
export type UploadFeature = z.infer<typeof UploadFeature>;

/** One slide of the teacher's version: an uploaded slide (possibly with changed words) or a copy of one. */
export const UploadSlideEdit = z.object({
  id: z.string().regex(/^(s\d{1,10}|c[a-z0-9]{4,16})$/),
  source: z.string().regex(/^s\d{1,10}$/),
  /** Changed blocks only: block id → its paragraphs. */
  text: z
    .record(z.string().regex(/^b\d{1,4}$/), z.array(z.string().max(UPLOAD_LIMITS.paragraphChars)).max(UPLOAD_LIMITS.paragraphsPerBlock))
    .optional(),
  /** Changed speaker notes, one string per paragraph. */
  notes: z.array(z.string().max(UPLOAD_LIMITS.paragraphChars)).max(UPLOAD_LIMITS.paragraphsPerBlock).optional(),
});
export type UploadSlideEdit = z.infer<typeof UploadSlideEdit>;

export const UploadedDeckSummary = z.object({
  id: Id,
  title: z.string(),
  fileName: z.string(),
  kind: z.enum(['presentation', 'template', 'slideshow']),
  /** Slides in the teacher's version now. */
  slideCount: z.number().int(),
  /** Slides that differ from the uploaded file (changed words or notes, and copies). */
  changedSlides: z.number().int(),
  /** Size of the uploaded file. */
  bytes: z.number().int(),
  rev: z.number().int(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type UploadedDeckSummary = z.infer<typeof UploadedDeckSummary>;

export const UploadedDeck = UploadedDeckSummary.extend({
  originalSha256: Sha256,
  /** Slide size in EMU (914400 per inch). */
  size: z.object({ cx: z.number(), cy: z.number() }),
  /** The file as uploaded: never changed by a save. */
  base: z.object({
    slides: z.array(UploadSlide),
    features: z.array(UploadFeature),
    totals: z.object({ slides: z.number().int(), textBlocks: z.number().int(), editableBlocks: z.number().int(), slidesWithEditableText: z.number().int(), parts: z.number().int() }),
  }),
  /** The teacher's version, as differences from the file. */
  edits: z.object({ slides: z.array(UploadSlideEdit).min(1).max(UPLOAD_LIMITS.slides) }),
  /**
   * Pictures of the slides. `available`: this server can draw them. `rev`: the saved version the stored pictures
   * show (null when there are none); when it is older than `rev` the pictures are behind the words.
   */
  previews: z.object({ available: z.boolean(), rev: z.number().int().nullable(), slideIds: z.array(z.string()) }),
});
export type UploadedDeck = z.infer<typeof UploadedDeck>;

export const UploadedDeckList = z.object({
  decks: z.array(UploadedDeckSummary),
  /** What this account may still upload. */
  allowance: z.object({ fileBytes: z.number().int(), remainingBytes: z.number().int(), remainingUploads: z.number().int() }),
});
export type UploadedDeckList = z.infer<typeof UploadedDeckList>;

/* ---------- sending the file: in pieces, so a dropped connection resumes instead of starting again ---------- */

export const UploadBeginRequest = z.object({
  fileName: z.string().min(1).max(UPLOAD_LIMITS.fileName),
  bytes: z.number().int().min(1).max(UPLOAD_LIMITS.fileBytes),
  /** SHA-256 of the whole file, computed on the device: the server checks it before reading the file. */
  sha256: Sha256,
});
export type UploadBeginRequest = z.infer<typeof UploadBeginRequest>;

export const UploadSession = z.object({
  sessionId: Id,
  chunkBytes: z.number().int(),
  chunkCount: z.number().int(),
  /** Indexes of the pieces the server already holds (a resumed upload sends only the others). */
  received: z.array(z.number().int()),
  expiresAt: IsoDateTime,
});
export type UploadSession = z.infer<typeof UploadSession>;

export const UploadChunkRequest = z.object({
  /** One piece of the file, base64. Every piece but the last is exactly `chunkBytes` long. */
  data: z.string().min(1).max(Math.ceil((UPLOAD_LIMITS.chunkBytes * 4) / 3) + 8),
});
export const UploadChunkResult = z.object({ received: z.number().int(), complete: z.boolean() });

export const UploadSaveRequest = z.object({
  /** The rev this edit started from; a different stored rev answers `conflict` unless `force`. */
  baseRev: z.number().int().min(1),
  title: z.string().max(UPLOAD_LIMITS.title).optional(),
  slides: z.array(UploadSlideEdit).min(1).max(UPLOAD_LIMITS.slides),
  force: z.boolean().default(false),
});
export type UploadSaveRequest = z.infer<typeof UploadSaveRequest>;

export const UploadSaveResult = z.object({ rev: z.number().int(), updatedAt: IsoDateTime, changedSlides: z.number().int(), slideCount: z.number().int() });
export type UploadSaveResult = z.infer<typeof UploadSaveResult>;

export const UploadRenderResult = z.object({
  /** `ready`: pictures for `rev` are stored. `unavailable`: this server does not draw pictures. `failed`: it tried and could not. `busy`: try again shortly. */
  state: z.enum(['ready', 'unavailable', 'failed', 'busy']),
  rev: z.number().int().nullable(),
  slideIds: z.array(z.string()),
});
export type UploadRenderResult = z.infer<typeof UploadRenderResult>;

/** Why a file was not taken (`error.details.reason` of a refused upload). The screen has plain words for each. */
export const UPLOAD_REFUSALS = [
  'not_a_zip',
  'old_powerpoint',
  'password_protected',
  'pdf',
  'empty',
  'zip_bomb',
  'not_a_presentation',
  'wrong_office_file',
  'macros',
  'active_content',
  'strict_ooxml',
  'signed',
  'unsafe_part_name',
  'damaged',
  'too_many_parts',
  'too_many_slides',
  'too_large',
  'no_slides',
  'unreadable_text',
  'wrong_extension',
  'checksum_mismatch',
  'quota',
] as const;
export type UploadRefusalReason = (typeof UPLOAD_REFUSALS)[number];
