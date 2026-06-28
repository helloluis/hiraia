#!/usr/bin/env python3
"""Translate remaining quiz questions EN -> tl/bis via Fireworks (gpt-oss-120b, reasoning low).

Bypasses the Claude/Sonnet cap (uses FIREWORKS_API_KEY credits). Resumable: skips any
question index `i` already present in rag/pipeline/quiz-xlate/{tl,fw}-*.jsonl. Thread-pooled
with exponential backoff on 429/5xx so we stay under Fireworks rate limits.

  set -a; source ./.env.local; set +a
  FW_LIMIT=60 python3 rag/pipeline/fw-translate.py     # validation slice
  python3 rag/pipeline/fw-translate.py                 # full remaining
"""
import os, json, glob, time, threading, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed

HERE = os.path.dirname(os.path.abspath(__file__))
INPUT = os.path.join(HERE, os.environ.get('FW_INPUT', 'quiz-translate-input.jsonl'))
XDIR = os.path.join(HERE, 'quiz-xlate')
MODEL = 'accounts/fireworks/models/gpt-oss-120b'
URL = 'https://api.fireworks.ai/inference/v1/chat/completions'
KEY = os.environ['FIREWORKS_API_KEY']
BATCH = int(os.environ.get('FW_BATCH', '12'))
CONC = int(os.environ.get('FW_CONC', '6'))
LIMIT = int(os.environ.get('FW_LIMIT', '0'))  # 0 = all remaining

PROMPT_HEAD = '''Translate these grade-5 science quiz items from English into Tagalog (tl) and Cebuano/Bisaya (bis). Natural, simple, kid-friendly for a 10-year-old. Keep accurate science terms; English science words (oxygen, gravity, photosynthesis) are fine where Filipinos use them. Each item has fact_tl/fact_bis — use them as the terminology anchor so wording matches what the tutor teaches.
Return ONLY a JSON array, one object per item IN THE SAME ORDER, each exactly:
{"i":<same i>,"q_tl":"...","q_bis":"...","opt_tl":["a","b","c","d"],"opt_bis":["a","b","c","d"],"expl_tl":"...","expl_bis":"..."}
opt_tl/opt_bis each have EXACTLY 4 strings, SAME order as the English options. Preserve meaning exactly (a wrong option stays wrong). No commentary.
ITEMS:
'''

_lock = threading.Lock()
_stats = {'in': 0, 'out': 0, 'ok': 0, 'bad': 0, 'batches': 0, 'failed_batches': 0}

def done_indices():
    done = set()
    for fn in glob.glob(os.path.join(XDIR, 'tl-*.jsonl')) + glob.glob(os.path.join(XDIR, 'fw-*.jsonl')):
        for l in open(fn):
            l = l.strip()
            if l:
                try: done.add(json.loads(l)['i'])
                except Exception: pass
    return done

def call_fw(payload, attempt=0):
    body = json.dumps({'model': MODEL, 'reasoning_effort': 'low', 'temperature': 0.2,
                       'max_tokens': 5000, 'messages': [{'role': 'user', 'content': PROMPT_HEAD + json.dumps(payload, ensure_ascii=False)}]}).encode()
    req = urllib.request.Request(URL, data=body, headers={'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json'})
    try:
        r = json.load(urllib.request.urlopen(req, timeout=180))
        msg = r['choices'][0]['message']; u = r.get('usage', {})
        return (msg.get('content') or '', msg.get('reasoning_content') or '',
                u.get('prompt_tokens', 0), u.get('completion_tokens', 0))
    except urllib.error.HTTPError as e:
        if e.code in (429, 500, 502, 503, 529) and attempt < 5:
            ra = e.headers.get('Retry-After')
            time.sleep(float(ra) if ra else min(60, 2 ** (attempt + 1)))
            return call_fw(payload, attempt + 1)
        raise
    except (urllib.error.URLError, TimeoutError) as e:
        if attempt < 5:
            time.sleep(min(60, 2 ** (attempt + 1)))
            return call_fw(payload, attempt + 1)
        raise

def parse_array(c):
    s = c.strip()
    if s.startswith('```'):
        s = s.split('```', 2)[1].removeprefix('json').strip() if s.count('```') >= 2 else s.removeprefix('```json').removeprefix('```')
    a, b = s.find('['), s.rfind(']')
    if a < 0 or b <= a: return None
    try: return json.loads(s[a:b + 1])
    except Exception: return None

def valid(o, allowed):
    return (isinstance(o, dict) and o.get('i') in allowed and o.get('q_tl') and o.get('q_bis')
            and isinstance(o.get('opt_tl'), list) and len(o['opt_tl']) == 4
            and isinstance(o.get('opt_bis'), list) and len(o['opt_bis']) == 4
            and o.get('expl_tl') and o.get('expl_bis'))

def do_batch(idx, items):
    payload = [{'i': it['i'], 'q': it['q'], 'options': it['options'], 'explanation': it['explanation'],
                'fact_tl': it['fact_tl'], 'fact_bis': it['fact_bis']} for it in items]
    allowed = {it['i'] for it in items}
    try:
        content, reasoning, pin, pout = call_fw(payload)
    except Exception as e:
        with _lock:
            _stats['failed_batches'] += 1
        print(f'  batch {idx}: FAILED {type(e).__name__} {str(e)[:80]}', flush=True)
        return
    arr = parse_array(content) or parse_array(reasoning) or []
    good = [o for o in arr if valid(o, allowed)]
    outpath = os.path.join(XDIR, f'fw-{items[0]["i"]}.jsonl')
    with open(outpath, 'w') as f:
        for o in good:
            f.write(json.dumps({'i': o['i'], 'q_tl': o['q_tl'], 'q_bis': o['q_bis'],
                                'opt_tl': o['opt_tl'], 'opt_bis': o['opt_bis'],
                                'expl_tl': o['expl_tl'], 'expl_bis': o['expl_bis']}, ensure_ascii=False) + '\n')
    with _lock:
        _stats['in'] += pin; _stats['out'] += pout
        _stats['ok'] += len(good); _stats['bad'] += len(items) - len(good); _stats['batches'] += 1
        if _stats['batches'] % 20 == 0:
            print(f'  ...{_stats["batches"]} batches | {_stats["ok"]} ok, {_stats["bad"]} bad | {_stats["out"]//1000}k out tok', flush=True)

def main():
    inp = [json.loads(l) for l in open(INPUT)]
    done = done_indices()
    remaining = [it for it in inp if it['i'] not in done]
    if LIMIT: remaining = remaining[:LIMIT]
    batches = [remaining[i:i + BATCH] for i in range(0, len(remaining), BATCH)]
    print(f'input {len(inp)} | already done {len(done)} | translating {len(remaining)} in {len(batches)} batches '
          f'(size {BATCH}, conc {CONC}) via {MODEL.split("/")[-1]}', flush=True)
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=CONC) as ex:
        futs = [ex.submit(do_batch, i, b) for i, b in enumerate(batches)]
        for _ in as_completed(futs): pass
    dt = time.time() - t0
    # gpt-oss-120b Fireworks ~ $0.15/M in, $0.60/M out (estimate)
    cost = _stats['in'] / 1e6 * 0.15 + _stats['out'] / 1e6 * 0.60
    print(f'\nDONE in {dt/60:.1f} min | translated {_stats["ok"]} | dropped {_stats["bad"]} | failed batches {_stats["failed_batches"]}')
    print(f'tokens in/out: {_stats["in"]:,}/{_stats["out"]:,} | est cost ~${cost:.2f}')

if __name__ == '__main__':
    main()
