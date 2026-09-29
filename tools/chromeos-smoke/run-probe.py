#!/usr/bin/env python3
"""Run the installed x86 diagnostic offline on a disposable Android emulator.

Models must already be provisioned. This force-stops Hiraia and resets only the
diagnostic report. It never clears either app's data or touches a physical device.
"""
import argparse
import json
import re
import subprocess
import time
import xml.etree.ElementTree as ET
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--adb', default='adb')
parser.add_argument('--serial', default='emulator-5554')
parser.add_argument('--server-port', type=int, default=5037)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
adb = [args.adb, '-P', str(args.server_port), '-s', args.serial]
out = args.output
out.mkdir(parents=True, exist_ok=True)
probe = 'com.hiraia.chromeosprobe'

def call(*command, check=True, text=True):
    return subprocess.run(adb + list(command), stdin=subprocess.DEVNULL,
                          capture_output=True, text=text, check=check, timeout=40)

def shell(*command, check=True):
    return call('shell', *command, check=check).stdout.strip()

assert shell('getprop', 'ro.kernel.qemu') == '1', 'Emulator only'
assert shell('getprop', 'ro.product.cpu.abi') == 'x86_64', 'Native x86 guest required'
package = shell('dumpsys', 'package', 'com.hiraia.app')
assert 'primaryCpuAbi=x86_64' in package, 'Hiraia must execute native x86 code'
installed = shell('pm', 'path', 'com.hiraia.app').removeprefix('package:')
expected_sha = shell('sha256sum', installed).split()[0]
network = shell('ip', '-br', 'link')
for interface in ('eth0', 'wlan0'):
    line = next((line for line in network.splitlines() if line.startswith(interface)), '')
    assert not line or 'DOWN' in line, f'Guest must be offline: {line}'
(out / 'network.txt').write_text(network + '\n')

shell('am', 'force-stop', 'com.hiraia.app')
shell('am', 'force-stop', probe)
previous = shell('run-as', probe, 'cat', 'files/probe-report.json', check=False)
if previous:
    (out / 'previous-report.json').write_text(previous + '\n')
shell('run-as', probe, 'rm', '-f', 'files/probe-report.json')
shell('am', 'start', '-n', f'{probe}/.MainActivity')
time.sleep(3)
for _ in range(8):
    shell('uiautomator', 'dump', '--compressed', '/sdcard/hiraia-probe-ui.xml')
    raw = shell('cat', '/sdcard/hiraia-probe-ui.xml')
    nodes = [node.attrib for node in ET.fromstring(raw).iter('node')]
    button = next((node for node in nodes if
                   node.get('content-desc') == 'TEST HIRAIA + LABSE TOGETHER'
                   and node.get('enabled') == 'true'), None)
    if button:
        x1, y1, x2, y2 = map(int, re.findall(r'\d+', button['bounds']))
        if x2 > x1 and y2 > y1:
            shell('input', 'tap', str((x1 + x2) // 2), str((y1 + y2) // 2))
            break
    shell('input', 'swipe', '680', '600', '680', '300', '300')
else:
    raise SystemExit('Combined runtime test button was not reachable')

deadline = time.monotonic() + 900
last = None
report = None
passed = False
try:
    while time.monotonic() < deadline:
        time.sleep(3)
        raw = shell('run-as', probe, 'cat', 'files/probe-report.json', check=False)
        try:
            report = json.loads(raw)
        except json.JSONDecodeError:
            continue
        (out / 'probe-report.json').write_text(json.dumps(report, indent=2) + '\n')
        event = report['events'][-1] if report.get('events') else None
        if not event:
            continue
        marker = (event['stage'], event['status'])
        if marker != last:
            print(*marker, flush=True)
            last = marker
        pid = shell('pidof', probe)
        if pid:
            maps = shell('cat', f'/proc/{pid}/maps')
            if 'qvac-ggml-cpu-' in maps:
                (out / 'resident-maps.txt').write_text(maps + '\n')
        if any(e['status'] == 'FAIL' for e in report['events']):
            break
        if marker == ('suite:hiraia+labse', 'PASS'):
            assert report['provenance']['sourceApkSha256'] == expected_sha, 'Probe does not match installed Hiraia'
            passed = True
            break
finally:
    (out / 'logcat.txt').write_text(call('logcat', '-d').stdout)
    (out / 'result.png').write_bytes(call('exec-out', 'screencap', '-p', text=False).stdout)
    (out / 'summary.json').write_text(json.dumps({
        'passed': passed, 'sourceApkSha256': expected_sha,
        'guestAbi': 'x86_64', 'offline': True, 'lastStage': last,
    }, indent=2) + '\n')
if not passed:
    raise SystemExit('Native x86 runtime suite failed; inspect probe-report.json and logcat.txt')
print('PASS: offline native x86 generation, embedding, unload/reload', flush=True)
