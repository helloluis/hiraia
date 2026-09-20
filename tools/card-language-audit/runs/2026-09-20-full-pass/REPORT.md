# Tagalog card-language audit — final report

Branch `card-language-audit`, **28 commits, 1,596 cards modified, not merged, not pushed.**
`cards.db` NOT rebuilt. No APK. Nothing deployed.

Started from one card Luis saw on a device: `ffct-13212`, reading
**"Ilang pakpak ang langaw?"** — *"How many wings **is** the fly?"*

---

## 1. Applied — 1,596 cards

| pass | cards | how it was found |
|---|---:|---|
| Tagalog respellings → English | 1,359 | deterministic, Luis's editorial call |
| orthographic typo repairs | 105 | funnel: 19,279 → 1,248 → 129 fixes |
| literal `\n` rendering bug | 51 | LLM found the symptom, grep found the cause |
| `gawa ng` material-sense | 23 | deterministic, confirmed by each card's own English |
| counting-question grammar | 20 | 3-model panel + hand repair |
| Cebuano `PAK` → `Pako` | 9 | deterministic |
| double-marker `ang mayroon ang` | 39 | deterministic |

Every write passed the emphasis guard. **0 orphaned spans of 81,757, before and after.**

The 51 literal-`\n` cards are the best value per effort: they rendered a visible `\n\n`
mid-sentence AND never split into question and answer, so they displayed as one blob. A grep
would have found them in seconds if anyone had known to look.

---

## 2. Found but NOT applied — 211 cards + queues

**211 confirmed defective cards** (150 from the full sweep, 61 from grep+triage). None applied:
every one is a Tagalog lexical judgement, and my hand labels were wrong more often than the
model's during this audit.

Worst clusters:

| pattern | cards | the Tagalog actually says |
|---|---:|---|
| `poles` → poste | ~14 | magnet/Earth poles as fence POSTS, across the whole magnetism topic |
| `how much` → magkano | 9 | asks the PRICE of your weight, oxygen, momentum |
| `fog` → ambon | 6 | drizzle |
| `brick` → tisa | 4 | chalk — walls built of chalk |
| `unbalanced force` → puwersa na balanse | 1 | BALANCED force, the opposite |
| `high tide` → mataas ang kati | 1 | kati is LOW tide |
| camel `hump` → utong | 1 | nipple |
| `toads` → bakulaw | 3 | gorilla |
| `doves` → kalyos | 1 | a callus |
| mango `flower` → bulak | 1 | cotton |
| algae `feeds` coral → kumakain ng coral | 1 | the algae EATS the coral |

Also queued: 29 lexical typo rewrites, 5 split-vote grammar cards, 19 cards whose English field
holds Tagalog, 422 duplicate question leads, and the `kalamansi`/`abaka` policy call.

---

## 3. One finding is about the pipeline, not the cards

"Chewing the cud" became **`pag-usap`**. *Usap* means CHEW in Cebuano and TALK in Tagalog.
Combined with `Haiwan` (Malay for *hayop*) found earlier in a title, that is two instances of
**Cebuano/Malay bleeding into the Tagalog field** — which is what Sailor2 would do.

Fixing 211 cards does not stop the next data build from reintroducing this. Whoever owns the
translation pipeline should see these two examples.

---

## 4. What this audit actually taught

**Deterministic beats LLM on closed classes; LLM beats deterministic on open ones.**
`gawa ng` was found 23/23 by grep and 0/2 by the model. Nonword detection was the reverse:
rarity is meaningless in an agglutinative language (18,584 of 33,733 tokens appear ≤2 times),
and only a model could tell `hapag` (table) from a typo of `kapag`.

**The funnel is the architecture.** Deterministic narrowing 19,279 → 1,248 → model → 129 fixes
beat the monolithic sweep, which found nothing for 2.17M tokens.

**Grep proposes, triage disposes.** Patterns the model discovered greped to 1,017 candidates —
but **952 (94%) were FINE**. `tears→luha` and `cars→kotse` are correct Tagalog; the model had
flagged a context, not a word pair. Applying the greps blind would have corrupted 952 good
cards to fix 61. The same trap appeared earlier: 126 of 141 `bulb` matches were genuinely
about light bulbs.

**Measure the judge, not the model tier.** `claude-haiku-4.5` scored BELOW the cheapest model
tested. Opus beat Sonnet 13:3 on real flags here. `nova-micro` scored recall 1.00 by answering
BROKEN to everything — read alone, that number would have selected the worst model in the table.

**Controls are the only reason several of these numbers are right.** The spiked control caught
a sweep reporting "the corpus is clean" at recall 0.33. My own hand labels were wrong on 3 of 9
control words and on `unatin`/`magbilis`/`hingin` the model was right and I was not.

---

## 5. Recommendation

1. **A Filipino teacher reviews the 211.** Most have a confident suggested correction
   (`poste`→`polo`, `magkano`→`gaano karami`); the work is confirming, not authoring.
   At ~45 s/card that is under three hours.
2. **Send the two bleed examples upstream** before the next data build.
3. **Then rebuild and ship.** `python3 rag/pipeline/build-cards-db.py`, regression gate,
   APK. 1,596 cards have changed since v0.4.16 — that is a real release, Luis's call.
4. **Do NOT apply the 211 without review**, and do not apply pattern greps without triage.

## 6. Files

`PLAN.md` stage log · `all-flags.json` 150 sweep flags · `triage-results.json` 61 confirmed +
952 cleared · `pattern-grep-full.json` 95 patterns · `typos-lexical.json` 29 queued ·
`known-pattern-queue.json` · `review-queue.json` · `gold.json` + `bakeoff-scores.json`
