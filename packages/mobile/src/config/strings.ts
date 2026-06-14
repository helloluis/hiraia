import type { Language } from '@hiraia/shared';

/**
 * UI chrome strings that must follow the active TUTOR language (the model output is
 * already localized by the adapter; this is the app's own text — welcome note, input
 * placeholder, sidebar, status/error messages). Tagalog is the default/fallback.
 * Cebuano is "coming soon" but kept native so a beta switch reads correctly.
 *
 * Add new user-facing strings HERE (never inline) so English/Cebuano modes stay fully
 * localized. Look strings up via `uiStrings(activeLanguage)`.
 */
interface UIStrings {
  // chat screen
  welcomeTitle: string;
  welcomeSubtitle: string;
  inputPlaceholder: string;
  inputPreparing: string;
  waitPreparing: string;
  errorGeneric: string;
  // sidebar
  close: string;
  sectionLanguage: string;
  langRestartNote: string;
  beta: string;
  comingSoon: string;
  sectionConversations: string;
  noConversations: string;
  sectionNotes: string;
  noNotes: string;
  sectionVersion: string;
  labelModel: string;
  facts: string;
  tutorial: string;
  showTutorial: string;
  newConversation: string;
  // loader
  bootingUp: string;
}

const UI_STRINGS: Record<Language, UIStrings> = {
  tagalog: {
    welcomeTitle: 'Maligayang Pagdating sa Hiraia!',
    welcomeSubtitle: 'Magtanong ka ng kahit ano tungkol sa agham. Nandito ako para tulungan kang matuto.',
    inputPlaceholder: 'Magtanong tungkol sa agham...',
    inputPreparing: 'Inihahanda ang AI...',
    waitPreparing: 'Sandali lang—inihahanda ko pa ang AI. Pakisubukang muli sa ilang segundo. 🐱',
    errorGeneric: 'Paumanhin, may naganap na error. Pakisubukang muli. 🐱',
    close: '← Isara',
    sectionLanguage: 'Wika',
    langRestartNote: 'Sandali itong magri-restart kapag pinalitan.',
    beta: 'beta',
    comingSoon: 'malapit na!',
    sectionConversations: 'Mga Usapan',
    noConversations: 'Wala pang usapan',
    sectionNotes: 'Mga Tala',
    noNotes: 'Wala pang tala',
    sectionVersion: 'Bersyon',
    labelModel: 'Modelo',
    facts: 'datos',
    tutorial: 'Tutorial',
    showTutorial: 'Ipakita ang tutorial',
    newConversation: '+ Bagong Usapan',
    bootingUp: 'nag-boot up pa...',
  },
  english: {
    welcomeTitle: 'Welcome to Hiraia!',
    welcomeSubtitle: "Ask me anything about science. I'm here to help you learn.",
    inputPlaceholder: 'Ask about science...',
    inputPreparing: 'Preparing the AI...',
    waitPreparing: "One moment—I'm still preparing the AI. Please try again in a few seconds. 🐱",
    errorGeneric: 'Sorry, something went wrong. Please try again. 🐱',
    close: '← Close',
    sectionLanguage: 'Language',
    langRestartNote: 'It restarts briefly when you switch.',
    beta: 'beta',
    comingSoon: 'coming soon',
    sectionConversations: 'Conversations',
    noConversations: 'No conversations yet',
    sectionNotes: 'Notes',
    noNotes: 'No notes yet',
    sectionVersion: 'Version',
    labelModel: 'Model',
    facts: 'facts',
    tutorial: 'Tutorial',
    showTutorial: 'Show the tutorial',
    newConversation: '+ New Conversation',
    bootingUp: 'still booting up...',
  },
  cebuano: {
    welcomeTitle: 'Maayong Pag-abot sa Hiraia!',
    welcomeSubtitle: 'Pangutana bisan unsa bahin sa siyensya. Ania ko aron motabang nimo nga makakat-on.',
    inputPlaceholder: 'Pangutana bahin sa siyensya...',
    inputPreparing: 'Giandam ang AI...',
    waitPreparing: 'Kadiyot lang—giandam pa nako ang AI. Palihug sulayi pag-usab sa pipila ka segundo. 🐱',
    errorGeneric: 'Pasayloa, naay sayop nga nahitabo. Palihug sulayi pag-usab. 🐱',
    close: '← Sirado',
    sectionLanguage: 'Pinulongan',
    langRestartNote: 'Mag-restart kini dali kung mag-usab ka.',
    beta: 'beta',
    comingSoon: 'hapit na!',
    sectionConversations: 'Mga Panag-istorya',
    noConversations: 'Wala pay panag-istorya',
    sectionNotes: 'Mga Nota',
    noNotes: 'Wala pay nota',
    sectionVersion: 'Bersyon',
    labelModel: 'Modelo',
    facts: 'datos',
    tutorial: 'Tutorial',
    showTutorial: 'Ipakita ang tutorial',
    newConversation: '+ Bag-ong Panag-istorya',
    bootingUp: 'nag-boot up pa...',
  },
};

/** UI strings for the active language (null → Tagalog default). */
export function uiStrings(language: Language | null | undefined): UIStrings {
  return UI_STRINGS[language ?? 'tagalog'];
}
