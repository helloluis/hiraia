Title-card curriculum metadata mirrors the authored Android lesson groups. Regenerate it after changing the demo packs or lesson manifests:

    python3 packages/web/scripts/sync-demo-title-topics.py /path/to/hiraia-unified

This writes `src/data/demo-title-topics.json`. It retains only demo card IDs, matching reviewed lesson membership first and the demo's competency tags second. Illustrations are resolved from the existing demo art inventory at runtime. No new image processing, cloud writes, model files, or illustration-pack manifests are involved.

The native title card uses its active curriculum cursor. The demo uses the corresponding grade and lesson metadata. Intro pages have their own page identity and history entry; continuing reveals the already selected fact. They do not call normal-card advancement or review observation. Five ordinary cards follow an introduction before a quiz can be offered. Revisiting an intro through history does not reset that interval.
