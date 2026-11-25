#!/usr/bin/env python3
"""Short-lived R2 keys for Tala's teachers' files: ONE prefix of ONE private bucket, at most 24 hours.

Derived locally from the parent R2 credential (an HS256 token signed with its secret, as
tools/reference-archive/mint_credentials.py does it; no network request), then either written to a new local file
(0600, never overwritten) or installed on the production host as /etc/tala/r2-credentials.json (root:tala 0640,
replaced by rename, so the web server reads it again without a restart). Never prints a credential value: only
what is not secret (bucket, prefix, scope, issue and end times) and whether the installed file matches.

    renew-r2-keys.py --parent /home/b11/code/hiraia/.env.cloudflare.local --prefix tala/production/ --install-on b11-apps
    renew-r2-keys.py --parent … --prefix tala/rehearsal/ --ttl-hours 6 --output /path/to/new-file.json

The parent file is read for R2_ENDPOINT (or the account id), R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY only; a
parent that is itself temporary (R2_SESSION_TOKEN) is refused.
"""
import argparse
import base64
import hashlib
import hmac
import json
import os
import re
import shlex
import subprocess
import sys
import time
from datetime import datetime, timezone

BUCKETS = {"hiraia-archive"}  # checked 25 Nov 2026: no public address, no custom domain, no object expiry rule
PREFIX_RE = re.compile(r"tala/(production|rehearsal)/\Z")
ENDPOINT_RE = re.compile(r"https://([0-9a-f]{32})(?:\.(eu|us|fedramp))?\.r2\.cloudflarestorage\.com/?\Z")
ACCOUNT_RE = re.compile(r"[0-9a-f]{32}\Z")
KEYS = {"R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_SESSION_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "R2_ACCOUNT_ID"}
HOST_FILE = "/etc/tala/r2-credentials.json"
SSH = ["sudo", "-n", "ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=20"]


def fail(why):
    print(json.dumps({"status": "failed", "why": why}))
    sys.exit(1)


def parent_values(path):
    values = {}
    for raw in open(path, encoding="utf-8").read().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.removeprefix("export ").split("=", 1)
        name, value = name.strip(), value.strip()
        if name not in KEYS:
            continue
        if name in values:
            fail("the parent file names a credential field twice")
        if value[:1] in ("'", '"'):
            if len(value) < 2 or value[-1] != value[0]:
                fail("the parent file has an unterminated quoted value")
            value = value[1:-1]
        values[name] = value
    if values.get("R2_SESSION_TOKEN"):
        fail("the parent is a temporary credential; use the original key")
    access, secret = values.get("R2_ACCESS_KEY_ID", ""), values.get("R2_SECRET_ACCESS_KEY", "")
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,256}", access) or not secret or any(not 33 <= ord(c) <= 126 for c in secret):
        fail("the parent file has no usable R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY")
    accounts = {values[n] for n in ("CLOUDFLARE_ACCOUNT_ID", "R2_ACCOUNT_ID") if values.get(n)}
    if any(not ACCOUNT_RE.fullmatch(a) for a in accounts) or len(accounts) > 1:
        fail("the parent file's account ids are not valid or do not agree")
    endpoint = values.get("R2_ENDPOINT") or (f"https://{next(iter(accounts))}.r2.cloudflarestorage.com" if accounts else "")
    m = ENDPOINT_RE.fullmatch(endpoint)
    if not m:
        fail("the parent file has no account-level R2 endpoint")
    if accounts and next(iter(accounts)) != m.group(1):
        fail("the endpoint and the account id differ")
    return endpoint.rstrip("/"), m.group(1), access, secret


def b64url(b):
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode("ascii")


