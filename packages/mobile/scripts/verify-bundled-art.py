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
selection = json.loads((mobile / 'src/config/bundled-art.selection.json').read_text())
assert set(selection['keep']) == {row['slug'] for row in rows}, 'Stale bundled art selection'
assert len(rows) == selection['approvedImages'] and sum(r['bytes'] for r in rows) <= selection['budgetBytes']
with zipfile.ZipFile(sys.argv[1]) as apk:
    actual = {n for n in apk.namelist() if n.startswith('assets/illustrations/') and not n.endswith('/')}
    assert actual == set(expected), f'Illustration inventory mismatch: missing={len(set(expected)-actual)}, extra={len(actual-set(expected))}'
    for name, row in expected.items():
        data = apk.read(name)
        assert len(data) == row['bytes'] and hashlib.sha256(data).hexdigest() == row['sha256'], name
    duplicate = [n for n in apk.namelist() if n.startswith('res/') and ('images_cardspng_' in n or 'images_assetspng_' in n)]
    assert not duplicate, f'Legacy Metro illustrations still packaged: {len(duplicate)}'
    voices = json.loads((mobile / 'assets/voices/catalog.json').read_text())['voices']
    expected_voices = {v['sha256'] for v in voices.values() if v['delivery'] == 'bundled'}
    actual_voices = [hashlib.sha256(apk.read(name)).hexdigest() for name in apk.namelist() if name.endswith('.onnx')]
    assert len(actual_voices) == len(expected_voices) and set(actual_voices) == expected_voices, 'APK contains missing, stale, or download-only voice weights'
    # Resource shrinking renames cards.db: identify the exact compiled text database by bytes.
    database_digest = hashlib.sha256((mobile / 'assets/data/cards.db').read_bytes()).hexdigest()
    assert database_digest in {hashlib.sha256(apk.read(n)).hexdigest() for n in apk.namelist() if n.endswith('.db')}, 'Bundled text database is missing or stale'
print(f'APK illustrations verified: {len(rows)} images, exact inventory and SHA-256 equality')
print('APK voice inventory and complete bundled text database verified')
