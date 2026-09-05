#!/usr/bin/env python3
"""Build the title-polish worklist for an outside-model run (VPS + Kimi).

Stage 1 of the fix for judge findings #1 (keyword-salad titles) and #3 (spoiler titles).
Deterministic detectors over-generate SALAD on purpose (a connector-density heuristic
cannot know "Commensalism vs Mutualism" is a good title); the LLM triages. SPOILER
detection is high-precision (question-led body whose emphasized ANSWER term is in the
title) and those cards go straight to rewrite.

Output: rag/pipeline/title-work/
  worklist.jsonl    one line per card: {id, defect, title, fact_tl, fact_en, answers[]}
  TASKS.md          the self-contained brief for the runner on the VPS
"""
import json, os, re, sqlite3, collections

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
POOL = os.path.join(ROOT, 'rag/pipeline/cardsPool.app.json')
DB = os.path.join(ROOT, 'packages/mobile/assets/data/cards.db')
OUT = os.path.join(HERE, 'title-work')

FUNC = {'ng','na','sa','at','ang','mga','nga','ug','ka','ni','no','vs','ay','may','para','the','of','in','on','for','and','a','an','from','with','at','kung','bilang'}
ASK = re.compile(r'^(bakit|paano|ano|sino|saan|kailan|alit|ilang)', re.I)

def answer_terms(tl: str, emph: str) -> list[str]:
    """Emphasized words NOT in the question half — the card's answer vocabulary."""
    q, _, a = tl.partition('\n')
    qw = {w.lower().strip('.,!?—“”()') for w in q.split()}
    out = []
    for span in (emph or '').split('\x1f'):
        for w in span.split():
            wl = w.lower().strip('.,!?—“”()')
            if len(wl) > 3 and wl not in FUNC and wl not in qw and wl not in out:
                out.append(wl)
    return out

def main():
    os.makedirs(OUT, exist_ok=True)
    pool = json.load(open(POOL))
    db = sqlite3.connect(DB)
    rows = {r[0]: r for r in db.execute('SELECT id, tl, title_tl, emph_tl FROM card_text')}

    work = {}
    for c in pool['cards']:
        r = rows.get(c['id'])
        if not r: continue
        tl, title, emph = r[1], r[2], r[3]
        if not title: continue  # coverage tripwire owns missing titles, not this pass
        tw = title.split()
        conn = sum(1 for w in tw if w.lower().strip('.') in FUNC)

        spoiler_terms = []
        if tl and emph and ASK.match(tl.strip()):
            spoiler_terms = [t for t in answer_terms(tl, emph)
                             if t in {w.lower().strip('.,!?—') for w in tw}]

        is_spoiler = bool(spoiler_terms)
        is_salad = (len(tw) >= 3 and conn == 0) or (len(tw) >= 5 and conn <= 1)

        if is_spoiler:
            work[c['id']] = {'id': c['id'], 'defect': 'spoiler', 'answers': spoiler_terms,
                             'title': title, 'fact_tl': tl, 'fact_en': ''}
        elif is_salad:
            work[c['id']] = {'id': c['id'], 'defect': 'salad', 'answers': answer_terms(tl, emph) if tl else [],
                             'title': title, 'fact_tl': tl, 'fact_en': ''}

    # attach fact_en for the LLM's grounding (cheap: one more column read)
    en = {r[0]: r[1] for r in db.execute('SELECT id, en FROM card_text')}
    for w in work.values():
        w['fact_en'] = en.get(w['id'], '')

    with open(os.path.join(OUT, 'worklist.jsonl'), 'w') as f:
        for w in work.values():
            f.write(json.dumps(w, ensure_ascii=False) + '\n')

    counts = collections.Counter(w['defect'] for w in work.values())
    print(f"worklist: {len(work)} cards -> {OUT}/worklist.jsonl  ({dict(counts)})")

if __name__ == '__main__':
    main()
