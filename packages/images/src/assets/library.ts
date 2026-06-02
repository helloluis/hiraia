/**
 * AssetLibrary — loads, caches, and searches curated SVG assets.
 *
 * Provides keyword-based and metadata-filtered search over a directory
 * of SVG + JSON metadata pairs. Designed for in-memory use on-device.
 */

import { readFile, readdir } from 'node:fs/promises';
import { join, basename, dirname } from 'node:path';
import type {
  AssetMetadata,
  LoadedAsset,
  AssetQuery,
  AssetSearchResult,
} from './types.js';

/**
 * Parse the inner SVG content from a full SVG file string.
 * Strips the <?xml> declaration and <svg> wrapper, returning just the
 * inner elements suitable for embedding in a <g> group.
 */
function extractSvgContent(svgString: string): { content: string; viewBox: string } {
  // Strip XML declaration
  const withoutDecl = svgString.replace(/<\?xml[^?]*\?>\s*/i, '');

  // Extract viewBox
  const viewBoxMatch = withoutDecl.match(/viewBox="([^"]+)"/);
  const viewBox = viewBoxMatch ? viewBoxMatch[1] ?? '0 0 100 100' : '0 0 100 100';

  // Extract inner content between <svg ...> and </svg>
  const innerMatch = withoutDecl.match(/<svg[^>]*>([\s\S]*)<\/svg>/i);
  const content = innerMatch ? (innerMatch[1] ?? '').trim() : '';

  return { content, viewBox };
}

/**
 * Compute a simple keyword relevance score for a query against an asset.
 * Returns a score between 0 and 1.
 */
function scoreAsset(query: AssetQuery, meta: AssetMetadata): number {
  let score = 0;
  let factors = 0;

  // Text search — check name, description, tags
  if (query.text) {
    factors++;
    const terms = query.text.toLowerCase().split(/\s+/);
    const haystack = [
      meta.name,
      meta.description,
      ...meta.tags,
    ].join(' ').toLowerCase();

    const matched = terms.filter((t) => haystack.includes(t)).length;
    if (terms.length > 0) {
      score += matched / terms.length;
    }
  }

  // Subject filter
  if (query.subject) {
    factors++;
    if (meta.subject === query.subject) {
      score += 1;
    }
  }

  // Grade filter
  if (query.grade) {
    factors++;
    if (meta.grades.includes(query.grade)) {
      score += 1;
    }
  }

  // Tag filter
  if (query.tags && query.tags.length > 0) {
    factors++;
    const matched = query.tags.filter((t) =>
      meta.tags.includes(t.toLowerCase())
    ).length;
    score += matched / query.tags.length;
  }

  return factors > 0 ? score / factors : 0.5;
}

export class AssetLibrary {
  private assets = new Map<string, LoadedAsset>();
  private loaded = false;

  /** Load all SVG + JSON pairs from the given root directory. */
  async load(rootDir: string): Promise<void> {
    const subjects = ['biology', 'chemistry', 'physics', 'earth-science', 'general'];

    for (const subject of subjects) {
      const dir = join(rootDir, subject);
      let files: string[];
      try {
        files = await readdir(dir);
      } catch {
        continue; // directory doesn't exist, skip
      }

      const svgFiles = files.filter((f) => f.endsWith('.svg'));

      for (const svgFile of svgFiles) {
        const id = basename(svgFile, '.svg');
        const jsonFile = join(dir, `${id}.json`);

        let meta: AssetMetadata;
        try {
          const jsonStr = await readFile(jsonFile, 'utf-8');
          meta = JSON.parse(jsonStr) as AssetMetadata;
        } catch {
          console.warn(`AssetLibrary: skipping ${subject}/${id} — missing or invalid JSON metadata`);
          continue;
        }

        const svgStr = await readFile(join(dir, svgFile), 'utf-8');
        const { content, viewBox } = extractSvgContent(svgStr);

        this.assets.set(id, {
          meta: { ...meta, id },
          svgContent: content,
          viewBox,
        });
      }
    }

    this.loaded = true;
  }

  /** Load assets synchronously from pre-fetched data (for browser/embedded use). */
  loadFromData(data: { meta: AssetMetadata; svg: string }[]): void {
    for (const { meta, svg } of data) {
      const { content, viewBox } = extractSvgContent(svg);
      this.assets.set(meta.id, {
        meta,
        svgContent: content,
        viewBox,
      });
    }
    this.loaded = true;
  }

  /** Get a single asset by ID. */
  get(id: string): LoadedAsset | undefined {
    return this.assets.get(id);
  }

  /** List all loaded asset IDs. */
  list(): string[] {
    return Array.from(this.assets.keys());
  }

  /** Get all loaded assets. */
  all(): LoadedAsset[] {
    return Array.from(this.assets.values());
  }

  /** Total number of loaded assets. */
  get size(): number {
    return this.assets.size;
  }

  /** Whether the library has been loaded. */
  get isLoaded(): boolean {
    return this.loaded;
  }

  /**
   * Search for assets matching a query.
   *
   * Results are sorted by relevance score (highest first).
   * Assets with a score of 0 are excluded.
   */
  search(query: AssetQuery): AssetSearchResult[] {
    if (!this.loaded) {
      throw new Error('AssetLibrary: not loaded. Call load() or loadFromData() first.');
    }

    const limit = query.limit ?? 10;
    const results: AssetSearchResult[] = [];

    for (const asset of this.assets.values()) {
      const s = scoreAsset(query, asset.meta);
      if (s > 0) {
        results.push({ asset, score: s });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  /**
   * Find the best-matching asset for a text prompt.
   * Convenience wrapper around search().
   */
  findBest(text: string): LoadedAsset | undefined {
    const results = this.search({ text, limit: 1 });
    return results[0]?.asset;
  }
}
