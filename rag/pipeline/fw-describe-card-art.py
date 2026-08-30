#!/usr/bin/env python3
"""Say what picture each ORIGINAL card wants, so its illustration can be matched properly.

The 16,989 original cards were never put through the two-stage matcher — they still carry
whatever the old token-overlap matcher gave them, the one that pairs on a shared modifier.
It is visibly wrong in the app: a card about a fruit DOVE is illustrated with a fruit BAT,
because both sentences contain "fruit".

They cannot simply be re-matched, because they are missing the input that made the DepEd pass
work. A DepEd card carries a one-sentence description of the picture it wants, written when
the card was written; an original card has only its slug and its text. Matching a FACT against
a picture DESCRIPTION means comparing two different kinds of sentence, and retrieval is weak
across that gap. So this writes the missing sentence first, and the existing matcher then runs
on the same footing it had before.

  set -a; source ./.env.local; set +a
  python3 rag/pipeline/fw-describe-card-art.py
  FW_LIMIT=60 python3 rag/pipeline/fw-describe-card-art.py    # calibration slice

Writes rag/pipeline/original-art-wanted.json, keyed by card id; resumable.

Env: FW_MODEL, FW_CONC, FW_BATCH, FW_LIMIT.
"""
import os, json, time, threading, collections, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
UI = os.path.join(os.path.dirname(ROOT), 'hiraia-card-ui')
POOL = os.path.join(UI, 'rag/pipeline/cardsPool.app.json')
OUT = os.path.join(HERE, 'original-art-wanted.json')
URL = 'https://api.fireworks.ai/inference/v1/chat/completions'
KEY = os.environ['FIREWORKS_API_KEY']
MODEL = os.environ.get('FW_MODEL', 'accounts/fireworks/models/deepseek-v4-pro-0813')
CONC = int(os.environ.get('FW_CONC', '24'))
BATCH = int(os.environ.get('FW_BATCH', '10'))
LIMIT = int(os.environ.get('FW_LIMIT', '0'))
SEP = '\n\n'
_lock = threading.Lock()
_stats = collections.Counter()
_T0 = time.time()


def call(prompt, attempt=0):
    payload = {'model': MODEL, 'temperature': 0.2, 'max_tokens': 4000,
               'chat_template_kwargs': {'thinking': False},
               'messages': [{'role': 'user', 'content': prompt}]}
    req = urllib.request.Request(URL, data=json.dumps(payload).encode(), headers={
        'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json'})
    try:
        r = json.load(urllib.request.urlopen(req, timeout=600))
        u = r.get('usage', {})
        with _lock:
            _stats['in'] += u.get('prompt_tokens', 0)
            _stats['out'] += u.get('completion_tokens', 0)
        return r['choices'][0]['message'].get('content') or ''
    except urllib.error.HTTPError as e:
        if e.code in (412, 429, 500, 502, 503, 529) and attempt < 6:
            time.sleep(min(90, 2 ** (attempt + 1)))
            return call(prompt, attempt + 1)
        raise
    except (urllib.error.URLError, TimeoutError):
        if attempt < 6:
            time.sleep(min(90, 2 ** (attempt + 1)))
            return call(prompt, attempt + 1)
        raise


def obj_from(s):
    a, b = s.find('{'), s.rfind('}')
    if a >= 0 and b > a:
        try:
            return json.loads(s[a:b + 1])
        except Exception:
            return None
    return None


def prompt_for(batch):
    rows = []
    for n, c in enumerate(batch, 1):
        text = (c['fact'].get('en') or '').replace(SEP, ' ')
        rows.append(f'  CARD {n}\n   {text}')
    return f'''For each science card below, describe in ONE sentence the single picture that would best
help a child understand it.

Return STRICT JSON only:
{{"cards": [{{"card": 1, "art": "..."}}]}}

- Describe the concrete SUBJECT and what it is doing. This is going to be matched against a
  library of existing drawings, so name the thing plainly: "a fruit dove swallowing a small
  fruit whole", not "the wonder of seed dispersal".
- Name the specific animal, plant, organ, object or apparatus. If the card is about a fruit
  dove, the sentence must say fruit dove — a picture of some other fruit-eating animal is
  exactly the error this is fixing.
- One picture, one moment. No collages, no multi-panel scenes, no before-and-after.
- If the card is abstract and there is no honest picture for it — a definition, a unit, a
  rule — give an empty string. That is a normal answer, and a card with no good picture is
  better served by type than by a loosely related drawing.
- No style instructions, no mention of text, labels or captions in the image.

CARDS
{chr(10).join(rows)}'''


def do_batch(batch):
    try:
        got = obj_from(call(prompt_for(batch)))
    except Exception as e:
        with _lock:
            _stats['failed'] += len(batch)
        print(f'  FAIL {type(e).__name__}', flush=True)
        return {}
    out = {}
    for r in (got or {}).get('cards') or []:
        try:
            n = int(r['card'])
        except (KeyError, TypeError, ValueError):
            continue
        if 1 <= n <= len(batch):
            art = str(r.get('art') or '').strip()
            out[batch[n - 1]['id']] = art
            with _lock:
                _stats['described' if art else 'no honest picture'] += 1
    with _lock:
        _stats['done'] += len(batch)
        if _stats['done'] % 1500 < BATCH:
            cost = _stats['in'] * 1.6 / 1e6 + _stats['out'] * 4 / 1e6
            print(f"  ...{_stats['done']:,} | described {_stats['described']:,} | "
                  f"abstract {_stats['no honest picture']:,} | ${cost:.2f} | "
                  f"{(time.time()-_T0)/60:.1f} min", flush=True)
    return out


def main():
    cards = [c for c in json.load(open(POOL))['cards'] if c.get('source') != 'deped']
    done = json.load(open(OUT)) if os.path.exists(OUT) else {}
    todo = [c for c in cards if c['id'] not in done]
    if LIMIT:
        step = max(1, len(todo) // LIMIT)
        todo = todo[::step][:LIMIT]
    print(f'{len(cards):,} original cards | {len(done):,} described | {len(todo):,} to do')
    batches = [todo[i:i + BATCH] for i in range(0, len(todo), BATCH)]
    with ThreadPoolExecutor(max_workers=CONC) as ex:
        futs = [ex.submit(do_batch, b) for b in batches]
        for n, f in enumerate(as_completed(futs), 1):
            done.update(f.result())
            if n % 150 == 0:
                json.dump(done, open(OUT, 'w'), ensure_ascii=False)
    json.dump(done, open(OUT, 'w'), ensure_ascii=False)
    cost = _stats['in'] * 1.6 / 1e6 + _stats['out'] * 4 / 1e6
    print(f"\nDONE in {(time.time()-_T0)/60:.1f} min | ${cost:.2f} | failed {_stats['failed']}")
    print(f"  {len(done):,} cards | wants a picture {_stats['described']:,} | "
          f"abstract {_stats['no honest picture']:,}")


if __name__ == '__main__':
    main()
