#!/usr/bin/env python3
"""Build a synthetic candidates dir to exercise ingest-lane-a.py end to end (default: lane-a/out-test/).

  - 25 EXISTING bank facts re-submitted as candidates: 8 verbatim (validate must reject them as en-exact-in-bank)
    and 17 lightly paraphrased (LaBSE dedup must drop them at cosine ≥ 0.86);
  - 16 genuinely new facts for G6-F-10 (sound + moving source/receiver) and G5-F-5 (heavier vs lighter falling);
  - 7 deliberately invalid rows (unknown code, domain mismatch, confidence 1, too short, too long, exact dup, missing en);
  - a 3-row lane-a-G5-L-3.jsonl (2 plain clinical rows + 1 invalid) so the AUP stream's counts-only path is covered.

  finetuning/.convert-venv/bin/python rag/pipeline/lane-a/make-test-fixture.py [--out DIR]
"""
import argparse, json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
BANK = os.path.join(HERE, '..', '..', 'bank', 'science-facts.jsonl')
CODE_FOR_DOMAIN = {'EARTH_SPACE': 'G6-E-3', 'FORCE_MOTION_ENERGY': 'G6-F-9', 'MATTER': 'G6-M-5'}
AVOID = re.compile(r'\b(blood|bone|poison|toxic|sick|disease|illness|body|reproduc|pregnan|sperm|egg cell|urine|feces)', re.I)
PREFIX = ['Did you know that ', 'Scientists have found that ', 'Kids can remember that ', 'It is a fact that ']

NEW = [
    # G6-F-10 — describe and explain how sound changes when the source or the receiver are moving
    ('G6-F-10', 'siren pitch when ambulance passes', 'When an ambulance speeds toward you its siren sounds higher in pitch, and as it drives away the pitch drops lower.', ['siren', 'ambulance', 'pitch', 'tunog', 'tinig', 'mas mataas', 'mas mababa', 'ambulansya']),
    ('G6-F-10', 'sound waves squeezed in front of moving source', 'Sound waves from a moving source get squeezed closer together in front of it, so a listener in front hears a higher pitch.', ['sound wave', 'moving source', 'pitch', 'higher', 'tunog', 'gumagalaw', 'naglihok']),
    ('G6-F-10', 'sound waves stretched behind moving source', 'Behind a moving sound source the waves are stretched farther apart, so a listener behind it hears a lower pitch.', ['sound wave', 'lower pitch', 'behind', 'tunog', 'mas mababa', 'likod', 'luyo']),
    ('G6-F-10', 'faster motion bigger pitch change', 'The faster a horn or siren moves toward or away from you, the bigger the change in pitch you hear.', ['pitch', 'faster', 'siren', 'horn', 'bilis', 'paspas', 'tunog']),
    ('G6-F-10', 'moving listener hears higher pitch', 'If you ride a fast bus toward a ringing church bell, the bell sounds slightly higher than it does when you stand still.', ['bell', 'bus', 'moving listener', 'pitch', 'kampana', 'sumasakay', 'nagsakay']),
    ('G6-F-10', 'Doppler effect name', 'This change in pitch caused by motion is called the Doppler effect, named after the scientist Christian Doppler.', ['Doppler effect', 'Doppler', 'pitch', 'motion', 'galaw', 'lihok', 'tunog']),
    ('G6-F-10', 'bats hear pitch change in echoes', 'Bats notice the pitch of their returning echoes change, which tells them whether an insect is flying toward them or away.', ['bat', 'echo', 'pitch', 'paniki', 'kabog', 'insekto', 'alingawngaw']),
    ('G6-F-10', 'motorcycle sound drops as it passes', 'A racing motorcycle passing a crowd makes a long falling sound because its engine noise drops in pitch as it goes by.', ['motorcycle', 'pitch', 'engine', 'motorsiklo', 'tunog', 'dumadaan', 'moagi']),
    ('G6-F-10', 'Doppler weather radar', 'A Doppler weather radar sends out radio waves and measures how their frequency changes when they bounce off moving raindrops, revealing the wind inside a storm.', ['Doppler radar', 'PAGASA', 'radar', 'frequency', 'ulan', 'bagyo', 'hangin']),
    # G5-F-5 — predict and explain whether heavier objects fall faster than lighter objects due to gravity
    ('G5-F-5', 'coins of different weight fall together', 'If you drop a 1-peso coin and a 5-peso coin from the same height at the same time, they hit the floor together even though one is heavier.', ['coin', 'fall', 'gravity', 'barya', 'nahuhulog', 'nahulog', 'mahulog', 'sabay']),
    ('G5-F-5', 'flat vs crumpled paper falling', 'A flat sheet of paper falls slower than a crumpled one because air pushes against the flat sheet more, not because their weights are different.', ['paper', 'air resistance', 'fall', 'papel', 'hangin', 'nahuhulog', 'mabagal']),
    ('G5-F-5', 'gravity speeds up all objects equally', 'Earth\'s gravity speeds up every falling object by about 10 meters per second each second, no matter how heavy the object is.', ['gravity', 'fall', 'speed up', 'bumibilis', 'mibilis', 'mabigat', 'bug-at']),
    ('G5-F-5', 'heavier object pulled harder but harder to move', 'A heavier object is pulled harder by gravity, but it is also harder to get moving, so it speeds up at the same rate as a lighter one.', ['gravity', 'heavier', 'lighter', 'mabigat', 'magaan', 'bug-at', 'gaan']),
    ('G5-F-5', 'feather and coin in vacuum tube', 'In a tube with the air pumped out, a feather and a coin dropped together fall side by side and land at the same moment.', ['vacuum', 'feather', 'coin', 'balahibo', 'barya', 'nahuhulog', 'sabay']),
    ('G5-F-5', 'hammer and feather on the Moon', 'In 1971 an astronaut on the Moon dropped a hammer and a feather together, and with no air both landed at the same time.', ['Moon', 'astronaut', 'hammer', 'feather', 'buwan', 'martilyo', 'balahibo']),
    ('G5-F-5', 'parachute slows a fall', 'Air resistance, not weight, is why a parachute jumper floats down slowly while a dropped stone falls fast.', ['parachute', 'air resistance', 'fall', 'bato', 'mabagal', 'hinay', 'hangin']),
]

