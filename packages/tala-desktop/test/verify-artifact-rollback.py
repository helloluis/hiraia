"""Exercise local staging with two real complete installer sets; never publish.

Both inputs remain read-only. A temporary loopback HTTPS server reads the actual
installer bytes; a controlled 503 and a stale-pointer attempt must preserve latest.
The second set is then promoted locally and rolled back to the first, byte-for-byte.
"""
import argparse
import functools
import http.server
import importlib.util
import json
import os
from pathlib import Path
import ssl
import subprocess
import tempfile
import threading
import urllib.error

spec = importlib.util.spec_from_file_location('publisher', Path(__file__).parents[1] / 'scripts/stage-release.py')
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)


def installer_set(directory):
    manifest = p.validate(directory)
    # Reject the publisher unit tests' text fixtures. Native test receipts remain
    # separate evidence; these header checks alone do not prove launch/parity.
    for item in manifest['artifacts']:
        with (directory / item['file']).open('rb') as f:
            if item['platform'] == 'win32':
                assert f.read(2) == b'MZ', 'Windows input is not a PE installer'
            else:
                f.seek(-512, os.SEEK_END)
                assert f.read(4) == b'koly', 'Mac input is not a UDIF disk image'
    return manifest


def exercise(first_input, second_input):
    first_meta, second_meta = installer_set(first_input), installer_set(second_input)
    assert (first_meta['release'], first_meta['sourceCommit']) != (second_meta['release'], second_meta['sourceCommit']), 'Rollback needs two distinct real build sets'
    report = {'scope': 'LOCAL loopback HTTPS transaction with actual installer bytes; not publication or external HTTPS evidence',
              'sets': [first_meta, second_meta], 'checks': []}
    with tempfile.TemporaryDirectory(prefix='tala-installer-rollback-') as temporary:
        tmp = Path(temporary)
        root = tmp / 'staged'
        first, second = p.stage(first_input, root), p.stage(second_input, root)
        config, cert, key = tmp / 'openssl.cnf', tmp / 'cert.pem', tmp / 'key.pem'
        config.write_text('[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=Tala local artifact verification\n[ext]\nsubjectAltName=IP:127.0.0.1\n')
        subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-config', str(config), '-keyout', str(key), '-out', str(cert)],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        failed_name = next(m['file'] for m in second_meta['artifacts'] if m['platform'] == 'darwin' and m['arch'] == 'x64')
        control = {'fail': False, 'requests': 0}

        class Handler(http.server.SimpleHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                control['requests'] += 1
                if control['fail'] and self.path.endswith('/' + failed_name):
                    self.send_error(503, 'controlled artifact read failure')
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
        os.environ['SSL_CERT_FILE'] = str(cert)  # this process only, normal TLS validation
        latest = root / 'desktop-latest.json'
        try:
            p.promote(root, first, base, 'absent')
            baseline = latest.read_bytes()
            report['checks'].append({'name': 'first complete set promoted after full HTTPS hash read-back', 'status': 'passed', 'latestSha256': p.sha(baseline)})
            control['fail'] = True
            try:
                p.promote(root, second, base, p.sha(baseline))
                raise AssertionError('Failed artifact read was promoted')
            except urllib.error.HTTPError as error:
                assert error.code == 503
                assert latest.read_bytes() == baseline
                report['checks'].append({'name': 'failed Mac read-back preserves the complete current set', 'status': 'passed', 'httpStatus': error.code, 'file': failed_name, 'latestSha256': p.sha(latest.read_bytes())})
            control['fail'] = False
            try:
                p.promote(root, second, base, 'absent')
                raise AssertionError('Stale expected pointer was accepted')
            except ValueError as error:
                assert str(error).startswith('Latest changed')
                assert latest.read_bytes() == baseline
            report['checks'].append({'name': 'stale expected pointer preserves current set', 'status': 'passed'})
            p.promote(root, second, base, p.sha(baseline))
            current = latest.read_bytes()
            assert current != baseline
            report['checks'].append({'name': 'second complete set promoted together', 'status': 'passed', 'latestSha256': p.sha(current)})
            p.promote(root, first, base, p.sha(current))
            assert latest.read_bytes() == baseline
            report['checks'].append({'name': 'whole-set rollback restores the original pointer byte-for-byte', 'status': 'passed', 'latestSha256': p.sha(latest.read_bytes())})
            report['httpsRequests'] = control['requests']
        finally:
            if previous_ca is None:
                os.environ.pop('SSL_CERT_FILE', None)
            else:
                os.environ['SSL_CERT_FILE'] = previous_ca
            server.shutdown()
            server.server_close()
            thread.join()
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('first', type=Path)
    parser.add_argument('second', type=Path)
    parser.add_argument('report', type=Path)
    args = parser.parse_args()
    if args.report.exists():
        raise FileExistsError('Inspect the existing report before running a new exercise')
    report = exercise(args.first.resolve(), args.second.resolve())
    with args.report.open('x') as output:
        json.dump(report, output, indent=2)
        output.write('\n')
    print('Actual-artifact local transaction checks passed:', len(report['checks']))
