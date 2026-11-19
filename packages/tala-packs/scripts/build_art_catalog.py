#!/usr/bin/env python3
"""Build the competency -> illustration candidate catalog for Tala teaching packs.

Reads (never writes) the Hiraia reference checkout and joins, for every Grade 3-10 Science competency Tala serves:

  Tala competency id  --(grade, term, printed week range, wording)-->  Hiraia code (three-term-2026.json)
  Hiraia code  --(curated lesson units, curriculum tags)-->  cards  --(card.slug)-->  approved B&W illustration

Only images whose v0.5 review status is `clean` or `approved_regen` (an approved and installed redraw) are
candidates. Everything else is counted and excluded, never silently dropped. Nothing is generated, redrawn or
edited here.

Usage:
  python3 scripts/build_art_catalog.py --reference-root /home/b11/code/hiraia
  python3 scripts/build_art_catalog.py --reference-root /home/b11/code/hiraia --check
"""
from __future__ import annotations

import argparse
import collections
import difflib
import glob
import hashlib
import json
import os
import re
import struct
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PKG = HERE.parent
REPO = PKG.parent.parent
DEFAULT_PACKS = REPO / 'packages/tala-server/data/packs'
DEFAULT_OUT = PKG / 'data/art/competency-candidates.json'
USABLE = ('clean', 'approved_regen')
CATALOG_VERSION = 1


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def png_size(path: Path) -> tuple[int, int] | None:
    with open(path, 'rb') as f:
        head = f.read(24)
    if head[:8] != b'\x89PNG\r\n\x1a\n':
        return None
    w, h = struct.unpack('>II', head[16:24])
    return w, h


def norm(s: str) -> str:
    return re.sub(r'[^a-z0-9 ]', ' ', (s or '').lower())


def similarity(a: str, b: str) -> float:
    wa, wb = set(norm(a).split()), set(norm(b).split())
    jac = len(wa & wb) / max(1, len(wa | wb))
    ratio = difflib.SequenceMatcher(None, norm(a), norm(b)).ratio()
    return max(jac, ratio)


