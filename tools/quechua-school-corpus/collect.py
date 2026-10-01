#!/usr/bin/env python3
"""Collect public Quechua school PDFs with provenance; this is not a training set.

Python 3.11+ standard library, Poppler's pdfinfo/pdftotext. Network access is required
for discover/resolve/download, never for export. Originals, HTML caches, and
unmodified page text stay under the gitignored --storage directory. Catalogue
metadata is kept next to this script. Re-running resumes completed downloads.

Usage:
  python3 tools/quechua-school-corpus/collect.py discover
  python3 tools/quechua-school-corpus/collect.py resolve
  python3 tools/quechua-school-corpus/collect.py download
  python3 tools/quechua-school-corpus/collect.py export

The discovery site is an independent mirror, NOT MINEDU. Its category contains
misclassified books. Labels are provisional; publisher evidence and extracted
front matter are recorded separately. No language purity or reuse permission is
inferred from free access, a ministry logo, or a Quechua catalogue label.
"""

import argparse
import concurrent.futures
import csv
import hashlib
import html
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import shutil
import subprocess
import time
import unicodedata
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen


HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
DEFAULT_STORAGE = REPO / "finetuning/reference-materials/peru-quechua"
INDEX = "https://peru.librosminedu.com/colecciones/educacion-intercultural-bilingue/quechua/"
UA = "Hiraia-Quechua-Research/0.1 (public educational material inventory)"


def now():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def fold(value):
    return "".join(c for c in unicodedata.normalize("NFD", value.lower())
                   if unicodedata.category(c) != "Mn")


def dump(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".part")
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
    tmp.replace(path)


def read(path, default):
    return json.loads(path.read_text()) if path.exists() else default


def log(**kwargs):
    print(json.dumps(kwargs, ensure_ascii=False), flush=True)


def fetch_html(url, storage):
    path = storage / "html" / (hashlib.sha256(url.encode()).hexdigest() + ".html")
    if path.exists():
        return path.read_text()
    with urlopen(Request(url, headers={"User-Agent": UA}), timeout=60) as r:
        data = r.read(8 * 1024 * 1024)
    value = data.decode("utf-8", errors="replace")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(value)
    time.sleep(0.15)
    return value


class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []
        self.active = None

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            self.active = {**dict(attrs), "text": ""}

    def handle_data(self, data):
        if self.active is not None:
            self.active["text"] += data

    def handle_endtag(self, tag):
        if tag == "a" and self.active is not None:
            self.links.append(self.active)
            self.active = None


