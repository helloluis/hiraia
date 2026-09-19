# Card-body language audit (Tagalog / Cebuano)

Sibling of `tools/quiz-language-audit`, which does this for quiz MCQs. This one targets the
**card bodies** in `rag/pipeline/cardsPool.app.json`. Same house rule: **diagnose and propose;
write back only what is provably mechanical.**

39.2% of the pool (19,279 of 49,156 cards) opens its Tagalog body with a question, which the
deck prints as the card's lead. `ffct-13212`, seen on a real device, read:

> **Ilang pakpak ang langaw?** — literally *"How many wings **is** the fly?"*

`[Predicate] ang [Topic]` equates its two sides, so a bare `Ilang X ang Y?` asks what Y *is*,
not what it *has*. It needs the genitive `ng` or an existential `mayroon`.

## Why only two classes are auto-fixed

The rewrite is trivial. Deciding whether a sentence *needs* it is not — `Ilang beses tumitibok
ang puso mo?` is correct, because the verb `tumitibok` governs the `ang` phrase. A regex for
the broken shape fires on **274** cards and most are sentences like that, which the rewrite
would actively break. Adding verb-morphology filters (prefix, `-in-`/`-um-` infix, locative
`nasa`, capacity `kasya`/`kaya`) narrows it to **32** — better, but still ~55% precision, and
it still has false negatives (`ffct-00831`, where `lumilipad` is a participle modifying the
noun rather than the predicate). So that class goes to a judge, not to `sed`.

| class | what | count | action |
|---|---|---:|---|
| T0-A | `Ilang X ang mayroon ang Y?` — stray `ang`; `meron`→`mayroon` | 39 | **auto** |
| T0-B | Cebuano title `PAK` → `Pako` (English titles confirm "wing") | 9 | **auto** |
| T0-C | `fact.en` holds the Tagalog question | 19 | report — needs authoring |
| T0-D | two cards sharing one question lead | 422 | report — ids are referenced by art/quizzes/lessons |
| T1 | bare equational, no governing verb | 32 | judge, then propose |

## Gold set

`gold.json` — 59 hand-labelled items (20 BROKEN / 39 CORRECT) across 7 licensing patterns,
including the cases that fool naive rules: locative `nasa` on a part-possession
(`Ilang buto ang nasa leeg ng giraffe?` is **correct**), measure equivalences
(`Ilang minuto ang kalahating oras?` is **correct**), and the participle trap above.
Labels are mine, not native-verified — the `borderline: true` rows want a Tagalog speaker
before these numbers gate anything.

It exists so "is model X good enough" is **measured**. Cost is not the constraint: 32
candidates is a fraction of a cent anywhere, and the full 19,279 sweep is under a dollar on
the cheap tier. Competence in a low-resource language is the constraint.

`judge.py` reports accuracy plus **precision and recall on the BROKEN class separately** —
they are not interchangeable. Bad BROKEN precision writes wrong Tagalog into the shipped bank;
bad recall merely leaves defects in place.

## Commands

```sh
python3 tools/card-language-audit/audit.py detect     --run runs/2026-09-19-tl-questions
python3 tools/card-language-audit/audit.py apply-safe --run runs/2026-09-19-tl-questions
python3 tools/card-language-audit/judge.py bakeoff    --run ... --models a,b,c
python3 tools/card-language-audit/judge.py judge      --run ... --model X --targets t1
python3 tools/card-language-audit/judge.py sample     --run ... --n 300
```

`apply-safe` re-serialises the pool **exactly** as stored (one line, default separators,
verified byte-identical on an unmodified round-trip). Pretty-printing it instead turns a
48-card edit into a 2,070,923-line diff and adds 8 MB. Review changes through
`proposals.jsonl`, which is what it is for.

## Not done here

Nothing in this directory rebuilds `cards.db` or ships anything. After a fix lands in the pool,
`python3 rag/pipeline/build-cards-db.py` regenerates the database, and only then can an APK
carry it.
