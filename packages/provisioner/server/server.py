#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["segno>=1.6", "zeroconf>=0.130"]
# ///
"""Hiraia provisioning server: runs on the operator's laptop while phones are provisioned.

A factory-reset phone scans the QR code this server shows, joins the Wi-Fi named in it,
downloads the Hiraia Setup DPC from here, becomes a fully managed device, and registers here
for its Hiraia ID (HI2609-201, HI2609-202, ...). The server hands out IDs from one SQLite
database, so twenty phones registering at once still get twenty different numbers, and a
phone provisioned twice keeps the number it was given first.

  HIRAIA_WIFI_PASSWORD=... uv run packages/provisioner/server/server.py --wifi-ssid 'Army House'

then open http://127.0.0.1:8080/qr on the laptop for the QR code and the dashboard. With
--hiraia-apk the phones also install Hiraia, and with a synced mirror they download its content
(the embedder, the vectors, the illustration packs) from the laptop rather than the internet:

  uv run packages/provisioner/server/server.py --sync-mirror      # once, and after Hiraia changes

Two listeners:
  http://LAN:8080   the DPC APK, for Android's setup to download. Setup cannot trust a
                    self-signed certificate, so the QR code carries the APK's SHA-256 instead.
                    Also the mirror, /mirror/models/..., which nothing trusts: Hiraia checks
                    every byte against the sizes and MD5s built into its APK.
                    The dashboard, QR code and CSV are served here to the laptop itself only.
  https://LAN:8443  the phones' API. Self-signed; the QR code carries the SHA-256 of its public
                    key, which is the server's identity. The address is only a hint: the server
                    also announces itself over mDNS, and a phone that cannot reach the address it
                    was given looks for any server holding that key. It also serves the Hiraia
                    APK, whose SHA-256 a phone learns from this same pinned API.

State lives in --data-dir (default ~/.hiraia/provisioning): the database, the TLS key, the
registration token, the receipt key and issued.log. Back it up and keep it between sessions:
phones trust that key and carry receipts signed with that receipt key. Beside the directory, not
in it, provisioning.issued.log mirrors every number handed out, so restoring the directory from an
older backup can never hand a new phone a number a returning phone already wears.
"""
from __future__ import annotations

import argparse
import base64
import concurrent.futures
import contextlib
import csv
import dataclasses
import datetime as dt
import getpass
import hashlib
import hmac
import html
import http.server
import io
import ipaddress
import json
import mmap
import os
from pathlib import Path
import re
import secrets
import shutil
import signal
import socket
import sqlite3
import ssl
import struct
import subprocess
import sys
import threading
import urllib.error
import urllib.request
import zipfile

REPO = Path(__file__).resolve().parents[3]
DEFAULT_DPC_APK = REPO / 'packages/provisioner/android/app/build/outputs/apk/release/app-release.apk'
DPC_PACKAGE = 'com.hiraia.provisioner'
DPC_COMPONENT = f'{DPC_PACKAGE}/{DPC_PACKAGE}.AdminReceiver'
MDNS_TYPE = '_hiraia-prov._tcp.local.'
EXTRA = 'android.app.extra.'
LOOPBACK = {'127.0.0.1', '::1'}
MAX_BODY = 256 * 1024
# What a phone may report about itself. REGISTERED is the server's own, set on registration.
# INSTALLING comes with how far the Hiraia install has got, e.g. "Downloading Hiraia 42%".
PHONE_STATUSES = {'COMPLETE', 'ERROR', 'INSTALLING'}
HIRAIA_ID = re.compile(r'[A-Z0-9]{2,12}-([0-9]{3,9})')
MAX_SEQ = 999_999_999  # the largest number HIRAIA_ID can carry
CSV_COLUMNS = [
    'hiraia_id', 'status', 'detail', 'device_name', 'manufacturer', 'brand', 'model', 'product',
    'android_version', 'sdk', 'build_number', 'fingerprint', 'ram_total_bytes', 'storage_total_bytes',
    'serial', 'imei_1', 'imei_2', 'wifi_mac', 'hiraia_apk_version', 'model_pack_version',
    'image_pack_version', 'dpc_version', 'dpc_version_code', 'registered_at', 'updated_at', 'last_seen',
    'has_labse', 'has_search_vectors', 'image_packs_received',
]


def now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')


def b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip('=')


def digest(secret: str) -> str:
    return hashlib.sha256(secret.encode()).hexdigest()


# --- The DPC APK ---------------------------------------------------------------------------

APK_SIG_BLOCK_MAGIC = b'APK Sig Block 42'
V2_BLOCK_ID = 0x7109871A
V3_BLOCK_ID = 0xF05368C0
V31_BLOCK_ID = 0x1B93AD61
# The signature schemes, in the order Android 13 goes by them. Where there is a v3.1 signature,
# Android takes the signer from it and never even checks the v3 one beneath it.
SIGNATURE_SCHEMES = (V31_BLOCK_ID, V3_BLOCK_ID, V2_BLOCK_ID)
VERSION_CODE_ATTRIBUTE = 0x0101021B
VERSION_NAME_ATTRIBUTE = 0x0101021C


def apk_signer_certificate(apk: bytes) -> bytes:
    """The DER certificate the APK is signed with, from its v3.1, v3 or v2 signature block.

    Used to refuse a debug-signed DPC and to show which key signed it. The QR code does not use
    it: after a key rotation Android checks the OLDEST certificate, so the QR carries the hash of
    the APK file instead.
    """
    return apk_signer_certificates(apk)[0]


def apk_signer_certificates(apk: bytes) -> list[bytes]:
    """The DER certificate each of the APK's v3.1, v3 and v2 signatures names, in that order.

    This reads what the APK claims and verifies no signature: Android does that when it installs
    it, and refuses an APK not really signed by the key its signature names.
    """
    eocd = apk.rfind(b'PK\x05\x06', max(0, len(apk) - 65_557))
    if eocd < 0:
        raise ValueError('not a zip file')
    (central_directory,) = struct.unpack_from('<I', apk, eocd + 16)
    if apk[central_directory - 16:central_directory] != APK_SIG_BLOCK_MAGIC:
        raise ValueError('no APK signature block: the APK is not signed with scheme v2 or later')
    # Layout: u64 size, then (u64 length, u32 id, value) pairs, then u64 size and the magic.
    # The size counts everything after its own first copy.
    (size,) = struct.unpack_from('<Q', apk, central_directory - 24)
    pairs, blocks, offset = apk[central_directory - size:central_directory - 24], {}, 0
    while offset < len(pairs):
        length, block_id = struct.unpack_from('<QI', pairs, offset)
        blocks[block_id] = pairs[offset + 12:offset + 8 + length]
        offset += 8 + length
    if not any(scheme in blocks for scheme in SIGNATURE_SCHEMES):
        raise ValueError('the APK signature block has no v2 or v3 signature')

    def field(data: bytes, at: int) -> tuple[bytes, int]:
        """One u32-length-prefixed field, and where the next one starts."""
        (length,) = struct.unpack_from('<I', data, at)
        end = at + 4 + length
        if end > len(data):
            raise ValueError('truncated APK signature block')
        return data[at + 4:end], end

    def sequence(data: bytes) -> list[bytes]:
        items, at = [], 0
        while at < len(data):
            item, at = field(data, at)
            items.append(item)
        return items

    def certificate(block: bytes) -> bytes:
        # v2, v3 and v3.1 alike: signers -> signer -> signed data -> (digests, certificates, ...).
        signers = sequence(field(block, 0)[0])
        if len(signers) != 1:
            raise ValueError(f'expected one signer, found {len(signers)}')
        signed_data = field(signers[0], 0)[0]
        _digests, at = field(signed_data, 0)
        return sequence(field(signed_data, at)[0])[0]

    return [certificate(blocks[scheme]) for scheme in SIGNATURE_SCHEMES if scheme in blocks]


def _string_pool(chunk: bytes) -> list[str]:
    _type, header_size, _size, count, _styles, flags, strings_start, _styles_start = \
        struct.unpack_from('<HHIIIIII', chunk, 0)
    strings = []
    for offset in struct.unpack_from(f'<{count}I', chunk, header_size):
        at = strings_start + offset
        if flags & 0x100:  # UTF-8: a character count, then a byte count, each one or two bytes
            at += 2 if chunk[at] & 0x80 else 1
            length = chunk[at]
            if length & 0x80:
                length, at = ((length & 0x7F) << 8) | chunk[at + 1], at + 2
            else:
                at += 1
            strings.append(chunk[at:at + length].decode('utf-8', 'replace'))
        else:  # UTF-16: a unit count, one or two u16s
            (length,) = struct.unpack_from('<H', chunk, at)
            at += 2
            if length & 0x8000:
                length, at = ((length & 0x7FFF) << 16) | struct.unpack_from('<H', chunk, at)[0], at + 2
            strings.append(chunk[at:at + 2 * length].decode('utf-16-le', 'replace'))
    return strings


@dataclasses.dataclass(frozen=True)
class Manifest:
    package: str | None
    version_code: int
    version_name: str | None


def apk_manifest(apk: bytes | io.IOBase) -> Manifest:
    """The package, android:versionCode and android:versionName of the <manifest> element, read
    from the APK's compiled AndroidManifest.xml. `apk` is the APK's bytes, or an open file for one
    too large to read whole."""
    with zipfile.ZipFile(apk if hasattr(apk, 'seek') else io.BytesIO(apk)) as archive:
        xml = archive.read('AndroidManifest.xml')
    kind, header_size, _ = struct.unpack_from('<HHI', xml, 0)
    if kind != 0x0003:
        raise ValueError('AndroidManifest.xml is not compiled binary XML')
    strings, resource_ids, at = [], [], header_size
    while at < len(xml):
        kind, header_size, size = struct.unpack_from('<HHI', xml, at)
        if kind == 0x0001:  # the string pool
            strings = _string_pool(xml[at:at + size])
        elif kind == 0x0180:  # resource ids for the first strings, the attribute names
            resource_ids = struct.unpack_from(f'<{(size - header_size) // 4}I', xml, at + header_size)
        elif kind == 0x0102:  # a start tag; <manifest> is the first
            _ns, name, attribute_start, attribute_size, count = struct.unpack_from('<IIHHH', xml, at + header_size)
            if strings[name] != 'manifest':
                raise ValueError('the first element is not <manifest>')
            found = {}
            for index in range(count):
                namespace, attribute, _raw, _size, _res0, data_type, data = struct.unpack_from(
                    '<IIIHBBI', xml, at + header_size + attribute_start + index * attribute_size)
                # android: attributes are known by their resource id; `package` has none, and no
                # namespace, and is known by its name as Android's own parser finds it.
                resource = resource_ids[attribute] if attribute < len(resource_ids) else 0
                if resource == VERSION_CODE_ATTRIBUTE or not resource and strings[attribute] == 'versionCode':
                    found.setdefault('versionCode', (data_type, data))
                elif resource == VERSION_NAME_ATTRIBUTE or not resource and strings[attribute] == 'versionName':
                    found.setdefault('versionName', (data_type, data))
                elif not resource and namespace == 0xFFFFFFFF and strings[attribute] == 'package':
                    found.setdefault('package', (data_type, data))
            if 'versionCode' not in found:
                raise ValueError('the manifest has no versionCode')
            if found['versionCode'][0] not in (0x10, 0x11):
                raise ValueError('versionCode is not an integer')
            # Literal strings only: a versionName that refers to a resource, say, reads as absent.
            text = {key: strings[data] for key, (data_type, data) in found.items()
                    if key != 'versionCode' and data_type == 0x03 and data < len(strings)}
            return Manifest(text.get('package'), found['versionCode'][1], text.get('versionName'))
        at += size
    raise ValueError('no <manifest> element')


def apk_version_code(apk: bytes) -> int:
    """android:versionCode, read from the APK's compiled AndroidManifest.xml."""
    return apk_manifest(apk).version_code


