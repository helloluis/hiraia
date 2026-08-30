#!/usr/bin/env python3
"""Tag every feed factoid and bank fact with ONE MATATAG competency (+ its grade and quarter).

  python3 rag/pipeline/tag-curriculum.py            -> rag/bank/curriculum-tags.json, prints coverage
  python3 rag/pipeline/tag-curriculum.py --sample   -> also prints 12 random assignments for eyeballing

Rule: best-one by anchor overlap against matatag-elementary-competencies.json (144 codes in 16
grade-quarter blocks). Phrase hits count double. Ties -> lower grade (safer for a Grade-5 default).
Why best-one: the coverage audit's any-token matcher fans out to a median of 6 competencies per
card, which is fine for "is anything uncovered" and useless for weighting. Phrase-only tags 9%.
Best-one tags ~83% with exactly one code; the rest are off-curriculum and keep a low base weight.

Feed cards (ffct-*) and DepEd module cards (dcard-*) are DISJOINT id spaces (65 factId overlaps),
so the module-derived tags in cardsPool.deped.v3.json do not reach the feed; inference is the
only path for what ships.
"""
import json, re, random, sys, collections
ROOT = __import__("os").path.join(__import__("os").path.dirname(__file__), "..", "..")
def norm(s): return re.sub(r'[^a-z0-9 ]', ' ', (s or '').lower())
# Every MATATAG competency file (elementary G3-6 + jhs G7-10 when present), merged on "quarters".
import glob as _glob
_files = sorted(_glob.glob(f"{ROOT}/rag/sources/curriculum-guides/matatag-*-competencies.json"))
cur = {"quarters": [], "sources": []}
for _f in _files:
    _d = json.load(open(_f)); cur["quarters"] += _d["quarters"]; cur["sources"].append(_d.get("source", _f))
print(f"competency files: {[f.rsplit('/',1)[-1] for f in _files]} -> {sum(len(q['competencies']) for q in cur['quarters'])} competencies, grades {sorted({q['grade'] for q in cur['quarters']})}")
comps = []
for q in cur["quarters"]:
    for c in q["competencies"]:
        an = [norm(a) for a in (c.get("anchors") or [])]
        comps.append({"code": c["code"], "text": c["text"], "grade": int(q["grade"]), "quarter": int(q["quarter"]),
                      "domain": q.get("domain"), "anchors": an, "phrases": [a for a in an if " " in a]})
# Anchor weight = IDF across competencies x a corpus-frequency prior. The catch-all failure
# (G3-L-6 "basic needs" absorbing 5,720 cards via anchors `air`,`food`,`water`,`shelter`) is
# single common nouns that are unique to one competency (so IDF cannot see them) but appear in
# thousands of cards. Weight each anchor by how RARE it is in the factoid corpus; phrases x2.
import math
def build_weights(corpus_blobs):
    df_comp = collections.Counter(a for c in comps for a in set(c["anchors"]))
    n = len(corpus_blobs)
    df_corp = {a: sum(1 for b in corpus_blobs if a in b) for c in comps for a in set(c["anchors"])}
    w = {}
    for a in df_comp:
        idf_c = math.log((len(comps) + 1) / (df_comp[a] + 1)) + 1
        idf_x = math.log((n + 1) / (df_corp[a] + 1)) + 1          # rare in the corpus -> specific
        w[a] = idf_c * idf_x * (2.0 if " " in a else 1.0)
    return w
def best_one(blob, grades, w):
    scored = []
    for c in comps:
        s = sum(w[a] for a in c["anchors"] if a and a in blob)
        if s <= 0: continue
        if grades and c["grade"] in grades: s *= 1.5                 # the card's own grade tag breaks ties
        scored.append((s, c))
    if not scored: return None, 0.0, 0.0
    scored.sort(key=lambda x: -x[0]); top = scored[0][0]; second = scored[1][0] if len(scored) > 1 else 0.0
    return scored[0][1], top, (top - second) / top                    # confidence = margin over the runner-up
def tag_rows(rows, text_of, grades_of):
    blobs = [norm(text_of(r)) for r in rows]; w = build_weights(blobs)
    out = {}
    for r, blob in zip(rows, blobs):
        c, score, margin = best_one(blob, grades_of(r), w)
        out[r["id"]] = ({"competency": c["code"], "grade": c["grade"], "quarter": c["quarter"], "domain": c["domain"],
                         "score": round(score, 2), "confidence": round(margin, 2)} if c else None)
    return out
fds = [json.loads(l) for l in open(f"{ROOT}/rag/bank/factoids.jsonl", encoding="utf-8")]
bank = [json.loads(l) for l in open(f"{ROOT}/rag/bank/science-facts.jsonl", encoding="utf-8")]
ftext = lambda r: f"{r.get('topic','')} {r.get('q','')} {r.get('text','') if isinstance(r.get('text'),str) else json.dumps(r.get('text'))}"
btext = lambda r: f"{r.get('topic','')} {' '.join(r.get('terms') or [])} {r['fact'].get('en','') if isinstance(r.get('fact'),dict) else r.get('fact','')}"
gr = lambda r: {int(x) for x in (r.get("grades") or []) if str(x).isdigit()}
tf, tb = tag_rows(fds, ftext, gr), tag_rows(bank, btext, gr)
json.dump({"scheme": "best-one, anchors weighted by competency-IDF x corpus-rarity, phrases x2, own-grade tie-break x1.5", "factoids": tf, "bank": tb},
          open(f"{ROOT}/rag/bank/curriculum-tags.json", "w"))
print(f"tagged: factoids {sum(1 for v in tf.values() if v)}/{len(tf)}  bank {sum(1 for v in tb.values() if v)}/{len(tb)}  -> rag/bank/curriculum-tags.json")
feed = json.load(open(f"{ROOT}/rag/pipeline/cardsPool.app.json"))["cards"]
cov = collections.Counter(); off = 0
for c in feed:
    t = tf.get(c["id"])
    if t: cov[(t["grade"], t["quarter"])] += 1
    else: off += 1
print(f"\nFEED POOL ({len(feed)} illustrated cards) by grade x quarter, best-one:")
print("  grade  " + "".join(f"{q:>7}" for q in (1, 2, 3, 4)) + "   total")
for g in (3, 4, 5, 6): print(f"  {g:5}  " + "".join(f"{cov[(g,q)]:>7}" for q in (1, 2, 3, 4)) + f"{sum(cov[(g,q)] for q in (1,2,3,4)):>8}")
print(f"  off-curriculum: {off} ({100*off/len(feed):.0f}%)   thin cells (<200): {sorted((k,v) for k,v in cov.items() if v<200)}")
absorb = collections.Counter(v["competency"] for v in tf.values() if v)
print("  top absorbers:", absorb.most_common(4))
conf = [v["confidence"] for v in tf.values() if v]
lo = sum(1 for x in conf if x < 0.25)
print(f"  confidence (margin over runner-up): median {sorted(conf)[len(conf)//2]:.2f} | low (<0.25): {lo}/{len(conf)} -> weighted as near-off-curriculum")
if "--sample" in sys.argv:
    random.seed(3); print("\nSPOT-CHECK (does the competency describe the card?):")
    for c in random.sample([c for c in feed if tf.get(c["id"])], 12):
        t = tf[c["id"]]; comp = next(x for x in comps if x["code"] == t["competency"])
        print(f"  [{t['competency']:8} G{t['grade']} Q{t['quarter']} conf {t['confidence']:.2f}] {c['topic'][:30]:30} | {comp['text'][:50]}")
