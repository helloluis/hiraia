#!/usr/bin/env python3
"""Stage source facts for a factoid-generation run: filter science-facts.jsonl to one MATATAG
domain and attach image-catalog matches (has_image/slug), mirroring the biology src files.

Conservative image match: a fact gets has_image=true ONLY on a confident slug hit —
(a) fact.id minus a -gN grade suffix is an exact catalog slug, or
(b) the catalog slug's distinctive tokens are (nearly) a subset of the fact's id+topic+terms
    tokens (>=2 shared, missing at most one). Otherwise has_image=false → the generator writes
    an illustration prompt. The image catalog is biology-heavy, so matter/physics/earth-space
    facts will mostly (correctly) get prompts.

  python3 rag/pipeline/build-factoid-src.py MATTER rag/pipeline/factoids-matter-src.jsonl
"""
import json, re, sys, os

DOMAIN = sys.argv[1] if len(sys.argv) > 1 else 'MATTER'
OUT = sys.argv[2] if len(sys.argv) > 2 else f'rag/pipeline/factoids-{DOMAIN.lower()}-src.jsonl'
FACTS = 'rag/bank/science-facts.jsonl'
QC = 'packages/images/gemini-queue/qc-progress.json'

STOP = set('the a an of and or to in on for with is are na ng sa ang mga at ay diagram scene '
           'how what parts system its our their they them this that'.split())
def toks(s):
    return {t for t in re.split(r'[^a-z0-9]+', (s or '').lower()) if len(t) > 2 and t not in STOP}
def strip_grade(fid):
    return re.sub(r'-g\d+$', '', fid)

qc = json.load(open(QC))
slugset = set(qc.keys()) if isinstance(qc, dict) else set(qc)
slug_toks = {s: toks(s) for s in slugset}

def match_slug(fid, topic, terms):
    sg = strip_grade(fid)
    if sg in slugset:
        return sg
    ftoks = toks(fid) | toks(topic) | {t.lower() for t in terms}
    best = None
    for s, st in slug_toks.items():
        if not st:
            continue
        inter = st & ftoks
        if len(inter) >= 2 and len(inter) >= len(st) - 1:  # nearly all slug tokens present
            # prefer the longest (most specific) confident match
            if best is None or len(st) > len(slug_toks[best]):
                best = s
    return best

n = hit = 0
with open(OUT, 'w') as out:
    for l in open(FACTS):
        l = l.strip()
        if not l:
            continue
        r = json.loads(l)
        if r.get('domain') != DOMAIN:
            continue
        n += 1
        fid = r['id']; topic = r.get('topic', ''); terms = r.get('terms', [])
        slug = match_slug(fid, topic, terms)
        if slug:
            hit += 1
        f = r.get('fact', {})
        out.write(json.dumps({
            'id': fid,
            'topic': topic,
            'grades': r.get('grades', [5]),
            'en': f.get('en', ''),
            'tl': f.get('tl', ''),
            'bis': f.get('bis', ''),
            'has_image': bool(slug),
            'slug': slug or None,
        }, ensure_ascii=False) + '\n')

print(f'{DOMAIN}: staged {n} facts -> {OUT}  (has_image {hit} / {n}, {100*hit//max(n,1)}%)')
