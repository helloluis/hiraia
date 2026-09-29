"""Read release facts from signed APK bytes, shared by the builder and publisher."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]
PLATFORMS = json.loads((ROOT / 'packages/mobile/build-platforms.json').read_text())
CERT = '40d750d5576cb59c311c7ba713403e065b934967d7a7d1bc80652e1167a20c35'


def android_tool(name):
    sdk = Path(os.environ.get('ANDROID_HOME') or os.environ.get('ANDROID_SDK_ROOT') or
               Path.home() / 'Library/Android/sdk')
    candidates = sorted(sdk.glob(f'build-tools/*/{name}'),
                        key=lambda p: tuple(int(n) for n in re.findall(r'\d+', p.parent.name)))
    if not candidates:
        raise ValueError(f'{name} missing in {sdk}; set ANDROID_HOME')
    return str(candidates[-1])


def filename(version, platform):
    if platform not in PLATFORMS or not re.fullmatch(r'(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)', version):
        raise ValueError('Unknown platform or invalid version')
    return f'hiraia-v{version.replace(".", "p")}{PLATFORMS[platform]["suffix"]}.apk'


def hashes(file):
    sha, md5, size = hashlib.sha256(), hashlib.md5(), 0
    with Path(file).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            sha.update(chunk)
            md5.update(chunk)
            size += len(chunk)
    return {'bytes': size, 'sha256': sha.hexdigest(), 'md5': md5.hexdigest()}


def embedded_identity(file):
    with zipfile.ZipFile(file) as apk:
        config = json.loads(apk.read('assets/app.config'))
        platform = config.get('extra', {}).get('distributionPlatform')
        if platform not in PLATFORMS:
            raise ValueError('APK has no supported distribution label; rebuild with pnpm apk')
        abis = sorted({n.split('/')[1] for n in apk.namelist() if n.startswith('lib/') and n.endswith('.so')})
        if abis != sorted(PLATFORMS[platform]['abis']):
            raise ValueError(f'{platform} APK has wrong ABIs: {abis}')
        runtime = apk.read('assets/fingerprint').decode().strip()
        if not re.fullmatch(r'[a-f0-9]{40}', runtime):
            raise ValueError('APK lacks a valid OTA fingerprint')
        bundle_sha = hashlib.sha256(apk.read('assets/index.android.bundle')).hexdigest()
    return {'platform': platform, 'abis': abis, 'runtime': runtime, 'bundleSha256': bundle_sha}


def measure(file, expected_platform=None):
    identity = embedded_identity(file)
    if expected_platform and identity['platform'] != expected_platform:
        raise ValueError('APK distribution does not match the requested platform')
    env = dict(os.environ)
    if not env.get('JAVA_HOME') and Path('/opt/homebrew/opt/openjdk@17').is_dir():
        env['JAVA_HOME'] = '/opt/homebrew/opt/openjdk@17'
    certs = subprocess.check_output([android_tool('apksigner'), 'verify', '--print-certs', str(file)], text=True, env=env)
    cert = re.findall(r'Signer #\d+ certificate SHA-256 digest: ([a-f0-9]{64})', certs)
    if cert != [CERT]:
        raise ValueError('APK is not signed with the pinned Hiraia release certificate')
    badging = subprocess.check_output([android_tool('aapt'), 'dump', 'badging', str(file)], text=True)
    match = re.search(r"package: name='com.hiraia.app' versionCode='(\d+)' versionName='([^']+)'", badging)
    if not match or int(match[1]) < 1:
        raise ValueError('APK is not a versioned Hiraia student app')
    name = filename(match[2], identity['platform'])
    return {**identity, **hashes(file), 'versionName': match[2], 'versionCode': int(match[1]),
            'filename': name, 'signingCertSha256': CERT}


def validate_pair(manifest, directory, inspect=measure):
    if manifest.get('schema') != 1 or not manifest.get('complete'):
        raise ValueError('Build is incomplete')
    artifacts = manifest.get('artifacts', {})
    if set(artifacts) != set(PLATFORMS):
        raise ValueError('Build must contain every configured platform')
    versions, runtimes = set(), set()
    for platform, item in artifacts.items():
        relative = Path(item['path'])
        if relative.is_absolute() or '..' in relative.parts:
            raise ValueError('Artifact path escapes the build')
        measured = inspect(Path(directory) / relative, platform)
        if any(item.get(key) != value for key, value in measured.items()):
            raise ValueError(f'{platform} artifact no longer matches its build manifest')
        versions.add((measured['versionName'], measured['versionCode']))
        runtimes.add(measured['runtime'])
    if len(versions) != 1 or len(runtimes) != len(PLATFORMS):
        raise ValueError('Builds must share a version and have separate native runtimes')
    return artifacts
