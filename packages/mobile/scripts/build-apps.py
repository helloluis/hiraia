#!/usr/bin/env python3
"""Build and sign every student-app platform. A partial pair is never a release."""
import argparse
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

MOBILE = Path(__file__).resolve().parents[1]
ROOT = MOBILE.parents[1]
sys.path.insert(0, str(ROOT / 'deploy'))
from app_artifacts import PLATFORMS, measure, validate_pair


def source_digest():
    paths = subprocess.check_output(['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--',
        'packages/mobile', 'packages/shared', 'packages/images', 'rag/bank',
        'rag/pipeline/cardsPool.app.json', 'package.json', 'pnpm-lock.yaml', 'deploy/app_artifacts.py'], cwd=ROOT)
    files = set(p.decode() for p in paths.split(b'\0') if p)
    files.update('packages/mobile/' + p for p in ['assets/data/cards.db', 'assets/data/tokens.bin',
                 'assets/voices/en/model.onnx', 'assets/voices/tl/model.onnx'])
    digest = hashlib.sha256()
    for name in sorted(files):
        file = ROOT / name
        digest.update(name.encode() + b'\0')
        if not file.is_file():
            digest.update(b'deleted\0')
            continue
        with file.open('rb') as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                digest.update(chunk)
        digest.update(b'\0')
    return digest.hexdigest()


def run(command, log, env, cwd=MOBILE):
    print(f'== {log.name}', flush=True)
    with log.open('wb') as stream:
        result = subprocess.run(command, cwd=cwd, env=env, stdout=stream, stderr=subprocess.STDOUT)
    if result.returncode:
        print(log.read_text(errors='replace')[-9000:], file=sys.stderr)
        raise RuntimeError(f'{log.name} failed ({result.returncode}); full log: {log}')


def build(directory, env):
    directory.mkdir(parents=True, exist_ok=False)
    # One formal model gate per pair, before either APK. No skip-gate release mode.
    initial = source_digest()
    run(['pnpm', 'qa:exam'], directory / 'exam-tests.log', env)
    run(['python3', 'scripts/build-assessment-bank.py', '--check'], directory / 'exam-bank.log', env)
    run(['bash', str(ROOT / 'finetuning/eval/harness/run-harness.sh')], directory / 'regression.log',
        {**env, 'JSON_OUT': str(directory / 'regression.json')}, ROOT)
    try:
        run(['node', '-e', "require('./scripts/qvac-android-x64.cjs').verifiedPort()"], directory / 'qvac-check.log', env)
    except RuntimeError:
        run(['node', 'scripts/build-qvac-android-x64.mjs'], directory / 'qvac-build.log', env)
    artifacts = {}
    for platform in PLATFORMS:
        if source_digest() != initial:
            raise RuntimeError('App inputs changed during this build; rerun the complete pair')
        target = directory / platform
        target.mkdir()
        current = {**env, 'HIRAIA_APK_VARIANT': platform}
        run(['pnpm', 'exec', 'expo', 'prebuild', '--platform', 'android', '--no-install'], target / 'prebuild.log', current)
        run(['node', 'scripts/post-prebuild.mjs'], target / 'post-prebuild.log', current)
        run(['bash', 'scripts/build-apk-single.sh'], target / 'build.log', current)
        run(['bash', 'scripts/sign-apk.sh'], target / 'sign.log', current)
        unsigned = MOBILE / 'android/app/build/outputs/apk/release/app-release.apk'
        # Filename is generated from the same declared platform table by sign-apk.sh.
        from app_artifacts import filename
        version = json.loads((MOBILE / 'app.json').read_text())['expo']['version']
        signed = unsigned.parent / filename(version, platform)
        metadata = measure(signed, platform)
        shutil.copyfile(signed, target / metadata['filename'])
        metadata['path'] = f"{platform}/{metadata['filename']}"
        artifacts[platform] = metadata
        run(['pnpm', 'exec', 'expo-updates', 'fingerprint:generate', '--platform', 'android'],
            target / 'fingerprint.json', current)
        if json.loads((target / 'fingerprint.json').read_text())['hash'] != metadata['runtime']:
            raise RuntimeError('Saved fingerprint differs from the signed APK')
        if source_digest() != initial:
            raise RuntimeError('App inputs changed during this build; neither package is releasable')
        print(f"== {platform}: signed and verified, {metadata['bytes']:,} bytes", flush=True)
    manifest = {'schema': 1, 'complete': True, 'builtAt': dt.datetime.now(dt.timezone.utc).isoformat(),
                'gitCommit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
                'sourceSha256': initial, 'artifacts': artifacts}
    validate_pair(manifest, directory)
    (directory / 'release.json').write_text(json.dumps(manifest, indent=2) + '\n')
    # Update this pointer only after BOTH builds, signatures and archives passed.
    pointer = directory.parent / 'latest.json'
    temporary = directory.parent / '.latest.json.tmp'
    temporary.write_text(json.dumps({'manifest': str(directory / 'release.json')}, indent=2) + '\n')
    temporary.replace(pointer)
    print(f'== Complete Android + ChromeOS build: {directory / "release.json"}', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, help='new output directory; never overwritten')
    args = parser.parse_args()
    if os.environ.get('EXPO_PUBLIC_ASSESSMENT_EVALUATION') == '1':
        parser.error('Private assessment evaluation is not a public platform release')
    if os.environ.get('INSTALL') == '1':
        parser.error('Build both first, then install the signed platform APK with an explicit adb -s device')
    env = {**os.environ}
    env.pop('HIRAIA_APK_VARIANT', None)
    if not env.get('JAVA_HOME') and Path('/opt/homebrew/opt/openjdk@17').exists():
        env['JAVA_HOME'] = '/opt/homebrew/opt/openjdk@17'
    if not env.get('ANDROID_HOME'):
        for sdk in [Path.home() / 'Library/Android/sdk', Path.home() / 'Android/Sdk']:
            if sdk.is_dir():
                env['ANDROID_HOME'] = str(sdk)
                break
    directory = (args.output or ROOT / 'build/app-releases' / dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ')).resolve()
    lock_dir = ROOT / 'build/app-releases'
    lock_dir.mkdir(parents=True, exist_ok=True)
    with (lock_dir / '.build.lock').open('w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            parser.error('Another platform build owns this checkout; do not share generated android/')
        build(directory, env)


if __name__ == '__main__':
    main()
