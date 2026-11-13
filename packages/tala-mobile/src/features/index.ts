import type { SyncEngine, LocalStore, TalaClient } from '@hiraia/tala-core/contracts';
import { createGeneration } from './generation';
import { createRoster } from './roster';
import { createCommunity } from './community';
export function createFeatures(deps: {
  engine: SyncEngine;
  store: LocalStore;
  client: TalaClient;
  newId(): string;
  now(): Date;
}) {
  const generation = createGeneration(deps),
    roster = createRoster(deps),
    community = createCommunity({ ...deps, tasks: generation.tasks });
  let running = false,
    online = false,
    timer: ReturnType<typeof setTimeout> | null = null,
    stopped = false;
  const stoppedWaiters: Array<() => void> = [];
  async function tick(connected = online) {
    online = connected;
    if (running || stopped) return;
    running = true;
    try {
      await generation.tick(online);
      await community.tick(online);
    } finally {
      running = false;
      for (const done of stoppedWaiters.splice(0)) done();
    }
  }
  return {
    generation,
    roster,
    community,
    tasks: generation.tasks,
    tick,
    async start() {
      stopped = false;

      async function loop() {
        if (stopped) return;
        await tick();
        if (!stopped) timer = setTimeout(() => void loop().catch(() => {}), 4000);
      }
      void loop().catch(() => {});
    },
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (running) await new Promise<void>((resolve) => stoppedWaiters.push(resolve));
    },
  };
}
export type Features = ReturnType<typeof createFeatures>;
