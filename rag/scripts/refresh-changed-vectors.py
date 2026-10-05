#!/usr/bin/env python3
"""Refresh edited fact bodies without re-embedding the unchanged bank.

Requires the original bank file whose hash matches the existing vector metadata:
  python rag/scripts/refresh-changed-vectors.py --before /tmp/before.jsonl

Uses the same fp32 LaBSE raw-CLS recipe as build-vectors.py. Refuses ordinal
changes, a stale baseline, quantization overflow, or failed unchanged controls.
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F
from transformers import AutoModel, AutoTokenizer

ROOT = Path(__file__).resolve().parents[2]
MODEL = 'sentence-transformers/LaBSE'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--before', type=Path, required=True)
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    path = ROOT / 'rag/bank/science-facts.jsonl'
    raw = path.read_bytes()
    old_raw = args.before.read_bytes()
    before = [json.loads(s) for s in old_raw.splitlines() if s.strip()]
    after = [json.loads(s) for s in raw.splitlines() if s.strip()]
    meta_path = ROOT / 'packages/mobile/assets/rag/vectors-labse.meta.json'
    vector_path = meta_path.with_name('vectors-labse.i8.bin')
    meta = json.loads(meta_path.read_text())
    assert meta['bankHash'] == hashlib.md5(old_raw).hexdigest()[:12], 'Wrong baseline bank'
    assert meta['count'] == len(after) == len(before)
    assert [r['id'] for r in before] == [r['id'] for r in after], 'Ordinal changes need full rebuild'
    langs = meta['langs']
    dims = meta['dims']
    assert langs == ['tl', 'bis', 'en'] and dims == 768
    changes = [(j, i) for j, lang in enumerate(langs) for i, (old, new) in enumerate(zip(before, after))
               if (old['topic'], old['fact'][lang]) != (new['topic'], new['fact'][lang])]
    assert changes, 'No changed embeddings'
    assert len(changes) <= 300, 'Use full rebuild for a large update'
    original_bytes = vector_path.read_bytes()
    vectors = np.frombuffer(original_bytes, dtype=np.int8).reshape(len(langs), len(after), dims).copy()
    torch.set_num_threads(4)
    tok = AutoTokenizer.from_pretrained(MODEL)
    model = AutoModel.from_pretrained(MODEL).eval()

    def encode(rows):
        texts = [f"{bank[i]['topic']}. {bank[i]['fact'][langs[j]]}" for bank, j, i in rows]
        enc = tok(texts, return_tensors='pt', padding=True, truncation=True, max_length=192)
        with torch.no_grad():
            cls = model(**enc).last_hidden_state[:, 0]
        return F.normalize(cls, p=2, dim=1).numpy()

    controls = [(j, i) for j in range(3) for i in (0, len(after)//2, len(after)-1)]
    encoded = encode([(before, j, i) for j, i in controls])
    similarities = []
    for v, (j, i) in zip(encoded, controls):
        old = vectors[j, i].astype(np.float32) * meta['scale']
        similarities.append(float(np.dot(v, old) / np.linalg.norm(old)))
    assert min(similarities) > .995, f'Embedding recipe mismatch: {similarities}'
    for start in range(0, len(changes), 8):
        batch = changes[start:start+8]
        encoded = encode([(after, j, i) for j, i in batch])
        assert np.isfinite(encoded).all()
        quantized = np.rint(encoded / meta['scale'])
        assert np.max(np.abs(quantized)) <= 127, 'Scale overflow requires full requantization'
        for v, (j, i) in zip(quantized.astype(np.int8), batch):
            vectors[j, i] = v
        print(f'{min(start+8, len(changes))}/{len(changes)} vectors refreshed', flush=True)
    changed_set = set(changes)
    original = np.frombuffer(original_bytes, dtype=np.int8).reshape(vectors.shape)
    actual_changed = set(zip(*np.where(np.any(vectors != original, axis=2))))
    assert actual_changed <= changed_set, 'Unchanged row modified'
    assert path.read_bytes() == raw, 'Bank changed during encoding; rerun'
    new_bytes = vectors.tobytes()
    report = dict(model=MODEL, revision=model.config._commit_hash,
                  beforeBankHash=meta['bankHash'], afterBankHash=hashlib.md5(raw).hexdigest()[:12],
                  count=len(after), scale=meta['scale'], refreshedVectors=len(changes),
                  unchangedControlCosines=similarities,
                  unchangedVectorsVerified=len(langs)*len(after)-len(changes),
                  changedFacts=sorted({after[i]['id'] for _, i in changes}),
                  beforeVectorsSha256=hashlib.sha256(original_bytes).hexdigest(),
                  afterVectorsSha256=hashlib.sha256(new_bytes).hexdigest())
    args.report.write_text(json.dumps(report, indent=2) + '\n')
    temp = vector_path.with_suffix('.tmp')
    temp.write_bytes(new_bytes)
    temp.replace(vector_path)
    meta['bankHash'] = report['afterBankHash']
    meta_path.write_text(json.dumps(meta, indent=1) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
