#!/usr/bin/env python3
"""Audit APK ELF imports against the packaged closure and Android NDK API stubs.

This is a static screen, not a runtime compatibility certificate. dlopen/dlsym,
syscalls, Java API use, ISA dispatch and vendor drivers need separate testing.
"""
import argparse
import hashlib
import json
import re
import subprocess
import tempfile
import zipfile
from pathlib import Path


def inspect(readelf, path):
    with path.open('rb') as f:
        if f.read(4) != b'\x7fELF':
            return {'needed': [], 'imports': [], 'exports': [], 'versioned_exports': []}
    text = subprocess.check_output([str(readelf), '--dyn-syms', '--dynamic', '--notes', '--wide', str(path)], text=True)
    imports, exports, versioned_exports = [], set(), set()
    for line in text.splitlines():
        p = line.split()
        if len(p) >= 8 and p[0].rstrip(':').isdigit() and p[0].endswith(':'):
            name = p[7].split('@')[0]
            if p[6] == 'UND':
                imports.append({'symbol': name, 'weak': p[4] == 'WEAK', 'versioned': p[7]})
            elif p[4] in ('GLOBAL', 'WEAK'):
                exports.add(name)
                versioned_exports.add(p[7].replace('@@', '@'))
    needed = re.findall(r'\(NEEDED\).*?\[(.*?)\]', text)
    return {'needed': needed, 'imports': imports, 'exports': sorted(exports), 'versioned_exports': sorted(versioned_exports)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('apk', type=Path)
    parser.add_argument('--ndk', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    host = next((args.ndk / 'toolchains/llvm/prebuilt').iterdir())
    readelf = host / 'bin/llvm-readelf'
    system = host / 'sysroot/usr/lib/aarch64-linux-android'
    args.out.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        packaged = {}
        with zipfile.ZipFile(args.apk) as z:
            for name in z.namelist():
                if name.startswith('lib/arm64-v8a/') and name.endswith('.so'):
                    path = Path(z.extract(name, tmp))
                    packaged[path.name] = inspect(readelf, path)
        # Build the API 29 export catalog, including system libraries requested only
        # through native addons at runtime, not necessarily by the main executable.
        catalog = {p.name: inspect(readelf, p) for p in (system / '29').glob('*.so')}
        combined = {**catalog, **packaged}
        all_exports = set().union(*(set(x['exports']) for x in combined.values()))
        all_versioned_exports = set().union(*(set(x['versioned_exports']) for x in combined.values()))
        version_misses = [{'library': n, **i} for n, lib in packaged.items() for i in lib['imports']
                          if '@' in i['versioned'] and i['versioned'] not in all_versioned_exports]
        findings = []
        for name, lib in packaged.items():
            closure, pending, missing = {name}, list(lib['needed']), set()
            while pending:
                dep = pending.pop()
                if dep in closure:
                    continue
                closure.add(dep)
                if dep in combined:
                    pending.extend(combined[dep]['needed'])
                else:
                    missing.add(dep)
            exports = set().union(*(set(combined[n]['exports']) for n in closure if n in combined))
            for imp in lib['imports']:
                if imp['symbol'] not in exports:
                    findings.append({'library': name, **imp,
                                     'in_other_api29_or_packaged_library': imp['symbol'] in all_exports})
            lib['missing_needed'] = sorted(missing)
        absent = {f['symbol'] for f in findings if not f['in_other_api29_or_packaged_library']}
        introduced = {}
        for api in sorted(int(p.name) for p in system.iterdir() if p.is_dir() and p.name.isdigit() and int(p.name) > 29):
            if not absent:
                break
            for p in (system / str(api)).glob('*.so'):
                for symbol in absent & set(inspect(readelf, p)['exports']):
                    introduced[symbol] = {'first_ndk_api_above_29': api, 'library': p.name}
            absent -= introduced.keys()
        report = {'apk': str(args.apk.resolve()), 'sha256': hashlib.file_digest(args.apk.open('rb'), 'sha256').hexdigest(),
                  'ndk': str(args.ndk), 'api': 29, 'abi': 'arm64-v8a',
                  'limitations': ['Symbols and symbol versions compared against the union of bundled libraries and API29 stubs; runtime linker scope still matters.',
                                 'Weak imports can be optional; closure misses may resolve from runtime global scope.',
                                 'No proof about dlopen/dlsym, Java APIs, syscalls, CPU instructions, drivers or runtime behavior.'],
                  'libraries': {n: {'needed': lib['needed'], 'missing_needed': lib['missing_needed'],
                                     'import_count': len(lib['imports']), 'export_count': len(lib['exports']),
                                     'versioned_imports': [i['versioned'] for i in lib['imports'] if '@' in i['versioned']]}
                                for n, lib in packaged.items()},
                  'outside_dependency_closure': findings, 'later_api_symbols': introduced,
                  'unresolved_symbol_versions': version_misses}
        (args.out / 'native-audit.json').write_text(json.dumps(report, indent=2) + '\n')
        hard = [f for f in findings if not f['weak'] and not f['in_other_api29_or_packaged_library']]
        summary = [f"APK SHA-256: {report['sha256']}", f"ARM64 libraries: {len(packaged)}",
                   f"Strong imports absent from all packaged/API29 exports: {len(hard)}",
                   f"Imports outside declared dependency closure: {len(findings)}",
                   f"Unresolved symbol versions: {len(version_misses)}",
                   f"Later-API symbols: {json.dumps(introduced)}"]
        for n, lib in packaged.items():
            if lib['missing_needed']:
                summary.append(f"Missing DT_NEEDED: {n}: {lib['missing_needed']}")
        summary.extend(json.dumps(f) for f in findings)
        (args.out / 'native-audit.txt').write_text('\n'.join(summary) + '\n')
        print('\n'.join(summary[:6]))


if __name__ == '__main__':
    main()
