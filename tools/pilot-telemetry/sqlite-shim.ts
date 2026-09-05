// Host adapter for exercising the mobile repository's actual SQL against SQLite.
// Device tests still need Expo's native bridge; this does not emulate that bridge.
export async function openDatabaseAsync(name: string) {
  return (globalThis as any).__telemetryOpen(name);
}
