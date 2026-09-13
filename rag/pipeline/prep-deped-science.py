#!/usr/bin/env python3
"""Turn the raw DepEd science harvest into a clean, grounded MODULE TABLE for fact generation.

Input : finetuning/reference-materials/deped-science/deped-science.jsonl  (1,440 docs)
Output: rag/pipeline/deped-modules.jsonl                                   (grades 3-10)

Per module we recover the curriculum coordinates the generator needs so it FOLLOWS the
Philippine curriculum instead of guessing at one:

  grade    3-10, read from the TEXT first. The folder path cannot be trusted: 228 docs live
           under `subjects/grade-7-10/science` and 173 under `grade-4-6/science` — RANGE
           folders. A naive `grade-(\\d+)` on the path calls all of the first group "grade 7",
           which is how an earlier count showed a fake spike at g7=304 / g4=253. The module's
           own cover states its grade ("Science - Grade 10", "Agham 3"), so that wins; the
           path is only used when it names a single grade (`grade-8-matatag-lms/science-8`).
  strand   FE / LT / MT / ES, decoded from the DepEd competency code (e.g. S7MT-Ia-1) where
           present. These map 1:1 onto Hiraia's four MATATAG domains, so the generated bank
           lines up with the existing one without a translation layer.
  quarter  1-4, and week where stated — the curriculum's own sequencing.
  title    the module's stated topic ("Charles' Law", "Mga Halaman").
  matatag  True for the current MATATAG curriculum rather than the older K-10 editions;
           worth preferring when the same topic appears in both.

  python3 rag/pipeline/prep-deped-science.py
"""
import json, os, re, hashlib, collections

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(HERE, 'deped-modules.jsonl')

# Two harvests feed this, gathered separately and with different field names. The Drive pull
# carries its own grade/matatag metadata; the LRMDS pull carries only an id, so its grade is
# recovered from the text like everything else. They are disjoint (checked: 0 of 185 LRMDS
# docs duplicate a Drive doc), and LRMDS adds ~22% more source text.
SOURCES = [
    {'path': 'finetuning/reference-materials/deped-science/deped-science.jsonl', 'kind': 'drive'},
    {'path': 'finetuning/reference-materials/science/docs.jsonl', 'kind': 'lrmds'},
]


def load_sources():
    """Yield uniform docs from every harvest, skipping any that repeat text already seen."""
    seen, rows = set(), []
    for src in SOURCES:
        path = os.path.join(ROOT, src['path'])
        if not os.path.exists(path):
            print(f"  (skipped, not present: {src['path']})")
            continue
        n = 0
        for line in open(path):
            if not line.strip():
                continue
            r = json.loads(line)
            text = r.get('text') or ''
            sig = hashlib.md5(re.sub(r'\s+', ' ', text[:4000]).strip().encode()).hexdigest()
            if sig in seen:
                continue
            seen.add(sig)
            if src['kind'] == 'lrmds':
                rid = r.get('lrmds_id')
                r = {'text': text, 'drive_id': f'lrmds-{rid}', 'matatag': False,
                     'source_page': f'https://lrmds.deped.gov.ph/detail/{rid}'}
            r['harvest'] = src['kind']
            rows.append(r)
            n += 1
        print(f"  {src['kind']:6s} {n:>5} docs from {os.path.basename(path)}")
    return rows

# DepEd competency code: S<grade><strand>-<quarter roman><week letter>-<number>
CODE = re.compile(r'\bS(\d{1,2})(FE|LT|MT|ES)-([IVX]+)([a-z])?-?(\d+)?\b')
STRAND = {'FE': 'FORCE_MOTION_ENERGY', 'LT': 'LIVING_THINGS', 'MT': 'MATTER', 'ES': 'EARTH_SPACE'}

# "Science - Grade 10", "Agham 3", "Science 5", "Grade 4 Science", "Baitang 6"
GRADE_TEXT = [
    re.compile(r'\b(?:Science|Agham|SCIENCE|AGHAM)\s*[-–—]?\s*(?:Grade|Baitang|GRADE)?\s*(\d{1,2})\b'),
    re.compile(r'\b(?:Grade|Baitang|GRADE|BAITANG)\s*(\d{1,2})\s*[-–—]?\s*(?:Science|Agham)\b'),
]
# a path segment naming exactly ONE grade (never a range like grade-7-10)
GRADE_PATH_ONE = re.compile(r'grade-(\d{1,2})(?!-\d)')
SCIENCE_N = re.compile(r'science-(\d{1,2})\b')

