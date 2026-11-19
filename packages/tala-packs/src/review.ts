/**
 * Model critique and revision. A second model family (Qwen) reads the whole pack and lists problems; the writer
 * (DeepSeek) answers with targeted patches. Each patch is applied on its own and kept only if the pack still passes
 * the contract and has no more check failures than before. This stage is a MODEL critique: it is recorded as such
 * and never counts as human review.
 */
import { z } from 'zod';
import { WeeklyPackContent } from '@hiraia/tala-core/contracts';
import { MODELS, type Meter } from './llm';
import { artCandidatesFor, artText, fill, groundingFor, loadPrompt } from './context';
import { stage } from './generate';
import { checkPack } from './checks';
import { checkVerbiage } from './verbiage';
import { lineMax, splitSlideLine, stripEnumerator } from './text';
export { splitSlideLine } from './text';
import type { WeekTarget } from './targets';

/** Ids like "c2 (still open)" (copied from the format example) become "c2". */
const issueId = z.preprocess((v) => (typeof v === 'string' ? (v.match(/^\s*([A-Za-z]{1,3}\d{1,3})\b/)?.[1] ?? v.trim().slice(0, 12)) : v), z.string().max(12));
export const Issue = z.object({
  id: issueId,
  severity: z.enum(['blocker', 'major', 'minor']),
  category: z.string().max(40),
  path: z.string().max(200),
  problem: z.string().max(1200),
  fix: z.string().max(2000),
});
export type Issue = z.infer<typeof Issue>;
/** Over-long lists are trimmed, not rejected: a 41st issue is not worth failing a week over. */
const capped = <T extends z.ZodTypeAny>(item: T, n: number) => z.preprocess((v) => (Array.isArray(v) ? v.slice(0, n) : v), z.array(item));
/** Verification rounds also report what became of each earlier issue (fixed / still open / withdrawn). */
export const IssueStatus = z.object({ id: issueId, status: z.enum(['fixed', 'open', 'withdrawn']), note: z.string().max(600).default('') });
export const Critique = z.object({
  verdict: z.enum(['pass', 'revise']),
  issues: capped(Issue, 40),
  previous: z.array(IssueStatus).default([]),
});
export type Critique = z.infer<typeof Critique>;

// `expect` may quote the whole current value; only its opening characters are compared. A missing quote is refused per patch.
// A quoted list, number or object (models quote what they see in the JSON) is compared as its JSON text.
const quote = z.preprocess((v) => (v === null || v === undefined || typeof v === 'string' ? v : JSON.stringify(v)), z.string().nullable().optional());
const Patch = z.object({ path: z.string().max(200), expect: quote, value: z.unknown(), issueIds: z.array(z.string()).default([]) });
export const Revision = z.object({
  patches: capped(Patch, 250),
  declined: z.array(z.object({ issueId: z.string(), reason: z.string().max(1000) })).default([]),
});

/** The pack as the critic and reviser see it: no provenance hashes or file records. */
/**
 * The pack as the critic and reviser see it: no provenance hashes or file records, and every object inside a list
 * labelled with its position as "_i". Models miscount indexes in long arrays (11 of 14 rejected patches in one G7
 * revision quoted the right text at the wrong index); with the label they copy the index instead of counting.
 */
export function packForReview(p: WeeklyPackContent) {
  const { provenance: _p, illustrations: _i, ...rest } = p;
  return annotate(rest);
}

export function annotate(v: unknown): unknown {
  if (Array.isArray(v)) return v.map((x, i) => (x && typeof x === 'object' && !Array.isArray(x) ? { _i: i, ...(annotate(x) as object) } : annotate(x)));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, annotate(x)]));
  return v;
}

/** Remove "_i" labels a model may copy into a patch value. */
export function stripIndex(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripIndex);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([k]) => k !== '_i').map(([k, x]) => [k, stripIndex(x)]));
  return v;
}

/**
 * Qwen without reasoning often drops the JSON wrapper: it returned a bare list of issues, a bare list of statuses, or
 * the object inside a one-item list (G5, G7, 19 Nov). The content is complete, so the shape is restored (logged).
 */
