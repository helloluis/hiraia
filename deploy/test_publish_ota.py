"""Offline tests for deploy/publish-ota.py's pure parts; no R2, no network, no real key.

  python3 -m unittest deploy/test_publish_ota.py
"""
import base64
import contextlib
import datetime as dt
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('publish_ota', Path(__file__).with_name('publish-ota.py'))
ota = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ota)

RT = 'bc46088521c8be59290c8d1836e279376924a4e3'
U1 = '11111111-1111-4111-8111-111111111111'
U2 = '22222222-2222-4222-8222-222222222222'
U3 = '44444444-4444-4444-8444-444444444444'
U4 = '55555555-5555-4555-8555-555555555555'
STAMP = {'at': '2026-09-24T00:00:00.000Z', 'git': 'abc123', 'apk': '0.4.24'}


def upd(update_id):
    return {'kind': 'update', 'id': update_id}


def steps(*ops, channel=None):
    """Replay publisher operations: (ring, release, rollout) tuples through update_channel."""
    for ring, release, rollout in ops:
        channel = ota.update_channel(channel, runtime=RT, ring=ring, release=release, rollout=rollout, stamp=STAMP)
    return channel


def digests(data, ext, path=None):
    md5 = hashlib.md5(data).hexdigest()
    sha = hashlib.sha256(data)
    return {'bytes': len(data), 'sha256': sha.hexdigest(), 'md5': md5,
            'hash': base64.urlsafe_b64encode(sha.digest()).rstrip(b'=').decode(), 'ext': ext,
            'path': path or f'assets/{md5}'}


class ManifestTests(unittest.TestCase):
    def test_manifest_follows_protocol_v1_and_points_at_content_addressed_urls(self):
        bundle = digests(b'hermes bytecode', 'hbc')
        font = digests(b'font bytes', 'ttf')
        doc = ota.build_manifest(update_id=U1, created_at='2026-09-24T01:02:03.004Z', runtime=RT, bundle=bundle,
                                 assets=[font], expo_client={'name': 'Hiraia', 'version': '0.4.24'},
                                 hiraia={'git': 'abc'})
        self.assertEqual(set(doc), {'id', 'createdAt', 'runtimeVersion', 'launchAsset', 'assets', 'metadata', 'extra'})
        self.assertEqual(doc['runtimeVersion'], RT)
        self.assertEqual(doc['launchAsset'], {
            'hash': bundle['hash'], 'key': bundle['md5'], 'contentType': 'application/javascript',
            'fileExtension': '.bundle', 'url': f"https://assets.hiraia.org/ota/android/assets/{bundle['sha256']}"})
        self.assertEqual(doc['assets'], [{
            'hash': font['hash'], 'key': font['md5'], 'contentType': 'font/ttf', 'fileExtension': '.ttf',
            'url': f"https://assets.hiraia.org/ota/android/assets/{font['sha256']}"}])
        self.assertNotIn('=', doc['launchAsset']['hash'], 'base64url without padding, as the phone compares it')
        self.assertEqual(doc['extra']['expoClient']['version'], '0.4.24', 'Constants.expoConfig on an OTA launch')

    def test_serialised_bytes_survive_the_phones_utf8_round_trip(self):
        doc = {'id': U1, 'extra': {'expoClient': {'name': 'Hiraia — ñ', 'x': 'Tagalog: “Salamat”'}}}
        body = ota.serialize(doc)
        body.decode('ascii')  # ASCII-only: nothing for a re-encode to change
        self.assertEqual(body.decode('utf-8').encode('utf-8'), body)
        self.assertEqual(json.loads(body), doc)

    def test_created_at_is_the_shape_expo_updates_parses_first(self):
        stamp = ota.iso_ms(dt.datetime(2026, 9, 24, 1, 2, 3, 4999, tzinfo=dt.timezone.utc))
        self.assertEqual(stamp, '2026-09-24T01:02:03.004Z')
        dt.datetime.strptime(stamp, '%Y-%m-%dT%H:%M:%S.%fZ')

    def test_rollback_directive_and_release_keys_match_the_relay_layout(self):
        self.assertEqual(ota.rollback_directive('2026-09-24T00:00:00.000Z'),
                         {'type': 'rollBackToEmbedded', 'parameters': {'commitTime': '2026-09-24T00:00:00.000Z'}})
        self.assertEqual(ota.release_keys(RT, {'kind': 'update', 'id': U1}),
                         (f'ota/android/{RT}/updates/{U1}/manifest.json', f'ota/android/{RT}/updates/{U1}/manifest.json.sig'))
        self.assertEqual(ota.release_keys(RT, {'kind': 'rollBackToEmbedded', 'id': U2})[0],
                         f'ota/android/{RT}/directives/{U2}/directive.json')

    def test_hermes_version_and_embedded_keys(self):
        self.assertEqual(ota.hermes_version(ota.HERMES_MAGIC + (96).to_bytes(4, 'little')), 96)
        with self.assertRaises(ValueError):
            ota.hermes_version(b'var x = 1;  ')
        embedded = {'id': U1, 'commitTime': 1, 'assets': [{'packagerHash': 'aa'}, {'packagerHash': 'bb'}, {'name': 'x'}]}
        self.assertEqual(ota.embedded_keys(embedded), {'aa', 'bb'})


