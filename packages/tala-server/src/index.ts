/**
 * @hiraia/tala-server entry.
 * OWNER: workstream A (kernel runtime).
 *
 *   createTalaServer(overrides?) → { handle(request: Request): Promise<Response>; close(): void; config }
 *
 * `handle` serves everything under API_BASE from the route table in @hiraia/tala-core,
 * dispatching to the handlers registered by `modules` (src/modules/index.ts).
 */
import { ConfigError, loadConfig } from './kernel/config';
import type { DeepPartial } from './kernel/config';
import { createServerFromEnv } from './kernel/server';
import type { TalaServer } from './kernel/server';
import type { TalaServerConfig } from './kernel/types';
import { modules } from './modules';

export * from './kernel/types';
export { modules } from './modules';
export { ConfigError, loadConfig };
export type { DeepPartial, TalaServer };

/**
 * Build a server from the environment (see src/kernel/README.md for the variables) with every registered
 * module. `overrides` are merged over the environment, deeply, so `{ limits: { pageSize: 10 } }` is enough.
 * Opens the database at `config.dbPath` and applies pending migrations before returning.
 */
export function createTalaServer(overrides?: DeepPartial<TalaServerConfig>): TalaServer {
  return createServerFromEnv(modules, overrides);
}

const SHARED = Symbol.for('hiraia.tala.server');

/**
 * One server per process, kept on globalThis. Use this from a framework that reloads modules in
 * development (Next.js), so a reload does not open the database a second time.
 */
export function getTalaServer(): TalaServer {
  const holder = globalThis as unknown as Record<symbol, TalaServer | undefined>;
  holder[SHARED] ??= createTalaServer();
  return holder[SHARED];
}
