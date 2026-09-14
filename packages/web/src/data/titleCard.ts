import topics from './demo-title-topics.json';
import { getCard, hasDemoArt, type CardFact } from './cards';
export interface TitleCardContent {
  key: string; quarter: number; category: string;
  title: { en: string; tl: string; bis: string }; slugs: string[];
}
export function titleForCard(fact: CardFact, grade: number, previous?: string | null): TitleCardContent | null {
  const candidates = topics.filter(t => t.grade === grade && t.cardIds.includes(fact.id));
  const topic = candidates.find(t => t.key === previous) ?? candidates[0];
  if (!topic) return null;
  const slugs = [...new Set([fact.id, ...topic.cardIds].map(id => getCard(id)?.slug).filter((slug): slug is string => !!slug && hasDemoArt(slug)))].slice(0, 3);
  return { ...topic, slugs };
}
