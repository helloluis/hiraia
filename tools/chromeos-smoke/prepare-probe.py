#!/usr/bin/env python3
"""Build an isolated x86_64 QVAC diagnostic from the exact signed preview APK.

The existing Android compatibility probe supplies the runtime tests. Its original
project and the shipping app are never modified; generated files live under build/.
"""

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import zipfile
from pathlib import Path


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


root = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--apk', type=Path, required=True)
parser.add_argument('--output', type=Path,
                    default=root / 'build/chromeos-20260929/cloud/probe')
args = parser.parse_args()
apk = args.apk.resolve(strict=True)
output = args.output.resolve()
if output.exists():
    raise SystemExit(f'Refusing to overwrite an existing generated project: {output}')
if not output.is_relative_to(root / 'build'):
    raise SystemExit('Generated output must stay inside this worktree\'s ignored build/ directory')

mobile = root / 'packages/mobile'
source = root / 'tools/android10-probe'
abi = 'x86_64'
package = 'com.hiraia.chromeosprobe'
output.mkdir(parents=True)
(output / 'build').mkdir()
(output / 'node_modules').symlink_to(root / 'node_modules', target_is_directory=True)
source_hashes = {}
for filename in ['index.js', 'models.js', 'ProbePackage.kt', 'package.json',
                 'metro.config.js', 'babel.config.js']:
    original = source / filename
    source_hashes[str(original.relative_to(root))] = digest(original)
    text = original.read_text().replace('com.hiraia.androidprobe', package)
    text = text.replace('Android 10+ · ARM64 · QVAC 0.17.1 · CPU only',
                        'Android Desktop · x86_64 · QVAC 0.17.1 · CPU only')
    text = text.replace('Hiraia Android Probe', 'Hiraia x86 QVAC Probe')
    if filename == 'index.js':
        text = text.replace('heartbeat, getSystemResources,',
                            'subscribeServerLogs, heartbeat, getSystemResources,')
        text = text.replace("    await step('worker-heartbeat',", """    subscribeServerLogs(entry => console.log('[QVAC-native]', JSON.stringify(entry)));
    await step('worker-heartbeat',""")
    (output / filename).write_text(text)
manifest = json.loads((output / 'package.json').read_text())
manifest['name'] = 'hiraia-chromeos-qvac-probe'
mobile_manifest = json.loads((mobile / 'package.json').read_text())
# The copied Activity and launch theme use Expo's native splash-screen module.
manifest['dependencies']['expo-splash-screen'] = mobile_manifest['dependencies']['expo-splash-screen']
(output / 'package.json').write_text(json.dumps(manifest, indent=2) + '\n')

android = output / 'android'
shutil.copytree(mobile / 'android', android,
                ignore=shutil.ignore_patterns('build', '.gradle', '.cxx', '.kotlin',
                                             'jniLibs', 'local.properties'))
for path in android.rglob('*'):
    if path.is_file() and path.suffix in ('.kt', '.java', '.xml', '.gradle', '.properties'):
        text = path.read_text().replace('com.hiraia.app', package)
        text = text.replace('<string name="app_name">Hiraia</string>',
                            '<string name="app_name">Hiraia x86 QVAC Probe</string>')
        text = text.replace('android:scheme="hiraia"', 'android:scheme="hiraia-chromeos-probe"')
        path.write_text(text)

application = next(android.rglob('MainApplication.kt'))
text = application.read_text().replace('PackageList(this).packages.apply {',
                                      'PackageList(this).packages.apply {\n              add(ProbePackage())')
text = text.replace('              add(ai.onnxruntime.reactnative.OnnxruntimePackage())\n', '')
text = text.replace('getUseDeveloperSupport(): Boolean = BuildConfig.DEBUG',
                    'getUseDeveloperSupport(): Boolean = false')
application.write_text(text)
shutil.copyfile(output / 'ProbePackage.kt', application.parent / 'ProbePackage.kt')

