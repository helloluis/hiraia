import json, re, os, sys
V=sys.argv[1]  # a / b / c
TURN=re.compile(r'(<\|im_end\|>|<\|endoftext\|>|\n\s*assistant\b|\n\s*user\b)')
def clean(t):
    t=re.sub(r'<think>.*?</think>','',t or '',flags=re.S)
    if '<think>' in t: t=t.split('<think>')[0]
    return TURN.split(t)[0].strip()
rows=json.load(open(f'finetuning/distill/eval/eval-v2{V}-out.json'))
d=f'finetuning/distill/eval/items-v2{V}'; os.makedirs(d,exist_ok=True)
for i,r in enumerate(rows):
    json.dump({'framed_q':r['framed_q'],'topic':r['topic'],'en':r['en'],'tl':r['tl'],'wrong_topic':r['wrong_topic'],
               'out_correct':clean(r['out_correct']),'out_distractor':clean(r['out_distractor']),'out_nofact':clean(r['out_nofact'])},
              open(f'{d}/item-{i:03d}.json','w'),ensure_ascii=False)
print(f'v2{V}: wrote {len(rows)} judge items -> {d}')