export function normalizeCritique(raw: unknown, log: string[]): unknown {
  if (!Array.isArray(raw)) return raw;
  const objects = raw.every((x) => x && typeof x === 'object' && !Array.isArray(x));
  if (!objects) return raw;
  if (raw.length === 1 && ('issues' in raw[0] || 'previous' in raw[0] || 'verdict' in raw[0])) {
    log.push('reply was the object wrapped in a one-item list; unwrapped');
    return raw[0];
  }
  if (raw.length === 0) {
    log.push('reply was an empty list; read as no issues');
    return { verdict: 'pass', issues: [] };
  }
  if (raw.every((x: any) => 'severity' in x)) {
    log.push('reply was a bare list of issues; wrapped as {issues}');
    return { verdict: raw.some((x: any) => x.severity !== 'minor') ? 'revise' : 'pass', issues: raw };
  }
  if (raw.every((x: any) => 'status' in x)) {
    log.push('reply was a bare status list; wrapped as {previous}; no new issues reported in this reply');
    return { previous: raw, issues: [], verdict: raw.some((x: any) => x.status === 'open') ? 'revise' : 'pass' };
  }
  return raw;
}

export async function critique(meter: Meter, pack: WeeklyPackContent, t: WeekTarget, round: number, extraIssues: string[] = [], opts: { thinking?: boolean } = {}): Promise<Critique> {
  const fil = pack.language === 'fil';
  const prompt = fill(loadPrompt(fil ? 'pack-critique-fil.v1' : 'pack-critique.v1').text, {
    GRADE: t.grade,
    COMPETENCIES: t.competencies.map((c) => `- [${c.id}] ${c.text}`).join('\n'),
    GROUNDING: groundingFor(t, 8).text,
    PACK: JSON.stringify(packForReview(pack)),
  });
  const res = await stage({
    meter,
    packId: t.targetId,
    name: `${pack.language}-critique${round}`,
    spec: MODELS.critic,
    thinking: opts.thinking ?? true,
    prompt: extraIssues.length ? `${prompt}\n\nAUTOMATIC CHECKS ALSO REPORTED (include them as issues):\n- ${extraIssues.join('\n- ')}` : prompt,
    schema: Critique,
    maxTokens: 24_000,
    normalize: normalizeCritique,
  });
  return res.value;
}

const EDITION = {
  en: {
    edition: 'English edition',
    scope: 'wrong science, a wrong answer key, a safety risk, a misconception the text would plant, or a contradiction the revision introduced',
    rules: 'Learner slides must stay short and simple for children; teacher text plain but complete.',
    categories: 'scientific_accuracy|answer_key|misconception_risk|alignment|safety|local_accuracy|age_appropriateness|clarity|consistency|slide_design',
  },
  fil: {
    edition: 'Filipino edition, written from a checked English edition',
    scope: 'wrong science or meaning lost in the Filipino, a wrong answer, a lost safety instruction, a learner slide in whole English sentences, Filipino too hard or unnatural for the grade, or a contradiction the revision introduced',
    rules:
      "Filipino rules (Hiraia student app): natural, simple, warm, short sentences for children; Taglish welcome (English science words Filipinos use as single words); no deep or puristic Tagalog; DepEd competency text stays verbatim in English — never report that. The lesson structure (slide order, flow slideIds, minutes, pictures, choice order) is fixed by the English edition: do not report it.",
    categories: 'scientific_accuracy|answer_key|language_quality|readability|safety|consistency',
  },
} as const;

/**
 * A verification round: the critic sees its previous issues and what the reviser did, marks each issue fixed / open /
 * withdrawn, and adds only new blocker or major problems. Fresh full critiques every round never converged (each
 * round found a different set of polish issues), so later rounds verify instead.
 */
