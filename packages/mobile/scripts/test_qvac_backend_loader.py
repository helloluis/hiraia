#!/usr/bin/env python3
"""Exercise the real patched loader with simulated CPU capabilities and APK names.

Run against the qvac-fabric source directory printed by the native build. The
loader body is compiled unchanged; fake dlopen/CPUID responses allow unsupported
and absent backends to be tested without executing their instruction sets.
"""
import argparse
import subprocess
import tempfile
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('fabric', type=Path)
args = parser.parse_args()
source = (args.fabric / 'ggml/src/ggml-backend-reg.cpp').read_text()
start = source.index('static ggml_backend_reg_t ggml_backend_load_best(')
body = source[start:source.index('\nvoid ggml_backend_load_all()', start)]

prefix = r'''
#include <filesystem>
#include <map>
#include <memory>
#include <vector>
#include <string>
#include <cstring>
#include <iostream>
#define __ANDROID__ 1
#ifndef __x86_64__
#define __x86_64__ 1
#endif
#define GGML_LOG_ERROR(...) ((void)0)
#define GGML_LOG_DEBUG(...) ((void)0)
#define GGML_LOG_INFO(...) ((void)0)
namespace fs = std::filesystem;
using ggml_backend_reg_t = std::string;
using ggml_backend_score_t = int (*)();
using dl_handle_ptr = std::unique_ptr<int>;
std::map<std::string, int> scores;
int current_score;
int score() { return current_score; }
int * dl_load_library(const fs::path & path) {
    auto it = scores.find(path.string());
    if (it == scores.end()) return nullptr;
    current_score = it->second;
    return new int(1);
}
void * dl_get_sym(int *, const char *) { return reinterpret_cast<void *>(&score); }
const char * dl_error() { return "not bundled"; }
std::string path_str(const fs::path & p) { return p.string(); }
fs::path backend_filename_prefix() { return "libqvac-ggml-"; }
fs::path backend_filename_extension() { return ".so"; }
fs::path get_executable_path() { return "/nonexistent-hiraia-loader-test"; }
struct registry {
    std::string load_backend(const fs::path & p, bool) { return p.string(); }
} reg;
registry & get_reg() { return reg; }
'''
suffix = r'''
int main() {
    auto check = [](const char * expected) {
        const auto actual = ggml_backend_load_best("cpu", true, "/nonexistent-hiraia-loader-test");
        if (actual != expected) {
            std::cerr << "Expected " << expected << "; got " << actual << '\n';
            return false;
        }
        return true;
    };
    // No optimized backend is present: the oldest supported CPU still works.
    scores = {{"libqvac-ggml-cpu-x64.so", 1}};
    if (!check("libqvac-ggml-cpu-x64.so")) return 1;
    // Several future variants exist but CPUID rejects them. They cannot win
    // merely because their filenames occur later in the fallback list.
    scores["libqvac-ggml-cpu-haswell.so"] = 0;
    scores["libqvac-ggml-cpu-alderlake.so"] = 0;
    scores["libqvac-ggml-cpu-sapphirerapids.so"] = 0;
    if (!check("libqvac-ggml-cpu-x64.so")) return 2;
    // An Ivy Bridge class guest may use AVX/F16C, but lacks AVX2/FMA.
    scores["libqvac-ggml-cpu-sse42.so"] = 5;
    scores["libqvac-ggml-cpu-sandybridge.so"] = 21;
    scores["libqvac-ggml-cpu-ivybridge.so"] = 23;
    if (!check("libqvac-ggml-cpu-ivybridge.so")) return 3;
    // All advertised variants are incompatible: fail rather than execute one.
    scores = {{"libqvac-ggml-cpu-sapphirerapids.so", 0}};
    if (!check("")) return 4;
    std::cout << "4 native loader cases passed\n";
}
'''
with tempfile.TemporaryDirectory(prefix='hiraia-qvac-loader-') as tmp:
    tmp = Path(tmp)
    def run(name, tested_body):
        cpp, exe = tmp / f'{name}.cpp', tmp / name
        cpp.write_text(prefix + tested_body + suffix)
        subprocess.run(['c++', '-std=c++17', str(cpp), '-o', str(exe)], check=True)
        return subprocess.run([str(exe)], capture_output=True, text=True)
    result = run('patched', body)
    print(result.stdout, end='')
    if result.returncode:
        raise SystemExit(result.stderr)
    # Seed the exact historical score bug: the suite must reject it.
    unsafe = body.replace('if (s <= 0)', 'if (false)')
    assert unsafe != body, 'Expected explicit unsupported-CPU guard'
    control = run('unsafe-control', unsafe)
    assert control.returncode != 0, 'Seeded unsupported-CPU defect escaped detection'
    print('Seeded unsupported-CPU defect correctly rejected')
    missing = body.replace('#if defined(__x86_64__)', '#if 0', 1)
    assert missing != body, 'Expected Android x86 basename discovery'
    control = run('missing-backends-control', missing)
    assert control.returncode != 0, 'Seeded missing-backend defect escaped detection'
    print('Seeded missing-backend defect correctly rejected')
