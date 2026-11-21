'use client';
/**
 * The Library front page: find a week's pack without thinking. A signed-in teacher first sees the packs for their own
 * grade levels this week (from their school calendar); below, anyone can browse by grade and term. Weeks that are
 * built show as covers; weeks that are not built yet are folded away instead of filling the page with grey rows.
 * Coverage and review status stay honest: a draft is called a draft on every cover.
 */
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, type ReactNode } from 'react';
import { engine as pacing } from '@hiraia/tala-core/pacing';
import type { PackIndex, PackIndexEntry, PackLang, PackStatus, PackSubject, PackVariant } from '@hiraia/tala-core/contracts';
import { useT, type StringKey } from '@/i18n';
import { isoDate, mondayOf } from '@/data/ids';
import { previewUrl, usePackIndex } from '@/data/packs';
import { useWorkspace } from '@/data/records';
import { useSession } from '@/data/session';
import { ArrowLink, Disclosure, Kicker, Segmented } from '@/components/editorial';
import { Icon } from '@/components/icons';
import { Banner, Placeholder, cx, type Tone } from '@/components/ui';
import { MyCopies } from './MyCopies';

const GRADES = ['3', '4', '5', '6', '7', '8', '9', '10'] as const;
type Grade = (typeof GRADES)[number];
const isGrade = (g: string | null | undefined): g is Grade => GRADES.includes(g as Grade);
const BUILT: PackStatus[] = ['approved', 'draft', 'needs_work'];

export function statusLabel(entry: Pick<PackVariant, 'status' | 'viewable'>): { key: StringKey; tone: Tone } {
  const s: PackStatus = entry.status;
  if (s === 'approved') return { key: 'lib.status.approved', tone: 'sage' };
  if ((s === 'draft' || s === 'needs_work') && entry.viewable)
    return s === 'draft' ? { key: 'lib.status.draft', tone: 'gold' } : { key: 'lib.status.needs_work', tone: 'brick' };
  if (s === 'draft' || s === 'needs_work') return { key: 'lib.status.review', tone: 'neutral' };
  return { key: 'lib.status.notBuilt', tone: 'neutral' };
}

/** Whole weeks between two Mondays, 1-based ("week 10 of the term"). */
function weekOfTerm(termStart: string, date: string): number {
  const a = Date.parse(`${mondayOf(termStart)}T12:00:00Z`);
  const b = Date.parse(`${mondayOf(date)}T12:00:00Z`);
  return Math.floor((b - a) / (7 * 86400_000)) + 1;
}

