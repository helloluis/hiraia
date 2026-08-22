#!/usr/bin/env python3
"""STAGE 1 of the card-title/taxonomy pass: DERIVE a controlled category vocabulary from the
card pool instead of inventing one from intuition.

The feed's only taxonomy today is `domain`, which has FOUR values across 16,948 cards — far too
coarse for "other marine life" style navigation. This script does the open-vocabulary half:
it shows the model a large stratified sample of card TOPICS (topics are short, so a wide sample
is cheap) and asks it to propose a free-form category per topic. The proposals are then counted
and normalised; a human curates the result into the fixed ladder in card-taxonomy.json.

Two-stage on purpose: 16,948 independent label inventions would yield thousands of near-synonyms
("sea animals" / "marine life" / "ocean creatures") and "other <category>" could never group
anything. This pass is allowed to be messy BECAUSE its output is curated, not shipped.

  set -a; source ./.env.local; set +a
  python3 rag/pipeline/fw-derive-card-taxonomy.py
"""
import os, json, glob, time, threading, random, collections, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
POOL = os.path.join(ROOT, 'packages/mobile/src/generated/cardsPool.generated.json')
OUT = os.path.join(HERE, 'taxonomy-probe')
# deepseek-v4-flash: benchmarked head-to-head against qwen3p7-plus on this exact task —
# qwen burned its whole token budget on reasoning and returned nothing parseable, deepseek
# completed cleanly. Both are reasoning models, hence the generous max_tokens below.
MODEL = os.environ.get('FW_MODEL', 'accounts/fireworks/models/deepseek-v4-flash-0731')
URL = 'https://api.fireworks.ai/inference/v1/chat/completions'
KEY = os.environ['FIREWORKS_API_KEY']
CONC = int(os.environ.get('FW_CONC', '12'))
PER_CALL = int(os.environ.get('FW_PER_CALL', '120'))
SAMPLE = int(os.environ.get('FW_SAMPLE', '3000'))
SEED = int(os.environ.get('FW_SEED', '11'))
os.makedirs(OUT, exist_ok=True)


def call(prompt, attempt=0):
    body = json.dumps({'model': MODEL, 'temperature': 0.3, 'max_tokens': 32000,
                       'messages': [{'role': 'user', 'content': prompt}]}).encode()
    req = urllib.request.Request(URL, data=body, headers={
        'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json'})
    try:
        r = json.load(urllib.request.urlopen(req, timeout=300))
        m = r['choices'][0]['message']; u = r.get('usage', {})
        return (m.get('content') or '', m.get('reasoning_content') or '',
                u.get('prompt_tokens', 0), u.get('completion_tokens', 0))
    except urllib.error.HTTPError as e:
        if e.code in (429, 500, 502, 503, 529) and attempt < 6:
            ra = e.headers.get('Retry-After')
            time.sleep(float(ra) if ra else min(90, 2 ** (attempt + 1)))
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
    lines = '\n'.join(json.dumps({'i': i, 'domain': t['domain'], 'topic': t['topic']},
                                 ensure_ascii=False) for i, t in enumerate(batch))
    return f'''You are building a browsing taxonomy for a Filipino grade-school science card feed.
Each line below is one card's TOPIC. For each, name the SUBJECT CATEGORY a 10-year-old would
recognise it as belonging to — the kind of thing you could put after the words "other ...".

RULES
- 1-3 words, lower case, plural where natural: "marine animals", "weather", "simple machines".
- Name the SUBJECT, never the format or a modifier. Not "interesting facts", not "large things",
  not "Philippine facts" — a Philippine eagle is "birds".
- Prefer a category that would hold roughly 1-3% of a general grade-school science library:
  "birds" not "animals" (too broad) and not "eagles" (too narrow).
- If the topic is about a place/country, still categorise by the SCIENCE subject.

TOPICS
{lines}

Reason briefly, then output ONLY a JSON array, one object per topic, same order:
[{{"i":0,"cat":"..."}}]'''


_lock = threading.Lock()
_stats = {'in': 0, 'out': 0, 'items': 0, 'calls': 0, 'failed': 0}


def do_call(batch, idx, tries=3):
    # A parse MISS is not a failure to log and forget — it is retryable. The model reasons at
    # length (46k chars of reasoning against 3k of answer was measured) and intermittently
    # truncates the JSON array. Re-running the same batch by hand parses fine, so treat a
    # short/absent array exactly like a network error: back off and try again. Swallowing it
    # silently is how six shards came back "0 labels, failed 0" and were written as empty
    # files that a naive resume then skipped forever.
    arr, pin, pout = [], 0, 0
    for a in range(tries):
        try:
            c, rc, pin, pout = call(prompt_for(batch))
        except Exception as e:
            with _lock: _stats['failed'] += 1
            print(f'  FAIL #{idx}: {type(e).__name__}', flush=True); return
        arr = arr_from(c, rc) or []
        if len(arr) >= len(batch) * 0.8:
            break
        print(f'  #{idx} short parse ({len(arr)}/{len(batch)}) — retry {a + 1}/{tries}', flush=True)
        time.sleep(2 ** a)
    by_i = {o.get('i'): o for o in arr if isinstance(o, dict)}
    rows = []
    for i, t in enumerate(batch):
        cat = str((by_i.get(i) or {}).get('cat', '')).strip().lower()
        if cat:
            rows.append({'domain': t['domain'], 'topic': t['topic'], 'cat': cat})
    with open(os.path.join(OUT, f'probe-{idx}.jsonl'), 'w') as fh:
        for r in rows:
            fh.write(json.dumps(r, ensure_ascii=False) + '\n')
    with _lock:
        _stats['in'] += pin; _stats['out'] += pout
        _stats['items'] += len(rows); _stats['calls'] += 1
        print(f"  #{idx} -> {len(rows)} labels ({_stats['calls']} calls done)", flush=True)


def main():
    cards = json.load(open(POOL))['cards']
    # stratify by domain in proportion, so a small domain still gets enough labels to cluster
    by_dom = collections.defaultdict(list)
    for c in cards:
        by_dom[c['domain']].append(c)
    rnd = random.Random(SEED)
    picked = []
    for dom, cs in sorted(by_dom.items()):
        seen, uniq = set(), []
        for c in cs:                       # one card per distinct topic — labelling dupes is waste
            if c['topic'] not in seen:
                seen.add(c['topic']); uniq.append(c)
        n = max(200, round(SAMPLE * len(cs) / len(cards)))
        picked += rnd.sample(uniq, min(n, len(uniq)))
    rnd.shuffle(picked)
    batches = [picked[i:i + PER_CALL] for i in range(0, len(picked), PER_CALL)]
    done = {os.path.basename(p) for p in glob.glob(os.path.join(OUT, 'probe-*.jsonl'))
            if os.path.getsize(p) > 0}
    work = [(b, i) for i, b in enumerate(batches) if f'probe-{i}.jsonl' not in done]
    print(f'{len(picked)} topics -> {len(batches)} batches ({PER_CALL}/call), {len(work)} to run', flush=True)
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=CONC) as ex:
        for _ in as_completed([ex.submit(do_call, b, i) for b, i in work]): pass
    cost = _stats['in'] / 1e6 * 0.22 + _stats['out'] / 1e6 * 0.88
    print(f"\nDONE in {(time.time()-t0)/60:.1f} min | {_stats['items']} labels | failed {_stats['failed']}")
    print(f"tokens in/out {_stats['in']:,}/{_stats['out']:,} | est cost ~${cost:.2f}")


if __name__ == '__main__':
    main()
