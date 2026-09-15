const fs = require('node:fs');
const path = require('node:path');
const { withDangerousMod } = require('@expo/config-plugins');

// onnxruntime-react-native (1.24) ships the LEGACY `unimodule.json` and no
// `expo-module.config.json`, so Expo SDK 54 autolinking resolves it with `"modules": []`:
// it builds and packages the native .so files (libonnxruntime.so + libonnxruntimejsi.so)
// but never writes an OnnxruntimePackage entry into the generated PackageList.java. The
// result is `NativeModules.Onnxruntime === null`, and the very first thing the app does —
// `import 'onnxruntime-react-native'` in src/voice/engine.ts — runs the package's
// binding.ts `Module.install()`, which throws "Cannot read property 'install' of null"
// before any screen renders. It crashes on launch, and ONLY in a release build (the
// symptom is invisible to type-check, unit tests and the regression gate).
//
// The class is already on the app classpath (the gradle project is included — that is why
// the .so files are in the APK), so registering it by hand in MainApplication is the whole
// fix. Same mechanism the repo already uses for HiraiaMemoryPackage. The fully-qualified
// name avoids needing an import. R8 keeps the referenced package + module, and the module's
// getName()="Onnxruntime" is a string constant R8 does not rename.
function registerOnnxruntime(mobile) {
  const app = path.join(
    mobile, 'android/app/src/main/java/com/hiraia/app/MainApplication.kt');
  let source = fs.readFileSync(app, 'utf8');
  const call = 'add(ai.onnxruntime.reactnative.OnnxruntimePackage())';
  if (!source.includes(call)) {
    const marker = 'PackageList(this).packages.apply {';
    if (!source.includes(marker)) throw new Error('Cannot register OnnxruntimePackage');
    source = source.replace(marker, `${marker}\n              ${call}`);
    fs.writeFileSync(app, source);
  }

  // Belt and braces under R8 (minifyEnabled is on for release): the package ships NO
  // consumer ProGuard rules, so keep its bridge classes and native methods explicitly.
  // The MainApplication reference already keeps the package; this guards the JSI helper
  // and anything reached only over JNI, which reference-analysis cannot see.
  const pro = path.join(
    mobile, 'android/app/proguard-rules.pro');
  const KEEP = [
    '',
    '# onnxruntime-react-native — bridge + JSI classes reached from native/JNI (withOnnxruntime.js)',
    '-keep class ai.onnxruntime.** { *; }',
    '-keepclasseswithmembernames class ai.onnxruntime.** { native <methods>; }',
    '',
  ].join('\n');
  if (fs.existsSync(pro)) {
    const body = fs.readFileSync(pro, 'utf8');
    if (!body.includes('ai.onnxruntime')) fs.appendFileSync(pro, KEEP);
  }
}

module.exports = (config) =>
  withDangerousMod(config, ['android', async (config) => {
    registerOnnxruntime(config.modRequest.projectRoot);
    return config;
  }]);
module.exports.registerOnnxruntime = registerOnnxruntime;
