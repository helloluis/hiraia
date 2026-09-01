# Card gate (run BEFORE on-device / human testing)

A formal, automated check that the on-device **card writer** behaves — **run it green before
building an APK or asking a human to test.** It exists because on-device spot-checks are slow
and unreliable; they were fooled once by stale persisted history that looked like a fresh
failure.

**ZERO TOLERANCE.** There is no `pending` flag any more. A case is blocking or it is deleted.
The first run against a new model is expected to be RED — that is what having a gate is for.

## What it gates

The model is no longer a conversational tutor. It is a **single-turn card writer**: given a
child's typed topic plus retrieved grounding it prints ONE card-shaped fact, in their language,
at their grade, and stops. So the gate runs the CARD PATH, not a conversation:

```
route (model-free):  hybrid retrieve (context-free, topK 4)  ->  isOffDomain(topCos, lexUnreachable)
                       ->  grounded | in-domain gap | off-domain
print (grounded):    buildCardPrompt(@hiraia/shared)  ->  POST /v1/chat/completions
                       (temp CARD_TEMP 0.3, stop ['\n\n'], chat_template_kwargs enable_thinking:false)
                       ->  sanitizeCardAnswer  ->  assert
```

That is the same routing `LocalEngine.answerQuery` (phone) and `retrieveForCard` +
`/api/demo/card` (web) make, on the same shared floors and the same shared prompt.

## What it catches

- **Generation health** — live bugs nothing in the old gate could see. The model is a THINKING
  model: without `chat_template_kwargs: {enable_thinking: false}` it returns an empty `content`
  with the answer stranded in `reasoning_content`, and every card silently reads as a failure.
  And without a stop sequence it writes the correct card, then degenerates into repeated
  `**Pansin:** … **Paliwanag:** …` until the token cap. The gate asserts non-empty `content` and
  `finish_reason == 'stop'`, so if either fix is ever dropped it says so. It also asserts on the
  RAW `content`, before `sanitizeCardAnswer`, that no reasoning tag (`</think>`) and no
  `[image:]` control token was emitted — the product sanitizer strips both now, and a sanitizer
  that quietly absorbs a regression is a gate that goes green on a model that got worse.
- **Groundedness** — a grounded card must share at least two content words with what was
  retrieved. `mustNotContain` lists only catch the wordings someone thought to forbid: the
  `nba finals` card "Ang finals ay ang pinakahuling laban ng isang serye ng paligsahan" dodged
  all seven and PASSED, while being invented wholesale from parametric memory. One case opts
  out (`allowUngrounded`, `tier2-affirm-flat-earth`) because its `mustContain` demands the
  opposite: retrieval cannot supply a round-earth fact for "patag", and telling a child the
  Earth might be flat because the retriever missed is worse than an ungrounded card. That flag
  is not a tolerance — every use must carry a `_why_allowUngrounded` note.

### Which request shape a run proves

Both card knobs — the stop sequence and the thinking-disable — are shared constants
(`CARD_STOP`, `CARD_REASONING_BUDGET` in `@hiraia/shared` prompts/cards.ts), so the gate, the
web route and the phone cannot disagree about their VALUES. They still travel by different
transports: this gate speaks llama-server HTTP (`stop` + `chat_template_kwargs`), which is what
hiraia.org sends; the phone reaches the same two decisions through QVAC's load-time
`stop_sequences` and per-request `reasoning_budget`. The run prints which shape it exercised. A
green gate is not by itself proof of the device path — an on-device smoke test still is.
- **Card shape** — nothing enforced it before. Every printed card must be within the prompt's
  own 30 words and the sanitizer's 320 chars, with no greeting, no preamble or echoed prompt
  cue, no question mark, no invitation to keep talking, no deflection, no markdown scaffolding
  (bold, code fences, bullets, headings — `RichText` went with the chat surface, so a card is
  rendered in a plain `<Text>` and every asterisk prints literally) or repeated sentence, no
  `[image:]` tag and no emoji (the deck has a fixed palette and Android colours emoji). Single
  source of truth: `../cardshape.mts`.
