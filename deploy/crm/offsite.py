#!/usr/bin/env python3
"""Offsite copies of hiraia-crm backup artifacts in Cloudflare R2 (S3 API), verified by read-back.

  offsite.py push   --env FILE --file ARTIFACT --sha256 HEX --tiers daily[,weekly,monthly] [--keep daily=7,weekly=4,monthly=6]
  offsite.py list   --env FILE [--tier daily]
  offsite.py fetch  --env FILE --key KEY --out PATH
  offsite.py verify --env FILE --key KEY --sha256 HEX

The env file (root-only, mode 600; never in the repo) holds R2_ENDPOINT, R2_ACCESS_KEY_ID,
R2_SECRET_ACCESS_KEY, optional R2_SESSION_TOKEN, and optionally HIRAIA_CRM_BACKUP_BUCKET (default
b11-ovh-backups — the project's existing OVH backups bucket; artifacts live under their own
HIRAIA_CRM_BACKUP_PREFIX, default hiraia-crm/, beside the restic repository, never inside it).

An upload only counts once the object has been downloaded again and its SHA-256 matches
(AGENTS.md: never claim a backup complete from upload success alone). Remote tiers are pruned to
the same 7/4/6 retention as the local ones. The public hiraia-assets bucket is refused. Credentials
are never printed. One JSON document is written to stdout; errors go to stderr with exit 1.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path

ENV_KEYS = ("R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_SESSION_TOKEN",
            "HIRAIA_CRM_BACKUP_BUCKET", "HIRAIA_CRM_BACKUP_PREFIX")
DEFAULT_BUCKET = "b11-ovh-backups"
DEFAULT_PREFIX = "hiraia-crm/"
REFUSED_BUCKETS = {"hiraia-assets"}
TIERS = ("daily", "weekly", "monthly")
ARTIFACT_SUFFIX = ".tar.gpg"


def fail(message: str, code: int = 1) -> None:
    print(f"offsite: {message}", file=sys.stderr)
    sys.exit(code)


def load_env(path: str) -> dict:
    values = {}
    for raw in Path(path).read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.removeprefix("export ").split("=", 1)
        name, value = name.strip(), value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
            value = value[1:-1]
        if name in ENV_KEYS:
            values[name] = value
    for required in ("R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"):
        if not values.get(required):
            fail(f"{path} lacks {required}")
    if not values["R2_ENDPOINT"].startswith("https://"):
        fail("R2_ENDPOINT must be an https:// URL")
    bucket = values.get("HIRAIA_CRM_BACKUP_BUCKET") or DEFAULT_BUCKET
    if bucket in REFUSED_BUCKETS or "assets" in bucket:
        fail(f"refusing bucket {bucket}: backups must not go to a public bucket")
    prefix = (values.get("HIRAIA_CRM_BACKUP_PREFIX") or DEFAULT_PREFIX).strip("/") + "/"
    if prefix.startswith("restic/"):
        fail("refusing to write inside the restic repository prefix")
    values["bucket"], values["prefix"] = bucket, prefix
    return values


def client(env: dict):
    try:
        import boto3
        from botocore.config import Config
    except ImportError:
        fail("boto3 is not installed (install.sh creates /opt/hiraia-crm/venv)")
    kwargs = dict(endpoint_url=env["R2_ENDPOINT"], aws_access_key_id=env["R2_ACCESS_KEY_ID"],
                  aws_secret_access_key=env["R2_SECRET_ACCESS_KEY"], region_name="auto",
                  config=Config(retries={"max_attempts": 5, "mode": "standard"}, connect_timeout=20, read_timeout=120))
    if env.get("R2_SESSION_TOKEN"):
        kwargs["aws_session_token"] = env["R2_SESSION_TOKEN"]
    return boto3.client("s3", **kwargs)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_object(s3, bucket: str, key: str) -> tuple[str, int]:
    body = s3.get_object(Bucket=bucket, Key=key)["Body"]
    digest, size = hashlib.sha256(), 0
    for chunk in iter(lambda: body.read(1 << 20), b""):
        digest.update(chunk)
        size += len(chunk)
    return digest.hexdigest(), size


def list_tier(s3, bucket: str, prefix: str, tier: str) -> list[dict]:
    out = []
    paginator = s3.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=f"{prefix}{tier}/"):
        for obj in page.get("Contents", []):
            out.append({"key": obj["Key"], "bytes": obj["Size"], "last_modified": obj["LastModified"].isoformat()})
    return sorted(out, key=lambda o: o["key"])


def parse_keep(spec: str) -> dict:
    keep = {"daily": 7, "weekly": 4, "monthly": 6}
    for part in filter(None, spec.split(",")):
        tier, _, n = part.partition("=")
        if tier not in keep or not n.isdigit() or int(n) < 1:
            fail(f"bad --keep entry {part!r}")
        keep[tier] = int(n)
    return keep


def push(args) -> dict:
    env = load_env(args.env)
    artifact = Path(args.file)
    if not artifact.is_file() or not artifact.name.endswith(ARTIFACT_SUFFIX):
        fail(f"{artifact} is not a backup artifact")
    local_sha = sha256_file(artifact)
    if args.sha256 and args.sha256.lower() != local_sha:
        fail(f"local artifact sha256 {local_sha} != expected {args.sha256}")
    tiers = [t for t in args.tiers.split(",") if t]
    if any(t not in TIERS for t in tiers):
        fail(f"tiers must be among {TIERS}")
    keep = parse_keep(args.keep)
    s3 = client(env)
    bucket, prefix = env["bucket"], env["prefix"]
    uploaded, pruned = [], []
    sidecar = artifact.with_name(artifact.name + ".sha256")
    for tier in tiers:
        key = f"{prefix}{tier}/{artifact.name}"
        with artifact.open("rb") as handle:
            s3.put_object(Bucket=bucket, Key=key, Body=handle, ContentType="application/pgp-encrypted",
                          Metadata={"sha256": local_sha, "tier": tier})
        remote_sha, size = sha256_object(s3, bucket, key)
        if remote_sha != local_sha:
            s3.delete_object(Bucket=bucket, Key=key)
            fail(f"read-back sha256 mismatch for {key} (deleted the bad copy)")
        if sidecar.is_file():
            s3.put_object(Bucket=bucket, Key=key + ".sha256", Body=sidecar.read_bytes(), ContentType="text/plain")
        uploaded.append({"tier": tier, "key": key, "bytes": size, "sha256": remote_sha, "verified": True})
        artifacts = [o["key"] for o in list_tier(s3, bucket, prefix, tier) if o["key"].endswith(ARTIFACT_SUFFIX)]
        for old in artifacts[:-keep[tier]] if len(artifacts) > keep[tier] else []:
            s3.delete_object(Bucket=bucket, Key=old)
            s3.delete_object(Bucket=bucket, Key=old + ".sha256")
            pruned.append(old)
    return {"state": "ok", "bucket": bucket, "prefix": prefix, "uploaded": uploaded, "pruned": pruned}


def list_cmd(args) -> dict:
    env = load_env(args.env)
    s3 = client(env)
    tiers = [args.tier] if args.tier else list(TIERS)
    return {"bucket": env["bucket"], "prefix": env["prefix"], "tiers": {t: list_tier(s3, env["bucket"], env["prefix"], t) for t in tiers}}


def fetch(args) -> dict:
    env = load_env(args.env)
    s3 = client(env)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    head = s3.head_object(Bucket=env["bucket"], Key=args.key)
    expected = head.get("Metadata", {}).get("sha256")
    s3.download_file(env["bucket"], args.key, str(out))
    os.chmod(out, 0o600)
    got = sha256_file(out)
    if expected and got != expected:
        fail(f"downloaded sha256 {got} != stored metadata {expected}")
    return {"key": args.key, "out": str(out), "bytes": out.stat().st_size, "sha256": got, "verified_against_metadata": bool(expected)}


def verify(args) -> dict:
    env = load_env(args.env)
    s3 = client(env)
    got, size = sha256_object(s3, env["bucket"], args.key)
    if got != args.sha256.lower():
        fail(f"remote sha256 {got} != expected {args.sha256}")
    return {"key": args.key, "bytes": size, "sha256": got, "verified": True}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("push"); p.add_argument("--env", required=True); p.add_argument("--file", required=True)
    p.add_argument("--sha256"); p.add_argument("--tiers", default="daily"); p.add_argument("--keep", default="daily=7,weekly=4,monthly=6")
    p.set_defaults(run=push)
    p = sub.add_parser("list"); p.add_argument("--env", required=True); p.add_argument("--tier"); p.set_defaults(run=list_cmd)
    p = sub.add_parser("fetch"); p.add_argument("--env", required=True); p.add_argument("--key", required=True); p.add_argument("--out", required=True); p.set_defaults(run=fetch)
    p = sub.add_parser("verify"); p.add_argument("--env", required=True); p.add_argument("--key", required=True); p.add_argument("--sha256", required=True); p.set_defaults(run=verify)
    args = parser.parse_args()
    try:
        result = args.run(args)
    except SystemExit:
        raise
    except Exception as error:  # botocore errors carry no credentials in their messages
        fail(f"{type(error).__name__}: {str(error)[:300]}")
    print(json.dumps(result, separators=(",", ":")))


if __name__ == "__main__":
    main()