export async function recheck(
  meter: Meter,
  pack: WeeklyPackContent,
  t: WeekTarget,
  round: number,
  previous: Issue[],
  report: RevisionReport,
  extraIssues: string[] = [],
  opts: { thinking?: boolean } = {}
): Promise<Critique> {
  const e = EDITION[pack.language];
  const prompt = fill(loadPrompt('pack-recheck.v1').text, {
    GRADE: t.grade,
    EDITION: e.edition,
    NEW_SCOPE: e.scope,
    EDITION_RULES: e.rules,
    CATEGORIES: e.categories,
    COMPETENCIES: t.competencies.map((c) => `- [${c.id}] ${c.text}`).join('\n'),
    PREVIOUS: JSON.stringify(previous),
    REPORT: JSON.stringify(report),
    PACK: JSON.stringify(packForReview(pack)),
  });
  const ids = new Set(previous.map((i) => i.id));
  const res = await stage({
    meter,
    packId: t.targetId,
    name: `${pack.language}-recheck${round}`,
    spec: MODELS.critic,
    thinking: opts.thinking ?? false,
    prompt: extraIssues.length ? `${prompt}\n\nAUTOMATIC CHECKS ALSO REPORTED (include each as an issue unless it is already listed):\n- ${extraIssues.join('\n- ')}` : prompt,
    schema: Critique,
    maxTokens: 24_000,
    softCheck: true,
    // A bare status list keeps every ruling; the runner carries each "open" issue forward with its note.
    normalize: normalizeCritique,
    check: (c) => {
      const missing = [...ids].filter((id) => !c.previous.some((p) => p.id === id));
      return missing.length ? [`"previous" has no status for: ${missing.join(', ')}. Give every previous issue a status.`] : [];
    },
  });
  return res.value;
}

type Seg = string | number;
export function parsePath(path: string): Seg[] {
  const out: Seg[] = [];
  for (const part of path.replace(/^\$\.?/, '').split('.')) {
    const m = part.match(/^([A-Za-z_][\w]*)?((?:\[\d+\])*)$/);
    if (!m) throw new Error(`bad path segment ${part}`);
    if (m[1]) out.push(m[1]);
    for (const idx of m[2]!.matchAll(/\[(\d+)\]/g)) out.push(Number(idx[1]));
  }
  return out;
}

export const formatPath = (segs: Seg[]) => segs.map((s, i) => (typeof s === 'number' ? `[${s}]` : i ? `.${s}` : s)).join('');

/**
 * Paths may name a list item by its id instead of its index ("slides[d4s2].lines", "assessment[q7].answer");
 * this rewrites them to indexes against the current pack.
 */
export function canonicalPath(pack: unknown, path: string): string {
  const withIdx = path.replace(/\[([A-Za-z][\w-]*)\]/g, (_m, id: string, offset: number) => {
    const prefix = path.slice(0, offset);
    let node: any = pack;
    for (const s of parsePath(prefix)) node = node?.[s];
    const k = Array.isArray(node) ? node.findIndex((x: any) => x && x.id === id) : -1;
    if (k < 0) throw new Error(`no item with id ${id} at ${prefix}`);
    return `[${k}]`;
  });
  return formatPath(parsePath(withIdx));
}

/**
 * A quote that matches a different index of the same list, and only one, identifies the intended item: the patch is
 * moved there. Needs a quote of at least 16 letters/digits so a short or empty quote can never move a patch.
 */
export function retarget(pack: WeeklyPackContent, path: string, expect: string | null | undefined): string | null {
  if (!expect || squashText(expect.replace(/"_i"\s*:\s*\d+\s*,?/g, '')).length < 16) return null;
  const segs = parsePath(path);
  const hits = new Set<string>();
  segs.forEach((s, k) => {
    if (typeof s !== 'number') return;
    let arr: any = pack;
    for (const x of segs.slice(0, k)) arr = arr?.[x];
    if (!Array.isArray(arr)) return;
    for (let i = 0; i < arr.length; i++) {
      if (i === s) continue;
      const alt = formatPath([...segs.slice(0, k), i, ...segs.slice(k + 1)]);
      if (expectMatches(pack, alt, expect)) hits.add(alt);
    }
  });
  return hits.size === 1 ? [...hits][0]! : null;
}

const FROZEN = new Set(['schemaVersion', 'packId', 'curriculumVersion', 'curriculumDataRevision', 'learningAreaId', 'grade', 'term', 'week', 'language', 'competencies', 'timing', 'provenance', 'illustrations']);

