'use client';
/**
 * State of the "my own slides" editor: the teacher's differences from her uploaded file, with undo history and
 * saving that is always truthful. Same rules as the editor for a copy of a Hiraia deck (useDeckEditor): every
 * change is kept on this device at once and sent to the server about a second after she stops typing; a failed
 * save keeps the work, says so and retries; a save refused because the slides changed elsewhere waits for her
 * choice. The uploaded file itself is never sent again and never changes.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { UPLOAD_LIMITS } from '@hiraia/tala-core/contracts';
import type { UploadedDeck, UploadSlideEdit } from '@hiraia/tala-core/contracts';
import { getUpload, saveUpload, uploadFailure } from '@/data/uploads';
import { historyOf, historyPush, historyRedo, historyUndo, type History } from './deck-model';
import { clearUploadDraft, readUploadDraft, writeUploadDraft, type UploadDraft } from './upload-model';
import type { SaveState } from './useDeckEditor';

const AUTOSAVE_MS = 1200;
const RETRY_MS = [2000, 5000, 12000, 30000];
const WAITING: SaveState[] = ['conflict', 'signedOut', 'gone'];

function deviceStorage() {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function useUploadEditor(initial: UploadedDeck) {
  const uploadId = initial.id;
  const [deck, setDeck] = useState(initial);
  const [hist, setHist] = useState<History<UploadSlideEdit[]>>(() => historyOf(initial.edits.slides));
  const [title, setTitle] = useState(initial.title);
  const [state, setStateRaw] = useState<SaveState>('saved');
  /** The saved version on the server (pictures are drawn of this). */
  const [rev, setRev] = useState(initial.rev);
  const [kept, setKept] = useState(true);
  const [draftOffer, setDraftOffer] = useState<UploadDraft | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  const edits = hist.present;
  const fallbackTitle = initial.title;
  const normal = useCallback((t: string, s: UploadSlideEdit[]) => JSON.stringify({ title: (t.trim() || fallbackTitle).slice(0, UPLOAD_LIMITS.title), slides: s }), [fallbackTitle]);
  const live = useRef({
    edits: initial.edits.slides,
    title: initial.title,
    rev: initial.rev,
    saved: '',
    state: 'saved' as SaveState,
    inflight: null as Promise<boolean> | null,
    timer: null as ReturnType<typeof setTimeout> | null,
    draftTimer: null as ReturnType<typeof setTimeout> | null,
    attempts: 0,
    alive: true,
    seenEdits: initial.edits.slides,
    seenTitle: initial.title,
  });
  if (!live.current.saved) live.current.saved = normal(initial.title, initial.edits.slides);
  const setState = useCallback((s: SaveState) => {
    live.current.state = s;
    setStateRaw(s);
  }, []);
  const isDirty = useCallback(() => normal(live.current.title, live.current.edits) !== live.current.saved, [normal]);

  const adopt = useCallback(
    (d: UploadedDeck) => {
      const L = live.current;
      if (L.timer) clearTimeout(L.timer);
      if (L.draftTimer) clearTimeout(L.draftTimer);
      L.edits = d.edits.slides;
      L.title = d.title;
      L.seenEdits = d.edits.slides;
      L.seenTitle = d.title;
      L.rev = d.rev;
      L.saved = normal(d.title, d.edits.slides);
      L.attempts = 0;
      setDeck(d);
      setHist(historyOf(d.edits.slides));
      setTitle(d.title);
      setRev(d.rev);
      setState('saved');
      clearUploadDraft(deviceStorage(), uploadId);
    },
    [normal, setState, uploadId]
  );

  const saveNow = useCallback(
    async (force = false): Promise<boolean> => {
      const L = live.current;
      while (L.inflight) await L.inflight;
      if (L.timer) clearTimeout(L.timer);
      if (!isDirty() && !force) {
        if (!WAITING.includes(L.state)) setState('saved');
        return true;
      }
      const body = { title: (L.title.trim() || fallbackTitle).slice(0, UPLOAD_LIMITS.title), slides: L.edits };
      const sent = JSON.stringify(body);
      setState('saving');
      const run = saveUpload(uploadId, { baseRev: L.rev, ...body, force })
        .then((res) => {
          L.rev = res.rev;
          L.saved = sent;
          L.attempts = 0;
          if (!L.alive) return true;
          setRev(res.rev);
          setRefusal(null);
          if (isDirty()) {
            setState('dirty');
            L.timer = setTimeout(() => void saveNow(), AUTOSAVE_MS);
          } else {
            setState('saved');
            clearUploadDraft(deviceStorage(), uploadId);
          }
          return true;
        })
        .catch((err: unknown) => {
          if (!L.alive) return false;
          const why = uploadFailure(err);
          if (why === 'conflict' || why === 'signedOut' || why === 'gone' || why === 'refused') {
            setState(why);
            return false;
          }
          setState(why === 'offline' ? 'offline' : 'error');
          const pause = RETRY_MS[Math.min(L.attempts, RETRY_MS.length - 1)]!;
          L.attempts += 1;
          L.timer = setTimeout(() => void saveNow(), pause);
          return false;
        })
        .finally(() => {
          if (L.inflight === run) L.inflight = null;
        });
      L.inflight = run;
      return run;
    },
    [fallbackTitle, isDirty, setState, uploadId]
  );

  const keepOnDevice = useCallback(() => {
    const L = live.current;
    if (L.draftTimer) clearTimeout(L.draftTimer);
    L.draftTimer = null;
    if (isDirty()) setKept(writeUploadDraft(deviceStorage(), { v: 1, uploadId, baseRev: L.rev, at: new Date().toISOString(), title: L.title, slides: L.edits }));
    else clearUploadDraft(deviceStorage(), uploadId);
  }, [isDirty, uploadId]);

  useEffect(() => {
    const L = live.current;
    L.edits = edits;
    L.title = title;
    if (L.seenEdits === edits && L.seenTitle === title) return;
    L.seenEdits = edits;
    L.seenTitle = title;
    if (L.draftTimer) clearTimeout(L.draftTimer);
    L.draftTimer = setTimeout(keepOnDevice, 350);
    if (WAITING.includes(L.state)) return;
    if (L.state !== 'saving') setState('dirty');
    if (L.timer) clearTimeout(L.timer);
    L.timer = setTimeout(() => void saveNow(), AUTOSAVE_MS);
  }, [edits, title, keepOnDevice, saveNow, setState]);

  // Unsaved work left on this device from last time is offered back, once.
  useEffect(() => {
    const d = readUploadDraft(deviceStorage(), uploadId);
    if (!d) return;
    const same = normal(d.title, d.slides) === live.current.saved;
    const newer = d.baseRev === initial.rev || Date.parse(d.at) > Date.parse(initial.updatedAt);
    if (same || !newer) clearUploadDraft(deviceStorage(), uploadId);
    else setDraftOffer(d);
    // Only when the slides open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadId]);

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
      keepOnDevice();
      if (isDirty() && !WAITING.includes(L.state)) void saveNow();
      L.alive = false;
    };
  }, [isDirty, keepOnDevice, saveNow]);

  const change = useCallback((next: UploadSlideEdit[], tag: string | null = null) => setHist((h) => historyPush(h, next, tag)), []);
  const undo = useCallback(() => setHist(historyUndo), []);
  const redo = useCallback(() => setHist(historyRedo), []);

  const acceptDraft = useCallback(() => {
    if (!draftOffer) return;
    setHist((h) => historyPush(h, draftOffer.slides));
    if (draftOffer.title) setTitle(draftOffer.title);
    setDraftOffer(null);
  }, [draftOffer]);
  const discardDraft = useCallback(() => {
    clearUploadDraft(deviceStorage(), uploadId);
    setDraftOffer(null);
  }, [uploadId]);

  const keepMine = useCallback(() => saveNow(true), [saveNow]);
  const loadServer = useCallback(async (): Promise<boolean> => {
    try {
      adopt(await getUpload(uploadId));
      return true;
    } catch (e) {
      const why = uploadFailure(e);
      if (why === 'gone' || why === 'signedOut') setState(why);
      return false;
    }
  }, [adopt, setState, uploadId]);

  return {
    deck,
    edits,
    title,
    setTitle,
    change,
    undo,
    redo,
    canUndo: hist.past.length > 0,
    canRedo: hist.future.length > 0,
    state,
    rev,
    kept,
    refusal,
    flush: saveNow,
    retry: () => void saveNow(),
    keepMine,
    loadServer,
    draftOffer,
    acceptDraft,
    discardDraft,
  };
}

export type UploadEditor = ReturnType<typeof useUploadEditor>;