- **The three outcomes** — that `roblox` yields NO card, and that a real-but-uncovered or
  merely misspelled science word (`batirya`, `pterodactyl`, `photosinthesis`) yields the honest
  GAP card rather than "I'm only a science tutor". Getting that backwards on a child's real
  question is the worst failure in the product. Two of the three shapes are model-free — that
  is exactly why they cannot hallucinate — so those cases assert routing and stop.
- **Thin grounding** — the actual invention trigger. Queries whose facts CLEAR the retrieval
  floor without answering them: `nba finals` scores .630 and arrives with four shark facts. The
  prompt's only permitted escape is "print the nearest FACT whole — do not force the
  connection", and forcing it is the failure — asserted both ways now, `mustNotContain` on the
  forced connection and `mustContain` on a subject that was actually retrieved. (Chitchat like
  "ano po paborito ninyong pagkain?" is NOT in this tier: it measures 0.467 and retrieves
  nothing, so it is a routing case for the model-free gap card.)
- **Language purity in all three directions** — Cebuano leaking into a Tagalog card is exactly
  as much a defect as Filipino leaking into an English one. The bank fills `bis` on all 50,279
  rows and Cebuano is a first-class card language, so it carries real coverage here (9 of 45
  cases), not the 3-of-42 token presence it used to.
- **Grade register** — grade is a user-visible setting spliced straight into the prompt and
  nothing asserted it changed anything. `gradePairWith` prints the same query at two grades and
  requires both to be valid cards, to DIFFER (an inert grade is a silently broken setting), and
  not to invert (the Grade-3 card is not the longer-worded one).
- **Confabulation / retrieval regressions** — as before: `mustContain` / `mustNotContain` on
  the printed card, `expectRetrieves` / `mustRetrieveIdIncludes` on the retrieved ids.

### Temperature

The gate runs at the temperature the **product** runs at (`CARD_TEMP` = 0.3), not at 0. A
temp-0 gate is blind to exactly the stochastic branch a child hits. Every case is drawn
`SAMPLES` times (default 3) and must pass on **every** draw; the summary also reports how many
cases printed a different card across draws, which is the number to watch release over release.

## Run

```bash
finetuning/eval/harness/run-harness.sh              # the shipping GGUF, no adapter
MODEL=path/to/candidate.gguf ./run-harness.sh       # A/B a candidate
ADAPTER=path/to/adapter.gguf ./run-harness.sh       # only if the candidate HAS one
SAMPLES=5 ./run-harness.sh                          # more draws per case
CASES=route,thin ./run-eval.mts                     # focused, against servers already up
```

The default model is `deploy/models/hiraia-sft-2b-Q4_K_M.gguf` — the CPT'd + SFT'd Qwen3.5-2B
that hiraia.org serves. It is a **full-parameter SFT with no adapter**, so `--lora` is only
passed when `ADAPTER` is set. `deploy/models` is gitignored, so from a linked worktree the
harness also looks in the primary checkout.

The embedder is REQUIRED and there is no lexical fallback: the card path ROUTES on LaBSE
cosines, so without one every query looks off-domain and the verdict would be about the missing
embedder rather than the model. `EMBED_BACKEND` picks between the Q4_K_M GGUF (default — the
quant the phone downloads and the substrate the off-domain floors were calibrated on) and the
transformers raw-CLS service (the method that built the corpus blob). Whichever ran is printed
with the verdict, because the verdict depends on it. `embed-serve.sh` boots one standalone for
fixture work.

Exit 0 + `ALL PASS` = green. Non-zero lists the failing case ids and why.

## Cases (`cases.json`)

```
{ id, tier, lang, grade, query,
  expectOutcome?   grounded (default) | gap | offdomain
  expectRetrieves?, mustRetrieveIdIncludes?[],
  mustContain?[], mustNotContain?[],      // case-insensitive regexes, on the PRINTED card
  maxWords?, gradePairWith?, samples?, skipGeneration? }
```

The universal card-shape invariants are applied to every printed card automatically, so a new
case cannot forget them — it only has to say what is TRUE about its own answer. Add a case
whenever a new failure mode shows up; it is cheaper to encode here than to rediscover on a phone.

## Process

1. Change model / prompt / RAG bank.
2. **Run this gate. Require green.**
3. Build the APK.
4. Then on-device / human testing.

Skipping step 2 is how we burned a build + a manual test on a misdiagnosis.
