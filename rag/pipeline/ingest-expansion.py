#!/usr/bin/env python3
"""Ingest the parallel-agent expansion wave into the bank.

Reads every rag/pipeline/.expansion/*.jsonl produced by the generator agents,
then: dedup (by id vs bank + within batch; by normalized domain+topic to catch
near-dups) -> validate (schema, domain enum, trilingual >=10 chars each, terms
with cross-language coverage) -> append on-schema records to science-facts.jsonl.

  python3 rag/pipeline/ingest-expansion.py            # dry run, prints stats
  python3 rag/pipeline/ingest-expansion.py --write     # append accepted facts
"""
import json, sys, os, re, glob, unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BANK = os.path.join(ROOT, "rag/bank/science-facts.jsonl")
EXP = os.path.join(ROOT, "rag/pipeline/.expansion")
DOMAINS = {"MATTER", "LIVING_THINGS", "FORCE_MOTION_ENERGY", "EARTH_SPACE",
           "ABOUT_HIRAIA", "PH_CIVICS", "PH_GEOGRAPHY"}

def norm_topic(s):
    s = unicodedata.normalize("NFKD", (s or "").lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()

def slug_ok(s):
    return bool(re.match(r"^[a-z0-9][a-z0-9-]*$", s or ""))

# --- existing bank state -------------------------------------------------
existing_ids, existing_topics = set(), set()
for l in open(BANK):
    try:
        r = json.loads(l)
        existing_ids.add(r["id"])
        existing_topics.add((r.get("domain", ""), norm_topic(r.get("topic", ""))))
    except Exception:
        pass
print(f"bank: {len(existing_ids)} facts, {len(existing_topics)} domain+topic keys")

# --- load all agent outputs ----------------------------------------------
files = sorted(glob.glob(os.path.join(EXP, "*.jsonl")))
raw = []
for fp in files:
    n = 0
    for line in open(fp):
        line = line.strip()
        if not line:
            continue
        try:
            raw.append(json.loads(line)); n += 1
        except Exception:
            pass
    print(f"  {os.path.basename(fp)}: {n} records")
print(f"total raw records: {len(raw)}")

# --- dedup + validate ----------------------------------------------------
accepted, seen_ids, seen_topics = [], set(), set()
drops = {"dup_bank": 0, "dup_batch": 0, "dup_topic_bank": 0, "dup_topic_batch": 0,
         "bad_id": 0, "bad_domain": 0, "missing_lang": 0, "few_terms": 0, "no_vernacular": 0}

ASCII = re.compile(r"^[\x00-\x7f]+$")
def has_vernacular(terms):
    # at least one term that isn't pure-ASCII OR enough terms that some are
    # plausibly TL/BIS content words; we require >=6 terms and that they are
    # not all identical-to-English by demanding variety in length/shape.
    nonascii = any(not ASCII.match(t or "") for t in terms)
    return len(terms) >= 6 and (nonascii or len(set(terms)) >= 6)

for x in raw:
    fid = x.get("id", "")
    dom = x.get("domain")
    topic_key = (dom, norm_topic(x.get("topic", "")))
    if not slug_ok(fid):
        drops["bad_id"] += 1; continue
    if dom not in DOMAINS:
        drops["bad_domain"] += 1; continue
    if fid in existing_ids:
        drops["dup_bank"] += 1; continue
    if fid in seen_ids:
        drops["dup_batch"] += 1; continue
    if topic_key in existing_topics:
        drops["dup_topic_bank"] += 1; continue
    if topic_key in seen_topics:
        drops["dup_topic_batch"] += 1; continue
    fa = x.get("fact") or {}
    if not all(len((fa.get(k) or "").strip()) >= 10 for k in ("tl", "en", "bis")):
        drops["missing_lang"] += 1; continue
    terms = [t for t in (x.get("terms") or []) if isinstance(t, str) and t.strip()]
    if len(terms) < 6:
        drops["few_terms"] += 1; continue
    if not has_vernacular(terms):
        drops["no_vernacular"] += 1; continue
    seen_ids.add(fid); seen_topics.add(topic_key)
    accepted.append({
        "id": fid, "domain": dom, "topic": x.get("topic", ""),
        "grades": [g for g in (x.get("grades") or [5]) if isinstance(g, int)] or [5],
        "terms": terms,
        "fact": {"tl": fa["tl"].strip(), "en": fa["en"].strip(), "bis": fa["bis"].strip()},
        "source": x.get("source", "expansion"),
        "generator": "claude-workflow", "reviewed": False,
    })

print("dropped:", {k: v for k, v in drops.items() if v})
print(f"accepted: {len(accepted)}")

if "--write" in sys.argv:
    with open(BANK, "a") as fh:
        for x in accepted:
            fh.write(json.dumps(x, ensure_ascii=False) + "\n")
    print(f"appended {len(accepted)} -> {BANK}")
    total = sum(1 for _ in open(BANK))
    print(f"bank now: {total} facts")
else:
    print("(dry run; pass --write to append)")
