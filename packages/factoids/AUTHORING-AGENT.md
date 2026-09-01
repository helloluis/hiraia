# Factoid Authoring — Agent Brief

You are expanding Hiraia's **factoid bank**: short "Alam mo ba na…?" science nuggets
shown to Filipino grade-school kids. Each one appears (a) as a daily push message and
(b) dropped into the chat on app launch to give the child something to read while the
on-device AI warms up. **Your prose is the final product** — at the moment a factoid is
shown, the AI model isn't even loaded, so nothing rewrites what you write. Make it
correct, warm, and genuinely interesting.

Your job: **write new factoids and append them to the bank.** Do not run any builds or
deploys. Just edit the JSON.

---

## 1. The one rule about language

**Write every factoid in Tagalog OR Bisaya (Cebuano) — never English-first.** These are
for Filipino children; the local language is the point.

- Tagalog prose → put it in the `tl` field.
- Bisaya prose → put it in the `ceb` field.
- `en` is **optional**. You may add a faithful English translation to help future
  reviewers, but it must never be the primary/only language.

Aim for roughly a **70/30 split: ~70% Tagalog, ~30% Bisaya**, unless told otherwise.

Voice: simple, friendly, concrete. Imagine explaining to a curious 9-year-old. Short
sentences. Avoid jargon; if you must use a science word, define it in plain words right
after. No English loanwords where a natural Tagalog/Bisaya word exists.

---

## 2. Where to write & the exact schema

Append to the `factoids` array in:

```
packages/factoids/bank/factoids.json
```

The file is `{ version, builtAt, count, factoids: [...] }`. After appending, **update
`count`** to equal `factoids.length` and set `builtAt` to the current ISO timestamp.
**Never edit or delete existing entries** — only add.

Each new entry has this exact shape (this is the contract — match it precisely):

```json
{
  "id": "topic-slug--specific-fact",
  "imageId": "",
  "subject": "physics",
  "hook": {
    "tl": "ang kidlat ay mas mainit pa kaysa sa ibabaw ng araw",
    "en": "lightning is hotter than the surface of the sun"
  },
  "body": {
    "tl": "Umaabot ang init ng kidlat sa halos 30,000°C — limang beses na mas mainit kaysa sa ibabaw ng araw! Kaya natin itong naririnig bilang kulog dahil mabilis itong nagpapainit at nagpapalawak ng hangin sa paligid.",
    "en": "Lightning reaches almost 30,000°C — five times hotter than the sun's surface! We hear it as thunder because it heats and expands the surrounding air so fast."
  },
  "grades": [4, 5, 6],
  "tags": ["weather", "electricity"],
  "source": "Lightning channel ~30,000 K, ~5× the Sun's ~5,800 K photosphere; thunder = rapid thermal expansion of air.",
  "verified": false,
  "verifiedBy": null,
  "verifiedAt": null
}
```

Field notes:

- **`id`** — unique, kebab-case, pattern `topic-slug--specific-fact` (double dash).
  Include the Filipino name where natural, like the existing ones
  (`bee-bubuyog--queen-eggs`, `volcano-erupting--ring-of-fire`). Must not collide with any
  existing id (full list at the bottom of this file).
- **`hook`** — the clause that goes AFTER "Alam mo ba na " and BEFORE the "?". So it reads
  *"Alam mo ba na **{hook}**?"* No leading "Alam mo ba na", no trailing "?". Keep it to one
  punchy clause.
- **`body`** — 1–3 sentences of follow-up explanation. **Keep the whole message near ~50
  words** (hook + body combined). The composer adds the lead-in
  ("Alam mo ba na…" / "Nahibaw-an ba nimo nga…") automatically — don't write it yourself.
- **`subject`** — exactly one of: `biology`, `chemistry`, `physics`, `earth-science`,
  `general`.
- **`grades`** — DepEd grade bands it suits, from `3`–`10`. Most should target `3`–`6`
  (elementary). Use `[]` for "all ages".
- **`tags`** — a few lowercase keywords for filtering.
- **`source`** — a short note stating the factual claim and a reference/justification. This
  is what a reviewer fact-checks. Be specific (numbers, mechanism), not vague.
- **`verified`** — always `false` for your new entries. You did NOT verify them; a human or
  the `verify` pass promotes them later. Leave `verifiedBy` and `verifiedAt` as `null`.

> **Accuracy bar:** even though `verified:false`, write only things you are confident are
> textbook-correct. No invented statistics, no "fun facts" that are actually myths
> (no "lightning never strikes twice", no "we use 10% of our brain"). If you're unsure of a
> number, state the claim more generally in `source` rather than fabricating precision.