def labels(title):
    """Conservative discovery labels, not linguistic identification."""
    s = fold(title)
    if "shawi" in s:
        variety = "not_quechua_shawi"
    elif "wanka" in s:
        variety = "wanka"
    elif "collao" in s or "qullaw" in s:
        variety = "collao"
    elif "chanka" in s or "chanca" in s:
        variety = "chanka"
    elif "san martin" in s:
        variety = "kichwa_san_martin"
    elif "loreto" in s:
        variety = "kichwa_loreto"
    elif "kichwa" in s or "amazonico" in s:
        variety = "kichwa_unspecified"
    elif "cajamarca" in s:
        variety = "norteno_inkawasi_cajamarca_unsplit"
    elif "inkawasi" in s or "kanaris" in s:
        variety = "inkawasi_kanaris"
    elif "norteno" in s or "anan qichwa" in s:
        variety = "norteno_unspecified"
    elif "central" in s or "chawpi" in s:
        variety = "central_unspecified"
    elif "sureno" in s or "urin qichwa" in s:
        variety = "southern_unsplit"
    else:
        variety = "unspecified"

    if "evaluacion censal" in s or re.search(r"\bece\b", s):
        subject = "assessment_related"
    elif "ciencia" in s and "personal" in s:
        subject = "science_and_personal_social"
    elif "vocabulario" in s or "diccionario" in s:
        subject = "glossary_dictionary"
    elif "manual" in s and "escritura" in s:
        subject = "orthography"
    elif "docente" in s or "guia de analisis" in s:
        subject = "teacher_guide"
    elif "matematica" in s:
        subject = "mathematics"
    elif "saberes" in s or "haceres" in s:
        subject = "community_knowledge"
    elif any(w in s for w in ["literatura", "literaratura", "relatos", "lectura", "poema", "poesia", "cancionero", "retahila", "adivinanza", "cuento", "cartillas de animales", "cartillas animales"]):
        subject = "literature_readers"
    elif "comunicacion" in s or "lengua originaria" in s:
        subject = "language_communication"
    else:
        subject = "other_school_material"

    if "alternativa" in s or "eba" in s or "intermedio" in s:
        level = "basic_alternative_education"
    elif "secundaria" in s:
        level = "secondary"
    elif "inicial" in s or re.search(r"[345]\s+anos", s):
        level = "early_childhood"
    elif "primaria" in s:
        level = "primary"
    elif subject in {"science_and_personal_social", "mathematics"}:
        level = "primary_inferred_from_series"
    else:
        level = "unspecified"
    # Do not interpret a numbered story/volume, cycle, L2 lesson or child's age as grade.
    grades = re.findall(r"\b([1-6])(?:\s*(?:\.|°|º|er|o))*\s*(?:grado(?:\s+de)?|de)?\s*(?:primaria|secundaria)", s)
    if subject in {"science_and_personal_social", "mathematics", "language_communication"}:
        m = re.search(r"(?:tecnologia|matematicas?|comunicacion)\s+(?:del\s+)?([1-6])\b", s)
        if m:
            grades.append(m[1])
    distinct_grades = sorted(set(map(int, grades)))
    return {"variety_label": variety, "subject_label": subject,
            "level_label": level, "grade_candidates": distinct_grades,
            "grade_review_needed": len(distinct_grades) > 1,
            "metadata_basis": "discovery_title_unverified",
            "scope": "excluded_non_quechua" if variety.startswith("not_quechua") else "candidate"}


def discover(args):
    records = {}
    for page in range(1, args.pages + 1):
        url = INDEX if page == 1 else urljoin(INDEX, f"page/{page}/")
        body = fetch_html(url, args.storage)
        for block in re.findall(r"<article\b.*?</article>", body, re.S):
            a = re.search(r'<a\b[^>]*href="([^"]+)"', block)
            t = re.search(r'<p\b[^>]*class="entry-title"[^>]*>(.*?)</p>', block, re.S)
            if not (a and t):
                continue
            book_url = html.unescape(a[1])
            title = html.unescape(re.sub("<[^>]+>", "", t[1]))
            rid = "book-" + hashlib.sha256(book_url.encode()).hexdigest()[:12]
            records[book_url] = {"id": rid, "title": title, "discovery_url": book_url,
                                 "discovery_index": url, "discovered_at": now(),
                                 "discovery_host_type": "independent_third_party_mirror",
                                 "claimed_publisher": "Peru MINEDU (unverified catalogue claim)",
                                 **labels(title)}
        log(index_page=page, cumulative_records=len(records))
    dump(args.catalogue / "discovery.json", list(records.values()))


def resolve_book(record, args):
    out = dict(record)
    if record["scope"] != "candidate":
        out.update(resolve_status="excluded_non_quechua", editions=[])
        return out
    try:
        parser = Links()
        parser.feed(fetch_html(record["discovery_url"], args.storage))
        downloads = [a for a in parser.links if "btn" in a.get("class", "").split()
                     and "/pdf-" in a.get("href", "")]
        if not downloads:
            out.update(resolve_status="no_public_download_link", editions=[])
            return out
        editions = []
        for a in downloads:
            url = urljoin(record["discovery_url"], a["href"])
            body = fetch_html(url, args.storage)
            ids = sorted(set(re.findall(r"drive\.google\.com/file/d/([A-Za-z0-9_-]+)", body)))
            editions.append({"download_page": url, "mirror_edition_label": a["text"].strip(),
                             "drive_ids": ids, "resolve_status": "resolved" if len(ids) == 1 else "ambiguous_or_missing_drive_id"})
        out.update(resolve_status="resolved" if all(e["resolve_status"] == "resolved" for e in editions) else "partial", editions=editions)
    except Exception as exc:
        out.update(resolve_status="error", resolve_error=f"{type(exc).__name__}: {exc}")
    return out


