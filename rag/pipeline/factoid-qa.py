#!/usr/bin/env python3
"""Local QA for a factoid generation batch (the "break after each batch" check). Reads the
gen-*.jsonl, joins the source facts, and reports mechanical quality + samples for a human
faithfulness read. Automated: format ratio, reading load, trilingual completeness, image
prompt presence + style-string compliance, dup detection, empty/short bodies.

  python3 rag/pipeline/factoid-qa.py [gen_glob] [src_file]
"""
import json, glob, sys, re
from collections import Counter

GEN = sys.argv[1] if len(sys.argv) > 1 else 'rag/pipeline/factoids-bio/gen-*.jsonl'
SRC = sys.argv[2] if len(sys.argv) > 2 else 'rag/pipeline/factoids-bio-batch1-src.jsonl'
STYLE_MARK = 'hand-drawn line art'  # must appear in every image_prompt

src = {}
for l in open(SRC):
    if l.strip():
        r = json.loads(l); src[r['id']] = r

rows = []
bad = 0
for fn in sorted(glob.glob(GEN)):
    for l in open(fn):
        l = l.strip()
        if not l: continue
        try: rows.append(json.loads(l))
        except Exception: bad += 1

def words(s): return len(re.findall(r'\S+', s or ''))
issues = Counter()
samples = {'qa': [], 'straight': [], 'prompt': [], 'suspect_len': []}
qa = straight = withPrompt = 0
tl_words = []
seen_fids = set()
dups = 0

for r in rows:
    fid = r.get('factId')
    if fid in seen_fids: dups += 1
    seen_fids.add(fid)
    fmt = r.get('format')
    if fmt == 'qa': qa += 1
    elif fmt == 'straight': straight += 1
    # trilingual completeness (body)
    if not all(r.get(k, '').strip() for k in ('t_en', 't_tl', 't_bis')):
        issues['missing-body-lang'] += 1
    # qa must have a question in all langs
    if fmt == 'qa' and not all(r.get(k, '').strip() for k in ('q_en', 'q_tl', 'q_bis')):
        issues['qa-missing-question'] += 1
    # straight must NOT carry a question
    if fmt == 'straight' and (r.get('q_en') or '').strip():
        issues['straight-has-question'] += 1
    # reading load (tagalog body)
    w = words(r.get('t_tl', ''))
    tl_words.append(w)
    if w > 45: issues['long-body'] += 1;
    if w < 3: issues['too-short-body'] += 1
    # image prompt logic vs source
    s = src.get(fid, {})
    has_img = s.get('has_image')
    ip = (r.get('image_prompt') or '').strip()
    if has_img and ip: issues['prompt-when-image-exists'] += 1
    if (not has_img) and not ip: issues['no-prompt-no-image'] += 1
    if ip:
        withPrompt += 1
        if STYLE_MARK not in ip.lower(): issues['prompt-missing-style'] += 1
        if len(samples['prompt']) < 5: samples['prompt'].append((fid, ip))
    # collect samples for the faithfulness read (with source)
    if fmt == 'qa' and len(samples['qa']) < 6:
        samples['qa'].append((fid, r.get('q_tl'), r.get('t_tl'), s.get('en', '')))
    if fmt == 'straight' and len(samples['straight']) < 6:
        samples['straight'].append((fid, r.get('t_tl'), s.get('en', '')))

n = len(rows) or 1
med = sorted(tl_words)[len(tl_words)//2] if tl_words else 0
print(f'==================== FACTOID QA ====================')
print(f'factoids: {len(rows)} (malformed lines {bad}) | dup factIds: {dups}')
print(f'format: qa {qa} ({100*qa//n}%) / straight {straight} ({100*straight//n}%)')
print(f'reading load: median {med} tagalog words | image prompts written: {withPrompt}')
print(f'issues: {dict(issues) if issues else "NONE"}')
print()
print('--- QA samples (question / body / SOURCE fact — check faithfulness) ---')
for fid, q, t, en in samples['qa']:
    print(f'  Q: {q}')
    print(f'  A: {t}')
    print(f'  src: {en[:110]}')
    print()
print('--- STRAIGHT samples (body / SOURCE) ---')
for fid, t, en in samples['straight'][:4]:
    print(f'  • {t}')
    print(f'    src: {en[:110]}')
print()
print('--- image prompt samples (style check) ---')
for fid, ip in samples['prompt'][:3]:
    print(f'  • {ip[:200]}')
