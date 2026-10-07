"""Activation must bind the offered APK to the same validated three-edition release."""
import copy
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

import install_service

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'deploy'))
from test_all_platforms import AllPlatforms, module as combination


class ActivationEvidence(unittest.TestCase):
    def setUp(self):
        fixture = AllPlatforms()
        fixture.setUp()
        self.pair = fixture.apks
        self.full = combination.combine(fixture.apks, fixture.windows)

    def test_same_validated_artifacts_are_accepted(self):
        install_service.validate_full_release(self.pair, self.full)

    def test_other_apk_bytes_or_commits_are_rejected(self):
        for change in (
            lambda m: m.update(gitCommit='c' * 40),
            lambda m: m['artifacts']['android'].update(sha256='d' * 64),
            lambda m: m['artifacts']['chromeos'].update(runtime='another-runtime'),
        ):
            bad = copy.deepcopy(self.full)
            change(bad)
            with self.assertRaisesRegex(ValueError, 'exact APK pair'):
                install_service.validate_full_release(self.pair, bad)

    def test_unvalidated_windows_cannot_activate_a_phone_release(self):
        for change in (
            lambda m: m['artifacts'].pop('windows'),
            lambda m: m['artifacts']['windows']['validation']['exam'].update(history=False),
            lambda m: m['artifacts']['windows']['validation'].update(packaged=False),
            lambda m: m['artifacts']['windows']['validation']['voices'].pop('tl'),
        ):
            bad = copy.deepcopy(self.full)
            change(bad)
            with self.assertRaises(ValueError):
                install_service.validate_full_release(self.pair, bad)

    def test_activation_without_evidence_fails_before_any_file_or_service_change(self):
        with patch.object(sys, 'argv', ['installer', '--pair', '/absent/release.json',
                                       '--dpc-apk', '/absent/setup.apk', '--activate']), \
                patch.object(install_service.sys, 'platform', 'darwin'), \
                patch.object(Path, 'read_text', side_effect=AssertionError('must reject before file access')):
            with self.assertRaises(SystemExit) as raised:
                install_service.main()
        self.assertEqual(raised.exception.code, 2)