// A leading "2." the model wrote on a slide line is ignored on both sides: quotes often leave it out.
const squashText = (v: string) => stripEnumerator(v).toLowerCase().replace(/[^a-z0-9]+/g, '');
// A list is compared as all its items in order, so quoting its first item or the whole list both match.
const squash = (v: unknown): string =>
  Array.isArray(v)
    ? v.map((x) => (typeof x === 'string' ? squashText(x) : squashText(JSON.stringify(x)))).join('')
    : v !== null && typeof v === 'object'
      ? squashText(JSON.stringify(v))
      : squashText(String(v ?? ''));

const MISSING = Symbol('missing');
function valueAt(pack: unknown, path: string): unknown {
  let node: any = pack;
  for (const s of parsePath(path)) {
    if (node == null || typeof node !== 'object' || !(s in node)) return MISSING;
    node = node[s];
  }
  return node;
}

/** Guard against wrong-index patches: the reviser must quote the start of the value it replaces. */
export function expectMatches(pack: WeeklyPackContent, path: string, expect: string | null | undefined): boolean {
  let node: any = pack;
  for (const s of parsePath(path)) {
    if (node == null) return false;
    node = node[s];
  }
  const empty = node === '' || node == null || (Array.isArray(node) && node.length === 0);
  if (expect === undefined || expect === null) return empty;
  // Up to 48 letters/digits are compared: two flow steps can open with the same 24 ("Sabihin: …").
  const want = squashText(expect.replace(/"_i"\s*:\s*\d+\s*,?/g, '')).slice(0, 48);
  if (want.length === 0 || want === 'null') return empty;
  if (squash(node).startsWith(want)) return true;
  // An object (e.g. an image {slug, alt}) may be quoted by its first field's value.
  if (node !== null && typeof node === 'object' && !Array.isArray(node)) {
    const first = Object.values(node)[0];
    return squash(first).startsWith(want) || squash(JSON.stringify(node)).includes(want);
  }
  return false;
}

/** Text a model writes instead of the content ("[paragraph updated by issue c1]"). */
const PLACEHOLDER = /\[(?:[^\]]{0,60}\b)?(?:updated|unchanged|placeholder|same as (?:before|above)|see issue|by issue|text here)\b[^\]]{0,60}\]/i;
export function placeholderIn(v: unknown): string | null {
  if (typeof v === 'string') return PLACEHOLDER.test(v) ? v.slice(0, 80) : null;
  if (Array.isArray(v)) for (const x of v) { const p = placeholderIn(x); if (p) return p; }
  else if (v && typeof v === 'object') for (const x of Object.values(v)) { const p = placeholderIn(x); if (p) return p; }
  return null;
}

export function applyPatch(pack: WeeklyPackContent, path: string, value: unknown): WeeklyPackContent {
  const segs = parsePath(path);
  if (!segs.length || FROZEN.has(String(segs[0]))) throw new Error(`path ${path} is not editable`);
  if (segs.at(-1) === 'id' || segs.at(-1) === 'day' || segs.at(-1) === 'revealOf') throw new Error(`path ${path} is structural`);
  const copy = structuredClone(pack) as unknown as Record<string, unknown>;
  let node: any = copy;
  for (const s of segs.slice(0, -1)) {
    if (node == null || !(s in node)) throw new Error(`path ${path} does not exist`);
    node = node[s];
  }
  const last = segs.at(-1)!;
  if (node == null || !(last in node)) throw new Error(`path ${path} does not exist`);
  const before = node[last];
  const kind = (v: unknown) => (Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v);
  if (kind(before) !== kind(value) && !(kind(before) === 'null' || kind(value) === 'null'))
    throw new Error(`path ${path}: type ${kind(value)} replaces ${kind(before)}`);
  node[last] = value;
  return copy as unknown as WeeklyPackContent;
}

/**
 * Mechanical fixes to a patch before it is tried: a number sent as text becomes a number; a slide line over the TV
 * limit is split into two lines at a sentence boundary (the whole `lines` list is then patched). Content is unchanged.
 */
