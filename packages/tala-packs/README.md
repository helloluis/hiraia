# @hiraia/tala-packs — prebuilt weekly Science teaching packs

For every week the DepEd 2026 Three-Term Budgets of Work print for Science, Grades 3–10 (262 weeks), this package
builds an **English and a Filipino** pack: five MATATAG-format lesson plans, a 16:9 classroom deck with speaker notes,
and a teacher guide written for teachers who are not Science specialists. Decisions and rationale:
`docs/tala/teaching-packs/STATUS.md`; wording rules: `docs/tala/teaching-packs/VERBIAGE-RULES.md`; PRD §18.4.

Offline batch tooling. The web app only reads the committed library (`library/`) and the built files.

## Inputs (all verified, all committed)

| File | What | Built by |
|---|---|---|
| `packages/tala-server/data/packs/science-bow-2026-g*.json` | Competencies, verbatim, with printed weeks and pages | curriculum workstream |
| `data/curriculum/science-bow-2026-activities.json` | DepEd's printed term activities and performance tasks | `scripts/extract_bow_activities.py` |
| `data/art/competency-candidates.json` | Approved Hiraia B&W drawings per competency (code crosswalk → curated lessons and tags → card slug → v0.5 review status), with SHA-256 | `scripts/build_art_catalog.py --reference-root /home/b11/code/hiraia` |
| `data/grounding/competency-statements.json` | What Hiraia already teaches per competency (English and Tagalog) | `scripts/build_grounding.py` |
| `data/references.json` | Closed list of citable sources, each link checked | by hand |

## Pipeline per week

| Stage | Model (direct API) | Output |
|---|---|---|
| Week design + teacher-guide science + assessment | `deepseek-v4-pro`, reasoning on | outline |
| Five days: lesson plan, slides, speaker notes | `deepseek-flash` (DeepSeek V4.1 Flash) | English days |
| Independent critique → patches (each patch must quote the text it replaces) → re-critique | `qwen4-max` ↔ `deepseek-v4-pro` | revised English |
| Every drawing checked against its slide | `qwen3-vl-plus` | illustration records |
| Filipino guide + assessment, composed from the checked English | `deepseek-v4-pro` | |
| Filipino days (structure locked to English) | `deepseek-flash` | Filipino edition |
| Filipino critique (science + Hiraia wording rules) → patches (text only) | `qwen4-max` ↔ `deepseek-v4-pro` | revised Filipino |
| Deterministic checks, wording (verbiage/1) checks, structure equality | none | `review.json` per language |
| Render: PPTX (pptxgenjs), slide previews (LibreOffice), PDFs (Chromium) | none | `build/artifacts/<id>/<lang>/` |

Stage results are cached in `build/work/<id>/` (keyed by prompt and model), so reruns resume. A week that fails is
recorded and the run continues; three weeks failing the same way stop the run. Spend is metered against `--budget`
in `build/calls.jsonl`.

## Commands

```sh
set -a; . /home/b11/code/tala-v1/packages/tala-server/.env; set +a   # DEEPSEEK_API_KEY, ALIBABACLOUD_API_KEY (names only)
npx tsx src/cli.ts targets                                   # the 262 weeks
npx tsx src/cli.ts run --targets sci26-g4-t1-w08 --thorough  # one week, 3 critique rounds per language
npx tsx src/cli.ts run --all --pending --budget 60 --concurrency 4 --off-peak
npx tsx src/cli.ts inventory                                 # library/INVENTORY.md
npx tsx src/cli.ts approve sci26-g4-t1-w08 --lang fil --by "Name" --role "Grade 4 teacher, …" [--expert] [--publish]
pnpm --filter @hiraia/tala-packs test
```

Rendering needs LibreOffice (`TALA_PACKS_SOFFICE`, default `~/.local/bin/lo-soffice`) and Chromium
(`TALA_PACKS_CHROMIUM`); the drawings are read from `TALA_PACKS_REFERENCE_ROOT` (default `/home/b11/code/hiraia`).

## Review and publication

`review.json` keeps the stages apart: `autoChecks` (deterministic), `modelCritique` (a second model; **not** human
review), `verbiage` (Hiraia wording rules), `teacherReview` / `expertReview` (named people only; `approve` refuses a
model name in tests), `publication`. Only `approved` versions are public; reviewers (any signed-in account outside
production, or `TALA_PACK_REVIEWERS` in production) can open drafts.
