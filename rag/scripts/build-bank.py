#!/usr/bin/env python3
"""Compile the curated fact bank (JSONL, source of truth) into a SQLite + FTS5
database for on-device BM25 retrieval. The .db is a build artifact (gitignored);
edit the .jsonl, never the .db.

  python3 rag/scripts/build-bank.py          # build rag/bank/science.db
  python3 rag/scripts/build-bank.py "ano ang photosynthesis"   # build + test query
"""
import json, sqlite3, sys, os, glob, time

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # rag/
JSONL = os.path.join(HERE, "bank", "science-facts.jsonl")
DB = os.path.join(HERE, "bank", "science.db")

def load():
    rows = []
    for line in open(JSONL, encoding="utf-8"):
        line = line.strip()
        if line:
            rows.append(json.loads(line))
    return rows

def build(rows):
    if os.path.exists(DB):
        os.remove(DB)
    con = sqlite3.connect(DB)
    con.execute("""CREATE TABLE facts(
        id TEXT PRIMARY KEY, domain TEXT, topic TEXT, grades TEXT,
        terms TEXT, fact_tl TEXT, fact_en TEXT, source TEXT, reviewed INTEGER)""")
    # FTS5 over the Tagalog text + topic + terms => bm25() ranking on-device
    con.execute("CREATE VIRTUAL TABLE facts_fts USING fts5(id UNINDEXED, topic, terms, fact_tl)")
    for r in rows:
        con.execute("INSERT INTO facts VALUES(?,?,?,?,?,?,?,?,?)", (
            r["id"], r["domain"], r["topic"], json.dumps(r["grades"]),
            " ".join(r.get("terms", [])), r["fact"]["tl"], r["fact"]["en"],
            r.get("source", ""), 1 if r.get("reviewed") else 0))
        con.execute("INSERT INTO facts_fts VALUES(?,?,?,?)", (
            r["id"], r["topic"], " ".join(r.get("terms", [])), r["fact"]["tl"]))
    con.commit()
    return con

def search(con, query, k=3):
    # FTS5 MATCH + bm25() ranking (lower = better). Quote terms for a tolerant OR-ish match.
    q = " OR ".join(t for t in query.replace("?", " ").split() if len(t) > 2)
    # Weight columns (id, topic, terms, fact_tl): topic > terms > body so an
    # on-topic fact outranks one that merely shares a keyword in its prose.
    cur = con.execute(
        "SELECT f.topic, f.fact_tl, bm25(facts_fts, 0.0, 8.0, 4.0, 1.0) AS rank FROM facts_fts "
        "JOIN facts f ON f.id = facts_fts.id WHERE facts_fts MATCH ? ORDER BY rank LIMIT ?",
        (q, k))
    return cur.fetchall()

def main():
    rows = load()
    con = build(rows)
    sz = os.path.getsize(DB)
    print(f"built {DB}: {len(rows)} facts, {sz/1024:.0f} KB db")
    if len(sys.argv) > 1:
        print(f"\nquery: {sys.argv[1]}")
        for topic, tl, rank in search(con, sys.argv[1]):
            print(f"  [{topic} bm25={rank:.2f}] {tl[:130]}...")

if __name__ == "__main__":
    main()
