#!/usr/bin/env python3
"""Art-QA triage — DeepSeek V4 Flash Vision triages each mismatch/partial verdict.

The audit (verdicts.jsonl) found ~1,275 mismatches and ~6,656 partials. The fix
differs by ROOT CAUSE, which the raw verdict doesn't carry:

  wrong_image    — the IMAGE itself depicts the wrong subject. Every card using
                   this slug is broken; the fix is new art (or dropping the image).
  wrong_assign   — the image is fine but was ASSIGNED to the wrong card. One good
                   image + N wrong cards; the fix is a pool re-match (point the
                   cards at better slugs, image stays).
  wrong_card     — the CARD's own text/title is the problem (title asks something
                   the art can't show, e.g. a color question under monochrome art).
                   The fix is card-side (retitle or accept).
  acceptable     — a defensible soft partial (metaphor art, generic-but-on-topic);
                   leave as is.

DeepSeek sees the image + card text + the audit note and picks one. Text-only
call (no image needed): the audit already established what the image shows; this
stage needs judgment about WHY it doesn't fit, best made with the note in context.

  FIREWORKS_API_KEY=... python3 rag/pipeline/art-qa-triage.py            # all
  FIREWORKS_API_KEY=... LIMIT=100 python3 rag/pipeline/art-qa-triage.py  # pilot
Output: rag/pipeline/art-qa/triage.jsonl — {pair_id, slug, card_id, verdict,
audit_note, triage, reason}. Resumable (skips already-triaged pair_ids).
"""
import os, sys, json, time, threading, urllib.request, urllib.error, subprocess
from concurrent.futures import ThreadPoolExecutor, as_completed

HERE = os.path.dirname(os.path.abspath(__file__))
URL = os.environ.get('URL', 'https://api.fireworks.ai/inference/v1/chat/completions')
MODEL = os.environ.get('MODEL', 'accounts/fireworks/models/deepseek-v4-flash-vision-exp')
KEY = os.environ['FIREWORKS_API_KEY']
CONC = int(os.environ.get('CONC', '24'))
LIMIT = int(os.environ.get('LIMIT', '0')) or None
VERDICTS = os.path.join(HERE, 'art-qa', 'verdicts.jsonl')
POOL = os.path.join(os.path.dirname(os.path.dirname(HERE)), 'rag/pipeline/cardsPool.app.json')
OUT = os.path.join(HERE, 'art-qa', 'triage.jsonl')

lock = threading.Lock()
stats = {'done': 0, 'errors': 0, 'in_tok': 0, 'out_tok': 0}
t0 = time.time()

def call(prompt, retries=5):
    body = json.dumps({
        'model': MODEL, 'max_tokens': 250, 'temperature': 0.2,
        'reasoning_effort': 'none',
        'messages': [{'role': 'user', 'content': prompt}],
    }).encode()
    last = None
    for attempt in range(retries):
        req = urllib.request.Request(URL, data=body, headers={
            'Content-Type': 'application/json', 'Authorization': f'Bearer {KEY}'})
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                d = json.loads(r.read())
            content = (d['choices'][0]['message'].get('content') or '').strip()
            usage = d.get('usage') or {}
            if content:
                return content, int(usage.get('prompt_tokens') or 0), int(usage.get('completion_tokens') or 0)
            last = RuntimeError('empty content')
        except urllib.error.HTTPError as e:
            last = RuntimeError(f'HTTP {e.code}: {e.read().decode()[:150]}')
            if e.code in (429, 500, 503):
                time.sleep(2 ** attempt * 2)
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(2 ** attempt * 2)
    raise RuntimeError(f'triage call failed: {last}')