gradle = android / 'app/build.gradle'
text = gradle.read_text()
# The diagnostic has no card illustrations or shipping content assets.
text = text.replace('apply from: new File(rootDir, "../scripts/illustration-assets.gradle")', '')
text, count = re.subn(r'ndk \{ abiFilters [^\n]+ \}', 'ndk { abiFilters "x86_64" }', text)
assert count == 1, 'Expected exactly one application ABI filter'
text = text.replace('release {', 'release {\n            debuggable true', 1)
gradle.write_text(text)
props = android / 'gradle.properties'
text, count = re.subn(r'^reactNativeArchitectures=.*$', 'reactNativeArchitectures=x86_64',
                      props.read_text(), flags=re.MULTILINE)
assert count == 1, 'Expected exactly one React Native ABI setting'
props.write_text(text)

# Disable OTA in the disposable diagnostic; it must execute its own frozen bundle.
app_manifest = android / 'app/src/main/AndroidManifest.xml'
text = app_manifest.read_text()
text = re.sub(r'(<meta-data android:name="expo.modules.updates.ENABLED" android:value=")[^"]+("/>)',
              r'\g<1>false\2', text)
text = text.replace('<uses-native-library android:name="libOpenCL.so"/>',
                    '<uses-native-library android:name="libOpenCL.so" android:required="false"/>')
app_manifest.write_text(text)

native_hashes = {}
prefixes = ('libbare-', 'libqvac', 'libfs-native', 'libquickbit-', 'librabin-',
            'librocksdb-', 'libsimdle-', 'libsodium-', 'libudx-')
with zipfile.ZipFile(apk) as archive:
    for name in archive.namelist():
        filename = Path(name).name
        if not name.startswith(f'lib/{abi}/') or not filename.startswith(prefixes):
            continue
        if filename == 'libbare-kit.so':
            continue  # Built by the normal, pinned Gradle dependency.
        data = archive.read(name)
        if data[:4] != b'\x7fELF' or int.from_bytes(data[18:20], 'little') != 62:
            raise SystemExit(f'Not an x86_64 ELF: {name}')
        target = android / 'app/src/main/jniLibs' / abi / filename
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        native_hashes[filename] = hashlib.sha256(data).hexdigest()
# 45 total runtime libraries: 44 copied addons/backends plus Gradle's libbare-kit.so.
assert len(native_hashes) == 44, f'Expected 44 copied x86_64 addons/backends, got {len(native_hashes)}'

deps = root / 'node_modules'
versions = {name: json.loads((deps / name / 'package.json').read_text())['version']
            for name in ['@qvac/sdk', '@qvac/llm-llamacpp', '@qvac/embed-llamacpp',
                         'react-native-bare-kit', 'expo', 'react-native']}
assert versions['@qvac/sdk'] == '0.17.1', versions
assert versions['react-native-bare-kit'] == '0.12.3', versions
worker = deps / '@qvac/sdk/dist/worker.mobile.bundle.js'
shutil.copyfile(worker, output / 'build/worker.mobile.bundle.js')
provenance = {
    'sourceBranch': subprocess.check_output(['git', '-C', str(root), 'branch', '--show-current'], text=True).strip(),
    'sourceCommit': subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD'], text=True).strip(),
    'sourceApkSha256': digest(apk), 'workerSha256': digest(worker), 'versions': versions,
    'abis': [abi], 'nativeSha256': native_hashes, 'testSourceSha256': source_hashes,
    'preparationSha256': digest(Path(__file__)), 'diagnostic': True,
    'placement': 'CPU only; all shipping x86 CPU variants retained for upstream runtime selection; GPU libraries retained',
}
(output / 'build/provenance.json').write_text(json.dumps(provenance, indent=2) + '\n')
print(json.dumps({'project': str(output), 'nativeLibrariesCopied': len(native_hashes),
                  'sourceApkSha256': provenance['sourceApkSha256']}, indent=2))
