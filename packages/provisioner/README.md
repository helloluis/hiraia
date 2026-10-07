# Hiraia Provisioner

Turns a factory-reset donated phone into a Hiraia learning device with one QR scan. Built for
the JamboPhone JP1 (Android 13); spec: `Hiraia_JP1_Provisioning_Spec.txt`.

Two pieces:

- **`android/`: Hiraia Setup**, a device policy controller (DPC). Android's setup downloads it
  from the QR code and makes it the phone's **device owner**, which lets it install and remove
  apps, grant permissions and read hardware IDs with nobody tapping through prompts.
- **`server/`: the provisioning server**, run on the operator's laptop. It shows the QR code,
  serves the DPC, gives each phone the next Hiraia ID (`HI2609-201`, `-202`, …), keeps the
  inventory in SQLite with a live dashboard and a CSV export, and offers DPC updates. It also
  offers the Hiraia APK, and mirrors Hiraia's downloads so that phones fetch them from the laptop
  rather than the internet.

## Status: milestones 1 and 2

The phone:
1. Scans the QR code and joins the Wi-Fi named in it (`--wifi-ssid`), with nobody typing.
2. Installs the DPC and becomes device owner.
3. Registers with the laptop and gets its ID, which it shows on the lock screen.
4. Updates the DPC first, if the server offers a newer one.
5. Downloads Hiraia from the laptop and installs it without prompts, if the server offers it.
6. Grants Hiraia every runtime permission it asks for, so no camera, Nearby or location prompt
   interrupts a student later.
7. Hands Hiraia the laptop's mirror address.
8. Removes or hides the preloaded apps (`PackagePolicy.kt`), makes its own tidy grid the home
   screen with Hiraia first, sets the wallpaper and a ten-minute screen timeout once (a student
   may change either), and turns on Bluetooth and location for Nearby classes.
9. Reports that it is done.

After that it checks in every two hours while the server is reachable. It installs a newer DPC,
or a newer Hiraia, when one is on offer, and applies the package policy again even when the
server cannot be reached.

### Updating the existing fleet to 0.4.40

Keep the existing `~/.hiraia/provisioning` directory and the sibling
`~/.hiraia/provisioning.issued.log`. The registered phones pin its TLS public key;
starting a replacement identity would strand them. Do not reset phones or use
`--new-identity` for an ordinary Hiraia upgrade. A changed laptop IP is handled by
mDNS discovery, provided phones and laptop share a network that permits multicast.

Hiraia Setup 0.4.3 installs a newer, correctly signed `com.hiraia.app` APK over its
pinned local API. This works independently of an installed Hiraia 0.4.24's updater.
It preserves app data and phone registration. Existing periodic jobs survive reboot;
there is no immediate boot-triggered check-in in that DPC version. Leave the phones
on the provisioning Wi-Fi for the next check-in (normally within the two-hour
schedule, subject to Android scheduling). The Setup screen's **Check for an update** action
is available for an individual phone that needs an immediate check.

Serve Hiraia Setup **0.4.4 (9)** with `--min-dpc-version-for-hiraia 9`. Older Setup
builds first receive that small update with the existing signing key, then check in
again for Hiraia. Setup 0.4.4 checks in immediately after boot and retries interrupted
or busy-server transfers through JobScheduler. A 15-minute retry window lets Wi-Fi
come up; when the laptop stays unreachable, the phone returns to its normal two-hour
schedule. The first contact from an existing 0.4.3 phone still follows its old schedule.

Start with a verified signed APK and a complete mirror. The server checks APK signing
identity, model/voice sizes and hashes, and image
pack pins before offering anything. `--require-complete-mirror` makes missing or
corrupt required content a startup failure instead of quietly falling back to the
internet. Add `--with-llm` when serving phones with enough memory for the tutor model.
The 98 JP1 registrations inspected on 7 October 2026 have 3.67 GiB RAM and do not
require that model.

```sh
uv run --script --locked packages/provisioner/server/server.py --sync-mirror
uv run --script --locked packages/provisioner/server/server.py \
  --dpc-apk ~/.hiraia/builds/hiraia-setup-0.4.4.apk \
  --hiraia-apk /path/to/verified/hiraia-v0p4p40.apk \
  --require-complete-mirror --min-dpc-version-for-hiraia 9
```

