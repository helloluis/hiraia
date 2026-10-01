#!/usr/bin/env python3
"""Mint short-lived archive credentials locally; never print credential values."""
from __future__ import annotations

import argparse
import base64
from datetime import datetime, timezone
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import time
import uuid

from archive import ArchiveError, DEFAULT_STATE, fail, validate_bucket


PREFIXES = ("objects/sha256/", "snapshots/")
DEFAULT_TTL = 6 * 60 * 60
MAX_TTL = 24 * 60 * 60
ACCOUNT_RE = re.compile(r"[0-9a-f]{32}\Z")
ENDPOINT_RE = re.compile(r"https://([0-9a-f]{32})(?:\.(eu|us|fedramp))?\.r2\.cloudflarestorage\.com/?\Z")
ENV_KEYS = {"R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_SESSION_TOKEN",
            "CLOUDFLARE_ACCOUNT_ID", "R2_ACCOUNT_ID"}


def parse_parent(path):
    values = {}
    for raw in Path(path).read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.removeprefix("export ").split("=", 1)
        name, value = name.strip(), value.strip()
        if name not in ENV_KEYS:
            continue
        if name in values:
            fail("ambiguous_parent", "Parent env file contains duplicate credential or account fields")
        if value.startswith(("'", '"')):
            if len(value) < 2 or value[-1] != value[0]:
                fail("invalid_parent", "Parent env file has an unterminated quoted value")
            value = value[1:-1]
        values[name] = value
    if values.get("R2_SESSION_TOKEN"):
        fail("temporary_parent_refused", "Use the original parent access key and secret, not temporary credentials")
    return values


def validate_parent(values):
    access = values.get("R2_ACCESS_KEY_ID", "")
    secret = values.get("R2_SECRET_ACCESS_KEY", "")
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,256}", access) or not secret or any(not 33 <= ord(c) <= 126 for c in secret):
        fail("invalid_parent", "Parent env file must contain valid R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY")
    accounts = [values[name] for name in ("CLOUDFLARE_ACCOUNT_ID", "R2_ACCOUNT_ID") if values.get(name)]
    if any(not ACCOUNT_RE.fullmatch(value) for value in accounts) or len(set(accounts)) > 1:
        fail("invalid_account", "Configured Cloudflare account IDs are invalid or inconsistent")
    endpoint = values.get("R2_ENDPOINT")
    if not endpoint:
        if not accounts:
            fail("endpoint_missing", "Provide R2_ENDPOINT or a valid CLOUDFLARE_ACCOUNT_ID/R2_ACCOUNT_ID")
        endpoint = f"https://{accounts[0]}.r2.cloudflarestorage.com"
    match = ENDPOINT_RE.fullmatch(endpoint)
    if not match:
        fail("invalid_endpoint", "Use an HTTPS account-level Cloudflare R2 endpoint without a port, query or credentials")
    account = match.group(1)
    if accounts and accounts[0] != account:
        fail("account_mismatch", "R2 endpoint and configured Cloudflare account ID differ")
    return endpoint.rstrip("/"), account, access, secret


def validate_ttl(seconds):
    if type(seconds) is not int or not 1 <= seconds <= MAX_TTL:
        fail("invalid_ttl", "Credential lifetime must be between 1 and 86400 seconds (24 hours)")
    return seconds


