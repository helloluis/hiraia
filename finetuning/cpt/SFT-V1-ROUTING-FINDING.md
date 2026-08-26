# SFT v1 — Cebuano routing test (the synth-ceb decision)

**Question:** is the Cebuano→Tagalog leak seen in the CPT base a *knowledge* gap (fix: more
Cebuano corpus, i.e. the synth-ceb refresh) or a *routing* gap (fix: SFT data)?

**Answer: routing. The synth-ceb corpus is NOT the fix for this.**

Model: `Cryptopop/hiraia-sft-flagship-2b` as Q4_K_M via llama-server `/v1/chat/completions`,
greedy, `chat_template_kwargs.enable_thinking=false`, the app's real per-language system
prompt (`generateSystemPrompt('cebuano', 5, true)`).

| system prompt | user turn | reply | |
|---|---|---|---|
| Cebuano | `Unsa ang adlaw?` | Cebuano | ✓ |
| Cebuano | `Unsaon paghimo sa mga tanom sa ilang pagkaon?` | Cebuano | ✓ |
| Cebuano | `Ngano nga nag-ulan?` | Cebuano | ✓ |
| Cebuano | `Unsa ang buhat sa kasingkasing?` | Cebuano | ✓ |
| Cebuano | `Ang tubig` *(neutral)* | **Tagalog** | ✗ |
| Cebuano | `Ang hangin` *(neutral)* | **Tagalog** | ✗ |
| Cebuano | `Ang bato` *(neutral)* | **Tagalog** | ✗ |
| Cebuano | `Ang mga bituon` *(neutral)* | **Tagalog** | ✗ |
| Tagalog | all 4 controls | Tagalog | ✓ |

**4/4 on Cebuano-worded prompts, 0/4 on language-neutral prompts.** The model routes on the
*user's words*, not the system prompt. Its Cebuano is fluent (held-out ppl 4.45, better than
Tagalog's 4.57) — when it does answer in Cebuano the science is correct
(*"Ang adlaw mao ang Araw — ang dako nga bituon"*, *"nagbomba og dugo sa tibuok lawas"*).

**Why, from the SFT data itself:** of 2,670 Cebuano-system rows, **97% carry Cebuano words in
the user turn and only 29 (1%) are language-neutral.** The model learned "reply in the language
of the question"; it was never shown that the system instruction must win when the question
is ambiguous. More raw Cebuano corpus cannot teach that — it is an instruction-following
behaviour, and it is cheap to fix: a few hundred SFT rows pairing a Cebuano system prompt with
neutral user turns (shared-vocabulary prompts, bare nouns, English science terms).

**Decision:** keep synth-ceb banking (it is free until the Ox window closes) and hold it for a
future CPT refresh. Do not gate SFT v2 on it. SFT v2 = add the neutral-turn Cebuano bucket
and re-run this exact 12-probe test; target 8/8.

Also observed on the Tagalog side: `Bakit umuulan?` — which looped on the CPT base — now
answers normally. Greedy degeneration is gone after SFT.

## Prompt-only fix — tested, insufficient on its own

Can a stronger system prompt fix this without training? 8 neutral prompts, same model, greedy:

| system prompt | Cebuano replies |
|---|---|
| deployed `generateSystemPrompt('cebuano')` | **0/8** |
| deployed + explicit LANGUAGE LOCK clause (*"NEVER reply in Tagalog… if unsure, answer in Cebuano"*) | **3/8** |

The deployed prompt says only *"Reply in natural, conversational Cebuano Bisaya"* and never mentions
Tagalog; its one use of "Filipino" (*"tutor for Filipino students"*) is a demographic cue toward
Tagalog. The English prompt, by contrast, spells out *"never switch to Tagalog or Bisaya"*. The lock
clause helps but the model cannot reliably obey it — it was never trained on this situation. And
one of the 3 "successes" (`volcano`) was Cebuano text that asked a question back instead of
answering, i.e. the lock was fought at the cost of the task.

