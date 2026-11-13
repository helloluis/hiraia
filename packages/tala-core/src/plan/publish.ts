/** Shared pre-post privacy transform. Ported from community/publish; no platform APIs. */
import type { RichText, SectionContent, Span } from '../contracts/content';
import type { Lang } from '../contracts/common';
export interface PublishPrivacyOptions {
  schoolName?: string;
  schoolNames?: readonly string[];
  classNames?: readonly string[];
  sectionNames?: readonly string[];
  teacherName?: string;
  dates?: readonly string[];
  includeSchoolName?: boolean;
}
const PLACEHOLDER = {
  fil: { school: '[paaralan]', section: '[seksiyon]', date: '[petsa]' },
  en: { school: '[school]', section: '[section]', date: '[date]' },
} as const;
/** Use text() for the post title/summary and content() for each structured section. */
export function createPublishCleaner(lang: Lang, options: PublishPrivacyOptions = {}) {
  const replacements: Array<{ pattern: RegExp; with: string }> = [];
  if (!options.includeSchoolName)
    for (const name of [options.schoolName ?? '', ...(options.schoolNames ?? [])]) {
      if (name.trim().length >= 4)
        replacements.push({ pattern: literal(name.trim()), with: PLACEHOLDER[lang].school });
    }
  for (const name of [...(options.classNames ?? []), ...(options.sectionNames ?? [])]) {
    if (isDistinctiveClassName(name))
      replacements.push({ pattern: literal(name.trim()), with: PLACEHOLDER[lang].section });
  }
  for (const date of new Set(options.dates ?? []))
    for (const pattern of datePatterns(date))
      replacements.push({ pattern, with: PLACEHOLDER[lang].date });
  replacements.sort((a, b) => b.pattern.source.length - a.pattern.source.length);
  const text = (s: string) =>
    replacements.reduce(
      (value, replacement) => value.replace(replacement.pattern, replacement.with),
      s
    );
  return {
    text,
    content: (c: SectionContent) => cleanContent(c, text, options.teacherName),
    items: (items: string[]) => stripSignatureItems(items, options.teacherName).map(text),
  };
}
function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function literal(s: string): RegExp {
  return new RegExp(
    `(?<![\\p{L}\\p{N}])${escapeRegExp(s).replace(/\s+/g, '\\s+')}(?![\\p{L}\\p{N}])`,
    'giu'
  );
}

/** "Grade 4" or "Kinder" says nothing about a school; "Grade 4 - Sampaguita" does. */
function isDistinctiveClassName(name: string): boolean {
  const n = name.trim();
  return (
    n.length >= 4 &&
    !/^(?:grade|baitang|gr\.?|g|kinder(?:garten)?|k)\s*-?\s*(?:\d{1,2}|k)?$/i.test(n)
  );
}

const MONTHS_EN = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const MONTHS_FIL = [
  'Enero',
  'Pebrero',
  'Marso',
  'Abril',
  'Mayo',
  'Hunyo',
  'Hulyo',
  'Agosto',
  'Setyembre',
  'Oktubre',
  'Nobyembre',
  'Disyembre',
];

