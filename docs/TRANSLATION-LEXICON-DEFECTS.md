# Translation lexicon defects — Cebuano and Tagalog

**Status:** open. These are generator defects, not one-off card errors. They will recur on the
next content build unless the translation step's lexicon is fixed.

Found by the Cebuano card-language audit (`tools/cebuano-language-audit/`, Sept 2026), which
repaired 621 fields across 618 cards. The repairs are downstream cleanup. This file is the
upstream problem.

---

## 1. Tagalog false friends written into Cebuano

The translation step reaches for a Tagalog word that is also a Cebuano word with a **different
meaning**. A child reading only the Cebuano gets a false fact, and the card never corrects it.

These are confirmed against the corpus's own Cebuano bodies and, where noted, against Wolff's
*Dictionary of Cebuano Visayan* and binisaya.com.

| written | actually means in Cebuano | was used for | correct word | scale |
|---|---|---|---|---|
| `langgam` | **bird** (680 bodies, uniformly) | ant | `hulmigas` | largest class in the audit |
| `lingkod` | to **sit** | vibrate | `mokurog` / `mag-uyog` | ran through the whole sound curriculum |
| `kulob` | **wrinkled**, face-down | boils | `mobukal` | 25 of 27 uses, the whole boiling curriculum |
| `bantol` | a **stonefish** (Wolff) | jellyfish | `dikya` | 25 titles |
| `landok` | **Ilocano** for iron — not Cebuano at all | iron / steel | `puthaw` / `bakal` | 12 titles |
| `kangi` | not a word in any dictionary | shiver, vibrate | `kurog` | 10 titles |
| `buto` | seed, to explode | bone | `bukog` | |
| `halas` | snake | lizard | `tiki` | |
| `bakaw` | mangrove | egret | `tagak` | |
| `tahong` | mussel | giant clam | `taklobo` | |
| `hilo` | poison | thread | `tanod` | |
| `gamot` | root | medicine | `tambal` | |
| `ungo` | witch | monkey | `unggoy` | |
| `bala` | bullet | law | `balaod` | |
| `aso` | smoke | ash | `abo` | |
| `ihi` | urine | feces | `tae` | on a parasitic-worm health card |
| `kalibutan` | world, Earth | universe | `uniberso` | asserted the Earth is 13.8bn years old |

**Words that look like false friends and are NOT.** Each of these was wrongly flagged during the
audit and had to be refuted against the corpus. Do not "fix" them:

`bakal` (iron/steel, 39/39 bodies — never "to buy") · `lana` (Spanish *lana* = wool, and the
corpus glosses it itself: "balhibo nga gitawag og **lana o wool**") · `bulok` (the rotten sense
is attested; the colour sense takes `bulokon`) · `bukal` (a hot spring really is `bukal`) ·
`dayami` (rice straw really is `dayami`; only a *drinking* straw is wrong) · `kagang` (the
corpus's own word for cricket) · `mopalta` (attested for light bouncing) · `gasolina` (the
standard rendering of "fuel") · `sanga` (attested for "stem") · `pako` (16 bodies pair it with
English "nail", beside 314 wing uses).

## 2. Titles drawn from a different vocabulary than bodies

138 Cebuano words head three or more card titles while appearing in **zero** of 47,056 Cebuano
bodies. Whatever generated the titles was not drawing on the lexicon that generated the bodies.

Triage found 63 of the 138 to be real defects — but **75 were not**, so this signal must never
be applied without review. `malaksi`, `lumoy`, `balhas` and `azul` are correct Cebuano the
bodies merely never use; `daku`/`dako` and `itum`/`itom` are spelling variants.

Detector: `tools/cebuano-language-audit/title_unattested.py`.

## 3. The 20-character title truncation (FIXED in the generator, Sept 2026)

`fw-gen-card-titles.py` and its two siblings counted an over-length title (`long_ += 1`) and
then shipped it anyway through a raw `title[:TITLE_MAX]` character slice. Only `title_en` was
ever measured; `title_tl` and `title_bis` were sliced unchecked.

Result: 128 titles cut mid-word at exactly 20 characters against 2–6 at every neighbouring
length — English 31, Tagalog 48, Cebuano 49. "Energy Without Oxyge", "Geckos Eat Mosquitoe".

Fixed by `_fit()`, which trims whole words and leaves a title intact rather than severing it.
All 105 detectable cuts have been restored in the pool.

**The cap itself was the defect.** `TITLE_MAX = 20` sits under a comment saying the index band
fits ~27 characters, and 36.5% of the pool's 147,468 titles are already longer than 20.
Consider raising it.

---

## How to check a suspected false friend

Do not trust an LLM's ear for Cebuano, including your own — the audit's word list was refuted
three separate times. Use the corpus:

```bash
python3 tools/cebuano-language-audit/ceb_usage.py --bis <word>   # what the corpus uses it FOR
python3 tools/cebuano-language-audit/ceb_usage.py --en <term>    # how bodies render a concept
```

Counts are over Cebuano **bodies** only, so a defective title cannot vouch for itself. Where the
corpus is ambiguous, a dictionary outranks it — this corpus is itself machine-translated and can
be wrong in bulk.
