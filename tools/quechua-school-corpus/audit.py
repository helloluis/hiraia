#!/usr/bin/env python3
"""Offline checks and a local browsing index for the collected school materials.

Run after collect.py export. Counts are raw extracted words, not Quechua tokens.
Duplicate-page comparison collapses whitespace ONLY for the overlap measurement;
it never rewrites original PDFs or extracted text, or merges training examples.
"""

import collections
import csv
import hashlib
import json
from pathlib import Path

from collect import HERE, REPO, dump, now


def write_csv(path, rows):
    if not rows:
        return
    with path.open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def main():
    resources = json.loads((HERE / "resources.json").read_text())
    records = json.loads((HERE / "resolved.json").read_text())
    summary = json.loads((HERE / "summary.json").read_text())
    by_id = {r["id"]: r for r in resources}
    title_by_id = collections.defaultdict(list)
    for b in records:
        for e in b.get("editions", []):
            for rid in e["drive_ids"]:
                title_by_id[rid].append(b["title"])

    unique = [r for r in resources if r.get("status") == "downloaded" and not r.get("exact_duplicate_of")]
    page_owners = collections.defaultdict(list)
    page_words = {}
    text_owners = collections.defaultdict(list)
    issues = []
    ocr_needed = []
    extracted_pages = 0
    total_words = 0
    for r in unique:
        pdf = REPO / r["pdf_path"]
        with pdf.open("rb") as f:
            assert f.read(5) == b"%PDF-", pdf
            f.seek(0)
            assert hashlib.file_digest(f, "sha256").hexdigest() == r["sha256"], pdf
        text_path = REPO / r["text_path"]
        text = text_path.read_text()
        if r["raw_whitespace_words_all_languages"] == 0:
            ocr_needed.append({"resource_id": r["id"], "titles": title_by_id[r["id"]],
                               "pdf_path": r["pdf_path"], "pdf_pages": r["pdf_pages"],
                               "status": "requires_ocr_and_language_review"})
        if text.strip():
            text_owners[hashlib.sha256(text.encode()).hexdigest()].append(r["id"])
        pages = [json.loads(line) for line in (REPO / r["pages_path"]).read_text().splitlines()]
        assert sum(len(p["text"].split()) for p in pages) == r["raw_whitespace_words_all_languages"], r["id"]
        assert [p["pdf_page"] for p in pages] == list(range(1, len(pages) + 1)), r["id"]
        if len(pages) != r["pdf_pages"]:
            issues.append({"resource_id": r["id"], "issue": "extracted_page_count_mismatch"})
        for p in pages:
            # Only whitespace folding: retain letters, accents, case, apostrophes,
            # punctuation, numbers and mathematical symbols in the comparison.
            normalized = " ".join(p["text"].split())
            digest = hashlib.sha256(normalized.encode()).hexdigest()
            page_owners[digest].append((r["id"], p["pdf_page"]))
            page_words[digest] = len(normalized.split())
            total_words += len(normalized.split())
            extracted_pages += 1
        if r["extraction_review"] == "needed":
            issues.append({"resource_id": r["id"], "issue": "sparse_or_suspect_text_requires_review",
                           "note": "Sparse illustrated workbooks may be valid; this does not establish an OCR failure."})
        if not r["minedu_text_evidence_found"]:
            issues.append({"resource_id": r["id"], "issue": "minedu_publisher_not_detected_in_first_eight_pages"})

    pair_pages = collections.Counter()
    for digest, owners in page_owners.items():
        if page_words[digest] < 30:
            continue
        ids = sorted(set(rid for rid, _ in owners))
        for i, left in enumerate(ids):
            for right in ids[i + 1:]:
                pair_pages[left, right] += 1
    overlaps = []
    for (left, right), shared in pair_pages.most_common():
        fraction = shared / min(by_id[left]["pdf_pages"], by_id[right]["pdf_pages"])
        if shared >= 10 and fraction >= 0.20:
            overlaps.append({"left_resource": left, "right_resource": right,
                             "left_title": title_by_id[left][0], "right_title": title_by_id[right][0],
                             "shared_pages_at_least_30_words": shared,
                             "fraction_of_shorter_pdf_pages": round(fraction, 4)})
    write_csv(HERE / "edition-overlap-review.csv", overlaps)
    audit = {"as_of_utc": now(), "unique_pdfs_verified": len(unique),
             "extracted_pages_verified": extracted_pages,
             "raw_whitespace_words_all_languages": total_words,
             "unique_page_texts_whitespace_folded": len(page_owners),
             "words_after_exact_page_text_dedup_all_languages": sum(page_words.values()),
             "exact_extracted_document_duplicate_groups": [ids for ids in text_owners.values() if len(ids) > 1],
             "edition_overlap_candidate_pairs": len(overlaps), "review_flags": issues,
             "method_note": "PDF SHA-256 checked; page records and word totals checked. Overlap uses whitespace folding only, preserves spelling and punctuation, and does not change source text. Different editions may still overlap even when pages differ. No language purity, scientific accuracy, native fluency, or reuse permission has been certified."}
    dump(HERE / "audit.json", audit)
    dump(HERE / "ocr-needed.json", ocr_needed)

    rows = list(csv.DictReader((HERE / "catalogue.csv").open()))
    science = [r for r in rows if r["subject_label"] == "science_and_personal_social" and r["download_status"] == "downloaded"]
    write_csv(HERE / "science-downloaded.csv", science)
    leads = json.loads((HERE / "official-url-leads-2022.json").read_text())
    acquired_keys = {(r["variety_label"], r["grade_candidates"]) for r in science if r["download_status"] == "downloaded"}
    gaps = []
    for r in leads:
        if r["subject_label"] != "science_and_personal_social":
            continue
        grade = ";".join(map(str, r["grade_candidates"]))
        if (r["variety_label"], grade) not in acquired_keys:
            gaps.append({"title": r["title"], "variety_label": r["variety_label"],
                         "grade_candidates": grade, "official_pdf_url": r["official_pdf_urls"][0],
                         "discovery_url": r["discovery_url"], "retrieval_status": r["retrieval_status"]})
    write_csv(HERE / "science-acquisition-gaps.csv", gaps)

    # Local static index: no external assets, services or text upload.
    payload = json.dumps(rows, ensure_ascii=False).replace("<", "\\u003c").replace("&", "\\u0026")
    subtitle = (f'{len(unique):,} distinct PDF files · {summary["unique_pdf_pages"]:,} pages · '
                f'{total_words:,} raw words across all languages')
    template = """<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Quechua school-material collection — Hiraia research</title>
<style>
body{font:16px/1.5 system-ui,sans-serif;max-width:1500px;margin:32px auto;padding:0 24px;color:#172a2b;background:#f6f8f6}
h1{font-size:28px;margin-bottom:6px}p{max-width:1000px}a{color:#075b74}small{display:block;color:#526365}
.controls{display:flex;flex-wrap:wrap;gap:10px;position:sticky;top:0;padding:12px 0;background:#f6f8f6}
input,select{font:inherit;padding:8px;border:1px solid #aebdbc;border-radius:5px}input{min-width:300px;flex:1}
table{width:100%;border-collapse:collapse;background:white}th,td{text-align:left;padding:12px;vertical-align:top;border-bottom:1px solid #dce4e1}th{background:#e8efea}td:first-child{max-width:540px}td:last-child{min-width:110px}button{font:inherit;padding:7px}
</style>
<h1>Quechua school-material collection</h1>
<p><b>SUBTITLE</b></p>
<p>Research copies of school materials attributed to Peru’s MINEDU. PDFs were retrieved through public mirrors; each row retains its source. Variety, grade, and edition labels come from the catalogue and need review. These counts include Spanish, front matter and exercises. Editions can overlap. <b>This collection is not cleared for training.</b></p>
<p><a href="catalogue.csv">CSV catalogue</a> · <a href="summary.json">Counts and scope</a> · <a href="science-downloaded.csv">Science books</a> · <a href="science-acquisition-gaps.csv">Missing science books</a> · <a href="edition-overlap-review.csv">Edition overlap</a> · <a href="audit.json">Extraction audit</a></p>
<div class="controls"><input id="query" placeholder="Search title, variety, grade or edition" aria-label="Search"><select id="variety" aria-label="Variety"></select><select id="subject" aria-label="Subject"></select><select id="level" aria-label="Level"></select><button id="science">Science only</button></div>
<p id="count"></p><table><thead><tr><th>Title and source</th><th>Variety / level / grade</th><th>Edition / size</th><th>Files</th></tr></thead><tbody id="body"></tbody></table>
<script id="data" type="application/json">PAYLOAD</script>
<script>
const rows=JSON.parse(document.getElementById('data').textContent);
const el=id=>document.getElementById(id), pretty=s=>s.replaceAll('_',' ');
for(const [id,field,name] of [['variety','variety_label','All varieties'],['subject','subject_label','All subjects'],['level','level_label','All levels']]){
 const o=document.createElement('option');o.value='';o.textContent=name;el(id).append(o);
 for(const val of [...new Set(rows.map(r=>r[field]))].sort()){const o=document.createElement('option');o.value=val;o.textContent=pretty(val);el(id).append(o);}
 el(id).addEventListener('change',render);
}
function link(parent,label,url){const a=document.createElement('a');a.textContent=label;a.href=url;parent.append(a);}
function small(parent,text){const s=document.createElement('small');s.textContent=text;parent.append(s);}
function render(){
 const q=el('query').value.toLowerCase();
 const shown=rows.filter(r=>(!q||[r.title,r.variety_label,r.grade_candidates,r.mirror_edition_label].join(' ').toLowerCase().includes(q))&&(!el('variety').value||r.variety_label===el('variety').value)&&(!el('subject').value||r.subject_label===el('subject').value)&&(!el('level').value||r.level_label===el('level').value));
 el('count').textContent=shown.length+' catalogue rows (editions and aliases may repeat a file)';el('body').replaceChildren();
 const frag=document.createDocumentFragment();
 for(const r of shown){const tr=document.createElement('tr'),a=document.createElement('td'),b=document.createElement('td'),c=document.createElement('td'),d=document.createElement('td');
 link(a,r.title,r.discovery_url);small(a,pretty(r.subject_label));
 b.textContent=pretty(r.variety_label);small(b,pretty(r.level_label)+(r.grade_candidates?' · Grade '+r.grade_candidates:''));
 c.textContent=r.mirror_edition_label;small(c,r.pdf_pages?r.pdf_pages+' PDF pages · '+Number(r.raw_whitespace_words_all_languages).toLocaleString()+' raw words':r.download_status);
 if(r.download_status==='downloaded'){link(d,'PDF','../../'+r.pdf_path);if(Number(r.raw_whitespace_words_all_languages)>0){d.append(document.createTextNode(' · '));link(d,'Text','../../'+r.text_path);}else small(d,'Needs OCR');if(r.exact_duplicate_of)small(d,'Exact duplicate');}else d.textContent=r.download_status;
 small(d,pretty(r.reuse_status));tr.append(a,b,c,d);frag.append(tr);
 }el('body').append(frag);
}
el('query').addEventListener('input',render);el('science').addEventListener('click',()=>{el('subject').value='science_and_personal_social';render();});render();
</script></html>"""
    (HERE / "index.html").write_text(template.replace("SUBTITLE", subtitle).replace("PAYLOAD", payload))
    print(json.dumps({"unique_pdfs_verified": len(unique), "raw_words_all_languages": total_words,
                      "words_after_page_dedup_all_languages": sum(page_words.values()),
                      "overlap_pairs": len(overlaps), "science_gaps": len(gaps),
                      "review_flags": len(issues)}, indent=2))


if __name__ == "__main__":
    main()
