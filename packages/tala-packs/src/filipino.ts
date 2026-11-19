/**
 * The Filipino edition of a week. Written natively in Filipino from the checked English edition: the same
 * competencies, timing, lesson structure, slides and drawings, with the text composed for Filipino classrooms under
 * the Hiraia student app's wording rules (docs/tala/teaching-packs/VERBIAGE-RULES.md).
 *
 *   guide + assessment → deepseek-v4-pro (reasoning off): teacher explanations, misconceptions, worked answers
 *   five days          → deepseek-flash: lesson plan, slides, speaker notes
 *
 * Structure is copied from the English edition, never taken from the model; only text is.
 */
import { z } from 'zod';
import { AssessmentItem, TeacherGuide, type Slide, type WeeklyPackContent } from '@hiraia/tala-core/contracts';
import { MODELS, type Meter, type ModelSpec } from './llm';
import { fill, loadInputs, loadPrompt } from './context';
import { DayOut, LENGTH_ONLY, stage, tidySlide, type DayOut as DayOutT } from './generate';
import type { WeekTarget } from './targets';
import { lineMax, slideCharsMax, splitAtComma, splitSlideLine, stripEnumerator } from './text';

export const FilGuideOut = z.object({
  title: z.string().trim().min(1).max(80),
  summary: z.string().trim().min(1).max(600),
  guide: TeacherGuide,
  assessment: z.array(AssessmentItem).min(4).max(12),
});
export type FilGuideOut = z.infer<typeof FilGuideOut>;

/** Hiraia's own Filipino wording for the week's competencies, plus the pack's vocabulary pairs. */
export function filipinoAnchors(en: WeeklyPackContent, t: WeekTarget, perCompetency = 6): { examples: string; glossary: string } {
  const g = loadInputs().grounding.competencies as Record<string, { statements: Array<{ tl?: string | null }> }>;
  const examples = t.competencies
    .flatMap((c) => (g[c.id]?.statements ?? []).map((s) => s.tl).filter((x): x is string => Boolean(x)).slice(0, perCompetency))
    .map((x) => `- ${x.replace(/\s+/g, ' ')}`);
  const glossary = en.guide.vocabulary.map((v) => `- ${v.term}${v.filipino ? ` → ${v.filipino}` : ' → (keep the English word)'}`);
  return { examples: [...new Set(examples)].join('\n') || '(none)', glossary: glossary.join('\n') };
}

/** Copy structure from the English edition; keep only the model's text. */
function lockGuideStructure(en: WeeklyPackContent) {
  return (raw: unknown, log: string[]): unknown => {
    if (!raw || typeof raw !== 'object') return raw;
    const o = structuredClone(raw) as any;
    const g = o.guide ?? {};
    const same = (key: string) => {
      const a = (en.guide as any)[key] as unknown[];
      if (!Array.isArray(g[key]) || g[key].length !== a.length) log.push(`guide.${key}: ${Array.isArray(g[key]) ? g[key].length : 'missing'} items, English has ${a.length}`);
    };
    for (const k of ['background', 'prerequisites', 'vocabulary', 'misconceptions', 'studentQuestions', 'localExamples', 'materials', 'preparation', 'safety', 'sources']) same(k);
    (g.background ?? []).forEach((b: any, i: number) => {
      if (en.guide.background[i]) b.refIds = en.guide.background[i]!.refIds;
    });
    (g.vocabulary ?? []).forEach((v: any, i: number) => {
      const e = en.guide.vocabulary[i];
      if (e) {
        v.term = e.term;
        v.filipino = e.filipino;
      }
    });
    (g.sources ?? []).forEach((s: any, i: number) => {
      const e = en.guide.sources[i];
      if (e) {
        s.refId = e.refId;
        s.locator = e.locator;
      }
    });
    (o.assessment ?? []).forEach((q: any, i: number) => {
      const e = en.assessment[i];
      if (!e) return;
      q.id = e.id;
      q.kind = e.kind;
      q.correctChoice = e.correctChoice;
      q.competencyId = e.competencyId;
      if ((q.choices ?? []).length !== e.choices.length) log.push(`assessment[${i}]: ${(q.choices ?? []).length} choices, English has ${e.choices.length}`);
    });
    return o;
  };
}

