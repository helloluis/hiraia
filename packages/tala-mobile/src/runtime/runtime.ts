import { createTalaClient } from '@hiraia/tala-core/contracts';
import { createSyncEngine } from '@hiraia/tala-core/sync';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { openStore } from '../storage/native';
export async function createRuntime() {
  const store = await openStore();
  let deviceId = await store.getMeta('deviceId');
  if (!deviceId) { deviceId = Crypto.randomUUID(); await store.commit({meta:{deviceId}}); }
  const client = createTalaClient({ baseUrl: process.env.EXPO_PUBLIC_TALA_API_URL ?? 'https://tala.hiraia.org', getToken: () => SecureStore.getItemAsync('tala.session'), timeoutMs: 60_000, validateResponses: true });
  const engine = createSyncEngine({ store, transport: client.syncTransport, deviceId, now: () => new Date(), newId: Crypto.randomUUID });
  return {store, client, engine};
}
export type Runtime = Awaited<ReturnType<typeof createRuntime>>;
