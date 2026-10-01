import copy
import importlib.util
import json
from pathlib import Path
import runpy
import sys
import tempfile
import unittest
from unittest.mock import patch
from app_artifacts import CERT

spec = importlib.util.spec_from_file_location('combine_apps', Path(__file__).with_name('combine-app-artifacts.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class AllPlatforms(unittest.TestCase):
    def setUp(self):
        commit = 'a' * 40
        base = {'schema': 1, 'complete': True, 'gitCommit': commit}
        artifact = {'versionName': '0.4.27', 'versionCode': 27, 'bytes': 500, 'sha256': 'b' * 64}
        self.apks = {**base, 'artifacts': {p: {**artifact, 'platform': p, 'runtime': p, 'signingCertSha256': CERT} for p in ['android', 'chromeos']}}
        validation = {'passed': True, 'packaged': True, 'gitCommit': commit, 'platform': 'win32', 'arch': 'x64',
                      'exam': {'questions': 12, 'completed': True, 'resumed': True, 'history': True, 'keyboard': True, 'zoom': True, 'carousel': True, 'outOfOrder': True, 'screenReader': True},
                      'native': {'stats': {'backendDevice': 'cpu'}, 'embeddingDimensions': 768}, 'voices': {'en': {}, 'tl': {}}}
        self.windows = {**base, 'artifacts': {'windows': {**artifact, 'platform': 'windows', 'validation': validation}}}

    def test_requires_every_edition_and_one_source(self):
        self.assertEqual(set(module.combine(self.apks, self.windows)['artifacts']), {'android', 'chromeos', 'windows'})
        for mutate in [lambda a, w: a.update(complete=False), lambda a, w: a['artifacts'].pop('chromeos'),
                       lambda a, w: w.update(gitCommit='c' * 40), lambda a, w: w['artifacts']['windows'].update(versionCode=28)]:
            a, w = copy.deepcopy(self.apks), copy.deepcopy(self.windows)
            mutate(a, w)
            with self.assertRaises(ValueError): module.combine(a, w)

    def test_cli_preserves_utf8_evidence_under_a_windows_legacy_locale(self):
        # Reproduce the actual Windows runner's cp1252 default without requiring
        # that locale to be installed on the Mac that gates all three builds.
        original_open = Path.open
        def windows_open(path, mode='r', buffering=-1, encoding=None, errors=None, newline=None):
            if 'b' not in mode and encoding in (None, 'locale'):
                encoding = 'cp1252'
            return original_open(path, mode, buffering, encoding, errors, newline)
        checks = ['900\u00d7600 window', 'Learner Jos\u00e9 data']
        self.windows['artifacts']['windows']['validation']['checks'] = checks
        with tempfile.TemporaryDirectory() as temp:
            a, w, out = [Path(temp) / name for name in ['apks.json', 'windows.json', 'all.json']]
            for path, value in [(a, self.apks), (w, self.windows)]:
                path.write_text(json.dumps(value, ensure_ascii=False), encoding='utf-8')
            script = str(Path(__file__).with_name('combine-app-artifacts.py'))
            with patch.object(Path, 'open', windows_open), patch.object(sys, 'argv', [script, str(a), str(w), str(out)]):
                runpy.run_path(script, run_name='__main__')
            actual = json.loads(out.read_text(encoding='utf-8'))
            self.assertEqual(actual['artifacts']['windows']['validation']['checks'], checks)

    def test_rejects_unverified_windows_or_wrong_android_identity(self):
        for mutate in [lambda a, w: w['artifacts']['windows']['validation'].update(passed=False),
                       lambda a, w: w['artifacts']['windows']['validation'].update(packaged=False),
                       lambda a, w: w['artifacts']['windows']['validation'].pop('exam'),
                       lambda a, w: w['artifacts']['windows']['validation']['exam'].update(resumed=False),
                       lambda a, w: w['artifacts']['windows']['validation']['exam'].update(carousel=False),
                       lambda a, w: w['artifacts']['windows']['validation']['exam'].update(outOfOrder=False),
                       lambda a, w: w['artifacts']['windows']['validation']['voices'].pop('tl'),
                       lambda a, w: a['artifacts']['android'].update(signingCertSha256='wrong')]:
            a, w = copy.deepcopy(self.apks), copy.deepcopy(self.windows)
            mutate(a, w)
            with self.assertRaises(ValueError): module.combine(a, w)
