"""Voice-v2 corpus generator (P3). Runs pod-side inside chatterbox-finetuning/.

Synthesizes one wav per input line with the narrator reference, resampled to
16 kHz mono for the MS-iSTFT student pipeline, plus an LJSpeech metadata.csv.
Resumable: lines whose output wav already exists are skipped.

Usage:
  python gen_corpus.py --lines /workspace/corpus-lines-en.txt \
      --out /workspace/corpus-en-v2 --prefix en [--adapter]
--adapter loads the fine-tuned LoRA (Tagalog teacher) via the bench loader;
without it the native base model is used (English).
"""
import argparse
import os
import random
import sys

import numpy as np
import soundfile as sf
import torch
import torchaudio

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from src.utils import setup_logger, trim_silence_with_vad
from src.config import TrainConfig
from src.chatterbox_.tts import ChatterboxTTS

logger = setup_logger("gen-corpus")
cfg = TrainConfig()
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
TARGET_SR = 16000
PARAMS = {"temperature": 0.8, "repetition_penalty": 1.2}


def load_engine(use_adapter):
    if use_adapter:
        # reuse the bench script's LoRA loader (resized vocab + adapter)
        import inference_bench2 as bench
        return bench.load_finetuned_engine_lora(DEVICE)
    engine = ChatterboxTTS.from_local(cfg.model_dir, device=DEVICE)
    engine.t3.eval(); engine.s3gen.eval(); engine.ve.eval()
    return engine


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--lines", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--prefix", required=True)
    ap.add_argument("--adapter", action="store_true")
    ap.add_argument("--shard", type=int, nargs=2, default=None, metavar=("K","N"))
    ap.add_argument("--reference", default="/workspace/reference.wav")
    ap.add_argument("--temp", type=float, default=0.8)
    args = ap.parse_args()

    lines = [l.strip() for l in open(args.lines, encoding="utf-8") if l.strip()]
    wav_dir = os.path.join(args.out, "wavs")
    os.makedirs(wav_dir, exist_ok=True)

    todo = [(i, t) for i, t in enumerate(lines)
            if not os.path.exists(os.path.join(wav_dir, f"{args.prefix}-{i:06d}.wav"))
            and (args.shard is None or i % args.shard[1] == args.shard[0])]
    logger.info(f"{len(lines)} lines, {len(todo)} to synthesize")
    if todo:
        engine = load_engine(args.adapter)
        for n, (i, text) in enumerate(todo):
            random.seed(i); np.random.seed(i); torch.manual_seed(i)
            try:
                wav = engine.generate(text=text, audio_prompt_path=args.reference, temperature=args.temp, repetition_penalty=1.2)
                if isinstance(wav, tuple):
                    wav = wav[0]
                wav = wav.squeeze().cpu()
                wav16 = torchaudio.functional.resample(wav, engine.sr, TARGET_SR).numpy()
                wav16 = trim_silence_with_vad(wav16, TARGET_SR)
                if len(wav16) < TARGET_SR // 2:
                    logger.warning(f"line {i}: too short after trim, skipping")
                    continue
                sf.write(os.path.join(wav_dir, f"{args.prefix}-{i:06d}.wav"), wav16, TARGET_SR)
            except Exception as e:
                logger.error(f"line {i} failed: {e}")
            if (n + 1) % 50 == 0:
                logger.info(f"progress {n + 1}/{len(todo)}")

    # metadata over everything present, in line order
    rows = []
    for i, text in enumerate(lines):
        wid = f"{args.prefix}-{i:06d}"
        if os.path.exists(os.path.join(wav_dir, f"{wid}.wav")):
            rows.append(f"{wid}|{text}|{text}")
    with open(os.path.join(args.out, "metadata.csv"), "w", encoding="utf-8") as f:
        f.write("\n".join(rows) + "\n")
    logger.info(f"CORPUS_DONE {len(rows)}/{len(lines)} wavs in {args.out}")


if __name__ == "__main__":
    main()
