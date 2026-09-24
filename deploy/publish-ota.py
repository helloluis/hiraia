#!/usr/bin/env python3
"""Publish an OTA JS update (expo-updates) for an installed Hiraia APK — or roll one back.

Phones on 0.4.24+ ask https://hiraia.org/api/updates/manifest at cold start (Wi-Fi only) and
when the reader taps "Check for updates". That route (packages/web/src/app/api/updates/
manifest) is a RELAY: it cannot mint an update. THIS script is the only thing that can. It
signs on this Mac with the key at ~/.hiraia/ota-keys/private-key.pem (never in the repo,
never on the server), and a phone rejects anything not signed by it against the certificate
baked into its APK (packages/mobile/certs/certificate.pem).

WHAT A PUBLISH DOES (steps 0-11; --dry-run does 0-9 locally and uploads/flips NOTHING):
   0. preflight: packages/mobile + packages/shared clean in git, then build-apk.sh's own
      pre-flight (voices, image packs, lesson manifests, card-inventory freshness) via
      PREFLIGHT_ONLY=1, and for --ring production a green regression gate (--gate-log).
   1. read the SIGNED APK: assets/fingerprint (its runtime), assets/app.manifest (the embedded
      update: asset md5 keys + commitTime), the Hermes bytecode version, the signing cert.
   2. `expo-updates fingerprint:generate` on this tree must EQUAL the APK's runtime. A phone
      silently ignores an update for another runtime, so a mismatch is an abort, not a warning.
   3. `expo export --platform android` into packages/mobile/build/ota/<stamp>/ (gitignored).
   4. the export's .hbc must have the APK's Hermes version and carry the QVAC worker bundleId.
   5. asset reuse: every asset whose md5 is in the embedded manifest costs phones 0 bytes.
      Anything new is listed with its size, and refused past 2 MB each / 5 MB total unless
      --allow-large-assets — cards.db, tokens.bin and the voices go by content pack or APK.
   6. sha256 (hex + base64url) and md5 of every file.
   7. upload content-addressed objects (IfNoneMatch='*', immutable) — assets the phones
      already hold included, so every URL in a manifest resolves — read each back and re-hash.
   8. build the manifest (Expo Updates protocol v1; extra.expoClient = the public app config,
      without which Constants.expoConfig is empty on an OTA launch).
   9. serialise ONCE, sign those exact bytes (openssl, RSA-SHA256 PKCS#1 v1.5), verify them
      against certs/certificate.pem, upload manifest.json + manifest.json.sig.
  10. flip ota/android/<runtime>/channel.json for the ring (read-modify-write, IfMatch).
  11. end-to-end: ask the live route as a phone in that ring would, check the multipart part
      is our exact bytes with a valid signature, measure the bundle on the wire.

RINGS: canary = an allowlist of EAS-Client-ID values (--canary-client; find a test phone's id
in `pm2 logs hiraia-web | grep '\\[ota\\]'` after it checks); production = everyone, with
--rollout N percent and the previous production release as the fallback for the rest — but
only if it had reached 100% (a release held back stays held back). Whenever production takes
a new release (promote, republish, publish, rollback) the canary ring follows production again.

--runtime is the APK's own fingerprint: `unzip -p <signed apk> assets/fingerprint`, or the
"runtime" of the ledger line a publish printed — NOT `fingerprint:generate` on a tree that
has moved on since. A rollback into a runtime with no published update is refused.

ROLLING BACK. Pointing the channel at an OLDER update does nothing: phones only take an update
newer than the one they run. The two real options, both a fresh signed artifact:
  --republish <update-id>   the last good update again, as a new id with a new createdAt;
  --rollback-to-embedded    a signed directive: phones go back to the APK's own bundle.
A crash BEFORE first render is rolled back by the phone itself; anything later needs these.

Publish from the tree that built the APK (a release worktree at its tag): the fingerprint
covers app.json, the config plugins, native modules and the QVAC addons (fingerprint.config.js).

  ~/.venvs/hiraia-publish/bin/python deploy/publish-ota.py --dry-run --apk <signed.apk>
  ~/.venvs/hiraia-publish/bin/python deploy/publish-ota.py --env-file .env.cloudflare.local \\
      --apk packages/mobile/android/app/build/outputs/apk/release/hiraia-v0p4p24.apk --ring canary
  ... --ring production --rollout 10 --gate-log /tmp/gate.log --promote     (canary → 10%)
  ... --ring production --rollout 100 --rollout-only                         (widen)
  ... --runtime <40-hex> --ring production --rollback-to-embedded            (emergency)
"""
import argparse
import base64
import datetime as dt
import gzip
import hashlib
import importlib.util
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import uuid
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MOBILE = ROOT / 'packages/mobile'
CERT = MOBILE / 'certs/certificate.pem'
DEFAULT_KEY = Path.home() / '.hiraia/ota-keys/private-key.pem'
BUCKET = 'hiraia-assets'
PUBLIC = 'https://assets.hiraia.org'
ROUTE = 'https://hiraia.org/api/updates/manifest'
PREFIX = 'ota/android'
IMMUTABLE = 'public, max-age=31536000, immutable'
# Same pin as packages/mobile/scripts/sign-apk.sh: an OTA is only ever built against the
# release-signed APK that phones actually run, never the debug-signed gradle output.
PINNED_APK_CERT = '40d750d5576cb59c311c7ba713403e065b934967d7a7d1bc80652e1167a20c35'
ASSET_MAX = 2 * 1024 * 1024
ASSETS_TOTAL_MAX = 5 * 1024 * 1024
HISTORY_MAX = 200
# The relay caches channel.json for 60 s; the end-to-end check waits out one refresh.
ROUTE_WAIT_S = 90
HERMES_MAGIC = bytes.fromhex('c61fbc03c103191f')
RUNTIME = re.compile(r'[0-9a-f]{40}')
UUID_RE = re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')
CLIENT_ID = re.compile(r'[A-Za-z0-9-]{8,64}')
CONTENT_TYPES = {
    'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'gif': 'image/gif',
    'webp': 'image/webp', 'svg': 'image/svg+xml', 'ttf': 'font/ttf', 'otf': 'font/otf',
    'wav': 'audio/wav', 'mp3': 'audio/mpeg', 'mp4': 'video/mp4', 'json': 'application/json',
}


