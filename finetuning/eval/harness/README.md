# Behavioral gate (run BEFORE on-device / human testing)

A formal, automated check that the on-device tutor actually behaves correctly —
**run it green before building an APK or asking a human to test.** It exists
because manual/on-device spot-checks are unreliable: they're slow, and they were
fooled once by *stale persisted chat history* (an old confabulated answer that
looked like a fresh failure). This gate removes the guesswork.

## What it does

`run-harness.sh` boots a local `llama-server` with the **device's exact base GGUF**
(`deploy/models/Sailor2-3B-Chat.Q4_K_M.gguf`) + the **adapter GGUF** — the same
engine family and weights the phone runs — then `run-eval.mts` drives each case in
`cases.json` through the **real runtime prompt pipeline**:

```
RagStore.retrieveForGrounding(question)  ->  generateSystemPrompt(lang, grade, imageTags=true)
   +  formatGroundingBlock(hits)  ->  POST /v1/chat/completions (temp 0)  ->  assert
```

i.e. it tests retrieval + prompt assembly + adapter behavior together, exactly as
the app builds them — not the model in isolation.

## What it catches

- **Confabulation / adapter-not-applied** — grounded answers must contain the right
  concept and must NOT contain confabulation markers (e.g. dinosaur must say
  "reptil", must not say "Permian"). If the adapter silently isn't applied, these fail.
- **Retrieval regressions** — `expectRetrieves` asserts the right fact id is returned
  (model-independent; cheap).
- **Abstention** — out-of-bank questions must express uncertainty, not invent.
- **Over-abstention on COVERED topics** (`mustGround`) — the inverse failure: when the
  bank demonstrably HAS facts on a topic, the model must USE them, not punt to a
  teacher/book ("hindi ako sigurado… tanungin ang guro mo"). Codified after a kid asked
  "May homework po ako tungkol sa planet Venus" on-device and got deflected despite 39
  Venus facts in the bank. `mustGround:true` fails the case if the answer matches any
  `REFUSAL_MARKERS` (deflection phrasings in TL/BIS/EN). Pair it with `expectRetrieves`/
  `mustRetrieveIdIncludes` so you're asserting on a genuinely-covered topic.
- **Lecturing** — chit-chat must stay short (`maxChars`) and not dump a science topic.

### Device-temperature deflection (the temp-0 blind spot)

The gate runs at **temp 0** (deterministic, stable regressions). But the **device runs
at the model's default temp (~0.8** — `LocalEngine.chat` sets none), where the grounded
adapter can **stochastically** deflect on a vaguely-phrased-but-covered query that temp 0
answers fine. The Venus deflection was invisible at temp 0 and reproduced at temp 0.8
(1/5 samples; the photosynthesis variant 4/5). To probe it:

```bash
TEMP=0.8 SAMPLES=5 CASES=homework-grounds ./run-eval.mts   # focused, via env
```

A `mustGround` case then fails if **any** of the N samples deflects (the kid only has to
hit the bad branch once). `run-harness.sh` runs this automatically as an **informational**
pass after the temp-0 gate (`SKIP_GROUNDING_TEMP=1` to skip; `GROUND_TEMP`/`GROUND_SAMPLES`
to tune) — it measures the deflection rate release-over-release without blocking, since
the over-abstention is a known/`pending` behavior awaiting the next grounded adapter.

The companion **retrieval-side** failure (a vague "report/assignment about X" whose common
verb hijacks lexical retrieval away from the covered facts) lives in
`rag/pipeline/retrieval-stress.cases.json` as `verb-hijack` cases (model-independent).

## Run

```bash
finetuning/eval/harness/run-harness.sh           # uses the grounded adapter by default
ADAPTER=path/to/other.gguf ./run-harness.sh       # test a different adapter
BASE=... BIN=... PORT=... ./run-harness.sh         # override base / llama-server / port
```

Exit 0 + `ALL PASS` = green. Non-zero lists the failing case ids and why.

## Cases (`cases.json`)

Each case: `{ id, lang, grade, mode, question, expectRetrieves, mustContain[],
mustNotContain[], maxChars? }`. Regexes are case-insensitive.
`expectRetrieves`: a fact id that must be returned, `"none"` (must return nothing),
or `"any"` (don't assert on retrieval — use for greetings/abstain where Tagalog
function words legitimately match unrelated facts and the *behavior* is what matters).

Add a case whenever a new failure mode shows up (it's cheaper to encode it here than
to rediscover it on a phone).

## Process

1. Change adapter / prompt / RAG bank.
2. **Run this gate. Require green.**
3. Build the APK.
4. Then on-device / human testing.

Skipping step 2 is how we burned a build + a manual test on a misdiagnosis.
