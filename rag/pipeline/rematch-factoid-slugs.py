#!/usr/bin/env python3
"""Re-assign every factoid's illustration with the CORRECTED matcher, in place.

Why this exists: a card's `slug` is decided in build-factoid-src.py, three layers upstream of
the feed, and baked into factoids.jsonl. When match_slug was fixed (a slug may no longer be
chosen on modifier words alone — see NONTOPIC there), the existing bank still carried the old
assignments. Re-running the whole chain would mean re-GENERATING 36k factoid texts through
Fireworks, which is pointless: only the image match changed, not the writing. So this re-runs
the matcher alone and rewrites `image.slug`.

Measured effect: 2,669 factoids re-matched to a better illustration, 18 lost a slug entirely,
and the card pool loses 72 of 16,948 cards (-0.4%). A card with no illustration is dropped by
gen-cards-pool.py, so that shrink is the real cost of the stricter rule — worth it against
fixes like "earthworm tunnels" moving off `hydra-on-water-plant`.

  python3 rag/pipeline/rematch-factoid-slugs.py            # dry run, prints the delta
  APPLY=1 python3 rag/pipeline/rematch-factoid-slugs.py    # rewrite factoids.jsonl
  then: python3 rag/pipeline/gen-cards-pool.py
"""
import json, os, re, shutil

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
FACTOIDS = os.path.join(ROOT, 'rag/bank/factoids.jsonl')
FACTS = os.path.join(ROOT, 'rag/bank/science-facts.jsonl')
QC = os.path.join(ROOT, 'packages/images/gemini-queue/qc-progress.json')
IMAGEMAP = os.path.join(ROOT, 'packages/mobile/src/generated/imageMap.ts')
APPLY = os.environ.get('APPLY') == '1'

# Reuse the matcher's own rules rather than restating them — the two must not drift.
src = open(os.path.join(HERE, 'build-factoid-src.py')).read()
ns = {}
exec(src.split('qc = json.load')[0], ns)
toks, NONTOPIC, strip_grade = ns['toks'], ns['NONTOPIC'], ns['strip_grade']

qc = json.load(open(QC))
slugset = set(qc.keys()) if isinstance(qc, dict) else set(qc)
slug_toks = {s: toks(s) for s in slugset}
bundled = set(re.findall(r'"([^"]+)":\s*require', open(IMAGEMAP).read()))

terms_by = {}
for line in open(FACTS):
    if line.strip():
        r = json.loads(line)
        terms_by[r['id']] = [t.lower() for t in r.get('terms', [])]


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
        # a slug may not be chosen on modifier words alone (see build-factoid-src.py)
        topical = inter - NONTOPIC
        subject_tokens = st - NONTOPIC
        if subject_tokens and not topical:
            continue
        if len(inter) >= 2 and len(inter) >= len(st) - 1:
            if best is None or len(st) > len(slug_toks[best]):
                best = s
    return best


rows, same, changed, lost, gained = [], 0, 0, 0, 0
before = after = 0
for line in open(FACTOIDS):
    line = line.strip()
    if not line:
        continue
    fo = json.loads(line)
    old = fo['image'].get('slug')
    new = match_slug(fo['factId'], fo.get('topic', ''), terms_by.get(fo['factId'], []))
    before += 1 if (old and old in bundled) else 0
    after += 1 if (new and new in bundled) else 0
    if old == new:
        same += 1
    elif old and not new:
        lost += 1
    elif new and not old:
        gained += 1
    else:
        changed += 1
    fo['image']['slug'] = new
    if not new:
        fo['image'].setdefault('prompt', None)
    rows.append(fo)

print(f'factoids {len(rows)} | unchanged {same} | re-matched {changed} | lost {lost} | gained {gained}')
print(f'cards with a bundled illustration: {before} -> {after} ({after - before:+d})')

if not APPLY:
    print('\nDRY RUN — set APPLY=1 to rewrite factoids.jsonl')
else:
    shutil.copyfile(FACTOIDS, FACTOIDS + '.pre-rematch.bak')
    with open(FACTOIDS, 'w') as fh:
        for fo in rows:
            fh.write(json.dumps(fo, ensure_ascii=False) + '\n')
    print(f'\nWROTE {FACTOIDS} (backup at {os.path.basename(FACTOIDS)}.pre-rematch.bak)')
    print('next: python3 rag/pipeline/gen-cards-pool.py')
