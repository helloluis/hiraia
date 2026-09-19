# Card-body Tagalog question audit — final report

**Branch:** `card-language-audit` (worktree `/Users/luis/Code/hiraia-card-lang`), not merged, not pushed.
**Nothing was deployed.** `cards.db` was not rebuilt; no APK carries any of this.

Started from one card Luis saw on a device: `ffct-13212`, whose Tagalog lead read
**"Ilang pakpak ang langaw?"** — literally *"How many wings **is** the fly?"*

---

## 1. What was fixed (applied, committed `6354fdd2c`)

48 mechanical repairs to `rag/pipeline/cardsPool.app.json`:

| class | n | change |
|---|---:|---|
| T0-A double marker | 39 | `Ilang X ang mayroon ang Y?` → `Ilang X mayroon ang Y?`; `meron` → `mayroon` |
| T0-B `PAK` corruption | 9 | Cebuano titles: `Duha ka PAK sa Langaw` → `... Pako ...` (all 9 are wing cards; their English titles confirm it) |

The pool is re-serialised byte-identically to how it is stored, so this is a **1-line diff**
rather than 2,070,923 lines and +8 MB. Review through `proposals.jsonl`.

## 2. What is proposed, not applied

**16 confirmed counting-question defects** (`proposals-t1.md`), including the original card:

> `ffct-13212`  **Ilang pakpak ang langaw?** → **Ilan ang pakpak ng langaw?**

Judged by a 3-model panel (`gemini-3.5-flash-lite` + `ling-3.0-flash` + `gpt-5-nano`), unanimous.
**9 more are 2-1 splits** and are genuinely unresolved — see the reliability caveat below.
**7 were unanimously CORRECT** and must be left alone.

**23 `gawa ng` material-sense errors** (`enum-gawa-ng.json`) — `Ano ang gawa ng nana?` asks what
pus *makes*, not what it is made *of*. Correct frame is `gawa sa` / `Sa ano gawa ang X?`.
Found deterministically, no model needed. **11 of the 23 carry an `emphasis.tl` span.**

**Reported, untouched:** 19 cards whose `fact.en` holds the Tagalog question, and 422 duplicated
question leads (card ids are referenced by art, quizzes and lessons — dedupe is not mechanical).

---

## 3. The thing that will bite whoever does the fix pass

**17.3% of question leads (3,326 of 19,279) carry an `emphasis.tl` span inside the lead.**
Editing a lead without updating `emphasis.tl` in the same change **silently drops the card's
bolding**. In the `gawa ng` list alone that is 11 of 23 cards. Any fix tooling must treat the
lead and its emphasis span as one edit.

---

## 4. Measured defect rate for the wider corpus

19,279 of 49,156 cards (39.2%) open with a question line. A 300-item stratified sample was read
by four lenses (grammar, grade-5 register, faithfulness to the English source, MT artifacts),
with every claimed defect class then checked by a skeptic briefed to kill prescriptivism.

**46 classes proposed → 42 refuted.** The corpus is much cleaner than a naive pass would say.

| tier | definition | rate | 95% CI | projected |
|---|---|---:|---|---|
| A — hard | a teacher would fix without debate, provable from the card's own EN/answer/title | **3.7%** | 2.1–6.5% | ~710 |
| B — A + arbitrable | plus items needing a native speaker | **11.7%** | 8.5–15.8% | ~2,250 |

**88% of the sample would ship unchanged.**

---

## 5. Cost — the answer is not what we assumed

The question that started this was "which cheap model should we use". That was the wrong axis.

- A full 19,279 × 3-model pass: **$4–8**. (The 8-model × 59-item bake-off cost $0.02.)
- The same pass queues **~1,100 cards** for a Filipino teacher at unanimity.
- At 45 s/card that is **~14 hours** of arbitration, before any editing, before the
  `emphasis.tl` handling above.

**The budget line is teacher-hours, not tokens.** Everything worth optimising is on the human side.

---

## 6. Model selection — what the gold set bought

59 hand-labelled items, 20 BROKEN / 39 CORRECT, 7 licensing patterns (`gold.json`).

