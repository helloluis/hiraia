import importlib.util
import functools
import http.server
import json
import os
from pathlib import Path
import ssl
import subprocess
import tempfile
import threading
import unittest
import urllib.error

spec = importlib.util.spec_from_file_location('publisher', Path(__file__).parents[1] / 'scripts/stage-release.py')
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)

class PublicationTest(unittest.TestCase):
    def test_real_https_readback_failure_and_atomic_rollback(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / 'staged'
            def candidate(number):
                source = Path(tmp) / f'input-{number}'
                source.mkdir()
                m = dict(schemaVersion=1, release=f'tala-desktop-preview-{number}', sourceCommit=str(number) * 40,
                         version=f'0.1.{number}', electron='45.5.0', hostedOrigin='https://tala.hiraia.org', artifacts=[])
                for platform, arch in sorted(p.REQUIRED):
                    name = f'Tala-{number}-{platform}-{arch}.' + ('exe' if platform == 'win32' else 'dmg')
                    data = f'Explicitly synthetic HTTPS transaction fixture {number}/{platform}/{arch}'.encode()
                    (source / name).write_bytes(data)
                    m['artifacts'].append(dict(m, artifacts=None, platform=platform, arch=arch, file=name, bytes=len(data), sha256=p.sha(data), sourceDirty=False))
                (source / 'desktop-release.json').write_text(json.dumps(m))
                return p.stage(source, root)
            first, second = candidate(1), candidate(2)
            config = Path(tmp) / 'openssl.cnf'
            cert, key = Path(tmp) / 'cert.pem', Path(tmp) / 'key.pem'
            config.write_text('[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=Tala local transaction test\n[ext]\nsubjectAltName=IP:127.0.0.1\n')
            subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-config', str(config), '-keyout', str(key), '-out', str(cert)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            failures = []
            requests = []
            class Handler(http.server.SimpleHTTPRequestHandler):
                def log_message(self, *args):
                    pass
                def do_GET(self):
                    requests.append(self.path)
                    if failures and self.path.endswith('.dmg'):
                        self.send_error(503, 'deliberate test failure')
                    else:
                        super().do_GET()
            server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(root)))
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            context.load_cert_chain(cert, key)
            server.socket = context.wrap_socket(server.socket, server_side=True)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            base = f'https://127.0.0.1:{server.server_port}'
            previous_ca = os.environ.get('SSL_CERT_FILE')
            # This test process trusts exactly its ephemeral certificate. No OS
            # trust store change and no certificate-verification bypass.
            os.environ['SSL_CERT_FILE'] = str(cert)
            try:
                p.promote(root, first, base, 'absent')
                before = (root / 'desktop-latest.json').read_bytes()
                failures.append(True)
                with self.assertRaises(urllib.error.HTTPError) as rejected:
                    p.promote(root, second, base, p.sha(before))
                self.assertEqual(rejected.exception.code, 503)
                self.assertEqual((root / 'desktop-latest.json').read_bytes(), before)
                failures.clear()
                p.promote(root, second, base, p.sha(before))
                current = (root / 'desktop-latest.json').read_bytes()
                p.promote(root, first, base, p.sha(current))
                self.assertEqual((root / 'desktop-latest.json').read_bytes(), before)
                self.assertGreaterEqual(len(requests), 13)
            finally:
                if previous_ca is None:
                    os.environ.pop('SSL_CERT_FILE', None)
                else:
                    os.environ['SSL_CERT_FILE'] = previous_ca
                server.shutdown()
                server.server_close()
                thread.join()

    def test_failure_retains_current_pair_and_rollback_restores_whole_set(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / 'public'
            def candidate(number):
                source = Path(tmp) / f'input-{number}'
                source.mkdir()
                m = dict(schemaVersion=1, release=f'tala-desktop-preview-{number}', sourceCommit=str(number) * 40,
                         version=f'0.1.{number}', electron='45.5.0', hostedOrigin='https://tala.hiraia.org', artifacts=[])
                for platform, arch in p.REQUIRED:
                    name = f'Tala-0.1.{number}-{platform}-{arch}.' + ('exe' if platform == 'win32' else 'dmg')
                    data = f'synthetic test {number}/{platform}/{arch}'.encode()
                    (source / name).write_bytes(data)
                    m['artifacts'].append(dict(m, artifacts=None, platform=platform, arch=arch, file=name, bytes=len(data), sha256=p.sha(data), sourceDirty=False))
                (source / 'desktop-release.json').write_text(json.dumps(m))
                return source
            def readback(url, length, digest):
                data = (root / url.removeprefix('https://downloads.example.test/')).read_bytes()
                if len(data) != length or p.sha(data) != digest:
                    raise ValueError('readback failed')
            first = p.stage(candidate(1), root)
            p.promote(root, first, 'https://downloads.example.test', 'absent', readback)
            previous = (root / 'desktop-latest.json').read_bytes()
            second = p.stage(candidate(2), root)
            def failed(*args):
                raise ValueError('controlled HTTPS failure')
            with self.assertRaisesRegex(ValueError, 'controlled HTTPS failure'):
                p.promote(root, second, 'https://downloads.example.test', p.sha(previous), failed)
            self.assertEqual((root / 'desktop-latest.json').read_bytes(), previous)
            with self.assertRaisesRegex(ValueError, 'Latest changed'):
                p.promote(root, second, 'https://downloads.example.test', 'absent', readback)
            p.promote(root, second, 'https://downloads.example.test', p.sha(previous), readback)
            current = (root / 'desktop-latest.json').read_bytes()
            p.promote(root, first, 'https://downloads.example.test', p.sha(current), readback)
            self.assertEqual((root / 'desktop-latest.json').read_bytes(), previous)
            self.assertTrue(second.is_dir())

if __name__ == '__main__':
    unittest.main()
