/** Platform-independent delivery policy. No network work is on the learning path. */
export type Props = Record<string, string | number | boolean>;
export interface Event {
  id: string;
  name: string;
  occurred_at: number;
  session_id: string;
  props: Props;
}
export interface Repository {
  installationId: string;
  append(events: Event[]): Promise<void>;
  list(limit: number): Promise<Event[]>;
  acknowledge(ids: string[]): Promise<void>;
  retryAt(): Promise<number>;
  setRetryAt(time: number): Promise<void>;
}
export function newId(): string {
  // Pseudonymous identity, not an authentication credential.
  return `${Date.now().toString(36)}_${Array.from({ length: 4 }, () =>
    Math.floor(Math.random() * 0x100000000)
      .toString(16)
      .padStart(8, '0')
  ).join('')}`;
}
/** UTF-8 length without Node Buffer or a native TextEncoder dependency. */
export function jsonBytes(value: unknown): number {
  let bytes = 0;
  for (const char of JSON.stringify(value)) {
    const point = char.codePointAt(0)!;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return bytes;
}
export function boundedBatch(events: Event[], installationId: string): Event[] {
  // Reserve 1KB of the 90KB application budget for reporter metadata added by the caller.
  let bytes = jsonBytes({ schema: 1, installation_id: installationId, events: [] }) + 1024;
  const selected: Event[] = [];
  for (const event of events.slice(0, 50)) {
    const size = jsonBytes(event) + (selected.length ? 1 : 0);
    if (bytes + size > 90_000) break;
    selected.push(event);
    bytes += size;
  }
  return selected;
}
export function supportedAcknowledgements(
  events: Event[],
  response: { acknowledged?: unknown; rejected?: unknown; assessment_supported?: boolean }
) {
  const assessmentIds = new Set(
    events.filter((e) => e.name === 'assessment_completed').map((e) => e.id)
  );
  const supportedIds = (ids: unknown) =>
    Array.isArray(ids) && response.assessment_supported !== true
      ? ids.filter((id) => !assessmentIds.has(id))
      : ids;
  return {
    acknowledged: supportedIds(response.acknowledged),
    rejected: supportedIds(response.rejected),
  };
}
export class Outbox {
  private writes = Promise.resolve();
  private pending = 0;
  private lost = 0;
  private flushing = false;
  private failures = 0;
  constructor(
    private repository: () => Promise<Repository>,
    private send: (body: { schema: 1; installation_id: string; events: Event[] }) => Promise<{
      ok: boolean;
      acknowledged?: unknown;
      rejected?: unknown;
      retryAfterMs?: number;
    }>,
    private now = Date.now,
    private random = Math.random
  ) {}

  enqueue(events: Event[]): void {
    if (!events.length) return;
    if (this.pending >= 200) {
      this.lost += events.length;
      return;
    }
    this.pending++;
    this.writes = this.writes
      .then(async () => {
        const repo = await this.repository();
        const lost = this.lost;
        const batch = lost
          ? [
              ...events,
              { ...events[0]!, id: newId(), name: 'queue_dropped', props: { count: lost } },
            ]
          : events;
        await repo.append(batch);
        this.lost -= lost;
      })
      .catch(() => {
        this.lost += events.length;
      })
      .finally(() => {
        this.pending--;
      });
  }
  async drainWrites(): Promise<void> {
    await this.writes;
  }
  async flush(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    let repo: Repository | undefined;
    try {
      await this.writes;
      repo = await this.repository();
      if ((await repo.retryAt()) > this.now()) return;
      // Limit each wake to five batches; subsequent foreground ticks continue draining.
      for (let batch = 0; batch < 5; batch++) {
        const events = boundedBatch(await repo.list(50), repo.installationId);
        if (!events.length) return;
        const response = await this.send({
          schema: 1,
          installation_id: repo.installationId,
          events,
        });
        const sent = new Set(events.map((e) => e.id));
        const acknowledged = response.acknowledged;
        const rejected = response.rejected ?? [];
        if (
          !response.ok ||
          !Array.isArray(acknowledged) ||
          !Array.isArray(rejected) ||
          acknowledged.length + rejected.length === 0 ||
          [...acknowledged, ...rejected].some((id) => typeof id !== 'string' || !sent.has(id))
        ) {
          const delay = Math.max(response.retryAfterMs || 0, this.backoff());
          await repo.setRetryAt(this.now() + Math.min(delay, 86400000));
          return;
        }
        await repo.acknowledge([...new Set([...acknowledged, ...rejected])] as string[]);
        const lost = events.filter(
          (e) => rejected.includes(e.id) && e.name !== 'queue_dropped'
        ).length;
        if (lost)
          await repo.append([
            { ...events[0]!, id: newId(), name: 'queue_dropped', props: { count: lost } },
          ]);
        this.failures = 0;
        await repo.setRetryAt(0);
      }
    } catch {
      try {
        await repo?.setRetryAt(this.now() + this.backoff());
      } catch {
        /* Disk failure must not escape. */
      }
    } finally {
      this.flushing = false;
    }
  }
  private backoff() {
    return (
      Math.min(3600000, 30000 * 2 ** Math.min(this.failures++, 7)) * (0.75 + this.random() * 0.5)
    );
  }
}
