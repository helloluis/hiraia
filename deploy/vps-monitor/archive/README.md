# Archived admin dashboard

`admin_app-2026-09-05.py` is an exact source snapshot of the working question-cards
admin dashboard before the pilot redesign, including its local training-monitor changes.
It is a reference snapshot; do not run it as a second service.

The committed training dashboard remains available, behind the existing login, at
`/admin/archive/training`. The previous telemetry report is at `/admin/archive/telemetry`.
The new default `/admin` dashboard does not poll training services or invoke their controls.
