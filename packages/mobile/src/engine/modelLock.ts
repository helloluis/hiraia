/**
 * The QVAC model is single-instance (one generation at a time). Every completion on it —
 * chat streaming, summarize, the feed's grounded answers / reward line, and the grade
 * re-prime (LocalEngine.setGrade → warmUp) — is serialized through this one lock so two
 * generations can never overlap on the shared model.
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
