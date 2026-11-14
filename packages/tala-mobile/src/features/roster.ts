import { RosterImportDraft, RosterProposed, Student } from '@hiraia/tala-core/contracts';
import type {
  LocalStore,
  SyncEngine,
  TalaClient,
  RosterResolution,
  RosterRow,
  RosterField,
  RosterImportRequest,
  RosterConfirmResponse,
} from '@hiraia/tala-core/contracts';
import type { z } from 'zod';
import {
  extractText,
  structureRows,
  normalizeSource,
  rosterCounts,
  safeNameCell,
  emptyName,
  groupDuplicates,
} from '@hiraia/tala-core/roster';
import type { SafeSource } from '@hiraia/tala-core/roster';
import { atomic, type Operation } from './atomic';
export interface Review {
  draft: z.infer<typeof RosterImportDraft>;
  source: SafeSource[];
  resolutions: z.infer<typeof RosterResolution>[];
  savedRows: number[];
  key: string | null;
  studentIds?: Record<string, string>;
  confirmDefaults?: { defaultGradeGroupId: string | null; acceptAllChanged: boolean };
  confirmPayload?: z.infer<typeof RosterResolution>[];
  response?: z.infer<typeof RosterConfirmResponse>;
}
export function createRoster(deps: {
  store: LocalStore;
  engine: SyncEngine;
  client: TalaClient;
  newId(): string;
  now(): Date;
}) {
  const { store, engine, client, newId, now } = deps;
  const key = (id: string) => `roster.review.${id}`;
  async function load(classId: string): Promise<Review | null> {
    const data = await store.getMeta(key(classId));
    if (!data) return null;
    const review = JSON.parse(data) as Review;
    if (new Date(review.draft.expiresAt).getTime() <= now().getTime()) {
      await store.commit({ meta: { [key(classId)]: null } });
      return null;
    }
    return review;
  }
  async function save(review: Review) {
    await store.commit({ meta: { [key(review.draft.classId)]: JSON.stringify(review) } });
    return review;
  }
  async function parse(
    classId: string,
    text: string,
    filename: string,
    exact = false,
    encodingReview = false
  ) {
    if (text.length > 5 * 1024 * 1024) throw Error('Too large');
    const data = structureRows(extractText(text, exact ? 'txt' : filename.split('.').pop()), {
      exactlyAsWritten: exact,
      encodingReview,
    });
    return save({
      draft: RosterImportDraft.parse({
        importId: `local-${newId()}`,
        classId,
        filename,
        columns: data.columns,
        droppedColumns: data.droppedColumns,
        rows: data.rows,
        counts: data.counts,
        route: 'rules',
        aiUsed: false,
        sheets: [],
        expiresAt: new Date(now().getTime() + 24 * 3600000).toISOString(),
      }),
      source: data.source,
      resolutions: [],
      savedRows: [],
      key: null,
    });
  }
  async function online(input: z.infer<typeof RosterImportRequest>) {
    // Server config is checked again; a cached cloud flag alone can never authorise a changed route.
    const config = await client.call('config.get');
    if (input.useAi && config.rosterLlmRoute === 'cloud' && !input.cloudFlagAcknowledged)
      throw Error('Cloud acknowledgement required');
    const draft = await client.call('roster.import', { body: input });
    return save({ draft, source: [], resolutions: [], savedRows: [], key: null });
  }
  async function resolve(
    classId: string,
    rowIndex: number,
    action: z.infer<typeof RosterResolution>['action'],
    students?: z.infer<typeof RosterProposed>[]
  ) {
    const review = await load(classId);
    if (!review || review.key) throw Error('Finish pending save first');
    if (
      students?.some(
        (student) =>
          !safeNameCell(student.displayName) ||
          [student.familyName, student.givenName, student.middleName, student.suffix].some(
            (name) => name && !safeNameCell(name)
          ) ||
          (student.localId && /\d{8,}/.test(student.localId))
      )
    )
      throw Error('Use names and a short local ID only');
    review.resolutions = review.resolutions.filter((r) => r.rowIndex !== rowIndex);
    review.resolutions.push({ rowIndex, action, students });
    return save(review);
  }
  async function remap(classId: string, columns: z.infer<typeof RosterImportDraft>['columns']) {
    const review = await load(classId);
    if (!review || review.key || review.savedRows.length) throw Error('Already saving');
    if (review.draft.importId.startsWith('local-')) {
      review.draft.columns = columns;
      review.draft.rows = normalizeSource(review.source, columns);
      groupDuplicates(review.draft.rows);
      review.draft.counts = rosterCounts(review.draft.rows);
    } else
      review.draft = await client.call('roster.remap', {
        params: { importId: review.draft.importId },
        body: { columns },
      });
    review.resolutions = [];
    return save(review);
  }
  async function confirm(
    classId: string,
    defaultGradeGroupId: string | null,
    acceptAllChanged = false
  ) {
    const review = await load(classId);
    if (!review) throw Error('Review expired');
    if (!review.key) {
      review.key = newId();
      review.confirmPayload = review.resolutions;
      review.confirmDefaults = { defaultGradeGroupId, acceptAllChanged };
      await save(review);
    }
    const cls = (await engine.get('class', classId))?.data;
    if (!cls) throw Error('Missing class');
    let response = review.response;
    if (!response && !review.draft.importId.startsWith('local-')) {
      // Retry uses the exact frozen key and resolutions until the response is durably applied.
      response = await client.call('roster.confirm', {
        params: { importId: review.draft.importId },
        body: {
          idempotencyKey: review.key,
          resolutions: review.confirmPayload ?? [],
          acceptAllChanged: review.confirmDefaults!.acceptAllChanged,
          defaultGradeGroupId: review.confirmDefaults!.defaultGradeGroupId,
        },
      });
      review.response = response;
      await save(review);
    }
    if (!response) {
      const students: z.infer<typeof RosterConfirmResponse>['students'] = [],
        pendingRows: number[] = [];
      for (const row of review.draft.rows) {
        if (review.savedRows.includes(row.rowIndex)) continue;
        const choice = review.confirmPayload?.find((r) => r.rowIndex === row.rowIndex);
        if (choice?.action === 'not_student' || (row.status === 'not_student' && !choice)) {
          continue;
        }
        let proposed: z.infer<typeof RosterProposed>[];
        if (choice?.action === 'split' || choice?.action === 'edit') {
          proposed = (choice.students ?? []).map((s) => RosterProposed.parse(s));
          if (!proposed.length || (choice.action === 'split' && proposed.length < 2)) {
            pendingRows.push(row.rowIndex);
            continue;
          }
        } else if (choice?.action === 'keep_original')
          proposed = [{ ...emptyName(row.original), grade: row.proposed.grade }];
        else if (
          choice?.action === 'accept' ||
          row.status === 'clean' ||
          (row.status === 'changed' && review.confirmDefaults!.acceptAllChanged)
        )
          proposed = [row.proposed];
        else {
          pendingRows.push(row.rowIndex);
          continue;
        }
        const ready = proposed.map((p) => ({
          ...p,
          rowIndex: row.rowIndex,
          gradeGroupId:
            cls.gradeGroups.find((g) => g.grade === p.grade)?.id ??
            review.confirmDefaults!.defaultGradeGroupId,
        }));
        if (
          ready.some(
            (p) =>
              !p.displayName.trim() ||
              p.displayName === '[withheld]' ||
              !safeNameCell(p.displayName) ||
              !p.gradeGroupId
          )
        ) {
          pendingRows.push(row.rowIndex);
          continue;
        }
        students.push(...ready);
      }
      response = { students, pendingRows };
      review.response = response;
      await save(review);
    }
    review.studentIds ??= {};
    for (const [index, p] of response.students.entries())
      review.studentIds[`${p.rowIndex}.${index}`] ??= newId();
    await save(review);
    const ops: Operation[] = response.students.map((p, index) => ({
      op: 'put',
      entity: 'student',
      data: Student.parse({
        id: review.studentIds![`${p.rowIndex}.${index}`]!,
        classId,
        gradeGroupId: p.gradeGroupId,
        displayName: p.displayName,
        familyName: p.familyName,
        givenName: p.givenName,
        middleName: p.middleName,
        suffix: p.suffix,
        sex: p.sex,
        localId: p.localId,
        order: index,
        importId: review.draft.importId,
      }),
    }));
    const existing = (await engine.list('student')).filter((s) => s.data.classId === classId);
    const ids = new Set(existing.map((s) => s.id));
    if (
      existing.length +
        ops.filter((o) => o.op === 'put' && !ids.has((o.data as { id: string }).id)).length >
      500
    )
      throw Error('Roster exceeds 500');
    await atomic(engine, ops);
    review.savedRows = [
      ...new Set([
        ...review.savedRows,
        ...review.draft.rows
          .filter((r) => !response!.pendingRows.includes(r.rowIndex))
          .map((r) => r.rowIndex),
      ]),
    ];
    review.key = null;
    review.confirmPayload = undefined;
    review.confirmDefaults = undefined;
    review.response = undefined;
    if (!response.pendingRows.length) {
      await store.commit({ meta: { [key(classId)]: null } });
      return null;
    }
    review.resolutions = review.resolutions.filter((r) =>
      response!.pendingRows.includes(r.rowIndex)
    );
    await save(review);
    return review;
  }
  return {
    load,
    parse,
    online,
    async localSuggestion(classId: string, rowIndex: number, expected: string, output: string) {
      const review = await load(classId);
      if (
        !review ||
        !review.draft.importId.startsWith('local-') ||
        review.key ||
        review.savedRows.includes(rowIndex) ||
        review.resolutions.some((r) => r.rowIndex === rowIndex)
      )
        throw Error('localAiReviewChanged');
      const index = review.draft.rows.findIndex((r) => r.rowIndex === rowIndex);
      if (index < 0 || JSON.stringify(review.draft.rows[index]) !== expected)
        throw Error('localAiReviewChanged');
      const { rosterSuggestion } = await import('./local-ai/roster');
      review.draft.rows[index] = rosterSuggestion(review.draft.rows[index]!, output);
      groupDuplicates(review.draft.rows);
      review.draft.counts = rosterCounts(review.draft.rows);
      // Local draft only: never send the model request or names to roster.import.
      return save(review);
    },
    resolve,
    remap,
    confirm,
    async abandon(classId: string, online: boolean) {
      const review = await load(classId);
      if (online && review && !review.draft.importId.startsWith('local-'))
        await client.call('roster.abandon', { params: { importId: review.draft.importId } });
      await store.commit({ meta: { [key(classId)]: null } });
    },
  };
}
