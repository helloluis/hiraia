# ChromeOS Android / x86 QVAC smoke test

The signed ChromeOS preview APK contains ARM64 and native x86_64 libraries. The local
Apple Silicon Desktop AVD has passed ARM inference, embedding and input/resize tests.
This directory prepares the missing native x86 test on a disposable Intel Linux/KVM VM.
An Android Desktop AVD is not a full ChromeOS ARC environment.

## Diagnostic APK

Use the same worker, models and lifecycle tests as `tools/android10-probe`, with a separate
application ID (`com.hiraia.chromeosprobe`). Preparation copies all 44 x86 addons/backends
from the signed preview; the pinned Gradle dependency supplies the 45th library,
`libbare-kit.so`. All 45 must match the signed preview byte for byte after the build.
The diagnostic deliberately uses the Android debug certificate and enables `run-as` for
model provisioning/report collection. It is not a Hiraia release.

From the worktree root, with Node 22, JDK 17 and the Android SDK:

```sh
python3 tools/chromeos-smoke/prepare-probe.py \
  --apk packages/mobile/android/app/build/outputs/apk/release/hiraia-v0p4p26-chromeos-preview.apk
bash tools/chromeos-smoke/build-probe.sh
```

Preparation refuses an existing output directory. Generated files, native libraries and
the APK live under the ignored `build/chromeos-20260929/cloud/probe/` directory. The build
explicitly regenerates Metro output, then verifies the signature, actual x86 ELF types,
shared-library dependencies and QVAC/Bare/C++ runtime symbols. It never runs the shared
Bare link step or Hiraia's prebuild hooks.

The diagnostic tests:

- Verified Hiraia-2B and LaBSE model hashes, worker startup and resource discovery.
- Hiraia cold/warm generation, unload/reload, and generation after reload.
- A 768-dimensional, finite, unit-norm LaBSE embedding while Hiraia remains resident.
- Persistent stage reports, so native failures retain the last operation attempted.

Model files go in `/data/user/0/com.hiraia.chromeosprobe/files/`, with the filenames and
hashes in `tools/android10-probe/models.js`. Start the app, provision those files, disable
the guest's Wi-Fi/mobile/Ethernet interfaces, and use **Test Hiraia + LaBSE together**.
Collect `run-as com.hiraia.chromeosprobe cat files/probe-report.json` and process logcat.
Keep raw output: nonempty generation verifies execution, not teaching quality.

## Disposable Google Cloud host

The user authorized a total of **up to US$5** on 29 September 2026. Do not create a VM until
an authenticated account and the correct project are available. Inspect billing status,
N2 quota and network access before creation. Never reset this allowance by starting a new
run or deleting evidence of previous usage.

Allocation: `n2-standard-4`, 4 vCPU / 16 GB RAM, Ubuntu 24.04, 50 GB auto-deleting balanced
boot disk, `us-central1-a`, nested virtualization enabled. No attached service account or
API scopes. Use an absolute deletion deadline three hours after creation, no automatic
restart and no public ADB/VNC ports. Use SSH to run ADB on host loopback. Inspect existing
network access before choosing a narrowly scoped SSH/IAP rule; do not change existing rules.

Creation flags, after setting the authorized project and a unique instance name:

```sh
gcloud --configuration=hiraia-chromeos --project="$HIRAIA_PROJECT" compute instances create "$HIRAIA_VM" \
  --zone=us-central1-a --machine-type=n2-standard-4 \
  --image-project=ubuntu-os-cloud --image-family=ubuntu-2404-lts-amd64 \
  --boot-disk-size=50GB --boot-disk-type=pd-balanced --boot-disk-auto-delete \
  --enable-nested-virtualization --maintenance-policy=TERMINATE --no-restart-on-failure \
  --termination-time="$HIRAIA_DELETE_AT" --instance-termination-action=DELETE \
  --no-service-account --no-scopes --labels=purpose=hiraia-x86-test
```

`HIRAIA_DELETE_AT` must be an RFC3339 timestamp three hours in the future, calculated just
before creation. An absolute deadline prevents a restart from extending the paid session.
Verify the returned instance's scheduling policy and boot-disk auto-delete setting. The
published Iowa N2 compute rate checked for this task is approximately $0.194236/hour;
three hours costs about $0.59 before disk/network/IP charges. A budget notification does
not enforce the $5 task ceiling. Record every resource and delete it when testing ends.

Upload `setup-desktop-vm.sh` and run it with sudo on the new VM. It installs a pinned,
checksum-verified Android SDK CLI and Google's x86_64 Android 14 Desktop image, provisions
1366×768 / 160 dpi / 6 GB / 4 cores, and starts the guest under systemd. It refuses to run
without `/dev/kvm` and requests hardware acceleration explicitly. The setup script successfully booted the x86 Desktop guest with KVM on an Intel Haswell
`n1-standard-4` host after all four Iowa N2 zones rejected requests for capacity. The N1
host has 4 vCPU and 15 GB RAM; the Android guest keeps the planned 6 GB / 4-core settings.
Failed N2 requests were checked for orphaned VMs/disks; none remained.

