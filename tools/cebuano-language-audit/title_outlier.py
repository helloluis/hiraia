#!/usr/bin/env python3
"""Deterministic detector for the Cebuano title-outlier defect class.

Chunk D of the sweep established the signature: the card's *title* carries a Tagalog
false friend (or a wrong-sense verb) while the card's own *body* uses the correct
Cebuano word. That co-occurrence is what rules out regional variation, which is the
reason a bare grep for the suspect word is useless -- 89% of such hits are fine.

The filter fires only when all four hold:
  1. title_bis contains the suspect word,
  2. the English card really is about the concept that word mistranslates,
  3. the Cebuano body or terms list contains the correct word,
  4. the suspect word is absent from the Cebuano body (so the title is the outlier).

Output feeds runs/batches-triage/*.json; every candidate is still read by a judge
before anything is rewritten. Run:  python3 title_outlier.py [out.json]
"""
import json, re, sys, glob, os

HERE = os.path.dirname(os.path.abspath(__file__))
BATCHES = os.path.join(HERE, 'runs', 'batches-sweep', '*.json')

# (concept, english context, wrong Cebuano, correct Cebuano)
PAIRS = [
    ('vibrate',  r'vibrat',                 r'lingkod',               r'kurog|uyog|vibrat'),
    ('ant',      r'\bants?\b',              r'langgam',               r'hulmigas|hantatalo'),
    ('rotten',   r'rot|decay|spoil',        r'bulok',                 r'dunot|madunot|malata'),
    ('medicine', r'medicin|drug|remed',     r'\bgamot\b',             r'tambal|bulong'),
    ('thread',   r'thread|fib(er|re)|yarn', r'\bhilo\b',              r'tanod|hilo\w|lanot|sinulid'),
    ('wool',     r'\bwool',                 r'\blana\b',              r'balhibo|delana|\bwool'),
    ('straw',    r'\bstraw\b',              r'dayami',                r'\bstraw\b|tubo'),
    ('iron',     r'\biron\b',               r'\bbakal\b',             r'puthaw'),
    ('bone',     r'\bbones?\b',             r'\bbuto\b',              r'bukog'),
    ('spring',   r'\bspring',               r'\bbukal\b',             r'tubod|\bspring'),
    ('blind',    r'blind',                  r'bulag',                 r'\bbuta\b'),
    ('rare',     r'\brare',                 r'bihag',                 r'talagsaon|panagsa'),
    ('soft',     r'\bsoft',                 r'\blumo[ts]\b',          r'humok|malumo'),
    ('universe', r'universe|cosmos',        r'kalibutan',             r'uniberso'),
    ('space',    r'\b(outer )?space\b',     r'kalibutan|kahangturan', r'kawanangan'),
    ('law',      r'\blaws?\b',              r'\bbala\b',              r'balaod'),
    ('ash',      r'\bash\b|ashes',          r'\baso\b',               r'\babo\b'),
    ('spin',     r'spin|rotat',             r'tirok',                 r'tuyok|libot'),
    ('form',     r'\bform',                 r'tapak',                 r'porma|buo|himo'),
    ('cool',     r'\bcool',                 r'kunhod',                r'bugnaw'),
    ('erode',    r'erod|erosion|wash(es|ing)? away', r'uwang',        r'anod|dahili|hugno'),
    ('sweat',    r'sweat|perspir',          r'\bbaul\b|\bbahu\b|panghupaw', r'singot'),
    ('feces',    r'feces|faeces|dung|poop|droppings', r'\bihi\b',     r'\bta[ei]\b|\biti\b'),
    ('pear',     r'\bpear\b',               r'\bpera\b',              r'peras'),
    ('plate',    r'tectonic plate',         r'\bplato\b',             r'plaka|\bplate'),
    ('tide',     r'\btides?\b',             r'\bbalod\b',             r'taob|hunas'),
    ('horn',     r'\bhorn\b',               r'sungay|buryo',          r'busina|budyong'),
    ('heart',    r'\bheart\b',              r'\bbato\b',              r'kasingkasing'),
    ('cricket',  r'cricket',                r'kagang',                r'\bkuliglig|\bcricket'),
    ('wasp',     r'\bwasp',                 r'putyokan',              r'tamboanan|\bwasp'),
    ('monkey',   r'monkey',                 r'\bungo\b',              r'unggoy|amo'),
    ('toad',     r'\btoad',                 r'bakulaw',               r'\bbaki\b|kabakiba'),
]


def load_cards():
    cards = []
    for f in sorted(glob.glob(BATCHES)):
        cards.extend(json.load(open(f, encoding='utf-8')))
    return cards


def detect(cards):
    per = {}
    for concept, en_re, wrong_re, right_re in PAIRS:
        E, W, R = (re.compile(x, re.I) for x in (en_re, wrong_re, right_re))
        hits = []
        for c in cards:
            if not W.search(c.get('title_bis', '') or ''):
                continue
            if not E.search((c.get('en', '') or '') + ' ' + (c.get('title_en', '') or '')):
                continue
            body = c.get('bis', '') or ''
            if not R.search(body + ' ' + ' '.join(c.get('terms') or [])):
                continue
            if W.search(body):          # body agrees with the title -> not an outlier
                continue
            hits.append(c['id'])
        per[concept] = hits
    return per


if __name__ == '__main__':
    per = detect(load_cards())
    total = sum(len(v) for v in per.values())
    for k, v in sorted(per.items(), key=lambda x: -len(x[1])):
        if v:
            print('%-9s %3d  %s' % (k, len(v), ' '.join(v[:8])))
    print('total %d candidates' % total)
    if len(sys.argv) > 1:
        json.dump(per, open(sys.argv[1], 'w'), ensure_ascii=False, indent=1)
