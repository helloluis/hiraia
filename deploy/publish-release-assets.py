#!/usr/bin/env python3
"""Publish release assets to Cloudflare R2 — the origin the phones and the website read.

Since 2026-09-06 the model files and the APK are served from the R2 bucket `hiraia-assets`
behind the custom domain https://assets.hiraia.org (Cloudflare edge). The VPS keeps only
307 redirects for the legacy URLs (deploy/nginx/hiraia.org.conf) — copying a file into
/var/www/hiraia-models/ no longer publishes anything. THIS script is the publish step.

What it does for an APK (`--apk`):
  1. measures bytes / sha256 / md5 and reads android.versionCode with aapt;
  2. uploads it to an IMMUTABLE versioned key   models/hiraia-v<versionName with dots replaced by p>.apk
     (Cache-Control: public, max-age=31536000, immutable) — the URL the website and the
     in-app manifest should point at, so no phone can ever get a stale edge-cached copy;
  3. also refreshes the mutable alias          models/hiraia.apk  (max-age=14400)
     for old links/QR codes, and purges its edge cache if CF_ZONE_ID/CF_API_TOKEN are set;
  4. reads every uploaded object back and re-hashes it (sha256), then HEADs it through
     assets.hiraia.org and checks the byte count and Accept-Ranges;
  5. prints the download.ts block (versionCode, publishedAt, url, fileSizeMB, bytes,
     sha256, md5) that feeds BOTH the landing page and /api/app/manifest.
For a model/vector file (`--asset FILE`): upload under models/<basename> as immutable,
read-back-verified. Filenames are versioned by convention (see packages/mobile/src/config/
model.ts REMOTE_ASSETS) — NEVER reuse a filename for different bytes.

Credentials come from an env file that is gitignored and lives at the main checkout's root
(/Users/luis/Code/hiraia/.env.cloudflare.local on Luis's Mac — never commit it):
  R2_ENDPOINT=https://<account>.r2.cloudflarestorage.com
  R2_ACCESS_KEY_ID=...            R2_SECRET_ACCESS_KEY=...
  CLOUDFLARE_ACCOUNT_ID=...       CLOUDFLARE_API_TOKEN=...   (optional: enables the purge of
                                  the mutable alias; the zone id is looked up by name, or set
                                  CF_ZONE_ID to skip the lookup)
Same file the image-pack publisher uses (packages/mobile/scripts/publish-image-packs.py).
`--check` only authenticates and lists what is in models/ (read-only) — run it first.

  python3 -m venv ~/.venvs/hiraia-publish && ~/.venvs/hiraia-publish/bin/pip install boto3
  ~/.venvs/hiraia-publish/bin/python deploy/publish-release-assets.py \
      --env-file /private/path/.env.cloudflare.local \
      --apk packages/mobile/android/app/build/outputs/apk/release/hiraia-signed.apk
  ~/.venvs/hiraia-publish/bin/python deploy/publish-release-assets.py \
      --env-file ... --asset deploy/models/labse.Q4_K_M.gguf
"""
import argparse
import datetime as dt
import glob
import hashlib
import json
import os
import re
import subprocess
import sys
import urllib.request

BUCKET = 'hiraia-assets'
PUBLIC = 'https://assets.hiraia.org'
IMMUTABLE = 'public, max-age=31536000, immutable'
ALIAS_TTL = 'public, max-age=14400'


def load_env(path):
    v = {}
    for line in open(path):
        k, sep, x = line.partition('=')
        if sep and not k.strip().startswith('#'):
            v[k.strip()] = x.strip().strip('"').strip("'")
    for k in ('R2_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'):
        if not v.get(k):
            sys.exit(f'!! {k} missing from {path}')
    return v


def digests(path):
    sha, md5, n = hashlib.sha256(), hashlib.md5(), 0
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            sha.update(chunk); md5.update(chunk); n += len(chunk)
    return n, sha.hexdigest(), md5.hexdigest()


