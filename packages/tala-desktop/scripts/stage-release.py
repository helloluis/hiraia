#!/usr/bin/env python3
"""Candidate filesystem publisher. No SSH, credentials, service changes or deploy.

The release owner runs this only at the approved artifact destination. stage writes
an immutable complete directory; promote verifies public HTTPS bytes and atomically
replaces one whole-set pointer. A failed verification leaves latest untouched.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import tempfile
import urllib.parse
import urllib.request

REQUIRED = {('win32', 'x64'), ('darwin', 'arm64'), ('darwin', 'x64')}

def sha(data):
    return hashlib.sha256(data).hexdigest()

def validate(directory):
    manifest = json.loads((directory / 'desktop-release.json').read_text())
    commit, release = manifest['sourceCommit'], manifest['release']
    if not re.fullmatch(r'[0-9a-f]{40}', commit) or not re.fullmatch(r'tala-(?:v1-demo\.[0-9]+|desktop-preview-[A-Za-z0-9.-]+)', release):
        raise ValueError('Invalid release identity')
    artifacts = manifest['artifacts']
    if len(artifacts) != 3 or {(m['platform'], m['arch']) for m in artifacts} != REQUIRED:
        raise ValueError('Incomplete platform set')
    for m in artifacts:
        if m.get('sourceDirty') or any(m[k] != manifest[k] for k in ['sourceCommit', 'release', 'version', 'electron', 'hostedOrigin']):
            raise ValueError('Mixed or dirty source identity')
        if not re.fullmatch(r'Tala-[A-Za-z0-9.-]+\.(exe|dmg)', m['file']):
            raise ValueError('Invalid filename')
        file = directory / m['file']
        if file.is_symlink() or not file.is_file():
            raise ValueError('Not a regular installer')
        data = file.read_bytes()
        if len(data) != m['bytes'] or sha(data) != m['sha256']:
            raise ValueError('Installer digest/size mismatch')
    return manifest

def stage(source, root):
    manifest = validate(source)
    relative = Path(manifest['release']) / manifest['sourceCommit']
    target = root / relative
    if target.exists():
        existing = validate(target)
        if existing != manifest:
            raise ValueError('Immutable release already exists with different metadata')
        return target  # exact, verified retry
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix='.stage-', dir=target.parent))
    try:
        for name in ['desktop-release.json'] + [m['file'] for m in manifest['artifacts']]:
            shutil.copyfile(source / name, temporary / name)
        validate(temporary)
        os.rename(temporary, target)
    finally:
        if temporary.exists():
            shutil.rmtree(temporary)
    return target

def verify_https(url, expected_bytes, expected_sha):
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != 'https' or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError('Public artifact URL must be plain HTTPS')
    with urllib.request.urlopen(url, timeout=120) as response:
        if urllib.parse.urlsplit(response.url).scheme != 'https':
            raise ValueError('HTTPS downgraded')
        digest = hashlib.sha256()
        length = 0
        while block := response.read(1024 * 1024):
            length += len(block)
            if length > expected_bytes:
                raise ValueError('Public artifact too large')
            digest.update(block)
        if length != expected_bytes or digest.hexdigest() != expected_sha:
            raise ValueError('Public HTTPS read-back digest/size mismatch')

def promote(root, release_dir, base_url, expected_latest, verifier=verify_https):
    root = root.resolve()
    directory = release_dir.resolve()
    relative = directory.relative_to(root)
    manifest = validate(directory)
    if relative != Path(manifest['release']) / manifest['sourceCommit']:
        raise ValueError('Unexpected immutable directory layout')
    url = urllib.parse.urlsplit(base_url)
    if url.scheme != 'https' or url.username or url.password or url.query or url.fragment:
        raise ValueError('Artifact base URL must be HTTPS without credentials/query/fragment')
    published = json.loads(json.dumps(manifest))
    for artifact in published['artifacts']:
        artifact['url'] = base_url.rstrip('/') + '/' + relative.as_posix() + '/' + artifact['file']
        verifier(artifact['url'], artifact['bytes'], artifact['sha256'])
    # The directory is already reachable; verify its immutable manifest as well.
    raw = (directory / 'desktop-release.json').read_bytes()
    verifier(base_url.rstrip('/') + '/' + relative.as_posix() + '/desktop-release.json', len(raw), sha(raw))
    published['status'] = 'released'
    published['manifestUrl'] = base_url.rstrip('/') + '/' + relative.as_posix() + '/desktop-release.json'
    latest = root / 'desktop-latest.json'
    lock = root / '.promotion-lock'
    lock.mkdir()  # competing operators fail closed; no last-writer-wins overwrite
    temporary = None
    try:
        actual = sha(latest.read_bytes()) if latest.exists() else 'absent'
        if actual != expected_latest:
            raise ValueError('Latest changed since review; inspect before retrying')
        fd, filename = tempfile.mkstemp(prefix='.latest-', dir=root)
        temporary = Path(filename)
        with os.fdopen(fd, 'w') as stream:
            json.dump(published, stream, indent=2)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, latest)
        return published
    finally:
        if temporary and temporary.exists():
            temporary.unlink()
        lock.rmdir()

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    for name in ['stage', 'promote']:
        cmd = sub.add_parser(name)
        cmd.add_argument('source', type=Path)
        cmd.add_argument('root', type=Path)
        if name == 'promote':
            cmd.add_argument('--base-url', required=True)
            cmd.add_argument('--expected-latest-sha256', required=True)
    args = parser.parse_args()
    if args.command == 'stage':
        print(stage(args.source, args.root))
    else:
        result = promote(args.root, args.source, args.base_url, args.expected_latest_sha256)
        print(json.dumps({'release': result['release'], 'sourceCommit': result['sourceCommit']}))
