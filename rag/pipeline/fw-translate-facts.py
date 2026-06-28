#!/usr/bin/env python3
"""Re-translate the english of facts marked _retranslate (after correction) into tl/bis
via Fireworks gpt-oss-120b, and clear the flag. Small batch (the corrected facts).
  set -a; source ./.env.local; set +a
  python3 rag/pipeline/fw-translate-facts.py
"""
import os, json, time, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading

HERE = os.path.dirname(os.path.abspath(__file__))
BANK = os.path.join(HERE, '..', 'bank', 'science-facts.jsonl')
URL = 'https://api.fireworks.ai/inference/v1/chat/completions'
KEY = os.environ['FIREWORKS_API_KEY']
MODEL = 'accounts/fireworks/models/gpt-oss-120b'

facts = [json.loads(l) for l in open(BANK)]
todo = [f for f in facts if f.get('_retranslate')]
print(f'{len(todo)} corrected facts to re-translate', flush=True)
lock = threading.Lock()

def call(prompt, attempt=0):
    body = json.dumps({'model': MODEL, 'reasoning_effort': 'low', 'temperature': 0.2, 'max_tokens': 4000,
                       'messages': [{'role': 'user', 'content': prompt}]}).encode()
    req = urllib.request.Request(URL, data=body, headers={'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json'})
    try:
        r = json.load(urllib.request.urlopen(req, timeout=120))
        return r['choices'][0]['message'].get('content') or ''
    except urllib.error.HTTPError as e:
        if e.code in (429, 500, 502, 503, 529) and attempt < 5:
            time.sleep(min(60, 2 ** (attempt + 1))); return call(prompt, attempt + 1)
        raise

def do(batch):
    payload = [{'id': f['id'], 'en': f['fact']['en']} for f in batch]
    prompt = ('Translate each English science fact into natural, kid-friendly Tagalog (tl) and Cebuano/Bisaya (bis). '
              'Keep English science terms where Filipinos use them. Output ONLY a JSON array: '
              '[{"id":"..","tl":"..","bis":".."}].\nFACTS:\n' + json.dumps(payload, ensure_ascii=False))
    c = call(prompt)
    a, b = c.find('['), c.rfind(']')
    try:
        arr = json.loads(c[a:b + 1])
    except Exception:
        return
    by = {f['id']: f for f in batch}
    with lock:
        for o in arr:
            if isinstance(o, dict) and o.get('id') in by and o.get('tl') and o.get('bis'):
                by[o['id']]['fact']['tl'] = o['tl']; by[o['id']]['fact']['bis'] = o['bis']
                by[o['id']].pop('_retranslate', None)

batches = [todo[i:i + 8] for i in range(0, len(todo), 8)]
with ThreadPoolExecutor(max_workers=5) as ex:
    for _ in as_completed([ex.submit(do, b) for b in batches]): pass

still = sum(1 for f in facts if f.get('_retranslate'))
for f in facts:
    f.pop('_retranslate', None)  # clear flag regardless (re-run picks up empties)
with open(BANK, 'w') as f:
    for x in facts:
        f.write(json.dumps(x, ensure_ascii=False) + '\n')
done = sum(1 for x in facts if x.get('fact', {}).get('tl'))
print(f're-translated {len(todo) - still}/{len(todo)} | wrote {os.path.basename(BANK)}')
