'use client';
/**
 * One lesson's AI request for slides, from asking to applying: start it (after the lesson's edits have reached the
 * server: the slides are made from the lesson as saved), follow it until it ends, then apply the proposal or keep
 * the slides as they are. Nothing is written into a deck until `apply`. A request that is already being worked on
 * (another tab, a reload) is followed, never started again. Every way it can end without a proposal is a `trouble`
 * the screen says in words, with the slides unchanged and a way to try again.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { LessonPresentation, SlidesAiScope, SlidesJob } from '@hiraia/tala-core/contracts';
import { applySlidesAi, discardSlidesAi, getSlidesAi, slidesAiTrouble, startSlidesAi, type SlidesAiTrouble } from '@/data/decks';

export type SlidesAiPhase = 'idle' | 'starting' | 'working' | 'ready' | 'applying' | 'conflict' | 'failed';

const POLL_MS = [1200, 1500, 2000, 3000];

export function useSlidesAi(
  planId: string | null,
  opts: {
    /** The job the presentation says is open for this lesson (after a reload). */
    initial?: SlidesJob | null;
    /** Send the device's edits first; false when they could not reach the server. */
    beforeStart?: () => Promise<boolean>;
    /** The proposal was applied: the server's new presentation, and what the proposal covered. */
    onApplied?: (p: LessonPresentation, scope: SlidesAiScope) => void;
  } = {}
) {
  const [job, setJob] = useState<SlidesJob | null>(null);
  const [phase, setPhase] = useState<SlidesAiPhase>('idle');
  const [trouble, setTrouble] = useState<SlidesAiTrouble | null>(null);
  const live = useRef({ alive: true, polling: null as string | null, timer: null as ReturnType<typeof setTimeout> | null, tries: 0 });
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const settle = useCallback((j: SlidesJob) => {
    setJob(j);
    if (j.status === 'ready') {
      setPhase('ready');
      setTrouble(null);
    } else if (j.status === 'failed') {
      setPhase('failed');
      setTrouble(j.failure?.reason ?? 'server');
    } else if (j.status === 'queued' || j.status === 'running') setPhase('working');
    else setPhase('idle');
  }, []);

  const follow = useCallback(
    (j: SlidesJob) => {
      const L = live.current;
      if (!planId) return;
      if (L.timer) clearTimeout(L.timer);
      L.polling = j.id;
      L.tries = 0;
      const tick = async () => {
        if (!L.alive || L.polling !== j.id) return;
        try {
          const next = await getSlidesAi(planId, j.id);
          if (!L.alive || L.polling !== j.id) return;
          settle(next);
          if (next.status === 'queued' || next.status === 'running') {
            L.tries += 1;
            L.timer = setTimeout(tick, POLL_MS[Math.min(L.tries, POLL_MS.length - 1)]);
          } else L.polling = null;
        } catch (e) {
          if (!L.alive || L.polling !== j.id) return;
          // No connection for a moment: keep following, a little slower; the request goes on on the server.
          const why = slidesAiTrouble(e);
          if (why === 'offline' || why === 'server') {
            setTrouble('offline');
            L.timer = setTimeout(tick, 5000);
          } else {
            setPhase('failed');
            setTrouble(why);
            L.polling = null;
          }
        }
      };
      L.timer = setTimeout(tick, POLL_MS[0]);
    },
    [planId, settle]
  );

  // A request already open for this lesson (a reload, another tab) is picked up where it is.
  const initialId = opts.initial?.id ?? null;
  useEffect(() => {
    const j = optsRef.current.initial;
    if (!j || live.current.polling === j.id) return;
    settle(j);
    if (j.status === 'queued' || j.status === 'running') follow(j);
  }, [initialId, follow, settle]);

  useEffect(() => {
    const L = live.current;
    L.alive = true;
    return () => {
      L.alive = false;
      if (L.timer) clearTimeout(L.timer);
    };
  }, []);

  const start = useCallback(
    async (scope: SlidesAiScope, more: { slideId?: string; instruction?: string; deckId?: string } = {}): Promise<boolean> => {
      if (!planId || phase === 'starting' || phase === 'working' || phase === 'applying') return false;
      setPhase('starting');
      setTrouble(null);
      try {
        const sent = (await optsRef.current.beforeStart?.()) ?? true;
        if (!sent) {
          setPhase('failed');
          setTrouble('unsynced');
          return false;
        }
        const j = await startSlidesAi(planId, { scope, ...more });
        if (!live.current.alive) return false;
        settle(j);
        if (j.status === 'queued' || j.status === 'running') follow(j);
        return true;
      } catch (e) {
        setPhase('failed');
        setTrouble(slidesAiTrouble(e));
        return false;
      }
    },
    [planId, phase, follow, settle]
  );

  const apply = useCallback(
    async (force = false): Promise<boolean> => {
      if (!planId || !job || job.status !== 'ready') return false;
      setPhase('applying');
      try {
        const p = await applySlidesAi(planId, job.id, force);
        setJob(null);
        setPhase('idle');
        setTrouble(null);
        optsRef.current.onApplied?.(p, job.scope);
        return true;
      } catch (e) {
        const why = slidesAiTrouble(e);
        if (why === 'conflict') {
          setPhase('conflict');
          setTrouble(null);
        } else {
          setPhase('ready');
          setTrouble(why);
        }
        return false;
      }
    },
    [planId, job]
  );

  /** "Keep mine" (or dismiss a failure, or stop waiting): the proposal is dropped on the server too. */
  const discard = useCallback(async () => {
    const j = job;
    live.current.polling = null;
    setJob(null);
    setPhase('idle');
    setTrouble(null);
    if (planId && j) await discardSlidesAi(planId, j.id).catch(() => {});
  }, [planId, job]);

  return { job, phase, trouble, start, apply, discard, busy: phase === 'starting' || phase === 'working' || phase === 'applying' };
}

export type SlidesAi = ReturnType<typeof useSlidesAi>;
