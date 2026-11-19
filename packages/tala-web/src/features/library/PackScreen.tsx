'use client';
/**
 * One weekly pack, laid out like a magazine feature: a cover (what week, what it is about, its drawing, its honest
 * status), the Big Idea, the week at a glance, then three reading sections — lesson plans, slides, teacher guide.
 * "Use for my class" copies the lessons into the teacher's own records; the slides can be copied and edited
 * (features/slides). The shared pack itself never changes.
 */
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import type { PackDetail, PackFileKind, PackLang } from '@hiraia/tala-core/contracts';
import { layoutDeck, layoutInputFromPack } from '@hiraia/tala-core/decks';
import { useT } from '@/i18n';
import { useSession } from '@/data/session';
import { fileUrl, mediaUrl, previewUrl, usePackDetail, usePackIndex } from '@/data/packs';
import { BigIdea, Disclosure, Facts, Kicker, Plate, Segmented, StatusChip, TabBar } from '@/components/editorial';
import { Icon, type IconName } from '@/components/icons';
import { Banner, Button, EmptyState, LinkButton, Placeholder, Toast, cx } from '@/components/ui';
import { PackSlidesTab } from '@/features/slides/PackSlidesTab';
import { PackGuide } from './PackGuide';
import { PackLessons } from './PackLessons';
import { UseSheet } from './UseSheet';
import { leadSentence } from './prose';

type Tab = 'lessons' | 'slides' | 'guide';
const TABS: Tab[] = ['lessons', 'slides', 'guide'];

