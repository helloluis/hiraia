import type { LocalStore } from '@hiraia/tala-core/contracts';
/** Approximate uncompressed application bytes, deliberately not a claim about carrier billing. */
export function meteredFetch(store: LocalStore, request: typeof fetch = fetch): typeof fetch {
  let queue = Promise.resolve();
  return async (input, init) => {
    const response = await request(input, init);
    const body =
      typeof init?.body === 'string' ? unescape(encodeURIComponent(init.body)).length : 0;
    const clone = response.clone();
    void clone
      .arrayBuffer()
      .then((bytes) => {
        const date = new Date();
        date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
        const week = date.toISOString().slice(0, 10);
        queue = queue
          .then(async () => {
            const previous = await store.getMeta('network.week');
            const used =
              previous === week ? Number((await store.getMeta('network.bytes')) ?? 0) : 0;
            await store.commit({
              meta: {
                'network.week': week,
                'network.bytes': String(used + bytes.byteLength + body),
              },
            });
          })
          .catch(() => {});
      })
      .catch(() => {});
    return response;
  };
}
