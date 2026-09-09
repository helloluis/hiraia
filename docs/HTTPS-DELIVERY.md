# Pilot asset delivery

HTTPS is the canonical delivery route. Budget for every student downloading all
required assets from CDN/VPS; no peer seeding, discovery, or sharing is assumed.
Pear sharing is a separate future grant project.

The current production prefix is https://hiraia.org/models. Mobile builds may set
EXPO_PUBLIC_ASSETS_BASE_URL to a provisioned HTTPS CDN prefix. This is a build-time
setting, not remote configuration. Existing APKs keep their baked-in URLs, including
older hiraia.b11.dev URLs; preserve those routes during migration.

The optional generation assets currently total 1,774,001,024 bytes (~1.77 GB):
- hiraia-sft-2b-v2.Q4_K_M.gguf: 1,274,396,160 bytes
- labse.Q4_K_M.gguf: 383,762,048 bytes
- vectors-labse-af171fe8a9f9.i8.bin: 115,842,816 bytes

That is approximately 1.77 TB for 1,000 complete fresh installs, plus APK delivery,
retries and updates. Optional illustration packs add 323,225,817 bytes (~323 MB),
for 2,097,226,841 bytes (~2.10 GB) with all generation assets. The curated library
remains bundled and usable without these downloads. See [IMAGE-PACKS.md](IMAGE-PACKS.md).

The current downloader persists partial files, resumes via byte ranges, checks the
expected size and pinned streaming MD5, and atomically promotes verified files.
Moving the origin must not change bytes under an existing filename. SHA-256 records
are also maintained for release verification outside the phone.

Before CDN cutover:
1. Provision Cloudflare/R2 access and a production custom domain.
2. Upload exact versioned assets; compare full object sizes and hashes with release records.
3. Verify HTTPS HEAD and Range responses (206, exact Content-Range and bytes), including
   resume after interruption. Preserve content encoding and immutable cache headers.
4. Verify the signed APK artifact separately; preserve the existing landing-page
   download click tracking when changing its destination.
5. Test a fresh install and a resumed download on Android before publishing a new APK.
6. Keep old VPS URLs working until existing APKs have a tested migration route.

The Cloudflare R2 custom domain assets.hiraia.org is live. Legacy VPS URLs for the
three generation assets and existing APK redirect to it. Illustration packs are
published directly under its /models/images/ prefix; the new installer pins that
location. Older APKs need an update to use the illustration installer. Physical
Android download/resume validation remains required before a pilot APK release.

Publishing (2026-09-06 onward): R2 is the origin of truth and part of every release.
`deploy/publish-release-assets.py` uploads a signed APK as an immutable versioned key
(`models/hiraia-v<versionCode>.apk`) plus the `hiraia.apk` alias (4 h edge TTL, purged
when `CF_ZONE_ID`/`CF_API_TOKEN` are provided), and model/vector files as immutable
`models/<versioned filename>` objects; every upload is read back and re-hashed, then
HEAD-checked through assets.hiraia.org (exact bytes, `Accept-Ranges: bytes`). The
printed block goes into `packages/web/src/config/download.ts`, which feeds both the
landing page and `/api/app/manifest` (the in-app update check). Point `apk.url` at the
versioned key so an edge cache can never hand a phone the previous build. The VPS copies
under `/var/www/hiraia-models/` are legacy; the live nginx redirects are tracked verbatim
in `deploy/nginx/`.
