# DepEd LRMDS — science subset (2026-08-22)

Contents:
- `docs.jsonl` — extracted text, one doc per line:
  `{"text": ..., "lrmds_id": "...", "queries": ["science"]}`
- `pdfs/` — the source PDFs (named `<lrmds_id>.pdf`).
- `HARVEST-STATS.json` — harvest counters.

Scope: LRMDS learner resources matching the "science" query (K–12 science SLMs,
LMs, activity sheets). Language note: Philippine science materials are frequently
English-medium or mixed — run a fastText LID pass if you need pure tl/ceb (or
filter to the Filipino-medium items by inspecting `text`).

Provenance & terms: lrmds.deped.gov.ph — Philippine government works (IP Code
§176; resource pages state "Reproduce, Use, Copy, Print"). Non-commercial/
educational use fine; commercial exploitation needs DepEd approval. Third-party
content inside modules retains its own copyright.

Sibling set: ../lrmds/ (language-focused harvest: Mother Tongue Bisaya/Cebuano,
Basa Pilipinas, Filipino/Tagalog learner materials).
