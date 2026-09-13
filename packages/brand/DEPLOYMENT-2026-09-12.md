# Brand release — 12 September 2026

Live: https://hiraia.org. Android release: 0.3.3, versionCode 6.

APK: https://assets.hiraia.org/models/hiraia-v6.apk

- Bytes: 311407922
- SHA-256: dd12320a4241b3d17b27b9d08ba6b682be62b2357e9bc5bce9fcafc07fc4053c
- MD5: 7c97762e3dcfb797391535ba014ed750
- Production signing certificate matched the existing pinned certificate.

Website deployment used the current VPS source plus targeted wordmark/favicon changes and release metadata. It preserved the server's existing telemetry and download changes; it did not deploy the unrelated local website edits. The staging production build passed TypeScript/lint and page generation. Homepage, FAQ, exact favicon bytes, public version-6 manifest, and partial APK downloads were verified after deployment. The live website was also checked in the browser.

VPS staging: `/root/hiraia-brand-release`. Deployment script and build/deployment logs remain there. Rollback: `/root/hiraia-brand-backup-20260912-v6` contains `source.tar.gz` and the previous `.next` directory under `next`. Restore those to `/root/hiraia/packages/web`, then restart only `hiraia-web`. The previous version-4 APK is retained. Old Next static chunks were retained to support already-open browser tabs.

The standard `deploy/update.sh` hard-resets to origin/main. This release was applied directly to the existing production checkout; carry the branding and release metadata into main before using that reset-based deployment again.

Android: Metro 8.156 seconds, Gradle 2m33s (excluding preflight). The signed APK passed exact inventory/hash checks for all 12,373 illustrations, which also matched the previous signed APK. The emulator's existing debug-signed app was updated using the same release build before production signing; the production-signed artifact was independently signature-verified. Native seed/page growth and the updated feed wordmark rendered; no app runtime errors were observed. No USB phone was connected.

Cloud inventory comparison across all 131 pre-existing objects found changes only to `models/hiraia.apk`, plus the new `models/hiraia-v6.apk`. Models, vectors, and all image packs were unchanged. Uploads were downloaded back and SHA-256 verified. Public HEAD and range reads passed. The alias cache-purge API returned 401; its public HEAD already showed the new bytes from the tested edge. Old alias cache entries elsewhere can expire over four hours; the website and app manifest use the immutable version-6 URL and avoid that alias cache.
