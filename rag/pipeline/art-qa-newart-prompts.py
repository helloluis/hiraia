#!/usr/bin/env python3
"""Generate replacement image prompts for the 2,735 wrong_image slugs — art-QA step 2.

The audit triaged these slugs as depicting the wrong subject entirely; every card
using one is broken until the art is replaced. This writes ONE new prompt per
AFFECTED CARD (not per slug — the prompt must serve the card's fact, and a slug
shared by multiple cards with different facts needs its own image per card; the
new slugs will be minted fresh so no sharing is inherited).

Style boilerplate is the exact STYLE string from fw-gen-factoids.py — the phrase
every previous generation run ended with, so the new art matches the deck.

  set -a; source <main>/.env.local; set +a
  python3 rag/pipeline/art-qa-newart-prompts.py            # all
  LIMIT=50 python3 rag/pipeline/art-qa-newart-prompts.py    # pilot

Output: rag/pipeline/art-qa/newart-prompts.jsonl — {card_id, old_slug,
new_slug, prompt}. new_slug = 'qa-<card_id>' (fresh, collision-free).
Resumable by card_id. Prompts verified to end with the STYLE phrase verbatim.
"""
import os, json, re, time, threading, collections, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
POOL = os.path.join(HERE, 'cardsPool.app.json')
TRIAGE = os.path.join(HERE, 'art-qa', 'triage.jsonl')
ITEMS = '/Users/luis/Code/hiraia/rag/pipeline/illustration-items.json'
OUT = os.path.join(HERE, 'art-qa', 'newart-prompts.jsonl')

STYLE = ('hand-drawn line art, black and white, clean single-weight ink outlines, no shading '
         'and no color, simple and friendly for children, centered on a plain white background')

URL = 'https://api.fireworks.ai/inference/v1/chat/completions'
KEY = os.environ['FIREWORKS_API_KEY']
MODEL = os.environ.get('FW_MODEL', 'accounts/fireworks/models/deepseek-v4-flash-vision-exp')
CONC = int(os.environ.get('FW_CONC', '24'))
BATCH = int(os.environ.get('FW_BATCH', '10'))
LIMIT = int(os.environ.get('FW_LIMIT', '0')) or None

_lock = threading.Lock()
_stats = collections.Counter()
_T0 = time.time()


def call(prompt, attempt=0):
    payload = {'model': MODEL, 'temperature': 0.3, 'max_tokens': 2500,
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


EXAMPLES = """A pair of human lungs with the windpipe branching into them, front view, anatomical but simple.
A simple human arm bent at the elbow showing a muscle connected to the bone by a tendon.
A cutaway hillside showing roots holding the soil against flowing rainwater."""


def prompt_for(job):
    """job: list of (card_id, title_en, topic, fact_en, audit_note)"""
    blocks = []
    for n, (cid, title, topic, fact, note) in enumerate(job, 1):
        blocks.append(
            f'  CARD {n} (id {cid})\n'
            f'   title: {title}\n'
            f'   topic: {topic}\n'
            f'   fact: {fact[:250]}\n'
            f'   why the old image failed: {note[:150]}'
        )
    return f'''You write illustration prompts for a Filipino grade-school science app. Each card below
needs ONE new picture because its current one shows the wrong subject entirely (the audit
note says why it failed — the new prompt must depict the card's actual subject, and must
avoid repeating the old failure).

A good prompt is ONE sentence in plain English describing a single, simple, concrete scene
a child would recognize — the card's subject as one clear visual moment. Look at these
real examples from the deck for the register:

{EXAMPLES}

Rules:
- Depict the card's SUBJECT (the thing the fact is about), not an abstract concept, not a
  diagram of the failure the audit described.
- One scene, one focus. No text, labels, arrows, panels, or multi-step sequences.
- Do NOT include any style words (the style is appended automatically later).

Return STRICT JSON: {{"prompts":[{{"card":1,"prompt":"..."}},...]}} one per card.

''' + '\n\n'.join(blocks)


def main():
    pool = json.load(open(POOL))
    by_id = {c['id']: c for c in pool['cards']}

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
        if t['triage'] != 'wrong_image' or t['card_id'] in seen or t['card_id'] in done_cards:
            continue
        seen.add(t['card_id'])
        work.append(t)
    if LIMIT:
        work = work[:LIMIT]
    print(f'{len(work)} cards need new-art prompts', flush=True)
    if not work:
        return

    jobs = []
    for i in range(0, len(work), BATCH):
        job = []
        for t in work[i:i + BATCH]:
            c = by_id.get(t['card_id']) or {}
            f = c.get('fact') or {}
            job.append((t['card_id'], (c.get('title') or {}).get('en') or c.get('topic', ''),
                        c.get('topic', ''), f.get('en', ''), t['reason']))
        jobs.append(job)

    def run_job(job):
        out = call(prompt_for(job))
        o = obj_from(out)
        prompts = (o or {}).get('prompts') or []
        rows = []
        for n, (cid, _t, _to, _f, _n) in enumerate(job, 1):
            p = next((x for x in prompts if int(x.get('card', 0)) == n), None)
            text = (p.get('prompt') or '').strip() if p else ''
            # strip any style-words the model appended despite the rule, then append canonical
            text = re.sub(r'[.\s]*(hand[- ]drawn|black[- ]and[- ]white|line art|ink outline|'
                          r'white background|no shading|no color).*$', '', text, flags=re.I).strip()
            if not text:
                _stats['empty'] += 1
                continue
            full = f'{text}. {STYLE}'
            rows.append({'card_id': cid, 'old_slug': next(t['slug'] for t in work if t['card_id'] == cid),
                         'new_slug': f'qa-{cid}', 'prompt': full})
        with _lock:
            with open(OUT, 'a') as f:
                for r in rows:
                    f.write(json.dumps(r, ensure_ascii=False) + '\n')
            _stats['done'] += len(rows)

    with ThreadPoolExecutor(max_workers=CONC) as ex:
        futs = {ex.submit(run_job, j): j for j in jobs}
        for fut in as_completed(futs):
            try:
                fut.result()
            except Exception as e:  # noqa: BLE001
                _stats['err'] += 1
                print(f'  job err: {str(e)[:120]}', flush=True)
            if _stats['done'] and _stats['done'] % 500 < BATCH:
                el = (time.time() - _T0) / 60
                cost = _stats['in'] / 1e6 * 0.22 + _stats['out'] / 1e6 * 0.66
                print(f"  {_stats['done']}/{len(work)} | {el:.1f}min | ${cost:.2f}", flush=True)

    el = (time.time() - _T0) / 60
    cost = _stats['in'] / 1e6 * 0.22 + _stats['out'] / 1e6 * 0.66
    print(f"DONE. prompts {_stats['done']} (empty {_stats['empty']}, err {_stats['err']}) "
          f"| {el:.1f}min | ${cost:.2f}", flush=True)


if __name__ == '__main__':
    main()
