'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { CalendarDay, TimelineEntry } from '@hiraia/tala-core/contracts';
import { NON_TEACHING_KINDS } from '@hiraia/tala-core/contracts';
import { formatDate, formatLongDate, useT } from '@/i18n';
import { addDays, isoDate, mondayOf, monthEnd, monthStart } from '@/data/ids';
import { useSession } from '@/data/session';
import { groupByDate, useTimeline } from '@/data/timeline';
import { pendingDisruptionIds } from '@/data/realign';
import {
  Badge,
  Banner,
  Button,
  EmptyState,
  LinkButton,
  List,
  ListRow,
  PageHeader,
  Placeholder,
  SectionTitle,
  Toast,
  type Tone,
} from '@/components/ui';
import { MarkSheet } from './MarkSheet';
import { NoClassSheet } from './NoClassSheet';
import { RealignSheet } from './RealignSheet';

export function WeekScreen() {
  const { t, lang } = useT();
  const { engine } = useSession();
  const today = isoDate();
  const [weekStart, setWeekStart] = useState(() => mondayOf(today));
  const weekEnd = addDays(weekStart, 6);
  const mStart = monthStart(today);
  const mEnd = monthEnd(today);
  const from = weekStart < mStart ? weekStart : mStart;
  const to = weekEnd > mEnd ? weekEnd : mEnd;
  const tl = useTimeline(from, to);
  const [marking, setMarking] = useState<TimelineEntry | null>(null);
  const [noClass, setNoClass] = useState(false);
  const [realignIds, setRealignIds] = useState<string[] | null>(null);
  const [toast, setToast] = useState<{ message: string; undo?: () => void } | null>(null);

  const pending = useMemo(
    () => pendingDisruptionIds(tl.ws, tl.currentTerm?.id ?? null),
    [tl.ws, tl.currentTerm]
  );

  const weekEntries = useMemo(
    () => tl.entries.filter((e) => e.date >= weekStart && e.date <= weekEnd),
    [tl.entries, weekStart, weekEnd]
  );
  const days = useMemo(() => groupByDate(weekEntries), [weekEntries]);
  const offDays = useMemo(
    () =>
      tl.ws.calendarDays.filter(
        (d) =>
          d.date >= weekStart &&
          d.date <= weekEnd &&
          NON_TEACHING_KINDS.includes(d.kind) &&
          (!tl.ws.activeYear || d.schoolYearId === tl.ws.activeYear.id)
      ),
    [tl.ws.calendarDays, tl.ws.activeYear, weekStart, weekEnd]
  );
  const monthEntries = useMemo(
    () => tl.entries.filter((e) => e.date >= mStart && e.date <= mEnd),
    [tl.entries, mStart, mEnd]
  );
  const atRisk = tl.summaries.filter((s) => s.plan.atRisk.length);

  if (tl.loading && !tl.ws.classes.length) {
    return (
      <>
        <PageHeader title={t('week.title')} />
        <Placeholder rows={5} />
      </>
    );
  }

  if (!tl.ws.classes.length) {
    return (
      <>
        <PageHeader title={t('week.title')} />
        <EmptyState
          action={
            <LinkButton href="/setup" variant="primary">
              {t('week.setupAction')}
            </LinkButton>
          }
        >
          {t('week.noClass')}
        </EmptyState>
      </>
    );
  }

  const isThisWeek = weekStart === mondayOf(today);

  return (
    <>
      <PageHeader
        title={t('week.title')}
        subtitle={isThisWeek ? undefined : t('week.weekOf', { date: formatDate(weekStart, lang) })}
      />

      {/* Needs attention */}
      {(pending.length > 0 || atRisk.length > 0) && (
        <section aria-labelledby="attention" className="flex flex-col gap-2 mb-4">
          <h2 id="attention" className="text-title">
            {t('week.needsAttention')}
          </h2>
          {pending.length > 0 && (
            <Banner
              kind="warn"
              action={
                <Button variant="primary" onClick={() => setRealignIds(pending)}>
                  {t('realign.fix')}
                </Button>
              }
            >
              {t('realign.pending', { n: pending.length })}
            </Banner>
          )}
          {atRisk.map((s) => (
            <Banner key={s.track.id} kind="warn">
              {t('week.atRisk', {
                subject: `${s.subjectName} · ${t('common.grade', { g: s.grade })}`,
                n: s.plan.atRisk.length,
              })}
            </Banner>
          ))}
        </section>
      )}

      {/* Week navigation */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <Button
          variant="quiet"
          onClick={() => setWeekStart((w) => addDays(w, -7))}
          aria-label={t('week.prev')}
        >
          ← {t('week.prev')}
        </Button>
        {!isThisWeek && (
          <Button variant="quiet" onClick={() => setWeekStart(mondayOf(today))}>
            {t('week.thisWeek')}
          </Button>
        )}
        <Button
          variant="quiet"
          onClick={() => setWeekStart((w) => addDays(w, 7))}
          aria-label={t('week.next')}
        >
          {t('week.next')} →
        </Button>
      </div>

      {tl.loading && weekEntries.length === 0 ? (
        <Placeholder rows={4} />
      ) : days.length === 0 && offDays.length === 0 ? (
        <EmptyState>{t('week.empty')}</EmptyState>
      ) : (
        <div className="flex flex-col gap-4">
          {[0, 1, 2, 3, 4, 5, 6].map((i) => {
            const date = addDays(weekStart, i);
            const entries = days.find((d) => d.date === date)?.entries ?? [];
            const off = offDays.filter((d) => d.date === date);
            if (!entries.length && !off.length) return null;
            return (
              <section key={date} aria-labelledby={`d-${date}`}>
                <h2
                  id={`d-${date}`}
                  className={`text-title mb-1 flex items-center gap-2 ${date === today ? 'text-talaTeal' : ''}`}
                >
                  {formatLongDate(date, lang)}
                  {date === today && <Badge tone="teal">{t('common.today')}</Badge>}
                </h2>
                <List>
                  {off.map((d) => (
                    <ListRow
                      key={d.id}
                      title={`${t('week.noClassDay')} · ${t(`noclass.kind.${d.kind}` as never) || d.kind}`}
                      subtitle={d.label || undefined}
                    />
                  ))}
                  {entries.map((e) => (
                    <SessionRow
                      key={`${e.date}-${e.assignmentId}-${e.slotId}`}
                      entry={e}
                      tl={tl}
                      onMark={() => setMarking(e)}
                    />
                  ))}
                </List>
              </section>
            );
          })}
        </div>
      )}

      <div className="mt-4">
        <Button onClick={() => setNoClass(true)} full>
          {t('week.markNoClass')}
        </Button>
      </div>

      {/* This Month */}
      <SectionTitle>{t('week.month')}</SectionTitle>
      {tl.summaries.length > 0 && (
        <List className="mb-3">
          {tl.summaries.map((s) => {
            const n = s.plan.sessionsBehind;
            const text =
              n > 0.5
                ? t('week.behind', { n: Math.round(n) })
                : n < -0.5
                  ? t('week.ahead', { n: Math.round(-n) })
                  : t('week.onPace');
            const tone: Tone = n > 0.5 ? 'brick' : n < -0.5 ? 'teal' : 'sage';
            return (
              <ListRow
                key={s.track.id}
                title={`${s.subjectName} · ${t('common.grade', { g: s.grade })}`}
                trailing={<Badge tone={tone}>{text}</Badge>}
              />
            );
          })}
        </List>
      )}
      <MonthList entries={monthEntries} />

      <MarkSheet
        entry={marking}
        onClose={() => setMarking(null)}
        ws={tl.ws}
        onSaved={() => setToast({ message: t('mark.saved') })}
      />
      <NoClassSheet
        open={noClass}
        onClose={() => setNoClass(false)}
        ws={tl.ws}
        defaultDate={today}
        onSaved={(day: CalendarDay) => {
          setNoClass(false);
          setRealignIds([day.id]);
        }}
      />
      {realignIds && engine && (
        <RealignSheet
          open
          onClose={() => setRealignIds(null)}
          dayIds={realignIds}
          tl={tl}
          onApplied={(undo) => {
            setRealignIds(null);
            setToast({ message: t('realign.applied'), undo });
          }}
        />
      )}
      <Toast message={toast?.message ?? null} onUndo={toast?.undo} onDone={() => setToast(null)} />
    </>
  );
}

function SessionRow({
  entry,
  tl,
  onMark,
}: {
  entry: TimelineEntry;
  tl: ReturnType<typeof useTimeline>;
  onMark: () => void;
}) {
  const { t } = useT();
  const cls = tl.ws.classes.find((c) => c.id === entry.classId);
  const groups = Object.keys(entry.byGroup);
  const multi = groups.length > 1;
  const topics = groups.map((gid) => {
    const grade = cls?.gradeGroups.find((g) => g.id === gid)?.grade;
    const first = entry.byGroup[gid]?.[0];
    const comp = first ? tl.competencyById.get(first) : null;
    const text = comp ? (comp.code ? `${comp.code} · ` : '') + comp.text : '';
    return { grade, text };
  });
  const assignment = tl.ws.assignments.find((a) => a.id === entry.assignmentId);
  const slot = assignment?.slots.find((s) => s.id === entry.slotId);
  // No curriculum data for this subject (typed objectives, CUR-10): no per-group competency lines to show.
  const hasCurriculum = !!assignment?.learningAreaId && topics.some((tp) => tp.text);
  const state =
    entry.mark === 'taught'
      ? 'taught'
      : entry.mark === 'partial'
        ? 'partial'
        : entry.mark === 'not_taught'
          ? 'notTaught'
          : entry.planState === 'locked'
            ? 'locked'
            : entry.planState === 'draft'
              ? 'draft'
              : entry.mark === 'assumed_taught'
                ? 'assumed'
                : 'none';
  const tone: Tone =
    state === 'taught'
      ? 'sage'
      : state === 'locked'
        ? 'teal'
        : state === 'notTaught'
          ? 'brick'
          : 'neutral';
  const stateLabel = t(`week.state.${state}` as never);
  const kindLabel =
    entry.kind === 'buffer'
      ? t('week.buffer')
      : entry.kind === 'assessment'
        ? t('week.assessment')
        : null;
  const href = entry.planId
    ? `/lessons/${entry.planId}`
    : `/lessons/new?classId=${entry.classId}&assignmentId=${entry.assignmentId}&date=${entry.date}&slotId=${entry.slotId}`;
  const past = entry.date <= tl.today;
  const beforeTala =
    (entry.kind as string) === 'before_tala' || (entry.mark as string | null) === 'before_tala';
  if (beforeTala) {
    // Covered before the teacher started using Tala: no plan needed, never behind (PACE-5). A quiet completed row.
    return (
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-3 py-2 bg-white border-b border-hairline last:border-b-0 text-forestMuted">
        <span>
          {slot?.startTime ? `${slot.startTime} · ` : ''}
          {entry.subjectName}
        </span>
        <Badge tone="sage">✓ {t('week.state.beforeTala')}</Badge>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2 px-3 py-3 bg-white border-b border-hairline last:border-b-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="font-medium">
          {slot?.startTime ? `${slot.startTime} · ` : ''}
          {entry.subjectName}
          {tl.ws.classes.length > 1 && cls ? ` · ${cls.name}` : ''}
        </span>
        <span className="flex flex-wrap items-center gap-2">
          {multi && <Badge>{t('week.multigrade')}</Badge>}
          {kindLabel ? <Badge>{kindLabel}</Badge> : <Badge tone={tone}>{stateLabel}</Badge>}
        </span>
      </div>
      {hasCurriculum
        ? topics.map((tp, i) => (
            <p key={i} className="text-small text-forestMuted break-words">
              {multi && tp.grade ? (
                <strong className="text-forest">{t('common.grade', { g: tp.grade })}: </strong>
              ) : null}
              {tp.text || (entry.kind === 'lesson' ? t('editor.noCompetency') : '')}
            </p>
          ))
        : multi && (
            <p className="text-small text-forestMuted">
              {topics
                .map((tp) => (tp.grade ? t('common.grade', { g: tp.grade }) : ''))
                .filter(Boolean)
                .join(' + ')}
            </p>
          )}
      <div className="flex flex-wrap gap-2">
        {entry.kind === 'lesson' && (
          <Link
            href={href}
            className={`inline-flex items-center justify-center min-h-touch px-4 rounded border font-medium ${entry.planId ? 'bg-white border-forest' : 'bg-talaTeal text-white border-talaTeal'}`}
          >
            {entry.planId ? t('week.open') : t('week.create')}
          </Link>
        )}
        {past && groups.length > 0 && (
          <Button variant="quiet" onClick={onMark}>
            {t('week.mark')}
          </Button>
        )}
      </div>
    </div>
  );
}

function MonthList({ entries }: { entries: TimelineEntry[] }) {
  const { t, lang } = useT();
  const weeks = useMemo(() => {
    const map = new Map<string, TimelineEntry[]>();
    for (const e of entries) {
      const w = mondayOf(e.date);
      map.set(w, [...(map.get(w) ?? []), e]);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [entries]);
  if (!weeks.length) return <EmptyState>{t('week.monthEmpty')}</EmptyState>;
  return (
    <List>
      {weeks.map(([w, es]) => {
        const lessons = es.filter((e) => e.kind === 'lesson');
        const without = lessons.filter((e) => e.planState === 'none').length;
        return (
          <ListRow
            key={w}
            title={t('week.weekOf', { date: formatDate(w, lang) })}
            subtitle={`${t('week.sessions', { n: lessons.length })}${without ? ` · ${t('week.withoutPlan', { n: without })}` : ''}`}
          />
        );
      })}
    </List>
  );
}
