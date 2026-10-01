#!/usr/bin/env python3
"""Audit reviewed draft knowledge links against actual lesson shelves, not topic labels.

Counts are optimistic capacity bounds: all linked knowledge is assumed encountered.
No timestamps, student histories, difficulty or production eligibility are invented.
"""
import csv
import hashlib
import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'rag/assessment-authoring'


def coverage(card_ids, links):
    rows = {i['id']: i for cid in set(card_ids) for i in links.get(cid, [])}
    return dict(linked_cards=sum(bool(links.get(cid)) for cid in set(card_ids)),
                candidate_items=len(rows),
                knowledge_families_upper_bound=len({i['relationships']['knowledge_family_id'] for i in rows.values()}),
                item_ids=sorted(rows))


def main():
    source_files = {}

    def read(path):
        raw = path.read_bytes()
        source_files[str(path.relative_to(ROOT))] = hashlib.sha256(raw).hexdigest()
        return json.loads(raw)

    items = [i for p in sorted((OUT/'batches').glob('*.json')) if not p.name.endswith('.validation.json')
             for i in read(p)['items']]
    core = read(ROOT/'rag/pipeline/cardsPool.app.json')['cards']
    core_ids = {c['id'] for c in core}
    all_links = defaultdict(list)
    for item in items:
        if item['status'] not in ('hold', 'retired'):
            for cid in item['eligibility']['recent_learning']['source_card_ids']:
                all_links[cid].append(item)
    summaries, lessons = [], []
    for grade in range(3, 11):
        manifest = read(ROOT/f'packages/mobile/src/generated/grade{grade}Lessons.generated.json')
        supplement = read(ROOT/f'packages/mobile/src/data/grade{grade}LessonSupplement.json')
        known_ids = core_ids | {c['id'] for c in supplement['cards']}
        # Material at or below the enrolled grade; no automatic cross-grade eligibility.
        links = {cid: [i for i in rows if i['scope']['material_grade'] <= grade]
                 for cid, rows in all_links.items()}
        shelf_ids = set()
        grade_rows = []
        for lesson in manifest['lessons']:
            ids = set(lesson['cardIds']) & known_ids
            shelf_ids |= ids
            row = dict(grade=grade, lesson=lesson['key'], title=lesson['title']['en'],
                       quarter=lesson['quarter'], shelf_cards=len(ids), **coverage(ids, links))
            row['core_knowledge_families_upper_bound'] = coverage(set(lesson['coreCardIds']) & known_ids, links)['knowledge_families_upper_bound']
            grade_rows.append(row)
        full = coverage(shelf_ids, links)
        windows = {}
        for size in (1, 2, 4):
            caps = [coverage(set().union(*(set(l['cardIds']) & known_ids for l in manifest['lessons'][start:start+size])), links)['knowledge_families_upper_bound']
                    for start in range(max(0, len(grade_rows)-size+1))]
            windows[str(size)] = dict(windows=len(caps), at_least_six_upper_bound=sum(n >= 6 for n in caps),
                                     minimum=min(caps) if caps else None, maximum=max(caps) if caps else None)
        summaries.append(dict(grade=grade, lessons=len(grade_rows), shelf_cards=len(shelf_ids),
                              **full, lessons_without_any_link=sum(r['candidate_items'] == 0 for r in grade_rows),
                              lesson_window_capacity=windows))
        lessons.extend(grade_rows)
    # Known controls: repeated exposures/cards and alternate items do not multiply families.
    fake = lambda ident, fam: dict(id=ident, relationships=dict(knowledge_family_id=fam))
    a, b = fake('a', 'same'), fake('b', 'same')
    assert coverage(['c', 'c'], {'c': [a, b]})['knowledge_families_upper_bound'] == 1
    assert coverage(['different-card'], {'c': [a]})['candidate_items'] == 0
    assert coverage(['c', 'd'], {'c': [a], 'd': [a]})['candidate_items'] == 1
    assert coverage([], {'c': [a]})['linked_cards'] == 0
    report = dict(created_at=datetime.now(timezone.utc).isoformat(timespec='seconds'), source_files=source_files,
                  draft_items=len(items), core_cards=len(core),
                  linked_core_cards=len(core_ids & all_links.keys()),
                  production_eligible_items=sum(i['production_ready'] for i in items),
                  controls_passed=4, grades=summaries, lessons=lessons,
                  limits=[
                      'Only explicitly reviewed source-card/knowledge links count. Related topics, tags, fact suffixes and source snapshots alone do not add eligible links.',
                      'Non-held drafts are counted for planning; no item is approved for a student.',
                      'All cards in a shelf/window are hypothetically encountered. This is an optimistic upper bound, not a prediction of ordinary app usage.',
                      'The feed can navigate topics and apply weights; lesson order does not establish elapsed time or actual knowledge exposure.',
                      'Six families do not guarantee a valid form: duplicate source facts, benchmark overlap, history and language/coverage gates can reduce availability.',
                      'One, two and four lesson windows are content breadth scenarios, not assertions about how many lessons a learner completes in fourteen days.'
                  ])
    (OUT/'exposure-link-audit.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
    with (OUT/'exposure-link-audit.csv').open('w', newline='') as f:
        fields = [k for k in lessons[0] if k != 'item_ids']
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader(); writer.writerows({k:r[k] for k in fields} for r in lessons)
    lines = ['# Assessment links to actual lesson shelves', '', f'Generated: {report["created_at"]}', '',
             f'{report["linked_core_cards"]} of {len(core)} core cards have an explicit non-held draft assessment knowledge link. Production-eligible items: **0**.', '',
             'The curated rotation fixtures cannot establish availability after ordinary app use. These counts use the shipping lesson shelves and the explicitly recorded card links; they do not invent student histories.', '',
             '| Student grade | Lessons | Shelf cards | Cards with links | Lessons with no link | Single lessons with ≥6 families (upper bound) |',
             '|---|---:|---:|---:|---:|---:|']
    for r in summaries:
        lines.append(f'| {r["grade"]} | {r["lessons"]} | {r["shelf_cards"]} | {r["linked_cards"]} | {r["lessons_without_any_link"]} | {r["lesson_window_capacity"]["1"]["at_least_six_upper_bound"]} |')
    lines += ['', 'The recent-learning pool needs both broad question coverage and reviewed equivalent teaching-card links. Adding stems alone will not solve a sparse exposure link graph. Inspect every proposed link for the same tested claim and required conditions in each language; a keyword or competency match is insufficient.', '',
              'Use actual fourteen-day, profile-scoped knowledge exposures when implementing selection. Report the eligible recent count and its denominator honestly. Readiness supplements provide a usable quiz when permitted, but do not count as recent retention.', '',
              'Scope and limits:', ''] + ['- '+x for x in report['limits']]
    lines += ['', 'Full per-lesson records: [CSV](exposure-link-audit.csv), [JSON](exposure-link-audit.json). Four counting controls pass.', '']
    (OUT/'exposure-link-audit.md').write_text('\n'.join(lines))
    print(json.dumps({k:report[k] for k in ('draft_items','core_cards','linked_core_cards','production_eligible_items','controls_passed')}))
    print(json.dumps([{k:r[k] for k in ('grade','lessons','shelf_cards','linked_cards','lessons_without_any_link','lesson_window_capacity')} for r in summaries]))


if __name__ == '__main__':
    main()
