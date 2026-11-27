'use client';
/**
 * "Edit my copy": a much simpler Google Slides for one teacher's own copy of a pack's deck.
 *
 * What a teacher can do, and nothing more: click the words on the slide (or use the plain fields) to change the
 * title, the lines, the answer choices and the teacher notes; add, duplicate, delete, move and restore slides;
 * remove or put back a drawing; undo; present; download the copy as PowerPoint. Changes save by themselves and the
 * screen always says truthfully whether they are saved. The copy is private; the Hiraia original never changes.
 */
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { DECK_LIMITS } from '@hiraia/tala-core/contracts';
import type { DeckDetail, DeckSlide } from '@hiraia/tala-core/contracts';
import type { EditField } from '@hiraia/tala-core/decks';
import { useT } from '@/i18n';
import { useSession } from '@/data/session';
import { deckFailure, deckMediaUrl, deckPptxUrl, deleteDeck, forgetDecks, useDeck } from '@/data/decks';
import { StatusChip } from '@/components/editorial';
import { Icon, type IconName } from '@/components/icons';
import { Banner, Button, LinkButton, Placeholder, Sheet, Sparkle, Toast, cx } from '@/components/ui';
import { DeckFields } from './DeckFields';
import {
  ADDABLE_KINDS,
  addSlide,
  baseOf,
  canDelete,
  canMove,
  clearDraft,
  deleteSlide,
  duplicateSlide,
  groupSlides,
  isAnchor,
  isLocked,
  moveSlide,
  newSlideId,
  restoreSlide,
  setChoices,
  setCorrectChoice,
  updateSlide,
  viewOfDeck,
  type AddableKind,
} from './deck-model';
import { LocalIcon } from './local-icons';
import { AiProposalSheet } from './AiProposalSheet';
import { RevisionsSheet } from './RevisionsSheet';
import { RETRYABLE, TROUBLE_KEY } from './ai-words';
import { rewritable } from './deck-model';
import { useSlidesAi } from './useSlidesAi';
import { Presenter, type PresenterHandle } from './Presenter';
import { SlideThumb, kindCaption, slideName } from './SlideThumb';
import { SlideView, type SlideEditing } from './SlideView';
import { useDeckEditor, type DeckEditor as Editor, type SaveState } from './useDeckEditor';

const WIDE_QUERY = '(min-width: 840px)';

function useWide(): boolean {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(WIDE_QUERY);
    const apply = () => setWide(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);
  return wide;
}

/** The route's screen: waits for the session and the copy, and says plainly when the copy cannot be opened. */
export function DeckEditorScreen({ deckId }: { deckId: string }) {
  const { t } = useT();
  const { status } = useSession();
  const router = useRouter();
  const params = useSearchParams();
  useEffect(() => {
    if (status === 'signedOut') router.replace('/sign-in');
  }, [status, router]);
  const deck = useDeck(status === 'signedIn' ? deckId : null);
  if (deck.detail) return <DeckEditor key={deck.detail.deck.id} initial={deck.detail} startSlideId={params.get('slide')} planId={params.get('plan')} />;
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[40rem] flex-col justify-center gap-4 px-4 py-10">
      {status !== 'signedIn' || deck.loading || !deck.failed ? (
        <Placeholder rows={5} />
      ) : deck.failed === 'gone' ? (
        <>
          <Banner kind="warn">{t('sl.ed.notFound')}</Banner>
          <LinkButton href="/library" variant="primary">
            {t('sl.ed.goLibrary')}
          </LinkButton>
        </>
      ) : (
        <>
          <Banner kind="warn">{t('sl.ed.loadFailed')}</Banner>
          <Button variant="primary" onClick={() => void deck.reload()}>
            {t('sl.ed.retry')}
          </Button>
          <LinkButton href="/library">{t('sl.ed.goLibrary')}</LinkButton>
        </>
      )}
    </main>
  );
}

function SaveStatus({ state }: { state: SaveState }) {
  const { t } = useT();
  const ok = state === 'saved';
  const busy = state === 'saving' || state === 'dirty';
  const text = ok
    ? t('sl.ed.status.saved')
    : state === 'saving'
      ? t('sl.ed.status.saving')
      : state === 'dirty'
        ? t('sl.ed.status.dirty')
        : state === 'offline'
          ? t('sl.ed.status.offline')
          : t('sl.ed.status.error');
  return (
    <p
      role="status"
      aria-live="polite"
      data-save-state={state}
      className={cx(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1.5 text-small font-medium leading-none',
        ok ? 'bg-sage/30 text-forest' : busy ? 'bg-forest/10 text-forestMuted' : 'bg-brick/10 text-brick'
      )}
    >
      {ok ? <Icon name="check" size={15} strokeWidth={2.4} /> : busy ? <LocalIcon name="spinner" size={15} className="animate-spin" /> : state === 'offline' ? <LocalIcon name="cloudOff" size={15} /> : <Icon name="alert" size={15} />}
      <span className="whitespace-nowrap">{text}</span>
    </p>
  );
}