INVALID = [
    dict(tmp_id='lane-a-BAD-001', brief_code='G9-X-1', domain='MATTER', topic='unknown code', grades=[9], en='Water boils at about 100 degrees Celsius at sea level, which is why kettles whistle.', terms=['a'] * 6, source='x', card_form='fact', confidence=3),
    dict(tmp_id='lane-a-BAD-002', brief_code='G6-E-3', domain='MATTER', topic='domain mismatch', grades=[6], en='Mayon Volcano in Albay is famous for its almost perfect cone shape and frequent eruptions.', terms=['a'] * 6, source='x', card_form='fact', confidence=3),
    dict(tmp_id='lane-a-BAD-003', brief_code='G6-F-9', domain='FORCE_MOTION_ENERGY', topic='low confidence', grades=[6], en='A slinky pushed along its length shows a longitudinal wave moving through the coils.', terms=['a'] * 6, source='x', card_form='fact', confidence=1),
    dict(tmp_id='lane-a-BAD-004', brief_code='G6-F-9', domain='FORCE_MOTION_ENERGY', topic='too short', grades=[6], en='Sound is a longitudinal wave.', terms=['a'] * 6, source='x', card_form='fact', confidence=3),
    dict(tmp_id='lane-a-BAD-005', brief_code='G6-F-9', domain='FORCE_MOTION_ENERGY', topic='too long', grades=[6], en=' '.join(['wave'] * 65), terms=['a'] * 6, source='x', card_form='fact', confidence=3),
    dict(tmp_id='lane-a-BAD-006', brief_code='G6-F-10', domain='FORCE_MOTION_ENERGY', topic='exact dup of a new row', grades=[6], en=NEW[0][2], terms=['a'] * 6, source='x', card_form='fact', confidence=3),
    dict(tmp_id='lane-a-BAD-007', brief_code='G6-F-10', domain='FORCE_MOTION_ENERGY', topic='missing en', grades=[6], terms=['a'] * 6, source='x', card_form='fact', confidence=3),
]

