/**
 * Judge a set of session-walk transcripts (scripts/walk-out/session-*.json) — the
 * LLM half of the local content check, on the Claude SUBSCRIPTION (no API key),
 * matching the repo's eval convention (see finetuning/distill/eval/judge-v2.wf.js).
 *
 * One agent per session file reads the full reader-visible transcript and scores it
 * on the content questions the deterministic harness cannot answer:
 *   sequencing  — does the walk make sense page to page; are fork offers distinct
 *   text        — reading level, language consistency, factual sanity of factoids
 *   art         — is the named illustration plausibly relevant (it may view the webp)
 *   titles      — QUALITY of authored titles and ticket labels: fragments, spoilers of
 *                 the next card, ungrounded names. Register is mixed BY DESIGN (English
 *                 science terms in Tagalog grammar, "Windpipe ng Python") — never penalize
 *                 that. COVERAGE (missing titles) is a walker-side tripwire, not judged.
 *   quiz        — MCQ quality where interjects fired (options plausible, answer true)
 *
 * Usage (from repo root, after `npx tsx scripts/session-walk.mts`):
 *   claude -p "run packages/mobile/scripts/judge-walks.wf.js with dir=packages/mobile/scripts/walk-out"
 * or inside Claude Code as a workflow. Merges to walk-out/JUDGE-REPORT.md.
 */
export const meta = {
  name: 'judge-card-walks',
  description: 'Score session-walk transcripts for sequencing, text, art, title and quiz quality',
  phases: [
    { title: 'Judge', detail: 'one agent per session transcript' },
    { title: 'Merge', detail: 'aggregate scores + worst offenders into JUDGE-REPORT.md' },
  ],
}
const _a = typeof args === 'string' ? JSON.parse(args) : args
const DIR = _a.dir || 'packages/mobile/scripts/walk-out'

const SCHEMA = {
  type: 'object',
  required: ['scores', 'issues', 'best_pages', 'worst_pages', 'summary'],
  properties: {
    scores: {
      type: 'object',
      required: ['sequencing', 'text_quality', 'art_fit', 'titles', 'quiz'],
      properties: {
        sequencing: { type: 'integer', description: '0-5: page-to-page flow makes sense for a curious grade-schooler; topic changes are at sensible moments; fork offers (when present) are genuinely different choices' },
        text_quality: { type: 'integer', description: '0-5: factoid bodies are age-appropriate, language-consistent (Tagalog session: no unexplained English sentences), factually sane' },
        art_fit: { type: 'integer', description: '0-5: the illustration slugs named on the pages plausibly depict what the card is about (view the webp files if uncertain)' },
        titles: { type: 'integer', description: '0-5: authored band titles and ticket labels read as real titles — noun phrases grounded in the card, not fragments ("when did", "wire gets"), not spoilers of the next card. English science terms inside Tagalog grammar are CORRECT register, not a defect; an all-English title is acceptable when the term is untranslatable. Only flag wrong-language content (e.g. Cebuano leaking into a Tagalog session) or titles naming something the fact does not say' },
        quiz: { type: 'integer', description: '0-5: interjected MCQs are answerable from the card they reference; options plausible; the marked answer is true; language matches (N/A-only if no quizzes, then 5)' },
      },
    },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        required: ['page', 'kind', 'detail'],
        properties: {
          page: { type: 'integer', description: 'page number n in the transcript (or -1 for session-level)' },
          kind: { type: 'string', description: 'one of: sequencing, text, art, title, quiz' },
          detail: { type: 'string', description: 'what is wrong, quoting the exact copy seen' },
        },
      },
    },
    best_pages: { type: 'array', items: { type: 'integer' }, description: 'up to 3 page numbers that show the deck at its best' },
    worst_pages: { type: 'array', items: { type: 'integer' }, description: 'up to 3 page numbers that most need work' },
    summary: { type: 'string', description: '2-3 sentences: what a child would experience in this session' },
  },
}

phase('Judge')
const sessions = _a.sessions || null
const tasks = (sessions || []).length
  ? sessions
  : await agent(
      `List the session-*.json files in ${DIR} and return their basenames as a JSON array of strings, nothing else.`,
      { label: 'list-sessions', phase: 'Judge', schema: { type: 'object', required: ['files'], properties: { files: { type: 'array', items: { type: 'string' } } } } }
    ).then((r) => r.files)

const judged = await parallel(
  tasks.map((f) => () =>
    agent(
      `You are auditing Hiraia, an offline Tagalog science card-feed app for Filipino grade-schoolers. ` +
        `Read the session transcript ${DIR}/${f} (JSON: policy, asks, pages[] — each page has band title, body text, art file path, ticket labels shown as the NEXT-CARD button, occasional quiz).\n\n` +
        `The art field is a path relative to the repo root; you may VIEW any of these image files to check the picture matches the card's topic. Band fallbacks (bandWasFallback) are cards with no authored title.\n\n` +
        `Score per the schema. Be strict about: ticket labels that are word fragments ("wire gets", "inapo") or spoil the next card's fact; titles naming something the card's fact does not say. Do NOT penalize English science terms in Tagalog titles — that is the deck's designed register ("Windpipe ng Python" is a good title); only flag body text that mixes whole English SENTENCES into Tagalog without reason; ` +
        `quiz options in the wrong language; a walk that repeats topics or lurches without logic; illustrations that depict something else entirely. ` +
        `Factual sanity only — flag science that is plainly wrong, do not deep-verify every claim.`,
      { label: `judge:${f}`, phase: 'Judge', schema: SCHEMA, agentType: 'general-purpose' }
    ).then((r) => ({ file: f, ...r })).catch(() => null)
  )
)

phase('Merge')
const rows = judged.filter(Boolean)
const mean = (k) => rows.length ? rows.reduce((x, r) => x + (r.scores?.[k] ?? 0), 0) / rows.length : 0
const issues = rows.flatMap((r) => (r.issues || []).map((i) => ({ file: r.file, ...i })))
const byKind = {}
for (const i of issues) byKind[i.kind] = (byKind[i.kind] || 0) + 1

const report = [
  `# Walk judge report`,
  ``,
  `${rows.length} sessions judged from ${DIR}.`,
  ``,
  `## Mean scores (0-5)`,
  ...['sequencing', 'text_quality', 'art_fit', 'titles', 'quiz'].map((k) => `- ${k}: ${mean(k).toFixed(2)}`),
  ``,
  `## Issues by kind`,
  ...Object.entries(byKind).map(([k, n]) => `- ${k}: ${n}`),
  ``,
  `## All issues`,
  ...issues.map((i) => `- [${i.kind}] ${i.file} p${i.page}: ${i.detail}`),
  ``,
  `## Session summaries`,
  ...rows.map((r) => `- **${r.file}** (${r.summary || ''})`),
].join('\n')

return { report, scores: Object.fromEntries(['sequencing', 'text_quality', 'art_fit', 'titles', 'quiz'].map((k) => [k, +mean(k).toFixed(2)])), issue_count: issues.length, files: rows.map((r) => r.file) }
