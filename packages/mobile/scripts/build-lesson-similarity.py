#!/usr/bin/env python3
"""Precompute LaBSE similarity within approved lesson pools. No inference/network.

Uses the existing English source-fact vectors (language-independent lesson planning).
This is a soft diversity hint, never permission to add a card to a lesson.
Run with Python + numpy; --check verifies the shipped artifact without rewriting it.
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[3]
MOBILE = ROOT / "packages/mobile"
OUTPUT = MOBILE / "src/generated/lessonSimilarity.generated.json"
MIN_COSINE = 0.80  # Editorial diversity heuristic, not a calibrated relevance threshold.
MAX_NEIGHBORS = 8


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def build():
    bank = ROOT / "rag/bank/science-facts.jsonl"
    meta_path = MOBILE / "assets/rag/vectors-labse.meta.json"
    binary = MOBILE / "assets/rag/vectors-labse.i8.bin"
    meta = json.loads(meta_path.read_text())
    raw = bank.read_bytes()
    if hashlib.md5(raw).hexdigest()[:12] != meta["bankHash"]:
        raise ValueError("Fact bank and LaBSE vectors do not match")
    rows = [json.loads(line) for line in raw.splitlines() if line.strip()]
    ordinals = {row["id"]: i for i, row in enumerate(rows)}
    if len(rows) != meta["count"] or len(ordinals) != len(rows):
        raise ValueError("Invalid bank count or duplicate source IDs")
    shape = (len(meta["langs"]), meta["count"], meta["dims"])
    if binary.stat().st_size != int(np.prod(shape)):
        raise ValueError("Incorrect vector file size")
    vectors = np.memmap(binary, dtype=np.int8, mode="r", shape=shape)[meta["langs"].index("en")]
    manifests = [MOBILE / f"src/generated/grade{g}Lessons.generated.json" for g in range(3, 11)]
    lessons, fact_ids = [], {}
    for path in manifests:
        data = json.loads(path.read_text())
        lessons.extend(data["lessons"])
        for card, fact in data["factIds"].items():
            if card in fact_ids and fact_ids[card] != fact:
                raise ValueError(f"Conflicting source mapping: {card}")
            fact_ids[card] = fact
    admitted = {fact_ids.get(card, card) for lesson in lessons for card in lesson["cardIds"]}
    facts = sorted(admitted & ordinals.keys())
    indices = {fact: i for i, fact in enumerate(facts)}
    nearest = [dict() for _ in facts]
    for lesson in lessons:
        ids = sorted({indices[fact_ids.get(card, card)] for card in lesson["cardIds"]
                      if fact_ids.get(card, card) in indices})
        if len(ids) < 2:
            continue
        matrix = np.array(vectors[[ordinals[facts[i]] for i in ids]], dtype=np.float32)
        norms = np.linalg.norm(matrix, axis=1, keepdims=True)
        if np.any(norms == 0):
            raise ValueError("Zero LaBSE vector in lesson pool")
        matrix /= norms  # Global int8 scale cancels in cosine similarity.
        scores = matrix @ matrix.T
        np.fill_diagonal(scores, -1)
        for row, source in enumerate(ids):
            # Sort quantized scores so the output remains stable across BLAS backends.
            candidates = [(ids[j], int(round(float(score) * 1000)))
                          for j, score in enumerate(scores[row]) if score >= MIN_COSINE]
            for target, score in sorted(candidates, key=lambda x: (-x[1], x[0]))[:MAX_NEIGHBORS]:
                nearest[source][target] = max(score, nearest[source].get(target, 0))
    neighbors = []
    for row in nearest:
        pairs = sorted(row.items(), key=lambda x: (-x[1], x[0]))[:MAX_NEIGHBORS]
        neighbors.append([n for pair in pairs for n in pair])
    sources = [bank, meta_path, binary, *manifests]
    return {
        "version": 1,
        "model": meta["model"], "language": "en", "bankHash": meta["bankHash"],
        "minCosine": MIN_COSINE, "maxNeighbors": MAX_NEIGHBORS,
        "sourceHashes": {str(p.relative_to(ROOT)): sha(p) for p in sources},
        "lessons": {lesson["key"]: lesson["revision"] for lesson in lessons},
        "unembeddedFacts": sorted(admitted - ordinals.keys()),
        "facts": facts, "neighbors": neighbors,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    data = build()
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n"
    if args.check:
        if not OUTPUT.exists() or json.loads(OUTPUT.read_text()) != data:
            raise SystemExit("Lesson similarity is stale; run build-lesson-similarity.py")
    else:
        OUTPUT.write_text(payload)
    print(json.dumps({"checked": args.check, "facts": len(data["facts"]),
                      "links": sum(len(row) // 2 for row in data["neighbors"]),
                      "unembedded": len(data["unembeddedFacts"]),
                      "bytes": len(payload.encode())}))
