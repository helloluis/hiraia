'use client';
/**
 * The lesson's slides, at the top of the Lesson Plan view (Luis, 27 Nov 2026: "Presentations should be displayed
 * prominently in the Lesson Plan view, so the teacher already knows that they need to edit it to coincide with their
 * lesson plan. There should be an AI regeneration button on the slides too." and "Multigrade presentations should be
 * dynamically assembled in the Lesson Plan view.").
 *
 * A single lesson shows its slides (its day of her copy of the pack it fits, or slides made with AI from the lesson
 * itself), says plainly that they are hers to make match the plan, and offers Present, Edit slides, Rewrite with AI
 * (all of the lesson's slides, or one slide, chosen before anything is asked), Download and Earlier versions. AI only
 * ever proposes: she sees the suggestion first and uses it or keeps her own, and using it keeps her slides as an
 * earlier version. When the lesson changes after its slides were made, a cue says so and nothing is changed.
 *
 * A multi-grade session shows its slides put together now from each grade's own lesson slides, in the order of the
 * session's time blocks (decks/assemble.ts), with each grade's part, what is missing, and a way to make it.
 *
 * Self-contained: it takes the editor's `PlanEditor` and talks to the server's owner-only decks routes.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LessonPresentation, LessonSlides, SessionPart, SlidesAiScope } from '@hiraia/tala-core/contracts';
import { sessionSourceChoices } from '@hiraia/tala-core/decks';
import { MULTIGRADE_TEMPLATE_ID } from '@hiraia/tala-core/plan';
import { useT } from '@/i18n';
import { useSession } from '@/data/session';
import { usePackIndex } from '@/data/packs';
import {
  chooseSessionSource,
  deckFailure,
  deckMediaUrl,
  forgetDecks,
  lessonPptxUrl,
  linkPackSlides,
  slidesStillFit,
  unlinkSlides,
  useLessonPresentation,
} from '@/data/decks';
import { Callout, Kicker, StatusChip } from '@/components/editorial';
import { Icon } from '@/components/icons';
import { Banner, Button, LinkButton, Placeholder, Select, Sheet, Sparkle, TextInput, Toast, Waiting, cx } from '@/components/ui';
import { AiProposalSheet } from '@/features/slides/AiProposalSheet';
import { RevisionsSheet } from '@/features/slides/RevisionsSheet';
import { Lightbox } from '@/features/slides/Lightbox';
import { Presenter, type PresenterHandle } from '@/features/slides/Presenter';
import { SlideThumb } from '@/features/slides/SlideThumb';
import { RETRYABLE, TROUBLE_KEY } from '@/features/slides/ai-words';
import { rewritable, viewOfDeck, viewOfLessonSlides, viewOfSession, type DeckView } from '@/features/slides/deck-model';
import { useSlidesAi, type SlidesAi } from '@/features/slides/useSlidesAi';
import { jobBusy, packChoiceForLesson, secondsSince } from './presentation-model';
import type { PlanEditor } from './usePlanEditor';

const STRIP = 'strip -mx-1 flex gap-2.5 px-1 py-1';
const THUMB = 'w-[9.5rem] shrink-0 wide:w-[11rem]';
const OUTLINE = 'inline-flex min-h-touch items-center justify-center gap-2 rounded border border-forest bg-white px-4 py-2 font-medium text-forest hover:bg-cream';

/** Send this device's edits of a lesson and say whether the server now has all of them. */
function useSendLesson(ed: PlanEditor) {
  const { engine, syncNow } = useSession();
  return useCallback(
    async (planId: string): Promise<boolean> => {
      if (!engine) return false;
      await ed.flushAll();
      await syncNow();
      const plan = await engine.get('plan', planId);
      const sections = (await engine.list('plan_section')).filter((s) => s.data.planId === planId);
      return Boolean(plan) && !plan!.dirty && !sections.some((s) => s.dirty);
    },
    [ed, engine, syncNow]
  );
}

/** "Writing your slides… 14 s", ticking while a request is being worked on. */
function Working({ ai, onStop }: { ai: SlidesAi; onStop: () => void }) {
  const { t } = useT();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const secs = ai.job ? secondsSince(ai.job.createdAt, now) : 0;
  return (
    <div data-ai-working>
      <Waiting label={`${t(ai.job?.scope === 'slide' ? 'pp.ai.workingSlide' : 'pp.ai.working')} ${t('pp.ai.seconds', { n: secs })}`} onCancel={onStop} />
      {ai.trouble === 'offline' && <p className="mt-1 text-small text-forestMuted">{t('pp.ai.offlineWaiting')}</p>}
    </div>
  );
}

