# Card titles — generating the 19,566 missing ones

**Job:** every feed card prints a title in its index band. 26,857 cards have one; **19,566 do not**,
and those fall back to the card's raw internal `topic` — a lowercase English sentence fragment like
`lungs take in oxygen`, which the band then uppercases and truncates mid-word
(`BONDED COMPOUND DIFFERS FROM ITS E…`). This job writes the missing titles.

This is a **data job**, not an app change. Nothing in `packages/mobile` needs to be touched.

> **Do not run this on Claude.** Route it to Fireworks (`qwen3p7-plus` was used for the labelling
> work; `deepseek-v4-pro` and `gpt-oss-120b` are the decorrelated alternates). Beyond cost, there is
> a hard constraint: a chunk of the bank is grade-school biology, and Tagalog/Bisaya child-body text
> (reproduction, blood, bones, poison, illness) trips Anthropic's AUP classifier and kills the whole
> context. See `finetuning/eval/AUP-NOTES` / `aup-denylist.json`. Send ids and text to Fireworks
> directly; do not paste card bodies into a Claude session to "check" them.

---

## 1. Where the data lives

**Source of truth is `rag/pipeline/cardsPool.app.json`** — an object `{ "cards": [...], "taxonomy": [...] }`
with 46,421 cards. It is the input to `rag/pipeline/build-cards-db.py`, which bakes
`packages/mobile/assets/data/cards.db`.

⚠️ **Do not write titles into `cards.db`.** It is a generated artefact and is deleted and rebuilt
(`build-cards-db.py:75-76` does `os.remove(OUT_DB)`). Edits there are lost on the next build.

Each entry looks like this. `title` is the field to add — everything else already exists:

```jsonc
{
  "id": "ffct-00001",
  "factId": "lungs-bring-in-oxygen-g4",
  "domain": "LIVING_THINGS",
  "topic": "lungs take in oxygen",          // internal descriptor — NOT a title
  "terms": ["oksiheno", "oxygen", "baga", "lungs", "hangin", "air", "huminga", ...],
  "fact": { "tl": "...", "en": "...", "bis": "..." },
  "title": { "tl": "...", "en": "...", "bis": "..." }   // ← ADD THIS
}
```

Select the work:

```python
import json
pool  = json.load(open('rag/pipeline/cardsPool.app.json'))
cards = pool['cards']                       # NOTE: an object, not a bare array
todo  = [c for c in cards if not (c.get('title') or {}).get('tl')]
assert len(todo) == 19566, len(todo)
```

Test on `title.tl`, not on the presence of `title`. Two cards (`dcard-01638`, `dcard-07237`) carry
`{"tl": "", "en": "", "bis": ""}` — an object that is present and empty. Testing for the object
misses them and leaves two cards showing a raw topic forever.

---

## 2. What a title is

A title is a **short noun phrase naming the thing the card is about**. It is not a summary, not a
sentence, and not the topic reworded. The band prints it in tracked uppercase, so length is a hard
design constraint, not a style preference.

**Measured from the 26,855 titles that already exist — match this distribution:**

| | chars | words |
|---|---|---|
| min | 3 | 1 |
| **median** | **18** | **3** |
| p90 | 26 | 4 |
| max | 58 | 9 |

**Target ≤ 26 characters. Treat 32 as a hard cap** — beyond that the band truncates.

### The register is mixed-language, deliberately

Philippine science is taught in English/Taglish, and the existing titles reflect that: the **science
term stays English, the grammar is Tagalog or Cebuano.** Do not "purify" this into invented Tagalog
coinages, and do not translate established English terms.

Real examples, with the topic they replace:

| `topic` (internal) | `title.tl` | `title.en` | `title.bis` |
|---|---|---|---|
| complete metamorphosis stages | Metamorphosis Yugto | Metamorphosis Stages | Metamorphosis Yugto |
| python uses a windpipe tube to breathe while eating | Windpipe ng Python | Python Windpipe | Windpipe sa Python |
| bat only flying mammal | Lumilipad na Mamalya | Only Flying Mammal | Naglupad nga Mamalya |
| python ambushes prey | Pananambang ng Sawa | Python Ambush | Pag-ambus sa Sawa |
| citrus trees | Mga Punong Sitrus | Citrus Trees | Mga Puno sa Sitrus |
| taro corm stores food to grow new shoots | Gabi Corm | Taro Corm | Gabi Corm |

Note the shape: the topic is verb-led and sentence-like (`python ambushes prey`); the title is a
noun phrase (`Pananambang ng Sawa`). That transformation is the job.

### All three languages, and they usually differ

`tl`, `en` and `bis` are all required. **Only 7% are identical across all three** — those are proper
nouns and untranslatable terms (`Gabi Corm`, `Ube Halaya Mixture`). The other 93% genuinely differ,
so emitting the same string three times is a failure signal, not a shortcut.

Cebuano is not Tagalog with spelling changes. Note the real markers in the examples above:
`ng` → `sa`, `na` → `nga`, `Pananambang` → `Pag-ambus`.

### Rules

1. **Title Case.** The band uppercases it anyway, but the stored form is Title Case — it is also
   read by the reward recap (`cardTitleById`), which does not uppercase.
2. **Noun phrase.** No verbs-as-predicate, no full stop, no question mark.
3. **Ground it in the card's own `fact` text.** The title must name something the fact actually says.
   Do not introduce a term, number, or claim that is not in `fact`.
4. **No grade markers, no "Alam mo ba", no emoji, no quotes.**
5. Prefer the concrete subject over the abstract process — `Windpipe ng Python` beats
   `Paghinga Habang Kumakain`.

---

## 3. Prompt

