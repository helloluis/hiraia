/**
 * Rewriting one part of a lesson with AI (RegenSheet): the checks that keep it from failing silently (pure: no React).
 *
 * Luis, 27 Nov 2026: the Materials "Rewrite with AI" button did nothing visible and showed no error. Every Materials
 * rewrite on production had "finished" with an EMPTY list, because materials may only name what the class has listed
 * (PRD rule, prompts and server check) and setup never asks for it, so the empty list was written over the section as a
 * success. Now: a missing prerequisite is said before anything is sent, and an empty answer is never applied.
 */
import { classResources, sectionHasContent } from '@hiraia/tala-core/generation';
import { TalaApiError, type ClassRecord, type GenerationJob } from '@hiraia/tala-core/contracts';

/** What has to be in place before this part can be rewritten (null: nothing missing). */
export type RegenBlocker = 'no_class_resources' | null;

export function regenBlocker(sectionKey: string, cls: Pick<ClassRecord, 'profile'> | null): RegenBlocker {
  if (sectionKey !== 'materials') return null;
  return classResources(cls?.profile ?? { materials: [], textbooks: [] }).length ? null : 'no_class_resources';
}

/** Materials a teacher types (commas or new lines), as the Class page stores them: trimmed, no repeats, within limits. */
export function parseResources(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[,\n]/)) {
    const item = raw.trim().replace(/\s+/g, ' ').slice(0, 120);
    if (!item || seen.has(item.toLowerCase())) continue;
    seen.add(item.toLowerCase());
    out.push(item);
    if (out.length === 60) break;
  }
  return out;
}

/** A finished job may only be applied when the requested part came back with something in it. */
export function usableResult(job: GenerationJob, sectionKey: string): boolean {
  if (job.status !== 'done' || !job.result) return false;
  return sectionHasContent(job.result.sections.find((s) => s.key === sectionKey)?.content);
}

/** A specific message for errors the generic mapping would make vague (the server's own prerequisite check). */
export function regenErrorKey(err: unknown): 'gen.materials.needResources' | null {
  if (
    err instanceof TalaApiError &&
    err.code === 'invalid_input' &&
    (err.details as { reason?: string } | undefined)?.reason === 'no_class_resources'
  )
    return 'gen.materials.needResources';
  return null;
}