An unpublished, newly generated asset must first be copied from the verified build
into `~/.hiraia/mirror/models/` under its exact pinned filename; a mirror sync cannot
download a file that has not been published. Keep the laptop awake and on the same
Wi-Fi. The dashboard is local to the laptop at `http://127.0.0.1:8080/`; it is not an
Internet service. Hiraia downloads its content after it is opened, so an installed
APK alone does not mean its optional images and voice have finished downloading.

**Hiraia's content (about 0.9 GB) is not part of provisioning.** Hiraia fetches it itself, and
only once it has been opened: the LaBSE embedder and search vectors, then the illustration packs,
while Hiraia is on screen. It asks the laptop's mirror first and falls back to
`assets.hiraia.org` when the mirror is missing a file or does not answer, so a phone that leaves
the warehouse without its content finishes on any Wi-Fi. Every byte is checked against the size
and MD5 built into Hiraia either way. The dashboard's Content column shows what each phone has
fetched from the mirror; content fetched from the internet does not appear there.

| | |
|---|---|
| DPC 0.4.3: package policy, home grid, wallpaper, radios, screen timeout; 22 JVM tests | done |
| Server: IDs, inventory, dashboard, CSV, QR, pinned TLS, mDNS, DPC updates; 62 tests, 19/19 mutants caught | done |
| Server: Hiraia APK offer, content mirror and its sync; 113 tests, 17/17 new mutants caught, 13/13 more in review | done |
| Hiraia 0.4.25: mirror-first downloads with fallback to the internet; 15 tests, 8/8 mutants caught | done |
| Hiraia 0.4.26: LaBSE fetched from launch and retried until it lands, image packs rest through an outage, both resume when a network returns | done |
| Adversarial reviews: four rounds (22, 13, 12, then 7 low findings), all addressed or accepted below; one of the mirror (7 findings, all fixed) | done |
| Device owner, registration, check-ins, mDNS rediscovery and recovery, on a real JP1 over adb | **passed** |
| Emulator rehearsal: a re-signed fake Hiraia was downloaded and **refused**; the genuine one was downloaded, installed silently, all 10 permissions granted, mirror address set | **passed** |
| QR provisioning on a factory-reset JP1 (DPC 0.4.2, HI2609-201, registered to complete in 65 s) | **passed** |
| Emulator, Hiraia 0.4.26 with a dead mirror: LaBSE from the internet with no taps, network cut at 358/384 MB, resumed from 358 MB 9 s after Wi-Fi returned, MD5 verified | **passed** |

## The JP1

Measured on the first unit (`devices/jp1-packages.tsv`):

- **Hardware:** Unisoc T606, 3.67 GiB RAM, 50 GB user storage, **no NFC**, Android 13 with
  Google Mobile Services.
- **Hiraia's features:** its memory policy (`packages/mobile/src/engine/memoryPolicy.ts`) will
  **not run or download the tutor LLM** on this phone, which needs 5.5 GiB. Semantic search,
  cards, quizzes and images all run, and the phone does not report itself as low-RAM.
- **Preloaded apps:** the 13 crypto, shopping, social and game apps are *user* installs copied
  from `/system/preloadapp/`. A device owner can uninstall them outright, though a factory reset
  brings them back. `com.jambo` is a system app and can only be hidden. The other 220 system
  packages include the Google apps.

## Build the DPC

```sh
cd packages/provisioner/android
JAVA_HOME=/opt/homebrew/opt/openjdk@17 ANDROID_HOME=~/Library/Android/sdk ./gradlew assembleRelease
```

Raise `versionCode` in `app/build.gradle` for every build meant for phones. Phones on the
provisioning Wi-Fi install a higher version at their next check-in.

**Back up the release key.** It lives at `~/.hiraia/provisioner-keys/`, outside the repo, as
`provisioner.jks` plus `keystore.properties`, which holds its password. Android only accepts a
DPC update signed with the same key, so losing it means factory-resetting every phone to move it
to a new one. The build refuses to run without it. Its certificate SHA-256 is
`32:1A:AD:0A:…:4F:ED`.

