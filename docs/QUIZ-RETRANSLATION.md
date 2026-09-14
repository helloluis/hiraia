# Quiz retranslation — English options under a Tagalog question

**Job:** ~1,504 quiz rows show a translated question with every long option still in English.
Retranslate them, repair the guard that should have caught it, and rebuild the shipped DB.

Reported by Luis 2026-09-12 from the app: playing in Tagalog, presented with English multiple
choices. Diagnosed the same day; this brief is the handoff.

## Scope (measured, not estimated)

| where | rows | affected |
|---|---:|---|
| `rag/bank/quiz-bank.jsonl` (source of truth) | 32,718 | **1,504** (tl 1,475 · bis 1,502 · both 1,473) |
| `packages/mobile/assets/data/cards.db` (what ships) | 25,751 | **1,162** (tl 1,138 · bis 1,160 · both 1,136) |

Fix the **bank**; the DB is derived from it. Nothing is missing from the data — `tl` and `bis` are
present but byte-identical to `en`, so the app cannot detect the problem and has no fallback.

## What counts as broken (read this before you count anything)

15,141 options are identical to English *legitimately*: place names, people, numbers, scientific
terms — "Cebu City", "Hidilyn Diaz", "100 degrees Celsius", "Diplococcus", "Bayan Ko". Do **not**
"fix" those; forcing them into Tagalog makes the deck worse.

An option is genuinely untranslated when **all** of these hold:

- it is **>= 20 characters**, and
- **fewer than half its words are capitalised** (this is what excludes proper nouns and
  institution names like "Philippine Institute of Volcanology and Seismology"), and
- its `tl` (or `bis`) is byte-identical to its `en`.

A **row** needs retranslation when its question IS translated but **every** option meeting the
above is untranslated. Checker — save as `rag/pipeline/check-quiz-translation.py`, it is also the
regression test for step 4:

```python
#!/usr/bin/env python3
"""Rows whose sentence-length options are all still English while the question is translated."""
import json, sys
BANK = 'rag/bank/quiz-bank.jsonl'
def sentencey(s):
    s = (s or '').strip()
    if len(s) < 20: return False
    w = s.split()
    return sum(1 for x in w if x[:1].isupper()) / len(w) < 0.5
bad = {'tl': set(), 'bis': set()}
for line in open(BANK):
    if not line.strip(): continue
    r = json.loads(line); q = r.get('q') or {}
    longs = [o for o in (r.get('options') or []) if sentencey(o.get('en'))]
    if not longs: continue
    for lang in ('tl', 'bis'):
        if (q.get(lang) or '').strip() == (q.get('en') or '').strip(): continue
        if all((o.get(lang) or '').strip() == (o.get('en') or '').strip() for o in longs):
            bad[lang].add(r['id'])
u = bad['tl'] | bad['bis']
print(f"tl {len(bad['tl'])} | bis {len(bad['bis'])} | union {len(u)}")
open('/tmp/quiz-untranslated-ids.txt', 'w').write('\n'.join(sorted(u)))
sys.exit(1 if u else 0)
```

## Root cause — three links, fix all three

1. **The translator was `gpt-oss-120b`.** `rag/pipeline/fw-translate.py` hard-codes
   `MODEL = 'accounts/fireworks/models/gpt-oss-120b'`. This project has since banned gpt-oss for
   generation and translation (see `rag/pipeline/depth-fill/BRIEF.md` §3). It silently returned the
   English string for some options.
2. **The acceptance rule let partial failures through.** `rag/pipeline/quiz_xlate_rules.py`
   `options_translated()` uses `any(...)` — a row passes if just ONE sentence-length option was
   translated. 504 more rows in the bank have some-but-not-all options English because of this.
3. **The rule then became a permanent no-op.** `options_distinct()` requires `len(opts) == 4`, but
   `trim-quiz-options.py` cut the bank from 4 options to 3 to fit the card UI. Since then
   `translation_ok()` can never return True for any row in this bank, so nothing downstream could
   catch the result. Worse, the trim keeps the two distractors with the shortest **longest
   localisation** (`max(len(v) for v in opt.values())`) — an untranslated option has no longer
   Tagalog string, so it always measured "shortest" and was **systematically preferred** over
   properly translated ones. That is why the survivors cluster into all-English option sets.