# ---------------------------------------------------------------------------------------
# pure helpers (deploy/test_publish_ota.py)
# ---------------------------------------------------------------------------------------

def iso_ms(moment):
    """The one date shape expo-updates' Android parser takes first: 2026-09-24T01:02:03.004Z."""
    moment = moment.astimezone(dt.timezone.utc)
    return moment.strftime('%Y-%m-%dT%H:%M:%S.') + f'{moment.microsecond // 1000:03d}Z'


def b64url(raw):
    return base64.urlsafe_b64encode(raw).rstrip(b'=').decode('ascii')


def file_digests(path):
    sha, md5, n = hashlib.sha256(), hashlib.md5(), 0
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            sha.update(chunk); md5.update(chunk); n += len(chunk)
    return {'bytes': n, 'sha256': sha.hexdigest(), 'md5': md5.hexdigest(), 'hash': b64url(sha.digest())}


def hermes_version(head):
    """Bytecode version of a Hermes bundle: 8-byte magic, then a little-endian uint32."""
    if head[:8] != HERMES_MAGIC:
        raise ValueError('not a Hermes bytecode bundle')
    return int.from_bytes(head[8:12], 'little')


def embedded_keys(app_manifest):
    """Asset keys of the APK's embedded update — expo-updates keys them by packagerHash (md5)."""
    return {a['packagerHash'] for a in app_manifest.get('assets', []) if a.get('packagerHash')}


def rollout_bucket(release_id, client_id):
    """0-99; MUST match rolloutBucket in packages/web/src/app/api/updates/manifest/relay.ts."""
    digest = hashlib.sha256(f'hiraia-ota-rollout-v1:{release_id}:{client_id.lower()}'.encode()).digest()
    return int.from_bytes(digest[:4], 'big') % 100


def serialize(doc):
    """The bytes that get signed. ASCII-only, so the phone's UTF-8 decode/encode round trip
    before it verifies (FileDownloader.kt: readUtf8() then toByteArray()) is the identity."""
    return json.dumps(doc, ensure_ascii=True, separators=(',', ':')).encode('ascii')


def asset_entry(info, ext):
    ext = ext.lstrip('.')
    return {
        'hash': info['hash'],
        'key': info['md5'],
        'contentType': CONTENT_TYPES.get(ext.lower(), 'application/octet-stream'),
        'fileExtension': '.' + ext,
        'url': f"{PUBLIC}/{PREFIX}/assets/{info['sha256']}",
    }


def build_manifest(*, update_id, created_at, runtime, bundle, assets, expo_client, hiraia):
    """Expo Updates protocol v1 manifest. `bundle` / `assets[i]` are file_digests() + ext."""
    return {
        'id': update_id,
        'createdAt': created_at,
        'runtimeVersion': runtime,
        'launchAsset': {
            'hash': bundle['hash'],
            'key': bundle['md5'],
            'contentType': 'application/javascript',
            'fileExtension': '.bundle',
            'url': f"{PUBLIC}/{PREFIX}/assets/{bundle['sha256']}",
        },
        'assets': [asset_entry(a, a['ext']) for a in assets],
        'metadata': {},
        'extra': {'expoClient': expo_client, 'hiraia': hiraia},
    }


def asset_guard(assets, embedded, allow_large=False):
    """(new assets phones must download, refusal reasons). Embedded ones cost 0 bytes."""
    new = [a for a in assets if a['md5'] not in embedded]
    problems = [f"{a['path']} ({a['bytes']:,} B) is over {ASSET_MAX:,} B" for a in new if a['bytes'] > ASSET_MAX]
    total = sum(a['bytes'] for a in new)
    if total > ASSETS_TOTAL_MAX:
        problems.append(f'new assets total {total:,} B, over {ASSETS_TOTAL_MAX:,} B')
    return new, ([] if allow_large else problems)


def rollback_directive(commit_time):
    return {'type': 'rollBackToEmbedded', 'parameters': {'commitTime': commit_time}}


def release_keys(runtime, release):
    """R2 keys of a release's body + detached signature (relay.ts releaseKeys, same layout)."""
    if release['kind'] == 'update':
        body = f"{PREFIX}/{runtime}/updates/{release['id']}/manifest.json"
    else:
        body = f"{PREFIX}/{runtime}/directives/{release['id']}/directive.json"
    return body, body + '.sig'


def empty_channel(runtime):
    return {
        'format': 1,
        'runtimeVersion': runtime,
        'canary': {'clients': [], 'release': None},
        'production': {'release': None, 'rollout': 100, 'fallback': None},
        'history': [],
    }


