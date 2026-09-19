"""Pitch-normalize corpus-tl-v2 -> corpus-tl-v3: clips with F0 median in
[203,237] copied as-is; others WORLD-resynthesized with f0 scaled so the
median lands on 220 Hz. Parallel over CPU."""
import os, sys, shutil
import numpy as np, soundfile as sf, pyworld
from multiprocessing import Pool

SRC = '/workspace/corpus-tl-v2/wavs'
DST = '/workspace/corpus-tl-v3/wavs'
LO, HI, TARGET = 203.0, 237.0, 220.0

def process(f):
    dst = os.path.join(DST, f)
    if os.path.exists(dst): return 'skip'
    y, sr = sf.read(os.path.join(SRC, f))
    if y.ndim > 1: y = y.mean(1)
    y = np.ascontiguousarray(y, dtype=np.float64)
    f0, t = pyworld.harvest(y, sr, f0_floor=70.0, f0_ceil=400.0)
    v = f0[f0 > 0]
    if len(v) < 5: return 'novoice'
    med = float(np.median(v))
    if LO <= med <= HI:
        shutil.copyfile(os.path.join(SRC, f), dst); return 'copy'
    sp = pyworld.cheaptrick(y, f0, t, sr)
    ap = pyworld.d4c(y, f0, t, sr)
    out = pyworld.synthesize(f0 * (TARGET / med), sp, ap, sr)
    peak = np.abs(out).max()
    if peak > 0.99: out = out * (0.99 / peak)
    sf.write(dst, out.astype(np.float32), sr)
    return 'shift'

if __name__ == '__main__':
    os.makedirs(DST, exist_ok=True)
    files = sorted(f for f in os.listdir(SRC) if f.endswith('.wav') and not f.startswith('._'))
    with Pool(int(sys.argv[1]) if len(sys.argv) > 1 else 8) as p:
        from collections import Counter
        c = Counter(p.map(process, files, chunksize=16))
    print('NORMALIZE_DONE', dict(c), flush=True)
