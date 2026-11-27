'use client';
/**
 * Section regeneration (LLM-3/LLM-4): optional instruction; confirmation when the teacher edited the section.
 *
 * Never silent (Luis, 27 Nov 2026): a missing prerequisite is shown before anything is sent (Materials needs the
 * class's own materials, and the sheet lets the teacher list them right here), only one request runs at a time, every
 * failure is shown at the top of the sheet with a way to try again, and an empty answer is never written over what the
 * teacher has.
 */
import { useEffect, useRef, useState } from 'react';
import type { ClassRecord, LocalRecord } from '@hiraia/tala-core/contracts';
import { useT } from '@/i18n';
import { useSession } from '@/data/session';
import { getClient } from '@/data/client';
import { newId } from '@/data/ids';
import {
  applyGenerationJob,
  buildGenerationInput,
  enqueue,
  hasObjectives,
  pollJob,
} from '@/data/generation';
import { errorKey } from '@/data/errors';
import { Banner, Button, Sheet, TextArea, TextInput } from '@/components/ui';
import { AiStatus } from '@/components/motion/AiStatus';
import type { AiPhase } from '@/components/motion/ai-status';
import type { PlanEditor } from './usePlanEditor';
import { parseResources, regenBlocker, regenErrorKey, usableResult } from './regen-logic';

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
  const [materialsText, setMaterialsText] = useState('');
  /** The key of the part being rewritten right now (one request at a time, also across close and reopen). */
  const [workingKey, setWorkingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failedOnce, setFailedOnce] = useState(false);
  /** The request's real state for the waiting display: sending until the server answers, then the job's own. */
  const [phase, setPhase] = useState<AiPhase>('sending');
  const [startedAt, setStartedAt] = useState(0);
  const inFlight = useRef(false);
  const ctrl = useRef<AbortController | null>(null);
  const jobId = useRef<string | null>(null);
  const errorBox = useRef<HTMLDivElement | null>(null);
  const online = network.online && network.rung !== 'offline';
  const sectionId = section?.id ?? null;

  // A different part (or a fresh opening) starts clean, unless a request is still running.
  useEffect(() => {
    if (inFlight.current) return;
    setError(null);
    setFailedOnce(false);
    setInstruction('');
    setMaterialsText('');
  }, [sectionId]);
  // A message appears where the teacher is looking (phones scroll a tall sheet), and is announced.
  useEffect(() => {
    if (error) errorBox.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [error]);

  if (!section || !ed.plan || !ed.template) return null;
  const labelOf = (key: string) =>
    ed.template!.sections.find((s) => s.key === key)?.label[lang] ?? key;
  const key = section.data.key;
  const label = labelOf(key);
  const edited = section.data.editedByTeacher;
  const blocker = regenBlocker(key, ed.cls);
  const typed = parseResources(materialsText);
  const working = workingKey !== null;
  const resources = ed.cls ? [...ed.cls.profile.materials, ...ed.cls.profile.textbooks].filter((m) => m.trim()) : [];

  const run = async () => {
    if (inFlight.current || !engine || !ed.plan || !ed.template) return;
    inFlight.current = true;
    setWorkingKey(key);
    setError(null);
    setPhase('sending');
    setStartedAt(Date.now());
    try {
      let cls: ClassRecord | null = ed.cls;
      if (blocker === 'no_class_resources') {
        // The prerequisite, filled in right here: saved to the class exactly as the Class page saves it.
        if (!cls || !typed.length) {
          setError(t('gen.materials.needResources'));
          return;
        }
        cls = { ...cls, profile: { ...cls.profile, materials: typed } };
        await engine.put('class', cls);
      }
      const input = buildGenerationInput({
        plan: ed.plan,
        cls,
        template: ed.template,
        language: ed.plan.language,
        kind: 'section',
        sectionKey: key,
        instruction,
      });
      if (!hasObjectives(input)) {
        setError(t('gen.needsCompetency'));
        return;
      }
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
      const c = new AbortController();
      ctrl.current = c;
      const job = await getClient().call('generation.create', { body: input, signal: c.signal });
      jobId.current = job.id;
      if (job.status === 'queued' || job.status === 'running') setPhase(job.status);
      const finished = await pollJob(getClient(), job.id, c.signal, (j) => {
        if (j.status === 'queued' || j.status === 'running') setPhase(j.status);
      });
      if (finished.status === 'done') {
        // An answer with nothing in the requested part is not applied: what the teacher has stays.
        if (!usableResult(finished, key)) {
          setFailedOnce(true);
          setError(t('gen.failed.empty_output'));
          return;
        }
        const fresh = (await engine.get('plan', ed.plan.id))?.data ?? ed.plan;
        const sections = (await engine.list('plan_section'))
          .filter((s) => s.data.planId === ed.plan!.id)
          .map((s) => s.data);
        await applyGenerationJob(engine, fresh, sections, finished, newId, [section.id]);
        onDone(t('gen.regenDone'));
        onClose();
      } else if (finished.status === 'cancelled') {
        onDone(t('gen.cancelled'));
        onClose();
      } else {
        setFailedOnce(true);
        setError(finished.failure ? t(`gen.failed.${finished.failure.reason}`) : t('gen.failed'));
      }
    } catch (err) {
      if ((err as { name?: string }).name !== 'AbortError') {
        setFailedOnce(true);
        setError(t(regenErrorKey(err) ?? errorKey(err)));
      }
    } finally {
      inFlight.current = false;
      ctrl.current = null;
      jobId.current = null;
      setWorkingKey(null);
    }
  };

  const cancel = async () => {
    ctrl.current?.abort();
    if (jobId.current)
      await getClient()
        .call('generation.cancel', { params: { jobId: jobId.current } })
        .catch(() => {});
  };

  const primaryLabel =
    blocker === 'no_class_resources'
      ? t('gen.materials.saveAndRewrite')
      : failedOnce
        ? t('gen.tryAgain')
        : edited
          ? t('gen.regenConfirm')
          : online
            ? t('gen.regen')
            : t('gen.keepWaiting');

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
            <Button
              variant="ai"
              onClick={() => void run()}
              disabled={blocker === 'no_class_resources' && typed.length === 0}
            >
              {primaryLabel}
            </Button>
          </>
        ) : undefined
      }
    >
      <div ref={errorBox} role="alert" aria-live="assertive">
        {error && <Banner kind="warn">{error}</Banner>}
      </div>
      {working && workingKey !== key && (
        <Banner kind="info">{t('gen.stillWorking', { section: labelOf(workingKey!) })}</Banner>
      )}
      {edited && <Banner kind="warn">{t('gen.regenEdited')}</Banner>}
      {blocker === 'no_class_resources' ? (
        <>
          <Banner kind="info">{t('gen.materials.needResources')}</Banner>
          <TextArea
            label={t('gen.materials.fieldLabel')}
            hint={t('gen.materials.fieldHint')}
            value={materialsText}
            maxLength={4000}
            onChange={(e) => setMaterialsText(e.target.value)}
            disabled={working}
          />
        </>
      ) : (
        key === 'materials' && (
          <p className="text-small text-forestMuted">
            {t('gen.materials.from', { list: resources.join(', ') })}
          </p>
        )
      )}
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
      {working && (
        <AiStatus
          phase={phase}
          startedAt={startedAt}
          label={t('gen.working')}
          onCancel={() => void cancel()}
          reachable={online}
        />
      )}
    </Sheet>
  );
}
