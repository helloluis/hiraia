'use client';
/**
 * The pieces of This Week: the "Up next" card, one lesson, the Library help beside it, and a collapsed day.
 * A lesson reads top-down the way a teacher asks: when and which class → what topic → my plan → ready-made help.
 */
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import type { CalendarDay, PackStatus } from '@hiraia/tala-core/contracts';
import { formatDate, formatLongDate, formatWeekday, useT, type StringKey } from '@/i18n';
import { previewUrl } from '@/data/packs';
import type { PackSuggestion } from '@/data/recommend';
import { ArrowLink, Disclosure, Kicker, StatusChip } from '@/components/editorial';
import { Icon, type IconName } from '@/components/icons';
import { Button, LinkButton, Placeholder, cx } from '@/components/ui';
import type { SessionState, SessionView, TopicView, WeekPack } from './sessions';
import { dayRelation, formatClock } from './upnext';

/* ---------- small shared pieces ---------- */

/** A link shaped like a pill, with its icon: one tap to one part of a pack. */
export function PillLink({ href, icon, children }: { href: string; icon: IconName; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-touch items-center gap-1.5 rounded-full border border-talaTeal/30 bg-white px-3.5 text-small font-semibold text-talaTeal hover:border-talaTeal hover:bg-cream"
    >
      <Icon name={icon} size={17} />
      <span>{children}</span>
    </Link>
  );
}

/** The pack's first slide as its cover. Decoration: the title beside it is the link a screen reader reads. */
function PackCover({ s, className }: { s: PackSuggestion; className?: string }) {
  const [broken, setBroken] = useState(false);
  if (!s.hasFiles || broken)
    return (
      <span className={cx('flex aspect-video items-center justify-center bg-forest text-yellow', className)}>
        <Icon name="slides" size={26} />
      </span>
    );
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={previewUrl(s.packId, 1, s.language)}
      alt=""
      loading="lazy"
      decoding="async"
      width={640}
      height={360}
      onError={() => setBroken(true)}
      className={cx('aspect-video border border-hairline bg-forest object-cover', className)}
    />
  );
}

/** A pack's review status, in the Library's own words (never softened here). */
const PACK_STATUS: Partial<Record<PackStatus, { key: StringKey; tone: 'ready' | 'draft' | 'fix' }>> = {
  approved: { key: 'lib.status.approved', tone: 'ready' },
  draft: { key: 'lib.status.draft', tone: 'draft' },
  needs_work: { key: 'lib.status.needs_work', tone: 'fix' },
};
function PackStatusChip({ status }: { status: PackStatus }) {
  const { t } = useT();
  const m = PACK_STATUS[status];
  return m ? <StatusChip tone={m.tone}>{t(m.key)}</StatusChip> : null;
}

/** "Grade 4 · Term 2 · Week 10" may break between facts, never inside one ("Week" / "10"). */
const keepFacts = (text: string) =>
  text
    .split(' · ')
    .map((fact) => fact.replace(/ /g, '\u00A0'))
    .join(' · ');

function PackMeta({ s }: { s: PackSuggestion }) {
  const { t } = useT();
  return (
    <>
      {keepFacts(t('wk.lib.meta', { grade: s.grade, term: s.term, week: s.week }))}
      {s.otherLanguage && <> · {keepFacts(t(s.language === 'en' ? 'wk.lib.inEnglish' : 'wk.lib.inFilipino'))}</>}
    </>
  );
}

const packHref = (s: PackSuggestion, tab?: 'lessons' | 'slides' | 'guide', day?: number | null) =>
  `/library/${s.packId}${tab ? `?tab=${tab}${day ? `&day=${day}` : ''}` : ''}`;

/* ---------- Library help beside one lesson ---------- */