TRIAGE_SCHEMA = """Answer with EXACTLY this format (one line):
TRIAGE: wrong_image | wrong_assign | wrong_card | acceptable
REASON: <one short sentence>

Categories:
- wrong_image: the illustration itself depicts the wrong subject entirely (e.g. a
  completely different object/scene than the card is about).
- wrong_assign: the illustration is coherent on its own, but it was clearly meant
  for a different card (right genre, wrong specific subject — e.g. generic lab
  glassware on a specific-chemistry card, correct animal wrong behavior).
- wrong_card: the card text/title is what makes the pair fail (title asks about
  color under monochrome line art, title contradicts the topic, card asks a
  counting question no image can show).
- acceptable: defensible soft partial — metaphorical or generic-but-on-topic art
  that a teacher would still use."""

def triage(p, title_en, topic, fact_en):
    prompt = (
        "You are triaging failed image-card pairs for a Filipino grade-school science app.\n\n"
        f"CARD id: {p['card_id']}\n"
        f"CARD title: {title_en or topic}\n"
        f"CARD topic: {topic}\n"
        f"CARD fact (English excerpt): {fact_en[:200]}\n"
        f"IMAGE slug: {p['slug']}\n"
        f"AUDIT verdict: {p['verdict']}\n"
        f"AUDIT note: {p['note']}\n\n"
        f"{TRIAGE_SCHEMA}"
    )
    text, tin, tout = call(prompt)
    import re
    m = re.search(r'TRIAGE:\s*(wrong_image|wrong_assign|wrong_card|acceptable)', text, re.I)
    t = m.group(1).lower() if m else 'acceptable'
    r_ = re.search(r'REASON:\s*(.+)', text, re.S)
    reason = (r_.group(1).strip().replace('\n', ' ') if r_ else text.replace('\n', ' '))[:200]
    row = {'pair_id': p['pair_id'], 'slug': p['slug'], 'card_id': p['card_id'],
           'verdict': p['verdict'], 'audit_note': p['note'], 'triage': t, 'reason': reason}
    with lock:
        stats['done'] += 1
        stats['in_tok'] += tin
        stats['out_tok'] += tout
        with open(OUT, 'a') as f:
            f.write(json.dumps(row, ensure_ascii=False) + '\n')

def main():
    pool = json.load(open(POOL))
    by_id = {c['id']: c for c in pool['cards']}
    rows, seen_pairs = [], set()
    for l in open(VERDICTS):
        if l.strip():
            r = json.loads(l)
            if r['verdict'] in ('mismatch', 'partial') and r['pair_id'] not in seen_pairs:
                seen_pairs.add(r['pair_id'])
                rows.append(r)
    done_t = set()
    if os.path.exists(OUT):
        for l in open(OUT):
            if l.strip():
                done_t.add(json.loads(l)['pair_id'])
    work = [r for r in rows if r['pair_id'] not in done_t]
    if LIMIT:
        work = work[:LIMIT]
    print(f"{len(work)} pairs to triage (of {len(rows)} flagged) | model={MODEL} conc={CONC}", flush=True)
    with ThreadPoolExecutor(max_workers=CONC) as ex:
        futs = {}
        for p in work:
            c = by_id.get(p['card_id']) or {}
            f = c.get('fact') or {}
            futs[ex.submit(triage, p, (c.get('title') or {}).get('en', ''), c.get('topic', ''), f.get('en', ''))] = p
        for fut in as_completed(futs):
            try:
                fut.result()
            except Exception as e:  # noqa: BLE001
                with lock:
                    stats['errors'] += 1
                print(f"  err {futs[fut]['pair_id']}: {str(e)[:120]}", flush=True)
            if stats['done'] % 500 == 0 and stats['done']:
                el = (time.time() - t0) / 60
                cost = stats['in_tok'] / 1e6 * 0.22 + stats['out_tok'] / 1e6 * 0.66
                print(f"  {stats['done']}/{len(work)} | {el:.1f}min | ${cost:.2f}", flush=True)
    el = (time.time() - t0) / 60
    cost = stats['in_tok'] / 1e6 * 0.22 + stats['out_tok'] / 1e6 * 0.66
    print(f"DONE. triaged {stats['done']} errors {stats['errors']} | {el:.1f}min | ${cost:.2f}", flush=True)

if __name__ == '__main__':
    main()
