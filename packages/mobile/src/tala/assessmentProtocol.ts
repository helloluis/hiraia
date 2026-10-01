/** Bounded, name-free assessment summary wire contract. Keep Kotlin/server validators aligned. */
export const ASSESSMENT_CAP = 'assessment_summary_v1';
export const ASSESSMENT_EVENT_BYTES = 4096;
export const SYNC_BATCH_BYTES = 90_000;
const SESSION = /^ha-[a-f0-9]{24}$/;
const HASH = /^[a-f0-9]{64}$/;
const TARGET = /^g(?:[3-9]|10)-[a-z0-9-]{1,96}$/;
const LABEL = /^[A-Za-z0-9_.:-]{1,100}$/;
const PROFILE = /^[A-Za-z0-9_-]{16,80}$/;
const required = new Set([
  'grade',
  'language',
  'profile_kind',
  'assessment_id',
  'assessment_kind',
  'assessment_mode',
  'assessment_blueprint',
  'assessment_segment',
  'assessment_bank',
  'assessment_blueprint_revision',
  'assessment_correct',
  'assessment_total',
  'benchmark_correct',
  'benchmark_total',
  'recent_correct',
  'recent_total',
  'readiness_correct',
  'readiness_total',
  'assessment_curriculum',
  'assessment_clock',
  'assessment_support',
  'assessment_targets',
  'assessment_repeats',
]);
const optional = new Set([
  'profile_id',
  'assessment_previous_at',
  'assessment_benchmark_change',
  'app_version',
  'build',
  'hiraiapedia_version',
  'cards_db_version',
  'android',
  'abi',
  'ram_gb',
]);
export function utf8Bytes(value: string): number {
  let length = 0;
  for (const c of value) {
    const p = c.codePointAt(0)!;
    length += p < 128 ? 1 : p < 2048 ? 2 : p < 65536 ? 3 : 4;
  }
  return length;
}
const integer = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
export function validAssessmentEvent(event: {
  id: string;
  name: string;
  occurred_at: number;
  session_id: string;
  props: Record<string, unknown>;
}): boolean {
  const p = event.props;
  if (
    event.name !== 'assessment_completed' ||
    !p ||
    utf8Bytes(JSON.stringify(event)) > ASSESSMENT_EVENT_BYTES ||
    Object.keys(p).some((key) => !required.has(key) && !optional.has(key)) ||
    [...required].some((key) => !(key in p))
  )
    return false;
  if (
    typeof p.assessment_id !== 'string' ||
    !SESSION.test(p.assessment_id) ||
    event.id !== `assessment_completed-${p.assessment_id}` ||
    event.session_id !== p.assessment_id ||
    !integer(event.occurred_at, 1577836800000, 8640000000000000) ||
    !integer(p.grade, 3, 10) ||
    !['english', 'tagalog', 'cebuano'].includes(String(p.language)) ||
    !['guest', 'student'].includes(String(p.profile_kind)) ||
    (p.profile_kind === 'student'
      ? typeof p.profile_id !== 'string' || !PROFILE.test(p.profile_id)
      : 'profile_id' in p)
  )
    return false;
  if (
    !['baseline', 'followup'].includes(String(p.assessment_kind)) ||
    !['local_evaluation', 'production'].includes(String(p.assessment_mode)) ||
    !['unverified', 'confirmed'].includes(String(p.assessment_curriculum)) ||
    p.assessment_clock !== 'device_time_unverified' ||
    !['none', 'read_aloud'].includes(String(p.assessment_support)) ||
    typeof p.assessment_blueprint !== 'string' ||
    !LABEL.test(p.assessment_blueprint)
  )
    return false;
  for (const key of ['assessment_segment', 'assessment_bank', 'assessment_blueprint_revision'])
    if (typeof p[key] !== 'string' || !HASH.test(p[key] as string)) return false;
  if (
    p.assessment_total !== 12 ||
    p.benchmark_total !== 6 ||
    !integer(p.assessment_correct, 0, 12) ||
    !integer(p.benchmark_correct, 0, 6) ||
    !integer(p.recent_total, 0, 6) ||
    !integer(p.readiness_total, 0, 6) ||
    p.recent_total + p.readiness_total !== 6 ||
    !integer(p.recent_correct, 0, p.recent_total) ||
    !integer(p.readiness_correct, 0, p.readiness_total) ||
    p.benchmark_correct + p.recent_correct + p.readiness_correct !== p.assessment_correct ||
    !integer(p.assessment_repeats, 0, 2)
  )
    return false;
  if ('assessment_previous_at' in p !== 'assessment_benchmark_change' in p) return false;
  if (
    'assessment_previous_at' in p &&
    (!integer(p.assessment_previous_at, 1, event.occurred_at) ||
      !integer(p.assessment_benchmark_change, -6, 6))
  )
    return false;
  if (typeof p.assessment_targets !== 'string' || p.assessment_targets.length > 1800) return false;
  let rows: unknown;
  try {
    rows = JSON.parse(p.assessment_targets);
  } catch {
    return false;
  }
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 12) return false;
  const targets = new Set<string>();
  let correct = 0,
    total = 0;
  for (const row of rows) {
    if (
      !Array.isArray(row) ||
      row.length !== 3 ||
      typeof row[0] !== 'string' ||
      !TARGET.test(row[0]) ||
      targets.has(row[0]) ||
      !integer(row[2], 1, 12) ||
      !integer(row[1], 0, row[2])
    )
      return false;
    targets.add(row[0]);
    correct += row[1];
    total += row[2];
  }
  if (total !== 12 || correct !== p.assessment_correct) return false;
  for (const key of optional) {
    if (
      !(key in p) ||
      ['profile_id', 'assessment_previous_at', 'assessment_benchmark_change'].includes(key)
    )
      continue;
    if (key === 'ram_gb') {
      if (
        typeof p[key] !== 'number' ||
        !Number.isFinite(p[key]) ||
        (p[key] as number) < 0 ||
        (p[key] as number) > 1e12
      )
        return false;
    } else if (typeof p[key] !== 'string' || !LABEL.test(p[key] as string)) return false;
  }
  return true;
}
