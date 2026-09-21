import artifact from '../generated/lessonSimilarity.generated.json';

// Saved source-fact LaBSE similarities, not on-device inference. An absent edge means
// "no hint", not "unrelated". Eligibility/grade/coverage stay entirely in lessonPlan.
const graph = artifact as {
  version: number;
  lessons: Record<string, string>;
  facts: string[];
  neighbors: number[][];
};
let ordinals: Map<string, number> | undefined;

function similarity(a: number | undefined, b: number | undefined): number {
  if (a === undefined || b === undefined) return 0;
  if (a === b) return 1;
  // The top-eight graph is directed; consult both ends so truncation is symmetric here.
  const find = (from: number, to: number) => {
    const row = graph.neighbors[from] ?? [];
    for (let i = 0; i < row.length; i += 2)
      if (row[i] === to) return row[i + 1]! / 1000;
    return 0;
  };
  return Math.max(find(a, b), find(b, a));
}

/** Reproducible per-run randomness; the resulting card order is persisted by the store. */
export function lessonRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function lessonVariety(
  key: string,
  revision: string,
  ids: readonly string[],
  factOf: (id: string) => string,
  random: () => number
): { score: (id: string) => number; selected: (id: string) => void } {
  const enabled = graph.version === 1 && graph.lessons[key] === revision;
  if (enabled) ordinals ??= new Map(graph.facts.map((fact, index) => [fact, index]));
  const candidates = [...new Set(ids)].map((id) => ({
    id,
    ordinal: enabled ? ordinals!.get(factOf(id)) : undefined,
    priority: random() * 0.25,
    redundancy: 0,
  }));
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  return {
    score: (id) => {
      const candidate = byId.get(id);
      return candidate ? candidate.priority - candidate.redundancy : -Infinity;
    },
    selected: (id) => {
      const selected = byId.get(id)?.ordinal;
      if (selected === undefined) return;
      for (const candidate of candidates) {
        const cosine = similarity(selected, candidate.ordinal);
        // A soft preference for varied examples, not a semantic duplicate classifier.
        // Never blocks a card: smaller pools and later visits can still exhaust every fact.
        const redundancy = Math.max(0, (cosine - 0.8) / 0.2);
        candidate.redundancy = Math.max(candidate.redundancy, redundancy);
      }
    },
  };
}
