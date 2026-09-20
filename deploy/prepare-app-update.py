#!/usr/bin/env python3
"""Prepare measured update metadata AFTER immutable files have been published.

Writes only --output; never deploys, uploads, or modifies a current manifest in place.
Every offered URL is read back and hashed before writing the candidate catalog.
"""
import argparse
import datetime
import hashlib
import json
from pathlib import Path
import re
import subprocess
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / 'packages/web/src/config'
CDN = 'https://assets.hiraia.org/models/'


def digests(path):
    md5, sha, size = hashlib.md5(), hashlib.sha256(), 0
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            md5.update(chunk); sha.update(chunk); size += len(chunk)
    return size, md5.hexdigest(), sha.hexdigest()


def verify_remote(url, size, sha256):
    digest, total = hashlib.sha256(), 0
    with urllib.request.urlopen(url, timeout=30) as response:
        if not response.url.startswith(CDN):
            raise ValueError('Unexpected CDN redirect')
        for chunk in iter(lambda: response.read(1024 * 1024), b''):
            total += len(chunk)
            if total > size:
                raise ValueError('Remote asset exceeds declared size')
            digest.update(chunk)
    if total != size or digest.hexdigest() != sha256:
        raise ValueError('Remote bytes do not match the local release artifact')


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('kind', choices=['model', 'images', 'tala'])
    p.add_argument('artifact', type=Path, help='GGUF, image manifest JSON, or signed Tala APK')
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--catalog', type=Path, default=CONFIG / 'asset-updates.json')
    p.add_argument('--min-app', type=int)
    p.add_argument('--max-app', type=int)
    p.add_argument('--label', default='Improved tutor model')
    p.add_argument('--notes', default='')
    p.add_argument('--aapt', help='Android build-tools aapt (required for Tala)')
    p.add_argument('--image-dir', type=Path)
    args = p.parse_args()
    if args.output.exists():
        p.error('--output already exists; use a new candidate path')
    if args.kind == 'tala':
        if not args.aapt:
            p.error('--aapt is required')
        text = subprocess.check_output([args.aapt, 'dump', 'badging', str(args.artifact)], text=True)
        match = re.search(r"package: name='com.hiraia.tala' versionCode='(\d+)' versionName='([^']+)'", text)
        if not match:
            p.error('Not a Tala APK')
        version, name = int(match[1]), match[2]
        if not re.fullmatch(r'\d+\.\d+\.\d+', name):
            p.error('Expected a versioned release')
        size, md5, sha = digests(args.artifact)
        if not 0 < size <= 200_000_000:
            p.error('Tala APK exceeds updater size limit')
        url = CDN + 'tala-v' + name.replace('.', 'p') + '.apk'
        verify_remote(url, size, sha)
        out = {'app': dict(versionCode=version, versionName=name, url=url, bytes=size,
                           md5=md5, sha256=sha, publishedAt=datetime.date.today().isoformat())}
    else:
        if not args.min_app or args.min_app < 1 or not args.max_app or args.max_app < args.min_app:
            p.error('--min-app and --max-app must bound the tested APK versions')
        out = json.loads(args.catalog.read_text())
        out['revision'] += 1
        out['minAppVersionCode'], out['maxAppVersionCode'] = args.min_app, args.max_app
        if args.kind == 'model':
            name = args.artifact.name
            if len(name) > 181 or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]*\.gguf', name):
                p.error('Expected a versioned GGUF filename')
            size, md5, sha = digests(args.artifact)
            if not 0 < size <= 2_000_000_000:
                p.error('Model exceeds supported runtime size envelope')
            if len(args.label) > 100 or len(args.notes) > 500:
                p.error('Label or notes too long')
            old = next(iter(out['models']), None)
            if old and old['filename'] == name:
                p.error('New model bytes need a new immutable filename')
            verify_remote(CDN + name, size, sha)
            out['models'] = [dict(id='base', revision=out['revision'], runtime='hiraia-2b-qwen35-v1',
                                  filename=name, url=CDN+name, bytes=size, md5=md5,
                                  label=args.label, notes=args.notes)]
        else:
            baseline = json.loads((ROOT/'packages/mobile/src/generated/imagePacks.generated.json').read_text())
            if out['imageBaseline'] != baseline['version']:
                p.error('Catalog belongs to another image baseline; prepare a separately tested catalog')
            original = {row['id']: row for row in baseline['packs']}
            changes = {row['id']: row for row in out['imagePacks']}
            incoming = json.loads(args.artifact.read_text())
            if incoming.get('format') != 1:
                p.error('Unsupported image format')
            for pack in incoming['packs']:
                if original.get(pack['id'], {}).get('md5') == pack['md5']:
                    continue
                name = pack['filename']
                if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]*-' + re.escape(pack['md5']) + r'\.hpak', name):
                    p.error('Unsafe or mutable pack filename')
                file = (args.image_dir or args.artifact.parent) / name
                size, md5, sha = digests(file)
                if (size, md5, sha) != (pack['bytes'], pack['md5'], pack['sha256']):
                    p.error('Image manifest does not match artifact bytes')
                if not 0 < size <= 100_000_000 or not 0 < pack['images'] <= 1200:
                    p.error('Image pack exceeds supported limits')
                verify_remote(CDN+'images/'+name, size, sha)
                changes[pack['id']] = pack
            out['imagePacks'] = list(changes.values())
    args.output.write_text(json.dumps(out, indent=2)+'\n')
    print(f'Verified candidate: {args.output}. Review, copy to the website config, then deploy the website.')


if __name__ == '__main__':
    main()
