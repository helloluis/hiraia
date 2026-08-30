#!/usr/bin/env python3
"""Fold the generated shards, the chosen illustrations and the taxonomy into ONE card pool.

Deliberately a PARALLEL bank: it is written to its own file and never touches the shipping
cardsPool.app.json, so the new writing can be compared against the old on equal terms
before anything replaces anything.

The shape matches the existing pool exactly (same keys, same taxonomy record) so the app and
the judging run can read either without a translation layer. What it adds is provenance —
every card carries the DepEd module, grade, quarter and competency code it came from, which is
what makes a claim checkable later.

  python3 rag/pipeline/assemble-deped-pool.py
  -> rag/pipeline/cardsPool.deped.json
  -> rag/pipeline/illustrations-needed.json   (cards with no picture yet, for the image queue)
"""
import json, os, glob, collections

HERE = os.path.dirname(os.path.abspath(__file__))
CARDS = os.path.join(HERE, os.environ.get('CARDS_DIR', 'deped-cards'))
CHOSEN = os.path.join(HERE, os.environ.get('CHOSEN', 'card-illustrations.chosen.json'))
TAXONOMY = os.path.join(HERE, 'deped-taxonomy.json')
OUT = os.path.join(HERE, os.environ.get('POOL_OUT', 'cardsPool.deped.json'))
NEEDED = os.path.join(HERE, 'illustrations-needed.json')


def slugify(s, n=48):
    out = []
    for ch in s.lower():
        if ch.isalnum():
            out.append(ch)
        elif out and out[-1] != '-':
            out.append('-')
    return ''.join(out).strip('-')[:n] or 'card'


def main():
    chosen = {}
    if os.path.exists(CHOSEN):
        for r in json.load(open(CHOSEN)):
            chosen[(r['shard'], r['i'])] = r
    print(f'  illustration decisions: {len(chosen):,}')

    tax = json.load(open(TAXONOMY))
    leaf_label = {l['id']: l for l in tax['leaves']}

    cards, needed, n = [], [], 0
    seen_fact = set()
    dup = 0
    for f in sorted(glob.glob(os.path.join(CARDS, '*.json'))):
        shard = os.path.basename(f)
        for i, c in enumerate(json.load(open(f))['cards']):
            # The same fact can be taught in two modules; keep the first and record the loss
            # rather than shipping a feed that repeats itself.
            key = c['fact']['en'].strip().lower()[:90]
            if key in seen_fact:
                dup += 1
                continue
            seen_fact.add(key)
            n += 1
            pick = chosen.get((shard, i))
            card = {
                'id': f'dcard-{n:05d}',
                'factId': f"{slugify(c['title']['en'])}-g{c['grade']}",
                'domain': c['domain'],
                'topic': c['topic'],
                'terms': c['terms'],
                'fact': c['fact'],
                'title': c['title'],
                'cats': c['cats'],
                'grade': c['grade'],
                'quarter': c['quarter'],
                'competency': c['competency'],
                'source_module': c['drive_id'],
            }
            if pick and pick.get('match'):
                card['image'] = {'kind': pick['kind'], 'ref': pick['match']}
                if pick['kind'] == 'slug':
                    card['slug'] = pick['match']
            else:
                card['image'] = None
                needed.append({'id': card['id'], 'title': c['title']['en'],
                               'prompt': c['illustration'], 'domain': c['domain'],
                               'grade': c['grade']})
            cards.append(card)

    pool = {'cards': cards, 'taxonomy': [
        {'id': l['id'], 'parent': l['parent'], 'label_en': l['label_en'],
         'label_tl': l['label_tl'], 'label_bis': l['label_bis']} for l in tax['leaves']]}
    json.dump(pool, open(OUT, 'w'), ensure_ascii=False)
    json.dump(needed, open(NEEDED, 'w'), ensure_ascii=False, indent=1)

    withimg = sum(1 for c in cards if c['image'])
    print(f'\n{len(cards):,} cards written ({dup:,} duplicate facts dropped)')
    print(f'  with an illustration : {withimg:,} ({withimg/len(cards)*100:.0f}%)')
    print(f'  needing one drawn    : {len(needed):,}')
    print(f'  taxonomy leaves      : {len(pool["taxonomy"]):,}')
    g = collections.Counter(c['grade'] for c in cards)
    print('  per grade:', ' '.join(f'g{k}={v:,}' for k, v in sorted(g.items())))
    d = collections.Counter(c['domain'] for c in cards)
    print('  per domain:', dict(d))
    nocat = sum(1 for c in cards if not c['cats'])
    print(f'  cards with no category: {nocat:,}')
    print(f'\n  wrote {os.path.basename(OUT)} and {os.path.basename(NEEDED)}')


if __name__ == '__main__':
    main()
