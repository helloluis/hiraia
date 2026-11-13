/**
 * @hiraia/tala-server entry.
 * OWNER: workstream A (kernel runtime). Required surface:
 *
 *   export function createTalaServer(overrides?: Partial<TalaServerConfig>): TalaServer
 *   interface TalaServer { handle(request: Request): Promise<Response>; close(): void; config: TalaServerConfig }
 *
 * `handle` serves everything under API_BASE from the route table in @hiraia/tala-core,
 * dispatching to the handlers registered by `modules` (src/modules/index.ts).
 */
export * from './kernel/types';
export { modules } from './modules';
