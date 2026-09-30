# Hiraia for Windows

The Windows preview shares the Android/ChromeOS curriculum, cards, quizzes, profiles,
grounded generation and reader. Electron provides a sandboxed desktop window; QVAC
and ONNX run locally in the host. No website or account is required to learn.

Target: Windows 10 or 11, x64 Intel/AMD. QVAC 0.17.1 officially lists Windows 10+ x64.
CPU inference is the default: a dedicated GPU is not required. The pinned Vulkan
loader and Microsoft C++ runtime are bundled app-local, so installing developer tools
or an administrator-owned runtime is unnecessary. The portable ZIP must be extracted
completely before running `Hiraia.exe`. Windows ARM is not a supported native target.

Core cards and quizzes work offline, including both bundled English and Tagalog
voices. The existing memory gate enables semantic retrieval at roughly 3.5 GiB and
generation at 5.5 GiB total RAM, subject to available memory. Those optional model
downloads are about 506 MB and 1.27 GB respectively; progress resumes after interruption.
Extra illustration packs download separately. Cebuano text remains available; there
is no bundled Cebuano voice. Data stays under the Windows user's Hiraia AppData directory,
so replacing or moving the extracted application does not erase learning history.

The wide reader uses the same adaptive 3.5/2.5/1.5-card layout as ChromeOS, with the
compact two-row toolbar, keyboard arrows/Page Up/Page Down, visible focus, reduced-motion
and Windows high-contrast styles. System screen-reader mode uses one active card.
At narrower widths and increased zoom it switches to the scrollable single-card reader.
Quiz options and explanations remain scrollable. Accessibility mode is automated-tested;
manual NVDA/Narrator acceptance is still required before a general release.

This preview is unsigned. Windows may show a SmartScreen reputation warning. No
Android APK update is offered to Windows. Tala Nearby enrolment is unavailable because
its current native implementation depends on Google's Android Nearby API. This is an
explicit preview limitation, not a simulated classroom connection.

## Build and validation

The canonical three-edition pipeline is `.github/workflows/native-apps.yml`, triggered
on app/content pushes to `main` or `hiraia-unified`, or workflow dispatch. While Luis's
Mac is awake, the existing protected runner restores private inputs, runs the formal
five-draw model gate, signs both APKs, and exports the desktop renderer. A standard
GitHub Windows runner then builds the pinned native prerequisites, packages Windows,
extracts the actual ZIP into a Unicode/space-containing path, and tests its UI,
persistence, CPU embedding/generation and both offline voices. A combined manifest is
emitted only after all three editions pass with the same commit and app version.
Only renderer assets and build evidence cross runners; signing credentials stay on Mac.

Local commands, after the normal private-input restore and `cards.db` rebuild:

```sh
pnpm install --frozen-lockfile
pnpm --filter @hiraia/desktop renderer
pnpm --filter @hiraia/mobile exec tsc -p tsconfig.desktop.json --noEmit
pnpm --filter @hiraia/desktop test
# On Windows PowerShell, once per pinned source revision:
packages/desktop/scripts/build-vulkan.ps1
node packages/desktop/scripts/install-native-deps.cjs
node packages/desktop/scripts/native-smoke.mjs
pnpm --filter @hiraia/desktop make
# Point this at the EXE extracted from the resulting ZIP:
HIRAIA_E2E_EXECUTABLE=/path/to/Hiraia.exe HIRAIA_E2E_NATIVE=1 node packages/desktop/tests/e2e.cjs
```

The packaging stage creates a flat install from the exact workspace lock snapshots.
Do not replace it with `pnpm deploy` on pnpm 9: that resolves dependencies again.
QVAC's official Forge plugin traces and prunes the worker graph; a guard requires both
llm and embedding engines. Generated SDK imports are made relative for portability.

CI retains the ZIP, SHA-256, complete artifact manifests, screenshots and validation
logs. Building does not publish. A Windows preview is uploaded with the existing immutable,
read-back-verified R2 publisher under an unlisted unique filename. Public APK aliases and
the website's release catalog are unchanged by Windows preview builds.

References: [QVAC requirements](https://docs.qvac.tether.io/system-requirements/),
[official Electron integration](https://docs.qvac.tether.io/tutorials/electron/).
