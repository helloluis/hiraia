/**
 * Pure helpers for "My own slides" (no React, no I/O): how an uploaded file and the teacher's differences from it
 * make the slides she sees, and the few things she can do to them. The uploaded file (`base`) never changes;
 * every operation returns a new list of differences.
 */
import { UPLOAD_LIMITS } from '@hiraia/tala-core/contracts';
import type { UploadBlock, UploadedDeck, UploadSlide, UploadSlideEdit } from '@hiraia/tala-core/contracts';
import type { StringKey } from '@/i18n/en';

export type UploadBase = UploadedDeck['base'];

/** One slide as the teacher has it now. */
export interface UploadSlideView {
  /** Id in the teacher's version (`s…` for a slide of the file, `c…` for a copy). */
  id: string;
  /** The slide of the uploaded file this one is or was copied from. */
  source: UploadSlide;
  isCopy: boolean;
  title: string;
  /** Text blocks with the words as they are now. */
  blocks: Array<UploadBlock & { changed: boolean }>;
  notes: { paragraphs: string[]; editable: boolean; changed: boolean };
  /** Words or notes differ from the file, or the slide is a copy. */
  changed: boolean;
}

const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** The teacher's slides, in her order. Edits naming a slide the file does not have are ignored. */
export function slidesView(base: UploadBase, edits: UploadSlideEdit[]): UploadSlideView[] {
  const byId = new Map(base.slides.map((s) => [s.id, s]));
  const out: UploadSlideView[] = [];
  for (const e of edits) {
    const source = byId.get(e.source);
    if (!source) continue;
    const blocks = source.blocks.map((b) => {
      const mine = e.text?.[b.id];
      const changed = mine !== undefined && !same(mine, b.paragraphs);
      return { ...b, paragraphs: changed ? mine! : b.paragraphs, changed };
    });
    const notesChanged = e.notes !== undefined && !same(e.notes.length ? e.notes : [''], source.notes.paragraphs.length ? source.notes.paragraphs : ['']);
    const titleBlock = blocks.find((b) => b.role === 'title') ?? blocks.find((b) => b.paragraphs.some((p) => p.trim()));
    const isCopy = e.id !== e.source;
    out.push({
      id: e.id,
      source,
      isCopy,
      title: (titleBlock?.paragraphs.join(' ') ?? '').replace(/\s+/g, ' ').trim(),
      blocks,
      notes: { paragraphs: notesChanged ? e.notes! : source.notes.paragraphs, editable: source.notes.editable, changed: notesChanged },
      changed: isCopy || notesChanged || blocks.some((b) => b.changed),
    });
  }
  return out;
}

const clip = (text: string) => (text.length > UPLOAD_LIMITS.paragraphChars ? text.slice(0, UPLOAD_LIMITS.paragraphChars) : text);

/** Change the paragraphs of one block. Setting them back to the file's words removes the difference. */
export function setBlockText(base: UploadBase, edits: UploadSlideEdit[], slideId: string, blockId: string, paragraphs: string[]): UploadSlideEdit[] {
  return edits.map((e) => {
    if (e.id !== slideId) return e;
    const block = base.slides.find((s) => s.id === e.source)?.blocks.find((b) => b.id === blockId);
    if (!block || !block.editable) return e;
    const next = (paragraphs.length ? paragraphs : ['']).slice(0, UPLOAD_LIMITS.paragraphsPerBlock).map(clip);
    const text = { ...(e.text ?? {}) };
    if (same(next, block.paragraphs)) delete text[blockId];
    else text[blockId] = next;
    const out: UploadSlideEdit = { id: e.id, source: e.source };
    if (Object.keys(text).length) out.text = text;
    if (e.notes !== undefined) out.notes = e.notes;
    return out;
  });
}

