/**
 * A single curated science fact in the grounding bank.
 *
 * Source of truth is `rag/bank/science-facts.jsonl` at the repo root. Node reads it
 * directly (`loadFactBank`, `@hiraia/shared/node`); the app reads it out of the `fact` table
 * in `packages/mobile/assets/data/cards.db`, compiled from the same JSONL by
 * `rag/pipeline/build-facts-db.py`. Edit the JSONL, rebuild the database.
 *
 * LINE ORDER IS AN API. Line N is fact ordinal N, and `assets/rag/vectors-labse.i8.bin` is
 * positional — vector i belongs to bank row i. Append; never reorder.
 */
export interface ScienceFact {
  id: string;
  domain:
    | 'MATTER'
    | 'LIVING_THINGS'
    | 'FORCE_MOTION_ENERGY'
    | 'EARTH_SPACE'
    // Philippine civic/cultural canon (national anthem, pledge, flag, prayers,
    // constitution, symbols) and geography (regions + provinces) — so a Filipino
    // tutor "just knows" the basics it would be embarrassing to miss.
    | 'PH_CIVICS'
    | 'PH_GEOGRAPHY'
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
