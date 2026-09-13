#!/usr/bin/env python3
"""STAGE E (setup) — pair each new card with the OLD card that teaches the same thing.

A verdict only means something if both sides were trying to say the same thing. Comparing a
new card about photosynthesis against an old card about earthquakes measures nothing, so pairs
are chosen by meaning: every sampled new card is matched to its nearest neighbour in the old
bank, and only pairs close enough to be about the same concept are kept.

The output is BLIND. Which side is old and which is new is decided per pair by a hash of the
pair id, so the judge cannot learn "A is always the new one" and drift into rewarding a
position. The key needed to un-blind it is written alongside, not shown to the judge.

  llama-server -m rag/embeddings-spike/models/labse-fp16.gguf --embedding --port 8771 \\
      -c 512 -ngl 99 --pooling mean &
  python3 rag/pipeline/build-judging-pairs.py
  -> rag/pipeline/judging-pairs.json   (N blind pairs + the un-blinding key)

Env: PORT, N_PAIRS, MIN_SIM.
"""
import json, os, math, time, hashlib, urllib.request, collections
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
UI = os.path.join(os.path.dirname(ROOT), 'hiraia-card-ui')
OLD = os.path.join(UI, 'packages/mobile/src/generated/cardsPool.generated.json')
NEW = os.path.join(HERE, 'cardsPool.deped.json')
OUT = os.path.join(HERE, 'judging-pairs.json')
OLDVEC = os.path.join(HERE, 'oldpool-vectors.npy')
PORT = os.environ.get('PORT', '8771')
N_PAIRS = int(os.environ.get('N_PAIRS', '120'))
MIN_SIM = float(os.environ.get('MIN_SIM', '0.72'))
BATCH = 64


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


def embed_all(texts, label):
    out, t0 = [], time.time()
    for i in range(0, len(texts), BATCH):
        out.append(embed(texts[i:i + BATCH]))
        if (i // BATCH) % 40 == 0 and i:
            print(f'    {label}: {i:,}/{len(texts):,}  {i/(time.time()-t0):.0f}/s', flush=True)
    return np.vstack(out)


def main():
    old = json.load(open(OLD))['cards']
    new = json.load(open(NEW))['cards']
    print(f'  old bank {len(old):,} cards | new bank {len(new):,} cards')

    if os.path.exists(OLDVEC):
        ov = np.load(OLDVEC)
        print(f'  old vectors cached {ov.shape}')
    else:
        ov = embed_all([c['fact']['en'] for c in old], 'old')
        np.save(OLDVEC, ov)

    # Sample the new bank evenly across grade and domain so the verdict is not decided by one
    # corner of the curriculum.
    buckets = collections.defaultdict(list)
    for c in new:
        buckets[(c['grade'], c['domain'])].append(c)
    sample, k = [], 0
    while len(sample) < N_PAIRS * 4 and k < 200:
        for key in sorted(buckets):
            if k < len(buckets[key]):
                sample.append(buckets[key][k])
        k += 1
    sample = sample[:N_PAIRS * 4]

    nv = embed_all([c['fact']['en'] for c in sample], 'new')
    sims = nv @ ov.T
    best = sims.argmax(axis=1)
    scores = sims[np.arange(len(best)), best]

    pairs, used_old = [], set()
    for c, bi, s in sorted(zip(sample, best, scores), key=lambda x: -x[2]):
        if s < MIN_SIM or int(bi) in used_old:
            continue
        used_old.add(int(bi))
        o = old[int(bi)]
        pid = f'pair-{len(pairs)+1:03d}'
        # blind side assignment: stable, uniform, and not learnable from position
        flip = int(hashlib.md5(pid.encode()).hexdigest(), 16) % 2 == 1
        newside = {'fact': c['fact'], 'title': c['title'], 'topic': c['topic']}
        oldside = {'fact': o['fact'], 'title': o.get('title') or {}, 'topic': o.get('topic')}
        pairs.append({'id': pid, 'similarity': round(float(s), 4),
                      'grade': c['grade'], 'domain': c['domain'],
                      'A': oldside if flip else newside,
                      'B': newside if flip else oldside,
                      '_new_side': 'B' if flip else 'A',
                      '_new_id': c['id'], '_old_id': o['id']})
        if len(pairs) >= N_PAIRS:
            break

    key = {p['id']: {'new_side': p.pop('_new_side'), 'new_id': p.pop('_new_id'),
                     'old_id': p.pop('_old_id')} for p in pairs}
    json.dump({'pairs': pairs, 'key': key}, open(OUT, 'w'), ensure_ascii=False, indent=1)
    sides = collections.Counter(v['new_side'] for v in key.values())
    print(f'\n{len(pairs)} blind pairs | similarity {pairs[-1]["similarity"]:.3f}..{pairs[0]["similarity"]:.3f}')
    print(f'  new card on side: {dict(sides)}')
    print('  grades:', dict(collections.Counter(p['grade'] for p in pairs)))
    print(f'  wrote {os.path.basename(OUT)}')


if __name__ == '__main__':
    main()
