import { sanitizeEvent, type TeacherEvent } from './protocol';

export type Binding = { class_id: string; public_key: string; bound_at: number };

export interface TeacherStore {
  binding(): Promise<Binding | null>;
  /** Atomically replace binding and reset delivery ACKs only when class/key changes. */
  bind(next: Binding): Promise<void>;
  /** Clears the binding and every unsent teacher event. */
  unbind(): Promise<void>;
  teacherAppend(events: TeacherEvent[]): Promise<void>;
  teacherList(limit: number): Promise<TeacherEvent[]>;
  teacherAcknowledge(ids: string[], expected?: Binding): Promise<void>;
  markLost(count: number): Promise<void>;
  lost(): Promise<number>;
  lastSync(): Promise<number>;
  setLastSync(time: number): Promise<void>;
  status(): Promise<string>;
  setStatus(value: string): Promise<void>;
}

const MAX_EVENTS = 20_000;
const MAX_AGE = 180 * 86400000;

/**
 * Durable teacher-sync outbox. Independent of mothership ACK. Overflow is recorded
 * as queue_dropped rather than dropped silently.
 */
export class TeacherQueue {
  constructor(
    private store: TeacherStore,
    private now = Date.now,
    private newId: () => string
  ) {}

  async binding() {
    return this.store.binding();
  }

  async bind(next: Binding) {
    await this.store.bind(next);
  }

  async unbind() {
    await this.store.unbind();
  }

  async enqueue(events: TeacherEvent[]) {
    if (!(await this.store.binding())) return;
    const clean = events.map(sanitizeEvent).filter((e): e is TeacherEvent => !!e);
    if (!clean.length) return;
    await this.store.teacherAppend(clean);
  }

  async pending(limit: number) {
    return this.store.teacherList(limit);
  }

  async ack(ids: string[], lost: string[], expected?: Binding) {
    if (ids.length) await this.store.teacherAcknowledge(ids, expected);
    if (lost.length) await this.store.markLost(lost.length);
  }

  async markSynced() {
    await this.store.setLastSync(this.now());
  }

  async overflowReport(template: TeacherEvent, dropped: number): Promise<TeacherEvent | null> {
    if (dropped <= 0) return null;
    return {
      ...template,
      id: this.newId(),
      name: 'queue_dropped',
      occurred_at: this.now(),
      props: { count: dropped },
    };
  }

  static get maxEvents() {
    return MAX_EVENTS;
  }
  static get maxAge() {
    return MAX_AGE;
  }
}

export { MAX_EVENTS as TEACHER_QUEUE_MAX, MAX_AGE as TEACHER_QUEUE_AGE };
