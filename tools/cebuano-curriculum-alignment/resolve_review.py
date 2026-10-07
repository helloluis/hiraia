#!/usr/bin/env python3
"""Record the human-readable, individually reviewed alignment decisions.

This is a fixed decision manifest, not an automated linguistic classifier.
Only the exact inventoried Cebuano strings below are eligible for replacement.
"""
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).parent
ROOT = HERE.parents[1]


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


NOTES = {
    97: 'Historical contributions and limits of earlier periodic models preserved.',
    98: 'Elements 1–10 names, symbols, atomic numbers and case checked individually.',
    99: 'Elements 11–20 names, symbols, atomic numbers and case checked individually.',
    100: 'Main-group shell pattern and helium exception preserved; no blanket transition-metal rule.',
    101: 'Fictional single-gene Aa/aa family remains explicitly hypothetical; no inference about real relatives.',
    102: 'Particle charges, locations and approximate masses, including electron 1/1836 u, match.',
    103: 'Three historical PAGASA storm tracks, timestamps and coordinates remain historical, not forecasts.',
    104: 'Rance uses a water-level difference; example does not claim all coasts suit tidal generation.',
    105: 'Changing direction at steady speed still changes velocity; acceleration comparison preserved.',
    106: 'napulo ka libo means ten thousand, losing English plural tens. Published parallel Cebuano/English attests tinagpulo ka libo; restore the quantity without inventing a numeric bound.',
    107: 'lapaw denotes going beyond/overflowing, not low-viscosity runny lava. Use explicit lava nga dali moagos; preserve broad-base comparison.',
    108: 'Xylem water/mineral transport preserved against wrong tissue distractors.',
    109: 'Photosynthesis distinguishes CO2/water material inputs from light energy and oxygen output.',
    110: 'Oxygen in aerobic respiration and energy release preserved; no photosynthesis substitution.',
    111: 'PAGASA weather-agency role and alternative agencies remain distinct.',
    112: 'Perpendicular force does zero work along displacement; no claim that all forces do no work.',
    113: 'Relative order and 100/90 age bracket around 95 retained with uncertainty and independent evidence.',
    114: 'Wolff lubug includes blurred vision, so preserve that body wording. Question omitted distant photograph alone; restore the English comparison.',
    115: 'DENR 2017 plant and 2019 fauna lists, category names, dated/local versus global scope retained.',
    116: 'Fixed mass versus comparable net force, equal time intervals and a = Fnet/m preserved. Explicitly repeat each trial rather than ambiguously change it.',
    117: 'hayag is bright, not exposed wire; panapton is cloth, not any plastic covering. Restore the specific insulation hazards while preserving low-voltage/adult/switch/rating restrictions.',
    118: 'Series/parallel circuit behavior and component/source ratings retained; no mains instruction.',
    119: 'Multiple earthquake/volcano/map clues locate boundaries but do not predict an individual event.',
    120: 'DNA-to-traits account retains multiple genes and environmental contributions.',
    121: 'Medical X-ray imaging and bone/soft-tissue contrast retained without learner-use instructions.',
    122: 'Restore omitted radioactive-decay origin of gamma rays and fighting disease while protecting healthy parts; replace malformed Babinantayon with dictionary-attested maampingon.',
    123: 'H2O two hydrogen atoms/bonds and oxygen relationship checked; distractors remain distinct.',
    124: 'NH3 one nitrogen and three hydrogen atoms preserved, answer index unchanged.',
    125: 'Oxygen atomic number8 and shell count2+6 preserved.',
    126: 'Multiple independent long-term global climate records distinguished from one local weather event.',
    127: 'Mass/velocity controls, p = mv, impulse and stopping-time/pad limits retained. Make repeated trials explicit.',
    128: 'No single reaction clue proves a new substance; unknown substances/cleaners must not be tasted or smelled.',
    129: 'Indicator color transitions, equal volumes/drops and salt caveat match. Use attested Cebuano dalag for yellow and explicitly repeat tests; no claim that borrowed dilaw is ungrammatical.',
    130: 'Restore measured water volume and repeated trials; retain controlled tablet mass/mixing, temperature variable and gas-rate versus sugar-dissolving distinction.',
    131: 'Mass balance, 2Mg + O2 → 2MgO and lost-gas accounting retained; no sealed gas container or unsupervised burning.',
    132: 'Seatbelt/airbag stopping conditions and average force retained; airbag is not a seatbelt replacement.',
    133: 'Generation/transmission/current and electrical safety limits preserved.',
    134: '10 W ×2 h =20 Wh =0.02 kWh and safe lighting retained. Ask an adult to handle equipment, rather than make them touch it.',
    135: 'Inherited variation and selection across generations retained, without intentional adaptation.',
    136: 'Blood-pressure feedback mechanism and direction checked against English and options.',
    137: 'GNSS repeated multi-year displacement/velocity evidence retained, not instantaneous earthquake prediction.',
}