---

## 3. Accompanying images — for about 1 in 3 factoids

Hiraia has a library of **414 illustrations** indexed in:

```
packages/images/index.json     →  { version, builtAt, count, assets: [...] }
```

Each asset entry looks like:
`{ id, subject, name, caption:{en,tl,bis}, parts, tags, grades, curriculum, searchText, viewBox }`

**For roughly one third of the factoids you write, find a genuinely matching image** and
put its `id` in the factoid's `imageId`. For the other ~two thirds, leave `imageId: ""`.
At the 300 target that's about **~90–100 image-anchored factoids** — comfortably within the
414-asset library, but only where the match is real.

How to match:
1. Search `assets` for an entry whose `subject`, `name`, `tags`, or `caption` clearly
   depicts the factoid's subject. Use `searchText` — it concatenates the searchable terms.
2. Only attach an image if it's a **good, direct** match (a factoid about lightning →
   a lightning/storm asset; not "weather, close enough"). A wrong picture is worse than
   none. If nothing fits well, leave `imageId: ""`.
3. Copy the asset's `id` **exactly** into `imageId`. Do not invent image ids — every
   `imageId` you set must already exist in `index.json`.

Don't force the 1/3 ratio per-factoid; aim for it across the whole batch. It's fine if it
lands at 1/4 or 2/5 — just don't image-anchor everything, and don't leave them all blank.

---

## 4. Where the facts come from — fit the grade, vary the sources

**(a) Grade-appropriate.** Match each factoid's concept *and* vocabulary to its `grades`.
Use the DepEd K–12 Science progression as your guide for what a child at that level has
actually met in school:

- **Grades 3–4:** living vs non-living; parts & needs of plants and animals; the senses;
  weather; soil, rocks & water; the Sun and Moon; everyday materials & their uses;
  push & pull. *No technical terms* — it must be sayable in plain words.
- **Grades 5–6:** body systems; ecosystems & food chains; properties and changes of
  materials (mixtures, solutions, physical vs chemical change); force, motion & energy;
  simple machines; the water cycle; weather patterns; the solar system; Earth's structure.
  May *name* a system/process if the body explains it simply.
- **Grades 7–10** (use sparingly, only for the simplest hooks): particle model of matter;
  cells; electricity & magnetism; plate tectonics; light & sound; climate.

A grade-3 factoid that needs the word "photosynthesis" is mis-graded — either simplify it
or raise its `grades`.

**(b) Don't mine one well.** Pull from a **spread of reputable references** so the bank
isn't 276 paraphrases of a single encyclopedia, and so no one source's error or bias
propagates across hundreds of factoids. Before trusting a specific number, **cross-check it
against at least two independent reputable sources.** Good families to draw from:

- **Authoritative general science** — Encyclopædia Britannica / Britannica Kids, NASA &
  NASA Space Place, National Geographic / Nat Geo Kids, Smithsonian, university & museum
  outreach pages, established science textbooks.
- **Kid-pitched explainers** — useful for the *register* (how simply to phrase it), but
  verify the underlying *fact* against an authoritative source. Never trust a "fun facts"
  listicle on its own; that's how myths spread.
- **Philippine institutions** for local / PH-relevant facts — **PAGASA** (weather,
  typhoons), **PHIVOLCS** (volcanoes, earthquakes), **DOST**, **DENR** & biodiversity
  bodies. These are the right authority for Taal, Mayon, the Philippine eagle, etc., and
  make the bank feel local.
- **Vary even within a subject** — different animals from different reference pages, not 30
  facts all traceable to one "amazing animals" article.

The `source` field must reflect this: state the actual claim **and** the kind/name of
reference you grounded it on — specific, not "the internet". If two good sources disagree on
a figure, use the conservative or rounded version.

> If you have live web access, actually look things up and diversify. If you don't, rely
> only on well-established, broadly-agreed facts (the kind any two encyclopedias would state
> the same way) and avoid anything hinging on a precise figure you can't be sure of — phrase
> it more generally instead. This reinforces the accuracy bar in §2.

---

## 5. What to write — the goal is 300 total

**The bank must grow from 24 to 300 factoids — so you are writing ~276 new ones.** This is
a large batch; structure it (see "Working at this scale" below) so it stays balanced,
accurate, and non-repetitive.

The current 24 are almost all biology (20 biology, 4 earth-science). Physics and chemistry
are at **zero**. Use this **per-subject target for the full 300** so the final bank is
well-rounded — the "to add" column is what you write:

