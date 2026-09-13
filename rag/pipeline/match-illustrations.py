#!/usr/bin/env python3
"""STAGE D — give every generated card a picture from the library we already own.

Stage C ends each card with one sentence describing the illustration it wants. This matches
that sentence against the ~23k illustrations already drawn for the old bank, and flags the
ones with no good match so they can be generated later. Nothing is drawn here.

It matches on MEANING, not shared words. The old bank's matcher keyed on token overlap and
put earthworm tunnels on a picture of a hydra because both sentences contained "water" — the
failure that started this rebuild. Two sentences describing the same picture rarely share
vocabulary ("a clear plastic incubator with a baby inside" / "a hospital incubator holding a
newborn under a warm lamp"), so embeddings are the honest tool.

Runs against a local llama-server holding LaBSE:

  llama-server -m rag/embeddings-spike/models/labse-fp16.gguf \\
      --embedding --port 8771 -c 512 -ngl 99 --pooling mean &
  python3 rag/pipeline/match-illustrations.py
  WATCH=1 python3 rag/pipeline/match-illustrations.py    # keep matching as Stage C writes

LaBSE rather than the e5-small the on-device retriever ships: e5 returns ~0.9 for everything
(measured spread between a true paraphrase and an unrelated scene: 0.008), which ranks fine
but cannot support a threshold. This job must decide MATCH or NEEDS-DRAWING, so the wider
spread matters more than the model size that drove the on-device choice.

Env: PORT, THRESHOLD, WATCH, CARDS_DIR.
"""
import os, json, glob, time, math, urllib.request
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
UI = os.path.join(os.path.dirname(ROOT), 'hiraia-card-ui')
CARDS = os.path.join(HERE, os.environ.get('CARDS_DIR', 'deped-cards'))
OUT = os.path.join(HERE, 'card-illustrations.json')
LIBCACHE = os.path.join(HERE, 'illustration-vectors.npy')
LIBITEMS = os.path.join(HERE, 'illustration-items.json')
PORT = os.environ.get('PORT', '8771')
TOPK = int(os.environ.get('TOPK', '8'))
WATCH = os.environ.get('WATCH') == '1'
BATCH = 64


def embed(texts):
    for attempt in range(12):
        try:
            req = urllib.request.Request(
                f'http://127.0.0.1:{PORT}/v1/embeddings',
                data=json.dumps({'input': texts}).encode(),
                headers={'Content-Type': 'application/json'})
            d = json.load(urllib.request.urlopen(req, timeout=300))['data']
            return [normalise(x['embedding']) for x in d]
        except Exception:
            if attempt == 11:
                raise
            time.sleep(min(30, 2 * (attempt + 1)))


def normalise(v):
    n = math.sqrt(sum(x * x for x in v)) or 1.0
    return [x / n for x in v]


