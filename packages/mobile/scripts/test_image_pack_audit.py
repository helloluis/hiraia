import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('coverage_audit', Path(__file__).with_name('audit-image-packs.py'))
audit_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit_module)


class ImageCoverageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.generated = 'packages/mobile/src/generated/'
        self.write(self.generated + 'cardsIndex.generated.json', {'cards': [
            {'id': 'fish', 'factId': 'fish-g4', 'slug': 'fish'},
            {'id': 'text', 'factId': 'text-g3', 'slug': ''},
        ]})
        self.write(self.generated + 'curriculumTags.generated.json', {'fish': ['G3', 3, 1, 1, [[9, 1, 1, 1]]]})
        self.write(self.generated + 'bundledArt.generated.json', {'images': []})
        self.png = b'\x89PNG\r\n\x1a\nexample-original-image'
        self.row = {'slug': 'fish', 'bytes': len(self.png), 'md5': hashlib.md5(self.png).hexdigest()}
        self.write('rag/pipeline/art-shards/index.json', {'tail': {'images': 1}, 'shards': [{'file': 'fish.json'}]})
        self.write('rag/pipeline/art-shards/fish.json', {'images': [self.row]})
        self.pack_dir = self.root / 'packs'
        self.pack_dir.mkdir()
        self.manifest = self.root / 'manifest.json'

    def write(self, name, value):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value))

    def package(self, cell):
        header = json.dumps({'images': [self.row]}).encode()
        data = b'HIRAIMG1' + struct.pack('<I', len(header)) + header + self.png
        (self.pack_dir / 'fish.hpak').write_bytes(data)
        self.write('manifest.json', {'version': 'fixture', 'packs': [{
            'id': 'fish-pack', 'cell': cell, 'filename': 'fish.hpak', 'images': 1,
            'bytes': len(data), 'unpackedBytes': len(self.png),
            'sha256': hashlib.sha256(data).hexdigest(), 'md5': hashlib.md5(data).hexdigest(),
        }]})

    def audit(self):
        return audit_module.audit(self.root, self.manifest, self.pack_dir)

    def test_cross_grade_reuse_requires_common_delivery(self):
        self.package('g4-all')
        before = self.audit()
        self.assertFalse(before['ok'])
        self.assertEqual([r['grade'] for r in before['grades'] if r['missing_images']], [3, 9])
        self.package('common')
        after = self.audit()
        self.assertTrue(after['ok'])
        self.assertEqual(after['text_only_cards'], 1)

    def test_image_missing_from_all_packs_cannot_be_silently_skipped(self):
        self.write('manifest.json', {'version': 'fixture', 'packs': []})
        report = self.audit()
        self.assertFalse(report['ok'])
        self.assertEqual(report['corpus_images_missing_from_delivery'], ['fish'])
        self.assertEqual([r['grade'] for r in report['grades'] if r['missing_images']], [3, 4, 9])

    def test_corrupt_pack_is_rejected_before_coverage_is_reported(self):
        self.package('common')
        with (self.pack_dir / 'fish.hpak').open('ab') as f:
            f.write(b'corruption')
        with self.assertRaisesRegex(ValueError, 'checksum/size mismatch'):
            self.audit()

    def test_multigrade_suffix_keeps_grade_ten_whole(self):
        self.assertEqual(audit_module.card_grades({'id': 'a', 'factId': 'a-g10'}, {}), {10})
        self.assertEqual(audit_module.card_grades({'id': 'a', 'factId': 'a-g345'}, {}), {3, 4, 5})


if __name__ == '__main__':
    unittest.main()
