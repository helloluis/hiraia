let sequence = 0;
export function newId() {
  return `test_event_0123456789_${sequence++}`;
}
export function track(name: string, props: object, id?: string) {
  (globalThis as any).__telemetryEvents.push({ name, props, id });
}
export function trackMany(events: any[]) {
  (globalThis as any).__telemetryEvents.push(...events);
}
export function errorCategory(error: Error) {
  return /cancel/.test(error.message) ? 'cancelled' : 'network';
}
