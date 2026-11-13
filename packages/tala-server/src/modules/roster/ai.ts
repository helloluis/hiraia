import { z } from 'zod';
import { RosterProposed, RosterField, type RosterImportDraft, type RosterRow, type LlmRoute } from '@hiraia/tala-core';
import { fieldForHeader, nameFields, safeNameCell, traceable } from '@hiraia/tala-core/roster';
import type { Ctx } from '../../kernel/types';
import { HttpError } from '../../kernel/types';

export function aiRoute(ctx: Ctx, useAi: boolean, acknowledged: boolean): LlmRoute {
  if (!useAi || !ctx.config.features.rosterAi) return 'rules';
  const routes = ['roster.columns', 'roster.names'].map(f => ctx.services.llm.routeFor(f as 'roster.columns' | 'roster.names'));
  if (ctx.config.environment === 'production' && routes.includes('cloud')) return 'rules';
  if (routes.includes('cloud') && !acknowledged) throw new HttpError('invalid_input', 'Please acknowledge the early-access cloud AI notice, or choose Clean without AI.');
  return routes.includes('cloud') ? 'cloud' : routes.includes('local') ? 'local' : routes.includes('rules') ? 'rules' : 'off';
}
const NameOutput = z.object({ rows: z.array(z.object({ rowIndex: z.number().int(), proposed: RosterProposed.strict() }).strict()).max(500) }).strict();
const ColumnOutput = z.object({ columns: z.array(z.object({ index: z.number().int().min(0).max(99), field: RosterField }).strict()).max(100) }).strict();
function flag(row: RosterRow, value: RosterRow['flags'][number]): void {
  if (!row.flags.includes(value)) row.flags.push(value);
  row.status = 'needs_review';
}
/** Each invocation is bounded even with a faulty gateway that ignores its abort signal. */
async function bounded<T>(call: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const abort = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([call(abort.signal), new Promise<never>((_, reject) => { timer = setTimeout(() => { abort.abort(); reject(new Error('timeout')); }, 12000); })]); }
  finally { clearTimeout(timer); abort.abort(); }
}
export async function assistDraft(ctx: Ctx, draft: RosterImportDraft): Promise<void> {
  if (draft.route !== 'cloud' && draft.route !== 'local') return;
  if (ctx.config.environment === 'production' && draft.route === 'cloud') return;
  // Only canonical known header labels, never arbitrary first-row text or metadata.
  // Samples are fully masked, a stricter minimisation policy than pattern masking.
  if (draft.columns.some(c => c.field === 'ignore')) {
    try {
      const result = await bounded(signal => ctx.services.llm.complete({ feature: 'roster.columns', promptId: 'roster/columns', version: 1, route: draft.route, userId: null, vars: { columns: JSON.stringify(draft.columns.map(c => ({ index: c.index, header: fieldForHeader(c.header) === 'ignore' ? '[unmapped]' : c.field, sample: '[masked]' }))) }, schema: ColumnOutput, maxOutputTokens: 1500, signal }));
      if (result.ok && ColumnOutput.safeParse(result.data).success) {
        draft.aiUsed = true;
        // Discarded columns cannot be recovered, nor can a model override known sensitive columns.
        // The mapping is advisory only; the teacher must re-upload with an explicit mapping.
      }
    } catch { /* Import remains available with manual mapping. Never log input or provider errors. */ }
  }
  const unresolved = draft.rows.filter(r => r.status === 'needs_review' && r.flags.some(f => f === 'uncertain_split') && safeNameCell(r.original) && !r.flags.some(f => ['maybe_not_person','maybe_two_people','corrupted_characters'].includes(f)));
  for (let offset = 0; offset < unresolved.length; offset += 40) {
    const batch = unresolved.slice(offset, offset + 40);
    try {
      const result = await bounded(signal => ctx.services.llm.complete({ feature: 'roster.names', promptId: 'roster/names', version: 1, route: draft.route, userId: null, vars: { rows: JSON.stringify(batch.map(r => ({ rowIndex: r.rowIndex, name: r.original }))) }, schema: NameOutput, maxOutputTokens: 8000, signal }));
      if (!result.ok) { for (const row of batch) flag(row, 'model_rules_disagree'); continue; }
      const parsed = NameOutput.safeParse(result.data);
      // Cardinality and exact identity of row indices must hold before ANY proposal is used.
      if (!parsed.success || parsed.data.rows.length !== batch.length || new Set(parsed.data.rows.map(r => r.rowIndex)).size !== batch.length || parsed.data.rows.some(r => !batch.some(b => b.rowIndex === r.rowIndex))) {
        for (const row of batch) flag(row, 'untraceable_output'); continue;
      }
      draft.aiUsed = true;
      for (const item of parsed.data.rows) {
        const row = batch.find(r => r.rowIndex === item.rowIndex)!;
        const p = item.proposed;
        if (!traceable(row.original, p) || p.sex !== null || p.grade !== null || p.localId !== null || !p.displayName.trim()) {
          flag(row, 'untraceable_output'); continue;
        }
        // Names can be rearranged, but may not lose source name runs either.
        const reverse = { ...p, displayName: row.proposed.displayName, familyName: '', givenName: '', middleName: '', suffix: '' };
        if (!traceable(p.displayName, reverse)) { flag(row, 'untraceable_output'); continue; }
        const differs = [...nameFields].filter(k => k !== 'fullName').some(k => p[k as 'givenName'] !== row.proposed[k as 'givenName']);
        if (differs || p.displayName !== row.proposed.displayName) flag(row, 'model_rules_disagree');
        row.proposed = { ...p, grade: row.proposed.grade, sex: row.proposed.sex, localId: row.proposed.localId };
        // A model never resolves a teacher-review flag.
      }
    } catch { for (const row of batch) flag(row, 'model_rules_disagree'); }
  }
}
