'use client';
/**
 * The Slides tab of a pack page, and the small strip of slides a lesson step uses.
 *
 * Two things are kept visibly apart: the **Hiraia original** (shared with every teacher, never changes) and
 * **My copy** (private to the signed-in teacher, editable). Slides are shown by day, each one opens in the carousel,
 * and the deck can be presented full screen or downloaded as PowerPoint from here.
 */
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { packSubjectOf, type PackDetail } from '@hiraia/tala-core/contracts';
import { formatTime, useT } from '@/i18n';
import { useSession } from '@/data/session';
import { fileUrl, previewUrl } from '@/data/packs';
import { createDeck, deckFailure, deckMediaUrl, deckPptxUrl, forgetDecks, packMediaUrl, useDeck, useMyDeck } from '@/data/decks';
import { Callout, Facts, IconBadge, Kicker, Segmented, StatusChip } from '@/components/editorial';
import { Icon } from '@/components/icons';
import { Banner, Button, LinkButton, Placeholder } from '@/components/ui';
import { changedIds, groupSlides, viewOfDeck, viewOfPack, type DeckView, type SlideGroup } from './deck-model';
import { Lightbox } from './Lightbox';
import { Presenter, type PresenterHandle } from './Presenter';
import { SlideThumb } from './SlideThumb';

/** The shared original of a loaded pack, laid out once. */
function packView(detail: PackDetail): DeckView {
  const { packId } = detail.content;
  return viewOfPack(
    detail,
    (slug) => packMediaUrl(packId, slug, detail.language),
    // The Mathematics pilot is shown from its own checked slide pictures (one per slide, in order).
    packSubjectOf(packId) === 'science' ? undefined : (index) => previewUrl(packId, index + 1, detail.language)
  );
}

const GRID = 'grid grid-cols-2 gap-x-3 gap-y-4 min-[560px]:grid-cols-3 min-[1100px]:grid-cols-4';
/** Quiet outlined control that is a link (downloads). */
const OUTLINE = 'inline-flex min-h-touch items-center justify-center gap-2 rounded border border-forest bg-white px-4 py-2 font-medium text-forest hover:bg-cream';

function GroupHeading({ group }: { group: SlideGroup }) {
  const { t } = useT();
  const name = group.part === 'intro' ? t('sl.group.intro') : group.part === 'about' ? t('sl.group.about') : t('sl.group.day', { n: group.day });
  return (
    <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-t border-hairline pt-4">
      <h3 className="kicker text-talaTeal">{name}</h3>
      {group.part === 'day' && group.title && <p className="min-w-0 break-words font-display text-title text-forest">{group.title}</p>}
      <p className="ml-auto text-small text-forestMuted">{group.layouts.length === 1 ? t('sl.countOne') : t('sl.count', { n: group.layouts.length })}</p>
    </div>
  );
}

