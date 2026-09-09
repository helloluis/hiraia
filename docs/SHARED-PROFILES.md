# Shared student profiles

First launch (including the first upgrade to profiles) offers an optional first name,
a list of saved students, and Skip / Guest. Names are local labels only, limited to
40 characters with control characters removed. Creating the same name twice makes
two independent profiles; the picker adds profile numbers to distinguish them.
Returning students should select their existing profile.

The title bar shows the active name or Guest and a switch button. Selecting a
profile saves an atomic AsyncStorage record and restarts the JS runtime into the
language, grade and tutorial onboarding workflow. Pending telemetry writes are
awaited. The active identity remains unchanged until restart so old asynchronous
work cannot become the next student's activity. If restart fails, the saved choice
is retained and the screen offers a restart retry.

Each named profile gets its own hiraia-profile-<random ID>.db, including language,
grade, reading/quiz counters and card/competency seen history. Guest uses the original
hiraia.db, preserving existing progress. Bundled content, images, downloaded models
and the telemetry database remain shared. Switching never deletes another profile.
The profile catalogue is hiraia.student-profiles.v1 in AsyncStorage. Invalid or
unreadable storage fails visibly rather than silently replacing the catalogue.

Telemetry sends profile_kind=student and a random profile_id, or profile_kind=guest
without an ID. It never sends the first name. The collector rejects name fields.
Profile IDs survive switches and restarts but are not accounts or cross-device
identities. The dashboard counts distinct (installation_id, profile_id) pairs and
excludes shared Guest use. Its chart counts profiles by their first recorded event.

Dashboard labels are version-1 SHA-256-derived adjective-color-animal labels plus
a four-character suffix, incorporating both installation and profile IDs. The
vocabulary and algorithm are stable; names play no role. Raw IDs remain the actual
keys, so label collisions cannot merge data. Session lists show the friendly label.
Neon already mirrors event JSON, so the new anonymous fields need no mirror schema
change.

Local Activity filters by profile and grade at event time; quiz attempts retain the
identity and persona from first display. Historic rows with no profile are Guest.
Existing anonymous history is never reassigned when a student gives a name.
Local learning history has no automatic expiry (tested at 400 days); server raw
telemetry pruning is also disabled during the pilot. Clearing app data/uninstalling
removes local names, IDs and history. The offline upload queue remains bounded,
independently of retained on-device history.

Validation: mobile tsc, scripts/profiles.test.mjs, scripts/activity-details.test.mjs,
collector validation/hooks tests, dashboard profile/alias tests, and Chrome checks.
Offline Android 14 arm64 emulator smoke passed: optional first name, native restart,
English/Grade 5 onboarding, named title bar, Settings summary and Activity navigation,
Guest onboarding in Grade 4, and return to the named profile with Grade 5 and its
reading counter restored. Test app data was cleared before shutting down the disposable
emulator; no synthetic events were uploaded. Physical-device testing is still pending.

The emulator initially rejected the existing mandatory libOpenCL.so declaration.
Both prebuild paths now mark that vendor GPU loader optional. The corrected APK
installed and ran the curated feed on the emulator without OpenCL. This does not
establish local-model performance on low-memory devices.
