#!/usr/bin/env python3
"""Restore the audited pool's exact baseline into its generating records.

This is a one-time migration, not an overlay or a substitute for language review.
It captures the pre-language output in memory, records every source leaf changed,
then requires a full normal guarded replay equal to the intended current pool.
The shared/original checkout is never used as a source of replacement content.
"""
import contextlib
import argparse
import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
PIPE = ROOT / 'rag/pipeline'
OUT = ROOT / 'build/cebuano-curriculum-alignment'
sys.path.insert(0, str(PIPE))
from card_language_patches import apply_patches


def pin(raw):
    return {'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()}


def load_wire():
    spec = importlib.util.spec_from_file_location('alignment_wire', PIPE / 'wire-app-pool.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--trial', required=True)
    args = parser.parse_args()
    manifest = json.loads((Path(__file__).parent / 'import-001.json').read_bytes())
    base_path = OUT / 'baseline/rag/pipeline/cardsPool.app.json'
    raw = base_path.read_bytes()
    expected_pin = next(x for x in manifest['baseline'] if x['path'] == 'rag/pipeline/cardsPool.app.json')
    assert pin(raw) == {k: expected_pin[k] for k in ('bytes', 'sha256')}
    baseline = {c['id']: c for c in json.loads(raw)['cards']}
    pool_path = PIPE / 'cardsPool.app.json'
    pool_raw = pool_path.read_bytes()
    intended = json.loads(pool_raw)
    wire = load_wire()
    captured = []

    class Captured(Exception):
        pass

    def capture(cards):
        captured.extend(cards)
        raise Captured()

    # Stop BEFORE the strict overlay and before wire opens any output. This is
    # diagnosis only; the final replay below uses the unmodified guard.
    wire.apply_language_patches = capture
    with contextlib.redirect_stdout(io.StringIO()):
        try:
            wire.main()
        except Captured:
            pass
    assert captured
    names = ['cardsPool.merged.json', 'editorial.json', 'original-art-chosen.json']
    original = {name: (PIPE / name).read_bytes() for name in names}
    docs = {name: json.loads(data) for name, data in original.items()}
    merged = {c['id']: c for c in docs[names[0]]['cards']}
    editorial, art = docs[names[1]], docs[names[2]]
    changes = []

    def replace(name, cid, obj, key, value, prefix):
        if obj.get(key) == value:
            return
        changes.append({'file': name, 'card_id': cid, 'field': prefix + [key],
                        'existed': key in obj, 'before': copy.deepcopy(obj.get(key)),
                        'after': copy.deepcopy(value)})
        obj[key] = copy.deepcopy(value)

    for generated in captured:
        cid = generated['id']
        target, src = baseline[cid], merged[cid]
        e = editorial.get(cid, {})
        con = e.get('concise')
        concise = bool(con and con.get('tl') and con.get('en')
                       and ('\n\n' in src['fact']['tl']) == ('\n\n' in con['tl']))
        for field in set(generated) | set(target):
            if generated.get(field) == target.get(field):
                continue
            assert field in ('fact', 'title', 'cats', 'slug', 'emphasis'), (cid, field)
            if field == 'fact':
                for lang in ('en', 'tl', 'bis'):
                    if generated['fact'][lang] == target['fact'][lang]:
                        continue
                    if concise and con.get(lang):
                        replace(names[1], cid, con, lang, target['fact'][lang], ['concise'])
                    else:
                        replace(names[0], cid, src['fact'], lang, target['fact'][lang], ['fact'])
            elif field == 'emphasis' and e:
                replace(names[1], cid, e, 'emphasis', target.get('emphasis', {}), [])
            elif field == 'slug':
                replace(names[2], cid, art, cid, target.get('slug') or '', [])
            else:
                assert field in target, (cid, 'unexpected field deletion', field)
                replace(names[0], cid, src, field, target[field], [])
        # Restoring the paragraph shape can reactivate a formerly skipped concise
        # record. Reconcile that newly effective source too, rather than changing
        # wire's established editorial eligibility rule.
        if generated['fact'] != target['fact'] and con and con.get('tl') and con.get('en'):
            if ('\n\n' in src['fact']['tl']) == ('\n\n' in con['tl']):
                for lang in ('en', 'tl', 'bis'):
                    if con.get(lang):
                        replace(names[1], cid, con, lang, target['fact'][lang], ['concise'])

    # Every edit is a restoration of a pinned, already shipping baseline value.
    trial_dir = OUT / args.trial
    trial_dir.mkdir(parents=True, exist_ok=False)
    for name, doc in docs.items():
        (trial_dir / name).write_text(json.dumps(doc, ensure_ascii=False))
    trial = load_wire()
    trial.SRC = str(trial_dir / names[0])
    trial.ED = str(trial_dir / names[1])
    trial.ART = str(trial_dir / names[2])
    trial.OUT = str(trial_dir / 'cardsPool.app.json')
    trial.main()
    actual = json.loads(Path(trial.OUT).read_bytes())
    if actual != intended:
        by_id = {c['id']: c for c in intended['cards']}
        mismatches = [c['id'] for c in actual['cards'] if c != by_id.get(c['id'])]
        (trial_dir / 'mismatches.json').write_text(json.dumps(mismatches, indent=2))
        raise AssertionError(f'whole-pool trial mismatch: {len(mismatches)} cards, {mismatches[:8]}')
    assert pool_path.read_bytes() == pool_raw, 'current pool changed during trial'
    for name in names:
        assert (PIPE / name).read_bytes() == original[name], 'concurrent source change: ' + name
    for name in names:
        backup = OUT / 'baseline/rag/pipeline' / name
        if not backup.exists():
            backup.write_bytes(original[name])
        else:
            assert backup.read_bytes() == original[name]
    # Commit local source changes only after the entire output matches.
    for name in names:
        (PIPE / name).write_bytes((trial_dir / name).read_bytes())
    report = {
        'schema': 'hiraia.audited-pool-source-reconciliation/v1',
        'baseline': expected_pin, 'changes': changes,
        'source_before': {name: pin(raw) for name, raw in original.items()},
        'source_after': {name: pin((PIPE / name).read_bytes()) for name in names},
        'whole_output_equals_audited_baseline_plus_3986_edits_minus_retirement': True,
        'guarded_trial': pin(Path(trial.OUT).read_bytes()), 'new_science_or_language_decisions': 0,
    }
    (Path(__file__).parent / 'source-reconciliation-001.json').write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(f'Exact whole-pool equality; {len(changes)} source fields restored.')


if __name__ == '__main__':
    main()
