'use client';
/**
 * Teaching packs on the web: the library index and a pack's content through the typed client, cached on the device
 * (a pack a teacher opened stays readable offline), plain links for the prebuilt files, and "use for my class",
 * which copies the five day plans into the teacher's own records as editable drafts with a link to their source.
 */
import { useEffect, useState } from 'react';
import { API_BASE } from '@hiraia/tala-core/contracts';
import type { ClassRecord, PackDetail, PackFileKind, PackIndex, PackLang, SyncEngine } from '@hiraia/tala-core/contracts';
import { planFromPackDay, weekdaysFrom } from './pack-plans';
export { planFromPackDay, packVersion, weekdaysFrom } from './pack-plans';
import { getClient } from './client';
import { useSession } from './session';

const INDEX_KEY = 'packs.index';
const DETAIL_PREFIX = 'packs.detail.';

export const fileUrl = (packId: string, kind: PackFileKind, lang: PackLang) => `${API_BASE}/packs/${encodeURIComponent(packId)}/files/${kind}?lang=${lang}`;
export const previewUrl = (packId: string, slide: number, lang: PackLang) => `${API_BASE}/packs/${encodeURIComponent(packId)}/previews/${slide}?lang=${lang}`;

export function usePackIndex() {
  const { cache, status } = useSession();
  const [index, setIndex] = useState<PackIndex | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    (async () => {
      const cached = await cache.get<PackIndex>(INDEX_KEY).catch(() => null);
      if (cached && alive) setIndex(cached);
      try {
        const fresh = await getClient().call('packs.index');
        if (!alive) return;
        setIndex(fresh);
        await cache.set(INDEX_KEY, fresh).catch(() => {});
      } catch {
        if (alive && !cached) setFailed(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [cache, status]);
  return { index, failed };
}

export function usePackDetail(packId: string, lang: PackLang) {
  const { cache, status } = useSession();
  const [detail, setDetail] = useState<PackDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setDetail(null);
    setError(null);
    (async () => {
      const key = `${DETAIL_PREFIX}${packId}.${lang}`;
      const cached = await cache.get<PackDetail>(key).catch(() => null);
      if (cached && alive) setDetail(cached);
      try {
        const fresh = await getClient().call('packs.detail', { params: { packId }, query: { lang } });
        if (!alive) return;
        setDetail(fresh);
        await cache.set(key, fresh).catch(() => {});
      } catch (e) {
        if (alive && !cached) setError(e instanceof Error ? e.message : 'unavailable');
      }
    })();
    return () => {
      alive = false;
    };
  }, [cache, packId, lang, status]);
  return { detail, error };
}

export async function addPackToClass(args: {
  engine: SyncEngine;
  detail: PackDetail;
  cls: ClassRecord;
  gradeGroupId: string;
  assignmentId: string | null;
  weekOf: string | null;
  newId: () => string;
}): Promise<string[]> {
  const dates = args.weekOf ? weekdaysFrom(args.weekOf) : [];
  const built = args.detail.content.days.map((day, i) =>
    planFromPackDay({
      pack: args.detail.content,
      review: args.detail.review,
      day,
      cls: args.cls,
      gradeGroupId: args.gradeGroupId,
      assignmentId: args.assignmentId,
      date: dates[i] ?? null,
      newId: args.newId,
    })
  );
  await args.engine.batch(
    built.flatMap(({ plan, sections }) => [
      { op: 'put' as const, entity: 'plan' as const, data: plan },
      ...sections.map((s) => ({ op: 'put' as const, entity: 'plan_section' as const, data: s })),
    ])
  );
  return built.map((b) => b.plan.id);
}
