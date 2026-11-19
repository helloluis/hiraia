'use client';
/**
 * A teacher's own copy of a pack's slides ("My copy"): typed calls to the owner-only `decks.*` routes, the URLs of a
 * copy's drawings and its PowerPoint file, and small hooks for the screens. The copy lives on the server under the
 * teacher's account; nothing here can reach another teacher's copy.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE, TalaApiError } from '@hiraia/tala-core/contracts';
import type { DeckDetail, DeckSaveResult, DeckSlide, DeckSummary, PackLang } from '@hiraia/tala-core/contracts';
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
