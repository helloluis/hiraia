#!/usr/bin/env python3
"""Coverage audit: map the existing fact bank + feed factoids onto the MATATAG elementary
learning competencies (Grades 3-6) to find what we're WEAK on before generating more.

Heuristic match (first pass, deliberately generous): a fact/factoid counts toward a
competency if it is in the same MATATAG domain AND its topic/terms/text contains any of the
competency's distinctive anchor keywords. Multi-word anchors are matched as phrases; the rest
as word tokens (>=4 chars, minus a small stoplist). Over-matching is fine here — the signal we
want is the ZEROS and thin cells, and those are robust to a loose matcher.

  python3 rag/pipeline/curriculum-audit.py
"""
import json, re, collections, os

CURR = 'rag/sources/curriculum-guides/matatag-elementary-competencies.json'
FACTS = 'rag/bank/science-facts.jsonl'
FACTOIDS = 'rag/bank/factoids.jsonl'

STOP = {'their','they','them','with','from','that','this','some','used','uses','using',
        'other','into','over','about','such','when','have','things','thing','make','made',
        'change','changes','local','environment','simple','different','various','common',
        'example','examples','identify','describe','observe','between','which'}

def norm(s): return re.sub(r'[^a-z0-9 ]', ' ', (s or '').lower())

def anchor_terms(anchors):
    """Return (phrases, tokens) from a competency's anchor list."""
    phrases, tokens = [], set()
    for a in anchors:
        a = norm(a).strip()
        if ' ' in a:
            phrases.append(a)
        for w in a.split():
            if len(w) >= 4 and w not in STOP:
                tokens.add(w)
    return phrases, tokens

def load_curr():
    d = json.load(open(CURR))
    for q in d['quarters']:
        for c in q['competencies']:
            c['_phrases'], c['_tokens'] = anchor_terms(c['anchors'])
            c['_grade'], c['_domain'] = q['grade'], q['domain']
            c['_title'] = q['title']
    return d

def fact_blob(r):
    f = r.get('fact', {})
    parts = [r.get('topic',''), ' '.join(r.get('terms',[])), f.get('en',''), f.get('tl','')]
    return norm(' '.join(parts))

def factoid_blob(r):
    t = r.get('text', {}); q = r.get('q') or {}
    parts = [r.get('topic',''), t.get('en',''), t.get('tl',''), q.get('en',''), q.get('tl','')]
    return norm(' '.join(parts))

def matches(blob, comp):
    for p in comp['_phrases']:
        if p in blob:
            return True
    # need >=1 distinctive token hit
    return any(tok in blob for tok in comp['_tokens'])

def main():
    curr = load_curr()
    comps = [c for q in curr['quarters'] for c in q['competencies']]

    # index facts/factoids by domain for speed
    facts_by_dom = collections.defaultdict(list)
    dom_count = collections.Counter()
    nf = 0
    for l in open(FACTS):
        l = l.strip()
        if not l: continue
        r = json.loads(l); nf += 1
        d = r.get('domain','?'); dom_count[d] += 1
        facts_by_dom[d].append(fact_blob(r))

    factoid_by_dom = collections.defaultdict(list)
    ndoids = 0
    if os.path.exists(FACTOIDS):
        for l in open(FACTOIDS):
            l = l.strip()
            if not l: continue
            r = json.loads(l); ndoids += 1
            # factoids currently carry subject not MATATAG domain; biology -> LIVING_THINGS
            subj = r.get('subject','')
            d = 'LIVING_THINGS' if subj == 'biology' else r.get('domain','?')
            factoid_by_dom[d].append(factoid_blob(r))

    # per-competency coverage
    for c in comps:
        dom = c['_domain']
        c['_facts'] = sum(1 for b in facts_by_dom.get(dom, []) if matches(b, c))
        c['_factoids'] = sum(1 for b in factoid_by_dom.get(dom, []) if matches(b, c))

    print('='*78)
    print(f'MATATAG ELEMENTARY COVERAGE AUDIT  (facts={nf}, factoids={ndoids})')
    print('='*78)
    print('\n--- DOMAIN LEVEL ---')
    print(f'{"domain":<22}{"facts":>8}{"factoids":>10}')
    for d in ['MATTER','LIVING_THINGS','FORCE_MOTION_ENERGY','EARTH_SPACE']:
        print(f'{d:<22}{dom_count.get(d,0):>8}{len(factoid_by_dom.get(d,0) and factoid_by_dom.get(d,[])) if False else len(factoid_by_dom.get(d,[])):>10}')
    print(f'{"(PH_GEOGRAPHY)":<22}{dom_count.get("PH_GEOGRAPHY",0):>8}')
    print(f'{"(PH_CIVICS)":<22}{dom_count.get("PH_CIVICS",0):>8}')

    print('\n--- COMPETENCY LEVEL (sorted by fact coverage, thinnest first) ---')
    print(f'{"code":<9}{"facts":>6}{"doids":>7}  competency')
    for c in sorted(comps, key=lambda c: (c['_facts'], c['_factoids'])):
        txt = c['text'][:82]
        print(f'{c["code"]:<9}{c["_facts"]:>6}{c["_factoids"]:>7}  {txt}')

    # gap buckets
    empty = [c for c in comps if c['_facts'] == 0]
    thin  = [c for c in comps if 0 < c['_facts'] < 30]
    print('\n--- GAP SUMMARY ---')
    print(f'competencies with ZERO matching facts ({len(empty)}): {[c["code"] for c in empty]}')
    print(f'competencies with THIN (<30) fact coverage ({len(thin)}): {[c["code"] for c in thin]}')

    # factoid gap: every non-LIVING_THINGS competency has ~0 factoids by construction
    doid_empty = [c for c in comps if c['_factoids'] == 0]
    print(f'\ncompetencies with ZERO feed FACTOIDS ({len(doid_empty)} of {len(comps)}):')
    by_dom = collections.Counter(c['_domain'] for c in doid_empty)
    print(f'  by domain: {dict(by_dom)}')

if __name__ == '__main__':
    main()
