#!/usr/bin/env python3
"""Merge the DepEd bank into the shipping bank instead of replacing it.

Blind judging said the old writing wins 56/44 on cards where BOTH banks teach the same thing —
but that comparison only covers the quarter where they overlap. Measured on 2,000 sampled new
cards, 38% have no counterpart in the old bank at all, concentrated in grades 7-10 (the
electromagnetic spectrum, projectile motion, the endocrine system, circuit problems). The old
bank is strongest where it already exists; the new one earns its place by covering what the
old one never did.

So: keep every old card, add only new cards that are not already covered, and carry the
curriculum metadata (grade, quarter, competency, DepEd taxonomy leaf) onto everything that
has it. Nothing that currently ships is deleted.

  llama-server -m rag/embeddings-spike/models/labse-fp16.gguf --embedding --port 8771 \\
      -c 512 -ngl 99 --pooling mean &
  python3 rag/pipeline/merge-card-banks.py
  -> rag/pipeline/cardsPool.merged.json

Env: PORT, DUP_THRESHOLD, NEW_POOL.
"""
import json, os, time, urllib.request, collections
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
# The ORIGINAL bank: gen-cards-pool.py's output, in THIS worktree. It used to be hard-coded
# to a sibling `hiraia-card-ui` checkout, which only made sense while the deck lived on its
# own branch; on `unified` that path is a stale copy of a DIFFERENT factoid bank.
OLD = os.environ.get('OLD_POOL') or os.path.join(
    ROOT, 'rag/pipeline/cardsPool.app.json')
NEW = os.path.join(HERE, os.environ.get('NEW_POOL', 'cardsPool.deped.v3.json'))
OUT = os.path.join(HERE, 'cardsPool.merged.json')
OLDVEC = os.path.join(HERE, 'oldpool-vectors.npy')
NEWVEC = os.path.join(HERE, 'newpool-vectors.npy')
PORT = os.environ.get('PORT', '8771')
# 0.78 was where sampling showed "the old bank already teaches this"; below it the new card is
# genuinely additional. Deliberately not higher: a near-paraphrase adds nothing to a feed and
# two cards saying the same thing is exactly the repetition the reader notices first.
DUP = float(os.environ.get('DUP_THRESHOLD', '0.78'))
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
    old = json.load(open(OLD))
    new = json.load(open(NEW))
    oldc, newc = old['cards'], new['cards']
    print(f'  old {len(oldc):,} cards | new {len(newc):,} cards')

    ov = np.load(OLDVEC) if os.path.exists(OLDVEC) else embed_all(
        [c['fact']['en'] for c in oldc], 'old')
    if not os.path.exists(OLDVEC):
        np.save(OLDVEC, ov)
    # Cached: embedding 23k cards takes ~8 minutes, and a mid-run server crash should not
    # cost the whole pass.
    if os.path.exists(NEWVEC) and len(np.load(NEWVEC)) == len(newc):
        nv = np.load(NEWVEC)
        print(f'  new vectors cached {nv.shape}')
    else:
        nv = embed_all([c['fact']['en'][:200] for c in newc], 'new')
        np.save(NEWVEC, nv)

    kept, dropped = [], 0
    # Compare in blocks so a 23k x 17k float matrix is never held at once.
    for i in range(0, len(newc), 512):
        block = nv[i:i + 512]
        best = (block @ ov.T).max(axis=1)
        for c, s in zip(newc[i:i + 512], best):
            if s >= DUP:
                dropped += 1
            else:
                kept.append(c)

    # Second pass: the new cards can also duplicate EACH OTHER once the old-bank filter is off.
    keep_idx = [i for i, c in enumerate(newc) if c in kept] if False else None
    kept_pos = {id(c): i for i, c in enumerate(newc)}
    kv = np.vstack([nv[kept_pos[id(c)]:kept_pos[id(c)] + 1] for c in kept])
    keep_mask, seen = [], None
    for i, c in enumerate(kept):
        if seen is None:
            seen = kv[i:i + 1]
            keep_mask.append(True)
            continue
        if float((kv[i:i + 1] @ seen.T).max()) >= 0.90:
            keep_mask.append(False)
        else:
            seen = np.vstack([seen, kv[i:i + 1]])
            keep_mask.append(True)
    kept = [c for c, m in zip(kept, keep_mask) if m]

    # DepEd ids are APPEND-ONLY. They used to be minted 1..N over whatever survived THIS
    # run's dedup, which is stable only for as long as the old bank never changes. It changed
    # — the feed bank went from 17k clip-art-only cards to 36.5k once the engravings were
    # wired — and a re-mint would silently re-point 7,638 bundled dcard-*.png illustrations
    # and ~10.6k curriculum tags at different cards, with nothing failing to say so. So a card
    # that already earned an id keeps it (matched on its English text, which is unique across
    # the bank), and only genuinely new cards take the next free number.
    prev = {}
    if os.path.exists(OUT):
        for c in json.load(open(OUT))['cards']:
            if c['id'].startswith('dcard-'):
                prev[c['fact']['en'].strip()] = c['id']
    nxt = max((int(i.split('-')[1]) for i in prev.values()), default=0) + 1
    merged = list(oldc)
    reused = minted = 0
    for c in kept:
        c = dict(c)
        pid = prev.get(c['fact']['en'].strip())
        if pid:
            c['id'], reused = pid, reused + 1
        else:
            c['id'], nxt, minted = f'dcard-{nxt:05d}', nxt + 1, minted + 1
        c['source'] = 'deped'
        merged.append(c)
    print(f'  DepEd ids: {reused:,} kept from the previous merge, {minted:,} newly minted, '
          f'{len(prev) - reused:,} retired (now covered by the feed bank)')
    for c in merged:
        c.setdefault('source', 'original')

    tax = {t['id']: t for t in (old.get('taxonomy') or [])}
    for t in new.get('taxonomy') or []:
        tax.setdefault(t['id'], t)

    json.dump({'cards': merged, 'taxonomy': list(tax.values())}, open(OUT, 'w'),
              ensure_ascii=False)
    withimg = sum(1 for c in merged if c.get('image') or c.get('slug'))
    print(f'\n{len(merged):,} cards merged')
    print(f'  from the original bank : {len(oldc):,}')
    print(f'  added from DepEd       : {len(kept):,}  '
          f'({dropped:,} dropped as already covered, '
          f'{sum(1 for m in keep_mask if not m):,} as internal duplicates)')
    print(f'  with an illustration   : {withimg:,} ({withimg/len(merged)*100:.0f}%)')
    print(f'  taxonomy leaves        : {len(tax):,}')
    g = collections.Counter(c.get('grade') for c in merged if c.get('grade'))
    print('  DepEd cards per grade:', ' '.join(f'g{k}={v:,}' for k, v in sorted(g.items())))
    print(f'  wrote {os.path.basename(OUT)}')


if __name__ == '__main__':
    main()
