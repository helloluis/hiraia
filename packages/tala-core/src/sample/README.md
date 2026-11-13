# Shared sample class (PACE-11)

```ts
import { buildSampleClass } from '@hiraia/tala-core/sample';
const sample = buildSampleClass({ schoolYear, today, newId, lang });
```

The factory is pure: no I/O, current-clock lookup, random calls or platform APIs.
`today` is a Gregorian `YYYY-MM-DD`; `lang` is `en` or `fil`. `newId()` supplies
fresh IDs no longer than 57 characters (UUIDs work). The factory prefixes them
with `sample:` and rejects duplicates. Equal inputs and equal ID sequences yield
equal output.

The result contains `isSample`, `label`, `schoolYear` (a copy of the supplied
calendar), `classRecord`, `assignments`, `tracks`, `students`, `plans`, `sections`,
`calendarDays`, `competencies`, `records`, and `preview`.

- Grade 2 + Grade 4, six deliberately named Sample Learners; no real-person names.
- One shared Mathematics timetable following the school's teaching weekdays.
- A track per group for the current term, or the next term during a break; after
  the year, the last term is a completed-year preview. Accepted exact allocations
  start at the first available session on/after today. If no sessions remain, the
  last session is an example; this never changes the school's dates or calendar.
- Three complete multi-grade example plans, one locked using the normal helper.
  If fewer than three teaching sessions remain, extra examples are undated. Even
  a term with no teaching sessions produces three examples, including one locked.
- The sample's buffer and assessment reservations are zero so a short remaining
  term can still demonstrate a lesson. Normal teacher defaults are not changed.
- Bundled `fixture-demo-v1` Mathematics competencies keep the example usable
  offline. For terms 1–3 they match the server fixture packs exactly; arbitrary
  term structures get explicitly synthetic local competencies with the same
  fixture naming convention. Nothing is presented as official DepEd text.

`records` is a discriminated array of `{ entity, data, isSample: true }`, ordered
for persistence: class, assignment, tracks, students, sections, plans. Sections
precede the locked plan so its server snapshot contains them. Pass `entity` and
`data` to the sync engine; the wrapper flag is UI metadata, not a new synced field.
The class's persistent isSample flag, sample-prefixed IDs, labelled names/text and
class/plan links identify records whose schema has no isSample field. The supplied
school year is NOT a new sample record: persist it separately only if the caller
created it. This factory never replaces the teacher's profile or calendar.

Cache `competencies` locally along with the sample for offline timelines. They are
reference data, not synced records. Use `sample.classRecord.isSample` for the
persistent sample badge and community-post prohibition. Removal can use this
bundle's entity/id list, or follow the class/plan links after reloading. Remove
plan sections explicitly; deleting a plan does not cascade on the server.

The root namespace re-export is `sample`; `./sample` and the root export were
added by the orchestrator. Web/mobile should replace their local fixture builders
with this factory and own the confirmation, sync writes, caching and removal UI.