export function LibraryScreen() {
  const { t, lang } = useT();
  const router = useRouter();
  const params = useSearchParams();
  const { status } = useSession();
  const { index, failed } = usePackIndex();
  // The Mathematics pilot is a second, small library. Where it is not installed its index does not load and the
  // Library is Science only, exactly as before.
  const mathIndex = usePackIndex('mathematics').index;
  const subject: PackSubject = params.get('subject') === 'mathematics' && mathIndex ? 'mathematics' : 'science';
  const ws = useWorkspace();
  const uiLang: PackLang = lang === 'fil' ? 'fil' : 'en';
  const subjects = mathIndex ? (
    <Segmented
      label={t('lib.subject.label')}
      value={subject}
      onChange={(v) => router.replace(v === 'mathematics' ? '/library?subject=mathematics' : '/library', { scroll: false })}
      className="self-start"
      options={[
        { value: 'science', label: t('lib.subject.science'), icon: 'flask' },
        { value: 'mathematics', label: t('lib.subject.math'), icon: 'grid' },
      ]}
    />
  ) : null;

  // The teacher's own grade levels and where the school calendar is today.
  const today = isoDate();
  const myGrades = useMemo(() => {
    const set = new Set<Grade>();
    for (const c of ws.classes) for (const g of c.gradeGroups) if (isGrade(g.grade)) set.add(g.grade);
    return GRADES.filter((g) => set.has(g));
  }, [ws.classes]);
  const now = useMemo(() => {
    const term = ws.activeYear ? pacing.termForDate(ws.activeYear, today) : null;
    return term ? { term: term.index, week: weekOfTerm(term.startDate, today) } : null;
  }, [ws.activeYear, today]);

  const packs = index?.packs ?? [];
  const builtIn = (g: string, tm: number) => packs.filter((p) => p.grade === g && p.term === tm && (['en', 'fil'] as const).some((l) => BUILT.includes(p.variants[l].status))).length;
  const askedGrade = params.get('grade');
  const grade: Grade = isGrade(askedGrade) ? askedGrade : (myGrades[0] ?? '4');
  const askedTerm = Number(params.get('term'));
  // No term asked for: the teacher's current term, else the term with the most to read for this grade.
  const term = [1, 2, 3].includes(askedTerm) ? askedTerm : (now?.term ?? [1, 2, 3].reduce((best, tm) => (builtIn(grade, tm) > builtIn(grade, best) ? tm : best), 1));
  const go = (g: string, tm: number) => router.replace(`/library?grade=${g}&term=${tm}`, { scroll: false });

  const weeks = packs.filter((p) => p.grade === grade && p.term === term).sort((a, b) => a.week - b.week);
  const isBuilt = (p: PackIndexEntry) => (['en', 'fil'] as const).some((l) => BUILT.includes(p.variants[l].status));
  const built = weeks.filter(isBuilt);
  const notBuilt = weeks.filter((p) => !isBuilt(p));
  const c = index?.counts;
  const builtTotal = packs.filter(isBuilt).length;
  const drafts = c ? c.draft + c.needsWork : 0;

  // "For your classes": this week's and next week's pack for each of the teacher's grades, when they can be opened.
  const forYou = useMemo(() => {
    if (!now || !myGrades.length) return [];
    const out: Array<{ entry: PackIndexEntry; when: 'this' | 'next' }> = [];
    for (const g of myGrades)
      for (const [offset, when] of [
        [0, 'this'],
        [1, 'next'],
      ] as const) {
        const entry = packs.find((p) => p.grade === g && p.term === now.term && p.week === now.week + offset && p.viewable);
        if (entry) out.push({ entry, when });
      }
    return out.sort((a, b) => (a.when === b.when ? 0 : a.when === 'this' ? -1 : 1)).slice(0, 4);
  }, [packs, myGrades, now]);

  if (subject === 'mathematics' && mathIndex) return <MathLibrary index={mathIndex} uiLang={uiLang} signedIn={status === 'signedIn'} subjects={subjects} />;

  return (
    <div className="flex flex-col gap-8 wide:gap-10">
      {subjects}
      <header className="grid items-center gap-4 wide:grid-cols-[minmax(0,1fr)_24rem] wide:gap-10">
        <div className="min-w-0">
          <Kicker icon="book">{t('lib2.kicker')}</Kicker>
          <h1 className="mt-3 text-hero">{t('lib.title')}</h1>
          <p className="mt-3 max-w-measure text-read text-forest/90 wide:text-lead">{t('lib2.lead')}</p>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/art/library-hero.webp" alt="" width={960} height={640} className="ink mx-auto hidden w-full max-w-md wide:block" />
      </header>

      {failed && !index && <Banner kind="error">{t('lib.loadFailed')}</Banner>}

      {c && c.approved < c.targets && (
        <section aria-label={t('lib2.previewTitle')} className="rounded-lg bg-yellow/20 px-4 py-3 wide:px-5">
          <div className="flex gap-3">
            <Icon name="info" size={22} className="mt-0.5 text-forest" />
            <div className="min-w-0 flex-1">
              <p className="break-words">
                <span className="font-semibold">{t('lib2.previewTitle')}. </span>
                {t('lib2.previewBody', { built: builtTotal, weeks: packs.length })}
              </p>
              <Disclosure summary={<span className="text-small font-medium text-talaTeal">{t('lib2.howChecked')}</span>}>
                <p className="text-small break-words">{t('lib.honest')}</p>
                <p className="mt-2 text-small font-medium break-words" data-testid="coverage">
                  {t('lib.coverage', { weeks: packs.length, ready: c.approved, total: c.targets, review: c.draft + c.needsWork, notBuilt: c.notBuilt + c.failed })}
                </p>
              </Disclosure>
            </div>
          </div>
          {index && !index.reviewerView && drafts > 0 && status !== 'signedIn' && (
            <Link href="/sign-in" className="mt-1 inline-flex min-h-touch items-center gap-2 rounded bg-talaTeal px-4 font-medium text-white">
              <Icon name="lock" size={18} />
              {t('lib2.signIn')}
            </Link>
          )}
        </section>
      )}

      {forYou.length > 0 && (
        <section aria-labelledby="for-you">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 id="for-you" className="text-headline">
              {t('lib2.forYou')}
            </h2>
            <p className="text-small text-forestMuted">{t('lib2.forYouHint')}</p>
          </div>
          <ul className="mt-4 grid gap-4 min-[560px]:grid-cols-2 wide:grid-cols-4">
            {forYou.map(({ entry, when }) => (
              <li key={entry.packId}>
                <WeekCard entry={entry} uiLang={uiLang} badge={t(when === 'this' ? 'lib2.thisWeek' : 'lib2.nextWeek')} showGrade />
              </li>
            ))}
          </ul>
        </section>
      )}

      <MyCopies />

      <section aria-label={`${t('lib.grade', { grade })}, ${t('lib.term', { term })}`} className="flex flex-col gap-5">
        <div className="flex flex-col gap-3 border-t border-hairline pt-6">
          <p className="kicker text-forestMuted">{t('lib2.browse')}</p>
          <nav aria-label={t('lib.gradePicker')} className="strip -mx-4 flex gap-2 px-4 wide:mx-0 wide:flex-wrap wide:px-0">
            {GRADES.map((g) => {
              const on = g === grade;
              const mine = myGrades.includes(g);
              return (
                <button
                  key={g}
                  type="button"
                  onClick={() => go(g, term)}
                  aria-pressed={on}
                  className={cx(
                    'relative inline-flex min-h-touch shrink-0 items-center gap-1.5 rounded-full border px-4 text-body',
                    on ? 'border-forest bg-forest font-medium text-cream' : 'border-hairline bg-white text-forest hover:border-forest'
                  )}
                >
                  <span className="whitespace-nowrap">{t('lib.grade', { grade: g })}</span>
                  {mine && (
                    <>
                      <span aria-hidden="true" className={cx('h-2 w-2 rounded-full', on ? 'bg-yellow' : 'bg-talaTeal')} />
                      <span className="sr-only">{t('lib2.yourGrade')}</span>
                    </>
                  )}
                </button>
              );
            })}
          </nav>
          <Segmented
            label={t('lib.termPicker')}
            value={String(term)}
            onChange={(v) => go(grade, Number(v))}
            className="self-start"
            options={[1, 2, 3].map((tm) => ({ value: String(tm), label: now?.term === tm ? `${t('lib.term', { term: tm })} · ${t('lib2.now')}` : t('lib.term', { term: tm }) }))}
          />
        </div>

        {!index && !failed && <Placeholder rows={6} />}

        {index && built.length === 0 && (
          <div className="flex flex-col items-center gap-3 rounded-xl bg-white px-5 py-8 text-center shadow-card">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/art/empty-shelf.webp" alt="" width={320} height={320} loading="lazy" className="ink h-36 w-36 object-contain" />
            <p className="font-display text-title">{t('lib2.noneBuilt')}</p>
            <p className="max-w-[30rem] text-forestMuted">{t('lib2.noneBuiltHint')}</p>
          </div>
        )}

        {built.length > 0 && (
          <>
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-headline">{t(built.some((w) => w.viewable) ? 'lib2.builtHeading' : 'lib2.builtHeadingVisitor')}</h2>
              <p className="text-small text-forestMuted">{t('lib2.builtCount', { n: built.length })}</p>
            </div>
            <ol className="grid gap-4 min-[560px]:grid-cols-2 wide:grid-cols-3">
              {built.map((w) => (
                <li key={w.packId}>
                  <WeekCard entry={w} uiLang={uiLang} badge={now && now.term === w.term && now.week === w.week ? t('lib2.thisWeek') : undefined} />
                </li>
              ))}
            </ol>
          </>
        )}

        {notBuilt.length > 0 && (
          <Disclosure
            className="rounded-lg border border-hairline bg-white/60 px-4"
            summary={t('lib2.notBuiltSummary', { n: notBuilt.length })}
            hint={t('lib2.notBuiltHint')}
            icon={<Icon name="clock" size={20} className="text-forestMuted" />}
          >
            <ol className="grid gap-x-8 text-small wide:grid-cols-2">
              {notBuilt.map((w) => (
                <li key={w.packId} className="flex gap-3 border-t border-hairline py-2">
                  <span className="w-16 shrink-0 text-forestMuted">{t('lib2.weekNo', { week: w.week })}</span>
                  <span className="min-w-0 break-words">{w.topic}</span>
                </li>
              ))}
            </ol>
          </Disclosure>
        )}
      </section>

      <ArrowLink href="/community">{t('lib.community')}</ArrowLink>
    </div>
  );
}