function BarIcon({ icon, local, label, onClick, disabled }: { icon?: IconName; local?: 'redo' | 'dots'; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} title={label} className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded text-forest hover:bg-cream disabled:opacity-35 disabled:hover:bg-transparent">
      {local ? <LocalIcon name={local} size={22} /> : <Icon name={icon!} size={22} />}
    </button>
  );
}

function Op({ icon, children, onClick, disabled, tone }: { icon: IconName; children: ReactNode; onClick: () => void; disabled?: boolean; tone?: 'add' | 'danger' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cx(
        'inline-flex min-h-touch shrink-0 items-center gap-2 rounded border px-3 font-medium disabled:cursor-not-allowed disabled:opacity-40',
        tone === 'add' ? 'border-2 border-talaTeal bg-white text-talaTeal hover:bg-talaTeal/10' : tone === 'danger' ? 'border-hairline bg-white text-brick hover:bg-brick/10' : 'border-hairline bg-white text-forest hover:bg-cream'
      )}
    >
      <Icon name={icon} size={19} />
      <span className="whitespace-nowrap">{children}</span>
    </button>
  );
}

const ADD_ICON: Record<AddableKind, IconName> = { concept: 'lessons', question: 'help', activity: 'checklist', vocabulary: 'book' };

/**
 * `planId`: the editor was opened from a lesson plan (its slides panel). Back goes to the lesson, and a slide can be
 * rewritten with AI from that lesson (the server checks the lesson uses this very deck).
 */
