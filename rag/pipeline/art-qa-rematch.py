#!/usr/bin/env python3
"""Re-match the 1,115 wrong_assign cards: shortlist by LaBSE meaning, DeepSeek picks.

The art-QA triage judged these cards' CURRENT image as assigned to the wrong card
(the image is coherent, just not for this card). This gives each card a better slug
from the ~18.8k illustrations that both have a description vector (for retrieval)
and a local PNG (so the APK can actually render the pick).

Two stages, same architecture as rematch-original-art.py (recall by embedding,
final pick by model — cosine gaps of ~0.006 cannot support a threshold):
  1. LaBSE-embed the card's title+topic+fact, cosine top-8 from the library
     (current slug ALWAYS in the shortlist so a right pairing is kept, not churned).
  2. DeepSeek V4 Flash (reasoning off) picks the one that could genuinely serve,
     or 0 = keep current (no confident replacement).

  llama-server -m <labse gguf> --embedding --port 8771 -c 512 -ngl 99 --pooling mean &
  set -a; source <main checkout>/.env.local; set +a
  python3 rag/pipeline/art-qa-rematch.py            # all 1,115
  FW_LIMIT=50 python3 rag/pipeline/art-qa-rematch.py  # pilot

Writes rag/pipeline/art-qa/rematch.jsonl: {card_id, old_slug, new_slug, wanted, why}.
new_slug == old_slug when the model keeps the current pairing; null never occurs
(0 means "keep"). Resumable by card_id. The pool is NOT touched here — a separate
apply step does the swap after review.
"""
import os, json, time, threading, collections, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
MAIN = '/Users/luis/Code/hiraia'  # illustration vectors/items live in the main checkout
POOL = os.path.join(HERE, 'cardsPool.app.json')
TRIAGE = os.path.join(HERE, 'art-qa', 'triage.jsonl')
ITEMS = os.path.join(MAIN, 'rag/pipeline/illustration-items.json')
VECS = os.path.join(MAIN, 'rag/pipeline/illustration-vectors.npy')
OUT = os.path.join(HERE, 'art-qa', 'rematch.jsonl')
LOCAL_PNG = os.path.join(ROOT, 'packages/images/cards-png')

