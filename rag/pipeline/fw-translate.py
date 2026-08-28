#!/usr/bin/env python3
"""Translate remaining quiz questions EN -> tl/bis via Fireworks (gpt-oss-120b, reasoning low).

Bypasses the Claude/Sonnet cap (uses FIREWORKS_API_KEY credits). Resumable: skips any
question index `i` already present in XDIR/{tl,fw}-*.jsonl (XDIR = FW_XDIR or
rag/pipeline/quiz-xlate) whose row passes quiz_xlate_rules.translation_ok (distinct options,
sentence-length options really translated) — a stored row that fails it is redone. Thread-pooled
with exponential backoff on 429/5xx so we stay under Fireworks rate limits. Each run appends its
token ledger to XDIR/ledger.jsonl.

  set -a; source ./.env.local; set +a
  FW_DRY=1 python3 rag/pipeline/fw-translate.py        # plan only (done / remaining), no calls
  FW_LIMIT=60 python3 rag/pipeline/fw-translate.py     # validation slice
  python3 rag/pipeline/fw-translate.py                 # full remaining
  FW_INPUT=quiz-lane/translate-input.jsonl FW_XDIR=quiz-lane/xlate python3 rag/pipeline/fw-translate.py
"""
import os, sys, json, glob, time, threading, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from quiz_xlate_rules import translation_ok
INPUT = os.path.join(HERE, os.environ.get('FW_INPUT', 'quiz-translate-input.jsonl'))
XDIR = os.path.join(HERE, os.environ.get('FW_XDIR', 'quiz-xlate'))
os.makedirs(XDIR, exist_ok=True)
MODEL = 'accounts/fireworks/models/gpt-oss-120b'
URL = 'https://api.fireworks.ai/inference/v1/chat/completions'
KEY = os.environ['FIREWORKS_API_KEY']
BATCH = int(os.environ.get('FW_BATCH', '12'))
CONC = int(os.environ.get('FW_CONC', '6'))
LIMIT = int(os.environ.get('FW_LIMIT', '0'))  # 0 = all remaining
DRY = bool(os.environ.get('FW_DRY'))  # print the plan and exit without calling Fireworks

PROMPT_HEAD = '''Translate these grade-5 science quiz items from English into Tagalog (tl) and Cebuano/Bisaya (bis). Natural, simple, kid-friendly for a 10-year-old. Keep accurate science terms; English science words (oxygen, gravity, photosynthesis) are fine where Filipinos use them. Each item has fact_tl/fact_bis — use them as the terminology anchor so wording matches what the tutor teaches.
Return ONLY a JSON array, one object per item IN THE SAME ORDER, each exactly:
{"i":<same i>,"q_tl":"...","q_bis":"...","opt_tl":["a","b","c","d"],"opt_bis":["a","b","c","d"],"expl_tl":"...","expl_bis":"..."}
opt_tl/opt_bis each have EXACTLY 4 strings, SAME order as the English options. Preserve meaning exactly (a wrong option stays wrong). Translate ALL FOUR options too — an option left as a whole English sentence is a failure; only a single science term may stay English. The four options must remain four DIFFERENT texts in each language: if two would collapse to the same word (e.g. air/wind -> hangin), phrase them so they stay distinct (hangin / ihip ng hangin). No commentary.
ITEMS:
'''

_lock = threading.Lock()
_stats = {'in': 0, 'out': 0, 'ok': 0, 'bad': 0, 'batches': 0, 'failed_batches': 0}

def done_indices(by_i):
    """Indices with a stored row that passes translation_ok; a stored row that fails it is re-queued."""
    done = set()
    for fn in glob.glob(os.path.join(XDIR, 'tl-*.jsonl')) + glob.glob(os.path.join(XDIR, 'fw-*.jsonl')):
        for l in open(fn):
            l = l.strip()
            if l:
                try: t = json.loads(l)
                except Exception: continue
                if t['i'] not in by_i or translation_ok(by_i[t['i']]['options'], t): done.add(t['i'])
    return done

