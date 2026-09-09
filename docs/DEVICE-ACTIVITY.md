# Device Activity

Settings retains its existing Last 24h / This Week / This Quarter table and links
to a dedicated Activity route. The summary's quarter remains a calendar quarter.

The detail page separates the selected grade at event time, with cards viewed,
distinct curated cards, dynamic cards, active days, quiz attempts, correct answers,
accuracy and last activity. It defaults to all retained history and the currently
selected grade, with other recorded grades available in the grade table.

Reporting dates (week, last 30 days, or inclusive local YYYY-MM-DD dates) are
independent of curriculum Q1–Q4. Curriculum semester groups mean Q1–Q2 and Q3–Q4;
they do not assume school-calendar boundaries. Use explicit school reporting dates
until the pilot's academic calendar is agreed.

Module coverage uses the selected grade's current installed curriculum outline and
card membership. It counts distinct curated cards viewed, with available cards as
the denominator. A card can serve multiple modules; module rows are not additive.
Quizzes include repeat attempts, so accuracy is practice accuracy, not mastery.
Dynamic and unmapped cards remain in grade totals. Reports now filter by local student profile. Guest combines unnamed use;
there are no inferred student identities or active-time estimates.

Local SQLite activity_details stores grade, language, profile ID and card identity alongside
existing activity event IDs. Quiz attempts freeze their persona at first display.
History is independent of upload acknowledgements and is no longer deleted after
100 days. The bounded telemetry delivery queue remains unchanged. No new server
fields or API deployment are required; these fields already exist in uploaded events.

Upgrade recovers metadata from any pending events once, without recounting them.
Acknowledged historic rows without metadata remain Unknown grade. Rows expired by
an older app cannot be recovered. Detailed tracking and refresh timestamps are
shown on the page. Clearing app data/uninstalling removes local history.

Validation:
- node --test packages/mobile/scripts/activity-details.test.mjs
- mobile tsc --noEmit
- existing pilot telemetry activity/repository regression suites

Native navigation and per-profile Grade 5 activity were verified in the offline Android 14
emulator using hiraia-shared-profiles.apk. The physical phone still has the earlier
image-installer APK until the shared-profile build is installed.
