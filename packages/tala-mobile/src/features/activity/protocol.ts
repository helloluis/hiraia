/**
 * Tala classroom protocol v1 — the pure, testable half of the teacher side. The authority is
 * modules/tala-activity/PROTOCOL.md (derived from Tala 0.4.4 and student app 0.4.24 on branch
 * tala-0.4.x); every constant here cites the 0.4.x source it mirrors.
 */

export const SERVICE_ID = 'com.hiraia.classroom.v1';
export const QR_KIND = 'hiraia-tala';
export const SCHEMA = 1;
/** Tala 0.4.4 advertises "Hiraia Tala 2 <hint>" (ClassHint.kt). */
export const HINTED_ENDPOINT_PREFIX = 'Hiraia Tala 2 ';
const HINT_SALT = 'hiraia-tala-hint-v1:';
/** Protocol additions this Tala honours; a student sends leave notices only on seeing them. */
export const CAPABILITIES: readonly string[] = ['left_profiles'];

export const MAX_PROFILES = 50;
export const MAX_LEFT_PROFILES = 50;
export const MAX_EVENTS = 50;
export const MAX_NAME = 40;
export const MAX_PROPS = 1600;
export const MAX_CLASS_NAME = 48;
/** NearbyCollector: a BYTES payload over this is dropped and the endpoint disconnected. */
export const MAX_OUTER = 180_000;
/** NearbyCollector: the decrypted inner JSON, serialized, must not exceed this. */
export const MAX_INNER = 150_000;
export const MAX_MANUAL_PAYLOAD = 2048;
export const MAX_MANUAL_ATTEMPTS = 3;
export const MANUAL_CODE_TTL_MS = 60 * 60 * 1000;
export const MIN_OCCURRED_AT = 1577836800000;
export const MAX_OCCURRED_AT = 8640000000000000;

