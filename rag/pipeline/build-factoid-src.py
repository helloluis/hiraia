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

# NON-TOPICAL tokens: words that describe a MODIFIER, not a subject. These are the reason a
# fact about the OUTER, MIDDLE and INNER ear was illustrated with `inner-vs-outer-planets`:
# the shared tokens were {inner, outer}, and the single slug token carrying the actual
# subject -- `planets` -- was the one the old rule allowed to be missing.
#
# Trilingual on purpose. The bank is EN/TL/BIS and `terms` mixes all three, so an
# English-only list would still let a Cebuano adjective carry a match (the card feed's
# non-sequitur audit found exactly that: `matahum` = beautiful, linking ozone to a wafer).
NONTOPIC = set((
    'inner outer upper lower middle centre center front back side top bottom left right '
    'loob labas taas baba gitna harap likod sulod gawas ibabaw ubos '
    'first second third last next new old young big small large little long short tall '
    'high low deep shallow fast slow hot cold warm cool wet dry hard soft light heavy '
    'dark bright thick thin wide narrow strong weak clean dirty '
    'malaki maliit mabilis mabagal mainit malamig mataas mababa mahaba maikli '
    'dako gamay paspas hinay init bugnaw halapad hataas '
    'once twice many few all some none each every other another same different '
    'one two three four five six seven eight nine ten hundred thousand million '
    'isa dalawa tatlo apat lima marami konti lahat iba pareho '
    'usa duha tulo upat daghan tanan lain '
    'red blue green yellow black white brown grey gray orange purple pink '
    'pula asul berde dilaw itim puti kayumanggi kahel lila rosas '
    'thing things part kind kinds type types way ways sort form '
    'bagay bahagi uri paraan anyo butang klase'
).split())
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
        # The slug's SUBJECT tokens must be among the matched ones. "Nearly all slug
        # tokens present" alone is not enough -- it lets the ONE missing token be the
        # subject while positional/quantity/colour words carry the match. Never accept a
        # match made purely of modifiers.
        topical = inter - NONTOPIC
        subject_tokens = st - NONTOPIC
        if subject_tokens and not topical:
            continue
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
