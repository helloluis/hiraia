#!/usr/bin/env python3
"""STAGE D2 — choose the card's illustration from its shortlist, or say there isn't one.

match-illustrations.py narrows ~23k illustrations down to the 8 nearest for each card. That
step is good at recall and bad at the final pick: the correct picture is usually in the eight,
but rarely first, and the cosine gaps between right and wrong are ~0.006 — noise. No threshold
can be drawn through that, so the choice is made by a model that can actually look at the two
descriptions and say whether they depict the same thing.

Saying NO matters as much as picking. The library was drawn for the previous bank, so many new
cards simply have no picture yet — "a cow swishing its tail to flick away flies" has none, and
the old token-overlap matcher answered "wading bird pulling worm from mud". A card with no
illustration is a card we know to draw; a card with the wrong one is a card that teaches the
wrong thing.

  set -a; source ./.env.local; set +a
  python3 rag/pipeline/fw-rerank-illustrations.py
  FW_LIMIT=200 python3 rag/pipeline/fw-rerank-illustrations.py     # calibration slice

Env: FW_MODEL, FW_CONC, FW_LIMIT, FW_BATCH.
"""
import os, json, time, threading, collections, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'card-illustrations.json')
OUT = os.path.join(HERE, 'card-illustrations.chosen.json')
URL = 'https://api.fireworks.ai/inference/v1/chat/completions'
KEY = os.environ['FIREWORKS_API_KEY']
MODEL = os.environ.get('FW_MODEL', 'accounts/fireworks/models/deepseek-v4-pro-0813')
CONC = int(os.environ.get('FW_CONC', '24'))
BATCH = int(os.environ.get('FW_BATCH', '8'))
LIMIT = int(os.environ.get('FW_LIMIT', '0'))

_lock = threading.Lock()
_stats = collections.Counter()
_T0 = time.time()


def call(prompt, attempt=0):
    payload = {'model': MODEL, 'temperature': 0.0, 'max_tokens': 4000,
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
    blocks = []
    for n, r in enumerate(batch, 1):
        opts = '\n'.join(f'     {i}. {c["text"][:150]}'
                         for i, c in enumerate(r['candidates'], 1))
        blocks.append(f'  CARD {n}\n   wants: {r["illustration"]}\n   available:\n{opts}')
    body = '\n\n'.join(blocks)
    return f'''Each card below describes the picture it needs. Under it are existing pictures we
already own. For each card, pick the ONE existing picture that could genuinely serve as its
illustration, or 0 if none of them can.

Return STRICT JSON only:
{{"picks": [{{"card": 1, "choice": 0}}, ...]}}   one entry per card, in order

WHEN TO PICK A NUMBER
  The picture shows the same subject doing the same thing, so a child looking at it while
  reading the card would see what the card is about. Wording may differ completely.
    "a fuzzy bee landing on a pink flower, dusted with pollen"  ->  "bee on flower pollinating"
    "wet clothes on a line under a bright sun"  ->  "clothes drying on a line in sunlight"

WHEN TO ANSWER 0
  Be strict, and expect 0 to be a common answer. These pictures were drawn for a different
  set of cards, so most cards here have no picture yet. Answer 0 whenever the best option is
  merely the same general topic, or the same category of thing, rather than the same subject:
    "a cow swishing its tail to flick away flies"   vs "wading bird pulling worm from mud" -> 0
    "a puddle spreading flat with no fixed shape"   vs "dishwashing liquid on a greasy plate" -> 0
    "a mother dog with her puppies"                 vs "bat pup clinging to mother" -> 0
  A wrong picture is worse than no picture: it teaches the child something the card never said.
  If you are hesitating, the answer is 0.

{body}'''


def do_batch(batch, bi):
    try:
        got = obj_from(call(prompt_for(batch)))
    except Exception as e:
        with _lock:
            _stats['failed'] += len(batch)
        print(f'  FAIL batch {bi}: {type(e).__name__}', flush=True)
        return []
    picks = {}
    for p in (got or {}).get('picks') or []:
        try:
            picks[int(p['card'])] = int(p['choice'])
        except (KeyError, TypeError, ValueError):
            continue
    out = []
    for n, r in enumerate(batch, 1):
        ch = picks.get(n, 0)
        chosen = r['candidates'][ch - 1] if 1 <= ch <= len(r['candidates']) else None
        out.append({**{k: r[k] for k in ('drive_id', 'shard', 'i', 'title', 'illustration')},
                    'match': chosen['ref'] if chosen else None,
                    'kind': chosen['kind'] if chosen else None,
                    'score': chosen['score'] if chosen else None,
                    'matched_text': chosen['text'] if chosen else None,
                    'top1_score': r['candidates'][0]['score'] if r['candidates'] else None})
    with _lock:
        _stats['done'] += len(batch)
        _stats['matched'] += sum(1 for o in out if o['match'])
        if _stats['done'] % 800 < BATCH:
            el = (time.time() - _T0) / 60
            cost = _stats['in'] * 1.6 / 1e6 + _stats['out'] * 4 / 1e6
            print(f"  ...{_stats['done']:,} cards | matched {_stats['matched']:,} "
                  f"({_stats['matched']/max(_stats['done'],1)*100:.0f}%) | ${cost:.2f} | {el:.1f} min",
                  flush=True)
    return out


def main():
    rows = json.load(open(SRC))
    rows = [r for r in rows if r.get('candidates')]
    if LIMIT:
        step = max(1, len(rows) // LIMIT)
        rows = rows[::step][:LIMIT]
    done = {}
    if os.path.exists(OUT):
        for r in json.load(open(OUT)):
            done[(r['shard'], r['i'])] = r
        rows = [r for r in rows if (r['shard'], r['i']) not in done]
        print(f'  resuming: {len(done):,} already chosen')
    batches = [rows[i:i + BATCH] for i in range(0, len(rows), BATCH)]
    print(f'{len(rows):,} cards | {len(batches):,} batches of {BATCH} | conc {CONC}')

    results = list(done.values())
    with ThreadPoolExecutor(max_workers=CONC) as ex:
        futs = [ex.submit(do_batch, b, i) for i, b in enumerate(batches)]
        for n, f in enumerate(as_completed(futs), 1):
            results.extend(f.result())
            if n % 100 == 0:
                json.dump(results, open(OUT, 'w'), ensure_ascii=False)
    json.dump(results, open(OUT, 'w'), ensure_ascii=False)

    hit = [r for r in results if r['match']]
    cost = _stats['in'] * 1.6 / 1e6 + _stats['out'] * 4 / 1e6
    print(f"\nDONE in {(time.time()-_T0)/60:.1f} min | ${cost:.2f}")
    print(f"  {len(results):,} cards | matched {len(hit):,} ({len(hit)/max(len(results),1)*100:.0f}%) "
          f"| need drawing {len(results)-len(hit):,}")
    if hit:
        ranks = collections.Counter()
        for r in hit:
            ranks[r['score']] = ranks.get(r['score'], 0)
        used = len({r['match'] for r in hit})
        print(f"  distinct illustrations used: {used:,}")
        rescued = sum(1 for r in hit if r['score'] != r['top1_score'])
        print(f"  picks that were NOT retrieval's top-1: {rescued:,} ({rescued/len(hit)*100:.0f}%)")


if __name__ == '__main__':
    main()
