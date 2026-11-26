'use client';
/**
 * Curriculum packs, calendar presets and client config: fetched through the typed client, cached in IndexedDB,
 * cached copy first and a background refresh when online (RES-1).
 */
import { useEffect, useMemo, useState } from 'react';
import { packId as makePackId } from '@hiraia/tala-core/curriculum';
import type {
  CalendarPreset,
  ClassRecord,
  CurriculumIndex,
  CurriculumPack,
  TalaClient,
  TeachingAssignment,
} from '@hiraia/tala-core/contracts';
import type { KvCache } from './cache';
import { getClient } from './client';
import { useSession } from './session';

const INDEX_KEY = 'curriculum.index';
const PACK_PREFIX = 'curriculum.pack.';
const PRESETS_KEY = 'calendar.presets';
const PRESET_PREFIX = 'calendar.preset.';

async function cachedFirst<T>(
  cache: KvCache,
  key: string,
  fetcher: () => Promise<T>,
  onFresh?: (v: T) => void
): Promise<T | null> {
  const cached = await cache.get<T>(key);
  const refresh = fetcher()
    .then(async (v) => {
      await cache.set(key, v);
      onFresh?.(v);
      return v;
    })
    .catch(() => null);
  if (cached) return cached;
  return refresh;
}

export async function loadIndex(
  client: TalaClient,
  cache: KvCache,
  onFresh?: (v: CurriculumIndex) => void
) {
  return cachedFirst(cache, INDEX_KEY, () => client.call('curriculum.index'), onFresh);
}

export async function loadPack(
  client: TalaClient,
  cache: KvCache,
  packId: string
): Promise<CurriculumPack | null> {
  return cachedFirst(cache, PACK_PREFIX + packId, () =>
    client.call('curriculum.pack', { params: { packId } })
  );
}

export async function loadPresets(client: TalaClient, cache: KvCache) {
  return cachedFirst(
    cache,
    PRESETS_KEY,
    async () => (await client.call('calendar.presets')).presets
  );
}

export async function loadPreset(
  client: TalaClient,
  cache: KvCache,
  presetId: string
): Promise<CalendarPreset | null> {
  return cachedFirst(cache, PRESET_PREFIX + presetId, () =>
    client.call('calendar.preset', { params: { presetId } })
  );
}

/**
 * The curriculum version in force for ONE grade and learning area in a school year. Every learning area has its own
 * version (science-bow-2026, english-bow-2026, reading-and-literacy-bow-2026, …), so there is no single version for a
 * whole school year. Chosen the way the server's `versionFor` chooses: sourced packs before sample data, then the
 * newest data revision. A year with no pack in force falls back to the packs of that grade and area of any year.
 */
export function curriculumVersionOf(
  index: CurriculumIndex | null,
  yearLabel: string | null,
  grade: string,
  learningAreaId: string | null
): string | null {
  if (!index || !learningAreaId) return null;
  const all = index.packs.filter((p) => p.grade === grade && p.learningAreaId === learningAreaId);
  const inForce = yearLabel ? all.filter((p) => p.schoolYears.includes(yearLabel)) : [];
  const best = [...(inForce.length ? inForce : all)].sort(
    (a, b) =>
      Number(a.curriculumVersion.startsWith('fixture-')) -
        Number(b.curriculumVersion.startsWith('fixture-')) ||
      b.dataRevision - a.dataRevision ||
      a.curriculumVersion.localeCompare(b.curriculumVersion)
  )[0];
  return best?.curriculumVersion ?? null;
}

export function packIdFor(
  index: CurriculumIndex | null,
  yearLabel: string | null,
  grade: string,
  learningAreaId: string | null
): string | null {
  const version = curriculumVersionOf(index, yearLabel, grade, learningAreaId);
  return version && learningAreaId ? makePackId(version, grade, learningAreaId) : null;
}

/**
 * The packs that hold a plan's tagged competencies, whatever the plan's own learning area: a multi-grade session made
 * from each grade's own lesson can carry Grade 1 Reading and Literacy beside Grade 2–3 English. A competency id
 * starts with its pack's version, learning area and grade (`<version>.<area>.g<grade>.`, contracts/curriculum.ts).
 */
export function packIdsOfCompetencies(index: CurriculumIndex | null, competencyIds: string[]): string[] {
  if (!index || !competencyIds.length) return [];
  const ids = new Set<string>();
  for (const p of index.packs) {
    const prefix = `${p.curriculumVersion}.${p.learningAreaId}.g${p.grade}.`;
    if (competencyIds.some((id) => id.startsWith(prefix))) ids.add(p.packId);
  }
  return [...ids].sort();
}

/** Pack ids needed for a set of classes and assignments. */
export function packIdsFor(
  index: CurriculumIndex | null,
  yearLabel: string | null,
  classes: ClassRecord[],
  assignments: TeachingAssignment[]
): string[] {
  const ids = new Set<string>();
  for (const a of assignments) {
    const cls = classes.find((c) => c.id === a.classId);
    if (!cls || cls.curriculum === 'none') continue;
    for (const gid of a.gradeGroupIds) {
      const g = cls.gradeGroups.find((x) => x.id === gid);
      const pid = g ? packIdFor(index, yearLabel, g.grade, a.learningAreaId) : null;
      if (pid) ids.add(pid);
    }
  }
  return [...ids].sort();
}

export function useCurriculumIndex() {
  const { cache } = useSession();
  const [index, setIndex] = useState<CurriculumIndex | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    loadIndex(getClient(), cache, (v) => alive && setIndex(v)).then((v) => {
      if (!alive) return;
      setIndex(v);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [cache]);
  return { index, loading };
}

export function usePacks(packIds: string[]) {
  const { cache } = useSession();
  const key = packIds.join('|');
  const [packs, setPacks] = useState<Record<string, CurriculumPack>>({});
  const [loading, setLoading] = useState(packIds.length > 0);
  useEffect(() => {
    let alive = true;
    const ids = key ? key.split('|') : [];
    if (!ids.length) {
      setLoading(false);
      return;
    }
    setLoading(true);
    Promise.all(
      ids.map((id) => loadPack(getClient(), cache, id).then((p) => [id, p] as const))
    ).then((pairs) => {
      if (!alive) return;
      setPacks((prev) => {
        const next = { ...prev };
        for (const [id, p] of pairs) if (p) next[id] = p;
        return next;
      });
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [cache, key]);
  const competencies = useMemo(() => Object.values(packs).flatMap((p) => p.competencies), [packs]);
  const missing = useMemo(() => packIds.filter((id) => !packs[id]), [packIds, packs]);
  return { packs, competencies, loading, missing };
}

export function useCalendarPresets() {
  const { cache } = useSession();
  const [presets, setPresets] = useState<Array<Omit<CalendarPreset, 'days' | 'terms'>> | null>(
    null
  );
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    loadPresets(getClient(), cache).then((p) => {
      if (!alive) return;
      if (p) setPresets(p);
      else setFailed(true);
    });
    return () => {
      alive = false;
    };
  }, [cache]);
  return { presets, failed, load: (id: string) => loadPreset(getClient(), cache, id) };
}
