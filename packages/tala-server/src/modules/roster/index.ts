import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { RosterImportDraft, RosterProposed as Proposed, RosterRow, RosterConfirmResponse } from '@hiraia/tala-core';
import { RosterProposed } from '@hiraia/tala-core';
import { emptyName, normalizeSource, rosterCounts, safeNameCell, structureRows, type SafeSource } from '@hiraia/tala-core/roster';
import { HttpError, requireUser, type Ctx, type ServerModule } from '../../kernel/types';
import { aiRoute, assistDraft } from './ai';
import { readRoster } from './reader';
interface StoredDraft { draft: RosterImportDraft; source: SafeSource[]; exact: boolean; saved: Set<number> }
const TTL = 24 * 60 * 60 * 1000 - 60_000;
function classFor(ctx: Ctx, classId: string) {
  const user = requireUser(ctx);
  const record = ctx.services.records.get(user.id, 'class', classId);
  if (!record || record.deletedAt) throw new HttpError('not_found', 'This class is no longer available.');
  return record.data;
}
function clone<T>(value: T): T { return structuredClone(value); }

/** A fresh module instance isolates drafts between servers and tests. No roster content goes to SQLite. */
export function createRosterModule(): ServerModule & { kernel: { onAccountDeleted: NonNullable<ServerModule['onAccountDeleted']> } } {
  const drafts = new Map<string, StoredDraft>();
  // TEMP metadata participates in account-merge rollback without persisting student data.
  const ensureOwners = (db: Ctx['db']) => db.exec('CREATE TEMP TABLE IF NOT EXISTS roster_import_owners (import_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, expires INTEGER NOT NULL)');
  const ownerOf = (db: Ctx['db'], id: string) => (db.prepare('SELECT owner_id FROM roster_import_owners WHERE import_id = ?').get(id) as { owner_id: string } | undefined)?.owner_id;
  // Lost HTTP responses can be replayed without retaining the source draft. Receipts are
  // encrypted in memory, scoped to owner/import/key, and share the original 24h deadline.
  const receiptKey = randomBytes(32);
  const receipts = new Map<string, { importId: string; classId: string; expires: number; fingerprint: string; iv: Buffer; tag: Buffer; bytes: Buffer }>();
  const forgetReceipt = (key: string) => { receipts.get(key)?.bytes.fill(0); receipts.delete(key); };
  function purge(now: number) {
    for (const [id, stored] of drafts) if (Date.parse(stored.draft.expiresAt) <= now) drafts.delete(id);
    for (const [key, receipt] of receipts) if (receipt.expires <= now) forgetReceipt(key);
  }
  function lookup(ctx: Ctx, id: string): StoredDraft {
    purge(ctx.now().getTime());
    const user = requireUser(ctx), stored = drafts.get(id);
    if (!stored || ownerOf(ctx.db, id) !== user.id) throw new HttpError('not_found', 'This import has expired or is no longer available. Please import it again.');
    try { classFor(ctx, stored.draft.classId); } catch (error) { drafts.delete(id); throw error; }
    return stored;
  }
  const onAccountDeleted: NonNullable<ServerModule['onAccountDeleted']> = (deps, userId) => {
    ensureOwners(deps.db);
    for (const id of drafts.keys()) if (ownerOf(deps.db, id) === userId) drafts.delete(id);
    for (const [key, receipt] of receipts) if (ownerOf(deps.db, receipt.importId) === userId) forgetReceipt(key);
    deps.db.prepare('DELETE FROM roster_import_owners WHERE owner_id = ?').run(userId);
  };
  const onAccountMerged: NonNullable<ServerModule['onAccountMerged']> = (deps, fromUserId, toUserId) => {
    ensureOwners(deps.db);
    // Import IDs are globally unique. Retry keys are scoped by import ID, so matching
    // client keys from the two accounts do not collide. Repeated/self merges are no-ops.
    if (fromUserId !== toUserId) deps.db.prepare('UPDATE roster_import_owners SET owner_id = ? WHERE owner_id = ?').run(toUserId, fromUserId);
  };
  return {
    name: 'roster', migrations: [],
    onAccountDeleted,
    onAccountMerged,
    // Compatibility until the kernel reads the public hook directly (worker A §3).
    kernel: { onAccountDeleted },
    start(deps) {
      ensureOwners(deps.db);
      const timer = setInterval(() => {
        purge(deps.now().getTime());
        deps.db.prepare('DELETE FROM roster_import_owners WHERE expires <= ?').run(deps.now().getTime());
        for (const [key, receipt] of receipts) if (!deps.services.records.get(ownerOf(deps.db, receipt.importId) ?? '', 'class', receipt.classId)) forgetReceipt(key);
        for (const [id, stored] of drafts) {
          const cls = deps.services.records.get(ownerOf(deps.db, id) ?? '', 'class', stored.draft.classId);
          if (!cls || cls.deletedAt) drafts.delete(id);
        }
      }, 60_000);
      timer.unref();
      return () => { clearInterval(timer); drafts.clear(); for (const key of receipts.keys()) forgetReceipt(key); receiptKey.fill(0); deps.db.exec('DROP TABLE IF EXISTS temp.roster_import_owners'); };
    },
    handlers: {
      'roster.import': async (ctx, { body }) => {
        const user = requireUser(ctx);
        if (!user.emailVerified) throw new HttpError('forbidden', 'Verify your email before importing a class list.');
        classFor(ctx, body.classId);
        const route = aiRoute(ctx, body.useAi && !body.exactlyAsWritten, body.cloudFlagAcknowledged);
        if ((body.text === undefined) === (body.contentBase64 === undefined)) throw new HttpError('invalid_input', 'Provide either pasted text or one file.');
        if (body.contentBase64 && !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(body.contentBase64)) throw new HttpError('invalid_input', 'The uploaded file is incomplete. Please upload it again.');
        purge(ctx.now().getTime());
        if (drafts.size >= 100 || [...drafts.keys()].filter(id => ownerOf(ctx.db, id) === user.id).length >= 10) throw new HttpError('rate_limited', 'Finish or abandon an earlier import before starting another.');
        const bytes = body.text !== undefined ? new TextEncoder().encode(body.text) : Buffer.from(body.contentBase64!, 'base64');
        let extracted;
        try { extracted = await readRoster({ bytes, extension: body.text !== undefined ? 'txt' : body.filename.split('.').pop()!.toLowerCase(), maxRows: Math.min(500, ctx.config.limits.rosterRows) + 100, sheet: body.sheet, exactlyAsWritten: body.exactlyAsWritten }, Math.min(5 * 1024 * 1024, ctx.config.limits.rosterFileBytes)); }
        finally { bytes.fill(0); }
        let parsed;
        try { parsed = structureRows(extracted.rows, { maxRows: ctx.config.limits.rosterRows, exactlyAsWritten: body.exactlyAsWritten, encodingReview: extracted.encodingReview }); }
        catch { throw new HttpError('invalid_input', 'This list exceeds the import limits. Paste up to 500 names as text.'); }
        extracted.rows.length = 0; // Release unapproved cells before any model call.
        const draft: RosterImportDraft = { importId: ctx.newId(), classId: body.classId, filename: body.filename, columns: parsed.columns, droppedColumns: parsed.droppedColumns, rows: parsed.rows, counts: parsed.counts, route, aiUsed: false, sheets: extracted.sheets, expiresAt: new Date(ctx.now().getTime() + TTL).toISOString() };
        await assistDraft(ctx, draft);
        draft.counts = rosterCounts(draft.rows);
        classFor(ctx, body.classId); // Recheck after asynchronous parsing/model work.
        ctx.db.prepare('INSERT INTO roster_import_owners (import_id, owner_id, expires) VALUES (?, ?, ?)').run(draft.importId, user.id, Date.parse(draft.expiresAt));
        drafts.set(draft.importId, { draft, source: parsed.source, exact: body.exactlyAsWritten, saved: new Set() });
        return clone(draft);
      },
      'roster.get': (ctx, { params }) => clone(lookup(ctx, params.importId).draft),
      'roster.remap': (ctx, { params, body }) => {
        const stored = lookup(ctx, params.importId);
        if (stored.saved.size) throw new HttpError('conflict', 'Finish the pending rows before starting a new column mapping.');
        if (new Set(body.columns.map(c => c.index)).size !== body.columns.length) throw new HttpError('invalid_input', 'Map each column only once.');
        const columns = clone(stored.draft.columns);
        for (const mapping of body.columns) {
          const column = columns.find(c => c.index === mapping.index);
          if (!column) throw new HttpError('invalid_input', 'Choose a column from this import.');
          if ((column.field === 'drop' || column.field === 'ignore') && mapping.field !== 'drop' && mapping.field !== 'ignore') throw new HttpError('invalid_input', 'That column was discarded for privacy. Paste only the name columns and import again.');
          // Never reinterpret metadata as a name or convert a name into a local ID/grade.
          const names = ['fullName','givenName','middleName','familyName','suffix'];
          if (mapping.field !== column.field && !['drop','ignore'].includes(mapping.field) && !(names.includes(mapping.field) && names.includes(column.field))) throw new HttpError('invalid_input', 'Only name columns can be remapped between name fields. Paste a corrected list to change other columns.');
          column.field = mapping.field;
        }
        for (const c of columns) if (c.field === 'drop' || c.field === 'ignore') for (const s of stored.source) s.cells[c.index] = '';
        stored.draft.columns = columns;
        stored.draft.droppedColumns = [...new Set([...stored.draft.droppedColumns, ...columns.filter(c => c.field === 'drop' || c.field === 'ignore').map(c => c.header)])];
        const uncertainEncoding = new Set(stored.draft.rows.filter(r => r.flags.includes('corrupted_characters')).map(r => r.rowIndex));
        stored.draft.rows = normalizeSource(stored.source, columns, stored.exact);
        for (const row of stored.draft.rows) if (uncertainEncoding.has(row.rowIndex)) { row.flags.push('corrupted_characters'); row.status = 'needs_review'; }
        stored.draft.counts = rosterCounts(stored.draft.rows);
        return clone(stored.draft);
      },
      'roster.confirm': (ctx, { params, body }) => {
        const owner = requireUser(ctx).id;
        purge(ctx.now().getTime());
        const key = body.idempotencyKey ? JSON.stringify([params.importId, body.idempotencyKey]) : null;
        const fingerprint = createHash('sha256').update(JSON.stringify(body)).digest('hex');
        const prior = key ? receipts.get(key) : undefined;
        if (prior) {
          if (ownerOf(ctx.db, prior.importId) !== owner) throw new HttpError('not_found', 'This import is no longer available.');
          try { classFor(ctx, prior.classId); } catch (error) { forgetReceipt(key!); throw error; }
          if (prior.fingerprint !== fingerprint) throw new HttpError('conflict', 'Use a new confirmation key when changing the reviewed rows.');
          const decipher = createDecipheriv('aes-256-gcm', receiptKey, prior.iv); decipher.setAuthTag(prior.tag);
          return JSON.parse(Buffer.concat([decipher.update(prior.bytes), decipher.final()]).toString('utf8')) as import('zod').z.infer<typeof RosterConfirmResponse>;
        }
        if (key && receipts.size >= 1000) throw new HttpError('rate_limited', 'Please try saving again later.');
        const stored = lookup(ctx, params.importId), cls = classFor(ctx, stored.draft.classId);
        if (body.defaultGradeGroupId && !cls.gradeGroups.some(g => g.id === body.defaultGradeGroupId)) throw new HttpError('invalid_input', 'Choose a grade group in this class.');
        const resolutions = new Map(body.resolutions.map(r => [r.rowIndex, r]));
        if (resolutions.size !== body.resolutions.length || [...resolutions.keys()].some(i => !stored.draft.rows.some(r => r.rowIndex === i))) throw new HttpError('invalid_input', 'Resolve each row only once, using rows from this import.');
        const students: Array<Proposed & { gradeGroupId: string | null; rowIndex: number }> = [], pendingRows: number[] = [];
        for (const row of stored.draft.rows) {
          const resolution = resolutions.get(row.rowIndex);
          let values: Proposed[] = [];
          if (resolution) {
            switch (resolution.action) {
              case 'not_student': break;
              case 'keep_original': values = [{ ...emptyName(row.original), grade: row.proposed.grade }]; break;
              case 'accept': values = [row.proposed]; break;
              case 'edit': case 'split': {
                const count = resolution.students?.length ?? 0;
                if ((resolution.action === 'edit' && count !== 1) || (resolution.action === 'split' && (count < 2 || count > 4))) throw new HttpError('invalid_input', 'Provide one corrected student, or two to four students when splitting a row.');
                values = resolution.students!;
                break;
              }
            }
          } else if (row.status === 'clean' || (row.status === 'changed' && body.acceptAllChanged)) values = [row.proposed];
          else if (row.status !== 'not_student') { pendingRows.push(row.rowIndex); continue; }
          for (const value of values) {
            const checked = RosterProposed.safeParse(value);
            if (!checked.success || ![value.displayName, value.givenName, value.familyName, value.middleName, value.suffix].every(safeNameCell) || !value.displayName.trim() || value.displayName === '[withheld]' || (value.localId && /\d{8,}/.test(value.localId))) throw new HttpError('invalid_input', 'Check the name and optional local ID before saving.');
            const gradeGroupId = value.grade ? cls.gradeGroups.find(g => g.grade === value.grade)?.id ?? null : body.defaultGradeGroupId;
            if (value.grade && !gradeGroupId) { pendingRows.push(row.rowIndex); break; }
            students.push({ ...checked.data, gradeGroupId, rowIndex: row.rowIndex });
          }
        }
        // A split with any unresolved group is atomic: never save only half of a learner row.
        const pending = [...new Set(pendingRows)];
        const ready = students.filter(s => !pending.includes(s.rowIndex));
        for (const row of stored.draft.rows) if (!pending.includes(row.rowIndex)) stored.saved.add(row.rowIndex);
        if (pending.length) {
          stored.draft.rows = stored.draft.rows.filter(r => pending.includes(r.rowIndex));
          stored.source = stored.source.filter(r => pending.includes(r.rowIndex));
          stored.draft.counts = rosterCounts(stored.draft.rows);
        } else drafts.delete(params.importId);
        const response = { students: clone(ready), pendingRows: pending };
        if (key) {
          const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', receiptKey, iv);
          const bytes = Buffer.concat([cipher.update(JSON.stringify(response), 'utf8'), cipher.final()]);
          receipts.set(key, { importId: params.importId, classId: stored.draft.classId, expires: Date.parse(stored.draft.expiresAt), fingerprint, iv, tag: cipher.getAuthTag(), bytes });
        }
        return response;
      },
      'roster.abandon': (ctx, { params }) => { lookup(ctx, params.importId); drafts.delete(params.importId); for (const [key, receipt] of receipts) if (ownerOf(ctx.db, receipt.importId) === requireUser(ctx).id && receipt.importId === params.importId) forgetReceipt(key); return { ok: true }; },
    },
  };
}
export const rosterModule = createRosterModule();