REFUTED = {
    63: 'Keep semilya: Wolff similya explicitly includes seedling, especially for transplanting. Rarity/spelling variation is not a defect.',
    68: 'Keep hulagway: dictionary allows a mental image/description and the key context is clear. Earlier narrowing-to-picture suspicion is withdrawn.',
    70: 'Keep semilya seedling distractor on the same positive lexical authority as record63.',
    73: 'Keep putot/usbong: bud usage is attested and the potato-eye comparison preserves the English distinction.',
    78: 'Keep titip: Wolff títip means very steep. Earlier statement that it was incorrect was false; no gradient rewrite is justified.',
    79: 'Keep lungag: a hole/opening in the barrier can be the wave gap. Earlier preference for gintang was stylistic, not a proven defect.',
}

# Ordinal -> exact old/new substring pairs. Every matched source leaf is recorded
# separately, so body/explanation and overlay/supplement copies stay synchronized.
FIXES = {
    2: [('Naglakaw', 'Naglihok')],
    3: [('Naglakaw', 'Naglihok')],
    4: [('Dili kanunay sukwahi sa lihok sa butang gikan sa yuta ang friction:', 'Dili kanunay sukwahi ang friction sa lihok sa butang kon ang yuta ang basihan:'), ('Nag dailos', 'Nagdailos')],
    10: [('Gamay ang direktang epekto sa natunaw nga naglutaw nga sea ice kay nakapahiluna na kini og tubig,', 'Gamay ang direktang epekto sa pagkatunaw sa naglutaw nga sea ice sa sea level kay naa nay water displacement tungod niini,')],
    34: [('Nagalihok', 'Naglihok'), ('hamis ug bagis nga panapton', 'hamis ug gansal nga panapton')],
    45: [('humok nga yuta', 'humok nga yutang kulonon')],
    47: [('pareho ang katulin sa matag segundo sa B ug C', 'dili mausab ang katulin sa B ug dili usab mausab ang katulin sa C')],
    51: [('Itandi ang Pag-agas sa Yuta', 'Itandi ang Pag-agas sa Tubig sa Yuta'), ('parehas nga gidaghanon sa uga', 'parehas nga volume sa uga'), ('samang gisukod nga gidaghanon sa tubig', 'samang gisukod nga volume sa tubig'), ('texture ug pagkaputos sa yuta', 'texture ug pagkadasok sa yuta')],
    52: [('gidaghanon sa yuta', 'volume sa yuta')],
    57: [('humok nga yuta', 'humok nga yutang kulonon')],
    61: [('Gipainit sa Sun ang imong panit through radiation! Nagpadala kini ug invisible infrared waves sa empty vacuum sa space para makabot nimo.', 'Ang Adlaw mopainit sa imong panit pinaagi sa radiation! Mopadala kini og dili makita nga infrared waves latas sa walay sulod nga vacuum sa kawanangan aron makaabot kanimo.')],
    64: [('tanang bagis nga nawong', 'tanang gansal nga nawong')],
    75: [('nag-okupar og puy-anan', 'nag-okupar og luna'), ('Wala kini sulod', 'Walay sulod nga luna kini')],
    86: [('Ang pagbisikleta padulong sa bell nagpahimo niini nga medyo mas taas kaysa sa naglingkod nimong higala.', 'Ang pagbisikleta padulong sa kampana makapahimo nga medyo mas taas ang pitch nga imong madungog kaysa sa madungog sa imong naglingkod nga higala.')],
    89: [('Naglakaw', 'Naglihok'), ('Kon magpadayon ang puwersa paingon sa wala,', 'Kon magpadayon sa igo nga gidugayon ang puwersa paingon sa wala,')],
    94: [('patuyoka ang globo sa matag posisyon sa orbit', 'patuyoka ang globo kausa sa matag posisyon sa orbit'), ('Itandi ang bahin nga hayag:', 'Itandi kon unsa kadako nga bahin sa agianan niini ang hayag:')],
    106: [('napulo ka libo ka tuig', 'tinagpulo ka libo ka tuig')],
    107: [('Nganong mahimong makahimo og lapad nga base ang lapaw nga lava?', 'Nganong mahimong makahimo og lapad nga base ang lava nga dali moagos?')],
    114: [('Unsang obserbasyon ang nanginahanglan og probe duol sa planeta?', 'Unsang obserbasyon ang nanginahanglan og probe duol sa planeta imbes nga hulagway lamang nga gikuha gikan sa layo?')],
    116: [('usba ang matag trial', 'balika ang matag trial')],
    117: [('hayag nga mains wires', 'mga mains wire nga walay tabon'), ('plastik nga panapton', 'plastik nga tabon')],
    122: [('Oo! Naggamit ang mga doktor og kusgan nga gamma ray aron i-target ug patayon ang cancer cells. Babinantayon kining gisukod aron mapanalipdan ang himsog nga lawas.', 'Oo! Naggamit ang mga doktor og kusgan nga gamma rays gikan sa radioactive decay aron i-target ug patayon ang cancer cells. Maampingon kining gisukod aron batokan ang sakit samtang gipanalipdan ang himsog nga mga bahin sa lawas.')],
    127: [('Itala ang oras sa paghunong ug usba.', 'Itala ang oras sa paghunong ug balika ang pagsulay.')],
    129: [('Dilaw ang bromothymol blue', 'Dalag ang bromothymol blue'), ('Apili og nailhang controls ug usba.', 'Apili og nailhang controls ug balika ang pagsulay.')],
    130: [('parehas nga gidaghanon sa tubig', 'parehas nga volume sa tubig'), ('usba ug igraph ang resulta', 'balika ang mga pagsulay ug igraph ang resulta')],
    134: [('ipahikap sa hamtong ang plugs o kagamitan', 'hangyoa ang hamtong nga modumala sa mga plug o kagamitan')],
}


