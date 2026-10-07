# Cebuano alignment with the audited full-year curriculum

7 October 2026. **Local integration and verification complete.** Native-language
certification, classroom validation and release remain separate work.

Worktree: `/Users/luis/Code/hiraia/build/cebuano-curriculum-alignment-20261007`.
Branch: `codex/cebuano-curriculum-alignment-20261007`, based on audited curriculum
commit `a2ce8367182c09055c2d5936418ad2c7212d70b0` from
`codex/apk-footprint-refactor`. The shared `hiraia-unified` checkout and its
completed Cebuano campaign were left untouched. Nothing was committed or deployed.

## Content carried and reviewed

The completed discovery-card audit contributed **3,986 exact approved edits** and
the all-language source-safety retirement of `dcard-09952`. All 66 approval files
retain their original bytes. Eighteen absolute approval references became
repository-relative; neither approvals nor before/after contexts changed.

The newer curriculum received a separate English-fidelity and lexical review:
**137 records, 836 English/Cebuano field pairs**, covering both handoffs' correction
overlays, 59 new teaching cards and changed questions on existing facts. All records
have saved substantive readings. **26 records changed across 47 Cebuano leaves;
111 records were kept.** English, Filipino, IDs, option order and answer keys were
preserved. Corrections include motion versus walking, reference-surface wording,
water displacement, soft clay, distinct speeds, physical space, repeated trials,
electrical exposure and omitted scientific limits. English science terms remain
valid classroom vocabulary.

Evidence: [review inventory](../tools/cebuano-curriculum-alignment/review-inventory-001.json),
[exact decisions](../tools/cebuano-curriculum-alignment/reviewed-edits-001.json),
[application proof](../tools/cebuano-curriculum-alignment/review-application-001.json).
The lexical addendum preserves rejected suspicions: `titip`, `similya`, `hulagway`,
`pilak` and other attested words were not replaced merely for sounding unfamiliar.
Dictionary and corpus excerpts are in the same directory's `evidence/` folder.

The historical three missing-judgment holds (`ffct-15686`, `ffct-24184`,
`ffct-24823`) and five invalid-evidence holds (`ffct-08459`, `ffct-09018`,
`ffct-10152`, `ffct-18958`, `ffct-34595`) remain exactly unchanged. This alignment
does not convert the old campaign's holds into approvals or claim new native review.

## Durable generation and assessment links

Regeneration now reapplies exact language approvals after science corrections and
presentation backfills. Changed English or emphasis invalidates an old approval.
Retirement is enforced before editorial assembly and before database replacement.
Downloadable art references remain available through their shard manifests; an
explicitly rejected image is not silently reassigned.

The audited branch's merged/editorial/art sources did not reproduce its published
pool. **17,315 source-field restorations** reconciled those inputs to the pinned
audited baseline. This was not a bulk translation rewrite: an isolated normal
generation had to equal the entire audited output plus the exact historical edits
and retirement before source files were changed. A second normal regeneration of
the final alignment reproduced its pool byte-for-byte. Original failures and the
one stale concise-editorial conflict are retained in the local evidence.

The changed card bodies also invalidated assessment source snapshots. **79 source
links across 77 items, plus two foundation items**, were individually compared with
their full questions, answer keys, claim limits and current source text. Source
snapshots, supporting excerpts and revisions were reconciled. Learner-facing
assessment content, review status and production status are unchanged.

One source link is explicitly held: `ha-g4-0010` cannot be unlocked by reading
`ffct-07430` alone. That card locates producers in an energy pyramid but does not
teach the question's grass/photosynthesis claim. Exact text equality cannot bypass
this semantic hold. The constructed exposure fixture drops that unsupported event;
the unchanged rotation requirements still pass. The question remains a draft.

All 33 authoring batches (638 items) and the 72-item foundation bundle validate.
The compiled bank contains **705 drafts and five excluded items**, with production
disabled. Native-language, teacher, student-pilot and cohort gates remain pending.
See [assessment decisions](../tools/cebuano-curriculum-alignment/assessment-link-decisions-001.json)
and [source validation](../tools/cebuano-curriculum-alignment/assessment-source-validation-001.json).

## Validation

The [final verification](../tools/cebuano-curriculum-alignment/final-verification-001.json)
compares the entire pool against the audited baseline and permitted changes, checks
every database card field, and reverses the new curriculum and assessment mutations
to prove unrelated fields unchanged. It also pins the regenerated outputs.

- 49,155 active database cards; retired ID absent from the pool/index/database and
  retained in Tala's append-only historical catalogue.
- 53,022 grounding rows and their ordinal/token indexes verified; 25,751 compiled
  card questions match the database.
- 322 competencies, 1,032 reviewed teaching slots and 1,280 selected cards preserved.
  English review lock, curriculum membership and source-PDF pins unchanged.
- All eight lesson compilers, assessment compiler, similarity file, Tala catalogue
  and public competency catalogue pass freshness checks.
- 92 curriculum, 84 assessment and three public-browser tests pass. Python checks
  pass: 47 original language/presentation/retirement guards, three pipeline
  integration cases, four English-review controls, six assessment-compiler cases
  and eight guarded-application cases. Foundation validation retains 27 negative
  controls.
- Mobile, desktop-renderer and web TypeScript checks pass; Git diff whitespace
  checks pass.

The first sweep exposed stale test assumptions and sparse-checkout omissions.
The curriculum test now checks nonrepetition within the current frozen lesson run;
the production planner already permits a reviewed anchor in multiple lessons.
The missing tracked voice/image metadata and Tala fixture were materialized.
Failed runs are retained with their diagnosis; only affected checks were repeated.

The G5 Term 1 week 11 and G6 Term 2 week 11 source gaps remain explicit. Practical
investigations, graphs, discussion and research still require teacher observation.

## Retrieval asset and release handoff

Two grounding-body changes required **two refreshed Cebuano vectors**. The exact
published audited baseline was verified first. LaBSE revision
`836121a0533e5664b21c7aacc5d22951f2b8b25b` ran locally from cache; 159,064 unaffected
vectors remained byte-identical, and nine unchanged controls passed.

| Asset | Value |
|---|---|
| New immutable filename | `vectors-labse-3a36094d18d2.i8.bin` |
| Bytes | 122,162,688 |
| SHA256 | `67912d4fd3270876ab2922316b20f8dad4109ac26eac2234cdb1728a6d59405b` |
| MD5 | `3d555f7450025a208ca65f2f02436759` |
| Database version | `a486f1a7be0c` |

The local canonical vector binary, metadata and `edition.ts` agree. A named copy
is retained under `build/cebuano-curriculum-alignment/release/` for publication.
**The new vector asset has not been uploaded.** Before distributing a build from
this branch, publish that exact immutable filename through the normal release
tool and verify read-back bytes; the new download URL must not be assumed live.
Do not restore the old filename or use old vectors with the changed bank.

No new provider inference, APK build, version bump, model training, native
certification, commit, upload or deployment occurred. The final completion receipt
and copied local execution logs live in
`tools/cebuano-curriculum-alignment/`.
