/**
 * Community moderation (PRD §11.6): rule detectors first, then the model, against deliberately loose
 * guidelines. Student personal data is the one strict category.
 *
 *   high rule finding           → return (no model call; strict category)
 *   moderation off / route rules → allow (rules only; low hints are "unsure", and unsure means allow)
 *   model answers               → allow, or return with reasons (unclear reasons outside personal data dropped)
 *   model unavailable / invalid → pending; a background recheck decides later
 */
import { z } from 'zod';
import type { ModerationDecision, SectionContent } from '@hiraia/tala-core';
import { detectPersonalData, hasBlockingFinding, moderationText, normalizeForMatch, textUnits } from '@hiraia/tala-core/moderation';
import type { PersonalDataFinding } from '@hiraia/tala-core/moderation';
import type { LlmGateway, TalaServerConfig } from '../../kernel/types';

export const MODERATION_PROMPT_ID = 'moderation/moderate';
/** Characters of lesson text sent to the model. Rule detectors always read everything. */
export const MODERATION_MAX_CHARS = 20_000;

export const ModelVerdict = z.object({
  decision: z.enum(['allow', 'return']),
  reasons: z
    .array(
      z.object({
        category: z.enum(['student_personal_data', 'unsuitable', 'not_a_lesson']),
        clear: z.boolean().default(true),
        message: z.string().max(400),
        sectionKey: z.string().max(64).nullable().default(null),
        excerpt: z.string().max(600).nullable().default(null),
      }),
    )
    .max(10)
    .default([]),
});
export type ModelVerdict = z.infer<typeof ModelVerdict>;

export interface ModerationInput {
  title: string;
  summary: string;
  sections: ReadonlyArray<{ key: string; content: SectionContent }>;
  /** Variants of learner names from the author's own class lists. Never logged, never sent to a model. */
  knownNames: readonly string[];
  report?: { reason: string; note: string } | null;
  userId: string | null;
}

export interface ModerationOutcome {
  decision: ModerationDecision;
  provider: string;
  model: string | null;
  promptVersion: number | null;
  /** 'ok' | 'rules_strict' | 'rules_only' | the gateway's failure reason. Safe to log. */
  llmOutcome: string;
  ruleKinds: string[];
}

const GENERIC_MESSAGES: Record<ModerationDecision['reasons'][number]['category'], string> = {
  student_personal_data: "This lesson seems to include a learner's personal information. Please remove it and post again.",
  unsuitable: 'Part of this lesson is not suitable for a shared teaching library. Please change it and post again.',
  not_a_lesson: 'This does not look like a lesson. The community is for lesson plans only.',
};

export async function runModeration(deps: { llm: LlmGateway; config: TalaServerConfig }, input: ModerationInput): Promise<ModerationOutcome> {
  const guidelineVersion = deps.config.moderation.guidelineVersion;
  const textInput = { title: input.title, summary: input.summary, sections: input.sections };
  const findings = detectPersonalData(textInput, { knownNames: input.knownNames });
  const ruleKinds = [...new Set(findings.map((f) => `${f.kind}:${f.confidence}`))].sort();

  if (hasBlockingFinding(findings)) {
    return {
      decision: { decision: 'return', reasons: findings.filter((f) => f.confidence === 'high').map(toReason), guidelineVersion },
      provider: 'rules',
      model: null,
      promptVersion: null,
      llmOutcome: 'rules_strict',
      ruleKinds,
    };
  }

  const rulesOnly = (llmOutcome: string): ModerationOutcome => ({
    decision: { decision: 'allow', reasons: [], guidelineVersion },
    provider: 'rules',
    model: null,
    promptVersion: null,
    llmOutcome,
    ruleKinds,
  });
  const route = deps.llm.routeFor('community.moderate');
  if (!deps.config.moderation.enabled || route === 'rules' || route === 'off') return rulesOnly('rules_only');

  const { text } = moderationText(textInput, MODERATION_MAX_CHARS);
  const sectionKeys = new Set(['title', 'summary', ...input.sections.map((s) => s.key)]);
  const result = await deps.llm.complete({
    feature: 'community.moderate',
    promptId: MODERATION_PROMPT_ID,
    // moderate.v<n> embeds guidelines.v<n>: the guideline version selects the prompt.
    version: guidelineVersion,
    vars: {
      lesson: text,
      hints: JSON.stringify(findings.map((f) => ({ kind: f.kind, sectionKey: f.sectionKey, excerpt: f.excerpt }))),
      report: input.report ? JSON.stringify({ reason: input.report.reason, note: input.report.note }) : 'none',
    },
    schema: ModelVerdict,
    userId: input.userId,
    maxOutputTokens: 800,
    check: (v) => (v.decision === 'return' && v.reasons.length === 0 ? ['A "return" decision needs at least one reason.'] : []),
  });

  if (!result.ok) {
    if (result.reason === 'disabled' || result.reason === 'rules_only') return rulesOnly('rules_only');
    return {
      decision: { decision: 'pending', reasons: [], guidelineVersion },
      provider: 'none',
      model: null,
      promptVersion: null,
      llmOutcome: result.reason,
      ruleKinds,
    };
  }

  const units = textUnits(textInput).map((u) => ({ key: u.sectionKey, norm: normalizeForMatch(u.text) }));
  const reasons: ModerationDecision['reasons'] = [];
  if (result.data.decision === 'return') {
    for (const r of result.data.reasons) {
      // Loose guidelines: outside the strict category, an unclear reason is "unsure", and unsure means allow.
      if (r.category !== 'student_personal_data' && !r.clear) continue;
      const excerpt = traceExcerpt(r.excerpt, units);
      reasons.push({
        category: r.category,
        message: r.message.trim() ? r.message.trim().slice(0, 300) : GENERIC_MESSAGES[r.category],
        sectionKey: excerpt?.key ?? (r.sectionKey && sectionKeys.has(r.sectionKey) ? r.sectionKey : null),
        excerpt: excerpt?.text ?? null,
      });
    }
  }
  return {
    decision: { decision: reasons.length ? 'return' : 'allow', reasons, guidelineVersion },
    provider: result.provider,
    model: result.model,
    promptVersion: result.promptVersion,
    llmOutcome: 'ok',
    ruleKinds,
  };
}

function toReason(f: PersonalDataFinding): ModerationDecision['reasons'][number] {
  return { category: 'student_personal_data', message: f.message, sectionKey: f.sectionKey, excerpt: f.excerpt.slice(0, 300) };
}

/**
 * Keep a model excerpt only if it really is in the lesson (model output is untrusted, PRD §9.6), and report
 * the section it is actually in.
 */
function traceExcerpt(excerpt: string | null, units: Array<{ key: string; norm: string }>): { key: string; text: string } | null {
  if (!excerpt) return null;
  const needle = normalizeForMatch(excerpt).replace(/[….]+$/, '').trim();
  if (needle.length < 3) return null;
  const hit = units.find((u) => u.norm.includes(needle)) ?? units.find((u) => needle.includes(u.norm) && u.norm.length >= 8);
  return hit ? { key: hit.key, text: excerpt.trim().slice(0, 300) } : null;
}
