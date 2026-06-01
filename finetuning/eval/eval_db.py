#!/usr/bin/env python3
"""SQLite store for Hiraia eval results — every test prompt + model response,
tied to a training run, with score columns, built for later visualization of
both the test suite and per-run quality.

Schema (3 tables):
  runs      — one row per training run / adapter version we evaluate
  prompts   — the test suite (one row per question; stable across runs)
  responses — one row per (run × prompt): the model's reply + all scores

Usage:
  python eval_db.py init
  python eval_db.py import-prompts student-prompts.json
  python eval_db.py register-run --id bisaya-v1 --lang cebuano --engine qvac \
      --base "Qwen3-1.7B-Q4_K_M" --notes "r16 a32 3ep assistantLossOnly"
  python eval_db.py import-results results-bisaya.json --run bisaya-v1
  python eval_db.py report
"""
import argparse, json, sqlite3, os, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(HERE, "eval.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS runs (
  run_id        TEXT PRIMARY KEY,         -- e.g. 'bisaya-v1', 'tagalog-full-v2'
  lang          TEXT NOT NULL,            -- cebuano | tagalog
  engine        TEXT NOT NULL,            -- qvac | transformers-unsloth  (which stack produced the model)
  base_model    TEXT,                     -- e.g. 'Qwen3-1.7B-Q4_K_M' (the deployment quant) vs 'qwen3-1.7b-bnb-4bit'
  adapter_fmt   TEXT,                     -- gguf | safetensors
  lora_rank     INTEGER,
  lora_alpha    INTEGER,
  epochs        INTEGER,
  train_loss    REAL,
  eval_loss     REAL,
  dataset       TEXT,                     -- dataset file/name used
  n_samples     INTEGER,
  matches_prod  INTEGER DEFAULT 0,        -- 1 if this run replicates the on-phone setup (QVAC + Q4_K_M)
  notes         TEXT,
  created_at    TEXT
);

CREATE TABLE IF NOT EXISTS prompts (
  prompt_id     TEXT PRIMARY KEY,         -- e.g. 'ceb-02'
  lang          TEXT NOT NULL,
  grade         INTEGER,
  register      TEXT,                     -- clean|misspelled|lazy_keywords|vague|codeswitch|incomplete|txtspeak
  topic         TEXT,
  prompt        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS responses (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id        TEXT NOT NULL REFERENCES runs(run_id),
  prompt_id     TEXT NOT NULL REFERENCES prompts(prompt_id),
  reply         TEXT,
  -- auto scores (cheap heuristics)
  words         INTEGER,
  lang_ok       INTEGER,                  -- responded in the expected language
  ceb_ratio     REAL,
  tag_ratio     REAL,
  eng_ratio     REAL,
  english_heavy INTEGER,
  ends_question INTEGER,                  -- Socratic ending present
  repetitive    INTEGER,                  -- low unique-word ratio (degeneration)
  too_short     INTEGER,
  -- human / rubric scores (filled in later, nullable)
  human_correct        INTEGER,           -- science factually correct? 1/0
  human_intent_ok      INTEGER,           -- recovered intent from messy input? 1/0
  human_register_ok    INTEGER,           -- grade-appropriate + right tone? 1/0
  human_overall        INTEGER,           -- 1-5
  human_notes          TEXT,
  created_at    TEXT,
  UNIQUE(run_id, prompt_id)
);

CREATE INDEX IF NOT EXISTS idx_resp_run ON responses(run_id);
CREATE INDEX IF NOT EXISTS idx_resp_prompt ON responses(prompt_id);
"""

def conn():
    c = sqlite3.connect(DB); c.execute("PRAGMA foreign_keys=ON"); return c

def now():
    # ISO date; passed-in rather than computed-at-import to keep deterministic
    return datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

def cmd_init(a):
    c = conn(); c.executescript(SCHEMA); c.commit()
    print(f"initialized {DB}")

def cmd_import_prompts(a):
    data = json.load(open(a.file))["prompts"]
    c = conn()
    for p in data:
        c.execute("""INSERT OR REPLACE INTO prompts(prompt_id,lang,grade,register,topic,prompt)
                     VALUES(?,?,?,?,?,?)""",
                  (p["id"], p["lang"], p["grade"], p["register"], p["topic"], p["prompt"]))
    c.commit(); print(f"imported {len(data)} prompts")

def cmd_register_run(a):
    c = conn()
    c.execute("""INSERT OR REPLACE INTO runs(run_id,lang,engine,base_model,adapter_fmt,
                 lora_rank,lora_alpha,epochs,train_loss,eval_loss,dataset,n_samples,matches_prod,notes,created_at)
                 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
              (a.id,a.lang,a.engine,a.base,a.adapter_fmt,a.lora_rank,a.lora_alpha,a.epochs,
               a.train_loss,a.eval_loss,a.dataset,a.n_samples,1 if a.matches_prod else 0,a.notes,now()))
    c.commit(); print(f"registered run {a.id}")

