#!/usr/bin/env python3
"""Score judges on the gold set, then run the winner over the real candidates.

The question this answers is NOT "which model is cheapest". At 32 Tier-1 candidates the whole
job costs a fraction of a cent on anything, and even the full 19,279-question sweep is under a
dollar on the cheap tier. The binding constraint is whether a model can make one specific
Tagalog judgment — does the token before `ang` license it — in a low-resource language where
small models are known to be weak. gold.json exists so that is measured, not assumed.

Reported per model: accuracy, and precision/recall ON THE **BROKEN** CLASS, which is the number
that matters. A judge with high accuracy but poor BROKEN precision writes bad Tagalog into the
shipped bank; one with poor BROKEN recall just leaves defects in place. Those are not equally
bad, so they are never averaged into a single score here.

  python3 judge.py bakeoff --run <dir> --models a,b,c
  python3 judge.py judge   --run <dir> --model <id> --targets t1
  python3 judge.py sample  --run <dir> --n 300          # Tier-2 stratified draw
  python3 judge.py report  --run <dir>

Resumable: every call appends to <run>/<stage>.jsonl and skips ids already present, so a
heartbeat can stop and restart mid-batch without losing or repeating paid work.
"""
import argparse
import collections
import json
import os
import pathlib
import random
import re
import sys
import time
import urllib.error
import urllib.request

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[1]
POOL = ROOT / 'rag/pipeline/cardsPool.app.json'
GOLD = HERE / 'gold.json'
ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'

PROMPT = """You judge ONE Tagalog question for a single grammatical defect. Answer with one word.

Tagalog `[Predicate] ang [Topic]` EQUATES the two sides. So a bare "Ilang X ang Y?" asks
"Y IS how many X?" — wrong when X is a PART or POSSESSION of Y. That needs `ng` or `mayroon`:
  BROKEN:  Ilang pakpak ang langaw?      (wings are part of the fly)
  correct: Ilan ang pakpak ng langaw?  /  Ilang pakpak mayroon ang langaw?

Answer CORRECT when the `ang` is licensed by any of these, even if X looks like a part of Y:
  - a governing VERB:        Ilang beses tumitibok ang puso mo?      (tumitibok)
                             Ilang sakit ang dinadala ng lamok?      (dinadala; -in- infix)
  - a locative `nasa`:       Ilang buto ang nasa leeg ng giraffe?
  - a measure/identity:      Ilang minuto ang kalahating oras?       (the sides ARE one quantity)
  - a capacity pseudo-verb:  Ilang Mundo ang kasya sa loob ng Araw?  (kasya, kaya)
  - an existential:          Ilang paa mayroon ang insekto?

CAUTION: a participle MODIFYING the noun is not a governing verb.
  "Ilang pakpak ang karaniwang insektong lumilipad?" is BROKEN — `lumilipad` describes the
  insect, it is not the predicate of the sentence.

Ignore every other flaw (word choice, mass nouns like "Ilang enerhiya", register, facts).
Judge ONLY the ang/ng licensing.

QUESTION: {q}

Reply with exactly one word: BROKEN or CORRECT"""


def env_key():
    for p in (ROOT / '.env.local', pathlib.Path.home() / 'Code/hiraia/.env.local'):
        if p.exists():
            for line in p.read_text().splitlines():
                k, sep, v = line.partition('=')
                if sep and k.strip() == 'OPENROUTER_API_KEY':
                    return v.strip().strip('"').strip("'")
    return os.environ.get('OPENROUTER_API_KEY')


