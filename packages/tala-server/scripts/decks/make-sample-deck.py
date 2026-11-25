"""A small lesson deck of the kind a teacher brings, for previews and walk-throughs of "My own slides".

    python make-sample-deck.py <out.pptx>

Written with python-pptx (so it is NOT produced by any code in this repository): a title slide, a bulleted list, a
picture with labels in text boxes, a table, a native chart, speaker notes, a slide transition and a hidden slide.
Everything in it is invented for the
demo (the teacher's name is the fictional one the UI seed uses; the bean-plant measurements are sample data).
"""
import io
import sys

from lxml import etree
from PIL import Image, ImageDraw
from pptx import Presentation
from pptx.chart.data import CategoryChartData
from pptx.dml.color import RGBColor
from pptx.enum.chart import XL_CHART_TYPE
from pptx.util import Inches, Pt


def plant_picture():
    """A simple drawing of a flowering plant: roots, stem, leaves, flower. No words (labels are text boxes)."""
    w, h = 900, 1100
    im = Image.new('RGB', (w, h), (250, 247, 238))
    d = ImageDraw.Draw(im)
    ground = 760
    d.rectangle([0, ground, w, h], fill=(214, 186, 150))
    d.line([0, ground, w, ground], fill=(120, 86, 52), width=6)
    # roots
    for dx, dy in [(-190, 200), (-110, 270), (-30, 300), (60, 280), (150, 230), (210, 150)]:
        d.line([450, ground, 450 + dx * 0.5, ground + dy * 0.55, 450 + dx, ground + dy], fill=(120, 86, 52), width=9, joint='curve')
    # stem
    d.line([450, ground, 450, 300], fill=(60, 140, 70), width=22)
    # leaves
    d.ellipse([190, 470, 450, 590], fill=(92, 176, 96), outline=(46, 110, 58), width=5)
    d.ellipse([450, 380, 720, 500], fill=(92, 176, 96), outline=(46, 110, 58), width=5)
    d.line([200, 530, 450, 530], fill=(46, 110, 58), width=4)
    d.line([450, 440, 710, 440], fill=(46, 110, 58), width=4)
    # flower
    for ox, oy in [(0, -95), (90, -30), (56, 76), (-56, 76), (-90, -30)]:
        d.ellipse([450 + ox - 70, 230 + oy - 70, 450 + ox + 70, 230 + oy + 70], fill=(240, 132, 150), outline=(190, 80, 104), width=4)
    d.ellipse([395, 175, 505, 285], fill=(250, 204, 70), outline=(200, 150, 30), width=4)
    out = io.BytesIO()
    im.save(out, format='PNG')
    out.seek(0)
    return out


def notes(slide, text):
    slide.notes_slide.notes_text_frame.text = text


P = 'http://schemas.openxmlformats.org/presentationml/2006/main'


def fade_in(slide):
    """A plain fade transition, written the way PowerPoint writes it (after the colour map, before any timing)."""
    sld = slide._element
    transition = etree.SubElement(sld, f'{{{P}}}transition', {'spd': 'med'})
    etree.SubElement(transition, f'{{{P}}}fade')


def main(path):
    prs = Presentation()
    title_layout, content_layout, title_only = prs.slide_layouts[0], prs.slide_layouts[1], prs.slide_layouts[5]

    s = prs.slides.add_slide(title_layout)
    s.shapes.title.text = 'Parts of a Plant'
    s.placeholders[1].text = 'Science 4 · Quarter 2 · Gng. Santos'
    notes(s, 'Greet the class. Ask: What plants do you see on your way to school?')

    s = prs.slides.add_slide(content_layout)
    s.shapes.title.text = 'What we will learn'
    body = s.placeholders[1].text_frame
    body.text = 'Name the main parts of a plant'
    for line in ['Tell what each part does', 'Explain how the parts work together']:
        body.add_paragraph().text = line
    notes(s, 'Read the three targets aloud with the class.')

    s = prs.slides.add_slide(title_only)
    s.shapes.title.text = 'Look at this plant'
    s.shapes.add_picture(plant_picture(), Inches(0.6), Inches(1.5), height=Inches(5.6))
    for label, top in [('Flower', 1.75), ('Leaf', 3.3), ('Stem', 4.3), ('Roots', 5.9)]:
        box = s.shapes.add_textbox(Inches(5.4), Inches(top), Inches(2.2), Inches(0.6))
        run = box.text_frame.paragraphs[0].add_run()
        run.text = label
        run.font.size = Pt(28)
        run.font.bold = True
        run.font.color.rgb = RGBColor(0x1F, 0x4E, 0x3D)
    q = s.shapes.add_textbox(Inches(5.4), Inches(6.6), Inches(4.2), Inches(0.6))
    q.text_frame.text = 'Which part takes in water?'
    notes(s, 'Point to each part. Let learners name it before you say it.')

    s = prs.slides.add_slide(title_only)
    s.shapes.title.text = 'What each part does'
    rows = [('Part', 'What it does'),
            ('Roots', 'Take in water and minerals from the soil. Hold the plant in place.'),
            ('Stem', 'Carries water to the leaves. Holds the plant up.'),
            ('Leaves', 'Make food for the plant using sunlight, water and air.'),
            ('Flower', 'Makes seeds, so new plants can grow.')]
    table = s.shapes.add_table(len(rows), 2, Inches(0.6), Inches(1.6), Inches(8.8), Inches(4.6)).table
    table.columns[0].width = Inches(2.2)
    table.columns[1].width = Inches(6.6)
    for r, (a, b) in enumerate(rows):
        table.cell(r, 0).text = a
        table.cell(r, 1).text = b
    notes(s, 'Learners copy the table into their notebooks.')

    s = prs.slides.add_slide(title_only)
    s.shapes.title.text = 'Our bean plant grew (sample data)'
    data = CategoryChartData()
    data.categories = ['Day 2', 'Day 4', 'Day 6', 'Day 8', 'Day 10']
    data.add_series('Height in cm', (0, 1.5, 4, 7.5, 11))
    s.shapes.add_chart(XL_CHART_TYPE.COLUMN_CLUSTERED, Inches(0.8), Inches(1.6), Inches(8.4), Inches(5.2), data)
    notes(s, 'Ask: On which days did the plant grow the most?')

    s = prs.slides.add_slide(content_layout)
    s.shapes.title.text = 'Check what you know'
    body = s.placeholders[1].text_frame
    body.text = 'Which part makes food for the plant?'
    for line in ['Which part holds the plant in the soil?', 'What would happen to a plant with no leaves?']:
        body.add_paragraph().text = line
    notes(s, 'Answers are on the next slide, which is hidden from the class.')

    s = prs.slides.add_slide(content_layout)
    s.shapes.title.text = 'Answer key'
    body = s.placeholders[1].text_frame
    body.text = 'Leaves make food for the plant.'
    for line in ['Roots hold the plant in the soil.', 'Without leaves a plant cannot make its food, so it stops growing and may die.']:
        body.add_paragraph().text = line
    s._element.set('show', '0')  # hidden in the slide show
    notes(s, 'For the teacher only.')

    for slide in list(prs.slides)[:2]:
        fade_in(slide)

    prs.core_properties.title = 'Parts of a Plant'
    prs.core_properties.author = 'Demo teacher'
    prs.save(path)


main(sys.argv[1])
