'use client';
/**
 * Background runner for queued and "continue in background" generation requests (LLM-7, RES-8).
 * Mounted once in the app shell: when online it creates jobs for queued requests, polls open jobs, and writes
 * finished drafts into the plan through the sync engine. Nothing is lost if the tab closes: the queue is on the device.
 */
import { useEffect, useRef } from 'react';
import { TalaApiError } from '@hiraia/tala-core/contracts';
import { useSession } from '@/data/session';
import { getClient } from '@/data/client';
import { newId } from '@/data/ids';
import {
  applyGenerationJob,
  dequeue,
  failureReason,
  listQueue,
  recordFailure,
  TERMINAL,
  updateQueued,
} from '@/data/generation';
import { usableResult } from '@/features/editor/regen-logic';

const TICK_MS = 20_000;

export function GenerationRunner() {
  const { engine, cache, network, status } = useSession();
  const busy = useRef(false);

  useEffect(() => {
    if (status !== 'signedIn' || !engine) return;
    const client = getClient();
    const run = async () => {
      if (busy.current || !network.online || network.rung === 'offline') return;
      busy.current = true;
      try {
        for (const item of await listQueue(cache)) {
          try {
            let jobId = item.jobId;
            if (!jobId) {
              const job = await client.call('generation.create', { body: item.input });
              jobId = job.id;
              await updateQueued(cache, item.id, { jobId });
            }
            const job = await client.call('generation.get', { params: { jobId } });
            if (!TERMINAL.includes(job.status)) continue;
            const sectionKey = item.input.kind === 'section' ? (item.input.sectionKey ?? null) : null;
            const failed = (reason: string) =>
              recordFailure(cache, { id: item.id, planId: item.planId, sectionKey, reason, at: new Date().toISOString() });
            if (job.status === 'done' && sectionKey && !usableResult(job, sectionKey)) {
              // An empty part is never written over the teacher's text (27 Nov 2026); she is told instead.
              await failed('empty_output');
            } else if (job.status === 'done') {
              const planRec = await engine.get('plan', item.planId);
              if (planRec && !planRec.deletedAt && planRec.data.state === 'draft') {
                const sections = (await engine.list('plan_section'))
                  .filter((s) => s.data.planId === item.planId)
                  .map((s) => s.data);
                await applyGenerationJob(
                  engine,
                  planRec.data,
                  sections,
                  job,
                  newId,
                  item.confirmedSectionIds
                );
              }
            }
            // failed: kept for the lesson to show (never a silent drop); cancelled was the teacher's own choice.
            if (job.status === 'failed') await failed(job.failure?.reason ?? 'providers_unavailable');
            await dequeue(cache, item.id);
          } catch (err) {
            // Permanent refusals leave the queue and are shown in the lesson; anything retryable waits for the next tick.
            if (err instanceof TalaApiError && !err.retryable && err.code !== 'unauthenticated') {
              await recordFailure(cache, {
                id: item.id,
                planId: item.planId,
                sectionKey: item.input.kind === 'section' ? (item.input.sectionKey ?? null) : null,
                reason: failureReason(err),
                at: new Date().toISOString(),
              });
              await dequeue(cache, item.id);
            }
          }
        }
      } finally {
        busy.current = false;
      }
    };
    void run();
    const t = setInterval(() => void run(), TICK_MS);
    const onOnline = () => void run();
    window.addEventListener('online', onOnline);
    return () => {
      clearInterval(t);
      window.removeEventListener('online', onOnline);
    };
  }, [engine, cache, status, network.online, network.rung]);

  return null;
}
