'use client';
/**
 * Editing a teacher's own uploaded PowerPoint file.
 *
 * What she can do here, and nothing more: change the words of any text on a slide (title, text boxes, table cells),
 * write or change her notes, reorder, copy and remove slides, undo, and download the file with her changes written
 * in (or the untouched file she uploaded). What Tala does NOT do is redraw her design: fonts, colours, pictures,
 * charts, diagrams and animations stay exactly as they are in the file, and the screen says so.
 *
 * The picture of a slide is drawn by the server only where it is set up to (it is the real slide, not an
 * imitation); elsewhere the slide is shown as its text boxes in their places. Either way the words are edited in
 * plain fields, which is also what works on a phone.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { UPLOAD_LIMITS } from '@hiraia/tala-core/contracts';
import type { UploadedDeck } from '@hiraia/tala-core/contracts';
import { useT } from '@/i18n';
import type { StringKey } from '@/i18n';
import { useSession } from '@/data/session';
import { deleteUpload, renderUpload, uploadFailure, uploadOriginalUrl, uploadPptxUrl, uploadPreviewUrl, useUpload } from '@/data/uploads';
import { StatusChip } from '@/components/editorial';
import { Icon, type IconName } from '@/components/icons';
import { Banner, Button, LinkButton, Placeholder, Sheet, Toast, cx } from '@/components/ui';
import { LocalIcon } from './local-icons';
import {
  bringBack,
  canMove,
  canRemove,
  clearUploadDraft,
  copyBlocker,
  copySlide,
  keptFeatures,
  moveSlide,
  newCopyId,
  notesToText,
  removedSlides,
  removeSlide,
  restoreSlide,
  setBlockText,
  setNotes,
  slidesView,
  textToNotes,
  type UploadSlideView,
} from './upload-model';
import { useUploadEditor, type UploadEditor as Editor } from './useUploadEditor';
import type { SaveState } from './useDeckEditor';

export function UploadEditorScreen({ uploadId }: { uploadId: string }) {
  const { t } = useT();
  const { status } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (status === 'signedOut') router.replace('/sign-in');
  }, [status, router]);
  const upload = useUpload(status === 'signedIn' ? uploadId : null);
  if (upload.deck) return <UploadEditor key={upload.deck.id} initial={upload.deck} />;
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[40rem] flex-col justify-center gap-4 px-4 py-10">
      {status !== 'signedIn' || upload.loading || !upload.failed ? (
        <Placeholder rows={5} />
      ) : (
        <>
          <Banner kind="warn">{t(upload.failed === 'gone' ? 'up.ed.notFound' : 'up.ed.loadFailed')}</Banner>
          {upload.failed !== 'gone' && (
            <Button variant="primary" onClick={() => void upload.reload()}>
              {t('common.retry')}
            </Button>
          )}
          <LinkButton href="/library/mine">{t('up.ed.back')}</LinkButton>
        </>
      )}
    </main>
  );
}

function SaveStatus({ state }: { state: SaveState }) {
  const { t } = useT();
  const ok = state === 'saved';
  const busy = state === 'saving' || state === 'dirty';
  const text = ok ? t('sl.ed.status.saved') : state === 'saving' ? t('sl.ed.status.saving') : state === 'dirty' ? t('sl.ed.status.dirty') : state === 'offline' ? t('sl.ed.status.offline') : t('sl.ed.status.error');
  return (
    <p
      role="status"
      aria-live="polite"
      data-save-state={state}
      className={cx('inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1.5 text-small font-medium leading-none', ok ? 'bg-sage/30 text-forest' : busy ? 'bg-forest/10 text-forestMuted' : 'bg-brick/10 text-brick')}
    >
      {ok ? <Icon name="check" size={15} strokeWidth={2.4} /> : busy ? <LocalIcon name="spinner" size={15} className="animate-spin" /> : state === 'offline' ? <LocalIcon name="cloudOff" size={15} /> : <Icon name="alert" size={15} />}
      <span className="whitespace-nowrap">{text}</span>
    </p>
  );
}

function Op({ op, icon, children, onClick, disabled, tone, title }: { op: string; icon: IconName; children: ReactNode; onClick: () => void; disabled?: boolean; tone?: 'danger'; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      data-op={op}
      className={cx(
        'inline-flex min-h-touch shrink-0 items-center gap-2 rounded border border-hairline bg-white px-3 font-medium disabled:cursor-not-allowed disabled:opacity-40',
        tone === 'danger' ? 'text-brick hover:bg-brick/10' : 'text-forest hover:bg-cream'
      )}
    >
      <Icon name={icon} size={19} />
      <span className="whitespace-nowrap">{children}</span>
    </button>
  );
}

const fieldId = (slideId: string, blockId: string, line: number) => `uf-${slideId}-${blockId}-${line}`;

/** Pictures are redrawn unasked this long after a save, while she is not typing… */
const AUTO_DRAW_AFTER_MS = 2500;
/** …but only for a file that draws quickly; a slow one is redrawn when she asks. */
const AUTO_DRAW_MAX_MS = 8000;
/** After the server says it is busy drawing, wait this long; after a few such answers in a row, stop asking unasked. */
const AUTO_DRAW_BUSY_MS = 6000;
const AUTO_DRAW_BUSY_TRIES = 5;

