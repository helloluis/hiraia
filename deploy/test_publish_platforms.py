import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('publisher', Path(__file__).with_name('publish-release-assets.py'))
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)


class PairPublishingTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.directory = Path(self.tmp.name)
        self.manifest = self.directory / 'release.json'
        self.manifest.write_text('{}')
        self.output = self.directory / 'candidate.json'
        self.artifacts = {p: dict(platform=p, path=f'{p}/app.apk', filename=f'{p}.apk',
            bytes=100, sha256=p, md5='a'*32, runtime=str(i)*40, signingCertSha256='b'*64,
            versionCode=27, versionName='0.4.27', abis=publisher.PLATFORMS[p]['abis'])
            for i,p in enumerate(publisher.PLATFORMS)}

    def tearDown(self): self.tmp.cleanup()

    def test_second_platform_immutable_collision_prevents_all_uploads(self):
        with patch.object(publisher, 'validate_pair', return_value=self.artifacts), \
             patch.object(publisher, 'ensure_immutable', side_effect=[None, ValueError('immutable collision')]), \
             patch.object(publisher, 'upload') as upload:
            with self.assertRaisesRegex(ValueError, 'immutable collision'):
                publisher.publish_pair(None, {}, self.manifest, self.output)
            upload.assert_not_called()
            self.assertFalse(self.output.exists())

    def test_second_upload_failure_cannot_update_aliases_or_emit_a_catalog(self):
        with patch.object(publisher, 'validate_pair', return_value=self.artifacts), \
             patch.object(publisher, 'ensure_immutable'), \
             patch.object(publisher, 'head_public'), \
             patch.object(publisher, 'upload', side_effect=[None, ValueError('read-back failed')]) as upload:
            with self.assertRaisesRegex(ValueError, 'read-back failed'):
                publisher.publish_pair(None, {}, self.manifest, self.output)
            self.assertEqual(upload.call_count, 2)
            self.assertFalse(self.output.exists())

    def test_success_has_separate_platform_urls_aliases_and_measured_catalog(self):
        with patch.object(publisher, 'validate_pair', return_value=self.artifacts), \
             patch.object(publisher, 'ensure_immutable'), patch.object(publisher, 'head_public'), \
             patch.object(publisher, 'purge'), patch.object(publisher, 'upload') as upload:
            publisher.publish_pair(None, {}, self.manifest, self.output)
            keys = [call.args[1] for call in upload.call_args_list]
            self.assertEqual(keys, ['models/android.apk', 'models/chromeos.apk',
                                    'models/hiraia.apk', 'models/hiraia-chromeos.apk'])
            catalog = json.loads(self.output.read_text())['platforms']
            for platform in self.artifacts:
                self.assertEqual(catalog[platform]['platform'], platform)
                self.assertEqual(catalog[platform]['url'], publisher.PUBLIC+f'/models/{platform}.apk')
                self.assertEqual(catalog[platform]['sha256'], self.artifacts[platform]['sha256'])


if __name__ == '__main__': unittest.main()