@dataclasses.dataclass(frozen=True)
class Dpc:
    """The DPC APK, read once at startup: what is served, hashed and offered as an update never
    changes under a running session, even if Gradle rebuilds or cleans the file meanwhile."""
    path: Path
    data: bytes
    sha256: str
    version_code: int
    signer_sha256: str

    @property
    def package_checksum(self) -> str:
        return b64url(bytes.fromhex(self.sha256))

    @classmethod
    def load(cls, path: Path) -> 'Dpc':
        data = path.read_bytes()
        certificate = apk_signer_certificate(data)
        if b'Android Debug' in certificate:
            raise ValueError(f'{path} is signed with the Android debug key. Setup will not install a '
                             'debug (testOnly) build; serve the release APK.')
        return cls(path, data, hashlib.sha256(data).hexdigest(), apk_version_code(data),
                   hashlib.sha256(certificate).hexdigest())


# --- Hiraia and its content mirror ---------------------------------------------------------
#
# The mirror is a delivery truck, not an authority. A phone checks every byte it takes from here
# against sizes and MD5s built into the Hiraia APK, and the Hiraia APK itself arrives over the
# pinned API with its SHA-256. Nothing below decides what a phone trusts; it only saves the school's
# internet from carrying the same gigabyte to every phone. The server still verifies what it holds,
# so that a truncated or stale file is never handed out to fail on twenty phones one by one.

HIRAIA_PACKAGE = 'com.hiraia.app'
# SHA-256 of the certificate Hiraia's release builds are signed with. Android installs any
# correctly signed APK on a fresh phone, so this is what keeps a debug build, Tala, or anything
# else signed by someone else from ever being offered as Hiraia.
HIRAIA_SIGNER = '40d750d5576cb59c311c7ba713403e065b934967d7a7d1bc80652e1167a20c35'
ASSET_ORIGIN = 'https://assets.hiraia.org/models'
MIRROR_ROUTE = '/mirror/models/'
# Hiraia's size-and-MD5 tables. The mirror serves exactly the files they list: a file a phone
# would refuse is of no use to it, and anything else has no business on the LAN listener.
MODEL_CONFIG = REPO / 'packages/mobile/src/config/modelAssets.json'
VOICE_CATALOG = REPO / 'packages/mobile/assets/voices/catalog.json'
BUNDLED_IMAGE_PACKS = REPO / 'packages/mobile/src/generated/imagePacks.generated.json'
ASSET_UPDATES = REPO / 'packages/web/src/config/asset-updates.json'
ASSET_FILENAME = re.compile(r'[a-zA-Z0-9][a-zA-Z0-9._-]{0,180}')  # the rule Hiraia applies to its asset names
CHUNK = 1024 * 1024


@dataclasses.dataclass(frozen=True)
class Asset:
    """A file Hiraia downloads after it is installed, as Hiraia itself knows it."""
    name: str  # its path under the mirror's models/: a filename, or images/<filename>
    size: int
    md5: str


def _asset(name: str, size: object, md5: object, where: Path, images: bool = False) -> Asset:
    if not (isinstance(name, str) and ASSET_FILENAME.fullmatch(name)):
        raise ValueError(f'{where}: {name!r} is not a plain asset filename')
    if type(size) is not int or size <= 0 or not (isinstance(md5, str) and re.fullmatch(r'[0-9a-f]{32}', md5)):
        raise ValueError(f'{where}: {name} has no usable size and MD5')
    return Asset(f'images/{name}' if images else name, size, md5)


def remote_assets(model_config: Path = MODEL_CONFIG) -> dict[str, Asset]:
    """Read the same JSON model pins imported by the app's active edition.

    No TypeScript scraping or second copy of the release's filenames and hashes. An
    unexpected model inventory fails closed instead of silently omitting downloads.
    """
    table = json.loads(model_config.read_text())
    if not isinstance(table, dict) or set(table) != {'base', 'vectors', 'embedder'}:
        raise ValueError(f'{model_config}: expected exactly base, vectors and embedder')
    return {key: _asset(row.get('filename'), row.get('bytes'), row.get('md5'), model_config)
            for key, row in table.items()}


def known_assets(with_llm: bool = True, model_config: Path = MODEL_CONFIG, bundled: Path = BUNDLED_IMAGE_PACKS,
                 updates: Path = ASSET_UPDATES, voices: Path = VOICE_CATALOG) -> list[Asset]:
    """Every file a phone may fetch from the mirror, with the size and MD5 Hiraia checks it against:
    the embedder and vectors, the bundled image packs, and the packs and model the web catalog
    offers as replacements, plus downloadable voices. The tutor model only with_llm,
    since only 6 GB+ phones run it."""
    remote = remote_assets(model_config)
    assets = [remote['embedder'], remote['vectors']] + ([remote['base']] if with_llm else [])
    catalog = json.loads(updates.read_text())
    if with_llm:
        for model in catalog.get('models') or []:
            if model.get('url') != f'{ASSET_ORIGIN}/{model.get("filename")}':
                raise ValueError(f'{updates}: model {model.get("filename")!r} is not at {ASSET_ORIGIN}/')
            assets.append(_asset(model['filename'], model.get('bytes'), model.get('md5'), updates))
    for path, packs in [(bundled, json.loads(bundled.read_text())['packs']), (updates, catalog['imagePacks'])]:
        assets += [_asset(pack.get('filename'), pack.get('bytes'), pack.get('md5'), path, images=True)
                   for pack in packs]
    voice_catalog = json.loads(voices.read_text())
    if voice_catalog.get('format') != 1 or not isinstance(voice_catalog.get('voices'), dict):
        raise ValueError(f'{voices}: unsupported voice catalog')
    for voice in voice_catalog['voices'].values():
        if voice.get('delivery') not in {'bundled', 'download'}:
            raise ValueError(f'{voices}: unknown voice delivery')
        entry = _asset(voice.get('filename'), voice.get('bytes'), voice.get('md5'), voices)
        if voice['delivery'] == 'download':
            assets.append(entry)
    unique: dict[str, Asset] = {}
    for asset in assets:
        if unique.setdefault(asset.name, asset) != asset:
            raise ValueError(f'{asset.name} is listed twice, with different sizes or MD5s')
    return list(unique.values())


def file_md5(file: io.IOBase) -> str:
    file.seek(0)
    return hashlib.file_digest(file, 'md5').hexdigest()


def _mib(size: int) -> str:
    return f'{size / 2**20:,.1f} MiB' if size < 2**30 else f'{size / 2**30:.2f} GiB'


def content_kind(name: str) -> str:
    """What a mirror file is to Hiraia: the LaBSE embedder, the search vectors, an image pack, or
    the tutor model (6 GB+ phones only)."""
    if name.startswith('images/'):
        return 'images'
    if name.startswith('labse'):
        return 'labse'
    if name.startswith('vectors-'):
        return 'vectors'
    if name.startswith('voice-'):
        return 'voice'
    return 'model'


CONTENT_LABELS = {'labse': 'LaBSE', 'vectors': 'the search vectors', 'model': 'the tutor model', 'images': 'images',
                  'voice': 'read-aloud voices'}


@dataclasses.dataclass(frozen=True)
class MirrorFile:
    asset: Asset
    file: io.BufferedReader  # held open from verification on: what is served is what was hashed


class Mirror:
    """The files in --mirror-dir that match Hiraia's tables, verified when the server starts.

    Each is kept open from the moment it was hashed, so a sync running meanwhile, which replaces
    files by renaming, cannot change what this session serves. Files it adds are served after a
    restart."""

    def __init__(self, root: Path, files: dict[str, MirrorFile], missing: list[Asset]):
        self.root, self.files, self.missing = root, files, missing

    @property
    def size(self) -> int:
        return sum(file.asset.size for file in self.files.values())

    @classmethod
    def load(cls, root: Path, known: list[Asset], required: list[Asset] | None = None, log=print) -> 'Mirror':
        """The files of `known` that are in the mirror and match; `required` (by default all of them)
        are the ones worth telling the operator about when they are not."""
        def verify(asset: Asset) -> MirrorFile | None:
            try:
                file = (root / 'models' / asset.name).open('rb')
            except FileNotFoundError:
                return None
            except OSError as problem:  # unreadable, or a folder where the file should be
                log(f'WARNING: cannot read the mirror\'s {asset.name} ({problem.strerror}), so it is not served.')
                return None
            if os.fstat(file.fileno()).st_size == asset.size and file_md5(file) == asset.md5:
                return MirrorFile(asset, file)
            file.close()
            log(f'WARNING: the mirror\'s {asset.name} does not match Hiraia\'s size and MD5 for it, so it is '
                'not served. --sync-mirror replaces it.')
            return None

        with concurrent.futures.ThreadPoolExecutor(4) as pool:  # hashlib hashes outside the GIL
            verified = dict(zip([asset.name for asset in known], pool.map(verify, known), strict=True))
        files = {name: file for name, file in verified.items() if file}
        return cls(root, files, [asset for asset in (known if required is None else required)
                                 if asset.name not in files])

    def close(self):
        for file in self.files.values():
            file.file.close()


class Unsatisfiable(Exception):
    """A Range that asks only for bytes past the end of the file."""


def _position(digits: str) -> int:
    """A byte position from a Range header. Python refuses to read a number thousands of digits
    long, and anyone on the LAN may send one; any number past every file's end means the same."""
    digits = digits.lstrip('0') or '0'
    return int(digits) if len(digits) <= 18 else 2**63


def byte_range(header: str | None, size: int) -> tuple[int, int] | None:
    """The first and last byte a Range header asks for, or None to send the whole file.

    One range of the forms `bytes=N-`, `bytes=A-B` and `bytes=-N`. Anything else is ignored, as
    HTTP allows, and the whole file is sent: Hiraia's downloader sees that and starts again rather
    than splice a whole body onto its partial file.
    """
    match = re.fullmatch(r'bytes=(\d*)-(\d*)', (header or '').strip())
    if not match or match[1] == match[2] == '':
        return None
    if match[1] == '':  # the last N bytes
        suffix = _position(match[2])
        if suffix == 0 or size == 0:
            raise Unsatisfiable
        return max(0, size - suffix), size - 1
    first, last = _position(match[1]), _position(match[2]) if match[2] else None
    if last is not None and last < first:
        return None
    if first >= size:
        raise Unsatisfiable
    return first, size - 1 if last is None else min(last, size - 1)


@dataclasses.dataclass(frozen=True)
class HiraiaApk:
    """The Hiraia APK on offer to phones, snapshotted into the mirror directory under its SHA-256
    when the server starts: a rebuild of the original mid-session changes nothing that is offered,
    and the offer's hash always describes the bytes served."""
    path: Path
    file: io.BufferedReader  # the snapshot, held open: every check below read these exact bytes
    sha256: str
    size: int
    version_code: int
    version_name: str

    @property
    def offer(self) -> dict:
        return {'package': HIRAIA_PACKAGE, 'version_code': self.version_code, 'version_name': self.version_name,
                'sha256': self.sha256, 'size': self.size}

    @classmethod
    def snapshot(cls, source: Path, mirror_root: Path, signer: str = HIRAIA_SIGNER) -> 'HiraiaApk':
        """Copies the APK in, then checks the copy: its signer, its package and its version."""
        folder = mirror_root / 'apk'
        folder.mkdir(parents=True, exist_ok=True)
        incoming = folder / f'.incoming-{os.getpid()}.part'
        try:
            shutil.copyfile(source, incoming)
            file = incoming.open('rb')
        except BaseException:
            incoming.unlink(missing_ok=True)
            raise
        try:
            # Every signature it carries must name Hiraia's key, not just the one this reads first:
            # Android 13 goes by a v3.1 signature where there is one, whatever the v3 one says.
            with mmap.mmap(file.fileno(), 0, access=mmap.ACCESS_READ) as apk:
                certificates = {hashlib.sha256(found).hexdigest() for found in apk_signer_certificates(apk)}
            manifest = apk_manifest(file)
            if certificates != {signer}:
                raise ValueError(f'{source} is not signed with Hiraia\'s release key (its certificate SHA-256 is '
                                 f'{" and ".join(sorted(certificates))}). Gradle\'s app-release.apk is debug-signed; '
                                 'offer the hiraia-v*.apk that packages/mobile/scripts/sign-apk.sh makes from it.')
            if manifest.package != HIRAIA_PACKAGE:
                raise ValueError(f'{source} is {manifest.package or "an APK without a package name"}, not '
                                 f'{HIRAIA_PACKAGE}')
            if not manifest.version_name:
                raise ValueError(f'{source} has no versionName')
            file.seek(0)
            sha256 = hashlib.file_digest(file, 'sha256').hexdigest()
            path = folder / f'{sha256}.apk'
            os.replace(incoming, path)  # the open file moves with it: what was checked is what is served
        except BaseException:
            file.close()
            incoming.unlink(missing_ok=True)
            raise
        for older in folder.glob('*.apk'):  # a snapshot is only a copy of a build output
            if older != path:
                older.unlink()
        return cls(path, file, sha256, os.fstat(file.fileno()).st_size, manifest.version_code, manifest.version_name)

    def close(self):
        self.file.close()


