export const meta = {
  name: 'shorten-dialogues',
  description: 'Rewrite all Bisaya+Tagalog science dialogues to <=6 sentences, short 2-3 sentence paragraphs, keeping Socratic structure',
  phases: [{ title: 'Rewrite', detail: 'one agent per ~30-dialogue chunk, reads/writes files' }],
}

const DIR = '/Users/luis/Code/hiraia/finetuning/datasets/rewrite_work'

// deterministic chunk ids: bisaya_000..067 (68), tagalog_000..066 (67)
const chunks = []
for (let i = 0; i < 68; i++) chunks.push({ cid: `bisaya_${String(i).padStart(3,'0')}`, lang: 'bisaya' })
for (let i = 0; i < 67; i++) chunks.push({ cid: `tagalog_${String(i).padStart(3,'0')}`, lang: 'tagalog' })

const PROMPT = (c) => `You are condensing science-tutor dialogues for "Hiraia", a Filipino AI tutor for KIDS (grades 3-10). Language: ${c.lang === 'bisaya' ? 'Cebuano/Bisaya' : 'Tagalog'}.

Read input file: ${DIR}/in_${c.cid}.jsonl
JSONL; each line {"messages":[{role:system},{role:user},{role:assistant}]}. System prompt contains "Grade N".

For EACH line, REWRITE ONLY the assistant message, then write the full line (system+user unchanged, assistant rewritten) to: ${DIR}/out_${c.cid}.jsonl (same line count, same order).

REWRITE RULES for the assistant answer:
- MAX 6 sentences. SHORTER for younger grades: grade 3-4 => 3-4 sentences; grade 5-6 => 4-5; grade 7-10 => up to 6.
- Break into SHORT PARAGRAPHS of 2-3 sentences each, separated by a blank line (\\n\\n), for phone readability. The final follow-up question is its own last paragraph.
- KEEP Socratic structure: brief warm acknowledgement, then clear core explanation, then ONE open follow-up question (with "?").
- Scientifically correct but simplified for the age. Drop exhaustive lists/sub-sections/multiple examples/formula-dumps. Keep ONE clear explanation + at most one relatable Filipino/Visayan example.
- Natural conversational ${c.lang === 'bisaya' ? 'Cebuano' : 'Tagalog'}. Science terms may stay in English (e.g. "photosynthesis","density") but explain simply. Do NOT switch languages. Follow-up question stays in ${c.lang === 'bisaya' ? 'Cebuano' : 'Tagalog'}.
- **bold** for 1-2 key terms max (optional). NO markdown headers, NO bullet lists.

Use python: json.loads each line, replace messages[2]["content"], json.dumps(obj, ensure_ascii=False) one per line. Verify out line count == in line count.

Return ONLY: "out_${c.cid}.jsonl <lines>".`

phase('Rewrite')
log(`rewriting ${chunks.length} chunks`)
const results = await parallel(
  chunks.map((c) => () =>
    agent(PROMPT(c), { label: `rw:${c.cid}`, phase: 'Rewrite' })
      .then((r) => ({ cid: c.cid, ok: true }))
      .catch((e) => ({ cid: c.cid, ok: false, msg: String(e) }))
  )
)
const ok = results.filter((r) => r && r.ok)
const failed = results.filter((r) => !r || !r.ok)
log(`done: ${ok.length} ok, ${failed.length} failed`)
return { ok: ok.length, failed: failed.map((f) => f && f.cid), total: chunks.length }
