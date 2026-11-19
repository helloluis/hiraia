'use client';
/**
 * The five lessons of a pack, one day at a time, laid out to be read: a headline and what learners will be able to
 * do, then the lesson as a timeline of short steps (what you do and say, what learners do, and the slides for that
 * step), then the exit ticket with its answer folded away, and help for learners who struggle or finish early.
 * What you need and what learners should see sit beside the text on a wide screen.
 */
import { useState } from 'react';
import type { DayPlan, PackDetail } from '@hiraia/tala-core/contracts';
import { useT, type StringKey } from '@/i18n';
import { Disclosure, IconBadge, Kicker } from '@/components/editorial';
import { Icon, type IconName } from '@/components/icons';
import { cx } from '@/components/ui';
import { SlideStrip } from '@/features/slides/PackSlidesTab';
import { Prose, Script } from './Prose';

const PHASE_ICON: Record<string, IconName> = {
  activating_prior_knowledge: 'help',
  lesson_purpose: 'target',
  developing_understanding: 'flask',
  generalization: 'lightbulb',
  evaluating_learning: 'checkCircle',
};

export function PackLessons({
  detail,
  day,
  onDay,
  onSlides,
}: {
  detail: PackDetail;
  day: number;
  onDay: (day: number) => void;
  /** Open the deck at a slide (the pack page switches to its Slides section). */
  onSlides?: (slideId: string) => void;
}) {
  const { t } = useT();
  const p = detail.content;
  const current = p.days.find((d) => d.day === day) ?? p.days[0]!;
  return (
    <div className="flex flex-col gap-6">
      <nav aria-label={t('pk.dayPicker')} className="strip -mx-4 flex gap-2 px-4 wide:mx-0 wide:px-0">
        {p.days.map((d) => {
          const on = d.day === current.day;
          return (
            <button
              key={d.day}
              type="button"
              aria-current={on ? 'true' : undefined}
              onClick={() => onDay(d.day)}
              className={cx(
                'flex min-h-touch shrink-0 items-center gap-2 rounded-full border px-4 text-left',
                on ? 'border-forest bg-forest text-cream' : 'border-hairline bg-white text-forest hover:border-forest'
              )}
            >
              <span className={cx('font-display text-title leading-none', on ? 'text-yellow' : 'text-talaTeal')}>{d.day}</span>
              <span className="max-w-[11rem] truncate text-small font-medium wide:max-w-[9rem]">{d.title}</span>
            </button>
          );
        })}
      </nav>
      <DayArticle key={current.day} detail={detail} day={current} onSlides={onSlides} />
      <div className="flex items-center justify-between gap-3 border-t border-hairline pt-4">
        {current.day > 1 ? (
          <button type="button" onClick={() => onDay(current.day - 1)} className="inline-flex min-h-touch items-center gap-2 font-medium text-talaTeal">
            <Icon name="arrowLeft" size={18} />
            {t('pk.prevDay', { day: current.day - 1 })}
          </button>
        ) : (
          <span />
        )}
        {current.day < p.days.length && (
          <button type="button" onClick={() => onDay(current.day + 1)} className="inline-flex min-h-touch items-center gap-2 font-medium text-talaTeal">
            {t('pk.nextDay', { day: current.day + 1 })}
            <Icon name="arrowRight" size={18} />
          </button>
        )}
      </div>
    </div>
  );
}