export function PackScreen({ packId }: { packId: string }) {
  const { t, lang: uiLang } = useT();
  const router = useRouter();
  const params = useSearchParams();
  const { status } = useSession();
  const { index } = usePackIndex();
  const entry0 = index?.packs.find((p) => p.packId === packId);

  // Language: an explicit choice (?lang=) wins; else the interface language; else whichever version can be opened.
  const asked = params.get('lang');
  const preferred: PackLang = asked === 'en' || asked === 'fil' ? asked : uiLang === 'fil' ? 'fil' : 'en';
  const other: PackLang = preferred === 'fil' ? 'en' : 'fil';
  const lang: PackLang = entry0 && !entry0.variants[preferred].viewable && entry0.variants[other].viewable ? other : preferred;
  const { detail, error } = usePackDetail(packId, lang);

  const tab: Tab = TABS.includes(params.get('tab') as Tab) ? (params.get('tab') as Tab) : 'lessons';
  const day = Math.min(5, Math.max(1, Number(params.get('day')) || 1));
  const setParams = (next: Record<string, string | null>, scrollTo?: string) => {
    const q = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === null) q.delete(k);
      else q.set(k, v);
    }
    router.replace(`/library/${packId}?${q.toString()}`, { scroll: false });
    if (scrollTo) requestAnimationFrame(() => document.getElementById(scrollTo)?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  };

  const [useOpen, setUseOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const layouts = useMemo(() => (detail ? layoutDeck(layoutInputFromPack(detail.content, detail.review)) : []), [detail]);

  // A link that names a tab or a day lands on the reading section, not on the cover.
  const [landed, setLanded] = useState(false);
  useEffect(() => {
    if (!detail || landed) return;
    setLanded(true);
    if (params.get('tab') || params.get('day')) requestAnimationFrame(() => document.getElementById('pack-sections')?.scrollIntoView({ block: 'start' }));
  }, [detail, landed, params]);

  const language = (
    <Segmented
      label={t('pk.language')}
      size="sm"
      value={lang}
      onChange={(l) => setParams({ lang: l })}
      options={(['fil', 'en'] as const).map((l) => ({
        value: l,
        label: t(l === 'fil' ? 'lib.pack.filipino' : 'lib.pack.english'),
        disabled: entry0 ? !entry0.variants[l].viewable : false,
        title: entry0 && !entry0.variants[l].viewable ? t('pk.notInLanguage') : undefined,
      }))}
    />
  );
  const back = (grade?: string, term?: number) => (
    <a href={grade ? `/library?grade=${grade}&term=${term}` : '/library'} className="inline-flex min-h-touch items-center gap-1.5 font-medium text-talaTeal">
      <Icon name="arrowLeft" size={18} />
      {t('lib.back')}
    </a>
  );

  if (!detail && !error) return <Placeholder rows={6} />;
  if (!detail)
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {back()}
          {language}
        </div>
        {status === 'signedIn' ? (
          <Banner kind="warn">{error}</Banner>
        ) : (
          // A visitor cannot open a draft: say so kindly and offer the way in.
          <EmptyState
            art="shelf"
            heading={t('pk.visitorTitle')}
            action={
              <LinkButton href="/sign-in" variant="primary">
                <Icon name="lock" size={18} />
                {t('lib2.signIn')}
              </LinkButton>
            }
          >
            {t('pk.visitorBody')}
          </EmptyState>
        )}
      </div>
    );

  const { content: p, review, entry } = detail;
  const variant = entry.variants[detail.language];
  const approved = review.publication === 'approved' && Boolean(review.teacherReview);
  const needsWork = variant.status === 'needs_work';
  const coverSlug = layouts[0]?.picture ?? p.illustrations[0]?.slug ?? null;
  const coverAlt = p.slides.find((s) => s.image?.slug === coverSlug)?.image?.alt ?? '';
  const idea = leadSentence(p.guide.bigIdea);
  const file = (kind: PackFileKind) => variant.files.find((f) => f.kind === kind);
  const mb = (bytes: number) => (bytes / 1_048_576).toFixed(1);
  const downloads: Array<{ kind: PackFileKind; icon: IconName; label: string; type: string }> = [
    { kind: 'slides', icon: 'slides', label: t('pk.dl.slides'), type: t('pk.dl.pptx') },
    { kind: 'guide', icon: 'book', label: t('pk.dl.guide'), type: t('pk.dl.pdf') },
    { kind: 'plans', icon: 'lessons', label: t('pk.dl.plans'), type: t('pk.dl.pdf') },
  ];
  const checkState = (s: string) => (s === 'pass' ? t('pk.check.pass') : s === 'fail' ? t('pk.check.fail') : s === 'issues_open' ? t('pk.check.open') : t('pk.check.none'));
  const checkTone = (s: string): 'ready' | 'fix' | 'quiet' => (s === 'pass' ? 'ready' : s === 'fail' || s === 'issues_open' ? 'fix' : 'quiet');

  return (
    <div className="flex flex-col gap-8 wide:gap-10">
      {/* ---------- Cover ---------- */}
      <header className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {back(p.grade, p.term)}
          {language}
        </div>
        <div className="grid items-start gap-6 wide:grid-cols-[minmax(0,1fr)_20rem] wide:gap-10">
          <div className="min-w-0">
            <Kicker icon="flask">{t('pk.kicker', { grade: p.grade, term: p.term, week: p.week })}</Kicker>
            <h1 className="mt-3 text-hero break-words [overflow-wrap:anywhere]">{p.title}</h1>
            <p className="mt-4 max-w-measure text-read text-forest/90 break-words wide:text-lead">{p.summary}</p>
            <Facts
              className="mt-4"
              items={[
                { icon: 'lessons', text: t('pk.fact.lessons') },
                variant.slideCount ? { icon: 'slides', text: t('pk.fact.slides', { n: variant.slideCount }) } : null,
                { icon: 'book', text: t('pk.fact.guide') },
              ]}
            />
            <div className="mt-5 border-l-[3px] border-yellow pl-3">
              <StatusChip tone={approved ? 'ready' : needsWork ? 'fix' : 'draft'}>
                {approved ? t('pk.status.ready', { reviewer: review.teacherReview!.reviewer }) : needsWork ? t('pk.status.fix') : t('pk.status.draft')}
              </StatusChip>
              {!approved && <p className="mt-2 max-w-measure text-small text-forestMuted">{needsWork ? t('pk.fixNote') : t('pk.draftNote')}</p>}
              <a href="#pack-checked" className="mt-1 inline-flex min-h-[2.5rem] items-center gap-1 text-small font-medium text-talaTeal underline-offset-4 hover:underline">
                {t('pk.status.more')}
                <Icon name="arrowDown" size={14} />
              </a>
            </div>
          </div>
          {coverSlug && <Plate eager src={mediaUrl(p.packId, coverSlug, detail.language)} alt={coverAlt} className="aspect-[16/10] w-full max-w-sm justify-self-center wide:aspect-[4/3] wide:max-w-none" />}
        </div>

        <div className="flex flex-col gap-3 wide:flex-row wide:flex-wrap wide:items-center">
          {status === 'signedIn' ? (
            <Button variant="primary" onClick={() => setUseOpen(true)} className="wide:shrink-0 wide:whitespace-nowrap wide:px-6">
              <Icon name="plus" size={20} />
              {t('pk.use')}
            </Button>
          ) : (
            <LinkButton href="/sign-in" variant="primary">
              {t('lib.pack.useSignIn')}
            </LinkButton>
          )}
          {variant.files.length === 0 ? (
            <p className="text-small text-forestMuted">{t('lib.pack.notBuiltFiles')}</p>
          ) : (
            <ul className="flex flex-wrap gap-2" aria-label={t('pk.download')}>
              {downloads.map((d) => {
                const f = file(d.kind);
                if (!f) return null;
                return (
                  <li key={d.kind}>
                    <a
                      href={fileUrl(p.packId, d.kind, detail.language)}
                      download
                      className="inline-flex min-h-touch items-center gap-2 rounded border border-hairline bg-white px-3 hover:border-forest"
                    >
                      <Icon name="download" size={18} className="text-talaTeal" />
                      <span className="font-medium">{d.label}</span>
                      <span className="text-small text-forestMuted">
                        {d.type} · {t('lib.pack.size', { size: mb(f.bytes) })}
                      </span>
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </header>

      {/* ---------- Big idea ---------- */}
      <BigIdea label={t('pk.bigIdea')} idea={idea ? idea.lead : p.guide.bigIdea}>
        {idea && <p className="break-words">{idea.rest}</p>}
        <p className="break-words">
          <span className="kicker mr-2 text-forestMuted">{t('pk.whyItMatters')}</span>
          {p.guide.whyItMatters}
        </p>
      </BigIdea>

      {/* ---------- The week at a glance ---------- */}
      <section aria-labelledby="glance">
        <h2 id="glance" className="kicker text-forestMuted">
          {t('pk.glance')}
        </h2>
        <ol className="strip -mx-4 mt-3 flex gap-3 px-4 wide:mx-0 wide:grid wide:grid-cols-5 wide:px-0">
          {p.days.map((d) => {
            // The day's divider slide is its cover: the real slide a class will see first that day.
            const at = p.slides.findIndex((x) => x.kind === 'day' && x.day === d.day);
            const cover = at >= 0 && variant.files.length > 0 ? previewUrl(p.packId, at + 1, detail.language) : null;
            return (
              <li key={d.day} className="w-[15.5rem] shrink-0 wide:w-auto">
                <button
                  type="button"
                  onClick={() => setParams({ tab: 'lessons', day: String(d.day) }, 'pack-sections')}
                  className="group flex h-full w-full flex-col overflow-hidden rounded-lg bg-white text-left shadow-card transition-shadow hover:shadow-lift"
                >
                  <span className="relative block aspect-video w-full overflow-hidden bg-forest">
                    {cover ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={cover} alt="" loading="lazy" decoding="async" width={640} height={360} className="h-full w-full object-cover" />
                    ) : (
                      <span className="absolute left-3 top-2 font-display text-[2.75rem] leading-none text-yellow">{d.day}</span>
                    )}
                  </span>
                  <span className="flex flex-1 flex-col gap-1 px-3 py-3">
                    <span className="kicker text-talaTeal">{t('pk.dayN', { day: d.day })}</span>
                    <span className="font-display text-title leading-snug break-words">{d.title}</span>
                    <span className="mt-auto inline-flex items-center gap-1 pt-1 text-small font-medium text-talaTeal">
                      {t('pk.readDay')}
                      <Icon name="arrowRight" size={15} className="transition-transform group-hover:translate-x-0.5" />
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </section>

      {/* ---------- Reading sections ---------- */}
      <div id="pack-sections" className="scroll-mt-16">
        <div className="sticky top-[var(--header-h,0px)] z-20 -mx-4 bg-cream px-4 pt-1 wide:mx-0 wide:px-0">
          <TabBar
            label={t('lib.pack.tabs')}
            idBase="pack"
            value={tab}
            onChange={(v) => setParams({ tab: v, slide: null })}
            tabs={[
              { value: 'lessons', label: t('pk.tab.lessons'), icon: 'lessons', count: p.days.length },
              { value: 'slides', label: t('pk.tab.slides'), icon: 'slides', count: p.slides.length },
              { value: 'guide', label: t('pk.tab.guide'), icon: 'book' },
            ]}
          />
        </div>
        <div role="tabpanel" id={`pack-panel-${tab}`} aria-labelledby={`pack-tab-${tab}`} className="pt-6">
          {tab === 'lessons' && (
            <PackLessons
              detail={detail}
              day={day}
              onDay={(d) => setParams({ day: String(d) }, 'pack-sections')}
              onSlides={(id) => setParams({ tab: 'slides', slide: id }, 'pack-sections')}
            />
          )}
          {tab === 'slides' && <PackSlidesTab detail={detail} initialSlideId={params.get('slide')} />}
          {tab === 'guide' && <PackGuide detail={detail} />}
        </div>
      </div>

      {/* ---------- How it was checked ---------- */}
      <section id="pack-checked" aria-labelledby="checked" className="scroll-mt-20 rounded-xl bg-white px-5 py-5 shadow-card wide:px-7">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-talaTeal/15 text-talaTeal">
            <Icon name="shield" size={21} />
          </span>
          <h2 id="checked" className="text-headline">
            {t('pk.checked')}
          </h2>
        </div>
        <ul className="mt-4 grid gap-4 wide:grid-cols-3">
          <li>
            <p className="font-semibold">{t('pk.check.auto')}</p>
            <div className="mt-1.5">
              <StatusChip tone={checkTone(review.autoChecks.state)}>{checkState(review.autoChecks.state)}</StatusChip>
            </div>
          </li>
          <li>
            <p className="font-semibold">{t('pk.check.model')}</p>
            <div className="mt-1.5">
              <StatusChip tone={checkTone(review.modelCritique.state)}>{checkState(review.modelCritique.state)}</StatusChip>
            </div>
            <p className="mt-1.5 text-small text-forestMuted">{t('pk.check.modelDetail', { model: review.modelCritique.model ?? '—', rounds: review.modelCritique.rounds })}</p>
          </li>
          <li>
            <p className="font-semibold">{t('pk.check.teacher')}</p>
            <div className="mt-1.5">
              <StatusChip tone={review.teacherReview ? 'ready' : 'quiet'}>{review.teacherReview ? `${review.teacherReview.reviewer} (${review.teacherReview.role})` : t('pk.check.none')}</StatusChip>
            </div>
          </li>
        </ul>
        {review.modelCritique.openIssues.length > 0 && (
          <Disclosure className="mt-3 border-t border-hairline" summary={t('pk.check.openIssues', { n: review.modelCritique.openIssues.length })} icon={<Icon name="alert" size={20} className="text-brick" />}>
            <ul className="flex list-disc flex-col gap-1.5 pl-5 text-small">
              {review.modelCritique.openIssues.map((i) => (
                <li key={i} className={cx('break-words')}>
                  {i}
                </li>
              ))}
            </ul>
          </Disclosure>
        )}
      </section>

      {useOpen && <UseSheet detail={detail} onClose={() => setUseOpen(false)} onDone={() => setToast(t('lib.use.done'))} />}
      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  );
}
