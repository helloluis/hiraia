# Proposal for the release owner — not deployed

Use the existing Tala download host for production, under a separate `/download/desktop/`
prefix. No new paid service or account. This needs Luis's storage/publication decision with
the complete verified candidate; it is not covered by demo.20 approval. Preview-1 stays
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
4. The `/download` server component reads this latest manifest at request time, validates
   status/schema, exactly Windows x64 + Mac arm64 + Mac x64, source/version agreement,
   positive safe byte counts, SHA256 strings, and HTTPS URLs restricted to the chosen
   production prefix. Invalid/incomplete data hides the entire desktop section; it must
   never show a partially updated platform set.
   `desktop-manifest-proposal.ts` supplies this parser; it returns null on any missing,
   duplicate, mismatched, dirty or incorrectly hosted artifact. Use the approved prefix
   explicitly, and fetch only its `desktop-latest.json` with redirects disabled.
5. `download-section-proposal.tsx` is the proposed small UI addition. Existing Android
   content is unchanged. English keys are in `download-strings-en.json`; Filipino wording
   must go through the release owner's Filipino lane before integration.

The tag workflow already automatically builds all editions for relevant release tags.
It currently produces **artifacts only**. A separate release-owner promotion action can run
the approved commands above; no credentials or deployment access are added to public CI.
If a permanent automated promotion runner is desired later, agree its narrowly scoped
destination and authorization first. This document does not claim it exists.

Rollback uses the same promote command on the previous immutable directory, with the
current pointer's digest. Old artifacts stay intact. Failed builds, missing native evidence,
failed HTTPS reads and stale-pointer conflicts must leave the current release untouched.
The local publisher tests execute those transaction/rollback paths with synthetic bytes,
including real loopback HTTPS with an ephemeral certificate trusted only by that test
process. A deliberately failed DMG read-back (HTTP 503) leaves latest byte-identical;
promotion of a second complete set and rollback restore the first whole-set pointer.
This is a transaction fixture, not a production deployment or an installer-artifact
publication exercise. The latter waits for native complete sets and the approved host.

`test/verify-artifact-rollback.py` prepares the next, stronger local check with **two
actual complete installer sets** from reviewed native runs. It validates every artifact
hash/size, requires distinct source/tag identities and rejects the text files used by
unit fixtures. Inputs stay read-only; staging and latest changes are confined to a new
temporary directory. It reads the actual EXE/DMG bytes over loopback HTTPS, fails one
Mac read-back with 503, rejects a stale expected pointer, promotes the second complete
set and rolls back to the first pointer byte-for-byte. Its temporary certificate is
trusted only by that process. No host, public storage or system trust changes occur.

```
python3 packages/tala-desktop/test/verify-artifact-rollback.py \
  /reviewed/first-complete-set /reviewed/second-complete-set /private/new-report.json
```

This driver is prepared but has **not run with actual installers**: no complete set has
passed yet. Its eventual result must remain separate from externally verified preview
downloads and any release-owner-approved production promotion.
