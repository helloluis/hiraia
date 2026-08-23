#!/usr/bin/env python3
"""STAGE B — derive the card taxonomy FROM the curriculum instead of guessing at one.

The previous taxonomy was inferred from finished card text, so its categories were an
artefact of how the cards happened to be worded. This one is built from what the Department
of Education actually teaches: every leaf is grounded in modules that exist, and each module
is assigned to a leaf, so the feed's "other ocean animals" shelf corresponds to a real place
in the curriculum rather than a keyword cluster.

The structure is given, not invented — grade (3-10) x strand (the four MATATAG domains) is
already the curriculum's own top-level grid. This stage only fills the level below it: the
recurring TOPICS within each cell. That is why it runs per (grade, strand) rather than over
the whole corpus at once; each call sees one cell's real topic list and groups it.

  python3 rag/pipeline/fw-derive-deped-taxonomy.py
  -> rag/pipeline/deped-taxonomy.json          leaves + parents, trilingual labels
  -> rag/pipeline/module-leaf.json             drive_id -> leaf id

Env: FW_MODEL, FW_CONC.
"""
import os, json, glob, collections, urllib.request, urllib.error, time, threading
from concurrent.futures import ThreadPoolExecutor, as_completed

HERE = os.path.dirname(os.path.abspath(__file__))
PROFILES = os.path.join(HERE, 'module-profiles')
OUT_TAX = os.path.join(HERE, 'deped-taxonomy.json')
OUT_MAP = os.path.join(HERE, 'module-leaf.json')
URL = 'https://api.fireworks.ai/inference/v1/chat/completions'
KEY = os.environ['FIREWORKS_API_KEY']
MODEL = os.environ.get('FW_MODEL', 'accounts/fireworks/models/deepseek-v4-pro-0813')
CONC = int(os.environ.get('FW_CONC', '8'))

STRAND_LABEL = {
    'LIVING_THINGS': ('Living Things', 'Mga Buhay na Bagay', 'Mga Buhing Butang'),
    'FORCE_MOTION_ENERGY': ('Force, Motion, and Energy', 'Puwersa, Galaw, at Enerhiya',
                            'Kusog, Lihok, ug Enerhiya'),
    'MATTER': ('Matter', 'Materya', 'Materya'),
    'EARTH_SPACE': ('Earth and Space', 'Daigdig at Kalawakan', 'Kalibutan ug Kawanangan'),
}
_lock = threading.Lock()


def call(prompt, attempt=0):
    # A 60-module cell reasons for ~10k tokens before writing a single character; at 12k the
    # budget was gone before the JSON began and 29 of 32 cells came back empty.
    body = json.dumps({'model': MODEL, 'temperature': 0.2, 'max_tokens': 40000,
                       'messages': [{'role': 'user', 'content': prompt}]}).encode()
    req = urllib.request.Request(URL, data=body, headers={
        'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json'})
    try:
        r = json.load(urllib.request.urlopen(req, timeout=600))
        m = r['choices'][0]['message']
        return (m.get('content') or ''), (m.get('reasoning_content') or '')
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as e:
        if attempt < 8:
            time.sleep(min(90, 2 ** (attempt + 1)))
            return call(prompt, attempt + 1)
        raise


def obj_from(*cands):
    for c in cands:
        s = (c or '').strip()
        a, b = s.find('{'), s.rfind('}')
        if a >= 0 and b > a:
            try:
                return json.loads(s[a:b + 1])
            except Exception:
                pass
    return None


def cell_prompt(grade, strand, mods):
    # Reference modules by INDEX, not drive_id. Echoing 60 x 32-char ids back is ~1.5k tokens
    # of pure bookkeeping in the answer, and every one is a chance to corrupt an id.
    listing = '\n'.join(
        f"  {i}. {m['topic']}  ({'; '.join(m['key_concepts'][:5])})" for i, m in enumerate(mods, 1))
    en, tl, bis = STRAND_LABEL[strand]
    return f'''These are the real Philippine DepEd science modules for Grade {grade}, strand "{en}".
Group them into the TOPICS this grade actually studies.

Return STRICT JSON only:
{{"leaves": [{{"id": "kebab-case-id", "label_en": "...", "label_tl": "...", "label_bis": "...",
              "modules": [1, 4, 7]}}]}}

RULES
- Create as many leaves as the material genuinely has topics. Use your judgement on how
  many; do not agonise over the count.
- Every module NUMBER below must appear in exactly one leaf. Use the numbers, not the titles.
- A leaf is a SHELF the reader can be offered: it must read naturally after the word
  "other" — "other simple machines", "other weather patterns". Never a document type, never a
  single fact, never a whole strand restated.
- label_en / label_tl / label_bis are that shelf name in English, Tagalog, and Cebuano,
  PLURAL, lowercase, 1-4 words. Write real Cebuano, not Tagalog spelled differently; if a
  term genuinely has no Cebuano equivalent in school use, keep the scientific term.
- Merge near-duplicates. Two leaves that a 10-year-old could not tell apart are one leaf.

MODULES
{listing}'''


