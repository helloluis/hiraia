#!/usr/bin/env python3
"""Prove the final local alignment against its pinned pre-change documents."""
import argparse
import copy
import hashlib
import json
from pathlib import Path
import sqlite3
import subprocess
import sys

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
BASE = ROOT/'build/cebuano-curriculum-alignment/baseline'
sys.path.insert(0, str(ROOT/'rag/pipeline'))
from card_language_patches import apply_patches, load_registry
from card_retirement import exclude_retired_cards, assert_no_retired_cards
from content_corrections import correct_cards, corrections
from apply_review import prepare


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def read(path):
    return json.loads(path.read_bytes())


def pin(path):
    raw = path.read_bytes()
    return dict(path=str(path.relative_to(ROOT)), bytes=len(raw), sha256=sha(raw))


def original(file):
    path = BASE/file
    return path.read_bytes() if path.exists() else subprocess.check_output(['git', 'show', 'HEAD:'+file], cwd=ROOT)


def jsonl(raw):
    return [json.loads(line) for line in raw.splitlines() if line.strip()]


def verify():
    manifest = read(HERE/'import-001.json')
    for entry in manifest['baseline']:
        raw = original(entry['path'])
        assert (sha(raw), len(raw)) == (entry['sha256'], entry['bytes']), entry['path']
    plan = read(HERE/'reviewed-edits-001.json')
    raw_sources = {file: original(file) for file in plan['source_pins']}
    before, expected_sources = prepare(plan, raw_sources)
    for file, expected in expected_sources.items():
        assert read(ROOT/file) == expected, f'Unexpected curriculum edit: {file}'

    baseline_pool = read(BASE/'rag/pipeline/cardsPool.app.json')
    expected_pool = copy.deepcopy(baseline_pool)
    expected_pool['cards'] = apply_patches(exclude_retired_cards(expected_pool['cards']))
    correct_cards(expected_pool['cards'])
    pool = read(ROOT/'rag/pipeline/cardsPool.app.json')
    assert pool == expected_pool, 'Whole-pool difference outside approved changes'
    cards = pool['cards']
    by_id = {c['id']: c for c in cards}
    baseline_by_id = {c['id']: c for c in baseline_pool['cards']}
    assert len(cards) == len(by_id) == 49155
    assert_no_retired_cards(cards)
    assert apply_patches(cards, require_applied=True) == cards
    assert len(load_registry()) == 3986
    holds = ['ffct-15686', 'ffct-24184', 'ffct-24823', 'ffct-08459', 'ffct-09018', 'ffct-10152', 'ffct-18958', 'ffct-34595']
    for cid in holds:
        assert by_id[cid] == baseline_by_id[cid], f'Mandatory hold changed: {cid}'

    changes = {row['factId']: row for row in corrections()}
    bank_counts = {}
    for name, key in [('science-facts.jsonl', 'id'), ('quiz-bank.jsonl', 'factId')]:
        old = jsonl(original('rag/bank/'+name))
        new = jsonl((ROOT/'rag/bank'/name).read_bytes())
        expected = copy.deepcopy(old)
        for row in expected:
            patch = changes.get(row[key])
            if not patch or 'fact' not in patch:
                continue
            if key == 'id':
                row['fact'] = patch['fact']
                if 'topic' in patch:
                    row['topic'] = patch['topic']
            elif 'question' in patch:
                q = patch['question']
                row.update(q=q['q'], options=q['o'], answer=q['a'], explanation=q['e'], difficulty=q['d'])
        assert expected == new, f'Unrelated bank edit: {name}'
        bank_counts[name] = dict(rows=len(new), changed_rows=sum(a != b for a, b in zip(old, new)))

    decisions = read(HERE/'assessment-link-decisions-001.json')
    authored = {file: read(ROOT/file) for file in decisions['source_pins']}
    inverse = copy.deepcopy(authored)
    for operation in reversed(decisions['operations']):
        parent = inverse[operation['file']]
        for key in operation['keys'][:-1]:
            parent = parent[key]
        key = operation['keys'][-1]
        assert parent[key] == operation['after'], operation['keys']
        if operation.get('before_absent'):
            del parent[key]
        else:
            parent[key] = operation['before']
    for file, document in inverse.items():
        raw = original(file)
        assert sha(raw) == decisions['source_pins'][file]
        assert document == json.loads(raw), f'Unreviewed assessment mutation: {file}'
        old_items = {item['id']: item for item in document['items']}
        for item in authored[file]['items']:
            old = old_items[item['id']]
            for field in ('content', 'review', 'status', 'production_ready', 'scope', 'relationships', 'eligibility'):
                assert item.get(field) == old.get(field), (item['id'], field)
    compiled = read(ROOT/'packages/mobile/src/assessment/bank.generated.json')
    assert compiled['productionEnabled'] is False
    compiled_by_id = {item['id']: item for item in compiled['items']}
    assert not compiled_by_id['ha-g4-0010']['teachingLinks'], 'Unsupported exposure link activated'
    assert len(compiled['items']) == 705 and len(compiled['excluded']) == 5
    for item in compiled['items']:
        for link in item['teachingLinks']:
            for language, digest in link['hashes'].items():
                if digest:
                    assert sha(by_id[link['cardId']]['fact'][language].strip().encode()) == digest

    db_path = ROOT/'packages/mobile/assets/data/cards.db'
    with sqlite3.connect(f'file:{db_path}?mode=ro', uri=True) as db:
        db_rows = {row[0]: row for row in db.execute('SELECT * FROM card_text')}
        assert set(db_rows) == set(by_id)
        for c in cards:
            fact, title, emph = (c.get(k) or {} for k in ('fact', 'title', 'emphasis'))
            expected = (c['id'], *(fact.get(lang) or '' for lang in ('tl','en','bis')),
                *(title.get(lang) or '' for lang in ('tl','en','bis')),
                *('\x1f'.join(emph.get(lang) or []) for lang in ('tl','en','bis')),
                1 if c.get('poster') else 0, c.get('quarter'), c.get('competency') or '', c.get('source_module') or '')
            assert db_rows[c['id']] == expected, c['id']
        questions = read(ROOT/'packages/mobile/src/data/cards-questions.json')
        question_rows = questions if isinstance(questions, list) else questions['questions']
        expected_questions = {}
        for question in question_rows:
            expected_questions.setdefault(question['f'], question)
        assert {fid: json.loads(raw) for fid, raw in db.execute('SELECT factId,json FROM card_question')} == expected_questions
        assert db.execute('SELECT count(*) FROM fact').fetchone()[0] == 53022
        assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
    index = read(ROOT/'packages/mobile/src/generated/cardsIndex.generated.json')
    assert [row['id'] for row in index['cards']] == [c['id'] for c in cards]
    assert 'dcard-09952' in (ROOT/'packages/tala/android/app/src/main/assets/card-catalog.tsv').read_text()

    protected = ['rag/pipeline/full-year-review-lock.json', 'rag/pipeline/full-year-review.json',
                 'rag/pipeline/term2-pilot-review.json', 'packages/shared/src/curriculum/three-term-2026.json',
                 'docs/full-year-curriculum-coverage.json']
    for file in protected:
        assert (ROOT/file).read_bytes() == original(file), f'English review or curriculum membership changed: {file}'
    source_report = read(HERE/'source-reconciliation-001.json')
    for file, expected in source_report['source_after'].items():
        actual = pin(ROOT/'rag/pipeline'/file)
        assert (actual['sha256'], actual['bytes']) == (expected['sha256'], expected['bytes'])

    vector = ROOT/'packages/mobile/assets/rag/vectors-labse.i8.bin'
    raw = vector.read_bytes()
    meta = read(vector.with_name('vectors-labse.meta.json'))
    bank_raw = (ROOT/'rag/bank/science-facts.jsonl').read_bytes()
    refresh = read(HERE/'vector-refresh-001.json')
    assert meta['bankHash'] == hashlib.md5(bank_raw).hexdigest()[:12] == refresh['afterBankHash']
    assert len(raw) == meta['count'] * len(meta['langs']) * meta['dims'] == 122162688
    assert sha(raw) == refresh['afterVectorsSha256']
    md5 = hashlib.md5(raw).hexdigest()
    filename = f"vectors-labse-{meta['bankHash']}.i8.bin"
    edition = (ROOT/'packages/mobile/src/config/edition.ts').read_text()
    model_assets = read(ROOT/'packages/mobile/src/config/modelAssets.json')
    assert model_assets['vectors']['filename'] == filename and model_assets['vectors']['md5'] == md5
    assert model_assets['vectors']['bytes'] == len(raw)
    assert "import modelAssets from './modelAssets.json';" in edition
    assert 'vectors: { ...modelAssets.vectors, url: remoteAssetUrl(modelAssets.vectors.filename) }' in edition
    output_paths = ['rag/pipeline/cardsPool.app.json', 'rag/bank/science-facts.jsonl',
        'rag/bank/quiz-bank.jsonl', 'packages/mobile/src/data/cards-questions.json',
        'packages/mobile/src/assessment/bank.generated.json', 'packages/mobile/assets/data/cards.db',
        'packages/mobile/src/generated/cardsIndex.generated.json', 'packages/mobile/assets/data/tokens.bin',
        'packages/mobile/assets/rag/vectors-labse.meta.json', 'packages/mobile/src/config/edition.ts',
        'packages/mobile/src/config/modelAssets.json']
    return dict(schema='hiraia.cebuano-curriculum-final-verification/v1',
        approved_historical_edits=3986, reviewed_curriculum_records=137, curriculum_records_edited=26,
        curriculum_bis_leaves_edited=47, active_cards=len(cards), retired_card='dcard-09952',
        whole_pool_matches_approved_changes=True, mandatory_holds_unchanged=holds, banks=bank_counts,
        assessment_links_reviewed=len(decisions['reviewed_source_links']), foundation_snapshots_reviewed=2,
        assessment_content_keys_statuses_unchanged=True, unsupported_exposure_hold='ha-g4-0010',
        compiled_assessments=len(compiled['items']), excluded_assessments=len(compiled['excluded']),
        production_assessments_enabled=False, english_review_and_membership_unchanged=True,
        db_version=index['dbVersion'], all_database_card_fields_verified=len(cards),
        retrieval_asset=dict(**pin(vector), filename=filename, md5=md5, published=False),
        outputs=[pin(ROOT/file) for file in output_paths], native_certified=False,
        provider_calls=0, committed=False, deployed=False)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    assert not args.out.exists(), 'Do not overwrite verification evidence'
    result = verify()
    args.out.write_text(json.dumps(result, indent=2)+'\n')
    print(json.dumps(result, indent=2))
