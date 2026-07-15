#!/usr/bin/env python3
"""Assemble factoid gen-*.jsonl (one or more batch dirs) into the feed factoid bank, joined
to their source facts for slug/topic/grades and to science-facts.jsonl for the MATATAG domain.
Dedup by factId. Writes rag/bank/factoids.jsonl with a `domain` field so the feed can sample
evenly across the four elementary quarters (Materials / Living Things / Force-Motion-Energy /
Earth-Space) regardless of how many were generated per domain.

  python3 rag/pipeline/assemble-factoids.py \
      rag/pipeline/factoids-bio:rag/pipeline/factoids-bio-batch1-src.jsonl \
      rag/pipeline/factoids-bio-b2:rag/pipeline/factoids-bio-batch2-src.jsonl \
      rag/pipeline/factoids-bio-b3:rag/pipeline/factoids-bio-batch3-src.jsonl \
      rag/pipeline/factoids-gen-matter:rag/pipeline/factoids-MATTER-src.jsonl \
      rag/pipeline/factoids-gen-fme:rag/pipeline/factoids-FORCE_MOTION_ENERGY-src.jsonl \
      rag/pipeline/factoids-gen-earth:rag/pipeline/factoids-EARTH_SPACE-src.jsonl
"""
import json, glob, os, sys

OUT = 'rag/bank/factoids.jsonl'
FACTS = 'rag/bank/science-facts.jsonl'
# biology batches all join to the SAME re-matched LIVING_THINGS src (aggressive image match
# → far more bundled-illustration coverage than the conservative batch-era src files).
DEFAULT_PAIRS = [
    'rag/pipeline/factoids-bio:rag/pipeline/factoids-LIVING_THINGS-src.jsonl',
    'rag/pipeline/factoids-bio-b2:rag/pipeline/factoids-LIVING_THINGS-src.jsonl',
    'rag/pipeline/factoids-bio-b3:rag/pipeline/factoids-LIVING_THINGS-src.jsonl',
    'rag/pipeline/factoids-gen-matter:rag/pipeline/factoids-MATTER-src.jsonl',
    'rag/pipeline/factoids-gen-fme:rag/pipeline/factoids-FORCE_MOTION_ENERGY-src.jsonl',
    'rag/pipeline/factoids-gen-earth:rag/pipeline/factoids-EARTH_SPACE-src.jsonl',
]
pairs = sys.argv[1:] or DEFAULT_PAIRS

# MATATAG domain -> friendly feed subject label
SUBJECT = {'MATTER': 'materials', 'LIVING_THINGS': 'biology',
           'FORCE_MOTION_ENERGY': 'physics', 'EARTH_SPACE': 'earth_space'}

# id -> MATATAG domain (authoritative, from the fact bank)
dom = {}
for l in open(FACTS):
    l = l.strip()
    if l:
        r = json.loads(l); dom[r['id']] = r.get('domain', '')

# source facts (for slug / grades / topic)
src = {}
for pair in pairs:
    _, srcfile = pair.split(':')
    if os.path.exists(srcfile):
        for l in open(srcfile):
            if l.strip():
                r = json.loads(l); src[r['id']] = r

def tri(en, tl, bis):
    return {'en': (en or '').strip(), 'tl': (tl or '').strip(), 'bis': (bis or '').strip()}

records = {}
malformed = 0
for pair in pairs:
    gdir = pair.split(':')[0]
    for fn in sorted(glob.glob(os.path.join(gdir, 'gen-*.jsonl'))):
        for l in open(fn):
            l = l.strip()
            if not l: continue
            try: r = json.loads(l)
            except Exception: malformed += 1; continue
            fid = r.get('factId')
            if not fid or fid in records: continue
            s = src.get(fid, {})
            fmt = r.get('format', 'straight')
            body = tri(r.get('t_en'), r.get('t_tl'), r.get('t_bis'))
            if not body['en'] and not body['tl']:  # empty factoid — skip
                continue
            q = tri(r.get('q_en'), r.get('q_tl'), r.get('q_bis')) if fmt == 'qa' else None
            if q and not (q['en'] or q['tl']):
                q = None; fmt = 'straight'
            slug = s.get('slug') or None
            prompt = (r.get('image_prompt') or '').strip() or None
            d = dom.get(fid, '')
            records[fid] = {
                'factId': fid,
                'subject': SUBJECT.get(d, 'science'),
                'domain': d,
                'topic': s.get('topic', ''),
                'grades': s.get('grades', [5]),
                'format': fmt,
                'q': q,
                'text': body,
                'image': {'slug': slug, 'prompt': None if slug else prompt},
                'difficulty': r.get('difficulty', 1),
                'reviewed': False,
            }

recs = list(records.values())
for i, r in enumerate(recs):
    r['id'] = f'ffct-{i:05d}'
order = ['id', 'factId', 'subject', 'domain', 'topic', 'grades', 'format', 'q', 'text', 'image', 'difficulty', 'reviewed']
recs = [{k: r[k] for k in order} for r in recs]

os.makedirs('rag/bank', exist_ok=True)
with open(OUT, 'w') as f:
    for r in recs:
        f.write(json.dumps(r, ensure_ascii=False) + '\n')

from collections import Counter
qa = sum(1 for r in recs if r['format'] == 'qa')
withslug = sum(1 for r in recs if r['image']['slug'])
withprompt = sum(1 for r in recs if r['image']['prompt'])
noimg = sum(1 for r in recs if not r['image']['slug'] and not r['image']['prompt'])
bydom = Counter(r['domain'] for r in recs)
print(f'assembled {len(recs)} factoids (malformed {malformed}) → {OUT}')
print(f'  format: qa {qa} / straight {len(recs)-qa}')
print(f'  image: existing slug {withslug} | prompt {withprompt} | NEITHER {noimg}')
print(f'  by domain: {dict(bydom)}')
print(f'  size: {os.path.getsize(OUT)/1e6:.1f} MB')
