/**
 * Pure decisions for one classroom sync burst: which teacher endpoint is offered which class.
 * nearby.ts owns the radios, crypto and storage; everything here is plain data so it can be
 * unit-tested (scripts/tala-session.test.mts).
 *
 * Classes are joined per student, so one phone can owe several teachers. Students bound to the
 * same class share one Nearby session: a group. Tala >= 0.4.4 advertises a hint of the class it
 * collects for, so the phone connects only where one of its groups belongs. Tala 0.4.3 advertises
 * no hint: the phone offers its groups one connection at a time, and a teacher holding another
 * class's key disconnects before `ready`. A connection that got `ready` is never offered a second
 * class: Tala 0.4.3 paints every tile of a phone red when a later envelope fails on it.
 */
import { b64urlEncode, utf8 } from './manual';
import { MAX_LEFT_PROFILES, MAX_PROFILES, sanitizeProfile, type TeacherProfile } from './protocol';
import type { ClassKey, LeaveTombstone, ScopedBinding } from './queue';
import { GUEST_SCOPE, wireId } from './scope';

/** Tala 0.4.4 and later: this prefix, then comma-separated class hints. */
export const HINTED_ENDPOINT_PREFIX = 'Hiraia Tala 2 ';
const HINT_SALT = 'hiraia-tala-hint-v1:';

/** First 8 characters of base64url(SHA-256(salt + classId)). Advisory only: the class key still decides. */
export async function classHint(
  classId: string,
  sha256: (bytes: Uint8Array) => Uint8Array | Promise<Uint8Array>
): Promise<string> {
  return b64urlEncode(await sha256(utf8(HINT_SALT + classId))).slice(0, 8);
}

/**
 * The class hints a teacher advertises, or null when it advertises none. Tala 0.4.3 says just
 * "Hiraia Tala"; an unknown future name is treated the same way, because trial connections work
 * with any collector that speaks protocol v1.
 */
export function endpointHints(name?: string): string[] | null {
  if (!name?.startsWith(HINTED_ENDPOINT_PREFIX)) return null;
  return name
    .slice(HINTED_ENDPOINT_PREFIX.length)
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);
}

export type Group = ClassKey & {
  /** class_id + public_key: what one teacher key accepts. */
  key: string;
  hint: string;
  /** Bound student scopes. Empty for a leave-only group. */
  scopes: string[];
  /** Wire profiles of exactly those scopes; never empty when `scopes` is not. */
  profiles: TeacherProfile[];
  /** Wire ids of students who left this class and whose teacher has not been told yet. */
  leaves: string[];
  lastSync: number;
  /** Holds the student on screen. */
  active: boolean;
};

export function groupKey(c: ClassKey): string {
  return `${c.class_id} ${c.public_key}`;
}

/**
 * Bound scopes grouped by class, best first: the student on screen, then the most recently
 * synced class, then classes that only owe a leave. A class that only has tombstones left is
 * a leave-only group, used solely with a teacher advertising its hint.
 */
export function buildGroups(input: {
  bindings: ScopedBinding[];
  leaves: LeaveTombstone[];
  hint: (classId: string) => string;
  activeScope: string;
  installationId: string;
  profiles: readonly { id: string; name: string }[];
}): Group[] {
  const groups = new Map<string, Group>();
  const groupOf = (c: ClassKey) => {
    const key = groupKey(c);
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        class_id: c.class_id,
        public_key: c.public_key,
        hint: input.hint(c.class_id),
        scopes: [],
        profiles: [],
        leaves: [],
        lastSync: 0,
        active: false,
      };
      groups.set(key, group);
    }
    return group;
  };
  for (const b of input.bindings) {
    const name =
      b.scope === GUEST_SCOPE ? 'Guest' : input.profiles.find((p) => p.id === b.scope)?.name;
    const profile =
      name === undefined
        ? null
        : sanitizeProfile({ id: wireId(b.scope, input.installationId), name });
    // Events without their student in the list would reach the teacher as a "Recovered
    // student" or a Guest tile, so a scope that cannot be named does not sync at all.
    if (!profile) continue;
    const group = groupOf(b);
    if (group.profiles.length >= MAX_PROFILES) continue;
    group.scopes.push(b.scope);
    group.profiles.push(profile);
    group.lastSync = Math.max(group.lastSync, b.last_sync);
    if (b.scope === input.activeScope) group.active = true;
  }
  for (const t of input.leaves) {
    const group = groupOf(t);
    if (group.leaves.length >= MAX_LEFT_PROFILES || group.leaves.includes(t.wire_id)) continue;
    if (!group.profiles.some((p) => p.id === t.wire_id)) group.leaves.push(t.wire_id);
  }
  return [...groups.values()]
    .filter((g) => g.scopes.length || g.leaves.length)
    .sort(
      (a, b) =>
        Number(!a.scopes.length) - Number(!b.scopes.length) ||
        Number(b.active) - Number(a.active) ||
        b.lastSync - a.lastSync
    );
}

type EndpointState = {
  name?: string;
  hints: string[] | null;
  /** Groups this teacher did not accept (disconnect before `ready`). */
  failed: Set<string>;
  /** A group got `ready` here; nothing else is offered to this teacher this burst. */
  done: boolean;
  /** Nearby lost it; nothing is offered until it is found again. */
  lost: boolean;
};