| model | acc | BROKEN prec | BROKEN recall |
|---|---:|---:|---:|
| inclusionai/ling-3.0-flash | .966 | .95 | .95 |
| deepseek-v4-flash-0731 | .949 | .905 | .95 |
| google/gemini-3.5-flash-lite | .949 | .905 | .95 |
| qwen/qwen3.7-flash | .949 | .905 | .95 |
| openai/gpt-5-nano | .932 | .90 | .90 |
| anthropic/claude-haiku-4.5 | .932 | **1.00** | .80 |
| mistralai/mistral-nemo | .695 | .625 | **.25** |
| amazon/nova-micro-v1 | .458 | .385 | **1.00** |
| **3-model majority vote** | **.983** | **1.00** | **.95** |

Three results worth keeping:

- **Cheap is fine; *which* cheap is everything.** `ling-3.0-flash` and `mistral-nemo` sit at
  nearly the same price. One scores .966, the other catches **one defect in four**.
- **`nova-micro`'s recall of 1.00 is degenerate.** It answers BROKEN to almost everything —
  20/20 on part-possession, **1/16** on governing-verb, 32 false positives. Read as a single
  number it looks like the best model in the table. This is why precision and recall are
  reported separately and never averaged.
- **The frontier model was not the ceiling.** `claude-haiku-4.5` is the most conservative judge
  (perfect precision, misses 4 of 20), and the cheapest model beats it on accuracy.

### Reliability caveat — the scores have a noise floor

Three T1 texts appear on more than one card, which accidentally probes self-consistency.
The panel failed it once:

```
"Ilang dulo ang may baterya?"
  ffct-22124 →  CORRECT, CORRECT, CORRECT
  ffct-23523 →  BROKEN,  BROKEN,  CORRECT
```

Byte-identical input, temperature 0, two of three models flipped. So some 2-1 splits are
sampling noise, not difficulty, and `.983` should be read as "very good", not as a precise
figure. It is also the row already hand-marked `borderline` — the models are least stable
exactly where the linguistics is least clear.

**All gold labels are mine and are NOT native-verified.** A Filipino teacher should settle the
`borderline` rows before these numbers gate anything.

---

## 7. Recommendation

1. **Free, do first.** Land the 23 `gawa ng` fixes and the two other deterministic enumerations
   (singleton non-words; within-card English self-contradiction — 1,490 leads use an English
   word their own title or terms already translate). No model required.
2. **~$5.** One narrow LLM pass for the single class that cannot be enumerated: the TL lead
   drops something the EN lead has and the answer does not restore it. No prefilter — the
   obvious one catches under half the known cases and costs more than it saves.
3. **Gate the human queue.** Review unanimous FLAGs only, hard-capped at 400 for the first
   batch. If precision on that batch is under ~0.7, stop.
4. **Spend the teacher-hours on ANSWERS, not leads.** This is the real finding. The
   highest-value defects hit during the sweep are not language defects:

   - `ffct-36052` — Vigan jars shaped by **alahero** (jewellers); should be *magpapalayok*
   - `ffct-21283` — inverts the change, "liquid batter into hard cake", backwards
   - `ffct-09227` — restates its premise instead of explaining
   - `dcard-04970` — asks which cleanser is the better **buy**, never mentions price

   Under the project's accuracy-above-fluency rule these outrank every language defect in this
   report. **An answer-quality sweep is the sweep worth funding.**

---

## 8. Files

| file | what |
|---|---|
| `proposals.jsonl` | every finding, machine-readable |
| `proposals-t1.md` | the 16 confirmed rewrites, 9 splits, 7 leave-alones |
| `enum-gawa-ng.json` | 23 material-sense `gawa ng` errors, 11 with emphasis spans |
| `gold.json` | 59-item counting-question gold set |
| `bakeoff-scores.json` | all 8 models, per-pattern |
| `TIER2-RUBRIC.md` | paste-ready judge prompt, 30-item gold set, prescriptivist traps |
| `PLAN.md` | stage-by-stage log of the overnight run |

## 9. Known gaps

- Gold labels not native-verified.
- The T1 regex generator has a known false negative (`ffct-00831`, a participle mistaken for a
  predicate), so 16 confirmed is a floor, not a census.
- The 9 split cards are unresolved; re-running them at n=3 for a stable majority costs cents.
- 422 duplicate leads and 19 Tagalog-in-English-field cards are reported but unfixed.
- One skeptic agent died on an AUP false positive (known classifier issue); 51 of 52 completed.
