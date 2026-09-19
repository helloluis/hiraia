/** Tala Nearby protocol v1. Teacher Kotlin is the authority if this drifts. */

export const SERVICE_ID = 'com.hiraia.classroom.v1';
export const QR_KIND = 'hiraia-tala';
export const SCHEMA = 1;
export const MAX_PROFILES = 50;
export const MAX_EVENTS = 50;
export const MAX_NAME = 40;
export const MAX_PROPS = 1600;
export const MAX_OUTER = 180_000;
export const MAX_INNER = 150_000;
export const ID = /^[A-Za-z0-9_-]{16,80}$/;
export const CLASS_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const TEACHER_EVENTS = new Set([
  'first_open',
  'profile_updated',
  'session_started',
  'card_viewed',
  'quiz_shown',
  'quiz_answer_submitted',
  'quiz_graded',
  'download_started',
  'download_resumed',
  'download_failed',
  'download_cancelled',
  'download_installed',
  'asset_available',
  'model_load_started',
  'model_ready',
  'model_load_failed',
  'generation_started',
  'generation_completed',
  'generation_failed',
  'queue_dropped',
]);

export type TeacherProfile = { id: string; name: string };
export type TeacherEvent = {
  id: string;
  name: string;
  occurred_at: number;
  session_id: string;
  props: Record<string, string | number | boolean>;
};

export type TeacherQr = {
  v: 1;
  kind: typeof QR_KIND;
  class_id: string;
  public_key: string;
};

export type InnerBatch = {
  schema: 1;
  class_id: string;
  installation_id: string;
  challenge: string;
  profiles: TeacherProfile[];
  events: TeacherEvent[];
};

export type AckBody = {
  challenge: string;
  accepted: string[];
  rejected: string[];
};

export function chunk<T>(items: T[], size: number): T[][] {
  if (size < 1) return [];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function sanitizeProfile(p: TeacherProfile): TeacherProfile | null {
  const name = p.name.trim().slice(0, MAX_NAME);
  if (!ID.test(p.id) || !name) return null;
  return { id: p.id, name };
}

export function sanitizeEvent(e: TeacherEvent): TeacherEvent | null {
  if (!ID.test(e.id) || !TEACHER_EVENTS.has(e.name)) return null;
  if (!Number.isSafeInteger(e.occurred_at) || e.occurred_at < 1577836800000) return null;
  if (typeof e.session_id !== 'string' || !e.props) return null;
  const props = { ...e.props };
  if (JSON.stringify(props).length > MAX_PROPS) return null;
  return {
    id: e.id,
    name: e.name,
    occurred_at: e.occurred_at,
    session_id: e.session_id,
    props,
  };
}

/** ACK must name only IDs from this batch; delete accepted+rejected, retry the rest. */
export function applyAck(
  sent: string[],
  ack: AckBody,
  challenge: string
): { ok: true; done: string[]; retry: string[]; lost: string[] } | { ok: false; reason: string } {
  if (ack.challenge !== challenge) return { ok: false, reason: 'challenge' };
  if (!Array.isArray(ack.accepted) || !Array.isArray(ack.rejected))
    return { ok: false, reason: 'shape' };
  const sentSet = new Set(sent);
  const seen = new Set<string>();
  for (const id of [...ack.accepted, ...ack.rejected]) {
    if (typeof id !== 'string' || !sentSet.has(id) || seen.has(id))
      return { ok: false, reason: 'ids' };
    seen.add(id);
  }
  const lost = ack.rejected.filter((id) => sentSet.has(id));
  const done = [...new Set([...ack.accepted, ...ack.rejected])];
  const retry = sent.filter((id) => !seen.has(id));
  return { ok: true, done, retry, lost };
}
