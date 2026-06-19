#!/usr/bin/env python3
"""Build the cat-v11 English-bucket worklist: seed items per bucket type, sharded
into DIR/<type>/<shard>.json for gen-cat-v11-english.wf.js. Each seed becomes ONE
training row (English reply). Emphasis: Taglish-input → English reply (the leak)."""
import json, os, sys

DIR = sys.argv[1] if len(sys.argv) > 1 else '/tmp/cat-v11-work'
SHARD = 25

# Seed THEMES — the generator writes one natural user turn + English reply per seed.
# We give many distinct angles so the rows are diverse (the generator varies wording).
TAGLISH_CHITCHAT = [
    'hi po greeting', 'good morning po', 'kumusta ka po', 'okay lang po ako', 'salamat po',
    'thank you po sa tulong', 'magandang umaga po', 'hello po kumusta', 'uy hi po', 'musta na po',
    'ang galing mo po', 'sige po', 'ang bait mo po', 'goodnight po', 'paalam po',
    'ano ginagawa mo po', 'bored ako po', 'gutom na ako po', 'excited ako po sa science',
    'natutuwa ako po', 'nakakatamad mag-aral po', 'ang init ngayon po', 'umuulan po dito',
    'kakain pa po ako', 'balik ako mamaya po', 'hi ulit po', 'miss kita po', 'cute mo po',
    'pwede ba kita kausapin po', 'wala lang po nagche-check lang', 'good afternoon po',
    'tahimik ka lang po', 'ang saya mag-aral po', 'ayoko na po mag-aral',
    'pagod na ako po', 'gising pa po ako', 'sleepy na po ako', 'kamusta ang araw mo po',
]
TAGLISH_IDENTITY = [
    'sino ka po', 'robot ka ba po', 'tao ka ba po', 'AI ka po ba', 'anong pangalan mo po',
    'taga-saan ka po', 'ilang taon ka na po', 'nakikita mo ba ako po', 'naririnig mo ba ako po',
    'may pakiramdam ka ba po', 'natutulog ka ba po', 'kumakain ka ba po', 'totoong tao ka po ba',
    'paano ka gumagana po', 'sino gumawa sa iyo po', 'nasa loob ka ba ng phone ko po',
    'kaibigan kita po ba', 'magaling ka ba sa lahat po', 'natatakot ka ba po',
    'may mga kaibigan ka ba po', 'lagi ka ba dito po',
]
TAGLISH_OFFTOPIC = [
    'gawin mo yung math homework ko po', 'sagutin mo to para sakin po', 'sino panalo sa NBA po',
    'tell me a joke po', 'kanta ka naman po', 'sino crush mo po', 'sino mas magaling artista po',
    'ano latest cellphone po', 'pwede ka maglaro po', 'magkwento ka ng ghost story po',
    'sino panalo sa eleksyon po', 'ano paborito mong kpop po', 'bumili ka ng laruan ko po',
    'pwede mong gawin assignment ko sa filipino po', 'kausapin mo crush ko po',
    'magsabi ka ng bad word po', 'i love you po sabihin mo din', 'ano score sa game kahapon po',
    'pakitranslate to sa korean po', 'sino mananalo bukas po',
]
ENGLISH_CHITCHAT_CLEAN = [
    'hi', 'hello there', 'how are you', 'good morning', 'thank you so much', 'good night',
    'im bored', 'im so happy today', 'this is fun', 'i like science', 'whats up', 'hey',
    'im tired', 'im excited to learn', 'youre nice', 'see you later', 'im back', 'im hungry',
    'its raining here', 'i had a good day', 'i dont feel like studying', 'youre smart',
    'can we be friends', 'im sleepy', 'thanks for helping me',
]
ENGLISH_IDENTITY_CLEAN = [
    'who are you', 'are you a robot', 'are you a real person', 'are you an AI', 'whats your name',
    'where are you from', 'how old are you', 'can you see me', 'can you hear me',
    'do you have feelings', 'do you sleep', 'do you eat', 'how do you work', 'who made you',
    'are you inside my phone', 'are you my friend', 'do you get scared', 'are you always here',
]

BUCKETS = {
    'taglish_chitchat': TAGLISH_CHITCHAT,
    'taglish_identity': TAGLISH_IDENTITY,
    'taglish_offtopic': TAGLISH_OFFTOPIC,
    'english_chitchat_clean': ENGLISH_CHITCHAT_CLEAN,
    'english_identity_clean': ENGLISH_IDENTITY_CLEAN,
}

plan = []
total = 0
for btype, seeds in BUCKETS.items():
    d = os.path.join(DIR, btype)
    os.makedirs(d, exist_ok=True)
    shards = []
    for i in range(0, len(seeds), SHARD):
        chunk = [{'id': f'{btype}-{j}', 'seed': s} for j, s in enumerate(seeds[i:i + SHARD], start=i)]
        name = f'shard-{i // SHARD}.json'
        json.dump(chunk, open(os.path.join(d, name), 'w'), ensure_ascii=False)
        shards.append(name)
        total += len(chunk)
    plan.append({'type': btype, 'shards': shards})

json.dump({'dir': DIR, 'plan': plan}, open(os.path.join(DIR, 'plan.json'), 'w'), ensure_ascii=False)
print(f'wrote {total} seeds across {len(BUCKETS)} buckets -> {DIR}')
for p in plan:
    print(f'  {p["type"]:26} {len(p["shards"])} shards')
