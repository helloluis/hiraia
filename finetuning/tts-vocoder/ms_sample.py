import sys, os, torch, soundfile as sf, numpy as np
REPO, CONFIG, MODELDIR, LINES_FILES, OUT = sys.argv[1:6+ -1] if False else (sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5])
sys.path.insert(0, REPO)
os.chdir(REPO)
import utils, commons
from models import SynthesizerTrn
from text.symbols import symbols
from text import text_to_sequence

hps = utils.get_hparams_from_file(CONFIG)
net_g = SynthesizerTrn(len(symbols), hps.data.filter_length // 2 + 1,
                       hps.train.segment_size // hps.data.hop_length, **hps.model).cuda().eval()
ckpt = utils.latest_checkpoint_path(MODELDIR, 'G_*.pth')
print('loading', ckpt, flush=True)
utils.load_checkpoint(ckpt, net_g, None)

def get_text(t):
    seq = text_to_sequence(t, hps.data.text_cleaners)
    if hps.data.add_blank:
        seq = commons.intersperse(seq, 0)
    return torch.LongTensor(seq)

lines = []
for f in LINES_FILES.split(','):
    lines += [l.strip() for l in open(f) if l.strip()]
chunks = []
with torch.no_grad():
    for t in lines:
        x = get_text(t).cuda().unsqueeze(0)
        xl = torch.LongTensor([x.size(1)]).cuda()
        audio = net_g.infer(x, xl, noise_scale=0.4, noise_scale_w=0.8, length_scale=1.0)[0]
        a = audio[0, 0].cpu().numpy()
        chunks.append(a); chunks.append(np.zeros(int(hps.data.sampling_rate * 0.35), dtype=np.float32))
sf.write(OUT, np.concatenate(chunks), hps.data.sampling_rate)
print('SAMPLE_DONE', OUT, flush=True)