function SlideGroups({ view, onOpen, changed }: { view: DeckView; onOpen: (index: number) => void; changed?: Set<string> }) {
  const { t } = useT();
  const groups = useMemo(() => groupSlides(view.layouts), [view.layouts]);
  return (
    <div className="flex flex-col gap-6">
      {groups.map((g) => (
        <section key={g.key} aria-label={g.part === 'day' ? `${t('sl.group.day', { n: g.day })}${g.title ? `: ${g.title}` : ''}` : g.part === 'intro' ? t('sl.group.intro') : t('sl.group.about')}>
          <GroupHeading group={g} />
          <div className={GRID}>
            {g.layouts.map((l) => (
              <SlideThumb
                key={l.id}
                view={view}
                layout={l}
                onOpen={onOpen}
                mark={
                  changed?.has(l.id) ? (
                    <span className="ml-auto inline-flex shrink-0 items-center gap-1 font-medium text-talaTeal">
                      <Icon name="pencil" size={13} strokeWidth={2.1} />
                      {t('sl.ed.changed')}
                    </span>
                  ) : undefined
                }
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export function PackSlidesTab({ detail, initialSlideId }: { detail: PackDetail; initialSlideId?: string | null }) {
  const { t, lang: uiLang } = useT();
  const { status } = useSession();
  const router = useRouter();
  const packId = detail.content.packId;
  const lang = detail.language;
  /** Only Science decks can be copied and edited in Tala; the Mathematics pilot offers its PowerPoint file. */
  const copyable = packSubjectOf(packId) === 'science';
  const variant = detail.entry.variants[lang];
  const file = variant.files.find((f) => f.kind === 'slides') ?? null;
  const original = useMemo(() => packView(detail), [detail]);
  const [which, setWhich] = useState<'original' | 'mine'>('original');
  const [open, setOpen] = useState<{ which: 'original' | 'mine'; index: number } | null>(null);
  const [making, setMaking] = useState(false);
  const [makeError, setMakeError] = useState<string | null>(null);
  const presentOriginal = useRef<PresenterHandle>(null);
  const presentMine = useRef<PresenterHandle>(null);

  const mine = useMyDeck(copyable ? packId : '', lang);
  const mineId = mine.summary?.id ?? null;
  const deck = useDeck(which === 'mine' ? mineId : null);
  const mineUrl = useCallback((slug: string) => (mineId ? deckMediaUrl(mineId, slug) : ''), [mineId]);
  const mineView = useMemo(() => (deck.detail ? viewOfDeck(deck.detail.deck, mineUrl, { stamp: deck.detail.deck.rev, baseSlides: deck.detail.baseSlides }) : null), [deck.detail, mineUrl]);
  const mineChanged = useMemo(() => (deck.detail ? changedIds(deck.detail.deck.slides, deck.detail.baseSlides) : undefined), [deck.detail]);

  // A link straight to one slide (from a lesson step) opens the carousel on it.
  useEffect(() => {
    if (!initialSlideId) return;
    const i = original.layouts.findIndex((l) => l.id === initialSlideId);
    if (i >= 0) setOpen({ which: 'original', index: i });
  }, [initialSlideId, original]);

  const edit = async (slideId?: string) => {
    const suffix = slideId ? `?slide=${encodeURIComponent(slideId)}` : '';
    if (mineId) return router.push(`/slides/${mineId}${suffix}`);
    setMaking(true);
    setMakeError(null);
    try {
      const made = await createDeck(packId, lang);
      forgetDecks();
      router.push(`/slides/${made.deck.id}${suffix}`);
    } catch (e) {
      setMakeError(t(deckFailure(e) === 'offline' ? 'sl.mine.offline' : 'sl.mine.createFailed'));
      setMaking(false);
    }
  };

  const signedIn = status === 'signedIn';
  const mb = (bytes: number) => (bytes / 1_048_576).toFixed(1);
  const editControl = signedIn ? (
    <Button variant="primary" busy={making} onClick={() => void edit()}>
      <Icon name="pencil" size={20} />
      {making ? t('sl.mine.making') : t(mineId ? 'sl.editContinue' : 'sl.edit')}
    </Button>
  ) : (
    <LinkButton href="/sign-in" variant="primary">
      <Icon name="pencil" size={20} />
      {t('sl.signInToEdit')}
    </LinkButton>
  );
  const lightboxView = open ? (open.which === 'mine' ? mineView : original) : null;
  const openSlideId = open && lightboxView ? lightboxView.layouts[Math.min(open.index, lightboxView.layouts.length - 1)]?.id : undefined;
  const changedCount = mine.summary?.changedSlides ?? 0;

  return (
    <section className="flex flex-col gap-5" aria-label={t('lib.pack.tab.slides')}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Kicker icon="slides">{t('sl.kicker')}</Kicker>
          {!original.approved && <StatusChip tone="draft">{t('sl.draft')}</StatusChip>}
        </div>
        {copyable && (
          <Segmented
            label={t('sl.view.label')}
            value={which}
            onChange={setWhich}
            className="self-start"
            options={[
              { value: 'original', label: t('sl.view.original'), icon: 'slides' },
              { value: 'mine', label: t('sl.view.mine'), icon: 'pencil' },
            ]}
          />
        )}
      </div>
      {makeError && <Banner kind="error">{makeError}</Banner>}

      {which === 'original' ? (
        <>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => presentOriginal.current?.start(0)}>
              <Icon name="play" size={20} />
              {t('sl.present')}
            </Button>
            {file && (
              <a href={fileUrl(packId, 'slides', lang)} download className={OUTLINE}>
                <Icon name="download" size={20} />
                {t('sl.downloadSize', { size: mb(file.bytes) })}
              </a>
            )}
            {copyable && editControl}
          </div>
          <Callout tint="teal" icon="info">
            <p className="max-w-measure">{t(copyable ? 'sl.original.note' : 'sl.pilot.note')}</p>
          </Callout>
          {!file && <p className="text-small text-forestMuted">{t('sl.notBuilt')}</p>}
          <SlideGroups view={original} onOpen={(index) => setOpen({ which: 'original', index })} />
          <p className="flex items-start gap-2 text-small text-forestMuted">
            <Icon name="notes" size={16} className="mt-0.5" />
            <span>{t('sl.notesHint')}</span>
          </p>
        </>
      ) : signedIn && !mineId && mine.loading ? (
        <Placeholder rows={3} />
      ) : !signedIn || !mineId ? (
        <div className="grid gap-6 overflow-hidden rounded-xl bg-talaTeal/10 p-5 wide:grid-cols-[minmax(0,1fr)_minmax(0,20rem)] wide:items-center wide:p-8">
          <div className="flex flex-col items-start gap-3">
            <IconBadge name="pencil" tint="teal" size={48} />
            <h3 className="font-display text-headline text-forest">{t('sl.mine.inviteTitle')}</h3>
            <p className="max-w-measure text-read">{t('sl.mine.inviteBody')}</p>
            <div className="mt-1">
              {signedIn ? (
                <Button variant="primary" busy={making} onClick={() => void edit()}>
                  <Icon name="pencil" size={20} />
                  {making ? t('sl.mine.making') : t('sl.mine.make')}
                </Button>
              ) : (
                editControl
              )}
            </div>
            {mine.failed && <p className="text-small text-brick">{t('sl.mine.loadFailed')}</p>}
          </div>
          {/* Hiraia spot drawing (decoration): ink on the tinted block, like print on paper. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/art/my-copy.webp" alt="" width={1000} height={667} loading="lazy" decoding="async" className="ink order-first mx-auto h-auto w-full max-w-[15rem] wide:order-none wide:max-w-[20rem]" />
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-3 rounded-xl bg-talaTeal/10 p-4 wide:p-5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h3 className="min-w-0 break-words font-display text-title text-forest">{mine.summary?.title ?? detail.content.title}</h3>
              <StatusChip tone="mine" icon="lock">
                {t('sl.view.mine')}
              </StatusChip>
            </div>
            {mine.summary && (
              <Facts
                className="text-forest"
                items={[
                  { icon: 'pencil', text: changedCount === 0 ? t('sl.mine.unchanged') : changedCount === 1 ? t('sl.mine.changedOne') : t('sl.mine.changed', { n: changedCount }) },
                  { icon: 'clock', text: t('sl.mine.saved', { when: formatTime(mine.summary.updatedAt, uiLang) }) },
                  { icon: 'lock', text: t('sl.mine.private') },
                ]}
              />
            )}
            <div className="flex flex-wrap gap-2">
              {editControl}
              <Button onClick={() => presentMine.current?.start(0)} disabled={!mineView}>
                <Icon name="play" size={20} />
                {t('sl.present')}
              </Button>
              {mineId && (
                <a href={deckPptxUrl(mineId)} download className={OUTLINE}>
                  <Icon name="download" size={20} />
                  {t('sl.mine.downloadMine')}
                </a>
              )}
            </div>
          </div>
          {deck.failed ? (
            <Banner kind="warn" action={<Button onClick={() => void deck.reload()}>{t('sl.ed.retry')}</Button>}>
              {t('sl.mine.loadFailed')}
            </Banner>
          ) : mineView ? (
            <SlideGroups view={mineView} changed={mineChanged} onOpen={(index) => setOpen({ which: 'mine', index })} />
          ) : (
            <Placeholder rows={4} />
          )}
        </>
      )}

      {open && lightboxView && (
        <Lightbox
          view={lightboxView}
          index={open.index}
          onIndex={(index) => setOpen((o) => (o ? { ...o, index } : o))}
          onClose={() => setOpen(null)}
          action={
            signedIn && copyable ? (
              <button
                type="button"
                onClick={() => void edit(openSlideId)}
                disabled={making}
                className="inline-flex min-h-touch min-w-0 flex-1 items-center justify-center gap-2 rounded bg-yellow px-3 font-semibold leading-tight text-forest hover:brightness-95 disabled:opacity-60 wide:flex-none max-[839px]:basis-full"
              >
                <Icon name="pencil" size={20} />
                <span className="whitespace-nowrap">{t('sl.edit')}</span>
              </button>
            ) : undefined
          }
        />
      )}
      <Presenter ref={presentOriginal} view={original} />
      {mineView && <Presenter ref={presentMine} view={mineView} />}
    </section>
  );
}

/**
 * The slides one part of a lesson uses, as a short row of pictures inside the lesson plan. Tapping one opens the
 * carousel on that slide (with the whole deck behind it).
 */
export function SlideStrip({ detail, slideIds, label }: { detail: PackDetail; slideIds: string[]; label?: string }) {
  const { t } = useT();
  const view = useMemo(() => packView(detail), [detail]);
  const layouts = useMemo(() => slideIds.map((id) => view.layouts.find((l) => l.id === id)).filter((l): l is NonNullable<typeof l> => Boolean(l)), [slideIds, view]);
  const [open, setOpen] = useState<number | null>(null);
  if (!layouts.length) return null;
  return (
    <div className="min-w-0">
      {label && <p className="kicker mb-1.5 text-forestMuted">{label}</p>}
      <div className="strip -mx-1 flex gap-2.5 px-1 py-1" role="group" aria-label={label ?? t('sl.stripLabel')}>
        {layouts.map((l) => (
          <SlideThumb key={l.id} view={view} layout={l} onOpen={setOpen} caption={false} className="w-[9.5rem] shrink-0" />
        ))}
      </div>
      {open !== null && <Lightbox view={view} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />}
    </div>
  );
}
