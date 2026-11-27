'use client';
/**
 * What Tala does, on the homepage: three things, each shown rather than described.
 *   1. one lesson plan for a multi-grade room   (a real capture of the session editor)
 *   2. slides for a lesson that she can edit     (a real capture of the slide editor)
 *   3. the DepEd Science curriculum, by week     (drawn here from the shipped curriculum data)
 * A short headline and one sentence each. The captures come from scripts/home-capture.mjs (invented teacher, local
 * server), one set per language and per layout, so the picture is in the reader's language and is never a desktop
 * screen squeezed onto a phone. Strings only; no literal colours.
 */
import type { CSSProperties, ReactNode } from 'react';
import { useT, type StringKey } from '@/i18n';
import { ArrowLink, Kicker } from '@/components/editorial';
import { Icon, type IconName } from '@/components/icons';
import { cx } from '@/components/ui';
import { CurriculumMap, usePackCoverage } from './CurriculumMap';
import type { ScienceCoverage } from './coverage';
import { SCIENCE_COVERAGE } from './science-coverage.generated';
import { useReveal } from './useReveal';
import { SHOTS, WIDE_SHOT_FROM, type ShotName } from './shots';

const FRAME = 'overflow-hidden rounded-[1.125rem] border-[3px] border-forest bg-white shadow-[0_8px_0_rgb(var(--c-forest-rgb)/0.55)]';

/** A product capture in its frame. The box keeps each layout's proportions, so nothing moves while it loads. */
function Capture({ name, alt, className, single }: { name: ShotName; alt: string; className?: string; /** Proportions in the one-column layout from 600 px (a tall capture is shown cut at the bottom there). */ single?: string }) {
  const { lang } = useT();
  const ref = useReveal<HTMLElement>();
  const l = lang === 'fil' ? 'fil' : 'en';
  const [phoneW, phoneH] = SHOTS[name].phone;
  const [wideW, wideH] = SHOTS[name].wide;
  const file = (view: 'wide' | 'phone', ext: 'webp' | 'jpg') => `/screens/home/${name}-${view}-${l}.${ext}`;
  return (
    <figure ref={ref} className={cx('tala-landing-reveal m-0', FRAME, className)}>
      <picture
        className="tala-landing-shot block"
        style={{ '--shot-phone': `${phoneW} / ${phoneH}`, '--shot-single': single ?? `${wideW} / ${wideH}`, '--shot-wide': `${wideW} / ${wideH}` } as CSSProperties}
      >
        <source media={`(min-width: ${WIDE_SHOT_FROM}px)`} type="image/webp" srcSet={file('wide', 'webp')} width={wideW} height={wideH} />
        <source media={`(min-width: ${WIDE_SHOT_FROM}px)`} type="image/jpeg" srcSet={file('wide', 'jpg')} width={wideW} height={wideH} />
        <source type="image/webp" srcSet={file('phone', 'webp')} width={phoneW} height={phoneH} />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={file('phone', 'jpg')} alt={alt} width={phoneW} height={phoneH} loading="lazy" decoding="async" className="block h-full w-full object-cover object-top" />
      </picture>
    </figure>
  );
}

function Words({ icon, kicker, title, titleId, children, className }: { icon: IconName; kicker: string; title: string; titleId: string; children?: ReactNode; className?: string }) {
  return (
    <div className={cx('flex flex-col gap-3 wide:gap-4', className)}>
      <Kicker icon={icon}>{kicker}</Kicker>
      <h3 id={titleId} className="font-display text-[clamp(1.75rem,1.15rem+2.6vw,2.75rem)] leading-[1.08] text-forest text-balance break-words [overflow-wrap:anywhere]">
        {title}
      </h3>
      {children}
    </div>
  );
}

const Lead = ({ children }: { children: ReactNode }) => <p className="max-w-[34rem] text-lead text-forestMuted">{children}</p>;

