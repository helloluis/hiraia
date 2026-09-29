# Android x86 backend discovery

The `qvac-fabric` port is copied from QVAC's pinned registry tree
`5f8e256042a0651b560ef81ec429e0b49a2c4a91` (fabric 9840.1.1). Its only portfile
change applies `android-x64-backend-discovery.patch` to the verified upstream
source archive. `qvac-android-x64.json` pins every overlay input by SHA-256.

Android loads APK libraries by basename. Upstream's fallback only lists ARM CPU
variants, so native Intel/AMD model initialization fails despite successful ELF
linkage. The patch adds all 14 built x86 variants, retains the baseline, and
rejects a zero CPU feature score before applying any preference offset. A zero
score means the processor cannot execute that backend. x86 ranking uses feature
scores without a filename-order preference.

This overlay is used only by Hiraia's x86 source build. Vendor ARM binaries remain
unchanged. It does not turn this port into vendor-supported QVAC Android x86.
Run `scripts/test_qvac_backend_loader.py <fabric-source-directory>` for baseline,
unsupported CPU, optimized CPU and fail-closed checks, including a seeded defect.
Real Android generation/embedding tests are still required.
