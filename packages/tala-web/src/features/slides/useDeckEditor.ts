'use client';
/**
 * State of the "edit my copy" screen: the slides with undo history, and saving that is always truthful.
 *
 * Saving: every change is written to this device at once (so a refresh or a dropped connection loses nothing),
 * then sent to the server about a second after the teacher stops typing. A failed save keeps the work, says so and
 * retries; a save refused because the copy changed elsewhere (another tab or device) waits for the teacher's choice.
 * The server decides ownership and order; the device clock is only a tie-break for offering unsaved work back.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DECK_LIMITS } from '@hiraia/tala-core/contracts';
import type { DeckDetail, DeckSlide } from '@hiraia/tala-core/contracts';
import { deckFailure, forgetDecks, getDeck, resetDeck, saveDeck } from '@/data/decks';
import { changedIds, clearDraft, historyOf, historyPush, historyRedo, historyUndo, readDraft, slidesForSave, writeDraft, type DeckDraft, type DraftStorage, type History } from './deck-model';

/**
 * saved: the server has everything · dirty: will save in a moment · saving · offline / error: not saved, will retry ·
 * signedOut / gone / conflict: waiting for the teacher · refused: the server would not take this change.
 */
export type SaveState = 'saved' | 'dirty' | 'saving' | 'offline' | 'error' | 'signedOut' | 'refused' | 'conflict' | 'gone';

const AUTOSAVE_MS = 1200;
const RETRY_MS = [2000, 5000, 12000, 30000];
const WAITING: SaveState[] = ['conflict', 'signedOut', 'gone'];