/** A text area that is as tall as its words. */
function GrowingText({ id, value, onChange, label, placeholder, rows = 1, className }: { id?: string; value: string; onChange: (v: string) => void; label: string; placeholder?: string; rows?: number; className?: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      id={id}
      value={value}
      rows={rows}
      aria-label={label}
      placeholder={placeholder}
      maxLength={UPLOAD_LIMITS.paragraphChars}
      onChange={(e) => onChange(e.target.value)}
      spellCheck
      className={cx('block w-full resize-none overflow-hidden rounded border border-hairline bg-white px-3 py-2 text-body leading-snug text-forest focus:border-talaTeal', className)}
    />
  );
}

/** One slide: the server's picture when there is one, else its text boxes in their places. Editable text can be clicked. */
function SlidePicture({ deck, slide, number, previewRev, hasPicture, onPick }: { deck: UploadedDeck; slide: UploadSlideView; number: number; previewRev: number | null; hasPicture: boolean; onPick: (blockId: string) => void }) {
  const { t } = useT();
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [slide.id, previewRev]);
  const picture = hasPicture && !broken;
  const roleLabel = (b: UploadSlideView['blocks'][number]) => `${t(`up.ed.role.${b.role}` as StringKey)}${b.role === 'cell' || b.role === 'text' ? ` (${b.name})` : ''}`;
  return (
    <div className="relative w-full select-none overflow-hidden bg-white" style={{ aspectRatio: `${deck.size.cx} / ${deck.size.cy}` }} data-slide-id={slide.id} data-has-picture={picture ? 'yes' : 'no'}>
      {picture && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={uploadPreviewUrl(deck.id, slide.id, previewRev)} alt={t('up.ed.picture.alt', { n: number })} draggable={false} onError={() => setBroken(true)} className="absolute inset-0 h-full w-full" />
      )}
      {slide.blocks.map((b) => {
        if (!b.box) return null;
        const style = { left: `${b.box.x * 100}%`, top: `${b.box.y * 100}%`, width: `${b.box.w * 100}%`, height: `${b.box.h * 100}%` };
        const words = b.paragraphs.join(' ').trim();
        return (
          <button
            key={b.id}
            type="button"
            disabled={!b.editable}
            onClick={() => onPick(b.id)}
            aria-label={t('up.ed.picture.box', { label: `${roleLabel(b)}${words ? `: ${words.slice(0, 80)}` : ''}` })}
            title={b.editable ? t('up.ed.picture.box', { label: roleLabel(b) }) : t('up.ed.readOnly')}
            data-block={b.id}
            className={cx(
              'absolute overflow-hidden rounded-sm text-left outline-2 outline-offset-1',
              b.editable ? 'cursor-text hover:outline-dashed hover:outline-talaTeal focus-visible:outline focus-visible:outline-talaTeal' : 'cursor-default',
              !picture && 'border border-dashed border-forest/40 bg-cream/60 p-[2%]',
              b.changed && picture && 'outline-dashed outline-talaTeal/60'
            )}
            style={style}
          >
            {!picture && (
              <span className={cx('block overflow-hidden text-forest', b.role === 'title' ? 'font-display font-semibold' : '')} style={{ fontSize: 'clamp(8px, 1.6cqw, 18px)', lineHeight: 1.25 }}>
                {b.paragraphs.map((p, i) => (
                  <span key={i} className="block whitespace-pre-wrap break-words">
                    {p || ' '}
                  </span>
                ))}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function BlockFields({ slide, block, onChange }: { slide: UploadSlideView; block: UploadSlideView['blocks'][number]; onChange: (paragraphs: string[]) => void }) {
  const { t } = useT();
  const label = `${t(`up.ed.role.${block.role}` as StringKey)}${block.role === 'cell' ? ` · ${block.name.replace(/^.*\s(R\d+C\d+)$/, '$1')}` : ''}`;
  const set = (i: number, v: string) => onChange(block.paragraphs.map((p, k) => (k === i ? v : p)));
  return (
    <div className="flex flex-col gap-1.5" data-block-fields={block.id}>
      <p className="flex flex-wrap items-center gap-2 text-small font-semibold text-forestMuted">
        {label}
        {block.changed && <StatusChip tone="mine">{t('up.ed.blockChanged')}</StatusChip>}
      </p>
      {!block.editable ? (
        <div className="rounded border border-hairline bg-cream/50 px-3 py-2 text-forestMuted">
          <p className="whitespace-pre-wrap break-words">{block.paragraphs.join('\n')}</p>
          <p className="mt-1 flex items-start gap-1.5 text-small">
            <Icon name="lock" size={14} className="mt-0.5 shrink-0" />
            {t('up.ed.readOnly')}
          </p>
        </div>
      ) : (
        <>
          {block.paragraphs.map((p, i) => (
            <div key={i} className="flex items-start gap-1.5">
              <GrowingText id={fieldId(slide.id, block.id, i)} value={p} onChange={(v) => set(i, v)} label={t('up.ed.paragraph', { label, n: i + 1 })} />
              {block.paragraphs.length > 1 && (
                <button type="button" onClick={() => onChange(block.paragraphs.filter((_p, k) => k !== i))} aria-label={t('up.ed.removeLine')} title={t('up.ed.removeLine')} className="inline-flex h-11 w-9 shrink-0 items-center justify-center rounded text-forestMuted hover:bg-cream hover:text-brick">
                  <Icon name="x" size={18} />
                </button>
              )}
            </div>
          ))}
          {block.role !== 'title' && block.paragraphs.length < UPLOAD_LIMITS.paragraphsPerBlock && (
            <button type="button" onClick={() => onChange([...block.paragraphs, ''])} data-add-line className="inline-flex min-h-touch items-center gap-1.5 self-start rounded px-1 text-small font-medium text-talaTeal hover:bg-talaTeal/10">
              <Icon name="plus" size={16} />
              {t('up.ed.addLine')}
            </button>
          )}
        </>
      )}
    </div>
  );
}

function UploadEditor({ initial }: { initial: UploadedDeck }) {
  const { t } = useT();
  const router = useRouter();
  const ed: Editor = useUploadEditor(initial);
  const deck = ed.deck;
  const base = deck.base;
  const slides = useMemo(() => slidesView(base, ed.edits), [base, ed.edits]);
  const total = slides.length;

  const [selectedId, setSelectedId] = useState(() => initial.edits.slides[0]!.id);
  const lastIndex = useRef(0);
  const index = Math.max(0, slides.findIndex((s) => s.id === selectedId));
  const slide = slides[index]!;
  useEffect(() => {
    if (slides.some((s) => s.id === selectedId)) lastIndex.current = slides.findIndex((s) => s.id === selectedId);
    else setSelectedId(slides[Math.min(lastIndex.current, slides.length - 1)]!.id);
  }, [slides, selectedId]);
  const select = useCallback((i: number) => setSelectedId(slides[Math.max(0, Math.min(i, slides.length - 1))]!.id), [slides]);

  type SheetName = 'kept' | 'download' | 'more' | 'delete';
  const [sheet, setSheet] = useState<SheetName | null>(null);
  // One sheet can lead to another (More → Delete). The first one's own closing must not close the second.
  const closing = (name: SheetName) => () => setSheet((s) => (s === name ? null : s));
  const [toast, setToast] = useState<{ message: string; undo?: boolean } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [working, setWorking] = useState<'download' | 'delete' | 'conflict' | null>(null);
  const [conflictLater, setConflictLater] = useState(false);
  useEffect(() => {
    if (ed.state !== 'conflict') setConflictLater(false);
  }, [ed.state]);

  /* ---- pictures of the slides (only where the server draws them) ---- */
  const [previews, setPreviews] = useState(initial.previews);
  const [drawing, setDrawing] = useState<'idle' | 'busy' | 'failed'>('idle');
  /** How the last drawing went: decides whether the next one happens unasked. */
  const pace = useRef({ lastMs: 0, waitUntil: 0, busyInARow: 0 });
  const refreshPictures = useCallback(async () => {
    if (!previews.available) return;
    setDrawing('busy');
    const saved = await ed.flush();
    if (!saved) return setDrawing('idle');
    const started = Date.now();
    try {
      const r = await renderUpload(deck.id);
      if (r.state === 'ready') {
        pace.current = { lastMs: Date.now() - started, waitUntil: 0, busyInARow: 0 };
        setPreviews({ available: true, rev: r.rev, slideIds: r.slideIds });
      } else if (r.state === 'busy') pace.current = { ...pace.current, waitUntil: Date.now() + AUTO_DRAW_BUSY_MS, busyInARow: pace.current.busyInARow + 1 };
      // The server draws no pictures (any more): stop asking, and show the words in their boxes instead.
      else if (r.state === 'unavailable') setPreviews((p) => ({ ...p, available: false }));
      setDrawing(r.state === 'failed' ? 'failed' : 'idle');
    } catch {
      setDrawing('failed');
    }
  }, [deck.id, ed, previews.available]);
  const drewOnce = useRef(false);
  useEffect(() => {
    if (drewOnce.current || !initial.previews.available) return;
    drewOnce.current = true;
    if (initial.previews.rev !== initial.rev) void refreshPictures();
  }, [initial, refreshPictures]);
  // The picture follows the words by itself: a little after a save, while she is not typing.
  const redraw = useRef(refreshPictures);
  redraw.current = refreshPictures;
  useEffect(() => {
    if (!previews.available || drawing !== 'idle' || ed.state !== 'saved' || previews.rev === ed.rev) return;
    if (pace.current.lastMs > AUTO_DRAW_MAX_MS || pace.current.busyInARow >= AUTO_DRAW_BUSY_TRIES) return;
    const timer = setTimeout(() => void redraw.current(), Math.max(AUTO_DRAW_AFTER_MS, pace.current.waitUntil - Date.now()));
    return () => clearTimeout(timer);
  }, [previews.available, previews.rev, ed.rev, ed.state, drawing]);
  // Where the server cannot draw, a stored picture is shown only while it still shows her words: an older one could
  // not be refreshed, so the boxes (which always show her words) take its place.
  const picturesCurrent = previews.rev !== null && previews.rev === ed.rev && ed.state === 'saved';
  const pictured = useMemo(() => new Set(previews.available || picturesCurrent ? previews.slideIds : []), [previews.available, picturesCurrent, previews.slideIds]);
  const picturesBehind = previews.available && previews.rev !== null && (previews.rev !== ed.rev || ed.state !== 'saved');

  // Ctrl/⌘+Z outside a text box undoes slide changes.
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

  const focusBlock = (blockId: string) => {
    const el = document.getElementById(fieldId(slide.id, blockId, 0));
    el?.scrollIntoView({ block: 'center' });
    el?.focus({ preventScroll: true });
  };

  /* ---- slide operations ---- */
  const move = (dir: -1 | 1) => {
    const r = moveSlide(ed.edits, slide.id, dir);
    if (r) ed.change(r.edits);
  };
  const copy = () => {
    const id = newCopyId(ed.edits.map((e) => e.id));
    const r = copySlide(base, ed.edits, slide.id, id);
    if (!r) return;
    ed.change(r.edits);
    setSelectedId(id);
  };
  const remove = () => {
    const r = removeSlide(ed.edits, slide.id);
    if (!r) return;
    ed.change(r.edits);
    setSelectedId(r.edits[r.index]!.id);
    setToast({ message: t('up.ed.toast.removed'), undo: true });
  };
  const putBack = () => {
    ed.change(restoreSlide(ed.edits, slide.id));
    setToast({ message: t('up.ed.toast.restored'), undo: true });
  };

  const startDownload = (href: string) => {
    const a = document.createElement('a');
    a.href = href;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
  const downloadMine = async () => {
    setWorking('download');
    const ok = await ed.flush();
    setWorking(null);
    setSheet(null);
    if (!ok) return setNotice(t('up.ed.downloadFailed'));
    startDownload(uploadPptxUrl(deck.id));
  };
  const remove_ = async () => {
    setWorking('delete');
    try {
      await deleteUpload(deck.id);
      clearUploadDraft(window.localStorage, deck.id);
      router.replace('/library/mine');
    } catch (e) {
      setWorking(null);
      setSheet(null);
      if (uploadFailure(e) === 'gone') router.replace('/library/mine');
      else setNotice(t('up.ed.deleteFailed'));
    }
  };

  const kept = useMemo(() => keptFeatures(base), [base]);
  const gone = useMemo(() => removedSlides(base, ed.edits), [base, ed.edits]);
  const blocked = copyBlocker(base, ed.edits, slide.id);
  const onSlide = useMemo(() => {
    const counts = new Map<string, number>();
    for (const o of slide.source.objects) counts.set(o.kind, (counts.get(o.kind) ?? 0) + 1);
    if (slide.source.animations) counts.set('animation', 1);
    if (slide.source.transition) counts.set('transition', 1);
    return [...counts.entries()];
  }, [slide.source]);
  const trouble = ed.state === 'offline' || ed.state === 'error' || ed.state === 'signedOut' || ed.state === 'refused' || ed.state === 'gone' || (ed.state === 'conflict' && conflictLater);
  const slideLabel = (s: UploadSlideView, i: number) => s.title || t('up.ed.untitled', { n: i + 1 });

  return (
    <div className="flex min-h-dvh flex-col bg-cream text-forest">
      <header className="sticky top-0 z-30 border-b border-hairline bg-white">
        <div className="mx-auto flex w-full max-w-[104rem] items-center gap-1 px-2 py-1.5 wide:gap-2 wide:px-5">
          <Link href="/library/mine" aria-label={t('up.ed.back')} title={t('up.ed.back')} className="inline-flex h-12 shrink-0 items-center gap-1.5 rounded px-2 font-medium text-talaTeal hover:bg-cream">
            <Icon name="arrowLeft" size={22} />
            <span className="hidden wide:inline">{t('up.ed.backShort')}</span>
          </Link>
          <div className="min-w-0 flex-1">
            <p className="kicker hidden items-center gap-1.5 text-talaTeal wide:flex">
              <Icon name="lock" size={13} strokeWidth={2.2} />
              <span className="truncate">{t('up.ed.kicker', { file: deck.fileName })}</span>
            </p>
            <input
              value={ed.title}
              onChange={(e) => ed.setTitle(e.target.value)}
              onBlur={() => {
                if (!ed.title.trim()) ed.setTitle(initial.title);
              }}
              aria-label={t('up.ed.name')}
              title={t('up.ed.name')}
              maxLength={UPLOAD_LIMITS.title}
              className="block w-full min-w-0 truncate rounded border border-transparent bg-transparent px-1 font-display text-body text-forest hover:border-hairline focus:border-talaTeal wide:text-title"
            />
          </div>
          <SaveStatus state={ed.state} />
          <div className="hidden items-center wide:flex">
            <button type="button" onClick={ed.undo} disabled={!ed.canUndo} aria-label={t('sl.ed.undo')} title={t('sl.ed.undo')} className="inline-flex h-12 w-12 items-center justify-center rounded text-forest hover:bg-cream disabled:opacity-35">
              <Icon name="undo" size={22} />
            </button>
            <button type="button" onClick={ed.redo} disabled={!ed.canRedo} aria-label={t('sl.ed.redo')} title={t('sl.ed.redo')} className="inline-flex h-12 w-12 items-center justify-center rounded text-forest hover:bg-cream disabled:opacity-35">
              <LocalIcon name="redo" size={22} />
            </button>
          </div>
          <Button variant="primary" className="whitespace-nowrap" onClick={() => setSheet('download')} aria-label={t('up.ed.download')} title={t('up.ed.download')} data-open-download>
            <Icon name="download" size={20} />
            <span className="hidden min-[520px]:inline">{t('up.ed.download')}</span>
          </Button>
          <button type="button" onClick={() => setSheet('more')} aria-label={t('sl.ed.more')} title={t('sl.ed.more')} data-open-more className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded text-forest hover:bg-cream">
            <LocalIcon name="dots" size={22} />
          </button>
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
                <LinkButton href="/library/mine">{t('up.ed.back')}</LinkButton>
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
                    ? t('up.ed.notFound')
                    : ed.state === 'conflict'
                      ? t('up.ed.conflict.title')
                      : t('sl.ed.status.errorLong')}
          </Banner>
        )}
        {notice && (
          <Banner kind="warn" action={<Button variant="quiet" onClick={() => setNotice(null)}>{t('common.close')}</Button>}>
            {notice}
          </Banner>
        )}
        <Banner kind="info" action={<Button variant="quiet" onClick={() => setSheet('kept')} data-kept-more>{t('up.kept.more')}</Button>}>
          <span data-kept-summary>
            {t('up.kept.summary', { slides: base.totals.slides, blocks: base.totals.editableBlocks })} {t('up.ed.wordsHint')}
          </span>
        </Banner>
      </div>

      <div className="mx-auto grid w-full max-w-[104rem] flex-1 items-start gap-4 px-3 py-3 wide:grid-cols-[13rem_minmax(0,1fr)] wide:px-5 min-[1180px]:grid-cols-[13rem_minmax(0,1fr)_24rem]">
        {/* Every slide (wide screens) */}
        <nav aria-label={t('up.ed.slides')} className="sticky top-[4.5rem] hidden max-h-[calc(100dvh-5.5rem)] flex-col gap-2 self-start overflow-y-auto pb-6 pr-2 wide:flex">
          {slides.map((s, i) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSelectedId(s.id)}
              aria-current={s.id === slide.id ? 'true' : undefined}
              data-slide-thumb={s.id}
              className={cx('flex flex-col gap-1 rounded-lg border-2 bg-white p-1.5 text-left hover:border-talaTeal/60', s.id === slide.id ? 'border-talaTeal' : 'border-transparent shadow-card')}
            >
              {pictured.has(s.id) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={uploadPreviewUrl(deck.id, s.id, previews.rev)} alt="" loading="lazy" className="w-full rounded-sm bg-white" style={{ aspectRatio: `${deck.size.cx} / ${deck.size.cy}` }} />
              ) : (
                <span className="flex w-full items-center justify-center rounded-sm bg-cream/70 px-2 text-center text-small text-forestMuted" style={{ aspectRatio: `${deck.size.cx} / ${deck.size.cy}` }}>
                  <span className="line-clamp-3 break-words">{slideLabel(s, i)}</span>
                </span>
              )}
              <span className="flex items-center gap-1.5 px-0.5 text-small">
                <span className="font-semibold tabular-nums">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate text-forestMuted">{slideLabel(s, i)}</span>
                {s.changed && <span className="h-2 w-2 shrink-0 rounded-full bg-talaTeal" title={t(s.isCopy ? 'up.ed.slideCopy' : 'up.ed.slideChanged')} aria-label={t(s.isCopy ? 'up.ed.slideCopy' : 'up.ed.slideChanged')} />}
              </span>
            </button>
          ))}
        </nav>

        <div className="flex min-w-0 flex-col gap-3">
          <div className="overflow-hidden rounded bg-white p-1 shadow-lift wide:rounded-lg wide:p-2" style={{ containerType: 'inline-size' }} data-pictures={!previews.available ? 'none' : drawing === 'busy' ? 'drawing' : picturesBehind || !pictured.has(slide.id) ? 'behind' : 'current'}>
            <SlidePicture deck={deck} slide={slide} number={index + 1} previewRev={previews.rev} hasPicture={pictured.has(slide.id)} onPick={focusBlock} />
          </div>
          {previews.available ? (
            (picturesBehind || drawing !== 'idle' || !pictured.has(slide.id)) && (
              <p className="flex flex-wrap items-center gap-2 text-small text-forestMuted" role="status">
                {drawing === 'busy' ? (
                  <>
                    <LocalIcon name="spinner" size={15} className="animate-spin" />
                    {t('up.ed.picture.drawing')}
                  </>
                ) : (
                  <>
                    <Icon name="info" size={15} />
                    {drawing === 'failed' ? t('up.ed.picture.failed') : pictured.has(slide.id) ? t('up.ed.picture.behind') : t('up.ed.picture.none')}
                    <button type="button" onClick={() => void refreshPictures()} className="inline-flex min-h-touch items-center gap-1 rounded px-1.5 font-medium text-talaTeal hover:bg-talaTeal/10" data-refresh-pictures>
                      <Icon name="restore" size={15} />
                      {t('up.ed.picture.refresh')}
                    </button>
                  </>
                )}
              </p>
            )
          ) : (
            <p className="flex items-start gap-2 text-small text-forestMuted">
              <Icon name="info" size={15} className="mt-0.5 shrink-0" />
              {t('up.ed.picture.none')}
            </p>
          )}

          <div className="flex items-center gap-2">
            <button type="button" onClick={() => select(index - 1)} disabled={index === 0} aria-label={t('sl.ed.prevSlide')} className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white text-forest shadow-card hover:bg-cream disabled:opacity-35">
              <Icon name="chevronLeft" size={24} />
            </button>
            <div className="flex min-w-0 flex-1 flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center">
              <p className="font-semibold tabular-nums">{t('sl.slideOf', { n: index + 1, total })}</p>
              {slide.isCopy && <StatusChip tone="mine">{t('up.ed.slideCopy')}</StatusChip>}
              {!slide.isCopy && slide.changed && <StatusChip tone="mine">{t('up.ed.slideChanged')}</StatusChip>}
              {slide.source.hidden && <StatusChip tone="quiet">{t('up.ed.slideHidden')}</StatusChip>}
            </div>
            <button type="button" onClick={() => select(index + 1)} disabled={index === total - 1} aria-label={t('sl.ed.nextSlide')} className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white text-forest shadow-card hover:bg-cream disabled:opacity-35">
              <Icon name="chevronRight" size={24} />
            </button>
          </div>

          <div role="group" aria-label={t('up.ed.op.label')} className="strip -mx-3 flex gap-2 px-3 py-1 wide:mx-0 wide:flex-wrap wide:overflow-visible wide:px-0">
            <Op op="up" icon="arrowUp" onClick={() => move(-1)} disabled={!canMove(ed.edits, slide.id, -1)}>
              {t('up.ed.op.up')}
            </Op>
            <Op op="down" icon="arrowDown" onClick={() => move(1)} disabled={!canMove(ed.edits, slide.id, 1)}>
              {t('up.ed.op.down')}
            </Op>
            <Op op="copy" icon="copy" onClick={copy} disabled={blocked !== null} title={blocked === 'linked_content' ? t('up.ed.copyBlocked') : undefined}>
              {t('up.ed.op.copy')}
            </Op>
            {slide.changed && !slide.isCopy && (
              <Op op="restore" icon="restore" onClick={putBack}>
                {t('up.ed.op.restore')}
              </Op>
            )}
            <Op op="remove" icon="trash" tone="danger" onClick={remove} disabled={!canRemove(ed.edits)}>
              {t('up.ed.op.remove')}
            </Op>
          </div>
          {blocked === 'linked_content' && (
            <p className="flex items-start gap-2 text-small text-forestMuted">
              <Icon name="info" size={15} className="mt-0.5 shrink-0" />
              {t('up.ed.copyBlocked')}
            </p>
          )}
          {gone.length > 0 && (
            <section aria-label={t('up.ed.removedTitle')} className="rounded-lg border border-hairline bg-white p-3">
              <p className="font-semibold">{t('up.ed.removedTitle')}</p>
              <p className="text-small text-forestMuted">{t('up.ed.removedBody')}</p>
              <ul className="mt-2 flex flex-col gap-1.5">
                {gone.map((s) => (
                  <li key={s.id} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate">
                      {s.number}. {s.title || t('up.ed.untitled', { n: s.number })}
                    </span>
                    <Button variant="quiet" onClick={() => ed.change(bringBack(ed.edits, s))} data-bring-back={s.id}>
                      {t('up.ed.bringBack')}
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Every slide in a row (phones) */}
          <div role="group" aria-label={t('up.ed.slides')} className="strip -mx-3 flex gap-2 px-3 py-1 wide:hidden">
            {slides.map((s, i) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSelectedId(s.id)}
                aria-current={s.id === slide.id ? 'true' : undefined}
                data-slide-chip={s.id}
                className={cx('flex h-14 w-24 shrink-0 flex-col justify-between rounded border-2 bg-white p-1 text-left text-small', s.id === slide.id ? 'border-talaTeal' : 'border-hairline')}
              >
                <span className="font-semibold tabular-nums">{i + 1}</span>
                <span className="truncate text-forestMuted">{slideLabel(s, i)}</span>
              </button>
            ))}
          </div>
        </div>

        <aside aria-label={t('up.ed.words')} className="flex min-w-0 flex-col gap-4 rounded-lg bg-white p-4 shadow-card wide:col-start-2 min-[1180px]:sticky min-[1180px]:top-[4.5rem] min-[1180px]:col-start-3 min-[1180px]:row-start-1 min-[1180px]:max-h-[calc(100dvh-5.5rem)] min-[1180px]:overflow-y-auto">
          <h2 className="font-display text-title">{t('up.ed.words')}</h2>
          {slide.blocks.length === 0 ? (
            <p className="text-forestMuted">{t('up.ed.noWords')}</p>
          ) : (
            slide.blocks.map((b) => <BlockFields key={`${slide.id}-${b.id}`} slide={slide} block={b} onChange={(paragraphs) => ed.change(setBlockText(base, ed.edits, slide.id, b.id, paragraphs), `text:${slide.id}:${b.id}`)} />)
          )}
          <div className="flex flex-col gap-1.5 border-t border-hairline pt-3">
            <p className="flex items-center gap-2 font-semibold">
              <Icon name="notes" size={18} />
              {t('up.ed.notes')}
              {slide.notes.changed && <StatusChip tone="mine">{t('up.ed.blockChanged')}</StatusChip>}
            </p>
            {slide.notes.editable ? (
              <>
                <GrowingText
                  id={`un-${slide.id}`}
                  rows={3}
                  value={notesToText(slide.notes.paragraphs)}
                  onChange={(v) => ed.change(setNotes(base, ed.edits, slide.id, textToNotes(v)), `notes:${slide.id}`)}
                  label={t('up.ed.notes')}
                  placeholder={t('up.ed.notesPlaceholder')}
                />
                <p className="text-small text-forestMuted">{t('up.ed.notesHint')}</p>
              </>
            ) : (
              <p className="text-small text-forestMuted">{slide.notes.paragraphs.length ? notesToText(slide.notes.paragraphs) : t('up.ed.notesUnavailable')}</p>
            )}
          </div>
          {onSlide.length > 0 && (
            <div className="flex flex-col gap-1 border-t border-hairline pt-3" data-kept-on-slide>
              <p className="flex items-center gap-2 text-small font-semibold text-forestMuted">
                <Icon name="lock" size={15} />
                {t('up.ed.kept')}
              </p>
              <p className="text-small text-forestMuted">{onSlide.map(([kind, n]) => `${t(`up.kept.${kind}` as StringKey)}${n > 1 ? ` × ${n}` : ''}`).join(' · ')}</p>
            </div>
          )}
        </aside>
      </div>

      <Sheet open={sheet === 'kept'} onClose={closing('kept')} title={t('up.kept.title')}>
        <p>{t('up.kept.summary', { slides: base.totals.slides, blocks: base.totals.editableBlocks })}</p>
        {deck.kind !== 'presentation' && <p>{t(deck.kind === 'template' ? 'up.kept.template' : 'up.kept.slideshow')}</p>}
        {kept.length === 0 ? (
          <p className="text-forestMuted">{t('up.kept.none')}</p>
        ) : (
          <>
            <p>{t('up.kept.intro')}</p>
            <ul className="flex flex-col gap-1.5" data-kept-list>
              {kept.map((k) => (
                <li key={k.feature} className="flex items-start gap-2">
                  <Icon name="lock" size={16} className="mt-1 shrink-0 text-forestMuted" />
                  <span>
                    <span className="font-medium">{t(`up.kept.${k.feature}` as StringKey)}</span>
                    {k.slides.length > 0 && <span className="text-forestMuted"> · {t(k.slides.length === 1 ? 'up.kept.onSlide' : 'up.kept.onSlides', { list: k.slides.join(', ') })}</span>}
                  </span>
                </li>
              ))}
            </ul>
            {kept.some((k) => k.slides.length > 0) && <p className="text-small text-forestMuted">{t('up.kept.numbers')}</p>}
          </>
        )}
      </Sheet>

      <Sheet open={sheet === 'download'} onClose={closing('download')} title={t('up.ed.download')}>
        <Button variant="primary" full busy={working === 'download'} onClick={() => void downloadMine()} data-download-mine>
          <Icon name="download" size={20} />
          {t('up.ed.downloadMine')}
        </Button>
        <p className="-mt-1 text-small text-forestMuted">{t('up.ed.downloadMineHint')}</p>
        <Button
          full
          onClick={() => {
            setSheet(null);
            startDownload(uploadOriginalUrl(deck.id));
          }}
          data-download-original
        >
          <Icon name="file" size={20} />
          {t('up.ed.downloadOriginal')}
        </Button>
        <p className="-mt-1 text-small text-forestMuted">{t('up.ed.downloadOriginalHint')}</p>
      </Sheet>

      <Sheet open={sheet === 'more'} onClose={closing('more')} title={t('sl.ed.more')}>
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
        <Button full onClick={() => setSheet('kept')}>
          <Icon name="info" size={20} />
          {t('up.kept.more')}
        </Button>
        <Button full variant="danger" onClick={() => setSheet('delete')} data-delete>
          <Icon name="trash" size={20} />
          {t('up.ed.delete')}
        </Button>
      </Sheet>

      <Sheet
        open={sheet === 'delete'}
        onClose={closing('delete')}
        title={t('up.ed.deleteTitle')}
        actions={
          <>
            <Button onClick={() => setSheet(null)}>{t('common.cancel')}</Button>
            <Button variant="danger" busy={working === 'delete'} onClick={() => void remove_()} data-delete-confirm>
              {t('up.ed.deleteConfirm')}
            </Button>
          </>
        }
      >
        <p>{t('up.ed.deleteBody')}</p>
      </Sheet>

      <Sheet
        open={ed.state === 'conflict' && !conflictLater}
        onClose={() => setConflictLater(true)}
        title={t('up.ed.conflict.title')}
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
        <p>{t('up.ed.conflict.body')}</p>
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
        <span className="sr-only">{t('up.title')}</span>
      </Sheet>

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
