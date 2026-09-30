# Assessment target catalogue history

Each immutable `<registry-input-hash>.tsv` preserves the exact target labels from
that compiled student registry. The original 28 September catalogue was verified
against its captured registry before being archived byte for byte.

The Tala catalogue generator adds a snapshot for a new registry, refuses to
replace an existing snapshot, and packages every recorded map into a versioned
asset. `--check` is read-only. Old target IDs are resolved using the result's own
bank hash; matching a newer ID does not establish that the old claim was identical.

These files contain curriculum labels and narrow claims, never student records.
Do not delete old snapshots when retiring questions or adding another grade.