class SignatureTests(unittest.TestCase):
    """The exact-bytes contract, with a throwaway key made here (never the real one)."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        d = Path(cls.tmp.name)
        cls.key, cls.cert, cls.other = d / 'key.pem', d / 'cert.pem', d / 'other.pem'
        for key in (cls.key, cls.other):
            subprocess.run(['openssl', 'genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:2048',
                            '-out', str(key)], check=True, capture_output=True)
        subprocess.run(['openssl', 'req', '-x509', '-key', str(cls.key), '-subj', '/CN=test', '-days', '1',
                        '-out', str(cls.cert)], check=True, capture_output=True)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_signature_covers_exactly_the_serialised_bytes(self):
        body = ota.serialize({'id': U1, 'runtimeVersion': RT, 'assets': []})
        signature = ota.sign_bytes(body, self.key)
        self.assertTrue(ota.verify_bytes(body, signature, self.cert))
        self.assertFalse(ota.verify_bytes(body.replace(b'"assets":[]', b'"assets":[ ]'), signature, self.cert),
                         'same JSON, other bytes: a phone rejects it')
        self.assertFalse(ota.verify_bytes(json.dumps(json.loads(body)).encode(), signature, self.cert))
        self.assertFalse(ota.verify_bytes(body, ota.sign_bytes(body, self.other), self.cert), 'wrong key')

    def test_signature_matches_openssl_rsa_sha256_pkcs1(self):
        body = b'{"type":"rollBackToEmbedded"}'
        signature = ota.sign_bytes(body, self.key)
        raw = subprocess.run(['openssl', 'dgst', '-sha256', '-sign', str(self.key)], input=body,
                             capture_output=True, check=True).stdout
        self.assertEqual(base64.b64decode(signature), raw, 'PKCS#1 v1.5 is deterministic')

    def test_the_relays_multipart_answer_parses_to_our_bytes_and_signature(self):
        body = ota.serialize({'id': U1})
        signature = ota.sign_bytes(body, self.key)
        boundary = 'hiraia-ota-0123456789abcdef01234567'
        raw = (f'--{boundary}\r\ncontent-type: application/json; charset=utf-8\r\n'
               f'content-disposition: form-data; name="manifest"\r\n'
               f'expo-signature: sig="{signature}", keyid="main"\r\n\r\n').encode() + body + f'\r\n--{boundary}--\r\n'.encode()
        parts = ota.parse_multipart(f'multipart/mixed; boundary={boundary}', raw)
        self.assertEqual(len(parts), 1)
        headers, payload = parts[0]
        self.assertEqual(payload, body)
        self.assertEqual(headers['content-disposition'], 'form-data; name="manifest"')
        self.assertTrue(ota.verify_bytes(payload, ota.signature_from_header(headers['expo-signature']), self.cert))
        with self.assertRaises(ValueError):
            ota.parse_multipart('application/json', raw)


class AssetGuardTests(unittest.TestCase):
    def test_embedded_assets_are_free_and_new_heavy_ones_are_refused(self):
        embedded = {'db', 'font'}
        assets = [
            {'path': 'assets/db', 'md5': 'db', 'bytes': 146_000_000},
            {'path': 'assets/font', 'md5': 'font', 'bytes': 90_000},
            {'path': 'assets/icon', 'md5': 'icon', 'bytes': 40_000},
        ]
        new, problems = ota.asset_guard(assets, embedded)
        self.assertEqual([a['md5'] for a in new], ['icon'])
        self.assertEqual(problems, [])

        changed_db = [dict(assets[0], md5='db2', path='assets/db2')] + assets[1:]
        new, problems = ota.asset_guard(changed_db, embedded)
        self.assertEqual({a['md5'] for a in new}, {'db2', 'icon'})
        self.assertTrue(any('assets/db2' in p for p in problems))
        self.assertEqual(ota.asset_guard(changed_db, embedded, allow_large=True)[1], [])

        many_small = [{'path': f'assets/s{i}', 'md5': f's{i}', 'bytes': 1_500_000} for i in range(4)]
        self.assertTrue(any('total' in p for p in ota.asset_guard(many_small, set())[1]), 'each under 2 MB, 6 MB total')


class ChannelTests(unittest.TestCase):
    def test_canary_publish_into_an_empty_channel(self):
        nxt = ota.update_channel(None, runtime=RT, ring='canary', release={'kind': 'update', 'id': U1},
                                 add_clients=['6F1D0C2E-5B7A-4C1E-9D3F-2A8B4C6D8E0F'], stamp=STAMP)
        self.assertEqual(nxt['canary'], {'clients': ['6F1D0C2E-5B7A-4C1E-9D3F-2A8B4C6D8E0F'],
                                         'release': {'kind': 'update', 'id': U1}})
        self.assertIsNone(nxt['production']['release'])
        self.assertEqual(nxt['history'][-1]['ring'], 'canary')
        again = ota.update_channel(nxt, runtime=RT, ring='canary', add_clients=['6f1d0c2e-5b7a-4c1e-9d3f-2a8b4c6d8e0f'],
                                   stamp=STAMP)
        self.assertEqual(len(again['canary']['clients']), 1, 'case-insensitive dedupe')
        removed = ota.update_channel(again, runtime=RT, ring='canary',
                                     remove_clients=['6f1d0c2e-5b7a-4c1e-9d3f-2a8b4c6d8e0f'], stamp=STAMP)
        self.assertEqual(removed['canary']['clients'], [])
        with self.assertRaises(ValueError):
            ota.update_channel(None, runtime=RT, ring='canary', add_clients=['has space'], stamp=STAMP)

    def test_production_takes_a_new_release_with_the_old_one_as_fallback(self):
        first = ota.update_channel(None, runtime=RT, ring='production', release={'kind': 'update', 'id': U1},
                                   rollout=100, stamp=STAMP)
        with self.assertRaises(ValueError):
            ota.update_channel(first, runtime=RT, ring='production', release={'kind': 'update', 'id': U2}, stamp=STAMP)
        second = ota.update_channel(first, runtime=RT, ring='production', release={'kind': 'update', 'id': U2},
                                    rollout=10, stamp=STAMP)
        self.assertEqual(second['production'], {'release': {'kind': 'update', 'id': U2}, 'rollout': 10,
                                                'fallback': {'kind': 'update', 'id': U1}})
        widened = ota.update_channel(second, runtime=RT, ring='production', rollout=100, stamp=STAMP)
        self.assertEqual(widened['production']['rollout'], 100)
        self.assertEqual(widened['production']['fallback'], {'kind': 'update', 'id': U1}, 're-sizing keeps the fallback')
        self.assertEqual(second['production']['rollout'], 10, 'input never mutated')
        for bad in (-1, 101):
            with self.assertRaises(ValueError):
                ota.update_channel(second, runtime=RT, ring='production', rollout=bad, stamp=STAMP)
        with self.assertRaises(ValueError):
            ota.update_channel(None, runtime=RT, ring='production', rollout=50, stamp=STAMP)

    def test_a_release_held_below_100_percent_never_becomes_the_fallback(self):
        # OTA-1: U2 held at 10% (a bug showed up), fix U3 goes out at 10%. Before the fix U2 became
        # the fallback, i.e. the release for the ~90% outside U3's rollout.
        base = steps(('production', upd(U1), 100), ('production', upd(U2), 10))
        self.assertEqual(base['production']['fallback'], upd(U1))
        fixed = steps(('production', upd(U3), 10), channel=base)
        self.assertEqual(fixed['production'], {'release': upd(U3), 'rollout': 10, 'fallback': upd(U1)})
        self.assertTrue(any(f'{U2} was at 10%' in line for line in ota.channel_summary(base, fixed)),
                        'the operator is told the held-back release did not become the fallback')

        halted = steps(('production', None, 0), ('production', upd(U3), 10), channel=base)
        self.assertEqual(halted['production']['fallback'], upd(U1), 'halted at 0% stays out of the fallback')

        widened = steps(('production', None, 100), ('production', upd(U3), 10), channel=base)
        self.assertEqual(widened['production']['fallback'], upd(U2), 'a release that reached 100% becomes it')

        never = steps(('production', upd(U1), 10), ('production', upd(U2), 10))
        self.assertIsNone(never['production']['fallback'], 'nothing ever reached everyone: outside gets a 204')

        directive = {'kind': 'rollBackToEmbedded', 'id': '33333333-3333-4333-8333-333333333333'}
        after_brake = steps(('production', directive, None), ('production', upd(U3), 10), channel=base)
        self.assertEqual(after_brake['production']['fallback'], directive, 'phones outside the fix stay braked')

    def test_canary_follows_production_whenever_production_takes_a_new_release(self):
        # OTA-3: allowlisted phones must not stay pinned to the canary release through a rollback.
        client = ['6F1D0C2E-5B7A-4C1E-9D3F-2A8B4C6D8E0F']
        channel = ota.update_channel(None, runtime=RT, ring='canary', release=upd(U2), add_clients=client, stamp=STAMP)
        promoted = steps(('production', upd(U2), 10), channel=channel)
        self.assertIsNone(promoted['canary']['release'], '--promote hands canary phones to production')
        self.assertEqual(promoted['canary']['clients'], client, 'the allowlist itself stays')

        testing = steps(('production', upd(U1), 100), ('canary', upd(U2), None), channel=channel)
        self.assertEqual(testing['canary']['release'], upd(U2))
        self.assertEqual(steps(('production', None, 50), channel=testing)['canary']['release'], upd(U2),
                         're-sizing production is not a new release: canary keeps its release')
        republished = steps(('production', upd(U4), 100), channel=testing)
        self.assertIsNone(republished['canary']['release'], 'a --republish rollback reaches canary phones too')
        self.assertEqual(steps(('production', upd(U1), 100), channel=testing)['canary']['release'], upd(U2),
                         'naming the release production already has is not a new release')

    def test_a_production_rollback_brakes_every_ring_at_100_percent(self):
        channel = ota.update_channel(None, runtime=RT, ring='canary', release={'kind': 'update', 'id': U2}, stamp=STAMP)
        channel = ota.update_channel(channel, runtime=RT, ring='production', release={'kind': 'update', 'id': U1},
                                     rollout=20, stamp=STAMP)
        directive = {'kind': 'rollBackToEmbedded', 'id': '33333333-3333-4333-8333-333333333333'}
        braked = ota.update_channel(channel, runtime=RT, ring='production', release=directive, stamp=STAMP)
        self.assertEqual(braked['production']['release'], directive)
        self.assertEqual(braked['production']['rollout'], 100)
        self.assertIsNone(braked['canary']['release'])

    def test_channel_guards_runtime_and_caps_history(self):
        with self.assertRaises(ValueError):
            ota.update_channel(ota.empty_channel(RT), runtime='0' * 40, ring='canary', stamp=STAMP)
        channel = ota.empty_channel(RT)
        channel['history'] = [{'n': i} for i in range(ota.HISTORY_MAX + 5)]
        nxt = ota.update_channel(channel, runtime=RT, ring='canary', stamp=STAMP)
        self.assertEqual(len(nxt['history']), ota.HISTORY_MAX)
        self.assertEqual(nxt['history'][-1]['at'], STAMP['at'])

    def test_rollout_buckets_match_the_relay(self):
        # Vectors computed with rolloutBucket() in packages/web/src/app/api/updates/manifest/relay.ts.
        self.assertEqual(ota.rollout_bucket(U1, '6f1d0c2e-5b7a-4c1e-9d3f-2a8b4c6d8e0f'), 67)
        self.assertEqual(ota.rollout_bucket(U2, 'AAAAAAAA-0000-4000-8000-000000000001'), 46)
        self.assertEqual(ota.rollout_bucket('33333333-3333-4333-8333-333333333333', 'abcdefgh'), 46)
        probe = ota.production_probe_client(U1, 5)
        self.assertLess(ota.rollout_bucket(U1, probe), 5)


class FakeBucket:
    """Stands in for R2 in main(): reads from a dict, records writes."""
    objects = {}
    writes = []

    def __init__(self, env_file, dry_run):
        self.s3 = object()
        self.dry_run = dry_run

    def get(self, key):
        body = self.objects.get(key)
        return (body, '"etag"') if body is not None else (None, None)

    def runtimes(self):
        return sorted(k.split('/')[2] for k in self.objects)

    def put_immutable(self, key, *_):
        FakeBucket.writes.append(key)
        return 'uploaded'

    def put_channel(self, runtime, doc, etag):
        FakeBucket.writes.append(f'ota/android/{runtime}/channel.json')


class RollbackGuardTests(unittest.TestCase):
    """OTA-2: an emergency rollback aimed at the wrong runtime must fail loudly, not 'succeed'."""

    def test_rollback_problem_needs_a_runtime_that_carried_an_update(self):
        self.assertIn('no channel.json', ota.rollback_problem(None))
        only_clients = ota.update_channel(None, runtime=RT, ring='canary', add_clients=['abcdefgh'], stamp=STAMP)
        self.assertIn('never carried an update', ota.rollback_problem(only_clients))
        self.assertIsNone(ota.rollback_problem(steps(('canary', upd(U1), None))))
        self.assertIsNone(ota.rollback_problem(steps(('production', upd(U1), 100))))
        braked = steps(('production', upd(U1), 100),
                       ('production', {'kind': 'rollBackToEmbedded', 'id': '33333333-3333-4333-8333-333333333333'}, None))
        braked['production']['fallback'] = None
        self.assertIsNone(ota.rollback_problem(braked), 'a second brake is allowed: history shows the update')

    def run_main(self, argv):
        FakeBucket.writes = []
        with tempfile.NamedTemporaryFile(suffix='.pem') as key, \
                patch.object(ota, 'Bucket', FakeBucket), \
                patch.object(ota, 'git', return_value='abc123'), \
                patch.object(ota, 'sign_bytes', side_effect=AssertionError('signed before the guard')), \
                patch.object(sys, 'argv', ['publish-ota.py', '--env-file', 'env', '--key', key.name, *argv]), \
                contextlib.redirect_stdout(io.StringIO()):
            ota.main()

    def test_a_rollback_into_a_runtime_nobody_published_is_refused_before_signing(self):
        FakeBucket.objects = {f'ota/android/{RT}/channel.json': json.dumps(steps(('production', upd(U1), 100))).encode()}
        wrong = 'b' * 40
        with self.assertRaises(SystemExit) as refused:
            self.run_main(['--runtime', wrong, '--ring', 'production', '--rollback-to-embedded'])
        message = str(refused.exception.code)
        self.assertIn(f'refusing to roll back runtime {wrong}', message)
        self.assertIn('unzip -p <apk> assets/fingerprint', message)
        self.assertIn(RT, message, 'lists the runtimes that do exist')
        self.assertEqual(FakeBucket.writes, [], 'no directive uploaded, no channel created')

    def test_a_rollback_into_the_real_runtime_goes_ahead(self):
        FakeBucket.objects = {f'ota/android/{RT}/channel.json': json.dumps(steps(('production', upd(U1), 100))).encode()}
        with self.assertRaises(AssertionError) as reached:
            self.run_main(['--runtime', RT, '--ring', 'production', '--rollback-to-embedded'])
        self.assertIn('signed before the guard', str(reached.exception), 'passed the guard and went on to sign')

    def test_bucket_lists_runtime_prefixes_across_pages(self):
        pages = [
            {'CommonPrefixes': [{'Prefix': f'ota/android/{RT}/'}, {'Prefix': 'ota/android/assets/'}],
             'IsTruncated': True, 'NextContinuationToken': 't1'},
            {'CommonPrefixes': [{'Prefix': 'ota/android/' + 'a' * 40 + '/'}], 'IsTruncated': False},
        ]
        calls = []

        class S3:
            def list_objects_v2(self, **kwargs):
                calls.append(kwargs)
                return pages[len(calls) - 1]

        bucket = ota.Bucket(None, dry_run=True)
        bucket.s3 = S3()
        self.assertEqual(bucket.runtimes(), sorted([RT, 'a' * 40]))
        self.assertEqual(calls[0]['Delimiter'], '/')
        self.assertEqual(calls[1]['ContinuationToken'], 't1')


class GuardTextTests(unittest.TestCase):
    def test_fingerprint_diff_from_the_build_log(self):
        # Key order as createFingerprintForBuildAsync prints it: sources first, hash last.
        built = {'sources': [
            {'type': 'file', 'filePath': 'scripts/post-prebuild.mjs', 'hash': 'a'},
            {'type': 'contents', 'id': 'hiraia-qvac-native', 'hash': 'b'},
            {'type': 'dir', 'filePath': 'native', 'hash': 'c'}], 'hash': RT}
        log = 'noise\n> Task :app:createReleaseUpdatesResources\n' + json.dumps(built, separators=(',', ':')) + '\nBUILD SUCCESSFUL'
        found = ota.fingerprint_from_build_log(log, RT)
        self.assertEqual(found, built)
        self.assertIsNone(ota.fingerprint_from_build_log(log, '0' * 40))
        now = [{'type': 'file', 'filePath': 'scripts/post-prebuild.mjs', 'hash': 'a'},
               {'type': 'contents', 'id': 'hiraia-qvac-native', 'hash': 'CHANGED'},
               {'type': 'file', 'filePath': 'qvac.config.json', 'hash': 'd'}]
        self.assertEqual(ota.diff_sources(built['sources'], now), [
            '  - removed dir native', '  + added   file qvac.config.json', '  ~ changed contents hiraia-qvac-native'])

    def test_gate_log_must_end_green(self):
        self.assertTrue(ota.gate_green('...\n>> GATE GREEN\n'))
        self.assertFalse(ota.gate_green('>> GATE GREEN\n...\n>> GATE RED\n'))
        self.assertFalse(ota.gate_green('no verdict'))


class HandWrittenChannelTests(unittest.TestCase):
    def test_summary_tolerates_a_hand_written_channel(self):
        # The relay accepts a channel without fallback/rollout/canary; so must the printout.
        after = {'production': {'release': {'kind': 'manifest', 'id': 'u1'}}}
        lines = ota.channel_summary(None, after)
        self.assertIn('production: manifest u1 at 100%', lines[0])
        self.assertIn('follows production', lines[-1])
        half = {'production': {'release': {'kind': 'manifest', 'id': 'u2'}, 'rollout': 50}}
        self.assertIn('nothing (204)', ota.channel_summary(after, half)[0])


if __name__ == '__main__':
    unittest.main()
