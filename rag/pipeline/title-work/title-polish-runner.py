#!/usr/bin/env python3
"""Title-polish runner — executes on the VPS against the Kimi (Moonshot) API.

Model routing by difficulty (cost discipline):
  - salad TRIAGE  -> kimi-k2.7 (cheap): classify keep/fix; when the fix is obvious,
    write it inline (it costs ~nothing extra — the agent is already looking at the card)
  - spoiler FIX   -> kimi-k3 (hard task: name the topic WITHOUT stating the answer)
  - salad flagged-but-unfixed -> kimi-k3 (K2.7 said "bad but I couldn't fix it")

Resumable: finished shards are skipped; a ZERO-BYTE shard counts as unfinished (same
convention as fw-gen-card-titles.py). Everything lands in ./out/ as JSONL.

  KIMI_API_KEY=... python3 title-polish-runner.py            # all shards
  LIMIT=20       python3 title-polish-runner.py              # pilot slice
  SHARDS_PER_RUN=200 CONC=8 python3 title-polish-runner.py   # pacing knobs
"""
import os, json, time, threading, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed

HERE = os.path.dirname(os.path.abspath(__file__))
WORKLIST = os.path.join(HERE, 'worklist.jsonl')
OUT = os.path.join(HERE, 'out')
URL = 'https://api.kimi.com/coding/v1/chat/completions'  # kimi.ai/code subscription keys
KEY = os.environ['KIMI_API_KEY']

CHEAP = os.environ.get('KIMI_CHEAP_MODEL', 'kimi-for-coding')          # K2.7 — triage
SMART = os.environ.get('KIMI_SMART_MODEL', 'k3-256k')                  # K3 — rewrites
CONC = int(os.environ.get('CONC', '8'))
PER_CALL = int(os.environ.get('PER_CALL', '20'))
LIMIT = int(os.environ.get('LIMIT', '0')) or None
BATCH = 40  # cards per shard file

SPEC = """\
You are fixing display TITLES on a Filipino grade-school science card deck (Tagalog).

A title is a SHORT NOUN PHRASE naming what the card is about (target 3 words / ~18 chars,
NEVER over 32 characters in any language). It is a LABEL, not a summary, never a sentence.

REGISTER: English science terms inside Tagalog grammar is CORRECT ("Windpipe ng Python",
"Radula ng Suso"). Do not purify English into invented Tagalog coinages; do not translate
established terms. Cebuano uses real Cebuano ("sa" for "ng", "nga" for "na").

HARD RULES:
1. <=32 characters in EACH of tl/en/bis, counting every letter. Verify before answering.
2. Title Case; linkers lowercase (ng, na, sa, at, ug, nga). Noun phrase; no final punctuation.
3. Ground it: name ONLY what the card's fact states. No new terms or numbers.
4. tl, en, bis all present; identical across all three ONLY for untranslatable proper nouns.
5. NO SPOILING: if the card asks a question and the title gives away the answer, rewrite so
   the title names the TOPIC, not the answer. "Paano kumakain ang kuhol?" -> "Paraan ng Kuhol
   sa Pagkain" is borderline; "Pagong sa Pagkain" style topic-naming is the goal. NEVER include
   an answer term from the card's `answers` list in the new title.
6. NO KEYWORD SALADS: a pile of nouns with no grammar ("Halaman Imbak Enerhiya Araw",
   "Stomata CO2 Papasok") is not a title. Add the connective tissue or drop words until it
   reads as a phrase a teacher would write ("Imbak ng Enerhiya", "CO2 sa Stomata").
7. If the existing title is already good, keep it EXACTLY — output action "keep".
"""

def call(model, prompt, max_tokens=12000, retries=4):
    body = json.dumps({
        'model': model,
        # kimi.ai/code models only allow temperature=1 (validated: 400 otherwise)
        'temperature': 1,
        'max_tokens': max_tokens,
        'messages': [{'role': 'user', 'content': prompt}],
    }).encode()
    last = None
    for attempt in range(retries):
        req = urllib.request.Request(URL, data=body, headers={
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {KEY}',
        })
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                data = json.loads(r.read())
                return data['choices'][0]['message']['content']
        except Exception as e:  # noqa: BLE001 — retry any transport/API error
            last = e
            time.sleep(2 ** attempt * 3)
    raise RuntimeError(f'Kimi call failed after {retries} retries: {last}')

def extract_json(text):
    """Kimi may wrap JSON in fences or prose; find the outermost {...}."""
    text = text.strip()
    if text.startswith('```'):
        text = text.split('\n', 1)[1] if '\n' in text else text
        text = text.rsplit('```', 1)[0]
    start = text.find('{')
    end = text.rfind('}')
    return json.loads(text[start:end + 1])

def triage_prompt(cards):
    lines = []
    for i, c in enumerate(cards):
        lines.append(f"[{i}] id={c['id']} title={c['title']!r} answers={c.get('answers') or []}")
        lines.append(f"    fact: {c['fact_tl'][:220]}")
    return (
        SPEC
        + "\nTASK: for each card below, decide whether its CURRENT title is acceptable.\n"
        + "- Acceptable = a real noun-phrase title (even if terse, even all-English if the term\n"
        + "  is established: 'Commensalism vs Mutualism' is GOOD).\n"
        + "- Unacceptable = keyword salad (nouns piled with no grammar) or a spoiler.\n"
        + "  If unacceptable and you can write a better title confidently, write it.\n"
        + "  If unacceptable but you are NOT confident, set fix=false and say why in note.\n\n"
        + "Return STRICT JSON: {\"results\":[{\"i\":<index>,\"action\":\"keep\"|\"fix\","
        + "\"title\":{\"tl\":..,\"en\":..,\"bis\":..},\"note\":\"\"}]}. "
        + "action=keep implies title omitted. One entry per input card, in order.\n\n"
        + 'CARDS:\n' + '\n'.join(lines)
    )

