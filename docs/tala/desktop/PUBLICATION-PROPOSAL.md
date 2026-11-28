# Proposal for the release owner — not deployed

Use the existing Tala download host for production, under a separate `/download/desktop/`
prefix. No new paid service or account. This needs Luis's storage/publication decision with
the complete verified candidate; it is not covered by demo.20 approval. Verified previews stay
in GitHub Actions artifacts (3 days, unlisted but accessible to signed-in GitHub users).

Layout under `/var/www/tala-download/desktop/`:

```
<release-tag>/<full-source-commit>/Tala-<version>-win-x64.exe
<release-tag>/<full-source-commit>/Tala-<version>-mac-arm64.dmg
<release-tag>/<full-source-commit>/Tala-<version>-mac-x64.dmg
<release-tag>/<full-source-commit>/desktop-release.json
desktop-latest.json
```

Release owner integration steps, after approval:

1. Add a restrictive nginx location for this prefix only (static files, no directory listing,
   no scripts, allowlisted installer/manifest filenames, nosniff, attachment disposition for
   installers). Immutable directories get a long cache lifetime; latest is no-cache.
2. Source the complete native artifact from the exact reviewed source commit. Run the
   candidate `packages/tala-desktop/scripts/stage-release.py stage <complete-artifact> <root>`.
   This validates three platforms, consistent source/version, hashes and sizes before an
   atomic rename into the immutable directory. An identical retry is accepted; differing
   bytes at an existing identity are refused.
3. Run `stage-release.py promote <immutable-dir> <root> --base-url <approved-HTTPS-prefix>
   --expected-latest-sha256 <previous-pointer-digest-or-absent>` only after native parity is
   accepted and Luis approves. It reads every installer and the immutable manifest over
   HTTPS, checks full byte digests, then locks/checks the reviewed previous pointer and
   atomically replaces the **single whole-set manifest**. No per-platform latest pointers.
4. The `/download` server component reads
   `path.join(TALA_DOWNLOAD_DIR, 'desktop', 'desktop-latest.json')` from disk at request
   time, just like the existing Android manifests. It validates
   status/schema, exactly Windows x64 + Mac arm64 + Mac x64, source/version agreement,
   positive safe byte counts, SHA256 strings, and HTTPS URLs restricted to the chosen
   production prefix. Invalid/incomplete data hides the entire desktop section; it must
   never show a partially updated platform set.
   `desktop-manifest-proposal.ts` supplies this parser; it returns null on any missing,
   duplicate, mismatched, dirty or incorrectly hosted artifact. Use the approved prefix
   explicitly. There is no SSR HTTPS self-fetch; HTTPS full-byte verification remains
   in the separate promotion operation. Before any promote, the owner must restrict
   the candidate to the exact release tag and source commit Luis approved. The parser
   accepts valid identity syntax; it does not grant permission to promote any preview.
5. `download-section-proposal.tsx` is the proposed small UI addition. Warnings/help
   precede download links, and the source commit has its own label. Existing Android
   links/content stay intact; when a valid desktop section is present, use the neutral
   `download.desktop.pageTitle` for the page h1. English keys are in
   `download-strings-en.json`; Filipino wording goes through the release owner's lane.
   All twelve Filipino lines are in `download-strings-fil.json`, copied unchanged
   from the Filipino owner's review relayed by release-owner bridges `7001b495` and
   `e7bed28b`. The English warning adopts their platform-scope clarification; no other
   existing English key changed. The page-title/source-label keys are additive.

The tag workflow already automatically builds all editions for relevant release tags.
It currently produces **artifacts only**. A separate release-owner promotion action can run
the approved commands above; no credentials or deployment access are added to public CI.
If a permanent automated promotion runner is desired later, agree its narrowly scoped
destination and authorization first. This document does not claim it exists.

Rollback uses the same promote command on the previous immutable directory, with the
current pointer's digest. Old artifacts stay intact. Failed builds, missing native evidence,
failed HTTPS reads and stale-pointer conflicts must leave the current release untouched.
The local publisher tests cover transaction failures with synthetic bytes. The stronger
actual-artifact exercise has now also passed using both verified native complete sets:
`tala-desktop-preview-3g` and `tala-desktop-preview-production-1`, both at `c8d99c048`.
The latter is a distinct real release tuple, not a relabelled fixture.

`test/verify-artifact-rollback.py` validated all six installers and read the actual
EXE/DMG and immutable-manifest bytes over loopback HTTPS. All five checks passed:
first complete promotion; failed Intel read-back (503) preserves latest; stale-pointer
rejection preserves latest; second complete promotion; whole-set rollback restores
the original pointer byte-for-byte. The report records 19 HTTPS requests.
Inputs remained read-only; all staging/latest changes used a temporary directory and
the ephemeral certificate was trusted only by that process. No production host,
public storage or system trust changed.

Evidence: [actual-artifact-rollback-20261128.json](evidence/actual-artifact-rollback-20261128.json).
This proves the local transaction with real installers. Externally verified GitHub
preview downloads are separate evidence in [CANDIDATE.md](CANDIDATE.md); an actual
production promotion/read-back still requires the release owner's window and approval.

Reproduce with two reviewed sets and a new report path:

```
python3 packages/tala-desktop/test/verify-artifact-rollback.py \
  /reviewed/first-complete-set /reviewed/second-complete-set /private/new-report.json
```

Release-owner integration review `0c071794768a41939d31a7c2166755b5` confirms the
existing host has sufficient storage and currently serves only allowlisted Android
files. Desktop URLs therefore do not exist yet. The owner will add strict immutable-file
and latest-manifest nginx locations, explicit content types, attachment disposition for
installers, nosniff, immutable/no-cache policies respectively, and no directory listing.
They will back up the site file, run nginx -t and deploy only in their approved window.
Promotion is a manual owner operation on that host with a recorded pointer backup;
there are no CI deployment credentials or automatic promoter.
