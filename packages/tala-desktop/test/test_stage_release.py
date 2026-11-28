import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('publisher', Path(__file__).parents[1] / 'scripts/stage-release.py')
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)

class PublicationTest(unittest.TestCase):
    def test_failure_retains_current_pair_and_rollback_restores_whole_set(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / 'public'
            def candidate(number):
                source = Path(tmp) / f'input-{number}'
                source.mkdir()
                m = dict(schemaVersion=1, release=f'tala-desktop-preview-{number}', sourceCommit=str(number) * 40,
                         version=f'0.1.{number}', electron='45.5.0', hostedOrigin='https://tala.hiraia.org', artifacts=[])
                for platform, arch in p.REQUIRED:
                    name = f'Tala-0.1.{number}-{platform}-{arch}.' + ('exe' if platform == 'win32' else 'dmg')
                    data = f'synthetic test {number}/{platform}/{arch}'.encode()
                    (source / name).write_bytes(data)
                    m['artifacts'].append(dict(m, artifacts=None, platform=platform, arch=arch, file=name, bytes=len(data), sha256=p.sha(data), sourceDirty=False))
                (source / 'desktop-release.json').write_text(json.dumps(m))
                return source
            def readback(url, length, digest):
                data = (root / url.removeprefix('https://downloads.example.test/')).read_bytes()
                if len(data) != length or p.sha(data) != digest:
                    raise ValueError('readback failed')
            first = p.stage(candidate(1), root)
            p.promote(root, first, 'https://downloads.example.test', 'absent', readback)
            previous = (root / 'desktop-latest.json').read_bytes()
            second = p.stage(candidate(2), root)
            def failed(*args):
                raise ValueError('controlled HTTPS failure')
            with self.assertRaisesRegex(ValueError, 'controlled HTTPS failure'):
                p.promote(root, second, 'https://downloads.example.test', p.sha(previous), failed)
            self.assertEqual((root / 'desktop-latest.json').read_bytes(), previous)
            with self.assertRaisesRegex(ValueError, 'Latest changed'):
                p.promote(root, second, 'https://downloads.example.test', 'absent', readback)
            p.promote(root, second, 'https://downloads.example.test', p.sha(previous), readback)
            current = (root / 'desktop-latest.json').read_bytes()
            p.promote(root, first, 'https://downloads.example.test', p.sha(current), readback)
            self.assertEqual((root / 'desktop-latest.json').read_bytes(), previous)
            self.assertTrue(second.is_dir())

if __name__ == '__main__':
    unittest.main()
