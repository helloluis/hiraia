import copy
import importlib.util
from pathlib import Path
import unittest
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
                      'exam': {'questions': 12, 'completed': True, 'resumed': True, 'history': True, 'keyboard': True, 'zoom': True},
                      'native': {'stats': {'backendDevice': 'cpu'}, 'embeddingDimensions': 768}, 'voices': {'en': {}, 'tl': {}}}
        self.windows = {**base, 'artifacts': {'windows': {**artifact, 'platform': 'windows', 'validation': validation}}}

    def test_requires_every_edition_and_one_source(self):
        self.assertEqual(set(module.combine(self.apks, self.windows)['artifacts']), {'android', 'chromeos', 'windows'})
        for mutate in [lambda a, w: a.update(complete=False), lambda a, w: a['artifacts'].pop('chromeos'),
                       lambda a, w: w.update(gitCommit='c' * 40), lambda a, w: w['artifacts']['windows'].update(versionCode=28)]:
            a, w = copy.deepcopy(self.apks), copy.deepcopy(self.windows)
            mutate(a, w)
            with self.assertRaises(ValueError): module.combine(a, w)

    def test_rejects_unverified_windows_or_wrong_android_identity(self):
        for mutate in [lambda a, w: w['artifacts']['windows']['validation'].update(passed=False),
                       lambda a, w: w['artifacts']['windows']['validation'].update(packaged=False),
                       lambda a, w: w['artifacts']['windows']['validation'].pop('exam'),
                       lambda a, w: w['artifacts']['windows']['validation']['exam'].update(resumed=False),
                       lambda a, w: w['artifacts']['windows']['validation']['voices'].pop('tl'),
                       lambda a, w: a['artifacts']['android'].update(signingCertSha256='wrong')]:
            a, w = copy.deepcopy(self.apks), copy.deepcopy(self.windows)
            mutate(a, w)
            with self.assertRaises(ValueError): module.combine(a, w)