/**
 * The Mathematics pilot: six weeks, said plainly to be a pilot. No grade or term pickers (there are six packs) and no
 * "for your classes" (the pilot is not tied to a class calendar): the packs by grade, each with its printed term and
 * week, and the pilot's terms above them.
 */
function MathLibrary({ index, uiLang, signedIn, subjects }: { index: PackIndex; uiLang: PackLang; signedIn: boolean; subjects: ReactNode }) {
  const { t } = useT();
  const grades = [...new Set(index.packs.map((p) => p.grade))].sort((a, b) => Number(a) - Number(b));
  const locked = !index.reviewerView && index.packs.some((p) => !p.viewable);
  return (
    <div className="flex flex-col gap-8 wide:gap-10">
      {subjects}
      <header className="min-w-0">
        <Kicker icon="grid">{t('libm.kicker')}</Kicker>
        <h1 className="mt-3 text-hero">{t('libm.title')}</h1>
        <p className="mt-3 max-w-measure text-read text-forest/90 wide:text-lead">{t('libm.lead')}</p>
      </header>

      <section aria-label={t('libm.noteTitle')} className="rounded-lg bg-yellow/20 px-4 py-3 wide:px-5" data-testid="pilot-terms">
        <div className="flex gap-3">
          <Icon name="info" size={22} className="mt-0.5 shrink-0 text-forest" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <p className="break-words">
              <span className="font-semibold">{t('libm.noteTitle')}. </span>
              {t('libm.noteBody')}
            </p>
            <p className="text-small break-words text-forest/90">{t('libm.noteDates')}</p>
          </div>
        </div>
        {locked && !signedIn && (
          <Link href="/sign-in" className="mt-2 inline-flex min-h-touch items-center gap-2 rounded bg-talaTeal px-4 font-medium text-white">
            <Icon name="lock" size={18} />
            {t('lib2.signIn')}
          </Link>
        )}
      </section>

      {grades.map((g) => {
        const packs = index.packs.filter((p) => p.grade === g).sort((a, b) => a.term - b.term || a.week - b.week);
        return (
          <section key={g} aria-labelledby={`math-g${g}`} className="flex flex-col gap-4 border-t border-hairline pt-6">
            <div className="flex items-baseline justify-between gap-3">
              <h2 id={`math-g${g}`} className="text-headline">
                {t('lib.grade', { grade: g })}
              </h2>
              <p className="text-small text-forestMuted">{t('lib2.builtCount', { n: packs.length })}</p>
            </div>
            <ol className="grid gap-4 min-[560px]:grid-cols-2 wide:grid-cols-3">
              {packs.map((p) => (
                <li key={p.packId}>
                  <WeekCard entry={p} uiLang={uiLang} kicker={t('libm.termWeek', { term: p.term, week: p.week })} />
                </li>
              ))}
            </ol>
          </section>
        );
      })}
    </div>
  );
}

