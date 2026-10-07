"""Tests for the provisioning server: the APK readers, ID allocation under concurrency, and the
two listeners end to end on real sockets (the API over pinned TLS).

  JAVA_HOME=/opt/homebrew/opt/openjdk@17 uv run --with segno --with zeroconf \
    python -m unittest packages/provisioner/server/test_server.py
"""
import argparse
import base64
import csv
import dataclasses
import hashlib
import http.client
import http.server
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import socket
import sqlite3
import ssl
import struct
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest import mock
import zipfile

spec = importlib.util.spec_from_file_location('provisioning_server', Path(__file__).with_name('server.py'))
server = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = server
spec.loader.exec_module(server)

SDK = Path.home() / 'Library/Android/sdk/build-tools'


def build_tool(name: str) -> Path | None:
    found = sorted(SDK.glob(f'*/{name}'))
    return found[-1] if found else (Path(shutil.which(name)) if shutil.which(name) else None)


def lp(data: bytes) -> bytes:
    return struct.pack('<I', len(data)) + data


def binary_manifest(version_code: int, package: str | None = None, version_name: str | None = None) -> bytes:
    """A minimal compiled AndroidManifest.xml: <manifest package=... android:versionCode=...
    android:versionName=...>, UTF-16 strings. As aapt2 lays it out, the android: attribute names
    come first in the string pool, with their resource ids; `package` has neither id nor namespace."""
    names = ['versionCode', 'versionName', 'manifest', 'package', 'http://schemas.android.com/apk/res/android',
             package or '', version_name or '']
    offsets, data = [], b''
    for name in names:
        offsets.append(len(data))
        data += struct.pack('<H', len(name)) + name.encode('utf-16-le') + b'\0\0'
    data += b'\0' * (-len(data) % 4)
    strings_start = 28 + 4 * len(names)
    pool = struct.pack('<HHIIIIII', 0x0001, 28, strings_start + len(data), len(names), 0, 0, strings_start, 0)
    pool += struct.pack(f'<{len(names)}I', *offsets) + data
    resource_map = struct.pack('<HHIII', 0x0180, 8, 16, server.VERSION_CODE_ATTRIBUTE, server.VERSION_NAME_ATTRIBUTE)
    attributes = [struct.pack('<IIIHBBI', 4, 0, 0xFFFFFFFF, 8, 0, 0x10, version_code)]
    if version_name is not None:
        attributes.append(struct.pack('<IIIHBBI', 4, 1, 6, 8, 0, 0x03, 6))
    if package is not None:
        attributes.append(struct.pack('<IIIHBBI', 0xFFFFFFFF, 3, 5, 8, 0, 0x03, 5))
    element = struct.pack('<HHIII', 0x0102, 16, 16 + 20 + 20 * len(attributes), 1, 0xFFFFFFFF)
    element += struct.pack('<IIHHHHHH', 0xFFFFFFFF, 2, 20, 20, len(attributes), 0, 0, 0) + b''.join(attributes)
    body = pool + resource_map + element
    return struct.pack('<HHI', 0x0003, 8, 8 + len(body)) + body


def signed_apk(certificate: bytes, block_id: int = server.V2_BLOCK_ID, version_code: int = 7,
               also: tuple[tuple[int, bytes], ...] = (), **manifest) -> bytes:
    """A zip holding a compiled manifest, with an APK signature block spliced in before its
    central directory. `also`: further (scheme, certificate) signatures, as an APK signed with
    several schemes carries."""
    out = io.BytesIO()
    with zipfile.ZipFile(out, 'w') as archive:
        archive.writestr('AndroidManifest.xml', binary_manifest(version_code, **manifest))
    apk = out.getvalue()
    eocd = apk.rfind(b'PK\x05\x06')
    (central_directory,) = struct.unpack_from('<I', apk, eocd + 16)
    pairs = b''
    for scheme, signer in ((block_id, certificate),) + also:
        signed_data = lp(b'') + lp(lp(signer)) + lp(b'')
        if scheme != server.V2_BLOCK_ID:  # v3 and v3.1 signed data carry min/max SDK after the certificates
            signed_data = lp(b'') + lp(lp(signer)) + struct.pack('<II', 28, 0x7FFFFFFF) + lp(b'')
        value = lp(lp(lp(signed_data) + lp(b'') + lp(b'public key')))
        pairs += struct.pack('<QI', 4 + len(value), scheme) + value
    size = len(pairs) + 8 + 16
    block = struct.pack('<Q', size) + pairs + struct.pack('<Q', size) + server.APK_SIG_BLOCK_MAGIC
    eocd += len(block)
    apk = apk[:central_directory] + block + apk[central_directory:]
    return apk[:eocd + 16] + struct.pack('<I', central_directory + len(block)) + apk[eocd + 20:]


def inventory(key: str, **fields) -> dict:
    return {'device_key': key, 'model': 'JP1', 'ram_total_bytes': 3_936_354_304, **fields}


class ApkReading(unittest.TestCase):
    def test_reads_the_certificate_from_a_v2_block(self):
        self.assertEqual(server.apk_signer_certificate(signed_apk(b'cert-der')), b'cert-der')

    def test_reads_the_v3_block_layout(self):
        self.assertEqual(server.apk_signer_certificate(signed_apk(b'v3-cert', server.V3_BLOCK_ID)), b'v3-cert')

    def test_goes_by_the_signature_android_13_goes_by(self):
        apk = signed_apk(b'v2-cert', also=((server.V3_BLOCK_ID, b'v3-cert'), (server.V31_BLOCK_ID, b'v31-cert')))
        self.assertEqual(server.apk_signer_certificate(apk), b'v31-cert')
        self.assertEqual(server.apk_signer_certificates(apk), [b'v31-cert', b'v3-cert', b'v2-cert'])

    def test_refuses_an_apk_without_a_signature_block(self):
        out = io.BytesIO()
        with zipfile.ZipFile(out, 'w') as archive:
            archive.writestr('a', b'b')
        with self.assertRaisesRegex(ValueError, 'no APK signature block'):
            server.apk_signer_certificate(out.getvalue())

    def test_refuses_a_debug_signed_dpc(self):
        with tempfile.TemporaryDirectory() as tmp:
            apk = Path(tmp, 'app-debug.apk')
            apk.write_bytes(signed_apk(b'...CN=Android Debug, O=Android...'))
            with self.assertRaisesRegex(ValueError, 'debug key'):
                server.Dpc.load(apk)

    def test_reads_the_version_code_from_a_compiled_manifest(self):
        self.assertEqual(server.apk_version_code(signed_apk(b'c', version_code=123456)), 123456)

    def test_holds_the_bytes_it_serves(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp, 'provisioner.apk')
            path.write_bytes(signed_apk(b'release', version_code=3))
            dpc = server.Dpc.load(path)
            path.unlink()  # a `gradle clean` mid-session changes nothing that is served
            self.assertEqual((dpc.version_code, hashlib.sha256(dpc.data).hexdigest()), (3, dpc.sha256))
            self.assertEqual(base64.urlsafe_b64decode(dpc.package_checksum + '=').hex(), dpc.sha256)

    def test_agrees_with_the_android_build_tools_on_the_built_release_apk(self):
        apksigner, aapt2 = build_tool('apksigner'), build_tool('aapt2')
        if not server.DEFAULT_DPC_APK.exists() or not apksigner or not aapt2:
            self.skipTest('needs the release APK and the Android build tools')
        if subprocess.run([str(apksigner), '--version'], capture_output=True).returncode:
            self.skipTest('apksigner has no Java runtime (set JAVA_HOME to a JDK 17)')
        dpc = server.Dpc.load(server.DEFAULT_DPC_APK)
        certs = subprocess.run([str(apksigner), 'verify', '--print-certs', str(server.DEFAULT_DPC_APK)],
                               capture_output=True, text=True, check=True).stdout
        self.assertIn(f'certificate SHA-256 digest: {dpc.signer_sha256}', certs)
        badging = subprocess.run([str(aapt2), 'dump', 'badging', str(server.DEFAULT_DPC_APK)],
                                 capture_output=True, text=True, check=True).stdout
        self.assertIn(f"versionCode='{dpc.version_code}'", badging)


@unittest.skipUnless(shutil.which('openssl'), 'needs openssl to make the TLS key')
class Pin(unittest.TestCase):
    def test_pins_the_public_key_exactly_as_openssl_extracts_it(self):
        with tempfile.TemporaryDirectory() as tmp:
            cert, key, pin = server.ensure_tls(Path(tmp))
            spki = subprocess.run(f'openssl x509 -in {cert} -pubkey -noout | openssl pkey -pubin -outform DER',
                                  shell=True, capture_output=True, check=True).stdout
            self.assertEqual(pin, server.b64url(hashlib.sha256(spki).digest()))

    def test_a_reissued_certificate_keeps_the_pin(self):
        with tempfile.TemporaryDirectory() as tmp:
            cert, _, pin = server.ensure_tls(Path(tmp))
            cert.unlink()
            reissued, _, again = server.ensure_tls(Path(tmp))
            self.assertTrue(reissued.exists())
            self.assertEqual(again, pin)


KEY = 'test-receipt-key'


class RegistryTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.mirror = Path(self.tmp.name, 'mirror.issued.log')
        self.registry = self.make('HI2609', 201)

    def tearDown(self):
        self.tmp.cleanup()

    def make(self, prefix, first):
        return server.Registry(Path(self.tmp.name, 'p.db'), prefix, first, KEY, self.mirror)

    def register(self, key, registry=None, **fields):
        return (registry or self.registry).register(inventory(key, **fields)).hiraia_id

    def test_numbers_start_at_first_and_count_up(self):
        self.assertEqual([self.register(f'serial:A{i}') for i in range(3)], ['HI2609-201', 'HI2609-202', 'HI2609-203'])

    def test_a_phone_registering_again_keeps_its_id_and_gets_a_new_secret(self):
        first = self.registry.register(inventory('serial:A', ram_total_bytes=1))
        self.registry.report(first.hiraia_id, 'COMPLETE', '')
        self.register('serial:B')
        again = self.registry.register(inventory('serial:A', ram_total_bytes=2))
        self.assertEqual(again.hiraia_id, first.hiraia_id)
        self.assertFalse(self.registry.authenticate(first.hiraia_id, first.secret))
        self.assertTrue(self.registry.authenticate(first.hiraia_id, again.secret))
        device = self.registry.devices()[0]
        self.assertEqual((device['status'], device['inventory']['ram_total_bytes']), ('REGISTERED', 2))

    def test_a_secret_only_works_for_its_own_phone(self):
        a = self.registry.register(inventory('serial:A'))
        b = self.registry.register(inventory('serial:B'))
        self.assertTrue(self.registry.authenticate(a.hiraia_id, a.secret))
        self.assertFalse(self.registry.authenticate(b.hiraia_id, a.secret))
        self.assertFalse(self.registry.authenticate('HI2609-999', a.secret))

    def test_simultaneous_registrations_never_share_a_number(self):
        ids, keys = [], [f'serial:P{i}' for i in range(24)] + ['serial:SAME'] * 8
        lock = threading.Lock()

        def register(key):
            hiraia_id = self.make('HI2609', 201).register(inventory(key)).hiraia_id
            with lock:
                ids.append((key, hiraia_id))

        threads = [threading.Thread(target=register, args=(key,)) for key in keys]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        by_key = {}
        for key, hiraia_id in ids:
            by_key.setdefault(key, set()).add(hiraia_id)
        self.assertTrue(all(len(v) == 1 for v in by_key.values()), 'one key, one ID')
        numbers = sorted(int(next(iter(v))[-3:]) for v in by_key.values())
        self.assertEqual(numbers, list(range(201, 226)))
        self.assertEqual(self.registry.highest_issued(), 225)

    def test_a_new_prefix_or_a_higher_first_continues_without_reusing(self):
        self.register('serial:A')
        later = self.make('HI2610', 300)
        self.assertEqual(self.register('serial:B', later), 'HI2610-300')
        self.assertEqual(self.register('serial:A', later), 'HI2609-201')
        self.assertEqual(self.register('serial:C', self.make('HI2610', 1)), 'HI2610-301')

    def restore(self, backup: dict):
        """Puts the data directory back as it was: the database and issued.log, not the mirror."""
        for path, content in backup.items():
            path.write_bytes(content)

    def backup(self) -> dict:
        return {path: path.read_bytes() for path in [self.registry.path, self.registry.path.with_name('issued.log')]}

    def test_restoring_the_data_directory_neither_reuses_numbers_nor_moves_returning_phones(self):
        self.assertEqual(self.register('serial:A'), 'HI2609-201')
        day_one = self.backup()
        receipt_b = self.registry.register(inventory('serial:B')).receipt
        receipt_c = self.registry.register(inventory('serial:C')).receipt
        self.restore(day_one)  # database AND issued.log roll back; the mirror outside does not
        self.assertEqual(self.registry.highest_issued(), 203)
        self.assertEqual(self.register('serial:NEW'), 'HI2609-204')
        self.assertEqual(self.register('serial:C', hiraia_id='HI2609-203', id_receipt=receipt_c), 'HI2609-203')
        self.assertEqual(self.register('serial:B', hiraia_id='HI2609-202', id_receipt=receipt_b), 'HI2609-202')
        self.assertEqual(self.register('serial:NEXT'), 'HI2609-205')
        logged = self.registry.path.with_name('issued.log').read_text()
        self.assertIn('HI2609-203\tserial:C', logged)  # a reclaimed number is on record again

    def test_without_the_mirror_a_duplicate_number_is_flagged_loudly(self):
        registry = server.Registry(Path(self.tmp.name, 'p.db'), 'HI2609', 201, KEY)  # no mirror
        self.register('serial:A', registry)
        day_one = self.backup()
        receipt_b = registry.register(inventory('serial:B')).receipt
        self.restore(day_one)
        self.assertEqual(self.register('serial:NEW', registry), 'HI2609-202')  # the log rolled back too
        moved = registry.register(inventory('serial:B', hiraia_id='HI2609-202', id_receipt=receipt_b))
        self.assertEqual(moved.hiraia_id, 'HI2609-203')
        self.assertIn('DUPLICATE ID', moved.note)
        # B's old receipt is still genuine, but for a number B no longer wears: it cannot stand in
        # for the token any more. Only the receipt for its current number can.
        self.assertFalse(registry.may_register_by_receipt(
            inventory('serial:B', hiraia_id='HI2609-202', id_receipt=receipt_b)))
        self.assertTrue(registry.may_register_by_receipt(
            inventory('serial:B', hiraia_id='HI2609-203', id_receipt=moved.receipt)))

    def test_a_receipt_only_proves_its_own_phone(self):
        self.register('serial:A')
        before = self.backup()
        self.register('serial:X')                                       # HI2609-202
        receipt_y = self.registry.register(inventory('serial:Y')).receipt  # HI2609-203
        self.restore(before)
        self.mirror.unlink()  # 202 and 203 are free again in every record
        # G shows Y's receipt for Y's number. It proves nothing about G, so G is simply numbered next.
        self.assertEqual(self.register('serial:G', hiraia_id='HI2609-203', id_receipt=receipt_y), 'HI2609-202')
        self.assertEqual(self.register('serial:Y', hiraia_id='HI2609-203', id_receipt=receipt_y), 'HI2609-203')

    def test_a_forged_claim_is_ignored_and_cannot_move_the_counter(self):
        self.register('serial:A')
        self.assertEqual(self.register('serial:F', hiraia_id='HI2609-500'), 'HI2609-202')
        self.assertEqual(self.register('serial:H', hiraia_id='HI2609-999999999', id_receipt='A' * 43), 'HI2609-203')
        self.assertIn('without proof', self.registry.devices()[1]['detail'])
        self.assertEqual(self.register('serial:NEXT'), 'HI2609-204')

    def test_a_receipt_may_stand_in_for_the_token_only_for_its_own_row(self):
        a = self.registry.register(inventory('serial:A'))
        b = self.registry.register(inventory('serial:B'))
        self.assertTrue(self.registry.may_register_by_receipt(
            inventory('serial:A', hiraia_id=a.hiraia_id, id_receipt=a.receipt)))
        self.assertFalse(self.registry.may_register_by_receipt(
            inventory('serial:A', hiraia_id=b.hiraia_id, id_receipt=b.receipt)))
        self.assertFalse(self.registry.may_register_by_receipt(inventory('serial:A', hiraia_id=a.hiraia_id)))
        self.registry.path.unlink()  # a lost database: the receipt restores the row
        registry = self.make('HI2609', 201)
        self.assertTrue(registry.may_register_by_receipt(
            inventory('serial:A', hiraia_id=a.hiraia_id, id_receipt=a.receipt)))

    def test_imei_evidence_accumulates_and_a_different_phone_is_refused(self):
        self.register('serial:DUP', imei=['861234567890123'])
        # A registration that could not read the IMEIs (or a forged one) cannot erase them...
        self.assertEqual(self.register('serial:DUP', imei=[]), 'HI2609-201')
        self.assertEqual(self.registry.devices()[0]['inventory']['imei'], ['861234567890123'])
        # ...so a phone with other IMEIs is still recognised as a different phone.
        with self.assertRaisesRegex(server.Conflict, 'IMEIs 861234567890123') as refused:
            self.register('serial:DUP', imei=['869999999999999'])
        self.assertEqual(refused.exception.hiraia_id, 'HI2609-201')
        self.assertEqual(self.register('serial:DUP', imei=['861234567890123', '861234567890124']), 'HI2609-201')
        self.assertEqual(self.registry.devices()[0]['inventory']['imei'], ['861234567890123', '861234567890124'])
        self.register('serial:DUP', imei=['861234567890124'])  # one SIM slot unreadable this time
        self.assertEqual(self.registry.devices()[0]['inventory']['imei'], ['861234567890123', '861234567890124'])

    def test_ids_never_outgrow_their_pattern(self):
        registry = self.make('HI2609', server.MAX_SEQ)
        self.assertEqual(self.register('serial:LAST', registry), f'HI2609-{server.MAX_SEQ}')
        with self.assertRaisesRegex(server.Conflict, 'no Hiraia ID numbers left'):
            registry.register(inventory('serial:ONE-TOO-MANY'))

    def test_a_check_in_heals_the_status_a_re_registration_reset(self):
        hiraia_id = self.register('serial:A', dpc_version='0.2.0', dpc_version_code=2)
        self.registry.report(hiraia_id, 'COMPLETE', '')
        self.register('serial:A', dpc_version='0.2.0', dpc_version_code=2)  # lost its secret
        self.assertEqual(self.registry.devices()[0]['status'], 'REGISTERED')
        self.registry.seen(hiraia_id, 'COMPLETE', 3, '0.3.0')
        device = self.registry.devices()[0]
        self.assertEqual((device['status'], device['dpc_version_code'], device['dpc_version']), ('COMPLETE', 3, '0.3.0'))

    def test_csv_has_the_spec_columns_splits_imeis_and_defuses_formulas(self):
        self.registry.register(inventory('serial:A', serial='A', imei=['111111111111111', '222222222222222'],
                                         brand='Jambo', model='=HYPERLINK("http://x")', device_name='@SUM(1)'))
        rows = list(csv.DictReader(io.StringIO(self.registry.csv())))
        self.assertEqual(list(rows[0]), server.CSV_COLUMNS)
        row = rows[0]
        self.assertEqual((row['imei_1'], row['imei_2'], row['brand'], row['status']),
                         ('111111111111111', '222222222222222', 'Jambo', 'REGISTERED'))
        self.assertEqual((row['model'], row['device_name']), ('\'=HYPERLINK("http://x")', "'@SUM(1)"))

    def test_csv_shows_the_dpc_version_from_registration_on(self):
        self.register('serial:A', dpc_version='0.2.0', dpc_version_code=2)
        row = next(csv.DictReader(io.StringIO(self.registry.csv())))
        self.assertEqual((row['dpc_version'], row['dpc_version_code']), ('0.2.0', '2'))


class Validation(unittest.TestCase):
    def test_device_keys_are_validated(self):
        for bad in [None, [], {'device_key': ''}, {'device_key': 'mac:1'}, {'device_key': 'serial:a b'}]:
            with self.assertRaises(ValueError):
                server.validate_inventory(bad)
        server.validate_inventory({'device_key': 'enrollment:4f1c2d3e-0000-4000-8000-000000000000'})

    def test_fields_must_be_short_strings_bounded_ints_or_imei_lists(self):
        good = inventory('serial:A', sdk=33, low_ram_device=False, imei=['861234567890123'], serial=None,
                         hiraia_id='HI2609-201')
        self.assertIs(server.validate_inventory(good), good)
        for field, value in [('ram_total_bytes', 10**400), ('ram_total_bytes', -1), ('ram_total_bytes', True),
                             ('ram_total_bytes', 1.5), ('sdk', '33'), ('imei', 5), ('imei', ['x']),
                             ('imei', ['1' * 15] * 5), ('model', 'x' * 257), ('model', {'a': 1}),
                             ('low_ram_device', 0), ('hiraia_id', 'HI2609-2'), ('hiraia_id', 'drop table'),
                             ('hiraia_id', 'HI2609-２０５'), ('id_receipt', 'short'), ('device_key', 'serial:２')]:
            with self.assertRaises(ValueError, msg=f'{field}={value!r:.40}'):
                server.validate_inventory(inventory('serial:A', **{field: value}))


def config(**overrides) -> server.Config:
    values = dict(host='127.0.0.1', http_port=0, https_port=0, wifi_ssid='Army House', wifi_password='secret123',
                  wifi_security='WPA', time_zone='Asia/Manila', offline=False)
    return server.Config(**{**values, **overrides})