/** `onPage`: the row sits on the cream page (a day row) rather than on a white card. */
export function LibraryRow({ library, onPage }: { library: NonNullable<TopicView['library']>; onPage?: boolean }) {
  const { t } = useT();
  if (library.kind === 'none') {
    return (
      <div className="mt-3 flex items-start gap-2.5 text-small text-forestMuted">
        <Icon name="book" size={18} className="mt-0.5" />
        <div className="min-w-0">
          <p>{t('wk.lib.none')}</p>
          <ArrowLink href={`/library?grade=${library.grade}${library.term ? `&term=${library.term}` : ''}`} className="-mt-1.5 text-small">
            {t('wk.lib.browseGrade', { grade: library.grade })}
          </ArrowLink>
        </div>
      </div>
    );
  }
  const s = library.suggestion;
  return (
    <div className={cx('mt-4 rounded-lg p-3 wide:p-4', onPage ? 'border border-hairline bg-white' : 'bg-talaTeal/10')}>
      <Kicker icon="book">{t(s.match === 'calendar' ? 'wk.lib.calendar' : 'wk.lib.kicker')}</Kicker>
      <div className="mt-2.5 grid grid-cols-[7rem_minmax(0,1fr)] items-start gap-x-3 gap-y-2 wide:grid-cols-[9rem_minmax(0,1fr)] wide:gap-y-1">
        <Link
          href={packHref(s)}
          className="col-span-2 font-semibold leading-snug text-forest underline-offset-4 break-words hover:underline wide:col-span-1 wide:col-start-2 wide:row-start-1"
        >
          {s.title}
        </Link>
        <Link href={packHref(s)} aria-hidden="true" tabIndex={-1} className="col-start-1 wide:row-span-3 wide:row-start-1">
          <PackCover s={s} className="w-full rounded-sm" />
        </Link>
        <p className="col-start-2 min-w-0 self-center text-small text-forestMuted wide:self-start">
          <PackMeta s={s} />
        </p>
        {/* The status never wraps mid-phrase: its own line on phones, under the facts on wide screens. */}
        <p className="col-span-2 wide:col-span-1 wide:col-start-2">
          <PackStatusChip status={s.status} />
        </p>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <PillLink href={packHref(s, 'lessons', library.day)} icon="lessons">
          {library.day ? t('wk.lib.lessonDay', { day: library.day }) : t('wk.lib.lessons')}
        </PillLink>
        <PillLink href={packHref(s, 'slides')} icon="slides">
          {t('wk.lib.slides')}
        </PillLink>
        <PillLink href={packHref(s, 'guide')} icon="lightbulb">
          {t('wk.lib.guide')}
        </PillLink>
      </div>
    </div>
  );
}

/* ---------- one lesson ---------- */

const STATE: Record<SessionState, { tone: 'ready' | 'draft' | 'fix' | 'quiet' | 'mine'; icon: IconName }> = {
  taught: { tone: 'ready', icon: 'checkCircle' },
  partial: { tone: 'draft', icon: 'clock' },
  notTaught: { tone: 'fix', icon: 'alert' },
  locked: { tone: 'mine', icon: 'lock' },
  draft: { tone: 'draft', icon: 'pencil' },
  assumed: { tone: 'quiet', icon: 'check' },
  none: { tone: 'quiet', icon: 'file' },
};

function StateChip({ view }: { view: SessionView }) {
  const { t } = useT();
  if (view.kind === 'buffer') return <StatusChip tone="quiet" icon="clock">{t('week.buffer')}</StatusChip>;
  if (view.kind === 'assessment') return <StatusChip tone="quiet" icon="checklist">{t('week.assessment')}</StatusChip>;
  const s = STATE[view.state];
  return (
    <StatusChip tone={s.tone} icon={s.icon}>
      {t(`week.state.${view.state}` as StringKey)}
    </StatusChip>
  );
}

function Topic({ tp, big, showGrade }: { tp: TopicView; big: boolean; showGrade: boolean }) {
  const { t } = useT();
  return (
    <div className="mt-2">
      <h3 className={cx('font-display font-semibold break-words [text-wrap:balance]', big ? 'text-title' : 'text-[1.125rem] leading-snug')}>
        {showGrade && tp.grade && <span className="mr-2 font-body text-small font-bold uppercase tracking-wider text-talaTeal">{t('common.grade', { g: tp.grade })}</span>}
        {tp.title || t('editor.noCompetency')}
      </h3>
      {tp.text && (
        <details className="disclosure">
          <summary className="flex min-h-touch flex-wrap items-center gap-x-3 text-small text-forestMuted">
            {tp.time && <span className="whitespace-nowrap">{tp.time}</span>}
            <span className="inline-flex items-center gap-1 whitespace-nowrap font-medium text-talaTeal">
              {t('wk.competency')}
              <Icon name="chevronDown" size={16} className="disclosure-chevron" />
            </span>
          </summary>
          <p className="mb-1 max-w-measure border-l-2 border-yellow pl-3 text-forest">{tp.text}</p>
        </details>
      )}
    </div>
  );
}

