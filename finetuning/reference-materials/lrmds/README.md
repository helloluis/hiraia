# DepEd LRMDS harvest — reference copy (2026-08-22)

Contents:
- `docs.jsonl` — 1,272 extracted text documents, one per line:
  `{"text": ..., "lrmds_id": "...", "queries": [...]}` (queries = which search
  terms surfaced the resource: binisaya / cebuano / sinugbuanong / mother tongue /
  mtb-mle / basa pilipinas / filipino / tagalog).
- `pdfs/` — the source PDFs (named `<lrmds_id>.pdf`), if copied in.
- `HARVEST-STATS.json` — harvest counters.

Provenance & terms: DepEd Learning Resource Management and Development System
(lrmds.deped.gov.ph). Philippine government works (IP Code §176; LRMDS resource
pages state "Reproduce, Use, Copy, Print"). Non-commercial/educational use is
fine; commercial exploitation needs DepEd approval. Third-party content inside
modules (images, songs) retains its own copyright.

Language note: the ceb/Bisaya-tagged queries are the reliable-Cebuano subset;
"filipino"/"tagalog" queries include some English-medium resources — filter by
language with a fastText LID pass if you need purity (lid.176 has tl/ceb).

The bigger DepEd SLM haul (24,975 modules, SDO Muntinlupa LR portal) is on the
RunPod volume hiraia-cpt-expansion at /workspace/corpus/raw/deped-lrportal/
(docs.jsonl + pdfs/) — ask the corpus session to pull it down if needed.