class Payload(unittest.TestCase):
    dpc = server.Dpc(Path('provisioner.apk'), b'apk', hashlib.sha256(b'apk').hexdigest(), 2, 'ab' * 32)

    def test_names_the_dpc_the_network_and_the_server(self):
        payload = server.provisioning_payload(config(http_port=8080, https_port=8443), self.dpc, 'PIN', 'TOKEN')
        e = server.EXTRA
        self.assertEqual(payload[e + 'PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME'],
                         'com.hiraia.provisioner/com.hiraia.provisioner.AdminReceiver')
        self.assertEqual(payload[e + 'PROVISIONING_DEVICE_ADMIN_PACKAGE_DOWNLOAD_LOCATION'],
                         'http://127.0.0.1:8080/provisioner.apk')
        checksum = payload[e + 'PROVISIONING_DEVICE_ADMIN_PACKAGE_CHECKSUM']
        self.assertNotIn('=', checksum)
        self.assertEqual(base64.urlsafe_b64decode(checksum + '='), hashlib.sha256(b'apk').digest())
        self.assertNotIn(e + 'PROVISIONING_DEVICE_ADMIN_SIGNATURE_CHECKSUM', payload)
        self.assertNotIn(e + 'PROVISIONING_SKIP_EDUCATION_SCREENS', payload)  # setup ignores it from a QR code
        self.assertEqual((payload[e + 'PROVISIONING_WIFI_SSID'], payload[e + 'PROVISIONING_WIFI_PASSWORD'],
                          payload[e + 'PROVISIONING_WIFI_SECURITY_TYPE']), ('Army House', 'secret123', 'WPA'))
        self.assertIs(payload[e + 'PROVISIONING_LEAVE_ALL_SYSTEM_APPS_ENABLED'], True)
        self.assertEqual(payload[e + 'PROVISIONING_ADMIN_EXTRAS_BUNDLE'],
                         {'server': 'https://127.0.0.1:8443', 'pin': 'PIN', 'token': 'TOKEN'})
        self.assertNotIn(e + 'PROVISIONING_ALLOW_OFFLINE', payload)

    def test_open_network_offline_and_no_wifi(self):
        e = server.EXTRA
        open_net = server.provisioning_payload(config(wifi_security='NONE', offline=True), self.dpc, 'P', 'T')
        self.assertNotIn(e + 'PROVISIONING_WIFI_PASSWORD', open_net)
        self.assertIs(open_net[e + 'PROVISIONING_ALLOW_OFFLINE'], True)
        by_hand = server.provisioning_payload(config(wifi_ssid=None), self.dpc, 'P', 'T')
        self.assertFalse([k for k in by_hand if 'WIFI' in k])

    def test_the_qr_code_encodes_the_payload(self):
        try:
            import segno  # noqa: F401
        except ImportError:
            self.skipTest('run under `uv run --with segno` to render the QR code')
        svg = server.qr_svg(server.provisioning_payload(config(), self.dpc, 'P', 'T'))
        self.assertTrue(svg.startswith('<?xml') and '<svg' in svg)

    def test_wpa3_only_is_not_offered(self):
        with self.assertRaises(SystemExit), mock.patch('sys.stderr', io.StringIO()):
            server.main(['--wifi-ssid', 'x', '--wifi-security', 'SAE'])

    def test_first_must_fit_the_id_pattern(self):
        with self.assertRaises(SystemExit), mock.patch('sys.stderr', io.StringIO()):
            server.main(['--host', '127.0.0.1', '--first', str(server.MAX_SEQ + 1)])


