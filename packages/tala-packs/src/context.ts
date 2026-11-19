/**
 * Everything the writer and the critic see for one week, assembled only from verified inputs: the curriculum record,
 * DepEd's printed term activities, Hiraia's per-competency statements, the closed reference list and the approved
 * illustration candidates.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DATA, PROMPTS } from './paths';
import { buildTargets, loadSciencePacks, type WeekTarget } from './targets';
import { CURRICULUM_PACKS } from './paths';

export interface ArtCandidate {
  slug: string;
  file: string;
  sha256: string;
  px: [number, number];
  status: 'clean' | 'approved_regen';
  score: number;
  evidence: string[];
  cards: string[];
  titles: string[];
  facts: string[];
  depiction: string | null;
  depictionSource: string | null;
  generator: string;
}
interface ArtCatalog {
  referenceCommit: string;
  competencies: Record<string, { hiraiaCode: string; candidates: ArtCandidate[] }>;
}
interface Grounding {
  competencies: Record<string, { hiraiaCode: string; statements: Array<{ id: string; kind: string; text: string; source: string }> }>;
}
interface BowActivities {
  grades: Record<string, { source: { document: string; edition: string }; terms: Record<string, { suggestedActivities: string[]; performanceTasks: string[]; pages: number[] }> }>;
}
export interface Reference {
  id: string;
  kind: string;
  title: string;
  publisher: string;
  url: string;
  locatorHint: string;
  verification: string;
}

const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf8')) as T;

let cache: {
  targets: WeekTarget[];
  art: ArtCatalog;
  grounding: Grounding;
  bow: BowActivities;
  references: Reference[];
} | null = null;

export function loadInputs() {
  if (!cache) {
    cache = {
      targets: buildTargets(loadSciencePacks(CURRICULUM_PACKS)),
      art: readJson<ArtCatalog>(resolve(DATA, 'art/competency-candidates.json')),
      grounding: readJson<Grounding>(resolve(DATA, 'grounding/competency-statements.json')),
      bow: readJson<BowActivities>(resolve(DATA, 'curriculum/science-bow-2026-activities.json')),
      references: readJson<{ references: Reference[] }>(resolve(DATA, 'references.json')).references,
    };
  }
  return cache;
}

export function loadPrompt(name: string): { id: string; text: string } {
  return { id: name, text: readFileSync(resolve(PROMPTS, `${name}.md`), 'utf8') };
}

export function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (m, k: string) => {
    if (!(k in vars)) throw new Error(`Prompt variable ${k} not supplied.`);
    return vars[k]!;
  });
}

export function describeTarget(t: WeekTarget): string {
  const lines = [
    `Grade ${t.grade} Science, Term ${t.term}, Week ${t.week} of ${t.termWeeks} (DepEd 2026 Three-Term Budget of Work).`,
    `Competencies for this week (verbatim; ids in brackets):`,
    ...t.competencies.map(
      (c) =>
        `- [${c.id}] ${c.text}\n  Topic: ${c.shortTitle ?? c.domain ?? '—'}. Printed weeks ${c.weekFrom}–${c.weekTo}; this is week ${c.position} of ${c.spanWeeks} for it.`
    ),
  ];
  if (t.ranges.length > 1)
    lines.push(
      `Note: DepEd's printed week cells overlap this week (${t.ranges.map((r) => `${r.weekFrom}–${r.weekTo}`).join(' and ')}); both topics run this week.`
    );
  if (t.contentStandard) lines.push(`Term content standard: ${t.contentStandard}`);
  if (t.performanceStandard) lines.push(`Term performance standard: ${t.performanceStandard}`);
  lines.push(
    `Last week's topic: ${t.previousWeekTitles.join(' · ') || '(start of term)'}. Next week's topic: ${t.nextWeekTitles.join(' · ') || '(end of term)'}.`
  );
  return lines.join('\n');
}

export function bowActivitiesFor(t: WeekTarget): string {
  const term = loadInputs().bow.grades[t.grade]?.terms[String(t.term)];
  if (!term) return '(none printed)';
  return [
    'Suggested activities:',
    ...term.suggestedActivities.map((a) => `- ${a}`),
    'Suggested performance tasks:',
    ...term.performanceTasks.map((a) => `- ${a}`),
  ].join('\n');
}

export function groundingFor(t: WeekTarget, perCompetency = 10): { text: string; ids: string[] } {
  const g = loadInputs().grounding.competencies;
  const ids: string[] = [];
  const blocks = t.competencies.map((c) => {
    const items = (g[c.id]?.statements ?? []).slice(0, perCompetency);
    ids.push(...items.map((s) => s.id));
    return [`For [${c.id}]:`, ...items.map((s) => `- (${s.kind}; ${s.source.slice(0, 80)}) ${s.text.replace(/\s+/g, ' ')}`)].join('\n');
  });
  return { text: blocks.join('\n'), ids: [...new Set(ids)] };
}

export function referencesText(): string {
  return loadInputs()
    .references.map((r) => `- ${r.id}: ${r.title} — ${r.publisher}. Locator: ${r.locatorHint}.`)
    .join('\n');
}

/** Illustration candidates for the week: union over its competencies, best first, deduplicated. */
export function artCandidatesFor(t: WeekTarget, perCompetency = 18, cap = 60): ArtCandidate[] {
  const art = loadInputs().art.competencies;
  const seen = new Map<string, ArtCandidate>();
  const lists = t.competencies.map((c) => (art[c.id]?.candidates ?? []).slice(0, perCompetency));
  // round-robin so every competency gets its best images in before any gets its tenth
  for (let i = 0; i < perCompetency; i++)
    for (const list of lists) {
      const cand = list[i];
      if (cand && !seen.has(cand.slug)) seen.set(cand.slug, cand);
    }
  return [...seen.values()].slice(0, cap);
}

export function artText(cands: ArtCandidate[]): string {
  return cands
    .map((c) => {
      const what = (c.depiction ?? c.facts[0] ?? '').replace(/\s+/g, ' ');
      const shortWhat = what
        .replace(/black[- ]and[- ]white.*$/i, '')
        .replace(/hand-drawn line art.*$/i, '')
        .slice(0, 170);
      return `- ${c.slug}: ${c.titles[0] ?? ''} — ${shortWhat}`;
    })
    .join('\n');
}