function guideChecks(en: WeeklyPackContent) {
  return (v: FilGuideOut): string[] => {
    const errs: string[] = [];
    for (const k of ['background', 'prerequisites', 'vocabulary', 'misconceptions', 'studentQuestions', 'localExamples', 'materials', 'preparation', 'safety', 'sources'] as const)
      if ((v.guide[k] as unknown[]).length !== (en.guide[k] as unknown[]).length) errs.push(`guide.${k} must have exactly ${(en.guide[k] as unknown[]).length} items, as in the English edition`);
    if (v.assessment.length !== en.assessment.length) errs.push(`assessment must have exactly ${en.assessment.length} items`);
    v.assessment.forEach((q, i) => {
      if (q.choices.length !== (en.assessment[i]?.choices.length ?? 0)) errs.push(`assessment[${i}] must have ${en.assessment[i]?.choices.length} choices`);
    });
    return errs;
  };
}

function lockDayStructure(enDay: DayOutT) {
  return (raw: unknown, log: string[]): unknown => {
    if (!raw || typeof raw !== 'object') return raw;
    const o = structuredClone(raw) as any;
    o.day = enDay.day;
    o.minutes = enDay.minutes;
    o.competencyIds = enDay.competencyIds;
    if (!Array.isArray(o.flow) || o.flow.length !== enDay.flow.length) log.push(`flow: ${Array.isArray(o.flow) ? o.flow.length : 'missing'} steps, English has ${enDay.flow.length}`);
    (o.flow ?? []).forEach((f: any, i: number) => {
      const e = enDay.flow[i];
      if (!e) return;
      f.phase = e.phase;
      f.minutes = e.minutes;
      f.slideIds = e.slideIds;
    });
    if (!Array.isArray(o.slides) || o.slides.length !== enDay.slides.length) log.push(`slides: ${Array.isArray(o.slides) ? o.slides.length : 'missing'}, English has ${enDay.slides.length}`);
    (o.slides ?? []).forEach((s: any, i: number) => {
      const e = enDay.slides[i];
      if (!e) return;
      s.id = e.id;
      s.day = e.day;
      s.kind = e.kind;
      s.revealOf = e.revealOf;
      s.correctChoice = e.correctChoice;
      s.lines ??= [];
      s.choices ??= [];
      // Over-long lines: drop a leading "1." the deck adds itself, then split at a sentence boundary if there is room.
      if (Array.isArray(s.lines) && s.lines.some((l: unknown) => typeof l === 'string' && stripEnumerator(l).length > lineMax('fil'))) {
        const fixed = s.lines.flatMap((l: unknown) => {
          if (typeof l !== 'string') return [l];
          const bare = stripEnumerator(l);
          return bare.length > lineMax('fil') ? (splitSlideLine(bare, lineMax('fil')) ?? splitAtComma(bare, lineMax('fil')) ?? [bare]) : [l];
        });
        if (fixed.length <= 5) {
          s.lines = fixed;
          log.push(`slides[${i}]: long line split or unnumbered`);
        }
      }
      s.image = e.image ? { slug: e.image.slug, alt: (s.image && typeof s.image === 'object' && s.image.alt) || e.image.alt } : null;
    });
    return o;
  };
}

function dayChecksFil(enDay: DayOutT) {
  return (d: DayOutT): string[] => {
    const errs: string[] = [];
    if (d.slides.length !== enDay.slides.length) errs.push(`write exactly ${enDay.slides.length} slides, one for each English slide, in the same order`);
    if (d.flow.length !== enDay.flow.length) errs.push(`write exactly ${enDay.flow.length} flow steps, one for each English step`);
    d.slides.forEach((s, i) => {
      const e = enDay.slides[i];
      if (e && s.choices.length !== e.choices.length) errs.push(`slides[${i}] must have ${e.choices.length} choices`);
      if (s.title.length > 60) errs.push(`${LENGTH_ONLY}slides[${i}].title is longer than 60 characters`);
      s.lines.forEach((l, j) => {
        if (stripEnumerator(l).length > lineMax('fil')) errs.push(`${LENGTH_ONLY}slides[${i}].lines[${j}] is ${stripEnumerator(l).length} characters; the limit is ${lineMax('fil')}. Shorten it or split it into two lines`);
      });
      if (s.lines.join('').length > slideCharsMax('fil')) errs.push(`${LENGTH_ONLY}slides[${i}] has ${s.lines.join('').length} characters of text; the limit is ${slideCharsMax('fil')}. Keep the same ideas in fewer words`);
    });
    return errs;
  };
}

/** The English edition's day, as the Filipino writer sees it (structure and checked text). */
function enDayView(en: WeeklyPackContent, day: number): DayOutT {
  const plan = en.days.find((d) => d.day === day)!;
  const slides = en.slides.filter((s) => s.day === day);
  return { ...plan, slides } as DayOutT;
}