def derive(endpoint, account, access, secret, bucket, prefix, ttl):
    issued = int(time.time())
    claims = {"bucket": bucket, "scope": "object-read-write", "paths": {"prefixPaths": [prefix], "objectPaths": []},
              "sub": account, "iss": access, "aud": endpoint.removeprefix("https://"), "iat": issued, "exp": issued + ttl}
    part = lambda v: b64url(json.dumps(v, sort_keys=True, separators=(",", ":")).encode("utf-8"))
    unsigned = part({"alg": "HS256", "typ": "JWT"}) + "." + part(claims)
    token = unsigned + "." + b64url(hmac.new(secret.encode("utf-8"), unsigned.encode("ascii"), hashlib.sha256).digest())
    iso = lambda t: datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    body = {"accessKeyId": access, "secretAccessKey": hashlib.sha256(token.encode("ascii")).hexdigest(),
            "sessionToken": base64.b64encode(("jwt/" + token).encode("ascii")).decode("ascii"), "expiresAt": iso(issued + ttl)}
    return (json.dumps(body) + "\n").encode("ascii"), iso(issued), iso(issued + ttl)


INSTALL = r"""set -eu
umask 077
getent group tala >/dev/null
d=/etc/tala; f=$(mktemp "$d/.r2-credentials.XXXXXXXX")
trap 'rm -f "$f"' EXIT
cat > "$f"
chown root:tala "$f"; chmod 0640 "$f"; sync "$f"
mv -f "$f" "$d/r2-credentials.json"; trap - EXIT
sync "$d"
stat -c '%U:%G %a' "$d/r2-credentials.json"
sha256sum "$d/r2-credentials.json" | cut -c1-64
"""


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--parent", required=True, help="env file holding the parent R2 credential")
    ap.add_argument("--bucket", default="hiraia-archive")
    ap.add_argument("--prefix", required=True, help="tala/production/ or tala/rehearsal/")
    ap.add_argument("--ttl-hours", type=float, default=24.0)
    where = ap.add_mutually_exclusive_group(required=True)
    where.add_argument("--output", help="a NEW local file (0600)")
    where.add_argument("--install-on", help="ssh alias of the production host (root, over the pinned route): installs " + HOST_FILE)
    where.add_argument("--install-via", help="JSON list: a command that runs its last argument as root on another machine (a rehearsal machine)")
    a = ap.parse_args()
    if a.bucket not in BUCKETS:
        fail("not a bucket checked to be private")
    if not PREFIX_RE.fullmatch(a.prefix):
        fail("the prefix must be tala/production/ or tala/rehearsal/")
    ttl = int(a.ttl_hours * 3600)
    if not 60 <= ttl <= 24 * 3600:
        fail("the lifetime must be between one minute and 24 hours")
    body, issued, ends = derive(*parent_values(a.parent), a.bucket, a.prefix, ttl)
    digest = hashlib.sha256(body).hexdigest()
    report = {"bucket": a.bucket, "prefix": a.prefix, "scope": "object-read-write", "issuedAt": issued, "expiresAt": ends}
    if a.output:
        out = os.path.abspath(a.output)
        fd = os.open(out, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, "wb") as f:
            f.write(body)
            f.flush()
            os.fsync(f.fileno())
        print(json.dumps({"status": "written", "file": out, **report}))
        return
    # The keys travel on ssh's standard input, never on a command line. ssh joins its arguments into one remote
    # command line, so the script is quoted as one word.
    if a.install_on:
        if not re.fullmatch(r"[A-Za-z0-9._-]{1,64}", a.install_on):
            fail("not a host alias")
        command = SSH + [a.install_on, "bash -c " + shlex.quote(INSTALL)]
    else:
        via = json.loads(a.install_via)
        if not (isinstance(via, list) and via and all(isinstance(x, str) for x in via)):
            fail("--install-via must be a JSON list of strings")
        command = via + ["bash -c " + shlex.quote(INSTALL)]
    r = subprocess.run(command, input=body, capture_output=True, timeout=120)
    lines = r.stdout.decode("utf-8", "replace").split()
    if r.returncode != 0 or len(lines) < 3:
        fail(f"install on the host failed (exit {r.returncode})")
    owner_mode, installed = f"{lines[0]} {lines[1]}", lines[2]
    if owner_mode != "root:tala 640":
        fail(f"the installed file has owner and mode {owner_mode}, not root:tala 640")
    if installed != digest:
        fail("the installed file is not the file that was sent")
    print(json.dumps({"status": "installed", "host": a.install_on or "(rehearsal)", "file": HOST_FILE, "ownerMode": "root:tala 0640", "matches": True, **report}))


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as e:  # an exception's text could hold a value: only its kind is shown
        fail(type(e).__name__)
