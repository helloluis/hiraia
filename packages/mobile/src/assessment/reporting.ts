import type { Event, Props } from '../telemetry/core';
import type { AssessmentResult } from './types';

const LANGUAGES = { en: 'english', tl: 'tagalog', bis: 'cebuano' } as const;
const CONTEXT_KEYS = new Set([
  'app_version',
  'build',
  'hiraiapedia_version',
  'cards_db_version',
  'android',
  'abi',
  'ram_gb',
]);

/** Deliberately constructs a summary: no object spreading of answers, names or content. */
export function assessmentReport(result: AssessmentResult, context: Props = {}): Event | null {
  if (!result.reporting) return null;
  const session = result.session;
  const props: Props = {};
  for (const [key, value] of Object.entries(context)) if (CONTEXT_KEYS.has(key)) props[key] = value;
  Object.assign(props, {
    profile_kind: session.profileId === 'guest' ? 'guest' : 'student',
    ...(session.profileId === 'guest' ? {} : { profile_id: session.profileId }),
    grade: session.grade,
    language: LANGUAGES[session.language],
    assessment_id: session.id,
    assessment_kind: session.kind,
    assessment_mode: session.admissionMode,
    assessment_blueprint: session.blueprintId,
    assessment_segment: session.comparisonKey,
    assessment_bank: session.registryInputHash,
    assessment_blueprint_revision: session.blueprintRevision,
    assessment_correct: result.score.correct,
    assessment_total: result.score.total,
    benchmark_correct: result.benchmark.correct,
    benchmark_total: result.benchmark.total,
    recent_correct: result.recent.correct,
    recent_total: result.recent.total,
    readiness_correct: result.readiness.correct,
    readiness_total: result.readiness.total,
    assessment_repeats: session.exactRepeats,
    assessment_curriculum: session.curriculumMatch,
    assessment_clock: session.clockTrust,
    assessment_support: session.answers.some((a) => a.supportUsed === 'read_aloud')
      ? 'read_aloud'
      : 'none',
    assessment_targets: JSON.stringify(
      result.targetInsights.map((t) => [t.targetId, t.correct, t.total])
    ),
    ...(result.comparison
      ? {
          assessment_previous_at: Date.parse(result.comparison.previousCompletedAt),
          assessment_benchmark_change: result.comparison.benchmarkDifference,
        }
      : {}),
  });
  return {
    id: `assessment_completed-${session.id}`,
    name: 'assessment_completed',
    session_id: session.id,
    occurred_at: Date.parse(result.completedAt),
    props,
  };
}

/** Failed writes stay pending; the durable assessment history reconstructs this after a crash. */
export class AssessmentReportQueue {
  private pending = new Map<string, AssessmentResult>();
  private finished = new Set<string>();
  private running: Promise<void> | null = null;
  constructor(private stage: (result: AssessmentResult) => Promise<void>) {}
  offer(history: AssessmentResult[]) {
    for (const result of history)
      if (result.reporting && !this.finished.has(result.session.id))
        this.pending.set(result.session.id, result);
    void this.flush();
  }
  async flush(): Promise<void> {
    if (this.running) return this.running;
    this.running = (async () => {
      for (const [id, result] of this.pending) {
        try {
          await this.stage(result);
          this.pending.delete(id);
          this.finished.add(id);
        } catch {
          // A later foreground retry will reconcile it. Learning never waits for export.
        }
      }
    })();
    try {
      await this.running;
    } finally {
      this.running = null;
    }
  }
}
