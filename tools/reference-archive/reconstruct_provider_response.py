#!/usr/bin/env python3
"""Reconstruct one audited provider JSONL from archived metadata and image bytes.

The pinned cleanup proposal supplies trusted snapshot receipts and the exact
serialization recipe. The destination is published only after its complete hash
matches the original. Existing files and offload markers are never changed.
"""
import argparse
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import uuid

import archive as archive_tools
import local_cleanup as safe_files

MAX_PAYLOAD_BYTES = 128 * 1024 * 1024
MAX_METADATA_BYTES = 64 * 1024 * 1024


class ReconstructionError(Exception):
    pass


def require(condition, code):
    if not condition:
        raise ReconstructionError(code)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read_proposal(path, pin, source):
    raw = safe_files.read_document(Path(path).expanduser().absolute(), pin)
    rows = [safe_files.decode(line) for line in raw.splitlines() if line.strip()]
    by_path = {row['path']: row for row in rows}
    require(len(by_path) == len(rows), 'duplicate_source_proof')
    require(source in by_path, 'source_not_in_proposal')
    pins = {}
    for row in rows:
        compact = row['archived_compact_metadata']
        pin_value = {key: compact[key] for key in ['manifest_sha256', 'receipt_sha256']}
        previous = pins.setdefault(compact['snapshot_id'], pin_value)
        require(previous == pin_value, 'conflicting_snapshot_pins')
    selected = by_path[source]
    reconstruction = selected['raw_json_reconstruction']
    require(reconstruction.get('byte_identical_reconstruction_verified') is True and
            reconstruction.get('reconstructed_sha256') == selected['sha256'],
            'exact_reconstruction_not_proven')
    require(selected.get('all_nonpayload_json_fields_preserved') is True and
            selected.get('all_image_bytes_match_restored_archive') is True and
            not selected.get('errors'), 'source_preservation_not_proven')
    require(archive_tools.HASH_RE.fullmatch(selected['sha256']) and
            type(selected['bytes']) is int and selected['bytes'] >= 0, 'invalid_source_digest')
    recipe = reconstruction['recipe']
    require(type(recipe.get('ensure_ascii')) is bool and recipe.get('sort_keys') is False and
            recipe.get('encoding') == 'utf-8' and recipe.get('newline') in ('', '\n', '\r\n') and
            recipe.get('b64_json_key_position') in ('first', 'reference-position'), 'unsupported_recipe')
    separators = recipe.get('separators')
    require(separators is None or (isinstance(separators, list) and len(separators) == 2 and
            separators[0] in (',', ', ') and separators[1] in (':', ': ')), 'unsupported_separators')
    for payload in selected['image_payload_archive_proofs']:
        require(payload['snapshot_id'] in pins, 'payload_snapshot_pin_missing_use_full_proposal')
    return selected, pins


