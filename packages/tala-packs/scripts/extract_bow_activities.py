#!/usr/bin/env python3
"""Extract DepEd's printed term-level "Suggested Activities" and "Suggested Performance Tasks" from the archived
2026 Three-Term Science Budgets of Work (Grades 3-10), verbatim, with physical page numbers.

Method: `pdftotext -bbox-layout` gives one text block per table cell. A label block ("Suggested Activities",
"Suggested Performance Tasks") sits vertically centred in its row; the content block in the right-hand column whose
vertical extent contains the label's centre is that row's content. A content block at the top of the next page
with no label beside it continues the previous page's last row. Term boundaries come from the printed
"First/Second/Third Term" headings. Text is kept as printed (layout whitespace joined; U+200B/U+FEFF/U+00AD removed).
"""
from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PKG = HERE.parent
REPO = PKG.parent.parent
SRC = REPO / 'rag/sources/curriculum-guides/three-term-2026'
OUT = PKG / 'data/curriculum/science-bow-2026-activities.json'
TERMS = {'First Term': 1, 'Second Term': 2, 'Third Term': 3}
INVISIBLE = dict.fromkeys(map(ord, '​﻿­'))


def clean(s: str) -> str:
    return re.sub(r'\s+', ' ', html.unescape(s).translate(INVISIBLE)).strip()


def blocks_of(pdf: Path, page: int):
    xml = subprocess.run(
        ['pdftotext', '-bbox-layout', '-f', str(page), '-l', str(page), str(pdf), '-'],
        capture_output=True, text=True, check=True,
    ).stdout
    out = []
    for x0, y0, x1, y1, inner in re.findall(
        r'<block xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)</block>', xml, re.S
    ):
        lines = []
        for ly0, line in re.findall(r'<line xMin="[\d.]+" yMin="([\d.]+)"[^>]*>(.*?)</line>', inner, re.S):
            words = re.findall(r'<word[^>]*>(.*?)</word>', line)
            lines.append((float(ly0), clean(' '.join(words))))
        out.append({'x0': float(x0), 'y0': float(y0), 'x1': float(x1), 'y1': float(y1), 'lines': [t for _, t in lines],
                    'ly': [y for y, _ in lines], 'text': clean(' '.join(t for _, t in lines))})
    # Some pages print bullet glyphs as their own blocks beside the text: fold them back in as line prefixes.
    glyphs = [b for b in out if b['text'] in ('●', '○')]
    rest = [b for b in out if b['text'] not in ('●', '○')]
    for g in glyphs:
        host = next((b for b in rest if b['x0'] > g['x0'] and b['y0'] - 2 <= g['y0'] <= b['y1'] + 2), None)
        if not host:
            continue
        i = min(range(len(host['ly'])), key=lambda k: abs(host['ly'][k] - g['y0']))
        if not host['lines'][i].startswith(('●', '○')):
            host['lines'][i] = g['text'] + ' ' + host['lines'][i]
        host['text'] = clean(' '.join(host['lines']))
    return rest


def page_count(pdf: Path) -> int:
    info = subprocess.run(['pdftotext', '-layout', str(pdf), '-'], capture_output=True, text=True, check=True).stdout
    return info.count('\f') or 1


def split_items(lines: list[str]) -> list[str]:
    """Top-level bullets become items; sub-bullets (○) stay inside their parent item, joined with '; '."""
    items: list[list[str]] = []
    for raw in lines:
        line = raw.strip()
        if not line:
            continue
        if line.startswith('●'):
            items.append([line.lstrip('● ').strip()])
        elif line.startswith('○'):
            if items:
                items[-1].append('• ' + line.lstrip('○ ').strip())
        elif items:
            items[-1].append(line)
        else:
            items.append([line])
    result = []
    for parts in items:
        text = ''
        for p in parts:
            if p.startswith('• '):
                text = text.rstrip() + ('; ' if not text.rstrip().endswith(':') else ' ') + p[2:]
            else:
                text = (text + ' ' + p).strip()
        result.append(re.sub(r'\s+', ' ', text).strip())
    return [r for r in result if r]


