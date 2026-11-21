# Dev Diary: Siay entry title correction — origin activation record

Published 2026-11-21 11:45 UTC on b11-apps under `ovh-hiraia-web.service`, holding b11-dev's
`hiraia.lock`. The 6 Nov 2026 entry title changed to "Fifth pilot launched at Siay National High
School, Zamboanga Sibugay". The photo, date and caption are unchanged, and no public files changed.
Base build `g_dqKl1Y4beKguRcfjsju` → `8wtgwenq9epb0-CTfsuS3`. The Android manifest was verified
unchanged; old hashed assets are retained.

Rollback, with `hiraia.lock` held, on b11-apps:
`python3 /root/devdiary-siay-title-20261121/activate.py rollback` (it restores the prior title
build). The backup is at `/var/backups/hiraia-publications/devdiary-siay-title-20261121`.