class ArchivedFiles:
    """Validate pinned manifests and read only the selected metadata/payloads."""
    def __init__(self, pins, *, local_roots=None, state=None, client_factory=None, bucket=None):
        self.pins, self.snapshots = pins, {}
        self.local_roots = [Path(p).expanduser().absolute() for p in (local_roots or [])]
        self.state = Path(state or archive_tools.DEFAULT_STATE).expanduser().absolute()
        self.client_factory, self.bucket, self.client = client_factory, bucket, None
        require(bool(self.local_roots) != bool(client_factory), 'select_local_or_remote_archive')
        if not self.local_roots:
            archive_tools.validate_bucket(bucket)

    def remote_client(self):
        if self.client is None:
            self.client = self.client_factory()
        return self.client

    def snapshot(self, snapshot_id):
        if snapshot_id in self.snapshots:
            return self.snapshots[snapshot_id]
        require(snapshot_id in self.pins, 'untrusted_snapshot')
        archive_tools.snapshot_key(snapshot_id, 'receipt.json')
        pin = self.pins[snapshot_id]
        if self.local_roots:
            directory = self.state / 'snapshots' / snapshot_id
            receipt_raw = safe_files.read_document(directory / 'receipt.json', pin['receipt_sha256'])
        else:
            receipt_raw = archive_tools.read_bytes(self.remote_client(), self.bucket,
                archive_tools.snapshot_key(snapshot_id, 'receipt.json'), 65536, pin['receipt_sha256'])
        require(receipt_raw is not None, 'committed_receipt_missing')
        receipt = archive_tools.parse_receipt(receipt_raw, snapshot_id)
        pointer = receipt['manifest']
        require(pointer['sha256'] == pin['manifest_sha256'], 'manifest_pin_mismatch')
        if self.local_roots:
            manifest_raw = safe_files.read_document(directory / 'manifest.json', pointer['sha256'])
        else:
            manifest_raw = archive_tools.read_bytes(self.remote_client(), self.bucket, pointer['key'],
                archive_tools.MAX_MANIFEST_BYTES, pointer['sha256'], pointer['bytes'])
        require(manifest_raw is not None and len(manifest_raw) == pointer['bytes'], 'manifest_size_mismatch')
        manifest = archive_tools.validate_manifest(safe_files.decode(manifest_raw))
        require(manifest['snapshot_id'] == snapshot_id and manifest['totals'] == receipt['totals'],
                'receipt_manifest_mismatch')
        by_path, by_sha = {}, {}
        for item in manifest['files']:
            by_path[(item['source_id'], item['path'])] = item
            by_sha.setdefault(item['sha256'], item)
        self.snapshots[snapshot_id] = by_path, by_sha
        return by_path, by_sha

    def read_item(self, item, maximum):
        require(0 <= item['bytes'] <= maximum, 'selected_file_too_large')
        if self.local_roots:
            for root in self.local_roots:
                path = root / item['source_id'] / item['path']
                if path.exists() or path.is_symlink():
                    raw = safe_files.read_document(path, item['sha256'])
                    require(len(raw) == item['bytes'], 'restored_file_size_mismatch')
                    return raw
            raise ReconstructionError('selected_file_missing_from_local_restores')
        output = io.BytesIO()
        archive_tools.stream_original(self.remote_client(), self.bucket, item, output)
        raw = output.getvalue()
        require(len(raw) == item['bytes'], 'remote_file_size_mismatch')
        return raw

    def compact(self, location):
        by_path, _ = self.snapshot(location['snapshot_id'])
        item = by_path.get((location['source_id'], location['path']))
        require(item is not None and item['sha256'] == location['sha256'] and
                item['bytes'] == location['bytes'], 'compact_metadata_not_in_pinned_snapshot')
        return self.read_item(item, MAX_METADATA_BYTES)

    def payload(self, proof):
        _, by_sha = self.snapshot(proof['snapshot_id'])
        item = by_sha.get(proof['sha256'])
        require(item is not None and item['bytes'] == proof['bytes'], 'payload_not_in_pinned_snapshot')
        return self.read_item(item, MAX_PAYLOAD_BYTES)


