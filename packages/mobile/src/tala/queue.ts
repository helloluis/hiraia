import { sanitizeEvent, type TeacherEvent } from './protocol';

/** What identifies a class to the phone: a readable ready/ack proves the teacher holds its key. */
export type ClassKey = { class_id: string; public_key: string };
export type Binding = ClassKey & { bound_at: number; class_name?: string };
/** One student's class. Scope = that student's profile id, or 'guest' (see scope.ts). */
export type ScopedBinding = ClassKey & {
  scope: string;
  /** '' until a QR or a teacher reply names the class. */
  class_name: string;
  bound_at: number;
  last_sync: number;
  /** Events this student lost to queue overflow or teacher rejection. */
  dropped: number;
};
/** A student left this class. Only a teacher build that understands it is told (left_profiles). */
export type LeaveTombstone = ClassKey & { wire_id: string; left_at: number };

export interface TeacherStore {
  bindings(): Promise<ScopedBinding[]>;
  binding(scope: string): Promise<ScopedBinding | null>;
  /** Atomically bind one scope; its unsent events and counters reset only when class/key changes. */
  bind(scope: string, next: Binding): Promise<void>;
  /** Leave: drops the scope's binding and unsent events, and records a leave tombstone. */
  unbind(scope: string): Promise<void>;
  /**
   * Once, after a 0.4.23 upgrade and once profiles are loaded: a leave tombstone for the dropped
   * phone-wide class for each of these profiles and the Guest, unless back in that class.
   */
  settleLegacyClass(profileIds: string[]): Promise<void>;
  /** Unexpired leave tombstones. */
  leaves(): Promise<LeaveTombstone[]>;
  clearLeaves(classId: string, wireIds: string[]): Promise<void>;
  /** Class names arrive from the teacher's reply too, so a QR without one gets named later. */
  setClassName(expected: ClassKey, name: string): Promise<void>;
  /** Routes each event to its scope's queue; events of unbound scopes are not kept. */
  teacherAppend(events: TeacherEvent[]): Promise<void>;
  /** The next events of these scopes that `expected` has not acknowledged yet. */
  teacherList(expected: ClassKey, scopes: string[], limit: number): Promise<TeacherEvent[]>;
  teacherAcknowledge(ids: string[], expected: ClassKey, lost?: string[]): Promise<void>;
  setLastSync(scopes: string[], time: number): Promise<void>;
  /** When a 0.4.23 phone-wide class was dropped, if this scope still owes a re-scan; else 0. */
  rejoinNotice(scope: string): Promise<number>;
}

const MAX_EVENTS = 20_000;
const MAX_AGE = 180 * 86400000;
/** Undelivered leave tombstones expire; by then the teacher has moved on without them. */
const LEAVE_AGE = 30 * 86400000;
const REJOIN_NOTICE_AGE = 30 * 86400000;

/**
 * Durable teacher-sync outbox, one queue per student scope. Independent of mothership ACK.
 * Overflow is recorded as queue_dropped rather than dropped silently.
 */
export class TeacherQueue {
  constructor(
    private store: TeacherStore,
    private now = Date.now
  ) {}

  async bindings() {
    return this.store.bindings();
  }

  async binding(scope: string) {
    return this.store.binding(scope);
  }

  async bind(scope: string, next: Binding) {
    await this.store.bind(scope, next);
  }

  async unbind(scope: string) {
    await this.store.unbind(scope);
  }

  async settleLegacyClass(profileIds: string[]) {
    await this.store.settleLegacyClass(profileIds);
  }

  async enqueue(events: TeacherEvent[]) {
    const clean = events.map(sanitizeEvent).filter((e): e is TeacherEvent => !!e);
    if (!clean.length) return;
    await this.store.teacherAppend(clean);
  }

  async pending(expected: ClassKey, scopes: string[], limit: number) {
    return this.store.teacherList(expected, scopes, limit);
  }

  async ack(ids: string[], lost: string[], expected: ClassKey) {
    if (ids.length) await this.store.teacherAcknowledge(ids, expected, lost);
  }

  async markSynced(scopes: string[]) {
    await this.store.setLastSync(scopes, this.now());
  }

  async leaves() {
    return this.store.leaves();
  }

  async clearLeaves(classId: string, wireIds: string[]) {
    if (wireIds.length) await this.store.clearLeaves(classId, wireIds);
  }

  async setClassName(expected: ClassKey, name: string) {
    await this.store.setClassName(expected, name);
  }

  async rejoinNotice(scope: string) {
    return this.store.rejoinNotice(scope);
  }
}

export {
  MAX_EVENTS as TEACHER_QUEUE_MAX,
  MAX_AGE as TEACHER_QUEUE_AGE,
  LEAVE_AGE as TEACHER_LEAVE_AGE,
  REJOIN_NOTICE_AGE as TEACHER_REJOIN_NOTICE_AGE,
};