/** One lesson. `big` is the Up next card; the day rows use the calmer size. */
export function LessonBlock({ view, big, onMark }: { view: SessionView; big: boolean; onMark: () => void }) {
  const { t, lang } = useT();
  const minutes = t('wk.minutes', { n: view.minutes });
  // Subject first only when the headline below is a topic; otherwise the subject IS the headline.
  const who = [view.hasTopic ? view.subject : null, view.className].filter(Boolean) as string[];

  if (view.beforeTala) {
    // Covered before the teacher started using Tala: no plan needed, never behind. A quiet finished line.
    return (
      <div className={cx('flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-forestMuted', big ? 'px-5 py-4 wide:px-7' : 'py-3')}>
        <span>
          {view.startTime ? `${formatClock(view.startTime)} · ` : ''}
          {view.subject}
          {view.className ? ` · ${view.className}` : ''}
        </span>
        <StatusChip tone="quiet" icon="check">{t('week.state.beforeTala')}</StatusChip>
      </div>
    );
  }

  const libraries = view.topics.filter((tp) => tp.library).map((tp) => ({ id: tp.groupId, library: tp.library! }));
  return (
    <article className={big ? 'px-5 py-5 wide:px-7 wide:py-6' : 'py-4'}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <p className="kicker flex items-center gap-1.5 text-forest">
          <Icon name="clock" size={15} strokeWidth={2.1} />
          <span className="whitespace-nowrap">{view.startTime ? `${formatClock(view.startTime)}\u00A0· ${minutes}` : minutes}</span>
        </p>
        <span className="flex flex-wrap items-center gap-2">
          {view.multi && <StatusChip tone="quiet" icon="users">{t('week.multigrade')}</StatusChip>}
          <StateChip view={view} />
        </span>
      </div>
      {who.length > 0 && <p className="kicker mt-2.5 text-forestMuted">{who.join('\u00A0· ')}</p>}

      {view.hasTopic ? (
        view.topics.map((tp) => <Topic key={tp.groupId} tp={tp} big={big} showGrade={view.multi} />)
      ) : (
        <h3 className={cx('mt-2 font-display font-semibold break-words [text-wrap:balance]', big ? 'text-title' : 'text-[1.125rem] leading-snug')}>{view.planTitle || view.subject}</h3>
      )}
      {view.hasTopic && view.planTitle && (
        <p className="mt-1 flex items-start gap-1.5 text-small text-forestMuted">
          <Icon name="lessons" size={16} className="mt-0.5" />
          <span className="min-w-0 break-words [overflow-wrap:anywhere]">{t('wk.myPlan', { title: view.planTitle })}</span>
        </p>
      )}
      {/* A Saturday or Sunday class: DepEd's weeks run Monday to Friday, so its topic is Tala's suggestion. */}
      {view.weekend && view.hasTopic && view.kind === 'lesson' && (
        <p className="mt-2 flex items-start gap-1.5 text-small text-forestMuted" data-testid="weekend-note">
          <Icon name="lightbulb" size={16} className="mt-0.5 shrink-0" />
          <span className="min-w-0">{t('wk.weekend.note', { weekday: formatWeekday(view.date, lang) })}</span>
        </p>
      )}

      {(view.kind === 'lesson' || view.canMark) && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {view.kind === 'lesson' &&
            (view.entry.planId ? (
              <LinkButton href={view.href} variant="secondary">
                <Icon name="lessons" size={18} />
                {t('wk.openPlan')}
              </LinkButton>
            ) : (
              <LinkButton href={view.href} variant={view.over ? 'secondary' : 'primary'}>
                <Icon name="pencil" size={18} />
                {t('week.create')}
              </LinkButton>
            ))}
          {view.canMark && (
            <Button variant="quiet" onClick={onMark}>
              <Icon name="checkCircle" size={18} />
              {t('wk.mark')}
            </Button>
          )}
        </div>
      )}

      {libraries.map((l) => (
        <LibraryRow key={l.id} library={l.library} onPage={!big} />
      ))}
    </article>
  );
}

/* ---------- Up next: the next teaching day, open ---------- */

