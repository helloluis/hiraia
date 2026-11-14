#!/usr/bin/env python3
"""Extract competencies directly from archived DepEd BOW PDFs. Requires pypdf.
Usage: python3 import_science.py --reference-root /path/to/hiraia [--check]
Never edits the reference checkout. Output text is PDF text with whitespace joined.
"""
import argparse
import gzip
import hashlib
import json
import re
import subprocess
from pathlib import Path
from pypdf import PdfReader
from topic_titles import short_title

VERSION = 'science-bow-2026'
DATA = Path(__file__).resolve().parents[2] / 'data'

def encode(value):
    # Match repository formatting so regeneration and prettier remain byte-identical.
    prettier = Path(__file__).resolve().parents[4] / 'node_modules/prettier/bin/prettier.cjs'
    return subprocess.run(['node', str(prettier), '--parser', 'json'], input=json.dumps(value, ensure_ascii=False), text=True, capture_output=True, check=True).stdout

def sized(pack):
    for _ in range(8):
        size = len(encode(pack).encode())
        if size == pack['bytes']:
            return pack
        pack['bytes'] = size
    raise ValueError('Pack byte size did not converge')

def extract(path, grade, source):
    records, term, active, domain, current, start_page = [], 0, False, None, [], 0
    content_column = 0
    sequence = 0
    week_cells = {}
    def flush():
        nonlocal current, sequence
        if not current:
            return
        text = ' '.join(current)
        assert term in (1, 2, 3), (grade, text)
        sequence += 1
        records.append(dict(id=f'{VERSION}.science.g{grade}.t{term}.{sequence}', code=None,
            learningAreaId='science', grade=str(grade), termIndex=term, sequence=sequence,
            text=text, textLang='en', contentStandard=None, performanceStandard=None,
            domain=domain, weight=None, weightSource='estimated',
            source=dict(document=f'DepEd Science G{grade}: 2026 Three-Term BOW',
                edition=source['edition'], page=start_page, url=source['url'])))
        current = []
    reader = PdfReader(path)
    for page_number, page in enumerate(reader.pages, 1):
        for line in page.extract_text(extraction_mode='layout').splitlines():
            stripped = line.strip()
            if not stripped or re.search(r'Page \d+ of|Last updated|Budget of Work.*Grade', stripped):
                continue
            week_match = re.match(r'^\s{0,14}(\d+)(?:\s+to\s+(\d+))?(?=\s{2,}|$)', line) if active else None
            match = re.fullmatch(r'(First|Second|Third) Term', stripped)
            if match:
                flush(); term = {'First': 1, 'Second': 2, 'Third': 3}[match[1]]; active = False; sequence = 0
                continue
            if 'Learning Competency' in line and 'Week' in line:
                flush(); active = True; continue
            if 'Suggested Activities' in line or 'Performance Standard' in line or 'Content Standard' in line:
                flush(); active = False; continue
            if not active:
                continue
            if '●' in line:
                # Activities use a far-right bullet column; LC bullets sit at the left of the LC cell.
                pos = line.index('●')
                if pos > 35:
                    flush(); active = False; continue
                flush(); text = line[pos + 1:].strip()
                content_column = pos + 4
                current = [text]; start_page = page_number
            elif current and len(line) - len(line.lstrip()) >= content_column - 1:
                current.append(stripped)
            elif current and re.match(r'^\s*\d+(?:\s+to\s+\d+)?\s+', line) and len(line) > content_column and not line[:content_column].strip().strip('0123456789 to'):
                current.append(line[content_column:].strip())
            else:
                flush()
                if stripped not in ('Week', 'Learning Competency') and not re.fullmatch(r'\d+(?: to \d+)?', stripped):
                    domain = re.sub(r'^\d+(?:\s+to\s+\d+)?\s{2,}', '', stripped)
            if week_match:
                cell = (int(week_match[1]), int(week_match[2] or week_match[1]), page_number)
                week_cells.setdefault((term, domain), []).append(cell)
    flush()
    assert records and {r['termIndex'] for r in records} == {1, 2, 3}, f'Incomplete extraction for Grade {grade}'
    assert all(5 < len(r['text']) <= 2000 and 'Suggested Activities' not in r['text'] for r in records)
    # Standards are term-level cells. Preserve their source wording, joining only layout whitespace.
    standards, current_term, mode, col = {}, 0, None, 0
    for page in reader.pages:
        for line in page.extract_text(extraction_mode='layout').splitlines():
            stripped = line.strip()
            match = re.fullmatch(r'(First|Second|Third) Term', stripped)
            if match:
                current_term = {'First': 1, 'Second': 2, 'Third': 3}[match[1]]
                standards[current_term] = {'content': [], 'performance': []}
                mode = 'content'; continue
            if not current_term or not mode or not stripped or re.search(r'Page \d+ of|Last updated|Budget of Work.*Grade', stripped):
                continue
            if 'Learning Competency' in line and 'Week' in line:
                mode = None; continue
            if 'by the end of the term' in line.lower():
                mode = 'performance'; col = line.lower().index('by the end of the term')
            elif '●' in line:
                mode = 'content'; col = line.index('●')
            if col and len(line) > col:
                text = line[col:].strip()
                if text:
                    standards[current_term][mode].append(text)
    for record in records:
        standard = standards[record['termIndex']]
        record['contentStandard'] = ' '.join(standard['content']) or None
        record['performanceStandard'] = ' '.join(standard['performance']) or None
    evidence = {}
    for record in records:
        key = (record['termIndex'], record['domain'])
        cells = week_cells.get(key)
        if not cells:
            # G10 Term 1: the merged Week 1 cell spans Chemical Reactions and
            # Acids, Bases, and Salts. Other explicit shared cells are listed below; unseen cases fail closed.
            shared = {(10, 1, 'Acids, Bases, and Salts'): 'Chemical Reactions', (5, 3, 'Conductors, Insulators, and Simple Circuits'): 'Static Electricity', (5, 3, 'Weathering and Erosion'): 'Landforms, Rocks, and Minerals', (10, 3, 'Renewable and non-renewable energy'): 'Large-scale Generation and Distribution of Electricity'}
            assert (grade, *key) in shared, (grade, key)
            cells = week_cells[(key[0], shared[(grade, *key)])]
        ranges = {(a, b) for a, b, _ in cells}
        assert len(ranges) == 1, (grade, key, ranges)
        record['weekFrom'], record['weekTo'] = next(iter(ranges))
        record['shortTitle'], record['shortTitleSource'] = short_title(record)
        evidence[key] = dict(termIndex=key[0], domain=key[1], weekFrom=record['weekFrom'], weekTo=record['weekTo'], weekColumnPages=sorted({page for _, _, page in cells}), sharedAcrossCompetencies=True)
    return records, list(evidence.values())

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--reference-root', type=Path, required=True)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    manifest_path = args.reference_root / 'rag/sources/curriculum-guides/three-term-2026/sources.json'
    sources = json.loads(manifest_path.read_text())['sources']
    provenance = {'version': VERSION, 'extractor': 'pypdf layout; whitespace-only joining; source.page is 1-based physical PDF page, not printed footer', 'sources': [], 'weekNotes': 'Week ranges are transcribed from the left Week column and apply to every competency in the corresponding merged topic cell; they are not individual competency deadlines. Shared cells also span Grade 5 Term 3 Static Electricity + Circuits (1–2) and Landforms/Rocks/Minerals + Weathering/Erosion (3–5); Grade 10 Term 1 Chemical Reactions + Acids/Bases/Salts (1); Grade 10 Term 3 Electricity Generation/Distribution + Renewable/non-renewable energy (10–11). Equal sharing of a range is a pacing heuristic, not a published per-competency duration.', 'titleNotes': 'Official labels use complete headings or a colon suffix of at most four words. All other labels use the deterministic, reviewable noun-phrase candidate table in topic_titles.py and are marked derived.'}
    outputs = {}
    for source in sources:
        path = args.reference_root / source['referenceFile']
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        assert digest == source['sha256'], f'Source PDF changed: {path.name}'
        records, week_evidence = extract(path, source['grade'], source)
        pack = sized(dict(packId=f"{VERSION}:{source['grade']}:science", curriculumVersion=VERSION,
            grade=str(source['grade']), learningAreaId='science', schoolYears=['2026-2027'],
            competencyCount=len(records), dataRevision=2, bytes=0, competencies=records))
        payload = json.dumps(pack, ensure_ascii=False, separators=(',', ':')).encode()
        assert len(payload) <= 512 * 1024, 'Pack exceeds raw sanity ceiling'
        assert len(gzip.compress(payload, compresslevel=6, mtime=0)) + 64 <= 100 * 1024, 'Pack exceeds compressed API budget including envelope'
        outputs[DATA / 'packs' / f"{VERSION}-g{source['grade']}.json"] = encode(pack)
        provenance['sources'].append({**source, 'competencyCount': len(records), 'weekCells': week_evidence, 'terms': {str(t): sum(r['termIndex'] == t for r in records) for t in [1, 2, 3]}})
        print(f"Grade {source['grade']}: {len(records)} competencies, {pack['bytes']} bytes")
    outputs[DATA / 'science-provenance.json'] = encode(provenance)
    for path, content in outputs.items():
        if args.check:
            assert path.read_text() == content, f'Generated data is stale: {path.name}'
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content)

if __name__ == '__main__':
    main()
