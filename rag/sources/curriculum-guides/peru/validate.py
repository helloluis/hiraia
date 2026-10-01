#!/usr/bin/env python3
"""Validate map structure, PH references, and optionally the pinned source PDF.

Run from any directory. --source-pdf additionally compares all 103 transcribed
bullets (including separately retained examples) and all nine cycle standards
with a fresh, column-aware extraction of the pinned official document.
"""

from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import sys

from extract_source import (
    EXPECTED_COUNTS, PREFIX, extract_performances, extract_standards, read_science_xml,
)

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]


def validate(data: dict, reuse: dict, source_pdf: Path | None = None) -> list[str]:
    errors: list[str] = []

    def check(condition: bool, message: str) -> None:
        if not condition:
            errors.append(message)

    competencies = data["competencies"]
    capacities = [capacity for competency in competencies for capacity in competency["capacities"]]
    performances = data["performance_expectations"]
    standards = data["cycle_standards"]
    nodes = competencies + capacities + performances + standards
    ids = [node["id"] for node in nodes]
    check(len(set(ids)) == len(ids), "Duplicate curriculum IDs")
    competency_ids = {f"{PREFIX}-{code}" for code in EXPECTED_COUNTS}
    check({c["id"] for c in competencies} == competency_ids, "Wrong national competency set")
    check(len(capacities) == 11, "Expected 11 capacities")
    check(len(standards) == 9, "Expected nine primary cycle standards")
    check(len(performances) == 103, "Expected 103 grade performance bullets")
    check(len(data["source_documents"]) == 1, "Unexpected source document set")
    check(data["source_documents"][0]["id"] == "minedu-primary-2017", "Wrong source document ID")
    check(data["source_documents"][0]["pdf_total_pages"] == 396, "Wrong PDF page count")
    check(data["coverage"]["peru_performances_reviewed_for_coverage"] == 0, "Unapproved coverage claim")
    check(data["coverage"]["coverage_fraction"] is None, "Unapproved coverage fraction")
    for competency in competencies:
        expected = {"INQ": 5, "EXP": 2, "TEC": 4}[competency["id"].split("-")[-1]]
        check(len(competency["capacities"]) == expected, f"Wrong capacity count: {competency['id']}")
        check(all(c["id"].startswith(competency["id"] + "-CAP") for c in competency["capacities"]), "Capacity parent mismatch")
    for node in nodes:
        source = node["source"]
        check(source["document_id"] == "minedu-primary-2017", f"Unknown source: {node['id']}")
        check(len(source["printed_pages"]) == len(source["pdf_pages"]) > 0, f"Missing pages: {node['id']}")
        check(source["pdf_pages"] == [p + 2 for p in source["printed_pages"]], f"PDF/printed offset: {node['id']}")
        check(all(271 <= p <= 301 for p in source["printed_pages"]), f"Outside science section: {node['id']}")
    for code, expected_by_grade in EXPECTED_COUNTS.items():
        for grade, count in enumerate(expected_by_grade, 1):
            selected = [p for p in performances if p["grade"] == grade and p["competency_id"] == f"{PREFIX}-{code}"]
            check(len(selected) == count, f"{code} Grade {grade}: expected {count} bullets")
            check(sorted(p["ordinal_within_grade_competency"] for p in selected) == list(range(1, count + 1)), f"Non-contiguous ordinals: {code} G{grade}")
            for performance in selected:
                ordinal = performance["ordinal_within_grade_competency"]
                check(performance["id"] == f"{PREFIX}-{code}-G{grade}-{ordinal:02d}", f"ID does not follow pinned source ordering: {performance['id']}")
    cycles = {"III": (3, 2), "IV": (4, 4), "V": (5, 6)}
    check({(s["competency_id"], s["cycle"]) for s in standards} == {(c, y) for c in competency_ids for y in cycles}, "Incomplete standard matrix")
    for standard in standards:
        level, end_grade = cycles[standard["cycle"]]
        check((standard["national_progression_level"], standard["end_grade"]) == (level, end_grade), f"Standard level confused with grade: {standard['id']}")
    for performance in performances:
        check(performance["grade"] in range(1, 7), f"Invalid grade: {performance['id']}")
        check(performance["cycle"] == ["III", "IV", "V"][(performance["grade"] - 1) // 2], f"Wrong performance cycle: {performance['id']}")
        check(performance["coverage_status"] == "not_assessed", f"Unapproved Peru coverage status: {performance['id']}")
        check(bool(performance["statement_es"].strip()), f"Empty source statement: {performance['id']}")
        check("Ejemplo:" not in performance["statement_es"], f"Source example leaked into target: {performance['id']}")
    indexed = {p["id"]: p for p in performances}
    bacteria = indexed.get(f"{PREFIX}-EXP-G6-01", {})
    check("PE-SOURCE-BACTERIA-001" in bacteria.get("source_issue_ids", []), "Known bacteria error lost its issue flag")
    check("bacterias necesitan un huésped" in (bacteria.get("source_example_es") or ""), "Source bacteria error was silently rewritten or lost")
    check("bacterias necesitan un huésped" not in bacteria.get("statement_es", ""), "Source bacteria error leaked into curriculum target")
    check(any(issue["id"] == "PE-SOURCE-BACTERIA-001" and issue["performance_id"] == bacteria.get("id") for issue in data["source_issues"]), "Missing source-issue record")
    computed = {
        "national_competencies": len(competencies), "capacities": len(capacities),
        "primary_cycle_standards": len(standards), "grade_performance_bullets": len(performances),
        "performance_bullets_by_grade": {str(g): sum(p["grade"] == g for p in performances) for g in range(1, 7)},
        "performance_bullets_by_competency": {code: sum(p["competency_id"] == f"{PREFIX}-{code}" for p in performances) for code in EXPECTED_COUNTS},
    }
    check(data["counts"] == computed, "Summary counts differ from map")
    check(reuse["target_map_id"] == data["id"], "Reuse crosswalk points to another map")
    check(reuse["counts"]["alignment_approved"] == 0, "Crosswalk asserts unapproved alignment")
    for baseline in reuse["baseline_files"]:
        path = ROOT / baseline["path"]
        check(path.is_file(), f"Missing PH baseline file: {path}")
        if path.is_file():
            check(hashlib.sha256(path.read_bytes()).hexdigest() == baseline["sha256"], f"PH baseline changed; re-review candidates: {baseline['path']}")
    linked = set()
    check(len({c["id"] for c in reuse["candidates"]}) == len(reuse["candidates"]), "Duplicate candidate IDs")
    for candidate in reuse["candidates"]:
        check(set(candidate["peru_performance_ids"]) <= indexed.keys(), f"Unknown Peru reference: {candidate['id']}")
        linked.update(candidate["peru_performance_ids"])
        check(bool(candidate["required_work"]), f"Candidate omits remaining work: {candidate['id']}")
        for reference in candidate["philippines_lesson_candidates"]:
            path = ROOT / reference["authoring_file"]
            if not path.is_file():
                continue
            authoring = json.loads(path.read_text())
            lesson = next((lesson for lesson in authoring["lessons"] if lesson["key"] == reference["lesson_key"]), None)
            check(lesson is not None, f"Unknown lesson: {reference['lesson_key']}")
            if lesson:
                check({u["id"] for u in lesson["units"]} == set(reference["unit_ids"]), f"Lesson unit mismatch: {reference['lesson_key']}")
                check({u["competency"] for u in lesson["units"]} == {c["code"] for c in reference["competencies"]}, f"PH competency mismatch: {reference['lesson_key']}")
    check(set(reuse["unmatched_performance_ids"]) == indexed.keys() - linked, "Unmatched target set is wrong")
    check(reuse["counts"]["candidate_groups"] == len(reuse["candidates"]), "Candidate group count is wrong")
    check(reuse["counts"]["performance_targets_with_a_candidate"] == len(linked), "Candidate target count is wrong")
    check(reuse["counts"]["performance_targets_without_a_candidate"] == len(indexed.keys() - linked), "Unmatched target count is wrong")
    for gap in reuse["gaps"]:
        check(set(gap["peru_performance_ids"]) <= indexed.keys(), f"Unknown target in gap: {gap['id']}")
    if source_pdf is not None:
        try:
            pages = read_science_xml(source_pdf)
            actual = extract_performances(pages) + extract_standards(pages)
            source_nodes = {node["id"]: node for node in performances + standards}
            for expected in actual:
                record = source_nodes.get(expected["id"], {})
                for field, value in expected.items():
                    check(record.get(field) == value, f"Source mismatch {expected['id']}.{field}")
        except (OSError, ValueError) as exc:
            errors.append(f"Source check failed: {exc}")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-pdf", type=Path, help="Also verify all transcriptions against the SHA-256-pinned official PDF")
    args = parser.parse_args()
    data = json.loads((HERE / "cneb-primary-science.json").read_text())
    reuse = json.loads((HERE / "reuse-candidates.json").read_text())
    errors = validate(data, reuse, args.source_pdf)
    if errors:
        for error in errors:
            print(f"FAIL: {error}", file=sys.stderr)
        return 1
    print(json.dumps({
        "status": "PASS", "map": data["id"], **data["counts"],
        "reuse_candidate_groups": len(reuse["candidates"]),
        "source_pdf_verified": args.source_pdf is not None,
        "coverage_approved": False,
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
