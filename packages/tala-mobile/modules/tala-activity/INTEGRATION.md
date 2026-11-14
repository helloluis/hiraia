# tala-activity — what Worker E must wire

Worker P owns `modules/tala-activity/**` and `src/features/activity/**` only. Everything below is a
change in E's paths; each item is exact so it can be applied without reading the port.

## 1. Test script glob (blocks "tests pass for tala-mobile")

`package.json` → `"test": "tsx --test src/**/*.test.ts"` is expanded by `sh`, where `**` means `*`, so
only two-level files (`src/x/y.test.ts`) run. The activity tests live at `src/features/activity/*.test.ts`
and are silently skipped. Change to a quoted glob so Node expands it:

```json
"test": "tsx --test \"src/**/*.test.ts\""
```

Verified locally with `node_modules/.bin/tsx --test "src/features/activity/*.test.ts"`: 44 tests, all green (plus 13 Kotlin JUnit tests in the JVM build).

## 2. Local Expo module autolinking

Nothing to add for discovery: Expo autolinks `modules/*/expo-module.config.json` (SDK ≥ 50). Check with
`npx expo config --type introspect` / `expo prebuild` that `expo.modules.talaactivity.TalaActivityModule`
is listed. The module has **no JS dependency** beyond `expo` (`requireOptionalNativeModule`).

## 3. Android permissions (`app.json` → `expo.android.permissions`)

The module's `AndroidManifest.xml` declares them and the manifest merger adds them, but list them in
`app.json` too so the prebuilt manifest is explicit and reviewable (same set as Tala 0.4.4):

```json
"permissions": [
  "android.permission.ACCESS_NETWORK_STATE",
  "android.permission.ACCESS_WIFI_STATE",
  "android.permission.CHANGE_WIFI_STATE",
  "android.permission.BLUETOOTH",
  "android.permission.BLUETOOTH_ADMIN",
  "android.permission.ACCESS_FINE_LOCATION",
  "android.permission.BLUETOOTH_ADVERTISE",
  "android.permission.BLUETOOTH_CONNECT",
  "android.permission.BLUETOOTH_SCAN",
  "android.permission.NEARBY_WIFI_DEVICES"
]
```

`BLUETOOTH`/`BLUETOOTH_ADMIN` carry `maxSdkVersion="30"` and `ACCESS_FINE_LOCATION` `maxSdkVersion="31"`
in the module manifest; if Expo's merge drops the attributes, add them with a small config plugin
(`withAndroidManifest`) or accept them unbounded (harmless, but Play review asks why). Do **not** add
`neverForLocation` to `BLUETOOTH_SCAN`: Nearby still needs derived location on API 31.

Runtime permission prompts are issued by the module (`requestPermissions()`, via Expo's permissions
service); no `expo-location`/`expo-bluetooth` dependency is needed.

## 4. Native dependencies (Gradle, inside the module — nothing for E to add)

`com.google.android.gms:play-services-nearby:19.4.0`, `play-services-base:18.5.0`,
`desugar_jdk_libs:2.1.5` — identical to the student module and Tala 0.4.4. The module compiles with the
app's Kotlin (2.1.x) because the Nearby wrapper is Java (`NearbyAdvertiser.java`), as in the student app.

Google Play services is required on the phone (it is on every pilot phone; `availability().playServices`
reports it).

## 5. Card catalog asset (build time)

`android/build.gradle` runs `scripts/sync-card-catalog.mjs` before `preBuild`: it needs **`git`, `node`
and the `tala-0.4.x` branch present** in the checkout that builds the APK (CI must fetch that branch:
`git fetch origin tala-0.4.x:tala-0.4.x`). The 1.9 MB TSV lands in the module's `assets/` and is not
committed. Size: it counts toward the APK (compressed ≈ 450 KB) and the §14.1 budget line "including the
0.4.x card catalog"; it is **not** in the JS bundle or in `check-budget.mjs`'s image total. It is parsed
natively and lazily (first learner page), kept in native memory (~6–8 MB), never in the JS heap.

## 6. Database

Call `openActivityDatabase()` from `src/features/activity/runtime.ts` once at startup (after the
LocalStore opens). It uses a **separate** SQLCipher file `tala-activity.db` with its own SecureStore key
`tala.activity-database-key`, so activity never rides along with the LocalStore, sync or account export
(ACT-5/PRIV-10). Then `createActivityRuntime({ db })` → an `ActivityRuntime` to hand to the screens. No
schema or plugin changes: the existing `expo-sqlite` SQLCipher plugin and `expo-secure-store` are used.

## 7. Navigation entry points (`src/App.tsx`, Class tab)

Replace the placeholder `<Body>{t('activity')}</Body>` in the class card with a button:

```tsx
<Button label={tA('collect')} onPress={() => { setFeatureClass(c.id); setPage('activity'); }} />
```

and add two pages:

```tsx
{page === 'activity' && featureClass && activityRt && (
  <ActivityScreen
    rt={activityRt}
    cls={{ classId: cls.id, name: cls.data.name, teacherName: profile?.name, schoolName: profile?.school,
           gradeLevel: cls.data.gradeGroups.map(g => g.grade).join(', '), schoolYear: cls.data.schoolYear }}
    language={language}
    onBack={() => setPage('main')}
    onSettings={() => setPage('settings')}
    onOpenLearner={(student, roster) => { setLearner({ roster, index: roster.findIndex(r => r.student === student) }); setPage('learner'); }}
  />
)}
{page === 'learner' && learner && activityRt && (
  <LearnerScreen rt={activityRt} roster={learner.roster} index={learner.index} language={language}
    rosterRows={students.filter(s => s.data.classId === featureClass).map(s => ({ id: s.id, name: s.data.displayName }))}
    onBack={() => setPage('activity')} onSettings={() => setPage('settings')} />
)}
```

`ActivityScreen` and `LearnerScreen` are exported from `src/features/activity/ActivityScreen.tsx` and
`LearnerScreen.tsx`. Both bring their own strings (`strings.ts`, `activityStrings(language)`), so no
`src/i18n` edit is required; if E prefers one table, fold `activityEn`/`activityFil` into `en.ts`/`fil.ts`
(keys are listed in `strings.ts`; none collide with existing keys except `back`, `cancel`, `settings`,
`next`, which have the same meaning).

The `Class` tab stays one of the four destinations (SIMPLE-9); "Collect activity" is a sub-screen.

Deleting a class (archive flow) should call `activityRt.deleteClass(classId)` so activity and the
keystore key go with it (PRIV-10).

## 8. Collection without an account (ACT-4)

The screens take a `ClassInput` from the planning class record. For ACT-4 (upgraded pilot teacher who never
signs in) a class must exist locally before sign-in; the import path (`upgrade.ts`) creates
`activity_classes` rows with the 0.4.x class id — E's "attach existing classes on first sign-in" step
should create planning `class` records with those ids (or pass `classIdFor` to remap). See UPGRADE.md.

## 9. Lifecycle

Nearby advertises only while `ActivityScreen` is mounted, the teacher tapped Collect (or opened the QR),
and the app is active (`AppState`); backgrounding stops it, as 0.4.x did. No foreground service, no wake
lock (§14.1 battery row).

## 10. What E should verify in the native build

- Module links and `availability()` returns sane values on a phone (`supported` true on Android 10+).
- Permission prompt flow on API 31+ and API 33+ (Nearby Wi-Fi devices).
- `expo-sqlite` SQLCipher opens `tala-activity.db` (fail-closed otherwise).
- The real two-phone test in README.md "Manual test for Luis".
