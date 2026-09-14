#!/usr/bin/env python3
"""Stage an exported ONNX voice into the APK's asset tree.

Takes an export directory (`model.onnx` + `tokens.txt`, as written by the ONNX export)
and produces what the app imports:

    packages/mobile/assets/voices/<id>/model.onnx   the weights, bundled in the APK
    packages/mobile/assets/voices/<id>/voice.json   sample rate, vocab, content hash

The vocabulary is inlined into voice.json rather than shipped as a second asset: it is
~40 entries, and a plain JSON import is resolved by Metro at build time, so the tokenizer
needs no file I/O and no async setup before the first word can be spoken.

The hash is what the app stamps beside the copy it extracts from the APK on first run —
an APK update can replace the model without changing its filename, so freshness has to be
decided on content, not on a version somebody has to remember to bump.

    scripts/voice/package-voices.py onnx tl --sample-rate 16000
"""
import argparse
import hashlib
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEST = ROOT / 'packages' / 'mobile' / 'assets' / 'voices'


def load_vocab(path: Path) -> dict:
    vocab = {}
    for line in path.read_text().splitlines():
        if not line.strip():
            continue
        symbol, idx = line.rsplit(' ', 1)
        # tokens.txt is whitespace-delimited, so a literal space is spelled out.
        vocab[' ' if symbol == '<space>' else symbol] = int(idx)
    # The pad token is id 0 in every MMS language, but WHICH letter holds it differs
    # ("a" in Tagalog, "k" in English). Verify the id is unique rather than trusting a
    # letter: a vocabulary with two id-0 symbols would make the tokenizer non-deterministic.
    zeros = [sym for sym, idx in vocab.items() if idx == 0]
    if len(zeros) != 1:
        raise SystemExit(f'expected exactly one symbol at id 0, found {zeros}')
    return vocab


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('export_dir', type=Path, help='directory with model.onnx + tokens.txt')
    ap.add_argument('voice_id', help='asset directory name, e.g. tl or en')
    ap.add_argument('--model', default='model.onnx', help='which export to ship')
    ap.add_argument('--sample-rate', type=int, default=16000)
    args = ap.parse_args()

    src = args.export_dir / args.model
    tokens = args.export_dir / 'tokens.txt'
    for p in (src, tokens):
        if not p.exists():
            raise SystemExit(f'missing {p}')

    out = DEST / args.voice_id
    out.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256(src.read_bytes()).hexdigest()
    shutil.copyfile(src, out / 'model.onnx')
    (out / 'voice.json').write_text(
        json.dumps(
            {'sha256': digest, 'sampleRate': args.sample_rate, 'vocab': load_vocab(tokens)},
            ensure_ascii=False,
            indent=2,
        )
        + '\n'
    )
    mb = src.stat().st_size / 1e6
    pad = next(sym for sym, idx in load_vocab(tokens).items() if idx == 0)
    print(f'{args.voice_id}: {args.model} -> {out.relative_to(ROOT)}  {mb:.1f} MB  '
          f'{digest[:12]}  {len(load_vocab(tokens))} symbols, pad={pad!r}')


if __name__ == '__main__':
    main()
