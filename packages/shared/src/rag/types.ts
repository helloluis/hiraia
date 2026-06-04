/**
 * A single curated science fact in the grounding bank.
 *
 * Source of truth is `rag/bank/science-facts.jsonl` at the repo root; the
 * bundled `facts.generated.ts` is compiled from it via
 * `rag/scripts/export-facts-ts.py`. Edit the JSONL, regenerate — never edit the
 * generated module by hand.
 */
export interface ScienceFact {
  id: string;
  domain:
    | 'MATTER'
    | 'LIVING_THINGS'
    | 'FORCE_MOTION_ENERGY'
    | 'EARTH_SPACE'
    // Facts about Hiraia itself (identity, purpose, who built it) so the tutor
    // can answer "sino ka / para saan to" authoritatively.
    | 'ABOUT_HIRAIA';
  topic: string;
  /** Curriculum grade bands this fact suits (2–10); descriptive metadata. */
  grades: number[];
  /** Tagalog + Bisaya + English query keywords, for lexical retrieval. */
  terms: string[];
  /** The fact text in each supported language. */
  fact: { tl: string; en: string; bis: string };
  source: string;
  generator: string;
  reviewed: boolean;
}

/** A retrieved fact plus its relevance score, language-resolved for display. */
export interface FactHit {
  fact: ScienceFact;
  /** Body text in the requested language. */
  text: string;
  /** Raw relevance score (higher = better; not normalized). */
  score: number;
}