# --- Syncing the mirror --------------------------------------------------------------------

def sync_mirror(root: Path, assets: list[Asset], origin: str = ASSET_ORIGIN, workers: int = 4, log=print,
                interval: float = 10, retry_wait: float = 2) -> bool:
    """Fetches every listed file the mirror does not already hold, verified. True if all of them
    are there afterwards.

    A download resumes from its .part file with a Range request, is checked against Hiraia's size
    and MD5, and only then renamed into place, so an interrupted or corrupt download is never
    served. Files already in place are hashed, not fetched. It can be run again at any time.
    """
    models = root / 'models'
    (models / 'images').mkdir(parents=True, exist_ok=True)
    lock, finished, stopping = threading.Lock(), threading.Event(), threading.Event()
    progress = {'verified': 0, 'downloaded': 0}

    class Stopped(Exception):
        pass

    def fetch(asset: Asset, part: Path) -> int:
        """One transfer into `part`, resuming from what it holds. Returns the offset it resumed
        from, 0 for a whole body. Raises OSError for anything short of every byte arriving."""
        offset = part.stat().st_size if part.exists() else 0
        if offset > asset.size:
            part.unlink()
            offset = 0
        if offset == asset.size:
            return offset
        request = urllib.request.Request(f'{origin}/{asset.name}', headers={
            'User-Agent': 'HiraiaProvisioning/1', **({'Range': f'bytes={offset}-'} if offset else {})})
        try:
            response = urllib.request.urlopen(request, timeout=60)
        except urllib.error.HTTPError as error:
            error.close()
            if error.code == 416:  # the origin's file ends before the partial does: not a prefix of it
                part.unlink(missing_ok=True)
            raise
        with response:
            # Only bytes the origin says are Hiraia's file, by its size, are written: a Wi-Fi login
            # page answering 200 never lands in the partial to be resumed onto.
            declared = response.headers.get('Content-Length')
            resumed = re.fullmatch(r'bytes (\d+)-\d+/(\d+)', response.headers.get('Content-Range') or '')
            if response.status == 206 and resumed and (int(resumed[1]), int(resumed[2])) == (offset, asset.size):
                mode = 'ab'
            elif response.status == 200 and declared in (None, str(asset.size)):
                mode, offset = 'wb', 0  # a whole body: start the file again, never splice it on
            else:
                raise OSError(f'answered {response.status} with {declared} bytes '
                              f'{response.headers.get("Content-Range") or ""} for a file of {asset.size}')
            written = offset
            with part.open(mode) as out:
                while chunk := response.read(CHUNK):
                    if stopping.is_set():
                        raise Stopped
                    written += len(chunk)
                    if written > asset.size:
                        raise OSError(f'sent more than the {asset.size} bytes Hiraia expects')
                    out.write(chunk)
                    with lock:
                        progress['downloaded'] += len(chunk)
        if written != asset.size:
            raise OSError(f'ended early at {written} of {asset.size} bytes')
        return offset

    def sync(asset: Asset) -> bool:
        final = models / asset.name
        part = final.with_name(final.name + '.part')
        if final.exists():
            with final.open('rb') as file:
                if os.fstat(file.fileno()).st_size == asset.size and file_md5(file) == asset.md5:
                    with lock:
                        progress['verified'] += 1
                    return True
            log(f'  {asset.name} does not match its size and MD5; fetching it again')
            final.unlink()
        failure = ''
        for attempt in range(3):
            if attempt and stopping.wait(retry_wait * attempt):
                return False
            try:
                resumed = fetch(asset, part)
            except OSError as error:  # urllib's HTTP errors, timeouts and resets are all OSErrors
                failure = str(error)
                continue
            except Stopped:
                return False
            with part.open('rb') as file:
                if file_md5(file) == asset.md5:
                    os.replace(part, final)
                    with lock:
                        progress['verified'] += 1
                    log(f'  ok      {asset.name} ({_mib(asset.size)})')
                    return True
            # Every byte arrived and they are the wrong ones. Never resume onto that. If the suspect
            # bytes were an older partial, one fresh download may cure it; if they all came in one
            # piece, the origin serves something else, and asking again would get the same.
            part.unlink()
            failure = 'the downloaded bytes do not match Hiraia\'s MD5 for it'
            if not resumed:
                break
        log(f'  FAILED  {asset.name}: {failure}')
        return False

    def report():
        while not finished.wait(interval):
            with lock:
                log(f'  {progress["verified"]} of {len(assets)} files in place, {_mib(progress["downloaded"])} '
                    'downloaded so far')

    total = sum(asset.size for asset in assets)
    wanted = sum(asset.size for asset in assets if not (models / asset.name).exists())
    free = shutil.disk_usage(models).free
    if wanted > free:
        log(f'The mirror needs up to {_mib(wanted)} more, and {models} has {_mib(free)} free.')
        return False
    log(f'Syncing {len(assets)} files ({_mib(total)}) from {origin} into {models}')
    threading.Thread(target=report, daemon=True).start()
    pool = concurrent.futures.ThreadPoolExecutor(workers)
    try:
        # Largest first, so the longest download is not the one left running alone at the end.
        results = list(pool.map(sync, sorted(assets, key=lambda asset: -asset.size)))
    except KeyboardInterrupt:
        stopping.set()
        log('Stopped. The partial downloads are kept, and the next --sync-mirror resumes them.')
        raise
    finally:
        finished.set()
        pool.shutdown(cancel_futures=True)
    log(f'The mirror holds {sum(results)} of {len(assets)} files, verified.' + ('' if all(results) else
        ' Run --sync-mirror again for the rest; it resumes where it stopped.'))
    return all(results)


# --- TLS and the registration token --------------------------------------------------------

def _der(data: bytes, at: int) -> tuple[int, int, int]:
    """(tag, value start, value end) of the DER element at `at`."""
    tag, length = data[at], data[at + 1]
    at += 2
    if length & 0x80:
        count = length & 0x7F
        length, at = int.from_bytes(data[at:at + count], 'big'), at + count
    return tag, at, at + length


def subject_public_key_info(certificate: bytes) -> bytes:
    """The certificate's SubjectPublicKeyInfo, the DER a phone hashes to check the pin."""
    _, start, _ = _der(certificate, 0)            # Certificate
    _, at, end = _der(certificate, start)         # tbsCertificate
    fields = []
    while at < end:
        tag, _, next_at = _der(certificate, at)
        fields.append((tag, at, next_at))
        at = next_at
    if fields[0][0] == 0xA0:                      # the optional [0] version
        fields = fields[1:]
    tag, start, end = fields[5]                   # serial, signature, issuer, validity, subject, SPKI
    if tag != 0x30:
        raise ValueError('certificate has no SubjectPublicKeyInfo where expected')
    return certificate[start:end]


def ensure_tls(data_dir: Path) -> tuple[Path, Path, str]:
    """The API's certificate and key, made once, and the pin phones hold: SHA-256 of the public key.

    Pinning the key rather than the certificate means an expired or lost certificate can be
    re-issued from the backed-up key without stranding a single phone.
    """
    cert, key = data_dir / 'tls-cert.pem', data_dir / 'tls-key.pem'
    if not key.exists():
        subprocess.run(['openssl', 'genrsa', '-out', str(key), '2048'], check=True, capture_output=True)
        key.chmod(0o600)
        cert.unlink(missing_ok=True)
    if not cert.exists():
        subprocess.run(['openssl', 'req', '-x509', '-new', '-key', str(key), '-days', '7300',
                        '-subj', '/CN=Hiraia provisioning server', '-out', str(cert)],
                       check=True, capture_output=True)
    der = ssl.PEM_cert_to_DER_cert(cert.read_text())
    return cert, key, b64url(hashlib.sha256(subject_public_key_info(der)).digest())


def ensure_secret(path: Path, rotate: bool = False) -> str:
    """A random secret kept in the data dir: the QR code's registration token, which only lets a
    phone register (each phone then gets its own secret), or the key that signs ID receipts."""
    if rotate or not path.exists():
        path.write_text(secrets.token_urlsafe(32))
        path.chmod(0o600)
    value = path.read_text().strip()
    if not value:
        raise ValueError(f'{path} is empty. Restore it from your backup of that directory.')
    return value


# The server's identity. Phones pin the TLS key, hold the token from their QR code, and carry
# receipts signed with the receipt key, so once any phone is registered none of them may be
# replaced without the operator saying so.
IDENTITY_FILES = ('tls-key.pem', 'token', 'receipt-key')


# --- The device registry -------------------------------------------------------------------

class Conflict(Exception):
    """A registration the server will not merge on its own; the operator has to look."""

    def __init__(self, message: str, hiraia_id: str | None = None):
        super().__init__(message)
        self.hiraia_id = hiraia_id


@dataclasses.dataclass(frozen=True)
class Registration:
    hiraia_id: str
    secret: str
    receipt: str
    note: str  # something the operator should know about this registration, or ''


