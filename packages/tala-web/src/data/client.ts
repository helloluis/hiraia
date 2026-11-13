import { createTalaClient, type TalaClient } from '@hiraia/tala-core/contracts';
import { networkMonitor } from './network';

let client: TalaClient | null = null;

/**
 * Same-origin typed client. Response validation stays off so sync pulls carrying future record shapes reach the
 * engine's compatibility boundary (sync README). The network monitor wraps fetch to measure response times
 * and failures for the degradation ladder (§14.2.1).
 */
export function getClient(): TalaClient {
  if (!client) {
    client = createTalaClient({
      baseUrl: '',
      validateResponses: false,
      timeoutMs: 30_000,
      fetch: networkMonitor.fetch,
    });
  }
  return client;
}

/** For tests: a client bound to any fetch (e.g. the in-package fake server). */
export function makeClient(fetchImpl: typeof fetch, baseUrl = 'http://tala.test'): TalaClient {
  return createTalaClient({ baseUrl, validateResponses: false, fetch: fetchImpl });
}