def update_channel(channel, *, runtime, ring, release=None, rollout=None, add_clients=(),
                   remove_clients=(), stamp, note=None):
    """The next channel.json. Never mutates `channel`.

    canary:     the ring's release becomes `release` (None leaves it; canary follows production).
    production: a NEW release takes the pointer; `rollout` alone re-sizes the current release.
                The release it replaces becomes the fallback for phones outside the rollout
                ONLY if it was at 100%: one held below that (halted for a bug, or still going
                out) must not reach the rest by the back door, so the fallback stays as it was.
                Canary phones follow production again (canary release cleared), so a
                --republish rollback reaches them too and they never sit on an old canary.
    A production rollBackToEmbedded directive is an emergency brake: always 100%.
    (Canary has no percentage.)
    """
    nxt = json.loads(json.dumps(channel)) if channel else empty_channel(runtime)
    if nxt.get('format') != 1 or nxt.get('runtimeVersion') != runtime:
        raise ValueError('channel.json belongs to another runtime or format')
    clients = [c for c in nxt['canary'].get('clients', []) if c.lower() not in {r.lower() for r in remove_clients}]
    for c in add_clients:
        if not CLIENT_ID.fullmatch(c):
            raise ValueError(f'not an EAS-Client-ID: {c!r}')
        if c.lower() not in {x.lower() for x in clients}:
            clients.append(c)
    nxt['canary']['clients'] = clients
    if rollout is not None and (not isinstance(rollout, int) or not 0 <= rollout <= 100):
        raise ValueError('rollout must be an integer 0-100')
    if ring == 'canary':
        if rollout is not None:
            raise ValueError('--rollout applies to the production ring')
        if release is not None:
            nxt['canary']['release'] = release
    elif ring == 'production':
        if release is not None and release['kind'] == 'rollBackToEmbedded':
            rollout = 100  # the brake covers everyone
        prod = nxt['production']
        if release is not None and release != prod.get('release'):
            if rollout is None:
                raise ValueError('a new production release needs an explicit --rollout')
            if prod.get('release') is not None and prod.get('rollout', 100) >= 100:
                prod['fallback'] = prod['release']
            prod['release'] = release
            nxt['canary']['release'] = None
        if rollout is not None:
            if prod.get('release') is None:
                raise ValueError('no production release to roll out')
            prod['rollout'] = rollout
    else:
        raise ValueError(f'unknown ring {ring!r}')
    entry = {'at': stamp['at'], 'ring': ring, 'release': release, 'rollout': rollout,
             'git': stamp.get('git'), 'apk': stamp.get('apk')}
    if add_clients or remove_clients:
        entry['clients'] = {'added': list(add_clients), 'removed': list(remove_clients)}
    if note:
        entry['note'] = note
    nxt['history'] = (nxt.get('history') or [])[-(HISTORY_MAX - 1):] + [entry]
    nxt['updatedAt'] = stamp['at']
    return nxt


def parse_multipart(content_type, body):
    """[(headers, body)] of a multipart/mixed answer — the relay's, as a phone reads it."""
    m = re.fullmatch(r'multipart/mixed;\s*boundary=("?)([^";]+)\1', content_type.strip())
    if not m:
        raise ValueError(f'not multipart/mixed: {content_type!r}')
    delim = b'--' + m.group(2).encode()
    if not body.startswith(delim + b'\r\n') or not body.rstrip(b'\r\n').endswith(delim + b'--'):
        raise ValueError('multipart framing is broken')
    inner = body[len(delim) + 2:body.rstrip(b'\r\n').rindex(delim + b'--')]
    parts = []
    for chunk in inner.split(b'\r\n' + delim + b'\r\n'):
        chunk = chunk[:-2] if chunk.endswith(b'\r\n') else chunk
        head, _, payload = chunk.partition(b'\r\n\r\n')
        headers = {}
        for line in head.decode('latin-1').split('\r\n'):
            k, _, v = line.partition(':')
            headers[k.strip().lower()] = v.strip()
        parts.append((headers, payload))
    return parts


def signature_from_header(value):
    """sig="<base64>" out of an expo-signature structured field."""
    m = re.search(r'(?:^|,)\s*sig="([A-Za-z0-9+/=]+)"', value or '')
    if not m:
        raise ValueError(f'no sig in expo-signature: {value!r}')
    return m.group(1)


def diff_sources(built, now):
    """What changed between two fingerprint source lists (e.g. the APK build's vs this tree's)."""
    def index(sources):
        return {(s['type'], s.get('filePath') or s.get('id')): s.get('hash') for s in sources}
    a, b = index(built), index(now)
    lines = [f'  - removed {t} {k}' for (t, k) in sorted(a.keys() - b.keys())]
    lines += [f'  + added   {t} {k}' for (t, k) in sorted(b.keys() - a.keys())]
    lines += [f'  ~ changed {t} {k}' for (t, k) in sorted(a.keys() & b.keys()) if a[(t, k)] != b[(t, k)]]
    return lines


def fingerprint_from_build_log(text, runtime):
    """The fingerprint JSON the gradle task printed while building the APK (sources + hash)."""
    for line in text.splitlines():
        start = line.find('{')
        if start < 0 or runtime not in line:
            continue
        try:
            doc = json.loads(line[start:])
        except ValueError:
            continue
        if isinstance(doc, dict) and doc.get('hash') == runtime and 'sources' in doc:
            return doc
    return None


def gate_green(text):
    """Did the LAST gate verdict in a run-harness.sh log say green?"""
    verdicts = re.findall(r'>> GATE (GREEN|RED)', text)
    return bool(verdicts) and verdicts[-1] == 'GREEN'


def rollback_problem(channel):
    """Why a rollBackToEmbedded here would reach no phone, or None when some phone may run an
    update on this runtime. A mistyped runtime (say `fingerprint:generate` on a tree that has
    moved on since the APK) has no channel.json; braking there would 'succeed', verify end to
    end against itself, and leave every real phone on the bad update."""
    if channel is None:
        return 'nothing was ever published for it (no channel.json)'
    production, canary = channel.get('production') or {}, channel.get('canary') or {}
    releases = [production.get('release'), production.get('fallback'), canary.get('release')]
    releases += [entry.get('release') for entry in channel.get('history') or []]
    if not any(isinstance(r, dict) and r.get('kind') == 'update' for r in releases):
        return 'its channel.json never carried an update'
    return None


