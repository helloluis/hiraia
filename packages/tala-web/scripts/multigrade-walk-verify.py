"""Judge the files a browser walk of the combined multi-grade plan saved, with tools that share no code with Tala.

    python multigrade-walk-verify.py <walk dir> [--soffice PATH] [--out result.json]

Reads multigrade-walk.json (written by multigrade-walk.mjs): the Word file the browser downloaded and the PDFs of the
print page. Checks, with python-docx, pypdf and (optionally) LibreOffice: the Word file opens and holds the session
as a table with one column per grade and one row per time block, with the note the teacher typed in the editor; the
PDFs are the paper asked for (A4, long bond, landscape for three grades) and hold the same table and note.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

from docx import Document
from docx.shared import Emu
from pypdf import PdfReader

ap = argparse.ArgumentParser()
ap.add_argument('dir')
ap.add_argument('--soffice')
ap.add_argument('--out')
args = ap.parse_args()
walk = json.load(open(Path(args.dir) / 'multigrade-walk.json', encoding='utf-8'))
files, plans = walk['files'], walk['expected']['plans']
results = []


def check(name, ok, detail=''):
    results.append({'name': name, 'ok': bool(ok), 'detail': str(detail)[:300]})
    print(('PASS  ' if ok else 'FAIL  ') + name + (f'  — {str(detail)[:180]}' if detail else ''))


def tight(text):
    return re.sub(r'\s+', '', text)


def size(page):
    return round(float(page.mediabox.width)), round(float(page.mediabox.height))


two = plans['two']
doc = Document(files['word'])
header = ['Time', 'Teacher is with'] + two['groups']
flow = next((t for t in doc.tables if [re.sub(r'\s+', ' ', c.text).strip() for c in t.rows[0].cells] == header), None)
check('Word: the downloaded file opens and the session is a table with a column per grade', flow is not None, header)
if flow is not None:
    labels = [re.sub(r'\s+', ' ', r.cells[0].text).strip() for r in flow.rows[1:]]
    check('Word: one row per time block, in order', len(labels) == len(two['blocks']) and all(l.startswith(b) for l, b in zip(labels, two['blocks'])), labels)
    check('Word: the heading row repeats on every page', flow.rows[0]._tr.xpath('./w:trPr/w:tblHeader') != [])
text = tight('\n'.join([p.text for p in doc.paragraphs] + [c.text for t in doc.tables for r in t.rows for c in r.cells]))
check('Word: the note the teacher typed in the editor is in the file', tight(two['note']) in text, two['note'])
check('Word: it says which lessons it was combined from, or carries their words', all(tight(s.split(': ', 1)[-1]) in text for s in two['sources']), two['sources'])
check('Word: A4 portrait', (round(Emu(doc.sections[0].page_width).pt), round(Emu(doc.sections[0].page_height).pt)) == (595, 842))
check('Word: draft and AI-draft labels', 'DRAFT' in text and tight('Drafted with AI and not yet checked by the teacher.') in text)
check('Word: curriculum references', tight('DepEd Science G4: 2026 Three-Term BOW') in text and tight('DepEd Science G5: 2026 Three-Term BOW') in text)

if args.soffice:
    work = tempfile.mkdtemp(prefix='tala-mg-walk-')
    home = Path(work) / 'home'
    home.mkdir()
    cmd = [args.soffice, '--headless', '--norestore', '--nolockcheck', '--nodefault', '--nofirststartwizard', f'-env:UserInstallation=file://{work}/profile', '--convert-to', 'pdf', '--outdir', work, files['word']]
    if os.path.exists('/usr/bin/unshare'):
        cmd = ['/usr/bin/unshare', '--map-root-user', '--net'] + cmd
    env = {'PATH': os.environ.get('PATH', '/usr/bin:/bin'), 'HOME': str(home), 'LANG': 'C.UTF-8', 'SAL_USE_VCLPLUGIN': 'svp'}
    for _ in range(2):
        r = subprocess.run(cmd, env=env, cwd=work, capture_output=True, timeout=300)
        if r.returncode != 81:
            break
    pdf = Path(work) / (Path(files['word']).stem + '.pdf')
    check('LibreOffice opens the downloaded Word file', pdf.exists())
    if pdf.exists():
        reader = PdfReader(str(pdf))
        lo = tight(' '.join(p.extract_text() or '' for p in reader.pages))
        check('LibreOffice: paper size and the teacher’s note', size(reader.pages[0]) == (595, 842) and tight(two['note']) in lo, f'{size(reader.pages[0])}, {len(reader.pages)} pages')

for key, want, groups, note in (
    ('pdf_a4', (595, 842), two['groups'], two['note']),
    ('pdf_long', (612, 936), two['groups'], two['note']),
    ('pdf_three_long', (936, 612), plans['three']['groups'], None),
):
    reader = PdfReader(files[key])
    pages = [tight(p.extract_text() or '') for p in reader.pages]
    whole = ''.join(pages)
    check(f'print {key}: every page is the paper asked for', all(size(p) == want for p in reader.pages), f'{size(reader.pages[0])} × {len(reader.pages)} pages, wanted {want}')
    check(f'print {key}: the session table with a column per grade', tight('Teacher is with') in whole and all(tight(g) in whole for g in groups))
    if note:
        check(f'print {key}: the teacher’s note', tight(note) in whole)
    check(f'print {key}: signature lines on the last page', tight('Prepared by') in pages[-1] and tight('Checked by') in pages[-1])

failed = [r for r in results if not r['ok']]
if args.out:
    json.dump({'checks': len(results), 'failed': len(failed), 'results': results}, open(args.out, 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
print(f'\n{len(results) - len(failed)}/{len(results)} checks passed')
sys.exit(1 if failed else 0)