def b64url(value):
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def json_part(value):
    return b64url(json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8"))


def derive_credentials(values, bucket, upload=False, ttl_seconds=DEFAULT_TTL, now=None):
    validate_bucket(bucket)
    validate_ttl(ttl_seconds)
    if type(upload) is not bool:
        fail("invalid_scope", "Write permission requires an explicit upload flag")
    endpoint, account, access, secret = validate_parent(values)
    issued = int(time.time()) if now is None else now
    if type(issued) is not int or issued < 0:
        fail("invalid_time", "Issue time must be a nonnegative UTC Unix timestamp")
    scope = "object-read-write" if upload else "object-read-only"
    claims = {"bucket": bucket, "scope": scope,
              "paths": {"prefixPaths": list(PREFIXES), "objectPaths": []},
              "sub": account, "iss": access, "aud": endpoint.removeprefix("https://"),
              "iat": issued, "exp": issued + ttl_seconds}
    # Do not add actions: this account's live endpoint rejects that claim (2026-10-01).
    unsigned = json_part({"alg": "HS256", "typ": "JWT"}) + "." + json_part(claims)
    signature = hmac.new(secret.encode("utf-8"), unsigned.encode("ascii"), hashlib.sha256).digest()
    token = unsigned + "." + b64url(signature)
    credentials = {"R2_ENDPOINT": endpoint, "R2_ACCESS_KEY_ID": access,
                   "R2_SECRET_ACCESS_KEY": hashlib.sha256(token.encode("ascii")).hexdigest(),
                   "R2_SESSION_TOKEN": base64.b64encode(("jwt/" + token).encode("ascii")).decode("ascii")}
    metadata = {"bucket": bucket, "scope": scope, "prefixes": list(PREFIXES),
                "ttl_seconds": ttl_seconds,
                "issued_at": datetime.fromtimestamp(issued, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "expires_at": datetime.fromtimestamp(issued + ttl_seconds, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}
    return credentials, metadata


def output_path(value):
    path = Path(os.path.abspath(Path(value).expanduser()))
    state = Path(os.path.abspath(DEFAULT_STATE))
    if path == state or not path.is_relative_to(state):
        fail("unsafe_output", "Credential output must be a file under ignored build/reference-archive/")
    for ancestor in (path, *path.parents):
        if ancestor.is_symlink():
            fail("unsafe_output", "Credential output cannot traverse symlinks")
    if path.exists():
        fail("output_exists", "Credential output already exists; choose a new filename")
    return path


def open_parent(path):
    """Open every directory with O_NOFOLLOW; create only the ignored state hierarchy."""
    state = Path(os.path.abspath(DEFAULT_STATE))
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    descriptor, current = os.open("/", flags), Path("/")
    try:
        for part in path.parent.parts[1:]:
            current /= part
            try:
                child = os.open(part, flags, dir_fd=descriptor)
            except FileNotFoundError:
                if current != state.parent and not current.is_relative_to(state):
                    fail("unsafe_output", "Parent checkout directory is unavailable")
                try:
                    os.mkdir(part, 0o700, dir_fd=descriptor)
                except FileExistsError:
                    pass
                child = os.open(part, flags, dir_fd=descriptor)
            os.close(descriptor)
            descriptor = child
        return descriptor
    except BaseException:
        os.close(descriptor)
        raise


def write_private_exclusive(path, data):
    path = output_path(path)
    directory = open_parent(path)
    temporary = ".credentials-" + uuid.uuid4().hex + ".tmp"
    created = False
    try:
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=directory)
        created = True
        with os.fdopen(fd, "wb") as stream:
            os.fchmod(stream.fileno(), 0o600)
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.link(temporary, path.name, src_dir_fd=directory, dst_dir_fd=directory, follow_symlinks=False)
        except FileExistsError:
            fail("output_exists", "Credential output appeared concurrently; it was not overwritten")
        os.fsync(directory)
    finally:
        if created:
            os.unlink(temporary, dir_fd=directory)
        os.close(directory)


def mint(env_file, output, bucket, upload=False, ttl_seconds=DEFAULT_TTL):
    validate_bucket(bucket)
    validate_ttl(ttl_seconds)
    path = output_path(output)  # Refuse unsafe/existing destinations before reading parent credentials.
    credentials, metadata = derive_credentials(parse_parent(env_file), bucket, upload, ttl_seconds)
    contents = ("# Temporary private archive credentials; do not commit or include in an archive selection.\n"
                + "".join(f"{key}={value}\n" for key, value in credentials.items())).encode("ascii")
    write_private_exclusive(path, contents)
    return {"status": "minted", "env_file": str(path), **metadata}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path, required=True, help="Parent credentials, e.g. .env.cloudflare.local")
    parser.add_argument("--output", type=Path, required=True, help="New private env file under build/reference-archive/")
    parser.add_argument("--bucket", required=True, help="Explicit previously verified private archive bucket")
    parser.add_argument("--upload", action="store_true", help="Grant object-read-write; default is object-read-only")
    lifetime = parser.add_mutually_exclusive_group()
    lifetime.add_argument("--ttl-hours", type=int, help="1–24 hours; default 6")
    lifetime.add_argument("--ttl-seconds", type=int, help="1–86400 seconds; default 21600")
    args = parser.parse_args(argv)
    ttl = args.ttl_seconds if args.ttl_seconds is not None else DEFAULT_TTL if args.ttl_hours is None else args.ttl_hours * 3600
    try:
        result = mint(args.env_file, args.output, args.bucket, args.upload, ttl)
        print(json.dumps(result, sort_keys=True))
        return 0
    except ArchiveError as error:
        print(json.dumps({"status": "failed", "error": error.record()}, sort_keys=True))
        return 1
    except KeyboardInterrupt:
        print(json.dumps({"status": "interrupted", "message": "No credential values were printed; inspect the requested output path before retrying."}))
        return 130
    except Exception:
        # Exception text can contain a secret, so even unexpected failures stay redacted.
        print(json.dumps({"status": "failed", "error": {"code": "local_failure", "message": "Credential input or private output could not be processed; values are never logged."}}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
