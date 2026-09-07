#!/usr/bin/env python3
"""Art-QA dispatcher — the shared brain of the image-match QA workflow.

Splits the 25,834 checkable (slug, card) pairs between the Kimi runner and the
in-session vision half, with a claims file so neither side double-checks work.

Work unit = (slug, card_id) for shared slugs (an image can match one card and
mismatch another), slug-only when exactly one card uses it. Claims live in
art-qa/claims.json: {"kimi": [pair ids], "session": [pair ids]} — assigned once,
never reassigned; verdicts land in art-qa/verdicts.jsonl.

  python3 rag/pipeline/art-qa-dispatch.py split          # make/refill the 50/50 split
  python3 rag/pipeline/art-qa-dispatch.py next-kimi N    # print N unclaimed kimi pairs as JSONL
  python3 rag-pipeline/art-qa-dispatch.py next-session N # same for the in-session half
  python3 rag/pipeline/art-qa-dispatch.py status         # progress summary
"""
import json, os, sys, base64, random

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
POOL = os.path.join(ROOT, 'rag/pipeline/cardsPool.app.json')
QA = os.path.join(HERE, 'art-qa')
CARDS_PNG = os.path.join(ROOT, 'packages/images/cards-png')
VERDICTS = os.path.join(QA, 'verdicts.jsonl')
CLAIMS = os.path.join(QA, 'claims.json')

def pairs():
    """All checkable (pair_id, slug, card_id, img_path) units."""
    pool = json.load(open(POOL))
    by_slug = {}
    for c in pool['cards']:
        if c.get('slug'):
            by_slug.setdefault(c['slug'], []).append(c)
    out = []
    for slug, cards in by_slug.items():
        p = os.path.join(CARDS_PNG, slug + '.png')
        if not os.path.exists(p):
            continue
        for c in cards:
            out.append({
                'pair_id': f"{slug}|{c['id']}",
                'slug': slug,
                'card_id': c['id'],
                'topic': c.get('topic', ''),
                'title_en': (c.get('title') or {}).get('en', ''),
                'cats': c.get('cats') or [],
                'img': p,
            })
    return out

def done_pair_ids():
    done = set()
    if os.path.exists(VERDICTS):
        for line in open(VERDICTS):
            if line.strip():
                done.add(json.loads(line)['pair_id'])
    return done

def load_claims():
    return json.load(open(CLAIMS)) if os.path.exists(CLAIMS) else {'kimi': [], 'session': []}

def cmd_split():
    os.makedirs(QA, exist_ok=True)
    all_pairs = pairs()
    done = done_pair_ids()
    claims = load_claims()
    claimed = set(claims['kimi']) | set(claims['session'])
    pending = [p for p in all_pairs if p['pair_id'] not in done and p['pair_id'] not in claimed]
    # interleave so both halves get a spread of domains, not a contiguous block
    random.Random(42).shuffle(pending)
    half = len(pending) // 2
    new_kimi = [p['pair_id'] for p in pending[:half]]
    new_session = [p['pair_id'] for p in pending[half:]]
    claims['kimi'].extend(new_kimi)
    claims['session'].extend(new_session)
    json.dump(claims, open(CLAIMS, 'w'))
    print(f"split: {len(all_pairs)} total checkable | already done {len(done)} | "
          f"claimed now: kimi +{len(new_kemi) if False else len(new_kimi)}, session +{len(new_session)} | "
          f"kimi total {len(claims['kimi'])}, session total {len(claims['session'])}")

def _next(side, n):
    all_pairs = {p['pair_id']: p for p in pairs()}
    done = done_pair_ids()
    out = []
    for pid in load_claims()[side]:
        if pid not in done and pid in all_pairs:
            out.append(all_pairs[pid])
            if len(out) >= n:
                break
    return out

def cmd_rebalance(pct):
    """Move PCT% of UNJUDGED session-claimed pairs to the kimi side (for when the
    kimi runner finishes early and we offload more of the in-session half to it)."""
    all_pairs = pairs()
    done = done_pair_ids()
    claims = load_claims()
    pending_session = [pid for pid in claims['session'] if pid not in done and pid in all_pairs]
    import random as _r
    _r.Random(7).shuffle(pending_session)
    n = round(len(pending_session) * pct / 100)
    moved = pending_session[:n]
    ms = set(moved)
    claims['kimi'].extend(moved)
    claims['session'] = [pid for pid in claims['session'] if pid not in ms]
    json.dump(claims, open(CLAIMS, 'w'))
    print(f"rebalanced {pct}%: moved {len(moved)} pending pairs session->kimi "
          f"(session now {len(claims['session'])}, kimi {len(claims['kimi'])})")

def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'status'
    if cmd == 'rebalance':
        cmd_rebalance(float(sys.argv[2]) if len(sys.argv) > 2 else 30)
    if cmd == 'split':
        cmd_split()
    elif cmd == 'next-kimi':
        n = int(sys.argv[2]) if len(sys.argv) > 2 else 50
        for p in _next('kimi', n):
            print(json.dumps(p, ensure_ascii=False))
    elif cmd == 'next-session':
        n = int(sys.argv[2]) if len(sys.argv) > 2 else 20
        for p in _next('session', n):
            print(json.dumps(p, ensure_ascii=False))
    elif cmd == 'status':
        all_pairs = pairs()
        done = done_pair_ids()
        claims = load_claims()
        done_kimi = sum(1 for pid in claims['kimi'] if pid in done)
        done_session = sum(1 for pid in claims['session'] if pid in done)
        print(f"checkable pairs: {len(all_pairs)} | verdicts {len(done)} "
              f"({100*len(done)/max(len(all_pairs),1):.1f}%)")
        print(f"kimi: {done_kimi}/{len(claims['kimi'])} | session: {done_session}/{len(claims['session'])}")

if __name__ == '__main__':
    main()
