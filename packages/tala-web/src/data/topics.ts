/**
 * Short topic labels for competencies (PRD CUR, Luis's review): "Term 2, Week 1: Exploring Motion" first, with the
 * full official competency text kept underneath as the authoritative wording. Uses `shortTitle`/`weekFrom`/`weekTo`
 * when a pack has them; otherwise falls back to the domain trimmed to four words, and to "Term N" without a week.
 */
import type { Competency, Lang } from '@hiraia/tala-core/contracts';

const WORDS: Record<Lang, { term: string; week: string; weeks: string }> = {
  en: { term: 'Term', week: 'Week', weeks: 'Weeks' },
  fil: { term: 'Term', week: 'Week', weeks: 'Weeks' },
};

export function trimWords(text: string | null | undefined, max = 4): string {
  if (!text) return '';
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  return words.slice(0, max).join(' ');
}

/** The one-to-four-word title: shortTitle, else the domain, else the first words of the competency text. */
export function topicTitle(c: Pick<Competency, 'shortTitle' | 'domain' | 'text'>): string {
  if (c.shortTitle?.trim()) return trimWords(c.shortTitle, 6);
  const domain = trimWords(c.domain, 4);
  if (domain) return domain;
  return trimWords(c.text, 4) + '…';
}

/** "Term 2, Week 1" / "Term 2, Weeks 3–4" / "Term 2". */
export function timeLabel(
  c: Pick<Competency, 'termIndex' | 'weekFrom' | 'weekTo'>,
  lang: Lang
): string {
  const w = WORDS[lang];
  const term = `${w.term} ${c.termIndex}`;
  if (c.weekFrom && c.weekTo && c.weekTo !== c.weekFrom)
    return `${term}, ${w.weeks} ${c.weekFrom}–${c.weekTo}`;
  if (c.weekFrom) return `${term}, ${w.week} ${c.weekFrom}`;
  return term;
}

export interface TopicLabel {
  /** e.g. "Term 2, Week 1: Exploring Motion" */
  heading: string;
  time: string;
  title: string;
  /** Full official competency text; never dropped. */
  text: string;
  code: string | null;
}

export function topicLabel(c: Competency, lang: Lang): TopicLabel {
  const time = timeLabel(c, lang);
  const title = topicTitle(c);
  return { heading: `${time}: ${title}`, time, title, text: c.text, code: c.code };
}
