#!/usr/bin/env python3
"""Compile real ELF fixtures to check both sides of the API29 audit boundary."""
import argparse
import json
import subprocess
import tempfile
import zipfile
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--ndk', required=True, type=Path)
args = parser.parse_args()
host = next((args.ndk / 'toolchains/llvm/prebuilt').iterdir())
clang = host / 'bin/clang'
audit = Path(__file__).with_name('audit.py')
with tempfile.TemporaryDirectory() as tmp:
    root = Path(tmp)
    for api, symbol, expected in [(29, 'AChoreographer_getInstance', None),
                                   (30, 'AChoreographer_registerRefreshRateCallback', 30)]:
        source = root / f'api{api}.c'
        # Never executed; the call exists solely to emit a dynamic import.
        source.write_text(f'extern void {symbol}(void); void test(void) {{ {symbol}(); }}\n')
        lib = root / f'libtest{api}.so'
        subprocess.run([str(clang), f'--target=aarch64-linux-android{api}', '-shared', '-fPIC',
                        str(source), '-landroid', '-o', str(lib)], check=True)
        apk = root / f'api{api}.apk'
        with zipfile.ZipFile(apk, 'w') as z:
            z.write(lib, 'lib/arm64-v8a/' + lib.name)
        output = root / f'report{api}'
        subprocess.run(['python3', str(audit), str(apk), '--ndk', str(args.ndk), '--out', str(output)],
                       check=True, stdout=subprocess.DEVNULL)
        report = json.loads((output / 'native-audit.json').read_text())
        if expected is None:
            assert not report['later_api_symbols'], report['later_api_symbols']
            assert not report['unresolved_symbol_versions'], report['unresolved_symbol_versions']
        else:
            assert report['later_api_symbols'][symbol]['first_ndk_api_above_29'] == expected
            assert any(i['symbol'] == symbol and not i['in_other_api29_or_packaged_library']
                       for i in report['outside_dependency_closure'])
        print(f'PASS: API{api} fixture {symbol}: expected later API {expected}')
