/**
 * Illustration stage. Every image a slide uses is looked at by a vision model together with that slide's text.
 * A drawing that does not show what the slide explains, or shows a visible science error, text, or anything
 * unsuitable, is replaced by at most two alternatives from the same competency candidates; if none passes, the
 * slide goes without a picture. Results are cached per (image bytes, slide text) and recorded in the pack.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { PackIllustration, Slide, WeeklyPackContent } from '@hiraia/tala-core/contracts';
import { MODELS, chat, parseJsonObject, type Meter } from './llm';
import { fill, loadInputs, loadPrompt, type ArtCandidate } from './context';
import { REFERENCE_ROOT, WORK } from './paths';
import type { WeekTarget } from './targets';

const clip = (n: number) => z.string().transform((s) => s.slice(0, n));
const Verdict = z.object({
  depicts: clip(400),
  matches_slide: z.boolean(),
  scientific_problem: clip(400).nullable().default(null),
  has_text: z.boolean(),
  unsuitable: clip(300).nullable().default(null),
  verdict: z.enum(['pass', 'fail']),
});
type Verdict = z.infer<typeof Verdict>;

export interface ImageStageReport {
  checked: number;
  passed: number;
  swapped: Array<{ slide: string; from: string; to: string }>;
  removed: Array<{ slide: string; slug: string; reason: string }>;
  costUsd: number;
}

const tokens = (s: string) => new Set(s.toLowerCase().match(/[a-z]{4,}/g) ?? []);

function weekCandidates(t: WeekTarget): Map<string, ArtCandidate> {
  const art = loadInputs().art.competencies;
  const out = new Map<string, ArtCandidate>();
  for (const c of t.competencies) for (const cand of art[c.id]?.candidates ?? []) if (!out.has(cand.slug)) out.set(cand.slug, cand);
  return out;
}

async function look(meter: Meter, packId: string, grade: string, s: Slide, cand: ArtCandidate, alt: string, cache: Record<string, Verdict>): Promise<Verdict> {
  const key = createHash('sha256').update(JSON.stringify([cand.sha256, s.title, s.lines, alt])).digest('hex').slice(0, 20);
  if (cache[key]) return cache[key]!;
  const bytes = readFileSync(resolve(REFERENCE_ROOT, cand.file));
  const sha = createHash('sha256').update(bytes).digest('hex');
  if (sha !== cand.sha256) throw new Error(`illustration ${cand.slug} changed on disk since the catalog was built`);
  const prompt = fill(loadPrompt('image-check.v1').text, {
    GRADE: grade,
    TITLE: s.title,
    LINES: s.lines.join(' / ') || '(none)',
    ALT: alt,
  });
  const res = await chat(meter, {
    spec: MODELS.vision,
    maxTokens: 500,
    label: `${packId}:image:${s.id}:${cand.slug}`,
    messages: [
      { role: 'system', content: 'Return one JSON object only.' },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: 'data:image/png;base64,' + bytes.toString('base64') } },
          { type: 'text', text: prompt },
        ],
      },
    ],
  });
  let v: Verdict;
  try {
    v = Verdict.parse(parseJsonObject(res.content));
  } catch {
    // An unreadable verdict is a failed check for this image only, never a failed pack.
    v = { depicts: 'check result could not be read', matches_slide: false, scientific_problem: null, has_text: false, unsuitable: null, verdict: 'fail' };
  }
  // A pass is only a pass if every condition holds, whatever the model wrote in `verdict`.
  const ok = v.verdict === 'pass' && v.matches_slide && !v.scientific_problem && !v.has_text && !v.unsuitable;
  const out = { ...v, verdict: ok ? ('pass' as const) : ('fail' as const) };
  cache[key] = out;
  return out;
}

export async function checkIllustrations(meter: Meter, pack: WeeklyPackContent, t: WeekTarget): Promise<{ pack: WeeklyPackContent; report: ImageStageReport }> {
  const start = meter.spentUsd;
  const dir = resolve(WORK, pack.packId);
  mkdirSync(dir, { recursive: true });
  const cacheFile = resolve(dir, 'image-checks.json');
  const cache: Record<string, Verdict> = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, 'utf8')) : {};
  const cands = weekCandidates(t);
  const report: ImageStageReport = { checked: 0, passed: 0, swapped: [], removed: [], costUsd: 0 };
  const slides: Slide[] = [];
  const records = new Map<string, PackIllustration>();
  try {
    for (const s of pack.slides) {
      if (!s.image) {
        slides.push(s);
        continue;
      }
      const first = cands.get(s.image.slug);
      const tried = new Set<string>();
      let chosen: { cand: ArtCandidate; verdict: Verdict; alt: string } | null = null;
      const attempt = async (cand: ArtCandidate, alt: string) => {
        tried.add(cand.slug);
        report.checked += 1;
        const v = await look(meter, pack.packId, pack.grade, s, cand, alt, cache);
        if (v.verdict === 'pass') chosen = { cand, verdict: v, alt };
        return v;
      };
      let firstVerdict: Verdict | null = null;
      if (first) firstVerdict = await attempt(first, s.image.alt);
      if (!chosen) {
        // Alternatives: same-week candidates whose captions share the most words with the slide.
        const want = tokens([s.title, ...s.lines].join(' '));
        const ranked = [...cands.values()]
          .filter((c) => !tried.has(c.slug))
          .map((c) => ({ c, score: [...tokens([...c.titles, c.depiction ?? ''].join(' '))].filter((w) => want.has(w)).length }))
          .filter((x) => x.score >= 2)
          .sort((a, b) => b.score - a.score)
          .slice(0, 2);
        for (const { c } of ranked) {
          await attempt(c, (c.titles[0] ?? c.slug) + ': ' + (c.depiction ?? '').slice(0, 120));
          if (chosen) break;
        }
      }
      if (chosen) {
        const { cand, verdict } = chosen as { cand: ArtCandidate; verdict: Verdict; alt: string };
        report.passed += 1;
        if (cand.slug !== s.image.slug) report.swapped.push({ slide: s.id, from: s.image.slug, to: cand.slug });
        const alt = cand.slug === s.image.slug ? s.image.alt : verdict.depicts.slice(0, 200);
        slides.push({ ...s, image: { slug: cand.slug, alt } });
        const rec = records.get(cand.slug);
        if (rec) rec.slides.push(s.id);
        else
          records.set(cand.slug, {
            slug: cand.slug,
            file: cand.file,
            sha256: cand.sha256,
            px: cand.px,
            v05Status: cand.status,
            generator: cand.generator,
            slides: [s.id],
            check: { method: 'vision_model', model: MODELS.vision.model, verdict: 'pass', note: verdict.depicts.slice(0, 600) },
          });
      } else {
        const why = !first
          ? 'not an approved candidate for this week'
          : firstVerdict
            ? [!firstVerdict.matches_slide && 'does not show what the slide explains', firstVerdict.scientific_problem, firstVerdict.has_text && 'has text in the drawing', firstVerdict.unsuitable]
                .filter(Boolean)
                .join('; ')
            : 'not checked';
        report.removed.push({ slide: s.id, slug: s.image.slug, reason: why || 'failed the check' });
        slides.push({ ...s, image: null });
      }
    }
  } finally {
    writeFileSync(cacheFile, JSON.stringify(cache, null, 1));
  }
  report.costUsd = meter.spentUsd - start;
  return { pack: { ...pack, slides, illustrations: [...records.values()] }, report };
}
