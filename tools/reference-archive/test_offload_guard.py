import base64
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
spec = importlib.util.spec_from_file_location('offload_guard', HERE / 'offload_guard.py')
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)

SCRIPTS = [
    'packages/images/qwen-queue/gen-images.py',
    'packages/images/qwen-queue/gen-images-openai.py',
    'packages/images/qwen-queue/gen-images-combo.py',
    'packages/images/qwen-queue/gen-images-batch.py',
    'packages/images/qwen-queue/batch-submit-all.py',
    'packages/images/qwen-queue/gen-round3.py',
    'packages/images/qwen-queue/process-images.py',
    'packages/images/qwen-queue/audit-regen/build.py',
    'packages/images/qwen-queue/audit-regen/submit.py',
    'packages/images/qwen-queue/audit-regen/extract_batch.py',
    'packages/images/qwen-queue/download-signed.sh',
    'rag/pipeline/imagegen/extract.py',
    'rag/pipeline/imagegen/to-webp.py',
    'rag/pipeline/imagegen/fetch-batch.sh',
    'rag/pipeline/art-qa-newart-extract.py',
    'rag/pipeline/depth-fill/append.py',
    'rag/pipeline/depth-fill/append-topup.py',
    'rag/pipeline/lane-a/append-lane-a.py',
    'packages/images/to-card-png.mjs',
    'packages/images/gemini-queue/downsize.mjs',
    'packages/images/gemini-queue/process-manual-batch.mjs',
    'packages/images/gemini-queue/process-manual-batch-dynamic.mjs',
    'packages/images/gemini-queue/manual-originals.mjs',
]


class OffloadGuardTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()
        for relative in SCRIPTS + [
            'tools/reference-archive/offload_guard.py',
            'tools/reference-archive/offload-guard.mjs',
        ]:
            destination = self.root / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / relative, destination)
        self.stubs = self.root / 'stubs'
        self.stubs.mkdir()
        (self.stubs / 'sitecustomize.py').write_text(
            "import socket\n"
            "def blocked(*args, **kwargs):\n"
            "    raise RuntimeError('UNEXPECTED_NETWORK')\n"
            "socket.socket.connect = blocked\n"
            "socket.socket.connect_ex = blocked\n"
        )
        bin_dir = self.stubs / 'bin'
        bin_dir.mkdir()
        curl = bin_dir / 'curl'
        curl.write_text('#!/bin/sh\necho UNEXPECTED_NETWORK >&2\nexit 99\n')
        curl.chmod(0o755)
        sharp = self.root / 'node_modules/sharp'
        sharp.mkdir(parents=True)
        (sharp / 'package.json').write_text('{"type":"module","exports":"./index.js"}')
        (sharp / 'index.js').write_text(
            "export default function sharp() { throw new Error('UNEXPECTED_IMAGE_CONVERSION'); }\n"
        )
        # No inherited credentials; dummy keys prevent a regression from consulting .env files.
        self.env = {
            'PATH': str(bin_dir) + os.pathsep + os.environ.get('PATH', ''),
            'PYTHONPATH': str(self.stubs),
            'PYTHONDONTWRITEBYTECODE': '1',
            'OPENAI_API_KEY': 'test-not-a-credential',
            'ALIBABACLOUD_API_KEY': 'test-not-a-credential',
        }

    def tearDown(self):
        self.temp.cleanup()

    def mark(self, relative, *, sidecar=False, contents='{}'):
        target = self.root / relative
        marker = Path(str(target) + guard.MARKER_NAME) if sidecar else target / guard.MARKER_NAME
        marker.parent.mkdir(parents=True, exist_ok=True)
        marker.write_text(contents)
        return marker

    def run_script(self, relative, *args, env=None, cwd=None):
        runner = 'node' if relative.endswith('.mjs') else 'bash' if relative.endswith('.sh') else sys.executable
        return subprocess.run(
            [runner, str(self.root / relative), *map(str, args)],
            cwd=cwd or self.root, env={**self.env, **(env or {})},
            capture_output=True, text=True, timeout=10,
        )

    def blocked(self, result):
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertIn('ARCHIVE_OFFLOADED:', result.stderr)
        self.assertNotIn('UNEXPECTED_NETWORK', result.stderr)
        self.assertNotIn('UNEXPECTED_IMAGE_CONVERSION', result.stderr)

    def both_helpers(self, path, expected_blocked):
        if expected_blocked:
            with self.assertRaises(guard.OffloadedSourceError):
                guard.assert_local(path)
        else:
            guard.assert_local(path)
        module = (self.root / 'tools/reference-archive/offload-guard.mjs').as_uri()
        result = subprocess.run(
            ['node', '--input-type=module', '-e',
             f'import {{assertLocal}} from {json.dumps(module)}; assertLocal(process.argv[1]);', str(path)],
            capture_output=True, text=True, env=self.env, timeout=10,
        )
        if expected_blocked:
            self.blocked(result)
        else:
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_unmarked_missing_sources_keep_existing_behavior(self):
        missing = self.root / 'unmarked/missing.png'
        self.both_helpers(missing, False)
        self.assertFalse(missing.parent.exists())

    def test_directory_marker_blocks_existing_and_missing_descendants(self):
        marker = self.mark('raw')
        original = marker.parent / 'restored.png'
        original.write_bytes(b'exact-restored-bytes')
        for path in [marker.parent, original, marker.parent / 'missing/subdir/source.png']:
            with self.subTest(path=path):
                self.both_helpers(path, True)
        self.both_helpers(self.root / 'raw-other/file.png', False)
        self.assertEqual(original.read_bytes(), b'exact-restored-bytes')
        self.assertTrue(marker.exists())

    def test_file_sidecar_does_not_block_siblings(self):
        self.mark('batch.jsonl', sidecar=True)
        self.both_helpers(self.root / 'batch.jsonl', True)
        self.both_helpers(self.root / 'manifest.jsonl', False)
        self.both_helpers(self.root, False)

    def test_malformed_and_dangling_symlink_markers_fail_closed(self):
        marker = self.mark('raw', contents='not JSON')
        self.both_helpers(marker.parent, True)
        marker.unlink()
        marker.symlink_to(self.root / 'missing-marker-target')
        self.both_helpers(marker.parent, True)

    def test_symlink_alias_cannot_bypass_ancestor_marker(self):
        self.mark('raw')
        nested = self.root / 'raw/nested'
        nested.mkdir()
        alias = self.root / 'alias'
        alias.symlink_to(nested, target_is_directory=True)
        self.both_helpers(alias / 'missing.png', True)

    def test_symlink_parent_traversal_checks_actual_target(self):
        self.mark('raw')
        nested = self.root / 'raw/nested'
        nested.mkdir()
        alias = self.root / 'alias'
        alias.symlink_to(nested, target_is_directory=True)
        self.both_helpers(alias / '..' / 'missing.png', True)

    def test_python_generators_stop_before_keys_inputs_or_paid_requests(self):
        queue = 'packages/images/qwen-queue/'
        cases = [
            ('gen-images.py', 'out', {}),
            ('gen-images-openai.py', 'out-openai', {}),
            ('gen-images-combo.py', 'out-final', {}),
            ('batch-submit-all.py', 'out-final', {}),
            *[('gen-images-batch.py', 'out-final', {'MODE': mode})
              for mode in ['build', 'submit', 'fetch', 'run']],
            ('gen-round3.py', 'out-round3', {}),
        ]
        for script, out, extra in cases:
            with self.subTest(script=script, mode=extra):
                marker = self.mark(queue + out)
                # Guards precede key lookup: explicitly remove even dummy credentials.
                previous = self.env
                self.env = {k: v for k, v in previous.items() if not k.endswith('_API_KEY')}
                try:
                    self.blocked(self.run_script(queue + script, env=extra))
                finally:
                    self.env = previous
                    marker.unlink()
                self.assertFalse((self.root / queue / 'batch-requests.jsonl').exists())
                self.assertFalse((self.root / queue / 'manifest.jsonl').exists())

    def test_round3_honors_custom_output_marker(self):
        self.mark('custom-output')
        self.blocked(self.run_script('packages/images/qwen-queue/gen-round3.py',
                                     env={'OUT': str(self.root / 'custom-output')}))

    def test_existing_unmarked_generation_output_is_still_skipped(self):
        queue = self.root / 'packages/images/qwen-queue'
        (queue / 'out').mkdir()
        (queue / 'out/already-done.png').write_bytes(b'unchanged')
        (queue / 'worklist.jsonl').write_text('{"id":"already-done","prompt":"test"}\n')
        result = self.run_script('packages/images/qwen-queue/gen-images.py')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('0 to generate', result.stdout)
        self.assertEqual((queue / 'out/already-done.png').read_bytes(), b'unchanged')

    def test_audit_build_and_submit_stop_for_both_original_collections(self):
        base = 'packages/images/qwen-queue/audit-regen/'
        for raw in ['raw', 'raw-4']:
            marker = self.mark(base + raw)
            for script in ['build.py', 'submit.py']:
                with self.subTest(raw=raw, script=script):
                    self.blocked(self.run_script(base + script))
            marker.unlink()
        self.assertFalse((self.root / base / 'batches.json').exists())

    def test_raw_converters_reject_marker_before_output_creation_or_image_import(self):
        self.mark('rag/pipeline/imagegen/raw')
        self.blocked(self.run_script('rag/pipeline/imagegen/to-webp.py'))
        self.assertFalse((self.root / 'rag/pipeline/imagegen/webp').exists())
        self.mark('custom-raw')
        output = self.root / 'custom-processed'
        self.blocked(self.run_script('packages/images/qwen-queue/process-images.py',
                                     env={'SRC': str(self.root / 'custom-raw'), 'DST': str(output)}))
        self.assertFalse(output.exists())

    def test_provider_extractors_reject_sidecars_before_creating_outputs(self):
        self.mark('batch.jsonl', sidecar=True)
        for script, output in [
            ('rag/pipeline/imagegen/extract.py', 'rag/pipeline/imagegen/raw'),
            ('rag/pipeline/art-qa-newart-extract.py', 'packages/images/cards-png'),
            ('packages/images/qwen-queue/audit-regen/extract_batch.py', 'packages/images/qwen-queue/audit-regen/raw'),
        ]:
            with self.subTest(script=script):
                self.blocked(self.run_script(script, self.root / 'batch.jsonl'))
                self.assertFalse((self.root / output).exists())

    def test_audit_extract_preflights_all_inputs_before_writing_any(self):
        first = self.root / 'first.jsonl'
        first.write_text(json.dumps({'custom_id': 'first', 'response': {'status_code': 200,
            'body': {'data': [{'b64_json': base64.b64encode(b'fixture').decode()}]}}}) + '\n')
        self.mark('second.jsonl', sidecar=True)
        self.blocked(self.run_script('packages/images/qwen-queue/audit-regen/extract_batch.py',
                                     first, self.root / 'second.jsonl'))
        self.assertFalse((self.root / 'packages/images/qwen-queue/audit-regen/raw').exists())

    def test_pipeline_image_stages_stop_before_input_enumeration(self):
        self.mark('rag/pipeline/imagegen/raw')
        for script, out_name in [('depth-fill/append.py', 'out'),
                                 ('depth-fill/append-topup.py', 'out-topup'),
                                 ('lane-a/append-lane-a.py', 'out')]:
            for stage in ['images', 'fetch', 'bank,images', 'bank, images']:
                with self.subTest(script=script, stage=stage):
                    self.blocked(self.run_script('rag/pipeline/' + script, '--stages', stage))
            self.assertFalse((self.root / 'rag/pipeline' / Path(script).parent / out_name).exists())

    def test_shell_downloads_stop_before_curl(self):
        marker = self.mark('rag/pipeline/imagegen/raw')
        script = 'rag/pipeline/imagegen/fetch-batch.sh'
        self.blocked(self.run_script(script, 'batch-1', 'https://example.invalid/fixture'))
        marker.unlink()
        self.mark('rag/pipeline/imagegen/batch-1.jsonl', sidecar=True)
        self.blocked(self.run_script(script, 'batch-1', 'https://example.invalid/fixture'))
        self.mark('packages/images/qwen-queue/out-final')
        self.blocked(self.run_script('packages/images/qwen-queue/download-signed.sh',
                                     'https://example.invalid/fixture'))

    def test_pipeline_fetch_preflights_provider_sidecars_before_api_polling(self):
        self.mark('rag/pipeline/imagegen/batch-guard.jsonl', sidecar=True)
        for script, out_name in [('depth-fill/append.py', 'out'),
                                 ('depth-fill/append-topup.py', 'out-topup'),
                                 ('lane-a/append-lane-a.py', 'out')]:
            with self.subTest(script=script):
                output = self.root / 'rag/pipeline' / Path(script).parent / out_name
                output.mkdir(parents=True, exist_ok=True)
                (output / 'image-batches.json').write_text(json.dumps({
                    'batches': [{'batch_id': 'batch-guard'}],
                }))
                self.blocked(self.run_script('rag/pipeline/' + script, '--stages', 'fetch'))
                self.assertEqual([p.name for p in output.iterdir()], ['image-batches.json'])

    def test_raw_extractors_stop_before_opening_a_missing_input(self):
        for script, raw in [
            ('rag/pipeline/imagegen/extract.py', 'rag/pipeline/imagegen/raw'),
            ('packages/images/qwen-queue/audit-regen/extract_batch.py',
             'packages/images/qwen-queue/audit-regen/raw'),
        ]:
            with self.subTest(script=script):
                marker = self.mark(raw)
                self.blocked(self.run_script(script, self.root / 'absent-batch.jsonl'))
                self.assertEqual(list(marker.parent.iterdir()), [marker])

    def test_javascript_converters_and_manual_processors_stop_before_enumeration(self):
        self.mark('raw')
        output = self.root / 'converted'
        for script in ['packages/images/to-card-png.mjs', 'packages/images/gemini-queue/downsize.mjs']:
            self.blocked(self.run_script(script, '--in', self.root / 'raw', '--out', output))
        self.assertFalse(output.exists())
        self.mark('assets-png-raw')
        self.blocked(self.run_script('packages/images/gemini-queue/downsize.mjs',
                                     '--in', 'assets-png', '--out', 'assets-png'))
        self.mark('packages/images/manual-originals')
        for name in ['process-manual-batch.mjs', 'process-manual-batch-dynamic.mjs']:
            self.blocked(self.run_script('packages/images/gemini-queue/' + name))
        self.assertFalse((self.root / 'packages/images/assets-png').exists())


if __name__ == '__main__':
    unittest.main()