export function preparePatch(pack: WeeklyPackContent, path: string, value: unknown): { path: string; value: unknown; note?: string } {
  const segs = parsePath(path);
  let before: any = pack;
  for (const x of segs) before = before?.[x];
  if (typeof before === 'number' && typeof value === 'string' && /^\s*\d+\s*$/.test(value)) return { path, value: Number(value), note: 'number sent as text' };
  // A list or object sent as JSON text, "null" as text, or a list of lines sent as one text with line breaks.
  if (typeof value === 'string' && before !== null && typeof before === 'object') {
    const text = value.trim();
    if (text === 'null' && !Array.isArray(before)) return preparePatch(pack, path, null);
    if (/^[[{]/.test(text)) {
      try {
        const parsed = stripIndex(JSON.parse(text));
        if (Array.isArray(parsed) === Array.isArray(before) && parsed !== null && typeof parsed === 'object') {
          const next = preparePatch(pack, path, parsed);
          return { ...next, note: [next.note, 'value sent as JSON text'].filter(Boolean).join('; ') };
        }
      } catch {
        /* not JSON: fall through */
      }
    }
    if (Array.isArray(before) && before.every((x) => typeof x === 'string') && text.includes('\n')) {
      const next = preparePatch(pack, path, text.split(/\n+/).map((l) => l.trim()).filter(Boolean));
      return { ...next, note: [next.note, 'list sent as lines of text'].filter(Boolean).join('; ') };
    }
  }
  if (typeof value === 'string' && before === null && value.trim() === 'null') return { path, value: null, note: '"null" sent as text' };
  const max = lineMax(pack.language);
  const one = path.match(/^(slides\[\d+\]\.lines)\[(\d+)\]$/);
  if (one && typeof value === 'string' && value.length > max) {
    const split = splitSlideLine(value, max);
    if (!split) return { path, value };
    let lines: any = pack;
    for (const x of parsePath(one[1]!)) lines = lines?.[x];
    if (!Array.isArray(lines)) return { path, value };
    const k = Number(one[2]);
    const next = [...lines.slice(0, k), ...split, ...lines.slice(k + 1)];
    return next.length <= 5 ? { path: one[1]!, value: next, note: `line split in ${split.length}` } : { path, value };
  }
  if (/^slides\[\d+\]\.lines$/.test(path) && Array.isArray(value) && value.some((l) => typeof l === 'string' && l.length > max)) {
    const next = value.flatMap((l) => (typeof l === 'string' ? (splitSlideLine(l, max) ?? [l]) : [l]));
    return next.length <= 5 ? { path, value: next, note: 'line split' } : { path, value };
  }
  return { path, value };
}

export interface RevisionReport {
  /** `from`: the path the reviser wrote, when its quote identified a different item of the same list; `note`: a mechanical fix. */
  applied: Array<{ path: string; issueIds: string[]; from?: string; note?: string }>;
  rejected: Array<{ path: string; reason: string }>;
  declined: Array<{ issueId: string; reason: string }>;
}

export async function revise(
  meter: Meter,
  pack: WeeklyPackContent,
  t: WeekTarget,
  issues: Issue[],
  round: number,
  opts: { thinking?: boolean; extraCheck?: (p: WeeklyPackContent) => string[] } = {}
): Promise<{ pack: WeeklyPackContent; report: RevisionReport }> {
  const prompt = fill(loadPrompt('pack-revise.v1').text, {
    GRADE: t.grade,
    PACK: JSON.stringify(packForReview(pack)),
    ISSUES: JSON.stringify(issues),
    ART:
      pack.language === 'fil'
        ? '(Filipino edition: the pictures are fixed by the English edition. Never patch an "image".)'
        : artText(artCandidatesFor(t)),
    LANGUAGE_RULE:
      pack.language === 'fil'
        ? 'This is the FILIPINO edition: write every new or changed text in Filipino (Taglish where classrooms mix), following the Hiraia student app rules: natural, simple, short sentences for children on slides; DepEd competency text stays in English.'
        : 'This is the ENGLISH edition: write every new or changed text in plain English; slide text short and simple for children.',
  });
  const mustAnswer = issues.filter((i) => i.severity !== 'minor').map((i) => i.id);
  const res = await stage({
    meter,
    packId: t.targetId,
    name: `${pack.language}-revise${round}`,
    spec: MODELS.writer,
    // The critic already states each fix; reasoning here cost ~19k tokens per pack for targeted patches.
    thinking: opts.thinking ?? false,
    prompt,
    schema: Revision,
    maxTokens: 24_000,
    softCheck: true,
    // The first G4 revision answered 20 issues with one placeholder patch; refuse that instead of applying it.
    check: (r) => {
      const answered = new Set([...r.patches.flatMap((p) => p.issueIds), ...r.declined.map((d) => d.issueId)]);
      const unanswered = mustAnswer.filter((id) => !answered.has(id));
      const holders = r.patches.map((p) => [p.path, placeholderIn(p.value)] as const).filter(([, h]) => h);
      return [
        ...(unanswered.length ? [`These blocker/major issues have neither a patch nor a "declined" reason: ${unanswered.join(', ')}. Answer every one.`] : []),
        ...holders.map(([path, h]) => `${path}: the value is a placeholder ("${h}"), not the finished text. Write the complete new text.`),
      ];
    },
  });
  const report: RevisionReport = { applied: [], rejected: [], declined: res.value.declined };
  let current = pack;
  const failuresOf = (p: WeeklyPackContent) => checkPack(p, t).failures.length + (opts.extraCheck?.(p).length ?? 0) + checkVerbiage(p).failures.length;
  let baseline = failuresOf(current);
  const deferred: Array<{ path: string; value: unknown; issueIds: string[]; from: string; added: number }> = [];
  for (const p of res.value.patches) {
    try {
      const holder = placeholderIn(p.value);
      if (holder) throw new Error(`the new value is a placeholder ("${holder}")`);
      let path = canonicalPath(current, p.path);
      if (valueAt(current, path) === MISSING) {
        const shorter = formatPath(parsePath(path).slice(1));
        throw new Error(`path ${path} does not exist in the pack${shorter && valueAt(current, shorter) !== MISSING ? ` (did you mean ${shorter}?)` : ''}`);
      }
      // The quote guards against a wrong list index, so it is required only when the path has one. Removing a picture
      // (image → null) is accepted on the path alone: the worst case is a slide without a drawing, which the next
      // verification round and the illustration report would show.
      const indexed = parsePath(path).some((x) => typeof x === 'number');
      const removesPicture = /^slides\[\d+\]\.image$/.test(path) && p.value === null;
      if (indexed && !removesPicture && !expectMatches(current, path, p.expect)) {
        const moved = retarget(current, path, p.expect);
        if (!moved) throw new Error('the quoted current value does not match this path (wrong index?)');
        path = moved;
      }
      const prepared = preparePatch(current, path, stripIndex(p.value));
      const next = applyPatch(current, prepared.path, prepared.value);
      const parsed = WeeklyPackContent.safeParse(next);
      if (!parsed.success) throw new Error(`breaks the contract: ${parsed.error.issues[0]?.path.join('.')} ${parsed.error.issues[0]?.message}`);
      const failures = failuresOf(parsed.data);
      if (failures > baseline) {
        // Kept for a second try together with the other patches that failed this way (moving a slide between two
        // flow steps needs both steps patched before the coverage check passes).
        deferred.push({ path: prepared.path, value: prepared.value, issueIds: p.issueIds, from: p.path, added: failures - baseline });
        continue;
      }
      current = parsed.data;
      baseline = failures;
      report.applied.push({ path: prepared.path, issueIds: p.issueIds, ...(prepared.path !== p.path ? { from: p.path } : {}), ...(prepared.note ? { note: prepared.note } : {}) });
    } catch (e) {
      report.rejected.push({ path: p.path, reason: (e as Error).message });
    }
  }
  if (deferred.length) {
    let group = current;
    let ok = true;
    try {
      for (const d of deferred) group = applyPatch(group, d.path, d.value);
    } catch {
      ok = false;
    }
    const parsed = ok ? WeeklyPackContent.safeParse(group) : null;
    if (parsed?.success && failuresOf(parsed.data) <= baseline && deferred.length > 1) {
      current = parsed.data;
      for (const d of deferred) report.applied.push({ path: d.path, issueIds: d.issueIds, ...(d.path !== d.from ? { from: d.from } : {}), note: 'applied together with the other deferred patches' });
    } else for (const d of deferred) report.rejected.push({ path: d.from, reason: `adds ${d.added} check failure(s)` });
  }
  return { pack: current, report };
}
