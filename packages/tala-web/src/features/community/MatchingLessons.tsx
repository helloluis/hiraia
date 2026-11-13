'use client';
/** COM-3: from a "no plan yet" slot, community lessons matching the competency, grade and language. */
import { useEffect, useState } from 'react';
import type { ArtifactSummary, TimelineEntry } from '@hiraia/tala-core/contracts';
import { useT } from '@/i18n';
import { useSession } from '@/data/session';
import { getClient } from '@/data/client';
import { List, ListRow, Placeholder, SectionTitle } from '@/components/ui';

export function MatchingLessons({
  entry,
  grade,
  language,
}: {
  entry: TimelineEntry | undefined;
  grade: string | null;
  language: 'fil' | 'en';
}) {
  const { t } = useT();
  const { network, config } = useSession();
  const [items, setItems] = useState<ArtifactSummary[] | null>(null);
  const competencyId = entry ? Object.values(entry.byGroup).flat()[0] : undefined;
  const online = network.online && network.rung !== 'offline';
  useEffect(() => {
    if (!competencyId || !online || config?.features.community === false) return;
    let alive = true;
    getClient()
      .call('community.search', {
        query: { competencyId, grade: (grade as never) ?? undefined, language },
      })
      .then((r) => alive && setItems(r.items.slice(0, 5)))
      .catch(() => alive && setItems([]));
    return () => {
      alive = false;
    };
  }, [competencyId, grade, language, online, config]);
  if (!competencyId || !online || config?.features.community === false) return null;
  return (
    <section>
      <SectionTitle>{t('com.matching')}</SectionTitle>
      {items === null ? (
        <Placeholder rows={2} />
      ) : items.length === 0 ? (
        <p className="text-forestMuted">{t('com.matchingNone')}</p>
      ) : (
        <List>
          {items.map((a) => (
            <ListRow
              key={a.id}
              href={`/community/${a.id}`}
              title={a.title}
              subtitle={`${t('com.by', { name: a.authorDisplayName })} · ${t('com.copies', { n: a.copyCount })}`}
            />
          ))}
        </List>
      )}
    </section>
  );
}
