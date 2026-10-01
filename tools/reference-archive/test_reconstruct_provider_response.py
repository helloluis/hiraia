"""Hermetic reconstruction tests: no credentials, network, or real source mutation."""
import base64
import contextlib
import copy
import io
import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest import mock

import archive
import local_cleanup
import reconstruct_provider_response as reconstruct


class MemoryReader:
    def __init__(self, objects):
        self.objects, self.reads = objects, []

    def get_object(self, *, Bucket, Key):
        self.reads.append(Key)
        value = self.objects[Key]
        return {'Body': io.BytesIO(value), 'ContentLength': len(value)}


class ReconstructionTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.source = self.root / 'source'
        self.source.mkdir()
        self.state, self.restored = self.root / 'state', self.root / 'restored'
        self.native = b'\x89PNG\r\n\x1a\nexact native image bytes\x00\xff'
        self.source_path = str(self.root / 'historical-response.jsonl')
        self.make_fixture()

    def make_fixture(self, position='first', separators=None):
        native_sha = archive.sha(self.native)
        image = {'b64_json': base64.b64encode(self.native).decode('ascii'), 'generation_id': 'gen-test'}
        if position == 'reference-position':
            image = {'generation_id': 'gen-test', 'b64_json': image['b64_json']}
        original = [
            {'id': 'request-1', 'custom_id': 'card-1', 'response': {'status_code': 200, 'body': {
                'created': 1789000000, 'data': [image], 'usage': {'input_tokens': 123, 'output_tokens': 196}}}, 'error': None},
            {'id': 'request-2', 'custom_id': 'card-2', 'response': None,
             'error': {'code': 'test-only', 'message': 'Información conservada'}},
        ]
        self.expected = ''.join(json.dumps(item, ensure_ascii=False, separators=separators) + '\n' for item in original).encode()
        compact = copy.deepcopy(original)
        data = compact[0]['response']['body']['data'][0]
        data.pop('b64_json')
        data['archive_image_reference'] = {'sha256': native_sha, 'bytes': len(self.native), 'format': 'PNG'}
        for index, item in enumerate(compact, 1):
            item['archive_source_record'] = {'source_line': index, 'source_file_sha256': archive.sha(self.expected)}
        (self.source / 'compact.jsonl').write_text(''.join(json.dumps(item, ensure_ascii=False) + '\n' for item in compact))
        (self.source / 'native.bin').write_bytes(self.native)
        (self.source / 'unrelated.bin').write_bytes(b'Do not fetch an entire snapshot for one response.')
        inventory = archive.inventory({'schema': 1, 'sources': [{'id': 'fixture', 'path': str(self.source)}]}, self.state, chunk_bytes=64)
        self.manifest_path = Path(inventory['manifest'])
        manifest_raw = self.manifest_path.read_bytes()
        manifest = json.loads(manifest_raw)
        self.snapshot_id = inventory['snapshot_id']
        receipt = {'schema': archive.SCHEMA, 'snapshot_id': self.snapshot_id, 'committed_at': archive.utc(),
                   'manifest': {'key': archive.snapshot_key(self.snapshot_id, 'manifest.json'),
                                'sha256': archive.sha(manifest_raw), 'bytes': len(manifest_raw)},
                   'totals': manifest['totals']}
        receipt_raw = archive.canonical(receipt)
        self.receipt_path = self.manifest_path.with_name('receipt.json')
        self.receipt_path.write_bytes(receipt_raw)
        compact_item = next(x for x in manifest['files'] if x['path'] == 'compact.jsonl')
        self.row = {'path': self.source_path, 'sha256': archive.sha(self.expected), 'bytes': len(self.expected),
                    'all_nonpayload_json_fields_preserved': True, 'all_image_bytes_match_restored_archive': True,
                    'errors': [], 'proof': {'json_records': 2, 'images': 1}, 'unique_payloads': 1,
                    'image_payload_archive_proofs': [{'snapshot_id': self.snapshot_id, 'sha256': native_sha, 'bytes': len(self.native)}],
                    'archived_compact_metadata': {'snapshot_id': self.snapshot_id, 'source_id': 'fixture',
                        'path': 'compact.jsonl', 'sha256': compact_item['sha256'], 'bytes': compact_item['bytes'],
                        'manifest_sha256': archive.sha(manifest_raw), 'receipt_sha256': archive.sha(receipt_raw)},
                    'raw_json_reconstruction': {'byte_identical_reconstruction_verified': True,
                        'reconstructed_sha256': archive.sha(self.expected), 'recipe': {
                            'ensure_ascii': False, 'sort_keys': False, 'encoding': 'utf-8', 'newline': '\n',
                            'separators': list(separators) if separators else None, 'b64_json_key_position': position}}}
        self.proposal = self.root / 'proposal.jsonl'
        self.proposal.write_text(json.dumps(self.row) + '\n')
        self.pin = archive.sha(self.proposal.read_bytes())
        self.pins = {self.snapshot_id: {key: self.row['archived_compact_metadata'][key]
                                     for key in ['manifest_sha256', 'receipt_sha256']}}
        if self.restored.exists():
            shutil.rmtree(self.restored)
        shutil.copytree(self.source, self.restored / 'fixture')
        self.objects = {archive.snapshot_key(self.snapshot_id, 'manifest.json'): manifest_raw,
                        archive.snapshot_key(self.snapshot_id, 'receipt.json'): receipt_raw}
        self.unrelated_keys = set()
        for item in manifest['files']:
            raw = (self.source / item['path']).read_bytes()
            for chunk in item['chunks']:
                key = archive.object_key(chunk['sha256'])
                self.objects[key] = raw[chunk['offset']:chunk['offset'] + chunk['bytes']]
                if item['path'] == 'unrelated.bin':
                    self.unrelated_keys.add(key)

    def local(self):
        return reconstruct.ArchivedFiles(self.pins, local_roots=[self.restored], state=self.state)

    def assert_clean_failure(self, row=None, archived=None, error=Exception):
        target = self.root / 'failed.jsonl'
        with self.assertRaises(error):
            reconstruct.reconstruct(row or self.row, archived or self.local(), target)
        self.assertFalse(target.exists())
        self.assertEqual(list(self.root.glob('.provider-reconstruct-*.partial')), [])

    def test_local_cli_restores_all_fields_and_exact_source_bytes(self):
        target = self.root / 'nested' / 'original.jsonl'
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            code = reconstruct.main(['--proposal', str(self.proposal), '--proposal-sha256', self.pin,
                '--source', self.source_path, '--destination', str(target), '--local-restore', str(self.restored),
                '--archive-state', str(self.state)])
        self.assertEqual(code, 0, output.getvalue())
        self.assertEqual(target.read_bytes(), self.expected)
        self.assertEqual(json.loads(output.getvalue())['status'], 'reconstructed')

    def test_reference_key_position_and_compact_serialization(self):
        self.make_fixture('reference-position', (',', ':'))
        target = self.root / 'compact-source.jsonl'
        reconstruct.reconstruct(self.row, self.local(), target)
        self.assertEqual(target.read_bytes(), self.expected)

    def test_remote_reads_only_required_objects_with_chunk_verification(self):
        client = MemoryReader(self.objects)
        remote = reconstruct.ArchivedFiles(self.pins, client_factory=lambda: client, bucket='hiraia-archive-test')
        target = self.root / 'remote.jsonl'
        reconstruct.reconstruct(self.row, remote, target)
        self.assertEqual(target.read_bytes(), self.expected)
        self.assertFalse(self.unrelated_keys.intersection(client.reads))
        self.assertEqual(client.reads.count(archive.snapshot_key(self.snapshot_id, 'receipt.json')), 1)

    def test_existing_destination_refused_before_archive_reads(self):
        target = self.root / 'existing.jsonl'
        target.write_bytes(b'newer user content')
        remote = reconstruct.ArchivedFiles(self.pins, client_factory=lambda: self.fail('network access'), bucket='hiraia-archive-test')
        with self.assertRaisesRegex(reconstruct.ReconstructionError, 'destination_exists'):
            reconstruct.reconstruct(self.row, remote, target)
        self.assertEqual(target.read_bytes(), b'newer user content')

    def test_late_destination_race_never_overwrites(self):
        target = self.root / 'race.jsonl'
        def competing_writer(*args, **kwargs):
            target.write_bytes(b'concurrent user file')
            raise FileExistsError()
        with mock.patch.object(reconstruct.os, 'link', side_effect=competing_writer):
            with self.assertRaises(FileExistsError):
                reconstruct.reconstruct(self.row, self.local(), target)
        self.assertEqual(target.read_bytes(), b'concurrent user file')
        self.assertEqual(list(self.root.glob('.provider-reconstruct-*.partial')), [])

    def test_corrupted_local_payload_never_publishes(self):
        (self.restored / 'fixture' / 'native.bin').write_bytes(b'corrupt')
        self.assert_clean_failure(error=local_cleanup.CleanupError)

    def test_corrupted_remote_chunk_never_publishes(self):
        objects = dict(self.objects)
        objects[archive.object_key(archive.sha(self.native))] = b'corrupt'
        remote = reconstruct.ArchivedFiles(self.pins, client_factory=lambda: MemoryReader(objects), bucket='hiraia-archive-test')
        self.assert_clean_failure(archived=remote, error=archive.ArchiveError)

    def test_wrong_receipt_pin_refuses_metadata(self):
        self.receipt_path.write_bytes(self.receipt_path.read_bytes() + b' ')
        self.assert_clean_failure(error=local_cleanup.CleanupError)

    def test_missing_payload_refuses_and_cleans_partial(self):
        (self.restored / 'fixture' / 'native.bin').unlink()
        self.assert_clean_failure(error=reconstruct.ReconstructionError)

    def test_wrong_serialization_recipe_fails_full_source_sha(self):
        row = copy.deepcopy(self.row)
        row['raw_json_reconstruction']['recipe']['b64_json_key_position'] = 'reference-position'
        self.assert_clean_failure(row=row, error=reconstruct.ReconstructionError)

    def test_symlink_parent_is_refused(self):
        actual = self.root / 'actual'
        actual.mkdir()
        link = self.root / 'link'
        link.symlink_to(actual, target_is_directory=True)
        with self.assertRaises(OSError):
            reconstruct.reconstruct(self.row, self.local(), link / 'response.jsonl')
        self.assertEqual(list(actual.iterdir()), [])

    def test_proposal_pin_and_exact_proof_are_required(self):
        with self.assertRaises(local_cleanup.CleanupError):
            reconstruct.read_proposal(self.proposal, '0' * 64, self.source_path)
        row = copy.deepcopy(self.row)
        row['raw_json_reconstruction']['byte_identical_reconstruction_verified'] = False
        self.proposal.write_text(json.dumps(row) + '\n')
        with self.assertRaisesRegex(reconstruct.ReconstructionError, 'exact_reconstruction_not_proven'):
            reconstruct.read_proposal(self.proposal, archive.sha(self.proposal.read_bytes()), self.source_path)


if __name__ == '__main__':
    unittest.main()
