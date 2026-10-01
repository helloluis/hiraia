#!/usr/bin/env python3
"""Delete only pinned, reviewed local files whose archival proof was checked.

No network, directory deletion, recursive traversal, or remote deletion. A claim
is an exclusive same-directory rename; an interrupted claim is recoverable.
"""
import argparse
from collections import defaultdict
from contextlib import contextmanager
import ctypes
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import time

SHA = re.compile(r"[0-9a-f]{64}\Z")
DEFAULT_STATE = Path(__file__).resolve().parents[2] / "build/reference-archive/local-cleanup-state"
ZERO = "0" * 64


class CleanupError(Exception):
    def __init__(self, code, path=None):
        self.code, self.path = code, str(path) if path else None
        super().__init__(code)


def require(condition, code, path=None):
    if not condition:
        raise CleanupError(code, path)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def unique_keys(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, "duplicate_json_key")
        result[key] = value
    return result


def decode(data):
    return json.loads(data, object_pairs_hook=unique_keys)


def absolute(value):
    require(isinstance(value, str) and "\0" not in value, "invalid_path")
    p = Path(value)
    require(p.is_absolute() and ".." not in p.parts and str(p) == value,
            "path_not_absolute_normalized", value)
    return p


@contextmanager
def directory(path, create=False):
    """Open every component without following a symlink; keep the final fd."""
    path = absolute(str(path))
    fd = os.open(path.anchor, os.O_RDONLY | os.O_DIRECTORY)
    try:
        for part in path.parts[1:]:
            if create:
                try:
                    os.mkdir(part, 0o700, dir_fd=fd)
                    os.fsync(fd)
                except FileExistsError:
                    pass
            nxt = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = nxt
        yield fd
    finally:
        os.close(fd)


def fingerprint(s):
    return {"device": s.st_dev, "inode": s.st_ino, "size": s.st_size,
            "mtime_ns": s.st_mtime_ns, "ctime_ns": s.st_ctime_ns,
            "mode": stat.S_IMODE(s.st_mode), "links": s.st_nlink}


def same_directory(path, fd):
    with directory(path) as current:
        a, b = os.fstat(fd), os.fstat(current)
        require((a.st_dev, a.st_ino) == (b.st_dev, b.st_ino), "parent_changed", path)


def entry_stat(fd, name):
    try:
        return os.stat(name, dir_fd=fd, follow_symlinks=False)
    except FileNotFoundError:
        return None


@contextmanager
def verified_file(fd, name, row, claimed=False):
    before = entry_stat(fd, name)
    require(before is not None and stat.S_ISREG(before.st_mode), "not_regular", row["path"])
    require(before.st_nlink == 1, "hardlinked", row["path"])
    expected = row["stat"]
    current = fingerprint(before)
    # Rename changes ctime. All other reviewed identity fields must still match;
    # ctime must remain stable during the claimed-file hash.
    keys = set(expected) - ({"ctime_ns"} if claimed else set())
    require(all(current[k] == expected[k] for k in keys), "stat_changed", row["path"])
    handle = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=fd)
    try:
        require(fingerprint(os.fstat(handle)) == current, "identity_changed", row["path"])
        digest = hashlib.sha256()
        while block := os.read(handle, 1024 * 1024):
            digest.update(block)
        after = entry_stat(fd, name)
        require(after is not None and fingerprint(after) == current and
                fingerprint(os.fstat(handle)) == current, "changed_during_hash", row["path"])
        require(digest.hexdigest() == row["sha256"], "hash_mismatch", row["path"])
        yield current
    finally:
        os.close(handle)


def read_document(path, expected=None):
    p = absolute(str(path))
    with directory(p.parent) as fd:
        before = entry_stat(fd, p.name)
        require(before is not None and stat.S_ISREG(before.st_mode) and before.st_nlink == 1,
                "unsafe_evidence_file", p)
        require(before.st_size <= 512 * 1024 * 1024, "document_too_large", p)
        handle = os.open(p.name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=fd)
        try:
            require(fingerprint(os.fstat(handle)) == fingerprint(before), "evidence_changed", p)
            pieces = []
            while block := os.read(handle, 1024 * 1024):
                pieces.append(block)
            after = entry_stat(fd, p.name)
            require(after is not None and fingerprint(after) == fingerprint(before) and
                    fingerprint(os.fstat(handle)) == fingerprint(before), "evidence_changed", p)
        finally:
            os.close(handle)
    raw = b"".join(pieces)
    if expected is not None:
        require(isinstance(expected, str) and SHA.fullmatch(expected) and sha(raw) == expected,
                "document_hash_mismatch", p)
    return raw


