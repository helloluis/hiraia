'use client';
/** Section regeneration (LLM-3/LLM-4): optional instruction; confirmation when the teacher edited the section. */
import { useRef, useState } from 'react';
import type { LocalRecord } from '@hiraia/tala-core/contracts';
import { useT } from '@/i18n';
import { useSession } from '@/data/session';
import { getClient } from '@/data/client';
import { newId } from '@/data/ids';
import { applyGenerationJob, buildGenerationInput, enqueue, pollJob } from '@/data/generation';
import { errorKey } from '@/data/errors';
import { Banner, Button, Sheet, TextInput, Waiting } from '@/components/ui';
import type { PlanEditor } from './usePlanEditor';

export function RegenSheet({
  section,
  onClose,
  ed,
  onDone,
}: {
  section: LocalRecord<'plan_section'> | null;
  onClose: () => void;
  ed: PlanEditor;
  onDone: (message: string) => void;
}) {
  const { t, lang } = useT();
  const { engine, cache, network } = useSession();
  const [instruction, setInstruction] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  const jobId = useRef<string | null>(null);
  const online = network.online && network.rung !== 'offline';
  if (!section || !ed.plan || !ed.template) return null;
  const label =
    ed.template.sections.find((s) => s.key === section.data.key)?.label[lang] ?? section.data.key;
  const edited = section.data.editedByTeacher;

  const run = async () => {
    if (!engine || !ed.plan || !ed.template) return;
    setError(null);
    const input = buildGenerationInput({
      plan: ed.plan,
      cls: ed.cls,
      template: ed.template,
      language: ed.plan.language,
      kind: 'section',
      sectionKey: section.data.key,
      instruction,
    });
    await ed.flushAll();
    if (!online) {
      await enqueue(cache, {
        id: newId(),
        planId: ed.plan.id,
        input,
        jobId: null,
        confirmedSectionIds: [section.id],
        createdAt: new Date().toISOString(),
      });
      onDone(t('gen.queued'));
      onClose();
      return;
    }
    setWorking(true);
    const c = new AbortController();
    ctrl.current = c;
    try {
      const job = await getClient().call('generation.create', { body: input, signal: c.signal });
      jobId.current = job.id;
      const finished = await pollJob(getClient(), job.id, c.signal);
      if (finished.status === 'done') {
        const fresh = (await engine.get('plan', ed.plan.id))?.data ?? ed.plan;
        const sections = (await engine.list('plan_section'))
          .filter((s) => s.data.planId === ed.plan!.id)
          .map((s) => s.data);
        await applyGenerationJob(engine, fresh, sections, finished, newId, [section.id]);
        onDone(t('gen.regenDone'));
        onClose();
      } else if (finished.status === 'cancelled') onClose();
      else
        setError(finished.failure ? t(`gen.failed.${finished.failure.reason}`) : t('gen.failed'));
    } catch (err) {
      if ((err as { name?: string }).name !== 'AbortError') setError(t(errorKey(err)));
    } finally {
      setWorking(false);
    }
  };

  const cancel = async () => {
    ctrl.current?.abort();
    if (jobId.current)
      await getClient()
        .call('generation.cancel', { params: { jobId: jobId.current } })
        .catch(() => {});
    setWorking(false);
  };

  return (
    <Sheet
      open={!!section}
      onClose={onClose}
      title={`${t('gen.regenTitle')}: ${label}`}
      actions={
        !working ? (
          <>
            <Button variant="quiet" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" onClick={() => void run()}>
              {edited ? t('gen.regenConfirm') : online ? t('gen.regen') : t('gen.keepWaiting')}
            </Button>
          </>
        ) : undefined
      }
    >
      {edited && <Banner kind="warn">{t('gen.regenEdited')}</Banner>}
      <TextInput
        label={t('gen.regenInstruction')}
        optional
        hint={t('gen.regenInstructionHint')}
        value={instruction}
        maxLength={500}
        onChange={(e) => setInstruction(e.target.value)}
        disabled={working}
      />
      <p className="text-small text-forestMuted">{t('gen.notice')}</p>
      {working && <Waiting label={t('gen.working')} onCancel={() => void cancel()} />}
      {error && <Banner kind="warn">{error}</Banner>}
    </Sheet>
  );
}