def cmd_import_results(a):
    d = json.load(open(a.file))
    rows = d["results"]
    c = conn()
    for r in rows:
        s = r.get("scores", {})
        c.execute("""INSERT OR REPLACE INTO responses(run_id,prompt_id,reply,words,lang_ok,
                     ceb_ratio,tag_ratio,eng_ratio,english_heavy,ends_question,repetitive,too_short,created_at)
                     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                  (a.run, r["id"], r.get("reply",""), s.get("words"),
                   int(bool(s.get("lang_ok"))), s.get("ceb_ratio"), s.get("tag_ratio"),
                   s.get("eng_ratio"), int(bool(s.get("english_heavy"))),
                   int(bool(s.get("ends_question"))), int(bool(s.get("repetitive"))),
                   int(bool(s.get("too_short"))), now()))
    c.commit(); print(f"imported {len(rows)} responses for run {a.run}")

def cmd_report(a):
    c = conn()
    print("=== RUNS ===")
    for row in c.execute("""SELECT run_id,lang,engine,base_model,matches_prod,
                            (SELECT COUNT(*) FROM responses WHERE run_id=runs.run_id) n
                            FROM runs ORDER BY created_at"""):
        prod = "PROD-MATCH" if row[4] else "not-prod"
        print(f"  {row[0]:20} {row[1]:8} {row[2]:20} base={row[3]} [{prod}] {row[5]} responses")
    print("\n=== PER-RUN AUTO-SCORES ===")
    for row in c.execute("""SELECT run_id, COUNT(*), SUM(lang_ok), SUM(english_heavy),
                            SUM(repetitive), SUM(ends_question), ROUND(AVG(words))
                            FROM responses GROUP BY run_id"""):
        print(f"  {row[0]:20} n={row[1]} lang_ok={row[2]} eng_heavy={row[3]} "
              f"repetitive={row[4]} ends_q={row[5]} avg_words={row[6]}")

def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("init")
    p = sub.add_parser("import-prompts"); p.add_argument("file")
    p = sub.add_parser("register-run")
    p.add_argument("--id", required=True); p.add_argument("--lang", required=True)
    p.add_argument("--engine", required=True); p.add_argument("--base")
    p.add_argument("--adapter-fmt"); p.add_argument("--lora-rank", type=int)
    p.add_argument("--lora-alpha", type=int); p.add_argument("--epochs", type=int)
    p.add_argument("--train-loss", type=float); p.add_argument("--eval-loss", type=float)
    p.add_argument("--dataset"); p.add_argument("--n-samples", type=int)
    p.add_argument("--matches-prod", action="store_true"); p.add_argument("--notes")
    p = sub.add_parser("import-results"); p.add_argument("file"); p.add_argument("--run", required=True)
    sub.add_parser("report")
    a = ap.parse_args()
    {"init":cmd_init,"import-prompts":cmd_import_prompts,"register-run":cmd_register_run,
     "import-results":cmd_import_results,"report":cmd_report}[a.cmd](a)

if __name__ == "__main__":
    main()
