#!/usr/bin/env python3
"""Art-QA Kimi runner — vision verdicts for the kimi half of the (slug, card) pairs.

One API call per pair (image base64 + card topic/title/cats), rate-window paced
(the same ledger discipline as kimi-backfill-card-cats.py). Batch-of-1 keeps the
payload predictable; the pace comes from concurrency, not multi-image calls.

Verdicts append to art-qa/verdicts.jsonl: {"pair_id","slug","card_id","verdict","note"}
where verdict is match | partial | mismatch.

  KIMI_API_KEY=... python3 rag/pipeline/art-qa-kimi.py            # continuous
  KIMI_API_KEY=... LIMIT=100 python3 rag/pipeline/art-qa-kimi.py  # bounded run
Env: MODEL, URL, CONC(6), WINDOW_MAX(850), WINDOW_HOURS(5), SAFETY_MARGIN(50), LIMIT
"""
import os, sys, json, time, base64, threading, glob, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed

HERE = os.path.dirname(os.path.abspath(__file__))
QA = os.path.join(HERE, 'art-qa')
VERDICTS = os.path.join(QA, 'verdicts.jsonl')
LEDGER = os.path.join(QA, 'ledger.json')
URL = os.environ.get('URL', 'https://api.kimi.com/coding/v1/chat/completions')
MODEL = os.environ.get('MODEL', 'kimi-for-coding')
KEY = os.environ['KIMI_API_KEY']
CONC = int(os.environ.get('CONC', '6'))
WINDOW_HOURS = float(os.environ.get('WINDOW_HOURS', '5'))
WINDOW_MAX = int(os.environ.get('WINDOW_MAX', '850'))
SAFETY_MARGIN = int(os.environ.get('SAFETY_MARGIN', '50'))
LIMIT = int(os.environ.get('LIMIT', '0')) or None

lock = threading.Lock()
stats = {'match': 0, 'partial': 0, 'mismatch': 0, 'errors': 0}

def reserve_slot():
    while True:
        with lock:
            now = time.time()
            try:
                ts = [t for t in json.load(open(LEDGER)) if t > now - WINDOW_HOURS * 3600]
            except Exception:
                ts = []
            if len(ts) < WINDOW_MAX - SAFETY_MARGIN:
                ts.append(now)
                tmp = LEDGER + '.tmp'
                json.dump(ts, open(tmp, 'w'))
                os.replace(tmp, LEDGER)
                return
            wait = (ts[0] + WINDOW_HOURS * 3600) - now + 60
        print(f"  [window] sleeping {wait/60:.0f}m", flush=True)
        time.sleep(min(wait, 900))

def call(img_b64, prompt, retries=5):
    body = json.dumps({
        'model': MODEL, 'temperature': 1, 'max_tokens': 300,
        'messages': [{'role': 'user', 'content': [
            {'type': 'image_url', 'image_url': {'url': f'data:image/png;base64,{img_b64}'}},
            {'type': 'text', 'text': prompt},
        ]}],
    }).encode()
    last = None
    for attempt in range(retries):
        reserve_slot()
        req = urllib.request.Request(URL, data=body, headers={
            'Content-Type': 'application/json', 'Authorization': f'Bearer {KEY}'})
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                text = json.loads(r.read())['choices'][0]['message']['content'].strip()
                if text:
                    return text
                last = RuntimeError('empty')
        except Exception as e:  # noqa: BLE001
            last = e
        time.sleep(2 ** attempt * 3)
    raise RuntimeError(f'kimi vision failed: {last}')

def parse_verdict(text):
    """Model returns free text; coerce to the enum, note keeps the reasoning."""
    t = text.lower()
    v = 'match'
    if 'mismatch' in t or 'does not' in t or "doesn't" in t or 'unrelated' in t:
        v = 'mismatch'
    elif 'partial' in t or 'loosely' in t or 'adjacent' in t or 'remedy' in t:
        v = 'partial'
    return v, text.replace('\n', ' ')[:220]

def judge(p):
    img = base64.b64encode(open(p['img'], 'rb').read()).decode()
    prompt = (
        "You are auditing illustrations for a Filipino grade-school science app. "
        f"The card is titled '{p['title_en'] or p['topic']}' (topic: {p['topic']}; categories: {', '.join(p['cats'])}). "
        "Look at the image and judge: does it DEPICT what the card is ABOUT? "
        "match = clearly the card's subject; partial = related/adjacent (e.g. depicts the remedy "
        "or a sub-part, not the subject itself); mismatch = depicts something else entirely. "
        "Answer with one word (match/partial/mismatch), then one short sentence why."
    )
    v, note = parse_verdict(call(img, prompt))
    row = {'pair_id': p['pair_id'], 'slug': p['slug'], 'card_id': p['card_id'],
           'verdict': v, 'note': note, 'source': 'kimi'}
    with lock:
        stats[v] += 1
        with open(VERDICTS, 'a') as f:
            f.write(json.dumps(row, ensure_ascii=False) + '\n')

def main():
    os.makedirs(QA, exist_ok=True)
    # pull the kimi worklist from the dispatcher
    import subprocess
    n = LIMIT if LIMIT else 20000
    out = subprocess.run([sys.executable, os.path.join(HERE, 'art-qa-dispatch.py'),
                          'next-kimi', str(n)], capture_output=True, text=True).stdout
    work = [json.loads(l) for l in out.splitlines() if l.strip()]
    if LIMIT:
        work = work[:LIMIT]
    print(f"{len(work)} pairs to judge | model={MODEL} conc={CONC}", flush=True)
    done = 0
    with ThreadPoolExecutor(max_workers=CONC) as ex:
        futs = {ex.submit(judge, p): p for p in work}
        for fut in as_completed(futs):
            try:
                fut.result()
            except Exception as e:  # noqa: BLE001
                with lock:
                    stats['errors'] += 1
            done += 1
            if done % 50 == 0:
                print(f"  {done}/{len(work)} | {stats}", flush=True)
    print(f"DONE. {stats}", flush=True)

if __name__ == '__main__':
    main()
