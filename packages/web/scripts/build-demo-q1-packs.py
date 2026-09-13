#!/usr/bin/env python3
"""Split the web-demo subset into a tiny Q1 seed and per-grade Q1 packs.

Seed: the first 5 Q1 cards per grade in competency order, so the lightbox can
open without parsing the full 2 MB bank and the walk can start in curriculum
sequence. After the visitor picks a grade, the matching pack loads the rest of
that grade's first-quarter cards + their MCQs.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

WEB = Path(__file__).resolve().parents[1]
DATA = WEB / "src" / "data"

cards_doc = json.loads((DATA / "demo-cards.json").read_text())
questions_doc = json.loads((DATA / "demo-questions.json").read_text())
CARDS = cards_doc["cards"]
TAGS = cards_doc.get("tags") or {}
TAXONOMY = cards_doc.get("taxonomy") or []
QUESTIONS = questions_doc["questions"]
Q_BY_FACT = {}
for q in QUESTIONS:
    Q_BY_FACT.setdefault(q["f"], []).append(q)

COMP_RE = re.compile(r"^(G\d+-[A-Z]+)-(\d+)$")


def comp_key(code: str) -> tuple:
    m = COMP_RE.match(code or "")
    if m:
        return (m.group(1), int(m.group(2)))
    return (code or "", 0)


def q1_for_grade(grade: int) -> list[dict]:
    rows = []
    for c in CARDS:
        tag = TAGS.get(c["id"])
        if not tag:
            continue
        _comp, g, q = tag[0], tag[1], tag[2]
        if g == grade and q == 1:
            rows.append(c)
    rows.sort(key=lambda c: (comp_key(TAGS[c["id"]][0]), c["id"]))
    return rows


def pick_seed(seq: list[dict], n: int = 5) -> list[dict]:
    # First five of the Q1 walk, not "illustrated-first": the demo has to start
    # on G3-M-1 / G9-F-1 / … even when those cards have no PNG yet.
    return seq[:n]


def slice_tags(cards: list[dict]) -> dict:
    return {c["id"]: TAGS[c["id"]] for c in cards if c["id"] in TAGS}


def questions_for(cards: list[dict]) -> list[dict]:
    out = []
    seen = set()
    for c in cards:
        for q in Q_BY_FACT.get(c["factId"], []):
            key = (q["f"], q.get("q", {}).get("en"))
            if key in seen:
                continue
            seen.add(key)
            out.append(q)
    return out


seed_cards: list[dict] = []
for grade in range(3, 11):
    seq = q1_for_grade(grade)
    seed = pick_seed(seq, 5)
    seed_cards.extend(seed)
    rest = [c for c in seq if c["id"] not in {s["id"] for s in seed}]
    pack = {
        "grade": grade,
        "quarter": 1,
        "cards": rest,
        "tags": slice_tags(rest),
        "questions": questions_for(seq),  # quizzes for the whole Q1 walk
    }
    path = DATA / f"demo-q1-g{grade}.json"
    path.write_text(json.dumps(pack, ensure_ascii=False, separators=(",", ":")))
    print(f"G{grade}: seed {len(seed)} + pack {len(rest)} cards, {len(pack['questions'])} MCQs, {path.stat().st_size/1024:.1f} KB")

seed_doc = {
    "cards": seed_cards,
    "tags": slice_tags(seed_cards),
    "taxonomy": TAXONOMY,
    "questions": questions_for(seed_cards),
}
seed_path = DATA / "demo-q1-seed.json"
seed_path.write_text(json.dumps(seed_doc, ensure_ascii=False, separators=(",", ":")))
print(f"seed: {len(seed_cards)} cards, {len(seed_doc['questions'])} MCQs, {seed_path.stat().st_size/1024:.1f} KB")