def apk_filename(version_name):
    if not re.fullmatch(r'(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)', version_name):
        raise ValueError(f'Expected a release version such as 0.3.3, got {version_name!r}')
    return 'hiraia-v' + version_name.replace('.', 'p') + '.apk'


def apk_version(path):
    aapts = sorted(glob.glob(os.path.expanduser('~/Library/Android/sdk/build-tools/*/aapt')))
    if not aapts:
        sys.exit('!! aapt not found — cannot read APK version')
    result = subprocess.run([aapts[-1], 'dump', 'badging', path], capture_output=True, text=True, check=True)
    code = re.search(r"versionCode='([0-9]+)'", result.stdout)
    name = re.search(r"versionName='([^']+)'", result.stdout)
    if not code or not name:
        sys.exit('!! versionCode/versionName missing from APK')
    apk_filename(name[1])  # Reject malformed versions before any upload.
    return int(code[1]), name[1]


def upload(s3, key, path, cache_control, sha256):
    with open(path, 'rb') as f:
        s3.upload_fileobj(
            f, BUCKET, key,
            ExtraArgs={'ContentType': 'application/octet-stream', 'CacheControl': cache_control,
                       'Metadata': {'sha256': sha256}},
        )
    # Read back and re-hash: the only proof the bytes in the bucket are the bytes on disk.
    body = s3.get_object(Bucket=BUCKET, Key=key)['Body']
    h = hashlib.sha256()
    for chunk in body.iter_chunks(1 << 20):
        h.update(chunk)
    if h.hexdigest() != sha256:
        sys.exit(f'!! read-back sha256 mismatch for {key} — NOT published correctly')
    print(f'   uploaded + read-back verified  {key}')


def head_public(key, bytes_expected, strict=True):
    req = urllib.request.Request(f'{PUBLIC}/{key}', method='HEAD')
    with urllib.request.urlopen(req, timeout=30) as r:
        length = int(r.headers.get('Content-Length', '0'))
        ranges = r.headers.get('Accept-Ranges', '')
    ok = length == bytes_expected and ranges == 'bytes'
    print(f'   {"ok" if ok else "!!"} HEAD {PUBLIC}/{key} → {length} bytes, Accept-Ranges: {ranges or "(none)"}')
    if not ok and strict:
        sys.exit('!! public HEAD does not match the upload (edge cache? wrong key?)')
    if not ok:
        print('   Alias edge cache is still serving the previous release; use the verified versioned URL.')
    return ok