**Product context that sharpens this (Luis, 2026-08-26):** the user selects the language mode
up-front in the UI. In Cebuano mode Tagalog is simply not a permitted output — this is a hard
rule, not a detection problem. So SFT v2's bucket is a *suppression* bucket: Cebuano system prompt
+ any prompt that would tempt Tagalog (shared vocabulary, bare nouns, English science terms) →
Cebuano-or-English answer. Ship the lock clause alongside it; it is free and gets partway.

## SFT v2 — how to read it (written before the result, 2026-08-26 15:14 UTC)

v2 = v1 data + the 804-row suppression bucket (201 unique × 4). Launched on `gylmbsqms5ww27`,
1,392 steps. Result repo `Cryptopop/hiraia-sft-flagship-2b-v2`.

**Do not read v2's training loss as evidence of anything.** 804 of 7,415 rows are near-duplicate
definitional answers upweighted 4×; they are easy and repeated, so loss will land below v1's
0.996 regardless of whether routing improved. The only number that counts is the 12-probe
routing score from `finetuning/eval/pod-eval/launch.sh` — v1 scored 4/8 on Cebuano-mode prompts
(4/4 Cebuano-worded, 0/4 neutral). Target for v2: 8/8. A result of 5–7/8 means the bucket
works but is under-weighted or under-covered (13 of 30 topics had no definitional source row).

## SFT v2 result — 5/8 (worded 4/4, neutral 1/4). Partial, and diagnostic.

`Cryptopop/hiraia-sft-flagship-2b-v2`: 1,392/1,392 steps, loss 1.49→0.84, verified on HF.
Routing on the identical 12 probes, same prompt, same decoding:

| | worded | neutral | Cebuano-mode |
|---|---|---|---|
| v1 | 4/4 | 0/4 | 4/8 |
| **v2** | 4/4 | **1/4** | **5/8** |

Tagalog controls 4/4 on both. No regression on worded prompts.

**The interesting part is the shape of the three remaining leaks.** v1 answered them in fluent,
confident Tagalog. v2 does not:

| prompt | v2 reply |
|---|---|
| `Ang hangin` | *refuses* — "hindi ako makapagbigay ng sagot sa hangin" |
| `Ang bato` | *clarifies* — "ano ang gusto mong malaman tungkol sa bato?" |
| `Ang mga bituon` | **Cebuano**, but a question back — "Nakakita ka na ba og bituon?" |
| `Ang tubig` | Tagalog (unchanged) |

The model learned that a bare noun under a Cebuano prompt is a situation to be careful in — it
stopped confidently answering in the wrong language — but not that the resolution is "answer in
Cebuano." The bucket taught the *case* without winning the *response*. Two reasons, both fixable:

1. **Under-weighted.** 804 rows (10.7%) against 2,599 Cebuano-worded rows that all reinforce
   "the question's language decides."
2. **Under-covered.** 13 of 30 topics had no definitional source row — including `hangin` and
   `bato`, two of the three that still leak. `bituon` *was* covered, and it flipped.

**v3 plan:** cover all 30 topics (write Cebuano definitional answers for the 13 missing ones —
short, and the bucket's answers are already the model's own style), raise the upweight to ~8×
(~1,600 rows, ~18%), and add bare-noun rows whose *answer* is a direct Cebuano explanation, not a
clarifying question. Same 12-probe test; target 8/8. Cost ~$2.

**Standing verdict unchanged:** this is an SFT-data problem with a visible dose-response
(0/4 → 1/4 from one bucket). The synth-ceb corpus would not have moved this number.

### v2 full results — one regression that reframes v3

Deterministic scoring (`finetuning/eval/pod-eval/score_answers.py`) over all 183 answers:

