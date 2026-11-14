/**
 * The card catalog: card id / quiz fact id → the student app's subcategory labels. On the phone
 * the 1.9 MB TSV is parsed natively (modules/tala-activity CardCatalog.kt) and queried through
 * `nativeCatalog`; this TypeScript parser is the same algorithm for tests and for small fixtures.
 * Format and append-only rule: packages/tala/scripts/build-card-catalog.py on branch tala-0.4.x.
 */
import type { LearningEvent } from './learning';

export interface Catalog {
  /** Labels for a learning event, [] when it cannot be placed (generated card, unknown id). */
  subcategories(events: LearningEvent[]): Promise<string[][]>;
}

export class ParsedCatalog implements Catalog {
  private constructor(
    private readonly labels: string[],
    private readonly labelOfId: Map<string, number>,
    readonly cards: Map<string, number[]>,
    readonly facts: Map<string, number[]>
  ) {}

  get size(): number {
    return this.cards.size + this.facts.size;
  }

  label(index: number): string {
    return this.labels[index]!;
  }

  labelOf(id: string): string | undefined {
    const index = this.labelOfId.get(id);
    return index === undefined ? undefined : this.labels[index];
  }

  ids(): Set<string> {
    return new Set(this.labelOfId.keys());
  }

  subcategoriesOf(event: LearningEvent): number[] {
    switch (event.name) {
      case 'card_viewed':
        return this.cards.get(event.cardId) ?? [];
      case 'quiz_graded':
        return this.facts.get(event.questionId) ?? this.facts.get(event.cardId) ?? [];
      default:
        return [];
    }
  }

  async subcategories(events: LearningEvent[]): Promise<string[][]> {
    return events.map((e) => this.subcategoriesOf(e).map((i) => this.labels[i]!));
  }

  static parse(text: string): ParsedCatalog {
    const labels: string[] = [];
    const labelIndex = new Map<string, number>();
    const labelOfLine: number[] = [];
    const labelOfId = new Map<string, number>();
    const cards = new Map<string, number[]>();
    const facts = new Map<string, number[]>();
    const combinations = new Map<string, number[]>();
    let start = 0;
    while (start < text.length) {
      let end = text.indexOf('\n', start);
      if (end < 0) end = text.length;
      const line = text.slice(start, end);
      start = end + 1;
      if (!line || line[0] === '#') continue;
      const second = line.indexOf('\t', 2);
      if (
        line.length <= 2 ||
        line[1] !== '\t' ||
        second <= 2 ||
        second >= line.length - 1 ||
        line.indexOf('\t', second + 1) >= 0
      )
        throw new Error(`Malformed card catalog line: ${line}`);
      const key = line.slice(2, second);
      const value = line.slice(second + 1);
      switch (line[0]) {
        case 'T': {
          let label = labelIndex.get(value);
          if (label === undefined) {
            label = labels.push(value) - 1;
            labelIndex.set(value, label);
          }
          labelOfLine.push(label);
          labelOfId.set(key, label);
          break;
        }
        case 'C':
        case 'F': {
          let lines = combinations.get(value);
          if (!lines) {
            lines = value.split(',').map((n) => {
              if (!/^\d+$/.test(n)) throw new Error(`Malformed card catalog line: ${line}`);
              return Number(n);
            });
            combinations.set(value, lines);
          }
          (line[0] === 'C' ? cards : facts).set(key, lines);
          break;
        }
        default:
          throw new Error(`Unknown card catalog record: ${line}`);
      }
    }
    if (!labels.length) throw new Error('Card catalog has no subcategories');
    const byLines = new Map<number[], number[]>();
    for (const lines of combinations.values()) {
      if (!lines.length || lines.some((i) => i < 0 || i >= labelOfLine.length))
        throw new Error('Card catalog names a subcategory it does not define');
      byLines.set(lines, [...new Set(lines.map((i) => labelOfLine[i]!))]);
    }
    for (const [k, v] of cards) cards.set(k, byLines.get(v)!);
    for (const [k, v] of facts) facts.set(k, byLines.get(v)!);
    return new ParsedCatalog(labels, labelOfId, cards, facts);
  }
}

/** Catalog over the native module: the TSV stays in native memory. */
export function nativeCatalog(native: {
  catalogSubcategories(eventsJson: string): Promise<string>;
}): Catalog {
  return {
    async subcategories(events) {
      if (!events.length) return [];
      const json = await native.catalogSubcategories(
        JSON.stringify(
          events.map((e) => ({ name: e.name, cardId: e.cardId, questionId: e.questionId }))
        )
      );
      return JSON.parse(json) as string[][];
    },
  };
}

/** A catalog that places nothing: the UI still works when the asset is missing. */
export const emptyCatalog: Catalog = {
  async subcategories(events) {
    return events.map(() => []);
  },
};
