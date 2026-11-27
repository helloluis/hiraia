'use client';
/**
 * A teacher's own copy of a pack's slides ("My copy"): typed calls to the owner-only `decks.*` routes, the URLs of a
 * copy's drawings and its PowerPoint file, and small hooks for the screens. The copy lives on the server under the
 * teacher's account; nothing here can reach another teacher's copy.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE, TalaApiError } from '@hiraia/tala-core/contracts';
import type { DeckDetail, DeckSaveResult, DeckSlide, DeckSummary, LessonPresentation, PackLang, SlidesAiFailure, SlidesAiScope, SlidesJob } from '@hiraia/tala-core/contracts';
import { getClient } from './client';
import { useSession } from './session';

export const deckMediaUrl = (deckId: string, slug: string) => `${API_BASE}/decks/${encodeURIComponent(deckId)}/media/${encodeURIComponent(slug)}`;
export const deckPptxUrl = (deckId: string) => `${API_BASE}/decks/${encodeURIComponent(deckId)}/pptx`;
/** A drawing of the shared original, exactly as embedded in the built deck (with its Hiraia mark). */
export const packMediaUrl = (packId: string, slug: string, lang: PackLang) =>
  `${API_BASE}/packs/${encodeURIComponent(packId)}/media/${encodeURIComponent(slug)}?lang=${lang}`;

export const listDecks = async (): Promise<DeckSummary[]> => (await getClient().call('decks.list')).decks;
/** Makes my copy of a pack's deck, or answers the copy I already have. */
export const createDeck = (packId: string, lang: PackLang): Promise<DeckDetail> => getClient().call('decks.create', { body: { packId, lang } });
export const getDeck = (deckId: string): Promise<DeckDetail> => getClient().call('decks.get', { params: { deckId } });
export const saveDeck = (deckId: string, body: { baseRev: number; title?: string; slides: DeckSlide[]; force?: boolean }): Promise<DeckSaveResult> =>
  getClient().call('decks.save', { params: { deckId }, body });
export const resetDeck = (deckId: string): Promise<DeckDetail> => getClient().call('decks.reset', { params: { deckId } });
export const deleteDeck = async (deckId: string): Promise<void> => {
  await getClient().call('decks.delete', { params: { deckId } });
};

export type DeckFailure = 'offline' | 'signedOut' | 'gone' | 'conflict' | 'refused' | 'server';

/** Why a deck call failed, in the few kinds the screens tell apart. */
export function deckFailure(err: unknown): DeckFailure {
  if (err instanceof TalaApiError) {
    if (err.code === 'network' || err.code === 'timeout') return 'offline';
    if (err.code === 'unauthenticated') return 'signedOut';
    if (err.code === 'not_found') return 'gone';
    if (err.code === 'conflict') return 'conflict';
    if (err.code === 'invalid_input' || err.code === 'forbidden') return 'refused';
  }
  return 'server';
}

/** The stored rev named by a `conflict` answer. */
export function conflictRev(err: unknown): number | null {
  if (!(err instanceof TalaApiError)) return null;
  const rev = (err.details as { rev?: unknown } | undefined)?.rev;
  return typeof rev === 'number' ? rev : null;
}

/* The list is small and asked for by several parts of a page: one request, shared, refreshed on demand. */
let listCache: { owner: string; decks: DeckSummary[] } | null = null;
const listeners = new Set<() => void>();
export function forgetDecks() {
  listCache = null;
  for (const l of listeners) l();
}

