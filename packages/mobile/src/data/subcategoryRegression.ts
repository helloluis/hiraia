import cardsIndex from '../generated/cardsIndex.generated.json';
import prerequisiteMap from './subcategoryPrerequisites.json';

interface TaxonomyLeaf {
  id: string;
  grade?: number;
  strand?: string;
}

interface IndexedCard {
  id: string;
  cats?: string[];
}

const gradeFromId = (id: string) => {
  const match = /^g(\d+)-/.exec(id);
  return match ? Number(match[1]) : undefined;
};
const leaves = new Map(
  ((cardsIndex as { taxonomy?: TaxonomyLeaf[] }).taxonomy ?? []).map((leaf) => [
    leaf.id,
    { ...leaf, grade: leaf.grade ?? gradeFromId(leaf.id) },
  ])
);
const links = prerequisiteMap.links as Record<string, string[]>;
const cardsBySubcategory = new Map<string, string[]>();

for (const card of (cardsIndex as { cards: IndexedCard[] }).cards) {
  for (const category of card.cats ?? []) {
    if (leaves.get(category)?.grade == null) continue;
    const cards = cardsBySubcategory.get(category) ?? [];
    cards.push(card.id);
    cardsBySubcategory.set(category, cards);
  }
}

/** Grade-local DepEd subcategories attached to a card. Generic browsing tags are excluded. */
export function subcategoriesForCard(card: IndexedCard, grade: number): string[] {
  return (card.cats ?? []).filter((id) => leaves.get(id)?.grade === grade);
}

export function prerequisitesForSubcategory(subcategory: string): readonly string[] {
  return links[subcategory] ?? [];
}

/**
 * Resolve the closest earlier-grade shelf that currently has enough cards to teach from.
 * Empty shelves are skipped by following the authored chain, so a partially built content
 * pack cannot strand or crash the feed.
 */
export function populatedPrerequisite(
  subcategory: string,
  minimumCards = 3
): { subcategory: string; grade: number; cardIds: readonly string[] } | null {
  const visited = new Set<string>();
  let frontier = [...prerequisitesForSubcategory(subcategory)];

  while (frontier.length) {
    const next: string[] = [];
    for (const id of frontier) {
      if (visited.has(id)) continue;
      visited.add(id);
      const leaf = leaves.get(id);
      const cardIds = cardsBySubcategory.get(id) ?? [];
      if (leaf?.grade != null && cardIds.length >= minimumCards) {
        return { subcategory: id, grade: leaf.grade, cardIds };
      }
      next.push(...prerequisitesForSubcategory(id));
    }
    frontier = next;
  }
  return null;
}

export function subcategoryGrade(subcategory: string): number | null {
  return leaves.get(subcategory)?.grade ?? null;
}
