'use client';
/**
 * This Week answers one question first: "What am I teaching next, and what do I do first?"
 *
 *  - Up next: the calendar-aware next teaching day, open, with each lesson's topic, plan and ready-made help.
 *  - Help from the Library: the packs that match the lessons still to teach (beside it on wide screens).
 *  - Every other day of the week is one quiet row that opens on tap.
 *  - Pacing ("Am I on pace?") and no-class days stay available, out of the way.
 *
 * The week shown by default is the week of the next teaching day, so on a weekend without classes the teacher sees
 * the coming Monday, and a teacher with a Saturday or Sunday class sees that day (weeks run Monday to Sunday).
 */
import { useEffect, useMemo, useState } from 'react';
import type { CalendarDay, TimelineEntry } from '@hiraia/tala-core/contracts';
import { NON_TEACHING_KINDS } from '@hiraia/tala-core/contracts';
import { formatDate, useT } from '@/i18n';
import { addDays, mondayOf, monthEnd, monthStart } from '@/data/ids';
import { usePackIndex } from '@/data/packs';
import { termWeekFor } from '@/data/recommend';
import { useSession } from '@/data/session';
import { useTimeline } from '@/data/timeline';
import { pendingDisruptionIds } from '@/data/realign';
import { ArrowLink, Callout, Disclosure } from '@/components/editorial';
import { Icon } from '@/components/icons';
import { Badge, Button, EmptyState, LinkButton, List, ListRow, Placeholder, Toast, type Tone } from '@/components/ui';
import { FirstSteps } from '@/features/shell/FirstSteps';
import { MarkSheet } from './MarkSheet';
import { NoClassSheet } from './NoClassSheet';
import { RealignSheet } from './RealignSheet';
import { DayRow, LibraryPanel, UpNext } from './WeekParts';
import { buildSessions, packsFor, scienceGrades } from './sessions';
import { LOOKAHEAD_DAYS, clockOf, nextTeachingDate, type Clock } from './upnext';
import { scheduleWeekdays, weekSpan } from './weekdays';

