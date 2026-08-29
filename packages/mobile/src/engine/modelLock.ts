/**
 * The QVAC model is single-instance (one generation at a time). Every completion on it —
 * chat streaming, summarize, the feed's grounded answer / reward line, and the grade
 * re-prime (LocalEngine.setGrade → warmUp) — is serialized through this ONE lock so two
 * generations can never overlap on the shared model.
 *
 * It lives here rather than inside chatStore (where it started) because the feed and the
 * engine itself now take it too: a store-private lock only serialized the store's own two
 * callers, which stopped being the whole set the moment anything else generated.
 */
let modelLock: Promise<unknown> = Promise.resolve();

export function withModelLock<T>(fn: () => Promise<T>): Promise<T> {
  const result = modelLock.then(fn, fn);
  modelLock = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}