# AUP stream: plain clinical, DepEd grade-5 level, English only (the ingest translates); never printed by the pipeline
G5L3 = [
    dict(tmp_id='lane-a-G5-L-3-001', brief_code='G5-L-3', domain='LIVING_THINGS', topic='ovaries release egg cells', grades=[5], en='The two ovaries are small organs that store egg cells and release about one egg cell each month.', terms=['ovary', 'egg cell', 'female', 'reproductive system', 'organ', 'diagram'], source='DepEd MATATAG G5 Q2; encyclopedia-stable', card_form='fact', confidence=3),
    dict(tmp_id='lane-a-G5-L-3-002', brief_code='G5-L-3', domain='LIVING_THINGS', topic='uterus is where a baby grows', grades=[5], en='The uterus is a hollow, muscular organ where a baby grows and is kept safe before it is born.', terms=['uterus', 'baby', 'grows', 'female', 'reproductive system', 'organ'], source='DepEd MATATAG G5 Q2; encyclopedia-stable', card_form='fact', confidence=3),
    dict(tmp_id='lane-a-G5-L-3-003', brief_code='G5-L-3', domain='EARTH_SPACE', topic='wrong domain on purpose', grades=[5], en='This row exists only to check that an invalid AUP-stream row is rejected without its text being printed.', terms=['x'] * 6, source='test', card_form='fact', confidence=3),
]


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--out', default=os.path.join(HERE, 'out-test')); a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    picked, n_exact = [], 0
    for i, l in enumerate(open(BANK, encoding='utf-8')):
        b = json.loads(l)
        code = CODE_FOR_DOMAIN.get(b['domain'])
        en = b['fact']['en']
        if not code or not (10 <= len(en.split()) <= 40) or AVOID.search(en + ' ' + b['topic']) or i % 97:
            continue
        k = len(picked)
        if k < 8:
            en2, tag = en, 'exact'; n_exact += 1
        else:
            en2, tag = PREFIX[k % 4] + en[0].lower() + en[1:].rstrip('.'), 'paraphrase'
        picked.append(dict(tmp_id=f'lane-a-BANK-{k + 1:03d}', brief_code=code, domain=b['domain'], topic=b['topic'], grades=[6],
                           en=en2, terms=[t for t in b['terms'] if re.fullmatch(r'[A-Za-z -]+', t)][:6] or ['test'] * 6,
                           source=f'fixture:{tag}:{b["id"]}', card_form='fact', confidence=3))
        if len(picked) == 25:
            break
    rows = picked + [dict(tmp_id=f'lane-a-{c}-{i + 1:03d}', brief_code=c, domain='FORCE_MOTION_ENERGY', topic=t, grades=[int(c[1])],
                          en=en, terms=terms, source='fixture:new; encyclopedia-stable', card_form='fact', confidence=3)
                     for i, (c, t, en, terms) in enumerate(NEW)] + INVALID
    with open(os.path.join(a.out, 'lane-a-candidates.jsonl'), 'w', encoding='utf-8') as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + '\n')
    with open(os.path.join(a.out, 'lane-a-G5-L-3.jsonl'), 'w', encoding='utf-8') as f:
        for r in G5L3:
            f.write(json.dumps(r, ensure_ascii=False) + '\n')
    print(f'wrote {a.out}: candidates {len(rows)} (bank-exact {n_exact}, bank-paraphrase {len(picked) - n_exact}, new {len(NEW)}, invalid {len(INVALID)}) | G5-L-3 rows {len(G5L3)}')


if __name__ == '__main__':
    main()
