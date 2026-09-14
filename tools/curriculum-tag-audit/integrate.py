#!/opt/homebrew/bin/python3
"""Assemble first-pass reviews into durable fact-ID overrides and apply them.

Does not patch generated JSON as the only fix. Writes:
  packages/mobile/src/data/curriculumTagOverrides.json  (relabels / injections)
  packages/mobile/src/data/curriculumTagExclusions.json (removals; merges hand entries)

Safe by default (--dry-run). Pass --apply to write. Then:
  node packages/mobile/scripts/gen-curriculum-tags.mjs
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RUNS = [
    ROOT / "tools/curriculum-tag-audit/runs/fw-dsv4",
    ROOT / "tools/curriculum-tag-audit/runs/fw-dsv4-pass2",
    ROOT / "tools/curriculum-tag-audit/runs/grok",
]
EXCLUSIONS = ROOT / "packages/mobile/src/data/curriculumTagExclusions.json"
OVERRIDES = ROOT / "packages/mobile/src/data/curriculumTagOverrides.json"
TAGS = ROOT / "rag/bank/curriculum-tags.json"
SOURCE_PATHS = {
    "index": "packages/mobile/src/generated/cardsIndex.generated.json",
    "text": "packages/mobile/assets/data/cards.db",
    "source_tags": "rag/bank/curriculum-tags.json",
    "runtime_tags": "packages/mobile/src/generated/curriculumTags.generated.json",
    "exclusions": "packages/mobile/src/data/curriculumTagExclusions.json",
    "elementary": "rag/sources/curriculum-guides/matatag-elementary-competencies.json",
    "jhs": "rag/sources/curriculum-guides/matatag-jhs-competencies.json",
    "outline": "packages/mobile/src/generated/curriculumOutline.generated.json",
}


def fingerprint():
    import hashlib

    hashes = {k: hashlib.file_digest((ROOT / p).open("rb"), "sha256").hexdigest() for k, p in SOURCE_PATHS.items()}
    snap = hashlib.sha256(json.dumps(hashes, sort_keys=True).encode()).hexdigest()
    return snap


def load_catalog_codes() -> set[str]:
    codes = set()
    for name in ("matatag-elementary-competencies.json", "matatag-jhs-competencies.json"):
        doc = json.loads((ROOT / "rag/sources/curriculum-guides" / name).read_text())
        for q in doc["quarters"]:
            for c in q["competencies"]:
                codes.add(c["code"])
    return codes


def iter_reviews():
    for d in RUNS:
        if not d.is_dir():
            continue
        for path in sorted(d.glob("*.review.jsonl")):
            for line in path.read_text().splitlines():
                if line.strip():
                    yield json.loads(line)


def rank(obj: dict, live_snap: str) -> tuple:
    snap = obj.get("snapshot") or ""
    reviewer = obj.get("reviewer") or ""
    flash = 1 if "deepseek" in reviewer else 0
    at = obj.get("reviewed_at") or ""
    n = len(obj.get("assigned_reviews") or [])
    return (1 if snap == live_snap else 0, flash, at, n)


def pick_best(rows: list[dict], live_snap: str) -> dict:
    return max(rows, key=lambda o: rank(o, live_snap))


def assigned_codes_bank(factoids: dict, card_id: str) -> list[str]:
    t = factoids.get(card_id) or {}
    codes = t.get("codes") or ([t["competency"]] if t.get("competency") else [])
    return [c for c in codes if isinstance(c, str) and not c.startswith("deped:")]


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--apply", action="store_true", help="Write exclusions + overrides. Default is dry-run.")
    args = p.parse_args(argv)

    live_snap = fingerprint()
    catalog = load_catalog_codes()
    factoids = json.loads(TAGS.read_text())["factoids"]
    hand = json.loads(EXCLUSIONS.read_text()) if EXCLUSIONS.is_file() else {}

    by_fid: dict[str, list] = defaultdict(list)
    n_rows = 0
    for obj in iter_reviews():
        fid = obj.get("fact_id")
        if not fid:
            continue
        n_rows += 1
        by_fid[fid].append(obj)

    keep = correct = exclude = skip_untagged_exclude = conflicts = 0
    overrides = {}
    exclusions = dict(hand)
    conflict_rows = []

    for fid, rows in by_fid.items():
        best = pick_best(rows, live_snap)
        disp = best.get("disposition")
        proposed = [c for c in (best.get("proposed_codes") or []) if c in catalog]
        # Drop duplicates, keep order.
        proposed = list(dict.fromkeys(proposed))
        others = {tuple(r.get("proposed_codes") or []) for r in rows}
        if len(others) > 1:
            # Same set in different order is not a conflict.
            sets = {tuple(sorted(s)) for s in others}
            if len(sets) > 1:
                conflicts += 1
                conflict_rows.append({"fact_id": fid, "proposed_sets": [list(s) for s in sorted(sets)]})
                # Still apply the best review; log the conflict.

        cid = best.get("id")
        bank = assigned_codes_bank(factoids, cid) if cid else []
        reviewer = best.get("reviewer") or "audit"
        note = f"first-pass {reviewer} {best.get('reviewed_at') or ''} disp={disp}"

        if disp == "keep":
            keep += 1
            continue
        if disp == "uncertain":
            continue
        if disp == "exclude" or not proposed:
            if not bank:
                skip_untagged_exclude += 1
                continue
            exclude += 1
            if fid not in hand:
                exclusions[fid] = note.strip()
            continue
        # correct (or exclude-with-proposals shouldn't happen)
        if set(proposed) == set(bank) and proposed:
            keep += 1
            continue
        correct += 1
        overrides[fid] = {
            "id": cid,
            "codes": proposed,
            "disposition": "correct",
            "reviewer": reviewer,
            "reviewed_at": best.get("reviewed_at"),
            "notes": note.strip(),
        }

    report = {
        "live_snapshot": live_snap,
        "review_rows": n_rows,
        "unique_facts": len(by_fid),
        "keep_no_write": keep,
        "correct_overrides": correct,
        "exclude_exclusions": exclude,
        "untagged_exclude_skipped": skip_untagged_exclude,
        "proposed_set_conflicts_logged": conflicts,
        "hand_exclusions_preserved": len(hand),
        "exclusions_total": len(exclusions),
        "overrides_total": len(overrides),
    }
    print(json.dumps(report, indent=2))
    if conflict_rows:
        print(f"conflicts {len(conflict_rows)} (best-review still applied; see integrate-conflicts.jsonl)")

    if not args.apply:
        print("\nDry-run. Pass --apply to write exclusions + overrides, then:")
        print("  node packages/mobile/scripts/gen-curriculum-tags.mjs")
        return 0

    OVERRIDES.write_text(
        json.dumps(
            {
                "schema": 1,
                "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "snapshot": live_snap,
                "source_runs": [str(p.relative_to(ROOT)) for p in RUNS if p.is_dir()],
                "factoids": dict(sorted(overrides.items())),
            },
            indent=2,
            ensure_ascii=False,
        )
        + "\n"
    )
    EXCLUSIONS.write_text(json.dumps(dict(sorted(exclusions.items())), indent=2, ensure_ascii=False) + "\n")
    conf_path = ROOT / "tools/curriculum-tag-audit/integrate-conflicts.jsonl"
    conf_path.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in conflict_rows))
    print(f"wrote {OVERRIDES.relative_to(ROOT)}")
    print(f"wrote {EXCLUSIONS.relative_to(ROOT)}")
    print(f"wrote {conf_path.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