## Run the server

```sh
HIRAIA_WIFI_PASSWORD='…' uv run packages/provisioner/server/server.py --wifi-ssid 'Army House'
```

Open <http://127.0.0.1:8080/qr> on the laptop. Then, on each factory-reset phone:
1. Tap the welcome screen six times.
2. Scan the code.
3. Accept the "this device belongs to your organization" screen. That is the one tap setup
   insists on.

The rest runs by itself. The lock screen shows `Hiraia HI2609-2xx · setting up`, then
`Hiraia HI2609-2xx` when done, or `· setup stopped` if something failed. The dashboard shows
the same.

- **Wi-Fi:** use a WPA2 or WPA2/WPA3-transition network. Android setup has no WPA3-only option.
  Pass `--offline` if the network has no internet; Android 13 otherwise wants it during setup.
- **`http://<laptop>:8080/provisioner.apk`** and the content mirror below are the only things
  served in the clear. The QR code carries the APK's SHA-256, and setup refuses anything else.
- **The dashboard, QR code and CSV** are served only to the laptop itself, at a loopback address.
  The QR code holds the Wi-Fi password and the registration token, so don't photograph or share
  it.
- **`https://<laptop>:8443/api/*`** is what phones call.
  - The certificate is self-signed. The QR code carries the SHA-256 of its public key, and that
    key is the server's identity.
  - The address is only a hint. The server announces `_hiraia-prov._tcp` over mDNS, and a phone
    that cannot reach its stored address looks the server up and trusts whichever address proves
    it holds the key.
  - Each phone gets its own secret when it registers. The QR code's token only lets a phone
    register.
- **Keep and back up `~/.hiraia/provisioning/`.** It is the server's identity and its record:
  - `tls-key.pem`: phones pin its public key. The certificate can be re-issued from it.
  - `token`: the registration token.
  - `receipt-key`: signs the receipt each phone gets for its ID.
  - `provisioning.db`: the phones and their inventory.
  - `issued.log`: every number ever handed out.
- **Leave `~/.hiraia/provisioning.issued.log` alone.** It sits *beside* the directory (in
  general `<parent of the data dir>/<its name>.issued.log`, so that parent must be writable; the
  server checks at startup). A restore of the directory should not touch it. It mirrors every number handed out, so a restored
  directory can never give a new phone a number a returning phone already wears. If the whole disk
  is lost, restore the directory and start with `--first` above the highest number on the
  stickers.
- **Missing identity files stop the server** once any phone is registered, rather than letting it
  silently make new ones no phone would trust. Each has its own way out:
  - `--new-token`: e.g. after a photo of the QR code got out. The old token is kept aside as
    `token.replaced-<time>`. Registered phones keep working and re-register with their receipts if
    they ever must. Phones scanned but not yet registered have to be scanned again.
  - `--new-receipt-key`: only for a key that is *lost*. It refuses to replace one that is there.
    Phones then keep their IDs only by serial number.
  - `--new-identity`: replaces all three, keeping the old files aside as `*.replaced-<time>`.
    Every phone provisioned so far has to be factory-reset and scanned again.
- **A phone keeps its ID.**
  - The server keys on the serial number, so re-provisioning a phone gives it back its number.
  - Every phone also holds a signed receipt for its ID. After a restore, returning phones show
    their receipts and get their numbers back. If that ever fails, the dashboard and terminal say
    `DUPLICATE ID`.
  - IMEIs only accumulate. A phone reporting a known serial with different IMEIs is refused (409),
    shown as `CONFLICT` on that serial's row, and logged. Resolving that is manual for now: two
    units sharing a serial has not been seen, and the serials of a JP1 batch should be checked
    once.
