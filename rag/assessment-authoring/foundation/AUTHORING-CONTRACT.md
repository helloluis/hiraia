# Incoming Grade 3 foundation source format

Implementation contract, 29 September 2026. These are evaluation drafts, not a school readiness test. Existing Grade 3-material questions remain unchanged.

Each source file is `{ "schema_version": 1, "scope_id": "incoming-grade3-foundations-2016k-v1", "created_at": "<ISO timestamp>", "items": [...] }`.

Each item contains:

- `id`: `ha-f3-0001` through `ha-f3-0072`; `revision`: 1; `status`: `source_checked` or `hold`; `production_ready`: false.
- `domain`: existing uppercase domain key; `target_id`: `g3-foundation-<claim>`; `knowledge_claim`, `claim_limit`, `knowledge_family_id`. Semantically equivalent items share a family; no artificial distinctness to inflate coverage.
- `curriculum`: `{ "source_id": "deped-kindergarten-2016", "code": "<verbatim source code>", "page": <PDF 1-based>, "mapping_note": "<narrow supporting-knowledge mapping, not whole competency or individual coverage proof>" }`. Material grade is **0 (Kindergarten)**, separate from student grade3. Sources/cohort must not imply a verified complete Grade2Makabansa crosswalk.
- `source_cards`: array of `{ "card_id", "fact_id", "fact": {en,tl,bis}, "support": {en,tl,bis}, "reviewed_languages": ["en","tl","bis"] }`. Support is a literal excerpt from the current card text that supports this exact claim. Empty when the item is a directly checked diagram/observable foundation and no exact Hiraia teaching card was reviewed. Never fabricate a teaching link. Compiler verifies snapshots and produces hashes. Item may separately have `source_bank_fact_ids` and `external_references` for author-review provenance.
- `content`: `{ "stem": {en,tl,bis}, "options": [{id:"o1",text:{en,tl,bis}},...], "correct_option_id": "o1", "explanation": {en,tl,bis} }`. Exactly 3 distinct options per language. Read-aloud reads stem and every option. No unsupported observation or missing picture dependencies.
- Optional `content.diagram`: `{ "kind": "ball_box", "relation": "above" | "below" | "left" | "right" | "inside" | "on" }`. The deterministic offline picture shows a ball relative to a box; answer and translations must agree. Above has a clear gap, on touches top, below is beneath a raised box, inside visibly lies inside its open boundary. The question may ask where the ball is relative to the box, or explicitly reverse the reference and ask where the box is relative to the ball. The scene relation always encodes the ball relative to the box; inverse variants share the original knowledge family. Avoid simultaneously plausible on/above distractors. The image itself is pinned with the session. Do not add external images/URLs.
- `rationale`: `{ "correct": "...", "distractors": {"o2":"...","o3":"..."} }` keyed to actual answer IDs.
- `demand`: `{ "type":"recall", "reading_demand":"...", "image_required":false, "read_aloud":"..." }`; image_required true exactly when diagram exists.
- `review`: `{ "source_check":"...", "language_evidence":"<specific corpus/card checks, limits>", "holds":[], "native_speaker_review":null, "teacher_review":null, "student_pilot":null }`. Do not fabricate native/independent approval. Discovered defects go on hold pending correction.
- Diagram items also record `review.diagram_question_subject` (`ball` or `box`) and `review.diagram_answer_relation` (the relation the keyed option must describe). `content.diagram.relation` always describes the ball relative to the box; a reverse question must explicitly record the box as its subject and the inverse answer relation. These author annotations are checked against the picture relation and keyed English option; they do not replace independent meaning/language review. Avoid simultaneously plausible alternatives such as “on” and “above” for a touching scene.
- `benchmark_slot`: null or one of the six stable broad supporting-knowledge constructs below. Include at least six candidates per slot. These broad constructs are provisional; shared slot alone is not calibrated difficulty equivalence.

| Author | IDs | Domain | Benchmark slots |
|---|---|---|---|
| living/materials | 0001–0018 | LIVING_THINGS | `foundation-body-functions` (6+), `foundation-living-needs` (6+) |
| living/materials | 0019–0036 | MATTER | `foundation-object-properties` (6+) |
| movement/surroundings | 0037–0054 | FORCE_MOTION_ENERGY | `foundation-push-pull-motion` (6+), `foundation-relative-position` (6) |
| movement/surroundings | 0055–0072 | EARTH_SPACE | `foundation-weather` (6+) |

Recommend one baseline candidate for each benchmark slot plus six probes. Baseline must be 3/domain, with living covering body/animal/plant; matter property/change/safety; movement force/motion/position; surroundings weather/protection/care. Benchmark candidates can be meaningful parallel contexts of the same family, but a form may not contain duplicate families or overlapping source fact IDs. Root verifies actual 14-day rotation, not just pool size.
