#!/usr/bin/env python3
"""Export the approved MB-iSTFT-VITS Tagalog generator (G_15000) to ONNX.

Same interface as the shipped MMS voices (see hiraia-unified scripts/voice/export-onnx.py):
`input_ids` + `attention_mask` in, float waveform out — drop-in for engine.ts.
noise_scale 0.4 / noise_scale_w 0.8 / length_scale 1.0 are baked (the Luis-approved
"lownoise" variant). The repo's TorchSTFT.inverse is already conv-based; its only
non-exportable piece is the numpy window_sumsquare on a dynamic length. For hann(16)/hop 4
the envelope is CONSTANT in the interior, so we divide by that constant instead (verified
against the original below); edge deviation is 12 samples (~0.75 ms) at each end.
"""
import sys, math
sys.path.insert(0, '/workspace/mbistft-en')
import numpy as np
import torch, torch.nn.functional as F
from scipy.signal import get_window

import stft as stft_mod
import utils, commons
from models import SynthesizerTrn
from text.symbols import symbols
from text import text_to_sequence

torch.manual_seed(1234)
# pqmf.PQMF hardcodes .cuda(device); this export runs on CPU while the GPU trains EN.
torch.Tensor.cuda = lambda self, device=None, **kw: self

# ---- export-safe inverse ------------------------------------------------------
# TorchSTFT.inverse uses torch.istft (not ONNX-exportable). Replace with an exact
# conv_transpose1d equivalent: windowed IDFT basis kernel, overlap-add via stride,
# constant hann(16)/hop-4 envelope (1.5 in the interior), center crop n_fft//2.
N, H = 16, 4
w16 = torch.from_numpy(get_window('hann', N, fftbins=True).astype(np.float32))
_k = torch.arange(N//2 + 1, dtype=torch.float32).unsqueeze(1)
_n = torch.arange(N, dtype=torch.float32).unsqueeze(0)
_ang = 2 * math.pi * _k * _n / N
_ck = torch.full((N//2 + 1, 1), 2.0); _ck[0, 0] = 1.0; _ck[-1, 0] = 1.0
KER = torch.cat([w16.unsqueeze(0) * _ck * torch.cos(_ang) / N,
                 -w16.unsqueeze(0) * _ck * torch.sin(_ang) / N], dim=0).unsqueeze(1)  # [18,1,16]
WSS = 1.5

def export_inverse(self, magnitude, phase):
    rmp = torch.cat([magnitude * torch.cos(phase), magnitude * torch.sin(phase)], dim=1)
    it = F.conv_transpose1d(rmp, KER.to(rmp.dtype), stride=H) / WSS
    return it[:, :, N//2 : -(N//2)]

# parity vs the real torch.istft implementation (interior samples)
_t = stft_mod.TorchSTFT(filter_length=16, hop_length=4, win_length=16)
mag = torch.rand(2, 9, 50) + 0.1; ph = torch.rand(2, 9, 50) * 3.14
a = _t.inverse(mag, ph); b = export_inverse(_t, mag, ph)
print("istft shapes:", tuple(a.shape), tuple(b.shape))
inner = slice(16, -16)
d = (a[..., inner] - b[..., inner]).abs().max().item()
print(f"inverse parity (interior): max|diff| = {d:.2e}")
assert d < 1e-4
stft_mod.TorchSTFT.inverse = export_inverse

# ---- model --------------------------------------------------------------------
hps = utils.get_hparams_from_file('/workspace/mbistft-en/configs/hiraia_en_ms.json')
net = SynthesizerTrn(len(symbols), hps.data.filter_length//2+1,
                     hps.train.segment_size//hps.data.hop_length, **vars(hps.model))
import glob as _g; _ck = sorted(_g.glob('/workspace/mbistft-en/logs/hiraia_en_ms/G_*.pth'), key=lambda p:int(p.split('_')[-1].split('.')[0]))[-1]
print('EXPORTING CKPT:', _ck)
utils.load_checkpoint(_ck, net, None)
net.eval()
net.dec.remove_weight_norm()
try: net.flow.remove_weight_norm(); print("flow weight_norm removed")
except Exception as e: print("flow wn left in place:", e)

class Waveform(torch.nn.Module):
    def __init__(self, net, noise_scale):
        super().__init__(); self.net = net; self.ns = noise_scale
    def forward(self, input_ids, attention_mask):
        x_lengths = attention_mask.sum(dim=1)
        o = self.net.infer(input_ids, x_lengths, noise_scale=self.ns,
                           noise_scale_w=0.8, length_scale=1.0)[0]
        return o.squeeze(1)

def ids_for(text):
    seq = text_to_sequence(text, hps.data.text_cleaners)
    seq = commons.intersperse(seq, 0)
    return torch.LongTensor(seq).unsqueeze(0)

x1 = ids_for("The heart pumps blood to every part of the body.")
m1 = torch.ones_like(x1)
x2 = ids_for("The Moon travels around the Earth.")
m2 = torch.ones_like(x2)

import os
outdir_env = os.environ.get('OUT_DIR')
if outdir_env:
    globals()['__OUT'] = outdir_env
OUT = os.environ.get('OUT_DIR', '/workspace/onnx-ms-en')
os.makedirs(OUT, exist_ok=True)

# ---- parity export (noise 0, deterministic) ----------------------------------
wrap0 = Waveform(net, 0.0)
with torch.no_grad():
    ref0 = wrap0(x1, m1)
torch.onnx.export(wrap0, (x1, m1), OUT+'/model.zero.onnx',
    input_names=['input_ids','attention_mask'], output_names=['waveform'],
    dynamic_axes={'input_ids':{0:'b',1:'t'},'attention_mask':{0:'b',1:'t'},'waveform':{0:'b',1:'s'}},
    opset_version=17, do_constant_folding=True)

import onnxruntime as ort
s0 = ort.InferenceSession(OUT+'/model.zero.onnx', providers=['CPUExecutionProvider'])
o0 = s0.run(None, {'input_ids': x1.numpy(), 'attention_mask': m1.numpy()})[0]
pd = float(np.abs(o0[0] - ref0.numpy()[0]).max())
print(f"graph parity (noise=0): torch vs ORT max|diff| = {pd:.2e}  len {o0.shape}")
assert pd < 5e-3, "parity failed"

# ---- ship export (noise 0.4 baked) -------------------------------------------
wrap = Waveform(net, 0.4)
torch.onnx.export(wrap, (x1, m1), OUT+'/model.onnx',
    input_names=['input_ids','attention_mask'], output_names=['waveform'],
    dynamic_axes={'input_ids':{0:'b',1:'t'},'attention_mask':{0:'b',1:'t'},'waveform':{0:'b',1:'s'}},
    opset_version=17, do_constant_folding=True)
s = ort.InferenceSession(OUT+'/model.onnx', providers=['CPUExecutionProvider'])
for x, m, tag in ((x1, m1, 'len%d' % x1.shape[1]), (x2, m2, 'len%d' % x2.shape[1])):
    out = s.run(None, {'input_ids': x.numpy(), 'attention_mask': m.numpy()})[0]
    print(f"ship model, {tag}: waveform {out.shape}, {out.shape[1]/16000:.2f}s, rms {np.sqrt((out**2).mean()):.4f}")
mb = os.path.getsize(OUT+'/model.onnx')/1e6
print(f"model.onnx: {mb:.1f} MB (opset 17)")