/** One built week as a cover: the deck's own cover slide, the week, its title and each language's honest status. */
function WeekCard({ entry, uiLang, badge, showGrade, kicker }: { entry: PackIndexEntry; uiLang: PackLang; badge?: string; showGrade?: boolean; kicker?: string }) {
  const { t } = useT();
  const mine = entry.variants[uiLang];
  const other = entry.variants[uiLang === 'fil' ? 'en' : 'fil'];
  const shown = mine.viewable ? mine : other.viewable ? other : null;
  const title = shown?.title ?? entry.topic;
  const cover = shown && shown.files.length > 0 ? previewUrl(entry.packId, 1, shown.language) : null;
  const inner = (
    <>
      <span className="relative block aspect-video w-full overflow-hidden bg-forest">
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover} alt={t('lib2.coverAlt', { title })} loading="lazy" decoding="async" width={640} height={360} className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center gap-3 text-cream">
            <span className="font-display text-[3rem] leading-none text-yellow">{entry.week}</span>
            {!entry.viewable && <Icon name="lock" size={22} />}
          </span>
        )}
        {badge && <span className="absolute left-3 top-3 rounded-full bg-yellow px-2.5 py-1 text-small font-semibold text-forest shadow-card">{badge}</span>}
      </span>
      <span className="flex flex-1 flex-col gap-1.5 px-4 py-4">
        <span className="kicker text-talaTeal">{kicker ?? (showGrade ? `${t('lib.grade', { grade: entry.grade })} · ${t('lib2.weekNo', { week: entry.week })}` : t('lib2.weekNo', { week: entry.week }))}</span>
        <span className="font-display text-title leading-snug break-words">{title}</span>
        {title !== entry.topic && <span className="text-small text-forestMuted break-words">{entry.topic}</span>}
        <span className="mt-auto flex flex-col gap-1 pt-2">
          {(['fil', 'en'] as const).map((l) => {
            const v = entry.variants[l];
            const st = statusLabel(v);
            const tone = st.tone === 'sage' ? 'text-forest' : st.tone === 'brick' ? 'text-brick' : 'text-forestMuted';
            return (
              <span key={l} className={cx('flex items-center gap-1.5 text-small', tone)}>
                <Icon name={v.status === 'approved' ? 'checkCircle' : v.status === 'needs_work' && v.viewable ? 'alert' : v.status === 'not_built' || v.status === 'failed' ? 'clock' : 'info'} size={14} strokeWidth={2.1} />
                <span className="font-medium text-forest">{t(l === 'fil' ? 'lib2.inFilipino' : 'lib2.inEnglish')}</span>
                <span>· {t(st.key)}</span>
              </span>
            );
          })}
        </span>
      </span>
    </>
  );
  const cls = 'group flex h-full flex-col overflow-hidden rounded-lg bg-white text-left shadow-card';
  return entry.viewable ? (
    <Link href={`/library/${entry.packId}`} className={cx(cls, 'transition-shadow hover:shadow-lift')}>
      {inner}
    </Link>
  ) : (
    <div className={cx(cls, 'opacity-90')}>
      {inner}
      <span className="flex items-center gap-1.5 border-t border-hairline px-4 py-2 text-small text-forestMuted">
        <Icon name="lock" size={14} />
        {t('lib2.locked')}
      </span>
    </div>
  );
}
