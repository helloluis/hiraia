import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

import app_artifacts as artifacts


class ArtifactTests(unittest.TestCase):
    def test_platform_names_cannot_collide(self):
        self.assertEqual(artifacts.filename('0.4.27', 'android'), 'hiraia-v0p4p27.apk')
        self.assertEqual(artifacts.filename('0.4.27', 'chromeos'), 'hiraia-v0p4p27-chromeos.apk')
        for version, platform in [('../0.4.27', 'android'), ('0.4.27', 'unknown')]:
            with self.assertRaises(ValueError): artifacts.filename(version, platform)

    def test_archive_platform_and_actual_abis_must_agree(self):
        with tempfile.TemporaryDirectory() as temp:
            apk = Path(temp) / 'app.apk'
            def write(platform, abis):
                with zipfile.ZipFile(apk, 'w') as z:
                    z.writestr('assets/app.config', json.dumps({'extra': {'distributionPlatform': platform}}))
                    z.writestr('assets/fingerprint', 'a' * 40)
                    z.writestr('assets/index.android.bundle', b'hermes')
                    for abi in abis: z.writestr(f'lib/{abi}/libqvac.so', b'native')
            write('chromeos', ['arm64-v8a', 'x86_64'])
            self.assertEqual(artifacts.embedded_identity(apk)['platform'], 'chromeos')
            for platform, abis in [('chromeos', ['arm64-v8a']), ('android', ['x86_64']), (None, ['arm64-v8a'])]:
                write(platform, abis)
                with self.assertRaises(ValueError): artifacts.embedded_identity(apk)

    def test_incomplete_mixed_or_tampered_pairs_fail(self):
        measured = {p: {'platform': p, 'versionName': '0.4.27', 'versionCode': 27,
                       'runtime': str(i) * 40, 'sha256': p} for i, p in enumerate(artifacts.PLATFORMS)}
        manifest = {'schema': 1, 'complete': True, 'artifacts': {
            p: {**row, 'path': f'{p}/app.apk'} for p, row in measured.items()}}
        inspect = lambda file, platform: measured[platform]
        artifacts.validate_pair(manifest, Path('/build'), inspect)
        variants = []
        bad = copy.deepcopy(manifest); bad['complete'] = False; variants.append(bad)
        bad = copy.deepcopy(manifest); del bad['artifacts']['chromeos']; variants.append(bad)
        bad = copy.deepcopy(manifest); bad['artifacts']['chromeos']['sha256'] = 'tampered'; variants.append(bad)
        bad = copy.deepcopy(manifest); bad['artifacts']['chromeos']['path'] = '../app.apk'; variants.append(bad)
        for bad in variants:
            with self.assertRaises(ValueError): artifacts.validate_pair(bad, Path('/build'), inspect)
        for key, value in [('versionCode', 28), ('runtime', measured['android']['runtime'])]:
            changed = copy.deepcopy(measured); changed['chromeos'][key] = value
            modified = copy.deepcopy(manifest); modified['artifacts']['chromeos'][key] = value
            with self.assertRaises(ValueError):
                artifacts.validate_pair(modified, Path('/build'), lambda f, p: changed[p])


spec = importlib.util.spec_from_file_location('builder', artifacts.ROOT / 'packages/mobile/scripts/build-apps.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class BuildFailureTests(unittest.TestCase):
    def test_failed_regression_stops_before_any_platform_and_preserves_last_good_pair(self):
        with tempfile.TemporaryDirectory() as temp:
            parent = Path(temp)
            (parent / 'latest.json').write_text('last good release')
            with patch.object(builder, 'source_digest', return_value='source'), \
                 patch.object(builder, 'run', side_effect=RuntimeError('regression failed')) as run:
                with self.assertRaisesRegex(RuntimeError, 'regression failed'):
                    builder.build(parent / 'failed', {})
            self.assertEqual(run.call_count, 1)
            self.assertIn('run-harness.sh', run.call_args.args[0][1])
            self.assertFalse((parent / 'failed/release.json').exists())
            self.assertEqual((parent / 'latest.json').read_text(), 'last good release')

    def test_source_drift_stops_before_building(self):
        with tempfile.TemporaryDirectory() as temp, \
             patch.object(builder, 'source_digest', side_effect=['before', 'changed']), \
             patch.object(builder, 'run') as run:
            directory = Path(temp) / 'drift'
            with self.assertRaisesRegex(RuntimeError, 'inputs changed'):
                builder.build(directory, {})
            self.assertEqual(run.call_count, 2)  # regression and native cache verification only
            self.assertFalse((directory / 'release.json').exists())


if __name__ == '__main__': unittest.main()