def load_plan(path, pin=None, applying=False):
    require(not applying or (isinstance(pin, str) and SHA.fullmatch(pin)), "apply_requires_plan_sha256")
    raw = read_document(path)
    plan_sha = sha(raw)
    require(pin is None or pin == plan_sha, "plan_hash_mismatch", path)
    plan = decode(raw)
    require(plan.get("schema") == 1, "unsupported_plan_schema")
    roots = [absolute(v) for v in plan["allowed_roots"]]
    protected = [absolute(v) for v in plan["protected_paths"]]
    require(roots and all(p != Path(p.anchor) for p in roots), "unsafe_allowed_roots")
    for root in roots:
        with directory(root):
            pass
    verification = plan["remote_verification"]
    evidence = decode(read_document(absolute(verification["path"]), verification["sha256"]))
    require(evidence.get("status") == "matched", "remote_verification_not_matched")
    remote = {s["snapshot_id"]: s for s in evidence["snapshots"]}
    require(len(remote) == len(evidence["snapshots"]), "duplicate_snapshot")
    archived, archived_locations = set(), set()
    evidence_paths = {absolute(str(path)), absolute(verification["path"])}
    snapshot_ids = set()
    for source in plan["snapshots"]:
        mp, rp = absolute(source["manifest_path"]), absolute(source["receipt_path"])
        evidence_paths.update((mp, rp))
        mr, rr = read_document(mp), read_document(rp)
        manifest, receipt = decode(mr), decode(rr)
        sid = manifest["snapshot_id"]
        require(sid in remote and sid not in snapshot_ids, "untrusted_or_duplicate_snapshot")
        trusted = remote[sid]
        require(trusted.get("remote_manifest_and_receipt") == "matched" and
                trusted.get("prior_full_restore") == "all files restored into a fresh directory, zero errors",
                "snapshot_not_verified_and_restored")
        require(sha(mr) == trusted["manifest_sha256"] and sha(rr) == trusted["receipt_sha256"],
                "archive_evidence_mismatch")
        require(receipt["snapshot_id"] == sid and receipt["manifest"]["sha256"] == sha(mr) and
                receipt["manifest"]["bytes"] == len(mr), "receipt_manifest_mismatch")
        snapshot_ids.add(sid)
        for item in manifest["files"]:
            archived.add((sid, item["sha256"], item["bytes"]))
            archived_locations.add((sid, item["source_id"], item["path"], item["sha256"], item["bytes"]))
    proofs, paths = {}, set()
    require(isinstance(plan["files"], list) and plan["files"], "empty_plan")
    for row in plan["files"]:
        p = absolute(row["path"])
        require(p not in paths, "duplicate_path", p)
        paths.add(p)
        require(any(p.is_relative_to(root) and p != root for root in roots), "outside_allowed_roots", p)
        require(not any(p == q or p.is_relative_to(q) for q in protected), "protected_path", p)
        require(not p.name.startswith(".hiraia-cleanup-") and
                not p.name.endswith(".hiraia-archive-offloaded.json"), "reserved_path", p)
        require(isinstance(row["sha256"], str) and SHA.fullmatch(row["sha256"]), "invalid_file_sha256", p)
        require(type(row["bytes"]) is int and row["bytes"] >= 0, "invalid_file_size", p)
        expected = row["stat"]
        require(set(expected) == {"device", "inode", "size", "mtime_ns", "ctime_ns", "mode", "links"}
                and all(type(v) is int for v in expected.values()), "invalid_stat", p)
        expected["mode"] = stat.S_IMODE(expected["mode"])
        require(expected["size"] == row["bytes"] and expected["links"] == 1, "unsafe_reviewed_stat", p)
        proof = row["archive"]
        if proof["kind"] == "exact-file":
            require((proof["snapshot_id"], row["sha256"], row["bytes"]) in archived,
                    "file_not_in_verified_archive", p)
        elif proof["kind"] == "provider-fields":
            pp = absolute(proof["proof_path"])
            evidence_paths.add(pp)
            key = (str(pp), proof["proof_sha256"])
            if key not in proofs:
                entries = [decode(line) for line in read_document(pp, key[1]).splitlines() if line.strip()]
                proofs[key] = {entry["path"]: entry for entry in entries}
                require(len(proofs[key]) == len(entries), "duplicate_provider_proof")
            record = proofs[key].get(str(p), {})
            counts = record.get("proof", {})
            require(record.get("sha256") == row["sha256"] and record.get("bytes") == row["bytes"] and
                    record.get("decision") == "eligible-after-final-reader-and-stat-check" and
                    record.get("all_nonpayload_json_fields_preserved") is True and
                    record.get("all_image_bytes_match_restored_archive") is True and
                    record.get("source_before_after_fingerprints_match") is True and
                    record.get("source_matches_prior_recovery_sha256") is True and
                    record.get("source_json_duplicate_keys_accepted") is False and
                    record.get("raw_json_reconstruction", {}).get("byte_identical_reconstruction_verified") is True and
                    record.get("raw_json_reconstruction", {}).get("reconstructed_sha256") == row["sha256"] and
                    not record.get("errors") and counts.get("errors", 0) == 0 and
                    counts.get("json_records", 0) > 0 and
                    counts.get("semantically_identical_records") == counts.get("json_records"),
                    "provider_fields_not_proven", p)
            compact = record["archived_compact_metadata"]
            require((compact["snapshot_id"], compact["source_id"], compact["path"], compact["sha256"],
                     compact["bytes"]) in archived_locations, "provider_metadata_not_archived", p)
            payloads = record["image_payload_archive_proofs"]
            require(len(payloads) == record["unique_payloads"] and
                    (bool(payloads) or counts.get("images", 0) == 0), "provider_payload_proof_missing", p)
            for payload in payloads:
                require((payload["snapshot_id"], payload["sha256"], payload["bytes"]) in archived,
                        "provider_payload_not_archived", p)
        else:
            raise CleanupError("unknown_archive_proof", p)
    require(not (paths & evidence_paths), "plan_targets_own_evidence")
    plan["_sha256"], plan["_evidence_paths"] = plan_sha, evidence_paths
    return plan