Then install the **release-signed preview** as `com.hiraia.app`, verify its on-device hash,
seed the same offline model/vector files as the ARM AVD, and exercise onboarding, the
3.5-card carousel, keyboard/history, resizing and native engine initialization. Run the
separate QVAC diagnostic for generation/embedding/reload proof. Do not substitute the
diagnostic for checking the installed production app.

Collect evidence to `build/chromeos-20260929/cloud/`, then delete the VM and boot disk
immediately. Delete any temporary access rule, local access-token file and task-specific
SSH key created for this test. Confirm resource deletion with a final read-only inventory.

Primary references:

- [Google's Desktop AVD](https://chromeos.dev/en/posts/desktop-avd-in-android-studio)
- [Nested virtualization](https://docs.cloud.google.com/compute/docs/instances/nested-virtualization/overview)
- [VM deletion deadlines](https://docs.cloud.google.com/compute/docs/instances/limit-vm-runtime)
- [N2 pricing](https://cloud.google.com/products/compute/pricing/general-purpose)

## Validated artifact, 29 September 2026

Signed Hiraia preview used for the Intel run, archived before the later toolbar revision:
`build/chromeos-20260929/hiraia-before-toolbar.apk`

- 522,045,988 bytes; SHA-256 `8ed2b627871c5df5d4473cf7987c5e1cfa88a5566b700ddca3234005a2166f9a`.
- Runtime `c480c3eb2e3cbd826efc83844eb1ae28b68171fc`; existing release certificate and version 0.4.26 / code 26.
- Diagnostic: 100,999,878 bytes; SHA-256 `6c6c73d59ffe70eb46e3d07b948ba166fa865f9a29025b3d829a373031bb310d`.
- All 45 diagnostic worker/backend libraries match the signed preview byte for byte.
- The installed app uses native `x86_64`; the guest exposes AVX/F16C but no AVX2.
  Process maps confirm selection of `libqvac-ggml-cpu-ivybridge.so`.
- The actual app, after tapping search to request its lazy engine, reports both semantic
  search and generation ready. Its real warm-up completion takes 2.234 seconds on CPU.
- With guest networking disabled, Hiraia + LaBSE pass the combined diagnostic. Embedding:
  768 finite dimensions, norm 1.0000000265, 285 ms. Generation: 7.448 s cold, 6.956 s warm,
  7.119 s after unload/reload. Both models coexist; peak recorded PSS is about 2.14 GiB.
- The raw diagnostic returns the supplied English photosynthesis fact despite the prompt's
  Tagalog request. This is execution evidence, not a language-quality pass. The application
  uses its own grounding/prompt pipeline; its separate 45-case teaching gate passed.
- QVAC's CPU/memory resource collectors warn on both Desktop emulators. Hiraia uses its own
  Android memory measurement; the warning does not prevent inference. Do not report the
  entire SDK resource-discovery API as supported.
- Intel keyboard/history, IME dismissal, 412/1024/1366 window resizing and offline Tagalog
  narration pass. These input/voice checks ran on the pre-fix preview; the final APK's
  complete JavaScript bundle, both DEX files and voice libraries are byte-identical.

The later two-row toolbar build has SHA-256
`c8b0a2bd5e50f33db54907b11de2d0cca57e2e7508dff9929ed030be385e138d` and occupies the regular
private preview filename. Its 129 native libraries, both DEX files and runtime fingerprint
are byte-identical to the Intel-tested APK. Its revised layout was tested on the local ARM
Desktop AVD. The saved diagnostic still pins the archived APK's hash; prepare a fresh
diagnostic to pair it with a different APK rather than weakening that provenance check.

Run the installed diagnostic on an emulator with the same installed Hiraia APK and
provisioned models (root adb is needed for process-map evidence):

```sh
python3 tools/chromeos-smoke/run-probe.py --serial emulator-5554   --output /path/to/evidence
```

For a forwarded cloud ADB connection, add `--server-port 5038`. The runner verifies the
installed Hiraia APK hash against the diagnostic's embedded provenance, requires a native
x86 emulator and disabled guest networking, and saves the persistent report, process maps,
logcat and screenshot. It force-stops only the two test applications and resets only the
probe report. The full per-library parity check is a separate build prerequisite.

The first preview failed with `make_cpu_buft_list: no CPU backend found`. Its logs are kept
as a negative control. The source-pinned loader patch lives in
`packages/mobile/native/qvac-x64-overlay`; its native tests include two seeded defects.

Cloud evidence is under `build/chromeos-20260929/cloud/`. The VM, auto-deleting boot disk,
firewall, subnet and network have been deleted and verified absent. Temporary SSH private
key and access-token file were removed; the ADB tunnel closed with the VM. Estimated total
cost: **US$0.212**, below the authorized $5. This is an estimate, not a settled billing
statement. Compute Engine's API remains enabled, with no task resources running.

Actual ChromeOS ARC, physical AMD hardware, classroom Nearby exchange and school-managed
installation policy remain unvalidated. Desktop AVD results do not imply QVAC vendor support.
