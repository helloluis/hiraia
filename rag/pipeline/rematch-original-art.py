#!/usr/bin/env python3
"""Re-match the ORIGINAL cards' illustrations: shortlist by meaning, then let a model decide.

The 16,989 original cards never went through this. They carry whatever the old token-overlap
matcher assigned, which pairs on any shared word including a modifier — a fruit DOVE card
illustrated with a fruit BAT, a card about comparing teeth illustrated with a hunt, a heron
standing still illustrated with a heron in flight.

Same two stages that fixed the DepEd cards, and for the same reason: on this library
retrieval is good at RECALL and bad at the final pick — the right picture is usually inside
the top eight but rarely first, and the cosine gaps between right and wrong are ~0.006. A bear
in snow once matched "mossy cloud forest" at 0.708, ABOVE several correct picks at 0.626. No
threshold can be drawn through that, so the shortlist goes to a model that can compare the two
descriptions and reject all of them.

The card's CURRENT illustration is always added to the shortlist, so a pairing that is already
right can be kept rather than churned, and one that is wrong is rejected on its merits rather
than merely displaced.

  llama-server -m rag/embeddings-spike/models/labse-fp16.gguf --embedding --port 8771 \\
      -c 512 -ngl 99 --pooling mean --log-disable &
  set -a; source ./.env.local; set +a
  python3 rag/pipeline/rematch-original-art.py

Writes rag/pipeline/original-art-chosen.json: card id -> slug or null.

Env: PORT, FW_MODEL, FW_CONC, FW_BATCH, FW_LIMIT, TOPK.
"""
import os, json, math, time, threading, collections, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
UI = os.path.join(os.path.dirname(ROOT), 'hiraia-card-ui')
POOL = os.path.join(UI, 'rag/pipeline/cardsPool.app.json')
WANTED = os.path.join(HERE, 'original-art-wanted.json')
ITEMS = os.path.join(HERE, 'illustration-items.json')
VECS = os.path.join(HERE, 'illustration-vectors.npy')
OUT = os.path.join(HERE, 'original-art-chosen.json')
QVEC = os.path.join(HERE, 'original-art-qvectors.npy')
URL = 'https://api.fireworks.ai/inference/v1/chat/completions'
KEY = os.environ['FIREWORKS_API_KEY']
MODEL = os.environ.get('FW_MODEL', 'accounts/fireworks/models/deepseek-v4-pro-0813')
PORT = os.environ.get('PORT', '8771')
CONC = int(os.environ.get('FW_CONC', '24'))
BATCH = int(os.environ.get('FW_BATCH', '8'))
LIMIT = int(os.environ.get('FW_LIMIT', '0'))
TOPK = int(os.environ.get('TOPK', '8'))
EMB_BATCH = 64
_lock = threading.Lock()
_stats = collections.Counter()
_T0 = time.time()


def embed(texts):
    for a in range(12):
        try:
            req = urllib.request.Request(
                f'http://127.0.0.1:{PORT}/v1/embeddings',
                data=json.dumps({'input': texts}).encode(),
                headers={'Content-Type': 'application/json'})
            d = json.load(urllib.request.urlopen(req, timeout=300))['data']
            v = np.asarray([x['embedding'] for x in d], dtype=np.float32)
            return v / np.clip(np.linalg.norm(v, axis=1, keepdims=True), 1e-9, None)
        except Exception:
            if a == 11:
                raise
            time.sleep(min(30, 2 * (a + 1)))


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
    for n, (card, wanted, cands) in enumerate(batch, 1):
        opts = '\n'.join(f'     {i}. {c["text"][:150]}' for i, c in enumerate(cands, 1))
        blocks.append(f'  CARD {n}\n   wants: {wanted}\n   available:\n{opts}')
    return f'''Each card below says what picture it needs. Under it are existing pictures we already own.
Pick the ONE that could genuinely serve as its illustration, or 0 if none can.

THE TEST IS THE SUBJECT, NOT THE MOMENT.
  A picture serves the card when it shows the same THING. A different moment in that thing's
  life, a wider or tighter framing, or extra detail around it are all FINE — a child looking
  at it still sees what the card is about.
    wants "a coral reef growing upward toward sunlight"
      vs  "a coral reef habitat"                          -> YES, same thing
    wants "a bulldozer clearing forest trees"
      vs  "deforestation, before and after"               -> YES, same thing
    wants "a single sampaguita flower on a stem"
      vs  "an insect on a sampaguita flower"              -> YES, the flower is there
    wants "a fruit dove swallowing a fruit whole"
      vs  "a fruit dove (punay)"                          -> YES

ANSWER 0 WHEN THE THING ITSELF IS DIFFERENT.
  Not "not the exact pose" — a different animal, a different instrument, a different object.
  These are real pairings this pass exists to remove:
    wants "a fruit dove eating fruit"        vs "a fruit bat dispersing seeds"    -> 0
    wants "a wind vane showing wind direction" vs "a magnetic compass"            -> 0
    wants "a milkfish swimming in a fishpond"  vs "rellenong bangus, a cooked dish" -> 0
    wants "a heron standing still to hunt"     vs "a heron in flight"             -> 0
  A wrong picture is worse than none: the card then teaches a child something it never said.
  But dropping a picture that DOES show the subject is its own loss — that card falls back to
  type for no reason. Choose 0 for a different thing, not for a different angle on the right
  one.

Return STRICT JSON only:
{{"picks": [{{"card": 1, "choice": 0}}, ...]}}   one entry per card, in order

{chr(10).join(blocks)}'''


