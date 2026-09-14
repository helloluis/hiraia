import { getCard, cursorTopic, type CardFact, type CurriculumCursor } from './cards';
import { lessonByKey, lessonsForGrade } from './lessonPlan';
import { artSourceFor } from './artSource';

export interface TitleCardContent {
  key: string;
  quarter: number;
  category: string;
  title: { en: string; tl: string; bis: string };
  slugs: string[];
}

/** Preview only illustrations belonging to the lesson the student is entering. */
export function titleForCard(fact: CardFact, grade: number, cursor: CurriculumCursor | null): TitleCardContent | null {
  const lesson = (cursor?.idSet.has(fact.id) ? lessonByKey(cursor.key) : null)
    ?? lessonsForGrade(grade).find(l => l.cardIds.includes(fact.id));
  const topic = cursor && cursorTopic(cursor);
  if (!lesson && !topic) return null;
  const ids = cursor?.idSet.has(fact.id) ? [...cursor.idSet] : lesson?.cardIds ?? [fact.id];
  const slugs: string[] = [];
  for (const id of [fact.id, ...ids]) {
    const slug = getCard(id)?.slug;
    if (slug && !slugs.includes(slug) && artSourceFor(slug)) slugs.push(slug);
    if (slugs.length === 3) break;
  }
  const category = lesson?.subcategories[0]?.replace(/^g\d+-/, '').split('-')[0] ?? fact.domain;
  return { key: `${grade}:${lesson?.key ?? cursor!.key}`, quarter: lesson?.quarter ?? topic!.quarter,
    category: category === 'living_things' || category === 'living' ? 'Living things' : category === 'force' ? 'Force, motion and energy' : category === 'earth' ? 'Earth and space' : category,
    title: lesson?.title ?? topic!.title, slugs };
}
