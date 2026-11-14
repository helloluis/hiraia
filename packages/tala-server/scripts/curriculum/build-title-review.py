#!/usr/bin/env python3
"""Repeatably update the title review section after importing/building packs."""
import argparse
import json
import gzip
from pathlib import Path
DATA = Path(__file__).resolve().parents[2] / 'data'
START = '<!-- BEGIN GENERATED TITLE REVIEW -->'
END = '<!-- END GENERATED TITLE REVIEW -->'
def render():
    packs = [json.loads(p.read_text()) for folder in ['packs', 'fixtures'] for p in sorted((DATA/folder).glob('*.json'))]
    rows = ['## Topic title review (data revision 2)', '', 'Short titles are UI labels only; competency text and source citations are unchanged.',
        'Official labels are complete headings or a colon suffix of 1–4 words. Derived Science',
        'labels use the explicit noun-phrase candidate table in `scripts/curriculum/topic_titles.py`:',
        'choose the first phrase found in the competency, otherwise the domain fallback. All',
        'fixture labels are derived and retain “Sample”. The table below lists **every** derived',
        'label for human review; it is not a claim that these labels are DepEd wording.', '',
        'Week ranges come from merged Week-column cells and are repeated for each competency',
        'within that cell. Physical source pages for the week cells are recorded separately in',
        '`science-provenance.json` → `sources[].weekCells`. Four cells span headings: G5 T3',
        'Static Electricity/Circuits (1–2), Landforms/Weathering (3–5), G10 T1 Chemical',
        'Reactions/Acids (1), and G10 T3 Electricity/Renewable Energy (10–11). These were',
        'visually checked against the PDFs. Fixture weeks are unknown and remain omitted.', '',
        'Payload sizes below measure compact pack-file JSON and gzip at default level 6.',
        'PRD §14.1 limits compressed responses to 100 KiB; tests also enforce a 512 KiB raw',
        'sanity ceiling. The existing pack `bytes` field remains the formatted JSON file size.',
        'Every Science competency keeps its full document title, edition, page and URL.',
        'The real-route tests gzip the exact HTTP response text with node:zlib defaults.', '',
        '| Pack | Official titles | Derived titles | With week data | Raw JSON bytes | Gzip bytes |', '| --- | ---: | ---: | ---: | ---: | ---: |']
    for p in packs:
        cs=p['competencies'];payload=json.dumps(p,ensure_ascii=False,separators=(',',':')).encode();rows.append(f"| {p['packId']} | {sum(c['shortTitleSource']=='official' for c in cs)} | {sum(c['shortTitleSource']=='derived' for c in cs)} | {sum('weekFrom' in c for c in cs)} | {len(payload)} | {len(gzip.compress(payload,compresslevel=6,mtime=0))} |")
    rows+=['', '| Competency ID | Derived title | Source competency text |', '| --- | --- | --- |']
    def esc(s):return s.replace('|', '\\|').replace('\n',' ')
    for p in packs:
        for c in p['competencies']:
            if c['shortTitleSource']=='derived': rows.append(f"| {c['id']} | {esc(c['shortTitle'])} | {esc(c['text'])} |")
    return '\n'.join(rows)
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--check',action='store_true');args=parser.parse_args()
    path=DATA/'README.md'; old=path.read_text(); prefix=old.split(START)[0].rstrip()
    new=prefix+'\n\n'+START+'\n'+render()+'\n'+END+'\n'
    if args.check:assert old==new, 'Title review is stale'
    else:path.write_text(new)
