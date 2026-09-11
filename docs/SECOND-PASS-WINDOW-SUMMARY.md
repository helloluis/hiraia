# Second-pass recovery window summary

Final scheduled queue check: 2026-09-10 21:45 UTC (September 11, 05:45 Manila).
Authorized expiry remains 2026-09-10 21:57:55.518 UTC. This checkpoint does not extend the window or claim the remaining inventory is complete.

| Second-pass outcome | Facts |
|---|---:|
| Original inventory | 12,245 |
| Reviewed and integrated with validation | 7,725 |
| Recovered into core | 1,951 |
| Held | 5,774 |
| Remaining | 4,520 |
| Completed reviews pending integration | 0 |

Local partition: 3,737 validated, complete. External A: 2,836 validated, complete. External B: 2,836 remaining. External C: 1,152 validated and 1,684 remaining. External ownership is preserved; no duplicate assignments were created.

Across both passes, 17,157 facts have reviewed decisions, with 6,150 recoveries and 11,007 holds. Reachable facts increased from 20,186 to 26,336. All 70 required recovery/curriculum/calendar/quiz tests and mobile type-check passed at the last integration, with no previously reachable card IDs lost.

No new completed external review files were available at this final scheduled check. Remaining counts are not approvals, and future-dated original reviewer timestamps are preserved only as provenance, not trusted completion times. Parent verification timestamps and original-review backups document integrations. The previously incomplete gas-exchange placeholder was substantively reviewed and resolved.

No commits, builds, APKs, deployments or pushes were performed during this recovery window. To resume, retain the immutable inventory and partitions, inspect external B/C ownership and completion ledgers, and integrate new complete reviews only after the same verification and tests. Renewed authorization is needed to continue after the stated expiry.

Subsequent user-authorized consolidation is complete; see [final validated results](SECOND-PASS-CONSOLIDATION.md). This document retains the historical scheduled-window checkpoint.
