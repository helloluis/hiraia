#!/usr/bin/env python3
"""Tagalog/Cebuano defect audit for CARD BODIES (rag/pipeline/cardsPool.app.json).

Sibling of tools/quiz-language-audit, which does the same job for quiz MCQs. Same house
rules: this script DIAGNOSES and PROPOSES. `apply-safe` writes only the classes whose fix
is a pure, reversible string transform with no judgment in it; everything else leaves the
pool untouched and lands in proposals.jsonl for review.

39.2% of the pool (19,279 of 49,156 cards) opens its Tagalog body with a question line, which
the deck prints as the card's lead. The defect that prompted this (ffct-13212, seen on a real
device) is a Tagalog equational error:

    Ilang pakpak ang langaw?        "How many wings IS the fly?"
    Ilan ang pakpak ng langaw?      "How many are the wings OF the fly?"   <- correct

`[Predicate] ang [Topic]` equates the two sides, so a bare "Ilang X ang Y?" asks what Y *is*,
not what it *has*. It needs the genitive `ng`, or an existential `mayroon`.

WHY THAT CLASS IS **NOT** AUTO-FIXED. The rewrite is trivial; deciding whether a sentence
needs it is not. "Ilang beses tumitibok ang puso mo?" is CORRECT — the verb `tumitibok`
governs the `ang` phrase. A regex for the broken shape fires on 274 cards and most are
sentences like that one, which the rewrite would actively break. So the counting-question
class is emitted as T1 candidates for a model that has been scored on a gold set first.

Classes
  T0-A  double marker      "Ilang X ang mayroon ang Y?"  -> "Ilang X mayroon ang Y?"   AUTO
        (also normalises the colloquial contraction `meron` -> `mayroon`)
  T0-B  PAK corruption     bis title "Duha ka PAK sa Langaw" -> "... Pako ..."          AUTO
        All 9 occurrences are Cebuano titles whose English says "wing(s)".
  T0-C  untranslated EN    fact.en's first line is the Tagalog one                    REPORT
        Needs English written, which is authoring, not a transform.
  T0-D  duplicate leads    two cards whose tl question line is identical              REPORT
        Card ids are referenced by art, quizzes and lessons; dedupe is not mechanical.
  T1    counting question  bare "Ilang X ang Y?" with no governing verb               CANDIDATE

Usage
  python3 tools/card-language-audit/audit.py detect      --run <dir>
  python3 tools/card-language-audit/audit.py apply-safe  --run <dir>   # T0-A + T0-B only
  python3 tools/card-language-audit/audit.py status      --run <dir>
"""
import argparse
import collections
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
POOL = ROOT / 'rag/pipeline/cardsPool.app.json'

# --- detectors -----------------------------------------------------------------------

# "Ilang X ang mayroon/meron ang Y?" — one `ang` too many. The first one is the stray.
DOUBLE = re.compile(r'^(Ilan[g]?\s+.+?)\s+ang\s+(?:meron|mayroon)\s+ang\s+(.+\?)$', re.I)
# A counting question at all.
COUNTING = re.compile(r'^Ilan[g]?\b', re.I)
# The bare equational shape, pre-verb-check.
EQUATIONAL = re.compile(r'^Ilang\s+(.+?)\s+ang\s+(.+)\?$', re.I)
# `PAK` as a standalone token, only ever seen in Cebuano titles for "pako" (wing).
PAK = re.compile(r'\bPAK\b')

# Tagalog verbal morphology. If any token between the counted noun and the topic carries one
# of these, a verb governs the `ang` phrase and the sentence is FINE. Deliberately generous:
# this runs as a NEGATIVE filter (suppressing candidates), so over-matching costs recall on a
# list a model reviews anyway, while under-matching would hand the model correct sentences.
VERB_PREFIX = re.compile(
    r'^(um|nag|nakaka|naka|nagka|nagpa|napa|mag|magka|magpa|ma|na|ni|pina|pinag|ipa|ipina|i|'
    r'pag|pang|makaka|maka|mai|mapa|sum|tum|kum|bum|dum|gum|lum|hum|pum|rum)',
    re.I)