/** Change a slide's notes (one string per paragraph). */
export function setNotes(base: UploadBase, edits: UploadSlideEdit[], slideId: string, paragraphs: string[]): UploadSlideEdit[] {
  return edits.map((e) => {
    if (e.id !== slideId) return e;
    const source = base.slides.find((s) => s.id === e.source);
    if (!source?.notes.editable) return e;
    const next = paragraphs.slice(0, UPLOAD_LIMITS.paragraphsPerBlock).map(clip);
    const was = source.notes.paragraphs.length ? source.notes.paragraphs : [''];
    const out: UploadSlideEdit = { id: e.id, source: e.source };
    if (e.text) out.text = e.text;
    if (!same(next.length ? next : [''], was)) out.notes = next;
    return out;
  });
}

/** Notes as one text for a text box, and back: one line per paragraph. */
export const notesToText = (paragraphs: string[]): string => paragraphs.join('\n');
export const textToNotes = (text: string): string[] => {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  while (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
};

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
/** `c` + 8 random [a-z0-9], never one already in the deck. */
export function newCopyId(taken: Iterable<string>, random: () => number = Math.random): string {
  const used = new Set(taken);
  for (;;) {
    let id = 'c';
    for (let i = 0; i < 8; i++) id += ALPHABET[Math.floor(random() * ALPHABET.length) % ALPHABET.length];
    if (!used.has(id)) return id;
  }
}

/** Why a slide cannot be copied here, or null when it can. */
export function copyBlocker(base: UploadBase, edits: UploadSlideEdit[], slideId: string): 'linked_content' | 'too_many' | null {
  const e = edits.find((x) => x.id === slideId);
  const source = e && base.slides.find((s) => s.id === e.source);
  if (!source) return 'linked_content';
  if (source.duplicateBlockers.length) return 'linked_content';
  return edits.length >= UPLOAD_LIMITS.slides ? 'too_many' : null;
}

/** A copy of a slide right after it, with the words it has now. */
export function copySlide(base: UploadBase, edits: UploadSlideEdit[], slideId: string, id: string): { edits: UploadSlideEdit[]; index: number } | null {
  const at = edits.findIndex((e) => e.id === slideId);
  if (at < 0 || copyBlocker(base, edits, slideId)) return null;
  const src = edits[at]!;
  const copy: UploadSlideEdit = { id, source: src.source };
  if (src.text) copy.text = Object.fromEntries(Object.entries(src.text).map(([k, v]) => [k, [...v]]));
  if (src.notes) copy.notes = [...src.notes];
  const next = edits.slice();
  next.splice(at + 1, 0, copy);
  return { edits: next, index: at + 1 };
}

export const canRemove = (edits: UploadSlideEdit[]): boolean => edits.length > 1;

export function removeSlide(edits: UploadSlideEdit[], slideId: string): { edits: UploadSlideEdit[]; index: number } | null {
  const at = edits.findIndex((e) => e.id === slideId);
  if (at < 0 || !canRemove(edits)) return null;
  const next = edits.filter((e) => e.id !== slideId);
  return { edits: next, index: Math.min(at, next.length - 1) };
}

export const canMove = (edits: UploadSlideEdit[], slideId: string, dir: -1 | 1): boolean => {
  const at = edits.findIndex((e) => e.id === slideId);
  return at >= 0 && at + dir >= 0 && at + dir < edits.length;
};

export function moveSlide(edits: UploadSlideEdit[], slideId: string, dir: -1 | 1): { edits: UploadSlideEdit[]; index: number } | null {
  if (!canMove(edits, slideId, dir)) return null;
  const at = edits.findIndex((e) => e.id === slideId);
  const next = edits.slice();
  const [s] = next.splice(at, 1);
  next.splice(at + dir, 0, s!);
  return { edits: next, index: at + dir };
}

/** Put a slide's words and notes back to the file's. */
export function restoreSlide(edits: UploadSlideEdit[], slideId: string): UploadSlideEdit[] {
  return edits.map((e) => (e.id === slideId ? { id: e.id, source: e.source } : e));
}

/** Slides of the file that are no longer in the teacher's version (removed, and not kept as a copy either). */
export function removedSlides(base: UploadBase, edits: UploadSlideEdit[]): UploadSlide[] {
  const used = new Set(edits.map((e) => e.source));
  return base.slides.filter((s) => !used.has(s.id));
}

/** Put a removed slide back, at the end. */
export function bringBack(edits: UploadSlideEdit[], slide: UploadSlide): UploadSlideEdit[] {
  return edits.some((e) => e.id === slide.id) ? edits : [...edits, { id: slide.id, source: slide.id }];
}

export const sameEdits = (a: UploadSlideEdit[], b: UploadSlideEdit[]): boolean => a === b || JSON.stringify(a) === JSON.stringify(b);

/** Things in the file that Tala only carries along, in the order a teacher would care about. */
export const KEPT_ORDER = [
  'chart',
  'diagram',
  'video',
  'audio',
  'animation',
  'transition',
  'embedded',
  'equation',
  'special',
  'ink',
  'graphic',
  'readOnlyText',
  'comments',
  'hiddenSlide',
  'sections',
  'customShow',
  'embeddedFont',
  'externalLink',
  'linkedFile',
  'customXml',
] as const;
export type KeptFeature = (typeof KEPT_ORDER)[number];

/** The kept things of a deck that are worth telling a teacher about (links and housekeeping parts are not). */
export function keptFeatures(base: UploadBase): Array<{ feature: KeptFeature; count: number; slides: number[] }> {
  const quiet = new Set(['externalLink', 'customXml', 'sections', 'noNotesPage']);
  return KEPT_ORDER.flatMap((feature) => {
    const f = base.features.find((x) => x.feature === feature);
    return f && !quiet.has(feature) ? [{ feature, count: f.count, slides: f.slides.filter((n) => n > 0) }] : [];
  });
}

/** Sizes for people: "3.4 MB". */
export function megabytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 10 ? String(Math.round(mb)) : mb >= 0.1 ? mb.toFixed(1) : '0.1';
}