def rewrite_prompt(cards):
    lines = []
    for i, c in enumerate(cards):
        lines.append(f"[{i}] id={c['id']} title={c['title']!r}")
        lines.append(f"    answers (FORBIDDEN in title): {c.get('answers') or []}")
        lines.append(f"    fact_tl: {c['fact_tl'][:220]}")
        lines.append(f"    fact_en: {c['fact_en'][:160]}")
    return (
        SPEC
        + "\nTASK: each card's title SPOILS its answer (the card asks a question the title\n"
        + "answers). Write a replacement title that names the TOPIC of the card without\n"
        + "containing any forbidden answer term. Keep the card's subject recognisable — the\n"
        + "child should still want to tap it.\n\n"
        + "Return STRICT JSON: {\"results\":[{\"i\":<index>,\"title\":{\"tl\":..,\"en\":..,\"bis\":..}}]}. "
        + "One entry per input card, in order.\n\n"
        + 'CARDS:\n' + '\n'.join(lines)
    )

def load_shards():
    cards = [json.loads(l) for l in open(WORKLIST) if l.strip()]
    shards = [cards[i:i + BATCH] for i in range(0, len(cards), BATCH)]
    if LIMIT:
        # pilot: take a proportional slice across the whole list, not the head
        step = max(1, len(cards) // LIMIT)
        pilot = cards[::step][:LIMIT]
        shards = [pilot[i:i + BATCH] for i in range(0, len(pilot), BATCH)]
    return shards

lock = threading.Lock()
stats = {'keep': 0, 'fixed': 0, 'kept_original': 0, 'errors': 0}

def run_shard(idx, cards):
    path = os.path.join(OUT, f'shard-{idx:04d}.jsonl')
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return  # resumable
    spoilers = [c for c in cards if c['defect'] == 'spoiler']
    salads = [c for c in cards if c['defect'] == 'salad']
    results = {}

    if salads:
        raw = call(CHEAP, triage_prompt(salads))
        for r in extract_json(raw).get('results', []):
            c = salads[r['i']]
            if r.get('action') == 'fix' and r.get('title'):
                results[c['id']] = {'id': c['id'], 'op': 'fix', 'title': r['title'], 'why': r.get('note', '')}
            elif r.get('action') == 'keep':
                results[c['id']] = {'id': c['id'], 'op': 'keep', 'why': r.get('note', '')}
            else:  # flagged, unconfident — escalate to the smart model
                results[c['id']] = {'id': c['id'], 'op': 'escalate', 'why': r.get('note', '')}

    if spoilers:
        raw = call(SMART, rewrite_prompt(spoilers))
        for r in extract_json(raw).get('results', []):
            c = spoilers[r['i']]
            results[c['id']] = {'id': c['id'], 'op': 'fix', 'title': r['title'], 'why': 'spoiler rewrite'}

    # escalations: K2.7 couldn't fix confidently -> one K3 pass for just those
    escalations = [c for c in salads if results.get(c['id'], {}).get('op') == 'escalate']
    if escalations:
        try:
            raw = call(SMART, rewrite_prompt(escalations))
            for r in extract_json(raw).get('results', []):
                c = escalations[r['i']]
                results[c['id']] = {'id': c['id'], 'op': 'fix', 'title': r['title'], 'why': 'escalated'}
        except Exception:
            pass  # leaves op=escalate — merged as keep locally, visible in the report

    with lock:
        for v in results.values():
            if v['op'] == 'keep': stats['keep'] += 1
            elif v['op'] == 'fix': stats['fixed'] += 1
            else: stats['kept_original'] += 1

    with open(path, 'w') as f:  # zero-byte on failure = unfinished, retried next run
        for c in cards:
            r = results.get(c['id'])
            if r:
                f.write(json.dumps(r, ensure_ascii=False) + '\n')

def main():
    os.makedirs(OUT, exist_ok=True)
    shards = load_shards()
    todo = [(i, s) for i, s in enumerate(shards)
            if not (os.path.exists(os.path.join(OUT, f'shard-{i:04d}.jsonl'))
                    and os.path.getsize(os.path.join(OUT, f'shard-{i:04d}.jsonl')) > 0)]
    print(f"{len(shards)} shards ({sum(len(s) for s in shards)} cards), {len(todo)} to run | "
          f"triage={CHEAP} rewrite={SMART} conc={CONC}")
    done = 0
    with ThreadPoolExecutor(max_workers=CONC) as ex:
        futs = {ex.submit(run_shard, i, s): i for i, s in todo}
        for fut in as_completed(futs):
            try:
                fut.result()
                done += 1
                if done % 10 == 0:
                    print(f"  {done}/{len(todo)} shards | {stats}")
            except Exception as e:  # noqa: BLE001 — one bad shard must not kill the run
                stats['errors'] += 1
                print(f"  shard {futs[fut]} FAILED: {e}")
    print(f"DONE. {stats}")
    print(f"results in {OUT}/ — pull back with: rsync -z VPS:{OUT}/ ./title-work/out/")

if __name__ == '__main__':
    main()