One card per call, or batch 20 per call — batching is cheaper and the task has no cross-card context.
Send `topic`, `fact.tl`, `fact.en`. (`fact.bis` is optional; the Cebuano title can be derived from
the Tagalog one plus the English term.)

```
You are naming index cards for a Filipino grade-school science deck.

Given a science fact, write a SHORT TITLE naming what the card is about, in three
languages: Tagalog (tl), English (en), Cebuano (bis).

RULES
- A noun phrase, not a sentence. No verb-led fragments, no final punctuation.
- Title Case.
- Aim for 3 words / ~18 characters. Never exceed 32 characters.
- Keep English science terms in English; put Tagalog/Cebuano grammar around them.
  This is how Philippine science is taught. Examples of the register:
    "Metamorphosis Yugto"  "Windpipe ng Python"  "Lumilipad na Mamalya"  "Gabi Corm"
- Do NOT invent Tagalog coinages for established English terms.
- Name only what the FACT actually states. Introduce no new term, number or claim.
- tl and bis are different languages. Cebuano uses "sa" where Tagalog uses "ng",
  and "nga" where Tagalog uses "na".
- Identical strings in all three languages are acceptable ONLY for proper nouns
  and untranslatable terms.

FACT (Tagalog): {fact_tl}
FACT (English): {fact_en}

Return ONLY JSON: {"tl": "...", "en": "...", "bis": "..."}
```

Do **not** put `topic` in the prompt. It is a lowercase English descriptor and models copy it
verbatim, which reproduces exactly the defect this job exists to fix.

---

## 4. Output format

Write a **patch file**, not a rewritten pool — it keeps the diff reviewable and lets the job resume.

`rag/pipeline/card-titles-patch.json`:

```json
{
  "ffct-00001": { "tl": "Baga at Oksiheno", "en": "Lungs And Oxygen", "bis": "Baga ug Oksiheno" },
  "ffct-00002": { "tl": "Litid sa Buto",    "en": "Tendons To Bone",  "bis": "Litid sa Bukog" }
}
```

Apply it:

```python
import json
pool  = json.load(open('rag/pipeline/cardsPool.app.json'))
patch = json.load(open('rag/pipeline/card-titles-patch.json'))
n = 0
for c in pool['cards']:
    t = patch.get(c['id'])
    if t and not (c.get('title') or {}).get('tl'):
        c['title'] = t; n += 1
print('applied', n)                          # expect 19566
# write the WHOLE object back — `taxonomy` must survive
json.dump(pool, open('rag/pipeline/cardsPool.app.json', 'w'), ensure_ascii=False)
```

Then rebuild the database:

```bash
python3 rag/pipeline/build-cards-db.py
```

`scripts/build-apk.sh` refuses to build if `cards.db` is older than `cardsPool.app.json`, so this
step is enforced — you cannot forget it.

---

## 5. Validation — run before applying

```python
import json, re
patch = json.load(open('rag/pipeline/card-titles-patch.json'))
pool  = {c['id']: c for c in json.load(open('rag/pipeline/cardsPool.app.json'))['cards']}
bad = []
for cid, t in patch.items():
    if cid not in pool:                      bad.append((cid, 'unknown id')); continue
    if (pool[cid].get('title') or {}).get('tl'): bad.append((cid, 'already titled')); continue
    for k in ('tl', 'en', 'bis'):
        v = (t.get(k) or '').strip()
        if not v:                 bad.append((cid, f'{k} empty'))
        elif len(v) > 32:         bad.append((cid, f'{k} {len(v)} chars > 32'))
        elif v != t[k]:           bad.append((cid, f'{k} untrimmed'))
        elif v.endswith(('.', '?', '!')):    bad.append((cid, f'{k} ends in punctuation'))
        # Title Case = leading capital. `v.isupper()` alone would reject legitimate
        # acronym titles ("DNA", "LED", "UV"), so only flag SHOUTING beyond acronym length.
        elif v[0].islower():                 bad.append((cid, f'{k} not Title Case'))
        elif v.isupper() and len(v) > 5:     bad.append((cid, f'{k} all caps'))
        elif re.search(r'[\U0001F300-\U0001FAFF]', v): bad.append((cid, f'{k} emoji'))
    if t.get('tl') == pool[cid]['topic']:    bad.append((cid, 'tl copied the topic'))
same3 = sum(1 for t in patch.values() if t.get('tl') == t.get('en') == t.get('bis'))
print(f'{len(patch)} titles, {len(bad)} problems, {same3} identical-across-3 '
      f'({100*same3/max(len(patch),1):.0f}% — expect ~7%, investigate if >15%)')
for b in bad[:40]: print('  ', b)
```

**Spot-check by hand** before committing 19,566 rows: pull 30 at random, read them against their
facts, and get a native speaker on the Cebuano. Memory records native-speaker review of the
Tagalog/Cebuano copy as an outstanding item — this is a good batch to fold into it.

---

## 6. Cost

19,566 cards. Batched 20 per call ≈ 980 calls; roughly 700 input + 900 output tokens per batch.
On Fireworks `qwen3p7-plus` that is a few dollars — comparable to the competency-labelling run
(`fw-label-competencies.py`), which is the closest precedent in this repo and a good structural
template for the driver script (batching, resume, per-shard output files).

Budget one re-run: the first pass will over-produce identical-across-three-languages titles, and
those want regenerating with the Cebuano markers spelled out in the prompt.

---

## 7. Definition of done

- `card-titles-patch.json` covers all 19,566, validation clean.
- `cardsPool.app.json` patched; `build-cards-db.py` re-run.
- `sqlite3 cards.db "select count(*) from card_text where trim(title_tl)=''"` → **0**.
- 30 hand-checked, Cebuano reviewed by a native speaker.
- No card's title equals its `topic`.
