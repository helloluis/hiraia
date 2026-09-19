#!/usr/bin/env python3
"""Build the kitten-DPO worklist: topic lists with explicit polarity, sharded for
gen-dpo-pairs.wf.js. The generator turns each topic into natural grade-5 prompt(s)
+ a CHOSEN (correct-polarity) and REJECTED (wrong-polarity reflex) answer.

Design principle: MIXED polarity per family so DPO teaches the model to EVALUATE,
not reflexively flip — hazardous AND safe; false AND true myths.

AUP: body/health safety topics (smoking/vaping/alcohol/drugs) are NOT here — they
go to a local generator (TL child body/health can't enter a Claude context). This
worklist is AUP-safe (eclipse/fire/outlets/water/etc + myths + safe + true facts)."""
import json, os, sys

DIR = sys.argv[1] if len(sys.argv) > 1 else '/tmp/dpo-work'
SHARD = 8

# polarity: hazardous → chosen opens YES-dangerous; safe → chosen opens NO-not-dangerous
SAFETY_HAZARDOUS = [
    'titigan ang araw / staring at the sun', 'tumingin sa solar eclipse nang walang proteksyon',
    'maglaro ng posporo o apoy', 'isaksak ang daliri sa outlet/saksakan', 'kumain ng hilaw na manok',
    'uminom ng maruming tubig o baha', 'tumakbo na may hawak na gunting', 'hawakan ang mainit na kalan',
    'lumangoy mag-isa sa malalim na tubig', 'makipag-usap sa estranghero online', 'tumawid nang hindi tumitingin',
    'kumain ng kabute o berry sa gubat na di kilala', 'maglaro ng matalim na kutsilyo',
    'tumayo sa ilalim ng puno kapag may kidlat', 'magpaputok ng paputok nang malapit',
    'tumingin sa welding arc nang walang mask', 'mag-bike nang walang helmet',
]
SAFETY_SAFE = [
    'uminom ng malinis na tubig', 'matulog nang maaga', 'kumain ng gulay', 'magbasa ng libro',
    'mag-exercise', 'maghugas ng kamay', 'magsipilyo ng ngipin', 'maglaro sa labas kapag araw',
    'magtanong sa klase', 'maglaro sa mabait na aso', 'kumain ng prutas', 'uminom ng gatas',
    'maligo', 'magsuot ng helmet kapag nagbibisikleta', 'mag-aral', 'tumulong sa bahay',
    'mag-drawing', 'kumanta', 'maglakad papuntang eskwela kasama ang kaibigan',
]
# myth: false → chosen opens NO-not-true; true → chosen opens YES-true
MYTH_FALSE = [
    'patag ang mundo', '10% lang ng utak ang ginagamit natin', 'nababaliw ang tao kapag full moon',
    'bulag ang mga paniki', '3 segundo lang ang memorya ng goldfish', 'hindi tumama ng dalawang beses ang kidlat sa iisang lugar',
    'nagiging hyper ang bata sa sobrang asukal', 'nagkaka-arthritis kapag pinipitik ang buto-buto ng daliri',
    'kitang-kita ang Great Wall of China mula sa kalawakan', 'nananatili sa tiyan ng 7 taon ang nalulunok na chewing gum',
    'lumalamig ang katawan ng tao papuntang itim-at-puti lang ang panaginip', 'nagkakasakit dahil sa lamig ng panahon',
    'nagbibigay ng night-vision superpower ang carrots', 'lumalaki ang ahas hanggang sa laki ng bahay',
]
MYTH_TRUE = [
    'bilog ang mundo', 'kumukulo ang tubig sa 100 degrees Celsius', 'naglalabas ng oxygen ang mga halaman',
    'isang bituin ang Araw', 'may 206 na buto ang tao', 'nagbobomba ng dugo ang puso',
    'mas mabagal ang tunog kaysa liwanag', 'yelo ang tubig na nagyelo', 'umiikot ang Buwan sa Earth',
    'may walong paa ang gagamba', 'hindi nabubulok ang pulot-pukyutan', 'may tatlong puso ang pugita',
    'Pacific ang pinakamalaking karagatan', 'mas mainit ang kidlat kaysa ibabaw ng Araw',
    'mas mahaba ang isang araw sa Venus kaysa isang taon nito',
]

BUCKETS = {
    'safety_hazardous': ('hazardous', SAFETY_HAZARDOUS),
    'safety_safe': ('safe', SAFETY_SAFE),
    'myth_false': ('false', MYTH_FALSE),
    'myth_true': ('true', MYTH_TRUE),
}
# tl gets the most weight (the failure language); en/bis lighter for cross-lingual robustness.
LANGS = ['tagalog', 'tagalog', 'english', 'cebuano']  # tagalog 2x weight

plan = []
total = 0
for bucket, (polarity, topics) in BUCKETS.items():
    for lang in set(LANGS):
        d = os.path.join(DIR, f'{bucket}__{lang}')
        os.makedirs(d, exist_ok=True)
        # tagalog gets 2 passes (more rows); en/bis 1
        passes = 2 if lang == 'tagalog' else 1
        items = []
        for pnum in range(passes):
            for j, t in enumerate(topics):
                items.append({'id': f'{bucket}-{lang}-{pnum}-{j}', 'topic': t, 'polarity': polarity, 'lang': lang})
        shards = []
        for i in range(0, len(items), SHARD):
            name = f'shard-{i // SHARD}.json'
            json.dump(items[i:i + SHARD], open(os.path.join(d, name), 'w'), ensure_ascii=False)
            shards.append(name)
            total += len(items[i:i + SHARD])
        plan.append({'bucket': bucket, 'lang': lang, 'polarity': polarity, 'dirkey': f'{bucket}__{lang}', 'shards': shards})

json.dump({'dir': DIR, 'plan': plan}, open(os.path.join(DIR, 'plan.json'), 'w'), ensure_ascii=False)
print(f'wrote {total} topic-items across {len(plan)} bucket×lang groups -> {DIR}')
from collections import Counter
for b in BUCKETS: print(f'  {b}: {len([p for p in plan if p["bucket"]==b])} lang-groups')
print('(each topic → generator makes ~2 prompt+pair variations, so ~%d pairs)' % (total * 2))