/** A failed or refused request: what happened, in words, and a way on. */
function Trouble({ ai, onRetry }: { ai: SlidesAi; onRetry: () => void }) {
  const { t } = useT();
  if (!ai.trouble || ai.phase !== 'failed') return null;
  return (
    <div data-ai-failed={ai.trouble}>
      <Banner
        kind="error"
        action={
          <span className="flex flex-wrap gap-2">
            {RETRYABLE.has(ai.trouble) && (
              <Button variant="primary" onClick={onRetry}>
                {t('pp.ai.retry')}
              </Button>
            )}
            <Button variant="quiet" onClick={() => void ai.discard()}>
              {t('common.close')}
            </Button>
          </span>
        }
      >
        {t(TROUBLE_KEY[ai.trouble])}
      </Banner>
    </div>
  );
}

/** Proposal slides laid out like the deck they would go into (or like a new lesson deck). */
function proposalView(ai: SlidesAi, ls: LessonSlides | null, fallback: { grade: string; subject: string; title: string }): DeckView | null {
  const p = ai.job?.proposal;
  if (!p) return null;
  const mediaUrl = (slug: string) => (ls ? deckMediaUrl(ls.deckId, slug) : '');
  return viewOfDeck(
    {
      id: `proposal-${ai.job!.id}`,
      title: ls?.title ?? fallback.title,
      language: p.language,
      grade: ls?.grade ?? fallback.grade,
      term: ls?.term ?? 0,
      week: ls?.week ?? 0,
      sourceApproved: ls?.sourceApproved ?? false,
      credits: ls?.credits ?? { reviewer: null, sourcesLine: '' },
      slides: p.slides,
      origin: ls?.origin ?? 'lesson',
      subject: ls?.subject ?? fallback.subject,
    },
    mediaUrl
  );
}

export function PresentationPanel({ ed }: { ed: PlanEditor }) {
  const { t } = useT();
  const { status } = useSession();
  const plan = ed.plan;
  // The server's revs of the lesson: when its edits reach the server, the slides' "the lesson changed" cue follows.
  const refresh = `${ed.planRecord?.rev ?? 0}:${ed.sections.map((s) => s.rev).join(',')}`;
  const pres = useLessonPresentation(plan?.id ?? '', refresh);
  if (!plan || status !== 'signedIn') return null;
  const session = plan.templateId === MULTIGRADE_TEMPLATE_ID || ed.template?.kind === 'multigrade';
  return (
    <section
      aria-labelledby="lesson-slides-title"
      data-presentation-panel={session ? 'session' : 'lesson'}
      className="flex flex-col gap-3 rounded-xl bg-talaTeal/10 p-4 wide:p-5"
    >
      {pres.presentation ? (
        session ? (
          <SessionSlides ed={ed} pres={pres.presentation} adopt={pres.adopt} reload={() => void pres.reload()} />
        ) : (
          <SingleLessonSlides ed={ed} pres={pres.presentation} adopt={pres.adopt} reload={() => void pres.reload()} />
        )
      ) : pres.failed ? (
        <>
          <Kicker icon="slides">{t(session ? 'pp.kickerSession' : 'pp.kicker')}</Kicker>
          <h2 id="lesson-slides-title" className="sr-only">
            {t(session ? 'pp.kickerSession' : 'pp.kicker')}
          </h2>
          <Banner kind="warn" action={<Button onClick={() => void pres.reload()}>{t('pp.retry')}</Button>}>
            {t(pres.failed === 'offline' ? 'pp.offline' : 'pp.loadFailed')}
          </Banner>
        </>
      ) : (
        <>
          <Kicker icon="slides">{t(session ? 'pp.kickerSession' : 'pp.kicker')}</Kicker>
          <h2 id="lesson-slides-title" className="sr-only">
            {t(session ? 'pp.kickerSession' : 'pp.kicker')}
          </h2>
          <Placeholder rows={2} />
        </>
      )}
    </section>
  );
}

/* ================================ one lesson ================================ */