URL = 'https://api.fireworks.ai/inference/v1/chat/completions'
KEY = os.environ['FIREWORKS_API_KEY']
MODEL = os.environ.get('FW_MODEL', 'accounts/fireworks/models/deepseek-v4-flash-vision-exp')
PORT = os.environ.get('PORT', '8771')
CONC = int(os.environ.get('FW_CONC', '24'))
BATCH = int(os.environ.get('FW_BATCH', '8'))
LIMIT = int(os.environ.get('FW_LIMIT', '0')) or None
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
    payload = {'model': MODEL, 'temperature': 0.0, 'max_tokens': 2500,
               'reasoning_effort': 'none',
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


def prompt_for(job):
    """job: list of (card_id, wanted, old_slug, cands)"""
    blocks = []
    for n, (cid, wanted, old, cands) in enumerate(job, 1):
        opts = []
        for i, c in enumerate(cands, 1):
            cur = ' [CURRENT]' if c['ref'] == old else ''
            opts.append(f'     {i}. {c["text"][:150]}{cur}')
        blocks.append(f'  CARD {n} (id {cid})\n   wants: {wanted}\n   available:\n' + '\n'.join(opts))
    return '''Each card below says what picture it needs. Under it are existing pictures we already own.
Pick the ONE that could genuinely serve as its illustration, or 0 if none can.

THE TEST IS THE SUBJECT, NOT THE MOMENT.
  A picture serves the card when it shows the same THING. A different moment in that thing's
  life, a wider or tighter framing, or extra detail around it are all FINE — a child looking
  at it still sees what the card is about.
    wants "a coral reef growing upward toward sunlight"
      vs  "a coral reef habitat"                          -> YES, same thing
      vs  "a fish nibbling coral"                         -> NO, the subject is the fish

The current picture (marked [CURRENT]) may itself be right — the audit that flagged it can
be over-cautious. Choose it if it genuinely serves. Choose 0 only when nothing does.

Return STRICT JSON: {"picks":[{"card":1,"choice":2,"why":"one short phrase"},...]} with one
entry per card, choice = option number or 0.

''' + '\n\n'.join(blocks)


def main():
    pool = json.load(open(POOL))
    by_id = {c['id']: c for c in pool['cards']}
    items = json.load(open(ITEMS))
    local = {f[:-4] for f in os.listdir(LOCAL_PNG) if f.endswith('.png')}
    idx = [i for i, it in enumerate(items) if it['ref'] in local]
    refs = [items[i]['ref'] for i in idx]
    texts = [items[i]['text'] for i in idx]
    vecs = np.load(VECS)[idx].astype(np.float32)
    vecs /= np.clip(np.linalg.norm(vecs, axis=1, keepdims=True), 1e-9, None)
    print(f'candidate library: {len(refs)} local+vectorized illustrations', flush=True)

    done_cards = set()
    if os.path.exists(OUT):
        for l in open(OUT):
            if l.strip():
                done_cards.add(json.loads(l)['card_id'])

    work, seen = [], set()
    for l in open(TRIAGE):
        if not l.strip():
            continue
        t = json.loads(l)
        if t['triage'] != 'wrong_assign' or t['card_id'] in seen or t['card_id'] in done_cards:
            continue
        seen.add(t['card_id'])
        work.append(t)
    if LIMIT:
        work = work[:LIMIT]
    print(f'{len(work)} cards to re-match', flush=True)
    if not work:
        print('nothing to do'); return

    wanted = {}
    for t in work:
        c = by_id.get(t['card_id']) or {}
        f = c.get('fact') or {}
        wanted[t['card_id']] = (
            f"{(c.get('title') or {}).get('en') or c.get('topic', '')}. {f.get('en', '')[:200]}"
        ).strip()

    keys = list(wanted)
    qv = np.vstack([embed([wanted[k] for k in keys[i:i + EMB_BATCH]])
                    for i in range(0, len(keys), EMB_BATCH)])
    print('card vectors ready', flush=True)

    # shortlists (current slug always appended if missing)
    ref_idx = {r: i for i, r in enumerate(refs)}
    short = {}
    for n, t in enumerate(work):
        k = t['card_id']
        scores = vecs @ qv[n]
        top = np.argsort(-scores)[:TOPK]
        cands = [{'ref': refs[i], 'text': texts[i], 'score': round(float(scores[i]), 4)} for i in top]
        if t['slug'] in ref_idx and t['slug'] not in [c['ref'] for c in cands]:
            cands.append({'ref': t['slug'], 'text': texts[ref_idx[t['slug']]],
                          'score': round(float(scores[ref_idx[t['slug']]]), 4)})
        short[k] = cands

    jobs = []
    for i in range(0, len(work), BATCH):
        jobs.append([(t['card_id'], wanted[t['card_id']], t['slug'], short[t['card_id']])
                     for t in work[i:i + BATCH]])

    def run_job(job):
        out = call(prompt_for(job))
        o = obj_from(out)
        picks = (o or {}).get('picks') or []
        rows = []
        for n, (cid, w, old, cands) in enumerate(job, 1):
            pick = next((p for p in picks if int(p.get('card', 0)) == n), None)
            ch = int(pick.get('choice', 0)) if pick and str(pick.get('choice', '0')).isdigit() else 0
            new = cands[ch - 1]['ref'] if 0 < ch <= len(cands) else old  # 0/invalid -> keep current
            why = (pick.get('why', '') if pick else 'no pick parsed')[:120]
            rows.append({'card_id': cid, 'old_slug': old, 'new_slug': new,
                         'changed': new != old, 'wanted': w[:150], 'why': why})
        with _lock:
            with open(OUT, 'a') as f:
                for r in rows:
                    f.write(json.dumps(r, ensure_ascii=False) + '\n')
            _stats['done'] += len(rows)
            _stats['changed'] += sum(1 for r in rows if r['changed'])

    with ThreadPoolExecutor(max_workers=CONC) as ex:
        futs = {ex.submit(run_job, j): j for j in jobs}
        for fut in as_completed(futs):
            try:
                fut.result()
            except Exception as e:  # noqa: BLE001
                _stats['err'] += 1
                print(f'  job err: {str(e)[:120]}', flush=True)
            if _stats['done'] and _stats['done'] % 200 < BATCH:
                el = (time.time() - _T0) / 60
                cost = _stats['in'] / 1e6 * 0.22 + _stats['out'] / 1e6 * 0.66
                print(f"  {_stats['done']}/{len(work)} changed {_stats['changed']} | {el:.1f}min | ${cost:.2f}", flush=True)

    el = (time.time() - _T0) / 60
    cost = _stats['in'] / 1e6 * 0.22 + _stats['out'] / 1e6 * 0.66
    print(f"DONE. re-matched {_stats['done']} (changed {_stats['changed']}) "
          f"errors {_stats['err']} | {el:.1f}min | ${cost:.2f}", flush=True)


if __name__ == '__main__':
    main()
