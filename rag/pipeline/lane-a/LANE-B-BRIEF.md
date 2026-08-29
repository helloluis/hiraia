# Lane B — writing brief for an outside model (Grok / Kimi): junior-high laggards

**What this is.** Hiraia is an offline science tutor for Filipino grade-school kids (DepEd MATATAG curriculum, Grades 3–10).
Its home screen is a feed of one-fact cards. After re-tagging every card with the competency it serves, **16 junior-high (Grade 7–10)
competencies are still short of illustrated cards** after everything else we have is counted. Your job: write new, correct,
grade-appropriate science facts for exactly those 16 competencies, as a **staged candidates file**. Our pipeline then dedups, verifies with a second
model, translates, mints ids, illustrates and ships them. You do none of that.

**Deliverable:** new files only, under `rag/pipeline/lane-b/out/` — nothing else in the repository changes.

---

## 0. Merge-safety rules (read twice — these are the ones that break things)

1. **Work in your own clone or git worktree**, never in `/Users/luis/Code/hiraia` itself. Another agent is editing that working
   tree right now (feed weighting, mobile app, tag files). If you must be in the same repo, run
   `git worktree add ../hiraia-lane-b -b lane-b-facts question-cards` and work there.
2. **Create files only under `rag/pipeline/lane-b/out/`.** Do not modify, regenerate, reformat or "fix" any existing file.
   In particular never touch: `rag/bank/science-facts.jsonl`, `rag/bank/factoids.jsonl`, `rag/bank/curriculum-tags*.json`,
   `rag/bank/competency-*.json`, anything under `packages/mobile/`, `packages/shared/`, `packages/images/`, or any
   `*.generated.*` file.
3. **Do not run any pipeline script.** Specifically not `assemble-factoids.py`, `assemble-newfacts.py`, `ingest-*.py`,
   `gen-cards-pool.py`, `build-vectors.py`, `export-facts-ts.py`, `tag-curriculum.py`, `fw-*.py`, `gen-*.mjs`. Several of
   them rewrite shared files wholesale and re-mint card ids by position — running one would silently corrupt ids that
   images, tags and the on-device seen-store are keyed by.
4. **Do not mint ids.** Use temporary ids of the form `lane-b-<CODE>-<nnn>` (e.g. `lane-b-G6-E-3-001`) inside your own
   file. Final ids are assigned by our ingest.
5. **Do not commit to `question-cards` or `main`.** If you commit at all, commit only `rag/pipeline/lane-b/out/*` on the
   branch `lane-b-facts`. Do not open a pull request that touches anything else. Do not rebase or merge other branches.
6. **Do not install, upgrade or run package managers** (`pnpm install`, `npm install`, `pip install`) in the repo.
7. Put the facts for `G10-L-8` (reproduction / human-body competencies) in **their own file** `out/lane-b-body.jsonl`
   (same format) — our side routes that file to a specific verifier without opening it in some contexts.

If any instruction here seems to require breaking one of these rules, stop and write the question into `out/REPORT.md`
instead.

## 1. Inputs (all read-only)

- `rag/pipeline/lane-a/briefs-lane-b.json` — the 16 briefs: competency code and text, the quarter's content standard, kind /
  card_form, how many cards exist (`have`), the floor, `need`, your **`target`** (need × oversample), and
  `existing_facts_en` = the English text of every feed card already serving that competency. **Do not restate any of
  those facts.** Our dedup drops anything within cosine 0.86 of an existing fact, so paraphrases are wasted work.
- `rag/pipeline/GENERATION-BRIEF.md` — the bank's authoring spec (schema, tone, term rules). Read it once.
- `rag/sources/curriculum-guides/FINAL-MATATAG-Science-CG-2023-Grades-3-10.pdf` — the curriculum, if you need the
  surrounding context of a competency (the JSON extraction of Grades 7–10 is `matatag-jhs-competencies.json` beside it).

## 2. The 16 competencies and targets

