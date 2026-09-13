#!/usr/bin/env python3
"""Prepare an isolated native shell from unified; never run its prebuild hooks."""
import argparse
import hashlib
import json
import re
import shutil
import subprocess
import zipfile
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--unified', required=True, type=Path)
args = parser.parse_args()
root = Path(__file__).resolve().parent
source = args.unified.resolve()
mobile = source / 'packages/mobile'
build = root / 'build'
build.mkdir(exist_ok=True)
deps = root / 'node_modules'
if not deps.exists():
    deps.symlink_to(source / 'node_modules', target_is_directory=True)
elif deps.resolve() != source / 'node_modules':
    raise SystemExit('node_modules points to a different dependency tree')
versions = {}
for name in ['@qvac/sdk', '@qvac/llm-llamacpp', '@qvac/embed-llamacpp', 'react-native-bare-kit', 'expo', 'react-native']:
    versions[name] = json.loads((deps / name / 'package.json').read_text())['version']
assert versions['@qvac/sdk'] == '0.17.1', versions
assert versions['react-native-bare-kit'] == '0.12.3', versions

android = root / 'android'
if android.exists():
    raise SystemExit('android/ already exists; move/remove this generated probe directory before preparing again')
shutil.copytree(mobile / 'android', android,
                ignore=shutil.ignore_patterns('build', '.gradle', '.cxx', '.kotlin', 'jniLibs', 'local.properties'))
for p in android.rglob('*'):
    if p.is_file() and p.suffix in ('.kt', '.java', '.xml', '.gradle', '.properties'):
        text = p.read_text()
        text = text.replace('com.hiraia.app', 'com.hiraia.androidprobe')
        text = text.replace('<string name="app_name">Hiraia</string>', '<string name="app_name">Hiraia Android Probe</string>')
        text = text.replace('android:scheme="hiraia"', 'android:scheme="hiraia-android-probe"')
        p.write_text(text)
application = next(android.rglob('MainApplication.kt'))
text = application.read_text().replace('PackageList(this).packages.apply {', 'PackageList(this).packages.apply {\n              add(ProbePackage())')
text = text.replace('getUseDeveloperSupport(): Boolean = BuildConfig.DEBUG', 'getUseDeveloperSupport(): Boolean = false')
application.write_text(text)
shutil.copyfile(root / 'ProbePackage.kt', application.parent / 'ProbePackage.kt')
gradle = android / 'app/build.gradle'
text = gradle.read_text().replace('versionName "0.1.0"', 'versionName "1.0.0"')
# Bundle the JS in a release variant, but keep run-as for report/model transfer.
text = text.replace('release {', 'release {\n            debuggable true', 1)
gradle.write_text(text)
manifest = android / 'app/src/main/AndroidManifest.xml'
text = manifest.read_text()
for permission in ['READ_EXTERNAL_STORAGE', 'WRITE_EXTERNAL_STORAGE', 'SYSTEM_ALERT_WINDOW']:
    text = re.sub(r'\s*<uses-permission android:name="android.permission.' + permission + r'"\s*/>', '', text)
# An absent vendor OpenCL library must not be an installation requirement.
text = text.replace('<uses-native-library android:name="libOpenCL.so"/>', '<uses-native-library android:name="libOpenCL.so" android:required="false"/>')
manifest.write_text(text)

apk = mobile / 'android/app/build/outputs/apk/release/app-release.apk'
native_hashes = {}
with zipfile.ZipFile(apk) as z:
    for name in z.namelist():
        # Use the exact audited native runtime/addons. Framework libraries are
        # supplied by their normal Gradle dependencies, not duplicated here.
        filename = Path(name).name
        if name.startswith('lib/arm64-v8a/') and (filename.startswith(('libbare-', 'libqvac', 'libfs-native', 'libquickbit-', 'librabin-', 'librocksdb-', 'libsimdle-', 'libsodium-', 'libudx-')) and filename != 'libbare-kit.so'):
            data = z.read(name)
            target = android / 'app/src/main/jniLibs/arm64-v8a' / filename
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
            native_hashes[filename] = hashlib.sha256(data).hexdigest()
worker = deps / '@qvac/sdk/dist/worker.mobile.bundle.js'
shutil.copyfile(worker, build / 'worker.mobile.bundle.js')
provenance = {'sourceBranch': 'unified',
              'sourceCommit': subprocess.check_output(['git', '-C', str(source), 'rev-parse', 'HEAD'], text=True).strip(),
              'sourceApkSha256': hashlib.file_digest(apk.open('rb'), 'sha256').hexdigest(),
              'workerSha256': hashlib.file_digest(worker.open('rb'), 'sha256').hexdigest(),
              'versions': versions, 'nativeSha256': native_hashes,
              'placement': 'CPU only; baseline ARMv8.0; GPU libraries retained to expose loading dependencies',
              'diagnostic': True}
(build / 'provenance.json').write_text(json.dumps(provenance, indent=2) + '\n')
print(json.dumps({'versions': versions, 'nativeLibrariesCopied': len(native_hashes), 'project': str(root)}, indent=2))