/** My copy of this pack in this language, if I have one. `null` while signed out. */
export function useMyDeck(packId: string, lang: PackLang) {
  const { status, user } = useSession();
  const owner = user?.id ?? '';
  const [decks, setDecks] = useState<DeckSummary[] | null>(() => (listCache && listCache.owner === owner ? listCache.decks : null));
  const [failed, setFailed] = useState<DeckFailure | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const l = () => setTick((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  useEffect(() => {
    if (status !== 'signedIn' || !owner) {
      setDecks(null);
      return;
    }
    let alive = true;
    if (listCache && listCache.owner === owner) setDecks(listCache.decks);
    listDecks()
      .then((d) => {
        listCache = { owner, decks: d };
        if (alive) {
          setDecks(d);
          setFailed(null);
        }
      })
      .catch((e) => {
        if (alive) setFailed(deckFailure(e));
      });
    return () => {
      alive = false;
    };
  }, [status, owner, tick]);
  const mine = (decks ?? []).filter((d) => d.packId === packId && d.language === lang).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null;
  return { summary: mine, loading: status === 'signedIn' && decks === null && !failed, failed, reload: forgetDecks };
}

/** One of my copies, whole. */
export function useDeck(deckId: string | null) {
  const { status } = useSession();
  const [detail, setDetail] = useState<DeckDetail | null>(null);
  const [failed, setFailed] = useState<DeckFailure | null>(null);
  const [loading, setLoading] = useState(Boolean(deckId));
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!deckId || status !== 'signedIn') return;
    const mine = ++seq.current;
    setLoading(true);
    try {
      const d = await getDeck(deckId);
      if (mine !== seq.current) return;
      setDetail(d);
      setFailed(null);
    } catch (e) {
      if (mine !== seq.current) return;
      setFailed(deckFailure(e));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [deckId, status]);
  useEffect(() => {
    setDetail(null);
    setFailed(null);
    void load();
  }, [load]);
  return { detail, setDetail, failed, loading, reload: load };
}

/* ---------------- a lesson's presentation (27 Nov 2026) ---------------- */
/*
 * The lesson plan's slides: which deck the lesson uses (its day of a pack copy, or slides made from the lesson with
 * AI), whether the lesson changed since, AI proposals, earlier versions, and a multi-grade session's parts. Every
 * route is owner-only on the server; the plan is read there as SAVED, so callers send the device's edits first.
 */
export const lessonPptxUrl = (planId: string) => `${API_BASE}/plans/${encodeURIComponent(planId)}/presentation/pptx`;

export const getPresentation = (planId: string): Promise<LessonPresentation> => getClient().call('decks.lesson.get', { params: { planId } });
export const linkPackSlides = (planId: string, body: { packId: string; lang: PackLang; day: number }): Promise<LessonPresentation> =>
  getClient().call('decks.lesson.link', { params: { planId }, body });
export const unlinkSlides = async (planId: string): Promise<void> => {
  await getClient().call('decks.lesson.unlink', { params: { planId } });
};
export const slidesStillFit = (planId: string): Promise<LessonPresentation> => getClient().call('decks.lesson.checked', { params: { planId } });
export const chooseSessionSource = (planId: string, groupId: string, sourcePlanId: string | null): Promise<LessonPresentation> =>
  getClient().call('decks.lesson.source', { params: { planId, groupId }, body: { planId: sourcePlanId } });
export const startSlidesAi = (planId: string, body: { scope: SlidesAiScope; slideId?: string; instruction?: string; deckId?: string }): Promise<SlidesJob> =>
  getClient().call('decks.ai.start', { params: { planId }, body });
export const getSlidesAi = (planId: string, jobId: string, signal?: AbortSignal): Promise<SlidesJob> =>
  getClient().call('decks.ai.get', { params: { planId, jobId }, signal });
export const applySlidesAi = (planId: string, jobId: string, force = false): Promise<LessonPresentation> =>
  getClient().call('decks.ai.apply', { params: { planId, jobId }, body: { force } });
export const discardSlidesAi = (planId: string, jobId: string): Promise<SlidesJob> => getClient().call('decks.ai.discard', { params: { planId, jobId } });
export const listRevisions = async (deckId: string) => (await getClient().call('decks.revisions', { params: { deckId } })).revisions;
export const restoreRevision = (deckId: string, revisionId: string): Promise<DeckDetail> =>
  getClient().call('decks.restore', { params: { deckId, revisionId } });

/** Why an AI request could not even start, or why it ended without a proposal, in the kinds the screens tell apart. */
export type SlidesAiTrouble = SlidesAiFailure | 'offline' | 'signedOut' | 'unsynced' | 'empty_lesson' | 'choose_day' | 'conflict' | 'server';

export function slidesAiTrouble(err: unknown): SlidesAiTrouble {
  if (err instanceof TalaApiError) {
    const reason = (err.details as { reason?: string } | undefined)?.reason;
    if (err.code === 'network' || err.code === 'timeout') return 'offline';
    if (err.code === 'unauthenticated') return 'signedOut';
    if (reason === 'empty_lesson' || reason === 'choose_day') return reason;
    if (reason === 'disabled') return 'disabled';
    if (err.code === 'conflict') return 'conflict';
    if (err.code === 'not_found') return 'gone';
    if (err.code === 'quota_exceeded') return 'quota_exceeded';
  }
  return 'server';
}

/** The lesson's presentation, loaded once and again whenever `refresh` changes (the plan reached the server again). */
export function useLessonPresentation(planId: string, refresh: string) {
  const { status } = useSession();
  const [presentation, setPresentation] = useState<LessonPresentation | null>(null);
  const [failed, setFailed] = useState<DeckFailure | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (status !== 'signedIn' || !planId) return;
    const mine = ++seq.current;
    setLoading(true);
    try {
      const p = await getPresentation(planId);
      if (mine !== seq.current) return;
      setPresentation(p);
      setFailed(null);
    } catch (e) {
      if (mine !== seq.current) return;
      setFailed(deckFailure(e));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [planId, status]);
  useEffect(() => {
    void load();
  }, [load, refresh]);
  /** Take an answer the server already gave (link, apply, choose) without asking again. */
  const adopt = useCallback((p: LessonPresentation) => {
    seq.current += 1;
    setPresentation(p);
    setFailed(null);
    setLoading(false);
  }, []);
  return { presentation, failed, loading, reload: load, adopt };
}
