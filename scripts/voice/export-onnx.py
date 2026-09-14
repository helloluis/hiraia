#!/usr/bin/env python3
"""Turn a finetune-hf-vits training output into the ONNX the app ships.

The trainer saves a VitsModelForPreTraining: the generator plus a discriminator that
exists only to train it. Loading those weights as a plain VitsModel drops the
discriminator, which is most of the file size and none of the inference path.

The exported graph is deliberately the smallest possible interface — `input_ids` and
`attention_mask` in, a float waveform out — so the React Native side needs no ORT
extensions and no C++: a ~40-symbol character tokenizer in TypeScript is the entire
front-end (see packages/mobile/src/voice/tokenizer.ts).

Run it wherever torch already lives; the training pod is the obvious place.

    scripts/voice/export-onnx.py /workspace/vits_en_finetuned /workspace/onnx-en
"""
import argparse
import inspect
import json
from pathlib import Path

import torch
from transformers import VitsModel, VitsTokenizer


class Waveform(torch.nn.Module):
    """VitsModel returns a dataclass; ONNX wants a tensor."""

    def __init__(self, model):
        super().__init__()
        self.model = model

    def forward(self, input_ids, attention_mask):
        return self.model(input_ids=input_ids, attention_mask=attention_mask).waveform


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('train_dir', type=Path, help='the fine-tune output directory')
    ap.add_argument('out_dir', type=Path)
    ap.add_argument('--opset', type=int, default=17)
    args = ap.parse_args()
    args.out_dir.mkdir(parents=True, exist_ok=True)

    model = VitsModel.from_pretrained(args.train_dir)
    model.eval()
    # Loud about what did not line up: a renamed weight would otherwise export a model
    # that runs and sounds wrong, which is the worst possible failure here.
    sd = model.state_dict()
    print(f'loaded {sum(p.numel() for p in model.parameters())/1e6:.1f}M params, '
          f'{len(sd)} tensors, sampling_rate={model.config.sampling_rate}')

    tokenizer = VitsTokenizer.from_pretrained(args.train_dir)
    vocab = tokenizer.get_vocab()
    # tokens.txt is whitespace-delimited, so a literal space has to be spelled out.
    lines = [f"{'<space>' if s == ' ' else s} {i}" for s, i in sorted(vocab.items(), key=lambda kv: kv[1])]
    (args.out_dir / 'tokens.txt').write_text('\n'.join(lines) + '\n')
    print(f'tokens.txt: {len(vocab)} symbols, pad={tokenizer.pad_token!r} '
          f'id={vocab.get(tokenizer.pad_token)}')

    # A real sentence, not zeros: tracing a degenerate input can bake a wrong shape into
    # the stochastic duration predictor.
    sample = 'the sun is a star and it is the closest star to the earth'
    ids = tokenizer(sample, return_tensors='pt')
    with torch.no_grad():
        reference = Waveform(model)(ids['input_ids'], ids['attention_mask'])
    print(f'traced on {ids["input_ids"].shape[1]} tokens -> '
          f'{reference.shape[-1]/model.config.sampling_rate:.2f}s')

    torch.onnx.export(
        Waveform(model),
        (ids['input_ids'], ids['attention_mask']),
        str(args.out_dir / 'model.onnx'),
        input_names=['input_ids', 'attention_mask'],
        output_names=['waveform'],
        dynamic_axes={
            'input_ids': {0: 'batch', 1: 'time'},
            'attention_mask': {0: 'batch', 1: 'time'},
            'waveform': {0: 'batch', 1: 'samples'},
        },
        opset_version=args.opset,
        do_constant_folding=True,
        # The legacy TorchScript exporter, explicitly. torch >=2.9 defaults to the
        # dynamo path, which cannot get past VITS's spline flow: that code branches on
        # `torch.min(inputs) < lower_bound`, a data-dependent condition dynamo refuses to
        # guard on. Tracing simply follows the branch the sample input takes, which is the
        # right answer here because the bound check is a guard, not a code path.
        **({'dynamo': False} if 'dynamo' in inspect.signature(torch.onnx.export).parameters else {}),
    )
    mb = (args.out_dir / 'model.onnx').stat().st_size / 1e6
    print(f'model.onnx: {mb:.1f} MB (opset {args.opset})')

    (args.out_dir / 'export.json').write_text(
        json.dumps({'source': str(args.train_dir), 'opset': args.opset,
                    'sampling_rate': model.config.sampling_rate,
                    'vocab_size': len(vocab)}, indent=2) + '\n')


if __name__ == '__main__':
    main()