QUARTER = re.compile(r'\b(?:Quarter|QUARTER|Markahan|Ikaapat|Ikatlo|Ikalawa|Una)\b[^\n]{0,24}?(\d)\b')
QUARTER_ORD = [(re.compile(r'\bUnang?\s+Markahan\b', re.I), 1),
               (re.compile(r'\bIkalawang?\s+Markahan\b', re.I), 2),
               (re.compile(r'\bIkatlong?\s+Markahan\b', re.I), 3),
               (re.compile(r'\bIkaapat na\s+Markahan\b', re.I), 4)]
WEEK = re.compile(r'\b(?:Week|Linggo)\b[^\n]{0,20}?(\d{1,2})\b', re.I)

# lines that are boilerplate rather than a topic
NOISE = re.compile(r'kagawaran|department of education|republic act|copyright|schools division|'
                   r'first edition|alternative delivery|learning activity sheet|worksheet|'
                   r'this material|centennial|muntinlupa|region|self-learning|module\s*$|'
                   r'manunulat|tagapagsuri|tagapangulo|writer|reviewer|illustrator|layout',
                   re.I)


def grade_of(text, path):
    head = text[:3000]
    for rx in GRADE_TEXT:
        for m in rx.finditer(head):
            g = int(m.group(1))
            if 1 <= g <= 12:
                return g, 'text'
    m = SCIENCE_N.search(path) or GRADE_PATH_ONE.search(path)
    if m:
        g = int(m.group(1))
        if 1 <= g <= 12:
            return g, 'path'
    m = CODE.search(head)
    if m:
        return int(m.group(1)), 'code'
    return None, 'none'


def title_of(text):
    """The module's stated topic. Cover pages put it on its own short line near the top,
    surrounded by agency boilerplate — so take the first short, non-noise, non-numeric line."""
    for line in text[:2500].split('\n'):
        s = line.strip(' :–—-')
        if not (4 <= len(s) <= 70):
            continue
        if NOISE.search(s) or s.isdigit():
            continue
        if re.fullmatch(r'[\d\s.\-–—:()]+', s):
            continue
        letters = sum(c.isalpha() for c in s)
        if letters < 4:
            continue
        return s
    return ''


def main():
    rows = load_sources()
    out, dropped, src = [], collections.Counter(), collections.Counter()
    for r in rows:
        text, path = r.get('text') or '', (r.get('source_page') or '').lower()
        g, how = grade_of(text, path)
        src[how] += 1
        if g is None:
            dropped['no-grade'] += 1
            continue
        if not (3 <= g <= 10):
            dropped[f'out-of-scope-g{g}'] += 1
            continue
        head = text[:6000]
        m = CODE.search(head)
        strand = STRAND.get(m.group(2)) if m else None
        q = None
        for rx, val in QUARTER_ORD:
            if rx.search(head):
                q = val
                break
        if q is None:
            mq = QUARTER.search(head)
            if mq and 1 <= int(mq.group(1)) <= 4:
                q = int(mq.group(1))
        mw = WEEK.search(head)
        out.append({
            'drive_id': r.get('drive_id'),
            'grade': g,
            'grade_from': how,
            'strand': strand,
            'competency': m.group(0) if m else None,
            'quarter': q,
            'week': int(mw.group(1)) if mw and int(mw.group(1)) <= 20 else None,
            'title': title_of(text),
            'matatag': bool(r.get('matatag')),
            'harvest': r.get('harvest', 'drive'),
            'source_page': r.get('source_page'),
            'chars': len(text),
            'text': text,
        })

    with open(OUT, 'w') as fh:
        for o in out:
            fh.write(json.dumps(o, ensure_ascii=False) + '\n')

    tok = sum(o['chars'] for o in out) // 4
    print(f'{len(rows)} science docs -> {len(out)} modules in scope (grades 3-10), ~{tok:,} tokens')
    print('  grade resolved from:', dict(src))
    print('  dropped:', dict(dropped))
    g = collections.Counter(o['grade'] for o in out)
    print('  per grade:', ' '.join(f'g{k}={v}' for k, v in sorted(g.items())))
    s = collections.Counter(o['strand'] or '(none)' for o in out)
    print('  strand:', dict(s))
    print('  per harvest:', dict(collections.Counter(o['harvest'] for o in out)))
    print(f"  with quarter: {sum(1 for o in out if o['quarter'])} | with title: {sum(1 for o in out if o['title'])}"
          f" | MATATAG: {sum(1 for o in out if o['matatag'])}")


if __name__ == '__main__':
    main()
