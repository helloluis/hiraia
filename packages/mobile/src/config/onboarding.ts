import type { Language } from '@hiraia/shared';

/**
 * Copy for the onboarding carousel. Bisaya (cebuano) strings are first-draft and
 * should be reviewed by a native speaker — flagged in the PR.
 */

// Order the slide-1 question cycles through (typewritered, each replacing the last).
export const LANG_CYCLE: Language[] = ['tagalog', 'english', 'cebuano'];

// Slide 1 — "How do you want to use Hiraia?" (cycled across languages).
export const Q_HOW_USE: Record<Language, string> = {
  tagalog: 'Paano mo gustong gamitin ang Hiraia?',
  english: 'How do you want to use Hiraia?',
  cebuano: 'Unsaon nimo paggamit ang Hiraia?',
};

// Slide 1 — each language's self-identification button, written IN that language.
export const LANG_BUTTON: Record<Language, string> = {
  tagalog: 'Magtatagalog po ako',
  english: 'I want to use English',
  cebuano: 'Magbinisaya ko',
};

// Slide 2 — caption above the chat demo (shown in the chosen language).
export const DEMO_CAPTION: Record<Language, string> = {
  tagalog: 'Magtanong ng kahit ano tungkol sa agham!',
  english: 'Ask anything about grade-school science!',
  cebuano: 'Pangutana bisan unsa bahin sa siyensya!',
};

// Slide 2 — the message the demo "user" types.
export const DEMO_QUESTION: Record<Language, string> = {
  tagalog: 'paexplain po ng photosynthesis',
  english: 'explain photosynthesis please',
  cebuano: 'palihug i-explain ang photosynthesis',
};

// Slide 2 — Hiraia's short demo reply (1–2 sentences).
export const DEMO_ANSWER: Record<Language, string> = {
  tagalog:
    'Sa photosynthesis, gumagawa ng sariling pagkain ang halaman gamit ang sikat ng araw, tubig, at hangin! 🌱',
  english: 'In photosynthesis, plants make their own food using sunlight, water, and air! 🌱',
  cebuano:
    'Sa photosynthesis, ang mga tanom maghimo og kaugalingong pagkaon gamit ang adlaw, tubig, ug hangin! 🌱',
};

// Slide 2 — the illustration slug shown in the demo reply (resolves via imageMap).
export const DEMO_IMAGE_SLUG = 'plant-parts';

// Slide 3 — download notice.
export const DL_TITLE: Record<Language, string> = {
  tagalog: 'Sandali lang — may ida-download',
  english: 'One quick download',
  cebuano: 'Kadiyot lang — naay i-download',
};
export const DL_BODY: Record<Language, string> = {
  tagalog:
    'Kailangan munang i-download ang malaking file na naglalaman ng Hiraiapedia at ng AI na guro. Maaaring tumagal ito nang ilang minuto — pasensya na! Nagsimula na itong mag-download habang binabasa mo ito. 📚',
  english:
    'We first need to download a large file with the Hiraiapedia and the AI tutor. This can take a few minutes — sorry for the wait! It already started downloading while you read this. 📚',
  cebuano:
    'Kinahanglan una namong i-download ang dakong file nga naay Hiraiapedia ug AI nga magtutudlo. Mahimong molungtad kini og pipila ka minuto — pasensya na! Nagsugod na kini pag-download samtang nagbasa ka. 📚',
};
export const DL_OK: Record<Language, string> = {
  tagalog: 'Sige!',
  english: 'OK!',
  cebuano: 'Sige!',
};