def reconstruct(record, archived, destination):
    destination = safe_files.absolute(str(Path(destination).expanduser().absolute()))
    expected = record['sha256']
    recipe = record['raw_json_reconstruction']['recipe']
    payloads = {item['sha256']: item for item in record['image_payload_archive_proofs']}
    require(len(payloads) == record['unique_payloads'], 'duplicate_or_missing_payload_proofs')
    seen_payloads = set()
    file_hash, byte_count, records, images = hashlib.sha256(), 0, 0, 0
    temporary = '.provider-reconstruct-' + uuid.uuid4().hex + '.partial'
    with safe_files.directory(destination.parent, create=True) as parent:
        require(safe_files.entry_stat(parent, destination.name) is None, 'destination_exists')
        # Do not read credentials or make a network request for an occupied destination.
        compact = archived.compact(record['archived_compact_metadata'])
        handle = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=parent)
        try:
            with os.fdopen(handle, 'wb') as output:
                for line in compact.splitlines():
                    require(bool(line.strip()), 'unexpected_blank_compact_record')
                    obj = safe_files.decode(line)
                    lineage = obj.pop('archive_source_record')
                    records += 1
                    require(lineage['source_line'] == records, 'unsupported_source_line_gaps')
                    data = ((obj.get('response') or {}).get('body') or {}).get('data') or []
                    for item in data:
                        if not isinstance(item, dict) or 'archive_image_reference' not in item:
                            continue
                        require('b64_json' not in item, 'compact_payload_field_collision')
                        reference = item.pop('archive_image_reference')
                        proof = payloads.get(reference['sha256'])
                        require(proof is not None and proof['bytes'] == reference['bytes'], 'payload_proof_mismatch')
                        native = archived.payload(proof)
                        require(digest(native) == reference['sha256'] and len(native) == reference['bytes'],
                                'native_payload_mismatch')
                        encoded = base64.b64encode(native).decode('ascii')
                        item['b64_json'] = encoded
                        if recipe['b64_json_key_position'] == 'first':
                            restored = {'b64_json': encoded, **{k: v for k, v in item.items() if k != 'b64_json'}}
                            item.clear()
                            item.update(restored)
                        seen_payloads.add(reference['sha256'])
                        images += 1
                    raw = (json.dumps(obj, ensure_ascii=recipe['ensure_ascii'],
                            separators=recipe['separators'], sort_keys=False) + recipe['newline']).encode('utf-8')
                    byte_count += len(raw)
                    require(byte_count <= record['bytes'], 'reconstruction_exceeds_source_size')
                    file_hash.update(raw)
                    output.write(raw)
                require(records == record['proof']['json_records'] and images == record['proof']['images'] and
                        seen_payloads == set(payloads), 'reconstructed_record_counts_mismatch')
                require(byte_count == record['bytes'] and file_hash.hexdigest() == expected,
                        'reconstructed_original_hash_mismatch')
                output.flush()
                os.fsync(output.fileno())
            safe_files.same_directory(destination.parent, parent)
            # Atomic create only; a late competing writer is never overwritten.
            os.link(temporary, destination.name, src_dir_fd=parent, dst_dir_fd=parent, follow_symlinks=False)
            os.fsync(parent)
        finally:
            try:
                os.unlink(temporary, dir_fd=parent)
                os.fsync(parent)
            except FileNotFoundError:
                pass
    return {'status': 'reconstructed', 'destination': str(destination), 'source': record['path'],
            'sha256': expected, 'bytes': byte_count, 'records': records, 'image_records': images,
            'offload_markers_modified': False}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--proposal', required=True, type=Path)
    parser.add_argument('--proposal-sha256', required=True)
    parser.add_argument('--source', required=True, help='Original absolute path recorded in the full proposal')
    parser.add_argument('--destination', required=True, type=Path)
    choice = parser.add_mutually_exclusive_group(required=True)
    choice.add_argument('--env-file', type=Path)
    choice.add_argument('--local-restore', action='append', type=Path)
    parser.add_argument('--bucket', help='Explicit private bucket; required with --env-file')
    parser.add_argument('--archive-state', type=Path, default=archive_tools.DEFAULT_STATE,
                        help='Local state containing pinned manifests/receipts; local-restore mode only')
    args = parser.parse_args(argv)
    try:
        source = str(safe_files.absolute(args.source))
        record, pins = read_proposal(args.proposal, args.proposal_sha256, source)
        if args.local_restore:
            archived = ArchivedFiles(pins, local_roots=args.local_restore, state=args.archive_state)
        else:
            require(bool(args.bucket), 'remote_bucket_required')
            archived = ArchivedFiles(pins, client_factory=lambda: archive_tools.make_client(args.env_file), bucket=args.bucket)
        result = reconstruct(record, archived, args.destination)
        code = 0
    except ReconstructionError as error:
        result, code = {'status': 'refused', 'code': str(error)}, 1
    except safe_files.CleanupError as error:
        result, code = {'status': 'refused', 'code': error.code}, 1
    except archive_tools.ArchiveError as error:
        result, code = {'status': 'refused', 'code': error.code}, 1
    except (OSError, ValueError, KeyError, TypeError) as error:
        result, code = {'status': 'refused', 'code': type(error).__name__}, 1
    print(json.dumps(result))
    return code


if __name__ == '__main__':
    raise SystemExit(main())
