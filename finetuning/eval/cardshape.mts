/**
 * CARD-SHAPE invariants — the objective, deterministic half of "did the model print a card?".
 *
 * The product is no longer a conversational tutor. The on-device model is a SINGLE-TURN CARD
 * WRITER: given a child's typed topic plus retrieved grounding it prints ONE card-shaped fact
 * in their language at their grade, and stops. Everything a conversation turn is allowed to do
 * — greet, preface, close with a question, offer to continue, hedge, illustrate itself — is a
 * DEFECT on a printed card. Nothing in the old gate checked any of it (it asserted only
 * `max_tokens: 320` and an opt-in `maxChars` on 5 of 42 cases), so this module exists.
 *
 * It is the single source of truth for those invariants, kept beside `presentation.mts` (whose
 * emoji/image-tag counters it reuses) so the regression gate and any future scored benchmark
 * measure the same thing. Everything here is a hard rule: a violation is always wrong, on
 * every card, in every language. Per-case content assertions live in `harness/cases.json`.
 *
 * The numbers are the PRODUCT's, not this file's opinion:
 *   - 30 words: `buildCardPrompt` says "hindi hihigit sa 30 salita" / "no more than 30 words"
 *     in all three languages. The deck's own median printed card is 19 words.
 *   - CARD_MAX_CHARS (320): `sanitizeCardAnswer` truncates past it, and a truncated card is a
 *     failed card, so we assert the model stayed under it rather than being cut to fit.
 *   - zero emoji: the card deck renders a fixed ten-colour palette and Android draws emoji in
 *     full colour, which breaks it on sight (see CardFeedScreen/RewardCard) — the app strips
 *     nothing, so an emoji the model writes is an emoji on the card.
 */
import { presentation } from './presentation.mts';

/** Word ceiling from the card prompt itself (`buildCardPrompt`: "no more than 30 words"). */
export const CARD_WORD_CEILING = 30;

/** Mirror of `sanitizeCardAnswer`'s ceiling — past this the app truncates and prints "…". */
export const CARD_CHAR_CEILING = 320;

/** Words in a card. Punctuation-only tokens (a lone dash, "—") are not words. */
export function wordCount(text: string): number {
  return (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu) ?? []).length;
}

/** Mean word length — the crude register proxy the grade-pair probe compares. */
export function meanWordLength(text: string): number {
  const w = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu) ?? [];
  if (!w.length) return 0;
  return w.reduce((a, s) => a + s.length, 0) / w.length;
}

/**
 * A conversation turn opens with a greeting; a printed card does not.
 * Anchored at the start so a card that *mentions* "maayong panahon" is untouched.
 */
const GREETING_RE =
  /^\s*(kumusta|kamusta|musta|hello|hi|hey|halo|magandang\s+(araw|umaga|hapon|gabi)|maayong\s+(buntag|hapon|adlaw|gabii)|good\s+(morning|afternoon|day|evening)|uy|oy)\b/i;

/**
 * Preamble: the card announces itself, or leaks the prompt's own scaffolding ("according to
 * the FACTS", an echoed TANONG:/SAGOT: cue). `sanitizeCardAnswer` strips exactly ONE leading
 * cue, so anything left here is a cue the app would print.
 */
