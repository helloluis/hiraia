#!/usr/bin/env python3
"""Stage an immutable macOS provisioner release, then activate it after all-platform validation.

No enrollment identity is created or replaced. A staged release does not serve phones.
"""
from __future__ import annotations
import argparse
import datetime as dt
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys
import tempfile

import server

REPO = Path(__file__).resolve().parents[3]
LABEL = 'com.hiraia.provisioner'
SETUP_CERT = '321aad0ae3ee615ba30aa7ba514be6f1f7bcdb2c4aaec1dc9aa8d02dba304fed'
SOURCES = (
    'packages/provisioner/server/server.py',
    'packages/provisioner/server/server.py.lock',
    'packages/mobile/src/config/modelAssets.json',
    'packages/mobile/assets/voices/catalog.json',
    'packages/mobile/src/generated/imagePacks.generated.json',
    'packages/web/src/config/asset-updates.json',
)


def sha(path: Path) -> str:
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def validate_full_release(pair: dict, full: dict) -> None:
    # Use the release pipeline's existing exam, native CPU and voice validation.
    sys.path.insert(0, str(REPO / 'deploy'))
    spec = importlib.util.spec_from_file_location('combine_apps', REPO / 'deploy/combine-app-artifacts.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    if full.get('schema') != 2 or full.get('complete') is not True:
        raise ValueError('activation needs the complete Android, ChromeOS and Windows manifest')
    items = full.get('artifacts', {})
    if set(items) != {'android', 'chromeos', 'windows'}:
        raise ValueError('activation needs all three platforms')
    if full.get('gitCommit') != pair.get('gitCommit') or any(
            items[k] != pair['artifacts'][k] for k in ('android', 'chromeos')):
        raise ValueError('all-platform evidence does not describe this exact APK pair')
    module.combine(pair, {'schema': 1, 'complete': True, 'gitCommit': full['gitCommit'],
                          'artifacts': {'windows': items['windows']}})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pair', type=Path, required=True, help='verified paired-APK release.json')
    parser.add_argument('--dpc-apk', type=Path, required=True)
    parser.add_argument('--all-platforms', type=Path, help='complete three-platform manifest; required to activate')
    parser.add_argument('--activate', action='store_true', help='install the LaunchAgent and start serving')
    parser.add_argument('--data-dir', type=Path, default=Path.home() / '.hiraia/provisioning')
    parser.add_argument('--mirror-dir', type=Path, default=Path.home() / '.hiraia/mirror')
    parser.add_argument('--service-dir', type=Path, default=Path.home() / '.hiraia/provisioner')
    args = parser.parse_args()
    if sys.platform != 'darwin':
        parser.error('this installer uses macOS LaunchAgents')
    if args.activate and args.all_platforms is None:
        parser.error('--activate requires --all-platforms; staging alone does not offer the APK')
    pair_path = args.pair.expanduser().resolve()
    pair = json.loads(pair_path.read_text())
    if args.all_platforms:
        validate_full_release(pair, json.loads(args.all_platforms.read_text()))
    sys.path.insert(0, str(REPO / 'deploy'))
    from app_artifacts import validate_pair, android_tool
    artifacts = validate_pair(pair, pair_path.parent)
    dpc_path = args.dpc_apk.expanduser().resolve()
    dpc = server.Dpc.load(dpc_path)
    signing_env = dict(os.environ)
    signing_env.setdefault('JAVA_HOME', '/opt/homebrew/opt/openjdk@17')
    subprocess.run([android_tool('apksigner'), 'verify', str(dpc_path)], env=signing_env, check=True)
    if server.apk_manifest(dpc.data).package != server.DPC_PACKAGE:
        parser.error('the DPC must be com.hiraia.provisioner')
    if dpc.signer_sha256 != SETUP_CERT or dpc.version_code < 9:
        parser.error('use the established Setup signing key and version 0.4.4 (9) or newer')
    data, mirror, service = [p.expanduser().resolve() for p in (args.data_dir, args.mirror_dir, args.service_dir)]
    for name in ('provisioning.db', 'tls-cert.pem', 'tls-key.pem', 'token', 'receipt-key', 'issued.log'):
        if not (data / name).is_file():
            parser.error(f'existing fleet identity is incomplete: {name}; restore it before activation')
    assets = server.known_assets()
    required = server.known_assets(False)
    content = server.Mirror.load(mirror, assets, required)
    missing = [item.name for item in required if item.name not in content.files]
    content.close()
    if missing:
        parser.error('incomplete mirror: ' + ', '.join(missing))
    uv = shutil.which('uv') or str(Path.home() / '.local/bin/uv')
    if not Path(uv).is_file():
        parser.error('uv is required; install its locked script environment before activation')
    files = {name: REPO / name for name in SOURCES}
    files.update({'artifacts/hiraia.apk': pair_path.parent / artifacts['android']['path'],
                  'artifacts/setup.apk': dpc_path, 'evidence/apk-pair.json': pair_path})
    if args.all_platforms:
        files['evidence/all-platforms.json'] = args.all_platforms.resolve()
    pins = {name: {'sha256': sha(path), 'bytes': path.stat().st_size} for name, path in files.items()}
    identity = hashlib.sha256(json.dumps(pins, sort_keys=True).encode()).hexdigest()
    service.mkdir(parents=True, mode=0o700, exist_ok=True)
    releases = service / 'releases'; releases.mkdir(mode=0o700, exist_ok=True)
    capsule = releases / f"{artifacts['android']['versionName']}-{identity[:16]}"
    if not capsule.exists():
        temporary = Path(tempfile.mkdtemp(prefix='.stage-', dir=releases))
        try:
            for name, source in files.items():
                target = temporary / name; target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(source, target); target.chmod(0o600)
                if sha(target) != pins[name]['sha256']:
                    raise ValueError(f'copy verification failed: {name}')
            (temporary / 'manifest.json').write_text(json.dumps({'schema': 1, 'files': pins}, indent=2) + '\n')
            temporary.rename(capsule)
        finally:
            if temporary.exists(): shutil.rmtree(temporary)
    for name, pin in pins.items():
        if sha(capsule / name) != pin['sha256']:
            raise ValueError(f'previously staged release changed: {name}')
    logs = service / 'logs'; logs.mkdir(mode=0o700, exist_ok=True)
    for name in ('stdout.log', 'stderr.log'):
        path = logs / name; path.touch(mode=0o600, exist_ok=True); path.chmod(0o600)
    command = ['/usr/bin/caffeinate', '-i', uv, 'run', '--no-project', '--script', '--locked', '--offline',
               str(capsule / SOURCES[0]), '--data-dir', str(data), '--mirror-dir', str(mirror),
               '--dpc-apk', str(capsule / 'artifacts/setup.apk'), '--hiraia-apk', str(capsule / 'artifacts/hiraia.apk'),
               '--require-complete-mirror', '--min-dpc-version-for-hiraia', '9']
    plist = {'Label': LABEL, 'ProgramArguments': command, 'WorkingDirectory': str(capsule),
             'RunAtLoad': True, 'KeepAlive': {'SuccessfulExit': False}, 'ThrottleInterval': 30,
             'ProcessType': 'Background', 'Nice': 10,
             'EnvironmentVariables': {'PYTHONUNBUFFERED': '1', 'UV_PYTHON_DOWNLOADS': 'never',
                                     'PATH': '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'},
             'StandardOutPath': str(logs / 'stdout.log'), 'StandardErrorPath': str(logs / 'stderr.log')}
    staged_plist = capsule / f'{LABEL}.plist'
    # Service paths are deployment metadata, separate from the immutable source/artifact pins.
    encoded = plistlib.dumps(plist)
    if staged_plist.exists() and staged_plist.read_bytes() != encoded:
        raise ValueError('staged service configuration differs; use a separate service directory')
    staged_plist.write_bytes(encoded)
    result = {'staged': str(capsule), 'activated': False, 'hiraia': artifacts['android'],
              'setup_version_code': dpc.version_code, 'identity_preserved': str(data),
              'dashboard': 'http://127.0.0.1:8080/', 'plist': str(staged_plist)}
    if args.activate:
        destination = Path.home() / 'Library/LaunchAgents' / staged_plist.name
        destination.parent.mkdir(parents=True, exist_ok=True)
        old = destination.read_bytes() if destination.exists() else None
        domain = f'gui/{os.getuid()}'
        loaded = subprocess.run(['launchctl', 'print', f'{domain}/{LABEL}'], capture_output=True).returncode == 0
        if old:
            backup = service / f"launchagent-before-{dt.datetime.now():%Y%m%dT%H%M%S}.plist"
            backup.write_bytes(old)
        if loaded: subprocess.run(['launchctl', 'bootout', f'{domain}/{LABEL}'], check=True)
        destination.write_bytes(encoded); destination.chmod(0o600)
        try:
            subprocess.run(['plutil', '-lint', str(destination)], check=True)
            subprocess.run(['launchctl', 'bootstrap', domain, str(destination)], check=True)
        except subprocess.CalledProcessError:
            if old:
                destination.write_bytes(old)
                if loaded: subprocess.run(['launchctl', 'bootstrap', domain, str(destination)], check=True)
            else: destination.unlink(missing_ok=True)
            raise
        result['activated'] = True
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