function SingleLessonSlides({ ed, pres, adopt, reload }: { ed: PlanEditor; pres: LessonPresentation; adopt: (p: LessonPresentation) => void; reload: () => void }) {
  const { t } = useT();
  const plan = ed.plan!;
  const locked = plan.state === 'locked';
  const send = useSendLesson(ed);
  const { index } = usePackIndex();
  const year = ed.ws.years.find((y) => y.id === ed.cls?.schoolYearId) ?? ed.ws.activeYear;
  const choice = useMemo(() => packChoiceForLesson({ plan, index, year }), [plan, index, year]);
  const ls = pres.slides;
  const deckId = ls?.deckId ?? null;
  const mediaUrl = useCallback((slug: string) => (deckId ? deckMediaUrl(deckId, slug) : ''), [deckId]);
  const view = useMemo(() => (ls ? viewOfLessonSlides(ls, mediaUrl) : null), [ls, mediaUrl]);
  const [toast, setToast] = useState<string | null>(null);
  const [sheet, setSheet] = useState<'rewrite' | 'proposal' | 'revisions' | 'unlink' | null>(null);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [working, setWorking] = useState<'link' | 'checked' | 'day' | 'unlink' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const presenter = useRef<PresenterHandle>(null);
  const ai = useSlidesAi(plan.id, {
    initial: pres.job,
    beforeStart: () => send(plan.id),
    onApplied: (p, scope) => {
      adopt(p);
      forgetDecks();
      setSheet(null);
      setToast(t(scope === 'new' ? 'pp.ai.appliedNew' : 'pp.ai.applied'));
    },
  });
  // A suggestion that is ready opens by itself (also after a reload); closing it keeps it waiting.
  const readyId = ai.phase === 'ready' ? ai.job?.id : null;
  const seenReady = useRef<string | null>(null);
  useEffect(() => {
    if (readyId && seenReady.current !== readyId) {
      seenReady.current = readyId;
      setSheet('proposal');
    }
  }, [readyId]);
  const proposal = useMemo(() => proposalView(ai, ls, { grade: plan.grades[0] ?? '', subject: plan.subjectName, title: plan.title }), [ai, ls, plan.grades, plan.subjectName, plan.title]);
  const content = (ls?.slides ?? []).filter(rewritable);
  // What "all of the lesson's slides" replaces (the server's count): answer slides included, not covers or credits.
  const lessonCount = (ls?.slides ?? []).filter((s) => s.kind !== 'cover' && s.kind !== 'day' && s.kind !== 'credits').length;
  const firstId = ls?.slides.find((s) => s.kind !== 'credits')?.id ?? ls?.slides[0]?.id ?? '';
  const editHref = deckId ? `/slides/${encodeURIComponent(deckId)}?plan=${encodeURIComponent(plan.id)}${firstId ? `&slide=${encodeURIComponent(firstId)}` : ''}` : '';

  const usePack = async (day: number) => {
    if (!choice) return;
    setWorking('link');
    setNotice(null);
    try {
      adopt(await linkPackSlides(plan.id, { packId: choice.packId, lang: choice.lang, day }));
      forgetDecks();
    } catch (e) {
      setNotice(t(deckFailure(e) === 'offline' ? 'pp.offline' : 'pp.linkFailed'));
    } finally {
      setWorking(null);
    }
  };
  const chooseDay = async (day: number) => {
    if (!ls) return;
    setWorking('day');
    setNotice(null);
    try {
      adopt(await linkPackSlides(plan.id, { packId: ls.packId, lang: ls.language, day }));
    } catch (e) {
      setNotice(t(deckFailure(e) === 'offline' ? 'pp.offline' : 'pp.linkFailed'));
    } finally {
      setWorking(null);
    }
  };
  const stillFit = async () => {
    setWorking('checked');
    try {
      adopt(await slidesStillFit(plan.id));
    } catch (e) {
      setNotice(t(deckFailure(e) === 'offline' ? 'pp.offline' : 'pp.loadFailed'));
    } finally {
      setWorking(null);
    }
  };
  const stopUsing = async () => {
    setWorking('unlink');
    try {
      await unlinkSlides(plan.id);
      forgetDecks();
      setSheet(null);
      reload();
    } catch (e) {
      setNotice(t(deckFailure(e) === 'offline' ? 'pp.offline' : 'pp.loadFailed'));
    } finally {
      setWorking(null);
    }
  };
  const ask = async (scope: SlidesAiScope, more: { slideId?: string; instruction?: string } = {}) => {
    setSheet(null);
    await ai.start(scope, more);
  };
  const busy = ai.busy || jobBusy(ai.job);
  const kicker = <Kicker icon="slides">{t('pp.kicker')}</Kicker>;

  /* ---------- no slides yet ---------- */
  if (!ls) {
    return (
      <>
        {kicker}
        <h2 id="lesson-slides-title" className="font-display text-headline text-forest">
          {t('pp.none.title')}
        </h2>
        <p className="max-w-measure text-read">{t('pp.none.body')}</p>
        {notice && <Banner kind="warn">{notice}</Banner>}
        {ai.phase === 'working' || ai.phase === 'starting' ? (
          <Working ai={ai} onStop={() => void ai.discard()} />
        ) : (
          <div className="flex flex-wrap gap-2">
            {choice && (
              <Button variant="primary" busy={working === 'link'} onClick={() => void usePack(choice.day)} disabled={busy} data-use-pack={choice.packId}>
                <Icon name="slides" size={20} />
                {t('pp.none.usePack', { title: choice.title })}
              </Button>
            )}
            <Button variant={choice ? 'ai' : 'primary'} onClick={() => void ask('new')} disabled={busy || locked || working !== null} data-make-slides>
              <Sparkle /> {t('pp.none.makeAi')}
            </Button>
          </div>
        )}
        {choice && (
          <p className="text-small text-forestMuted">
            {choice.day ? t('pp.none.packDay', { n: choice.day }) : t('pp.none.packWeek')} {t('pp.none.packCopy')}
            {choice.status !== 'approved' ? ` ${t('pp.none.packDraft')}` : ''}
          </p>
        )}
        <p className="text-small text-forestMuted">{t('pp.none.aiHint')}</p>
        <Trouble ai={ai} onRetry={() => void ask('new')} />
        {ai.phase === 'ready' && sheet !== 'proposal' && (
          <Banner kind="info" action={<Button variant="primary" onClick={() => setSheet('proposal')}>{t('pp.ai.look')}</Button>}>
            {t('pp.ai.waiting')}
          </Banner>
        )}
        <AiProposalSheet ai={ai} view={proposal} scope="new" replacing={0} open={sheet === 'proposal' && (ai.phase === 'ready' || ai.phase === 'applying' || ai.phase === 'conflict')} onClose={() => setSheet(null)} />
        <Toast message={toast} onDone={() => setToast(null)} />
      </>
    );
  }

  /* ---------- the lesson's slides ---------- */
  const fromPack = ls.origin === 'pack';
  const dayName = pres.link?.day ? t('pp.day', { n: pres.link.day }) : fromPack ? t('pp.wholeWeek') : null;
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {kicker}
        {fromPack ? (
          <StatusChip tone="mine" icon="lock">
            {t('sl.view.mine')}
          </StatusChip>
        ) : (
          <StatusChip tone="mine" icon="pencil">
            {t('pp.madeWithAi')}
          </StatusChip>
        )}
        {fromPack && !ls.sourceApproved && <StatusChip tone="draft">{t('sl.draft')}</StatusChip>}
      </div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id="lesson-slides-title" className="min-w-0 break-words font-display text-headline text-forest">
          {ls.title}
        </h2>
        <p className="text-small text-forestMuted">
          {[dayName, ls.slides.length === 1 ? t('sl.countOne') : t('sl.count', { n: ls.slides.length })].filter(Boolean).join(' · ')}
        </p>
      </div>

      <Callout tint="plain" icon="pencil" className="bg-white">
        <p className="max-w-measure" data-align-cue>
          <strong>{t('pp.align.title')}</strong> {t(fromPack ? 'pp.align.pack' : 'pp.align.lesson')}
        </p>
      </Callout>

      {pres.stale && (
        <div data-stale-cue>
          <Banner
            kind="warn"
            action={
              <span className="flex flex-wrap gap-2">
                {!locked && (
                  <Button variant="ai" onClick={() => setSheet('rewrite')} disabled={busy}>
                    <Sparkle /> {t('pp.ai.rewrite')}
                  </Button>
                )}
                <Button onClick={() => void stillFit()} busy={working === 'checked'}>
                  {t('pp.stale.fits')}
                </Button>
              </span>
            }
          >
            {t('pp.stale.body')}
          </Banner>
        </div>
      )}
      {notice && <Banner kind="warn" action={<Button variant="quiet" onClick={() => setNotice(null)}>{t('common.close')}</Button>}>{notice}</Banner>}
      {(ai.phase === 'working' || ai.phase === 'starting') && <Working ai={ai} onStop={() => void ai.discard()} />}
      <Trouble ai={ai} onRetry={() => setSheet('rewrite')} />
      {ai.phase === 'ready' && sheet !== 'proposal' && (
        <Banner kind="info" action={<Button variant="primary" onClick={() => setSheet('proposal')}>{t('pp.ai.look')}</Button>}>
          {t('pp.ai.waiting')}
        </Banner>
      )}

      {view && (
        <div className={STRIP} role="group" aria-label={t('pp.thumbs')} data-lesson-thumbs>
          {view.layouts.map((l) => (
            <SlideThumb key={l.id} view={view} layout={l} onOpen={setLightbox} caption={false} className={THUMB} />
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => presenter.current?.start(0)} disabled={!view?.layouts.length} data-present>
          <Icon name="play" size={20} />
          {t('sl.present')}
        </Button>
        <span className="contents" data-edit-slides>
          <LinkButton href={editHref}>
            <Icon name="pencil" size={20} />
            {t('pp.edit')}
          </LinkButton>
        </span>
        {!locked && (
          <Button variant="ai" onClick={() => setSheet('rewrite')} disabled={busy} data-rewrite>
            <Sparkle /> {t('pp.ai.rewrite')}
          </Button>
        )}
        <a href={lessonPptxUrl(plan.id)} download className={OUTLINE} data-download-lesson>
          <Icon name="download" size={20} />
          {t('sl.download')}
        </a>
        <Button variant="quiet" onClick={() => setSheet('revisions')} data-revisions-open>
          <Icon name="restore" size={18} />
          {t('pp.rev.open')}
        </Button>
      </div>
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
        {fromPack && ls.days.length > 1 && (
          <div className="w-full max-w-[16rem]">
            <Select
              label={t('pp.dayLabel')}
              value={String(pres.link?.day ?? 0)}
              disabled={working === 'day'}
              onChange={(e) => void chooseDay(Number(e.target.value))}
              data-lesson-day
            >
              {ls.days.map((d) => (
                <option key={d} value={d}>
                  {t('pp.day', { n: d })}
                </option>
              ))}
              <option value="0">{t('pp.wholeWeek')}</option>
            </Select>
          </div>
        )}
        <Button variant="quiet" onClick={() => setSheet('unlink')}>
          {t(fromPack ? 'pp.unlink.pack' : 'pp.unlink.lesson')}
        </Button>
      </div>

      <RewriteSheet
        open={sheet === 'rewrite'}
        onClose={() => setSheet(null)}
        view={view}
        slideIds={content.map((s) => s.id)}
        wholeWeek={fromPack && !pres.link?.day}
        count={lessonCount}
        onAsk={(scope, more) => void ask(scope, more)}
      />
      <AiProposalSheet
        ai={ai}
        view={proposal}
        scope={ai.job?.scope ?? 'lesson'}
        replacing={ai.job?.proposal?.replaces.length ?? 0}
        open={sheet === 'proposal' && (ai.phase === 'ready' || ai.phase === 'applying' || ai.phase === 'conflict')}
        onClose={() => setSheet(null)}
        current={view && ai.job?.proposal ? { layouts: view.layouts.filter((l) => ai.job!.proposal!.replaces.includes(l.id)), mediaUrl: view.mediaUrl } : null}
      />
      <RevisionsSheet
        deckId={deckId}
        open={sheet === 'revisions'}
        onClose={() => setSheet(null)}
        onRestored={() => {
          forgetDecks();
          reload();
          setToast(t('pp.rev.restored'));
        }}
      />
      <Sheet
        open={sheet === 'unlink'}
        onClose={() => setSheet(null)}
        title={t(fromPack ? 'pp.unlink.pack' : 'pp.unlink.lesson')}
        actions={
          <>
            <Button onClick={() => setSheet(null)}>{t('common.cancel')}</Button>
            <Button variant="danger" busy={working === 'unlink'} onClick={() => void stopUsing()}>
              {t(fromPack ? 'pp.unlink.packConfirm' : 'pp.unlink.lessonConfirm')}
            </Button>
          </>
        }
      >
        <p>{t(fromPack ? 'pp.unlink.packBody' : 'pp.unlink.lessonBody')}</p>
      </Sheet>
      {lightbox !== null && view && (
        <Lightbox
          view={view}
          index={lightbox}
          onIndex={setLightbox}
          onClose={() => setLightbox(null)}
          action={
            <LinkButton href={`/slides/${encodeURIComponent(ls.deckId)}?plan=${encodeURIComponent(plan.id)}&slide=${encodeURIComponent(view.layouts[lightbox]?.id ?? '')}`} variant="primary">
              <Icon name="pencil" size={20} />
              {t('sl.edit')}
            </LinkButton>
          }
        />
      )}
      {view && <Presenter ref={presenter} view={view} />}
      <Toast message={toast} onDone={() => setToast(null)} />
    </>
  );
}

/** "Rewrite with AI": the scope is chosen first (all of the lesson's slides, or one), with optional words for AI. */
function RewriteSheet({
  open,
  onClose,
  view,
  slideIds,
  wholeWeek,
  count,
  onAsk,
}: {
  open: boolean;
  onClose: () => void;
  view: DeckView | null;
  slideIds: string[];
  wholeWeek: boolean;
  count: number;
  onAsk: (scope: SlidesAiScope, more: { slideId?: string; instruction?: string }) => void;
}) {
  const { t } = useT();
  const [scope, setScope] = useState<'lesson' | 'slide'>(wholeWeek ? 'slide' : 'lesson');
  const [slideId, setSlideId] = useState<string | null>(null);
  const [instruction, setInstruction] = useState('');
  useEffect(() => {
    if (open) {
      setScope(wholeWeek ? 'slide' : 'lesson');
      setSlideId(null);
      setInstruction('');
    }
  }, [open, wholeWeek]);
  const pickable = view ? view.layouts.filter((l) => slideIds.includes(l.id)) : [];
  const ready = scope === 'lesson' ? !wholeWeek && count > 0 : Boolean(slideId);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('pp.ai.rewriteTitle')}
      actions={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="ai" disabled={!ready} onClick={() => onAsk(scope, { slideId: scope === 'slide' ? slideId! : undefined, instruction: instruction.trim() })} data-rewrite-go>
            <Sparkle /> {t(scope === 'lesson' ? 'pp.ai.rewriteAllGo' : 'pp.ai.rewriteOneGo')}
          </Button>
        </>
      }
    >
      <p>{t('pp.ai.rewriteBody')}</p>
      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">{t('pp.ai.scope')}</legend>
        {(['lesson', 'slide'] as const).map((s) => (
          <label
            key={s}
            className={cx(
              'flex min-h-touch cursor-pointer items-start gap-3 rounded-lg border bg-white p-3',
              scope === s ? 'border-2 border-talaTeal' : 'border-hairline',
              s === 'lesson' && wholeWeek && 'cursor-not-allowed opacity-60'
            )}
          >
            <input type="radio" name="rewrite-scope" className="mt-1 h-5 w-5 accent-talaTeal" checked={scope === s} disabled={s === 'lesson' && wholeWeek} onChange={() => setScope(s)} data-scope={s} />
            <span className="min-w-0">
              <span className="block font-semibold">{s === 'lesson' ? t('pp.ai.scopeAll', { n: count }) : t('pp.ai.scopeOne')}</span>
              <span className="block text-small text-forestMuted">{s === 'lesson' ? t(wholeWeek ? 'pp.ai.scopeAllWeek' : 'pp.ai.scopeAllHint') : t('pp.ai.scopeOneHint')}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {scope === 'slide' && view && (
        <div className="grid grid-cols-2 gap-x-3 gap-y-3 min-[560px]:grid-cols-3" role="group" aria-label={t('pp.ai.pickSlide')}>
          {pickable.map((l) => (
            <SlideThumb key={l.id} view={view} layout={l} current={slideId === l.id} onOpen={() => setSlideId(l.id)} />
          ))}
        </div>
      )}
      <TextInput
        label={t('pp.ai.instruction')}
        optional
        hint={t('pp.ai.instructionHint')}
        value={instruction}
        maxLength={300}
        onChange={(e) => setInstruction(e.target.value)}
      />
      <p className="text-small text-forestMuted">{t('pp.ai.notice')}</p>
    </Sheet>
  );
}

/* ================================ a multi-grade session ================================ */

function SessionSlides({ ed, pres, adopt, reload }: { ed: PlanEditor; pres: LessonPresentation; adopt: (p: LessonPresentation) => void; reload: () => void }) {
  const { t } = useT();
  const plan = ed.plan!;
  const send = useSendLesson(ed);
  const sections = useMemo(() => ed.sections.map((s) => s.data), [ed.sections]);
  // Put together from the plan as it is on this device right now, and each grade's slides as the server has them.
  const { view, assembled } = useMemo(() => viewOfSession({ plan, sections, parts: pres.parts }, deckMediaUrl), [plan, sections, pres.parts]);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const presenter = useRef<PresenterHandle>(null);
  // Coming back to the tab (after editing a grade's slides elsewhere): look again.
  useEffect(() => {
    const onShow = () => {
      if (document.visibilityState === 'visible') reload();
    };
    document.addEventListener('visibilitychange', onShow);
    return () => document.removeEventListener('visibilitychange', onShow);
  }, [reload]);
  const download = async () => {
    setDownloading(true);
    setNotice(null);
    // The download is put together on the server from the plan as saved there: send this device's edits first.
    const sent = await send(plan.id).catch(() => false);
    setDownloading(false);
    if (!sent) return setNotice(t('pp.err.unsynced'));
    const a = document.createElement('a');
    a.href = lessonPptxUrl(plan.id);
    a.download = '';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
  const missing = assembled.missing.length;
  const groups = [
    { key: 'cover', label: t('pp.session.cover'), first: 0, count: 1 },
    ...assembled.blocks.map((b) => ({ key: b.id, label: `${b.label} · ${t('common.minutes', { n: b.minutes })}`, first: b.first, count: b.count })),
    ...(assembled.layout.slides.some((s) => s.role === 'credits')
      ? [{ key: 'about', label: t('pp.session.about'), first: assembled.layout.slides.findIndex((s) => s.role === 'credits'), count: assembled.layout.slides.filter((s) => s.role === 'credits').length }]
      : []),
  ];
  return (
    <>
      <Kicker icon="slides">{t('pp.kickerSession')}</Kicker>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id="lesson-slides-title" className="min-w-0 break-words font-display text-headline text-forest">
          {t('pp.session.title')}
        </h2>
        <p className="text-small text-forestMuted">{t('sl.count', { n: view.layouts.length })}</p>
      </div>
      <p className="max-w-measure text-read">{t('pp.session.body')}</p>
      <ul className="grid gap-2 wide:grid-cols-2" data-session-parts>
        {pres.parts.map((part) => (
          <GradePart key={part.groupId} ed={ed} part={part} sessionPlanId={plan.id} send={send} adopt={adopt} reload={reload} onToast={setToast} />
        ))}
      </ul>
      {missing > 0 && <Banner kind="warn">{t(missing === 1 ? 'pp.session.missingOne' : 'pp.session.missing', { n: missing })}</Banner>}
      {notice && <Banner kind="warn">{notice}</Banner>}
      <div className="flex flex-col gap-3" data-session-thumbs>
        {groups.map((g) => (
          <div key={g.key} className="min-w-0">
            <p className="kicker mb-1 text-forestMuted">{g.label}</p>
            <div className={STRIP} role="group" aria-label={g.label}>
              {view.layouts.slice(g.first, g.first + g.count).map((l) => (
                <SlideThumb key={l.id} view={view} layout={l} onOpen={setLightbox} caption={false} className={THUMB} />
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => presenter.current?.start(0)} data-present>
          <Icon name="play" size={20} />
          {t('sl.present')}
        </Button>
        <Button onClick={() => void download()} busy={downloading} data-download-session>
          <Icon name="download" size={20} />
          {t('sl.download')}
        </Button>
      </div>
      {lightbox !== null && <Lightbox view={view} index={lightbox} onIndex={setLightbox} onClose={() => setLightbox(null)} />}
      <Presenter ref={presenter} view={view} />
      <Toast message={toast} onDone={() => setToast(null)} />
    </>
  );
}

/** One grade's part of the session: its lesson, its slides, and what to do when either is missing. */
function GradePart({
  ed,
  part,
  sessionPlanId,
  send,
  adopt,
  reload,
  onToast,
}: {
  ed: PlanEditor;
  part: SessionPart;
  sessionPlanId: string;
  send: (planId: string) => Promise<boolean>;
  adopt: (p: LessonPresentation) => void;
  reload: () => void;
  onToast: (m: string) => void;
}) {
  const { t } = useT();
  const plan = ed.plan!;
  const [sheet, setSheet] = useState(false);
  const [busy, setBusy] = useState(false);
  const sourceId = part.source?.planId ?? null;
  const ai = useSlidesAi(sourceId, {
    beforeStart: () => send(sourceId!),
    onApplied: () => {
      setSheet(false);
      forgetDecks();
      reload();
      onToast(t('pp.ai.appliedNew'));
    },
  });
  useEffect(() => {
    if (ai.phase === 'ready') setSheet(true);
  }, [ai.phase]);
  const choices = useMemo(() => sessionSourceChoices({ session: plan, groupId: part.groupId, grade: part.grade, plans: ed.ws.plans }), [plan, part.groupId, part.grade, ed.ws.plans]);
  const sourcePlan = sourceId ? ed.ws.plans.find((p) => p.id === sourceId) : undefined;
  const proposal = useMemo(
    () => proposalView(ai, null, { grade: part.grade, subject: sourcePlan?.subjectName ?? plan.subjectName, title: part.source?.title ?? '' }),
    [ai, part.grade, part.source?.title, sourcePlan?.subjectName, plan.subjectName]
  );
  const choose = async (id: string) => {
    setBusy(true);
    try {
      adopt(await chooseSessionSource(sessionPlanId, part.groupId, id || null));
    } catch {
      onToast(t('pp.loadFailed'));
    } finally {
      setBusy(false);
    }
  };
  const grade = t('common.grade', { g: part.grade });
  return (
    <li className="flex flex-col gap-2 rounded-lg bg-white p-3 shadow-card" data-session-part={part.grade}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-semibold">{grade}</span>
        {part.source ? (
          <span className="min-w-0 break-words text-forestMuted">{part.source.title || t('lessons.untitled')}</span>
        ) : (
          <span className="text-brick">{t('pp.session.noLesson')}</span>
        )}
      </div>
      <p className="flex flex-wrap items-center gap-2 text-small">
        {part.slides ? (
          <>
            <Icon name="slides" size={16} className="text-talaTeal" />
            <span>{part.slides.slides.length === 1 ? t('sl.countOne') : t('sl.count', { n: part.slides.slides.length })}</span>
            {part.stale && <StatusChip tone="fix">{t('pp.session.lessonChanged')}</StatusChip>}
          </>
        ) : part.source ? (
          <span className="text-forestMuted">{t('pp.session.noSlides')}</span>
        ) : null}
      </p>
      {(ai.phase === 'working' || ai.phase === 'starting') && <Working ai={ai} onStop={() => void ai.discard()} />}
      <Trouble ai={ai} onRetry={() => void ai.start('new')} />
      <div className="flex flex-wrap gap-2">
        {part.source && !part.slides && ai.phase !== 'working' && ai.phase !== 'starting' && (
          <Button variant="ai" onClick={() => void ai.start('new')} disabled={ai.busy} data-make-grade={part.grade}>
            <Sparkle /> {t('pp.session.make', { grade })}
          </Button>
        )}
        {part.source && (
          <LinkButton href={`/lessons/${encodeURIComponent(part.source.planId)}`} variant="quiet">
            {t('pp.session.openLesson')}
          </LinkButton>
        )}
      </div>
      {choices.length > 0 && (
        <Select label={t('pp.session.choose', { grade })} value={part.source?.chosen === 'teacher' ? part.source.planId : ''} disabled={busy} onChange={(e) => void choose(e.target.value)} data-session-source={part.grade}>
          <option value="">{t('pp.session.auto')}</option>
          {choices.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title || t('lessons.untitled')}
              {p.placements[0]?.dates[0] ? ` (${p.placements[0].dates[0]})` : ''}
            </option>
          ))}
        </Select>
      )}
      <AiProposalSheet ai={ai} view={proposal} scope="new" replacing={0} open={sheet && (ai.phase === 'ready' || ai.phase === 'applying' || ai.phase === 'conflict')} onClose={() => setSheet(false)} />
    </li>
  );
}
