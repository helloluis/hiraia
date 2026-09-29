"""Spike native-package checks with the upstream ARM-in-x64-directory failure."""
import importlib.util
from pathlib import Path
import struct
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('audit', Path(__file__).with_name('audit-native-abis.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class NativeAbisTest(unittest.TestCase):
    def fixture(self, machine=62, missing=None):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        apk = Path(temp.name) / 'fixture.apk'
        with zipfile.ZipFile(apk, 'w') as archive:
            for abi, elf_machine in [('arm64-v8a', 183), ('x86_64', machine)]:
                header = b'\x7fELF\x02\x01' + bytes(12) + struct.pack('<H', elf_machine)
                for name in ['libqvac__llm-llamacpp.1.so', 'libqvac__embed-llamacpp.1.so',
                             'libqvac-ggml-cpu-baseline.so', 'libbare-fs.1.so']:
                    if abi == 'x86_64' and name == missing:
                        continue
                    archive.writestr(f'lib/{abi}/{name}', header)
        return apk

    def test_genuine_architectures(self):
        self.assertTrue(module.audit(self.fixture(), ['arm64-v8a', 'x86_64'])['passed'])

    def test_renaming_arm_binaries_does_not_port_them(self):
        result = module.audit(self.fixture(machine=183), ['arm64-v8a', 'x86_64'])
        self.assertFalse(result['passed'])
        self.assertTrue(any('wrong ELF' in error for error in result['errors']))

    def test_both_engines_required(self):
        result = module.audit(self.fixture(missing='libqvac__embed-llamacpp.1.so'), ['arm64-v8a', 'x86_64'])
        self.assertFalse(result['passed'])
        self.assertTrue(any('missing QVAC library libqvac__embed' in error for error in result['errors']))

    def test_worker_addon_parity_required(self):
        result = module.audit(self.fixture(missing='libbare-fs.1.so'), ['arm64-v8a', 'x86_64'])
        self.assertFalse(result['passed'])
        self.assertTrue(any('missing ARM64 counterpart libbare-fs' in error for error in result['errors']))


if __name__ == '__main__':
    unittest.main()