def extract(pdf: Path):
    n = page_count(pdf)
    term = None
    sections: dict[int, dict] = {}
    last = None  # (term, kind) of the last content row seen
    for page in range(1, n + 1):
        blocks = blocks_of(pdf, page)
        heading = next((TERMS[b['text']] for b in blocks if b['text'] in TERMS), None)
        labels = [b for b in blocks if b['x0'] < 240 and b['text'].startswith('Suggested ')]
        contents = [b for b in blocks if b['x0'] > 240 and not b['text'].startswith('Page ')]
        used = set()
        # 1. A right-column block at the top of the page, before any new label row, continues the last row.
        if last and heading is None:
            for c in sorted(contents, key=lambda b: b['y0']):
                if c['y0'] > 140:
                    break
                if any(c['y0'] - 2 <= (lab['y0'] + lab['y1']) / 2 <= c['y1'] + 2 for lab in labels):
                    break  # a label row of its own: not a continuation
                cont = split_items(c['lines'])
                rows = sections[last[0]][last[1]]
                if c['lines'] and not c['lines'][0].startswith('●') and rows:
                    first, *more = cont
                    rows[-1] = (rows[-1] + ' ' + first).strip()
                    rows += more
                else:
                    rows += cont
                sections[last[0]]['pages'].add(page)
                used.add(id(c))
        if heading is not None:
            term = heading
            last = None
        # 2. Label rows: the content block whose extent contains the label's centre (else the most overlapping).
        for lab in labels:
            kind = 'suggestedActivities' if lab['text'].startswith('Suggested Activities') else 'performanceTasks'
            cy = (lab['y0'] + lab['y1']) / 2
            free = [c for c in contents if id(c) not in used]
            match = [c for c in free if c['y0'] - 2 <= cy <= c['y1'] + 2]
            if len(match) != 1:
                overlap = lambda c: min(c['y1'], lab['y1']) - max(c['y0'], lab['y0'])
                match = sorted([c for c in free if overlap(c) > 0], key=overlap, reverse=True)[:1]
            if len(match) != 1:
                raise RuntimeError(f'{pdf.name} p{page}: no content block beside "{lab["text"]}"')
            c = match[0]
            used.add(id(c))
            sec = sections.setdefault(term, {'suggestedActivities': [], 'performanceTasks': [], 'pages': set()})
            sec[kind] += split_items(c['lines'])
            sec['pages'].add(page)
            last = (term, kind)
    return sections


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=str(OUT))
    args = ap.parse_args()
    sources = json.loads((SRC / 'sources.json').read_text())['sources']
    doc = {
        'version': 1,
        'curriculumVersion': 'science-bow-2026',
        'method': 'pdftotext -bbox-layout cell blocks; label row centre inside the right-hand content block',
        'grades': {},
    }
    problems = []
    for g in range(3, 11):
        pdf = SRC / f'grade-{g}-science.pdf'
        meta = next(s for s in sources if s['grade'] == g)
        digest = hashlib.sha256(pdf.read_bytes()).hexdigest()
        if digest != meta['sha256']:
            problems.append(f'grade {g}: archived PDF hash differs from sources.json')
            continue
        secs = extract(pdf)
        doc['grades'][str(g)] = {
            'source': {'document': meta['title'], 'edition': meta['edition'], 'url': meta['url'], 'sha256': digest},
            'terms': {
                str(t): {
                    'suggestedActivities': s['suggestedActivities'],
                    'performanceTasks': s['performanceTasks'],
                    'pages': sorted(s['pages']),
                }
                for t, s in sorted(secs.items())
            },
        }
        for t in (1, 2, 3):
            s = secs.get(t)
            if not s or not s['suggestedActivities'] or not s['performanceTasks']:
                problems.append(f'grade {g} term {t}: missing activities or tasks')
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(doc, ensure_ascii=False, indent=1) + '\n')
    for g, d in doc['grades'].items():
        print(g, {t: (len(v['suggestedActivities']), len(v['performanceTasks']), v['pages']) for t, v in d['terms'].items()})
    if problems:
        print('PROBLEMS:\n  ' + '\n  '.join(problems), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
