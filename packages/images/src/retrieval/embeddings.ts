/**
 * Simple text embedding and retrieval system.
 *
 * Uses TF-IDF-like scoring for keyword matching. This is a lightweight
 * implementation suitable for on-device use without external embedding models.
 * For production, replace with a proper embedding model (e.g. sentence-transformers).
 */

import type { LoadedAsset, AssetQuery, AssetSearchResult } from '../assets/types.js';

/** Tokenize text into lowercase words, removing stopwords. */
function tokenize(text: string): string[] {
  const stopwords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
    'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
    'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need',
    'it', 'its', 'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she',
    'we', 'they', 'me', 'him', 'her', 'us', 'them',
  ]);

  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !stopwords.has(w));
}

/** Compute term frequency for a document. */
function termFrequency(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const token of tokens) {
    tf.set(token, (tf.get(token) ?? 0) + 1);
  }
  // Normalize by document length
  const len = tokens.length;
  if (len > 0) {
    for (const [term, count] of tf) {
      tf.set(term, count / len);
    }
  }
  return tf;
}

/** Compute cosine similarity between two term frequency vectors. */
function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (const [term, weight] of a) {
    normA += weight * weight;
    if (b.has(term)) {
      dotProduct += weight * b.get(term)!;
    }
  }

  for (const weight of b.values()) {
    normB += weight * weight;
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  return magnitude > 0 ? dotProduct / magnitude : 0;
}

/** Build a text representation of an asset for embedding. */
function assetToText(asset: LoadedAsset): string {
  const parts = [
    asset.meta.name,
    asset.meta.description,
    ...asset.meta.tags,
    asset.meta.subject,
    ...asset.meta.grades,
  ];
  if (asset.meta.curriculum) {
    parts.push(...asset.meta.curriculum);
  }
  return parts.join(' ');
}

export class SimpleRetriever {
  private embeddings = new Map<string, Map<string, number>>();

  /** Index a set of assets for retrieval. */
  index(assets: LoadedAsset[]): void {
    for (const asset of assets) {
      const text = assetToText(asset);
      const tokens = tokenize(text);
      const tf = termFrequency(tokens);
      this.embeddings.set(asset.meta.id, tf);
    }
  }

  /** Retrieve assets matching a text query. */
  retrieve(query: string, assets: LoadedAsset[], limit = 5): AssetSearchResult[] {
    if (this.embeddings.size === 0) {
      this.index(assets);
    }

    const queryTokens = tokenize(query);
    const queryEmbedding = termFrequency(queryTokens);

    const results: AssetSearchResult[] = [];

    for (const asset of assets) {
      const assetEmbedding = this.embeddings.get(asset.meta.id);
      if (!assetEmbedding) continue;

      const score = cosineSimilarity(queryEmbedding, assetEmbedding);
      if (score > 0) {
        results.push({ asset, score });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  /** Find the best matching asset for a query. */
  findBest(query: string, assets: LoadedAsset[]): LoadedAsset | undefined {
    const results = this.retrieve(query, assets, 1);
    return results[0]?.asset;
  }
}
