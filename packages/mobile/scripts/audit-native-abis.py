#!/usr/bin/env python3
"""Check actual ELF architectures and QVAC engines, not just APK directory names."""
import argparse
import json
import os
from pathlib import Path
import re
import struct
import subprocess
import sys
import tempfile
import zipfile

EXPECTED = {'arm64-v8a': (2, 183), 'x86_64': (2, 62), 'armeabi-v7a': (1, 40), 'x86': (1, 3)}
# Public Android platform libraries. OpenCL is an optional vendor backend, declared
# optional in the manifest; it must never become an engine dependency.
SYSTEM_LIBS = {'libc.so', 'libm.so', 'libdl.so', 'liblog.so', 'libandroid.so', 'libz.so',
               'libjnigraphics.so', 'libEGL.so', 'libGLESv2.so', 'libGLESv3.so',
               'libOpenSLES.so', 'libaaudio.so', 'libmediandk.so', 'libvulkan.so',
               'libnativewindow.so', 'libneuralnetworks.so', 'libstdc++.so'}


def linkage(archive, libraries, readelf, errors):
    checked = {}
    with tempfile.TemporaryDirectory(prefix='hiraia-abi-') as temp:
        for abi, names in libraries.items():
            defined, imports = set(), {}
            for name in names:
                file = Path(temp) / name
                file.write_bytes(archive.read(f'lib/{abi}/{name}'))
                report = subprocess.check_output([readelf, '--dynamic', '--dyn-syms', '--wide', str(file)], text=True)
                needed = re.findall(r'\(NEEDED\).*?\[([^\]]+)\]', report)
                allowed = SYSTEM_LIBS | set(names)
                if name == 'libqvac-ggml-opencl.so':
                    allowed |= {'libOpenCL.so'}
                for dependency in needed:
                    if dependency not in allowed:
                        errors.append(f'{abi}/{name}: missing dependency {dependency}')
                imports[name] = set()
                for line in report.splitlines():
                    fields = line.split()
                    if len(fields) < 8 or not fields[0].rstrip(':').isdigit():
                        continue
                    symbol = fields[7].split('@')[0]
                    if fields[6] != 'UND' and fields[4] in ('GLOBAL', 'WEAK'):
                        defined.add(symbol)
                    elif fields[6] == 'UND' and fields[4] == 'GLOBAL':
                        imports[name].add(symbol)
            count = 0
            for name, symbols in imports.items():
                if not name.startswith(('libqvac__', 'libqvac-ggml-')):
                    continue
                # Bare API compatibility and C++ ABI compatibility with the actual
                # libc++ chosen by Gradle, not only the library we built against.
                required = {s for s in symbols if s.startswith(('js_', 'uv_', 'bare_', '_Z'))}
                count += len(required)
                for missing in sorted(required - defined):
                    errors.append(f'{abi}/{name}: unresolved runtime symbol {missing}')
            checked[abi] = {'libraries': len(names), 'qvacRuntimeSymbols': count}
    return checked


def audit(apk, required, readelf=None):
    errors, libraries = [], {}
    with zipfile.ZipFile(apk) as archive:
        for name in archive.namelist():
            parts = name.split('/')
            if len(parts) != 3 or parts[0] != 'lib' or not name.endswith('.so'):
                continue
            abi = parts[1]
            libraries.setdefault(abi, []).append(parts[2])
            with archive.open(name) as stream:
                header = stream.read(20)
            if len(header) < 20 or header[:4] != b'\x7fELF' or header[5] not in (1, 2):
                errors.append(f'{name}: not an ELF library')
                continue
            machine = struct.unpack('<H' if header[5] == 1 else '>H', header[18:20])[0]
            if EXPECTED.get(abi) != (header[4], machine):
                errors.append(f'{name}: wrong ELF class/machine {header[4]}/{machine}')
        for abi in required or libraries:
            names = libraries.get(abi, [])
            if not names:
                errors.append(f'{abi}: ABI is missing from APK')
                continue
            for prefix in ['libqvac__llm-llamacpp.', 'libqvac__embed-llamacpp.', 'libqvac-ggml-cpu']:
                if not any(name.startswith(prefix) for name in names):
                    errors.append(f'{abi}: missing QVAC library {prefix}*')
        if 'arm64-v8a' in required and 'x86_64' in required:
            # Includes every worker addon and React Native/voice/database module.
            # CPU backend names are intentionally architecture-specific.
            shared = {name for name in libraries.get('arm64-v8a', [])
                      if not name.startswith('libqvac-ggml-cpu-')}
            for name in sorted(shared - set(libraries.get('x86_64', []))):
                errors.append(f'x86_64: missing ARM64 counterpart {name}')
        linked = linkage(archive, libraries, readelf, errors) if readelf else None
    return {'apk': str(apk), 'abis': {abi: len(names) for abi, names in libraries.items()}, 'linkage': linked,
            'required': required, 'errors': errors, 'passed': not errors}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('apk')
    parser.add_argument('--require', action='append', choices=EXPECTED, default=[])
    parser.add_argument('--linkage', action='store_true', help='Check dependencies and QVAC runtime symbols with NDK llvm-readelf')
    parser.add_argument('--readelf', help='Explicit llvm-readelf path')
    args = parser.parse_args()
    readelf = args.readelf
    if args.linkage and not readelf:
        sdk = Path(os.environ.get('ANDROID_HOME', Path.home() / 'Library/Android/sdk'))
        candidates = sorted(sdk.glob('ndk/*/toolchains/llvm/prebuilt/*/bin/llvm-readelf'))
        if not candidates:
            parser.error('Linkage audit requires Android NDK llvm-readelf; use --readelf or ANDROID_HOME')
        readelf = str(candidates[-1])
    result = audit(args.apk, args.require, readelf)
    print(json.dumps(result, indent=2))
    sys.exit(0 if result['passed'] else 1)