def embed_all(texts, label):
    out, t0 = [], time.time()
    for i in range(0, len(texts), BATCH):
        out.extend(embed(texts[i:i + BATCH]))
        if (i // BATCH) % 20 == 0 and i:
            el = time.time() - t0
            print(f'    {label}: {i:,}/{len(texts):,}  {i/el:.0f}/s', flush=True)
    return out


def load_library():
    """Every illustration we own, with the sentence that described it.

    Two sources: the 18,816 factoid images (keyed by factoid id, prompt stored alongside) and
    the named clip-art slugs, whose own name is the only description they have.
    """
    if os.path.exists(LIBCACHE) and os.path.exists(LIBITEMS):
        items = json.load(open(LIBITEMS))
        vecs = np.load(LIBCACHE)
        print(f'  library: {len(items):,} illustrations (cached vectors {vecs.shape})')
        return {'items': items, 'vecs': vecs}

    items = []
    seen = set()
    fj = os.path.join(UI, 'rag/bank/factoids.jsonl')
    for line in open(fj):
        if not line.strip():
            continue
        r = json.loads(line)
        img = r.get('image') or {}
        prompt = (img.get('prompt') or '').strip()
        if prompt and r['id'] not in seen:
            seen.add(r['id'])
            items.append({'kind': 'factoid', 'ref': r['id'], 'text': prompt})
    qc = os.path.join(UI, 'packages/images/gemini-queue/qc-progress.json')
    if os.path.exists(qc):
        for slug in json.load(open(qc)):
            items.append({'kind': 'slug', 'ref': slug, 'text': slug.replace('-', ' ')})
    print(f'  library: {len(items):,} illustrations — embedding (one time)...')
    vecs = np.asarray(embed_all([i['text'] for i in items], 'library'), dtype=np.float32)
    np.save(LIBCACHE, vecs)
    json.dump(items, open(LIBITEMS, 'w'), ensure_ascii=False)
    print(f'  cached -> {os.path.basename(LIBCACHE)} {vecs.shape}')
    return {'items': items, 'vecs': vecs}


def top_candidates(qvecs, vecs, k=TOPK):
    """The k nearest illustrations for each card, as one matrix product.

    Deliberately k, not 1. Measured on this library, LaBSE's top-1 is unreliable while its
    top-8 usually contains the right picture: a card wanting "a fuzzy bee landing on a pink
    flower" ranked "flowerpecker on mistletoe" first at 0.666 and the correct "bee on flower
    pollinating" second at 0.660 — a 0.006 gap, which is noise. Retrieval is good at recall
    and bad at the final choice, so it hands a shortlist to a model that can actually judge
    (fw-rerank-illustrations.py) instead of guessing with a threshold.
    """
    q = np.asarray(qvecs, dtype=np.float32)
    sims = q @ vecs.T
    idx = np.argpartition(-sims, k, axis=1)[:, :k]
    rows = np.arange(len(idx))[:, None]
    order = np.argsort(-sims[rows, idx], axis=1)
    idx = idx[rows, order]
    return idx, sims[rows, idx]


def run_once(lib, done):
    shards = [f for f in sorted(glob.glob(os.path.join(CARDS, '*.json')))
              if os.path.basename(f) not in done]
    if not shards:
        return 0, []
    cards = []
    for f in shards:
        j = json.load(open(f))
        for idx, c in enumerate(j['cards']):
            if c.get('illustration'):
                cards.append((os.path.basename(f), idx, c))
    if not cards:
        for f in shards:
            done.add(os.path.basename(f))
        return 0, []
    qv = embed_all([c[2]['illustration'] for c in cards], 'cards')
    cand_i, cand_s = top_candidates(qv, lib['vecs'])
    out = []
    for (shard, idx, c), ids, scores in zip(cards, cand_i, cand_s):
        out.append({'drive_id': c['drive_id'], 'shard': shard, 'i': idx,
                    'title': c['title']['en'], 'illustration': c['illustration'],
                    'candidates': [{'ref': lib['items'][int(j)]['ref'],
                                    'kind': lib['items'][int(j)]['kind'],
                                    'text': lib['items'][int(j)]['text'],
                                    'score': round(float(sc), 4)}
                                   for j, sc in zip(ids, scores)]})
    for f in shards:
        done.add(os.path.basename(f))
    return len(out), out


def main():
    lib = load_library()
    results, done = [], set()
    if os.path.exists(OUT):
        results = json.load(open(OUT))
        done = {r['shard'] for r in results}
        print(f'  resuming: {len(results):,} cards already matched')
    while True:
        n, new = run_once(lib, done)
        if new:
            results.extend(new)
            json.dump(results, open(OUT, 'w'), ensure_ascii=False)
            print(f'  +{n:,} cards | total {len(results):,} shortlisted', flush=True)
        if not WATCH:
            break
        time.sleep(20)

    print(f'\n{len(results):,} cards with {TOPK} candidates each')
    top1 = [r['candidates'][0]['score'] for r in results if r['candidates']]
    if top1:
        t = sorted(top1)
        print(f'  top-1 cosine: p10 {t[len(t)//10]:.3f} median {t[len(t)//2]:.3f} max {t[-1]:.3f}')
    print(f'  wrote {os.path.basename(OUT)} — now run fw-rerank-illustrations.py')


if __name__ == '__main__':
    main()
