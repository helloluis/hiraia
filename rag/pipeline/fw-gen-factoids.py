#!/usr/bin/env python3
"""Generate FEED FACTOIDS from staged source facts via Fireworks (qwen3.7-plus). One feed
factoid per source fact, faithful to the source (NO new claims). The source facts are already
trilingual+verified, so the model REWRITES into a punchy grade-5 feed voice grounded on the
provided EN/TL/BIS — it does not translate from scratch.

Format + difficulty are pre-assigned deterministically (per factId hash) for a controlled
~45% Q&A ratio, matching the biology batches. Output per fact:
  {factId, format, q_en, q_tl, q_bis, t_en, t_tl, t_bis, image_prompt, difficulty}
Written to gen-{tag}-{idx}.jsonl; assemble-factoids.py joins them back to the src for slug/topic.

  set -a; source ./.env.local; set +a
  SRC=rag/pipeline/factoids-MATTER-src.jsonl TAG=matter FW_LIMIT=2 python3 rag/pipeline/fw-gen-factoids.py
  SRC=rag/pipeline/factoids-MATTER-src.jsonl TAG=matter python3 rag/pipeline/fw-gen-factoids.py
"""
import os, json, glob, time, threading, hashlib, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.environ['SRC']
TAG = os.environ.get('TAG') or os.path.splitext(os.path.basename(SRC))[0]
OUT = os.path.join(HERE, f'factoids-gen-{TAG}')
MODEL = 'accounts/fireworks/models/qwen3p7-plus'
URL = 'https://api.fireworks.ai/inference/v1/chat/completions'
KEY = os.environ['FIREWORKS_API_KEY']
CONC = int(os.environ.get('FW_CONC', '10'))
LIMIT = int(os.environ.get('FW_LIMIT', '0'))
PER_CALL = int(os.environ.get('FW_PER_CALL', '8'))
QA_RATIO = float(os.environ.get('FW_QA_RATIO', '0.45'))
os.makedirs(OUT, exist_ok=True)

STYLE = ('hand-drawn line art, black and white, clean single-weight ink outlines, no shading '
         'and no color, simple and friendly for children, centered on a plain white background')

def h(s):
    return int(hashlib.md5(s.encode()).hexdigest()[:8], 16)

def fmt_for(fid):
    return 'qa' if (h(fid) % 100) < int(QA_RATIO * 100) else 'straight'

def diff_for(grades):
    g = min(grades) if grades else 5
    return 0 if g <= 3 else (1 if g <= 5 else 2)

def call(prompt, attempt=0):
    body = json.dumps({'model': MODEL, 'temperature': 0.6, 'max_tokens': 16000,
                       'messages': [{'role': 'user', 'content': prompt}]}).encode()
    req = urllib.request.Request(URL, data=body, headers={'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json'})
    try:
        r = json.load(urllib.request.urlopen(req, timeout=300))
        m = r['choices'][0]['message']; u = r.get('usage', {})
        return (m.get('content') or '', m.get('reasoning_content') or '', u.get('prompt_tokens', 0), u.get('completion_tokens', 0))
    except urllib.error.HTTPError as e:
        if e.code in (429, 500, 502, 503, 529) and attempt < 6:
            ra = e.headers.get('Retry-After'); time.sleep(float(ra) if ra else min(90, 2 ** (attempt + 1)))
            return call(prompt, attempt + 1)
        raise
    except (urllib.error.URLError, TimeoutError):
        if attempt < 6:
            time.sleep(min(90, 2 ** (attempt + 1))); return call(prompt, attempt + 1)
        raise

def arr_from(content, reasoning):
    for c in (content, reasoning):
        s = (c or '').strip(); a, b = s.find('['), s.rfind(']')
        if a >= 0 and b > a:
            try: return json.loads(s[a:b + 1])
            except Exception: pass
    return None

