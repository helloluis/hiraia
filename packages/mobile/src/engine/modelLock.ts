/**
 * The QVAC model is single-instance (one generation at a time). Every completion on it —
 * the feed's grounded card (LocalEngine.answerQuery) and its reward line (generateReward) —
 * is serialized through this ONE lock so two generations can never overlap on the shared
 * model. (The grade change used to generate too, re-running a ~78s warm-up prefill under this
 * lock; LocalEngine.setGrade is a plain config write now and takes nothing.) The init warm-up
 * deliberately stays outside the lock — see LocalEngine.prime().
 *
 * It is module-level rather than store-private (it started inside the old chatStore) because
 * the feed and the engine itself both take it: a store-private lock only serialized that one
 * store's callers, which stopped being the whole set the moment anything else generated.
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
