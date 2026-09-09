# Downloadable illustrations

The APK retains 12,218 bundled illustrations. The remaining 17,844 PNGs are served
as 53 immutable HTTPS packs from assets.hiraia.org/models/images. All card text
remains bundled. No model or peer discovery is required for image installation.

Build with `python3 packages/mobile/scripts/package-art.py`. Existing shard rows
are verified against source bytes before packaging. Output is in the ignored
packages/mobile/build/image-packs directory; the release manifest is committed at
packages/mobile/src/generated/imagePacks.generated.json. Generated filenames include
the complete MD5; SHA-256 is recorded and verified during publication. Do not edit
bytes under a published filename. Run the art partition builder first when artwork
changes, then rebuild packages and ship the resulting manifest in the APK.

Publish with `python3 packages/mobile/scripts/publish-image-packs.py --env-file /private/path/to/.env.cloudflare.local`
using a Python environment with boto3. This verifies every complete uploaded object's
SHA-256 and publishes a versioned index only after all objects pass.

The HIRAIMG1 format is 8 magic bytes, a 4-byte little-endian JSON-header length,
ASCII JSON metadata (Unicode slugs escaped), then concatenated original PNG bytes.
No decompression library or native module is added. Metadata and sizes are bounded;
output names are numeric rather than sourced paths. Each image crosses the bridge
individually (largest current image ~61 KB), with an event-loop yield between files.
The entire pack is verified using native streaming MD5 before extracting.

Settings offers translated download, pause, resume and retry controls. Downloading
is opt-in, discloses 323 MB and use of the current connection, and recommends Wi-Fi.
The choice persists, but transfers/installations run only while the app is foregrounded.
The student's grade is prioritized, followed by common and other-grade packs. Network
failures keep verified partial bytes for resume and back off between retries. The
existing telemetry downloader classifies .hpak transfers as images, not models.

Installed packs live under documents/image-packs/<digest>. Extraction occurs in an
isolated staging directory. A receipt and complete files are atomically promoted
together; the art registry is updated only after promotion. Restart recovery validates
all file sizes and rehydrates their URI mappings. Missing/corrupt receipts or missing
files trigger pack repair. Crash staging files and redundant downloaded packages are
cleaned up. Same-size post-install corruption is not rehashed on every launch.

Validation:
- `tsx --test packages/mobile/scripts/image-packs.test.mts`
- `node --test packages/mobile/scripts/image-installer.test.mjs`
- mobile TypeScript check and Android release build

Filesystem-backed installer tests cover failed writes without false completion,
offline restart hydration, missing-file repair, and foreground resume after cancellation.
These simulate the native interfaces; physical-device throughput/background behavior
still needs a smoke test with the built APK. Publication of packs does not update
already installed APKs: they need a build containing this installer and manifest.

## Automatic grade delivery (September 6 update)

Image downloads now default on (v2 preference), with pause/resume retained. Common
packs start when the app opens; the saved/selected grade's packs are added once
bootstrap and onboarding finish. Switching grades updates the queue. Images already
installed remain shared across profiles. Backgrounding pauses; foregrounding or retry
resumes. No install button is required.

The pack builder now groups each downloadable slug by the authored and curriculum-tagged grades of the cards that
use it. Multi-grade and unassigned illustrations go to common; single-grade images
have gN-all packs. This fixes missing images that the old primary-quarter grouping
placed under a different grade. The 33 immutable packages contain the same 17,844
images, with no duplicate slugs. Old CDN objects remain available for older APKs.

Version a74c195a0695586a: common 222.0 MB; common plus Grades 3–10 respectively:
233.3, 234.6, 239.1, 241.5, 236.6, 232.1, 231.4, 228.7 MB. Bundled art remains available
without any download. Coverage tests check all grade-authored cards against actual
pack headers. Settings uses the card font, ink colors, and gold bordered control.