class Registry:
    """Every phone this server has provisioned. SQLite is the record; the CSV is an export.

    Every number handed out is also appended to issued.log beside the database, and to a mirror
    outside the data directory. Restore the database, or the whole directory, from an older
    backup, and the mirror still knows the highest number in use: a new phone is never given a
    number a returning phone already wears, and returning phones reclaim theirs with receipts.
    """

    def __init__(self, path: Path, prefix: str, first: int, receipt_key: str, mirror: Path | None = None):
        self.path, self.prefix, self.first = path, prefix, first
        self.logs = [path.with_name('issued.log')] + ([mirror] if mirror else [])
        self.receipt_key = receipt_key.encode()
        with self._transaction() as db:
            db.execute("""CREATE TABLE IF NOT EXISTS devices (
                seq INTEGER PRIMARY KEY,
                hiraia_id TEXT NOT NULL UNIQUE,
                device_key TEXT NOT NULL UNIQUE,
                secret_sha256 TEXT NOT NULL,
                status TEXT NOT NULL,
                detail TEXT NOT NULL DEFAULT '',
                inventory TEXT NOT NULL,
                dpc_version_code INTEGER,
                dpc_version_name TEXT,
                registered_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                last_seen TEXT NOT NULL)""")
            db.execute("""CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY,
                hiraia_id TEXT NOT NULL,
                at TEXT NOT NULL,
                status TEXT NOT NULL,
                detail TEXT NOT NULL DEFAULT '')""")
            # The address each phone last called the API from (added after the first phones were
            # registered, so older databases gain the column here).
            if 'address' not in [row[1] for row in db.execute('PRAGMA table_info(devices)')]:
                db.execute('ALTER TABLE devices ADD COLUMN address TEXT')
            # Which of Hiraia's content files each phone has pulled from the mirror in full.
            db.execute("""CREATE TABLE IF NOT EXISTS content (
                hiraia_id TEXT NOT NULL,
                name TEXT NOT NULL,
                at TEXT NOT NULL,
                PRIMARY KEY (hiraia_id, name))""")

    @contextlib.contextmanager
    def _transaction(self):
        # BEGIN IMMEDIATE takes the write lock up front, so two registrations cannot both read
        # the same highest number and hand it out twice.
        db = sqlite3.connect(self.path, timeout=30, isolation_level=None)
        try:
            db.execute('BEGIN IMMEDIATE')
            try:
                yield db
            except BaseException:
                db.execute('ROLLBACK')
                raise
            db.execute('COMMIT')
        finally:
            db.close()

    def receipt(self, device_key: str, hiraia_id: str) -> str:
        """Proof, kept by the phone, that this server gave that phone that ID."""
        return b64url(hmac.new(self.receipt_key, f'{device_key}|{hiraia_id}'.encode(), hashlib.sha256).digest())

    def proven(self, inventory: dict) -> bool:
        claimed = inventory.get('hiraia_id')
        return bool(claimed) and hmac.compare_digest(str(inventory.get('id_receipt') or ''),
                                                     self.receipt(inventory['device_key'], claimed))

    def may_register_by_receipt(self, inventory: dict) -> bool:
        """A phone that lost its secret may register again with its receipt instead of the token,
        which matters once the token has been replaced: the phone only knows the one in its QR
        code. The receipt must be for this phone's own row, or for a row the database lost."""
        if not self.proven(inventory):
            return False
        db = sqlite3.connect(self.path, timeout=30)
        try:
            row = db.execute('SELECT hiraia_id FROM devices WHERE device_key = ?', (inventory['device_key'],)).fetchone()
        finally:
            db.close()
        return row is None or row[0] == inventory['hiraia_id']

    def highest_issued(self) -> int:
        """The highest number any of the logs has handed out."""
        top = 0
        for log in self.logs:
            if log.exists():
                for line in log.read_text().splitlines():
                    number = line.split('\t', 1)[0]
                    if number.isdigit():
                        top = max(top, int(number))
        return top

    def _log_issue(self, seq: int, hiraia_id: str, key: str, at: str):
        for path in self.logs:
            with path.open('a') as log:
                log.write(f'{seq}\t{hiraia_id}\t{key}\t{at}\n')
                log.flush()
                os.fsync(log.fileno())

    def register(self, inventory: dict) -> Registration:
        """The phone's Hiraia ID, a fresh secret for it, and the ID's receipt.

        A phone the server knows keeps its ID. A phone the server does not know, but which holds an
        ID with a receipt from this server (the database was restored from an older copy, say),
        gets that ID back, so two phones never end up wearing the same number. A claim without a
        valid receipt is ignored.
        """
        key, claimed, at = inventory['device_key'], inventory.get('hiraia_id'), now()
        proven = self.proven(inventory)
        secret = secrets.token_urlsafe(24)
        version_code, version_name = inventory.get('dpc_version_code'), inventory.get('dpc_version')
        with self._transaction() as db:
            row = db.execute('SELECT hiraia_id, inventory FROM devices WHERE device_key = ?', (key,)).fetchone()
            note = ''
            if row:
                hiraia_id = row[0]
                # IMEIs are evidence of which physical phone this is, and they only accumulate: a
                # registration that could not read them, or a forged one without them, never erases
                # them. Two phones with the same serial but different IMEIs are not merged.
                before, after = set(json.loads(row[1]).get('imei') or []), set(inventory.get('imei') or [])
                if before and after and not before & after:
                    raise Conflict(f'{key} is already {hiraia_id}, a phone with IMEIs {", ".join(sorted(before))}; '
                                   f'this one has {", ".join(sorted(after))}', hiraia_id)
                inventory = {**inventory, 'imei': sorted(before | after)}
                if claimed and claimed != hiraia_id:
                    note = f'phone showed {claimed}; its registered ID is {hiraia_id}'
                db.execute("UPDATE devices SET status = 'REGISTERED', detail = ?, inventory = ?, secret_sha256 = ?, "
                           'dpc_version_code = ?, dpc_version_name = ?, updated_at = ?, last_seen = ? '
                           'WHERE hiraia_id = ?',
                           (note, json.dumps(inventory, sort_keys=True), digest(secret), version_code, version_name,
                            at, at, hiraia_id))
            else:
                seq = int(HIRAIA_ID.fullmatch(claimed)[1]) if proven else None
                holder = proven and db.execute('SELECT device_key FROM devices WHERE hiraia_id = ? OR seq = ?',
                                               (claimed, seq)).fetchone()
                if proven and not holder:
                    hiraia_id = claimed
                    self._log_issue(seq, hiraia_id, key, at)  # the logs may not know it (an older disk)
                else:
                    (top,) = db.execute('SELECT MAX(seq) FROM devices').fetchone()
                    seq = max(self.first, (top or 0) + 1, self.highest_issued() + 1)
                    if seq > MAX_SEQ:
                        raise Conflict(f'no Hiraia ID numbers left above {MAX_SEQ}')
                    hiraia_id = f'{self.prefix}-{seq:03d}'
                    if proven:
                        # Two phones wearing one number: only possible if numbers were reissued
                        # after a restore without the issued.log mirror. Say it loudly.
                        note = (f'DUPLICATE ID: this phone proves it was given {claimed}, which {holder[0]} now '
                                f'holds; it is now {hiraia_id}. Relabel it.')
                    elif claimed:
                        note = f'phone showed {claimed} without proof it was issued here; given {hiraia_id}'
                    self._log_issue(seq, hiraia_id, key, at)
                db.execute('INSERT INTO devices (seq, hiraia_id, device_key, secret_sha256, status, detail, inventory, '
                           'dpc_version_code, dpc_version_name, registered_at, updated_at, last_seen) '
                           "VALUES (?, ?, ?, ?, 'REGISTERED', ?, ?, ?, ?, ?, ?, ?)",
                           (seq, hiraia_id, key, digest(secret), note, json.dumps(inventory, sort_keys=True),
                            version_code, version_name, at, at, at))
            db.execute("INSERT INTO events (hiraia_id, at, status, detail) VALUES (?, ?, 'REGISTERED', ?)",
                       (hiraia_id, at, note))
        return Registration(hiraia_id, secret, self.receipt(key, hiraia_id), note)

    def flag(self, hiraia_id: str, detail: str):
        """Puts something on a phone's dashboard row for the operator, without changing its status."""
        at = now()
        with self._transaction() as db:
            db.execute('UPDATE devices SET detail = ?, updated_at = ? WHERE hiraia_id = ?', (detail[:500], at, hiraia_id))
            db.execute("INSERT INTO events (hiraia_id, at, status, detail) VALUES (?, ?, 'CONFLICT', ?)",
                       (hiraia_id, at, detail[:500]))

    def authenticate(self, hiraia_id: str, secret: str) -> bool:
        db = sqlite3.connect(self.path, timeout=30)
        try:
            row = db.execute('SELECT secret_sha256 FROM devices WHERE hiraia_id = ?', (hiraia_id,)).fetchone()
        finally:
            db.close()
        return bool(row) and hmac.compare_digest(row[0], digest(secret))

    def report(self, hiraia_id: str, status: str, detail: str):
        at = now()
        with self._transaction() as db:
            db.execute('UPDATE devices SET status = ?, detail = ?, updated_at = ?, last_seen = ? WHERE hiraia_id = ?',
                       (status, detail, at, at, hiraia_id))
            db.execute('INSERT INTO events (hiraia_id, at, status, detail) VALUES (?, ?, ?, ?)',
                       (hiraia_id, at, status, detail))

    def seen(self, hiraia_id: str, status: str, version_code: int, version_name: str | None):
        """A check-in. The phone's own status wins: a phone that had to register again (and so
        shows REGISTERED here) but is set up says COMPLETE, and the record heals."""
        at = now()
        with self._transaction() as db:
            (current,) = db.execute('SELECT status FROM devices WHERE hiraia_id = ?', (hiraia_id,)).fetchone()
            db.execute('UPDATE devices SET last_seen = ?, dpc_version_code = ?, '
                       'dpc_version_name = COALESCE(?, dpc_version_name) WHERE hiraia_id = ?',
                       (at, version_code, version_name, hiraia_id))
            if status != current:
                db.execute('UPDATE devices SET status = ?, updated_at = ? WHERE hiraia_id = ?', (status, at, hiraia_id))
                db.execute('INSERT INTO events (hiraia_id, at, status, detail) VALUES (?, ?, ?, ?)',
                           (hiraia_id, at, status, 'from check-in'))

    def seen_at(self, hiraia_id: str, address: str):
        with self._transaction() as db:
            db.execute('UPDATE devices SET address = ? WHERE hiraia_id = ? AND address IS NOT ?',
                       (address, hiraia_id, address))

    def phone_at(self, address: str) -> str | None:
        """The phone that last called the API from this address, if any."""
        db = sqlite3.connect(self.path, timeout=30)
        try:
            row = db.execute('SELECT hiraia_id FROM devices WHERE address = ? ORDER BY last_seen DESC LIMIT 1',
                             (address,)).fetchone()
        finally:
            db.close()
        return row[0] if row else None

    def record_content(self, hiraia_id: str, name: str) -> bool:
        """Notes that a phone pulled a content file in full; True the first time for that file."""
        with self._transaction() as db:
            return db.execute('INSERT OR IGNORE INTO content (hiraia_id, name, at) VALUES (?, ?, ?)',
                              (hiraia_id, name, now())).rowcount == 1

    def devices(self) -> list[dict]:
        db = sqlite3.connect(self.path, timeout=30)
        try:
            rows = db.execute('SELECT hiraia_id, status, detail, inventory, dpc_version_code, dpc_version_name, '
                              'registered_at, updated_at, last_seen FROM devices ORDER BY seq').fetchall()
            received: dict[str, list[str]] = {}
            for hiraia_id, name in db.execute('SELECT hiraia_id, name FROM content ORDER BY at'):
                received.setdefault(hiraia_id, []).append(name)
        finally:
            db.close()
        return [{'hiraia_id': r[0], 'status': r[1], 'detail': r[2], 'inventory': json.loads(r[3]),
                 'dpc_version_code': r[4], 'dpc_version': r[5], 'registered_at': r[6], 'updated_at': r[7],
                 'last_seen': r[8], 'content': received.get(r[0], [])} for r in rows]

    def count(self) -> int:
        db = sqlite3.connect(self.path, timeout=30)
        try:
            return db.execute('SELECT COUNT(*) FROM devices').fetchone()[0]
        finally:
            db.close()

    def unfinished(self) -> int:
        return sum(device['status'] != 'COMPLETE' for device in self.devices())

    def csv(self) -> str:
        out = io.StringIO()
        writer = csv.DictWriter(out, CSV_COLUMNS, extrasaction='ignore')
        writer.writeheader()
        for device in self.devices():
            inventory = device['inventory']
            imei = inventory.get('imei') or []
            kinds = [content_kind(name) for name in device['content']]
            row = {**inventory, **{k: v for k, v in device.items() if k not in ('inventory', 'content') and v is not None},
                   'imei_1': imei[0] if len(imei) > 0 else '', 'imei_2': imei[1] if len(imei) > 1 else '',
                   'has_labse': 'yes' if 'labse' in kinds else 'no',
                   'has_search_vectors': 'yes' if 'vectors' in kinds else 'no',
                   'image_packs_received': kinds.count('images')}
            writer.writerow({column: spreadsheet_safe(row.get(column)) for column in CSV_COLUMNS})
        return out.getvalue()