def resolve(args):
    discovery = read(args.catalogue / "discovery.json", [])
    existing = {r["id"]: r for r in read(args.catalogue / "resolved.json", [])}
    todo = [r for r in discovery if existing.get(r["id"], {}).get("resolve_status") not in {"resolved", "excluded_non_quechua"}]
    order = {"science_and_personal_social": 0, "glossary_dictionary": 1, "orthography": 2}
    todo.sort(key=lambda r: order.get(r["subject_label"], 3))
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        pending = {pool.submit(resolve_book, r, args): r for r in todo}
        for n, future in enumerate(concurrent.futures.as_completed(pending), 1):
            item = future.result()
            existing[item["id"]] = item
            dump(args.catalogue / "resolved.json", [existing[r["id"]] for r in discovery if r["id"] in existing])
            log(resolved=n, total=len(todo), status=item["resolve_status"], id=item["id"])


def extract(pdf, rid, args):
    text_path = args.storage / "text" / (rid + ".txt")
    pages_path = args.storage / "pages" / (rid + ".jsonl")
    text_path.parent.mkdir(parents=True, exist_ok=True)
    pages_path.parent.mkdir(parents=True, exist_ok=True)
    info = subprocess.run(["pdfinfo", str(pdf)], capture_output=True, text=True, timeout=90, check=True)
    p = re.search(r"^Pages:\s+(\d+)", info.stdout, re.M)
    if not p:
        raise ValueError("pdfinfo did not return a page count")
    page_count = int(p[1])
    result = subprocess.run(["pdftotext", "-layout", "-enc", "UTF-8", str(pdf), str(text_path)], capture_output=True, text=True, timeout=240, check=True)
    body = text_path.read_text()
    pages = body.split("\f")
    if pages and not pages[-1].strip():
        pages.pop()
    word_counts = []
    with pages_path.open("w") as f:
        for i, page in enumerate(pages, 1):
            words = len(page.split())
            word_counts.append(words)
            f.write(json.dumps({"resource_id": rid, "pdf_page": i, "text": page,
                                "whitespace_words_all_languages": words}, ensure_ascii=False) + "\n")
    front = "\f".join(pages[:8])
    # Evidence is observable text, not a claim that publisher/rights are verified.
    evidence = []
    for i, page in enumerate(pages[:8], 1):
        for line in page.splitlines():
            if re.search(r"minedu|ministerio\s+de\s+educaci[oó]n|per[uú]\s+suyupi\s+yachay|derechos\s+reservados|prohibida\s+(?:su|la)|creativecommons|creative\s+commons|©|imprim|impreso|edici[oó]n|mirachisqa", line, re.I):
                evidence.append({"pdf_page": i, "line": line.strip()})
    strict_rights = bool(re.search(r"todos los derechos reservados|prohibida la reproducci[oó]n|permiso expreso", front, re.I))
    return {"pdf_pages": page_count, "extracted_pages": len(pages),
            "text_path": str(text_path.relative_to(REPO)),
            "pages_path": str(pages_path.relative_to(REPO)),
            "raw_whitespace_words_all_languages": sum(word_counts),
            "text_characters": len(body),
            "pages_under_20_words": sum(n < 20 for n in word_counts),
            "replacement_characters": body.count("\ufffd"),
            "extraction_method": "pdftotext -layout -enc UTF-8; no OCR; no linguistic normalization",
            "extraction_review": "needed" if sum(word_counts) < page_count * 20 or len(pages) != page_count or body.count("\ufffd") > 10 else "not_manually_reviewed",
            "front_matter_evidence": evidence,
            "minedu_text_evidence_found": bool(re.search(r"minedu|ministerio\s+de\s+educaci[oó]n|per[uú]\s+suyupi\s+yachay", front, re.I)),
            "front_matter_year_candidates": sorted(set(re.findall(r"\b(?:19|20)\d{2}\b", front))),
            "reuse_status": "explicit_restriction_detected_review_required" if strict_rights else "not_cleared_review_required",
            "quechua_only_word_count": None, "training_approved": False,
            "extractor_warning": result.stderr.strip()[:1000]}


