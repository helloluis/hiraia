#!/usr/bin/env python3
"""Bring quiz rows to the shipping ruleset: THREE short choices.

The card-ui build's bundled deck (packages/mobile/assets/data/cards.db) is 87% three-option with a
median option of 19 characters; the bank on this branch is 100% four-option (median 50 EN chars,
Tagalog options up to 236). Regeneration is the proper fix for new questions — see the prompt change
in fw-genverify.py — but existing rows can be trimmed losslessly: keep the correct answer and the two
distractors that read shortest (they are the ones that fit the card), re-index the answer, and leave
the explanation alone.

  python3 rag/pipeline/trim-quiz-options.py --dry-run          # report only
  python3 rag/pipeline/trim-quiz-options.py --from-id 27783    # trim the rows added by the quiz lane
  python3 rag/pipeline/trim-quiz-options.py                    # trim every 4-option row
"""
import argparse, json, os, shutil, statistics, collections
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
BANK = f"{ROOT}/rag/bank/quiz-bank.jsonl"
ap = argparse.ArgumentParser()
ap.add_argument("--dry-run", action="store_true"); ap.add_argument("--from-id", type=int, default=0)
ap.add_argument("--keep", type=int, default=3, help="options to keep (default 3)")
a = ap.parse_args()

def length(opt):
    """Longest localisation decides the fit — a short English option with a long Tagalog one still overflows."""
    if isinstance(opt, dict): return max(len(v or "") for v in opt.values())
    return len(opt or "")

rows = [json.loads(l) for l in open(BANK, encoding="utf-8")]
idx = lambda r: int(r["id"].split("-")[1]) if r["id"].split("-")[1].isdigit() else -1
changed = before = after = 0
for r in rows:
    if idx(r) < a.from_id: continue
    opts = r.get("options") or []
    if len(opts) <= a.keep: continue
    ans = r.get("answer", 0)
    if not (0 <= ans < len(opts)): continue
    correct = opts[ans]
    distractors = sorted((o for i, o in enumerate(opts) if i != ans), key=length)[: a.keep - 1]
    kept = sorted([correct] + distractors, key=lambda o: opts.index(o))  # keep the original order
    before += statistics.mean(length(o) for o in opts); after += statistics.mean(length(o) for o in kept)
    r["options"] = kept; r["answer"] = kept.index(correct); changed += 1
n = collections.Counter(len(r.get("options") or []) for r in rows)
print(f"rows {len(rows)} | trimmed {changed} | options/question now {dict(n)}")
if changed:
    print(f"mean option length (longest localisation) {before/changed:.0f} → {after/changed:.0f} chars")
if a.dry_run: print("dry run — nothing written"); raise SystemExit
shutil.copy(BANK, BANK + ".pre-trim.bak")
with open(BANK, "w", encoding="utf-8") as f:
    for r in rows: f.write(json.dumps(r, ensure_ascii=False) + "\n")
print(f"wrote {BANK} (backup {os.path.basename(BANK)}.pre-trim.bak) — now run gen-cards-questions.py")
