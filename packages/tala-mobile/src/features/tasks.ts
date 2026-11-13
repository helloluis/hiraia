import type { LocalStore } from '@hiraia/tala-core/contracts';
export type TaskState =
  | 'queued'
  | 'sending'
  | 'polling'
  | 'ready'
  | 'failed'
  | 'uncertain'
  | 'cancelled'
  | 'done';
export interface DurableTask<T = unknown> {
  id: string;
  kind: 'generation' | 'post';
  state: TaskState;
  input: T;
  remoteId?: string;
  result?: unknown;
  attempts: number;
  nextAt: number;
  error?: string;
  cancelRequested?: boolean;
  createdAt: string;
}
/** Metadata shares the encrypted SQLite transaction boundary. No plan/roster bodies are logged. */
export function taskStore(store: LocalStore) {
  let queue = Promise.resolve();
  const listeners = new Set<() => void>();
  async function list(): Promise<DurableTask[]> {
    return JSON.parse((await store.getMeta('feature.tasks')) ?? '[]');
  }
  async function change(action: (tasks: DurableTask[]) => void) {
    const next = queue.then(async () => {
      const tasks = await list();
      action(tasks);
      await store.commit({ meta: { 'feature.tasks': JSON.stringify(tasks) } });
      for (const listener of listeners) listener();
    });
    queue = next.catch(() => {});
    return next;
  }
  return {
    list,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    async put(task: DurableTask) {
      await change((tasks) => {
        const i = tasks.findIndex((t) => t.id === task.id);
        if (i < 0) tasks.push(task);
        else tasks[i] = task;
      });
    },
    async update(id: string, patch: Partial<DurableTask>) {
      await change((tasks) => {
        const t = tasks.find((t) => t.id === id);
        if (t) Object.assign(t, patch);
      });
    },
    async recover() {
      await change((tasks) => {
        for (const t of tasks)
          if (t.state === 'sending') t.state = t.remoteId ? 'polling' : 'uncertain';
      });
    },
  };
}
