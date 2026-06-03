/**
 * Asset library types.
 *
 * Defines the metadata schema for curated SVG assets and the retrieval
 * interfaces used by the RAG pipeline.
 */

// ─── Asset Metadata ───────────────────────────────────────────────────────────

export type Subject = 'biology' | 'chemistry' | 'physics' | 'earth-science' | 'general';

export type GradeBand = 'K-3' | '4-6' | '7-9' | '10-12';

export interface AssetMetadata {
  /** Unique asset identifier (matches filename without extension). */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Short description for retrieval and tooltips. */
  description: string;
  /** Subject area. */
  subject: Subject;
  /** Grade bands this asset is appropriate for. */
  grades: GradeBand[];
  /** Free-form tags for search and filtering. */
  tags: string[];
  /** DepEd curriculum code alignment (e.g. "S6FE-IIa-c-1"). */
  curriculum?: string[];
  /** Source of the asset (e.g. "bioicons", "wikimedia", "hiraia"). */
  source: string;
  /** License type. */
  license: 'CC-BY-4.0' | 'CC-BY-SA-4.0' | 'CC0' | 'MIT' | 'proprietary';
  /** Original SVG viewBox dimensions [w, h]. */
  viewBox: [number, number];
}

// ─── Loaded Asset ─────────────────────────────────────────────────────────────

export interface LoadedAsset {
  meta: AssetMetadata;
  /** Raw SVG string (the inner content, stripped of <svg> wrapper). */
  svgContent: string;
  /** Original SVG viewBox string. */
  viewBox: string;
}

// ─── Search / Retrieval ───────────────────────────────────────────────────────

export interface AssetQuery {
  /** Free-text search term. */
  text?: string;
  /** Filter by subject. */
  subject?: Subject;
  /** Filter by grade band. */
  grade?: GradeBand;
  /** Filter by tags (any match). */
  tags?: string[];
  /** Maximum results to return. */
  limit?: number;
}

export interface AssetSearchResult {
  asset: LoadedAsset;
  /** Relevance score (0-1, higher is better). */
  score: number;
}
