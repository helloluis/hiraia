#!/usr/bin/env python3
"""Assign a CONCEPT cluster id to every quiz question, so a single quiz round can
avoid serving two different facts that test the SAME idea (e.g. three distinct
Magnets facts all about "which metals a magnet attracts").

factId is unique per question, so it can't drive within-round de-dup. Instead we
embed each question's (English question + correct answer) with the SAME LaBSE
raw-CLS embedder used on-device (build-vectors.py parity), then greedily cluster
WITHIN each quizTopic by cosine similarity. Two questions in the same cluster =
"same concept" → pickQuestions keeps at most one per round.

Writes:
  - rag/bank/quiz-bank.jsonl            : adds "concept" (global int id) to each row
  - packages/mobile/src/data/quiz-bank.json : adds compact "c" to each sample question

  finetuning/.convert-venv/bin/python rag/scripts/cluster-quiz-concepts.py [THRESHOLD]
"""
import json, os, sys
import numpy as np, torch, torch.nn.functional as F
from collections import defaultdict, Counter
from transformers import AutoTokenizer, AutoModel

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # rag/
ROOT = os.path.dirname(HERE)
BANK = os.path.join(HERE, "bank", "quiz-bank.jsonl")
SAMPLE = os.path.join(ROOT, "packages", "mobile", "src", "data", "quiz-bank.json")
MODEL = "sentence-transformers/LaBSE"
THRESHOLD = float(sys.argv[1]) if len(sys.argv) > 1 else 0.82
dev = "mps" if torch.backends.mps.is_available() else "cpu"

rows = [json.loads(l) for l in open(BANK, encoding="utf-8")]
print(f"{len(rows)} questions; threshold={THRESHOLD}; device={dev}", flush=True)

tok = AutoTokenizer.from_pretrained(MODEL)
model = AutoModel.from_pretrained(MODEL).to(dev).eval()

def encode(texts, bs=128):
    out = []
    for i in range(0, len(texts), bs):
        enc = tok(texts[i:i+bs], return_tensors="pt", padding=True, truncation=True, max_length=128).to(dev)
        with torch.no_grad():
            cls = model(**enc).last_hidden_state[:, 0]  # raw CLS, no dense (== on-device)
        out.append(F.normalize(cls, p=2, dim=1).cpu().numpy())
        if (i // bs) % 20 == 0: print(f"  {min(i+bs,len(texts))}/{len(texts)}", flush=True)
    return np.vstack(out).astype(np.float32)

# concept text = English question + correct answer (the idea being tested)
def qa_text(r):
    q = r["q"].get("en", "")
    a = r["options"][r["answer"]].get("en", "")
    return f"{q} {a}"

print("embedding question+answer (en) ...", flush=True)
vecs = encode([qa_text(r) for r in rows])

# greedy representative-based clustering WITHIN each quizTopic (tighter than
# connected-components: a question joins the nearest existing seed >= threshold,
# else starts a new cluster). Global integer concept ids.
by_topic = defaultdict(list)
for i, r in enumerate(rows):
    by_topic[r.get("quizTopic", "?")].append(i)

concept = [None] * len(rows)
next_id = 0
topic_cluster_counts = {}
for topic, idxs in by_topic.items():
    seeds = []  # (concept_id, vec_index)
    for i in idxs:
        v = vecs[i]
        best, best_sim = -1, THRESHOLD
        for cid, si in seeds:
            sim = float(np.dot(v, vecs[si]))
            if sim >= best_sim:
                best, best_sim = cid, sim
        if best == -1:
            cid = next_id; next_id += 1
            seeds.append((cid, i))
            concept[i] = cid
        else:
            concept[i] = best
    topic_cluster_counts[topic] = len({concept[i] for i in idxs})

for i, r in enumerate(rows):
    r["concept"] = concept[i]

# ---- diagnostics ----
print(f"\n{next_id} concept clusters across {len(by_topic)} topics")
sizes = Counter(concept)
multi = [c for c, n in sizes.items() if n > 1]
print(f"clusters with >1 question: {len(multi)} ({sum(sizes[c] for c in multi)} questions grouped)")
print("\nclusters per topic (want >> 5 so a 5-round finds distinct concepts):")
for t, n in sorted(topic_cluster_counts.items(), key=lambda kv: kv[1]):
    pool = len(by_topic[t])
    flag = "  <-- thin" if n < 8 else ""
    print(f"  {n:3d} concepts / {pool:4d} q   {t}{flag}")

# validate the Magnets "which metals" case
print("\n=== Magnets 'which metals' cluster check ===")
mag = [(i, rows[i]) for i in by_topic.get("Magnets", [])]
metal = [(i, r) for i, r in mag if any(k in r["q"]["en"].lower() for k in
         ["which metals", "which group", "not attracted", "stick to", "pull all"])]
for i, r in metal:
    print(f"  concept={concept[i]:5d} | {r['q']['en'][:62]}")
print("  -> grouped" if len({concept[i] for i, _ in metal}) < len(metal) else "  -> still split (raise threshold? lower?)")

# largest few clusters (sanity: are they really the same idea?)
print("\n=== 3 largest clusters (sample) ===")
for c, n in sizes.most_common(3):
    members = [rows[i] for i in range(len(rows)) if concept[i] == c]
    print(f"  cluster {c} (n={n}), topic={members[0].get('quizTopic')}:")
    for m in members[:4]:
        print(f"     - {m['q']['en'][:66]}")

# ---- write back ----
with open(BANK, "w", encoding="utf-8") as f:
    for r in rows:
        f.write(json.dumps(r, ensure_ascii=False) + "\n")
print(f"\nwrote {BANK} (+concept)")

# map onto the bundled sample (compact key 'c')
id2concept = {r["id"]: r["concept"] for r in rows}
sample = json.load(open(SAMPLE, encoding="utf-8"))
miss = 0
for q in sample["questions"]:
    if q["id"] in id2concept:
        q["c"] = id2concept[q["id"]]
    else:
        miss += 1
json.dump(sample, open(SAMPLE, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print(f"wrote {SAMPLE} (+c); {len(sample['questions'])} questions, {miss} missing concept")
# how many distinct concepts per topic IN THE SAMPLE (what on-device dedup sees)
samp_by_topic = defaultdict(set)
for q in sample["questions"]:
    samp_by_topic[q["t"]].add(q.get("c"))
thin = [(t, len(cs)) for t, cs in samp_by_topic.items() if len(cs) < 5]
print("sample topics with <5 distinct concepts (round may still repeat):", thin if thin else "none")