/* ---------------- unsaved work kept on the device ---------------- */

export interface UploadDraft {
  v: 1;
  uploadId: string;
  baseRev: number;
  at: string;
  title: string;
  slides: UploadSlideEdit[];
}
interface Storage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
const draftKey = (id: string) => `tala.upload-draft.${id}`;

export function readUploadDraft(storage: Storage | null, uploadId: string): UploadDraft | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(draftKey(uploadId));
    if (!raw) return null;
    const d = JSON.parse(raw) as UploadDraft;
    return d?.v === 1 && d.uploadId === uploadId && Array.isArray(d.slides) && d.slides.length > 0 && typeof d.baseRev === 'number' ? d : null;
  } catch {
    return null;
  }
}
/** False when the device refused (storage full, private mode): the caller must not claim the work is kept. */
export function writeUploadDraft(storage: Storage | null, draft: UploadDraft): boolean {
  if (!storage) return false;
  try {
    storage.setItem(draftKey(draft.uploadId), JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}
export function clearUploadDraft(storage: Storage | null, uploadId: string): void {
  try {
    storage?.removeItem(draftKey(uploadId));
  } catch {
    /* nothing to clear */
  }
}

/* ---------------- why a file was not taken ---------------- */

/** Plain words for a refusal: the server's stable reason, in the teacher's language. */
export function refusalKey(reason: string | null): StringKey {
  const key = `up.no.${reason ?? 'other'}`;
  return (KNOWN.has(key) ? key : 'up.no.other') as StringKey;
}
const KNOWN = new Set(
  [
    'not_a_zip', 'old_powerpoint', 'password_protected', 'pdf', 'empty', 'zip_bomb', 'not_a_presentation', 'wrong_office_file', 'macros', 'active_content', 'strict_ooxml',
    'signed', 'unsafe_part_name', 'damaged', 'too_many_parts', 'too_many_slides', 'too_large', 'no_slides', 'unreadable_text', 'wrong_extension', 'checksum_mismatch', 'quota',
    'email_not_verified', 'rate_limited', 'other',
  ].map((r) => `up.no.${r}`)
);
