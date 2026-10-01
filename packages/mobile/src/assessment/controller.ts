import { sha256 } from './hash';
import { FORTNIGHT_MS, languageKey, resultFor, selectAssessment, validTime } from './selection';
import { decodeAssessmentData, type AssessmentStorage } from './storage';
import type {
  AdmissionMode,
  AnswerInput,
  AssessmentContext,
  AssessmentData,
  AssessmentExposure,
  AssessmentRegistry,
  AssessmentSnapshot,
  ExposureInput,
} from './types';

export const initialAssessmentSnapshot: AssessmentSnapshot = {
  loaded: false,
  busy: false,
  error: '',
  activeSession: null,
  results: null,
  history: [],
  completed: 0,
  due: false,
  needsBaseline: false,
  eligible: false,
  unavailableReason: '',
};

export function createAssessmentController(options: {
  registry: AssessmentRegistry;
  mode: AdmissionMode;
  storage: AssessmentStorage;
  now?: () => string;
  seed?: () => string;
  monotonic?: () => number;
  reportingPolicy?: () => Promise<{ enabled: boolean; epoch: string }>;
}) {
  const now = options.now ?? (() => new Date().toISOString());
  const seed = options.seed ?? (() => `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const monotonic =
    options.monotonic ??
    (() =>
      (globalThis as unknown as { performance?: { now(): number } }).performance?.now() ??
      Date.now());
  let data: AssessmentData | null = null,
    context: AssessmentContext | null = null;
  let snapshot: AssessmentSnapshot = { ...initialAssessmentSnapshot };
  const listeners = new Set<() => void>();
  let queue: Promise<void> = Promise.resolve(),
    retryAction: (() => Promise<void>) | null = null;
  let availabilityCache: { key: string; ok: boolean; reason: string; baseline: boolean } | null =
    null;
  let clockAnchor: { wall: number; elapsed: number } | null = null;
  function clockProblem(current: string): string {
    const at = validTime(current),
      authored = validTime(options.registry.authoredAt);
    if (at === null || authored === null || at < authored - 86400000)
      return 'The device date is earlier than this assessment bank. Check the date before continuing.';
    const observed = data?.lastObservedAt ? validTime(data.lastObservedAt) : null;
    if (observed !== null && at < observed)
      return 'The device date is earlier than saved progress. Check the date before continuing.';
    if (
      clockAnchor &&
      Math.abs(at - clockAnchor.wall - (monotonic() - clockAnchor.elapsed)) > 5 * 60000
    )
      return 'The device clock changed while the app was open. Check the date, then reopen the app.';
    return '';
  }
  function publish(patch: Partial<AssessmentSnapshot> = {}) {
    if (data && context) {
      const current = now(),
        at = validTime(current),
        gradeHistory = data.history.filter((r) => r.session.grade === context!.grade),
        last = gradeHistory.at(-1),
        lastAt = last ? validTime(last.completedAt) : null;
      // No fabricated elapsed fortnight if the clock is invalid or moves backwards.
      const problem = clockProblem(current);
      const due =
        !problem &&
        !!last &&
        at !== null &&
        lastAt !== null &&
        at >= lastAt &&
        at - lastAt >= FORTNIGHT_MS;
      const cacheKey = JSON.stringify([
        context,
        data.history.length,
        data.exposures,
        current.slice(0, 16),
        options.registry.inputHash,
      ]);
      if (!availabilityCache || availabilityCache.key !== cacheKey) {
        const selected = problem
          ? { ok: false as const, reason: problem }
          : selectAssessment(
              options.registry,
              context,
              data,
              current,
              'availability',
              options.mode
            );
        availabilityCache = {
          key: cacheKey,
          ok: selected.ok,
          reason: selected.ok ? '' : selected.reason,
          baseline: selected.ok && selected.session.kind === 'baseline',
        };
      }
      const needsBaseline = availabilityCache.baseline;
      snapshot = {
        ...snapshot,
        loaded: true,
        activeSession: data.activeSession,
        history: data.history,
        completed: data.history.length,
        needsBaseline,
        due: due || (data.history.length > 0 && needsBaseline),
        results: data.history.find((r) => r.session.id === data!.pendingResultsId) ?? null,
        eligible: !!data.activeSession || availabilityCache.ok,
        unavailableReason: availabilityCache.reason,
        ...patch,
      };
    } else snapshot = { ...snapshot, ...patch };
    listeners.forEach((listener) => listener());
  }
  function run(action: () => Promise<void>, retryable = true, kind = 'action'): Promise<void> {
    const work = async () => {
      const preserve = kind === 'hydrate' && !!data?.activeSession && !!retryAction;
      publish(retryable && !preserve ? { busy: true, error: '' } : { busy: true });
      try {
        await action();
        if (retryable && !preserve) retryAction = null;
        publish({ busy: false });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Assessment could not be saved. Try again.';
        if (retryable) {
          retryAction = action;
          publish({ busy: false, error: message });
        } else {
          publish({ busy: false });
          console.warn('Assessment exposure was not saved:', message);
        }
      }
    };
    queue = queue.then(work, work);
    return queue;
  }
  async function commit(next: AssessmentData) {
    // A single SQLite setting write atomically persists session + answer + completion history.
    // Never publish next before the disk write resolves.
    const observed = now(),
      observedAt = validTime(observed),
      previousAt = next.lastObservedAt ? validTime(next.lastObservedAt) : null;
    const saved = {
      ...next,
      lastObservedAt:
        observedAt !== null && (previousAt === null || observedAt >= previousAt)
          ? observed
          : next.lastObservedAt,
    };
    await options.storage.save(saved.profileId, JSON.stringify(saved), options.mode);
    data = saved;
    availabilityCache = null;
  }
  function requireLoaded() {
    if (!data || !context) throw new Error('Assessment data has not loaded. Try again.');
    return { data, context };
  }
  async function load(next: AssessmentContext) {
    languageKey(next.language);
    if (!next.profileId || !Number.isInteger(next.grade))
      throw new Error('A student profile and grade are required.');
    if (context?.profileId === next.profileId && data) {
      context = { ...next };
      return;
    }
    // Clear the old profile immediately; never show its answers under the new identity.
    data = null;
    context = { ...next };
    availabilityCache = null;
    snapshot = { ...initialAssessmentSnapshot, busy: true };
    listeners.forEach((listener) => listener());
    const loaded = decodeAssessmentData(
      await options.storage.load(next.profileId, options.mode),
      next.profileId
    );
    if (
      (loaded.activeSession?.admissionMode &&
        loaded.activeSession.admissionMode !== options.mode) ||
      loaded.history.some((r) => r.session.admissionMode !== options.mode)
    )
      throw new Error(
        'Saved assessment admission mode does not match this build. Progress has been kept for recovery.'
      );
    data = loaded;
    const at = validTime(now());
    clockAnchor = at === null ? null : { wall: at, elapsed: monotonic() };
  }
  async function start() {
    const loaded = requireLoaded();
    if (loaded.data.activeSession || loaded.data.pendingResultsId) return;
    const current = now(),
      at = validTime(current),
      last = loaded.data.history.at(-1);
    const problem = clockProblem(current);
    if (problem) throw new Error(problem);
    if (at === null || (last && at < validTime(last.completedAt)!))
      throw new Error(
        'The device date is earlier than your saved progress. Check the date and try again.'
      );
    const selection = selectAssessment(
      options.registry,
      loaded.context,
      loaded.data,
      current,
      seed(),
      options.mode
    );
    if (!selection.ok) throw new Error(selection.reason);
    await commit({ ...loaded.data, pendingStart: false, activeSession: selection.session });
  }
  const api = {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    hydrate: (next: AssessmentContext) =>
      run(
        async () => {
          await load(next);
          if (data!.pendingStart) await start();
        },
        true,
        'hydrate'
      ),
    begin: (next: AssessmentContext) =>
      run(async () => {
        await load(next);
        await start();
      }),
    requestStart: (next: AssessmentContext) =>
      run(async () => {
        await load(next);
        if (!data!.activeSession && !data!.pendingResultsId)
          await commit({ ...data!, pendingStart: true });
        await start();
      }),
    answer: (input: AnswerInput) =>
      run(async () => {
        const { data: current } = requireLoaded();
        const session = current.activeSession;
        if (!session) {
          const completed = current.history.find((r) => r.session.id === input.sessionId);
          if (
            completed?.session.answers.some(
              (a) => a.itemId === input.itemId && a.optionId === input.optionId
            )
          )
            return;
          throw new Error('This assessment is no longer active.');
        }
        if (session.id !== input.sessionId)
          throw new Error('This answer belongs to another assessment.');
        const previous = session.answers.find((a) => a.itemId === input.itemId);
        if (previous) {
          if (previous.optionId === input.optionId) return;
          throw new Error('This question was already answered.');
        }
        // Every frozen question is available from the start. Answers remain an
        // append-only event sequence; item identity, not its position, owns a choice.
        const question = session.items.find((item) => item.itemId === input.itemId);
        if (
          !question ||
          question.id !== input.itemId ||
          !question.options.some((o) => o.id === input.optionId)
        )
          throw new Error('This answer does not match a question in this assessment.');
        const answeredAt = now(),
          at = validTime(answeredAt),
          lastAt = validTime(session.answers.at(-1)?.answeredAt ?? session.startedAt);
        const problem = clockProblem(answeredAt);
        if (problem) throw new Error(problem);
        if (at === null || lastAt === null || at < lastAt)
          throw new Error(
            'The device date moved backwards. Check the date before saving this answer.'
          );
        const nextSession = {
          ...session,
          answers: [
            ...session.answers,
            {
              itemId: input.itemId,
              optionId: input.optionId,
              answeredAt,
              supportUsed: input.supportUsed ?? ('none' as const),
            },
          ],
        };
        if (nextSession.answers.length === 12) {
          const result = resultFor(nextSession, answeredAt, current.history);
          // Capture consent with the durable result. A telemetry database failure cannot
          // prevent completion, and an unrecorded/disabled decision is never replayed later.
          try {
            const policy = await options.reportingPolicy?.();
            if (policy?.enabled && /^[A-Za-z0-9_-]{16,80}$/.test(policy.epoch))
              result.reporting = { consentEpoch: policy.epoch };
          } catch {
            // The complete learning record is still saved locally.
          }
          await commit({
            ...current,
            activeSession: null,
            history: [...current.history, result],
            pendingResultsId: session.id,
          });
        } else await commit({ ...current, activeSession: nextSession });
      }),
    dismissResults: () =>
      run(async () => {
        const { data: current } = requireLoaded();
        await commit({ ...current, pendingResultsId: null });
      }),
    dismissError: () =>
      run(async () => {
        const { data: current } = requireLoaded();
        if (current.activeSession)
          throw new Error('Finish or recover the active assessment before leaving.');
        await commit({ ...current, pendingStart: false });
      }),
    cancelStart: () =>
      run(async () => {
        const { data: current } = requireLoaded();
        if (current.activeSession)
          throw new Error('Finish or recover the active assessment before leaving.');
        await commit({ ...current, pendingStart: false });
      }),
    recordExposure: (input: ExposureInput) => {
      const exposureProfile = context?.profileId;
      return run(async () => {
        const { data: current } = requireLoaded();
        if (current.profileId !== exposureProfile) return;
        const language = languageKey(input.language),
          currentTime = now(),
          nowAt = validTime(currentTime);
        if (clockProblem(currentTime)) return;
        const at =
          typeof input.timestamp === 'number' && Number.isFinite(input.timestamp)
            ? new Date(input.timestamp).toISOString()
            : (input.timestamp ?? currentTime);
        const eventAt = validTime(at);
        if (
          nowAt === null ||
          eventAt === null ||
          eventAt > nowAt ||
          eventAt < nowAt - FORTNIGHT_MS ||
          !input.exactRenderedBody
        )
          return;
        const hash = sha256(input.exactRenderedBody);
        const links = options.registry.items
          .flatMap((i) => i.teachingLinks)
          .filter((link) => link.cardId === input.cardId && link.hashes[language] === hash);
        if (!links.length) return;
        const families = [...new Set(links.map((link) => link.familyId))];
        const fresh: AssessmentExposure[] = families.map((familyId) => ({
          cardId: input.cardId,
          language,
          familyId,
          presentedTextSha256: hash,
          at: at as string,
          knowledgePresented: true,
        }));
        const keys = new Set(
          fresh.map((e) => `${e.cardId}|${e.language}|${e.familyId}|${e.presentedTextSha256}`)
        );
        const retained = current.exposures.filter(
          (e) =>
            validTime(e.at)! >= nowAt - FORTNIGHT_MS &&
            !keys.has(`${e.cardId}|${e.language}|${e.familyId}|${e.presentedTextSha256}`)
        );
        await commit({ ...current, exposures: [...retained, ...fresh] });
      }, false);
    },
    retry: () => {
      const action = retryAction;
      return action ? run(action) : Promise.resolve();
    },
  };
  return api;
}