| `subject`        | Have | Target (of 300) | To add | What it covers |
|------------------|------|-----------------|--------|----------------|
| `biology`        | 20   | ~90             | ~70    | animals, plants, human body, microbes, ecosystems |
| `physics`        | 0    | ~65             | ~65    | gravity, friction, magnets, light & shadows, sound, static electricity, simple machines, floating/sinking, heat, motion |
| `chemistry`      | 0    | ~55             | ~55    | states of matter, melting/freezing/evaporation, mixtures & solutions, why ice floats, rust, oil & water, air is matter, acids/bases (simple) |
| `earth-science`  | 4    | ~65             | ~61    | earthquakes & faults, volcanoes, typhoons, weather, clouds, rainbows, soil, fossils, oceans, the water cycle in detail |
| `general`        | 0    | ~25             | ~25    | **astronomy/space** (moon phases — don't repeat — stars, planets, Sun, eclipses, day/night, seasons), everyday science, technology |
| **Total**        | 24   | **300**         | ~276   | |

Treat the targets as guides, not hard quotas — landing within a handful of each is fine.
The firm requirement is **300 total** and **no subject left thin**.

**Lean into Philippine relevance** wherever it's natural — it makes kids light up: typhoons
and the Pacific, Taal/Mayon volcanoes and the Ring of Fire, Philippine animals (tarsier,
carabao, tamaraw, pawikan), rice farming, coral reefs, the country's biodiversity. Filipino
examples beat generic ones.

### Working at this scale (276 is a lot — do it in batches)

- Write in **batches of ~25–30**, cycling through subjects so the bank stays balanced as it
  grows (don't write all 70 biology first). After each batch: re-parse the JSON to confirm
  it's still valid, and update `count`.
- **Keep a running tally** toward 300 and toward each subject's target.
- **Guard against duplication as the bank grows** — before adding, check your new `id` and
  the *topic* against everything already in the file (the original 24 plus everything you've
  added). 276 nuggets across one subject WILL start repeating ideas if you're not deliberate;
  vary the angle (different animal, different mechanism, different everyday example).
- Quality does not drop as the count rises. A boring or shaky factoid at #250 is worse than
  no factoid — every one is shown to a child as fact.

---

## 6. Before you finish

1. The JSON must stay **valid** — parse it to be sure. Trailing commas or duplicate ids
   will break the app.
2. Every new `id` is **unique** (check against the existing list below and each other).
3. Every `imageId` you set **exists** in `packages/images/index.json`; the rest are `""`.
4. Every factoid has non-empty `hook` and `body` in `tl` **or** `ceb`.
5. `count` equals `factoids.length`; `builtAt` updated.
6. **Leave a one-line note** for the maintainer (in your final message, not in the file):
   how many you added, the per-subject breakdown, and how many got images.

> **No app snapshot any more.** The mobile app and the web demo used to carry a snapshot copy
> of this bank (`packages/mobile/src/data/factoids.json`, `packages/web/src/data/factoids.json`)
> and show one factoid as a "cold-start card" while the model warmed up in CHAT. Chat is gone,
> both snapshots are deleted, and nothing in either app reads this bank today — the card feed
> draws from `rag/bank/factoids.jsonl` via `cards.db`, which is a different pipeline. Authoring
> here is still fine; just don't promise a maintainer that a re-copy will ship it.

Do **not** run `pnpm build`, the verify pipeline, git, or any deploy. Authoring only.

---

## Existing factoid ids (do not reuse, do not duplicate the topics)

```
bee-bubuyog--queen-eggs
ant-langgam--super-strength
butterfly-paruparo--taste-with-feet
spider-gagamba--silk-stronger-than-steel
mosquito-lamok--only-females-bite
dragonfly-tutubi--hover-flight
tarsier--eyes-bigger-than-brain
eagle-agila--national-bird
bat-paniki--only-flying-mammal
frog-palaka--breathes-through-skin
snail-kuhol--thousands-of-teeth
earthworm-bulate--soil-engineer
gecko-tuko--climbs-upside-down
turtle-pagong--ancient-and-long-lived
water-cycle--water-is-recycled
moon-phases--changing-sunlight
solar-system--sun-holds-million-earths
volcano-erupting--ring-of-fire
coconut-niyog--tree-of-life
bamboo-kawayan--fastest-growing-plant
sampaguita--national-flower
narra--national-tree
mushroom-kabute--fungi-not-plant
crab-alimango--blue-blood
```
