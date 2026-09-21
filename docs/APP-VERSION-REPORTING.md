# App and content versions

Hiraia Settings shows the installed **Hiraia version and Android build code**,
followed by the model download status and **Hiraiapedia v1.5**. Tala Settings shows
the installed **Tala version and Android build code**. Android PackageInfo is the
source for both apps; Hiraia uses Expo configuration only as a development fallback.
The displayed app versions change with the APK release configuration, not a second
hard-coded UI string.

Every newly recorded Hiraia telemetry event includes `app_version`, `build`,
`hiraiapedia_version` and `cards_db_version`. The database revision identifies the
bundled card content more precisely than its public Hiraiapedia version. Existing
queued events retain their original metadata when sent after an update.

The uploading app is identified separately in `reporter.version`: Hiraia reports
its installed version when uploading directly, and Tala reports its own installed
version when forwarding student activity. Tala preserves the student's original
app/content versions rather than replacing them with the teacher app's version.
Tala does not bundle Hiraiapedia and therefore has no Hiraiapedia version of its own.

The admin pilot dashboard shows Hiraia version/build and Hiraiapedia version in
each recent session, plus the Tala uploader version when applicable. Expanded
session details include the database revision; each event's delivery information
shows which app/version uploaded it. The telemetry summary also groups Hiraia
installations by content version. These are reported observations, not a live
inventory: offline phones and old APKs cannot supply fresh metadata. Missing
historical values display as not reported rather than being inferred.

## Rollout order

1. Deploy the telemetry collector's updated field allowlist and the admin Python/
   HTML files before distributing updated APKs. Rebuild the standalone collector
   with `tools/pilot-telemetry/build-server.sh` if that is the production intake.
   An older collector rejects events containing the new content-version fields.
2. Build and distribute Hiraia and Tala through their normal release workflows.
   An older Tala can relay app versions but strips the new content-version fields.
3. Open each updated app and allow activity to sync. Check the corresponding
   session and uploader version in the admin dashboard.

This change does not bump either APK release version or modify already installed
APKs. Hiraiapedia's public content version is now 1.5.
