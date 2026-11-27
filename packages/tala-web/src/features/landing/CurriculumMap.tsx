'use client';
/**
 * The Science curriculum map on the homepage: one row per grade, one group per term, one mark per week.
 *
 * Every mark is a week the shipped curriculum packs place competencies in (science-coverage.generated.ts). A mark
 * gets a yellow cap when the teaching-pack library has a pack to read for that week in the page's language; that
 * is asked from the library's public index when the page is opened, so it is today's answer or nothing: no cap is
 * drawn and no number is said while the answer is on its way, or when it does not come. The figure is a real table: a screen reader hears each grade and term
 * with its weeks and competencies instead of 262 unnamed squares.
 */
import { useEffect, useMemo, useState } from 'react';
import { useT } from '@/i18n';
import { getClient } from '@/data/client';
import { cx } from '@/components/ui';
import { packWeeks, weekKey, type PackWeek, type ScienceCoverage } from './coverage';

type PackAnswer = { curriculumVersion?: string; packs: PackWeek[] };
export type PackCoverage =
  /** Asked, no answer yet: the page keeps the space and says nothing. */
  | { state: 'loading'; packs: null }
  /** The library answered just now. */
  | { state: 'ready'; packs: NonNullable<ReturnType<typeof packWeeks>> }
  /** No answer (offline, an error, another curriculum): nothing about packs is drawn or said. */
  | { state: 'failed'; packs: null };

/**
 * Which weeks have a pack, asked from the library's public index each time the page is opened. Deliberately not the
 * cached index the Library keeps for offline reading: a count on the homepage must be today's or absent.
 */
export function usePackCoverage(coverage: ScienceCoverage): PackCoverage {
  const { lang } = useT();
  const [answer, setAnswer] = useState<PackAnswer | 'failed' | null>(null);
  useEffect(() => {
    let alive = true;
    getClient()
      .call('packs.index', { query: { subject: 'science' } })
      .then((index) => alive && setAnswer(index as PackAnswer))
      .catch(() => alive && setAnswer('failed'));
    return () => {
      alive = false;
    };
  }, []);
  return useMemo((): PackCoverage => {
    if (answer === null) return { state: 'loading', packs: null };
    const packs = answer === 'failed' ? null : packWeeks(answer, coverage, lang === 'fil' ? 'fil' : 'en');
    return packs ? { state: 'ready', packs } : { state: 'failed', packs: null };
  }, [answer, coverage, lang]);
}

function Mark({ pack }: { pack: boolean }) {
  return (
    <span className="relative block h-[1.125rem] overflow-hidden rounded-[2px] bg-talaTeal wide:h-6 wide:rounded-[3px]">
      <span className={cx('tala-landing-cap absolute inset-x-0 top-0 h-[38%] bg-yellow', !pack && 'hidden')} />
    </span>
  );
}

export function CurriculumMap({ coverage, packCoverage }: { coverage: ScienceCoverage; packCoverage: PackCoverage }) {
  const { t } = useT();
  const { packs, state } = packCoverage;
  const longest = Math.max(...coverage.grades.flatMap((g) => g.terms.map((x) => x.weeks)));
  const terms = coverage.grades[0]?.terms.map((x) => x.term) ?? [];
  const mixed = Boolean(packs && packs.approved > 0);
  return (
    <figure className="m-0 flex flex-col gap-4 rounded-[1.125rem] border-[3px] border-forest bg-white p-4 shadow-[0_8px_0_rgb(var(--c-forest-rgb)/0.55)] wide:gap-5 wide:p-7">
      <table className="w-full table-fixed border-separate border-spacing-x-0 border-spacing-y-1.5 wide:border-spacing-y-2.5">
        <caption className="sr-only">{t('landing.s.cur.mapLabel')}</caption>
        <colgroup>
          <col className="w-9 wide:w-12" />
          {terms.map((term) => (
            <col key={term} />
          ))}
        </colgroup>
        <thead>
          <tr className="kicker text-forestMuted">
            <th scope="col" className="pb-1 pr-2 text-right font-bold">
              <span className="sr-only">{t('landing.s.cur.gradeCol')}</span>
            </th>
            {terms.map((term) => (
              <th key={term} scope="col" className="px-1 pb-1 text-left font-bold wide:px-2">
                {t('lib.term', { term })}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {coverage.grades.map((g) => (
            <tr key={g.grade}>
              <th scope="row" className="pr-2 text-right align-middle font-display text-[1.0625rem] leading-none text-forest wide:pr-3 wide:text-[1.25rem]">
                <span className="sr-only">{t('lib.grade', { grade: g.grade })}</span>
                <span aria-hidden="true">{g.grade}</span>
              </th>
              {g.terms.map((term) => {
                const built = packs ? Array.from({ length: term.weeks }, (_, i) => packs.built.has(weekKey(g.grade, term.term, i + 1))) : [];
                const count = built.filter(Boolean).length;
                return (
                  <td key={term.term} className="px-1 align-middle wide:px-2">
                    <span className="sr-only">
                      {packs
                        ? t('landing.s.cur.cellPacks', { weeks: term.weeks, competencies: term.competencies, built: count })
                        : t('landing.s.cur.cell', { weeks: term.weeks, competencies: term.competencies })}
                    </span>
                    <span aria-hidden="true" className="grid gap-[2px] wide:gap-[3px]" style={{ gridTemplateColumns: `repeat(${longest}, minmax(0, 1fr))` }}>
                      {Array.from({ length: term.weeks }, (_, i) => (
                        <Mark key={i} pack={Boolean(built[i])} />
                      ))}
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <figcaption className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-hairline pt-3 text-small text-forestMuted">
        <span className="inline-flex items-center gap-2">
          <span aria-hidden="true" className="block h-[1.125rem] w-2.5 rounded-[2px] bg-talaTeal" />
          {t('landing.s.cur.legendMapped')}
        </span>
        {/* Said only once the library has answered; until then its space is kept so nothing moves. No answer: left out. */}
        {state !== 'failed' && (
          <span className={cx('inline-flex items-center gap-2', !packs && 'invisible')} aria-hidden={packs ? undefined : true}>
            <span aria-hidden="true" className="relative block h-[1.125rem] w-2.5 overflow-hidden rounded-[2px] bg-talaTeal">
              <span className="absolute inset-x-0 top-0 h-[38%] bg-yellow" />
            </span>
            {t(mixed ? 'landing.s.cur.legendPackMixed' : 'landing.s.cur.legendPack')}
          </span>
        )}
      </figcaption>
    </figure>
  );
}