export function UpNext({ date, today, sessions, onMark }: { date: string; today: string; sessions: SessionView[]; onMark: (s: SessionView) => void }) {
  const { t, lang } = useT();
  const rel = dayRelation(date, today);
  const kicker = rel === 'today' ? t('wk.upNext.today') : rel === 'tomorrow' ? t('wk.upNext.tomorrow') : t('wk.upNext.day', { weekday: formatWeekday(date, lang) });
  const n = sessions.length;
  return (
    <section aria-labelledby="upnext-h" className="overflow-hidden rounded-xl bg-white shadow-card" data-testid="up-next">
      <header className="bg-forest px-5 py-5 text-cream wide:px-7 wide:py-6">
        <p className="kicker flex items-center gap-1.5 text-yellow">
          <Icon name="calendar" size={15} strokeWidth={2.1} />
          <span>{kicker}</span>
        </p>
        <h2 id="upnext-h" className="mt-2 text-[clamp(1.5rem,1.1rem+1.6vw,2.5rem)] leading-[1.1] [text-wrap:balance]">
          {formatLongDate(date, lang)}
        </h2>
        <p className="mt-2.5 max-w-measure text-cream/90">
          <span className="font-semibold text-cream">{n === 1 ? t('wk.lessons.one') : t('wk.lessons.many', { n })}.</span> {t('wk.upNext.lead')}
        </p>
      </header>
      <div className="divide-y divide-hairline">
        {sessions.map((s) => (
          <LessonBlock key={s.key} view={s} big onMark={() => onMark(s)} />
        ))}
      </div>
    </section>
  );
}

/* ---------- any other day: one row, opens on tap ---------- */

const OFF_KIND: Partial<Record<CalendarDay['kind'], StringKey>> = {
  suspension: 'noclass.kind.suspension',
  local_holiday: 'noclass.kind.local_holiday',
  school_event: 'noclass.kind.school_event',
  exam: 'noclass.kind.exam',
  national_holiday: 'wk.kind.national_holiday',
  deped_event: 'wk.kind.deped_event',
};

function DateTile({ date, tone }: { date: string; tone: 'today' | 'ahead' | 'past' }) {
  const { lang } = useT();
  return (
    <span
      aria-hidden="true"
      className={cx(
        'flex h-12 w-12 shrink-0 flex-col items-center justify-center gap-0.5 rounded leading-none',
        tone === 'today' ? 'bg-talaTeal text-white' : tone === 'ahead' ? 'border border-hairline bg-white text-forest' : 'bg-forest/10 text-forestMuted'
      )}
    >
      <span className="text-[0.6875rem] font-bold uppercase tracking-wider">{formatDate(date, lang, { weekday: 'short' })}</span>
      <span className="font-display text-[1.25rem] font-semibold leading-none">{Number(date.slice(8))}</span>
    </span>
  );
}

export function DayRow({
  date,
  today,
  sessions,
  off,
  defaultOpen,
  onMark,
}: {
  date: string;
  today: string;
  sessions: SessionView[];
  off: CalendarDay[];
  defaultOpen: boolean;
  onMark: (s: SessionView) => void;
}) {
  const { t, lang } = useT();
  const rel = dayRelation(date, today);
  // A day is behind us once its date has passed, or today once every lesson is over.
  const done = rel === 'past' || (rel === 'today' && sessions.length > 0 && sessions.every((s) => s.over));
  const offLabel = (d: CalendarDay) => d.label || (OFF_KIND[d.kind] ? t(OFF_KIND[d.kind]!) : '');

  const parts: string[] = off.map((d) => [t('week.noClassDay'), offLabel(d)].filter(Boolean).join(' · '));
  const n = sessions.length;
  if (n) parts.push(n === 1 ? t('wk.lessons.one') : t('wk.lessons.many', { n }));
  if (n && !done) {
    const lessons = sessions.filter((s) => s.kind === 'lesson');
    const without = lessons.filter((s) => s.entry.planState === 'none').length;
    if (lessons.length) parts.push(without ? t('week.withoutPlan', { n: without }) : t('wk.sum.allPlanned'));
  } else if (n) {
    const count = (st: SessionState) => sessions.filter((s) => s.state === st).length;
    if (count('notTaught')) parts.push(t('wk.sum.notTaught', { n: count('notTaught') }));
    if (count('partial')) parts.push(t('wk.sum.partial', { n: count('partial') }));
    if (count('taught') === n) parts.push(t('wk.sum.allTaught'));
  }

  return (
    <Disclosure
      className="border-b border-hairline"
      defaultOpen={defaultOpen}
      icon={<DateTile date={date} tone={rel === 'today' ? 'today' : done ? 'past' : 'ahead'} />}
      summary={
        <span className={cx('flex flex-wrap items-center gap-x-2 gap-y-1', done && rel !== 'today' && 'font-medium text-forestMuted')}>
          <span>{formatLongDate(date, lang)}</span>
          {rel === 'today' && <span className="rounded-full bg-talaTeal px-2 py-0.5 text-small font-medium leading-tight text-white">{t('common.today')}</span>}
          {rel === 'tomorrow' && <span className="rounded-full bg-yellow/40 px-2 py-0.5 text-small font-medium leading-tight text-forest">{t('wk.tomorrow')}</span>}
        </span>
      }
      hint={parts.join(' · ')}
    >
      <div className="divide-y divide-hairline wide:pl-[3.75rem]">
        {off.map((d) => (
          <p key={d.id} className="flex items-center gap-2 py-3 text-forestMuted">
            <Icon name="flag" size={18} />
            <span>{[t('week.noClassDay'), offLabel(d)].filter(Boolean).join(' · ')}</span>
          </p>
        ))}
        {sessions.map((s) => (
          <LessonBlock key={s.key} view={s} big={false} onMark={() => onMark(s)} />
        ))}
      </div>
    </Disclosure>
  );
}

