/**
 * Fixed words printed on slides, per language. Mirrors packages/tala-packs/src/render/labels.ts (the Filipino slide
 * labels reuse the section names learners know from DepEd self-learning modules: Tuklasin, Suriin, Subukin, Isaisip,
 * Tayahin). Keep the two files in step: a deck must read the same in the browser and in PowerPoint.
 */
import type { PackLang, SlideKind } from '../contracts/packs';

export interface DeckLabels {
  chip: Partial<Record<SlideKind | 'exit', string>>;
  day: string;
  draftBadge: string;
  footer: (grade: string, term: number, week: number) => string;
  creditsReviewed: (name: string) => string;
  creditsDraft: string;
  creditsArt: string;
  /** Added to the credits of a teacher's own copy, so an edited deck never passes as the reviewed original. */
  creditsEdited: string;
  sourcesIntro: string;
  sectionIntro: string;
  sectionAbout: string;
  sectionDay: string;
}

export const DECK_LABELS: Record<PackLang, DeckLabels> = {
  en: {
    chip: { question: 'Think about it', concept: 'Key idea', vocabulary: 'New words', activity: 'Activity', check: 'Check', reveal: 'Answer', summary: 'Remember', exit: 'Exit ticket' },
    day: 'DAY',
    draftBadge: 'DRAFT — not yet reviewed by a teacher',
    footer: (g, t, w) => `Grade ${g} Science · Term ${t} · Week ${w}`,
    creditsReviewed: (n) => `Reviewed by ${n}`,
    creditsDraft: 'Draft: checked automatically and by a second AI model; not yet reviewed by a teacher',
    creditsArt: 'Drawings © Hiraia: AI-generated (OpenAI and Google image models) and checked for science errors by Hiraia',
    creditsEdited: 'This copy was edited by its teacher; the edits were not checked by Hiraia',
    sourcesIntro: 'Sources in the teacher guide',
    sectionIntro: 'Introduction',
    sectionAbout: 'About this deck',
    sectionDay: 'Day',
  },
  fil: {
    chip: { question: 'Tuklasin', concept: 'Suriin', vocabulary: 'Mga bagong salita', activity: 'Gawain', check: 'Subukin', reveal: 'Sagot', summary: 'Isaisip', exit: 'Tayahin' },
    day: 'ARAW',
    draftBadge: 'DRAFT — hindi pa na-review ng teacher',
    footer: (g, t, w) => `Grade ${g} Science · Term ${t} · Week ${w}`,
    creditsReviewed: (n) => `Na-review ni ${n}`,
    creditsDraft: 'Draft na dumaan sa awtomatikong pagsusuri at binasa ng isa pang AI. Wala pang gurong nagsuri nito.',
    creditsArt: 'Mga drawing © Hiraia. Ginawa gamit ang mga image model ng OpenAI at Google. Sinuri ng Hiraia kung may mali sa Science.',
    creditsEdited: 'In-edit ng guro ang kopyang ito. Wala pang pagsusuri ng Hiraia sa mga pagbabago.',
    sourcesIntro: 'Mga sanggunian sa teacher guide',
    sectionIntro: 'Panimula',
    sectionAbout: 'Tungkol sa deck',
    sectionDay: 'Araw',
  },
};