def channel_summary(before, after):
    """Printed after every flip: what each ring now serves."""
    def name(release):
        return f"{release['kind']} {release['id']}" if release else None
    prod, canary = after.get('production') or {}, after.get('canary') or {}
    outside = '' if prod.get('rollout', 100) >= 100 else f"; outside it: {name(prod.get('fallback')) or 'nothing (204)'}"
    lines = [f"   production: {name(prod.get('release')) or 'nothing'} at {prod.get('rollout', 100)}%{outside}"]
    old = ((before or {}).get('production') or {})
    if prod.get('rollout', 100) < 100 and old.get('release') and old['release'] not in (prod.get('release'), prod.get('fallback')):
        lines.append(f"   {old['release']['id']} was at {old.get('rollout', 100)}% — not made the fallback: only a "
                     'release that reached every phone serves the phones outside a rollout')
    lines.append(f"   canary ({len(canary.get('clients') or [])} phones): {name(canary.get('release')) or 'follows production'}")
    return lines


def canary_probe_client(channel):
    clients = channel['canary'].get('clients') or []
    return clients[0] if clients else None


def production_probe_client(release_id, rollout):
    """A synthetic EAS-Client-ID inside the rollout, so the end-to-end check sees what those phones see."""
    for i in range(10_000):
        client = f'00000000-0000-4000-8000-{i:012d}'
        if rollout >= 100 or rollout_bucket(release_id, client) < rollout:
            return client
    return None


# ---------------------------------------------------------------------------------------
# local tools
# ---------------------------------------------------------------------------------------

def run(cmd, cwd=MOBILE, env=None, stream=False):
    """Run a tool; exit on failure. `stream` shows its output live (the minutes-long steps)."""
    result = subprocess.run(cmd, cwd=cwd, env=env, capture_output=not stream, text=True)
    if result.returncode != 0:
        if not stream:
            sys.stderr.write(result.stdout[-4000:] + result.stderr[-4000:])
        sys.exit(f"!! {' '.join(map(str, cmd))} exited {result.returncode}")
    return result.stdout


def sign_bytes(body, key):
    """Base64 RSA-SHA256 (PKCS#1 v1.5) over exactly `body`. The key is read by openssl, never printed."""
    result = subprocess.run(['openssl', 'dgst', '-sha256', '-sign', str(key)], input=body, capture_output=True)
    if result.returncode != 0:
        sys.exit('!! openssl could not sign with ' + str(key) + ': ' + result.stderr.decode(errors='replace')[-300:])
    return base64.b64encode(result.stdout).decode('ascii')


def verify_bytes(body, signature, cert):
    """What a phone does with the certificate baked into its APK."""
    with tempfile.TemporaryDirectory() as tmp:
        pub, sig = Path(tmp) / 'pub.pem', Path(tmp) / 'sig.bin'
        extracted = subprocess.run(['openssl', 'x509', '-pubkey', '-noout', '-in', str(cert)], capture_output=True)
        if extracted.returncode != 0:
            # A bare public key works too (the tests' throwaway key has no certificate).
            pub.write_bytes(Path(cert).read_bytes())
        else:
            pub.write_bytes(extracted.stdout)
        sig.write_bytes(base64.b64decode(signature))
        result = subprocess.run(['openssl', 'dgst', '-sha256', '-verify', str(pub), '-signature', str(sig)],
                                input=body, capture_output=True)
        return result.returncode == 0


def android_tool(name):
    tools = sorted((Path.home() / 'Library/Android/sdk/build-tools').glob(f'*/{name}'))
    if not tools:
        sys.exit(f'!! {name} not found under ~/Library/Android/sdk/build-tools')
    return str(tools[-1])


def read_apk(apk):
    """Step 1: what the phones actually run."""
    with zipfile.ZipFile(apk) as z:
        names = set(z.namelist())
        for required in ('assets/fingerprint', 'assets/app.manifest', 'assets/index.android.bundle'):
            if required not in names:
                sys.exit(f'!! {apk} has no {required} — it was built without expo-updates (0.4.23 and '
                         'older take no OTA) or without the fingerprint runtime policy')
        runtime = z.read('assets/fingerprint').decode().strip()
        embedded = json.loads(z.read('assets/app.manifest'))
        bundle = z.read('assets/index.android.bundle')
    hermes = hermes_version(bundle[:12])
    if not RUNTIME.fullmatch(runtime):
        sys.exit(f'!! assets/fingerprint is not a 40-hex fingerprint: {runtime!r}')
    env = {**os.environ, 'JAVA_HOME': os.environ.get('JAVA_HOME', '/opt/homebrew/opt/openjdk')}
    certs = run([android_tool('apksigner'), 'verify', '--print-certs', str(apk)], env=env)
    cert = re.search(r'SHA-256 digest: ([0-9a-f]{64})', certs)
    badging = run([android_tool('aapt'), 'dump', 'badging', str(apk)])
    code = re.search(r"versionCode='([0-9]+)'", badging)
    name = re.search(r"versionName='([^']+)'", badging)
    return {
        'runtime': runtime,
        'embedded': embedded,
        'hermes': hermes,
        'bundle': bundle,
        'cert': cert.group(1) if cert else None,
        'versionCode': int(code.group(1)) if code else None,
        'versionName': name.group(1) if name else None,
    }


def tree_fingerprint():
    return json.loads(run(['npx', 'expo-updates', 'fingerprint:generate', '--platform', 'android']))


def qvac_bundle_id():
    return json.loads((MOBILE / 'qvac/addons.manifest.json').read_text())['bundleId']


def git(*args):
    return run(['git', *args], cwd=ROOT).strip()