/* ---------- Help from the Library for the week ---------- */

export function LibraryPanel({
  packs,
  grades,
  term,
  home,
  loaded,
  failed,
}: {
  packs: WeekPack[];
  /** Grades of the teacher's Science classes. */
  grades: string[];
  term: number | null;
  /** Looking at the week of the next teaching day (wording: "this week"). */
  home: boolean;
  loaded: boolean;
  failed: boolean;
}) {
  const { t, lang } = useT();
  const day = (iso: string) => formatDate(iso, lang, { weekday: 'short', day: 'numeric', month: 'short' });
  return (
    <aside aria-labelledby="libhelp-h" className="rounded-xl border-t-4 border-talaTeal bg-white px-5 py-5 shadow-card" data-testid="library-help">
      <Kicker icon="book">{t('wk.lib.kicker')}</Kicker>
      <h2 id="libhelp-h" className="mt-1.5 text-title [text-wrap:balance]">
        {t(home ? 'wk.help.title' : 'wk.help.titleOther')}
      </h2>
      <p className="mt-1.5 text-small text-forestMuted">{t(grades.length ? 'wk.help.intro' : 'wk.help.scienceOnly')}</p>

      {packs.length > 0 ? (
        // One card per pack, cover first. A swipeable strip on phones; a column in the wide-screen sidebar.
        <ul className="strip -mx-5 mt-4 flex scroll-pl-5 gap-4 px-5 pb-1 min-[1180px]:mx-0 min-[1180px]:flex-col min-[1180px]:gap-5 min-[1180px]:px-0">
          {packs.map(({ suggestion: s, from, to, classes }) => (
            <li key={s.packId} className={cx('shrink-0 min-[1180px]:w-auto', packs.length === 1 ? 'w-full' : 'w-60')}>
              <Link href={packHref(s)} aria-hidden="true" tabIndex={-1} className="block">
                <PackCover s={s} className="w-full rounded" />
              </Link>
              <p className="kicker mt-3 text-forestMuted">
                {from === to ? t('wk.help.forDay', { date: day(from) }) : t('wk.help.forDays', { from: day(from), to: day(to) })}
              </p>
              <Link href={packHref(s)} className="mt-1 block font-semibold leading-snug text-forest underline-offset-4 break-words hover:underline">
                {s.title}
              </Link>
              <p className="mt-1 text-small text-forestMuted">
                <PackMeta s={s} />
                {classes.length > 1 && <> · {classes.join(', ')}</>}
              </p>
              <p className="mt-2">
                <PackStatusChip status={s.status} />
              </p>
            </li>
          ))}
        </ul>
      ) : !grades.length ? null : loaded ? (
        <p className="mt-4 rounded bg-cream px-3 py-3 text-small">{t('wk.help.empty')}</p>
      ) : failed ? (
        <p className="mt-4 rounded bg-cream px-3 py-3 text-small">{t('lib.loadFailed')}</p>
      ) : (
        <div className="mt-4">
          <Placeholder rows={2} />
        </div>
      )}

      <div className="mt-4 flex flex-col border-t border-hairline pt-1">
        {grades.slice(0, 3).map((g) => (
          <ArrowLink key={g} href={`/library?grade=${g}${term ? `&term=${term}` : ''}`}>
            {t('wk.lib.browseGrade', { grade: g })}
          </ArrowLink>
        ))}
        {(grades.length === 0 || grades.length > 3) && <ArrowLink href="/library">{t('wk.help.browseAll')}</ArrowLink>}
      </div>
    </aside>
  );
}
