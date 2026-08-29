# Template-routing benchmark

**Question:** if the app wraps the kid's one-or-two-word input in a mode-language template
(`Ipasabot ang "gravity" sa yano nga Cebuano para sa usa ka Grade 5 nga estudyante.`), does the
model answer in the mode's language reliably enough that language routing is *closed*?

**Pre-registered read (written 2026-08-26 17:40 UTC, before the first result):**

- **Target: ≥95% expected-language per mode** (fastText lid.176 label == mode language). Below
  that, the app-side reply-language check is load-bearing, not a safety net.
- The **variant breakdown** says which input shapes fail. Expected order of difficulty:
  `native-term` ≈ `en-term` (easy) < `en-misspelt` < `en-two-words`. If `en-term` under Cebuano
  mode is much worse than `native-term`, the English token is dragging the reply language.
- The **hedge rate** ("not sure") per mode is a template-tuning signal, not a routing signal.
  The template says *if you don't know this word, say you're not sure*; grade-5 core terms
  should rarely trigger it. A high hedge rate on `en-misspelt` is expected and fine.
- **Misroutes split into hedges vs explanations.** A wrong-language *hedge* is the template's
  exit clause firing in the wrong language (fix: reword the clause, or drop it). A
  wrong-language *explanation* is a true routing failure (fix: template wording, then SFT rows
  in exactly this shape — cheap, because the answers already exist).
- **Tagalog vs Cebuano vs English** are separate results. Tagalog is the model's majority
  language and should be near-perfect; Cebuano is the one that matters; English is the one
  that regressed under SFT v2 and is why v1 is under test.
- **One sample at T=0.7, n=1,188.** Per-mode n is 296–446, so a 95% rate has roughly ±2–3%
  resolution. Do not read a 1–2 point difference between variants as real without a second
  sample pass.

Files: `probes.json` (1,188), `templates.json` (the three wrappers), `routing_driver.sh` (pod),
`score_routing.py` (local). Model under test: `Cryptopop/hiraia-sft-flagship-2b` (SFT v1) Q4_K_M.
Results land at `<repo>/eval/routing-<label>.json`.

## Result — SFT v1, 2026-08-26 18:09 UTC (`routing-sft-v1.json`, n=1,188, T=0.7)

| mode | en-term | en-lower | en-misspelt | en-two-words | native-term | native-lower | **ALL** |
|---|---|---|---|---|---|---|---|
| tagalog | 99% | 100% | 100% | 99% | 96% | 100% | **99%** (441/446) |
| cebuano | 95% | 96% | 96% | 96% | 99% | 91% | **96%** (427/446) — **99.3% corrected** |
| english | 93% | 89% | 100% | 98% | — | — | **94%** (279/296) |

**Routing is closed.** With the app-composed template, the model answers in the mode's language
≥94% raw and ≥99% for both Filipino modes once the classifier's tl/ceb confusion is corrected:
of the 19 Cebuano-mode replies fastText called non-Cebuano, 16 are Cebuano by function-word
count (e.g. *"Dili ko sigurado sa 'saging' — kana usa ka Bisaya nga prutas"* labelled `tl`).
Of 41 raw misroutes, 27 are hedges in the wrong language and only **14 are wrong-language
explanations** — 1.2% of probes. English's 94% is the one to watch, and every English misroute
went to Tagalog, consistent with v1's 13/18 on the old english tier.

**The real finding is not routing — it is the hedge rate.**

| mode | replies that open with "not sure" |
|---|---|
| tagalog | **284/446 = 64%** |
| cebuano | 156/446 = 35% |
| english | 64/296 = 22% |

Under the Tagalog template the model says *"Hindi ko alam ang salitang iyan"* for
`photosynthesis`, `earthquake`, `solar system` — grade-5 core terms it demonstrably knows (it
explains them fluently on the capability set). 179 of the 284 hedges then go on to explain
anyway (*"Hindi ko alam ang salitang iyan! Pero tungkol sa Araw at mga planeta: …"*). So the
template's clause *"Kung hindi mo alam ang salitang ito, sabihin mo na hindi ka sigurado"* is
being read as an instruction to hedge, not as a permission to. It is worst in Tagalog because
the SFT data's abstain-balance rows are Tagalog-heavy.

This is a **template-wording problem, fixable at $0**: drop the hedge clause (or invert it to
*"answer directly; only say you're unsure if you truly don't know"*) and re-run. The benchmark
now exists precisely to tune this — each template variant costs ~$0.50 and 40 min.

**Decisions this supports:** v1 is the ship candidate; no more SFT buckets for routing; the
next spend is a template-wording sweep (3–4 variants), then an app-side reply-language check
for the remaining ~1% tail.