- **Numbering:** `--prefix HI2609 --first 201`.
- **If the laptop's address changes mid-session** (a new DHCP lease), the server moves with it:
  - The QR page shows a new code within 15 seconds.
  - The mDNS announcement switches to the new address, so phones already scanned find it.
  - A phone that was still downloading Hiraia Setup from the old code has to be scanned again.
  - If the first address comes back, it moves back.

  It never moves onto an interface that was already there, such as a tether, a VPN or Ethernet
  that took the default route, not even while the provisioning Wi-Fi blinks. With `--host`, it only
  warns: you chose the address, so you restart it with a new one.
- **The terminal logs what the dashboard cannot show:**
  - Registrations refused for a wrong token, e.g. a QR code from before `--new-token`.
  - Phones that reject this server's key, e.g. a QR code made by a different data directory.

  Control characters from phones are escaped, so nothing can rewrite the terminal.
- **What the QR code's token protects, and what it does not.** The token and the Wi-Fi password
  are in the QR code, so anyone with a photo of it, on that Wi-Fi, can register fake phones.
  Knowing a phone's serial (from its box, say), they can also re-register it and overwrite its
  inventory row. The real phone recovers at its next check-in, and its IMEIs cannot be erased.
  **Phones never take instructions from anything but the server's pinned key,** so the damage is
  confined to the dashboard and the CSV.

  If a photo gets out:
  - `--new-token` stops any *new* registration with it, and change the Wi-Fi password.
  - Serials the photo-holder already re-registered stay writable by them, because the receipt they
    were handed is exactly what the real phone holds and no server rule can tell the two apart.
    Evicting them completely also takes `--new-receipt-key`, after moving the old key aside. That
    costs the real phones their receipt-based recovery after a database restore.

### Hiraia and its content

With `--hiraia-apk`, phones also install Hiraia. With a synced mirror, they then download its
content from the laptop: the LaBSE embedder, the search vectors and the illustration packs, about
0.9 GB per phone.

```sh
uv run packages/provisioner/server/server.py --sync-mirror
uv run packages/provisioner/server/server.py --wifi-ssid 'Army House' \
  --hiraia-apk ~/.hiraia/builds/hiraia-v0p4p26.apk --dpc-apk ~/.hiraia/builds/hiraia-setup-0.4.3.apk
```

