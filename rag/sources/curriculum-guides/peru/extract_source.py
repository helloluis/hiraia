#!/usr/bin/env python3
"""Read the pinned MINEDU PDF's science tables without mixing their two columns.

This is deliberately specific to the SHA-256-pinned March 2017 edition. It is
not a generic PDF parser and must not silently accept another document layout.
Only line-wrap hyphens and layout whitespace are normalized. Original examples
remain source evidence, not approved science explanations or training text.
"""

from __future__ import annotations

import hashlib
from pathlib import Path
import re
import subprocess
import tempfile
import xml.etree.ElementTree as ET

PDF_SHA256 = "34009689b6e3fe2194ec61c1675af13407528ae5e0f34f4d484007efd9e832f7"
NS = {"x": "http://www.w3.org/1999/xhtml"}
ORDINALS = ["PRIMER", "SEGUNDO", "TERCER", "CUARTO", "QUINTO", "SEXTO"]
PREFIX = "PE-CNEB-2017-CYT"
EXPECTED_COUNTS = {
    "INQ": [5, 5, 5, 5, 5, 5],
    "EXP": [7, 9, 8, 10, 7, 9],
    "TEC": [4, 4, 4, 4, 3, 4],
}


def normalize_lines(lines: list[str]) -> str:
    text = "\n".join(lines)
    text = re.sub(r"(?<=\w)-\n(?=\w)", "", text)
    return text.replace("\n", " ")


def read_science_xml(pdf: Path) -> list[ET.Element]:
    if hashlib.sha256(pdf.read_bytes()).hexdigest() != PDF_SHA256:
        raise ValueError("The source PDF differs from the edition pinned by this map.")
    with tempfile.TemporaryDirectory(prefix="hiraia-peru-curriculum-") as tmp:
        target = Path(tmp) / "science.xml"
        subprocess.run(
            ["pdftotext", "-f", "273", "-l", "303", "-bbox-layout", str(pdf), str(target)],
            check=True,
        )
        pages = ET.parse(target).getroot().findall(".//x:page", NS)
    if len(pages) != 31:
        raise ValueError(f"Expected 31 science-section pages, found {len(pages)}")
    return pages


def source_locator(pdf_pages: list[int], **extra: object) -> dict:
    return {
        "document_id": "minedu-primary-2017",
        "printed_pages": [page - 2 for page in pdf_pages],
        "pdf_pages": pdf_pages,
        **extra,
    }


def extract_performances(pages: list[ET.Element]) -> list[dict]:
    groups: dict[tuple[str, int], list[dict]] = {}
    table_pages = []
    for page_number, page in enumerate(pages, 273):
        lines = [
            (
                " ".join(word.text or "" for word in line),
                {key: float(value) for key, value in line.attrib.items()},
            )
            for line in page.findall(".//x:line", NS)
        ]
        headings = [(text, box) for text, box in lines if text.startswith("DESEMPEÑOS DE")]
        if not headings:
            continue
        if len(headings) != 2:
            raise ValueError(f"Expected two grade columns on PDF page {page_number}")
        table_pages.append(page_number)
        competency = "INQ" if page_number <= 283 else "EXP" if page_number <= 293 else "TEC"
        for heading, heading_box in headings:
            grade = next(i + 1 for i, ordinal in enumerate(ORDINALS) if ordinal in heading)
            center = (heading_box["xMin"] + heading_box["xMax"]) / 2
            body = [
                (text, box)
                for text, box in lines
                if box["yMin"] > heading_box["yMax"]
                and box["yMax"] < 733
                and box["xMin"] >= center - 91
                and box["xMax"] <= center + 91
            ]
            body.sort(key=lambda line: (round(line[1]["yMin"], 1), line[1]["xMin"]))
            group = groups.setdefault((competency, grade), [])
            for text, _ in body:
                if text.startswith("Cuando") or (not group and not text.startswith("•")):
                    continue
                if text.startswith("•"):
                    group.append({"lines": [], "pages": []})
                    text = text.lstrip("•").strip()
                if not group:
                    continue
                group[-1]["lines"].append(text)
                if page_number not in group[-1]["pages"]:
                    group[-1]["pages"].append(page_number)
    if table_pages != [279, 281, 282, 283, 288, 289, 290, 291, 293, 298, 299, 300, 301, 302, 303]:
        raise ValueError(f"Unexpected grade-table page inventory: {table_pages}")
    results = []
    for (competency, grade), items in groups.items():
        expected = EXPECTED_COUNTS[competency][grade - 1]
        if len(items) != expected:
            raise ValueError(f"{competency} grade {grade}: expected {expected}, found {len(items)}")
        for ordinal, item in enumerate(items, 1):
            full_text = normalize_lines(item["lines"])
            statement, separator, example = full_text.partition(" Ejemplo: ")
            results.append({
                "id": f"{PREFIX}-{competency}-G{grade}-{ordinal:02d}",
                "competency_id": f"{PREFIX}-{competency}",
                "grade": grade,
                "cycle": ["III", "IV", "V"][(grade - 1) // 2],
                "ordinal_within_grade_competency": ordinal,
                "statement_es": statement,
                "source_example_es": example if separator else None,
                "source": source_locator(
                    item["pages"], column="left" if grade % 2 else "right",
                    bullet_ordinal_in_grade=ordinal,
                ),
            })
    return sorted(results, key=lambda item: (item["grade"], ["INQ", "EXP", "TEC"].index(item["competency_id"].split("-")[-1]), item["ordinal_within_grade_competency"]))


def extract_standards(pages: list[ET.Element]) -> list[dict]:
    results = []
    for competency, page_number in [("INQ", 277), ("EXP", 287), ("TEC", 297)]:
        blocks = pages[page_number - 273].findall(".//x:block", NS)
        for level, cycle in [(3, "III"), (4, "IV"), (5, "V")]:
            labels = [
                block for block in blocks
                if " ".join(word.text or "" for word in block.findall(".//x:word", NS)) == str(level)
                and 70 < float(block.attrib["xMin"]) < 90
            ]
            if len(labels) != 1:
                raise ValueError(f"Could not locate level {level} on PDF page {page_number}")
            label_y = (float(labels[0].attrib["yMin"]) + float(labels[0].attrib["yMax"])) / 2
            bodies = [
                block for block in blocks
                if 100 < float(block.attrib["xMin"]) < 120
                and float(block.attrib["yMin"]) < label_y < float(block.attrib["yMax"])
            ]
            if len(bodies) != 1:
                raise ValueError(f"Could not locate standard {level} on PDF page {page_number}")
            text = normalize_lines([
                " ".join(word.text or "" for word in line)
                for line in bodies[0].findall("x:line", NS)
            ])
            results.append({
                "id": f"{PREFIX}-{competency}-C{cycle}",
                "competency_id": f"{PREFIX}-{competency}",
                "cycle": cycle,
                "national_progression_level": level,
                "end_grade": level * 2 - 4,
                "statement_es": text,
                "source": source_locator([page_number], table_level=level),
            })
    return results