export function Showcase({ coverage = SCIENCE_COVERAGE }: { coverage?: ScienceCoverage }) {
  const { t } = useT();
  const packCoverage = usePackCoverage(coverage);
  const { packs } = packCoverage;
  const first = coverage.grades[0]?.grade ?? '';
  const last = coverage.grades[coverage.grades.length - 1]?.grade ?? '';
  const packsLine: StringKey = packs && packs.approved > 0 ? 'landing.s.cur.packsMixed' : 'landing.s.cur.packs';
  return (
    <section id="screens" aria-labelledby="home-does" className="scroll-mt-4 px-4 py-14 wide:px-8 wide:py-24">
      <div className="mx-auto flex max-w-6xl flex-col gap-16 wide:gap-28">
        {/* The section's name is a quiet label; the three headlines below carry the page. */}
        <h2 id="home-does" className="kicker -mb-8 flex items-center gap-4 font-body text-forestMuted wide:-mb-14">
          <span>{t('landing.todayTitle')}</span>
          <span aria-hidden="true" className="h-px flex-1 bg-hairline" />
        </h2>

        {/* 1 — the multi-grade lesson plan: picture left, words right */}
        <article aria-labelledby="home-mg" className="grid gap-7 wide:grid-cols-12 wide:items-center wide:gap-12">
          <Words icon="layers" kicker={t('landing.s.mg.k')} title={t('landing.s.mg.h')} titleId="home-mg" className="wide:order-2 wide:col-span-5">
            <Lead>{t('landing.s.mg.b')}</Lead>
          </Words>
          <Capture name="planner" alt={t('landing.s.mg.alt')} single="1320 / 1160" className="wide:order-1 wide:col-span-7" />
        </article>

        {/* 2 — slides: words across the top, the editor at full width */}
        <article aria-labelledby="home-sl" className="flex flex-col gap-7 wide:gap-10">
          <div className="grid gap-3 wide:grid-cols-12 wide:items-end wide:gap-12">
            <Words icon="slides" kicker={t('landing.s.sl.k')} title={t('landing.s.sl.h')} titleId="home-sl" className="wide:col-span-7" />
            <div className="flex flex-col items-start gap-3 wide:col-span-5 wide:pb-1">
              <Lead>{t('landing.s.sl.b')}</Lead>
              {/* The product's own "draft" colour and icon. Not StatusChip: this line must be free to wrap on a phone. */}
              <p className="inline-flex items-start gap-1.5 rounded-[0.875rem] bg-yellow/35 px-3 py-1.5 text-small font-medium leading-snug text-forest">
                <Icon name="info" size={15} strokeWidth={2.1} className="mt-[0.15em] shrink-0" />
                <span>{t('landing.s.sl.draft')}</span>
              </p>
            </div>
          </div>
          <Capture name="slides" alt={t('landing.s.sl.alt')} />
        </article>

        {/* 3 — the Science curriculum: words left, the map right */}
        <article aria-labelledby="home-cur" className="grid gap-7 wide:grid-cols-12 wide:items-center wide:gap-12">
          <Words
            icon="grid"
            kicker={t('landing.s.cur.k')}
            title={t('landing.s.cur.h', { from: first, to: last })}
            titleId="home-cur"
            className="wide:col-span-5"
          >
            <Lead>{t('landing.s.cur.b', { competencies: coverage.competencies })}</Lead>
            {/*
              Packs are a different claim from the curriculum, and only what the library itself reports is said. While
              it is being asked, the line's space is kept (nothing visible, nothing read out); with no answer the line
              is left out altogether. A number is never shown that the library did not just give.
            */}
            {packCoverage.state !== 'failed' && (
              <p className={cx('max-w-[34rem] text-body text-forestMuted', !packs && 'invisible')} aria-hidden={packs ? undefined : true}>
                {t(packsLine, { built: packs ? packs.built.size : coverage.weeks, weeks: coverage.weeks })}
              </p>
            )}
            <ArrowLink href="/library">{t('landing.s.cur.link')}</ArrowLink>
          </Words>
          <div className="wide:col-span-7">
            <CurriculumMap coverage={coverage} packCoverage={packCoverage} />
          </div>
        </article>
      </div>
    </section>
  );
}
