/**
 * Rule-based detectors for student personal data and contact details (PRD §11.6, PRIV-9).
 *
 * Pure: the same code runs on the phone before posting (so the teacher can fix things offline) and on the
 * server at posting time, before the model check.
 *
 * Each finding carries a confidence:
 *   high — shape alone is enough (a phone number, an LRN, a class list, a learner from the teacher's own
 *          roster). The server returns the post to its author without asking the model: student personal
 *          data is the one strict category.
 *   low  — could be personal data or could be ordinary lesson text (three names in a history lesson, a
 *          barangay name). Passed to the model as a hint; never returns a post on its own.
 */
import type { ModerationTextInput, TextUnit } from './text';
import { normalizeForMatch, textUnits } from './text';
import { COMMON_FAMILY_NAMES, COMMON_GIVEN_NAMES, NAME_PARTICLES } from './names';

export type PersonalDataKind = 'name_list' | 'roster_name' | 'lrn' | 'phone' | 'email' | 'address';

export interface PersonalDataFinding {
  category: 'student_personal_data';
  kind: PersonalDataKind;
  confidence: 'high' | 'low';
  /** Section key, or 'title' / 'summary'. */
  sectionKey: string;
  /** Short passage (≤ 120 characters) so the author can find it. Shown only to the author. */
  excerpt: string;
  /** Plain-language explanation for the author. */
  message: string;
}

export interface DetectOptions {
  /**
   * Names from the teacher's own class lists (display name, "Given Family", "Family, Given" …). A match is
   * a high-confidence finding. Names with fewer than two words are ignored, so a common first name alone
   * never matches ordinary words.
   */
  knownNames?: readonly string[];
}

export const PERSONAL_DATA_MESSAGES: Record<PersonalDataKind, string> = {
  name_list:
    "This part looks like a list of learners' names. Please remove the names before posting.",
  roster_name:
    'This part has the name of a learner from your class list. Please remove it before posting.',
  lrn: 'This looks like a learner reference number (LRN). Please remove it before posting.',
  phone: 'This looks like a phone number. Please remove it before posting.',
  email: 'This looks like an email address. Please remove it before posting.',
  address: 'This looks like a home address. Please remove it before posting.',
};

/** Thresholds for the class-list detector. A real class list is usually 20–45 names. */
export const NAME_LIST_THRESHOLDS = { withRosterSignal: 5, withoutSignal: 15, hint: 3 } as const;

const MAX_FINDINGS = 20;
const EXCERPT_CHARS = 120;

/* ------------------------------------------------------------------ */

export function detectPersonalData(
  input: ModerationTextInput,
  options: DetectOptions = {}
): PersonalDataFinding[] {
  const units = textUnits(input);
  const findings: PersonalDataFinding[] = [];
  const add = (
    kind: PersonalDataKind,
    confidence: 'high' | 'low',
    unit: TextUnit,
    at = 0,
    length = 0
  ) => {
    const excerpt = excerptAround(unit.text, at, length);
    if (
      findings.some(
        (f) => f.kind === kind && f.sectionKey === unit.sectionKey && f.excerpt === excerpt
      )
    )
      return;
    findings.push({
      category: 'student_personal_data',
      kind,
      confidence,
      sectionKey: unit.sectionKey,
      excerpt,
      message: PERSONAL_DATA_MESSAGES[kind],
    });
  };

  detectContacts(units, add);
  detectLrns(units, add);
  detectNameLists(units, findings);
  if (options.knownNames?.length) detectKnownNames(units, options.knownNames, add);

  // Strongest first, so a capped list keeps what matters.
  findings.sort((a, b) => (a.confidence === b.confidence ? 0 : a.confidence === 'high' ? -1 : 1));
  return findings.slice(0, MAX_FINDINGS);
}

export function hasBlockingFinding(findings: readonly PersonalDataFinding[]): boolean {
  return findings.some((f) => f.confidence === 'high');
}

/* ---------------- contacts: phone, email, address ---------------- */

type Add = (
  kind: PersonalDataKind,
  confidence: 'high' | 'low',
  unit: TextUnit,
  at?: number,
  length?: number
) => void;

