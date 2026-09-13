#!/usr/bin/env python3
"""Verify every selected illustration in the actual APK, including byte identity."""
import hashlib
import json
from pathlib import Path
import sys
import zipfile

mobile = Path(__file__).resolve().parent.parent
rows = json.loads((mobile / 'android/app/build/generated/illustrationAssets-manifest.json').read_text())
expected = {f"assets/illustrations/{r['slug']}.png": r for r in rows}
with zipfile.ZipFile(sys.argv[1]) as apk:
    actual = {n for n in apk.namelist() if n.startswith('assets/illustrations/') and not n.endswith('/')}
    assert actual == set(expected), f'Illustration inventory mismatch: missing={len(set(expected)-actual)}, extra={len(actual-set(expected))}'
    for name, row in expected.items():
        data = apk.read(name)
        assert len(data) == row['bytes'] and hashlib.sha256(data).hexdigest() == row['sha256'], name
    duplicate = [n for n in apk.namelist() if n.startswith('res/') and ('images_cardspng_' in n or 'images_assetspng_' in n)]
    assert not duplicate, f'Legacy Metro illustrations still packaged: {len(duplicate)}'
print(f'APK illustrations verified: {len(rows)} images, exact inventory and SHA-256 equality')