| code | cell | kind / card form | have / floor | **write** | competency |
|---|---|---|---|---|---|
| `G7-E-1` | G7 Q4 EARTH_SPACE | content / fact | 38 / 40 | **4** | classify geological faults according to the angle of the fault plane and direction of slip |
| `G8-L-7` | G8 Q1 LIVING_THINGS | content / fact | 15 / 40 | **40** | explain why humans are classified under Class Mammalia and the Order Primates |
| `G8-E-1` | G8 Q3 EARTH_SPACE | content / fact | 38 / 40 | **4** | identify what proportion of the Earth's surface is covered with water as opposed to land |
| `G8-E-10` | G8 Q3 EARTH_SPACE | content / fact | 7 / 30 | **69** | gather information from the Department of Science and Technology (DOST) and other reliable websites to identif |
| `G8-E-12` | G8 Q3 EARTH_SPACE | content / fact | 10 / 30 | **60** | draw on information from secondary sources to identify situations where tidal difference could be exploited to |
| `G8-F-8` | G8 Q4 FORCE_MOTION_ENERGY | content / fact | 29 / 30 | **3** | explain that the mechanical energy of an object is the sum of the kinetic energy and the potential energy avai |
| `G9-E-10` | G9 Q2 EARTH_SPACE | content / fact | 23 / 40 | **28** | gather information from secondary sources to discuss the regular occurrence of meteor showers |
| `G9-L-4` | G9 Q3 LIVING_THINGS | content / fact | 16 / 40 | **39** | use information from secondary sources to explain the beneficial, harmful, and neutral effects of mutations |
| `G9-M-4` | G9 Q4 MATTER | content / fact | 0 / 30 | **90** | identify the number of valence electrons of oxygen based on its position in the periodic table |
| `G10-E-1` | G10 Q1 EARTH_SPACE | content / fact | 29 / 40 | **18** | identify modern scientific processes used to detect and measure the displacement of tectonic plates |
| `G10-E-4` | G10 Q1 EARTH_SPACE | mixed / method | 8 / 20 | **36** | predict the position and shape of the Philippine Archipelago in 50 million years, based on the current velocit |
| `G10-F-3` | G10 Q2 FORCE_MOTION_ENERGY | mixed / method | 12 / 20 | **24** | use models to investigate elastic or inelastic collisions and describe the forces involved and their effects |
| `G10-F-6` | G10 Q2 FORCE_MOTION_ENERGY | content / fact | 28 / 30 | **6** | identify and explain that to change the momentum of an object, it is necessary to apply a force on the object  |
| `G10-F-7` | G10 Q2 FORCE_MOTION_ENERGY | content / fact | 27 / 40 | **21** | gather information from secondary sources to identify ways to reduce the impact of collisions such as seatbelt |
| `G10-M-5` | G10 Q3 MATTER | mixed / method | 16 / 20 | **12** | recognize that scientists: a. use chemical equations to describe chemical reactions, and b. write equations in |
| `G10-L-8` | G10 Q4 LIVING_THINGS | content / fact | 36 / 40 | **7** | use information from secondary sources to identify examples of modern biotechnology, such as genetically modif |

`target` already includes oversampling (3× where the competency is only partly fact-shaped, 1.6× otherwise) because
dedup and verification will reject some. Write exactly `target` candidates per code; do not pad other codes.

## 3. What a good fact is

- **One idea, one sentence in English**, 15–35 words, that a student of the competency’s grade (kids here are behind academically —
  aim a year younger than the label) can read once and understand. Concrete, everyday, Philippine-flavoured where natural
  (bundok, dagat, PAGASA, PHIVOLCS, Mayon, Taal, kalabaw, mangga, bayong…), but **facts about the world, not about the
  Philippines only**.
- **Consensus science only.** Encyclopedia-stable, textbook-level. Never invent a number, a name, a date or a mechanism.
  If a claim needs a specific figure, use only widely published rounded values (e.g. "about 100°C", "about 8 minutes")
  and say "about". If you are not sure a fact is true, do not write it — a dropped fact costs nothing, a wrong fact
  reaches a child. No myths, no folk claims, no "some say".
- **It must serve the competency in the table**, not merely mention its nouns. `G6-E-3` is about *patterns* of volcanic
  eruptions in the Philippines over time — a fact about what lava is does not serve it. For `kind: mixed` competencies
  (`card_form: did-you-know about a method` / `activity prompt`), write facts about *how scientists or people do the
  thing* ("To find out how much rain fell, people catch it in a straight-sided container and measure the depth.").
- **Not already in `existing_facts_en`** for that code, and not a duplicate of your own other candidates.
- **Safe and kind.** Nothing frightening, nothing that instructs a dangerous experiment, no medical advice. For
  `G5-L-3` use plain clinical vocabulary (ovary, uterus, egg cell), DepEd Grade-5 level, no more detail than the
  competency asks.
- Tagalog and Bisaya versions are **optional**: if you write them, one natural sentence each, everyday vocabulary
  (bundok not mountain; dugo, buto, isda; Cebuano ug/kini/dili, not at/ito/hindi), keep English science terms Filipino
  kids actually use (magnet, thermometer, energy, gravity). We re-translate and verify anyway, so accuracy in English is
  what matters.

Three rows from the existing bank, for register and shape (yours omit `id` and add `brief_code` / `tmp_id`):