def _leaves_from(got, grade, strand, mods):
    """Turn one model response into leaf records, resolving module INDEXES back to ids."""
    out = []
    for lf in got.get('leaves') or []:
        if not lf.get('label_en'):
            continue
        mids = []
        for n in (lf.get('modules') or []):
            try:
                i = int(n)
            except (TypeError, ValueError):
                continue
            if 1 <= i <= len(mods):
                mids.append(mods[i - 1]['drive_id'])
        out.append({
            'id': f"g{grade}-{strand.lower()}-{lf.get('id', '')}"[:70],
            'parent': strand, 'grade': grade, 'strand': strand,
            'label_en': lf['label_en'].strip().lower()[:48],
            'label_tl': (lf.get('label_tl') or lf['label_en']).strip().lower()[:48],
            'label_bis': (lf.get('label_bis') or lf.get('label_tl') or lf['label_en']).strip().lower()[:48],
            'modules': mids,
        })
    return out


def main():
    # Only profiles for modules still in the table. Deduplicating the harvest retired 78
    # modules whose profiles remain on disk; including them would shelve content twice.
    live = {json.loads(l)['drive_id'] for l in open(os.path.join(HERE, 'deped-modules.jsonl'))}
    profs = [json.load(open(f)) for f in glob.glob(os.path.join(PROFILES, '*.json'))
             if os.path.basename(f)[:-5] in live]
    profs = [p for p in profs if p.get('strand') and p.get('topic')]
    cells = collections.defaultdict(list)
    for p in profs:
        cells[(p['grade'], p['strand'])].append(p)
    print(f'{len(profs)} profiles -> {len(cells)} (grade, strand) cells')

    leaves, mod_leaf, failed = [], {}, []

    def do_cell(key, tries=3):
        grade, strand = key
        mods = cells[key]
        # A cell that comes back unparseable is not a lost cause — the model reasons for ~9k
        # tokens on a large cell and occasionally runs out before emitting JSON. Falling
        # straight to the catch-all would dump 39 modules onto one unusable "living things"
        # shelf, so try again before giving up on the cell.
        got = None
        for _ in range(tries):
            got = obj_from(*call(cell_prompt(grade, strand, mods)))
            if got and got.get('leaves'):
                break
        if not got or not got.get('leaves'):
            # Still nothing. The cell is likely too large to partition in one pass, so halve
            # it and group each half independently. Two smaller shelves of the same topic are
            # a far better outcome than 26 modules dumped on a generic "matter" shelf, which
            # is exactly the unusable offer this taxonomy exists to replace.
            if len(mods) > 12:
                out = []
                half = len(mods) // 2
                for part in (mods[:half], mods[half:]):
                    sub = obj_from(*call(cell_prompt(grade, strand, part)))
                    if sub and sub.get('leaves'):
                        out.extend(_leaves_from(sub, grade, strand, part))
                if out:
                    return key, out
            return key, None
        return key, _leaves_from(got, grade, strand, mods)

    with ThreadPoolExecutor(max_workers=CONC) as ex:
        for fut in as_completed([ex.submit(do_cell, k) for k in cells]):
            key, out = fut.result()
            if not out:
                failed.append(key)
                continue
            with _lock:
                for lf in out:
                    leaves.append(lf)
                    for mid in lf['modules']:
                        mod_leaf[mid] = lf['id']

    # A module with no leaf would be invisible to the feed, so place any stragglers on a
    # grade+strand catch-all rather than dropping them.
    placed = set(mod_leaf)
    for (grade, strand), mods in cells.items():
        orphans = [m['drive_id'] for m in mods if m['drive_id'] not in placed]
        if not orphans:
            continue
        en, tl, bis = STRAND_LABEL[strand]
        lid = f'g{grade}-{strand.lower()}-general'
        leaves.append({'id': lid, 'parent': strand, 'grade': grade, 'strand': strand,
                       'label_en': en.lower(), 'label_tl': tl.lower(), 'label_bis': bis.lower(),
                       'modules': orphans})
        for mid in orphans:
            mod_leaf[mid] = lid

    parents = [{'id': s, 'label_en': v[0], 'label_tl': v[1], 'label_bis': v[2]}
               for s, v in STRAND_LABEL.items()]
    json.dump({'parents': parents, 'leaves': leaves}, open(OUT_TAX, 'w'),
              ensure_ascii=False, indent=1)
    json.dump(mod_leaf, open(OUT_MAP, 'w'), ensure_ascii=False, indent=1)

    per = collections.Counter(len(l['modules']) for l in leaves)
    print(f'\n{len(leaves)} leaves | {len(mod_leaf)}/{len(profs)} modules placed'
          f' | cells failed: {len(failed)}')
    print(f'  modules per leaf: min {min(per)} max {max(per)}')
    print(f'  wrote {os.path.basename(OUT_TAX)}, {os.path.basename(OUT_MAP)}')
    for lf in leaves[:10]:
        print(f"    g{lf['grade']} {lf['label_en']:32s} ({len(lf['modules'])} modules)")


if __name__ == '__main__':
    main()
