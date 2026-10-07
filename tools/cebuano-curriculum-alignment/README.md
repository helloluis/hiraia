# Cebuano alignment with the audited curriculum

Work started 7 October 2026 on `codex/cebuano-curriculum-alignment-20261007`,
from audited curriculum commit `a2ce8367182c09055c2d5936418ad2c7212d70b0`.
Scope is local content integration and validation; no release or native-language
certification is implied.

The completed Cebuano discovery-card audit is historical evidence, not an approval
of the newer curriculum translations. `import-001.json` pins its final receipt,
3,986 approved edits, 66 unchanged approval files and the all-language retirement
of `dcard-09952`. Eighteen absolute review paths were made repository-relative;
approval bytes, before/after contexts and decisions are unchanged. The original
registry remains in `evidence/` for comparison.

The audited English/Filipino curriculum, competency memberships, scientific review
locks and source gaps remain authoritative. New or changed Cebuano curriculum
text is reviewed separately against that English and lexical evidence. Unresolved
items remain explicit holds. Existing missing/invalid-evidence holds are not
promoted to approvals.

Source baselines and execution logs are in the local, ignored
`build/cebuano-curriculum-alignment/` directory. The original completed audit and
the shared checkout are untouched. This branch carries the strict language and
retirement guards into source regeneration and database preflight.

Status: local alignment complete. All 3,986 historical approvals are carried;
137 curriculum records were separately reviewed, with 47 Cebuano leaves corrected
across 26 records. Source regeneration, database, assessment and curriculum checks
pass. See [the final handoff](../../docs/CEBUANO-CURRICULUM-ALIGNMENT-20261007.md),
`final-verification-001.json` and `completion-001.json`.

`evidence/executions/` retains actual local command exits and output hashes,
including failures. `check-failure-diagnosis-001.json` explains the test-fixture
and sparse-checkout repairs. The original 66 historical approval files are under
the repository-relative `tools/cebuano-readability/` paths pinned in the registry.

The changed retrieval asset is prepared locally and pinned in `edition.ts`, but
has not been published. Native/teacher/pilot review statuses and all explicit holds
remain intact. No provider inference or release action was performed.
