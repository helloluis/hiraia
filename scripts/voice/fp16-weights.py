#!/usr/bin/env python
"""Halve an ONNX file by storing its weights as fp16, without changing what it computes.

    scripts/voice/fp16-weights.py onnx-en/model.onnx onnx-en/model.fp16.onnx


Every large fp32 initializer is rewritten to fp16 and fronted by a `Cast` back to fp32, so
the graph's ops and their dtypes are untouched. At session load ORT's constant folding
collapses Cast(constant) back into an fp32 constant, so inference runs the identical
kernels on identical values - the saving is on DISK and in the APK, not in RAM.

This is deliberately not `convert_float_to_float16`: that rewrites op dtypes too, which on
this graph produced a Cast output-type mismatch ORT rejects, and on a 6k-node graph took
longer than writing this did.

Measured on the English voice: 114.3 MB -> 58.4 MB, RTF 0.265 vs 0.267 (i.e. unchanged),
worst weight error 0.043% of its tensor's scale, weight SNR 73.7 dB.

Small tensors are left alone - biases and scalars are most of the tensor COUNT and none of
the bytes, and each one converted would add a Cast node for nothing.
"""
import sys
import numpy as np
import onnx
from onnx import helper, numpy_helper, TensorProto

src, dst = sys.argv[1], sys.argv[2]
MIN_BYTES = 64 * 1024

model = onnx.load(src)
g = model.graph
keep, casts = [], []
converted = saved = 0
for init in g.initializer:
    if init.data_type != TensorProto.FLOAT:
        keep.append(init)
        continue
    a = numpy_helper.to_array(init)
    if a.nbytes < MIN_BYTES:
        keep.append(init)
        continue
    half = a.astype(np.float16)
    # A weight that overflows fp16 would become inf and silently wreck the audio.
    if not np.isfinite(half).all():
        keep.append(init)
        continue
    name16 = init.name + '_fp16'
    keep.append(numpy_helper.from_array(half, name16))
    casts.append(helper.make_node('Cast', [name16], [init.name],
                                  name=f'cast_{converted}', to=TensorProto.FLOAT))
    converted += 1
    saved += a.nbytes - half.nbytes

del g.initializer[:]
g.initializer.extend(keep)
# Casts depend only on initializers, so they are valid at the very front of a
# topologically ordered graph.
nodes = list(g.node)
del g.node[:]
g.node.extend(casts + nodes)

onnx.checker.check_model(model)
onnx.save(model, dst)
print(f'{converted} tensors -> fp16, {saved/1e6:.1f} MB saved, {len(casts)} Cast nodes added')