def prompt_for(batch):
    lines = []
    for i, f in enumerate(batch):
        lines.append(json.dumps({
            'i': i, 'factId': f['id'], 'format': fmt_for(f['id']), 'need_image_prompt': not f['has_image'],
            'en': f['en'], 'tl': f['tl'], 'bis': f['bis'],
        }, ensure_ascii=False))
    facts_block = '\n'.join(lines)
    return f'''You turn verified science facts into short cards for a Filipino grade-5 (10-year-old) science FEED — kids swipe through one fact per card. For EACH input fact, write ONE card.

TRILINGUAL: every card needs English (en), Tagalog (tl), and Bisaya/Cebuano (bis). The source already gives you correct en/tl/bis — REWRITE them into a lively, warm, kid-friendly feed voice. Keep them SHORT (about 15-30 words). Keep scientific/English key terms as-is where the source does.
FAITHFUL (HARD RULE): say only what the source fact says. Do NOT add new facts, numbers, names, or claims. If unsure, stay closer to the source.

FORMAT is given per fact:
- "qa": pose a natural, curiosity-sparking QUESTION (q_en/q_tl/q_bis), then answer it in the body (t_en/t_tl/t_bis). The question is the hook; the body is the answer.
- "straight": no question (leave q_* ""). Just the fact as a punchy statement in t_en/t_tl/t_bis.

IMAGE: if need_image_prompt is true, write ONE image_prompt in ENGLISH describing a simple illustration for this fact. It MUST end verbatim with this exact style phrase: "{STYLE}". If need_image_prompt is false, set image_prompt to "".

INPUT FACTS (one JSON per line):
{facts_block}

Reason briefly, then output ONLY a JSON array, one object per input fact, same order:
{{"i":0,"factId":"...","format":"qa|straight","q_en":"","q_tl":"","q_bis":"","t_en":"...","t_tl":"...","t_bis":"...","image_prompt":"...","difficulty":0}}
For "straight" cards q_en/q_tl/q_bis must be "". Copy factId and format exactly from the input.'''

_lock = threading.Lock()
_stats = {'in': 0, 'out': 0, 'items': 0, 'calls': 0, 'failed': 0}

def do_call(batch, idx):
    try:
        c, rc, pin, pout = call(prompt_for(batch))
    except Exception as e:
        with _lock: _stats['failed'] += 1
        print(f'  FAIL {TAG}#{idx}: {type(e).__name__}', flush=True); return
    arr = arr_from(c, rc) or []
    by_i = {o.get('i'): o for o in arr if isinstance(o, dict)}
    rows = []
    for i, f in enumerate(batch):
        o = by_i.get(i) or {}
        fmt = fmt_for(f['id'])
        t_en = str(o.get('t_en', '')).strip()
        if not t_en:  # skip empties; a later backfill pass can catch the misses
            continue
        rows.append({
            'factId': f['id'], 'format': fmt,
            'q_en': str(o.get('q_en', '')).strip() if fmt == 'qa' else '',
            'q_tl': str(o.get('q_tl', '')).strip() if fmt == 'qa' else '',
            'q_bis': str(o.get('q_bis', '')).strip() if fmt == 'qa' else '',
            't_en': t_en, 't_tl': str(o.get('t_tl', '')).strip(), 't_bis': str(o.get('t_bis', '')).strip(),
            'image_prompt': '' if f['has_image'] else str(o.get('image_prompt', '')).strip(),
            'difficulty': diff_for(f.get('grades', [5])),
        })
    with open(os.path.join(OUT, f'gen-{TAG}-{idx}.jsonl'), 'w') as fh:
        for r in rows:
            fh.write(json.dumps(r, ensure_ascii=False) + '\n')
    with _lock:
        _stats['in'] += pin; _stats['out'] += pout; _stats['items'] += len(rows); _stats['calls'] += 1
        if _stats['calls'] % 25 == 0:
            print(f"  ...{_stats['calls']} calls | {_stats['items']} factoids | {_stats['out']//1000}k out", flush=True)

def main():
    facts = [json.loads(l) for l in open(SRC) if l.strip()]
    batches = [facts[i:i + PER_CALL] for i in range(0, len(facts), PER_CALL)]
    done = {os.path.basename(fn) for fn in glob.glob(os.path.join(OUT, 'gen-*.jsonl'))}
    work = [(b, i) for i, b in enumerate(batches) if f'gen-{TAG}-{i}.jsonl' not in done]
    if LIMIT: work = work[:LIMIT]
    print(f'{TAG}: {len(facts)} facts -> {len(batches)} batches ({PER_CALL}/call), {len(work)} to run (conc {CONC})', flush=True)
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=CONC) as ex:
        for _ in as_completed([ex.submit(do_call, b, i) for b, i in work]): pass
    cost = _stats['in'] / 1e6 * 0.22 + _stats['out'] / 1e6 * 0.88
    print(f"\n{TAG} DONE in {(time.time()-t0)/60:.1f} min | {_stats['items']} factoids from {_stats['calls']} calls | failed {_stats['failed']}")
    print(f"tokens in/out {_stats['in']:,}/{_stats['out']:,} | est cost ~${cost:.2f}")

if __name__ == '__main__':
    main()