/** The plan's own session dates, in the forms teachers write them. Other dates (1898, a due date) stay. */
function datePatterns(iso: string): RegExp[] {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12 || Number(m[3]) < 1 || Number(m[3]) > 31)
    return [];
  const [, y, mo, d] = m;
  const mi = Number(mo) - 1;
  const day = String(Number(d));
  const months = [MONTHS_EN[mi]!, MONTHS_EN[mi]!.slice(0, 3), MONTHS_FIL[mi]!]
    .map(escapeRegExp)
    .join('|');
  const b = (s: string) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${s})(?![\\p{L}\\p{N}])`, 'giu');
  return [
    b(escapeRegExp(iso)),
    b(`(?:${months})\\.?\\s+0?${day},?\\s+${y}`),
    b(`0?${day}\\s+(?:${months})\\.?,?\\s+${y}`),
    b(`0?${Number(mo)}[/-]0?${day}[/-]${y}`),
  ];
}

const SIGNATURE_LABEL =
  /^\s*(?:(?:prepared|submitted|checked|noted|reviewed|approved|verified|recommending\s+approval|attested)\s+by|(?:inihanda|isinumite|sinuri|binigyang[\s-]pansin|pinagtibay|iniwasto|binigyang[\s-]pansin)\s+(?:ni|nina))\b/i;
const SIGNATURE_TAIL_ROLE =
  /\b(?:teacher|principal|head\s*teacher|master\s*teacher|coordinator|school\s*head|adviser|guro|punong[\s-]guro|tagapayo|ulong[\s-]guro|department\s+head|signature|lagda)\b/i;

function isSignatureTail(text: string, teacherName?: string): boolean {
  const t = text.trim();
  if (!t || t.length > 80) return false;
  return (
    (!!teacherName?.trim() && t.toLowerCase() === teacherName.trim().toLowerCase()) ||
    /^[\p{Lu}\s.,'’-]+$/u.test(t) ||
    SIGNATURE_TAIL_ROLE.test(t) ||
    /^_{3,}$/.test(t)
  );
}

const spanText = (spans: Array<{ text: string }>) => spans.map((s) => s.text).join('');

function stripSignatures(blocks: RichText, teacherName?: string): RichText {
  const out: RichText = [];
  let tail = 0;
  for (const b of blocks) {
    const text = b.t === 'p' ? spanText(b.spans) : '';
    if (b.t === 'p' && SIGNATURE_LABEL.test(text)) {
      tail = 3;
      continue;
    }
    if (tail > 0 && b.t === 'p' && isSignatureTail(text, teacherName)) {
      tail--;
      continue;
    }
    tail = 0;
    out.push(b);
  }
  return out;
}

function stripSignatureItems(items: string[], teacherName?: string): string[] {
  const out: string[] = [];
  let tail = 0;
  for (const item of items) {
    if (SIGNATURE_LABEL.test(item)) {
      tail = 2;
      continue;
    }
    if (tail > 0 && isSignatureTail(item, teacherName)) {
      tail--;
      continue;
    }
    tail = 0;
    out.push(item);
  }
  return out;
}

function cleanSpans(spans: Span[], clean: (s: string) => string): Span[] {
  const combined = clean(spanText(spans));
  const separately = spans.map((s) => ({ ...s, text: clean(s.text) }));
  // A private name may cross formatting boundaries; do not leak it by cleaning each span alone.
  if (spanText(separately) === combined) return separately;
  const result: Span[] = [];
  for (let offset = 0; offset < combined.length; offset += 4000)
    result.push({ ...(spans[0] ?? {}), text: combined.slice(offset, offset + 4000) });
  return result;
}
function cleanRich(blocks: RichText, clean: (s: string) => string, teacherName?: string): RichText {
  return stripSignatures(blocks, teacherName).map((b) =>
    b.t === 'p'
      ? { ...b, spans: cleanSpans(b.spans, clean) }
      : {
          ...b,
          items: stripSignatures(
            b.items.map((spans) => ({ t: 'p' as const, spans })),
            teacherName
          ).flatMap((item) => (item.t === 'p' ? [cleanSpans(item.spans, clean)] : [])),
        }
  );
}

export function cleanContent(
  c: SectionContent,
  clean: (s: string) => string,
  teacherName?: string
): SectionContent {
  switch (c.type) {
    case 'text':
      return { ...c, blocks: cleanRich(c.blocks, clean, teacherName) };
    case 'list':
      return { ...c, items: stripSignatureItems(c.items, teacherName).map(clean) };
    case 'procedure':
      return {
        ...c,
        steps: c.steps.map((s) => ({
          ...s,
          title: clean(s.title),
          body: cleanRich(s.body, clean, teacherName),
        })),
      };
    case 'weekgrid':
      return {
        ...c,
        days: c.days.map((d) => ({
          ...d,
          date: null,
          body: cleanRich(d.body, clean, teacherName),
        })),
      };
    case 'pergroup':
      return {
        ...c,
        groups: Object.fromEntries(
          Object.entries(c.groups).map(([k, v]) => [k, cleanRich(v, clean, teacherName)])
        ),
      };
    case 'multigrade':
      return {
        ...c,
        blocks: c.blocks.map((b) => ({
          ...b,
          label: clean(b.label),
          groups: Object.fromEntries(
            Object.entries(b.groups).map(([k, g]) => [
              k,
              { ...g, activity: cleanRich(g.activity, clean, teacherName) },
            ])
          ),
        })),
      };
  }
}
