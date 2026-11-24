"""Judge the combined multi-grade plan's files with tools that share no code with Tala.

    python multigrade-evidence-check.py <dir written by multigrade-evidence.mjs> [--soffice PATH] [--out result.json]

For every case in manifest.json:
  Word file (python-docx)   opens; paper size and orientation; the session is one table with the expected heading
                            row (marked to repeat on each page) and one row per time block; every grade's own words,
                            the curriculum references, the draft labels and a teacher's edit are there;
                            EDITABLE: a cell is changed and a paragraph added with python-docx, saved, reopened;
  Word file (LibreOffice)   the original and the revised file both open and convert to PDF at the right paper size
                            (skipped without --soffice);
  Printed PDF (pypdf)       every page is the paper asked for; nothing is missing; the heading row is on every page
                            the table runs onto; a time block is not cut in two when it fits on a page; the
                            signature lines are on the last page.
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
root = Path(args.dir)
results = []


def check(case, name, ok, detail=''):
    results.append({'case': case, 'name': name, 'ok': bool(ok), 'detail': str(detail)[:300]})
    if not ok:
        print(f'FAIL  {case}: {name}  — {str(detail)[:200]}')


def squash(text):
    return re.sub(r'\s+', ' ', text).strip()


def tight(text):
    """Without any white space: a PDF breaks lines wherever the page did, also inside "12–20"."""
    return re.sub(r'\s+', '', text)


def cell_text(cell):
    return '\n'.join(p.text for p in cell.paragraphs)


def docx_text(doc):
    parts = [p.text for p in doc.paragraphs]
    for t in doc.tables:
        for row in t.rows:
            for cell in row.cells:
                parts.append(cell_text(cell))
    return squash('\n'.join(parts))


def pt(emu):
    return Emu(emu).pt


def office_pdf(path, workdir):
    """LibreOffice opens a Word file and writes a PDF of it. Returns the PDF path or None."""
    profile = Path(workdir) / 'profile'
    home = Path(workdir) / 'home'
    home.mkdir(exist_ok=True)
    cmd = [args.soffice, '--headless', '--norestore', '--nolockcheck', '--nodefault', '--nofirststartwizard', f'-env:UserInstallation=file://{profile}',
           '--convert-to', 'pdf', '--outdir', str(workdir), str(path)]
    if os.path.exists('/usr/bin/unshare'):
        cmd = ['/usr/bin/unshare', '--map-root-user', '--net'] + cmd
    env = {'PATH': os.environ.get('PATH', '/usr/bin:/bin'), 'HOME': str(home), 'LANG': 'C.UTF-8', 'SAL_USE_VCLPLUGIN': 'svp'}
    for _ in range(2):
        r = subprocess.run(cmd, env=env, cwd=workdir, capture_output=True, timeout=300)
        if r.returncode != 81:
            break
    out = Path(workdir) / (Path(path).stem + '.pdf')
    return out if out.exists() else None


def page_size(page):
    box = page.mediabox
    return float(box.width), float(box.height)


def close(a, b, tol=1.5):
    return abs(a[0] - b[0]) <= tol and abs(a[1] - b[1]) <= tol


manifest = json.load(open(root / 'manifest.json', encoding='utf-8'))
work = tempfile.mkdtemp(prefix='tala-mg-check-')
for m in manifest:
    case = m['name']
    want_pt = tuple(m['pagePt'])

    # ---------- the Word file, read by python-docx ----------
    doc = Document(str(root / f'{case}.docx'))
    sec = doc.sections[0]
    check(case, 'Word: paper size', close((pt(sec.page_width), pt(sec.page_height)), want_pt), f'{pt(sec.page_width):.1f} x {pt(sec.page_height):.1f} pt, wanted {want_pt}')
    check(case, 'Word: orientation', ('landscape' if sec.orientation == 1 else 'portrait') == m['orientation'], sec.orientation)
    flow = next((t for t in doc.tables if [squash(c.text) for c in t.rows[0].cells] == m['header']), None)
    check(case, 'Word: the session is a real table with a column per grade', flow is not None, m['header'])
    if flow is not None:
        check(case, 'Word: one row per time block', len(flow.rows) == 1 + len(m['blocks']), f'{len(flow.rows) - 1} rows, {len(m["blocks"])} blocks')
        check(case, 'Word: the heading row repeats on every page', flow.rows[0]._tr.xpath('./w:trPr/w:tblHeader') != [])
        for row, block in zip(flow.rows[1:], m['blocks']):
            first = squash(row.cells[0].text)
            check(case, f'Word: row "{block["label"]}"', first.startswith(block['label']) and f'{block["minutes"]} min' in first, first)
            row_text = squash(' '.join(c.text for c in row.cells))
            check(case, f'Word: "{block["label"]}" holds its own words', all(s in row_text for s in block['own']), [s for s in block['own'] if s not in row_text][:2])
    text = docx_text(doc)
    missing = [s for s, n in m['sentences'].items() if text.count(squash(s)) < n]
    check(case, 'Word: every grade’s words are there', not missing, missing[:3])
    check(case, 'Word: curriculum references', all(r in text for r in m['references']), [r for r in m['references'] if r not in text])
    check(case, 'Word: draft labels', m['draft'] in text and squash(m['aiDraft']) in text)
    check(case, 'Word: title', squash(m['title']) in text, m['title'])
    if m['note']:
        check(case, 'Word: the session note', squash(m['note']) in text)
    if m['edit']:
        check(case, 'Word: what the teacher changed', all(squash(v) in text for v in m['edit'].values()), m['edit'])
    per_grade = [t for t in doc.tables if [squash(c.text) for c in t.rows[0].cells] == m['header'][2:]]
    check(case, 'Word: objectives, materials and assessment side by side per grade', len(per_grade) >= 3, f'{len(per_grade)} tables')

    # ---------- editable: change it the way a teacher would in Word, save, reopen ----------
    revised_path = Path(work) / f'{case}.revised.docx'
    if flow is not None:
        cell = flow.rows[2].cells[2]
        cell.paragraphs[-1].add_run(' [revised in Word]')
        cell.add_paragraph('A paragraph the teacher added in Word.')
        doc.paragraphs[2].add_run(' (revised)') if len(doc.paragraphs) > 2 else None
        doc.save(str(revised_path))
        again = Document(str(revised_path))
        flow2 = next((t for t in again.tables if [squash(c.text) for c in t.rows[0].cells] == m['header']), None)
        again_text = docx_text(again)
        check(case, 'Word: an edited copy saves and reopens with the edit and the same table', flow2 is not None and len(flow2.rows) == len(flow.rows) and '[revised in Word]' in again_text and 'A paragraph the teacher added in Word.' in again_text)

    # ---------- the Word file, opened by LibreOffice ----------
    if args.soffice:
        for label, path in (('original', root / f'{case}.docx'), ('revised', revised_path)):
            target = Path(work) / f'lo-{case}-{label}'
            target.mkdir(exist_ok=True)
            pdf = office_pdf(path, target)
            check(case, f'LibreOffice opens the {label} Word file', pdf is not None)
            if pdf is None:
                continue
            reader = PdfReader(str(pdf))
            check(case, f'LibreOffice ({label}): paper size', close(page_size(reader.pages[0]), want_pt, 2.5), f'{page_size(reader.pages[0])} wanted {want_pt}')
            lo_text = squash(' '.join(p.extract_text() or '' for p in reader.pages))
            check(case, f'LibreOffice ({label}): time blocks are there', all(b['label'] in lo_text for b in m['blocks']), [b['label'] for b in m['blocks'] if b['label'] not in lo_text])
            if label == 'original':
                m['wordPages'] = len(reader.pages)

    # ---------- the printed page (Chromium), read by pypdf ----------
    reader = PdfReader(str(root / f'{case}.pdf'))
    pages = [tight(p.extract_text() or '') for p in reader.pages]
    m['printPages'] = len(pages)
    check(case, 'print: every page is the paper asked for', all(close(page_size(p), want_pt) for p in reader.pages), [page_size(p) for p in reader.pages][:2])
    whole = ''.join(pages)
    missing = [s for s, n in m['sentences'].items() if whole.count(tight(s)) < n]
    check(case, 'print: every grade’s words are there', not missing, missing[:3])
    check(case, 'print: curriculum references', all(tight(r) in whole for r in m['references']))
    check(case, 'print: draft labels', tight(m['aiDraft']) in whole)
    if m['edit']:
        check(case, 'print: what the teacher changed', all(tight(v) in whole for v in m['edit'].values()))
    # Which page each time block is on: where its own sentences are.
    block_pages = []
    for block in m['blocks']:
        on = sorted({i for i, text in enumerate(pages) for s in block['own'] if tight(s) in text})
        block_pages.append(on)
    table_pages = sorted({i for on in block_pages for i in on})
    header_ok = all(tight(m['header'][0]) in pages[i] and tight(m['header'][1]) in pages[i] for i in table_pages)
    check(case, 'print: the heading row is on every page the table runs onto', header_ok and table_pages, f'table on pages {[i + 1 for i in table_pages]}')
    cut = [m['blocks'][i]['label'] for i, on in enumerate(block_pages) if len(on) > 1]
    if not m['longLessons']:
        check(case, 'print: no time block is cut across pages', not cut, cut)
    else:
        m['blocksOverTwoPages'] = cut
    check(case, 'print: signature lines are on the last page', all(tight(s) in pages[-1] for s in m['signatures']), m['signatures'])

failed = [r for r in results if not r['ok']]
summary = {
    'cases': len(manifest),
    'checks': len(results),
    'failed': len(failed),
    'libreoffice': bool(args.soffice),
    'pages': {m['name']: {'paper': m['paper'], 'orientation': m['orientation'], 'print': m.get('printPages'), 'word_in_libreoffice': m.get('wordPages'), 'blocks_over_two_pages': m.get('blocksOverTwoPages')} for m in manifest},
}
if args.out:
    json.dump({'summary': summary, 'results': results}, open(args.out, 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
print(json.dumps(summary, indent=1, ensure_ascii=False))
sys.exit(1 if failed else 0)