def call_fw(payload, attempt=0, r_finish=None):
    body = json.dumps({'model': MODEL, 'reasoning_effort': 'low', 'temperature': 0.2,
                       'max_tokens': 5000, 'messages': [{'role': 'user', 'content': PROMPT_HEAD + json.dumps(payload, ensure_ascii=False)}]}).encode()
    req = urllib.request.Request(URL, data=body, headers={'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json'})
    try:
        r = json.load(urllib.request.urlopen(req, timeout=180))
        msg = r['choices'][0]['message']; u = r.get('usage', {})
        if r_finish is not None: r_finish[0] = r['choices'][0].get('finish_reason')
        return (msg.get('content') or '', msg.get('reasoning_content') or '',
                u.get('prompt_tokens', 0), u.get('completion_tokens', 0))
    except urllib.error.HTTPError as e:
        if e.code in (429, 500, 502, 503, 529) and attempt < 5:
            ra = e.headers.get('Retry-After')
            time.sleep(float(ra) if ra else min(60, 2 ** (attempt + 1)))
            return call_fw(payload, attempt + 1, r_finish)
        raise
    except (urllib.error.URLError, TimeoutError) as e:
        if attempt < 5:
            time.sleep(min(60, 2 ** (attempt + 1)))
            return call_fw(payload, attempt + 1, r_finish)
        raise

def parse_array(c):
    s = c.strip()
    if s.startswith('```'):
        s = s.split('```', 2)[1].removeprefix('json').strip() if s.count('```') >= 2 else s.removeprefix('```json').removeprefix('```')
    a, b = s.find('['), s.rfind(']')
    if a < 0 or b <= a: return None
    try: return json.loads(s[a:b + 1])
    except Exception: return None

def valid(o, by_i):
    return (isinstance(o, dict) and o.get('i') in by_i and o.get('q_tl') and o.get('q_bis')
            and translation_ok(by_i[o['i']]['options'], o)
            and o.get('expl_tl') and o.get('expl_bis'))

def do_batch(idx, items):
    r_finish = [None]
    payload = [{'i': it['i'], 'q': it['q'], 'options': it['options'], 'explanation': it['explanation'],
                'fact_tl': it['fact_tl'], 'fact_bis': it['fact_bis']} for it in items]
    by_i = {it['i']: it for it in items}
    try:
        content, reasoning, pin, pout = call_fw(payload, r_finish=r_finish)
    except Exception as e:
        with _lock:
            _stats['failed_batches'] += 1
        print(f'  batch {idx}: FAILED {type(e).__name__} {str(e)[:80]}', flush=True)
        return
    arr = parse_array(content) or parse_array(reasoning) or []
    good = [o for o in arr if valid(o, by_i)]
    if len(good) < len(items):  # diagnostics only (counts, no content)
        print(f'  batch {idx} (i={items[0]["i"]}): {len(good)}/{len(items)} valid | parsed array len {len(arr)} | finish={r_finish[0]}', flush=True)
    outpath = os.path.join(XDIR, f'fw-{items[0]["i"]}.jsonl')
    with open(outpath, 'a') as f:  # append: a mop-up batch may start at the same i as an earlier partial batch
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
    done = done_indices({it['i']: it for it in inp})
    remaining = [it for it in inp if it['i'] not in done]
    if LIMIT: remaining = remaining[:LIMIT]
    batches = [remaining[i:i + BATCH] for i in range(0, len(remaining), BATCH)]
    print(f'input {len(inp)} | already done {len(done)} | translating {len(remaining)} in {len(batches)} batches '
          f'(size {BATCH}, conc {CONC}) via {MODEL.split("/")[-1]}', flush=True)
    if DRY: return
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=CONC) as ex:
        futs = [ex.submit(do_batch, i, b) for i, b in enumerate(batches)]
        for _ in as_completed(futs): pass
    dt = time.time() - t0
    # gpt-oss-120b Fireworks ~ $0.15/M in, $0.60/M out (estimate)
    cost = _stats['in'] / 1e6 * 0.15 + _stats['out'] / 1e6 * 0.60
    print(f'\nDONE in {dt/60:.1f} min | translated {_stats["ok"]} | dropped {_stats["bad"]} | failed batches {_stats["failed_batches"]}')
    print(f'tokens in/out: {_stats["in"]:,}/{_stats["out"]:,} | est cost ~${cost:.2f}')
    with open(os.path.join(XDIR, 'ledger.jsonl'), 'a') as f:
        f.write(json.dumps({'when': time.strftime('%Y-%m-%dT%H:%M:%S'), 'model': MODEL.split('/')[-1], 'items_attempted': len(remaining),
                            'batches': _stats['batches'], 'failed': _stats['failed_batches'], 'ok': _stats['ok'], 'bad': _stats['bad'],
                            'tok_in': _stats['in'], 'tok_out': _stats['out'], 'est_cost_usd': round(cost, 4),
                            'rate_in_per_M': 0.15, 'rate_out_per_M': 0.60, 'minutes': round(dt / 60, 1)}) + '\n')

if __name__ == '__main__':
    main()