def spreadsheet_safe(value: object) -> object:
    """A cell a spreadsheet will show as text, never evaluate as a formula."""
    if isinstance(value, str) and value[:1] in ('=', '+', '-', '@', '\t', '\r'):
        return "'" + value
    return '' if value is None else value


INVENTORY_INTS = {'sdk', 'ram_total_bytes', 'ram_available_bytes', 'ram_threshold_bytes', 'storage_total_bytes',
                  'storage_free_bytes', 'dpc_version_code'}
INVENTORY_BOOLS = {'device_owner', 'low_ram_device'}


def validate_inventory(body: object) -> dict:
    """What a phone may register with: short strings, bounded integers, and up to four IMEIs."""
    if not isinstance(body, dict):
        raise ValueError('expected a JSON object')
    key = body.get('device_key')
    if not isinstance(key, str) or not re.fullmatch(r'(serial|enrollment):[\w.:-]{1,128}', key, re.ASCII):
        raise ValueError('device_key must be serial:<serial> or enrollment:<uuid>')
    claimed = body.get('hiraia_id')
    if claimed is not None and not (isinstance(claimed, str) and HIRAIA_ID.fullmatch(claimed)):
        raise ValueError('hiraia_id must look like HI2609-201')
    receipt = body.get('id_receipt')
    if receipt is not None and not (isinstance(receipt, str) and re.fullmatch(r'[A-Za-z0-9_-]{43}', receipt)):
        raise ValueError('id_receipt must be the receipt this server issued')
    for name, value in body.items():
        if name in INVENTORY_INTS:
            ok = type(value) is int and 0 <= value < 2**63
        elif name in INVENTORY_BOOLS:
            ok = type(value) is bool
        elif name == 'imei':
            ok = isinstance(value, list) and len(value) <= 4 and all(
                isinstance(i, str) and re.fullmatch(r'[0-9A-Fa-f]{8,20}', i) for i in value)
        else:
            ok = value is None or (isinstance(value, str) and len(value) <= 256)
        if not ok or len(name) > 64:
            raise ValueError(f'unexpected value for {name[:64]!r}')
    return body


# --- The QR code ---------------------------------------------------------------------------

@dataclasses.dataclass(frozen=True)
class Config:
    host: str
    http_port: int
    https_port: int
    wifi_ssid: str | None
    wifi_password: str | None
    wifi_security: str
    time_zone: str
    offline: bool


def provisioning_payload(config: Config, dpc: Dpc, pin: str, token: str) -> dict:
    """What the QR code tells Android's setup: who manages the phone, and where to find it."""
    payload = {
        EXTRA + 'PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME': DPC_COMPONENT,
        EXTRA + 'PROVISIONING_DEVICE_ADMIN_PACKAGE_DOWNLOAD_LOCATION':
            f'http://{config.host}:{config.http_port}/provisioner.apk',
        # The hash of the exact bytes served. Setup checks it in preference to a signature
        # checksum, which after a key rotation would have to name the oldest certificate.
        EXTRA + 'PROVISIONING_DEVICE_ADMIN_PACKAGE_CHECKSUM': dpc.package_checksum,
        EXTRA + 'PROVISIONING_TIME_ZONE': config.time_zone,
        # Setup would otherwise disable system apps by its own list. What stays on the phone is
        # decided by the DPC's explicit package policy instead.
        EXTRA + 'PROVISIONING_LEAVE_ALL_SYSTEM_APPS_ENABLED': True,
        # PROVISIONING_SKIP_EDUCATION_SCREENS is deliberately absent: setup ignores it from a QR
        # code. The DPC asks for it in its GET_PROVISIONING_MODE reply instead.
        EXTRA + 'PROVISIONING_ADMIN_EXTRAS_BUNDLE': {
            'server': f'https://{config.host}:{config.https_port}',
            'pin': pin,
            'token': token,
        },
    }
    if config.wifi_ssid:
        payload[EXTRA + 'PROVISIONING_WIFI_SSID'] = config.wifi_ssid
        payload[EXTRA + 'PROVISIONING_WIFI_SECURITY_TYPE'] = config.wifi_security
        if config.wifi_security != 'NONE':
            payload[EXTRA + 'PROVISIONING_WIFI_PASSWORD'] = config.wifi_password
    if config.offline:
        # Android 13 otherwise wants the internet during setup; this is for a closed network.
        payload[EXTRA + 'PROVISIONING_ALLOW_OFFLINE'] = True
    return payload


def qr_svg(payload: dict) -> str:
    import segno
    out = io.BytesIO()
    segno.make(json.dumps(payload, separators=(',', ':')), error='l').save(out, kind='svg', scale=5, border=4)
    return out.getvalue().decode()


# --- HTTP ----------------------------------------------------------------------------------

class App:
    def __init__(self, registry: Registry, dpc: Dpc, config: Config, tls: tuple[Path, Path, str], token: str,
                 hiraia: HiraiaApk | None = None, mirror: Mirror | None = None, max_apk_downloads: int = 8,
                 min_dpc_version_for_hiraia: int | None = None):
        if min_dpc_version_for_hiraia is not None and (type(min_dpc_version_for_hiraia) is not int
                or not 1 <= min_dpc_version_for_hiraia <= dpc.version_code):
            raise ValueError('minimum DPC version must be positive and no newer than the offered DPC')
        self.registry, self.dpc, self.config, self.token = registry, dpc, config, token
        self.hiraia, self.mirror = hiraia, mirror
        self.min_dpc_version_for_hiraia = min_dpc_version_for_hiraia
        self.certificate, self.key, self.pin = tls
        self.payload = provisioning_payload(config, dpc, self.pin, token)
        self.lock = threading.Lock()
        self.moved_from: str | None = None  # the address the laptop had before it moved mid-session
        self.handshake_failures: set[str] = set()
        self.announce = lambda host: None  # replaced by main() with the mDNS announcement
        # Twenty phones pulling a 400 MB APK at once over one Wi-Fi each get a trickle and time out;
        # a few at a time finish, and the rest are told to come back.
        self.apk_downloads = threading.BoundedSemaphore(max_apk_downloads)
        self.said: set[tuple] = set()      # downloads already logged, per client and file
        # Hiraia fetches its content anonymously over plain HTTP; the phone's DPC talks to the API
        # from the same address, which is how a finished download is put against the right phone.
        # Kept in the database too, so a restarted server still knows phones set up before it.
        self.phones_by_address: dict[str, str] = {}
        self.steps: dict[str, str] = {}    # the last install step each phone reported

    def mirror_url(self) -> str | None:
        """Where phones get Hiraia's content, at the laptop's current address; None with nothing to serve."""
        if not self.mirror or not self.mirror.files:
            return None
        return f'http://{self.config.host}:{self.config.http_port}{MIRROR_ROUTE.rstrip("/")}'

    def offers(self, dpc_version: int | None = None) -> dict:
        """Let old Setup builds receive their own update before a large Hiraia download."""
        ready = self.min_dpc_version_for_hiraia is None or (type(dpc_version) is int
                and dpc_version >= self.min_dpc_version_for_hiraia)
        return {'hiraia': self.hiraia.offer if self.hiraia and ready else None, 'mirror': self.mirror_url()}

    def seen_at(self, address: str, hiraia_id: str):
        if self.phones_by_address.get(address) != hiraia_id:
            self.phones_by_address[address] = hiraia_id
            self.registry.seen_at(hiraia_id, address)

    def content_received(self, address: str, name: str):
        """A phone finished downloading one of Hiraia's content files from the mirror."""
        hiraia_id = self.phones_by_address.get(address) or self.registry.phone_at(address)
        if hiraia_id is None:
            return  # a device the API has not seen; nothing to put it against
        if self.registry.record_content(hiraia_id, name) and content_kind(name) != 'images':
            self.log(f'{hiraia_id}  has {CONTENT_LABELS[content_kind(name)]} ({name})')

    def first_time(self, *key) -> bool:
        with self.lock:
            if key in self.said:
                return False
            self.said.add(key)
            return True

    def log(self, message: str):
        # Phone-supplied text reaches this line; no control character may reach the terminal.
        safe = re.sub(r'[\x00-\x1f\x7f-\x9f]', lambda m: f'\\x{ord(m.group()):02x}', message)
        with self.lock:
            print(f'{dt.datetime.now():%H:%M:%S}  {safe}', flush=True)

    def move(self, host: str):
        """The laptop's address changed mid-session: point the QR code and the mDNS announcement at
        the new one. The listeners are bound to every interface, so they need nothing."""
        old = self.config.host
        self.config = dataclasses.replace(self.config, host=host)
        self.payload = provisioning_payload(self.config, self.dpc, self.pin, self.token)
        self.moved_from = old
        try:
            self.announce(host)
        except Exception as failure:  # noqa: BLE001 - the watcher must live on to try again
            self.log(f'WARNING: could not announce the new address over mDNS ({failure}).')
        self.log(f'This laptop moved from {old} to {host}. The QR page shows a new code within 15 seconds, and '
                 'the mDNS announcement uses the new address, so phones already scanned find it. A phone that was '
                 'still downloading Hiraia Setup from the old code has to be scanned again.')


class Handler(http.server.BaseHTTPRequestHandler):
    app: App
    timeout = 60
    server_version = 'HiraiaProvisioning/1'

    def log_message(self, format, *args):  # noqa: A002 - the base class's name
        pass

    def send(self, code: int, body: bytes | str, content_type: str = 'text/plain; charset=utf-8', **headers):
        data = body.encode() if isinstance(body, str) else body
        self.send_response(code)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        for name, value in headers.items():
            self.send_header(name.replace('_', '-'), value)
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(data)

    def send_json(self, code: int, body: dict, **headers):
        self.send(code, json.dumps(body), 'application/json', **headers)

    def send_file(self, file: io.BufferedReader, size: int, etag: str,
                  content_type: str = 'application/octet-stream') -> bool:
        """The file, or the one range of it the request asks for, streamed from disk a chunk at a time.

        Phones resume with `Range: bytes=N-`. Hiraia's downloader discards its partial file when a
        resume is answered with the whole body, so a range this can serve is always served as one.
        """
        headers = {'Accept-Ranges': 'bytes', 'ETag': f'"{etag}"'}
        wanted = self.headers.get('Range')
        if self.headers.get('If-Range', f'"{etag}"').strip() != f'"{etag}"':
            wanted = None  # the client's partial is of some other file: it gets this one whole
        try:
            span = byte_range(wanted, size)
        except Unsatisfiable:
            return self.send(416, b'', Content_Range=f'bytes */{size}', **headers)
        first, last = span or (0, size - 1)
        self.send_response(206 if span else 200)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(last + 1 - first))
        if span:
            self.send_header('Content-Range', f'bytes {first}-{last}/{size}')
        for name, value in headers.items():
            self.send_header(name, value)
        self.end_headers()
        if self.command == 'HEAD':
            return False
        at = first
        try:
            while at <= last:
                chunk = os.pread(file.fileno(), min(CHUNK, last + 1 - at), at)
                if not chunk:
                    raise OSError(f'{file.name} is shorter than when it was verified')
                self.wfile.write(chunk)
                at += len(chunk)
            self.wfile.flush()
        except (ConnectionError, TimeoutError, ssl.SSLError):
            self.close_connection = True  # a phone that stopped listening, e.g. to resume later
            return False
        # The phone now holds the whole file: this answer carried its last byte, and whatever came
        # before it arrived on earlier requests, or this one would not have asked from here.
        return last == size - 1