def cf_api(v, path, body=None):
    token = v.get('CLOUDFLARE_API_TOKEN') or v.get('CF_API_TOKEN')
    req = urllib.request.Request(
        f'https://api.cloudflare.com/client/v4{path}',
        data=json.dumps(body).encode() if body is not None else None,
        method='POST' if body is not None else 'GET',
        headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def zone_id(v, zone_name='hiraia.org'):
    if v.get('CF_ZONE_ID'):
        return v['CF_ZONE_ID']
    try:
        res = cf_api(v, f'/zones?name={zone_name}')
        zones = res.get('result') or []
        return zones[0]['id'] if zones else None
    except Exception as e:  # noqa: BLE001 — purge is best-effort, publishing is not
        print(f'   (zone lookup failed: {e})')
        return None


def purge(v, urls):
    if not (v.get('CLOUDFLARE_API_TOKEN') or v.get('CF_API_TOKEN')):
        print('   (no CLOUDFLARE_API_TOKEN — alias edge cache not purged; it expires within 4 h)')
        return
    zid = zone_id(v)
    if not zid:
        print('   (no zone id — alias edge cache not purged; it expires within 4 h)')
        return
    try:
        res = cf_api(v, f'/zones/{zid}/purge_cache', {'files': urls})
        print(f"   purge {'ok' if res.get('success') else '!! FAILED: ' + json.dumps(res)[:200]}: {', '.join(urls)}")
    except Exception as e:  # noqa: BLE001
        print(f'   (purge request failed: {e} — alias edge cache expires within 4 h)')


def check(s3):
    print(f'== {BUCKET}: authenticated. models/ contains:')
    resp = s3.list_objects_v2(Bucket=BUCKET, Prefix='models/', MaxKeys=200)
    for o in resp.get('Contents', []):
        if not o['Key'].startswith('models/images/'):
            print(f"   {o['Size']:>13,d}  {o['LastModified']:%Y-%m-%d %H:%M}  {o['Key']}")
    imgs = sum(1 for o in resp.get('Contents', []) if o['Key'].startswith('models/images/'))
    print(f'   (+ {imgs} objects under models/images/{" — truncated listing" if resp.get("IsTruncated") else ""})')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--env-file', required=True)
    ap.add_argument('--apk', help='signed APK to publish (versioned key + hiraia.apk alias)')
    ap.add_argument('--asset', action='append', default=[], help='model/vector file → models/<basename> (immutable)')
    ap.add_argument('--no-alias', action='store_true', help='do not touch models/hiraia.apk')
    ap.add_argument('--check', action='store_true', help='authenticate and list models/ only (read-only)')
    a = ap.parse_args()
    if not a.check and not a.apk and not a.asset:
        ap.error('nothing to publish: give --apk and/or --asset (or --check)')
    v = load_env(a.env_file)
    import boto3  # in the publish venv (see header)
    s3 = boto3.client('s3', endpoint_url=v['R2_ENDPOINT'], aws_access_key_id=v['R2_ACCESS_KEY_ID'],
                      aws_secret_access_key=v['R2_SECRET_ACCESS_KEY'], region_name='auto')
    if a.check:
        check(s3)
        return

    for path in a.asset:
        key = f'models/{os.path.basename(path)}'
        n, sha, _ = digests(path)
        print(f'== asset {path} ({n} bytes)')
        upload(s3, key, path, IMMUTABLE, sha)
        head_public(key, n)

    if a.apk:
        n, sha, md5 = digests(a.apk)
        vc, version_name = apk_version(a.apk)
        key = f'models/{apk_filename(version_name)}'
        # A release name is immutable. A changed APK must get a new versionName.
        from botocore.exceptions import ClientError
        try:
            existing = s3.head_object(Bucket=BUCKET, Key=key)
        except ClientError as error:
            if str(error.response.get('Error', {}).get('Code')) not in ('404', 'NoSuchKey', 'NotFound'):
                raise
        else:
            if existing.get('Metadata', {}).get('sha256') != sha:
                sys.exit(f'!! {key} already exists with different bytes — bump the app version first')
        print(f'== apk {a.apk}: version {version_name}, versionCode {vc}, {n} bytes')
        upload(s3, key, a.apk, IMMUTABLE, sha)
        head_public(key, n)
        if not a.no_alias:
            upload(s3, 'models/hiraia.apk', a.apk, ALIAS_TTL, sha)
            purge(v, [f'{PUBLIC}/models/hiraia.apk', 'https://hiraia.org/models/hiraia.apk'])
            head_public('models/hiraia.apk', n, strict=False)
        mb = round(n / 1048576)
        print('\nPaste into packages/web/src/config/download.ts (feeds the landing page AND /api/app/manifest),')
        print('then push main and run deploy/update.sh on the VPS:\n')
        print(f"  version: '{version_name}',")
        print(f'  versionCode: {vc},')
        print(f"  publishedAt: '{dt.date.today().isoformat()}',")
        print('  apk: {')
        print(f"    url: '{PUBLIC}/{key}',")
        print(f'    fileSizeMB: {mb},')
        print(f'    bytes: {n},')
        print(f"    sha256: '{sha}',")
        print(f"    md5: '{md5}',")
        print('  },')


if __name__ == '__main__':
    main()
