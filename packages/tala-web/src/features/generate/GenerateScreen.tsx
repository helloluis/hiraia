'use client';
/**
 * Lesson generation screen (PRD §9, LLM-1/2/7). Inputs are prefilled from the plan (which came from the slot):
 * competencies per grade group, class profile, time budget, template, language; guidance is optional.
 * Every failure path lands on the pre-filled template with the request kept; offline queues it.
 */
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  TalaApiError,
  type GenerationInput,
  type GenerationJob,
  type Lang,
} from '@hiraia/tala-core/contracts';
import { useT } from '@/i18n';
import { useSession } from '@/data/session';
import { getClient } from '@/data/client';
import { newId } from '@/data/ids';
import {
  applyGenerationJob,
  buildGenerationInput,
  enqueue,
  hasObjectives,
  MULTIGRADE_TEMPLATE,
  pollJob,
  prefillPlan,
  switchTemplate,
  TERMINAL,
} from '@/data/generation';
import { errorKey } from '@/data/errors';
import { topicLabel } from '@/data/topics';
import { usePlanEditor } from '@/features/editor/usePlanEditor';
import { AiStatus } from '@/components/motion/AiStatus';
import { type AiPhase } from '@/components/motion/ai-status';
import {
  Banner,
  Button,
  LinkButton,
  List,
  ListRow,
  PageHeader,
  Placeholder,
  Select,
  TextArea,
} from '@/components/ui';

type Phase = 'form' | 'working' | 'failed';