function deviceStorage(): DraftStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function useDeckEditor(initial: DeckDetail) {
  const deckId = initial.deck.id;
  const [detail, setDetail] = useState(initial);
  const [hist, setHist] = useState<History<DeckSlide[]>>(() => historyOf(initial.deck.slides));
  const [title, setTitle] = useState(initial.deck.title);
  const [state, setStateRaw] = useState<SaveState>('saved');
  const [savedAt, setSavedAt] = useState(initial.deck.updatedAt);
  /** False when the device refused to keep unsaved work (storage full, private mode). */
  const [kept, setKept] = useState(true);
  const [draftOffer, setDraftOffer] = useState<DeckDraft | null>(null);

  const slides = hist.present;
  const fallbackTitle = initial.deck.title;
  const normal = useCallback(
    (t: string, s: DeckSlide[]) => JSON.stringify({ title: (t.trim() || fallbackTitle).slice(0, DECK_LIMITS.deckTitle), slides: slidesForSave(s) }),
    [fallbackTitle]
  );
  const live = useRef({
    slides: initial.deck.slides,
    title: initial.deck.title,
    rev: initial.deck.rev,
    saved: '',
    state: 'saved' as SaveState,
    inflight: null as Promise<boolean> | null,
    timer: null as ReturnType<typeof setTimeout> | null,
    draftTimer: null as ReturnType<typeof setTimeout> | null,
    attempts: 0,
    alive: true,
    /** What the change effect last saw (so a re-run without a change does nothing). */
    seenSlides: initial.deck.slides,
    seenTitle: initial.deck.title,
  });
  if (!live.current.saved) live.current.saved = normal(initial.deck.title, initial.deck.slides);
  const setState = useCallback((s: SaveState) => {
    live.current.state = s;
    setStateRaw(s);
  }, []);
  const isDirty = useCallback(() => normal(live.current.title, live.current.slides) !== live.current.saved, [normal]);

  /** Take a server copy as the new truth (first load, "load the other one", "start over"). */
  const adopt = useCallback(
    (d: DeckDetail) => {
      const L = live.current;
      if (L.timer) clearTimeout(L.timer);
      if (L.draftTimer) clearTimeout(L.draftTimer);
      L.slides = d.deck.slides;
      L.title = d.deck.title;
      L.seenSlides = d.deck.slides;
      L.seenTitle = d.deck.title;
      L.rev = d.deck.rev;
      L.saved = normal(d.deck.title, d.deck.slides);
      L.attempts = 0;
      setDetail(d);
      setHist(historyOf(d.deck.slides));
      setTitle(d.deck.title);
      setSavedAt(d.deck.updatedAt);
      setState('saved');
      clearDraft(deviceStorage(), deckId);
    },
    [deckId, normal, setState]
  );

  const saveNow = useCallback(
    async (force = false): Promise<boolean> => {
      const L = live.current;
      // One save at a time: a second caller waits for the one in flight (and for any that started meanwhile).
      while (L.inflight) await L.inflight;
      if (L.timer) clearTimeout(L.timer);
      if (!isDirty() && !force) {
        if (!WAITING.includes(L.state)) setState('saved');
        return true;
      }
      const body = { title: (L.title.trim() || fallbackTitle).slice(0, DECK_LIMITS.deckTitle), slides: slidesForSave(L.slides) };
      const sent = JSON.stringify(body);
      setState('saving');
      const run = saveDeck(deckId, { baseRev: L.rev, ...body, force })
        .then((res) => {
          L.rev = res.rev;
          L.saved = sent;
          L.attempts = 0;
          if (!L.alive) return true;
          setSavedAt(res.updatedAt);
          forgetDecks();
          if (isDirty()) {
            setState('dirty');
            L.timer = setTimeout(() => void saveNow(), AUTOSAVE_MS);
          } else {
            setState('saved');
            clearDraft(deviceStorage(), deckId);
          }
          return true;
        })
        .catch((err: unknown) => {
          if (!L.alive) return false;
          const why = deckFailure(err);
          if (why === 'conflict' || why === 'signedOut' || why === 'gone' || why === 'refused') {
            setState(why);
            return false;
          }
          setState(why === 'offline' ? 'offline' : 'error');
          const wait = RETRY_MS[Math.min(L.attempts, RETRY_MS.length - 1)]!;
          L.attempts += 1;
          L.timer = setTimeout(() => void saveNow(), wait);
          return false;
        })
        .finally(() => {
          if (L.inflight === run) L.inflight = null;
        });
      L.inflight = run;
      return run;
    },
    [deckId, fallbackTitle, isDirty, setState]
  );

  /** Put the unsaved work on the device (or clear it when there is none). */
  const keepOnDevice = useCallback(() => {
    const L = live.current;
    if (L.draftTimer) clearTimeout(L.draftTimer);
    L.draftTimer = null;
    if (isDirty()) setKept(writeDraft(deviceStorage(), { v: 1, deckId, baseRev: L.rev, at: new Date().toISOString(), title: L.title, slides: L.slides }));
    else clearDraft(deviceStorage(), deckId);
  }, [deckId, isDirty]);

  // Every change: keep it on the device within a moment, send it to the server soon after.
  useEffect(() => {
    const L = live.current;
    L.slides = slides;
    L.title = title;
    if (L.seenSlides === slides && L.seenTitle === title) return;
    L.seenSlides = slides;
    L.seenTitle = title;
    if (L.draftTimer) clearTimeout(L.draftTimer);
    L.draftTimer = setTimeout(keepOnDevice, 350);
    if (WAITING.includes(L.state)) return;
    if (L.state !== 'saving') setState('dirty');
    if (L.timer) clearTimeout(L.timer);
    L.timer = setTimeout(() => void saveNow(), AUTOSAVE_MS);
  }, [slides, title, keepOnDevice, saveNow, setState]);

  // Unsaved work left on this device from last time is offered back, once, when the copy opens.
  useEffect(() => {
    const d = readDraft(deviceStorage(), deckId);
    if (!d) return;
    const same = normal(d.title, d.slides) === live.current.saved;
    const newer = d.baseRev === initial.deck.rev || Date.parse(d.at) > Date.parse(initial.deck.updatedAt);
    if (same || !newer) clearDraft(deviceStorage(), deckId);
    else setDraftOffer(d);
    // Only when the copy opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckId]);

  useEffect(() => {
    const L = live.current;
    L.alive = true;
    const onOnline = () => {
      if (L.state === 'offline' || L.state === 'error') void saveNow();
    };
    const onHide = () => {
      if (document.visibilityState !== 'hidden') return;
      keepOnDevice();
      if (isDirty() && !WAITING.includes(L.state)) void saveNow();
    };
    const onLeave = (e: BeforeUnloadEvent) => {
      keepOnDevice();
      if (!isDirty() && !L.inflight) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('beforeunload', onLeave);
    return () => {
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('beforeunload', onLeave);
      if (L.timer) clearTimeout(L.timer);
      // Leaving the screen inside the app: one last try; the device copy covers a failure.
      keepOnDevice();
      if (isDirty() && !WAITING.includes(L.state)) void saveNow();
      L.alive = false;
    };
  }, [isDirty, keepOnDevice, saveNow]);

  const change = useCallback((next: DeckSlide[], tag: string | null = null) => setHist((h) => historyPush(h, next, tag)), []);
  const undo = useCallback(() => setHist(historyUndo), []);
  const redo = useCallback(() => setHist(historyRedo), []);

  const acceptDraft = useCallback(() => {
    if (!draftOffer) return;
    setHist((h) => historyPush(h, draftOffer.slides));
    if (draftOffer.title) setTitle(draftOffer.title);
    setDraftOffer(null);
  }, [draftOffer]);
  const discardDraft = useCallback(() => {
    clearDraft(deviceStorage(), deckId);
    setDraftOffer(null);
  }, [deckId]);

  /** Conflict: keep this device's version (overwrites the other save). */
  const keepMine = useCallback(() => saveNow(true), [saveNow]);
  /** Conflict (or any time): drop what is here and load what the server has. */
  const loadServer = useCallback(async (): Promise<boolean> => {
    try {
      adopt(await getDeck(deckId));
      return true;
    } catch (e) {
      const why = deckFailure(e);
      if (why === 'gone' || why === 'signedOut') setState(why);
      return false;
    }
  }, [adopt, deckId, setState]);
  const startOver = useCallback(async (): Promise<boolean> => {
    const L = live.current;
    if (L.timer) clearTimeout(L.timer);
    if (L.inflight) await L.inflight;
    try {
      adopt(await resetDeck(deckId));
      forgetDecks();
      return true;
    } catch (e) {
      const why = deckFailure(e);
      if (why === 'gone' || why === 'signedOut') setState(why);
      return false;
    }
  }, [adopt, deckId, setState]);

  const changed = useMemo(() => changedIds(slides, detail.baseSlides), [slides, detail.baseSlides]);

  return {
    detail,
    slides,
    title,
    setTitle,
    change,
    undo,
    redo,
    canUndo: hist.past.length > 0,
    canRedo: hist.future.length > 0,
    state,
    kept,
    savedAt,
    changed,
    /** Save now and say whether the server has everything. */
    flush: saveNow,
    retry: () => void saveNow(),
    keepMine,
    loadServer,
    startOver,
    draftOffer,
    acceptDraft,
    discardDraft,
  };
}

export type DeckEditor = ReturnType<typeof useDeckEditor>;