VERB_SUFFIX = re.compile(r'(in|an|han|hin|nan)$', re.I)
# Tagalog marks many verbs with an INFIX rather than a prefix: `dinadala` is d-in-adala,
# `tumitibok` is t-um-itibok. A prefix list cannot see these, and missing them is not a
# harmless miss — it hands the model (and a careless rewrite) sentences that were correct.
VERB_INFIX = re.compile(r'^[bkdglmnprstwyBKDGLMNPRSTWY](in|um)\w{2,}', re.I)
# Predicates that license a following `ang` without being morphological verbs: locatives
# (`nasa` = is in/at), and the pseudo-verbs of capacity/fit. "Ilang buto ang NASA leeg ng
# giraffe?" is perfectly good Tagalog — the rewrite would wreck it.
LICENSING = {
    'nasa', 'naroon', 'naroroon', 'nandoon', 'nandito', 'narito', 'andoon', 'andito',
    'kasya', 'kasyang', 'kaya', 'kayang', 'taglay', 'taglayin', 'bumubuo', 'meron', 'mayroon',
}
# Words that look verbal by affix but are ordinary nouns/adjectives here. Without this the
# negative filter swallows genuine defects: `pakpak`, `insekto`, `ngipin`, `alimango` all trip
# a naive prefix/suffix test.
NOT_VERBS = {
    'ilan', 'ilang', 'ang', 'ng', 'na', 'nang', 'sa', 'mga', 'ay', 'at', 'o', 'ba', 'po',
    'pakpak', 'insekto', 'insektong', 'ngipin', 'alimango', 'alimangong', 'nito', 'niya',
    'mo', 'ko', 'natin', 'nila', 'kanilang', 'isang', 'isa', 'bawat', 'ito', 'iyon',
    'bahagi', 'grupo', 'uri', 'buto', 'paa', 'braso', 'kulay', 'talulot', 'sungay',
    'kaharian', 'batik', 'puso', 'neuron', 'bato', 'taon', 'beses', 'minuto', 'araw',
    'pares', 'binti', 'mata', 'tainga', 'daliri', 'galamay', 'sanggol', 'tao', 'hayop',
    'lamang', 'din', 'rin', 'pa', 'kaya', 'meron', 'mayroon', 'karaniwang', 'karaniwan',
}


def looks_verbal(word: str) -> bool:
    """Does this token license a following `ang`? Generous by design — see VERB_PREFIX."""
    w = re.sub(r'[^\wñÑ-]', '', word).lower()
    if not w:
        return False
    if w in LICENSING:                      # checked BEFORE NOT_VERBS: `kaya`/`meron` are in both
        return True
    if w in NOT_VERBS or len(w) < 4:
        return False
    if VERB_INFIX.match(w):
        return True
    if VERB_PREFIX.match(w) and len(w) >= 5:
        return True
    return bool(VERB_SUFFIX.search(w) and len(w) >= 5)


def first_line(text: str) -> str:
    return (text or '').split('\n')[0].strip()


def detect(cards):
    """Every finding, as a list of dicts. Pure — never touches the pool."""
    out = []
    leads = collections.defaultdict(list)

    for c in cards:
        cid = c.get('id')
        fact = c.get('fact') or {}
        title = c.get('title') or {}
        tl, en = fact.get('tl') or '', fact.get('en') or ''
        head = first_line(tl)

        # T0-B — PAK in any title field
        for lang, t in title.items():
            if t and PAK.search(t):
                out.append(dict(cls='T0-B', id=cid, field=f'title.{lang}', before=t,
                                after=PAK.sub('Pako', t), auto=True,
                                why='Cebuano "pako" (wing); English title confirms'))

        if not head.endswith('?'):
            continue
        leads[head.lower()].append(cid)

        # T0-C — the English body opens with the Tagalog question
        if en and first_line(en) == head:
            out.append(dict(cls='T0-C', id=cid, field='fact.en', before=first_line(en),
                            after=None, auto=False,
                            why='English field holds the Tagalog question; needs authoring'))

        # T0-A — double marker
        m = DOUBLE.match(head)
        if m:
            fixed = f'{m.group(1)} mayroon ang {m.group(2)}'
            out.append(dict(cls='T0-A', id=cid, field='fact.tl', before=head, after=fixed,
                            auto=True, why='stray `ang` before mayroon; meron normalised'))
            continue

        # T1 — counting question with no governing verb
        if COUNTING.match(head) and 'mayroon' not in head.lower() and 'meron' not in head.lower():
            m = EQUATIONAL.match(head)
            if m:
                body = f'{m.group(1)} {m.group(2)}'
                if not any(looks_verbal(w) for w in body.split()):
                    out.append(dict(cls='T1', id=cid, field='fact.tl', before=head,
                                    after=f'Ilan ang {m.group(1)} ng {m.group(2)}?',
                                    auto=False, verdict=None,
                                    why='bare equational; `after` is a PROPOSAL pending judge'))

    for head, ids in leads.items():
        if len(ids) > 1:
            out.append(dict(cls='T0-D', id=ids[0], field='fact.tl', before=head, after=None,
                            auto=False, dupes=ids, why=f'{len(ids)} cards share this lead'))
    return out