export function GenerateScreen() {
  const { t, lang } = useT();
  const router = useRouter();
  const params = useSearchParams();
  const planId = params.get('planId') ?? '';
  const { engine, cache, network, config } = useSession();
  const ed = usePlanEditor(planId);
  const [language, setLanguage] = useState<Lang>(lang);
  const [guidance, setGuidance] = useState('');
  const [phase, setPhase] = useState<Phase>('form');
  const [allowance, setAllowance] = useState<{
    fullRemainingToday: number;
    sectionRemainingToday: number;
    degraded: boolean;
  } | null>(null);
  const [failure, setFailure] = useState<{ reason: string; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ctrl = useRef<AbortController | null>(null);
  const jobRef = useRef<GenerationJob | null>(null);
  /** Where the open request really is (not answered yet, waiting its turn, being written) and when it was asked. */
  const [aiPhase, setAiPhase] = useState<AiPhase>('sending');
  const [startedAt, setStartedAt] = useState(0);
  /** One request at a time: a second press while one is open does nothing. */
  const inFlight = useRef(false);
  /**
   * The request as sent for the attempt in progress. Every re-send of ONE attempt carries the same key, so the server
   * answers with the same job and charges once (RES-5); the next attempt is a new request with a new key. Before, the
   * key was fixed for the whole visit, so asking again after a cancel was handed the cancelled job back.
   */
  const attempt = useRef<GenerationInput | null>(null);
  /** This screen is done with the attempt (it ended, was cancelled, or was sent to the background). */
  const settled = useRef(true);
  const online = network.online && network.rung !== 'offline' && network.rung !== 'readonly';

  useEffect(() => {
    if (ed.assignment) setLanguage(ed.assignment.language);
  }, [ed.assignment]);
  useEffect(() => {
    if (!online) return;
    getClient()
      .call('generation.allowance')
      .then(setAllowance)
      .catch(() => {});
  }, [online]);

  // A lesson copied from a Hiraia teaching pack is adapted to the class, not drafted from scratch.
  const fromPack = Boolean(ed.plan?.lineage?.artifactId?.startsWith('pack.'));
  const input = useMemo(
    () =>
      ed.plan && ed.template
        ? {
            ...buildGenerationInput({
              plan: ed.plan,
              cls: ed.cls,
              template: ed.template,
              language,
              guidance,
              kind: fromPack ? 'adapt' : 'full',
            }),
            ...(fromPack ? { targetLanguage: language } : {}),
          }
        : null,
    [ed.plan, ed.cls, ed.template, language, guidance, fromPack]
  );
  const needsMultigrade =
    !!ed.template && !!ed.plan && ed.groups.length > 1 && ed.template.kind !== 'multigrade';
  const featureOff = config ? !config.features.generation : false;
  const noAllowance = allowance ? allowance.fullRemainingToday <= 0 : false;

  const openPrefilled = async (queue: boolean) => {
    if (!engine || !ed.plan || !ed.template || !input) return;
    setBusy(true);
    try {
      await prefillPlan(
        engine,
        ed.plan,
        ed.sections.map((s) => s.data),
        input,
        ed.template,
        ed.competencies
      );
      if (queue) {
        // The same request (same key) only while its outcome is still open or unknown; an attempt that has ended
        // (the service did not answer) is asked afresh, or the queue would only be handed the old failure again.
        const j = jobRef.current;
        const open = attempt.current && (!j || !TERMINAL.includes(j.status));
        settled.current = true;
        await enqueue(cache, {
          id: newId(),
          planId: ed.plan.id,
          input: open ? attempt.current! : { ...input, idempotencyKey: newId() },
          jobId: open && j && j.status === 'queued' ? j.id : null,
          confirmedSectionIds: [],
          createdAt: new Date().toISOString(),
        });
      }
      router.replace(`/lessons/${ed.plan.id}`);
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    if (inFlight.current || !engine || !ed.plan || !input) return;
    setError(null);
    if (!hasObjectives(input)) return setError(t('gen.needsCompetency'));
    if (!online) return void openPrefilled(true);
    inFlight.current = true;
    settled.current = false;
    jobRef.current = null;
    const body: GenerationInput = { ...input, idempotencyKey: newId() };
    attempt.current = body;
    setAiPhase('sending');
    setStartedAt(Date.now());
    setPhase('working');
    const c = new AbortController();
    ctrl.current = c;
    // The waiting state shows the job's own status; a finished status ends it instead of being shown.
    const follow = (j: GenerationJob) => {
      jobRef.current = j;
      if (j.status === 'queued' || j.status === 'running') setAiPhase(j.status);
    };
    try {
      const job = await getClient().call('generation.create', { body, signal: c.signal });
      follow(job);
      const finished = await pollJob(getClient(), job.id, c.signal, follow);
      settled.current = true;
      if (finished.status === 'done') {
        const fresh = (await engine.get('plan', ed.plan.id))?.data ?? ed.plan;
        const sections = (await engine.list('plan_section'))
          .filter((s) => s.data.planId === ed.plan!.id)
          .map((s) => s.data);
        await applyGenerationJob(engine, fresh, sections, finished, newId);
        router.replace(`/lessons/${ed.plan.id}?drafted=1`);
      } else if (finished.status === 'cancelled') {
        setPhase('form');
        setError(t('gen.cancelled'));
      } else {
        setFailure(finished.failure ?? { reason: 'providers_unavailable', message: '' });
        setPhase('failed');
      }
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') {
        setPhase('form');
        return;
      }
      if (err instanceof TalaApiError && err.retryable) {
        // Server trouble looks like bad signal (RES-12): queue it and open the template.
        await openPrefilled(true);
        return;
      }
      setFailure({
        reason: err instanceof TalaApiError ? err.code : 'invalid_input',
        message: err instanceof TalaApiError ? t(errorKey(err)) : '',
      });
      setPhase('failed');
    } finally {
      inFlight.current = false;
      settled.current = true;
    }
  };

  const cancel = async () => {
    settled.current = true;
    const body = attempt.current;
    ctrl.current?.abort();
    // Cancelled before the server's answer reached this screen: the job may exist all the same. The attempt's own key
    // finds it (the same key returns the same job), so nothing keeps writing for a request the teacher withdrew.
    let id = jobRef.current?.id ?? null;
    if (!id && body)
      id =
        (
          await getClient()
            .call('generation.create', { body })
            .catch(() => null)
        )?.id ?? null;
    if (id)
      await getClient()
        .call('generation.cancel', { params: { jobId: id } })
        .catch(() => {});
    setPhase('form');
    setError(t('gen.cancelled'));
  };

  const background = async () => {
    const j = jobRef.current;
    if (!engine || !ed.plan || !input) return;
    settled.current = true;
    ctrl.current?.abort();
    await enqueue(cache, {
      id: newId(),
      planId: ed.plan.id,
      input: attempt.current ?? input,
      jobId: j?.id ?? null,
      confirmedSectionIds: [],
      createdAt: new Date().toISOString(),
    });
    router.replace(`/lessons/${ed.plan.id}?queued=1`);
  };

  // Leaving this page while Tala is still writing does not withdraw the request (Cancel does that). It is handed to
  // the device's queue, exactly as "Run in background" does, so the background runner writes the draft into the
  // lesson once. Before, the closed page went on waiting by itself and then pulled the teacher back to the lesson
  // from wherever she was; and if the tab was closed instead, the finished draft was never written.
  const handOver = useRef<() => void>(() => {});
  handOver.current = () => {
    const body = attempt.current;
    if (settled.current || !body || !ed.plan) return;
    settled.current = true;
    ctrl.current?.abort();
    void enqueue(cache, {
      id: newId(),
      planId: ed.plan.id,
      input: body,
      jobId: jobRef.current?.id ?? null,
      confirmedSectionIds: [],
      createdAt: new Date().toISOString(),
    });
  };
  useEffect(() => {
    const onHide = () => handOver.current();
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      handOver.current();
    };
  }, []);

  if (ed.loading && !ed.plan) return <Placeholder rows={5} />;
  if (!ed.plan || !ed.template) {
    return (
      <>
        <PageHeader title={t('gen.title')} back={{ href: '/lessons', label: t('lessons.title') }} />
        <Banner kind="warn">{t('editor.notFound')}</Banner>
      </>
    );
  }

  const failureKey = failure ? (`gen.failed.${failure.reason}` as const) : null;

  return (
    <div className="flex flex-col gap-4 max-w-[40rem]">
      <PageHeader
        title={fromPack ? t('gen.adaptTitle') : t('gen.title')}
        subtitle={[ed.plan.subjectName, ed.cls?.name].filter(Boolean).join(' · ')}
        back={{ href: `/lessons/${ed.plan.id}`, label: t('common.back') }}
      />
      <p>{fromPack ? t('gen.adaptNotice') : t('gen.intro')}</p>
      <Banner kind="info">{t('gen.notice')}</Banner>

      <List>
        <ListRow title={t('gen.forClass')} subtitle={ed.cls?.name ?? '—'} />
        <ListRow
          title={t('gen.groups')}
          subtitle={ed.groups
            .map(
              (g) =>
                `${t('common.grade', { g: g.grade })}${learners(ed.cls?.gradeGroups.find((x) => x.id === g.id)?.learnerCount, t)}`
            )
            .join(' · ')}
        />
        <ListRow
          title={ed.cls?.curriculum === 'none' ? t('gen.objectives') : t('gen.competencies')}
          subtitle={
            ed.cls?.curriculum === 'none' ? (
              ed.plan.customObjectives.join('; ') || t('editor.noCompetency')
            ) : (
              <span className="flex flex-col gap-1">
                {ed.groups.map((g) => {
                  const ids = ed.plan!.competencies[g.id] ?? [];
                  return (
                    <span key={g.id}>
                      {ed.groups.length > 1 && (
                        <strong className="text-forest">
                          {t('common.grade', { g: g.grade })}:{' '}
                        </strong>
                      )}
                      {ids.length
                        ? ids
                            .map((id) => {
                              const c = ed.competencies.find((x) => x.id === id);
                              return c ? topicLabel(c, lang).heading : id;
                            })
                            .join('; ')
                        : t('editor.noCompetency')}
                    </span>
                  );
                })}
              </span>
            )
          }
        />
        <ListRow title={t('gen.template')} subtitle={ed.template.name[lang]} />
        <ListRow
          title={t('gen.timeBudget')}
          subtitle={t('common.minutes', { n: ed.plan.durationMinutes })}
        />
      </List>

      {needsMultigrade && (
        <Banner
          kind="warn"
          action={
            <Button
              onClick={async () => {
                if (engine && ed.plan)
                  await switchTemplate(
                    engine,
                    ed.plan,
                    ed.sections.map((s) => s.data),
                    MULTIGRADE_TEMPLATE,
                    newId
                  );
              }}
            >
              {MULTIGRADE_TEMPLATE.name[lang]}
            </Button>
          }
        >
          {t('gen.multigradeTemplate')}
        </Banner>
      )}

      {phase === 'form' && (
        <>
          <Select
            label={t('gen.language')}
            value={language}
            onChange={(e) => setLanguage(e.target.value as Lang)}
          >
            <option value="fil">{t('lang.fil')}</option>
            <option value="en">{t('lang.en')}</option>
          </Select>
          <TextArea
            label={t('gen.guidance')}
            optional
            hint={t('gen.guidanceHint')}
            value={guidance}
            maxLength={1000}
            onChange={(e) => setGuidance(e.target.value)}
          />
          {allowance && (
            <p className="text-small text-forestMuted">
              {noAllowance
                ? t('gen.allowanceNone')
                : t('gen.allowance', {
                    full: allowance.fullRemainingToday,
                    section: allowance.sectionRemainingToday,
                  })}
              {allowance.degraded ? ` ${t('gen.degraded')}` : ''}
            </p>
          )}
          {!online && <Banner kind="info">{t('gen.queued')}</Banner>}
          {featureOff && <Banner kind="info">{t('gen.failed.disabled')}</Banner>}
          {error && <Banner kind="warn">{error}</Banner>}
          {input && !hasObjectives(input) && (
            <Banner kind="warn">{t('gen.needsCompetency')}</Banner>
          )}
          <Button
            variant="primary"
            full
            onClick={() => void start()}
            disabled={
              needsMultigrade || featureOff || noAllowance || !input || !hasObjectives(input)
            }
            busy={busy}
          >
            {online ? t('gen.start') : t('gen.keepWaiting')}
          </Button>
          <Button full onClick={() => void openPrefilled(false)} disabled={busy}>
            {t('gen.usePrefilled')}
          </Button>
        </>
      )}

      {phase === 'working' && (
        <>
          <AiStatus
            phase={aiPhase}
            startedAt={startedAt}
            label={t('gen.working')}
            onCancel={() => void cancel()}
            canBackground
            reachable={network.online && network.rung !== 'offline'}
          />
          <Button full onClick={() => void background()}>
            {t('gen.background')}
          </Button>
          <p className="text-small text-forestMuted">{t('gen.backgroundNote')}</p>
        </>
      )}

      {phase === 'failed' && failure && (
        <>
          <Banner kind="warn">
            {failureKey && isKnownFailure(failure.reason)
              ? t(failureKey as never)
              : failure.message || t('gen.failed')}
          </Banner>
          <p>{t('gen.prefilledNote')}</p>
          <Button variant="primary" full onClick={() => void openPrefilled(false)} busy={busy}>
            {t('gen.usePrefilled')}
          </Button>
          {failure.reason === 'providers_unavailable' && (
            <Button full onClick={() => void openPrefilled(true)} disabled={busy}>
              {t('gen.keepWaiting')}
            </Button>
          )}
          <LinkButton href={`/lessons/${ed.plan.id}`} variant="quiet" full>
            {t('common.back')}
          </LinkButton>
        </>
      )}
    </div>
  );
}

function learners(
  n: number | null | undefined,
  t: (k: 'gen.learnersN', v: { n: number }) => string
): string {
  return n ? ` (${t('gen.learnersN', { n })})` : '';
}

function isKnownFailure(reason: string): boolean {
  return [
    'providers_unavailable',
    'invalid_output',
    'quota_exceeded',
    'budget_exceeded',
    'disabled',
    'invalid_input',
  ].includes(reason);
}
