# Public demo Android APK

Build only from this V1 package/worktree. The app uses `com.hiraia.tala.next`, label Tala, versionName `1.0.0-demo.1`, versionCode 1, Hermes, HTTPS `https://tala.hiraia.org`, and no OTA channel. Android cleartext is explicitly disabled by the local config plugin. Legacy storage/overlay/vibration permissions are blocked. SQLCipher is enabled; startup checks cipher_version and refuses plaintext storage. Diagnostics reports the actual opened cipher version.

```
pnpm install --filter '@hiraia/tala-mobile...' --ignore-scripts
pnpm --filter @hiraia/tala-mobile type-check
pnpm --filter @hiraia/tala-mobile test
cd packages/tala-mobile
bash scripts/build-demo.sh
```

The build sources `~/.config/hiraia/build-env.sh`, exports the public `EXPO_PUBLIC_TALA_API_URL`, measures the exported Hermes bundle, stamps UTC build time, prebuilds ignored `android/`, then runs one release build with `--no-daemon --max-workers 2`. The single-use Gradle daemon exits automatically. Compressed native libraries (`expo.useLegacyPackaging=true`) reduce download size and are extracted by Android at installation. ABIs requested: arm64-v8a and armeabi-v7a. The final native inspection/receipt records the actual delivered ABIs and SDK levels.

`sign-demo.sh` creates the throwaway signing identity once at **`~/.config/hiraia/tala-next-demo.keystore`**, with private credentials at `~/.config/hiraia/tala-next-demo-signing.env` (`TALA_DEMO_KEYSTORE_PASSWORD`). Both are outside Git, mode 600, and must be retained together for future demo updates. Losing the signing identity forces testers to uninstall the old demo, losing its local data. This identity is unrelated to the live 0.4.x pilot key. Never copy the pilot key into this workflow.

Bump **both** versionName and versionCode in `app.config.js` for the next demo (`1.0.0-demo.2`, code 2). Keep the ID and keystore stable. Generated artifacts go to `/tmp/tala-apk/tala.apk` and `/tmp/tala-apk/tala-apk.json`. Orchestrator alone publishes them. No deploy/push/remote host step exists here.

Class activity stays a placeholder for this build. `expo.autolinking.exclude: ["tala-activity"]` explicitly excludes the optional Nearby module. Its code/tests remain intact, including the 44 tests previously missed by the unquoted test glob. No Nearby permissions or catalog assets should be in the delivered APK.

Settings → About / diagnostics shows identity, build time, server, actual SQLCipher version/key storage, loaded title font/system body font, device RAM and Android version, startup measurement, and measured exported Hermes size. Startup uses the RN native start marker when available; otherwise it labels the JS-only fallback. Force-stop/reopen for a cold process. Exported bundle size is labelled as such, rather than presented as APK size or device heap use.

The APK is a throwaway-signed public demo, not a claim that native reference-phone resource/teacher acceptance gates passed. Sign-in/register uses the configured server; a fictional sample works without an account/network. No production account or provider test is part of this build.
