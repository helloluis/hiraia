export type Rung = 'full' | 'low-bandwidth' | 'offline-cache' | 'read-only-offline';
export interface Conditions { connected: boolean; slow: boolean; serverDown: boolean; dataSaver: boolean; metered: boolean; storageFull: boolean; sessionExpired: boolean; formatBlocked: boolean; lowStorage: boolean; lowMemory: boolean }
export const initialConditions: Conditions = { connected: true, slow: false, serverDown: false, dataSaver: false, metered: false, storageFull: false, sessionExpired: false, formatBlocked: false, lowStorage: false, lowMemory: false };
export function transition(previous: Conditions, event: Partial<Conditions>) {
  const conditions = { ...previous, ...event };
  const rung: Rung = conditions.storageFull || conditions.sessionExpired || conditions.formatBlocked ? 'read-only-offline' : !conditions.connected || conditions.serverDown ? 'offline-cache' : conditions.slow || conditions.dataSaver || conditions.metered ? 'low-bandwidth' : 'full';
  return { conditions, rung, canWrite: rung !== 'read-only-offline', downloadAttachments: rung === 'full' && !conditions.lowStorage && !conditions.lowMemory,
    banner: conditions.storageFull ? 'storageFull' : conditions.sessionExpired ? 'sessionExpired' : conditions.formatBlocked ? 'formatBlocked' : rung === 'full' ? conditions.lowStorage ? 'lowStorage' : conditions.lowMemory ? 'lowMemory' : null : rung };
}
export function retryDelay(attempt: number, random = Math.random) { return Math.round(Math.min(60_000, 1000 * 2 ** Math.min(attempt, 6)) * (0.5 + random() * 0.5)); }
