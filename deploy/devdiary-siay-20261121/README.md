# Dev Diary: Siay National High School (6 Nov 2026) — origin activation record

Published 2026-11-21 11:23 UTC on b11-apps under `ovh-hiraia-web.service`, holding b11-dev's
`hiraia.lock`. Base: the live code53 web build `tP_ccIaUbEKyvK7FgFPzz` (source `929a8956a` +
the live platform catalogs). Only `src/components/DevDiary.tsx` changed and one public file was
added (`public/dev-diary/siay-nhs-phones.jpg`, sha256 `4d32d1a1…0472`). New build
`g_dqKl1Y4beKguRcfjsju`; the Android manifest was verified unchanged; old hashed assets are retained.

`stage.sh` built it in `/var/tmp/hiraia-devdiary-siay-20261121`, keeping the live donation widget.
`activate.py check|execute` ran the migration guard and hash checks before swapping.
Rollback, with `hiraia.lock` held, on b11-apps:
`python3 /root/devdiary-siay-20261121/activate.py rollback`. The backup is at
`/var/backups/hiraia-publications/devdiary-siay-20261121`.
