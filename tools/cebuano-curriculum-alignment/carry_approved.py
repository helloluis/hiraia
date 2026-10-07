#!/usr/bin/env python3
"""One-time, hash-bound transfer of existing approvals into the audited pool."""
import copy
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'rag/pipeline'))
from card_language_patches import apply_patches, load_registry, check_edit
from card_retirement import exclude_retired_cards, load_retirements


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def main():
    manifest = json.loads((Path(__file__).parent / 'import-001.json').read_bytes())
    path = ROOT / 'rag/pipeline/cardsPool.app.json'
    original = path.read_bytes()
    pin = next(x for x in manifest['baseline'] if x['path'] == str(path.relative_to(ROOT)))
    assert (digest(original), len(original)) == (pin['sha256'], pin['bytes']), 'target baseline changed'
    pool = json.loads(original)
    prior = {c['id']: c for c in pool['cards']}
    registry = load_registry()
    retired = load_retirements()
    cards = apply_patches(exclude_retired_cards(pool['cards']))
    changes = []
    for card in cards:
        before = prior[card['id']]
        if before != card:
            check_edit(before, card)
            changes.append(card['id'])
        elif card['id'] in registry:
            raise AssertionError('expected an unapplied baseline: ' + card['id'])
    assert set(changes) == set(registry)
    assert set(prior) - {c['id'] for c in cards} == set(retired)
    inverse = copy.deepcopy(cards)
    for card in inverse:
        if card['id'] in registry:
            card['fact']['bis'] = prior[card['id']]['fact']['bis']
            card['title']['bis'] = prior[card['id']]['title']['bis']
    assert inverse == [c for c in pool['cards'] if c['id'] not in retired], 'unrelated fields changed'
    pool['cards'] = cards
    output = json.dumps(pool, ensure_ascii=False).encode()
    assert path.read_bytes() == original, 'concurrent pool write'
    evidence = Path(__file__).parent / 'carry-approved-001.json'
    assert not evidence.exists(), 'carry receipt already exists'
    path.write_bytes(output)
    report = {
        'schema': 'hiraia.cebuano-curriculum-carry/v1',
        'baseline': pin, 'output': {'path': str(path.relative_to(ROOT)), 'sha256': digest(output), 'bytes': len(output)},
        'approved_edits_carried': len(changes), 'retired_ids': sorted(retired),
        'all_other_fields_and_order_unchanged': True, 'active_cards': len(cards),
        'new_approvals': 0, 'provider_calls': 0,
    }
    evidence.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report))


if __name__ == '__main__':
    main()
