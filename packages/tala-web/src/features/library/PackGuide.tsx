'use client';
/**
 * The teacher guide of a pack, as a reference a teacher can dip into: each part has its icon and heading, long
 * explanations open one at a time, wrong ideas are set against what is true, and answers stay folded until asked for.
 */
import { useState } from 'react';
import type { PackDetail } from '@hiraia/tala-core/contracts';
import { useT } from '@/i18n';
import { Callout, Disclosure, IconBadge, SectionHead } from '@/components/editorial';
import { Icon, type IconName } from '@/components/icons';
import { cx } from '@/components/ui';

export function PackGuide({ detail }: { detail: PackDetail }) {
  const { t } = useT();
  const p = detail.content;
  const g = p.guide;
  const sections: Array<{ id: string; icon: IconName; label: string; show: boolean }> = [
    { id: 'g-science', icon: 'flask', label: t('pk.g.science'), show: true },
    { id: 'g-prereq', icon: 'layers', label: t('pk.g.prereq'), show: g.prerequisites.length > 0 },
    { id: 'g-words', icon: 'book', label: t('pk.g.words'), show: g.vocabulary.length > 0 },
    { id: 'g-wrong', icon: 'alert', label: t('pk.g.wrong'), show: g.misconceptions.length > 0 },
    { id: 'g-questions', icon: 'help', label: t('pk.g.questions'), show: g.studentQuestions.length > 0 },
    { id: 'g-local', icon: 'pin', label: t('pk.g.local'), show: g.localExamples.length > 0 },
    { id: 'g-materials', icon: 'checklist', label: t('pk.g.materials'), show: g.materials.length > 0 || g.preparation.length > 0 },
    { id: 'g-safety', icon: 'shield', label: t('pk.g.safety'), show: g.safety.length > 0 },
    { id: 'g-assessment', icon: 'checkCircle', label: t('pk.g.assessment'), show: p.assessment.length > 0 },
    { id: 'g-sources', icon: 'file', label: t('pk.g.sources'), show: g.sources.length > 0 },
  ].filter((s) => s.show) as Array<{ id: string; icon: IconName; label: string; show: boolean }>;

  return (
    <div className="grid gap-8 wide:grid-cols-[15rem_minmax(0,1fr)] wide:gap-10">
      {/* Contents: a strip of chips on phones, a quiet list beside the text on wide screens. */}
      <nav aria-label={t('pk.g.jump')} className="min-w-0 wide:sticky wide:top-20 wide:self-start">
        <p className="kicker hidden text-forestMuted wide:block">{t('pk.g.jump')}</p>
        <ul className="strip -mx-4 flex gap-2 px-4 wide:mx-0 wide:mt-3 wide:flex-col wide:gap-0.5 wide:px-0">
          {sections.map((s) => (
            <li key={s.id} className="shrink-0">
              <a
                href={`#${s.id}`}
                className="inline-flex min-h-touch items-center gap-2 rounded-full border border-hairline bg-white px-3 text-small font-medium hover:border-forest wide:min-h-[2.5rem] wide:w-full wide:rounded wide:border-0 wide:bg-transparent wide:px-2 wide:hover:bg-white"
              >
                <Icon name={s.icon} size={16} className="text-talaTeal" />
                <span className="whitespace-nowrap wide:whitespace-normal">{s.label}</span>
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="flex min-w-0 flex-col gap-10">
        <section aria-labelledby="g-science" className="scroll-mt-28">
          <SectionHead id="g-science" icon="flask" title={t('pk.g.science')} rule={false} />
          <p className="mt-2 text-forestMuted">{t('pk.g.scienceHint')}</p>
          <div className="mt-3 divide-y divide-hairline border-y border-hairline">
            {g.background.map((b, i) => (
              <Disclosure key={b.heading} defaultOpen={i === 0} summary={<span className="font-display text-title leading-snug">{b.heading}</span>}>
                <div className="reading max-w-measure">
                  {b.paragraphs.map((x, j) => (
                    <p key={j} className="break-words">
                      {x}
                    </p>
                  ))}
                </div>
              </Disclosure>
            ))}
          </div>
        </section>

        {g.prerequisites.length > 0 && (
          <section aria-labelledby="g-prereq" className="scroll-mt-28">
            <SectionHead id="g-prereq" icon="layers" title={t('pk.g.prereq')} />
            <ol className="mt-4 flex flex-col gap-5">
              {g.prerequisites.map((x, i) => (
                <li key={i} className="flex gap-3">
                  <span className="font-display text-headline leading-none text-talaTeal">{i + 1}</span>
                  <div className="min-w-0">
                    <p className="text-read font-medium break-words">{x.idea}</p>
                    <div className="mt-2 grid gap-2 wide:grid-cols-2">
                      <Callout tint="teal" icon="help" title={t('pk.g.quickCheck')}>
                        <p className="text-small break-words">{x.quickCheck}</p>
                      </Callout>
                      <Callout tint="sage" icon="support" title={t('pk.g.ifMissing')}>
                        <p className="text-small break-words">{x.ifMissing}</p>
                      </Callout>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        )}

        {g.vocabulary.length > 0 && (
          <section aria-labelledby="g-words" className="scroll-mt-28">
            <SectionHead id="g-words" icon="book" title={t('pk.g.words')} />
            <dl className="mt-4 grid gap-x-8 gap-y-4 wide:grid-cols-2">
              {g.vocabulary.map((v) => (
                <div key={v.term} className="border-l-[3px] border-talaTeal/40 pl-3">
                  <dt className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-display text-title leading-snug">{v.term}</span>
                    {v.filipino && (
                      <span className="text-small text-forestMuted">
                        {t('pk.g.inFilipino')}: <span className="font-medium text-forest">{v.filipino}</span>
                      </span>
                    )}
                  </dt>
                  <dd className="mt-0.5 break-words">{v.meaning}</dd>
                  <dd className="mt-0.5 text-small italic text-forestMuted break-words">
                    {t('pk.g.example')}: {v.example}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        {g.misconceptions.length > 0 && (
          <section aria-labelledby="g-wrong" className="scroll-mt-28">
            <SectionHead id="g-wrong" icon="alert" tint="brick" title={t('pk.g.wrong')} />
            <ul className="mt-4 flex flex-col gap-6">
              {g.misconceptions.map((m) => (
                <li key={m.belief} className="grid gap-3 wide:grid-cols-2 wide:gap-5">
                  <div className="rounded-lg bg-brick/10 px-4 py-4">
                    <p className="kicker flex items-center gap-1.5 text-brick">
                      <Icon name="x" size={15} strokeWidth={2.4} />
                      {t('pk.g.learnersThink')}
                    </p>
                    <p className="mt-2 font-display text-title leading-snug break-words">“{m.belief}”</p>
                    <p className="mt-2 text-small text-forestMuted break-words">
                      <span className="font-semibold">{t('pk.g.whyThink')}: </span>
                      {m.whyLearnersThinkIt}
                    </p>
                  </div>
                  <div className="rounded-lg bg-sage/25 px-4 py-4">
                    <p className="kicker flex items-center gap-1.5 text-forest">
                      <Icon name="check" size={15} strokeWidth={2.4} />
                      {t('pk.g.true')}
                    </p>
                    <p className="mt-2 font-medium break-words">{m.correctIdea}</p>
                    <p className="mt-2 text-small break-words">
                      <span className="font-semibold">{t('pk.g.inClass')}: </span>
                      {m.howToAddress}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {g.studentQuestions.length > 0 && (
          <section aria-labelledby="g-questions" className="scroll-mt-28">
            <SectionHead id="g-questions" icon="help" title={t('pk.g.questions')} />
            <div className="mt-3 divide-y divide-hairline border-y border-hairline">
              {g.studentQuestions.map((q) => (
                <Disclosure key={q.question} summary={<span className="text-read">{q.question}</span>} icon={<Icon name="speech" size={20} className="text-talaTeal" />}>
                  <p className="reading max-w-measure pl-8 break-words">{q.answer}</p>
                </Disclosure>
              ))}
            </div>
          </section>
        )}

        {g.localExamples.length > 0 && (
          <section aria-labelledby="g-local" className="scroll-mt-28">
            <SectionHead id="g-local" icon="pin" title={t('pk.g.local')} />
            <ul className="mt-4 grid gap-5 wide:grid-cols-2">
              {g.localExamples.map((x) => (
                <li key={x.example} className="flex gap-3">
                  <Icon name="pin" size={20} className="mt-1 text-talaTeal" />
                  <div className="min-w-0">
                    <p className="font-medium break-words">{x.example}</p>
                    <p className="mt-1 text-small text-forestMuted break-words">{x.connection}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {(g.materials.length > 0 || g.preparation.length > 0) && (
          <section aria-labelledby="g-materials" className="scroll-mt-28">
            <SectionHead id="g-materials" icon="checklist" title={t('pk.g.materials')} />
            <ul className="mt-4 grid gap-x-8 wide:grid-cols-2">
              {g.materials.map((m) => (
                <li key={m.item} className="flex gap-3 border-b border-hairline py-3">
                  <span aria-hidden="true" className="mt-1 h-4 w-4 shrink-0 rounded-[3px] border border-forest/40 bg-white" />
                  <div className="min-w-0">
                    <p className="break-words">
                      <span className="font-medium">{m.item}</span>
                      <span className="text-forestMuted"> · {m.amount}</span>
                    </p>
                    {m.notes && <p className="mt-0.5 text-small text-forestMuted break-words">{m.notes}</p>}
                    {m.substitute && (
                      <p className="mt-0.5 text-small break-words">
                        <span className="font-semibold text-talaTeal">{t('pk.g.substitute')}: </span>
                        {m.substitute}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {g.preparation.length > 0 && (
              <Callout tint="teal" icon="clock" title={t('pk.g.prepare')} className="mt-5">
                <ol className="mt-1 flex list-decimal flex-col gap-1.5 pl-5">
                  {g.preparation.map((x) => (
                    <li key={x} className="break-words">
                      {x}
                    </li>
                  ))}
                </ol>
              </Callout>
            )}
          </section>
        )}

        {g.safety.length > 0 && (
          <section aria-labelledby="g-safety" className="scroll-mt-28">
            <SectionHead id="g-safety" icon="shield" tint="brick" title={t('pk.g.safety')} />
            <ul className="mt-4 flex flex-col gap-3 rounded-lg bg-brick/10 px-4 py-4">
              {g.safety.map((s) => (
                <li key={s} className="flex gap-3">
                  <Icon name="alert" size={18} strokeWidth={2} className="mt-1 text-brick" />
                  <span className="min-w-0 break-words">{s}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {p.assessment.length > 0 && (
          <section aria-labelledby="g-assessment" className="scroll-mt-28">
            <SectionHead id="g-assessment" icon="checkCircle" title={t('pk.g.assessment')} />
            <p className="mt-2 text-forestMuted">{t('pk.g.assessmentHint', { n: p.assessment.length })}</p>
            <ol className="mt-4 flex flex-col gap-5">
              {p.assessment.map((q, i) => (
                <AssessmentItem key={q.id} n={i + 1} q={q} />
              ))}
            </ol>
          </section>
        )}

        {g.sources.length > 0 && (
          <section aria-labelledby="g-sources" className="scroll-mt-28">
            <SectionHead id="g-sources" icon="file" title={t('pk.g.sources')} />
            <p className="mt-2 text-small text-forestMuted">{t('pk.g.sourcesNote')}</p>
            <ul className="mt-3 flex flex-col gap-2 text-small">
              {g.sources.map((s, i) => (
                <li key={i} className="break-words">
                  <span className="font-medium">{s.refId}</span>
                  <span className="text-forestMuted"> · {s.locator}</span>
                  <span className="block text-forestMuted">{s.usedFor}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

function AssessmentItem({ n, q }: { n: number; q: PackDetail['content']['assessment'][number] }) {
  const { t } = useT();
  const [shown, setShown] = useState(false);
  return (
    <li className="flex gap-3">
      <IconBadge name="help" size={36} />
      <div className="min-w-0 flex-1">
        <p className="text-read font-medium break-words">
          <span className="text-forestMuted">{n}. </span>
          {q.prompt}
        </p>
        {q.choices.length > 0 && (
          <ol className="mt-2 grid gap-1.5 wide:grid-cols-2">
            {q.choices.map((c, i) => {
              const right = shown && q.correctChoice === i;
              return (
                <li key={i} className={cx('flex items-start gap-2 rounded border px-3 py-2', right ? 'border-talaTeal bg-talaTeal/10 font-medium' : 'border-hairline bg-white')}>
                  <span className={cx('flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-small font-semibold', right ? 'bg-talaTeal text-white' : 'bg-forest/10')}>{'ABCD'[i]}</span>
                  <span className="min-w-0 break-words">{c}</span>
                  {right && <span className="ml-auto text-small text-talaTeal">{t('pk.g.correct')}</span>}
                </li>
              );
            })}
          </ol>
        )}
        {shown ? (
          <div className="mt-2 rounded-lg bg-sage/20 px-3 py-3">
            <p className="break-words">
              <span className="font-semibold">{t('pk.answer')}: </span>
              {q.answer}
            </p>
            <p className="mt-1 text-small text-forestMuted break-words">{q.explanation}</p>
          </div>
        ) : (
          <button type="button" onClick={() => setShown(true)} className="mt-2 inline-flex min-h-touch items-center gap-2 font-medium text-talaTeal">
            <Icon name="eye" size={18} />
            {t('pk.showAnswer')}
          </button>
        )}
      </div>
    </li>
  );
}