def load_jsonl(path: Path):
    with open(path, encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if line:
                yield json.loads(line)


def collect_code_texts(ref: Path) -> dict[str, str]:
    texts: dict[str, str] = {}
    for name in ('matatag-elementary-competencies.json', 'matatag-jhs-competencies.json'):
        d = json.loads((ref / 'rag/sources/curriculum-guides' / name).read_text())

        def walk(x):
            if isinstance(x, dict):
                if 'code' in x and ('text' in x or 'competency' in x):
                    texts[x['code']] = x.get('text') or x.get('competency')
                for v in x.values():
                    walk(v)
            elif isinstance(x, list):
                for v in x:
                    walk(v)

        walk(d['quarters'])
    return texts


def pair_codes(tala: list[dict], three_term: dict, code_texts: dict[str, str]):
    listed = {k: v for k, v in three_term.items() if v.get('status') == 'listed'}
    groups = collections.defaultdict(list)
    for c in tala:
        groups[(int(c['grade']), c['termIndex'], c['weekFrom'], c['weekTo'])].append(c)
    by_cell = collections.defaultdict(list)
    for k, v in listed.items():
        by_cell[(v['grade'], v['term'], v['weeks'][0], v['weeks'][1])].append(k)
    pairs: dict[str, dict] = {}
    problems: list[str] = []
    for key, cs in groups.items():
        codes = list(by_cell.get(key, []))
        if len(codes) != len(cs):
            problems.append(f'cell {key}: {len(cs)} Tala competencies vs {len(codes)} Hiraia codes')
        cand = sorted(
            ((similarity(c['text'], code_texts.get(k, '')), c['id'], k) for c in cs for k in codes), reverse=True
        )
        used_c, used_k = set(), set()
        for s, cid, k in cand:
            if cid in used_c or k in used_k:
                continue
            pairs[cid] = {'code': k, 'similarity': round(s, 3), 'heading': listed[k].get('heading')}
            used_c.add(cid)
            used_k.add(k)
    for c in tala:
        if c['id'] not in pairs:
            problems.append(f'unpaired {c["id"]}')
        elif pairs[c['id']]['similarity'] < 0.6:
            problems.append(f'weak pairing {c["id"]} -> {pairs[c["id"]]["code"]} ({pairs[c["id"]]["similarity"]})')
    return pairs, problems


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--reference-root', default='/home/b11/code/hiraia')
    ap.add_argument('--packs-dir', default=str(DEFAULT_PACKS))
    ap.add_argument('--out', default=str(DEFAULT_OUT))
    ap.add_argument('--per-competency', type=int, default=40)
    ap.add_argument('--check', action='store_true', help='rebuild in memory and compare with --out')
    args = ap.parse_args()
    ref = Path(args.reference_root).resolve()

    inputs = {
        'three_term': ref / 'packages/shared/src/curriculum/three-term-2026.json',
        'cards_pool': ref / 'rag/pipeline/cardsPool.app.json',
        'curriculum_tags': ref / 'packages/mobile/src/generated/curriculumTags.generated.json',
        'v05_manifest': ref / 'rag/pipeline/v05-review/regen-staging/manifest.jsonl',
        'v05_approvals_a': ref / 'rag/pipeline/v05-review/regen-staging/approvals-A.jsonl',
        'v05_approvals_b': ref / 'rag/pipeline/v05-review/regen-staging/approvals-B.jsonl',
        'v05_installed': ref / 'rag/pipeline/v05-review/regen-staging/_integration/approved-paths.nul',
        'factoids': ref / 'rag/bank/factoids.jsonl',
        'dcard_prompts': ref / 'rag/pipeline/imagegen/worklist.jsonl',
        'qa_prompts': ref / 'rag/pipeline/art-qa/newart-prompts.jsonl',
    }
    for name, p in inputs.items():
        if not p.exists():
            print(f'missing input {name}: {p}', file=sys.stderr)
            return 2
    lessons_files = sorted((ref / 'packages/mobile/src/generated').glob('grade*Lessons.generated.json'))
    findings_files = sorted((ref / 'rag/pipeline/v05-review/image-findings').glob('img-findings-shard-*.jsonl'))
    redraw_files = sorted((ref / 'packages/images/qwen-queue/audit-regen').glob('batch-requests-*.jsonl'))
    named_prompt_files = sorted((ref / 'packages/images/gemini-queue/prompts').glob('*.json'))

    # --- Tala competencies and the code crosswalk ---
    tala = []
    for f in sorted(Path(args.packs_dir).glob('science-bow-2026-g*.json')):
        tala += json.loads(f.read_text())['competencies']
    three_term = json.loads(inputs['three_term'].read_text())['competencies']
    code_texts = collect_code_texts(ref)
    pairs, problems = pair_codes(tala, three_term, code_texts)
    if problems:
        print('code pairing problems:\n  ' + '\n  '.join(problems), file=sys.stderr)
        return 3

    # --- cards, tags, curated lessons ---
    cards = json.loads(inputs['cards_pool'].read_text())['cards']
    card_by_id = {c['id']: c for c in cards}
    tags = json.loads(inputs['curriculum_tags'].read_text())
    tagged = collections.defaultdict(list)  # code -> [(card, primary?, confidence)]
    for cid, row in tags.items():
        primary, _grade, _quarter, conf, _cells, codes = row
        for code in set(codes) | {primary}:
            if code and not str(code).startswith('deped:'):
                tagged[code].append((cid, code == primary, float(conf or 0)))
    curated = collections.defaultdict(dict)  # code -> card -> weight
    for lf in lessons_files:
        d = json.loads(lf.read_text())
        for lesson in d['lessons']:
            core = set(lesson.get('coreCardIds') or [])
            for unit in lesson.get('units') or []:
                for cid in unit.get('cardIds') or []:
                    w = 3.0 if cid in core else 2.0
                    curated[unit['competency']][cid] = max(curated[unit['competency']].get(cid, 0), w)

    # --- image files ---
    named: dict[str, Path] = {}
    for sub in ('biology', 'chemistry', 'earth-science', 'general', 'physics'):
        for p in (ref / 'packages/images/assets-png' / sub).glob('*.png'):
            named[p.stem] = p
    cards_png = ref / 'packages/images/cards-png'

    def resolve(slug: str) -> Path | None:
        for s in (slug, re.sub(r'-g\d+$', '', slug).lower()):
            if not s:
                continue
            if s in named:
                return named[s]
            p = cards_png / f'{s}.png'
            if p.exists():
                return p
        return None

    # --- review status ---
    status: dict[str, str] = {}
    issue: dict[str, str] = {}
    for ff in findings_files:
        for r in load_jsonl(ff):
            status[r['image']] = r['status']
            if r.get('issue'):
                issue[r['image']] = r['issue']
    approved = set()
    for key in ('v05_approvals_a', 'v05_approvals_b'):
        for r in load_jsonl(inputs[key]):
            if r.get('verdict') == 'approve':
                approved.add(r['image'])
    installed = {p for p in inputs['v05_installed'].read_bytes().decode().split('\0') if p}
    v05_prompt = {r['image']: r.get('prompt') for r in load_jsonl(inputs['v05_manifest'])}

    def image_status(rel: str) -> str:
        s = status.get(rel)
        if s is None:
            return 'unaudited'
        if s == 'clean':
            return 'clean'
        if s == 'flagged' and rel in approved and rel in installed:
            return 'approved_regen'
        return s  # flagged / review

    # --- depiction prompts (what the picture was drawn to show) ---
    prompt_by_slug: dict[str, tuple[str, str]] = {}

    def put(slug, text, origin, override=False):
        if slug and text and (override or slug not in prompt_by_slug):
            prompt_by_slug[slug] = (re.sub(r'\s+', ' ', text).strip(), origin)

    for nf in named_prompt_files:
        d = json.loads(nf.read_text())
        for it in d.get('images') or []:
            if isinstance(it, dict):
                put(it.get('id') or it.get('slug'), it.get('prompt') or it.get('description'), 'gemini-queue')
    for r in load_jsonl(inputs['factoids']):
        img = r.get('image') or {}
        put(img.get('slug') or r['id'], img.get('prompt'), 'factoids')
    for r in load_jsonl(inputs['dcard_prompts']):
        put(r['id'], r.get('prompt'), 'imagegen-worklist')
    for r in load_jsonl(inputs['qa_prompts']):
        put(r.get('new_slug'), r.get('prompt'), 'art-qa', override=True)
    redrawn_sept = set()
    for rf in redraw_files:
        for r in load_jsonl(rf):
            slug = r.get('custom_id')
            redrawn_sept.add(slug)
            put(slug, (r.get('body') or {}).get('prompt'), 'audit-regen-2026-09', override=True)

    def generator(slug: str, rel: str) -> str:
        if rel in installed and rel in approved:
            return 'OpenAI gpt-image-2.6 (Hiraia v0.5 redraw, Nov 2026)'
        if slug in redrawn_sept:
            return 'OpenAI gpt-image-2 (Hiraia redraw, Sept 2026)'
        if slug.startswith('qa-'):
            return 'OpenAI gpt-image-2 (art-QA replacement)'
        if slug.startswith('ffct-'):
            return 'OpenAI gpt-image-2 (a few by Alibaba qwen-image)'
        if slug.startswith('dcard-'):
            return 'OpenAI image model (model not recorded)'
        return 'Google Imagen 4 Fast via Gemini (June 2026)'

    # --- candidates per competency ---
    excluded = collections.Counter()
    out_comp = {}
    hashed: dict[str, tuple[str, list]] = {}
    for c in sorted(tala, key=lambda c: c['id']):
        code = pairs[c['id']]['code']
        score = collections.defaultdict(float)
        why = collections.defaultdict(set)
        for cid, w in curated.get(code, {}).items():
            score[cid] += w
            why[cid].add('curated-core' if w >= 3 else 'curated-unit')
        for cid, primary, conf in tagged.get(code, []):
            score[cid] += (1.5 if primary else 1.0) + conf
            why[cid].add('tag-primary' if primary else 'tag')
        images = {}
        for cid, s in score.items():
            card = card_by_id.get(cid)
            if not card or not card.get('slug'):
                excluded['card-without-image'] += 1
                continue
            path = resolve(card['slug'])
            if not path:
                excluded['image-file-missing'] += 1
                continue
            rel = str(path.relative_to(ref))
            st = image_status(rel)
            if st not in USABLE:
                excluded[f'status:{st}'] += 1
                continue
            slug = path.stem
            entry = images.setdefault(
                slug,
                {
                    'slug': slug,
                    'file': rel,
                    'status': st,
                    'score': 0.0,
                    'cards': [],
                    'evidence': set(),
                    'titles': [],
                    'facts': [],
                },
            )
            entry['score'] = max(entry['score'], s) + (0.25 if entry['cards'] else 0)
            entry['cards'].append(cid)
            entry['evidence'] |= why[cid]
            t = (card.get('title') or {}).get('en')
            fact = (card.get('fact') or {}).get('en')
            if t and t not in entry['titles']:
                entry['titles'].append(t)
            if fact and fact not in entry['facts']:
                entry['facts'].append(fact)
        ranked = sorted(images.values(), key=lambda e: (-e['score'], e['slug']))[: args.per_competency]
        cands = []
        for e in ranked:
            p = ref / e['file']
            if e['file'] not in hashed:
                hashed[e['file']] = (sha256_file(p), list(png_size(p) or (0, 0)))
            digest, size = hashed[e['file']]
            prompt, origin = prompt_by_slug.get(e['slug'], (None, None))
            cands.append(
                {
                    'slug': e['slug'],
                    'file': e['file'],
                    'sha256': digest,
                    'px': size,
                    'status': e['status'],
                    'score': round(e['score'], 3),
                    'evidence': sorted(e['evidence']),
                    'cards': sorted(e['cards'])[:8],
                    'titles': e['titles'][:3],
                    'facts': [f[:300] for f in e['facts'][:2]],
                    'depiction': (prompt or '')[:500] or None,
                    'depictionSource': origin,
                    'generator': generator(e['slug'], e['file']),
                }
            )
        out_comp[c['id']] = {
            'hiraiaCode': code,
            'pairingSimilarity': pairs[c['id']]['similarity'],
            'grade': c['grade'],
            'term': c['termIndex'],
            'weeks': [c['weekFrom'], c['weekTo']],
            'shortTitle': c.get('shortTitle'),
            'candidateCount': len(cands),
            'candidates': cands,
        }

    ref_commit = subprocess.run(
        ['git', '-C', str(ref), 'rev-parse', 'HEAD'], capture_output=True, text=True
    ).stdout.strip()
    catalog = {
        'catalogVersion': CATALOG_VERSION,
        'purpose': 'Candidate Hiraia illustrations per Tala Science competency. Candidates are not yet '
        'selected or verified for a slide; selection and checks happen per pack.',
        'referenceRoot': str(ref),
        'referenceCommit': ref_commit,
        'usableStatuses': list(USABLE),
        'rights': 'Hiraia owns these illustrations (licence decision by Luis Buenaventura, 2026-11-19). Teaching-pack decks embed them with the Hiraia watermark (packages/tala-packs/src/render/watermark.ts); the approved files themselves are never edited.',
        'inputs': {k: sha256_file(v) for k, v in inputs.items()},
        'excludedCandidateCounts': dict(sorted(excluded.items())),
        'competenciesWithoutCandidates': sorted(k for k, v in out_comp.items() if not v['candidates']),
        'competencies': out_comp,
    }
    text = json.dumps(catalog, ensure_ascii=False, indent=1, sort_keys=False) + '\n'
    out = Path(args.out)
    if args.check:
        if not out.exists() or out.read_text() != text:
            print('catalog differs from a fresh build', file=sys.stderr)
            return 1
        print('catalog matches a fresh build')
        return 0
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text)
    n = sum(v['candidateCount'] for v in out_comp.values())
    print(f'wrote {out} ({len(out_comp)} competencies, {n} candidates, {len(hashed)} unique images)')
    print('excluded:', dict(excluded))
    print('without candidates:', len(catalog['competenciesWithoutCandidates']))
    return 0


if __name__ == '__main__':
    sys.exit(main())