def rename_exclusive(fd, source, destination):
    """Native no-overwrite rename, with no unsafe check-then-rename fallback."""
    libc = ctypes.CDLL(None, use_errno=True)
    if sys.platform == "darwin":
        function, flag = libc.renameatx_np, 0x4  # RENAME_EXCL, <sys/stdio.h>
    elif sys.platform.startswith("linux") and hasattr(libc, "renameat2"):
        function, flag = libc.renameat2, 1  # RENAME_NOREPLACE
    else:
        raise CleanupError("exclusive_rename_not_supported")
    function.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    function.restype = ctypes.c_int
    if function(fd, os.fsencode(source), fd, os.fsencode(destination), flag) != 0:
        error = ctypes.get_errno()
        raise OSError(error, os.strerror(error), destination)


class Journal:
    def __init__(self, fd, plan_sha, readonly=False):
        self.fd, self.readonly, self.events, self.last = fd, readonly, [], ZERO
        self.by_row = defaultdict(list)
        fcntl.flock(fd, (fcntl.LOCK_SH if readonly else fcntl.LOCK_EX) | fcntl.LOCK_NB)
        require(stat.S_ISREG(os.fstat(fd).st_mode) and os.fstat(fd).st_nlink == 1, "unsafe_journal")
        with os.fdopen(os.dup(fd), "rb") as source:
            raw = source.read()
        valid = 0
        for line in raw.splitlines(keepends=True):
            if not line.endswith(b"\n"):
                break
            event = decode(line)
            signed = dict(event)
            checksum = signed.pop("sha256")
            require(event["sequence"] == len(self.events) and event["previous"] == self.last and
                    checksum == sha(self.encode(signed)), "journal_corrupt")
            self.events.append(event)
            if "row_id" in event:
                self.by_row[event["row_id"]].append(event["event"])
            self.last = checksum
            valid += len(line)
        if self.events:
            require(self.events[0]["event"] == "header" and
                    self.events[0]["plan_sha256"] == plan_sha, "journal_plan_mismatch")
        if not readonly:
            if valid != len(raw):
                os.ftruncate(fd, valid)
                os.fsync(fd)
            os.lseek(fd, 0, os.SEEK_END)
            if not self.events:
                self.append("header", plan_sha256=plan_sha)

    @staticmethod
    def encode(value):
        return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()

    def append(self, event, **fields):
        require(not self.readonly, "readonly_journal")
        item = {"event": event, "sequence": len(self.events), "previous": self.last,
                "at": datetime.now(timezone.utc).isoformat(), **fields}
        checksum = sha(self.encode(item))
        item["sha256"] = checksum
        line = self.encode(item) + b"\n"
        while line:
            count = os.write(self.fd, line)
            require(count > 0, "journal_write_failed")
            line = line[count:]
        os.fsync(self.fd)
        self.events.append(item)
        if "row_id" in item:
            self.by_row[item["row_id"]].append(event)
        self.last = checksum

    def row_events(self, row_id):
        return self.by_row.get(row_id, [])


@contextmanager
def open_journal(state, plan_sha, applying):
    target = state / plan_sha
    if not applying and not target.exists():
        yield None
        return
    with directory(target, create=applying) as parent:
        flags = os.O_RDWR | os.O_CREAT if applying else os.O_RDONLY
        try:
            fd = os.open("journal.jsonl", flags | os.O_NOFOLLOW, 0o600, dir_fd=parent)
        except FileNotFoundError:
            if applying:
                raise
            yield None
            return
        try:
            if applying:
                os.fsync(parent)
            yield Journal(fd, plan_sha, readonly=not applying)
        finally:
            os.close(fd)


