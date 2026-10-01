import type { Event } from './store';

const SESSION = /^ha-[a-f0-9]{24}$/;
const HASH = /^[a-f0-9]{64}$/;
const LABEL = /^[a-zA-Z0-9_.:-]{1,100}$/;
const TARGET = /^g(?:[3-9]|10)-[a-z0-9-]{1,96}$/;
const CONTEXT = new Set(['app_version', 'build', 'hiraiapedia_version', 'cards_db_version', 'android', 'abi']);
const REQUIRED = [
  'assessment_id', 'assessment_kind', 'assessment_mode', 'assessment_blueprint',
  'assessment_segment', 'assessment_bank', 'assessment_blueprint_revision',
  'assessment_correct', 'assessment_total', 'benchmark_correct', 'benchmark_total',
  'recent_correct', 'recent_total', 'readiness_correct', 'readiness_total',
  'assessment_repeats', 'assessment_curriculum', 'assessment_clock', 'assessment_support',
  'assessment_targets', 'grade', 'language', 'profile_kind',
];
const ALLOWED = new Set([...REQUIRED, ...CONTEXT, 'profile_id', 'ram_gb',
  'assessment_previous_at', 'assessment_benchmark_change']);
const integer = (value: unknown, low: number, high: number): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= low && value <= high;
const member = (value: unknown, choices: string[]) => typeof value === 'string' && choices.includes(value);

/** Strict schema shared in tools/pilot-telemetry/ASSESSMENT-CONTRACT.md. No child text. */
export function validAssessment(event: Event): boolean {
  const p = event.props;
  if (event.occurred_at < 1577836800000) return false;
  if (Object.keys(p).some((key) => !ALLOWED.has(key)) || REQUIRED.some((key) => !Object.hasOwn(p, key))) return false;
  if (typeof p.assessment_id !== 'string' || !SESSION.test(p.assessment_id)
    || event.id !== `assessment_completed-${p.assessment_id}` || event.session_id !== p.assessment_id) return false;
  if (!member(p.assessment_kind, ['baseline', 'followup'])
    || !member(p.assessment_mode, ['local_evaluation', 'production'])
    || !member(p.assessment_curriculum, ['unverified', 'confirmed'])
    || p.assessment_clock !== 'device_time_unverified'
    || !member(p.assessment_support, ['none', 'read_aloud'])
    || !member(p.language, ['english', 'tagalog', 'cebuano'])
    || !member(p.profile_kind, ['guest', 'student']) || !integer(p.grade, 3, 10)) return false;
  if (typeof p.assessment_blueprint !== 'string' || !LABEL.test(p.assessment_blueprint)) return false;
  for (const key of ['assessment_segment', 'assessment_bank', 'assessment_blueprint_revision']) {
    if (typeof p[key] !== 'string' || !HASH.test(p[key] as string)) return false;
  }
  for (const key of CONTEXT) if (p[key] !== undefined && (typeof p[key] !== 'string' || !LABEL.test(p[key] as string))) return false;
  if (p.ram_gb !== undefined && (typeof p.ram_gb !== 'number' || !Number.isFinite(p.ram_gb) || p.ram_gb < 0 || p.ram_gb > 1e12)) return false;
  if (p.assessment_total !== 12 || p.benchmark_total !== 6 || !integer(p.assessment_correct, 0, 12)
    || !integer(p.benchmark_correct, 0, 6) || !integer(p.recent_total, 0, 6)
    || !integer(p.readiness_total, 0, 6) || !integer(p.recent_correct, 0, p.recent_total)
    || !integer(p.readiness_correct, 0, p.readiness_total) || !integer(p.assessment_repeats, 0, 2)
    || p.recent_total + p.readiness_total !== 6
    || p.benchmark_correct + p.recent_correct + p.readiness_correct !== p.assessment_correct) return false;
  const previous = p.assessment_previous_at, change = p.assessment_benchmark_change;
  if ((previous === undefined) !== (change === undefined)) return false;
  if (previous !== undefined && (!integer(previous, 1, event.occurred_at) || !integer(change, -6, 6))) return false;
  if (typeof p.assessment_targets !== 'string' || p.assessment_targets.length > 1800) return false;
  let targets: unknown;
  try { targets = JSON.parse(p.assessment_targets); } catch { return false; }
  if (!Array.isArray(targets) || targets.length < 1 || targets.length > 12) return false;
  let total = 0, correct = 0;
  const ids = new Set<string>();
  for (const target of targets) {
    if (!Array.isArray(target) || target.length !== 3 || typeof target[0] !== 'string'
      || target[0].length > 100 || !TARGET.test(target[0]) || ids.has(target[0])
      || !integer(target[2], 1, 12) || !integer(target[1], 0, target[2])) return false;
    ids.add(target[0]); correct += target[1]; total += target[2];
  }
  return total === 12 && correct === p.assessment_correct;
}