const PREAMBLE_RES: RegExp[] = [
  /^\s*(sige|siyempre|oo\s+naman|sure|of\s+course|certainly|okay|ok|alright)\b/i,
  /^\s*(narito|heto|eto|here(?:'s|\s+is)|this\s+is\s+the\s+answer|ang\s+sagot\s+(sa\s+tanong\s+)?ay|ania|kini\s+ang\s+tubag)\b/i,
  // "according to the FACTS below" in any of the three languages — the prompt talking to itself
  /\b(ayon|batay|base|sumala|sumala\s+sa|according|based)\s+sa?\s*(mga\s+|the\s+)?(fact|facts|impormasyon\s+sa\s+ibaba|datos\s+sa\s+ibaba|ibinigay\s+na\s+impormasyon)/i,
  /\b(mga\s+)?facts?\s+(sa\s+ibaba|sa\s+ubos|above|below|na\s+ibinigay|nga\s+gihatag)/i,
  // an echoed prompt cue anywhere in the body (a leading one is already stripped by the app)
  /\b(tanong|question|pangutana|sagot|answer|tubag)\s*:/i,
];

/**
 * A card states a fact and stops. Any question mark at all is a conversation move: either the
 * closing question the prompt forbids ("walang tanong sa dulo") or the child's own question
 * echoed back. This is deliberately absolute — a rhetorical question on a printed card is
 * still a card that talks back.
 */
const QUESTION_RE = /\?/;

/** Invitations to keep going — the closing move of a chat turn, with or without a "?". */
const INVITATION_RES: RegExp[] = [
  /\b(gusto|nais)\s+mo\s+ba(ng)?\b/i,
  /\b(subukan|tandaan|isipin|sabihin|tingnan)\s+mo\b/i,
  /\bano\s+sa\s+(tingin|palagay|akala)\s+mo\b/i,
  /\balam\s+mo\s+ba\b/i,
  /\b(gusto|ganahan)\s+ka\s+ba\b/i,
  /\b(sulayi|hinumdumi)\s+nimo\b/i,
  /\b(do|would)\s+you\s+want\b/i,
  /\bcan\s+you\s+(think|try|name)\b/i,
  /\blet'?s\b/i,
  /\b(tara|halika)\b/i,
];

/**
 * Deflection / over-abstention. The card prompt deliberately has NO "say you don't know"
 * clause (a 1,188-probe benchmark measured 64% of Tagalog replies OPENING with "hindi ko alam"
 * on terms the model then explained correctly, and that clause was the prime suspect) — a card
 * does not say it doesn't know. When the facts do not answer the query the prompt's ONLY
 * permitted escape is to print the nearest fact whole. So a deflection is a defect on EVERY
 * card, which is why this is universal here rather than the old per-case `mustGround` flag.
 *
 * Deliberately narrow — anchored deflection phrasings, not a bare "hindi" — so it does not
 * fire on legitimate science prose like "hindi ito bituin kundi planeta".
 */
export const REFUSAL_MARKERS: RegExp[] = [
  /hindi\s+(?:po\s+)?ako(?:\s+po)?\s+(?:gaano\s+)?(?:sigurado|tiyak|kumpiyansa)/i,
  /hindi\s+ko\s+(?:po\s+)?(?:alam|matiyak|masabi|maipaliwanag|sigurado|lubos na alam)/i,
  /hindi\s+(?:po\s+)?(?:sigurado|tiyak)\s+(?:ang|ako)/i,
  /wala\s+(?:po\s+)?ako(?:ng)?\s+(?:sapat\s+na\s+)?(?:impormasyon|alam|kaalaman|datos)/i,
  /(?:tanungin|magtanong|itanong|kausapin|konsultahin).{0,24}\b(?:guro|titser|teacher|magulang)\b/i,
  /(?:tingnan|basahin|hanapin|alamin|maghanap).{0,22}\b(?:libro|aklat|teksbuk|textbook|internet|reference)\b/i,
  /ayaw\s+ko(?:ng)?\s+(?:po\s+)?(?:magbigay|magsabi|manghula|mag-?imbento).{0,18}mali/i,
  /baka\s+(?:po\s+)?(?:ako\s+)?(?:magkamali|mali\s+ang|maling)/i,
  // Bisaya
  /wala\s+ko(?:y)?\s+(?:kasiguro|kasiguruhan|kahibalo|igong\s+impormasyon)/i,
  /pangutan-?a.{0,22}\b(?:magtutudlo|titser|maestra|maestro|ginikanan)\b/i,
  // English
  /\bI(?:'m| am)\s+not\s+(?:sure|certain)\b/i,
  /\bask\s+your\s+(?:teacher|parent)\b/i,
  /\bI\s+(?:don'?t|do not)\s+(?:know|have enough)\b/i,
];

/**
 * Degeneration signatures. Measured on the CPT'd Qwen3.5-2B: without a stop sequence it writes
 * the correct card and then repeats "**Pansin:** … **Paliwanag:** …" until the token cap. The
 * `stop: ['\n\n']` in the request is the fix; these assertions are the alarm for when it
 * stops being the fix. A printed card is one paragraph of prose — never a bolded label, a
 * bullet list, a heading, or the same sentence twice.
 */
const SCAFFOLD_RES: RegExp[] = [
  // MARKUP, colon or not. The three original patterns all required a `:` after the bolded
  // label, so a bare `**photosynthesis**` or `**June 19**` sailed through — and it is markup
  // the CHILD sees: `RichText` was deleted with the chat surface and `ResponseCard` renders
  // the card in a plain <Text>, so every asterisk and backtick prints literally.
  /\*\*/, // any bold run, labelled or not
  /```/, // code fence (measured: a card tailed off into ~28 repeated fences)
  /^\s*[-*•]\s+/m, // bullet list
  /^\s*#{1,6}\s+/m, // markdown heading
  /^\s*\d+\.\s+\S/m, // numbered list
];

/** The same sentence printed twice (the tail of a degeneration loop). */
function repeatedSentence(text: string): string | null {
  const seen = new Set<string>();
  for (const raw of text.split(/(?<=[.!?])\s+/)) {
    const key = raw.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
    if (wordCount(key) < 4) continue;
    if (seen.has(key)) return raw.trim().slice(0, 60);
    seen.add(key);
  }
  return null;
}

/* ------------------------------------------------------------------------------------------
 * LANGUAGE PURITY, all three directions.
 *
 * The old gate checked ONE direction (Filipino markers leaking into an English reply). The
 * product fills `bis` on all 50,279 bank rows and Cebuano is a first-class card language, so a
 * Tagalog card printed for a Cebuano child is exactly as much a failure as an English one.
 *
 * These sets are EXCLUSIVE by construction — the shared Filipino particles (ang, sa, mga, ni,
 * kung, kay, na, lang, wala, oo, salamat) are deliberately absent, because they score both
 * sides and would make every card look mixed. What is left only ever appears in one language,
 * so a SINGLE hit is real evidence of a leak, not a tally to be weighed. (Marker inventory
 * adapted from `detectLanguage` in packages/web/src/config/model.ts, then pruned to the
 * non-overlapping subset — that function classifies a user's message, this one polices a
 * card whose language is already known.)
 * ---------------------------------------------------------------------------------------- */
const TAGALOG_ONLY = new Set([
  'ano', 'anong', 'bakit', 'paano', 'paanong', 'kailan', 'sino', 'sinong', 'saan', 'nasaan',
  'ito', 'iyan', 'iyon', 'nito', 'niyan', 'niyon', 'hindi', 'huwag', 'dahil', 'kapag',
  'ngayon', 'kahapon', 'bukas', 'dito', 'doon', 'ganito', 'ganyan', 'meron', 'mayroon',
  'tayo', 'natin', 'namin', 'akin', 'iyo', 'kanya', 'atin', 'talaga',
  'naman', 'kasi', 'ay', 'upang', 'ngunit', 'subalit', 'tungkol', 'maganda', 'magandang',
  'po', 'opo', 'kumusta', 'kamusta',
]);
// NOTE: 'kanila' and 'inyo' were here and are NOT Tagalog-only — they are ordinary Cebuano
// ("ngadto kanila", "inyong lawas"). `kanila` is the fourth member of the very oblique
// paradigm whose kanako/kanimo/kaniya sit in CEBUANO_ONLY below, so keeping it here made the
// two sets non-exclusive and failed correct Cebuano cards on a single word (verified:
// "Ang kasingkasing nagbomba og dugo ngadto kanila ug sa inyong lawas." reported a Tagalog
// leak). Like ang/sa/mga/nga they are now in NEITHER set: shared words score for no one.
const CEBUANO_ONLY = new Set([
  'unsa', 'unsay', 'unsaon', 'giunsa', 'ngano', 'kinsa', 'naa', 'kini', 'kana',
  'kadto', 'gyud', 'gyod', 'jud', 'kaayo', 'dili', 'og', 'ug', 'nako', 'nimo',
  'kanako', 'kanimo', 'kaniya', 'nindot', 'maayo', 'maayong', 'palihug', 'bitaw', 'karon',
  'ganina', 'ugma', 'gahapon', 'tagpila', 'mao', 'ganahan', 'tanan', 'adunay', 'aduna',
  'tungod', 'busa', 'kasagaran', 'mahimong', 'sulod', 'gamay', 'kaugalingon',
]);
/**
 * `nga` is the one Cebuano workhorse that is NOT exclusive — Tagalog has the particle too
 * ("tama nga"). It is far too common in Cebuano prose to ignore as EVIDENCE that a card is
 * Cebuano, and far too risky to treat as PROOF that a Tagalog card leaked. So it counts only
 * on the positive side, never on the leak side.
 */
const CEBUANO_EVIDENCE = new Set([...CEBUANO_ONLY, 'nga', 'usa', 'pananglitan']);
// NOTE: 'at' is absent on purpose — it is Tagalog for "and", by far the commonest word in a
// Tagalog card, and including it would make every Tagalog card look English.
const ENGLISH_ONLY = new Set([
  'the', 'is', 'are', 'was', 'were', 'be', 'been', 'an', 'of', 'to', 'in', 'on',
  'and', 'or', 'but', 'with', 'for', 'from', 'they', 'them', 'their', 'its', 'it', 'this',
  'that', 'these', 'those', 'has', 'have', 'had', 'can', 'could', 'would', 'should', 'when',
  'which', 'because', 'while', 'into', 'about', 'than', 'then', 'also', 'you', 'your',
]);

/** Number of English function words a card may carry before it reads as an English card. */
const ENGLISH_DOMINANCE = 3;

export type CardLanguage = 'tagalog' | 'cebuano' | 'english';

/**
 * Language leaks in a card, in whichever direction. Empty = clean.
 * `lang` is the language the card was ASKED for, so this is purity, not detection.
 */
export function languageLeaks(text: string, lang: CardLanguage): string[] {
  const words = text.toLowerCase().match(/[a-zñ'-]+/g) ?? [];
  const hit = (set: Set<string>) => [...new Set(words.filter((w) => set.has(w)))];
  const tl = hit(TAGALOG_ONLY);
  const ceb = hit(CEBUANO_ONLY);
  const en = hit(ENGLISH_ONLY);
  const out: string[] = [];
  if (lang === 'tagalog') {
    if (ceb.length) out.push(`Cebuano in a Tagalog card: ${ceb.slice(0, 5).join(', ')}`);
    if (!tl.length && en.length >= ENGLISH_DOMINANCE)
      out.push(`English in a Tagalog card: ${en.slice(0, 5).join(', ')} (no Tagalog marker present)`);
  } else if (lang === 'cebuano') {
    if (tl.length) out.push(`Tagalog in a Cebuano card: ${tl.slice(0, 5).join(', ')}`);
    if (!hit(CEBUANO_EVIDENCE).length && en.length >= ENGLISH_DOMINANCE)
      out.push(`English in a Cebuano card: ${en.slice(0, 5).join(', ')} (no Cebuano marker present)`);
  } else {
    const fil = [...tl, ...ceb];
    if (fil.length) out.push(`Filipino in an English card: ${fil.slice(0, 5).join(', ')}`);
  }
  return out;
}

/* ------------------------------------------------------------------------------------------
 * RAW-GENERATION DEFECTS — asserted on the model's `content` BEFORE `sanitizeCardAnswer`.
 *
 * The product sanitizer now removes three habits of the shipping model that used to print as
 * literal text on the card: a leaked reasoning tag (`</think>`), an `[image: …]` control
 * token, and inline markdown (bold/backticks, unwrapped in place). Defending the child is
 * right, but a sanitizer that silently absorbs a regression is a gate that goes green on a
 * model that got worse. So these are asserted on the RAW string — the sanitizer's job is the
 * card, this function's job is the MODEL. (Before the sanitizer unwrapped markdown, inline
 * `**` was 3 of the baseline's 7 scaffolding failures; without the check here that entire
 * defect class — and its wasted tokens on a ~7 t/s phone — would ship invisibly.)
 * ---------------------------------------------------------------------------------------- */
export function rawGenerationDefects(raw: string): string[] {
  const v: string[] = [];
  const t = raw ?? '';
  if (/<\/?think>/i.test(t))
    v.push(
      'generation: reasoning tag leaked into `content` — the reasoning channel is bleeding ' +
        'through even with thinking disabled (sanitizeCardAnswer strips it; the model should not emit it)'
    );
  if (/\[image:/i.test(t))
    v.push(
      'generation: [image:] control token emitted — illustration is retrieval’s job on the ' +
        'card path, nothing resolves the tag (sanitizeCardAnswer strips it)'
    );
  // One backtick covers a fence run too; `**` covers bold pairs and orphans alike.
  if (/\*\*|`/.test(t))
    v.push(
      'generation: inline markdown (bold/backticks) emitted — ResponseCard renders a plain ' +
        '<Text>, markup is never legitimate card text (sanitizeCardAnswer unwraps it)'
    );
  return v;
}

/* ------------------------------------------------------------------------------------------
 * GROUNDEDNESS — does the card share ANY vocabulary with what was retrieved?
 *
 * The prompt's only permitted escape when the facts do not answer the query is "print the
 * nearest FACT whole — do not force the connection". A model that instead answers from
 * parametric memory produces a card that is lexically unrelated to every retrieved fact, and
 * nothing else in this file can see that: `mustNotContain` lists only catch the wordings
 * someone thought to forbid, so a paraphrase walks straight through (measured: "nba finals"
 * retrieved four shark/vine/court facts and the card read "Ang finals ay ang pinakahuling
 * laban ng isang serye ng paligsahan" — an invented definition, and the case PASSED).
 *
 * Deliberately a weak bar — TWO content words in common, matched loosely — because the card is
 * pitched at a Grade-5 reader and is allowed to simplify the grounding's vocabulary. It is a
 * confabulation detector, not a faithfulness score. Two rather than one because matching is
 * substring-either-way (to survive Tagalog/Cebuano affixation: "malaki" ↔ "pinakamalaking"),
 * and that looseness buys accidental hits: the invented "nba finals" card scored one on
 * "pinakahuling" ⊃ "huling" from an unrelated shark fact. Two coincidences at once is not a
 * pattern this has produced on any real card.
 * ---------------------------------------------------------------------------------------- */

/** Long-but-empty words: frequent enough in all three languages to be accidental overlap. */
const OVERLAP_STOP = new Set([
  // Tagalog
  'isang', 'ngunit', 'subalit', 'dahil', 'kapag', 'ngayon', 'talaga', 'naman', 'mayroon',
  'meron', 'iyong', 'kanyang', 'kanila', 'nila', 'iyon', 'tungkol', 'maaari', 'upang',
  'habang', 'bawat', 'lahat', 'ganito', 'ganyan', 'maging', 'kaniyang', 'nito',
  // Cebuano
  'adunay', 'aduna', 'tungod', 'kasagaran', 'mahimong', 'ilang', 'iyang', 'inyong', 'ngadto',
  'pananglitan', 'matag', 'tanan', 'kaayo', 'niini', 'kini', 'kana', 'kadto', 'usab', 'apan',
  // English
  'their', 'there', 'these', 'those', 'which', 'because', 'while', 'about', 'other', 'every',
  'would', 'could', 'should', 'another', 'using', 'from', 'that', 'this', 'with', 'they',
  'have', 'been', 'when', 'than', 'then', 'also', 'your', 'more', 'most', 'some', 'many',
  'such', 'only', 'into', 'them', 'like', 'called', 'makes', 'make', 'made', 'helps', 'help',
]);

/** Content words worth matching on: long enough to carry meaning, not on the stoplist. */
function contentWords(text: string): string[] {
  const out = new Set<string>();
  for (const w of text.toLowerCase().match(/[\p{L}]{5,}/gu) ?? []) if (!OVERLAP_STOP.has(w)) out.add(w);
  return [...out];
}

/** How many content words a card must share with the grounding (see the note above). */
const OVERLAP_MIN = 2;

/**
 * Null when the card shares enough content vocabulary with the retrieved facts; otherwise the
 * violation string. Matching is substring-either-way so Tagalog/Cebuano affixation counts
 * ("malaki" ↔ "pinakamalaking"). Returns null when there is nothing to compare against.
 */
export function groundednessMiss(card: string, facts: readonly string[]): string | null {
  if (!facts.length) return null;
  const cw = contentWords(card);
  if (!cw.length) return null; // a card of only short words — the word-count rules own that
  const fw = contentWords(facts.join(' '));
  if (!fw.length) return null;
  const shared = cw.filter((c) => fw.some((f) => f.includes(c) || c.includes(f)));
  // A card with only one content word cannot be asked for two overlaps.
  if (shared.length >= Math.min(OVERLAP_MIN, cw.length)) return null;
  return (
    `groundedness: the card shares ${shared.length} content word(s) with the retrieved facts ` +
    `(need ${Math.min(OVERLAP_MIN, cw.length)}; card: ${cw.slice(0, 8).join(', ')}` +
    `${shared.length ? `; shared: ${shared.join(', ')}` : ''}) — it was written from parametric ` +
    'memory, not from the grounding, and the prompt’s only escape is to print the nearest FACT whole'
  );
}

export interface CardShapeOptions {
  /** Language the card was asked for — enables the purity check. */
  lang: CardLanguage;
  /** Word ceiling for this card (default: the prompt's own 30). */
  maxWords?: number;
}

/**
 * Every universal card invariant, in one call. Returns violation strings (empty = a card).
 * Run it on the SANITIZED text — the string the app would actually print — so the gate and the
 * child are looking at the same thing.
 */
export function cardShapeViolations(card: string, opts: CardShapeOptions): string[] {
  const v: string[] = [];
  const text = card ?? '';
  const words = wordCount(text);
  const maxWords = opts.maxWords ?? CARD_WORD_CEILING;

  if (!text.trim()) return ['empty card'];
  if (words > maxWords) v.push(`length: ${words} words (ceiling ${maxWords})`);
  if (words < 4) v.push(`length: ${words} words — a stub, not a card`);
  if (text.length > CARD_CHAR_CEILING)
    v.push(`length: ${text.length} chars (> ${CARD_CHAR_CEILING}; the app would truncate it)`);
  if (text.trimEnd().endsWith('…') || text.trimEnd().endsWith('...'))
    v.push('truncated: card ends mid-thought ("…")');

  // One line per violated RULE, not per matching pattern — three regexes for the same bolded
  // label is one defect, and a wall of near-identical lines buries the other failures.
  const first = (res: RegExp[]) => res.find((re) => re.test(text));
  const report = (label: string, res: RegExp[]) => {
    const re = first(res);
    if (re) v.push(`${label}: matched ${re}`);
  };
  if (GREETING_RE.test(text)) v.push('greeting: a card does not say hello');
  report('preamble', PREAMBLE_RES);
  if (QUESTION_RE.test(text)) v.push('question: a printed card asks the child nothing');
  report('invitation', INVITATION_RES);
  report('deflection', REFUSAL_MARKERS);
  report('scaffolding', SCAFFOLD_RES);

  const dupe = repeatedSentence(text);
  if (dupe) v.push(`degeneration: sentence repeated — "${dupe}"`);

  const p = presentation(text);
  if (p.imageTags > 0)
    v.push(`image-tag: ${p.imageTags} [image:] tag(s) — illustration is retrieval's job, not the model's`);
  if (p.emoji > 0) v.push(`emoji: ${p.emoji} emoji — the card deck has a fixed palette and Android colours them`);

  v.push(...languageLeaks(text, opts.lang));
  return v;
}
