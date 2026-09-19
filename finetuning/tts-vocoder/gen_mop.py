import os, re, sys, random
import numpy as np, torch, soundfile as sf, torchaudio
sys.path.insert(0, '/workspace/chatterbox-finetuning')
os.chdir('/workspace/chatterbox-finetuning')
import inference_bench2 as bench
from src.utils import trim_silence_with_vad

LINES = [l.strip() for l in open('/workspace/corpus-lines-tl.marked.txt') if l.strip()]
WD = '/workspace/corpus-tl-v2/wavs'
REF = '/workspace/reference.wav'
TARGET_SR = 16000
missing = [i for i in range(len(LINES)) if not os.path.exists(f'{WD}/tl-{i:06d}.wav')]
print(f'mop-up per-sentence: {len(missing)} lines', flush=True)
engine = bench.load_finetuned_engine_lora('cuda')
for n, i in enumerate(missing):
    sents = [s for s in re.split(r'(?<=[.?!])\s+', LINES[i]) if s.strip()]
    chunks = []
    try:
        for j, sent in enumerate(sents):
            random.seed(i*100+j); np.random.seed(i*100+j); torch.manual_seed(i*100+j)
            wav = engine.generate(text=sent, audio_prompt_path=REF, temperature=0.5, repetition_penalty=1.2)
            if isinstance(wav, tuple): wav = wav[0]
            w16 = torchaudio.functional.resample(wav.squeeze().cpu(), engine.sr, TARGET_SR).numpy()
            w16 = trim_silence_with_vad(w16, TARGET_SR)
            if len(w16) > 0:
                chunks.append(w16); chunks.append(np.zeros(int(TARGET_SR*0.2), dtype=np.float32))
        if chunks and sum(len(c) for c in chunks) >= TARGET_SR // 2:
            sf.write(f'{WD}/tl-{i:06d}.wav', np.concatenate(chunks), TARGET_SR)
        else:
            print(f'line {i}: still too short', flush=True)
    except Exception as e:
        print(f'line {i} failed: {e}', flush=True)
    if (n+1) % 25 == 0: print(f'progress {n+1}/{len(missing)}', flush=True)
# final metadata over full set (UNMARKED text handled later by filelists; keep marked here for consistency)
count = sum(1 for i in range(len(LINES)) if os.path.exists(f'{WD}/tl-{i:06d}.wav'))
print(f'MOP_DONE total {count}/{len(LINES)}', flush=True)