/** The device clock, refreshed twice a minute so "Up next" moves on when a lesson ends. */
function useClock(): Clock {
  const [now, setNow] = useState(() => clockOf(new Date()));
  useEffect(() => {
    const id = setInterval(() => {
      const c = clockOf(new Date());
      setNow((prev) => (prev.date === c.date && prev.minutes === c.minutes ? prev : c));
    }, 30_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export function WeekScreen() {
  const { t, lang } = useT();
  const { engine } = useSession();
  const now = useClock();
  const today = now.date;
  /** A week the teacher paged to; null = the week of the next teaching day. */
  const [picked, setPicked] = useState<string | null>(null);

  // One timeline covers the month (pacing), the week on screen and the look-ahead for "Up next".
  const thisMonday = mondayOf(today);
  const lookEnd = addDays(mondayOf(addDays(today, LOOKAHEAD_DAYS)), 6);
  const mStart = monthStart(today);
  const mEnd = monthEnd(today);
  const from = [picked ?? thisMonday, thisMonday, mStart].sort()[0]!;
  const to = [addDays(picked ?? thisMonday, 6), lookEnd, mEnd].sort().reverse()[0]!;
  const tl = useTimeline(from, to);
  const { index, failed } = usePackIndex();

  const [marking, setMarking] = useState<TimelineEntry | null>(null);
  const [noClass, setNoClass] = useState(false);
  const [realignIds, setRealignIds] = useState<string[] | null>(null);
  const [toast, setToast] = useState<{ message: string; undo?: () => void } | null>(null);

  const { entries, ws, competencyById } = tl;
  const sessions = useMemo(() => buildSessions({ entries, ws, competencyById }, index, lang, now), [entries, ws, competencyById, index, lang, now]);
  const nextDate = useMemo(() => nextTeachingDate(sessions, now), [sessions, now]);
  const pending = useMemo(() => pendingDisruptionIds(ws, tl.currentTerm?.id ?? null), [ws, tl.currentTerm]);
  const atRisk = tl.summaries.filter((s) => s.plan.atRisk.length);
  const monthEntries = useMemo(() => entries.filter((e) => e.date >= mStart && e.date <= mEnd), [entries, mStart, mEnd]);

  if (tl.loading && !ws.classes.length) {
    return (
      <>
        <h1 className="mb-4 text-display">{t('week.title')}</h1>
        <Placeholder rows={5} />
      </>
    );
  }

  if (!ws.classes.length) {
    return (
      <>
        <h1 className="mb-4 text-display">{t('week.title')}</h1>
        <EmptyState
          art="board"
          action={
            <div className="flex flex-col items-center gap-1">
              <LinkButton href="/setup" variant="primary">
                {t('week.setupAction')}
              </LinkButton>
              <ArrowLink href="/library">{t('wk.empty.library')}</ArrowLink>
            </div>
          }
        >
          {t('week.noClass')}
        </EmptyState>
      </>
    );
  }

  const homeMonday = mondayOf(nextDate ?? today);
  const weekStart = picked ?? homeMonday;
  const weekEnd = addDays(weekStart, 6);
  const isHome = weekStart === homeMonday;
  const go = (weeks: number) => {
    const next = addDays(weekStart, weeks * 7);
    setPicked(next === homeMonday ? null : next);
  };

  const weekSessions = sessions.filter((s) => s.date >= weekStart && s.date <= weekEnd);
  const offDays = ws.calendarDays.filter(
    (d) => d.date >= weekStart && d.date <= weekEnd && NON_TEACHING_KINDS.includes(d.kind) && (!ws.activeYear || d.schoolYearId === ws.activeYear.id)
  );
  const heroDate = isHome ? nextDate : null;
  const heroSessions = heroDate ? weekSessions.filter((s) => s.date === heroDate) : [];
  const otherDates = [0, 1, 2, 3, 4, 5, 6]
    .map((i) => addDays(weekStart, i))
    .filter((date) => date !== heroDate && (weekSessions.some((s) => s.date === date) || offDays.some((d) => d.date === date)));
  // Another week: its first teaching day opens if it is still ahead; a week behind us stays closed.
  const openDate = isHome ? null : (otherDates.find((date) => date > today && weekSessions.some((s) => s.date === date)) ?? null);

  // Header: the week's dates, and where they fall in the school year when the calendar knows. Monday to Friday,
  // through Saturday or Sunday for a teacher with weekend classes (or a make-up that week).
  const span = weekSpan(weekStart, {
    schoolWeekdays: ws.activeYear?.teachingWeekdays,
    scheduleWeekdays: scheduleWeekdays(ws),
    sessionDates: weekSessions.map((s) => s.date),
  });
  const where = termWeekFor(ws.activeYear, span.start) ?? termWeekFor(ws.activeYear, span.end);
  const range = span.start === span.end ? formatDate(span.start, lang) : `${formatDate(span.start, lang)} – ${formatDate(span.end, lang)}`;

  // Library help: packs for the lessons still to teach this week (all of the week's lessons once it is behind us).
  const live = weekSessions.filter((s) => !s.beforeTala);
  const ahead = live.filter((s) => !s.over);
  const packs = packsFor(ahead.length ? ahead : live);
  const grades = scienceGrades({ entries, ws, competencyById });
  const libraryTerm = where?.term ?? tl.currentTerm?.index ?? null;

  const waiting = tl.loading && weekSessions.length === 0;
  const nothingThisWeek = !waiting && !heroDate && otherDates.length === 0;

  return (
    <div className="flex flex-col gap-6">
      {/* Title, then the week it shows between its two arrows: the arrows visibly belong to the dates. */}
      <header className="flex flex-col gap-2 wide:flex-row wide:items-center wide:justify-between wide:gap-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="text-display">{t('week.title')}</h1>
          {!isHome && (
            <button
              type="button"
              onClick={() => setPicked(null)}
              className="inline-flex min-h-touch items-center gap-1.5 rounded-full bg-talaTeal px-4 text-small font-semibold text-white hover:brightness-95"
            >
              <Icon name="restore" size={16} />
              {t('wk.backToThisWeek')}
            </button>
          )}
        </div>
        <nav aria-label={t('wk.pager')} className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => go(-1)}
            aria-label={t('week.prev')}
            title={t('week.prev')}
            className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-hairline bg-white text-forest hover:bg-cream"
          >
            <Icon name="chevronLeft" size={22} />
          </button>
          {/* Dates, then where they fall in the school year: two tidy lines on a phone, one line on wide screens. */}
          <p aria-live="polite" className="kicker min-w-0 flex-1 text-center text-talaTeal wide:flex-none wide:px-1">
            <span className="block whitespace-nowrap wide:inline">{range}</span>
            {where && (
              <>
                <span className="hidden wide:inline"> · </span>
                <span className="mt-1 block whitespace-nowrap wide:mt-0 wide:inline">{t('wk.termWeek', { term: where.term, week: where.week })}</span>
              </>
            )}
          </p>
          <button
            type="button"
            onClick={() => go(1)}
            aria-label={t('week.next')}
            title={t('week.next')}
            className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-hairline bg-white text-forest hover:bg-cream"
          >
            <Icon name="chevronRight" size={22} />
          </button>
        </nav>
      </header>

      <FirstSteps />

      {(pending.length > 0 || atRisk.length > 0) && (
        <section aria-labelledby="attention">
          <Callout tint="yellow" icon="alert" title={<span id="attention">{t('week.needsAttention')}</span>}>
            <ul className="flex flex-col gap-2">
              {pending.length > 0 && (
                <li className="flex flex-wrap items-center justify-between gap-2">
                  <span>{t('realign.pending', { n: pending.length })}</span>
                  <Button variant="primary" onClick={() => setRealignIds(pending)}>
                    {t('realign.fix')}
                  </Button>
                </li>
              )}
              {atRisk.map((s) => (
                <li key={s.track.id}>{t('week.atRisk', { subject: `${s.subjectName} · ${t('common.grade', { g: s.grade })}`, n: s.plan.atRisk.length })}</li>
              ))}
            </ul>
          </Callout>
        </section>
      )}

      <div className="grid gap-6 min-[1180px]:grid-cols-[minmax(0,1fr)_20rem] min-[1180px]:items-start">
        {/* 1. What is next */}
        {waiting ? (
          <div className="min-w-0 min-[1180px]:col-start-1 min-[1180px]:row-start-1">
            <Placeholder rows={4} />
          </div>
        ) : heroDate ? (
          <div className="min-w-0 min-[1180px]:col-start-1 min-[1180px]:row-start-1">
            <UpNext date={heroDate} today={today} sessions={heroSessions} onMark={(s) => setMarking(s.entry)} />
          </div>
        ) : isHome && !nextDate ? (
          <p className="min-w-0 rounded-lg bg-white px-5 py-5 text-lead shadow-card min-[1180px]:col-start-1 min-[1180px]:row-start-1">{t('wk.noUpcoming')}</p>
        ) : null}

        {/* 2. Where to get help. Beside the lessons on wide screens; under Up next on phones. */}
        <div className={`min-w-0 min-[1180px]:sticky min-[1180px]:top-6 min-[1180px]:col-start-2 min-[1180px]:row-span-2 min-[1180px]:row-start-1 ${heroDate || waiting ? '' : 'order-last min-[1180px]:order-none'}`}>
          <LibraryPanel packs={packs} grades={grades} term={libraryTerm} home={isHome} loaded={Boolean(index)} failed={failed} />
        </div>

        {/* 3. The other days, closed; then the quiet extras. */}
        <div className={`flex min-w-0 flex-col gap-6 min-[1180px]:col-start-1 ${heroDate || waiting || (isHome && !nextDate) ? 'min-[1180px]:row-start-2' : 'min-[1180px]:row-start-1'}`}>
          {otherDates.length > 0 && (
            <section aria-labelledby="days-h">
              <h2 id="days-h" className="border-b border-hairline pb-2 text-title">
                {isHome && heroDate ? t('wk.rest.title') : t('week.weekOf', { date: formatDate(weekStart, lang) })}
              </h2>
              <div key={weekStart}>
                {otherDates.map((date) => (
                  <DayRow
                    key={date}
                    date={date}
                    today={today}
                    sessions={weekSessions.filter((s) => s.date === date)}
                    off={offDays.filter((d) => d.date === date)}
                    defaultOpen={date === openDate}
                    onMark={(s) => setMarking(s.entry)}
                  />
                ))}
              </div>
            </section>
          )}
          {nothingThisWeek && <p className="rounded-lg bg-white px-5 py-5 text-lead shadow-card">{t('week.empty')}</p>}

          <div className="flex flex-col">
            <Disclosure
              className="border-y border-hairline"
              icon={<Icon name="challenge" size={22} className="text-talaTeal" />}
              summary={t('wk.pace.title')}
              hint={t('wk.pace.hint')}
            >
              {tl.summaries.length > 0 && (
                <List className="mb-3">
                  {tl.summaries.map((s) => {
                    const n = s.plan.sessionsBehind;
                    const text = n > 0.5 ? t('week.behind', { n: Math.round(n) }) : n < -0.5 ? t('week.ahead', { n: Math.round(-n) }) : t('week.onPace');
                    const tone: Tone = n > 0.5 ? 'brick' : n < -0.5 ? 'teal' : 'sage';
                    return <ListRow key={s.track.id} title={`${s.subjectName} · ${t('common.grade', { g: s.grade })}`} trailing={<Badge tone={tone}>{text}</Badge>} />;
                  })}
                </List>
              )}
              <MonthList entries={monthEntries} />
            </Disclosure>
            <div className="pt-2">
              <Button variant="quiet" onClick={() => setNoClass(true)}>
                <Icon name="flag" size={18} />
                {t('wk.noClassAction')}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <MarkSheet entry={marking} onClose={() => setMarking(null)} ws={ws} onSaved={() => setToast({ message: t('mark.saved') })} />
      <NoClassSheet
        open={noClass}
        onClose={() => setNoClass(false)}
        ws={ws}
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
  if (!weeks.length) return <p className="text-forestMuted">{t('week.monthEmpty')}</p>;
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