def main():
    inventory = json.loads((HERE/'review-inventory-001.json').read_bytes())
    records = inventory['records']
    assert len(records) == 137
    for file, pin in inventory['source_pins'].items():
        assert hashlib.sha256((ROOT/file).read_bytes()).hexdigest() == pin['sha256'], file
    reviewed = {}
    for file in ['full-readings-001.json', 'full-readings-002.json']:
        for record in json.loads((HERE/file).read_bytes())['records']:
            assert record['record_sha256'] == digest(records[record['ordinal']-1])
            reviewed[record['ordinal']] = record
    third = []
    for n, note in NOTES.items():
        r = records[n-1]
        third.append({'ordinal': n, 'fact_id': r['fact_id'], 'record_sha256': digest(r),
                      'full_fields_read': len(r['fields']), 'note': note,
                      'status': 'edit_pending' if n in FIXES else 'keep_after_english_comparison',
                      'native_certified': False})
    for record in third:
        reviewed[record['ordinal']] = record
    assert set(reviewed) == set(range(1,138))
    changes, decisions = [], []
    for r in records:
        n = r['ordinal']
        hits = [0]*len(FIXES.get(n, []))
        for field in r['fields']:
            before = field['bis']
            after = before
            for i, (old, new) in enumerate(FIXES.get(n, [])):
                if old in after:
                    assert after.count(old) == 1, (n, old)
                    after = after.replace(old, new)
                    hits[i] += 1
            if after != before:
                changes.append({'ordinal': n, 'fact_id': r['fact_id'],
                                'file': field['file'], 'pointer': field['pointer']+'/bis',
                                'english': field['en'], 'before': before, 'after': after})
        assert all(hits), (n, hits)
        decisions.append({'ordinal': n, 'fact_id': r['fact_id'], 'record_sha256': digest(r),
                          'decision': 'edit' if n in FIXES else 'keep',
                          'full_fields_reviewed': len(r['fields']),
                          'reason': REFUTED.get(n, reviewed[n]['note']),
                          'native_certified': False})
    plan = {'schema': 'hiraia.cebuano-curriculum-edits/v1',
            'inventory_sha256': hashlib.sha256((HERE/'review-inventory-001.json').read_bytes()).hexdigest(),
            'source_pins': inventory['source_pins'], 'decisions': decisions, 'changes': changes,
            'reviewer': 'Codex local alignment review', 'native_certified': False,
            'scope': 'English fidelity and evidenced lexical corrections only; no English/Filipino or answer-key changes.',
            'evidence': ['evidence/dictionary-002.json', 'evidence/dictionary-003.json',
                         'evidence/dictionary-004.json', 'evidence/lexical-corpus-001.json',
                         'evidence/quantity-attestation-001.json']}
    outputs = {'full-readings-003.json': {'reviewer': plan['reviewer'], 'records': third},
               'lexical-resolution-addendum-001.json': {'supersedes': 'Only the tentative lexical conclusions for these records in full-readings-002.json', 'resolutions': REFUTED},
               'reviewed-edits-001.json': plan}
    assert all(not (HERE/file).exists() for file in outputs)
    for file, doc in outputs.items():
        (HERE/file).write_text(json.dumps(doc, ensure_ascii=False, indent=2)+'\n')
    print(json.dumps({'records': len(decisions), 'edit_records': len(FIXES), 'bis_leaves': len(changes), 'keep_records': len(decisions)-len(FIXES)}))


if __name__ == '__main__':
    main()
