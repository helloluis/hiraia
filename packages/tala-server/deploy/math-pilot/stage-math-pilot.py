#!/usr/bin/env python3
"""Stage the six-week Mathematics pilot for /var/lib/tala/packs-math on the host.

    stage-math-pilot.py <extracted bundle root> <out dir> [--bundle-sha256 <hex of the delivered .tar.gz>]

Input: the Math owner's delivery, extracted (the folder that holds manifest.json, FILES-SHA256.json,
COVERAGE-QUALITY.json and weeks/). Nothing in it is executed. Output, in the shape the Tala server reads:

    index.json                                          six weeks, both languages, every version a draft
    mathematics-bow-2026/<packId>/<lang>/pack.json      the authored pack, byte for byte
    mathematics-bow-2026/<packId>/<lang>/review.json    the review stages as the bundle records them
    artifacts/<packId>/<lang>/manifest.json             which built files belong to that exact pack
    artifacts/<packId>/<lang>/<files>                   slides, teacher guide, lesson plans, exercises, solutions,
                                                        and where a week needs them its diagram bank and net templates
    artifacts/<packId>/<lang>/previews/thumb-NN.png     the bundle's own checked slide pictures
    NOTICES/                                            licence and font notices, kept with the files
    SHA256SUMS, STAGE-RECORD.json

Rules:
- Content is never rewritten. pack.json, every PPTX, PDF and PNG is copied and its hash compared with the
  bundle's own records (FILES-SHA256.json, the final attempt's manifest). Only names and folders change.
- The final attempt of each week is the one pinned in COVERAGE-QUALITY.json, never "the newest folder".
- Review is recorded honestly: automatic checks and an independent AI cross-review passed; no teacher and no
  expert reviewed anything; publication is `draft`. Nothing here can make a pack public.
- Renderer code, verification scripts, source pages and anything else in the bundle stay behind.
Python standard library only.
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import sys

LANGS = ('en', 'fil')
CURRICULUM = 'mathematics-bow-2026'
PACK_ID = re.compile(r'^math26-g(4|5|7)-t[1-3]-w\d{2}$')
# kind -> (source inside the bundle, relative to the week folder; {a} = final attempt, {l} = language), name suffix
FILES = (
    ('slides', '{l}/attempt-{a}/slides.pptx', 'slides.pptx'),
    ('guide', '{l}/attempt-{a}/teacher-guide.pdf', 'teacher-guide.pdf'),
    ('plans', '{l}/attempt-{a}/lesson-plans.pdf', 'lesson-plans.pdf'),
    ('exercises', 'student-exercises.{l}.pdf', 'student-exercises.pdf'),
    ('solutions', 'teacher-solutions.{l}.pdf', 'worked-solutions.pdf'),
)
LEDGER_PASS = 'AI-reviewed pilot draft; technical gates pass'
# Materials a week cannot be taught without, where the week has them (the solids week): kind, source, name, note.
EXTRAS = (
    ('diagrams', 'diagram-bank.{l}.pdf', 'diagram-bank.pdf', None),
    ('templates', 'net-templates.pdf', 'net-templates.pdf', 'net-templates.README.md'),
)
# Every PDF at the top of a week folder must be one of these, so no material is left behind without a decision.
WEEK_PDFS = re.compile(r'^(student-exercises|teacher-solutions|diagram-bank)\.(en|fil)\.pdf$|^net-templates\.pdf$')
NOTICES = (
    'docs/PROJECT-LICENSE-NOTICE.md',
    'renderer/packages/tala-packs/assets/fonts/Carlito-Caladea-OFL-notices.txt',
    'renderer/packages/tala-packs/assets/fonts/Fraunces-OFL.txt',
)
MAGIC = {'pptx': b'PK\x03\x04', 'pdf': b'%PDF-', 'png': b'\x89PNG\r\n\x1a\n'}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read(path):
    with open(path, 'rb') as f:
        return f.read()


def fail(message):
    print('STAGE FAILED: ' + message, file=sys.stderr)
    sys.exit(1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('bundle')
    ap.add_argument('out')
    ap.add_argument('--bundle-sha256', default=None)
    args = ap.parse_args()
    root = os.path.abspath(args.bundle)
    out = os.path.abspath(args.out)
    if os.path.exists(out) and os.listdir(out):
        fail('the output folder must be empty: ' + out)

    # 1. The bundle is the bundle its own checksum list describes.
    listed = {e['path']: e['sha256'] for e in json.loads(read(os.path.join(root, 'FILES-SHA256.json')))['files']}
    for rel, want in listed.items():
        p = os.path.join(root, rel)
        if os.path.islink(p) or not os.path.isfile(p):
            fail('listed file missing or not a regular file: ' + rel)
        if sha(read(p)) != want:
            fail('bundle file does not match FILES-SHA256.json: ' + rel)
    manifest_sha = sha(read(os.path.join(root, 'manifest.json')))
    if read(os.path.join(root, 'manifest.sha256')).split()[0].decode() != manifest_sha:
        fail('manifest.json does not match manifest.sha256')
    frozen = json.loads(read(os.path.join(root, 'manifest.json')))
    ledger = json.loads(read(os.path.join(root, 'COVERAGE-QUALITY.json')))
    if sorted(w['packId'] for w in frozen['weeks']) != sorted(r['packId'] for r in ledger) or len(ledger) != 6:
        fail('the frozen manifest and the coverage ledger do not name the same six weeks')

    def bundle_file(rel):
        """Bytes of a bundle file that FILES-SHA256.json vouches for."""
        if rel not in listed:
            fail('not in FILES-SHA256.json: ' + rel)
        return read(os.path.join(root, rel))

    record = {
        'schema': 'tala-math-pilot-stage/1',
        'bundleSha256': args.bundle_sha256,
        'bundleManifestSha256': manifest_sha,
        'bundleFrozenAt': frozen.get('frozenAt'),
        'coordinator': frozen.get('coordinator'),
        'curriculumVersion': CURRICULUM,
        'weeks': [],
    }
    entries = []
    written = {}  # relative output path -> sha256

    def put(rel, data):
        dest = os.path.join(out, rel)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest, 'wb') as f:
            f.write(data)
        written[rel] = sha(data)

    for row in sorted(ledger, key=lambda r: (int(r['grade']), int(r['term']), int(r['week']))):
        pack_id = row['packId']
        attempt = str(row['finalAttempt'])
        if not PACK_ID.match(pack_id) or not re.fullmatch(r'\d{2}', attempt):
            fail('unexpected pack id or attempt: %s %s' % (pack_id, attempt))
        week = 'weeks/' + pack_id
        # The coordinator's ledger is the uniform gate; each week's own STATUS.json words its stage differently
        # (and may list the pending human review as a blocker), so it is recorded below, not gated on.
        if (row.get('status') != LEDGER_PASS or row.get('majorUnresolvedIssues') != 0
                or row.get('teacherReviewed') is not False or row.get('nativeTeacherReviewed') is not False):
            fail(pack_id + ': the ledger does not record an AI-reviewed draft with no major issue open')
        status = json.loads(bundle_file(week + '/STATUS.json'))
        stray = [n for n in os.listdir(os.path.join(root, week)) if n.endswith('.pdf') and not WEEK_PDFS.match(n)]
        if stray:
            fail('%s has week-level PDFs this script does not know: %s' % (pack_id, ', '.join(sorted(stray))))
        week_record = {'packId': pack_id, 'finalAttempt': attempt, 'languages': {}}
        variants = {}
        topic = None
        competency_ids = None
        for lang in LANGS:
            pack_bytes = bundle_file('%s/%s/pack.json' % (week, lang))
            content_sha = sha(pack_bytes)
            attempt_dir = '%s/%s/attempt-%s' % (week, lang, attempt)
            built = json.loads(bundle_file(attempt_dir + '/manifest.json'))
            if bundle_file(attempt_dir + '/pack.json') != pack_bytes or built.get('inputSha256') != content_sha:
                fail('%s %s: the final attempt was not rendered from the canonical pack.json' % (pack_id, lang))
            if built.get('packId') != pack_id or built.get('language') != lang or built.get('teacherReviewed') is not False:
                fail('%s %s: unexpected build manifest' % (pack_id, lang))
            if built.get('renderWarnings'):
                fail('%s %s: the final render has warnings' % (pack_id, lang))
            pack = json.loads(pack_bytes)
            if (pack.get('packId'), pack.get('language'), pack.get('learningAreaId'), pack.get('curriculumVersion')) != (
                    pack_id, lang, 'mathematics', CURRICULUM):
                fail('%s %s: pack.json identifies itself differently' % (pack_id, lang))
            if (str(pack['grade']), int(pack['term']), int(pack['week'])) != (
                    str(row['grade']), int(row['term']), int(row['week'])):
                fail('%s %s: grade, term or week differs from the ledger' % (pack_id, lang))
            slides = pack['slides']
            if built.get('slides') != len(slides) or row.get('slidesPerLanguage') != len(slides):
                fail('%s %s: slide count differs between pack, build manifest and ledger' % (pack_id, lang))
            built_by_name = {f['name']: f for f in built['files']}
            base = 'tala-math-%s-%s' % (pack_id.replace('math26-', ''), lang)
            lib = '%s/%s/%s' % (CURRICULUM, pack_id, lang)
            art = 'artifacts/%s/%s' % (pack_id, lang)
            files = []
            for kind, pattern, suffix in FILES:
                rel = week + '/' + pattern.format(l=lang, a=attempt)
                data = bundle_file(rel)
                ext = suffix.rsplit('.', 1)[1]
                if not data.startswith(MAGIC[ext]):
                    fail('%s is not a %s file' % (rel, ext))
                own = built_by_name.get(os.path.basename(rel))
                if kind in ('slides', 'guide', 'plans') and (
                        not own or own['sha256'] != sha(data) or own['bytes'] != len(data)):
                    fail('%s does not match the final attempt manifest' % rel)
                name = '%s-%s' % (base, suffix)
                put('%s/%s' % (art, name), data)
                files.append({'kind': kind, 'name': name, 'bytes': len(data), 'sha256': sha(data), 'from': rel})
            for kind, pattern, suffix, note_file in EXTRAS:
                rel = week + '/' + pattern.format(l=lang)
                if rel not in listed:
                    continue
                data = bundle_file(rel)
                if not data.startswith(MAGIC['pdf']):
                    fail('%s is not a PDF' % rel)
                name = '%s-%s' % (base, suffix)
                put('%s/%s' % (art, name), data)
                extra = {'kind': kind, 'name': name, 'bytes': len(data), 'sha256': sha(data), 'from': rel}
                if note_file:
                    # The author's own instructions, word for word.
                    extra['note'] = ' '.join(bundle_file(week + '/' + note_file).decode('utf-8').split())
                files.append(extra)
            preview_dir = os.path.join(root, attempt_dir, 'previews')
            previews = sorted(n for n in os.listdir(preview_dir))
            if previews != ['slide-%02d.png' % n for n in range(1, len(slides) + 1)]:
                fail('%s %s: the slide pictures are not exactly slide-01..slide-%02d' % (pack_id, lang, len(slides)))
            for n, name in enumerate(previews, 1):
                data = bundle_file('%s/previews/%s' % (attempt_dir, name))
                if not data.startswith(MAGIC['png']):
                    fail('%s/previews/%s is not a PNG' % (attempt_dir, name))
                put('%s/previews/thumb-%02d.png' % (art, n), data)
            put(lib + '/pack.json', pack_bytes)
            at = status.get('finishedAt') or built.get('builtAt')
            review = {
                'packId': pack_id,
                'language': lang,
                'contentSha256': content_sha,
                # The bundle's deterministic gates: contract, editability, zero render warnings, every problem recomputed.
                'autoChecks': {'state': 'pass', 'checkerVersion': 'math-pilot-gates/1', 'failures': [], 'warnings': [], 'at': at},
                # A different AI conversation reviewed the week (same model family). NOT human review.
                'modelCritique': {
                    'state': 'pass',
                    'model': row.get('model'),
                    'rounds': 1,
                    'openIssues': [],
                    'resolvedIssues': 0,
                    'at': at,
                },
                'teacherReview': None,
                'expertReview': None,
                'verbiage': None,
                'publication': 'draft',
                'publicationBy': None,
            }
            put(lib + '/review.json', (json.dumps(review, ensure_ascii=False, indent=1) + '\n').encode())
            build_manifest = {
                'packId': pack_id,
                'language': lang,
                'contentSha256': content_sha,
                'builtAt': built.get('builtAt'),
                'renderWarnings': [],
                'files': [{k: f[k] for k in ('kind', 'name', 'bytes', 'sha256')} for f in files],
                'previews': len(previews),
                'previewFormat': 'png',
                'images': [],
                'editability': built.get('editability'),
                'source': {'bundleManifestSha256': manifest_sha, 'finalAttempt': attempt},
            }
            put(art + '/manifest.json', (json.dumps(build_manifest, ensure_ascii=False, indent=1) + '\n').encode())
            variants[lang] = {
                'language': lang,
                'status': 'draft',
                'title': pack['title'],
                'viewable': True,
                'files': [{k: f[k] for k in ('kind', 'name', 'bytes', 'sha256', 'note') if k in f} for f in files],
                'slideCount': len(slides),
                'illustratedSlides': sum(1 for s in slides if s.get('image')),
                'review': {'autoChecks': 'pass', 'modelCritique': 'pass', 'teacherReview': False, 'expertReview': False},
            }
            ids = [c['id'] for c in pack['competencies']]
            titles = []
            for c in pack['competencies']:
                t = c.get('shortTitle') or ''
                if t and t not in titles:
                    titles.append(t)
            if lang == 'en':
                topic, competency_ids = ' · '.join(titles) or pack['title'], ids
            elif ids != competency_ids:
                fail(pack_id + ': the two languages name different competencies')
            week_record['languages'][lang] = {
                'contentSha256': content_sha,
                'slides': len(slides),
                'files': files,
                'timingBasis': pack['timing'].get('basis'),
            }
        entries.append({
            'packId': pack_id,
            'grade': str(row['grade']),
            'term': int(row['term']),
            'week': int(row['week']),
            'topic': topic,
            'competencyIds': competency_ids,
            'status': 'draft',
            'viewable': True,
            'variants': variants,
        })
        week_record['ledgerStatus'] = row.get('status')
        week_record['weekStatus'] = {'stage': status.get('stage'), 'blockers': status.get('blockers', [])}
        week_record['rubric'] = row.get('rubric')
        week_record['reviewerAgentId'] = row.get('reviewerAgentId')
        record['weeks'].append(week_record)

    versions = [v for e in entries for v in e['variants'].values()]
    index = {
        'subject': 'mathematics',
        'curriculumVersion': CURRICULUM,
        'libraryVersion': (frozen.get('frozenAt') or '')[:10],
        'reviewerView': False,
        'counts': {
            'targets': len(versions),
            'approved': 0,
            'draft': len(versions),
            'needsWork': 0,
            'failed': 0,
            'notBuilt': 0,
        },
        'packs': entries,
    }
    put('index.json', (json.dumps(index, ensure_ascii=False, indent=1) + '\n').encode())
    # Licence and font notices travel with the files they cover (kept beside the library, not served).
    for rel in NOTICES:
        put('NOTICES/' + os.path.basename(rel), bundle_file(rel))
    record['files'] = len(written) + 1
    put('STAGE-RECORD.json', (json.dumps(record, ensure_ascii=False, indent=1) + '\n').encode())
    sums = ''.join('%s  %s\n' % (written[rel], rel) for rel in sorted(written))
    with open(os.path.join(out, 'SHA256SUMS'), 'w') as f:
        f.write(sums)
    print('staged %d weeks, %d language versions, %d files, %.1f MB -> %s' % (
        len(entries), len(versions), len(written) + 1,
        sum(os.path.getsize(os.path.join(out, rel)) for rel in written) / 1048576, out))


if __name__ == '__main__':
    main()