export async function composeFilipino(meter: Meter, en: WeeklyPackContent, t: WeekTarget, opts: { guideModel?: ModelSpec; dayModel?: ModelSpec } = {}): Promise<WeeklyPackContent> {
  const guideSpec = opts.guideModel ?? MODELS.writer;
  const daySpec = opts.dayModel ?? MODELS.writerFlash;
  const anchors = filipinoAnchors(en, t);
  const guidePrompt = loadPrompt('pack-fil-guide.v1');
  const guide = await stage({
    meter,
    packId: t.targetId,
    name: 'fil-guide',
    spec: guideSpec,
    thinking: false,
    maxTokens: 20_000,
    schema: FilGuideOut,
    normalize: lockGuideStructure(en),
    check: guideChecks(en),
    prompt: fill(guidePrompt.text, {
      GRADE: t.grade,
      FIL_EXAMPLES: anchors.examples,
      EN: JSON.stringify({ title: en.title, summary: en.summary, guide: en.guide, assessment: en.assessment }),
    }),
  });
  const dayPrompt = loadPrompt('pack-fil-day.v1');
  const days = await Promise.all(
    en.days.map(async (d) => {
      const enDay = enDayView(en, d.day);
      const res = await stage({
        meter,
        packId: t.targetId,
        name: `fil-day${d.day}`,
        spec: daySpec,
        thinking: false,
        maxTokens: 16_000,
        schema: DayOut,
        normalize: lockDayStructure(enDay),
        check: dayChecksFil(enDay),
        prompt: fill(dayPrompt.text, {
          GRADE: t.grade,
          DAY: String(d.day),
          GLOSSARY: `${anchors.glossary}\n${anchors.examples}`,
          EN_DAY: JSON.stringify(enDay),
        }),
      });
      return res.value;
    })
  );
  const slides: Slide[] = [
    filCover(en),
    ...days.flatMap((d) => d.slides.map(tidySlide)),
    filCredits(en),
  ];
  return {
    ...en,
    language: 'fil',
    title: guide.value.title,
    summary: guide.value.summary,
    guide: guide.value.guide,
    assessment: guide.value.assessment,
    days: days.map(({ slides: _s, ...rest }) => rest),
    slides,
    timing: { ...en.timing, basis: FIL_TIMING },
    provenance: {
      ...en.provenance,
      promptIds: [...en.provenance.promptIds, guidePrompt.id, dayPrompt.id],
      models: [
        ...en.provenance.models.map((m) => ({ ...m, role: `english-${m.role}` })),
        { role: 'filipino-guide-and-assessment', provider: guideSpec.provider, model: guideSpec.model },
        { role: 'filipino-days-slides-notes', provider: daySpec.provider, model: daySpec.model },
      ],
      generatedAt: new Date().toISOString(),
    },
  };
}

export const FIL_TIMING =
  'Limang beses sa isang linggo itinuturo ang Science, 45 minuto bawat session, sa Grade 3 hanggang 10: DepEd Order No. 010, s. 2024 (Tables 3, 5 at 6) at DepEd Order No. 012, s. 2024 (§2.a, na pumapayag din sa 50, 55 o 60 minutong period). Ginamit para sa three-term calendar ng SY 2026–2027.';

function filCover(en: WeeklyPackContent): Slide {
  const c = en.slides[0]!;
  return {
    ...c,
    title: c.title,
    lines: [`Grade ${en.grade} Science · Term ${en.term} · Week ${en.week}`, 'Limang lesson na tig-45 minuto'],
    notes:
      'Paano gamitin ang deck: nagsisimula ang bawat lesson sa slide na "Araw". Nasa speaker notes ng bawat slide kung ano ang sasabihin, ' +
      'ano ang itatanong at ang inaasahang sagot; lumalabas lang ito sa Presenter View, hindi sa TV. Nauuna ang slide na may tanong bago ' +
      'ang slide na may sagot, para makapag-isip muna ang learners. Nasa teacher guide (hiwalay na PDF) ang paliwanag sa science, ang mga ' +
      'karaniwang maling akala, at ang buong answer key.',
  };
}

function filCredits(en: WeeklyPackContent): Slide {
  const c = en.slides.at(-1)!;
  return {
    ...c,
    title: 'Tungkol sa deck na ito',
    lines: [
      'Inihanda ng Hiraia para sa Tala, isang libreng tool para sa teachers',
      `Curriculum: DepEd Grade ${en.grade} Science, 2026 Three-Term Budget of Work`,
      'Mga drawing: Hiraia science illustration library',
    ],
    notes:
      'Nasa teacher guide ang mga source ng science para sa linggong ito. Hindi kaanib o inendorso ng Department of Education ang Hiraia. ' +
      'I-check ang lesson laban sa sarili mong curriculum guide bago ito ituro.',
  };
}