function DeckEditor({ initial, startSlideId, planId }: { initial: DeckDetail; startSlideId: string | null; planId: string | null }) {
  const { t } = useT();
  const router = useRouter();
  const ed: Editor = useDeckEditor(initial);
  const deck = ed.detail.deck;
  const wide = useWide();
  const mediaUrl = useCallback((slug: string) => deckMediaUrl(deck.id, slug), [deck.id]);
  const view = useMemo(() => viewOfDeck({ ...deck, title: ed.title, slides: ed.slides }, mediaUrl, { editing: true, baseSlides: ed.detail.baseSlides }), [deck, ed.title, ed.slides, ed.detail.baseSlides, mediaUrl]);
  const groups = useMemo(() => groupSlides(view.layouts), [view.layouts]);
  const total = ed.slides.length;

  const [selectedId, setSelectedId] = useState(() => (startSlideId && initial.deck.slides.some((s) => s.id === startSlideId) ? startSlideId : initial.deck.slides[0]!.id));
  const lastIndex = useRef(0);
  const index = Math.max(0, ed.slides.findIndex((s) => s.id === selectedId));
  const slide = ed.slides[index]!;
  const layout = view.layouts[index];
  // The slide on show may vanish (undo, delete): fall to the one now in its place.
  useEffect(() => {
    if (ed.slides.some((s) => s.id === selectedId)) lastIndex.current = ed.slides.findIndex((s) => s.id === selectedId);
    else setSelectedId(ed.slides[Math.min(lastIndex.current, ed.slides.length - 1)]!.id);
  }, [ed.slides, selectedId]);

  const [active, setActive] = useState<EditField | null>(null);
  const [sheet, setSheet] = useState<'add' | 'drawing' | 'reset' | 'delete' | 'more' | 'revisions' | 'ai' | null>(null);
  const [toast, setToast] = useState<{ message: string; undo?: boolean } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [working, setWorking] = useState<'download' | 'reset' | 'delete' | 'conflict' | null>(null);
  const [conflictLater, setConflictLater] = useState(false);
  const presenter = useRef<PresenterHandle>(null);
  const bar = useRef<HTMLElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const rail = useRef<HTMLDivElement>(null);

  const select = useCallback((id: string) => {
    setActive(null);
    setSelectedId(id);
  }, []);
  const selectIndex = useCallback((i: number) => select(ed.slides[Math.max(0, Math.min(i, ed.slides.length - 1))]!.id), [ed.slides, select]);

  // Reopening lands on the same slide; the lists follow the slide on show.
  useEffect(() => {
    try {
      window.history.replaceState(window.history.state, '', `?slide=${encodeURIComponent(selectedId)}`);
    } catch {
      /* the address bar is a convenience only */
    }
    for (const el of [strip.current, rail.current]) el?.querySelector<HTMLElement>(`[data-slide-thumb="${selectedId}"]`)?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [selectedId]);

  // The sticky parts sit under the bar, whatever height it wraps to.
  const [barH, setBarH] = useState(56);
  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    const apply = () => setBarH(Math.round(el.getBoundingClientRect().height));
    apply();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (ed.state !== 'conflict') setConflictLater(false);
  }, [ed.state]);

  // Ctrl/⌘+Z and Ctrl/⌘+Shift+Z (or Ctrl+Y) outside a text box undo and redo slide changes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault();
        ed.undo();
      } else if ((k === 'z' && e.shiftKey) || k === 'y') {
        e.preventDefault();
        ed.redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ed]);

  const focusField = useCallback(
    (field: EditField) => {
      const id = field.type === 'title' ? `f-${slide.id}-title` : field.type === 'lines' ? `f-${slide.id}-line-0` : `f-${slide.id}-choice-${field.index}`;
      const el = document.getElementById(id);
      el?.scrollIntoView({ block: 'center' });
      el?.focus({ preventScroll: true });
    },
    [slide.id]
  );

  const locked = isLocked(slide);
  const editing: SlideEditing | undefined = useMemo(() => {
    if (locked) return undefined;
    return {
      active,
      valueOf: (f) => (f.type === 'title' ? slide.title : f.type === 'lines' ? slide.lines.join('\n') : (slide.choices[f.index] ?? '')),
      onStart: (f) => (wide ? setActive(f) : focusField(f)),
      onCancel: () => setActive(null),
      onCommit: (f, value) => {
        setActive(null);
        if (f.type === 'title') {
          const v = value.replace(/\s*\n\s*/g, ' ').trim();
          if (v !== slide.title) ed.change(updateSlide(ed.slides, slide.id, { title: v }));
        } else if (f.type === 'lines') {
          const lines = value.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, DECK_LIMITS.lines);
          if (lines.join('\n') !== slide.lines.join('\n')) ed.change(updateSlide(ed.slides, slide.id, { lines }));
        } else {
          const v = value.replace(/\s*\n\s*/g, ' ').trim();
          const next = slide.choices.slice();
          if (v) next[f.index] = v;
          else next.splice(f.index, 1);
          if (next.join('\n') !== slide.choices.join('\n')) ed.change(setChoices(ed.slides, slide.id, next));
        }
      },
      words: {
        addTitle: t('sl.ed.f.titlePlaceholder'),
        addText: t('sl.ed.f.linePlaceholder'),
        changeTitle: t('sl.ed.f.title'),
        changeText: t('sl.ed.f.text'),
        changeChoice: (letter) => t('sl.ed.f.choice', { letter }),
      },
      maxLength: (f) => (f.type === 'title' ? DECK_LIMITS.title : f.type === 'lines' ? (DECK_LIMITS.line + 1) * DECK_LIMITS.lines : DECK_LIMITS.choice),
    };
  }, [active, ed, focusField, locked, slide, t, wide]);

  /* ---- slide operations ---- */
  // A closing dialog hands the keyboard back to the button that opened it. Whatever should get the keyboard next
  // (the new slide's title) is therefore done AFTER the sheet has closed: this effect runs after the Sheet's own.
  const afterSheet = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (sheet !== null || !afterSheet.current) return;
    const run = afterSheet.current;
    afterSheet.current = null;
    run();
  }, [sheet]);

  const add = (kind: AddableKind) => {
    const id = newSlideId(ed.slides.map((s) => s.id));
    ed.change(addSlide(ed.slides, slide.id, kind, id).slides);
    afterSheet.current = () => {
      if (wide) setActive({ type: 'title' });
      else requestAnimationFrame(() => document.getElementById(`f-${id}-title`)?.focus());
    };
    setSheet(null);
    setSelectedId(id);
  };
  const duplicate = () => {
    const r = duplicateSlide(ed.slides, slide.id, newSlideId);
    if (!r) return;
    ed.change(r.slides);
    select(r.slides[r.index]!.id);
  };
  const remove = () => {
    const r = deleteSlide(ed.slides, slide.id);
    if (!r) return;
    ed.change(r.slides);
    select(r.slides[r.index]!.id);
    setToast({ message: t(r.removed.length > 1 ? 'sl.ed.toast.deletedPair' : 'sl.ed.toast.deleted'), undo: true });
  };
  const move = (dir: -1 | 1) => {
    const r = moveSlide(ed.slides, slide.id, dir);
    if (r) ed.change(r.slides);
  };
  const putBack = () => {
    ed.change(restoreSlide(ed.slides, slide.id, ed.detail.baseSlides));
    setToast({ message: t('sl.ed.toast.restored'), undo: true });
  };
  const setDrawing = (image: DeckSlide['image']) => {
    ed.change(updateSlide(ed.slides, slide.id, { image }));
    setSheet(null);
  };

  const download = async () => {
    setSheet(null);
    setWorking('download');
    const ok = await ed.flush();
    setWorking(null);
    if (!ok) return setNotice(t('sl.ed.downloadFailed'));
    const a = document.createElement('a');
    a.href = deckPptxUrl(deck.id);
    a.download = '';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
  const lessonDeck = deck.origin === 'lesson';
  const packHref = planId ? `/lessons/${encodeURIComponent(planId)}` : lessonDeck ? '/lessons' : `/library/${deck.packId}?tab=slides&lang=${deck.language}`;
  // Rewriting one slide with AI, from the lesson the editor was opened from.
  const ai = useSlidesAi(planId, {
    beforeStart: () => ed.flush(),
    onApplied: () => {
      setSheet(null);
      void ed.loadServer().then(() => setToast({ message: t('pp.ed.aiApplied') }));
    },
  });
  useEffect(() => {
    if (ai.phase === 'ready') setSheet('ai');
  }, [ai.phase]);
  const proposalView = useMemo(
    () => (ai.job?.proposal ? viewOfDeck({ ...deck, id: `proposal-${ai.job.id}`, slides: ai.job.proposal.slides }, mediaUrl) : null),
    [ai.job, deck, mediaUrl]
  );
  const rewriteSlide = () => void ai.start('slide', { slideId: slide.id, deckId: deck.id });
  const startOver = async () => {
    setWorking('reset');
    const ok = await ed.startOver();
    setWorking(null);
    setSheet(null);
    if (!ok) setNotice(t('sl.ed.resetFailed'));
  };
  const deleteCopy = async () => {
    setWorking('delete');
    try {
      await deleteDeck(deck.id);
      clearDraft(window.localStorage, deck.id);
      forgetDecks();
      router.replace(packHref);
    } catch (e) {
      setWorking(null);
      setSheet(null);
      if (deckFailure(e) === 'gone') router.replace(packHref);
      else setNotice(t('sl.ed.deleteFailed'));
    }
  };

  const mcq = (slide.kind === 'check' || slide.kind === 'question') && slide.choices.length > 0;
  const base = baseOf(slide, ed.detail.baseSlides);
  const isChanged = ed.changed.has(slide.id);
  const canPutBack = Boolean(base) && isChanged;
  const drawingHidden = Boolean(slide.image) && !mcq && layout && !layout.picture;
  const thumbMark = (id: string) => (ed.changed.has(id) ? <span className="ml-auto h-2 w-2 shrink-0 self-center rounded-full bg-talaTeal" title={t('sl.ed.changed')} aria-label={t('sl.ed.changed')} /> : undefined);
  const groupName = (g: (typeof groups)[number]) =>
    g.part === 'intro' ? t(lessonDeck ? 'pp.ed.lessonGroup' : 'sl.group.intro') : g.part === 'about' ? t('sl.group.about') : t('sl.group.day', { n: g.day });
  const trouble = ed.state === 'offline' || ed.state === 'error' || ed.state === 'signedOut' || ed.state === 'refused' || ed.state === 'gone' || (ed.state === 'conflict' && conflictLater);

  return (
    <div className="flex min-h-dvh flex-col bg-cream text-forest" style={{ ['--bar-h' as string]: `${barH}px` }}>
      <header ref={bar} className="sticky top-0 z-30 border-b border-hairline bg-white">
        <div className="mx-auto flex w-full max-w-[104rem] items-center gap-1 px-2 py-1.5 wide:gap-2 wide:px-5">
          <Link href={packHref} aria-label={t(planId ? 'pp.ed.backLesson' : 'sl.ed.back')} title={t(planId ? 'pp.ed.backLesson' : 'sl.ed.back')} className="inline-flex h-12 shrink-0 items-center gap-1.5 rounded px-2 font-medium text-talaTeal hover:bg-cream">
            <Icon name="arrowLeft" size={22} />
            <span className="hidden wide:inline">{t(planId ? 'pp.ed.backLessonShort' : 'sl.ed.backShort')}</span>
          </Link>
          <div className="min-w-0 flex-1">
            <p className="kicker hidden items-center gap-1.5 text-talaTeal wide:flex">
              <Icon name="pencil" size={13} strokeWidth={2.2} />
              <span className="truncate">
                {lessonDeck
                  ? [t('pp.madeWithAi'), t('lib.grade', { grade: deck.grade }), deck.subject].filter(Boolean).join(' · ')
                  : `${t('sl.view.mine')} · ${t('lib.grade', { grade: deck.grade })} · ${t('lib.term', { term: deck.term })} · ${t('lib.week', { week: deck.week })}`}
              </span>
            </p>
            <input
              value={ed.title}
              onChange={(e) => ed.setTitle(e.target.value)}
              onBlur={() => {
                if (!ed.title.trim()) ed.setTitle(initial.deck.title);
              }}
              aria-label={t('sl.ed.name')}
              title={t('sl.ed.name')}
              maxLength={DECK_LIMITS.deckTitle}
              className="block w-full min-w-0 truncate rounded border border-transparent bg-transparent px-1 font-display text-body text-forest hover:border-hairline focus:border-talaTeal wide:text-title"
            />
          </div>
          <SaveStatus state={ed.state} />
          <div className="hidden items-center wide:flex">
            <BarIcon icon="undo" label={t('sl.ed.undo')} onClick={ed.undo} disabled={!ed.canUndo} />
            <BarIcon local="redo" label={t('sl.ed.redo')} onClick={ed.redo} disabled={!ed.canRedo} />
          </div>
          <div className="hidden items-center gap-2 wide:flex">
            <Button className="hidden whitespace-nowrap min-[1100px]:inline-flex" onClick={() => void download()} busy={working === 'download'}>
              <Icon name="download" size={20} />
              {t('sl.download')}
            </Button>
            <Button variant="primary" className="whitespace-nowrap" onClick={() => presenter.current?.start(index)}>
              <Icon name="play" size={20} />
              {t('sl.present')}
            </Button>
          </div>
          <BarIcon local="dots" label={t('sl.ed.more')} onClick={() => setSheet('more')} />
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[104rem] flex-col gap-2 px-3 pt-3 empty:hidden wide:px-5">
        {trouble && (
          <Banner
            kind={ed.state === 'gone' || ed.state === 'refused' || ed.state === 'conflict' ? 'error' : 'warn'}
            action={
              ed.state === 'signedOut' ? (
                <LinkButton href="/sign-in" variant="primary">
                  {t('sl.ed.signIn')}
                </LinkButton>
              ) : ed.state === 'gone' ? (
                <LinkButton href="/library">{t('sl.ed.goLibrary')}</LinkButton>
              ) : ed.state === 'refused' ? (
                <Button onClick={ed.undo} disabled={!ed.canUndo}>
                  <Icon name="undo" size={18} />
                  {t('sl.ed.undo')}
                </Button>
              ) : ed.state === 'conflict' ? (
                <Button variant="primary" onClick={() => setConflictLater(false)}>
                  {t('sl.ed.retry')}
                </Button>
              ) : (
                <Button onClick={ed.retry}>{t('sl.ed.retry')}</Button>
              )
            }
          >
            {ed.state === 'offline'
              ? t(ed.kept ? 'sl.ed.status.offlineLong' : 'sl.ed.status.offlineNotKept')
              : ed.state === 'signedOut'
                ? t('sl.ed.status.signedOut')
                : ed.state === 'refused'
                  ? t('sl.ed.status.refused')
                  : ed.state === 'gone'
                    ? t('sl.ed.notFound')
                    : ed.state === 'conflict'
                      ? t('sl.ed.conflict.title')
                      : t('sl.ed.status.errorLong')}
          </Banner>
        )}
        {notice && (
          <Banner kind="warn" action={<Button variant="quiet" onClick={() => setNotice(null)}>{t('common.close')}</Button>}>
            {notice}
          </Banner>
        )}
        {lessonDeck ? null : !ed.detail.original.available ? (
          <Banner kind="info">{t('sl.ed.original.gone')}</Banner>
        ) : ed.detail.original.updated ? (
          <Banner kind="info" action={<LinkButton href={packHref}>{t('sl.ed.original.see')}</LinkButton>}>
            {t('sl.ed.original.updated')}
          </Banner>
        ) : null}
      </div>

      <div className="mx-auto grid w-full max-w-[104rem] flex-1 items-start gap-4 px-3 py-3 wide:grid-cols-[12.5rem_minmax(0,1fr)] wide:px-5 min-[1180px]:grid-cols-[12.5rem_minmax(0,1fr)_23.5rem]">
        {/* Every slide, by day (wide screens) */}
        <nav aria-label={t('sl.ed.slides')} className="sticky hidden self-start wide:block" style={{ top: 'calc(var(--bar-h) + 0.75rem)' }}>
          <div ref={rail} className="-mr-2 flex flex-col gap-1 overflow-y-auto pb-6 pl-1 pr-3 pt-1" style={{ maxHeight: 'calc(100dvh - var(--bar-h) - 1.5rem)' }}>
            {groups.map((g) => (
              <div key={g.key} className="flex flex-col gap-2 pb-2">
                <p className="kicker mt-1 text-forestMuted">{groupName(g)}</p>
                {g.layouts.map((l) => (
                  <SlideThumb key={l.id} view={view} layout={l} onOpen={selectIndex} current={l.id === selectedId} mark={thumbMark(l.id)} />
                ))}
              </div>
            ))}
          </div>
        </nav>

        <div className="flex min-w-0 flex-col gap-3">
          {/* The slide itself; on a phone it stays in view while the fields below are typed in */}
          <div className="sticky z-10 -mx-3 bg-cream px-3 pb-1.5 pt-1 wide:static wide:mx-0 wide:p-0" style={{ top: 'var(--bar-h)' }}>
            <div className="overflow-hidden rounded bg-white p-1 shadow-lift wide:rounded-lg wide:p-2">
              {layout && <SlideView key={slide.id} layout={layout} number={index + 1} mediaUrl={mediaUrl} eager editing={editing} label={slideName(t, layout, total)} />}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button type="button" onClick={() => selectIndex(index - 1)} disabled={index === 0} aria-label={t('sl.ed.prevSlide')} className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white text-forest shadow-card hover:bg-cream disabled:opacity-35">
              <Icon name="chevronLeft" size={24} />
            </button>
            <div className="flex min-w-0 flex-1 flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center">
              <p className="font-semibold tabular-nums">{t('sl.slideOf', { n: index + 1, total })}</p>
              {layout && <p className="text-small text-forestMuted">{[slide.day > 0 ? t('sl.group.day', { n: slide.day }) : null, kindCaption(t, layout)].filter(Boolean).join(' · ')}</p>}
              {isChanged && <StatusChip tone="mine">{t(base ? 'sl.ed.changed' : 'sl.ed.added')}</StatusChip>}
            </div>
            <button type="button" onClick={() => selectIndex(index + 1)} disabled={index === total - 1} aria-label={t('sl.ed.nextSlide')} className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white text-forest shadow-card hover:bg-cream disabled:opacity-35">
              <Icon name="chevronRight" size={24} />
            </button>
          </div>

          {/* Every slide in a row (phones) */}
          <div ref={strip} role="group" aria-label={t('sl.ed.slides')} className="strip -mx-3 flex gap-2 px-3 py-1 wide:hidden">
            {view.layouts.map((l) => (
              <SlideThumb key={l.id} view={view} layout={l} onOpen={selectIndex} current={l.id === selectedId} caption={false} className="w-24 shrink-0" />
            ))}
          </div>

          {!locked && (
            <p className="flex items-start gap-2 text-small text-forestMuted">
              <Icon name="pencil" size={16} className="mt-0.5 text-talaTeal" />
              <span className="hidden wide:inline">{t('sl.ed.hint')}</span>
              <span className="wide:hidden">{t('sl.ed.hintPhone')}</span>
            </p>
          )}

          <div role="group" aria-label={t('sl.ed.op.label')} className="strip -mx-3 flex gap-2 px-3 py-1 wide:mx-0 wide:flex-wrap wide:overflow-visible wide:px-0">
            <Op icon="plus" tone="add" onClick={() => setSheet('add')} disabled={total >= DECK_LIMITS.slides}>
              {t('sl.ed.op.add')}
            </Op>
            <Op icon="copy" onClick={duplicate} disabled={isAnchor(slide) || total >= DECK_LIMITS.slides - 1}>
              {t('sl.ed.op.duplicate')}
            </Op>
            <Op icon="arrowUp" onClick={() => move(-1)} disabled={!canMove(ed.slides, slide.id, -1)}>
              {t('sl.ed.op.up')}
            </Op>
            <Op icon="arrowDown" onClick={() => move(1)} disabled={!canMove(ed.slides, slide.id, 1)}>
              {t('sl.ed.op.down')}
            </Op>
            {/* Cover and day openers always carry a drawing (chosen for them unless the teacher picks one). */}
            {!locked && !mcq && (slide.kind === 'cover' || slide.kind === 'day') && deck.media.length > 0 && (
              <Op icon="image" onClick={() => setSheet('drawing')}>
                {t('sl.ed.op.chooseDrawing')}
              </Op>
            )}
            {!locked && !mcq && slide.kind !== 'cover' && slide.kind !== 'day' && slide.image && (
              <Op icon="image" onClick={() => setDrawing(null)}>
                {t('sl.ed.op.removeDrawing')}
              </Op>
            )}
            {!locked && !mcq && slide.kind !== 'cover' && slide.kind !== 'day' && !slide.image && deck.media.length > 0 && (
              <Op icon="image" onClick={() => setSheet('drawing')}>
                {t('sl.ed.op.addDrawing')}
              </Op>
            )}
            {canPutBack && (
              <Op icon="restore" onClick={putBack}>
                {t('sl.ed.op.restore')}
              </Op>
            )}
            <Op icon="trash" tone="danger" onClick={remove} disabled={!canDelete(ed.slides, slide.id)}>
              {t('sl.ed.op.delete')}
            </Op>
            {planId && !locked && rewritable(slide) && (
              <Button variant="ai" className="shrink-0 whitespace-nowrap" onClick={rewriteSlide} disabled={ai.busy} data-rewrite-slide>
                <Sparkle /> {t('pp.ed.rewriteSlide')}
              </Button>
            )}
          </div>
          {(ai.phase === 'starting' || ai.phase === 'working') && (
            <p role="status" className="flex items-center gap-2 text-small text-forestMuted" data-ai-working>
              <LocalIcon name="spinner" size={16} className="animate-spin" />
              {t('pp.ai.workingSlide')}
              <Button variant="quiet" onClick={() => void ai.discard()}>
                {t('common.cancel')}
              </Button>
            </p>
          )}
          {ai.phase === 'failed' && ai.trouble && (
            <div data-ai-failed={ai.trouble}>
              <Banner
                kind="error"
                action={
                  <span className="flex flex-wrap gap-2">
                    {RETRYABLE.has(ai.trouble) && (
                      <Button variant="primary" onClick={rewriteSlide}>
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
          )}
          {isAnchor(slide) && !locked && (
            <p className="flex items-start gap-2 text-small text-forestMuted">
              <Icon name="lock" size={16} className="mt-0.5" />
              <span>{t(slide.kind === 'cover' ? 'sl.ed.cover' : 'sl.ed.anchor')}</span>
            </p>
          )}
          {drawingHidden && <p className="text-small text-forestMuted">{t('sl.ed.drawing.hidden')}</p>}
          {!deck.sourceApproved && (
            <p className="flex items-start gap-2 text-small text-forestMuted">
              <Icon name="info" size={16} className="mt-0.5" />
              <span>{t('sl.ed.draftSource')}</span>
            </p>
          )}
        </div>

        <aside aria-label={t('sl.ed.onSlide')} className="min-w-0 rounded-lg bg-white p-4 shadow-card wide:col-start-2 min-[1180px]:sticky min-[1180px]:col-start-3 min-[1180px]:row-start-1 min-[1180px]:max-h-[calc(100dvh-var(--bar-h)-1.5rem)] min-[1180px]:overflow-y-auto" style={{ top: 'calc(var(--bar-h) + 0.75rem)' }}>
          <DeckFields
            key={slide.id}
            slide={slide}
            slides={ed.slides}
            layout={layout}
            onPatch={(patch, tag) => ed.change(updateSlide(ed.slides, slide.id, patch), tag)}
            onChoices={(checkId, choices) => ed.change(setChoices(ed.slides, checkId, choices), `choices:${checkId}`)}
            onCorrect={(checkId, i) => ed.change(setCorrectChoice(ed.slides, checkId, i))}
            onGoTo={select}
          />
        </aside>
      </div>

      {/* Phones: the two things a teacher reaches for most stay under the thumb */}
      <div className="sticky bottom-0 z-20 flex gap-2 border-t border-hairline bg-white px-3 py-2 wide:hidden" style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}>
        <Button variant="primary" className="flex-1" onClick={() => presenter.current?.start(index)}>
          <Icon name="play" size={20} />
          {t('sl.present')}
        </Button>
        <Button className="flex-1 whitespace-nowrap" onClick={() => setSheet('add')} disabled={total >= DECK_LIMITS.slides}>
          <Icon name="plus" size={20} />
          {t('sl.ed.op.addShort')}
        </Button>
      </div>

      <Presenter ref={presenter} view={view} onExit={selectIndex} />

      <Sheet open={sheet === 'add'} onClose={() => setSheet(null)} title={t('sl.ed.add.title')}>
        <div className="grid gap-2 min-[480px]:grid-cols-2">
          {ADDABLE_KINDS.map((k) => (
            <button key={k} type="button" onClick={() => add(k)} className="flex min-h-touch items-center gap-3 rounded-lg border border-hairline bg-white p-3 text-left hover:border-talaTeal hover:bg-talaTeal/10">
              <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-talaTeal/15 text-talaTeal">
                <Icon name={ADD_ICON[k]} size={22} />
              </span>
              <span className="min-w-0">
                <span className="block font-semibold">{t(`sl.ed.add.${k}`)}</span>
                <span className="block text-small text-forestMuted">{t(`sl.ed.add.${k}Hint`)}</span>
              </span>
            </button>
          ))}
        </div>
      </Sheet>

      <Sheet open={sheet === 'drawing'} onClose={() => setSheet(null)} title={t('sl.ed.drawing.title')}>
        {deck.media.length === 0 ? (
          <p>{t('sl.ed.drawing.none')}</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 min-[480px]:grid-cols-3">
            {deck.media.map((m) => (
              <button key={m.slug} type="button" onClick={() => setDrawing({ slug: m.slug, alt: m.alt })} className="flex flex-col gap-1 rounded-lg border border-hairline bg-white p-2 text-left hover:border-talaTeal">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={mediaUrl(m.slug)} alt={m.alt} loading="lazy" className="aspect-square w-full object-contain" />
                <span className="line-clamp-2 text-small text-forestMuted">{m.alt}</span>
              </button>
            ))}
          </div>
        )}
      </Sheet>

      <Sheet open={sheet === 'more'} onClose={() => setSheet(null)} title={t('sl.ed.more')}>
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-2 wide:hidden">
            <Button onClick={ed.undo} disabled={!ed.canUndo}>
              <Icon name="undo" size={20} />
              {t('sl.ed.undo')}
            </Button>
            <Button onClick={ed.redo} disabled={!ed.canRedo}>
              <LocalIcon name="redo" size={20} />
              {t('sl.ed.redo')}
            </Button>
          </div>
          <Button full className="min-[1100px]:hidden" onClick={() => void download()} busy={working === 'download'}>
            <Icon name="download" size={20} />
            {t('sl.download')}
          </Button>
          <Button full onClick={() => setSheet('revisions')} data-revisions-open>
            <Icon name="restore" size={20} />
            {t('pp.rev.open')}
          </Button>
          {!lessonDeck && (
            <Button full onClick={() => setSheet('reset')}>
              <Icon name="restore" size={20} />
              {t('sl.ed.reset')}
            </Button>
          )}
          <Button full variant="danger" onClick={() => setSheet('delete')}>
            <Icon name="trash" size={20} />
            {t('sl.ed.delete')}
          </Button>
        </div>
      </Sheet>

      <Sheet
        open={sheet === 'reset'}
        onClose={() => setSheet(null)}
        title={t('sl.ed.resetTitle')}
        actions={
          <>
            <Button onClick={() => setSheet(null)}>{t('common.cancel')}</Button>
            <Button variant="danger" busy={working === 'reset'} onClick={() => void startOver()} disabled={!ed.detail.original.available}>
              {t('sl.ed.resetConfirm')}
            </Button>
          </>
        }
      >
        <p>{t(ed.detail.original.available ? 'sl.ed.resetBody' : 'sl.ed.original.gone')}</p>
      </Sheet>

      <Sheet
        open={sheet === 'delete'}
        onClose={() => setSheet(null)}
        title={t('sl.ed.deleteTitle')}
        actions={
          <>
            <Button onClick={() => setSheet(null)}>{t('common.cancel')}</Button>
            <Button variant="danger" busy={working === 'delete'} onClick={() => void deleteCopy()}>
              {t('sl.ed.deleteConfirm')}
            </Button>
          </>
        }
      >
        <p>{t('sl.ed.deleteBody')}</p>
      </Sheet>

      <Sheet
        open={ed.state === 'conflict' && !conflictLater}
        onClose={() => setConflictLater(true)}
        title={t('sl.ed.conflict.title')}
        actions={
          <>
            <Button
              busy={working === 'conflict'}
              onClick={async () => {
                setWorking('conflict');
                await ed.loadServer();
                setWorking(null);
              }}
            >
              {t('sl.ed.conflict.theirs')}
            </Button>
            <Button variant="primary" onClick={() => void ed.keepMine()}>
              {t('sl.ed.conflict.mine')}
            </Button>
          </>
        }
      >
        <p>{t('sl.ed.conflict.body')}</p>
      </Sheet>

      <Sheet
        open={Boolean(ed.draftOffer)}
        onClose={ed.acceptDraft}
        title={t('sl.ed.draft.title')}
        actions={
          <>
            <Button onClick={ed.discardDraft}>{t('sl.ed.draft.discard')}</Button>
            <Button variant="primary" onClick={ed.acceptDraft}>
              {t('sl.ed.draft.use')}
            </Button>
          </>
        }
      >
        <span className="sr-only">{t('sl.ed.title')}</span>
      </Sheet>

      <RevisionsSheet
        deckId={deck.id}
        open={sheet === 'revisions'}
        onClose={() => setSheet(null)}
        beforeRestore={() => ed.flush()}
        onRestored={() => {
          void ed.loadServer().then(() => setToast({ message: t('pp.rev.restored') }));
        }}
      />
      <AiProposalSheet ai={ai} view={proposalView} scope="slide" replacing={1} open={sheet === 'ai' && (ai.phase === 'ready' || ai.phase === 'applying' || ai.phase === 'conflict')} onClose={() => setSheet(null)} />

      <Toast
        message={toast?.message ?? null}
        onUndo={
          toast?.undo
            ? () => {
                ed.undo();
                setToast(null);
              }
            : undefined
        }
        onDone={() => setToast(null)}
      />
    </div>
  );
}
