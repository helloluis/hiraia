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
  async function tick(connected = online) {
    online = connected;
    if (running || stopped) return;
    running = true;
    try {
      await generation.tick(online);
      await community.tick(online);
    } finally {
      running = false;
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
      await generation.tasks.recover();
      async function loop() {
        if (stopped) return;
        await tick();
        if (!stopped) timer = setTimeout(() => void loop().catch(() => {}), 4000);
      }
      void loop().catch(() => {});
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
export type Features = ReturnType<typeof createFeatures>;
