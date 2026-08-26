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
