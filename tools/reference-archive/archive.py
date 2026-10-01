#!/usr/bin/env python3
"""Immutable, byte-preserving private R2 archive. No remote deletion or overwrite."""
from __future__ import annotations

import argparse
import base64
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime, timezone
import fnmatch
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import sys
import tempfile
import threading
from urllib.parse import urlparse
import uuid


REPO = Path(__file__).resolve().parents[2]
DEFAULT_STATE = REPO / "build/reference-archive"
SCHEMA = "hiraia.reference-archive.v1"
CHUNK_BYTES = 64 * 1024 * 1024
READ_BYTES = 1024 * 1024
MAX_WORKERS = 16
MAX_MANIFEST_BYTES = 256 * 1024 * 1024
HASH_RE = re.compile(r"[0-9a-f]{64}\Z")
ID_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}\Z")
SNAPSHOT_RE = re.compile(r"\d{8}T\d{6}Z-[0-9a-f]{12}\Z")


class ArchiveError(Exception):
    def __init__(self, code, message, **details):
        super().__init__(message)
        self.code, self.message, self.details = code, message, details

    def record(self):
        return {"code": self.code, "message": self.message, **self.details}


def fail(code, message, **details):
    raise ArchiveError(code, message, **details)


def utc():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def canonical(value):
    return (json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")


def sha(data):
    return hashlib.sha256(data).hexdigest()


def object_key(digest):
    if not HASH_RE.fullmatch(digest):
        fail("invalid_hash", "Invalid SHA-256 value")
    return f"objects/sha256/{digest[:2]}/{digest}"


def snapshot_key(snapshot_id, name):
    if not SNAPSHOT_RE.fullmatch(snapshot_id):
        fail("invalid_snapshot", "Invalid snapshot identifier")
    return f"snapshots/{snapshot_id}/{name}"


def validate_bucket(bucket):
    if not bucket or not re.fullmatch(r"[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]", bucket):
        fail("invalid_bucket", "An explicit S3-compatible private bucket name is required")
    if bucket in {"hiraia-assets", "assets", "public", "cdn"} or "public" in bucket.split("-"):
        fail("public_bucket_refused", "A public asset bucket cannot be used as an archive")
    return bucket


def safe_relative(value):
    if not isinstance(value, str) or not value or "\\" in value or "\x00" in value:
        fail("unsafe_path", "Invalid archive-relative path")
    path = PurePosixPath(value)
    if not path.parts or path.is_absolute() or any(part in {".", ".."} for part in path.parts) or str(path) != value:
        fail("unsafe_path", "Archive paths must be normalized relative paths")
    return value


def signature(value):
    return {"device": value.st_dev, "inode": value.st_ino, "size": value.st_size,
            "mtime_ns": value.st_mtime_ns, "ctime_ns": value.st_ctime_ns,
            "mode": stat.S_IMODE(value.st_mode)}


def file_stat(path):
    try:
        value = path.lstat()
    except OSError:
        fail("source_unavailable", "A selected source file is unavailable", path=str(path))
    if not stat.S_ISREG(value.st_mode):
        fail("unsupported_file", "Only regular files are archived; symlinks are refused", path=str(path))
    return signature(value)


def ensure_stat(path, expected):
    if file_stat(path) != expected:
        fail("source_changed", "Selected source changed; create a new inventory snapshot", path=str(path))


@contextmanager
def stable_reader(path, expected):
    ensure_stat(path, expected)
    try:
        fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    except OSError:
        fail("source_unavailable", "Cannot open selected source", path=str(path))
    with os.fdopen(fd, "rb") as stream:
        if signature(os.fstat(stream.fileno())) != expected:
            fail("source_changed", "Selected source was replaced while opening", path=str(path))
        yield stream
        if signature(os.fstat(stream.fileno())) != expected:
            fail("source_changed", "Selected source changed while reading", path=str(path))
    ensure_stat(path, expected)


def matches(path, patterns):
    return any(fnmatch.fnmatchcase(path, pattern) or
               (pattern.startswith("**/") and fnmatch.fnmatchcase(path, pattern[3:]))
               for pattern in patterns)


def normalize_sources(selection):
    if not isinstance(selection, dict) or selection.get("schema") != 1:
        fail("invalid_selection", "Selection must use schema 1")
    sources, ids = [], set()
    for value in selection.get("sources", []):
        source = dict(value)
        source_id = source.get("id", "")
        if not ID_RE.fullmatch(source_id) or source_id in ids:
            fail("invalid_selection", "Source IDs must be unique safe names")
        ids.add(source_id)
        if not isinstance(source.get("path"), str) or not source["path"].strip():
            fail("invalid_selection", "Every source requires an explicit nonempty path")
        original = Path(source["path"]).expanduser().absolute()
        if original.is_symlink():
            fail("symlink_refused", "Explicit source roots cannot be symlinks", path=str(original))
        path = original.resolve()
        kind = source.get("kind", "directory")
        if kind not in {"directory", "file"} or not (path.is_dir() if kind == "directory" else path.is_file()):
            fail("invalid_selection", "Source path does not match its declared kind", path=str(path))
        includes, excludes = source.get("include", ["**"]), source.get("exclude", [])
        if not isinstance(includes, list) or not isinstance(excludes, list) or not includes or not all(isinstance(p, str) for p in includes + excludes):
            fail("invalid_selection", "Include/exclude patterns must be string lists")
        provenance = source.get("provenance", {})
        if not isinstance(provenance, dict):
            fail("invalid_selection", "Source provenance must be a JSON object")
        sources.append({"id": source_id, "path": str(path), "kind": kind,
                        "include": includes, "exclude": excludes, "provenance": provenance})
    if not sources:
        fail("empty_selection", "Select at least one explicit source root or file")
    return sources


def enumerate_files(sources):
    for source in sources:
        root = Path(source["path"])
        if source["kind"] == "file":
            yield source, root.name, root
            continue

        def walk_error(_error):
            fail("source_unavailable", "Cannot enumerate a selected source", source_id=source["id"])

        for directory, dirs, files in os.walk(root, followlinks=False, onerror=walk_error):
            base = Path(directory)
            admitted = []
            for name in sorted(dirs):
                path = base / name
                relative = path.relative_to(root).as_posix()
                if matches(relative, source["exclude"]) or matches(relative + "/", source["exclude"]):
                    continue
                if path.is_symlink():
                    fail("symlink_refused", "Selected directory contains a symlink", path=str(path))
                admitted.append(name)
            dirs[:] = admitted
            for name in sorted(files):
                path = base / name
                relative = safe_relative(path.relative_to(root).as_posix())
                if matches(relative, source["exclude"]) or not matches(relative, source["include"]):
                    continue
                yield source, relative, path


def inventory_file(source, relative, path, chunk_bytes):
    before = file_stat(path)
    digest, chunks, offset = hashlib.sha256(), [], 0
    with stable_reader(path, before) as stream:
        while data := stream.read(chunk_bytes):
            digest.update(data)
            chunks.append({"offset": offset, "bytes": len(data), "sha256": sha(data)})
            offset += len(data)
    if offset != before["size"]:
        fail("source_changed", "Selected source length changed", path=str(path))
    return {"source_id": source["id"], "path": relative, "bytes": offset,
            "sha256": digest.hexdigest(), "chunks": chunks, "stat": before}


def manifest_totals(files):
    objects = {chunk["sha256"]: chunk["bytes"] for item in files for chunk in item["chunks"]}
    return {"files": len(files), "unique_files": len({item["sha256"] for item in files}),
            "logical_bytes": sum(item["bytes"] for item in files), "objects": len(objects),
            "stored_bytes": sum(objects.values())}


def write_new(path, data):
    """Atomic create only, even if another process races us. Never truncate an existing file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".archive-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.link(temporary, path)
        except FileExistsError:
            if path.read_bytes() != data:
                fail("local_conflict", "Refusing to replace an existing local artifact", path=str(path))
    finally:
        Path(temporary).unlink(missing_ok=True)


def inventory(selection, state_dir=DEFAULT_STATE, chunk_bytes=CHUNK_BYTES):
    if not 1 <= chunk_bytes <= 128 * 1024 * 1024:
        fail("invalid_chunk_size", "Chunk size must be positive and no more than 128 MiB")
    sources = normalize_sources(selection)
    snapshot_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ-") + uuid.uuid4().hex[:12]
    snapshot_dir = Path(state_dir) / "snapshots" / snapshot_id
    files = [inventory_file(source, relative, path, chunk_bytes)
             for source, relative, path in enumerate_files(sources)]
    if not files:
        fail("empty_selection", "No selected regular files matched the source selection")
    absent = sorted({source["id"] for source in sources} - {item["source_id"] for item in files})
    if absent:
        fail("empty_source", "A selected source matched no files; refine the selection explicitly", source_ids=absent)
    manifest = {"schema": SCHEMA, "snapshot_id": snapshot_id, "created_at": utc(),
                "chunk_bytes": chunk_bytes, "sources": sources, "files": files,
                "totals": manifest_totals(files)}
    validate_manifest(manifest)
    data = canonical(manifest)
    if len(data) > MAX_MANIFEST_BYTES:
        fail("manifest_too_large", "Split this selection into smaller snapshots; manifest exceeds 256 MiB")
    path = snapshot_dir / "manifest.json"
    write_new(path, data)
    write_new(snapshot_dir / "manifest.sha256", (sha(data) + "\n").encode())
    return {"status": "inventoried", "snapshot_id": snapshot_id, "manifest": str(path),
            "manifest_sha256": sha(data), "totals": manifest["totals"]}


def validate_manifest(manifest):
    try:
        if manifest["schema"] != SCHEMA or not SNAPSHOT_RE.fullmatch(manifest["snapshot_id"]):
            raise ValueError()
        chunk_bytes = manifest["chunk_bytes"]
        if not isinstance(chunk_bytes, int) or not 1 <= chunk_bytes <= 128 * 1024 * 1024:
            raise ValueError()
        sources = {source["id"]: source for source in manifest["sources"]}
        if len(sources) != len(manifest["sources"]) or not sources:
            raise ValueError()
        for source_id, source in sources.items():
            if not ID_RE.fullmatch(source_id) or source["kind"] not in {"file", "directory"}:
                raise ValueError()
        paths, full_hashes, object_sizes = set(), {}, {}
        if not manifest["files"]:
            raise ValueError()
        for item in manifest["files"]:
            safe_relative(item["path"])
            identity = (item["source_id"], item["path"])
            if item["source_id"] not in sources or identity in paths or not HASH_RE.fullmatch(item["sha256"]):
                raise ValueError()
            paths.add(identity)
            if not isinstance(item["bytes"], int) or item["bytes"] < 0:
                raise ValueError()
            local_stat = item["stat"]
            if (any(type(local_stat[key]) is not int for key in ("device", "inode", "size", "mtime_ns", "ctime_ns", "mode"))
                    or local_stat["size"] != item["bytes"] or not 0 <= local_stat["mode"] <= 0o7777):
                raise ValueError()
            offset = 0
            for index, chunk in enumerate(item["chunks"]):
                if not HASH_RE.fullmatch(chunk["sha256"]) or chunk["offset"] != offset:
                    raise ValueError()
                if not isinstance(chunk["bytes"], int) or not 0 < chunk["bytes"] <= chunk_bytes:
                    raise ValueError()
                if index < len(item["chunks"]) - 1 and chunk["bytes"] != chunk_bytes:
                    raise ValueError()
                if object_sizes.setdefault(chunk["sha256"], chunk["bytes"]) != chunk["bytes"]:
                    raise ValueError()
                offset += chunk["bytes"]
            if offset != item["bytes"] or (not offset and item["sha256"] != sha(b"")):
                raise ValueError()
            if len(item["chunks"]) == 1 and item["sha256"] != item["chunks"][0]["sha256"]:
                raise ValueError()
            if full_hashes.setdefault(item["sha256"], item["chunks"]) != item["chunks"]:
                raise ValueError()
        if manifest_totals(manifest["files"]) != manifest["totals"]:
            raise ValueError()
    except (KeyError, TypeError, ValueError, AttributeError):
        fail("invalid_manifest", "Manifest schema, paths, totals or content hashes are inconsistent")
    return manifest


def load_manifest(path):
    path = Path(path)
    data = path.read_bytes()
    expected = path.with_name("manifest.sha256").read_text().strip()
    if not HASH_RE.fullmatch(expected) or sha(data) != expected:
        fail("manifest_changed", "Local manifest differs from its inventory SHA-256")
    try:
        manifest = json.loads(data)
    except ValueError:
        fail("invalid_manifest", "Manifest is not valid JSON")
    return validate_manifest(manifest), data


def source_path(manifest, item):
    source = next(source for source in manifest["sources"] if source["id"] == item["source_id"])
    return Path(source["path"]) if source["kind"] == "file" else Path(source["path"]) / item["path"]


def remote_code(error):
    response = getattr(error, "response", {})
    code = str(response.get("Error", {}).get("Code", "RemoteError"))
    return code if re.fullmatch(r"[A-Za-z0-9_-]{1,80}", code) else "RemoteError"


def remote_get(client, bucket, key):
    try:
        return client.get_object(Bucket=bucket, Key=key)
    except Exception as error:
        code = remote_code(error)
        if code in {"404", "NoSuchKey", "NotFound"}:
            return None
        fail("remote_error", "Remote read failed", remote_code=code, key=key)


def consume(response, expected_hash=None, expected_bytes=None, sink=None, digest=None, limit=None):
    count, own = 0, hashlib.sha256()
    body = response["Body"]
    try:
        while data := body.read(READ_BYTES):
            count += len(data)
            if limit is not None and count > limit:
                fail("remote_size", "Remote object exceeds the permitted size")
            own.update(data)
            if digest is not None:
                digest.update(data)
            if sink is not None:
                sink.write(data)
    except ArchiveError:
        raise
    except Exception:
        fail("remote_read_interrupted", "Remote body could not be completely read")
    finally:
        body.close()
    if count != response.get("ContentLength", count) or (expected_bytes is not None and count != expected_bytes):
        fail("remote_corrupt", "Remote object length does not match the manifest")
    actual = own.hexdigest()
    if expected_hash is not None and actual != expected_hash:
        fail("remote_corrupt", "Remote object SHA-256 does not match the manifest", expected_sha256=expected_hash, actual_sha256=actual)
    return actual, count


def read_bytes(client, bucket, key, limit, expected_hash=None, expected_bytes=None):
    response = remote_get(client, bucket, key)
    if response is None:
        return None
    output = io.BytesIO()
    consume(response, expected_hash, expected_bytes, output, limit=limit)
    return output.getvalue()


def conditional_put(client, bucket, key, data, content_type="application/octet-stream"):
    try:
        client.put_object(Bucket=bucket, Key=key, Body=data, ContentLength=len(data),
                          ContentType=content_type, ContentMD5=base64.b64encode(hashlib.md5(data).digest()).decode(),
                          IfNoneMatch="*", Metadata={"sha256": sha(data)})
        return True
    except Exception as error:
        code = remote_code(error)
        if code in {"412", "PreconditionFailed", "409", "ConditionalRequestConflict"}:
            return False
        # Never fall back to an unconditional PUT if a client/server lacks support.
        fail("remote_write_failed", "Conditional create failed; no unconditional overwrite attempted", remote_code=code, key=key)


def verified_create(client, bucket, key, data, content_type="application/json", known_absent=False):
    expected_hash = sha(data)
    if not known_absent:
        existing = remote_get(client, bucket, key)
        if existing is not None:
            consume(existing, expected_hash, len(data), limit=len(data))
            return False
    try:
        created = conditional_put(client, bucket, key, data, content_type)
    except ArchiveError:
        # A concurrent creator or bucket retention rule may return AccessDenied
        # instead of 412. Existing bytes are usable only after a complete hash check.
        existing = remote_get(client, bucket, key)
        if existing is None:
            raise
        consume(existing, expected_hash, len(data), limit=len(data))
        return False
    response = remote_get(client, bucket, key)
    if response is None:
        fail("remote_missing", "Object is absent after conditional create", key=key)
    consume(response, expected_hash, len(data), limit=len(data))
    return created


class Journal:
    def __init__(self, directory):
        self.path, self.mutex = Path(directory) / "journal.jsonl", threading.Lock()
        # A kill can leave a partial final record. It is never treated as proof.
        if self.path.exists():
            data = self.path.read_bytes()
            if data and not data.endswith(b"\n"):
                with self.path.open("r+b") as stream:
                    stream.truncate(data.rfind(b"\n") + 1)
                    stream.flush()
                    os.fsync(stream.fileno())

    def append(self, event, **values):
        with self.mutex:
            with self.path.open("ab") as stream:
                stream.write(canonical({"at": utc(), "event": event, **values}))
                stream.flush()
                os.fsync(stream.fileno())


@contextmanager
def snapshot_lock(directory):
    import fcntl  # macOS/Linux; kernel releases the lock after a crash.
    with (Path(directory) / "operation.lock").open("a+b") as stream:
        try:
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            fail("snapshot_busy", "Another operation holds this local snapshot")
        try:
            yield
        finally:
            fcntl.flock(stream, fcntl.LOCK_UN)


def bounded_results(function, values, workers):
    if not 1 <= workers <= MAX_WORKERS:
        fail("invalid_workers", f"Workers must be between 1 and {MAX_WORKERS}")
    iterator = iter(values)
    with ThreadPoolExecutor(max_workers=workers) as executor:
        queue = deque()
        for _ in range(workers * 2):
            try:
                queue.append(executor.submit(function, next(iterator)))
            except StopIteration:
                break
        while queue:
            yield queue.popleft().result()
            try:
                queue.append(executor.submit(function, next(iterator)))
            except StopIteration:
                pass


def upload_snapshot(client, bucket, manifest_path, workers=4, progress=None):
    validate_bucket(bucket)
    manifest_path = Path(manifest_path)
    manifest, data = load_manifest(manifest_path)
    directory, snapshot_id = manifest_path.parent, manifest["snapshot_id"]
    with snapshot_lock(directory):
        journal = Journal(directory)
        # Bind the resume journal to a destination without storing credentials.
        endpoint = getattr(getattr(client, "meta", None), "endpoint_url", "test-client")
        write_new(directory / "destination.json", canonical({"bucket": bucket, "endpoint_sha256": sha(endpoint.encode()), "manifest_sha256": sha(data)}))
        for item in manifest["files"]:
            ensure_stat(source_path(manifest, item), item["stat"])
        objects = {}
        for item in manifest["files"]:
            for chunk in item["chunks"]:
                objects.setdefault(chunk["sha256"], (item, chunk))

        def transfer(pair):
            item, chunk = pair
            digest, key = chunk["sha256"], object_key(chunk["sha256"])
            try:
                response = remote_get(client, bucket, key)
                created = False
                if response is not None:
                    consume(response, digest, chunk["bytes"], limit=chunk["bytes"])
                else:
                    path = source_path(manifest, item)
                    with stable_reader(path, item["stat"]) as stream:
                        stream.seek(chunk["offset"])
                        value = stream.read(chunk["bytes"])
                    if len(value) != chunk["bytes"] or sha(value) != digest:
                        fail("source_changed", "Source bytes differ from the frozen inventory", path=str(path))
                    created = verified_create(client, bucket, key, value, "application/octet-stream", known_absent=True)
                journal.append("object_verified", sha256=digest, bytes=chunk["bytes"], created=created)
                return {"ok": True, "created": created, "bytes": chunk["bytes"]}
            except ArchiveError as error:
                journal.append("object_failed", sha256=digest, error=error.record())
                return {"ok": False, "error": error.record()}

        completed = created = verified_bytes = error_count = 0
        errors = []
        for result in bounded_results(transfer, objects.values(), workers):
            if result["ok"]:
                completed += 1
                created += int(result["created"])
                verified_bytes += result["bytes"]
            else:
                error_count += 1
                if len(errors) < 50:
                    errors.append(result["error"])
            if progress and (completed + error_count) % 100 == 0:
                progress({"status": "uploading", "snapshot_id": snapshot_id, "verified_objects": completed,
                          "objects": len(objects), "verified_bytes": verified_bytes, "error_count": error_count})
        summary = {"snapshot_id": snapshot_id, "bucket": bucket, "totals": manifest["totals"],
                   "verified_objects": completed, "uploaded_objects": created,
                   "reused_objects": completed - created, "verified_bytes": verified_bytes,
                   "error_count": error_count, "errors": errors}
        if error_count:
            return {"status": "incomplete", **summary}
        for item in manifest["files"]:
            ensure_stat(source_path(manifest, item), item["stat"])
        manifest_key = snapshot_key(snapshot_id, "manifest.json")
        verified_create(client, bucket, manifest_key, data)
        receipt_key = snapshot_key(snapshot_id, "receipt.json")
        old = read_bytes(client, bucket, receipt_key, 65536)
        if old is not None:
            receipt = parse_receipt(old, snapshot_id)
            if receipt["manifest"] != {"key": manifest_key, "sha256": sha(data), "bytes": len(data)} or receipt["totals"] != manifest["totals"]:
                fail("snapshot_conflict", "Existing snapshot receipt names different content")
            receipt_data = old
        else:
            pending = directory / "receipt.pending.json"
            if pending.exists():
                receipt_data = pending.read_bytes()
                receipt = parse_receipt(receipt_data, snapshot_id)
                if receipt["manifest"] != {"key": manifest_key, "sha256": sha(data), "bytes": len(data)} or receipt["totals"] != manifest["totals"]:
                    fail("snapshot_conflict", "Pending receipt does not match this manifest")
            else:
                receipt = {"schema": SCHEMA, "snapshot_id": snapshot_id, "committed_at": utc(),
                           "manifest": {"key": manifest_key, "sha256": sha(data), "bytes": len(data)},
                           "totals": manifest["totals"]}
                receipt_data = canonical(receipt)
                write_new(pending, receipt_data)
            verified_create(client, bucket, receipt_key, receipt_data)
        # A local completion marker appears only after full read-back of both metadata objects.
        write_new(directory / "receipt.json", receipt_data)
        write_new(directory / "receipt.sha256", (sha(receipt_data) + "\n").encode())
        journal.append("snapshot_committed", manifest_sha256=sha(data), receipt_sha256=sha(receipt_data))
        return {"status": "committed", **summary, "manifest_key": manifest_key,
                "manifest_sha256": sha(data), "receipt_key": receipt_key,
                "receipt_sha256": sha(receipt_data)}


def parse_receipt(data, snapshot_id):
    try:
        receipt = json.loads(data)
        expected_key = snapshot_key(snapshot_id, "manifest.json")
        if (receipt["schema"] != SCHEMA or receipt["snapshot_id"] != snapshot_id or
                receipt["manifest"]["key"] != expected_key or
                not HASH_RE.fullmatch(receipt["manifest"]["sha256"]) or
                not isinstance(receipt["manifest"]["bytes"], int) or
                not 0 < receipt["manifest"]["bytes"] <= MAX_MANIFEST_BYTES):
            raise ValueError()
        return receipt
    except (KeyError, TypeError, ValueError):
        fail("invalid_receipt", "Snapshot receipt is invalid")


def remote_manifest(client, bucket, snapshot_id, receipt_sha256=None):
    validate_bucket(bucket)
    data = read_bytes(client, bucket, snapshot_key(snapshot_id, "receipt.json"), 65536, receipt_sha256)
    if data is None:
        fail("snapshot_incomplete", "Snapshot has no committed receipt; refusing partial restore/verification")
    receipt = parse_receipt(data, snapshot_id)
    pointer = receipt["manifest"]
    raw = read_bytes(client, bucket, pointer["key"], MAX_MANIFEST_BYTES, pointer["sha256"], pointer["bytes"])
    if raw is None:
        fail("remote_missing", "Committed snapshot manifest is missing")
    try:
        manifest = validate_manifest(json.loads(raw))
    except ValueError:
        fail("invalid_manifest", "Remote manifest is not valid JSON")
    if manifest["snapshot_id"] != snapshot_id or manifest["totals"] != receipt.get("totals"):
        fail("snapshot_conflict", "Receipt and manifest describe different snapshots")
    return manifest, sha(data)


def stream_original(client, bucket, item, sink=None):
    digest = hashlib.sha256()
    for chunk in item["chunks"]:
        response = remote_get(client, bucket, object_key(chunk["sha256"]))
        if response is None:
            fail("remote_missing", "A committed content object is missing", sha256=chunk["sha256"])
        consume(response, chunk["sha256"], chunk["bytes"], sink, digest, chunk["bytes"])
    if digest.hexdigest() != item["sha256"]:
        fail("file_hash_mismatch", "Reassembled original SHA-256 differs from the manifest",
             source_id=item["source_id"], path=item["path"])


def verify_snapshot(client, bucket, snapshot_id, workers=4, receipt_sha256=None):
    manifest, receipt_hash = remote_manifest(client, bucket, snapshot_id, receipt_sha256)
    unique_files = {item["sha256"]: item for item in manifest["files"]}

    def verify(item):
        try:
            stream_original(client, bucket, item)
            return None
        except ArchiveError as error:
            return error.record()

    errors = [error for error in bounded_results(verify, unique_files.values(), workers) if error]
    return {"status": "verified" if not errors else "corrupt", "snapshot_id": snapshot_id,
            "receipt_sha256": receipt_hash, "totals": manifest["totals"],
            "verified_unique_files": len(unique_files) - len(errors),
            "error_count": len(errors), "errors": errors[:50]}


def ensure_restore_parent(root, relative):
    safe_relative(relative)
    # Reject symlinks in existing ancestors as well as in the requested root.
    for ancestor in (root, *root.parents):
        if ancestor.is_symlink():
            fail("unsafe_restore_path", "Restore destination traverses a symlink")
    root.mkdir(parents=True, exist_ok=True)
    if root.is_symlink():
        fail("unsafe_restore_path", "Restore destination cannot be a symlink")
    current = root
    for part in PurePosixPath(relative).parts[:-1]:
        current = current / part
        try:
            current.mkdir()
        except FileExistsError:
            pass
        if current.is_symlink() or not current.is_dir():
            fail("unsafe_restore_path", "A restore path traverses a symlink or non-directory")
    return root / relative


def restore_snapshot(client, bucket, snapshot_id, destination, workers=4, receipt_sha256=None):
    manifest, receipt_hash = remote_manifest(client, bucket, snapshot_id, receipt_sha256)
    root = Path(destination).absolute()

    def restore(item):
        temporary = None
        try:
            target = ensure_restore_parent(root, item["source_id"] + "/" + item["path"])
            if target.exists() or target.is_symlink():
                before = file_stat(target)
                digest = hashlib.sha256()
                with stable_reader(target, before) as stream:
                    while data := stream.read(READ_BYTES):
                        digest.update(data)
                if before["size"] != item["bytes"] or digest.hexdigest() != item["sha256"]:
                    fail("restore_conflict", "Existing destination has different bytes; it was not overwritten", path=str(target))
                return {"ok": True, "created": False}
            fd, temporary = tempfile.mkstemp(prefix=".restore-", dir=target.parent)
            with os.fdopen(fd, "wb") as stream:
                stream_original(client, bucket, item, stream)
                stream.flush()
                os.fsync(stream.fileno())
            # Link is atomic create-only; even a late competing local writer is preserved.
            try:
                os.link(temporary, target)
            except FileExistsError:
                fail("restore_conflict", "Destination appeared during restore; it was not overwritten", path=str(target))
            os.chmod(target, item["stat"]["mode"] & 0o777)
            os.utime(target, ns=(item["stat"]["mtime_ns"], item["stat"]["mtime_ns"]))
            return {"ok": True, "created": True}
        except ArchiveError as error:
            return {"ok": False, "error": error.record()}
        finally:
            if temporary:
                Path(temporary).unlink(missing_ok=True)

    results = list(bounded_results(restore, manifest["files"], workers))
    errors = [result["error"] for result in results if not result["ok"]]
    return {"status": "restored" if not errors else "incomplete", "snapshot_id": snapshot_id,
            "receipt_sha256": receipt_hash, "destination": str(root), "totals": manifest["totals"],
            "restored_files": sum(result["ok"] and result["created"] for result in results),
            "existing_verified_files": sum(result["ok"] and not result["created"] for result in results),
            "error_count": len(errors), "errors": errors[:50]}


def make_client(env_file):
    # Parse data, never execute/source the env file. Never print values or SDK errors.
    values = {}
    for raw in Path(env_file).read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.removeprefix("export ").split("=", 1)
        name, value = name.strip(), value.strip()
        if name in {"R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_SESSION_TOKEN"}:
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            values[name] = value
    if any(not values.get(name) for name in ("R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY")):
        fail("credentials_missing", "Env file must provide R2_ENDPOINT, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY")
    endpoint = urlparse(values["R2_ENDPOINT"])
    if (endpoint.scheme != "https" or not (endpoint.hostname or "").endswith(".r2.cloudflarestorage.com")
            or endpoint.path not in {"", "/"} or endpoint.query or endpoint.fragment or endpoint.username or endpoint.password):
        fail("invalid_endpoint", "Use the HTTPS account-level Cloudflare R2 S3 endpoint")
    try:
        import boto3
        from botocore.config import Config
    except ImportError:
        fail("dependency_missing", "Run with the existing ~/.venvs/hiraia-publish Python environment (boto3 required)")
    client = boto3.client("s3", endpoint_url=values["R2_ENDPOINT"], region_name="auto",
                          aws_access_key_id=values["R2_ACCESS_KEY_ID"], aws_secret_access_key=values["R2_SECRET_ACCESS_KEY"],
                          aws_session_token=values.get("R2_SESSION_TOKEN") or None,
                          config=Config(signature_version="s3v4", retries={"mode": "standard", "max_attempts": 5},
                                        max_pool_connections=MAX_WORKERS, connect_timeout=20, read_timeout=120,
                                        request_checksum_calculation="when_required", response_checksum_validation="when_required"))
    if "IfNoneMatch" not in client.meta.service_model.operation_model("PutObject").input_shape.members:
        fail("conditional_create_unsupported", "The installed SDK must support PutObject IfNoneMatch; refusing unsafe writes")
    return client


def operational_path(path):
    value = Path(path).expanduser().absolute()
    resolved = value.resolve()
    if resolved.is_relative_to(REPO) and not resolved.is_relative_to(DEFAULT_STATE):
        fail("tracked_state_refused", "Operational state inside this repository must stay under ignored build/reference-archive/")
    return value


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    plan = commands.add_parser("inventory", help="Freeze an explicit local file selection; no credentials/network")
    plan.add_argument("--selection", type=Path)
    plan.add_argument("--root", action="append", default=[], metavar="ID=PATH")
    plan.add_argument("--file", action="append", default=[], metavar="ID=PATH")
    plan.add_argument("--state-dir", type=Path, default=DEFAULT_STATE)
    plan.add_argument("--chunk-mib", type=int, default=64)
    for name in ("upload", "verify", "restore"):
        command = commands.add_parser(name)
        command.add_argument("--env-file", required=True, type=Path)
        command.add_argument("--bucket", required=True, help="Previously verified private bucket; no public default")
        command.add_argument("--workers", type=int, default=4, help="Concurrent transfers, 1–16 (default: 4)")
        if name == "upload":
            command.add_argument("--manifest", required=True, type=Path)
        else:
            command.add_argument("--snapshot", required=True)
            command.add_argument("--receipt-sha256", help="Optional trusted hash from the original commit receipt")
        if name == "restore":
            command.add_argument("--destination", required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        if args.command == "inventory":
            selection = json.loads(args.selection.read_text()) if args.selection else {"schema": 1, "sources": []}
            for option, kind in ((args.root, "directory"), (args.file, "file")):
                for value in option:
                    if "=" not in value:
                        fail("invalid_selection", "Explicit sources use ID=PATH")
                    source_id, path = value.split("=", 1)
                    selection.setdefault("sources", []).append({"id": source_id, "path": path, "kind": kind})
            result = inventory(selection, operational_path(args.state_dir), args.chunk_mib * 1024 * 1024)
        else:
            validate_bucket(args.bucket)  # Refuse a public bucket before reading any credentials.
            if not 1 <= args.workers <= MAX_WORKERS:
                fail("invalid_workers", f"Workers must be between 1 and {MAX_WORKERS}")
            if args.command == "upload":
                operational_path(args.manifest.parent)
            client = make_client(args.env_file)
            if args.command == "upload":
                result = upload_snapshot(client, args.bucket, args.manifest, args.workers,
                                         progress=lambda row: print(json.dumps(row), file=sys.stderr, flush=True))
            elif args.command == "verify":
                result = verify_snapshot(client, args.bucket, args.snapshot, args.workers, args.receipt_sha256)
            else:
                result = restore_snapshot(client, args.bucket, args.snapshot, operational_path(args.destination),
                                          args.workers, args.receipt_sha256)
        print(json.dumps(result, ensure_ascii=False, sort_keys=True))
        return 0 if result["status"] in {"inventoried", "committed", "verified", "restored"} else 1
    except ArchiveError as error:
        print(json.dumps({"status": "failed", "error": error.record()}, ensure_ascii=False, sort_keys=True))
        return 1
    except KeyboardInterrupt:
        print(json.dumps({"status": "interrupted", "message": "Resume the same immutable inventory; all remote bytes will be verified again."}))
        return 130
    except (OSError, ValueError, TypeError, KeyError) as error:
        print(json.dumps({"status": "failed", "error": {"code": type(error).__name__, "message": "Invalid or unavailable local input; no credentials are logged."}}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
