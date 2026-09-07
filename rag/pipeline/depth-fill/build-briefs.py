#!/opt/homebrew/bin/python3
"""Live depth-fill briefs from runtime tags (post-audit, post-recovery).

  /opt/homebrew/bin/python3 rag/pipeline/depth-fill/build-briefs.py

Writes rag/pipeline/depth-fill/briefs.json. Floor 20. Skips fact_able <= 1.
"""
from __future__ import annotations

import collections
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
FLOOR = 20
OUT = Path(__file__).resolve().parent / "briefs.json"


def main():
    kinds = json.loads((ROOT / "rag/bank/competency-kinds.json").read_text())["competencies"]
    pool = {c["id"]: c for c in json.loads((ROOT / "rag/pipeline/cardsPool.app.json").read_text())["cards"]}
    tags = json.loads((ROOT / "packages/mobile/src/generated/curriculumTags.generated.json").read_text())
    by_code = collections.defaultdict(list)
    for cid, row in tags.items():
        card = pool.get(cid)
        if not card:
            continue
        codes = row[5] if len(row) > 5 else [row[0]]
        en = (card.get("fact") or {}).get("en") or ""
        for code in codes:
            if isinstance(code, str) and code.startswith("G"):
                by_code[code].append(en)

    briefs = []
    for name in (
        "matatag-elementary-competencies.json",
        "matatag-jhs-competencies.json",
    ):
        doc = json.loads((ROOT / "rag/sources/curriculum-guides" / name).read_text())
        for q in doc["quarters"]:
            for c in q["competencies"]:
                k = kinds.get(c["code"], {})
                fa = int(k.get("fact_able") or 0)
                have = len(by_code.get(c["code"], []))
                if have >= FLOOR or fa <= 1:
                    continue
                need = FLOOR - have
                over = 1.6 if fa >= 5 else 3.0
                form = k.get("card_form") or "fact"
                if form == "activity prompt":
                    form = "method"
                briefs.append(
                    dict(
                        code=c["code"],
                        grade=q["grade"],
                        quarter=q["quarter"],
                        domain=q.get("domain", ""),
                        competency=c["text"],
                        kind=k.get("kind", "content"),
                        fact_able=fa,
                        card_form=form,
                        have=have,
                        floor=FLOOR,
                        need=need,
                        target=math.ceil(need * over),
                        existing_facts_en=by_code.get(c["code"], [])[:80],
                    )
                )

    briefs.sort(key=lambda b: (b["have"], b["code"]))
    doc = dict(
        scheme="depth-fill/v1: floor 20 from runtime curriculumTags after audit+recovery; skip fact_able<=1; target = need x 3 (x1.6 if fact_able>=5)",
        summary=dict(
            competencies=len(briefs),
            need=sum(b["need"] for b in briefs),
            target=sum(b["target"] for b in briefs),
            floor=FLOOR,
        ),
        briefs=briefs,
    )
    OUT.write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n")
    s = doc["summary"]
    print(f"-> {OUT.relative_to(ROOT)}  codes={s['competencies']} need={s['need']} write={s['target']}")


if __name__ == "__main__":
    main()
