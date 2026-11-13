'use client';
/** Browse / search the community (COM-2, COM-6, COM-7) and my posts. 20 per page, filters only (no thumbnails). */
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import type { ArtifactSummary } from '@hiraia/tala-core/contracts';
import { useT } from '@/i18n';
import { useSession } from '@/data/session';
import { getClient } from '@/data/client';
import { useCurriculumIndex } from '@/data/curriculum';
import { useWorkspace } from '@/data/records';
import { GRADES } from '@/data/community';
import { errorKey } from '@/data/errors';
import {
  Badge,
  Banner,
  Button,
  EmptyState,
  List,
  ListRow,
  PageHeader,
  Placeholder,
  Select,
  TextInput,
  cx,
  type Tone,
} from '@/components/ui';

type Query = {
  q: string;
  grade: string;
  learningAreaId: string;
  termIndex: string;
  language: string;
  multigrade: string;
  maxMinutes: string;
};

export function CommunityScreen() {
  const { t, lang } = useT();
  const params = useSearchParams();
  const { network, user } = useSession();
  const { index } = useCurriculumIndex();
  const ws = useWorkspace();
  const [tab, setTab] = useState<'browse' | 'mine'>('browse');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [query, setQuery] = useState<Query>({
    q: '',
    grade: params.get('grade') ?? '',
    learningAreaId: '',
    termIndex: '',
    language: '',
    multigrade: '',
    maxMinutes: '',
  });
  const [items, setItems] = useState<ArtifactSummary[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const online = network.online && network.rung !== 'offline' && network.rung !== 'readonly';
  const competencyId = params.get('competencyId') ?? undefined;

  const run = useCallback(
    async (after: string | null) => {
      if (!online) return;
      setError(null);
      if (!after) setItems(null);
      else setLoadingMore(true);
      try {
        const r = await getClient().call('community.search', {
          query: {
            q: query.q || undefined,
            grade: (query.grade as never) || undefined,
            learningAreaId: query.learningAreaId || undefined,
            termIndex: query.termIndex ? Number(query.termIndex) : undefined,
            language: (query.language as never) || undefined,
            multigrade: query.multigrade || undefined,
            maxMinutes: query.maxMinutes ? Number(query.maxMinutes) : undefined,
            competencyId,
            mine: tab === 'mine' ? true : undefined,
            cursor: after ?? undefined,
          },
        });
        setItems((prev) => (after && prev ? [...prev, ...r.items] : r.items));
        setCursor(r.nextCursor);
      } catch (err) {
        setError(t(errorKey(err)));
        setItems((prev) => prev ?? []);
      } finally {
        setLoadingMore(false);
      }
    },
    [online, query, tab, competencyId, t]
  );

  useEffect(() => {
    const id = setTimeout(() => void run(null), 250);
    return () => clearTimeout(id);
  }, [run]);

  const multigradeOptions = [
    ...new Set(
      ws.classes
        .filter((c) => c.gradeGroups.length > 1)
        .map((c) =>
          c.gradeGroups
            .map((g) => g.grade)
            .sort()
            .join(',')
        )
    ),
  ];

  return (
    <div className="flex flex-col gap-3">
      <PageHeader title={t('com.title')} subtitle={t('com.intro')} />
      <div role="tablist" className="flex flex-wrap gap-2">
        {(['browse', 'mine'] as const).map((x) => (
          <button
            key={x}
            role="tab"
            aria-selected={tab === x}
            onClick={() => setTab(x)}
            className={cx(
              'min-h-touch px-4 rounded border',
              tab === x ? 'bg-talaTeal text-white border-talaTeal' : 'bg-white border-hairline'
            )}
          >
            {x === 'browse' ? t('com.browse') : t('com.mine')}
          </button>
        ))}
      </div>
      {!online && <Banner kind="info">{t('com.offline')}</Banner>}
      {online && (
        <>
          <TextInput
            label={t('com.search')}
            type="search"
            hint={t('com.searchHint')}
            value={query.q}
            onChange={(e) => setQuery((q) => ({ ...q, q: e.target.value }))}
          />
          <Button
            variant="quiet"
            onClick={() => setFiltersOpen((o) => !o)}
            aria-expanded={filtersOpen}
          >
            {t('com.filters')} {filtersOpen ? '▴' : '▾'}
          </Button>
          {filtersOpen && (
            <div className="grid gap-2 wide:grid-cols-3">
              <Select
                label={t('com.grade')}
                value={query.grade}
                onChange={(e) => setQuery((q) => ({ ...q, grade: e.target.value }))}
              >
                <option value="">{t('com.any')}</option>
                {GRADES.map((g) => (
                  <option key={g} value={g}>
                    {g === 'K' ? t('common.kinder') : t('common.grade', { g })}
                  </option>
                ))}
              </Select>
              <Select
                label={t('com.subject')}
                value={query.learningAreaId}
                onChange={(e) => setQuery((q) => ({ ...q, learningAreaId: e.target.value }))}
              >
                <option value="">{t('com.any')}</option>
                {(index?.learningAreas ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name[lang]}
                  </option>
                ))}
              </Select>
              <Select
                label={t('com.quarter')}
                value={query.termIndex}
                onChange={(e) => setQuery((q) => ({ ...q, termIndex: e.target.value }))}
              >
                <option value="">{t('com.any')}</option>
                {[1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
              <Select
                label={t('com.language')}
                value={query.language}
                onChange={(e) => setQuery((q) => ({ ...q, language: e.target.value }))}
              >
                <option value="">{t('com.any')}</option>
                <option value="fil">{t('lang.fil')}</option>
                <option value="en">{t('lang.en')}</option>
              </Select>
              <Select
                label={t('com.multigrade')}
                value={query.multigrade}
                onChange={(e) => setQuery((q) => ({ ...q, multigrade: e.target.value }))}
              >
                <option value="">{t('com.any')}</option>
                {multigradeOptions.map((m) => (
                  <option key={m} value={m}>
                    {m
                      .split(',')
                      .map((g) => t('common.grade', { g }))
                      .join(' + ')}
                  </option>
                ))}
              </Select>
              <TextInput
                label={t('com.maxMinutes')}
                inputMode="numeric"
                value={query.maxMinutes}
                onChange={(e) =>
                  setQuery((q) => ({ ...q, maxMinutes: e.target.value.replace(/\D/g, '') }))
                }
              />
            </div>
          )}
          {error && <Banner kind="warn">{error}</Banner>}
          {items === null ? (
            <Placeholder rows={5} />
          ) : items.length === 0 ? (
            <EmptyState>{t('com.noResults')}</EmptyState>
          ) : (
            <>
              <p className="text-small text-forestMuted">{t('com.results', { n: items.length })}</p>
              <List>
                {items.map((a) => (
                  <ArtifactRow key={a.id} a={a} mine={tab === 'mine' || a.mine} />
                ))}
              </List>
              {cursor && (
                <Button onClick={() => void run(cursor)} busy={loadingMore}>
                  {t('lessons.loadMore')}
                </Button>
              )}
            </>
          )}
        </>
      )}
      {!user?.emailVerified && tab === 'mine' && (
        <Banner kind="info">{t('com.postNeedsVerified')}</Banner>
      )}
    </div>
  );
}

export function ArtifactRow({ a, mine }: { a: ArtifactSummary; mine?: boolean }) {
  const { t } = useT();
  const statusTone: Tone =
    a.status === 'visible' ? 'sage' : a.status === 'returned' ? 'brick' : 'neutral';
  return (
    <ListRow
      href={`/community/${a.id}`}
      title={
        <span className="flex flex-wrap items-center gap-2">
          {a.title}
          {a.provenance.aiDrafted && <Badge>{t('com.aiDrafted')}</Badge>}
          {a.provenance.adapted && <Badge>{t('com.adapted')}</Badge>}
          {a.tags.multigrade && (
            <Badge>{a.tags.multigrade.map((g) => t('common.grade', { g })).join(' + ')}</Badge>
          )}
          {mine && <Badge tone={statusTone}>{t(`com.status.${a.status}`)}</Badge>}
        </span>
      }
      subtitle={`${t('com.by', { name: a.authorDisplayName })} · ${a.tags.subjectName} · ${a.tags.grades.map((g) => t('common.grade', { g })).join(', ')}${a.tags.termIndex ? ` · Q${a.tags.termIndex}` : ''} · ${t('com.duration', { n: a.tags.durationMinutes })} · ${t('com.copies', { n: a.copyCount })}`}
    />
  );
}