| | v1 | v2 |
|---|---|---|
| routing, Cebuano-mode | 4/8 | **5/8** |
| gate chitchat | 5/6 | 5/6 |
| gate grounded, forbidden-term violations | 0/34 | 0/34 |
| gate abstain | 1/1 | **0/1** |
| bisaya tier, Cebuano replies | 13/14 | 13/14 |
| all Tagalog tiers, Tagalog replies | 100% | 100% |
| **english tier, English replies** | **13/18** | **6/18** |
| median answer length | ~470 | ~560 (+20%) |

**The English regression is the finding.** All 12 English-mode failures switched to **Tagalog**
(not Cebuano), on prompts like *"Why is the sky blue?"* and *"Can I mix bleach and toilet
cleaner?"* — v1 answered those in English. So the bucket's English-term rows are not the direct
cause (they taught English-word→Cebuano). Rather, 804 more Cebuano-answer rows shifted the
model's prior toward "reply in a Philippine language," and under the English system prompt that
resolved to the dominant one, Tagalog. v1 held English by a thin margin (13/18); v2 tipped it.

This is the *same class* of failure as the Cebuano leak: the mode-lock not winning over the
prompt's surface language. It was latent in v1 and the bucket exposed it.

**The abstain regression is a factual error**: *"the largest star is the Supernova"* — a
supernova is an explosion, not a star. v1 said it wasn't sure; v2 confabulated. One case, but
it is the exact failure the accuracy-over-fluency rule exists for. Possibly the same +20%
verbosity pressure — v2 answers more, including when it shouldn't.

**v3 is therefore not "more Cebuano." It is mode-lock buckets for every mode:**
- Cebuano-mode neutral bucket (as v2, coverage extended via authored answers for the 16 topics
  with no definitional source row — 2 of the 3 surviving leaks are among them)
- **English-mode bucket**: English system prompt + Filipino/Taglish-flavoured user turns →
  English answer. The deployed English prompt already says *"never switch to Tagalog or
  Bisaya"*; the data must show it.
- Re-check `abstain-correct` (7/10 refusals, was 8/10) and the gate abstain case; if v3 keeps
  answering the unanswerable, add abstain rows to counter the verbosity drift.

The synth-ceb verdict is unchanged and now stronger: both leaks are mode-routing behaviours,
learnable from a few hundred rows each, and neither is a corpus-knowledge problem.

## SUPERSEDED — the app composes the prompt (Luis, 2026-08-26 evening)

Everything above treats the kid's raw input as what the model sees. It isn't. The app already
rewrites the user turn (`composeGroundedUserTurn` injects retrieved facts there), and Luis's
point stands: if a kid in Cebuano mode types `gravity`, the app can send

    Ipasabot ang "gravity" sa yano nga Cebuano para sa usa ka Grade 5 nga estudyante.

The mode is a fact the app holds; the model never has to *infer* it from two words. That
dissolves the neutral-turn problem, the bucket, the 16 uncovered topics, and the authoring
question. It also means **v1, not v2, is the candidate to ship** — v2's only gain was on inputs
the app will never send, and it cost the English tier.

Product context: the UI will steer kids toward one- or two-word input via placeholder/examples.
So short, often-English input is the *contract*, and the template is what carries the mode.
The template lives in the USER turn (system prompt stays static for the QVAC KV cache — see the
comment on `composeGroundedUserTurn`).

**What still has to be true, and is now being measured:** the model must follow a
native-language instruction template reliably, with an embedded term that may be English,
misspelled, lowercase, or two words. `finetuning/eval/routing/` is that benchmark: 82 grade-5
terms × 3 modes × input variants = 1,188 probes, sampled at T=0.7, replies labelled with
fastText lid.176 (not a regex). First run is on SFT v1. Target ≥95% expected-language per mode.
If it clears, the routing question is closed and the remaining work is answer quality, plus an
app-side reply-language check for the tail.

The 8-probe greedy regex test above was too small, greedy-only, and regex-scored; its numbers
(4/8, 5/8) should not be cited.