def ask(model, question, key, timeout=90):
    body = json.dumps({
        'model': model,
        'messages': [{'role': 'user', 'content': PROMPT.format(q=question)}],
        'temperature': 0,
        # Generous on purpose. Thinking models spend the whole budget on reasoning tokens and
        # then return an EMPTY content field — qwen3.7-flash silently produced 12 blank answers
        # at 2000, which scored as unparseable rather than wrong. Cost is irrelevant here
        # (fractions of a cent per item), so buy the headroom.
        'max_tokens': 8000,
    }).encode()
    req = urllib.request.Request(ENDPOINT, data=body, headers={
        'Authorization': f'Bearer {key}', 'Content-Type': 'application/json',
        'HTTP-Referer': 'https://hiraia.org', 'X-Title': 'hiraia-card-language-audit'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        d = json.loads(r.read())
    msg = (d['choices'][0].get('message') or {})
    txt = (msg.get('content') or '').strip()
    usage = d.get('usage') or {}
    # Models that emit reasoning can return an empty content field; treat as unparseable
    # rather than silently scoring it as CORRECT.
    up = txt.upper()
    verdict = 'BROKEN' if 'BROKEN' in up else ('CORRECT' if 'CORRECT' in up else None)
    return verdict, txt, usage


def load_done(path):
    if not path.exists():
        return {}
    out = {}
    for line in path.read_text(encoding='utf-8').splitlines():
        if line.strip():
            r = json.loads(line)
            # Only a RESOLVED row counts as done. Caching a None verdict would make a
            # transient blank or a rate-limit permanent across heartbeat restarts.
            if r.get('verdict') is not None:
                out[(r['model'], r['id'])] = r
    return out


def score(rows, gold_by_id):
    tp = fp = fn = tn = 0
    unparsed = 0
    per_pattern = collections.defaultdict(lambda: [0, 0])
    for r in rows:
        g = gold_by_id[r['id']]
        if r['verdict'] is None:
            unparsed += 1
            continue
        ok = r['verdict'] == g['gold']
        per_pattern[g['pattern']][0] += ok
        per_pattern[g['pattern']][1] += 1
        if g['gold'] == 'BROKEN' and r['verdict'] == 'BROKEN':
            tp += 1
        elif g['gold'] == 'CORRECT' and r['verdict'] == 'BROKEN':
            fp += 1
        elif g['gold'] == 'BROKEN' and r['verdict'] == 'CORRECT':
            fn += 1
        else:
            tn += 1
    n = tp + fp + fn + tn
    return {
        'n': n, 'unparsed': unparsed,
        'accuracy': round((tp + tn) / n, 3) if n else 0.0,
        'broken_precision': round(tp / (tp + fp), 3) if (tp + fp) else None,
        'broken_recall': round(tp / (tp + fn), 3) if (tp + fn) else None,
        'tp': tp, 'fp': fp, 'fn': fn, 'tn': tn,
        'per_pattern': {k: f'{v[0]}/{v[1]}' for k, v in sorted(per_pattern.items())},
    }


def cmd_bakeoff(a, run):
    key = env_key()
    if not key:
        sys.exit('!! OPENROUTER_API_KEY not found')
    gold = json.loads(GOLD.read_text(encoding='utf-8'))['items']
    gold_by_id = {g['id']: g for g in gold}
    out = run / 'bakeoff.jsonl'
    done = load_done(out)
    models = [m.strip() for m in a.models.split(',') if m.strip()]
    with out.open('a', encoding='utf-8') as f:
        for model in models:
            todo = [g for g in gold if (model, g['id']) not in done]
            print(f'  {model}: {len(todo)} to run ({len(gold)-len(todo)} cached)', flush=True)
            for g in todo:
                try:
                    v, raw, usage = ask(model, g['tl'], key)
                    rec = {'model': model, 'id': g['id'], 'verdict': v, 'raw': raw[:200],
                           'usage': usage}
                except (urllib.error.HTTPError, urllib.error.URLError, OSError,
                        KeyError, IndexError) as e:
                    detail = ''
                    if isinstance(e, urllib.error.HTTPError):
                        try:
                            detail = e.read()[:200].decode('utf-8', 'replace')
                        except Exception:
                            detail = ''
                    rec = {'model': model, 'id': g['id'], 'verdict': None,
                           'error': f'{type(e).__name__}: {e} {detail}'}
                f.write(json.dumps(rec, ensure_ascii=False) + '\n')
                f.flush()
                time.sleep(0.25)
    rows = load_done(out)
    results = {}
    for model in sorted({k[0] for k in rows}):
        mr = [v for k, v in rows.items() if k[0] == model]
        errs = sum(1 for r in mr if r.get('error'))
        s = score([r for r in mr if not r.get('error')], gold_by_id)
        s['errors'] = errs
        results[model] = s
    (run / 'bakeoff-scores.json').write_text(
        json.dumps(results, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    for m, s in sorted(results.items(), key=lambda kv: -(kv[1]['accuracy'])):
        print(f"\n  {m}\n    acc {s['accuracy']}  BROKEN prec {s['broken_precision']} "
              f"rec {s['broken_recall']}  (tp{s['tp']} fp{s['fp']} fn{s['fn']} tn{s['tn']}) "
              f"unparsed {s['unparsed']} err {s['errors']}")
        print(f"    {s['per_pattern']}")


def cmd_judge(a, run):
    key = env_key()
    if not key:
        sys.exit('!! OPENROUTER_API_KEY not found')
    props = [json.loads(l) for l in (run / 'proposals.jsonl').read_text(encoding='utf-8').splitlines()]
    targets = [p for p in props if p['cls'] == a.targets.upper()]
    out = run / f'verdicts-{a.targets}.jsonl'
    done = load_done(out)
    todo = [t for t in targets if (a.model, t['id']) not in done]
    print(f'  {a.model}: {len(todo)} to judge ({len(targets)-len(todo)} cached)', flush=True)
    with out.open('a', encoding='utf-8') as f:
        for t in todo:
            try:
                v, raw, usage = ask(a.model, t['before'], key)
                rec = {'model': a.model, 'id': t['id'], 'verdict': v, 'before': t['before'],
                       'after': t['after'], 'raw': raw[:200]}
            except Exception as e:
                rec = {'model': a.model, 'id': t['id'], 'verdict': None, 'error': str(e)[:200]}
            f.write(json.dumps(rec, ensure_ascii=False) + '\n')
            f.flush()
            time.sleep(0.25)
    rows = [v for k, v in load_done(out).items() if k[0] == a.model]
    print(f"  BROKEN {sum(1 for r in rows if r.get('verdict')=='BROKEN')} / "
          f"CORRECT {sum(1 for r in rows if r.get('verdict')=='CORRECT')} / "
          f"unresolved {sum(1 for r in rows if not r.get('verdict'))}")


def cmd_sample(a, run):
    """Tier-2 stratified draw: the broader question population, by interrogative."""
    d = json.loads(POOL.read_text(encoding='utf-8'))
    heads = []
    for c in d['cards']:
        tl = (c.get('fact') or {}).get('tl') or ''
        h = tl.split('\n')[0].strip()
        if h.endswith('?'):
            heads.append((c['id'], h, h.split()[0].lower().strip('?') if h.split() else ''))
    by = collections.defaultdict(list)
    for cid, h, w in heads:
        by[w].append((cid, h))
    rng = random.Random(20260919)
    total = sum(len(v) for v in by.values())
    draw = []
    for w, items in sorted(by.items(), key=lambda kv: -len(kv[1])):
        if len(items) < 20:
            continue
        k = max(8, round(a.n * len(items) / total))
        draw += [{'id': i, 'tl': t, 'interrogative': w} for i, t in rng.sample(items, min(k, len(items)))]
    (run / 'tier2-sample.json').write_text(
        json.dumps({'population': total, 'drawn': len(draw), 'items': draw},
                   ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(f'  population {total}, drew {len(draw)} across '
          f'{len(set(x["interrogative"] for x in draw))} interrogatives')


def cmd_report(a, run):
    for name in ('state.json', 'bakeoff-scores.json'):
        p = run / name
        if p.exists():
            print(f'--- {name} ---\n{p.read_text()}')


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('cmd', choices=['bakeoff', 'judge', 'sample', 'report'])
    ap.add_argument('--run', required=True)
    ap.add_argument('--models', default='')
    ap.add_argument('--model', default='')
    ap.add_argument('--targets', default='t1')
    ap.add_argument('--n', type=int, default=300)
    a = ap.parse_args()
    run = pathlib.Path(a.run)
    run.mkdir(parents=True, exist_ok=True)
    {'bakeoff': cmd_bakeoff, 'judge': cmd_judge, 'sample': cmd_sample, 'report': cmd_report}[a.cmd](a, run)
