#!/usr/bin/env python3
"""Build explicitly synthetic demo packs and unverified, editable calendar defaults."""
import json
from pathlib import Path
from import_science import sized, encode
DATA = Path(__file__).resolve().parents[2] / 'data'
for grade in [2, 3, 4, 5]:
    version = 'fixture-demo-v1'
    competencies = []
    for term in [1, 2, 3]:
        for sequence, domain in enumerate(['Objects', 'Living things', 'Movement', 'Our surroundings'], 1):
            competencies.append(dict(id=f'{version}.mathematics.g{grade}.t{term}.{sequence}',
                code=None, learningAreaId='mathematics', grade=str(grade), termIndex=term, sequence=sequence,
                text=f'SAMPLE DATA ONLY — Grade {grade}: describe and compare a small collection of {domain.lower()}.',
                textLang='en', contentStandard=None, performanceStandard=None, domain=domain, weight=None,
                shortTitle=f'Sample {domain.lower()}', shortTitleSource='derived',
                weightSource='estimated', source=dict(document='Synthetic Tala demo fixture; NOT a DepEd competency', edition='fixture-v1', page=None, url=None)))
    pack = sized(dict(packId=f'{version}:{grade}:mathematics', curriculumVersion=version, grade=str(grade),
        learningAreaId='mathematics', schoolYears=['2026-2027', '2027-2028'], competencyCount=len(competencies), dataRevision=2, bytes=0, competencies=competencies))
    (DATA/'fixtures'/f'demo-g{grade}.json').write_text(encode(pack))
for start in [2026, 2027]:
    # These are sample editable dates, deliberately not attributed to an official order.
    preset = dict(id=f'deped-{start}-{start+1}', version='provisional-1', label=f'SY {start}–{start+1} — provisional dates', provisional=True,
        startDate=f'{start}-06-01', endDate=f'{start+1}-03-31', terms=[
            dict(index=1, name='Term 1 (provisional)', startDate=f'{start}-06-01', endDate=f'{start}-09-11'),
            dict(index=2, name='Term 2 (provisional)', startDate=f'{start}-09-14', endDate=f'{start}-12-18'),
            dict(index=3, name='Term 3 (provisional)', startDate=f'{start+1}-01-04', endDate=f'{start+1}-03-31')], days=[],
        source='Unverified editable sample dates; no DepEd school-calendar order has been verified. Confirm all dates, holidays and term boundaries with your school.')
    (DATA/'calendars'/f'deped-{start}-{start+1}.json').write_text(encode(preset))