class LanHandler(Handler):
    """Plain HTTP: the DPC APK for setup, Hiraia's content mirror, and the operator's pages for the
    laptop alone."""

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        path = self.path.split('?', 1)[0]
        if path == '/provisioner.apk':
            self.app.log(f'{self.client_address[0]} downloading the DPC')
            return self.send(200, self.app.dpc.data, 'application/vnd.android.package-archive')
        if path.startswith(MIRROR_ROUTE):
            return self.send_mirror(path[len(MIRROR_ROUTE):])
        # The QR code holds the Wi-Fi password and the registration token; the table holds IMEIs.
        # Only the laptop itself, addressed by a loopback name, may see them: checking the Host
        # header as well as the client address stops a web page from reaching them by DNS rebinding.
        port = self.server.server_address[1]
        hosts = {f'127.0.0.1:{port}', f'localhost:{port}', f'[::1]:{port}'}
        if self.client_address[0] not in LOOPBACK or self.headers.get('Host') not in hosts:
            return self.send(404, 'Not found')
        private = {'X-Frame-Options': 'DENY', 'Cross-Origin-Resource-Policy': 'same-origin'}
        if path == '/':
            return self.send(200, dashboard(self.app), 'text/html; charset=utf-8', **private)
        if path == '/qr':
            return self.send(200, qr_page(self.app), 'text/html; charset=utf-8', **private)
        if path == '/qr.svg':
            return self.send(200, qr_svg(self.app.payload), 'image/svg+xml', **private)
        if path == '/export/devices.csv':
            return self.send(200, self.app.registry.csv(), 'text/csv; charset=utf-8',
                             Content_Disposition='attachment; filename="devices.csv"', **private)
        self.send(404, 'Not found')

    def send_mirror(self, name: str):
        """A file from the mirror: models/<filename> or models/images/<filename>. Open to the whole
        LAN in plain HTTP, like the DPC, because nothing here is secret and nothing here is trusted:
        Hiraia checks every byte against the size and MD5 built into it. Only files on Hiraia's own
        lists that matched them at startup are served; any other name is simply not there."""
        file = self.app.mirror.files.get(name) if self.app.mirror else None
        if file is None:
            return self.send(404, 'Not found')
        client = self.client_address[0]
        # A download arrives as many Range requests; one line per phone and file says enough, and
        # one per phone for the dozens of illustration packs.
        if self.command == 'GET' and self.app.first_time(client, 'images' if name.startswith('images/') else name):
            self.app.log(f'{client}  downloading ' + ('illustration packs' if name.startswith('images/') else
                                                      f'{name} ({_mib(file.asset.size)})') + ' from the mirror')
        if self.send_file(file.file, file.asset.size, file.asset.md5) and self.command == 'GET':
            self.app.content_received(client, name)


class ApiHandler(Handler):
    """HTTPS: what the DPC on a phone calls.

    POST /api/register  with the QR code's token: returns the phone's ID, its own secret, and a
                        receipt for the ID that it shows if it ever has to register again.
    POST /api/report    with the phone's secret: its status (COMPLETE, INSTALLING and how far, or
                        ERROR and why).
    POST /api/checkin   with the phone's secret: its status and DPC version; returns the DPC on offer.
    GET  /api/dpc.apk   with the phone's secret: that DPC, for the phone to update itself.
    GET  /api/hiraia.apk  with the phone's secret: the Hiraia APK on offer, resumable with Range.
    Register and check-in replies also name the Hiraia APK on offer and the content mirror.
    A phone authenticates with `Authorization: Bearer <secret>` and `X-Hiraia-Id: <its ID>`.
    """

    def read_body(self) -> bytes | None:
        # Read the whole request before answering, even to refuse it: closing a TLS connection
        # with request bytes still unread makes the kernel reset it, and the client never sees
        # the refusal.
        length = self.headers.get('Content-Length', '0')
        if not length.isdigit():
            self.close_connection = True
            self.send_json(400, {'error': 'bad Content-Length'}, Connection='close')
            return None
        if int(length) > MAX_BODY:
            self.close_connection = True
            remaining = min(int(length), 4 * MAX_BODY)
            while remaining > 0 and (chunk := self.rfile.read(min(remaining, 65536))):
                remaining -= len(chunk)
            self.send_json(413, {'error': 'request too large'}, Connection='close')
            return None
        return self.rfile.read(int(length))

    def device(self) -> str | None:
        """The ID of the phone making this request, if its secret checks out."""
        hiraia_id = self.headers.get('X-Hiraia-Id', '')
        authorization = self.headers.get('Authorization', '')
        if HIRAIA_ID.fullmatch(hiraia_id) and authorization.startswith('Bearer ') \
                and self.app.registry.authenticate(hiraia_id, authorization[7:]):
            self.app.seen_at(self.client_address[0], hiraia_id)
            return hiraia_id
        # 401 tells the phone to register again: the server may have lost track of it.
        self.send_json(401, {'error': 'unknown phone or wrong secret'})
        return None

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        if self.path not in ('/api/dpc.apk', '/api/hiraia.apk'):
            return self.send_json(404, {'error': 'not found'})
        hiraia_id = self.device()
        if not hiraia_id:
            return
        if self.path == '/api/dpc.apk':
            self.app.log(f'{hiraia_id}  downloading DPC {self.app.dpc.version_code}')
            return self.send(200, self.app.dpc.data, 'application/vnd.android.package-archive')
        hiraia = self.app.hiraia
        if not hiraia:
            return self.send_json(404, {'error': 'no Hiraia APK on offer'})
        if not self.app.apk_downloads.acquire(blocking=False):
            return self.send_json(503, {'error': 'busy with other phones; try again'}, Retry_After='30')
        try:
            if self.command == 'GET' and self.app.first_time(hiraia_id, hiraia.sha256):
                self.app.log(f'{hiraia_id}  downloading Hiraia {hiraia.version_name} ({hiraia.version_code})')
            self.send_file(hiraia.file, hiraia.size, hiraia.sha256, 'application/vnd.android.package-archive')
        finally:
            self.app.apk_downloads.release()

    def do_POST(self):
        raw = self.read_body()
        if raw is None:
            return
        if self.path == '/api/register':
            try:
                inventory, problem = validate_inventory(json.loads(raw or b'null')), None
            except ValueError as error:
                inventory, problem = None, error
            token = hmac.compare_digest(self.headers.get('Authorization', '').encode(),
                                        f'Bearer {self.app.token}'.encode())
            # A phone that lost its secret after the token was replaced still holds the old token,
            # but also a receipt for its own ID, which is proof enough to register again.
            by_receipt = not token and inventory is not None and self.app.registry.may_register_by_receipt(inventory)
            if not token and not by_receipt:
                # A phone that never registered is on no dashboard, so say so here. The usual cause
                # is a QR code from before the token was replaced.
                who = f' ({inventory["device_key"]})' if inventory else ''
                self.app.log(f'{self.client_address[0]}  registration refused: wrong token{who}')
                return self.send_json(401, {'error': 'unauthorized'})
            if problem:
                self.app.log(f'{self.client_address[0]}  registration refused: {problem}')
                return self.send_json(400, {'error': str(problem)})
            try:
                registration = self.app.registry.register(inventory)
            except OSError as failure:
                self.app.log(f'{self.client_address[0]}  registration failed: {failure}')
                return self.send_json(503, {'error': 'the server could not record this phone; try again'})
            except Conflict as conflict:
                self.app.log(f'{self.client_address[0]}  registration refused: {conflict}')
                if conflict.hiraia_id:
                    self.app.registry.flag(conflict.hiraia_id, f'CONFLICT: {conflict}')
                return self.send_json(409, {'error': str(conflict)})
            self.app.seen_at(self.client_address[0], registration.hiraia_id)
            ram = inventory.get('ram_total_bytes')
            self.app.log(f'{registration.hiraia_id}  registered  {inventory.get("model") or "?"}  '
                         f'{inventory["device_key"]}' + (f'  {ram / 2**30:.2f} GiB' if ram else '')
                         + ('  (by receipt)' if by_receipt else ''))
            if registration.note:
                self.app.log(f'{registration.hiraia_id}  {registration.note}')
            return self.send_json(200, {'hiraia_id': registration.hiraia_id, 'secret': registration.secret,
                                        'receipt': registration.receipt,
                                        **self.app.offers(inventory.get('dpc_version_code'))})
        if self.path not in ('/api/report', '/api/checkin'):
            return self.send_json(404, {'error': 'not found'})
        hiraia_id = self.device()
        if not hiraia_id:
            return
        try:
            body = json.loads(raw or b'null')
        except ValueError:
            return self.send_json(400, {'error': 'not JSON'})
        if not isinstance(body, dict):
            return self.send_json(400, {'error': 'expected a JSON object'})
        # Asked of a string only: a list or an object cannot even be looked up in a set.
        status = body.get('status') if isinstance(body.get('status'), str) else None
        if self.path == '/api/report':
            if status not in PHONE_STATUSES:
                return self.send_json(400, {'error': f'status must be one of {sorted(PHONE_STATUSES)}'})
            detail = str(body.get('detail') or '')[:500]
            self.app.registry.report(hiraia_id, status, detail)
            # An install reports its progress every few percent. The dashboard shows each report;
            # the terminal hears each new step once, whatever its numbers.
            step = f'{status} {re.sub(r"[0-9]+", "#", detail)}'
            with self.app.lock:
                changed, self.app.steps[hiraia_id] = self.app.steps.get(hiraia_id) != step, step
            if changed or status != 'INSTALLING':
                self.app.log(f'{hiraia_id}  {status}' + (f'  {detail}' if detail else ''))
            return self.send_json(200, {'ok': True})
        version, name = body.get('dpc_version_code'), body.get('dpc_version')
        if type(version) is not int or not 0 <= version < 2**31:
            return self.send_json(400, {'error': 'dpc_version_code must be an integer'})
        if status not in PHONE_STATUSES or not (name is None or (isinstance(name, str) and len(name) <= 64)):
            return self.send_json(400, {'error': f'status must be one of {sorted(PHONE_STATUSES)}'})
        self.app.registry.seen(hiraia_id, status, version, name)
        dpc = self.app.dpc
        self.send_json(200, {'dpc': {'version_code': dpc.version_code, 'sha256': dpc.sha256, 'size': len(dpc.data)},
                             **self.app.offers(version)})


