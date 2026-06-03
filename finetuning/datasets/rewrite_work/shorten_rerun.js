export const meta = {
  name: 'shorten-rerun',
  description: 'Re-run the 28 missing Tagalog chunk rewrites (<=6 sentences, short paragraphs)',
  phases: [{ title: 'Rewrite', detail: 'one agent per missing chunk' }],
}

const DIR = '/Users/luis/Code/hiraia/finetuning/datasets/rewrite_work'
const missing = ['tagalog_032','tagalog_040','tagalog_041','tagalog_042','tagalog_043','tagalog_044','tagalog_045','tagalog_046','tagalog_047','tagalog_048','tagalog_049','tagalog_050','tagalog_051','tagalog_052','tagalog_053','tagalog_054','tagalog_055','tagalog_056','tagalog_057','tagalog_058','tagalog_059','tagalog_060','tagalog_061','tagalog_062','tagalog_063','tagalog_064','tagalog_065','tagalog_066']

const PROMPT = (cid) => `Condense Tagalog science-tutor dialogues for "Hiraia", an AI tutor for Filipino KIDS (grades 3-10).

INPUT (absolute path): ${DIR}/in_${cid}.jsonl
OUTPUT (absolute path, MUST write here exactly): ${DIR}/out_${cid}.jsonl

JSONL; each line {"messages":[{role:system},{role:user},{role:assistant}]}. System prompt has "Grade N".

For EACH input line, rewrite ONLY the assistant message, write the full line (system+user unchanged) to OUTPUT. Same line count, same order.

REWRITE RULES (assistant answer):
- MAX 6 sentences. grade 3-4 => 3-4 sentences; 5-6 => 4-5; 7-10 => up to 6.
- SHORT PARAGRAPHS of 2-3 sentences each, separated by blank line (\\n\\n). Final follow-up question = its own last paragraph.
- Socratic: brief warm acknowledgement, clear core explanation, ONE open follow-up question (with "?").
- Simplified-correct for the age; drop lists/sub-sections/extra examples/formula dumps; keep ONE explanation + at most one relatable Filipino example.
- Natural Tagalog; science terms may stay English but explain simply; do NOT switch languages. **bold** 1-2 key terms max; NO headers, NO bullets.

MANDATORY: use python via Bash. Read ${DIR}/in_${cid}.jsonl, write ${DIR}/out_${cid}.jsonl with json.dumps(obj, ensure_ascii=False) one per line. THEN run: wc -l on both files and confirm equal. Do NOT cd; use the absolute paths above. If out line count != in, fix and rewrite before finishing.

Return ONLY: "out_${cid}.jsonl <inlines>/<outlines>".`

phase('Rewrite')
log(`re-running ${missing.length} missing chunks`)
const results = await parallel(
  missing.map((cid) => () =>
    agent(PROMPT(cid), { label: `rw:${cid}`, phase: 'Rewrite' })
      .then(() => ({ cid, ok: true }))
      .catch((e) => ({ cid, ok: false, msg: String(e) }))
  )
)
const failed = results.filter((r) => !r || !r.ok).map((r) => r && r.cid)
log(`rerun done: ${results.length - failed.length}/${missing.length} ok`)
return { ok: results.length - failed.length, failed, total: missing.length }
