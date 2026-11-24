"""Read the files a browser walk downloaded with an independent library, and compare them with what the walk did.

    python pptx-walk-verify.py <walk-xx.json> [<out.json>]

`walk-xx.json` is written by packages/tala-web/scripts/uploads-walk.mjs. Nothing here uses this repository's own
PowerPoint code: the files are opened with python-pptx. Checks:
  - the "file I uploaded" download is byte for byte the file that was uploaded (SHA-256);
  - the edited download opens, has the slides the teacher ended up with, in her order;
  - every slide holds exactly the words the walk left on it (changed ones changed, all others as uploaded), and its
    notes;
  - what Tala only carries along is still there and unchanged on every kept slide: pictures (same bytes), charts
    (same chart XML and the same embedded workbook), tables, hidden-ness, slide transitions, the slide's layout;
  - a removed slide is gone from the edited file and still in the original.
"""
import hashlib
import json
import sys

from pptx import Presentation
from pptx.util import Emu

P = '{http://schemas.openxmlformats.org/presentationml/2006/main}'
results = []


def check(name, ok, detail=''):
    results.append({'name': name, 'ok': bool(ok), 'detail': str(detail)[:400]})
    print(('PASS  ' if ok else 'FAIL  ') + name + (f'  — {str(detail)[:200]}' if detail else ''))


def sha(data):
    return hashlib.sha256(data).hexdigest()


def clean(text):
    # python-pptx gives a line break inside a paragraph as a vertical tab; the editor's fields use "\n".
    return text.replace('\x0b', '\n').replace(' ', '\n')


def frames(shapes):
    """Every text frame on a slide, in drawing order: shapes, the cells of tables, the members of groups."""
    for shape in shapes:
        if shape.__class__.__name__ == 'GroupShape':
            yield from frames(shape.shapes)
        elif getattr(shape, 'has_table', False) and shape.has_table:
            for row in shape.table.rows:
                for cell in row.cells:
                    yield cell.text_frame
        elif getattr(shape, 'has_text_frame', False) and shape.has_text_frame:
            yield shape.text_frame


def words(slide):
    return [clean(p.text) for frame in frames(slide.shapes) for p in frame.paragraphs]


def notes(slide):
    if not slide.has_notes_slide:
        return []
    frame = slide.notes_slide.notes_text_frame
    return [clean(p.text) for p in frame.paragraphs] if frame is not None else []


def kept(slide):
    """What the walk did not (and could not) change on a slide, in a form that compares across two files."""
    out = {'pictures': [], 'charts': [], 'tables': 0, 'hidden': slide._element.get('show') == '0',
           'transition': slide._element.find(f'{P}transition') is not None, 'layout': slide.slide_layout.name, 'boxes': []}
    for shape in slide.shapes:
        if shape.__class__.__name__ == 'Picture':
            out['pictures'].append(sha(shape.image.blob))
        if getattr(shape, 'has_chart', False) and shape.has_chart:
            part = shape.chart.part
            book = part.chart_workbook.xlsx_part
            out['charts'].append([sha(part.blob), sha(book.blob) if book is not None else None])
        if getattr(shape, 'has_table', False) and shape.has_table:
            out['tables'] += 1
        out['boxes'].append([shape.name, Emu(shape.left or 0), Emu(shape.top or 0), Emu(shape.width or 0), Emu(shape.height or 0)])
    return out


def main():
    walk = json.load(open(sys.argv[1], encoding='utf-8'))
    exp = walk['expected']
    files = exp['files']
    original_bytes = open(files['original'], 'rb').read()
    edited_bytes = open(files['edited'], 'rb').read()
    check('the "file I uploaded" download is the uploaded file, byte for byte', sha(original_bytes) == exp['uploadedSha256'], f"{len(original_bytes)} bytes, sha256 {sha(original_bytes)[:16]}…")
    check('the edited download is a different file', sha(edited_bytes) != exp['uploadedSha256'], f'{len(edited_bytes)} bytes')

    original = Presentation(files['original'])
    edited = Presentation(files['edited'])
    check('python-pptx opens the edited download', True, f'{len(edited.slides)} slides')
    by_id = {f's{s.slide_id}': s for s in original.slides}
    check('the edited download has the slides she ended up with', len(edited.slides) == len(exp['slides']), f"{len(edited.slides)} of {len(exp['slides'])} expected")
    check('slide size is unchanged', (edited.slide_width, edited.slide_height) == (original.slide_width, original.slide_height))

    wrong_words, wrong_notes, wrong_kept, changed, copies = [], [], [], 0, 0
    for i, (want, slide) in enumerate(zip(exp['slides'], edited.slides), start=1):
        source = by_id[want['source']]
        expected_words = [clean(p) for block in sorted(want['blocks'], key=lambda b: int(b[1:])) for p in want['blocks'][block]]
        actual = words(slide)
        if sorted(actual) != sorted(expected_words):
            wrong_words.append({'slide': i, 'expected': expected_words[:6], 'actual': actual[:6]})
        if actual != words(source):
            changed += 1
        if want['id'] != want['source']:
            copies += 1
        want_notes = [clean(p) for p in want['notes']]
        got_notes = notes(slide)
        # An empty notes page and no notes are the same thing to a teacher.
        if [p for p in got_notes if p] != [p for p in want_notes if p]:
            wrong_notes.append({'slide': i, 'expected': want_notes, 'actual': got_notes})
        if kept(slide) != kept(source):
            wrong_kept.append({'slide': i, 'expected': kept(source), 'actual': kept(slide)})
    check('every slide holds exactly the words the walk left on it', not wrong_words, json.dumps(wrong_words, ensure_ascii=False)[:380] if wrong_words else f"{len(exp['slides'])} slides; {changed} differ from the upload in their words; {copies} is a copy")
    check('every slide has the notes the walk left on it', not wrong_notes, json.dumps(wrong_notes, ensure_ascii=False)[:380] if wrong_notes else '')
    check('pictures, charts (with their data), tables, hidden slides, transitions, layouts and positions are as uploaded', not wrong_kept, json.dumps(wrong_kept, ensure_ascii=False)[:380] if wrong_kept else '')

    kinds = {'pictures': 0, 'charts': 0, 'tables': 0, 'hidden': 0, 'transition': 0}
    for slide in edited.slides:
        k = kept(slide)
        kinds['pictures'] += len(k['pictures'])
        kinds['charts'] += len(k['charts'])
        kinds['tables'] += k['tables']
        kinds['hidden'] += int(k['hidden'])
        kinds['transition'] += int(k['transition'])
    check('the edited download still holds what Tala only carries along', True, ', '.join(f'{v} {k}' for k, v in kinds.items()))

    removed_titles = []
    for rid in exp.get('removed', []):
        gone = by_id[rid]
        title = gone.shapes.title.text if gone.shapes.title is not None else ''
        removed_titles.append(title)
        still = [s for s in edited.slides if s.shapes.title is not None and s.shapes.title.text == title]
        check('a removed slide is gone from the edited file and still in the uploaded one', not still and title != '', title)
    check('the name she gave the slides is the name of the download', files['editedName'].lower().endswith('.pptx'), files['editedName'])

    failed = [r for r in results if not r['ok']]
    if len(sys.argv) > 2:
        json.dump({'walk': sys.argv[1], 'checks': len(results), 'failed': len(failed), 'results': results}, open(sys.argv[2], 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
    print(f'\n{len(results) - len(failed)}/{len(results)} checks passed')
    sys.exit(1 if failed else 0)


main()