def preflight(args):
    """Step 0. Returns the git sha. A dry run reports a dirty tree instead of refusing it."""
    sha = git('rev-parse', 'HEAD')
    dirty = git('status', '--porcelain', '--', 'packages/mobile', 'packages/shared')
    if dirty:
        msg = 'packages/mobile or packages/shared has uncommitted changes — an OTA must be a commit'
        if not args.dry_run:
            sys.exit('!! ' + msg + ':\n' + dirty)
        print('   (dry run) ' + msg)
    print('== preflight: build-apk.sh checks (voices, image packs, lessons, card inventory)')
    run(['bash', str(MOBILE / 'scripts/build-apk.sh')], env={**os.environ, 'PREFLIGHT_ONLY': '1'}, stream=True)
    if args.ring == 'production':
        check_gate(args, sha)
    return sha


def check_gate(args, sha):
    """CLAUDE.md: the regression gate is green before anything reaches a human, and a
    production OTA does. The log must say GREEN last and postdate the commit being shipped."""
    if not args.gate_log:
        if args.dry_run:
            print('   (dry run) no --gate-log; a real production publish refuses without one')
            return
        sys.exit('!! production needs --gate-log: finetuning/eval/harness/run-harness.sh | tee <file>')
    text = Path(args.gate_log).read_text(errors='replace')
    committed = int(git('log', '-1', '--format=%ct', sha))
    if not gate_green(text) or Path(args.gate_log).stat().st_mtime < committed:
        sys.exit(f'!! {args.gate_log} is not a GREEN gate run made after {sha[:10]} was committed')
    print(f'   regression gate: GREEN, run after {sha[:10]}')


def guard_fingerprint(runtime):
    """Step 2."""
    print('== fingerprint of this tree')
    now = tree_fingerprint()
    if now['hash'] == runtime:
        print(f'   {runtime} — matches the APK')
        return
    print(f"!! this tree's fingerprint {now['hash']} is not the APK's {runtime}.")
    print('   Phones would never apply this update. Publish from the tree that built the APK.')
    log = Path('/tmp/apk-build.log')
    built = fingerprint_from_build_log(log.read_text(errors='replace'), runtime) if log.exists() else None
    if built:
        print('   What changed since that build (from /tmp/apk-build.log):')
        print('\n'.join(diff_sources(built['sources'], now['sources'])) or '   (no per-source difference found)')
    sys.exit(1)


def export_update(out_dir):
    """Step 3. Same env as the APK build: build-apk.sh sets no EXPO_PUBLIC_* override."""
    overrides = sorted(k for k in os.environ if k.startswith('EXPO_PUBLIC_'))
    if overrides:
        sys.exit(f"!! {', '.join(overrides)} set — the APK was built without them; the export must match")
    print(f'== expo export → {out_dir.relative_to(ROOT)}')
    run(['npx', 'expo', 'export', '--platform', 'android', '--output-dir', str(out_dir),
         '--dump-assetmap', '--source-maps'], stream=True)
    meta = json.loads((out_dir / 'metadata.json').read_text())['fileMetadata']['android']
    bundle = out_dir / meta['bundle']
    assets = [{'path': a['path'], 'ext': a['ext'], 'file': out_dir / a['path']} for a in meta['assets']]
    return bundle, assets


def expo_client():
    return json.loads(run(['npx', 'expo', 'config', '--type', 'public', '--json']))


# ---------------------------------------------------------------------------------------
# R2
# ---------------------------------------------------------------------------------------