## The job

Work in `/Users/luis/Code/hiraia-unified` on a branch off `unified`. That checkout has uncommitted
work from other threads — **do not** revert or commit files outside this job.

**1. Repair the guard** (`rag/pipeline/quiz_xlate_rules.py`)
   - `options_distinct()`: accept any option count >= 3 (assert distinctness, not the number 4).
   - `options_translated()`: `any(` → `all(` — every sentence-length option must differ from English.
   - Use the same >= 20 chars + <50% capitalised test as the checker, so the rule and the test agree.
   - Sanity check after editing: the rule must now return False for a known-bad row and True for a
     known-good one. Do not skip this; the whole bug is a guard that was never exercised.

**2. Build the retranslate input.** `build-quiz-translate-input.py` skips factIds already in the
   bank, so it cannot be reused. Write a small builder that emits `fw-translate.py`'s input shape —
   `{i, factId, q, options, explanation, fact_tl, fact_bis}` — for the union id list, taking the
   terminology anchor `fact_tl`/`fact_bis` from `rag/bank/science-facts.jsonl` as the existing
   builder does. Use a fresh `i` offset (e.g. 800000) so indices cannot collide with earlier lanes.

**3. Translate with DeepSeek v4 Pro, never gpt-oss.** Parameterise the model rather than editing the
   constant: make `fw-translate.py` read `FW_MODEL` (defaulting to the current value is fine) and run
   it with `accounts/fireworks/models/deepseek-v4-pro-0813`. Keys: `set -a; . /Users/luis/Code/hiraia/.env.local; set +a`
   (`FIREWORKS_API_KEY`; never print or commit it). It is resumable and rejects rows failing
   `translation_ok`, which is exactly why step 1 comes first. Validate on `FW_LIMIT=60` and read a
   dozen outputs yourself before the full run. Cost is small — roughly 1,500 rows of three short
   options.

**4. Patch the bank in place.** `assemble-quiz-bank.py` only appends new factIds and will skip every
   one of these rows. Model the patcher on `trim-quiz-options.py`: back the bank up first, rewrite
   only the affected rows' `q`/`options`/`explanation` tl+bis, leave `id`, `factId`, `answer`,
   option order and every other row **byte-identical**, and print a before/after count. Then:

```sh
python3 rag/pipeline/check-quiz-translation.py          # expect union 0
python3 rag/pipeline/gen-cards-questions.py             # bank -> packages/mobile/src/data/cards-questions.json
python3 rag/pipeline/build-cards-db.py                  # -> packages/mobile/assets/data/cards.db (+ tokens.bin, cardsIndex)
npx tsx packages/mobile/scripts/card-harness.mts        # must exit 0
bash finetuning/eval/harness/run-harness.sh             # must be GREEN
```

## Acceptance

- The checker reports 0 for both languages, and the same check run against `cards.db` reports 0.
- Answer keys unchanged: for every patched row, `answer` still points at the same English option.
- Options still distinct within each language (a collapsed distractor makes the key ambiguous).
- No row outside the affected set changed — diff the bank against the backup and confirm the only
  differences are the intended ids.
- `card-harness.mts` exits 0 and `run-harness.sh` is green.
- The repaired guard is wired into the harness (or `check-quiz-translation.py` runs in CI) so this
  cannot regress silently a third time.

## Guardrails

- **Do not build an APK** and do not bump `versionCode`; a build thread owns that. Leave the rebuilt
  `cards.db`/`tokens.bin`/`cardsIndex.generated.json` in the working tree and say so in your report.
- Commit only when asked; if you do, commit by path and branch off `unified` first.
- Accuracy over fluency: if a translation is uncertain, leave the row and report it rather than
  shipping a wrong option to a child. Grade-5 register is the target.
- The 504 partially-untranslated rows are **out of scope** unless you finish early — fixing the
  `any` → `all` guard is what surfaces them; report the count so Luis can decide.