/** TalaDatabase.ID: installation, profile and event ids. */
export const ID = /^[A-Za-z0-9_-]{16,80}$/;
/** The student's parseTeacherQr accepts only RFC 4122 UUIDs as class ids (qr.ts CLASS_UUID). */
export const CLASS_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** TalaDatabase.EVENTS — the 0.4.4 allow-list, unchanged (assessment_completed is not in it). */
export const EVENTS: ReadonlySet<string> = new Set([
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
export const FAILURE_EVENTS: ReadonlySet<string> = new Set([
  'download_failed',
  'model_load_failed',
  'generation_failed',
]);

// ---- bytes ----

export function b64urlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*=*$/.test(value)) throw new Error('base64url');
  const stripped = value.replace(/=+$/, '');
  const pad = '='.repeat((4 - (stripped.length % 4)) % 4);
  const bin = atob(stripped.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

// ---- class hint (ClassHint.kt) ----

export async function classHint(
  classId: string,
  sha256: (bytes: Uint8Array) => Uint8Array | Promise<Uint8Array>
): Promise<string> {
  return b64urlEncode(await sha256(utf8(HINT_SALT + classId))).slice(0, 8);
}

export function endpointNameFor(hint: string): string {
  return HINTED_ENDPOINT_PREFIX + hint;
}

// ---- class names (ClassNames.kt) ----

const COLOURS = [
  'Blue',
  'Green',
  'Red',
  'Gold',
  'Silver',
  'Orange',
  'Purple',
  'Teal',
  'Amber',
  'Coral',
  'Indigo',
  'Jade',
  'Ruby',
  'Copper',
  'Violet',
  'Crimson',
];
/** English only: "Usa" is Tagalog for deer but Cebuano for ONE (see ClassNames.kt). */
const ANIMALS = [
  'Tarsier',
  'Carabao',
  'Tamaraw',
  'Dugong',
  'Pangolin',
  'Eagle',
  'Hornbill',
  'Turtle',
  'Dolphin',
  'Butterfly',
  'Firefly',
  'Dragonfly',
  'Owl',
  'Hawk',
  'Heron',
  'Frog',
  'Crab',
  'Seahorse',
  'Python',
  'Gecko',
  'Parrot',
  'Swift',
  'Crow',
  'Sparrow',
];

/** A stable "Colour Animal" for a class with no typed name: SHA-256(class id) bytes 0 and 1. */
export async function generatedClassName(
  classId: string,
  sha256: (bytes: Uint8Array) => Uint8Array | Promise<Uint8Array>
): Promise<string> {
  const digest = await sha256(utf8(classId));
  return `${COLOURS[digest[0]! % COLOURS.length]} ${ANIMALS[digest[1]! % ANIMALS.length]}`;
}

/** ClassIdentity.displayName: the typed name, else the derived one; never blank; ≤ 48. */
export async function displayClassName(
  classId: string,
  typed: string | null | undefined,
  sha256: (bytes: Uint8Array) => Uint8Array | Promise<Uint8Array>
): Promise<string> {
  const trimmed = (typed ?? '').trim();
  return (trimmed || (await generatedClassName(classId, sha256))).slice(0, MAX_CLASS_NAME);
}

// ---- QR payload (ClassIdentity.qrPayload) ----

/** Exact key order of 0.4.4's org.json output: v, kind, class_id, class_name, public_key. */
export function qrPayload(classId: string, className: string, publicKeyB64: string): string {
  return JSON.stringify({
    v: 1,
    kind: QR_KIND,
    class_id: classId,
    class_name: className.slice(0, MAX_CLASS_NAME),
    public_key: publicKeyB64,
  });
}

// ---- manual code (ManualEnrollment.kt / manual.ts) ----

export const MANUAL_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function normalizeManualCode(input: string): string | null {
  const raw = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (raw.length !== 12 || [...raw].some((c) => !MANUAL_ALPHABET.includes(c))) return null;
  return raw;
}

export function formatManualCode(code: string): string {
  return code.match(/.{1,4}/g)?.join('-') ?? code;
}

// ---- wire shapes ----

export type OuterEnvelope = {
  v: 1;
  type: 'intro' | 'batch';
  wrapped_key: string;
  nonce: string;
  ciphertext: string;
};

export type ManualEnrollRequest = {
  v: 1;
  type: 'manual_enroll';
  client_nonce: string;
  proof: string;
};

export type WireProfile = { id: string; name: string };
export type WireEvent = {
  id: string;
  name: string;
  occurred_at: number;
  props: Record<string, unknown>;
};
export type InnerBatch = {
  schema: 1;
  class_id: string;
  installation_id: string;
  challenge: string;
  profiles?: WireProfile[];
  events: WireEvent[];
  left_profiles?: unknown[];
};

export type ReplyBody = {
  challenge: string;
  accepted: string[];
  rejected: string[];
  class_name: string;
  caps: string[];
};

export function parseOuter(
  json: string
): { v: number; type: string; [key: string]: unknown } | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (o.v !== 1 || typeof o.type !== 'string') return null;
  return o as { v: number; type: string };
}

export function isOuterEnvelope(o: Record<string, unknown>): o is OuterEnvelope {
  return (
    (o.type === 'intro' || o.type === 'batch') &&
    typeof o.wrapped_key === 'string' &&
    typeof o.nonce === 'string' &&
    typeof o.ciphertext === 'string'
  );
}

export function isManualEnroll(o: Record<string, unknown>): o is ManualEnrollRequest {
  return (
    o.type === 'manual_enroll' && typeof o.client_nonce === 'string' && typeof o.proof === 'string'
  );
}

/**
 * Shape check of a decrypted inner body (NearbyCollector + the head of TalaDatabase.ingest).
 * Returns the reason on failure; the caller disconnects. Content rules (per-profile, per-event)
 * are applied by the store's ingest, which rejects events individually.
 */
export function checkInner(
  text: string,
  expected: { classId: string; challenge: string }
): { ok: true; batch: InnerBatch } | { ok: false; reason: string } {
  if (text.length > MAX_INNER) return { ok: false, reason: 'inner-size' };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'inner-json' };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return { ok: false, reason: 'inner-shape' };
  const o = raw as Record<string, unknown>;
  if (o.schema !== SCHEMA) return { ok: false, reason: 'schema' };
  if (o.challenge !== expected.challenge) return { ok: false, reason: 'challenge' };
  if (o.class_id !== expected.classId) return { ok: false, reason: 'class' };
  if (typeof o.installation_id !== 'string' || !ID.test(o.installation_id))
    return { ok: false, reason: 'installation' };
  if (!Array.isArray(o.events)) return { ok: false, reason: 'events' };
  const profiles = o.profiles === undefined ? [] : o.profiles;
  if (!Array.isArray(profiles)) return { ok: false, reason: 'profiles' };
  const left = o.left_profiles === undefined ? [] : o.left_profiles;
  if (!Array.isArray(left)) return { ok: false, reason: 'left' };
  if (
    profiles.length > MAX_PROFILES ||
    left.length > MAX_LEFT_PROFILES ||
    o.events.length > MAX_EVENTS
  )
    return { ok: false, reason: 'count' };
  for (const p of profiles)
    if (!p || typeof p !== 'object' || typeof p.id !== 'string' || typeof p.name !== 'string')
      return { ok: false, reason: 'profile-shape' };
  for (const e of o.events) {
    if (!e || typeof e !== 'object' || typeof e.id !== 'string' || !ID.test(e.id))
      return { ok: false, reason: 'event-id' };
  }
  return {
    ok: true,
    batch: {
      schema: 1,
      class_id: o.class_id,
      installation_id: o.installation_id,
      challenge: o.challenge,
      profiles: profiles as WireProfile[],
      events: o.events as WireEvent[],
      left_profiles: left,
    },
  };
}

/** NearbyCollector.reply's plaintext: key order challenge, accepted, rejected, class_name, caps. */
export function replyBody(
  challenge: string,
  accepted: string[],
  rejected: string[],
  className: string
): string {
  const body: ReplyBody = {
    challenge,
    accepted,
    rejected,
    class_name: className.slice(0, MAX_CLASS_NAME),
    caps: [...CAPABILITIES],
  };
  return JSON.stringify(body);
}

/** The plaintext hello the teacher sends on every new connection. */
export function challengeMessage(challenge: string): string {
  return JSON.stringify({ v: 1, type: 'challenge', challenge });
}
