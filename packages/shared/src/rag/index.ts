export * from './types.js';
export {
  RagStore,
  normalizeQuery,
  buildContextualQuery,
  expandColloquial,
  isOffDomain,
  CONTEXT_FALLBACK_FLOOR,
  OFFDOMAIN_OOV_FLOOR,
  OFFDOMAIN_HARD_FLOOR,
} from './RagStore.js';
export { tokenize } from './tokenize.js';
export { SemanticIndex } from './SemanticIndex.js';
export type { SemanticBlob, LangKey, SemHit } from './SemanticIndex.js';
// Where the bank comes from. There is deliberately NO bundled `SCIENCE_FACTS` array here any
// more: it was 43.5 MB of TypeScript that Metro could not tree-shake, so importing this
// barrel anywhere in the app dragged the whole fact bank into the JS bundle. The phone reads
// the bank out of cards.db (SqlFactSource); Node reads the source-of-truth JSONL
// (`@hiraia/shared/node` -> loadFactBank, kept out of this barrel because it needs node:fs).
export { MemoryFactSource, decodePostings, FIELD_BIT } from './FactSource.js';
export type { FactSource, TokenPostings } from './FactSource.js';
export { SqlFactSource, FACT_COLUMNS } from './SqlFactSource.js';
export type { FactDbDriver, FactDbRow } from './SqlFactSource.js';