```json
{"id": "erosion-rock-g5", "domain": "EARTH_SPACE", "topic": "erosion", "grades": [4, 5, 6], "terms": ["erosion", "erosyon", "natatangay", "nadadala", "naanod", "nadala", "pagguho", "ilog", "tubig", "hangin", "yelo", "river", "carry away", "lupa"], "fact": {"tl": "Ang erosion ay ang pagdadala ng mga durog na bato at lupa palayo ng tubig, hangin, o yelo patungo sa ibang lugar.", "en": "Erosion is the carrying away of broken rock and soil by water, wind, or ice to another place.", "bis": "Ang erosion mao ang pagdala sa nadugmok nga bato ug yuta palayo pinaagi sa tubig, hangin, o yelo ngadto sa laing lugar."}, "source": "AAAS BSL 4C/M2b"}
```
```json
{"id": "bigger-object-more-heat-g6", "domain": "FORCE_MOTION_ENERGY", "topic": "size and amount of heat", "grades": [6, 7, 8], "terms": ["mas malaki", "mas maraming init", "parehong temperatura", "dami ng init", "dako", "mas daghang init", "parehas nga temperatura", "bigger", "more heat", "same temperature", "amount of heat", "cup vs pot"], "fact": {"tl": "Ang isang malaking palayok ng maligamgam na tubig ay maaaring may mas maraming init kaysa sa isang maliit na tasa ng mainit na tubig, kahit mas mataas ang temperatura ng tasa.", "en": "A big pot of warm water can hold more total heat than a small cup of hot water, even though the cup has the higher temperature.", "bis": "Ang dakong kaldero sa init-init nga tubig mahimong adunay mas daghang init kaysa gamay nga tasa sa init nga tubig, bisan pa ug mas taas ang temperatura sa tasa."}, "source": "AAAS Benchmarks 4E/M4; encyclopedia-stable consensus"}
```
```json
{"id": "sand-silt-clay-g6", "domain": "EARTH_SPACE", "topic": "soil types by particle size", "grades": [6, 7], "terms": ["buhangin", "sand", "silt", "luwad", "clay", "laki ng butil", "uri ng lupa", "balas", "yutang kulonon", "gidak-on sa partikulo", "klase sa yuta", "particle size", "loam"], "fact": {"tl": "Ang uri ng lupa ay nakabatay sa laki ng butil nito: ang buhangin ay malalaki at magaspang, ang silt ay mas pino, at ang luwad (clay) ay pinakamaliit at malagkit.", "en": "Soil types depend on particle size: sand has large, gritty grains, silt is finer, and clay has the tiniest, stickiest particles.", "bis": "Ang klase sa yuta nag-agad sa gidak-on sa partikulo niini: ang balas dako ug magaspang, ang silt mas pino, ug ang yutang kulonon (clay) mao ang pinakagamay ug pinaka-pilit."}, "source": "encyclopedia-stable consensus (soil texture classes)"}
```

## 4. Output format

One JSON object per line (JSONL), UTF-8, in `rag/pipeline/lane-b/out/lane-b-candidates.jsonl` — except the body/reproduction codes listed in §0 rule 7, which go only to `rag/pipeline/lane-b/out/lane-b-body.jsonl` with the identical format.

```json
{"tmp_id": "lane-b-G6-E-3-001", "brief_code": "G6-E-3", "domain": "EARTH_SPACE", "topic": "Mayon eruption pattern",
 "grades": [6], "en": "Mayon Volcano has erupted about 50 times since 1616, which is why PHIVOLCS watches it all year round.",
 "tl": "", "bis": "", "terms": ["Mayon", "eruption", "pattern", "PHIVOLCS", "bulkan", "pagsabog", "bulkan nga nagbuto"],
 "source": "PHIVOLCS; encyclopedia-stable", "card_form": "fact", "confidence": 3}
```

Field rules: `brief_code` = the code from the table; `domain` = the cell's domain string exactly (`MATTER`,
`LIVING_THINGS`, `FORCE_MOTION_ENERGY`, `EARTH_SPACE`); `topic` = 2–5 English words; `grades` = the competency's grade
(add a neighbour grade only if the fact genuinely suits it); `terms` = ≥6 search words a kid might type, mixing English
with Tagalog and Bisaya where you can (inflections welcome); `source` = a short provenance line (standard, agency,
encyclopedia topic); `card_form` = `fact` or `method`; `confidence` = 3 (certain, textbook), 2 (confident), 1 (drop it
instead of writing 1).

Also write `rag/pipeline/lane-b/out/REPORT.md`: candidates per code vs target, anything you could not write and why,
and any competency you believe is mis-stated in the table. Keep it under a page.

## 5. Acceptance on our side (so you know what happens next)

dedup at cosine 0.86 against the 49,556-fact bank → decorrelated verification by a different model (drops `suspect` /
`wrong`) → translation → competency tag written from `brief_code` → feed rewrite → illustration → a judged sample.
Historically ~34% of candidates are novel and ~77% of those verify; that is why `target` is oversampled. You are not
expected to reach the floor alone — you are expected to be *correct*.
