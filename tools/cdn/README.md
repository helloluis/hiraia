# HTTPS asset delivery — pilot R2 rollout

Bucket: `hiraia-assets` (Standard, APAC). Public custom domain: `assets.hiraia.org`.
Object prefix: `models/`. Files are copied from the existing published VPS release;
this rollout does not publish a newly built APK or retire previous releases.

`upload-pilot-assets.py` runs on the VPS with boto3 in a private virtualenv. It reads
only S3 credentials from `/opt/hiraia-r2-rollout/upload.env`, checks pinned sizes/MD5,
uploads bounded multipart chunks, then reads each complete R2 object and compares
SHA-256. It records non-secret metadata in `manifest.json` beside the script.
Remove the temporary credential file when upload and verification finish.

`cutover-pilot-assets.py` is a one-time, guarded rollout for the captured nginx
configuration. It verifies public HTTPS HEAD and byte-range responses, backs up
both existing Hiraia site files, installs temporary 307 redirects for exactly the
four migrated files, and validates both public legacy URL routes. On failure it
restores the original nginx files. Other files retain their existing VPS routes.
307 responses use no-store so rollback does not leave a permanent client redirect.

The cutover adds real-IP handling using Cloudflare's official IPv4 and IPv6 ranges;
only connections from those ranges may supply CF-Connecting-IP. This preserves
per-visitor telemetry rate limits with the website behind Cloudflare. Refresh the
trusted ranges when Cloudflare changes them. This is not an origin firewall lock.

Versioned model/vector objects have immutable one-year cache headers. `hiraia.apk`
is the existing mutable release alias and has a five-minute cache lifetime. Update
its R2 object as part of every future APK publication and verify SHA-256; updating
only the old VPS file will no longer update students' downloads after cutover.

Browser access to the public download URL requires no API credentials. None of the
Cloudflare/R2 credentials belong in app builds or committed files. The website's
existing download-click endpoint is preserved because its original destination URL
continues working via redirect.

Phone-side redirected resume still needs a physical Android check before the next
APK release. HTTP verification covers Range preservation and exact response bytes;
it does not establish every Android network stack's redirect behavior.

## Deployment status — 2026-09-06

All four objects (2,085,193,969 bytes) are uploaded and fully SHA-256 verified against
the VPS originals. The custom domain has active ownership and SSL. Public Python
HTTP requests return Cloudflare 403 / error 1010 (Browser Integrity Check).
No nginx cutover or real-IP configuration has been applied. Existing VPS routes
remain unchanged; root/www DNS was already proxied when this rollout started.

Automatic approval review rejected the proposed BIC-only native-route exception
and subsequent cutover pending explicit user authorization. Proposed scope: GET/HEAD
under /models/ on assets.hiraia.org, hiraia.org and www.hiraia.org; POST to the exact
/api/telemetry/batch path on root/www. No DDoS, managed-WAF or rate-limiting bypass
is proposed. Browser checks remain active on website/admin routes.

Temporary S3 credentials were removed from the VPS and temporary local file; the
original local .env.cloudflare.local remains private and Git-ignored. The file
pilot-assets-manifest.json records the uploaded bytes and hashes without secrets.

## Cutover completed — 2026-09-06 02:05 UTC

After explicit user approval, installed the narrow BIC-only exception described above.
Native GET/HEAD requests and telemetry POST now reach their intended handlers. A cache
bypass rule for only the four legacy root/www asset URLs prevents old cached files
from overriding the new redirects. No managed-WAF, rate-limit or DDoS bypass was added.

Nginx redirects are now live; both hiraia.org and hiraia.b11.dev passed redirected
byte-range checks for all four objects. Trusted Cloudflare real-IP configuration is
installed. Rollback: /opt/hiraia-r2-rollout/nginx-before-20260906T020528Z/ on the VPS.
Earlier post-reload checks raced nginx worker startup; a two-second readiness delay
resolved this. Those attempts restored original configuration automatically.

### Image/card content inventory correction

Unified's generated art-shard index defines 12,218 bundled images (139,978,122 bytes)
and 17,844 additional images (321,829,632 bytes) in 53 shard manifests. This rollout
has NOT packaged/uploaded those shards or implemented their mobile download/installer
path. The art presence hooks and manifest generator exist, but no caller of
hydrateDownloadedArt was found. The card-text SQLite database still imports as a
bundled APK asset. Do not describe image-shard delivery as deployed.

### Image packs published — 2026-09-06

The subsequent unified implementation packages all 17,844 additional images into
53 immutable .hpak objects (323,225,817 bytes), now published under
https://assets.hiraia.org/models/images/. Manifest version: 8e07d3449abfb571.
Every uploaded object passed full SHA-256 readback and public byte-range checks.
Unified now includes an opt-in Settings installer with verified extraction,
pause/resume, grade prioritization, and offline restart hydration. Existing APKs
need updating to use it. Card text and the original 12,218 images remain bundled.
See unified docs/IMAGE-PACKS.md for build, publication and recovery details.
