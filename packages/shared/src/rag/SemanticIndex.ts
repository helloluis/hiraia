import type { Language } from '../types/index.js';

/**
 * Brute-force semantic retriever over the bundled int8 LaBSE vectors.
 *
 * The corpus is embedded at BUILD time (rag/scripts/build-vectors.py, LaBSE
 * raw-CLS — the exact on-device embedder) and shipped as a quantized int8 blob.
 * At query time the engine embeds the single incoming query with the same model
 * (@qvac/embed-llamacpp GGMLBert), normalizes it, and passes the vector here.
 *
 * At ~21k facts a flat dot-product scan is sub-millisecond — no ANN index, no
 * sqlite-vec, matching RagStore's "fits in RAM" design. int8 is lossless for
 * ranking (verified: identical Recall@3 vs float32). The constant dequant
 * `scale` cancels in the ranking and is only applied to recover the true cosine
 * for the abstain floor.
 */

export type LangKey = 'tl' | 'bis' | 'en';

export interface SemanticBlob {
  dims: number;
  /** int8 → cosine dequant factor (cosine = dot(query, int8) * scale). */
  scale: number;
  count: number;
  /** language order within `data` (lang-major layout). */
  langs: LangKey[];
  /** lang-major int8: [lang0 count*dims][lang1 ...]… ; fact order == bank file order. */
  data: Int8Array;
}

const LANG_KEY: Record<Language, LangKey> = { english: 'en', tagalog: 'tl', cebuano: 'bis' };

export interface SemHit {
  /** fact ORDINAL — line N of rag/bank/science-facts.jsonl, which is also `fact.ord`. */
  index: number;
  /** true cosine similarity in [-1, 1]. */
  cosine: number;
}

export class SemanticIndex {
  private base: Partial<Record<LangKey, number>> = {};

  constructor(private blob: SemanticBlob) {
    const stride = blob.count * blob.dims;
    blob.langs.forEach((lk, i) => {
      this.base[lk] = i * stride;
    });
  }

  get count(): number {
    return this.blob.count;
  }

  /**
   * Top-k facts by cosine to a NORMALIZED query vector, scored against the
   * language-scoped corpus (mirrors RagStore's language scoping). Cebuano facts
   * use the `bis` body, etc.
   */
  search(query: Float32Array, language: Language, topK: number): SemHit[] {
    const { dims, count, data, scale } = this.blob;
    const lk = LANG_KEY[language] ?? 'tl';
    const base = this.base[lk] ?? 0;
    const scores = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      let s = 0;
      const off = base + i * dims;
      for (let d = 0; d < dims; d++) s += query[d]! * data[off + d]!;
      scores[i] = s;
    }
    // partial top-k selection (avoid sorting all 21k)
    const top: number[] = [];
    for (let i = 0; i < count; i++) {
      const si = scores[i]!;
      if (top.length < topK) {
        top.push(i);
        if (top.length === topK) top.sort((a, b) => scores[b]! - scores[a]!);
      } else if (si > scores[top[topK - 1]!]!) {
        let p = topK - 1;
        while (p > 0 && si > scores[top[p - 1]!]!) {
          top[p] = top[p - 1]!;
          p--;
        }
        top[p] = i;
      }
    }
    return top.map((i) => ({ index: i, cosine: scores[i]! * scale }));
  }
}
