'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EntityName, LocalRecord, RecordData, SyncEngine } from '@hiraia/tala-core/contracts';
import { useSession } from './session';

export interface RecordList<E extends EntityName> {
  items: LocalRecord<E>[];
  /** True until the first read from the device completes (show placeholders, RES-2). */
  loading: boolean;
  reload: () => Promise<void>;
}

/** All live records of an entity from the device, kept fresh through the engine's change feed. */
export function useRecords<E extends EntityName>(entity: E): RecordList<E> {
  const { engine } = useSession();
  const [items, setItems] = useState<LocalRecord<E>[]>([]);
  const [loading, setLoading] = useState(true);
  const alive = useRef(true);
  const reload = useCallback(async () => {
    if (!engine) return;
    const list = await engine.list(entity);
    if (alive.current) {
      setItems(list);
      setLoading(false);
    }
  }, [engine, entity]);
  useEffect(() => {
    alive.current = true;
    if (!engine) {
      setLoading(false);
      return;
    }
    void reload();
    const unsub = engine.subscribe((changed) => {
      if (changed.some((c) => c.entity === entity)) void reload();
    });
    return () => {
      alive.current = false;
      unsub();
    };
  }, [engine, entity, reload]);
  return { items, loading, reload };
}

export function useRecord<E extends EntityName>(
  entity: E,
  id: string | null
): { record: LocalRecord<E> | null; loading: boolean } {
  const { engine } = useSession();
  const [record, setRecord] = useState<LocalRecord<E> | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!engine || !id) {
      setLoading(false);
      return;
    }
    let alive = true;
    const load = async () => {
      const r = await engine.get(entity, id);
      if (alive) {
        setRecord(r);
        setLoading(false);
      }
    };
    void load();
    const unsub = engine.subscribe((changed) => {
      if (changed.some((c) => c.entity === entity && c.id === id)) void load();
    });
    return () => {
      alive = false;
      unsub();
    };
  }, [engine, entity, id]);
  return { record, loading };
}

export const dataOf = <E extends EntityName>(list: LocalRecord<E>[]): RecordData<E>[] =>
  list.map((r) => r.data);

/** Everything the timeline and the class screens need, read once from the device. */
export function useWorkspace() {
  const profile = useRecords('profile');
  const years = useRecords('school_year');
  const classes = useRecords('class');
  const assignments = useRecords('assignment');
  const tracks = useRecords('pacing_track');
  const days = useRecords('calendar_day');
  const plans = useRecords('plan');
  const marks = useRecords('session_mark');
  const overrides = useRecords('pairing_override');
  const checks = useRecords('competency_check');
  const loading = [
    profile,
    years,
    classes,
    assignments,
    tracks,
    days,
    plans,
    marks,
    overrides,
    checks,
  ].some((x) => x.loading);
  return useMemo(() => {
    const prof = profile.items[0]?.data ?? null;
    const allYears = dataOf(years.items);
    const activeYear =
      allYears.find((y) => y.id === prof?.activeSchoolYearId) ??
      allYears.sort((a, b) => b.startDate.localeCompare(a.startDate))[0] ??
      null;
    return {
      loading,
      profile: prof,
      years: allYears,
      activeYear,
      classes: dataOf(classes.items).filter(
        (c) => !c.archived && (!activeYear || c.schoolYearId === activeYear.id)
      ),
      allClasses: dataOf(classes.items),
      assignments: dataOf(assignments.items),
      tracks: dataOf(tracks.items),
      calendarDays: dataOf(days.items),
      plans: dataOf(plans.items),
      planRecords: plans.items,
      marks: dataOf(marks.items),
      pairingOverrides: dataOf(overrides.items),
      checks: dataOf(checks.items),
    };
  }, [
    loading,
    profile.items,
    years.items,
    classes.items,
    assignments.items,
    tracks.items,
    days.items,
    plans.items,
    marks.items,
    overrides.items,
    checks.items,
  ]);
}

export type Workspace = ReturnType<typeof useWorkspace>;

/** Put several records as one logical change (sequential; the engine serialises writes). */
export async function putAll(
  engine: SyncEngine,
  writes: Array<{ entity: EntityName; data: unknown }>
): Promise<void> {
  for (const w of writes) await engine.put(w.entity, w.data as never);
}