# --- commands ------------------------------------------------------------------------

def load_pool():
    d = json.loads(POOL.read_text(encoding='utf-8'))
    return d, d['cards']


def cmd_detect(run: pathlib.Path):
    _, cards = load_pool()
    findings = detect(cards)
    run.mkdir(parents=True, exist_ok=True)
    with (run / 'proposals.jsonl').open('w', encoding='utf-8') as f:
        for x in findings:
            f.write(json.dumps(x, ensure_ascii=False) + '\n')
    by = collections.Counter(x['cls'] for x in findings)
    state = {'pool_cards': len(cards), 'counts': dict(by),
             'auto': sum(1 for x in findings if x['auto']), 'applied': False}
    (run / 'state.json').write_text(json.dumps(state, indent=2) + '\n', encoding='utf-8')
    for k in sorted(by):
        print(f'  {k}: {by[k]}')
    print(f'  auto-fixable: {state["auto"]}')
    return findings


def cmd_apply_safe(run: pathlib.Path):
    """Write ONLY the auto classes back to the pool. Everything else stays a proposal."""
    findings = [json.loads(l) for l in (run / 'proposals.jsonl').read_text(encoding='utf-8').splitlines()]
    auto = [x for x in findings if x.get('auto')]
    doc, cards = load_pool()
    index = {c['id']: c for c in cards}
    n = 0
    for x in auto:
        c = index.get(x['id'])
        if not c:
            continue
        obj, key = x['field'].split('.')
        target = c[obj]
        cur = target.get(key) or ''
        if x['cls'] == 'T0-A':                       # first line only; body must survive
            if first_line(cur) != x['before']:
                print(f'  SKIP {x["id"]}: lead moved since detect'); continue
            target[key] = cur.replace(x['before'], x['after'], 1)
        else:
            if cur != x['before']:
                print(f'  SKIP {x["id"]}: value moved since detect'); continue
            target[key] = x['after']
        n += 1
    # Serialise EXACTLY as the pool is stored: one line, default separators. Verified
    # byte-identical on an unmodified round-trip. Pretty-printing here instead turns a
    # 48-card edit into a 2,070,923-line diff and adds 8 MB to the repo — the edits become
    # unreviewable and the file stops being a sane artefact to ship. Review the change
    # through proposals.jsonl, which is why that file exists.
    POOL.write_text(json.dumps(doc, ensure_ascii=False), encoding='utf-8')
    st = json.loads((run / 'state.json').read_text())
    st['applied'] = True
    st['applied_count'] = n
    (run / 'state.json').write_text(json.dumps(st, indent=2) + '\n', encoding='utf-8')
    print(f'  applied {n} auto fixes to {POOL.relative_to(ROOT)}')


def cmd_status(run: pathlib.Path):
    print((run / 'state.json').read_text())


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('cmd', choices=['detect', 'apply-safe', 'status'])
    ap.add_argument('--run', required=True)
    a = ap.parse_args()
    fn = {'detect': cmd_detect, 'apply-safe': cmd_apply_safe, 'status': cmd_status}[a.cmd]
    sys.exit(fn(pathlib.Path(a.run)) and 0 or 0)
