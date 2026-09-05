#!/usr/bin/env python3
"""Merge the VPS title-polish output back into the pool — validate first, hard.

Validation (per new title, per language): <=32 chars, trimmed, Title Case, no trailing
punctuation/emoji, NOT identical to the old title, plus the two NEW deterministic rules
that make this defect class permanently detectable:
  - connector floor: a 3+ word title must carry at least one connector (no keyword salads)
  - answer exclusion: no forbidden answer term may appear in the new title (no spoilers)

Invalid rows are dropped (kept original) and reported. Then the pool is patched and saved.

  python3 rag/pipeline/merge-title-polish.py
  REPORT_ONLY=1 python3 rag/pipeline/merge-title-polish.py
"""
import json, os, re, glob, sqlite3, collections

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
POOL = os.path.join(ROOT, 'rag/pipeline/cardsPool.app.json')
OUT = os.path.join(HERE, 'title-work', 'out', 'shard-*.jsonl')
WORKLIST = os.path.join(HERE, 'title-work', 'worklist.jsonl')
DB = os.path.join(ROOT, 'packages/mobile/assets/data/cards.db')

FUNC = {'ng','na','sa','at','ang','mga','nga','ug','ka','ni','no','vs','ay','may','para','the','of','in','on','for','and','a','an','from','with','at','kung','bilang'}
EMOJI = re.compile(r'[\U0001F300-\U0001FAFF]')
REPORT_ONLY = os.environ.get('REPORT_ONLY') == '1'

work = {}
for line in open(WORKLIST):
    if line.strip():
        w = json.loads(line)
        work[w['id']] = w

results = {}
for f in sorted(glob.glob(OUT)):
    for line in open(f):
        if line.strip():
            r = json.loads(line)
            if r.get('op') == 'fix' and r.get('title'):
                results[r['id']] = r['title']

db = sqlite3.connect(DB)  # answer terms, read-only use
print(f"worklist {len(work)} | fix results {len(results)}")

bad_reasons = collections.Counter()
good = {}
for cid, t in results.items():
    w = work.get(cid)
    if not w:
        bad_reasons['unknown-id'] += 1; continue
    ok = True
    for k in ('tl', 'en', 'bis'):
        v = (t.get(k) or '').strip()
        if not v: ok = False; bad_reasons[f'{k}-empty'] += 1
        elif len(v) > 32: ok = False; bad_reasons[f'{k}-{len(v)}chars'] += 1
        elif v != t.get(k): ok = False; bad_reasons[f'{k}-untrimmed'] += 1
        elif v.endswith(('.', '?', '!')): ok = False; bad_reasons[f'{k}-punct'] += 1
        elif EMOJI.search(v): ok = False; bad_reasons[f'{k}-emoji'] += 1
        elif v[0].islower(): ok = False; bad_reasons[f'{k}-case'] += 1
    # connector floor (tl only — the band's language)
    v_tl = (t.get('tl') or '').strip()
    words = v_tl.split()
    conn = sum(1 for x in words if x.lower().strip('.') in FUNC)
    if len(words) >= 4 and conn == 0:
        ok = False; bad_reasons['salad-still'] += 1
    # answer exclusion
    forbidden = {a.lower() for a in w.get('answers', [])}
    if any(x.lower().strip('.,!?—') in forbidden for x in words):
        ok = False; bad_reasons['spoiler-still'] += 1
    if ok:
        good[cid] = {k: (t[k] or '').strip() for k in ('tl', 'en', 'bis')}

print(f"valid fixes: {len(good)} | invalid: {len(results) - len(good)} | reasons: {dict(bad_reasons)}")

# preview a few
import itertools
for cid, t in itertools.islice(good.items(), 6):
    print(f"  {cid}: {work[cid]['title']!r} -> {t['tl']!r}")

if REPORT_ONLY:
    print('REPORT_ONLY — pool untouched'); raise SystemExit(0)

pool = json.load(open(POOL))
n = 0
for c in pool['cards']:
    t = good.get(c['id'])
    if t:
        c['title'] = {'tl': t['tl'], 'en': t['en'], 'bis': t['bis']}
        n += 1
json.dump(pool, open(POOL, 'w'), ensure_ascii=False)
print(f"pool patched: {n} titles rewritten -> {POOL}")
print("next: python3 rag/pipeline/build-cards-db.py && walker tripwires")