function DayArticle({ detail, day, onSlides }: { detail: PackDetail; day: DayPlan; onSlides?: (slideId: string) => void }) {
  const { t } = useT();
  const p = detail.content;
  const daySlides = p.slides.filter((s) => s.day === day.day);
  const opener = daySlides.find((s) => s.kind === 'day') ?? daySlides[0];
  const competencies = p.competencies.filter((c) => day.competencyIds.includes(c.id));
  let clock = 0;
  return (
    <article className="grid gap-8 wide:grid-cols-[minmax(0,1fr)_19rem] wide:gap-10">
      <div className="min-w-0">
        <Kicker icon="clock">{t('pk.dayKicker', { day: day.day, minutes: day.minutes })}</Kicker>
        <h2 className="mt-2 text-hero break-words">{day.title}</h2>
        <div className="mt-4 flex gap-3">
          <Icon name="target" size={24} className="mt-1 text-talaTeal" />
          <p className="text-read text-forest wide:text-lead">
            <span className="block text-small font-semibold text-forestMuted">{t('pk.objective')}</span>
            {day.objective}
          </p>
        </div>
        {onSlides && opener && (
          <button
            type="button"
            onClick={() => onSlides(opener.id)}
            className="mt-4 inline-flex min-h-touch items-center gap-2 rounded-full border border-hairline bg-white px-4 font-medium text-forest hover:border-forest"
          >
            <Icon name="slides" size={20} className="text-talaTeal" />
            {t('pk.daySlides', { day: day.day, n: daySlides.length })}
            <Icon name="arrowRight" size={16} className="text-talaTeal" />
          </button>
        )}

        <div className="mt-8 flex items-baseline justify-between gap-3 border-t border-hairline pt-5">
          <h3 className="font-display text-headline">{t('pk.flow')}</h3>
          <p className="text-small text-forestMuted">{t('pk.flowHint', { steps: day.flow.length, minutes: day.minutes })}</p>
        </div>
        <ol className="mt-4 flex flex-col">
          {day.flow.map((f, i) => {
            const from = clock;
            clock += f.minutes;
            const last = i === day.flow.length - 1;
            return (
              <li key={i} className="relative flex gap-3 pb-7 wide:gap-4">
                {/* The rail: a numbered dot per step, joined by a line. */}
                <div className="flex w-8 shrink-0 flex-col items-center wide:w-10">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-talaTeal/15 text-talaTeal wide:h-10 wide:w-10">
                    <Icon name={PHASE_ICON[f.phase] ?? 'clock'} size={18} />
                  </span>
                  {!last && <span aria-hidden="true" className="mt-1 w-px flex-1 bg-hairline" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <h4 className="text-title font-semibold leading-snug break-words">{t(`pk.phase.${f.phase}` as StringKey) || f.phase}</h4>
                    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-forest/10 px-2.5 py-0.5 text-small font-medium">
                      {t('pk.minutes', { n: f.minutes })}
                      <span className="text-forestMuted">
                        · {from}–{from + f.minutes}
                      </span>
                    </span>
                  </div>
                  <div className="mt-3">
                    <p className="kicker flex items-center gap-1.5 text-talaTeal">
                      <Icon name="speech" size={15} strokeWidth={2.1} />
                      {t('pk.teacher')}
                    </p>
                    <Script text={f.teacher} className="reading mt-1.5 max-w-measure" />
                  </div>
                  <div className="mt-3 rounded-lg bg-sage/20 px-3 py-3 wide:px-4">
                    <p className="kicker flex items-center gap-1.5 text-forest">
                      <Icon name="learners" size={15} strokeWidth={2.1} />
                      {t('pk.learners')}
                    </p>
                    <Prose text={f.learners} className="mt-1.5 max-w-measure break-words" />
                  </div>
                  {f.slideIds.length > 0 && (
                    <div className="mt-3">
                      <SlideStrip detail={detail} slideIds={f.slideIds} label={t('pk.slidesForStep')} />
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>

        <ExitTicket day={day} />

        <div className="mt-6 divide-y divide-hairline border-y border-hairline">
          <Disclosure summary={t('pk.support')} icon={<IconBadge name="support" tint="teal" size={36} />}>
            <p className="max-w-measure pl-12 break-words">{day.support}</p>
          </Disclosure>
          <Disclosure summary={t('pk.extension')} icon={<IconBadge name="challenge" tint="yellow" size={36} />}>
            <p className="max-w-measure pl-12 break-words">{day.extension}</p>
          </Disclosure>
          <Disclosure summary={t('pk.longer')} icon={<IconBadge name="timer" tint="sage" size={36} />}>
            <p className="max-w-measure pl-12 break-words">{day.longerPeriod}</p>
          </Disclosure>
        </div>
      </div>

      <aside className="flex min-w-0 flex-col gap-6 wide:sticky wide:top-20 wide:self-start">
        <section aria-labelledby={`need-${day.day}`}>
          <h3 id={`need-${day.day}`} className="kicker flex items-center gap-1.5 text-forest">
            <Icon name="checklist" size={16} strokeWidth={2.1} />
            {t('pk.need')}
          </h3>
          <ul className="mt-3 flex flex-col gap-2.5">
            {day.materials.map((m, i) => (
              <li key={i} className="flex gap-2.5 text-small">
                <span aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 rounded-[3px] border border-forest/40 bg-white" />
                <span className="min-w-0 break-words">{m}</span>
              </li>
            ))}
          </ul>
        </section>
        {day.expectedObservations.length > 0 && (
          <section aria-labelledby={`see-${day.day}`} className="border-t border-hairline pt-5">
            <h3 id={`see-${day.day}`} className="kicker flex items-center gap-1.5 text-forest">
              <Icon name="eye" size={16} strokeWidth={2.1} />
              {t('pk.see')}
            </h3>
            <ul className="mt-3 flex flex-col gap-2.5">
              {day.expectedObservations.map((m, i) => (
                <li key={i} className="flex gap-2.5 text-small">
                  <Icon name="check" size={16} strokeWidth={2.2} className="mt-0.5 text-talaTeal" />
                  <span className="min-w-0 break-words">{m}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {competencies.length > 0 && (
          <section aria-labelledby={`comp-${day.day}`} className="border-t border-hairline pt-5">
            <h3 id={`comp-${day.day}`} className="kicker flex items-center gap-1.5 text-forest">
              <Icon name="shield" size={16} strokeWidth={2.1} />
              {t('pk.competency')}
            </h3>
            {competencies.map((c) => (
              <div key={c.id} className="mt-3">
                <p className="text-small italic break-words">{c.text}</p>
                <p className="mt-1 text-small text-forestMuted">{t('pk.competencyNote', { page: c.sourcePage })}</p>
              </div>
            ))}
          </section>
        )}
      </aside>
    </article>
  );
}

function ExitTicket({ day }: { day: DayPlan }) {
  const { t } = useT();
  const [shown, setShown] = useState(false);
  return (
    <section aria-label={t('pk.exit')} className="mt-2 rounded-xl bg-yellow/20 px-5 py-5 wide:px-6">
      <Kicker icon="checkCircle" className="!text-forest">
        {t('pk.exit')}
      </Kicker>
      <p className="mt-2 font-display text-title leading-snug break-words">{day.check.question}</p>
      {shown ? (
        <div className="mt-3 border-t border-forest/15 pt-3">
          <p className="break-words">
            <span className="font-semibold">{t('pk.answer')}: </span>
            {day.check.answer}
          </p>
          <p className="mt-1.5 text-small text-forestMuted break-words">
            <span className="font-semibold">{t('pk.why')}: </span>
            {day.check.why}
          </p>
        </div>
      ) : (
        <button type="button" onClick={() => setShown(true)} className="mt-3 inline-flex min-h-touch items-center gap-2 rounded-full border border-forest bg-white px-4 font-medium">
          <Icon name="eye" size={18} />
          {t('pk.showAnswer')}
        </button>
      )}
    </section>
  );
}
