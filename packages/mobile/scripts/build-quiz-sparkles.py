#!/usr/bin/env python3
"""Build/check the approved one-second quiz cues (macOS afconvert for building).

Install scripts/quiz-audio-requirements.txt in a development Python environment.
Download assets/audio/quiz/sources.json URLs into --sources as <id>.wav or
<id>.mp3. Original hashes are checked before conversion. No network calls.
Use --check to measure the shipped WAV files without rebuilding them.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import wave

import numpy as np
import pyloudnorm as pyln
from scipy.signal import resample_poly

ROOT = Path(__file__).resolve().parents[1] / 'assets/audio/quiz'
RATE = 44100
TARGET_LUFS = -22.0
PEAK_CEILING_DBTP = -3.0
METER = pyln.Meter(RATE)  # BS.1770 K weighting, standard 400 ms gating blocks.


def read_pcm(path):
    with wave.open(str(path)) as wav:
        assert (wav.getnchannels(), wav.getsampwidth(), wav.getframerate()) == (1, 2, RATE), path
        return np.frombuffer(wav.readframes(wav.getnframes()), dtype='<i2').astype(float) / 32768


def measure(samples):
    return {
        'integrated_lufs': round(float(METER.integrated_loudness(samples)), 4),
        'estimated_true_peak_dbtp': round(float(20 * np.log10(
            np.max(np.abs(resample_poly(samples, 4, 1))))), 4),
    }


def check_clips(manifest):
    levels = []
    for source in manifest['sources']:
        for clip in source['clips']:
            target = ROOT / clip['filename']
            assert hashlib.sha256(target.read_bytes()).hexdigest() == clip['sha256'], target
            samples = read_pcm(target)
            assert len(samples) == RATE and samples[0] == samples[-1] == 0, target
            assert np.sqrt(np.mean(samples[:2205] ** 2)) > .001, f'Late/silent onset: {target}'
            actual = measure(samples)
            assert abs(actual['integrated_lufs'] - TARGET_LUFS) < .05, (target, actual)
            assert actual['estimated_true_peak_dbtp'] <= PEAK_CEILING_DBTP, (target, actual)
            assert actual == clip['loudness'], (target, actual)
            levels.append(actual['integrated_lufs'])
            print(clip['filename'], actual)
    print(f'{len(levels)} clips verified; loudness spread {max(levels)-min(levels):.4f} LU.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sources', type=Path)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    manifest = json.loads((ROOT / 'sources.json').read_text())
    if args.check:
        check_clips(manifest)
        return
    if args.sources is None:
        parser.error('--sources is required unless using --check')
    manifest['normalization'] = {
        'method': 'BS.1770 integrated loudness, K weighting, 400 ms blocks, measured after fades',
        'target_lufs': TARGET_LUFS,
        'peak_ceiling_dbtp': PEAK_CEILING_DBTP,
        'peak_measurement': '4x scipy resample_poly estimate',
        'gain_only': True,
        'fade_in_ms': 3,
        'fade_out_ms': 80,
    }
    with tempfile.TemporaryDirectory(prefix='quiz-cues-') as temporary:
        for source in manifest['sources']:
            original = args.sources / (source['id'] + Path(source['download']).suffix)
            assert hashlib.sha256(original.read_bytes()).hexdigest() == source['source_sha256'], source['id']
            decoded = Path(temporary) / (source['id'] + '.wav')
            subprocess.run(['/usr/bin/afconvert', '-f', 'WAVE', '-d', f'LEI16@{RATE}',
                            '-c', '1', str(original), str(decoded)], check=True)
            samples = read_pcm(decoded)
            for clip in source['clips']:
                start = round(clip['start_seconds'] * RATE)
                values = samples[start:start + RATE].copy()
                assert len(values) == RATE, clip['filename']
                # Fade first, then match perceived loudness with constant gain.
                # Do not EQ, compress, pitch shift or change any approved cut.
                indices = np.arange(RATE)
                values *= np.minimum(1, np.minimum(indices / (RATE*.003),
                                                  (RATE-1-indices) / (RATE*.08)))
                level = METER.integrated_loudness(values)
                assert np.isfinite(level), clip['filename']
                values *= 10 ** ((TARGET_LUFS - level) / 20)
                # Fail instead of silently making a peaky clip quieter than the others.
                assert measure(values)['estimated_true_peak_dbtp'] <= PEAK_CEILING_DBTP, clip['filename']
                pcm = np.rint(values * 32768).astype('<i2')
                target = ROOT / clip['filename']
                with wave.open(str(target), 'wb') as wav:
                    wav.setnchannels(1)
                    wav.setsampwidth(2)
                    wav.setframerate(RATE)
                    wav.writeframes(pcm.tobytes())
                clip['sha256'] = hashlib.sha256(target.read_bytes()).hexdigest()
                clip['loudness'] = measure(read_pcm(target))
    (ROOT / 'sources.json').write_text(json.dumps(manifest, indent=2) + '\n')
    check_clips(manifest)


if __name__ == '__main__':
    main()
