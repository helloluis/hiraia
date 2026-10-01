#!/usr/bin/env python3
"""Join verified CI manifests; incomplete or mixed-source builds never become a set.

The Mac job measures both signed APKs; the Windows job measures the tested ZIP.
This index references those immutable CI artifacts. It does not publish anything.
"""
import json
from pathlib import Path
import re
import sys
from app_artifacts import CERT


def combine(android, windows):
    if not all(m.get('schema') == 1 and m.get('complete') is True for m in [android, windows]):
        raise ValueError('Both platform builds must be complete')
    commit = android.get('gitCommit', '')
    if not re.fullmatch(r'[a-f0-9]{40}', commit) or windows.get('gitCommit') != commit:
        raise ValueError('All platforms must come from the same commit')
    apks, desktop = android.get('artifacts', {}), windows.get('artifacts', {})
    if set(apks) != {'android', 'chromeos'} or set(desktop) != {'windows'}:
        raise ValueError('Exactly Android, ChromeOS and Windows are required')
    artifacts = {**apks, **desktop}
    versions = {(item.get('versionName'), item.get('versionCode')) for item in artifacts.values()}
    if len(versions) != 1 or None in next(iter(versions)):
        raise ValueError('Platform versions differ')
    for platform, item in artifacts.items():
        if item.get('platform') != platform or not re.fullmatch(r'[a-f0-9]{64}', item.get('sha256', '')) or item.get('bytes', 0) <= 0:
            raise ValueError('Invalid artifact identity or digest')
    if any(item.get('signingCertSha256') != CERT for item in apks.values()):
        raise ValueError('Android signing identity differs')
    if apks['android'].get('runtime') == apks['chromeos'].get('runtime'):
        raise ValueError('Android and ChromeOS require separate OTA runtimes')
    test = desktop['windows'].get('validation', {})
    exam = test.get('exam', {})
    if exam.get('questions') != 12 or not all(exam.get(check) is True for check in ['completed', 'resumed', 'history', 'keyboard', 'zoom']):
        raise ValueError('Windows must include a tested twelve-question exam')
    if not (test.get('passed') and test.get('packaged') and test.get('gitCommit') == commit and
            test.get('platform') == 'win32' and test.get('arch') == 'x64' and
            test.get('native', {}).get('stats', {}).get('backendDevice') == 'cpu' and
            test.get('native', {}).get('embeddingDimensions') == 768 and
            set(test.get('voices', {})) == {'en', 'tl'}):
        raise ValueError('Packaged Windows validation is incomplete')
    return {'schema': 2, 'complete': True, 'gitCommit': commit, 'artifacts': artifacts,
            'ciArtifacts': {platform: f'hiraia-{platform if platform == "windows" else "android-chromeos"}-{commit}' for platform in artifacts}}


if __name__ == '__main__':
    pair, desktop, output = map(Path, sys.argv[1:])
    result = combine(json.loads(pair.read_text()), json.loads(desktop.read_text()))
    output.write_text(json.dumps(result, indent=2) + '\n')
    print(f'Complete three-platform build: {output}')