def handle_row(row, plan_sha, journal, applying):
    path = Path(row["path"])
    row_id = sha(str(path).encode())
    claim = ".hiraia-cleanup-" + plan_sha + "-" + row_id + ".claim"
    events = journal.row_events(row_id) if journal else []
    with directory(path.parent) as parent:
        source, claimed = entry_stat(parent, path.name), entry_stat(parent, claim)
        if "deleted" in events or "recovered_deleted" in events:
            require(claimed is None, "unexpected_claim_after_completion", path)
            require(source is None, "source_recreated_after_cleanup", path)
            return "already_deleted"
        if source is None and claimed is None:
            require("unlink_intent" in events, "missing_without_delete_intent", path)
            if applying:
                journal.append("recovered_deleted", row_id=row_id, path=str(path))
            return "already_deleted"
        if claimed is None:
            with verified_file(parent, path.name, row):
                pass
            same_directory(path.parent, parent)
            if not applying:
                return "eligible"
            journal.append("prepared", row_id=row_id, path=str(path), claim=claim)
            rename_exclusive(parent, path.name, claim)
            os.fsync(parent)
        else:
            require("prepared" in events, "unowned_claim", path)
        try:
            with verified_file(parent, claim, row, claimed=True) as verified:
                same_directory(path.parent, parent)
                if not applying:
                    return "recoverable_claim"
                journal.append("claimed", row_id=row_id, path=str(path), claim=claim, stat=verified)
                journal.append("unlink_intent", row_id=row_id, path=str(path), claim=claim, stat=verified)
                same_directory(path.parent, parent)
                current = entry_stat(parent, claim)
                require(current is not None and fingerprint(current) == verified, "claim_changed_before_unlink", path)
                os.unlink(claim, dir_fd=parent)
                os.fsync(parent)
            journal.append("deleted", row_id=row_id, path=str(path), bytes=row["bytes"])
            return "deleted"
        except CleanupError:
            if applying and entry_stat(parent, claim) is not None:
                same_directory(path.parent, parent)
                try:
                    rename_exclusive(parent, claim, path.name)
                    os.fsync(parent)
                    journal.append("rolled_back", row_id=row_id, path=str(path), claim=claim)
                except OSError as error:
                    journal.append("rollback_blocked", row_id=row_id, path=str(path), claim=claim,
                                   errno=error.errno)
                    raise CleanupError("rollback_blocked_claim_preserved", path) from None
            raise


def execute(plan_path, pin=None, applying=False, state_dir=None):
    plan_path = Path(plan_path).absolute()
    plan = load_plan(plan_path, pin, applying)
    state = Path(state_dir or DEFAULT_STATE).absolute()
    require(not any(Path(r["path"]).is_relative_to(state) for r in plan["files"]), "plan_targets_cleanup_state")
    counts = {"eligible": 0, "recoverable_claim": 0, "deleted": 0, "already_deleted": 0}
    total_bytes = 0
    last_progress = time.monotonic()
    with open_journal(state, plan["_sha256"], applying) as journal:
        for number, row in enumerate(plan["files"], 1):
            try:
                result = handle_row(row, plan["_sha256"], journal, applying)
            except (CleanupError, OSError, KeyboardInterrupt) as error:
                if applying:
                    journal.append("interrupted" if isinstance(error, KeyboardInterrupt) else "refused",
                                   row_id=sha(row["path"].encode()), path=row["path"],
                                   code=getattr(error, "code", type(error).__name__))
                raise
            counts[result] += 1
            total_bytes += row["bytes"]
            if number % 500 == 0 or time.monotonic() - last_progress >= 15:
                print(json.dumps({"status": "progress", "phase": "apply" if applying else "dry_run",
                                  "processed_files": number, "total_files": len(plan["files"]),
                                  "logical_bytes": total_bytes, **counts}), file=sys.stderr, flush=True)
                last_progress = time.monotonic()
    return {"status": "applied" if applying else "dry_run", "plan_sha256": plan["_sha256"],
            "files": len(plan["files"]), "logical_bytes": total_bytes, **counts,
            "journal": str(state / plan["_sha256"] / "journal.jsonl") if applying else None}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", required=True)
    parser.add_argument("--plan-sha256")
    parser.add_argument("--state-dir")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args(argv)
    try:
        result = execute(args.plan, args.plan_sha256, args.apply, args.state_dir)
        code = 0
    except KeyboardInterrupt:
        result, code = {"status": "interrupted", "claims": "Retained for the same pinned plan to resume."}, 130
    except CleanupError as error:
        result, code = {"status": "refused", "code": error.code, "path": error.path}, 1
    except (OSError, ValueError, KeyError, TypeError) as error:
        result, code = {"status": "refused", "code": type(error).__name__}, 1
    print(json.dumps(result, ensure_ascii=False))
    return code


if __name__ == "__main__":
    raise SystemExit(main())