const PH_MOBILE = /(?<![\d+])(?:\+?63[\s.-]?|0)9\d{2}[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/g;
const LABELLED_PHONE =
  /\b(?:tel(?:ephone)?|phone|mobile|cell(?:phone)?|cp|contact(?:\s+(?:no|number))?|landline|telepono|numero)\b\.?\s*(?:no\.?|number|#)?\s*[:\-]?\s*(\+?\(?\d[\d\s().-]{5,18}\d)/gi;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const EXAMPLE_EMAIL_DOMAIN = /@(?:[a-z0-9-]+\.)*(?:example|sample|test|halimbawa)\.[a-z]{2,}$/i;
const STREET =
  /(?<![\p{L}\d])\d{1,5}[A-Za-z]?\s+(?:[\p{Lu}][\p{L}.'-]*\s+){1,4}(?:St\.?|Street|Ave\.?|Avenue|Rd\.?|Road|Blvd\.?|Boulevard|Drive|Dr\.?|Lane|Ln\.?|Kalye|Extension|Ext\.?)(?![\p{L}])/gu;
const BLOCK_LOT = /\b(?:Blk|Block)\.?\s*\d+[A-Za-z]?\s*,?\s*(?:Lot|Lt)\.?\s*\d+/gi;
const LABELLED_ADDRESS =
  /\b(?:home\s+address|address|tirahan|nakatira\s+sa)\s*[:\-]\s*([^_\n]{8,})/gi;
const LOCALITY = /\b(?:Purok|Sitio|Zone)\s+\d+\b|\b(?:Brgy|Bgy|Barangay)\.?\s+[\p{Lu}]/gu;

function detectContacts(units: TextUnit[], add: Add) {
  for (const u of units) {
    for (const m of u.text.matchAll(PH_MOBILE)) add('phone', 'high', u, m.index ?? 0, m[0].length);
    for (const m of u.text.matchAll(LABELLED_PHONE)) {
      if ((m[1]!.match(/\d/g)?.length ?? 0) >= 7)
        add('phone', 'high', u, m.index ?? 0, m[0].length);
    }
    for (const m of u.text.matchAll(EMAIL))
      add('email', EXAMPLE_EMAIL_DOMAIN.test(m[0]) ? 'low' : 'high', u, m.index ?? 0, m[0].length);
    for (const m of u.text.matchAll(STREET)) add('address', 'high', u, m.index ?? 0, m[0].length);
    for (const m of u.text.matchAll(BLOCK_LOT))
      add('address', 'high', u, m.index ?? 0, m[0].length);
    for (const m of u.text.matchAll(LABELLED_ADDRESS)) {
      if (/[\p{L}\d]/u.test(m[1]!)) add('address', 'high', u, m.index ?? 0, m[0].length);
    }
    for (const m of u.text.matchAll(LOCALITY)) add('address', 'low', u, m.index ?? 0, m[0].length);
  }
}

/* ---------------- LRN-like numbers ---------------- */

const LABELLED_LRN = /\bLRN\b\s*(?:no\.?|number|#)?\s*[:#.\-]?\s*(\d[\d\s-]{5,16}\d)/gi;
/** Twelve digits, optionally grouped 6-6 or 3-3-3-3, not part of a larger number like 1,000,000,000,000. */
const BARE_LRN =
  /(?<![\d,.])(?:\d{12}|\d{6}[ -]\d{6}|\d{3}[ -]\d{3}[ -]\d{3}[ -]\d{3})(?![\d]|[,.]\d)/g;

function detectLrns(units: TextUnit[], add: Add) {
  const bare: Array<{ unit: TextUnit; at: number; length: number; digits: string }> = [];
  for (const u of units) {
    for (const m of u.text.matchAll(LABELLED_LRN)) add('lrn', 'high', u, m.index ?? 0, m[0].length);
    for (const m of u.text.matchAll(BARE_LRN))
      bare.push({
        unit: u,
        at: m.index ?? 0,
        length: m[0].length,
        digits: m[0].replace(/\D/g, ''),
      });
  }
  // One twelve-digit number may be a place-value exercise; several distinct ones are a list of learners.
  const distinct = new Set(bare.map((b) => b.digits)).size;
  for (const b of bare) add('lrn', distinct >= 3 ? 'high' : 'low', b.unit, b.at, b.length);
}

/* ---------------- class lists ---------------- */

/** Words that say "this is a list of learners / a grouping of learners", not merely "learners". */
const ROSTER_CONTEXT =
  /\b(?:class\s*list|class\s*record|roster|master\s*list|masterlist|seat\s*plan|attendance|names\s+of\s+(?:the\s+)?(?:learners|pupils|students)|list\s+of\s+(?:the\s+)?(?:learners|pupils|students)|(?:listahan|talaan|pangalan)\s+ng\s+mga\s+(?:mag-?aaral|bata|estudyante)|(?:group|grupo|pangkat|team)\s+(?:\d+|[A-E]|one|two|three|four|five|isa|dalawa|tatlo|apat|lima)\b|(?:una|ikalawa|ikatlo|ikaapat|ikalima)(?:ng)?\s+pangkat|members?\s*:|miyembro|leader\s*:|lider\s*:)/i;

const NUMBERING = /^\s*(?:\d{1,3}[.)]\s*|[-•*·]\s+)/;
const SEX_SUFFIX = /[\s,(–-]+(?:M|F|Male|Female|Lalaki|Babae)\)?\.?$/i;
const LRN_SUFFIX = /[\s,(–-]+\d{12}\)?$/;
const INITIAL = /^[\p{Lu}]\.$/u;
const CAP_WORD = /^[\p{Lu}][\p{L}'’-]*\.?$/u;
const SUFFIX = /^(?:jr\.?|sr\.?|ii|iii|iv)$/i;

interface NameEvidence {
  nameLike: boolean;
  rosterSignal: boolean;
}

const fold = (w: string) => normalizeForMatch(w).replace(/[.'’-]/g, '');

function tokensAreName(s: string, allowSingleGiven: boolean): { ok: boolean; initial: boolean } {
  const tokens = s.split(/\s+/).filter(Boolean);
  if (!tokens.length || tokens.length > 6) return { ok: false, initial: false };
  let words = 0;
  let initial = false;
  let known = false;
  for (const [i, t] of tokens.entries()) {
    if (NAME_PARTICLES.has(t.toLowerCase())) continue;
    if (SUFFIX.test(t)) continue;
    if (INITIAL.test(t)) {
      if (i > 0) initial = true;
      continue;
    }
    if (!CAP_WORD.test(t)) return { ok: false, initial: false };
    words++;
    const f = fold(t);
    if (COMMON_GIVEN_NAMES.has(f) || COMMON_FAMILY_NAMES.has(f)) known = true;
  }
  if (words === 1 && allowSingleGiven && tokens.length === 1)
    return { ok: COMMON_GIVEN_NAMES.has(fold(tokens[0]!)), initial: false };
  if (words < 2 || words > 4) return { ok: false, initial: false };
  return { ok: initial || known, initial };
}

/** "Dela Cruz, Juan P." — family words, then given words with an optional middle initial. */
function commaNameOrder(familyPart: string, givenPart: string): boolean {
  const family = familyPart.split(/\s+/);
  const given = givenPart.split(/\s+/);
  if (family.length > 4 || given.length > 5) return false;
  const familyWords = family.filter((t) => !NAME_PARTICLES.has(t.toLowerCase()));
  if (
    !familyWords.length ||
    familyWords.length > 2 ||
    !familyWords.every((t) => CAP_WORD.test(t) && !t.endsWith('.'))
  )
    return false;
  // "Jose Rizal, Andres Bonifacio" is two names in a sentence, not "Family, Given".
  const first = fold(familyWords[0]!);
  if (COMMON_GIVEN_NAMES.has(first) && !COMMON_FAMILY_NAMES.has(first)) return false;
  const givenWords = given.filter((t) => !INITIAL.test(t) && !SUFFIX.test(t));
  if (!givenWords.length || givenWords.length > 3 || !givenWords.every((t) => CAP_WORD.test(t)))
    return false;
  const hasInitial = given.some((t) => INITIAL.test(t));
  const known =
    familyWords.some((t) => COMMON_FAMILY_NAMES.has(fold(t))) ||
    givenWords.some((t) => COMMON_GIVEN_NAMES.has(fold(t)));
  return hasInitial || known;
}

function analyseNameChunk(raw: string, allowSingleGiven: boolean): NameEvidence {
  let s = raw.replace(NUMBERING, '').trim();
  let rosterSignal = false;
  if (SEX_SUFFIX.test(s)) {
    s = s.replace(SEX_SUFFIX, '').trim();
    rosterSignal = true;
  }
  if (LRN_SUFFIX.test(s)) {
    s = s.replace(LRN_SUFFIX, '').trim();
    rosterSignal = true;
  }
  if (!s || s.length > 60 || /\d|[!?;:"“”()]/.test(s))
    return { nameLike: false, rosterSignal: false };
  // "Family, Given M." — the order class lists use.
  const comma = s.match(/^([^,]+),\s*([^,]+)$/);
  if (comma && commaNameOrder(comma[1]!.trim(), comma[2]!.trim()))
    return { nameLike: true, rosterSignal: true };
  const r = tokensAreName(s, allowSingleGiven);
  return { nameLike: r.ok, rosterSignal };
}

/** Name-like chunks in one line: the whole line, or its comma/semicolon/"and"-separated parts. */
function namesInLine(text: string): { count: number; rosterSignal: boolean } {
  // "Group 1: Ana Reyes, Ben Cruz" — the label is context, the rest is the list.
  const colon = text.indexOf(':');
  const body = colon >= 0 && colon < 40 ? text.slice(colon + 1) : text;
  if (!body.trim()) return { count: 0, rosterSignal: false };
  const whole = analyseNameChunk(body, false);
  if (whole.nameLike) return { count: 1, rosterSignal: whole.rosterSignal };
  const chunks = body.split(/\s*[,;]\s*|\s+(?:at|and|&)\s+/i).filter((c) => c.trim());
  if (chunks.length < 2) return { count: 0, rosterSignal: false };
  let count = 0;
  let rosterSignal = false;
  for (const c of chunks) {
    const e = analyseNameChunk(c, true);
    if (e.nameLike) count++;
    if (e.rosterSignal) rosterSignal = true;
  }
  return { count, rosterSignal };
}

function detectNameLists(units: TextUnit[], findings: PersonalDataFinding[]) {
  const bySection = new Map<string, TextUnit[]>();
  for (const u of units) bySection.set(u.sectionKey, [...(bySection.get(u.sectionKey) ?? []), u]);
  for (const [sectionKey, list] of bySection) {
    let count = 0;
    let signal = false;
    const examples: string[] = [];
    for (const u of list) {
      if (ROSTER_CONTEXT.test(u.text)) signal = true;
      const r = namesInLine(u.text);
      if (r.count > 0) {
        count += r.count;
        if (r.rosterSignal) signal = true;
        if (examples.length < 3) examples.push(u.text);
      }
    }
    const t = NAME_LIST_THRESHOLDS;
    const confidence =
      (count >= t.withRosterSignal && signal) || count >= t.withoutSignal
        ? 'high'
        : count >= t.hint
          ? 'low'
          : null;
    if (!confidence) continue;
    findings.push({
      category: 'student_personal_data',
      kind: 'name_list',
      confidence,
      sectionKey,
      excerpt: truncate(examples.join('; '), EXCERPT_CHARS),
      message: PERSONAL_DATA_MESSAGES.name_list,
    });
  }
}

/* ---------------- names from the teacher's own roster ---------------- */

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function detectKnownNames(units: TextUnit[], knownNames: readonly string[], add: Add) {
  const variants = [...new Set(knownNames.map(normalizeForMatch))].filter(
    (n) => n.length >= 5 && n.replace(/,/g, ' ').split(/\s+/).filter(Boolean).length >= 2
  );
  if (!variants.length) return;
  // One alternation, longest first, word-bounded on the normalised text.
  variants.sort((a, b) => b.length - a.length);
  const re = new RegExp(
    `(?:^|[^\\p{L}\\p{N}])(${variants.map(escapeRegExp).join('|')})(?![\\p{L}\\p{N}])`,
    'u'
  );
  for (const u of units) {
    const norm = normalizeForMatch(u.text);
    const m = norm.match(re);
    if (!m) continue;
    // Normalisation only removes accents and collapses spaces, so the position is close enough for an excerpt.
    add('roster_name', 'high', u, Math.max(0, (m.index ?? 0) - 1), m[1]!.length + 2);
  }
}

/* ---------------- helpers ---------------- */

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + '…';
}

function excerptAround(text: string, at: number, length: number): string {
  if (text.length <= EXCERPT_CHARS) return text;
  const pad = Math.max(0, Math.floor((EXCERPT_CHARS - length) / 2));
  const start = Math.max(0, Math.min(at - pad, text.length - EXCERPT_CHARS));
  const slice = text.slice(start, start + EXCERPT_CHARS - 2).trim();
  return `${start > 0 ? '…' : ''}${slice}${start + EXCERPT_CHARS - 2 < text.length ? '…' : ''}`;
}

/**
 * Variants of a learner's name worth matching in a post: the display name, "Given Family" and "Family, Given".
 * The server builds these from the teacher's own `student` records; they never leave the server or device.
 */
export function knownNameVariants(student: {
  displayName: string;
  givenName?: string;
  familyName?: string;
}): string[] {
  const out = [student.displayName];
  const g = student.givenName?.trim();
  const f = student.familyName?.trim();
  if (g && f) out.push(`${g} ${f}`, `${f}, ${g}`, `${f} ${g}`);
  return out.filter(
    (n) =>
      n &&
      n
        .trim()
        .split(/[\s,]+/)
        .filter(Boolean).length >= 2
  );
}