def download_one(rid, args):
    sidecar = args.storage / "metadata" / (rid + ".json")
    old = read(sidecar, {})
    pdf = args.storage / "pdf" / (rid + ".pdf")
    if old.get("status") == "downloaded" and pdf.exists() and (REPO / old["text_path"]).exists() and (REPO / old["pages_path"]).exists():
        return old
    source = f"https://drive.usercontent.google.com/download?id={rid}&export=download"
    result = {"id": rid, "public_download_url": source,
              "public_view_url": f"https://drive.google.com/file/d/{rid}/view",
              "retrieval_host_type": "third_party_public_google_drive_mirror", "attempted_at": now()}
    try:
        pdf.parent.mkdir(parents=True, exist_ok=True)
        if not pdf.exists():
            tmp = pdf.with_suffix(".pdf.part")
            size = 0
            with urlopen(Request(source, headers={"User-Agent": UA}), timeout=120) as r, tmp.open("wb") as f:
                content_type = r.headers.get("Content-Type", "")
                while True:
                    chunk = r.read(1024 * 1024)
                    if not chunk:
                        break
                    if size == 0 and not chunk.startswith(b"%PDF-"):
                        raise ValueError("public download did not return a PDF (HTML/login/confirmation/error); not bypassed")
                    size += len(chunk)
                    if size > args.max_file_mb * 1024 * 1024:
                        raise ValueError(f"exceeds {args.max_file_mb} MiB per-file limit")
                    f.write(chunk)
            tmp.replace(pdf)
            result["content_type"] = content_type
        with pdf.open("rb") as f:
            if f.read(5) != b"%PDF-":
                raise ValueError("cached original has invalid PDF magic")
            f.seek(0)
            digest = hashlib.file_digest(f, "sha256").hexdigest()
        result.update(status="downloaded", bytes=pdf.stat().st_size, sha256=digest,
                      pdf_path=str(pdf.relative_to(REPO)), **extract(pdf, rid, args))
    except Exception as exc:
        result.update(status="failed", error=f"{type(exc).__name__}: {exc}")
        pdf.with_suffix(".pdf.part").unlink(missing_ok=True)
    dump(sidecar, result)
    return result


def download(args):
    if not shutil.which("pdfinfo") or not shutil.which("pdftotext"):
        raise SystemExit("Install Poppler (pdfinfo and pdftotext) before downloading.")
    records = read(args.catalogue / "resolved.json", [])
    ordered = sorted(records, key=lambda r: {"science_and_personal_social": 0, "glossary_dictionary": 1, "orthography": 2}.get(r["subject_label"], 3))
    ids = list(dict.fromkeys(rid for r in ordered for e in r.get("editions", []) if e["resolve_status"] == "resolved" for rid in e["drive_ids"]))
    if args.limit:
        ids = ids[:args.limit]
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        pending = {pool.submit(download_one, rid, args): rid for rid in ids}
        for n, future in enumerate(concurrent.futures.as_completed(pending), 1):
            result = future.result()
            log(processed=n, total=len(ids), id=result["id"], status=result["status"],
                pages=result.get("pdf_pages"), words=result.get("raw_whitespace_words_all_languages"),
                error=result.get("error"))
    export(args)


