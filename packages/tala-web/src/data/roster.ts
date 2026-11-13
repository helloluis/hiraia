/**
 * Roster import (PRD §12) on the client: file/paste → server draft → mandatory review → students written through
 * the sync engine as one operation. Only the allow-listed student fields exist (PRIV-1); the server discards the
 * rest before storage and tells us which columns were dropped (PRIV-2).
 */
import type { RosterImportDraft, RosterProposed, RosterRow, Student, SyncEngine } from '@hiraia/tala-core/contracts';
import { z } from 'zod';
import type { RosterConfirmRequest, RosterResolution } from '@hiraia/tala-core/contracts';

export type Resolution = z.infer<typeof RosterResolution>;
export type ConfirmBody = z.input<typeof RosterConfirmRequest>;

export const TEXT_EXTENSIONS = ['txt', 'csv', 'tsv'];
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

export function extensionOf(name: string): string {
  return (name.split('.').pop() ?? '').toLowerCase();
}

/** Read a chosen file: text formats as text (encoding handled server-side too), binary formats as base64. */
export async function readRosterFile(file: File): Promise<{ text?: string; contentBase64?: string }> {
  if (file.size > MAX_FILE_BYTES) throw new Error('too_big');
  const buf = await file.arrayBuffer();
  if (TEXT_EXTENSIONS.includes(extensionOf(file.name))) return { contentBase64: toBase64(buf) };
  return { contentBase64: toBase64(buf) };
}

export function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export interface RowGroups {
  needsReview: RosterRow[];
  changed: RosterRow[];
  clean: RosterRow[];
  notStudents: RosterRow[];
}

export function groupRows(rows: RosterRow[]): RowGroups {
  return {
    needsReview: rows.filter(r => r.status === 'needs_review'),
    changed: rows.filter(r => r.status === 'changed'),
    clean: rows.filter(r => r.status === 'clean'),
    notStudents: rows.filter(r => r.status === 'not_student'),
  };
}

/** The import cannot be saved while a needs-review row is unresolved (§12.3.5) — unless the teacher saves only the resolved ones. */
export function unresolvedRows(draft: RosterImportDraft, resolutions: Map<number, Resolution>): RosterRow[] {
  return draft.rows.filter(r => r.status === 'needs_review' && !resolutions.has(r.rowIndex));
}

export function buildConfirm(draft: RosterImportDraft, resolutions: Map<number, Resolution>, opts: { acceptAllChanged: boolean; defaultGradeGroupId: string | null; idempotencyKey: string; onlyResolved: boolean }): ConfirmBody {
  const list = [...resolutions.values()];
  // Clean rows are accepted implicitly by the server; changed rows need the explicit bulk acceptance or a resolution.
  if (!opts.onlyResolved) {
    for (const r of draft.rows) if (r.status === 'clean' && !resolutions.has(r.rowIndex)) list.push({ rowIndex: r.rowIndex, action: 'accept' });
  }
  return { idempotencyKey: opts.idempotencyKey, resolutions: list, acceptAllChanged: opts.acceptAllChanged, defaultGradeGroupId: opts.defaultGradeGroupId };
}

export function proposedToStudent(p: RosterProposed & { gradeGroupId: string | null }, classId: string, order: number, importId: string, newId: () => string): Student {
  return {
    id: newId(),
    classId,
    gradeGroupId: p.gradeGroupId,
    displayName: p.displayName || [p.givenName, p.middleName, p.familyName, p.suffix].filter(Boolean).join(' '),
    familyName: p.familyName,
    givenName: p.givenName,
    middleName: p.middleName,
    suffix: p.suffix,
    sex: p.sex,
    localId: p.localId,
    order,
    importId,
  };
}

/** Write the confirmed students as one durable operation (PRIV, OFF-4). */
export async function saveStudents(engine: SyncEngine, students: Student[]): Promise<void> {
  if (students.length) await engine.batch(students.map(s => ({ op: 'put' as const, entity: 'student' as const, data: s })));
}

export function flagsToKeys(row: RosterRow): string[] {
  return row.flags.length ? row.flags : row.status === 'needs_review' ? ['uncertain_split'] : [];
}

export function emptyProposed(): RosterProposed {
  return { displayName: '', familyName: '', givenName: '', middleName: '', suffix: '', sex: null, grade: null, localId: null };
}
