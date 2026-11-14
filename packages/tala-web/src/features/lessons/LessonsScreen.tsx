'use client';
import { useMemo, useState } from 'react';
import type { Plan } from '@hiraia/tala-core/contracts';
import { formatDate, useT } from '@/i18n';
import { useWorkspace } from '@/data/records';
import { displayTitle, planDates } from '@/data/plans';
import {
  Badge,
  Button,
  EmptyState,
  LinkButton,
  List,
  ListRow,
  PageHeader,
  Placeholder,
  Select,
  TextInput,
  type Tone,
} from '@/components/ui';

const PAGE = 20;

/** Per-subject list of lessons (PLAN-11): a plain list, newest date first, 20 at a time (§14.1). */
export function LessonsScreen() {
  const { t, lang } = useT();
  const ws = useWorkspace();
  const [query, setQuery] = useState('');
  const [subject, setSubject] = useState('');
  const [shown, setShown] = useState(PAGE);

  const subjects = useMemo(
    () => [...new Set(ws.plans.map((p) => p.subjectName).filter(Boolean))].sort(),
    [ws.plans]
  );
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ws.planRecords
      .filter((r) => r.data.state !== 'archived')
      .filter((r) => !subject || r.data.subjectName === subject)
      .filter(
        (r) =>
          !q ||
          r.data.title.toLowerCase().includes(q) ||
          r.data.subjectName.toLowerCase().includes(q)
      )
      .sort(
        (a, b) =>
          (planDates(b.data)[0] ?? '').localeCompare(planDates(a.data)[0] ?? '') ||
          b.updatedAt.localeCompare(a.updatedAt)
      );
  }, [ws.planRecords, query, subject]);

  return (
    <>
      <PageHeader
        title={t('lessons.title')}
        action={
          <LinkButton href="/lessons/new" variant="primary">
            + {t('lessons.new')}
          </LinkButton>
        }
      />
      {ws.loading ? (
        <Placeholder rows={5} />
      ) : ws.plans.filter((p) => p.state !== 'archived').length === 0 ? (
        <EmptyState
          action={
            <LinkButton href="/lessons/new" variant="primary">
              {t('lessons.new')}
            </LinkButton>
          }
        >
          {t('lessons.empty')}
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="grid gap-2 wide:grid-cols-2">
            <TextInput
              label={t('lessons.search')}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {subjects.length > 1 && (
              <Select
                label={t('lessons.filterSubject')}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              >
                <option value="">{t('lessons.all')}</option>
                {subjects.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            )}
          </div>
          <List>
            {list.slice(0, shown).map((r) => (
              <LessonRow
                key={r.id}
                plan={r.data}
                dirty={r.dirty}
                conflict={!!r.conflict}
                ws={ws}
                lang={lang}
              />
            ))}
          </List>
          {list.length > shown && (
            <Button onClick={() => setShown((s) => s + PAGE)}>{t('lessons.loadMore')}</Button>
          )}
        </div>
      )}
    </>
  );
}

function LessonRow({
  plan,
  dirty,
  conflict,
  ws,
  lang,
}: {
  plan: Plan;
  dirty: boolean;
  conflict: boolean;
  ws: ReturnType<typeof useWorkspace>;
  lang: 'fil' | 'en';
}) {
  const { t } = useT();
  const cls = ws.allClasses.find((c) => c.id === plan.placements[0]?.classId);
  const dates = planDates(plan);
  const stateKey = plan.state === 'locked' ? 'week.state.locked' : 'week.state.draft';
  const tone: Tone = plan.state === 'locked' ? 'teal' : 'neutral';
  return (
    <ListRow
      href={`/lessons/${plan.id}`}
      title={
        <span className="flex flex-wrap items-center gap-2">
          <span className="line-clamp-3 break-words [overflow-wrap:anywhere]">
            {displayTitle(plan, t('lessons.untitled'))}
          </span>
          {cls?.isSample && <Badge tone="gold">{t('lessons.sampleTag')}</Badge>}
          {plan.aiDraft && <Badge>{t('lessons.aiDraft')}</Badge>}
          {conflict && <Badge tone="brick">{t('lessons.conflictBadge')}</Badge>}
        </span>
      }
      subtitle={[
        plan.subjectName,
        cls?.name,
        dates.length ? formatDate(dates[0]!, lang) : t('lessons.noDate'),
        dirty ? t('editor.waitingToSend') : null,
      ]
        .filter(Boolean)
        .join(' · ')}
      trailing={<Badge tone={tone}>{t(stateKey)}</Badge>}
    />
  );
}