class LanServer(http.server.ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


# How a TLS client says it does not trust the server's certificate; Android sends the first.
CERTIFICATE_REJECTIONS = {'SSLV3_ALERT_CERTIFICATE_UNKNOWN', 'TLSV1_ALERT_UNKNOWN_CA', 'SSLV3_ALERT_BAD_CERTIFICATE'}


class TlsServer(LanServer):
    def __init__(self, address, handler, context: ssl.SSLContext, app: App):
        super().__init__(address, handler)
        self.context, self.app = context, app

    def finish_request(self, request, client_address):
        # The handshake runs on the request's own thread, so one slow phone cannot stall the rest.
        request.settimeout(Handler.timeout)
        with self.context.wrap_socket(request, server_side=True) as tls:
            super().finish_request(tls, client_address)

    def handle_error(self, request, client_address):
        error = sys.exc_info()[1]
        if isinstance(error, ssl.SSLError) and error.reason in CERTIFICATE_REJECTIONS \
                and client_address[0] not in self.app.handshake_failures:
            # A client that rejected this server's key: most likely a phone scanned from a QR code
            # another server identity made, which will wait forever. Said once per address.
            self.app.handshake_failures.add(client_address[0])
            self.app.log(f'{client_address[0]}  rejected this server\'s key ({error.reason}). A phone whose QR code '
                         'came from a different server identity cannot use this one.')
        if isinstance(error, (ssl.SSLError, ConnectionError, TimeoutError)):
            return  # a phone that dropped mid-request, or something on the LAN that is not a phone
        super().handle_error(request, client_address)


def serve(app: App, bind: str = '0.0.0.0') -> tuple[LanServer, TlsServer]:
    lan_handler = type('Lan', (LanHandler,), {'app': app})
    api_handler = type('Api', (ApiHandler,), {'app': app})
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    context.load_cert_chain(app.certificate, app.key)
    lan = LanServer((bind, app.config.http_port), lan_handler)
    api = TlsServer((bind, app.config.https_port), api_handler, context, app)
    for server in (lan, api):
        threading.Thread(target=server.serve_forever, daemon=True).start()
    return lan, api


def advertise(host: str, port: int, pin: str):
    """Announce the API over mDNS, so a phone whose stored address went stale can find it again.
    Anything can announce this name; a phone still only trusts the key it was given. The name
    comes from the key, not the address, so a server that moved answers under the same name."""
    name = f'hiraia-provisioning-{hashlib.sha256(pin.encode()).hexdigest()[:8]}'
    if sys.platform == 'darwin':
        from mdns_macos import Advertisement
        # The LaunchAgent restarts the service if its connection to mDNSResponder dies.
        return Advertisement(host, port, name,
                             on_failure=lambda error: os.kill(os.getpid(), signal.SIGTERM))
    from zeroconf import ServiceInfo, Zeroconf
    zeroconf = Zeroconf(interfaces=[host])
    zeroconf.register_service(ServiceInfo(MDNS_TYPE, f'{name}.{MDNS_TYPE}', port=port,
                                          addresses=[socket.inet_aton(host)], server=f'{name}.local.',
                                          properties={'v': '1'}))
    return zeroconf


# --- Operator pages ------------------------------------------------------------------------

PAGE = """<!doctype html><meta charset="utf-8"><title>{title}</title>{refresh}
<style>
 body {{ font: 15px/1.4 -apple-system, system-ui, sans-serif; margin: 2rem; color: #222; }}
 table {{ border-collapse: collapse; }} td, th {{ padding: .3rem .8rem; border-bottom: 1px solid #ddd; text-align: left; }}
 .COMPLETE {{ color: #1a7f37; }} .ERROR {{ color: #b3261e; font-weight: 600; }} .REGISTERED {{ color: #9a6700; }}
 .INSTALLING {{ color: #0b57d0; }}
 .warn {{ color: #9a6700; }} code, pre {{ font-size: 13px; }} pre {{ white-space: pre-wrap; }} a {{ color: #0b57d0; }}
</style>
{body}"""


def _local_time(stamp: str) -> str:
    try:
        return dt.datetime.fromisoformat(stamp).astimezone().strftime('%d %b %Y, %H:%M:%S %z')
    except (TypeError, ValueError):
        return ''


def _gib(value: object) -> str:
    return f'{value / 2**30:.2f} GiB' if type(value) is int else ''


def delivery(app: App) -> str:
    """One line on what phones get besides the DPC: the Hiraia APK on offer and the mirror."""
    if app.hiraia:
        hiraia = (f'Hiraia {html.escape(app.hiraia.version_name)} ({app.hiraia.version_code}) on offer, '
                  f'sha256 <code>{app.hiraia.sha256[:16]}…</code>')
    else:
        hiraia = '<span class="warn">No Hiraia APK on offer</span> (<code>--hiraia-apk</code>)'
    mirror = app.mirror
    if mirror and mirror.files:
        count = len(mirror.files)
        content = (f'mirror: {count} file{"s" if count != 1 else ""}, {_mib(mirror.size)} at '
                   f'<code>{html.escape(app.mirror_url())}</code>')
    else:
        content = ('<span class="warn">mirror empty</span>: phones download Hiraia\'s content from the internet '
                   '(<code>--sync-mirror</code>)')
    missing = [asset.name for asset in mirror.missing] if mirror else []
    if missing:
        content += f' · {len(missing)} not in the mirror: {html.escape(", ".join(missing[:3]))}' + \
                   ('…' if len(missing) > 3 else '')
    return f'<p>{hiraia} · {content}</p>'


def content_cell(received: list[str]) -> str:
    """What Hiraia has pulled from the mirror in full: LaBSE, the search vectors, how many image
    packs. Hiraia fetches LaBSE the first time a student taps search, so it can lag the images."""
    kinds = [content_kind(name) for name in received]
    mark = lambda kind, label: (f'<span class="COMPLETE">{label} ✓</span>' if kind in kinds
                                else f'<span class="warn">{label} –</span>')
    packs = kinds.count('images')
    return ' · '.join([mark('labse', 'LaBSE'), mark('vectors', 'vectors'),
                       f'{packs} image pack{"" if packs == 1 else "s"}'])


def dashboard(app: App) -> str:
    devices = app.registry.devices()
    rows = []
    for device in devices:
        inventory = device['inventory']
        status = html.escape(device['status'])
        key = str(inventory.get('device_key', ''))
        identity = html.escape(str(inventory.get('serial') or key))
        if key.startswith('enrollment:'):
            identity = f'<span class="warn" title="No serial number: this ID will not survive a reset">{identity}</span>'
        cells = [content_cell(device['content']), html.escape(device['detail']),
                 html.escape(str(inventory.get('model') or '')), identity,
                 _gib(inventory.get('ram_total_bytes')), html.escape(str(device['dpc_version'] or '')),
                 _local_time(device['last_seen'])]
        rows.append(f'<tr><td>{html.escape(device["hiraia_id"])}</td><td class="{status}">{status}</td>'
                    + ''.join(f'<td>{cell}</td>' for cell in cells) + '</tr>')
    counts: dict[str, int] = {}
    for device in devices:
        counts[device['status']] = counts.get(device['status'], 0) + 1
    summary = ', '.join(f'{n} {status.lower()}' for status, n in sorted(counts.items())) or 'no phones yet'
    moved = (f'<p class="warn">This laptop moved from {html.escape(app.moved_from)} to '
             f'{html.escape(app.config.host)} during this session.</p>' if app.moved_from else '')
    body = (f'<h1>Hiraia provisioning</h1>{moved}<p>{summary} · <a href="/qr">QR code</a> · '
            f'<a href="/export/devices.csv">devices.csv</a></p>{delivery(app)}<table><tr><th>ID</th><th>Status</th>'
            '<th>Content</th><th>Detail</th><th>Model</th><th>Serial</th><th>RAM</th><th>DPC</th><th>Last seen</th></tr>'
            + ''.join(rows) + '</table>')
    return PAGE.format(title='Hiraia provisioning', refresh='<meta http-equiv="refresh" content="5">', body=body)


def qr_page(app: App) -> str:
    c = app.config
    network = (f'Wi-Fi <b>{html.escape(c.wifi_ssid)}</b> ({c.wifi_security})' if c.wifi_ssid
               else 'No Wi-Fi in the QR code: connect the phone yourself when setup asks')
    server = f'https://{c.host}:{c.https_port}'
    debug = (f'adb shell am broadcast -n {DPC_PACKAGE}/.DebugConfigReceiver --es server {server} '
             f'--es pin {app.pin} --es token {app.token}')
    moved = (f'<p class="warn">This laptop moved from {html.escape(app.moved_from)} to {html.escape(c.host)} '
             'during this session; this code has been updated. A phone scanned from the old code that had not '
             'finished downloading Hiraia Setup has to be scanned again.</p>' if app.moved_from else '')
    body = f"""<h1>Scan to provision</h1>{moved}
<p>On a factory-reset phone, tap the welcome screen six times, scan this code, and accept the
"this device belongs to your organization" screen. The rest runs by itself.
The code holds the Wi-Fi password and the registration token: do not photograph or share it.</p>
<img src="/qr.svg" alt="Provisioning QR code" style="width:min(80vh,90vw)">
<p>{network} · API <code>{html.escape(server)}</code>{' · offline setup' if c.offline else ''}<br>
DPC version {app.dpc.version_code} · sha256 <code>{app.dpc.sha256[:16]}…</code> ·
signed by <code>{app.dpc.signer_sha256[:16]}…</code></p>
{delivery(app)}
<p><a href="/">Dashboard</a></p>
<h2>Developing without a reset</h2>
<p>For a debug build made device owner over adb, this stands in for the QR code:</p>
<pre>{html.escape(debug)}</pre>"""
    # It refreshes itself: an open tab must never keep showing a code for an address that is gone.
    return PAGE.format(title='Provisioning QR code', refresh='<meta http-equiv="refresh" content="15">', body=body)


# --- Entry point ---------------------------------------------------------------------------

def lan_address() -> str | None:
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
        try:
            probe.connect(('192.0.2.1', 9))  # no packet is sent; this only picks the outbound interface
            return probe.getsockname()[0]
        except OSError:
            return None


def main(argv: list[str] | None = None):
    parser = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    parser.add_argument('--wifi-ssid', help='the network phones join during setup (omit to join by hand)')
    parser.add_argument('--wifi-security', default='WPA', choices=['WPA', 'NONE'],
                        help='WPA covers WPA2 and WPA2/WPA3 transition networks. Android setup has no '
                             'WPA3-only option: provision on a WPA2 or transition-mode SSID.')
    parser.add_argument('--host', help='this laptop\'s address on that network (default: detected)')
    parser.add_argument('--http-port', type=int, default=8080)
    parser.add_argument('--https-port', type=int, default=8443)
    parser.add_argument('--prefix', default='HI2609', help='Hiraia ID prefix (default HI2609)')
    parser.add_argument('--first', type=int, default=201, help='the first ID number handed out (default 201)')
    parser.add_argument('--new-token', action='store_true',
                        help='replace the registration token, e.g. after a photo of the QR code got out. Phones '
                             'scanned but not yet registered are refused and must be scanned again; registered '
                             'phones are unaffected, and re-register with their ID receipts if they ever must.')
    parser.add_argument('--new-receipt-key', action='store_true',
                        help='replace a lost receipt key. Phones keep their IDs through their serial numbers, but '
                             'their old receipts no longer prove anything after a database restore.')
    parser.add_argument('--new-identity', action='store_true',
                        help='make a new TLS key, token and receipt key although phones are registered (the old '
                             'files are kept aside). Every phone provisioned so far then has to be factory-reset '
                             'and scanned again.')
    parser.add_argument('--time-zone', default='Asia/Manila')
    parser.add_argument('--offline', action='store_true', help='the Wi-Fi has no internet (Android 13+)')
    parser.add_argument('--dpc-apk', type=Path, default=DEFAULT_DPC_APK)
    parser.add_argument('--data-dir', type=Path, default=Path.home() / '.hiraia/provisioning')
    parser.add_argument('--hiraia-apk', type=Path,
                        help='the Hiraia release APK to install on phones (none is offered without it). It must be '
                             f'{HIRAIA_PACKAGE}, signed with Hiraia\'s release key; it is copied into the mirror '
                             'directory at startup, so rebuilding it mid-session changes nothing.')
    parser.add_argument('--max-apk-downloads', type=int, default=8,
                        help='phones downloading the Hiraia APK at once; the rest are told to retry (default 8)')
    parser.add_argument('--min-dpc-version-for-hiraia', type=int,
                        help='offer Hiraia only after this Setup versionCode is installed; the offered DPC '
                             'must be at least this version so every phone can upgrade')
    parser.add_argument('--mirror-dir', type=Path, default=Path.home() / '.hiraia/mirror',
                        help='where Hiraia\'s content is mirrored for phones on the LAN (default ~/.hiraia/mirror)')
    parser.add_argument('--sync-mirror', action='store_true',
                        help='download or complete the mirror from the internet, verified against Hiraia\'s own '
                             'sizes and MD5s, then exit')
    parser.add_argument('--with-llm', action='store_true',
                        help='also require/sync the 1.27 GB tutor model, which only 6 GB+ phones run')
    parser.add_argument('--require-complete-mirror', action='store_true',
                        help='refuse to start if any required content is missing or corrupt; prevents '
                             'missing local files from sending phones to the internet')
    parser.add_argument('--mirror-origin', default=ASSET_ORIGIN, help=argparse.SUPPRESS)
    args = parser.parse_args(argv)

    mirror_dir = args.mirror_dir.expanduser().resolve()
    try:
        servable, needed = known_assets(), known_assets(with_llm=False)
    except (OSError, ValueError, KeyError, TypeError, AttributeError) as problem:
        parser.error(f'cannot read Hiraia\'s asset lists, which say what the mirror holds: {problem}')
    if args.sync_mirror:
        mirror_dir.mkdir(parents=True, exist_ok=True)
        try:
            synced = sync_mirror(mirror_dir, servable if args.with_llm else needed, args.mirror_origin,
                                 log=lambda message: print(message, flush=True))
        except KeyboardInterrupt:
            sys.exit(130)
        sys.exit(0 if synced else 1)
    if args.max_apk_downloads < 1:
        parser.error('--max-apk-downloads must be at least 1')

    if not re.fullmatch(r'[A-Z0-9]{2,12}', args.prefix):
        parser.error('--prefix must be 2-12 capital letters or digits')
    if not 1 <= args.first <= MAX_SEQ:
        parser.error(f'--first must be between 1 and {MAX_SEQ}')
    host = args.host or lan_address()
    if not host:
        parser.error('could not tell which network to serve on; pass --host')
    password = None
    if args.wifi_ssid and args.wifi_security == 'WPA':
        # Never on the command line, where other users of the laptop could read it.
        password = os.environ.get('HIRAIA_WIFI_PASSWORD') or getpass.getpass(f'Password for {args.wifi_ssid}: ')
        if not 8 <= len(password) <= 63:
            parser.error('a WPA password is 8 to 63 characters')

    data = args.data_dir.expanduser().resolve()
    data.mkdir(parents=True, exist_ok=True)
    data.chmod(0o700)
    # The mirror of issued.log sits beside the data directory, not in it, so restoring that
    # directory from a backup cannot roll it back.
    mirror = data.parent / f'{data.name}.issued.log'
    try:
        with mirror.open('a'):
            pass
    except OSError as failure:
        parser.error(f'cannot write {mirror} ({failure.strerror}). The mirror of issued.log lives beside the data '
                     'directory, in its parent, so a restore of the directory cannot roll it back; that parent must '
                     'be writable. Use a --data-dir inside a folder you can write to.')
    dpc = Dpc.load(args.dpc_apk)
    if args.min_dpc_version_for_hiraia is not None and not 1 <= args.min_dpc_version_for_hiraia <= dpc.version_code:
        parser.error('--min-dpc-version-for-hiraia must be positive and no newer than --dpc-apk')
    mirror_dir.mkdir(parents=True, exist_ok=True)
    hiraia = None
    if args.hiraia_apk:
        try:
            hiraia = HiraiaApk.snapshot(args.hiraia_apk.expanduser(), mirror_dir)
        except (OSError, ValueError, zipfile.BadZipFile, struct.error, IndexError, KeyError) as refused:
            parser.error(f'will not offer {args.hiraia_apk} as Hiraia: {refused}')
    print(f'Verifying the mirror in {mirror_dir}…', flush=True)
    content = Mirror.load(mirror_dir, servable, needed)
    required = servable if args.with_llm else needed
    missing = [asset.name for asset in required if asset.name not in content.files]
    if args.require_complete_mirror and missing:
        content.close()
        parser.error('incomplete content mirror: ' + ', '.join(missing) + '. Sync and verify it before serving phones.')
    if args.require_complete_mirror and not private_ipv4(host):
        content.close()
        parser.error('--require-complete-mirror needs a private LAN IPv4 address accepted by the app')
    guard_identity(parser, args, data, mirror)
    try:
        receipt_key = ensure_secret(data / 'receipt-key')
        token = ensure_secret(data / 'token')
    except ValueError as corrupt:
        parser.error(str(corrupt))
    config = Config(host, args.http_port, args.https_port, args.wifi_ssid, password, args.wifi_security,
                    args.time_zone, args.offline)
    registry = Registry(data / 'provisioning.db', args.prefix, args.first, receipt_key, mirror)
    app = App(registry, dpc, config, ensure_tls(data), token, hiraia, content, args.max_apk_downloads,
              args.min_dpc_version_for_hiraia)
    serve(app)
    last_host = data / 'host'
    moved = last_host.exists() and last_host.read_text().strip() != host
    last_host.write_text(host)
    mdns = advertise(host, args.https_port, app.pin)

    def announce(new_host: str):
        nonlocal mdns
        mdns.close()
        mdns = advertise(new_host, args.https_port, app.pin)
        last_host.write_text(new_host)

    app.announce = announce
    print(f'Hiraia provisioning server\n'
          f'  QR code and dashboard  http://127.0.0.1:{args.http_port}/qr\n'
          f'  phones fetch the DPC   http://{host}:{args.http_port}/provisioner.apk\n'
          f'  phones register at     https://{host}:{args.https_port} (and {MDNS_TYPE} over mDNS)\n'
          f'  server key (pinned)    {app.pin}\n'
          f'  DPC version {dpc.version_code}, sha256 {dpc.sha256[:16]}…\n'
          + (f'  Hiraia on offer        {hiraia.version_name} ({hiraia.version_code}), sha256 {hiraia.sha256[:16]}…\n'
             if hiraia else '  Hiraia on offer        none (--hiraia-apk)\n')
          + (f'  content mirror         {len(content.files)} files, {_mib(content.size)} at {app.mirror_url()}\n'
             if content.files else '  content mirror         empty: phones download Hiraia\'s content from the internet\n')
          + f'  IDs from {args.prefix}-{args.first:03d}; data in {data}', flush=True)
    if content.missing:
        print(f'  note: {len(content.missing)} of Hiraia\'s files are not in the mirror, and phones fetch those from '
              'the internet. Run --sync-mirror, then restart.', flush=True)
    if content.files and not private_ipv4(host):
        print(f'  note: {host} is not a private IPv4 address, and Hiraia only accepts a mirror at one, so phones '
              'will ignore it and use the internet.', flush=True)
    known = max((int(HIRAIA_ID.fullmatch(d['hiraia_id'])[1]) for d in registry.devices()), default=0)
    if registry.highest_issued() > known:
        print(f'  note: the issued logs have handed out numbers up to {registry.highest_issued()}, but the database '
              f'only knows up to {known}: it is older than the logs. New phones are numbered above the logs, and '
              'returning phones get their own numbers back.', flush=True)
    if moved and registry.unfinished():
        print(f'  note: this laptop was at a different address last time. {registry.unfinished()} unfinished '
              'phone(s) will look for it over mDNS; if they stay stuck, check the Wi-Fi allows multicast.',
              flush=True)
    threading.Thread(target=AddressWatch(app, pinned=bool(args.host)).run, daemon=True).start()
    try:
        threading.Event().wait()
    except KeyboardInterrupt:
        pass
    finally:
        mdns.close()
        content.close()
        if hiraia:
            hiraia.close()


def guard_identity(parser: argparse.ArgumentParser, args: argparse.Namespace, data: Path, mirror: Path):
    """Refuses to replace any part of the server's identity once phones depend on it, unless the
    operator says so; and never deletes a file it replaces."""
    # A log only proves phones exist if it holds an entry: startup creates an empty mirror to
    # check its folder is writable, and a first run must not mistake that for a registered phone.
    in_use = registered_count(data / 'provisioning.db') or any(
        log.exists() and log.stat().st_size > 0 for log in (data / 'issued.log', mirror))
    missing = [name for name in IDENTITY_FILES if not (data / name).exists()]
    allowed = {'token': args.new_token, 'receipt-key': args.new_receipt_key}
    unresolved = [name for name in missing if not args.new_identity and not allowed.get(name)]
    if in_use and unresolved:
        consequences = {
            'tls-key.pem': 'phones pin its key, so without it every phone provisioned so far has to be '
                           'factory-reset and scanned again (--new-identity)',
            'token': 'phones scanned but not yet registered hold it (--new-token makes a new one; they then '
                     'have to be scanned again)',
            'receipt-key': 'phones prove their IDs with it after a database restore (--new-receipt-key)',
        }
        parser.error(f'{", ".join(unresolved)} missing from {data}, but phones are already registered here. Restore '
                     'from your backup of that directory. Otherwise: '
                     + '; '.join(f'{name}: {consequences[name]}' for name in unresolved) + '.')
    if args.new_receipt_key and (data / 'receipt-key').exists() and not args.new_identity:
        parser.error(f'--new-receipt-key only replaces a LOST receipt key, and {data / "receipt-key"} is there. '
                     'Every phone\'s receipt depends on it. To replace it on purpose, move it aside yourself first.')
    stamp = dt.datetime.now().strftime('%Y%m%dT%H%M%S')
    replaced = []
    for name in (IDENTITY_FILES + ('tls-cert.pem',) if args.new_identity else ('token',) if args.new_token else ()):
        if (data / name).exists():
            (data / name).rename(data / f'{name}.replaced-{stamp}')
            replaced.append(name)
    if args.new_identity:
        print(f'NEW SERVER IDENTITY in {data}'
              + (f'; the old files are kept as *.replaced-{stamp}' if replaced else '')
              + '. Every phone provisioned with the old one has to be factory-reset and scanned again.', flush=True)
    elif args.new_token:
        print(f'NEW REGISTRATION TOKEN in {data}'
              + (f' (the old one is kept as token.replaced-{stamp})' if replaced else '')
              + '. Show the QR page again: phones scanned from the old code are refused.', flush=True)


def registered_count(database: Path) -> int:
    if not database.exists():
        return 0
    db = sqlite3.connect(database, timeout=30)
    try:
        return db.execute('SELECT COUNT(*) FROM devices').fetchone()[0]
    except sqlite3.OperationalError:  # no devices table yet
        return 0
    finally:
        db.close()


def private_ipv4(host: str) -> bool:
    """Whether Hiraia will take a mirror at this address: it accepts private IPv4 literals only."""
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        return False
    return any(address in ipaddress.ip_network(network) for network in ('10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'))


def address_present(host: str) -> bool:
    """Whether this laptop still has that address on some interface."""
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
        try:
            probe.bind((host, 0))
            return True
        except OSError:
            return False


class AddressWatch:
    """Follows the laptop's address through a session. It acts only when the served address is
    really gone, and moves only to an address that was NOT on the laptop while the served one
    worked: a new DHCP lease, or an interface that just joined. A tether, a VPN or Ethernet that
    was already there is never taken for the provisioning Wi-Fi, even while that Wi-Fi blinks.
    When the original address comes back, it moves back."""

    def __init__(self, app: App, pinned: bool, locate=lan_address, present=address_present,
                 addresses=None):
        self.app, self.pinned, self.locate, self.present = app, pinned, locate, present
        self.addresses = addresses or local_addresses
        self.home = app.config.host
        self.known = set(self.addresses())
        self.warned = False

    def check(self):
        host = self.app.config.host
        if self.present(host):
            self.warned = False
            self.known = set(self.addresses())
            return
        if not self.pinned and self.home != host and self.present(self.home):
            self.warned = False
            self.app.move(self.home)
            return
        current = None if self.pinned else self.locate()
        if current and current != host and current not in self.known and self.present(current):
            self.warned = False
            self.app.move(current)
        elif not self.warned:
            self.warned = True
            self.app.log(f'WARNING: this laptop no longer has the address {host}, so phones cannot reach it. '
                         + ('Reconnect it, or restart with a new --host.' if self.pinned
                            else 'Reconnect it to the provisioning Wi-Fi.'))

    def run(self, interval: float = 30):
        while True:
            threading.Event().wait(interval)
            try:
                self.check()
            except Exception as failure:  # noqa: BLE001 - a watcher that dies silently is worse
                self.app.log(f'WARNING: the address watch failed once ({failure}); it keeps watching.')


def local_addresses() -> list[str]:
    """Every IPv4 address on this laptop. ifaddr comes with zeroconf."""
    try:
        import ifaddr
    except ImportError:
        return [address for address in [lan_address()] if address]
    return [ip.ip for adapter in ifaddr.get_adapters() for ip in adapter.ips if isinstance(ip.ip, str)]


if __name__ == '__main__':
    main()