def do_batch(batch):
    try:
        got = obj_from(call(prompt_for(batch)))
    except Exception as e:
        with _lock:
            _stats['failed'] += len(batch)
        print(f'  FAIL {type(e).__name__}', flush=True)
        return {}
    picks = {}
    for p in (got or {}).get('picks') or []:
        try:
            picks[int(p['card'])] = int(p['choice'])
        except (KeyError, TypeError, ValueError):
            continue
    out = {}
    for n, (card, wanted, cands) in enumerate(batch, 1):
        ch = picks.get(n, 0)
        chosen = cands[ch - 1]['ref'] if 1 <= ch <= len(cands) else None
        out[card['id']] = chosen
        with _lock:
            if chosen is None:
                _stats['no picture'] += 1
            elif chosen == card.get('slug'):
                _stats['kept'] += 1
            else:
                _stats['replaced'] += 1
    with _lock:
        _stats['done'] += len(batch)
        if _stats['done'] % 1200 < BATCH:
            cost = _stats['in'] * 1.6 / 1e6 + _stats['out'] * 4 / 1e6
            print(f"  ...{_stats['done']:,} | kept {_stats['kept']:,} | "
                  f"replaced {_stats['replaced']:,} | none {_stats['no picture']:,} | "
                  f"${cost:.2f} | {(time.time()-_T0)/60:.1f} min", flush=True)
    return out


def main():
    pool = [c for c in json.load(open(POOL))['cards'] if c.get('source') != 'deped']
    wanted = json.load(open(WANTED))
    items = json.load(open(ITEMS))
    vecs = np.load(VECS)
    by_ref = {it['ref']: i for i, it in enumerate(items)}
    print(f'  library {len(items):,} illustrations | {len(wanted):,} cards described')

    work = [c for c in pool if (wanted.get(c['id']) or '').strip()]
    skipped = len(pool) - len(work)
    if LIMIT:
        step = max(1, len(work) // LIMIT)
        work = work[::step][:LIMIT]
    print(f'  {len(work):,} cards want a picture ({skipped:,} judged abstract, left as-is)')

    if os.path.exists(QVEC) and len(np.load(QVEC)) == len(work):
        qv = np.load(QVEC)
        print(f'  query vectors cached {qv.shape}')
    else:
        print('  embedding what each card wants...')
        parts, t0 = [], time.time()
        for i in range(0, len(work), EMB_BATCH):
            parts.append(embed([wanted[c['id']] for c in work[i:i + EMB_BATCH]]))
            if (i // EMB_BATCH) % 40 == 0 and i:
                print(f'    {i:,}/{len(work):,}  {i/(time.time()-t0):.0f}/s', flush=True)
        qv = np.vstack(parts)
        np.save(QVEC, qv)

    print('  shortlisting...')
    batches, cur = [], []
    for i in range(0, len(work), 512):
        blk = qv[i:i + 512]
        sims = blk @ vecs.T
        idx = np.argpartition(-sims, TOPK, axis=1)[:, :TOPK]
        rows = np.arange(len(idx))[:, None]
        idx = idx[rows, np.argsort(-sims[rows, idx], axis=1)]
        for c, ids in zip(work[i:i + 512], idx):
            cands = [items[int(j)] for j in ids]
            # the card's CURRENT picture always gets a hearing
            cur_ref = c.get('slug')
            if cur_ref and cur_ref in by_ref and all(x['ref'] != cur_ref for x in cands):
                cands = cands[:-1] + [items[by_ref[cur_ref]]]
            cur.append((c, wanted[c['id']], cands))
            if len(cur) == BATCH:
                batches.append(cur)
                cur = []
    if cur:
        batches.append(cur)
    print(f'  {len(batches):,} batches of {BATCH} | conc {CONC}')

    chosen = json.load(open(OUT)) if os.path.exists(OUT) else {}
    todo = [b for b in batches if any(x[0]['id'] not in chosen for x in b)]
    with ThreadPoolExecutor(max_workers=CONC) as ex:
        futs = [ex.submit(do_batch, b) for b in todo]
        for n, f in enumerate(as_completed(futs), 1):
            chosen.update(f.result())
            if n % 150 == 0:
                json.dump(chosen, open(OUT, 'w'), ensure_ascii=False)
    json.dump(chosen, open(OUT, 'w'), ensure_ascii=False)

    cost = _stats['in'] * 1.6 / 1e6 + _stats['out'] * 4 / 1e6
    print(f"\nDONE in {(time.time()-_T0)/60:.1f} min | ${cost:.2f} | failed {_stats['failed']}")
    print(f"  kept {_stats['kept']:,} | replaced {_stats['replaced']:,} | "
          f"no good picture {_stats['no picture']:,}")


if __name__ == '__main__':
    main()
