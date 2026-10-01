# Shared exam release — 1 October 2026

The 12-question exam is part of Hiraia on Android, ChromeOS and Windows. The earlier
exam work was committed only to a separate OTA test branch (`9ed8eb675`) and was absent
from the canonical three-edition source. This release merges that source and its
question-bank provenance into the shared release branch instead of maintaining another
edition-specific copy. It preserves the bank's pending teacher/language review labels
and all five held questions; inclusion in the app does not promote draft content.

Target release: Android/ChromeOS 0.4.28 (28), Windows 0.4.28-preview.1. Native release
measurements and publication evidence will be recorded after the packages pass.

Windows now honors isolated SQLite connections and closes only the report reader.
This prevents reading exam history from applying `query_only` to a child's progress
writer. Tests use actual SQLite to verify continued writes and separate profiles.

The shared model-free suite passes 108 exam, reporting and reader cases. The desktop
host suite passes eight storage/download cases. Desktop renderer testing completes
all twelve questions offline, resumes the exact attempt after a process restart,
checks the result and history, and verifies keyboard input and reachable options at
200% zoom and in a 900 × 600 window. Native Windows and both signed APKs still require
their release checks before publication. Windows screenshots will come from the
packaged Windows run, not from a mockup or another platform.

The formal model gate passed all 45 cases and all 185 sampled answers on 1 October
2026. Server ingestion and repository tests pass, including privacy validation,
deduplication and direct/Tala replay; the standalone collector already supports
assessment summaries. The release pipeline repeats the model gate, verifies the
compiled question bank, and requires packaged Windows exam evidence before accepting
the combined three-edition artifact manifest.