def load_env(path):
    """deploy/publish-release-assets.py's parser — one definition of the env file."""
    spec = importlib.util.spec_from_file_location('publish_release_assets', Path(__file__).with_name('publish-release-assets.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.load_env(path)


class Bucket:
    """R2 through boto3. With `dry_run`, reads are real (when credentials exist) and writes are only printed."""

    def __init__(self, env_file, dry_run):
        self.dry_run = dry_run
        self.s3 = None
        if env_file:
            v = load_env(env_file)
            import boto3  # in the publish venv (see publish-release-assets.py)
            self.s3 = boto3.client('s3', endpoint_url=v['R2_ENDPOINT'], aws_access_key_id=v['R2_ACCESS_KEY_ID'],
                                   aws_secret_access_key=v['R2_SECRET_ACCESS_KEY'], region_name='auto')
        elif not dry_run:
            sys.exit('!! --env-file is required (only --dry-run runs without R2 credentials)')

    def _missing(self, error):
        return str(error.response.get('Error', {}).get('Code')) in ('404', 'NoSuchKey', 'NotFound')

    def get(self, key):
        """(bytes, etag), or (None, None) when absent or no credentials."""
        if not self.s3:
            return None, None
        from botocore.exceptions import ClientError
        try:
            obj = self.s3.get_object(Bucket=BUCKET, Key=key)
        except ClientError as error:
            if self._missing(error):
                return None, None
            raise
        return obj['Body'].read(), obj['ETag']

    def runtimes(self):
        """40-hex runtimes with anything under ota/android/ — the candidates for --runtime."""
        if not self.s3:
            return []
        found, more = [], {}
        while True:
            page = self.s3.list_objects_v2(Bucket=BUCKET, Prefix=f'{PREFIX}/', Delimiter='/', **more)
            found += [p['Prefix'][len(PREFIX) + 1:].rstrip('/') for p in page.get('CommonPrefixes', [])]
            if not page.get('IsTruncated'):
                return sorted(r for r in found if RUNTIME.fullmatch(r))
            more = {'ContinuationToken': page['NextContinuationToken']}

    def put_immutable(self, key, source, content_type, sha256):
        """Create-if-absent + read-back. An existing object must already hold these exact bytes."""
        if self.dry_run:
            return 'would upload'
        from botocore.exceptions import ClientError
        try:
            head = self.s3.head_object(Bucket=BUCKET, Key=key)
        except ClientError as error:
            if not self._missing(error):
                raise
        else:
            if head.get('Metadata', {}).get('sha256') != sha256:
                sys.exit(f'!! {key} already exists with other bytes — content-addressed keys never change')
            return 'already there'
        body = source.read_bytes() if isinstance(source, Path) else source
        self.s3.put_object(Bucket=BUCKET, Key=key, Body=body, IfNoneMatch='*', ContentType=content_type,
                           CacheControl=IMMUTABLE, Metadata={'sha256': sha256})
        h = hashlib.sha256()
        for chunk in self.s3.get_object(Bucket=BUCKET, Key=key)['Body'].iter_chunks(1 << 20):
            h.update(chunk)
        if h.hexdigest() != sha256:
            sys.exit(f'!! read-back sha256 mismatch for {key} — NOT published correctly')
        return 'uploaded + read back'

    def put_channel(self, runtime, doc, etag):
        key = f'{PREFIX}/{runtime}/channel.json'
        body = json.dumps(doc, indent=2).encode() + b'\n'
        if self.dry_run:
            print(f'   (dry run) would write {key}:')
            print('\n'.join('     ' + line for line in body.decode().splitlines()[:40]))
            return
        from botocore.exceptions import ClientError
        condition = {'IfMatch': etag} if etag else {'IfNoneMatch': '*'}
        try:
            self.s3.put_object(Bucket=BUCKET, Key=key, Body=body, ContentType='application/json',
                               CacheControl='no-store', **condition)
        except ClientError as error:
            if str(error.response.get('Error', {}).get('Code')) in ('PreconditionFailed', '412'):
                sys.exit(f'!! {key} changed while this ran (another publish?) — nothing flipped; run again')
            raise
        print(f'   wrote {key}')


# ---------------------------------------------------------------------------------------
# steps
# ---------------------------------------------------------------------------------------

def publish_signed(bucket, runtime, release, doc, key_path):
    """Steps 9 (and the directive / republish equivalents): serialise once, sign, verify, upload."""
    body = serialize(doc)
    signature = sign_bytes(body, key_path)
    if not verify_bytes(body, signature, CERT):
        sys.exit(f'!! the signature does not verify against {CERT.relative_to(ROOT)} — '
                 'wrong key for this app? Phones would reject it.')
    print(f"   signed {len(body):,} B with {key_path} — verifies against {CERT.relative_to(ROOT)}")
    body_key, sig_key = release_keys(runtime, release)
    print(f"   {body_key}: {bucket.put_immutable(body_key, body, 'application/json', hashlib.sha256(body).hexdigest())}")
    sig = signature.encode()
    print(f"   {sig_key}: {bucket.put_immutable(sig_key, sig, 'text/plain', hashlib.sha256(sig).hexdigest())}")
    return body, signature


def build_update(args, apk, runtime, sha, bucket, key_path):
    """Steps 3-9 for a new update. Returns (release, signed manifest bytes, bundle digests)."""
    stamp = dt.datetime.now(dt.timezone.utc)
    out = MOBILE / 'build/ota' / stamp.strftime('%Y%m%dT%H%M%SZ')
    bundle_path, assets = export_update(out)

    head = bundle_path.read_bytes()
    if hermes_version(head[:12]) != apk['hermes']:
        sys.exit(f"!! export is Hermes bytecode v{hermes_version(head[:12])}, the APK v{apk['hermes']}")
    bundle_id = qvac_bundle_id().encode('utf-16-le')
    if bundle_id not in head or bundle_id not in apk['bundle']:
        sys.exit('!! the QVAC worker bundleId is not in both the export and the APK bundle — '
                 'the worker and the native addons would disagree')
    print(f"   Hermes v{apk['hermes']}, QVAC worker {qvac_bundle_id()[:12]} in both")

    bundle = file_digests(bundle_path)
    for a in assets:
        a.update(file_digests(a['file']))
        if a['md5'] != Path(a['path']).name:
            sys.exit(f"!! {a['path']}: md5 {a['md5']} is not its Metro key")
    new, problems = asset_guard(assets, embedded_keys(apk['embedded']), args.allow_large_assets)
    print(f"== assets: {len(assets)} in the update, {len(assets) - len(new)} reused from the APK (0 B to phones)")
    for a in new:
        print(f"   NEW {a['path']}.{a['ext']}  {a['bytes']:,} B")
    print(f"   bundle {bundle['bytes']:,} B (+{sum(a['bytes'] for a in new):,} B of new assets)")
    if problems:
        sys.exit('!! refusing: ' + '; '.join(problems) +
                 '\n   Content goes by content pack or APK. --allow-large-assets if you really mean it.')

    commit = apk['embedded'].get('commitTime', 0)
    if stamp.timestamp() * 1000 <= commit:
        sys.exit('!! the clock says now is not after the APK build — phones would ignore this update')
    update_id = str(uuid.uuid4())
    doc = build_manifest(
        update_id=update_id, created_at=iso_ms(stamp), runtime=runtime, bundle=bundle,
        assets=assets, expo_client=expo_client(),
        hiraia={'git': sha, 'apkVersionName': apk['versionName'], 'apkVersionCode': apk['versionCode']},
    )
    print(f'== {1 + len(assets)} content-addressed objects under {PREFIX}/assets/')
    outcomes = [bucket.put_immutable(f"{PREFIX}/assets/{bundle['sha256']}", bundle_path, 'application/javascript', bundle['sha256'])]
    for a in assets:
        outcomes.append(bucket.put_immutable(f"{PREFIX}/assets/{a['sha256']}", a['file'],
                                             asset_entry(a, a['ext'])['contentType'], a['sha256']))
    print('   ' + ', '.join(f'{outcomes.count(o)} {o}' for o in sorted(set(outcomes))))
    print(f"== manifest {update_id}")
    release = {'kind': 'update', 'id': update_id}
    body, _ = publish_signed(bucket, runtime, release, doc, key_path)
    out.mkdir(parents=True, exist_ok=True)
    (out / 'manifest.json').write_bytes(body)
    print(f"   local copy: {(out / 'manifest.json').relative_to(ROOT)}")
    return release, body, bundle


def republish(args, runtime, bucket, key_path):
    """The last good update again, as a NEW id with a newer createdAt (phones only move forward)."""
    old = {'kind': 'update', 'id': args.republish}
    body_key, sig_key = release_keys(runtime, old)
    body, _ = bucket.get(body_key)
    sig, _ = bucket.get(sig_key)
    if body is None or sig is None:
        sys.exit(f'!! {body_key} (+ .sig) not found on R2 — republish needs R2 read access (--env-file)')
    if not verify_bytes(body, sig.decode().strip(), CERT):
        sys.exit(f'!! {body_key} does not verify against the certificate — not republishing it')
    doc = json.loads(body)
    if doc.get('runtimeVersion') != runtime:
        sys.exit('!! that update belongs to another runtime')
    doc['id'] = str(uuid.uuid4())
    doc['createdAt'] = iso_ms(dt.datetime.now(dt.timezone.utc))
    doc.setdefault('extra', {}).setdefault('hiraia', {})['republishedFrom'] = args.republish
    release = {'kind': 'update', 'id': doc['id']}
    print(f"== republish {args.republish} as {doc['id']}")
    body, _ = publish_signed(bucket, runtime, release, doc, key_path)
    return release, body


def guard_rollback_target(bucket, runtime):
    """Before anything is signed: a rollback must land on a runtime where phones run an update."""
    if not bucket.s3:
        print('   (dry run) no R2 credentials: not checking that any phone runs an update on this runtime')
        return
    raw, _ = bucket.get(f'{PREFIX}/{runtime}/channel.json')
    problem = rollback_problem(json.loads(raw) if raw else None)
    if not problem:
        return
    try:
        known = ', '.join(r for r in bucket.runtimes() if r != runtime) or 'none'
    except Exception as error:  # the refusal matters more than the hint
        known = f'(could not list: {error})'
    sys.exit(f'!! refusing to roll back runtime {runtime}: {problem}, so no phone has an update to leave.\n'
             '   Wrong --runtime? Take it from the APK phones run (unzip -p <apk> assets/fingerprint) or the\n'
             '   "runtime" of the ledger line its publish printed — never from fingerprint:generate on a tree\n'
             f'   that has moved on since. Runtimes on R2: {known}')


def rollback(runtime, bucket, key_path):
    release = {'kind': 'rollBackToEmbedded', 'id': str(uuid.uuid4())}
    print(f"== rollBackToEmbedded directive {release['id']}")
    body, _ = publish_signed(bucket, runtime, release, rollback_directive(iso_ms(dt.datetime.now(dt.timezone.utc))), key_path)
    return release, body


def fetch_route(runtime, client):
    req = urllib.request.Request(ROUTE, headers={
        'Expo-Protocol-Version': '1', 'Expo-Platform': 'android', 'Expo-Runtime-Version': runtime,
        'EAS-Client-ID': client, 'Expo-Current-Update-ID': '00000000-0000-4000-8000-000000000000',
        'Accept': 'multipart/mixed', 'User-Agent': 'hiraia-publish-ota',
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.headers.get('Content-Type', ''), r.read()
    except urllib.error.HTTPError as error:
        return error.code, error.headers.get('Content-Type', ''), error.read()


def end_to_end(runtime, channel, ring, release, body, bundle):
    """Step 11: the live route, asked the way a phone in the ring asks, must hand back our bytes."""
    if release is None or body is None:
        return
    client = canary_probe_client(channel) if ring == 'canary' else production_probe_client(
        release['id'], channel['production']['rollout'])
    if not client:
        print('!! no canary clients in channel.json — nobody receives this. Add one with --canary-client.')
        return
    print(f'== end-to-end: {ROUTE} as {client} (the relay re-reads the channel within a minute)')
    deadline = time.time() + ROUTE_WAIT_S
    while True:
        status, ctype, raw = fetch_route(runtime, client)
        parts = parse_multipart(ctype, raw) if status == 200 else []
        if parts and parts[0][1] == body:
            break
        if time.time() > deadline:
            sys.exit(f'!! the route still does not serve {release["id"]} (HTTP {status}) — check pm2 logs hiraia-web')
        time.sleep(5)
    headers, payload = parts[0]
    if not verify_bytes(payload, signature_from_header(headers.get('expo-signature')), CERT):
        sys.exit('!! the route serves our bytes with a signature that does not verify')
    print(f"   served as '{headers.get('content-disposition')}', signature verifies")
    if bundle:
        measure_bundle(bundle)


def measure_bundle(bundle):
    """What a phone pays for the bundle: the edge's encoding, bytes on the wire, and the decoded hash."""
    url = f"{PUBLIC}/{PREFIX}/assets/{bundle['sha256']}"
    req = urllib.request.Request(url, headers={'Accept-Encoding': 'br, gzip', 'User-Agent': 'hiraia-publish-ota'})
    with urllib.request.urlopen(req, timeout=120) as r:
        encoding, wire = r.headers.get('Content-Encoding', 'identity'), r.read()
    if encoding == 'gzip' and hashlib.sha256(gzip.decompress(wire)).hexdigest() != bundle['sha256']:
        sys.exit('!! the gzip-encoded bundle does not decode to the uploaded bytes')
    with urllib.request.urlopen(urllib.request.Request(url, headers={'Accept-Encoding': 'identity'}), timeout=300) as r:
        if hashlib.sha256(r.read()).hexdigest() != bundle['sha256']:
            sys.exit('!! the public bundle is not the uploaded bytes')
    print(f"   bundle on the wire: {len(wire):,} B ({encoding}) for {bundle['bytes']:,} B"
          + ('' if encoding != 'identity' else ' — NOT compressed; add a Cloudflare Compression Rule for /ota/*'))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--env-file', help='R2 credentials (see publish-release-assets.py); optional with --dry-run')
    ap.add_argument('--apk', type=Path, help='the SIGNED APK phones run (its fingerprint is the runtime)')
    ap.add_argument('--runtime', help='40-hex runtime instead of --apk (rollback / republish / channel edits)')
    ap.add_argument('--key', type=Path, default=DEFAULT_KEY, help='signing key (default ~/.hiraia/ota-keys/private-key.pem)')
    ap.add_argument('--ring', choices=['canary', 'production'], default='canary')
    ap.add_argument('--rollout', type=int, help='production: percent of phones (0-100)')
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument('--republish', metavar='UPDATE_ID', help='re-sign an earlier update as a new one')
    mode.add_argument('--rollback-to-embedded', action='store_true', help='send the ring back to the APK bundle')
    mode.add_argument('--promote', action='store_true', help="production takes the canary ring's release")
    mode.add_argument('--rollout-only', action='store_true', help='only re-size the current production release')
    mode.add_argument('--channel-only', action='store_true', help='only edit the canary allowlist')
    ap.add_argument('--canary-client', action='append', default=[], help='add an EAS-Client-ID to the canary ring')
    ap.add_argument('--remove-canary-client', action='append', default=[])
    ap.add_argument('--gate-log', help='run-harness.sh output; required for a production publish')
    ap.add_argument('--allow-large-assets', action='store_true')
    ap.add_argument('--note', help='free text for channel.json history')
    ap.add_argument('--dry-run', action='store_true', help='everything local; upload and flip nothing')
    args = ap.parse_args()
    args.mode = ('republish' if args.republish else 'rollback' if args.rollback_to_embedded else
                 'promote' if args.promote else 'rollout' if args.rollout_only else
                 'channel' if args.channel_only else 'publish')
    if args.mode in ('promote', 'rollout') and args.ring != 'production':
        ap.error(f'--{args.mode.replace("rollout", "rollout-only")} is a production-ring operation')
    if args.mode == 'publish' and not args.apk:
        ap.error('publishing an update needs --apk (the fingerprint guard compares against it)')
    if args.rollout is not None and args.ring != 'production':
        ap.error('--rollout applies to the production ring (canary is an allowlist)')
    if args.mode == 'rollout' and args.rollout is None:
        ap.error('--rollout-only needs --rollout N')
    if args.republish and not UUID_RE.fullmatch(args.republish):
        ap.error('--republish takes an update id (lowercase UUID)')
    signs = args.mode in ('publish', 'republish', 'rollback')
    if signs and not args.key.is_file():
        sys.exit(f'!! signing key {args.key} not found (backed up in the password manager)')
    if not CERT.is_file():
        sys.exit(f'!! {CERT} missing')

    apk = read_apk(args.apk) if args.apk else None
    runtime = apk['runtime'] if apk else args.runtime
    if not runtime or not RUNTIME.fullmatch(runtime):
        ap.error('give --apk, or --runtime <40-hex fingerprint>')
    if apk:
        print(f"== APK {args.apk.name}: {apk['versionName']} ({apk['versionCode']}), runtime {runtime}, Hermes v{apk['hermes']}")
        if apk['cert'] != PINNED_APK_CERT:
            sys.exit(f"!! APK signed by {apk['cert']}, not the release key {PINNED_APK_CERT[:12]}… — sign it first (sign-apk.sh)")

    bucket = Bucket(args.env_file, args.dry_run)
    if args.mode == 'rollback':
        guard_rollback_target(bucket, runtime)
    sha = git('rev-parse', 'HEAD')
    release = body = bundle = None
    if args.mode == 'publish':
        sha = preflight(args)
        guard_fingerprint(runtime)
        release, body, bundle = build_update(args, apk, runtime, sha, bucket, args.key)
    elif args.mode == 'republish':
        release, body = republish(args, runtime, bucket, args.key)
    elif args.mode == 'rollback':
        release, body = rollback(runtime, bucket, args.key)

    raw, etag = bucket.get(f'{PREFIX}/{runtime}/channel.json')
    channel = json.loads(raw) if raw else None
    if args.mode == 'promote':
        release = (channel or empty_channel(runtime))['canary'].get('release')
        if not release:
            sys.exit('!! the canary ring has no release to promote (to widen a production rollout, use --rollout-only --rollout N)')
        body, _ = bucket.get(release_keys(runtime, release)[0])
        if release['kind'] == 'update':
            # The gate must postdate the commit the canary update was exported from.
            check_gate(args, json.loads(body)['extra']['hiraia']['git'] if body else sha)
    stamp = {'at': iso_ms(dt.datetime.now(dt.timezone.utc)), 'git': sha,
             'apk': apk['versionName'] if apk else None}
    try:
        nxt = update_channel(channel, runtime=runtime, ring=args.ring, release=release, rollout=args.rollout,
                             add_clients=args.canary_client, remove_clients=args.remove_canary_client,
                             stamp=stamp, note=args.note)
    except ValueError as error:
        sys.exit(f'!! {error}')
    print(f'== channel {PREFIX}/{runtime}/channel.json ({args.ring})')
    print('\n'.join(channel_summary(channel, nxt)))
    bucket.put_channel(runtime, nxt, etag)
    if not args.dry_run:
        end_to_end(runtime, nxt, args.ring, release, body, bundle)
    print('\nledger: ' + json.dumps({**nxt['history'][-1], 'runtime': runtime, 'dryRun': args.dry_run}))


if __name__ == '__main__':
    main()
