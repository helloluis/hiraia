"""Offline release-metadata tests; no uploads or provider requests."""
import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('app_update', Path(__file__).with_name('prepare-app-update.py'))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class Remote(io.BytesIO):
    url = release.CDN + 'tested.gguf'


class ReleaseTests(unittest.TestCase):
    def test_remote_readback_rejects_truncation_corruption_and_redirects(self):
        body = b'tested weights'
        digest = hashlib.sha256(body).hexdigest()
        with patch.object(release.urllib.request, 'urlopen', return_value=Remote(body)):
            release.verify_remote(Remote.url, len(body), digest)
        for data in [body[:-1], body + b'extra', b'x' * len(body)]:
            with patch.object(release.urllib.request, 'urlopen', return_value=Remote(data)):
                with self.assertRaises(ValueError):
                    release.verify_remote(Remote.url, len(body), digest)
        response = Remote(body)
        response.url = 'https://another.example/model'
        with patch.object(release.urllib.request, 'urlopen', return_value=response):
            with self.assertRaises(ValueError):
                release.verify_remote(Remote.url, len(body), digest)

    def test_model_candidate_is_measured_and_never_overwrites_current_catalog(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            artifact, catalog, output = root/'tested.gguf', root/'catalog.json', root/'candidate.json'
            body = b'tested weights'
            artifact.write_bytes(body)
            previous = {'format': 1, 'revision': 4, 'imageBaseline': 'test-baseline', 'models': [], 'imagePacks': []}
            catalog.write_text(json.dumps(previous))
            args = ['prepare', 'model', str(artifact), '--catalog', str(catalog), '--output', str(output), '--min-app', '17', '--max-app', '18']
            with patch('sys.argv', args), patch.object(release.urllib.request, 'urlopen', return_value=Remote(body)), contextlib.redirect_stdout(io.StringIO()):
                release.main()
            result = json.loads(output.read_text())
            self.assertEqual(result['revision'], 5)
            self.assertEqual(result['models'][0]['bytes'], len(body))
            self.assertEqual(result['models'][0]['md5'], hashlib.md5(body).hexdigest())
            self.assertEqual(json.loads(catalog.read_text()), previous)
            with patch('sys.argv', args), contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                release.main()
            output.unlink()
            with patch('sys.argv', args), patch.object(release.urllib.request, 'urlopen', return_value=Remote(b'bad')), self.assertRaises(ValueError):
                release.main()
            self.assertFalse(output.exists(), 'Never announce a missing or mismatched remote artifact')

    def test_tala_candidate_uses_apk_identity_and_verified_remote_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            artifact, output = root/'signed.apk', root/'tala.json'
            artifact.write_bytes(b'apk-fixture')
            args = ['prepare', 'tala', str(artifact), '--output', str(output), '--aapt', '/fake/aapt']
            with patch('sys.argv', args), patch.object(release.subprocess, 'check_output', return_value="package: name='com.hiraia.tala' versionCode='16' versionName='0.7.6'"), patch.object(release.urllib.request, 'urlopen', return_value=Remote(b'apk-fixture')), contextlib.redirect_stdout(io.StringIO()):
                release.main()
            app = json.loads(output.read_text())['app']
            self.assertEqual(app['url'], release.CDN + 'tala-v0p7p6.apk')
            self.assertEqual(app['versionCode'], 16)
            self.assertEqual(app['sha256'], hashlib.sha256(b'apk-fixture').hexdigest())


if __name__ == '__main__':
    unittest.main()