export type Burst = {
  groups: Group[];
  synced: Set<string>;
  endpoints: Map<string, EndpointState>;
  /** Endpoints already asked to accept the pending typed code. */
  manualTried: Set<string>;
  /** Endpoints whose connection for the typed code already failed once (see manualUnreachable). */
  manualRetried: Set<string>;
};

export function newBurst(groups: Group[]): Burst {
  return {
    groups,
    synced: new Set(),
    endpoints: new Map(),
    manualTried: new Set(),
    manualRetried: new Set(),
  };
}

export function findGroup(burst: Burst, key: string | undefined): Group | undefined {
  return key === undefined ? undefined : burst.groups.find((g) => g.key === key);
}

/** Replace the groups after a mid-burst enrolment; a class that gained a student owes a new sync. */
export function regroup(burst: Burst, groups: Group[]): void {
  for (const group of groups) {
    const before = findGroup(burst, group.key);
    if (!before || group.scopes.some((s) => !before.scopes.includes(s)))
      burst.synced.delete(group.key);
  }
  burst.groups = groups;
}

/** Remember a discovered teacher and the classes its name says it collects for. */
export function seen(burst: Burst, endpointId: string, name?: string): void {
  const known = burst.endpoints.get(endpointId);
  const hints = endpointHints(name);
  if (known) Object.assign(known, { name, hints, lost: false });
  else
    burst.endpoints.set(endpointId, { name, hints, failed: new Set(), done: false, lost: false });
}

/** Nearby no longer sees this teacher: it cannot be connected until it is found again. */
export function lost(burst: Burst, endpointId: string): void {
  const endpoint = burst.endpoints.get(endpointId);
  if (endpoint) endpoint.lost = true;
}

export function endpointName(burst: Burst, endpointId: string): string | undefined {
  return burst.endpoints.get(endpointId)?.name;
}

/**
 * Groups this teacher may still be offered, best first. A hinted teacher gets only its own
 * classes (including a class that only owes a leave); one without hints gets every class that
 * still has students, in trial order.
 */
export function candidates(burst: Burst, endpointId: string): Group[] {
  const endpoint = burst.endpoints.get(endpointId);
  if (!endpoint || endpoint.done || endpoint.lost) return [];
  return burst.groups.filter(
    (g) =>
      !burst.synced.has(g.key) &&
      !endpoint.failed.has(g.key) &&
      (endpoint.hints ? endpoint.hints.includes(g.hint) : g.scopes.length > 0)
  );
}

/** The teacher unwrapped this group's key (`ready`): the endpoint is spent on it. */
export function accepted(burst: Burst, endpointId: string): void {
  const endpoint = burst.endpoints.get(endpointId);
  if (endpoint) endpoint.done = true;
}

/**
 * A disconnect before `ready`: this teacher does not hold the group's key. Returns the next
 * group to offer the same teacher on a new connection, if any.
 */
export function rejected(burst: Burst, endpointId: string, key: string): Group | undefined {
  const endpoint = burst.endpoints.get(endpointId);
  if (!endpoint || endpoint.done) return undefined;
  endpoint.failed.add(key);
  return candidates(burst, endpointId)[0];
}

export function groupSynced(burst: Burst, key: string): void {
  burst.synced.add(key);
}

/**
 * Every class with students has synced. Leave-only groups never hold radios on by themselves,
 * but one already talking to its teacher (`inFlight`) is allowed to finish.
 */
export function burstDone(burst: Burst, inFlight: Iterable<string | undefined>): boolean {
  const flying = new Set(inFlight);
  return burst.groups.every(
    (g) => burst.synced.has(g.key) || (!g.scopes.length && !flying.has(g.key))
  );
}

/** Leave tombstones go only to a teacher whose name carries this class's hint (Tala >= 0.4.4). */
export function leavesFor(burst: Burst, endpointId: string, group: Group): string[] {
  const hints = burst.endpoints.get(endpointId)?.hints;
  return hints?.includes(group.hint) ? group.leaves : [];
}

/** The next teacher in range to try a typed code on, in discovery order. */
export function nextManualEndpoint(burst: Burst): string | undefined {
  for (const [id, endpoint] of burst.endpoints)
    if (!endpoint.done && !endpoint.lost && !burst.manualTried.has(id)) return id;
  return undefined;
}

/**
 * Connecting to the teacher holding the typed code failed. The first failure is retried (radio
 * contention); a second one means that teacher cannot be reached, so the code moves on rather
 * than wait on it for the whole burst. `busy`: another teacher holds this phone's radio, which
 * explains the failure without saying anything about this teacher, so it is not counted.
 */
export function manualUnreachable(burst: Burst, endpointId: string, busy: boolean): boolean {
  if (busy) return false;
  if (burst.manualRetried.has(endpointId)) return true;
  burst.manualRetried.add(endpointId);
  return false;
}

/**
 * Backoff counts bursts in which the phone met none of its teachers: meeting only another
 * class's teacher is a miss. Reaching `ready` is not, even if the burst ended before the class
 * finished syncing (a long history): only that class's own key can produce a readable `ready`.
 */
export function nextMisses(misses: number, burst: Burst): number {
  const reached = [...burst.endpoints.values()].some((e) => e.done);
  return burst.synced.size || reached ? 0 : misses + 1;
}
