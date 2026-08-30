/**
 * `@hiraia/shared/node` — the parts of the shared package that need a filesystem.
 *
 * Split out from the main entry point so `node:fs` can never reach the Metro graph: the
 * mobile app imports `@hiraia/shared`, and anything that barrel re-exports is bundled
 * whether or not it is used. Server and tooling import this one explicitly.
 */
export { loadFactBank, loadFactSource, bankFileHash, factBankPath } from './rag/bankFile.js';