- **`--sync-mirror`** downloads what the mirror lacks from `https://assets.hiraia.org/models/`
  into `--mirror-dir` (default `~/.hiraia/mirror`), then exits.
  - The files, and each one's size and MD5, come from the repo, the same tables Hiraia is built
    from: `packages/mobile/src/config/modelAssets.json` (also imported by the app's edition),
    `src/generated/imagePacks.generated.json`, and the image packs in the web catalog,
    `packages/web/src/config/asset-updates.json`, plus downloadable voices from
    `packages/mobile/assets/voices/catalog.json`.
  - A download resumes from its `.part` file, and is checked before it is renamed into place.
    Files already there are hashed, not fetched, so it can be run again at any time. Run it
    again after any of those tables changes.
  - `--with-llm` adds the 1.27 GB tutor model. Only 6 GB+ phones run it, and the JP1 is not one.
- **Restart the server after a sync.** At startup it hashes the mirror against the same tables,
  which takes a few seconds, and serves only the files that match, at
  `http://<laptop>:8080/mirror/models/…`. It logs any file that does not match, and never serves
  it. Register and check-in replies give phones that address, and it follows the laptop if its
  address changes. Hiraia only accepts a mirror at a private IPv4 address; the server warns if
  its address is not one.
- **`--hiraia-apk`** takes the APK that `packages/mobile/scripts/sign-apk.sh` makes
  (`hiraia-v*.apk`). Gradle's own `app-release.apk` is debug-signed and is refused.
  - The server will not start unless the APK is `com.hiraia.app`, and every signature it carries
    (v2, v3 and v3.1) names Hiraia's release key (certificate SHA-256 `40d750d5…0c35`).
  - It copies the APK into `<mirror-dir>/apk/`, named by its SHA-256, so a rebuild mid-session
    changes nothing on offer.
  - Phones download it over the pinned API, `--max-apk-downloads` (default 8) at a time. The
    rest are told to retry in 30 seconds.
  - The dashboard shows the version on offer, the mirror's size, and each phone's install
    progress as `INSTALLING`.
- **The mirror is a delivery truck, not an authority.** It is plain HTTP, and anyone on the
  Wi-Fi can reach it, or pretend to be it.
  - Nothing it sends is believed. Hiraia checks every byte against the sizes and MD5s built into
    its own APK, and discards anything else.
  - Hiraia takes the mirror's address only from its managed configuration, which only the DPC,
    as device owner, can set.
  - The Hiraia APK itself never comes from the mirror. It comes over the pinned API, with its
    SHA-256 from that same API. Hiraia Setup installs it only if it is that exact file, is
    `com.hiraia.app` at the version offered, and is signed with Hiraia's release key, which is
    fixed in Hiraia Setup itself and never taken from the server.

  So a fake mirror, or a tampered mirror directory, can make downloads slow or fail. It cannot
  get a single byte of its own onto a phone.

## Develop without a factory reset

A debug build is `testOnly`, which lets adb make it device owner and take that back again. This
works on a phone with **no accounts** on it:

```sh
adb install -t app/build/outputs/apk/debug/app-debug.apk
adb shell dpm set-device-owner com.hiraia.provisioner/.AdminReceiver
adb shell am broadcast -n com.hiraia.provisioner/.DebugConfigReceiver --es server … --es pin … --es token …
adb shell dpm remove-active-admin com.hiraia.provisioner/.AdminReceiver   # undo
```

The server's `/qr` page prints the exact `am broadcast` line, which stands in for the QR code.
Setup's QR flow refuses a `testOnly` APK, so the server refuses to serve a debug-signed one.

## Tests

```sh
JAVA_HOME=/opt/homebrew/opt/openjdk@17 uv run --with segno --with zeroconf \
  python -m unittest packages/provisioner/server/test_server.py
cd packages/provisioner/android && JAVA_HOME=/opt/homebrew/opt/openjdk@17 \
  ANDROID_HOME=~/Library/Android/sdk ./gradlew lintRelease
```

## Persistent Mac service

`server/install_service.py` copies the tested server, its dependency lock, asset
inventories and signed APKs into a versioned directory under
`~/.hiraia/provisioner/releases/`. It verifies the complete mirror and preserves
`~/.hiraia/provisioning` unchanged. Editing or switching a source checkout then has
no effect on the server already serving phones.

Stage a candidate without serving it:

```sh
python3 packages/provisioner/server/install_service.py \
  --pair build/app-releases/<build>/release.json \
  --dpc-apk packages/provisioner/android/app/build/outputs/apk/release/app-release.apk
```

After the required Windows build and packaged exam/voice/CPU checks finish from the
same commit, use that CI build's paired APK directory and combined manifest:

```sh
python3 packages/provisioner/server/install_service.py \
  --pair /path/to/ci-android-chromeos/release.json \
  --dpc-apk packages/provisioner/android/app/build/outputs/apk/release/app-release.apk \
  --all-platforms /path/to/complete-three-platform-manifest.json --activate
```

Activation refuses missing Windows evidence or different APK bytes. It installs
`~/Library/LaunchAgents/com.hiraia.provisioner.plist`, starts at login, restarts after
an unexpected exit, and keeps the Mac awake while serving. Dependencies are locked
and cached; startup needs no Internet. Logs are private to the operator under
`~/.hiraia/provisioner/logs/`. Open <http://127.0.0.1:8080/> on the Mac for status.
The phones must share its Wi-Fi network, with multicast and client-to-client access
allowed. No factory reset or new QR enrollment is needed for registered phones.

```sh
launchctl print gui/$(id -u)/com.hiraia.provisioner
launchctl bootout gui/$(id -u)/com.hiraia.provisioner  # stop serving
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.hiraia.provisioner.plist
```

After a reboot of the **Mac**, log in to start its user LaunchAgent. Closing the lid
can still put the Mac to sleep; keep it open, powered and on Wi-Fi while updating
phones. A healthy server does not make an offline phone reachable: Setup 0.4.3's
first contact can take up to its normal two-hour interval. Once it receives 0.4.4,
subsequent phone boots request a check-in immediately, subject to Android scheduling.
