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
