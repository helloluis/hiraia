#!/usr/bin/env python3
"""Final step of the fact-bank gap-fill: keep gpt-oss-verified new facts, translate their
english to tl/bis (gpt-oss), and merge into science-facts.jsonl. Backs up first.
  set -a; source ./.env.local; set +a
  python3 rag/pipeline/assemble-newfacts.py
"""
import os, json, glob, re, time, shutil, threading, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed

HERE = os.path.dirname(os.path.abspath(__file__))
BANK = os.path.join(HERE, '..', 'bank', 'science-facts.jsonl')
URL = 'https://api.fireworks.ai/inference/v1/chat/completions'
KEY = os.environ['FIREWORKS_API_KEY']
MODEL = 'accounts/fireworks/models/gpt-oss-120b'

cand = {json.loads(l)['id']: json.loads(l) for l in open(os.path.join(HERE, 'newfacts-to-verify.jsonl'))}
ok = set()
for fn in glob.glob(os.path.join(HERE, 'newfact-verdicts', 'verd-*.jsonl')):
    for l in open(fn):
        o = json.loads(l)
        if o.get('verdict') == 'ok' and o['id'] in cand:
            ok.add(o['id'])
kept = [cand[i] for i in ok]
print(f'verified-ok new facts: {len(kept)} / {len(cand)}', flush=True)

lock = threading.Lock()
def call(prompt, attempt=0):
    body = json.dumps({'model': MODEL, 'reasoning_effort': 'low', 'temperature': 0.2, 'max_tokens': 4000,
                       'messages': [{'role': 'user', 'content': prompt}]}).encode()
    req = urllib.request.Request(URL, data=body, headers={'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json'})
    try:
        return json.load(urllib.request.urlopen(req, timeout=120))['choices'][0]['message'].get('content') or ''
    except urllib.error.HTTPError as e:
        if e.code in (429, 500, 502, 503, 529) and attempt < 5:
            time.sleep(min(60, 2 ** (attempt + 1))); return call(prompt, attempt + 1)
        raise

trans = {}
def do(batch):
    payload = [{'id': f['id'], 'en': f['en']} for f in batch]
    c = call('Translate each English science fact into natural kid-friendly Tagalog (tl) and Cebuano/Bisaya (bis). '
             'Keep English science terms where Filipinos use them. Output ONLY JSON array [{"id","tl","bis"}].\nFACTS:\n'
             + json.dumps(payload, ensure_ascii=False))
    a, b = c.find('['), c.rfind(']')
    try: arr = json.loads(c[a:b + 1])
    except Exception: return
    with lock:
        for o in arr:
            if isinstance(o, dict) and o.get('id') in cand and o.get('tl') and o.get('bis'):
                trans[o['id']] = (o['tl'], o['bis'])

batches = [kept[i:i + 10] for i in range(0, len(kept), 10)]
print(f'translating {len(kept)} in {len(batches)} batches ...', flush=True)
with ThreadPoolExecutor(max_workers=6) as ex:
    for _ in as_completed([ex.submit(do, b) for b in batches]): pass

def terms(topic, en):
    ws = re.findall(r'[A-Za-z]{4,}', (topic + ' ' + en))
    stop = {'that', 'this', 'with', 'from', 'they', 'their', 'them', 'when', 'what', 'which', 'because', 'about', 'into', 'than', 'more', 'most', 'some', 'other', 'these', 'such', 'have', 'also'}
    seen, out = set(), []
    for w in ws:
        wl = w.lower()
        if wl not in stop and wl not in seen:
            seen.add(wl); out.append(wl)
    return out[:10]

records = []
for f in kept:
    if f['id'] not in trans:
        continue
    tl, bis = trans[f['id']]
    records.append({'id': f['id'], 'domain': f['domain'], 'topic': f.get('topic', ''),
                    'grades': f.get('grades', [5]), 'terms': terms(f.get('topic', ''), f['en']),
                    'fact': {'tl': tl, 'en': f['en'], 'bis': bis},
                    'source': 'fireworks qwen3.7-gen + gpt-oss-verify (2026-06)', 'generator': 'qwen3.7-fireworks', 'reviewed': False})

existing = [json.loads(l) for l in open(BANK)]
exist_ids = set(x['id'] for x in existing)
records = [r for r in records if r['id'] not in exist_ids]
shutil.copy(BANK, BANK + '.pre-newfacts.bak')
with open(BANK, 'w') as f:
    for x in existing + records:
        f.write(json.dumps(x, ensure_ascii=False) + '\n')
print(f'translated {len(trans)} | merged {len(records)} new facts')
print(f'fact bank: {len(existing)} -> {len(existing) + len(records)}')
print(f'backed up -> {os.path.basename(BANK)}.pre-newfacts.bak')
print('NEXT: regenerate the RAG vectors blob -> finetuning/.convert-venv/bin/python rag/scripts/build-vectors.py')