def export(args):
    records = read(args.catalogue / "resolved.json", [])
    resources = {p.stem: read(p, {}) for p in sorted((args.storage / "metadata").glob("*.json"))}
    sha_first = {}
    rows = []
    for rid, r in resources.items():
        if r.get("status") == "downloaded":
            r["exact_duplicate_of"] = sha_first.get(r["sha256"])
            sha_first.setdefault(r["sha256"], rid)
    for record in records:
        editions = record.get("editions", []) or [{}]
        for e in editions:
            for rid in e.get("drive_ids", []) or [""]:
                r = resources.get(rid, {})
                rows.append({"book_id": record["id"], "title": record["title"],
                             "variety_label": record["variety_label"], "subject_label": record["subject_label"],
                             "level_label": record["level_label"], "grade_candidates": ";".join(map(str, record["grade_candidates"])),
                             "grade_review_needed": record.get("grade_review_needed", False),
                             "scope": record["scope"], "discovery_url": record["discovery_url"],
                             "mirror_edition_label": e.get("mirror_edition_label", ""),
                             "mirror_year_not_verified": (re.search(r"Edición\s*(\d{4})", e.get("mirror_edition_label", ""))[1]
                                                          if re.search(r"Edición\s*(\d{4})", e.get("mirror_edition_label", "")) else ""),
                             "download_page": e.get("download_page", ""), "resource_id": rid,
                             "download_status": r.get("status", record.get("resolve_status", "pending")),
                             "pdf_path": r.get("pdf_path", ""), "text_path": r.get("text_path", ""),
                             "text_status": ("no_extractable_text_ocr_needed" if r.get("raw_whitespace_words_all_languages") == 0
                                             else "extracted_review_required" if r.get("extraction_review") == "needed"
                                             else "extracted_unreviewed" if r.get("status") == "downloaded" else "not_available"),
                             "pdf_pages": r.get("pdf_pages", ""), "bytes": r.get("bytes", ""),
                             "raw_whitespace_words_all_languages": r.get("raw_whitespace_words_all_languages", ""),
                             "sha256": r.get("sha256", ""), "exact_duplicate_of": r.get("exact_duplicate_of", ""),
                             "reuse_status": r.get("reuse_status", "not_cleared"), "training_approved": False})
    args.catalogue.mkdir(parents=True, exist_ok=True)
    if rows:
        with (args.catalogue / "catalogue.csv").open("w", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=list(rows[0]))
            writer.writeheader()
            writer.writerows(rows)
    unique = [r for r in resources.values() if r.get("status") == "downloaded" and not r.get("exact_duplicate_of")]
    groups = {}
    for field in ["variety_label", "subject_label", "level_label"]:
        by_value = {}
        for row in rows:
            r = resources.get(row["resource_id"], {})
            if r.get("status") == "downloaded":
                by_value.setdefault(row[field], {})[r["sha256"]] = r
        groups[field] = {value: {"unique_pdfs": len(items), "pdf_pages": sum(r["pdf_pages"] for r in items.values()),
                                 "raw_whitespace_words_all_languages": sum(r["raw_whitespace_words_all_languages"] for r in items.values())}
                         for value, items in sorted(by_value.items())}
    summary = {"as_of_utc": now(), "discovery_records": len(read(args.catalogue / "discovery.json", [])),
               "resolved_records": len(records), "catalogue_rows_including_editions": len(rows),
               "downloaded_resource_ids": sum(r.get("status") == "downloaded" for r in resources.values()),
               "failed_resource_ids": sum(r.get("status") == "failed" for r in resources.values()),
               "unique_pdf_sha256s": len(unique), "unique_pdf_bytes": sum(r["bytes"] for r in unique),
               "unique_pdf_pages": sum(r["pdf_pages"] for r in unique),
               "unique_pdfs_with_zero_extracted_words": sum(r["raw_whitespace_words_all_languages"] == 0 for r in unique),
               "raw_whitespace_words_all_languages": sum(r["raw_whitespace_words_all_languages"] for r in unique),
               "quechua_only_word_count": None, "training_approved_resources": 0,
               "counts_note": "Exact PDF-byte duplicates excluded. Editions and near-duplicate text NOT deduplicated. Counts include Spanish, front matter, page numbers, and exercises; these are NOT Quechua tokens. Per-label groups may overlap when duplicate books have conflicting discovery labels.",
               "rights_note": "All resources require rights review; public access and free distribution are not permission for model training. Some books explicitly restrict reproduction.",
               "group_counts": groups}
    dump(args.catalogue / "resources.json", list(resources.values()))
    dump(args.catalogue / "summary.json", summary)
    log(summary=summary)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("action", choices=["discover", "resolve", "download", "export"])
    parser.add_argument("--storage", type=Path, default=DEFAULT_STORAGE)
    parser.add_argument("--catalogue", type=Path, default=HERE)
    parser.add_argument("--workers", type=int, default=3)
    parser.add_argument("--pages", type=int, default=7)
    parser.add_argument("--limit", type=int, default=0, help="Download at most N resource IDs; 0 means all resolved public resources")
    parser.add_argument("--max-file-mb", type=int, default=150)
    args = parser.parse_args()
    args.storage = args.storage.resolve()
    args.catalogue = args.catalogue.resolve()
    if not 1 <= args.workers <= 4:
        parser.error("Use between 1 and 4 workers to keep public-host traffic modest")
    globals()[args.action](args)


if __name__ == "__main__":
    main()