class Identity(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.data = Path(self.tmp.name, 'provisioning')
        self.data.mkdir()
        self.mirror = Path(self.tmp.name, 'provisioning.issued.log')

    def tearDown(self):
        self.tmp.cleanup()

    def guard(self, *flags):
        parser = argparse.ArgumentParser()
        for flag in ('--new-token', '--new-receipt-key', '--new-identity'):
            parser.add_argument(flag, action='store_true')
        stderr = io.StringIO()
        with mock.patch('sys.stderr', stderr), mock.patch('sys.stdout', io.StringIO()):
            try:
                server.guard_identity(parser, parser.parse_args(list(flags)), self.data, self.mirror)
            except SystemExit:
                return stderr.getvalue()
        return None

    def with_phones(self, *present):
        for name in present:
            (self.data / name).write_text('x')
        server.Registry(self.data / 'provisioning.db', 'HI2609', 201, KEY).register(inventory('serial:A'))

    def test_a_first_run_makes_its_identity_freely(self):
        self.assertIsNone(self.guard())

    def test_refuses_to_invent_a_new_identity_once_phones_are_registered(self):
        self.with_phones()
        (self.data / 'issued.log').unlink()  # the database alone is enough to know phones exist
        refusal = self.guard()
        self.assertIn('tls-key.pem, token, receipt-key missing', refusal)
        self.assertIn('--new-identity', refusal)

    def test_a_lost_token_or_receipt_key_needs_only_its_own_flag(self):
        self.with_phones('tls-key.pem', 'receipt-key')
        self.assertIn('token missing', self.guard())
        self.assertIsNone(self.guard('--new-token'))
        (self.data / 'receipt-key').unlink()
        self.assertIn('receipt-key missing', self.guard('--new-token'))
        self.assertIsNone(self.guard('--new-token', '--new-receipt-key'))

    def test_a_first_run_after_the_writability_check_still_starts(self):
        self.mirror.touch()  # main() creates it empty to check its folder can be written
        (self.data / 'issued.log').touch()
        self.assertIsNone(self.guard())

    def test_the_mirror_alone_says_phones_exist(self):
        self.mirror.write_text('201\tHI2609-201\tserial:A\tnow\n')
        self.assertIn('missing', self.guard())

    def test_new_receipt_key_never_replaces_a_key_that_is_there(self):
        self.with_phones('tls-key.pem', 'token', 'receipt-key')
        self.assertIn('only replaces a LOST receipt key', self.guard('--new-receipt-key'))
        self.assertEqual((self.data / 'receipt-key').read_text(), 'x')

    def test_a_new_token_keeps_the_old_one_aside(self):
        self.with_phones('tls-key.pem', 'token', 'receipt-key')
        self.assertIsNone(self.guard('--new-token'))
        self.assertFalse((self.data / 'token').exists())
        self.assertEqual([p.read_text() for p in self.data.glob('token.replaced-*')], ['x'])
        self.assertTrue((self.data / 'receipt-key').exists())

    def test_the_mirror_must_be_writable_before_anything_starts(self):
        parent = Path(self.tmp.name, 'readonly')
        (parent / 'provisioning').mkdir(parents=True)
        parent.chmod(0o555)
        try:
            stderr = io.StringIO()
            with self.assertRaises(SystemExit), mock.patch('sys.stderr', stderr):
                server.main(['--host', '127.0.0.1', '--data-dir', str(parent / 'provisioning')])
            self.assertIn('provisioning.issued.log', stderr.getvalue())
        finally:
            parent.chmod(0o755)

    def test_a_new_identity_keeps_the_old_files_aside(self):
        self.with_phones('tls-key.pem', 'token', 'receipt-key')
        self.assertIsNone(self.guard('--new-identity'))
        self.assertFalse((self.data / 'tls-key.pem').exists())
        self.assertEqual(len(list(self.data.glob('tls-key.pem.replaced-*'))), 1)

    def test_an_empty_secret_file_is_refused_not_trusted(self):
        path = self.data / 'token'
        path.write_text('\n')
        with self.assertRaisesRegex(ValueError, 'empty'):
            server.ensure_secret(path)

    def test_rotating_the_token_changes_only_the_token(self):
        path = self.data / 'token'
        first = server.ensure_secret(path)
        self.assertEqual(server.ensure_secret(path), first)
        self.assertNotEqual(server.ensure_secret(path, rotate=True), first)


class Operator(unittest.TestCase):
    dpc = server.Dpc(Path('provisioner.apk'), b'apk', hashlib.sha256(b'apk').hexdigest(), 2, 'ab' * 32)

    def app(self):
        with tempfile.TemporaryDirectory() as tmp:
            registry = server.Registry(Path(tmp, 'p.db'), 'HI2609', 201, KEY)
        return server.App(registry, self.dpc, config(host='192.168.1.5', https_port=8443), (None, None, 'PIN'), 'T')

    def test_the_log_never_passes_control_characters_to_the_terminal(self):
        app, out = self.app(), io.StringIO()
        with mock.patch('sys.stdout', out):
            app.log('refused \x1b[2J\x1b[H10:00  HI2609-201  COMPLETE\nfake line\r')
        printed = out.getvalue()
        self.assertNotIn('\x1b', printed)
        self.assertEqual(printed.count('\n'), 1)
        self.assertIn('\\x1b[2J', printed)

    def watch(self, app, located, addresses, present, pinned=False):
        return server.AddressWatch(app, pinned=pinned, locate=lambda: located, present=lambda host: host in present(),
                                   addresses=lambda: list(addresses()))

    def test_a_move_repoints_the_qr_code_and_the_announcement(self):
        app, announced = self.app(), []
        app.announce = announced.append
        app.log = lambda message: None
        now = {'192.168.1.5'}
        watch = self.watch(app, '192.168.1.9', lambda: now, lambda: now)
        now = {'192.168.1.9'}  # a new DHCP lease
        watch.check()
        self.assertEqual(announced, ['192.168.1.9'])
        self.assertEqual(app.config.host, '192.168.1.9')
        extras = app.payload[server.EXTRA + 'PROVISIONING_ADMIN_EXTRAS_BUNDLE']
        self.assertEqual(extras['server'], 'https://192.168.1.9:8443')
        self.assertIn('192.168.1.9', app.payload[server.EXTRA + 'PROVISIONING_DEVICE_ADMIN_PACKAGE_DOWNLOAD_LOCATION'])
        self.assertEqual(app.moved_from, '192.168.1.5')

    def test_another_interface_taking_the_default_route_is_not_a_move(self):
        app, announced, logged = self.app(), [], []
        app.announce, app.log = announced.append, logged.append
        # A tether takes the default route, but the served address is still on the Wi-Fi.
        watch = self.watch(app, '172.20.10.2', lambda: {'192.168.1.5', '172.20.10.2'},
                           lambda: {'192.168.1.5', '172.20.10.2'})
        watch.check()
        self.assertEqual((announced, logged, app.config.host), ([], [], '192.168.1.5'))

    def test_a_blink_of_the_wifi_never_moves_the_server_onto_a_tether(self):
        app, announced, logged = self.app(), [], []
        app.announce, app.log = announced.append, logged.append
        now = {'192.168.1.5', '172.20.10.2'}
        watch = self.watch(app, '172.20.10.2', lambda: now, lambda: now)
        watch.check()
        now = {'172.20.10.2'}  # the router reboots; only the tether that was already there remains
        watch.check()
        self.assertEqual((announced, app.config.host), ([], '192.168.1.5'))
        self.assertEqual(len(logged), 1)  # it says the address is gone, once

    def test_the_server_moves_back_when_its_first_address_returns(self):
        app, announced = self.app(), []
        app.announce, app.log = announced.append, lambda message: None
        now = {'192.168.1.5'}
        watch = self.watch(app, '192.168.1.9', lambda: now, lambda: now)
        now = {'192.168.1.9'}
        watch.check()           # moved to the new lease
        now = {'192.168.1.5'}   # the first address returns and the new one goes
        watch.check()
        self.assertEqual(announced, ['192.168.1.9', '192.168.1.5'])
        self.assertEqual(app.config.host, '192.168.1.5')

    def test_a_located_address_that_is_not_there_is_not_moved_to(self):
        app, announced = self.app(), []
        app.announce, app.log = announced.append, lambda message: None
        now = {'192.168.1.5'}
        watch = self.watch(app, '10.0.0.7', lambda: now, lambda: now)
        now = set()
        watch.check()
        self.assertEqual(announced, [])

    def test_a_lost_address_is_said_once_and_again_after_it_came_back(self):
        app, logged = self.app(), []
        app.log = logged.append
        now = set()
        watch = self.watch(app, None, lambda: {'192.168.1.5'}, lambda: now)
        watch.check()
        watch.check()
        self.assertEqual(len(logged), 1)
        self.assertIn('no longer has the address 192.168.1.5', logged[0])
        now = {'192.168.1.5'}
        watch.check()
        now = set()
        watch.check()
        self.assertEqual(len(logged), 2)

    def test_a_failed_announcement_does_not_stop_the_move(self):
        app, logged = self.app(), []
        app.log = logged.append

        def broken(host):
            raise OSError('no socket')

        app.announce = broken
        app.move('192.168.1.9')
        self.assertEqual(app.config.host, '192.168.1.9')
        self.assertTrue(any('could not announce' in line for line in logged))

@unittest.skipUnless(shutil.which('openssl'), 'needs openssl to make the TLS key')
class LiveServer(unittest.TestCase):
    """Both listeners on real sockets, and the calls a phone makes to them."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        data = Path(self.tmp.name)
        self.apk = data / 'provisioner.apk'
        self.apk.write_bytes(signed_apk(b'release-cert', version_code=9))
        self.tls = server.ensure_tls(data)
        self.token = server.ensure_secret(data / 'token')
        self.app = server.App(server.Registry(data / 'p.db', 'HI2609', 201, KEY), server.Dpc.load(self.apk), config(),
                              self.tls, self.token, **self.delivery(data))
        self.logs = []
        self.app.log = self.logs.append
        self.lan, self.api = server.serve(self.app, bind='127.0.0.1')
        # The listeners took any free port; replies that name the LAN listener must name that one.
        self.app.config = dataclasses.replace(self.app.config, http_port=self.lan.server_address[1])

    def delivery(self, data: Path) -> dict:
        """The Hiraia APK, mirror and download cap the App is made with."""
        return {}

    def tearDown(self):
        for listener in (self.lan, self.api):
            listener.shutdown()
            listener.server_close()
        for held in (self.app.mirror, self.app.hiraia):
            if held:
                held.close()
        self.tmp.cleanup()

    def get(self, path, host=None):
        connection = http.client.HTTPConnection('127.0.0.1', self.lan.server_address[1], timeout=10)
        connection.request('GET', path, headers={'Host': host} if host else {})
        response = connection.getresponse()
        return response.status, response.read()

    def api_call(self, method, path, body=None, token=None, device=None, raw=None, headers=None):
        # Trust exactly as the phone does: any certificate, then compare its public key with the pin.
        context = ssl.create_default_context()
        context.check_hostname, context.verify_mode = False, ssl.CERT_NONE
        connection = http.client.HTTPSConnection('127.0.0.1', self.api.server_address[1], context=context, timeout=10)
        connection.connect()
        der = connection.sock.getpeercert(binary_form=True)
        self.assertEqual(server.b64url(hashlib.sha256(server.subject_public_key_info(der)).digest()), self.tls[2])
        auth = {'Authorization': f'Bearer {token or self.token}'}
        if device:
            auth = {'Authorization': f'Bearer {device[1]}', 'X-Hiraia-Id': device[0]}
        data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
        connection.request(method, path, data, {**auth, **(headers or {})})
        response = connection.getresponse()
        payload = response.read()
        self.headers = response.headers
        kind = response.getheader('Content-Type', '')
        return response.status, json.loads(payload) if 'json' in kind else payload

    def register(self, key='serial:JP1', **fields):
        status, reply = self.api_call('POST', '/api/register', inventory(key, **fields))
        self.assertEqual(status, 200, reply)
        self.assertEqual(reply['receipt'], self.app.registry.receipt(key, reply['hiraia_id']))
        self.registered = reply
        return reply['hiraia_id'], reply['secret']


class Listeners(LiveServer):

    def test_serves_the_dpc_apk(self):
        self.assertEqual(self.get('/provisioner.apk'), (200, self.apk.read_bytes()))

    def test_operator_pages_render_for_the_laptop(self):
        self.register('serial:X', model='<script>')
        status, page = self.get('/')
        self.assertEqual(status, 200)
        self.assertIn(b'HI2609-201', page)
        self.assertIn(b'&lt;script&gt;', page)
        self.assertNotIn(b'<script>', page)
        status, csv_text = self.get('/export/devices.csv')
        self.assertEqual(status, 200)
        self.assertTrue(csv_text.startswith(b'hiraia_id,status'))
        status, qr = self.get('/qr')
        self.assertIn(f'--es pin {self.tls[2]} --es token {self.token}'.encode(), qr)
        self.assertIn(b'http-equiv="refresh"', qr)  # an open tab follows a move of the laptop

    def test_operator_pages_refuse_a_rebound_host_name(self):
        for path in ['/', '/qr', '/qr.svg', '/export/devices.csv']:
            self.assertEqual(self.get(path, host=f'evil.example:{self.lan.server_address[1]}')[0], 404, path)
        self.assertEqual(self.get('/provisioner.apk', host='evil.example')[0], 200)

    def test_operator_pages_are_hidden_from_the_lan(self):
        address = server.lan_address()
        if not address or address.startswith('127.'):
            self.skipTest('no LAN address to connect from')
        self.lan.shutdown()
        self.lan.server_close()
        self.lan = server.LanServer((address, 0), type('Lan', (server.LanHandler,), {'app': self.app}))
        threading.Thread(target=self.lan.serve_forever, daemon=True).start()
        port = self.lan.server_address[1]
        connection = http.client.HTTPConnection(address, port, timeout=10)
        # From the LAN, even a request that names the loopback address in Host is refused.
        for host in [None, f'127.0.0.1:{port}', f'localhost:{port}']:
            for path, expected in [('/', 404), ('/qr', 404), ('/qr.svg', 404), ('/export/devices.csv', 404),
                                   ('/provisioner.apk', 200)]:
                connection.request('GET', path, headers={'Host': host} if host else {})
                response = connection.getresponse()
                response.read()
                self.assertEqual(response.status, expected, f'{path} Host={host}')

    def test_register_report_check_in_and_update(self):
        device = self.register()
        self.assertEqual(device[0], 'HI2609-201')
        self.assertEqual(self.api_call('POST', '/api/report', {'status': 'COMPLETE'}, device=device), (200, {'ok': True}))
        self.assertEqual(self.app.registry.devices()[0]['status'], 'COMPLETE')
        status, offer = self.api_call('POST', '/api/checkin', {'dpc_version_code': 1, 'dpc_version': '0.1.0',
                                                                'status': 'COMPLETE'}, device=device)
        self.assertEqual((status, offer['dpc']['version_code'], offer['dpc']['size']), (200, 9, len(self.apk.read_bytes())))
        self.assertEqual(self.app.registry.devices()[0]['dpc_version_code'], 1)
        status, apk = self.api_call('GET', '/api/dpc.apk', device=device)
        self.assertEqual((status, hashlib.sha256(apk).hexdigest()), (200, offer['dpc']['sha256']))

    def test_a_check_in_restores_complete_after_a_re_registration(self):
        device = self.register()
        self.api_call('POST', '/api/report', {'status': 'COMPLETE'}, device=device)
        device = self.register()  # lost its secret, so the row reads REGISTERED again
        self.assertEqual(self.app.registry.devices()[0]['status'], 'REGISTERED')
        self.api_call('POST', '/api/checkin', {'dpc_version_code': 2, 'status': 'COMPLETE'}, device=device)
        self.assertEqual(self.app.registry.devices()[0]['status'], 'COMPLETE')

    def test_after_a_new_token_a_phone_re_registers_with_its_receipt(self):
        status, first = self.api_call('POST', '/api/register', inventory('serial:JP1'))
        self.app.token = 'the-new-token'  # --new-token; the phone still holds the one from its QR code
        claim = inventory('serial:JP1', hiraia_id=first['hiraia_id'], id_receipt=first['receipt'])
        status, again = self.api_call('POST', '/api/register', claim)
        self.assertEqual((status, again['hiraia_id']), (200, first['hiraia_id']))
        self.assertTrue(any('(by receipt)' in line for line in self.logs))
        # Without a receipt, or with one for another phone's row, the old token is simply refused.
        self.assertEqual(self.api_call('POST', '/api/register', inventory('serial:NEW'))[0], 401)
        forged = inventory('serial:OTHER', hiraia_id=first['hiraia_id'], id_receipt=first['receipt'])
        self.assertEqual(self.api_call('POST', '/api/register', forged)[0], 401)
        self.assertTrue(any('registration refused: wrong token (serial:NEW)' in line for line in self.logs))

    def test_a_disk_that_cannot_record_a_phone_answers_503(self):
        with mock.patch.object(self.app.registry, 'register', side_effect=OSError(13, 'Permission denied')):
            self.assertEqual(self.api_call('POST', '/api/register', inventory('serial:DISK'))[0], 503)
        self.assertTrue(any('registration failed' in line for line in self.logs))

    def test_a_clash_is_refused_and_shown_on_the_dashboard(self):
        self.register('serial:DUP', imei=['861234567890123'])
        status, reply = self.api_call('POST', '/api/register', inventory('serial:DUP', imei=['869999999999999']))
        self.assertEqual(status, 409)
        self.assertTrue(self.app.registry.devices()[0]['detail'].startswith('CONFLICT:'))

    def test_only_a_rejected_key_is_blamed_on_the_qr_code(self):
        port = self.api.server_address[1]
        socket.create_connection(('127.0.0.1', port), timeout=5).close()  # a port scan, not a phone
        with tempfile.TemporaryDirectory() as other:
            stranger, _, _ = server.ensure_tls(Path(other))  # a QR code from another server identity
            context = ssl.create_default_context(cafile=str(stranger))
            context.check_hostname = False
            with self.assertRaises(ssl.SSLError):
                with socket.create_connection(('127.0.0.1', port), timeout=5) as raw:
                    context.wrap_socket(raw)
        deadline = __import__('time').monotonic() + 5
        while not any('rejected this server' in line for line in self.logs) and __import__('time').monotonic() < deadline:
            threading.Event().wait(0.05)
        rejections = [line for line in self.logs if 'rejected this server' in line]
        self.assertEqual(len(rejections), 1, self.logs)
        self.assertIn('UNKNOWN_CA', rejections[0])

    def test_a_phone_can_only_speak_for_itself(self):
        a = self.register('serial:A')
        b = self.register('serial:B')
        self.assertEqual(self.api_call('POST', '/api/report', {'status': 'ERROR'}, device=(b[0], a[1]))[0], 401)
        self.assertEqual(self.api_call('POST', '/api/report', {'status': 'ERROR'}, device=(b[0], self.token))[0], 401)
        self.assertEqual(self.api_call('GET', '/api/dpc.apk', device=('HI2609-999', a[1]))[0], 401)
        self.assertEqual(self.api_call('GET', '/api/dpc.apk')[0], 401)
        self.assertEqual([d['status'] for d in self.app.registry.devices()], ['REGISTERED', 'REGISTERED'])

    def test_refusals_arrive_intact_even_when_the_body_is_sent_separately(self):
        # http.client writes the headers and the body separately. Answering before reading the
        # body would make the kernel reset the connection and lose the refusal.
        for _ in range(20):
            self.assertEqual(self.api_call('POST', '/api/register', inventory('serial:A'), token='wrong')[0], 401)

    def test_the_api_refuses_what_a_phone_would_not_send(self):
        device = self.register('serial:OK')
        self.assertEqual(self.api_call('POST', '/api/register', {'device_key': 'nope'})[0], 400)
        self.assertEqual(self.api_call('POST', '/api/register', None, raw=b'{not json')[0], 400)
        self.assertEqual(self.api_call('POST', '/api/register', inventory('serial:B', ram_total_bytes=10**400))[0], 400)
        self.assertEqual(self.api_call('POST', '/api/report', {'status': 'HACKED'}, device=device)[0], 400)
        self.assertEqual(self.api_call('POST', '/api/report', {'status': ['COMPLETE']}, device=device)[0], 400)
        self.assertEqual(self.api_call('POST', '/api/checkin', {'dpc_version_code': 1, 'status': {}}, device=device)[0],
                         400)
        self.assertEqual(self.api_call('POST', '/api/checkin', {'dpc_version_code': 'x', 'status': 'COMPLETE'},
                                       device=device)[0], 400)
        self.assertEqual(self.api_call('POST', '/api/checkin', {'dpc_version_code': 1, 'status': 'HACKED'},
                                       device=device)[0], 400)
        self.register('serial:DUP', imei=['861234567890123'])
        self.assertEqual(self.api_call('POST', '/api/register', inventory('serial:DUP', imei=['869999999999999']))[0],
                         409)
        self.assertEqual(self.api_call('POST', '/api/nothing', {})[0], 404)
        status, _ = self.api_call('POST', '/api/register', None, raw=b'x' * (server.MAX_BODY + 1))
        self.assertEqual(status, 413)
        self.assertEqual(len(self.app.registry.devices()), 2)


HIRAIA_CERT = b'hiraia-release-cert'
HIRAIA_SIGNER = hashlib.sha256(HIRAIA_CERT).hexdigest()


def hiraia_apk(certificate: bytes = HIRAIA_CERT, package='com.hiraia.app', version_code=24, version_name='0.4.24',
               also=((server.V3_BLOCK_ID, HIRAIA_CERT),)):
    """Signed with v2 and v3, as sign-apk.sh signs Hiraia's release."""
    return signed_apk(certificate, version_code=version_code, also=also, package=package, version_name=version_name)


def asset(name: str, content: bytes) -> server.Asset:
    return server.Asset(name, len(content), hashlib.md5(content).hexdigest())


def fingerprint(data: bytes) -> tuple[int, str]:
    """What tests compare large bodies by: a failing assertEqual would otherwise diff megabytes."""
    return len(data), hashlib.sha256(data).hexdigest()[:16]


def released_hiraia_apk() -> Path | None:
    """The newest Hiraia release build on this laptop, if there is one."""
    found = sorted((server.REPO / 'packages/mobile/android/app/build/outputs/apk/release').glob('hiraia-v*.apk'),
                   key=lambda path: path.stat().st_mtime)
    return found[-1] if found else None


class HiraiaManifest(unittest.TestCase):
    def test_reads_the_package_and_version_name_too(self):
        self.assertEqual(server.apk_manifest(hiraia_apk()), server.Manifest('com.hiraia.app', 24, '0.4.24'))

    def test_a_manifest_without_them_has_neither(self):
        self.assertEqual(server.apk_manifest(signed_apk(b'c', version_code=5)), server.Manifest(None, 5, None))

    def test_reads_an_open_file_as_well_as_bytes(self):
        self.assertEqual(server.apk_manifest(io.BytesIO(hiraia_apk())).package, 'com.hiraia.app')

    def test_agrees_with_the_android_build_tools_on_the_hiraia_release(self):
        apk, apksigner, aapt2 = released_hiraia_apk(), build_tool('apksigner'), build_tool('aapt2')
        if not apk or not apksigner or not aapt2:
            self.skipTest('needs a Hiraia release APK and the Android build tools')
        if subprocess.run([str(apksigner), '--version'], capture_output=True).returncode:
            self.skipTest('apksigner has no Java runtime (set JAVA_HOME to a JDK 17)')
        with tempfile.TemporaryDirectory() as tmp:
            hiraia = server.HiraiaApk.snapshot(apk, Path(tmp))  # the real release key, as main() checks it
            try:
                badging = subprocess.run([str(aapt2), 'dump', 'badging', str(apk)],
                                         capture_output=True, text=True, check=True).stdout
                self.assertIn(f"package: name='com.hiraia.app' versionCode='{hiraia.version_code}' "
                              f"versionName='{hiraia.version_name}'", badging)
                certs = subprocess.run([str(apksigner), 'verify', '--print-certs', str(apk)],
                                       capture_output=True, text=True, check=True).stdout
                self.assertIn(f'certificate SHA-256 digest: {server.HIRAIA_SIGNER}', certs)
                self.assertEqual(hiraia.sha256, hashlib.sha256(apk.read_bytes()).hexdigest())
            finally:
                hiraia.close()


class HiraiaOffer(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.mirror = self.root / 'mirror'

    def tearDown(self):
        self.tmp.cleanup()

    def offer(self, apk: bytes, signer=HIRAIA_SIGNER) -> server.HiraiaApk:
        source = self.root / 'hiraia.apk'
        source.write_bytes(apk)
        hiraia = server.HiraiaApk.snapshot(source, self.mirror, signer=signer)
        self.addCleanup(hiraia.close)
        return hiraia

    def test_offers_a_snapshot_of_the_release_apk(self):
        apk = hiraia_apk()
        hiraia = self.offer(apk)
        sha256 = hashlib.sha256(apk).hexdigest()
        self.assertEqual(hiraia.offer, {'package': 'com.hiraia.app', 'version_code': 24, 'version_name': '0.4.24',
                                        'sha256': sha256, 'size': len(apk)})
        self.assertEqual(hiraia.path, self.mirror / 'apk' / f'{sha256}.apk')
        (self.root / 'hiraia.apk').write_bytes(hiraia_apk(version_code=25))  # a rebuild mid-session
        self.assertEqual(hiraia.path.read_bytes(), apk)
        self.assertEqual(os.pread(hiraia.file.fileno(), len(apk) + 1, 0), apk)

    def test_a_new_snapshot_replaces_the_old_one(self):
        first = self.offer(hiraia_apk(version_code=24))
        second = self.offer(hiraia_apk(version_code=25))
        self.assertEqual(sorted((self.mirror / 'apk').iterdir()), [second.path])
        self.assertFalse(first.path.exists())

    def refused(self, apk: bytes, reason: str, **signer):
        with self.assertRaisesRegex(ValueError, reason):
            self.offer(apk, **signer)
        self.assertEqual(list((self.mirror / 'apk').iterdir()), [], 'nothing refused is kept')

    def test_refuses_another_signer(self):
        self.refused(hiraia_apk(b'someone-else', also=()), 'not signed with Hiraia\'s release key')

    def test_every_signature_must_name_hiraias_key(self):
        # Android 13 takes the signer from a v3.1 signature and never looks at the v3 one beneath it.
        hijacked = hiraia_apk(also=((server.V3_BLOCK_ID, HIRAIA_CERT), (server.V31_BLOCK_ID, b'someone-else')))
        self.refused(hijacked, 'not signed with Hiraia\'s release key')
        self.refused(hiraia_apk(also=((server.V3_BLOCK_ID, b'someone-else'),)), 'not signed with Hiraia\'s release key')
        self.refused(hiraia_apk(b'someone-else'), 'not signed with Hiraia\'s release key')  # its v2 signature

    def test_pins_hiraias_own_release_key_by_default(self):
        source = self.root / 'hiraia.apk'
        source.write_bytes(hiraia_apk())  # signed with the tests' key, not Hiraia's
        with self.assertRaisesRegex(ValueError, 'not signed with Hiraia\'s release key'):
            server.HiraiaApk.snapshot(source, self.mirror)
        self.assertEqual(list((self.mirror / 'apk').iterdir()), [], 'nothing refused is kept')

    def test_refuses_another_app_signed_with_the_same_key(self):
        self.refused(hiraia_apk(package='com.hiraia.tala'), 'com.hiraia.tala, not com.hiraia.app')
        self.refused(hiraia_apk(package=None), 'without a package name')

    def test_refuses_an_apk_without_a_version_name(self):
        self.refused(hiraia_apk(version_name=None), 'no versionName')

    def test_the_server_will_not_start_offering_a_wrong_apk(self):
        dpc = self.root / 'provisioner.apk'
        dpc.write_bytes(signed_apk(b'release', version_code=3))
        (self.root / 'wrong.apk').write_bytes(hiraia_apk(b'someone-else'))
        stderr = io.StringIO()
        # Were the check ever to let it through, the server must not start for real: no listener
        # on this laptop's own ports, where the operator's server may be running.
        with self.assertRaises(SystemExit), mock.patch('sys.stderr', stderr), mock.patch('sys.stdout', io.StringIO()), \
                mock.patch.object(server, 'serve', side_effect=AssertionError('the server started')):
            server.main(['--host', '127.0.0.1', '--http-port', '0', '--https-port', '0', '--dpc-apk', str(dpc),
                         '--data-dir', str(self.root / 'data'), '--mirror-dir', str(self.mirror),
                         '--hiraia-apk', str(self.root / 'wrong.apk')])
        self.assertIn('will not offer', stderr.getvalue())


MODEL_ASSETS = {
    'base': {'filename': 'hiraia-sft-2b-v2.Q4_K_M.gguf', 'bytes': 1274396160,
             'md5': 'fe2d0ab2ad856f2a42c5add5872c4234'},
    'vectors': {'filename': 'vectors.bin', 'bytes': 10, 'md5': '69d152b4c38b619d4f019e652384d9b6'},
    'embedder': {'filename': 'labse.gguf', 'bytes': 20, 'md5': '2667f69edfbcb68acf617187fe817fae'},
}


class KnownAssets(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_reads_hiraias_own_tables(self):
        known = {a.name: a for a in server.known_assets()}
        self.assertEqual(known['labse.Q4_K_M.gguf'],
                         server.Asset('labse.Q4_K_M.gguf', 383762048, '2667f69edfbcb68acf617187fe817fae'))
        self.assertEqual(known['vectors-labse-3a36094d18d2.i8.bin'],
                         server.Asset('vectors-labse-3a36094d18d2.i8.bin', 122162688, '3d555f7450025a208ca65f2f02436759'))
        self.assertEqual(known['hiraia-sft-2b-v2.Q4_K_M.gguf'],
                         server.Asset('hiraia-sft-2b-v2.Q4_K_M.gguf', 1274396160, 'fe2d0ab2ad856f2a42c5add5872c4234'))
        packs = json.loads(server.BUNDLED_IMAGE_PACKS.read_text())['packs']
        packs += json.loads(server.ASSET_UPDATES.read_text())['imagePacks']
        self.assertEqual({name for name in known if name.startswith('images/')},
                         {'images/' + pack['filename'] for pack in packs})
        for pack in packs:
            self.assertEqual(known['images/' + pack['filename']].md5, pack['md5'])
        self.assertNotIn('hiraia-sft-2b-v2.Q4_K_M.gguf', {a.name for a in server.known_assets(with_llm=False)})

    def tables(self, models=None, bundled=None, updates=None, with_llm=True, voices=None):
        paths = [self.root / name for name in ['models.json', 'bundled.json', 'updates.json', 'voices.json']]
        paths[0].write_text(json.dumps(MODEL_ASSETS if models is None else models))
        paths[1].write_text(json.dumps({'packs': bundled or []}))
        paths[2].write_text(json.dumps({'models': [], 'imagePacks': updates or []}))
        paths[3].write_text(json.dumps({'format': 1, 'voices': voices or {}}))
        return server.known_assets(with_llm, *paths)

    def test_reads_shared_model_and_both_pack_lists(self):
        pack = {'filename': 'common-01-a.hpak', 'bytes': 5, 'md5': 'a' * 32}
        other = {'filename': 'g5-all-01-b.hpak', 'bytes': 6, 'md5': 'b' * 32}
        names = [(a.name, a.size) for a in self.tables(bundled=[pack], updates=[pack, other])]
        self.assertEqual(names, [('labse.gguf', 20), ('vectors.bin', 10), ('hiraia-sft-2b-v2.Q4_K_M.gguf', 1274396160),
                                 ('images/common-01-a.hpak', 5), ('images/g5-all-01-b.hpak', 6)])

    def test_missing_extra_and_unpinned_models_stop_it(self):
        for mutate in [lambda m: m.pop('embedder'), lambda m: m.update(extra=m['vectors']),
                       lambda m: m['vectors'].update(md5='NOT-HEX'),
                       lambda m: m['vectors'].update(bytes=True),
                       lambda m: m['vectors'].update(filename='../escape.bin')]:
            broken = json.loads(json.dumps(MODEL_ASSETS))
            mutate(broken)
            with self.assertRaises(ValueError):
                self.tables(models=broken)

    def test_downloadable_voice_is_mirrored_and_bundled_voice_is_not_required(self):
        en = {'filename': 'voice-en.onnx', 'bytes': 10, 'md5': 'a' * 32, 'delivery': 'bundled'}
        tl = {'filename': 'voice-tl.onnx', 'bytes': 12, 'md5': 'b' * 32, 'delivery': 'download'}
        known = {a.name: a for a in self.tables(voices={'en': en, 'tl': tl})}
        self.assertEqual(known['voice-tl.onnx'], server.Asset('voice-tl.onnx', 12, 'b' * 32))
        self.assertNotIn('voice-en.onnx', known)
        for broken in [{**tl, 'delivery': 'unknown'}, {**tl, 'md5': ''}]:
            with self.assertRaises(ValueError):
                self.tables(voices={'tl': broken})

    def test_real_downloadable_voice_is_in_inventory(self):
        voices = json.loads(server.VOICE_CATALOG.read_text())['voices']
        known = {a.name: a for a in server.known_assets()}
        for voice in voices.values():
            if voice['delivery'] == 'download':
                self.assertEqual(known[voice['filename']], server.Asset(voice['filename'], voice['bytes'], voice['md5']))

    def test_refuses_pack_names_that_are_not_plain_filenames_or_that_disagree(self):
        for pack in [{'filename': '../escape.hpak', 'bytes': 5, 'md5': 'a' * 32},
                     {'filename': 'a/b.hpak', 'bytes': 5, 'md5': 'a' * 32},
                     {'filename': 'x.hpak', 'bytes': 0, 'md5': 'a' * 32},
                     {'filename': 'x.hpak', 'bytes': True, 'md5': 'a' * 32}]:
            with self.assertRaises(ValueError, msg=pack):
                self.tables(bundled=[pack])
        with self.assertRaisesRegex(ValueError, 'listed twice'):
            self.tables(bundled=[{'filename': 'x.hpak', 'bytes': 5, 'md5': 'a' * 32}],
                        updates=[{'filename': 'x.hpak', 'bytes': 5, 'md5': 'b' * 32}])

    def test_the_server_will_not_start_without_them(self):
        stderr = io.StringIO()
        with self.assertRaises(SystemExit), mock.patch('sys.stderr', stderr), \
                mock.patch.object(server, 'known_assets', side_effect=ValueError('invalid model asset inventory')):
            server.main(['--sync-mirror', '--mirror-dir', str(self.root)])
        self.assertIn('invalid model asset inventory', stderr.getvalue())


class CompleteMirrorGate(unittest.TestCase):
    def test_missing_or_corrupt_assets_prevent_serving_before_identity_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for corrupt in [False, True]:
                mirror = root / ('corrupt' if corrupt else 'missing')
                (mirror / 'models').mkdir(parents=True)
                if corrupt:
                    (mirror / 'models/x.bin').write_bytes(b'wrong')
                assets = [server.Asset('x.bin', 5, hashlib.md5(b'right').hexdigest())]
                with mock.patch.object(server, 'known_assets', return_value=assets), \
                     mock.patch.object(server.Dpc, 'load'), mock.patch.object(server, 'guard_identity') as identity, \
                     mock.patch.object(server, 'serve') as serve, mock.patch('sys.stderr', io.StringIO()), \
                     mock.patch('sys.stdout', io.StringIO()), self.assertRaises(SystemExit) as stopped:
                    server.main(['--require-complete-mirror', '--host', '192.168.68.66',
                                 '--data-dir', str(root / 'identity'), '--mirror-dir', str(mirror)])
                self.assertEqual(stopped.exception.code, 2)
                identity.assert_not_called()
                serve.assert_not_called()

    def test_with_llm_requires_the_model_too(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            model = server.Asset('base.gguf', 5, hashlib.md5(b'right').hexdigest())
            with mock.patch.object(server, 'known_assets', side_effect=lambda with_llm=True: [model] if with_llm else []), \
                 mock.patch.object(server.Dpc, 'load'), mock.patch.object(server, 'serve') as serve, \
                 mock.patch('sys.stderr', io.StringIO()), mock.patch('sys.stdout', io.StringIO()), \
                 self.assertRaises(SystemExit) as stopped:
                server.main(['--require-complete-mirror', '--with-llm', '--host', '192.168.68.66',
                             '--data-dir', str(root / 'identity'), '--mirror-dir', str(root / 'mirror')])
            self.assertEqual(stopped.exception.code, 2)
            serve.assert_not_called()


class ContentKinds(unittest.TestCase):
    def test_every_real_asset_has_the_right_kind(self):
        kinds = {asset.name: server.content_kind(asset.name) for asset in server.known_assets()}
        self.assertEqual(kinds['labse.Q4_K_M.gguf'], 'labse')
        self.assertEqual(kinds['voice-tl-28d68857286c77cf.onnx'], 'voice')
        self.assertEqual([k for n, k in kinds.items() if n.startswith('vectors-')], ['vectors'])
        self.assertTrue(all(k == 'images' for n, k in kinds.items() if n.startswith('images/')))
        self.assertEqual(kinds['hiraia-sft-2b-v2.Q4_K_M.gguf'], 'model')


class ByteRanges(unittest.TestCase):
    def test_the_three_forms(self):
        for header, expected in [('bytes=0-', (0, 99)), ('bytes=40-', (40, 99)), ('bytes=99-', (99, 99)),
                                 ('bytes=10-19', (10, 19)), ('bytes=10-10', (10, 10)), ('bytes=90-500', (90, 99)),
                                 ('bytes=-5', (95, 99)), ('bytes=-500', (0, 99)), (' bytes=7- ', (7, 99))]:
            self.assertEqual(server.byte_range(header, 100), expected, header)

    def test_past_the_end_is_unsatisfiable(self):
        for header in ['bytes=100-', 'bytes=100-200', 'bytes=-0', 'bytes=5000-']:
            with self.assertRaises(server.Unsatisfiable, msg=header):
                server.byte_range(header, 100)

    def test_anything_else_means_the_whole_file(self):
        for header in [None, '', 'bytes=-', 'bytes=20-10', 'bytes=0-1,5-6', 'items=0-5', 'bytes=a-', 'bytes 5-']:
            self.assertIsNone(server.byte_range(header, 100), header)

    def test_numbers_of_any_length_are_read_as_positions(self):
        # Python will not read a number of thousands of digits; anyone on the LAN can send one.
        huge = '9' * 5000
        self.assertEqual(server.byte_range(f'bytes=0-{huge}', 100), (0, 99))
        self.assertEqual(server.byte_range(f'bytes=-{huge}', 100), (0, 99))
        self.assertEqual(server.byte_range('bytes=' + '0' * 5000 + '7-', 100), (7, 99))
        with self.assertRaises(server.Unsatisfiable):
            server.byte_range(f'bytes={huge}-', 100)


class Origin(http.server.ThreadingHTTPServer):
    """A stand-in for assets.hiraia.org: serves `files` under /models/, honours `Range: bytes=N-`
    unless told otherwise, and records every request. Files named in `unsized` are sent without a
    Content-Length, ending when the connection closes."""
    daemon_threads = True

    def __init__(self, files: dict[str, bytes]):
        self.files, self.requests, self.ignore_range, self.unsized = files, [], False, set()

        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                origin, name = self.server, self.path.removeprefix('/models/')
                origin.requests.append((name, self.headers.get('Range')))
                if name not in origin.files:
                    self.send_response(404)
                    self.send_header('Content-Length', '0')
                    return self.end_headers()
                body, wanted = origin.files[name], self.headers.get('Range')
                if wanted and not origin.ignore_range:
                    first = int(wanted.removeprefix('bytes=').rstrip('-'))
                    if first >= len(body):
                        self.send_response(416)
                        self.send_header('Content-Range', f'bytes */{len(body)}')
                        self.send_header('Content-Length', '0')
                        return self.end_headers()
                    self.send_response(206)
                    self.send_header('Content-Range', f'bytes {first}-{len(body) - 1}/{len(body)}')
                    body = body[first:]
                else:
                    self.send_response(200)
                if name not in origin.unsized:
                    self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        super().__init__(('127.0.0.1', 0), Handler)
        threading.Thread(target=self.serve_forever, daemon=True).start()

    @property
    def url(self) -> str:
        return f'http://127.0.0.1:{self.server_address[1]}/models'


class Sync(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.content = {'labse.gguf': os.urandom(2 * server.CHUNK + 12345), 'vectors.bin': os.urandom(70_000),
                        'images/common-01-x.hpak': os.urandom(40_000)}
        self.assets = [asset(name, body) for name, body in self.content.items()]
        self.origin = Origin(dict(self.content))
        self.logs = []

    def tearDown(self):
        self.origin.shutdown()
        self.origin.server_close()
        self.tmp.cleanup()

    def sync(self) -> bool:
        return server.sync_mirror(self.root, self.assets, self.origin.url, log=self.logs.append, retry_wait=0)

    def path(self, name: str) -> Path:
        return self.root / 'models' / name

    def test_fetches_verifies_and_does_nothing_the_second_time(self):
        self.assertTrue(self.sync())
        for name, body in self.content.items():
            self.assertEqual(self.path(name).read_bytes(), body, name)
        self.assertEqual(list(self.root.glob('**/*.part')), [])
        self.origin.requests.clear()
        self.assertTrue(self.sync())
        self.assertEqual(self.origin.requests, [])

    def test_resumes_a_part_file_with_a_range_request(self):
        body = self.content['labse.gguf']
        (self.root / 'models').mkdir()
        self.path('labse.gguf.part').write_bytes(body[:1_500_000])
        self.assertTrue(self.sync())
        self.assertIn(('labse.gguf', 'bytes=1500000-'), self.origin.requests)
        self.assertEqual(self.path('labse.gguf').read_bytes(), body)

    def test_a_complete_partial_is_checked_and_kept_without_a_download(self):
        (self.root / 'models').mkdir()
        self.path('labse.gguf.part').write_bytes(self.content['labse.gguf'])  # stopped just before the rename
        self.assertTrue(self.sync())
        self.assertEqual(self.path('labse.gguf').read_bytes(), self.content['labse.gguf'])
        self.assertNotIn('labse.gguf', [name for name, _ in self.origin.requests])

    def test_an_origin_that_ignores_range_restarts_the_file_rather_than_splice_it(self):
        self.origin.ignore_range = True
        (self.root / 'models').mkdir()
        self.path('labse.gguf.part').write_bytes(self.content['labse.gguf'][:1000])
        self.assertTrue(self.sync())
        self.assertEqual(self.path('labse.gguf').read_bytes(), self.content['labse.gguf'])
        self.assertEqual([r for r in self.origin.requests if r[0] == 'labse.gguf'], [('labse.gguf', 'bytes=1000-')])

    def test_bytes_that_do_not_match_are_never_installed(self):
        self.origin.files['vectors.bin'] = bytes(len(self.content['vectors.bin']))  # right length, wrong bytes
        self.assertFalse(self.sync())
        self.assertFalse(self.path('vectors.bin').exists())
        self.assertFalse(self.path('vectors.bin.part').exists())
        self.assertEqual([r for r in self.origin.requests if r[0] == 'vectors.bin'], [('vectors.bin', None)],
                         'a whole body that is wrong would be wrong again: not fetched twice')
        self.assertTrue(any('FAILED  vectors.bin' in line for line in self.logs))
        self.assertEqual(self.path('labse.gguf').read_bytes(), self.content['labse.gguf'])

    def test_a_poisoned_partial_is_discarded_and_fetched_again_from_zero(self):
        (self.root / 'models').mkdir()
        self.path('vectors.bin.part').write_bytes(b'<html>captive portal</html>')
        self.assertTrue(self.sync())
        self.assertEqual(self.path('vectors.bin').read_bytes(), self.content['vectors.bin'])
        self.assertEqual([r for r in self.origin.requests if r[0] == 'vectors.bin'],
                         [('vectors.bin', 'bytes=27-'), ('vectors.bin', None)])

    def test_a_body_that_is_not_the_file_by_its_length_is_never_written(self):
        self.origin.files['vectors.bin'] = b'<html>Log in to the school Wi-Fi</html>'
        self.assertFalse(self.sync())
        self.assertFalse(self.path('vectors.bin').exists())
        self.assertFalse(self.path('vectors.bin.part').exists(), 'nothing to resume onto later')
        self.assertTrue(any('answered 200 with 39 bytes' in line for line in self.logs), self.logs)

    def test_a_longer_body_of_unknown_length_is_cut_off_and_not_installed(self):
        self.origin.files['vectors.bin'] = self.content['vectors.bin'] + b'more'
        self.origin.unsized.add('vectors.bin')
        self.assertFalse(self.sync())
        self.assertFalse(self.path('vectors.bin').exists())
        self.assertTrue(any('more than the' in line for line in self.logs))

    def test_a_resume_answered_for_a_file_of_another_size_writes_nothing(self):
        body = self.content['vectors.bin']
        self.origin.files['vectors.bin'] = body + b'a newer, longer file'
        (self.root / 'models').mkdir()
        self.path('vectors.bin.part').write_bytes(body[:1000])
        self.assertFalse(self.sync())
        self.assertEqual(self.path('vectors.bin.part').read_bytes(), body[:1000])
        self.assertTrue(any(f'bytes 1000-{len(body) + 19}/{len(body) + 20}' in line for line in self.logs), self.logs)

    def test_a_partial_longer_than_the_origins_file_is_dropped(self):
        body = self.content['vectors.bin']
        self.origin.files['vectors.bin'] = body[:1000]  # the origin holds some other, shorter file
        (self.root / 'models').mkdir()
        self.path('vectors.bin.part').write_bytes(body[:2000])
        self.assertFalse(self.sync())
        self.assertFalse(self.path('vectors.bin.part').exists())
        self.assertEqual([r for r in self.origin.requests if r[0] == 'vectors.bin'][:2],
                         [('vectors.bin', 'bytes=2000-'), ('vectors.bin', None)])

    def test_a_short_body_that_says_it_is_the_file_is_kept_to_resume(self):
        self.origin.files['vectors.bin'] = self.content['vectors.bin'][:5000]
        self.origin.unsized.add('vectors.bin')  # a transfer cut off: no length said, fewer bytes came
        self.assertFalse(self.sync())
        self.assertEqual(self.path('vectors.bin.part').read_bytes(), self.content['vectors.bin'][:5000])
        self.origin.files['vectors.bin'] = self.content['vectors.bin']
        self.origin.unsized.clear()
        self.assertTrue(self.sync())
        self.assertIn(('vectors.bin', 'bytes=5000-'), self.origin.requests)
        self.assertEqual(self.path('vectors.bin').read_bytes(), self.content['vectors.bin'])

    def test_a_file_in_place_that_does_not_match_is_fetched_again(self):
        (self.root / 'models').mkdir()
        self.path('vectors.bin').write_bytes(bytes(len(self.content['vectors.bin'])))
        self.assertTrue(self.sync())
        self.assertEqual(self.path('vectors.bin').read_bytes(), self.content['vectors.bin'])

    def test_a_missing_file_fails_the_sync(self):
        del self.origin.files['images/common-01-x.hpak']
        self.assertFalse(self.sync())
        self.assertFalse(self.path('images/common-01-x.hpak').exists())

    def test_from_the_command_line(self):
        with mock.patch.object(server, 'known_assets', return_value=self.assets), \
                mock.patch('sys.stdout', io.StringIO()) as out:
            with self.assertRaises(SystemExit) as done:
                server.main(['--sync-mirror', '--mirror-dir', str(self.root), '--mirror-origin', self.origin.url])
        self.assertEqual(done.exception.code, 0)
        self.assertIn('holds 3 of 3 files', out.getvalue())
        self.origin.files['vectors.bin'] = b'x' * len(self.content['vectors.bin'])
        self.path('vectors.bin').unlink()
        with mock.patch.object(server, 'known_assets', return_value=self.assets), mock.patch('sys.stdout', io.StringIO()):
            with self.assertRaises(SystemExit) as done:
                server.main(['--sync-mirror', '--mirror-dir', str(self.root), '--mirror-origin', self.origin.url])
        self.assertEqual(done.exception.code, 1)


class Delivery(LiveServer):
    """The Hiraia APK over the pinned API, and its content from the mirror on the LAN listener."""

    def delivery(self, data: Path) -> dict:
        self.content = {'labse.gguf': os.urandom(2 * server.CHUNK + 777), 'images/common-01-x.hpak': os.urandom(5000),
                        'vectors.bin': os.urandom(3000)}
        models = data / 'mirror' / 'models'
        (models / 'images').mkdir(parents=True)
        for name, body in self.content.items():
            (models / name).write_bytes(body)
        (models / 'vectors.bin').write_bytes(bytes(3000))    # on Hiraia's list, but not what it lists
        (models / 'unlisted.bin').write_bytes(b'anything')    # not on Hiraia's list at all
        (models / 'labse.gguf.part').write_bytes(b'partial')  # a sync in progress
        known = [asset(name, body) for name, body in self.content.items()]
        self.load_logs = []
        mirror = server.Mirror.load(data / 'mirror', known, log=self.load_logs.append)
        source = data / 'hiraia.apk'
        source.write_bytes(hiraia_apk())
        self.hiraia_bytes = source.read_bytes()
        hiraia = server.HiraiaApk.snapshot(source, data / 'mirror', signer=HIRAIA_SIGNER)
        return {'hiraia': hiraia, 'mirror': mirror, 'max_apk_downloads': 2}

    def fetch(self, path: str, method: str = 'GET', **headers) -> tuple[int, http.client.HTTPMessage, bytes]:
        connection = http.client.HTTPConnection('127.0.0.1', self.lan.server_address[1], timeout=10)
        connection.request(method, path, headers={name.replace('_', '-'): value for name, value in headers.items()})
        response = connection.getresponse()
        return response.status, response.headers, response.read()

    def test_serves_verified_files_whole_and_in_ranges(self):
        body = self.content['labse.gguf']
        size, url = len(body), '/mirror/models/labse.gguf'
        status, headers, got = self.fetch(url)
        self.assertEqual((status, fingerprint(got), headers['Content-Length'], headers['Accept-Ranges']),
                         (200, fingerprint(body), str(size), 'bytes'))
        status, headers, got = self.fetch(url, 'HEAD')
        self.assertEqual((status, got, headers['Content-Length'], headers['Accept-Ranges']), (200, b'', str(size), 'bytes'))
        for wanted, first, last in [(f'bytes={server.CHUNK + 5}-', server.CHUNK + 5, size - 1), ('bytes=10-19', 10, 19),
                                    ('bytes=-7', size - 7, size - 1), (f'bytes=0-{size * 2}', 0, size - 1)]:
            status, headers, got = self.fetch(url, Range=wanted)
            self.assertEqual((status, headers['Content-Range'], headers['Content-Length'], headers['Accept-Ranges']),
                             (206, f'bytes {first}-{last}/{size}', str(last + 1 - first), 'bytes'), wanted)
            self.assertEqual(fingerprint(got), fingerprint(body[first:last + 1]), wanted)
        for wanted in [f'bytes={size}-', 'bytes=-0']:
            status, headers, got = self.fetch(url, Range=wanted)
            self.assertEqual((status, headers['Content-Range'], got), (416, f'bytes */{size}', b''), wanted)
        status, _, got = self.fetch(url, Range='bytes=0-1,5-6')
        self.assertEqual((status, fingerprint(got)), (200, fingerprint(body)))
        status, headers, _ = self.fetch(url, 'HEAD', Range='bytes=0-' + '9' * 5000)  # answered, not dropped
        self.assertEqual((status, headers['Content-Range']), (206, f'bytes 0-{size - 1}/{size}'))
        status, _, got = self.fetch('/mirror/models/images/common-01-x.hpak', Range='bytes=4000-')
        self.assertEqual((status, got), (206, self.content['images/common-01-x.hpak'][4000:]))

    def received(self, expected: list[str]) -> list[str]:
        """The phone's content once the server has recorded it: it records a file just after sending
        its last byte, which the client can read a moment before that."""
        deadline = time.monotonic() + 5
        while True:
            got = sorted(self.app.registry.devices()[0]['content'])
            if got == expected or time.monotonic() > deadline:
                return got
            time.sleep(0.02)

    def test_the_dashboard_shows_what_each_phone_has_received_in_full(self):
        self.register()  # the API now knows this phone at this address
        url, size = '/mirror/models/labse.gguf', len(self.content['labse.gguf'])
        self.fetch(url, 'HEAD')
        self.fetch(url, Range='bytes=0-99')  # a piece is not the file
        time.sleep(0.2)
        self.assertEqual(self.app.registry.devices()[0]['content'], [])
        self.fetch(url, Range='bytes=100-')  # the rest: now it has all of it
        self.fetch('/mirror/models/images/common-01-x.hpak')
        self.assertEqual(self.received(['images/common-01-x.hpak', 'labse.gguf']), ['images/common-01-x.hpak', 'labse.gguf'])
        deadline = time.monotonic() + 5
        while not any('has LaBSE' in line for line in self.logs) and time.monotonic() < deadline:
            time.sleep(0.02)
        self.assertTrue(any('has LaBSE' in line for line in self.logs), self.logs)
        self.fetch(url)  # a second full copy is not news
        time.sleep(0.2)
        self.assertEqual(sum('has LaBSE' in line for line in self.logs), 1)
        _, page = self.get('/')
        self.assertIn('LaBSE ✓'.encode(), page)
        self.assertIn('vectors –'.encode(), page)
        self.assertIn(b'1 image pack<', page)
        row = next(csv.DictReader(io.StringIO(self.app.registry.csv())))
        self.assertEqual((row['has_labse'], row['has_search_vectors'], row['image_packs_received']), ('yes', 'no', '1'))

    def test_a_restarted_server_still_knows_which_phone_is_at_an_address(self):
        self.register()
        self.app.phones_by_address.clear()  # what a restart forgets
        self.fetch('/mirror/models/labse.gguf')
        self.assertEqual(self.received(['labse.gguf']), ['labse.gguf'])

    def test_an_older_database_gains_the_address_column(self):
        path = Path(self.tmp.name, 'old.db')
        db = sqlite3.connect(path)
        db.execute("""CREATE TABLE devices (seq INTEGER PRIMARY KEY, hiraia_id TEXT NOT NULL UNIQUE,
            device_key TEXT NOT NULL UNIQUE, secret_sha256 TEXT NOT NULL, status TEXT NOT NULL,
            detail TEXT NOT NULL DEFAULT '', inventory TEXT NOT NULL, dpc_version_code INTEGER,
            dpc_version_name TEXT, registered_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_seen TEXT NOT NULL)""")
        db.commit()
        db.close()
        registry = server.Registry(path, 'HI2609', 201, KEY)
        hiraia_id = registry.register(inventory('serial:OLD')).hiraia_id
        registry.seen_at(hiraia_id, '192.168.1.50')
        self.assertEqual(registry.phone_at('192.168.1.50'), hiraia_id)

    def test_content_from_an_address_the_api_never_saw_is_put_against_no_phone(self):
        self.register()
        self.app.content_received('10.9.9.9', 'labse.gguf')
        self.assertEqual(self.app.registry.devices()[0]['content'], [])

    def test_a_resume_of_some_other_file_gets_this_one_whole(self):
        etag = f'"{hashlib.md5(self.content["labse.gguf"]).hexdigest()}"'
        status, headers, _ = self.fetch('/mirror/models/labse.gguf', Range='bytes=5-', If_Range=etag)
        self.assertEqual((status, headers['ETag']), (206, etag))
        status, _, got = self.fetch('/mirror/models/labse.gguf', Range='bytes=5-', If_Range='"another-file"')
        self.assertEqual((status, fingerprint(got)), (200, fingerprint(self.content['labse.gguf'])))

    def test_serves_nothing_it_has_not_verified(self):
        self.assertEqual(sorted(self.app.mirror.files), ['images/common-01-x.hpak', 'labse.gguf'])
        self.assertEqual([a.name for a in self.app.mirror.missing], ['vectors.bin'])
        self.assertTrue(any('vectors.bin does not match' in line for line in self.load_logs))
        for path in ['/mirror/models/vectors.bin', '/mirror/models/unlisted.bin', '/mirror/models/labse.gguf.part',
                     '/mirror/models/images/../labse.gguf', '/mirror/models/images%2F..%2Flabse.gguf',
                     '/mirror/models/common-01-x.hpak', '/mirror/models/', '/mirror/models/images/',
                     '/mirror/labse.gguf', '/mirror/models//labse.gguf']:
            self.assertEqual(self.fetch(path)[0], 404, path)
            self.assertEqual(self.fetch(path, Range='bytes=0-')[0], 404, path)

    def test_an_unreadable_file_is_not_served_and_does_not_stop_the_server(self):
        root = Path(self.tmp.name, 'other-mirror')
        (root / 'models' / 'labse.gguf').mkdir(parents=True)  # a folder where the file should be
        logs = []
        mirror = server.Mirror.load(root, [asset('labse.gguf', self.content['labse.gguf'])], log=logs.append)
        self.assertEqual((mirror.files, [a.name for a in mirror.missing]), ({}, ['labse.gguf']))
        self.assertTrue(any('cannot read the mirror\'s labse.gguf' in line for line in logs), logs)

    def test_is_open_to_the_lan_like_the_dpc(self):
        status, _, got = self.fetch('/mirror/models/labse.gguf', Host='evil.example')
        self.assertEqual((status, fingerprint(got)), (200, fingerprint(self.content['labse.gguf'])))

    def test_what_was_verified_is_what_is_served(self):
        models = Path(self.tmp.name, 'mirror', 'models')
        replacement = models / 'replacement'
        replacement.write_bytes(os.urandom(len(self.content['labse.gguf'])))
        os.replace(replacement, models / 'labse.gguf')  # e.g. a sync running beside the server
        self.assertEqual(fingerprint(self.fetch('/mirror/models/labse.gguf')[2]), fingerprint(self.content['labse.gguf']))

    def test_says_each_download_once(self):
        for wanted in ['bytes=0-', 'bytes=100-', 'bytes=200-']:
            self.fetch('/mirror/models/labse.gguf', Range=wanted)
            self.fetch('/mirror/models/images/common-01-x.hpak', Range=wanted)
        self.fetch('/mirror/models/labse.gguf', 'HEAD')
        said = [line for line in self.logs if 'from the mirror' in line]
        self.assertEqual(len(said), 2, said)
        self.assertTrue(any('labse.gguf' in line for line in said))
        self.assertTrue(any('illustration packs' in line for line in said))

    def test_replies_offer_hiraia_and_the_mirror(self):
        device = self.register()
        mirror = f'http://127.0.0.1:{self.lan.server_address[1]}/mirror/models'
        offer = {'package': 'com.hiraia.app', 'version_code': 24, 'version_name': '0.4.24',
                 'sha256': hashlib.sha256(self.hiraia_bytes).hexdigest(), 'size': len(self.hiraia_bytes)}
        self.assertEqual((self.registered['hiraia'], self.registered['mirror']), (offer, mirror))
        status, reply = self.api_call('POST', '/api/checkin', {'dpc_version_code': 9, 'status': 'INSTALLING'},
                                      device=device)
        self.assertEqual((status, reply['hiraia'], reply['mirror']), (200, offer, mirror))
        self.assertEqual(self.app.registry.devices()[0]['status'], 'INSTALLING')
        # The phone fetches from the address the reply names.
        connection = http.client.HTTPConnection(*mirror.removeprefix('http://').split('/')[0].split(':'), timeout=10)
        connection.request('GET', '/mirror/models/labse.gguf')
        self.assertEqual(fingerprint(connection.getresponse().read()), fingerprint(self.content['labse.gguf']))

    def test_old_setup_gets_its_update_before_hiraia_without_changing_registration(self):
        self.app.min_dpc_version_for_hiraia = 9
        device = self.register(dpc_version_code=8, dpc_version='0.4.3')
        self.assertIsNone(self.registered['hiraia'])
        self.assertIsNotNone(self.registered['mirror'])
        for version in (8, 9, 10):
            status, reply = self.api_call('POST', '/api/checkin',
                                         {'dpc_version_code': version, 'status': 'COMPLETE'}, device=device)
            self.assertEqual(status, 200)
            self.assertEqual(reply['dpc']['version_code'], 9)
            self.assertEqual(reply['hiraia'], None if version < 9 else self.app.hiraia.offer)
        self.assertEqual([row['hiraia_id'] for row in self.app.registry.devices()], [device[0]])
        self.assertEqual(self.api_call('GET', '/api/dpc.apk', device=device)[0], 200)

    def test_unknown_setup_version_waits_for_checkin(self):
        self.app.min_dpc_version_for_hiraia = 9
        for version in (None, True, '9', 0, 8):
            self.assertIsNone(self.app.offers(version)['hiraia'])

    def test_required_setup_version_cannot_strand_the_fleet(self):
        for version in (0, -1, 10, True, '9'):
            with self.assertRaisesRegex(ValueError, 'minimum DPC version'):
                server.App(self.app.registry, self.app.dpc, self.app.config, self.tls, self.token,
                           min_dpc_version_for_hiraia=version)

    def test_warns_of_an_address_hiraia_would_not_take_a_mirror_at(self):
        for host in ['10.0.0.5', '172.16.0.1', '172.31.255.254', '192.168.68.62']:
            self.assertTrue(server.private_ipv4(host), host)
        for host in ['172.32.0.1', '100.64.0.1', '8.8.8.8', '127.0.0.1', 'fd00::1', 'laptop.local', '192.168.068.62']:
            self.assertFalse(server.private_ipv4(host), host)

    def test_the_mirror_address_follows_the_laptop(self):
        device = self.register()
        self.app.move('192.168.68.70')
        _, reply = self.api_call('POST', '/api/checkin', {'dpc_version_code': 9, 'status': 'COMPLETE'}, device=device)
        self.assertEqual(reply['mirror'], f'http://192.168.68.70:{self.lan.server_address[1]}/mirror/models')

    def test_nothing_on_offer_is_null(self):
        self.app.hiraia.close()
        self.app.mirror.close()
        self.app.hiraia, self.app.mirror = None, server.Mirror(Path(self.tmp.name), {}, [])
        device = self.register()
        self.assertEqual((self.registered['hiraia'], self.registered['mirror']), (None, None))
        _, reply = self.api_call('POST', '/api/checkin', {'dpc_version_code': 9, 'status': 'COMPLETE'}, device=device)
        self.assertEqual((reply['hiraia'], reply['mirror']), (None, None))
        self.assertEqual(self.api_call('GET', '/api/hiraia.apk', device=device)[0], 404)
        self.assertEqual(self.fetch('/mirror/models/labse.gguf')[0], 404)
        self.assertIn(b'No Hiraia APK on offer', self.get('/')[1])

    def test_serves_the_hiraia_apk_to_registered_phones(self):
        device = self.register()
        status, apk = self.api_call('GET', '/api/hiraia.apk', device=device)
        self.assertEqual((status, apk), (200, self.hiraia_bytes))
        status, rest = self.api_call('GET', '/api/hiraia.apk', device=device, headers={'Range': 'bytes=100-'})
        self.assertEqual((status, rest, self.headers['Content-Range']),
                         (206, self.hiraia_bytes[100:], f'bytes 100-{len(self.hiraia_bytes) - 1}/{len(self.hiraia_bytes)}'))
        status, _ = self.api_call('GET', '/api/hiraia.apk', device=device,
                                  headers={'Range': f'bytes={len(self.hiraia_bytes)}-'})
        self.assertEqual((status, self.headers['Content-Range']), (416, f'bytes */{len(self.hiraia_bytes)}'))
        self.assertEqual(self.api_call('HEAD', '/api/hiraia.apk', device=device)[0], 200)
        self.assertEqual(self.headers['Content-Length'], str(len(self.hiraia_bytes)))
        self.assertEqual(self.api_call('GET', '/api/hiraia.apk')[0], 401)
        self.assertEqual(self.api_call('GET', '/api/hiraia.apk', device=('HI2609-999', device[1]))[0], 401)
        self.assertEqual(len([line for line in self.logs if 'downloading Hiraia 0.4.24 (24)' in line]), 1)
        self.assertEqual(self.fetch(f'/mirror/models/../apk/{hashlib.sha256(self.hiraia_bytes).hexdigest()}.apk')[0],
                         404, 'the APK is only for authenticated phones, never on the mirror')

    def test_too_many_downloads_at_once_are_told_to_come_back(self):
        device = self.register()
        for _ in range(2):  # both slots busy with other phones
            self.assertTrue(self.app.apk_downloads.acquire(blocking=False))
        status, reply = self.api_call('GET', '/api/hiraia.apk', device=device)
        self.assertEqual((status, self.headers['Retry-After']), (503, '30'))
        self.app.apk_downloads.release()
        self.assertEqual(self.api_call('GET', '/api/hiraia.apk', device=device), (200, self.hiraia_bytes))
        self.assertEqual(self.api_call('GET', '/api/hiraia.apk', device=device)[0], 200, 'a finished download frees its slot')

    def test_install_progress_shows_on_the_dashboard_and_once_per_step_in_the_terminal(self):
        device = self.register()
        for detail in ['Downloading Hiraia 5%', 'Downloading Hiraia 42%', 'Downloading Hiraia 99%', 'Installing Hiraia']:
            self.assertEqual(self.api_call('POST', '/api/report', {'status': 'INSTALLING', 'detail': detail},
                                           device=device), (200, {'ok': True}))
        device_row = self.app.registry.devices()[0]
        self.assertEqual((device_row['status'], device_row['detail']), ('INSTALLING', 'Installing Hiraia'))
        said = [line for line in self.logs if 'INSTALLING' in line]
        self.assertEqual(said, [f'{device[0]}  INSTALLING  Downloading Hiraia 5%', f'{device[0]}  INSTALLING  Installing Hiraia'])
        page = self.get('/')[1]
        self.assertIn(b'class="INSTALLING"', page)
        self.assertIn(b'Hiraia 0.4.24 (24) on offer', page)
        self.assertIn(b'mirror: 2 files', page)
        self.assertIn(b'1 not in the mirror: vectors.bin', page)
        self.assertIn(b'Hiraia 0.4.24 (24) on offer', self.get('/qr')[1])


if __name__ == '__main__':
    unittest.main()
