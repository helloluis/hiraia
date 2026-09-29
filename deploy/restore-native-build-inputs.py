#!/usr/bin/env python3
"""Restore a provisioned runner's private build inputs; never prints credentials."""
import json
import os
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
FILES = [
    'packages/mobile/assets/voices/en/model.onnx',
    'packages/mobile/assets/voices/tl/model.onnx',
    'deploy/models/hiraia-sft-2b-v2.Q4_K_M.gguf',
    'deploy/models/labse.Q4_K_M.gguf',
    'packages/mobile/credentials.json',
    'packages/mobile/keystores/release.jks',
]


def restore(directory):
    directory = directory.resolve()
    if directory == ROOT or ROOT in directory.parents:
        raise ValueError('Private inputs must live outside the disposable Actions checkout')
    missing = [name for name in FILES if not (directory / name).is_file()]
    if missing:
        raise ValueError('Runner lacks required inputs: ' + ', '.join(missing))
    credentials = json.loads((directory / 'packages/mobile/credentials.json').read_text())
    if credentials['android']['keystore']['keystorePath'] != 'keystores/release.jks':
        raise ValueError('Runner credentials must use the relative keystores/release.jks path')
    for name in FILES:
        target = ROOT / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(directory / name, target)
        if name.endswith(('.jks', 'credentials.json')):
            target.chmod(0o600)
    subprocess.run(['node', 'scripts/verify-voices.mjs'], cwd=ROOT / 'packages/mobile', check=True)
    # The first run may use a locally provisioned native cache. Future runs use
    # Actions cache; changed pins force the canonical source build instead.
    seed = directory / 'build/qvac-android-x64'
    target = ROOT / 'build/qvac-android-x64'
    pin = json.loads((ROOT / 'packages/mobile/native/qvac-android-x64.json').read_text())
    if not (target / 'manifest.json').exists() and (seed / 'manifest.json').is_file():
        manifest = json.loads((seed / 'manifest.json').read_text())
        if manifest.get('pin') == pin:
            for name in ['x86_64', 'notices']:
                shutil.copytree(seed / name, target / name, dirs_exist_ok=True)
            shutil.copyfile(seed / 'manifest.json', target / 'manifest.json')
            subprocess.run(['node', '-e', "require('./scripts/qvac-android-x64.cjs').verifiedPort()"],
                           cwd=ROOT / 'packages/mobile', check=True)
    print('Native inputs restored; voice SHA-256 pins verified. Signing identity is checked by the build.')


if __name__ == '__main__':
    value = os.environ.get('HIRAIA_BUILD_INPUTS_DIR')
    if not value:
        raise SystemExit('Set HIRAIA_BUILD_INPUTS_DIR to the provisioned runner inputs directory')
    restore(Path(value))
