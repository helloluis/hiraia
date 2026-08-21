#!/usr/bin/env python3
import json
from pathlib import Path

manifest = Path('/Users/luis/Code/hiraia-illu-rework/packages/images/review/batches/batch-096.json')
out = Path('/Users/luis/Code/hiraia-illu-rework/packages/images/review/verdicts/batch-096.jsonl')

verdicts = {
    # webp-1152
    'ffct-35689': ('text', 'name text on shirt'),
    'ffct-35690': ('ok', ''),
    'ffct-35693': ('ok', ''),
    'ffct-35694': ('ok', ''),
    'ffct-35695': ('ok', ''),
    'ffct-35696': ('ok', ''),
    'ffct-35698': ('text', 'plate labels baked in'),
    'ffct-35703': ('text', 'age text baked in'),
    'ffct-35704': ('text', 'place and monsoon labels'),
    'ffct-35709': ('ok', ''),
    'ffct-35712': ('ok', ''),
    'ffct-35716': ('text', 'rotation label baked in'),
    'ffct-35718': ('ok', ''),
    'ffct-35719': ('ok', ''),
    'ffct-35720': ('ok', ''),
    'ffct-35721': ('ok', ''),

    # webp-1153
    'ffct-35723': ('ok', ''),
    'ffct-35724': ('ok', ''),
    'ffct-35727': ('ok', ''),
    'ffct-35728': ('ok', ''),
    'ffct-35729': ('text', 'H/He symbols and title'),
    'ffct-35732': ('ok', ''),
    'ffct-35734': ('ok', ''),
    'ffct-35735': ('text', 'eye labels and glasses text'),
    'ffct-35736': ('ok', ''),
    'ffct-35739': ('ok', ''),
    'ffct-35741': ('ok', ''),
    'ffct-35743': ('ok', ''),
    'ffct-35744': ('ok', ''),
    'ffct-35746': ('ok', ''),
    'ffct-35749': ('ok', ''),
    'ffct-35750': ('ok', ''),

    # webp-1154
    'ffct-35751': ('text', 'soil pH kit labels'),
    'ffct-35753': ('text', 'soap label'),
    'ffct-35756': ('ok', ''),
    'ffct-35758': ('text', 'calendar number'),
    'ffct-35759': ('ok', ''),
    'ffct-35760': ('ok', ''),
    'ffct-35763': ('text', 'layer labels'),
    'ffct-35765': ('text', 'wave labels'),
    'ffct-35766': ('text', 'wave and core labels'),
    'ffct-35768': ('text', 'layer labels'),
    'ffct-35769': ('text', 'crust/mantle/Moho labels'),
    'ffct-35770': ('ok', ''),
    'ffct-35772': ('ok', ''),
    'ffct-35774': ('ok', ''),
    'ffct-35776': ('text', 'map labels'),
    'ffct-35779': ('ok', ''),

    # webp-1155
    'ffct-35780': ('ok', ''),
    'ffct-35782': ('text', 'chemical symbols'),
    'ffct-35783': ('ok', ''),
    'ffct-35787': ('ok', ''),
    'ffct-35790': ('ok', ''),
    'ffct-35791': ('ok', ''),
    'ffct-35792': ('ok', ''),
    'ffct-35793': ('ok', ''),
    'ffct-35795': ('text', 'Benguet map labels'),
    'ffct-35796': ('ok', ''),
    'ffct-35799': ('ok', ''),
    'ffct-35802': ('ok', ''),
    'ffct-35809': ('ok', ''),
    'ffct-35810': ('text', 'epicenter/focus labels'),
    'ffct-35811': ('ok', ''),
    'ffct-35812': ('text', 'danger sign text'),

    # webp-1156
    'ffct-35813': ('text', 'air pressure label'),
    'ffct-35815': ('ok', ''),
    'ffct-35817': ('ok', ''),
    'ffct-35818': ('ok', ''),
    'ffct-35819': ('ok', ''),
    'ffct-35823': ('ok', ''),
    'ffct-35824': ('ok', ''),
    'ffct-35825': ('ok', ''),
    'ffct-35828': ('ok', ''),
    'ffct-35829': ('ok', ''),
    'ffct-35831': ('text', 'ocean label'),
    'ffct-35833': ('ok', ''),
    'ffct-35836': ('ok', ''),
    'ffct-35840': ('text', 'hygrometer readout text'),
    'ffct-35841': ('ok', ''),
    'ffct-35843': ('ok', ''),

    # webp-1157
    'ffct-35845': ('text', 'warning sign text'),
    'ffct-35846': ('ok', ''),
    'ffct-35849': ('ok', ''),
    'ffct-35853': ('text', 'layer labels'),
    'ffct-35855': ('ok', ''),
    'ffct-35857': ('ok', ''),
    'ffct-35860': ('ok', ''),
    'ffct-35862': ('ok', ''),
    'ffct-35863': ('ok', ''),
    'ffct-35864': ('ok', ''),
    'ffct-35867': ('ok', ''),
    'ffct-35868': ('ok', ''),
    'ffct-35870': ('ok', ''),
    'ffct-35872': ('ok', ''),
    'ffct-35873': ('ok', ''),
    'ffct-35882': ('ok', ''),

    # webp-1158
    'ffct-35884': ('text', 'salt farm sign'),
    'ffct-35885': ('ok', ''),
    'ffct-35886': ('ok', ''),
    'ffct-35890': ('ok', ''),
    'ffct-35891': ('ok', ''),
    'ffct-35892': ('ok', ''),
    'ffct-35893': ('ok', ''),
    'ffct-35894': ('ok', ''),
    'ffct-35895': ('ok', ''),
    'ffct-35896': ('text', 'Fe/Hemoglobin labels'),
    'ffct-35897': ('ok', ''),
    'ffct-35898': ('ok', ''),
    'ffct-35902': ('text', 'Ni and battery labels'),
    'ffct-35905': ('text', 'Feldspar label'),
    'ffct-35906': ('text', 'magnitude labels'),
    'ffct-35909': ('ok', ''),

    # webp-1159
    'ffct-35912': ('text', 'signal number sign'),
    'ffct-35913': ('ok', ''),
    'ffct-35916': ('ok', ''),
    'ffct-35918': ('text', 'well sign and labels'),
    'ffct-35919': ('ok', ''),
    'ffct-35921': ('text', 'sand/silt/clay labels'),
    'ffct-35923': ('text', 'wave labels'),
    'ffct-35924': ('text', 'front labels'),
    'ffct-35927': ('ok', ''),
    'ffct-35930': ('ok', ''),
    'ffct-35931': ('ok', ''),
    'ffct-35933': ('text', 'sunscreen label'),
    'ffct-35935': ('text', 'radio text'),
    'ffct-35936': ('text', 'place name labels'),
    'ffct-35939': ('text', 'pole labels'),
    'ffct-35940': ('ok', ''),

    # webp-1160
    'ffct-35941': ('ok', ''),
    'ffct-35945': ('ok', ''),
    'ffct-35946': ('ok', ''),
    'ffct-35947': ('ok', ''),
    'ffct-35948': ('text', 'front labels'),
    'ffct-35952': ('ok', ''),
    'ffct-35953': ('text', 'signal number sign'),
    'ffct-35954': ('ok', ''),
    'ffct-35956': ('ok', ''),
    'ffct-35957': ('text', 'core labels'),
    'ffct-35958': ('ok', ''),
    'ffct-35959': ('ok', ''),
    'ffct-35960': ('ok', ''),
    'ffct-35962': ('ok', ''),
    'ffct-35963': ('text', 'Masinloc sign'),
    'ffct-35964': ('off-topic', 'crescent not gibbous'),

    # webp-1161
    'ffct-35965': ('ok', ''),
    'ffct-35967': ('text', 'altitude and city labels'),
    'ffct-35968': ('ok', ''),
    'ffct-35969': ('text', 'wind name labels'),
    'ffct-35970': ('ok', ''),
    'ffct-35974': ('ok', ''),
    'ffct-35976': ('off-topic', 'no teeth shown'),
    'ffct-35977': ('off-topic', 'adobo pot not rocks'),
    'ffct-35981': ('ok', ''),
    'ffct-35983': ('text', 'rock sign text'),
    'ffct-35984': ('ok', ''),
    'ffct-35989': ('ok', ''),
    'ffct-35990': ('off-topic', 'handwashing not eyes'),
    'ffct-35991': ('off-topic', 'drying seeds not weather'),
    'ffct-35992': ('ok', ''),
    'ffct-35994': ('ok', ''),

    # webp-1162
    'ffct-35995': ('ok', ''),
    'ffct-35996': ('ok', ''),
    'ffct-35998': ('ok', ''),
    'ffct-35999': ('ok', ''),
    'ffct-36000': ('text', 'Pinatubo label'),
    'ffct-36001': ('text', 'tide labels'),
    'ffct-36002': ('ok', ''),
    'ffct-36003': ('ok', ''),
    'ffct-36004': ('ok', ''),
    'ffct-36007': ('ok', ''),
    'ffct-36008': ('ok', ''),
    'ffct-36012': ('ok', ''),
    'ffct-36013': ('ok', ''),
    'ffct-36014': ('ok', ''),
    'ffct-36015': ('ok', ''),
    'ffct-36016': ('off-topic', 'crab not tides'),

    # webp-1163
    'ffct-36020': ('text', 'name plaque text'),
    'ffct-36022': ('ok', ''),
    'ffct-36023': ('text', 'festival sign text'),
    'ffct-36024': ('off-topic', 'turtle not stars'),
    'ffct-36025': ('ok', ''),
    'ffct-36026': ('text', 'aqueduct labels'),
    'ffct-36028': ('ok', ''),
    'ffct-36031': ('text', 'planet labels'),
    'ffct-36032': ('ok', ''),
    'ffct-36033': ('ok', ''),
    'ffct-36034': ('ok', ''),
    'ffct-36037': ('ok', ''),
    'ffct-36040': ('ok', ''),
    'ffct-36043': ('text', 'place name labels'),
    'ffct-36044': ('ok', ''),
    'ffct-36048': ('off-topic', 'firefly not stars'),
}

with manifest.open() as f:
    sheets = json.load(f)

with out.open('w') as f:
    total = 0
    counts = {}
    for sheet in sheets:
        set_name = sheet['set']
        for tile in sheet['tiles']:
            tid = tile['id']
            v, note = verdicts[tid]
            counts[v] = counts.get(v, 0) + 1
            total += 1
            line = json.dumps({'set': set_name, 'id': tid, 'v': v, 'note': note}, ensure_ascii=False)
            f.write(line + '\n')

print(f'total={total}')
print('counts=' + json.dumps(counts, sort_keys=True))
