#!/usr/bin/env python3
"""Render card layouts to a PNG contact sheet, for judging type without an APK build.

Reads the SHIPPED constants out of CardPage.tsx rather than restating them, so the sheet
cannot drift from the app: change the ramp and re-run, and the preview changes with it.
Uses the real fonts and the real card geometry, and picks real cards out of the pool at each
length, because the whole question a design pass has to answer is what the longest and
shortest actual content look like — not what lorem ipsum does.

Text-only cards are the default subject: they are the layout with the most freedom (no
illustration to anchor them) and the one most likely to look broken at an unlucky length.

  python3 packages/mobile/scripts/card-preview.py
  python3 packages/mobile/scripts/card-preview.py --lang bis --out /tmp/sheet.png

Needs Google Chrome for the rasterisation step; without it the HTML is still written and can
be opened directly.
"""
import argparse, base64, json, math, os, random, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
MOBILE = os.path.dirname(HERE)
ROOT = os.path.dirname(os.path.dirname(MOBILE))
POOL = os.path.join(MOBILE, 'src/generated/cardsPool.generated.json')
CARDPAGE = os.path.join(MOBILE, 'src/components/cards/CardPage.tsx')
POSTER = os.path.join(MOBILE, 'src/components/cards/posterLayout.ts')
FONTS = os.path.join(MOBILE, 'assets/fonts')
CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

# card geometry, mirroring CardFrame/CardPage
CARD_W, CARD_H = 361, 640
PLATE_W, PLATE_H = 291.0, 468.0     # the type plate's inner box at that card size


def constants():
    """Every tunable, read from the source that ships so the sheet cannot drift from it."""
    out = {}
    for path, keys in ((CARDPAGE, ('FILL', 'GLYPH', 'LINE_RATIO', 'MAX_SIZE', 'MIN_SIZE')),
                       (POSTER, ('NUMERAL_MAX_CHARS', 'NUMERAL_MAX_WORDS', 'LEAD_MAX_CHARS',
                                 'LEAD_MAX_POSITION'))):
        src = open(path).read()
        for k in keys:
            m = re.search(rf'const {k} = ([\d.]+);', src)
            if not m:
                sys.exit(f'could not find `const {k}` in {os.path.basename(path)}')
            out[k] = float(m.group(1))
    return out


def poster_for(text, spans, C):
    """Mirror of posterFor() in posterLayout.ts."""
    term = (spans or [None])[0]
    if not term:
        return ('plain', '', '', text)
    i = text.find(term)
    if i < 0:
        return ('plain', '', '', text)
    before, after = text[:i], text[i + len(term):]
    numeral = (re.search(r'\d', term) and len(term) <= C['NUMERAL_MAX_CHARS']
               and len(term.split()) <= C['NUMERAL_MAX_WORDS'])
    lead = len(term) <= C['LEAD_MAX_CHARS'] and i / max(len(text), 1) < C['LEAD_MAX_POSITION']
    if not numeral and not lead:
        return ('inline', before, term, after)
    tail = after.strip()
    if 0 < len(tail) <= 2 and not re.search(r'\w', tail):
        term, after = term + tail, ''
    return ('numeral' if numeral else 'lead', before, term, after)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--lang', default='tl', choices=('tl', 'en', 'bis'))
    ap.add_argument('--out', default='/tmp/card-preview.png')
    ap.add_argument('--seed', type=int, default=7)
    a = ap.parse_args()
    C = constants()

    def allowance(kind, before, term, after, is_qa):
        """Mirror of layoutAllowance() — the stacked blocks cost height the flow model misses."""
        per = PLATE_W / (C['GLYPH'] * C['MAX_SIZE'])
        lines = 0.0
        if kind in ('lead', 'numeral'):
            scale = 1.9 if kind == 'numeral' else 1.5
            lines += (scale - 1) * max(1, math.ceil(len(term) / max(per, 1)))
            if before.strip():
                lines += 0.5
            if after.strip():
                lines += 0.5
        if is_qa:
            lines += 1.2
        return lines * per

    def fit(n, extra=0.0):
        raw = math.sqrt(C['FILL'] * PLATE_H * PLATE_W / (max(n + extra, 1) * C['GLYPH'] * C['LINE_RATIO']))
        return round(min(C['MAX_SIZE'], max(C['MIN_SIZE'], raw)), 1)

    cards = [c for c in json.load(open(POOL))['cards'] if not c.get('slug')]
    txt = lambda c: c['fact'].get(a.lang) or ''
    random.seed(a.seed)

    def sample(lo, hi, qa):
        pool = [c for c in cards if lo <= len(txt(c)) <= hi and (('\n\n' in txt(c)) == qa)]
        return random.choice(pool) if pool else None

    lens = sorted(len(txt(c)) for c in cards)
    p = lambda q: lens[int(len(lens) * q)]
    wanted = [('shortest', lens[0], p(0.02), False), ('p25', p(0.25), p(0.3), False),
              ('median', p(0.48), p(0.52), False), ('p90', p(0.88), p(0.92), False),
              ('longest', p(0.985), lens[-1], False),
              ('Q&A median', p(0.45), p(0.6), True), ('Q&A long', p(0.9), lens[-1], True)]
    picked = [(lab, sample(lo, hi, qa)) for lab, lo, hi, qa in wanted]
    picked = [(lab, c) for lab, c in picked if c]

    fonts = {}
    for name, f in (('ZillaSlab', 'ZillaSlab-Regular.ttf'), ('ZillaSlabBold', 'ZillaSlab-Bold.ttf'),
                    ('AlfaSlabOne', 'AlfaSlabOne-Regular.ttf'), ('PatuaOne', 'PatuaOne-Regular.ttf'),
                    ('ArchivoBlack', 'ArchivoBlack-Regular.ttf')):
        fonts[name] = base64.b64encode(open(os.path.join(FONTS, f), 'rb').read()).decode()

    esc = lambda s: s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')

    def card_html(label, c):
        t = txt(c)
        title = (c.get('title') or {}).get(a.lang) or c.get('topic') or ''
        is_qa = '\n\n' in t
        seg = t.split('\n\n', 1)[1] if is_qa else t
        k0, b0, term0, a0 = poster_for(seg, (c.get('emphasis') or {}).get(a.lang), C)
        fs = fit(len(t), allowance(k0, b0, term0, a0, is_qa))
        lh = round(fs * C['LINE_RATIO'], 1)
        def block(seg):
            kind, before, term, after = poster_for(seg, (c.get('emphasis') or {}).get(a.lang), C)
            if kind == 'plain':
                return f'<div class="fact" style="font-size:{fs}px;line-height:{lh}px">{esc(seg)}</div>'
            if kind == 'inline':
                return (f'<div class="fact" style="font-size:{fs}px;line-height:{lh}px">'
                        f'{esc(before)}<span class="em">{esc(term)}</span>{esc(after)}</div>')
            big = round(fs * (1.9 if kind == 'numeral' else 1.5), 1)
            pre = (f'<div class="fact preLead" style="font-size:{fs}px;line-height:{lh}px">'
                   f'{esc(before.strip())}</div>') if before.strip() else ''
            post = (f'<div class="fact" style="font-size:{fs}px;line-height:{lh}px">'
                    f'{esc(after.lstrip())}</div>') if after.strip() else ''
            return (pre + f'<div class="{kind}" style="font-size:{big}px;'
                    f'line-height:{round(big*1.08,1)}px">{esc(term)}</div>' + post)

        if '\n\n' in t:
            ask, body = t.split('\n\n', 1)
            core = (f'<div class="ask" style="font-size:{round(fs*1.06,1)}px;'
                    f'line-height:{round(fs*1.38,1)}px">{esc(ask)}</div><div class="rule"></div>'
                    + block(body))
        else:
            core = block(t)
        cpl = int(PLATE_W / (C['GLYPH'] * fs))
        return (f'<figure><figcaption>{esc(label)} &middot; {len(t)}ch &middot; {fs}px &middot; '
                f'~{cpl} ch/line</figcaption><div class="board"><div class="card">'
                f'<div class="keyline"></div><div class="hole hl"></div><div class="hole hr"></div>'
                f'<div class="content"><div class="band"><span class="stamp"></span>'
                f'<span class="bandtxt">{esc(title)}</span></div>'
                f'<div class="typeplate"><div class="typeinner">{core}</div></div>'
                f'<div class="foot"><div class="ticket"><span class="key">&rsaquo;</span>'
                f'<span class="tickettxt">{esc((c.get("topic") or "")[:32])}</span></div></div>'
                f'</div></div></div></figure>')

    face = ''.join(f"@font-face{{font-family:'{n}';src:url(data:font/ttf;base64,{b}) "
                   f"format('truetype');}}" for n, b in fonts.items())
    html = f'''<!doctype html><meta charset="utf-8"><style>{face}
*{{box-sizing:border-box;margin:0;padding:0}}
body{{background:#141f1b;padding:26px;font-family:'ArchivoBlack';display:flex;flex-wrap:wrap;gap:22px}}
figcaption{{color:#8C9E6E;font-size:11px;letter-spacing:1.2px;text-transform:uppercase;margin-bottom:7px}}
.board{{width:{CARD_W}px;height:{CARD_H}px;background:#20342C;border-radius:20px;position:relative}}
.card{{position:absolute;inset:0;background:#F4EAD5;border:3px solid #1C3B2E;border-radius:18px;overflow:hidden}}
.keyline{{position:absolute;left:6px;top:6px;right:6px;bottom:6px;border:2px solid #1C3B2E;border-radius:12px}}
.hole{{position:absolute;top:5px;width:13px;height:13px;border-radius:7px;background:#20342C}}
.hl{{left:33%}} .hr{{left:63%}}
.content{{position:absolute;inset:0;padding:24px 13px 14px;display:flex;flex-direction:column}}
.band{{height:34px;border-radius:8px;background:#E7B08B;border:3px solid #1C3B2E;display:flex;align-items:center;gap:8px;padding:0 5px}}
.stamp{{width:24px;height:24px;border-radius:12px;background:#F4EAD5;border:2px solid #1C3B2E;flex:none}}
.bandtxt{{font-family:'PatuaOne';font-size:11.5px;color:#1C3B2E;letter-spacing:.3px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}}
.typeplate{{flex:1;margin-top:10px;background:#E7B08B;border:3px solid #1C3B2E;border-radius:7px;padding:6px;display:flex}}
.typeinner{{flex:1;background:#F4EAD5;border-radius:2px;display:flex;flex-direction:column;justify-content:center;padding:12px 8px}}
.ask{{font-family:'ZillaSlabBold';color:#1C3B2E;letter-spacing:-.1px}}
.fact{{font-family:'ZillaSlab';color:#1C3B2E}}
.preLead{{opacity:.66}}
.em{{font-family:'ZillaSlabBold';color:#7A2E22}}
.lead{{font-family:'ZillaSlabBold';color:#7A2E22;letter-spacing:-.6px;margin:3px 0}}
.numeral{{font-family:'AlfaSlabOne';color:#7A2E22;letter-spacing:-1px;margin:4px 0}}
.rule{{height:3px;background:#1C3B2E;border-radius:2px;margin:10px 0;width:52%}}
.foot{{margin-top:12px}}
.ticket{{min-height:48px;background:#D8A03A;border:3px solid #1C3B2E;border-radius:11px;display:flex;align-items:center;gap:9px;padding:6px 10px}}
.key{{width:26px;height:26px;border-radius:6px;background:#F4EAD5;display:flex;align-items:center;justify-content:center;font-family:'AlfaSlabOne';font-size:13px;color:#1C3B2E;flex:none}}
.tickettxt{{font-family:'ZillaSlabBold';font-size:17px;line-height:20px;color:#F4EAD5}}
</style>{''.join(card_html(l, c) for l, c in picked)}'''

    page = os.path.splitext(a.out)[0] + '.html'
    open(page, 'w').write(html)
    for lab, c in picked:
        print(f'  {lab:12s} {len(txt(c)):>4}ch -> {fit(len(txt(c)))}px')
    print(f'  wrote {page}')

    if not os.path.exists(CHROME):
        print('  (Chrome not found — open the HTML directly)')
        return
    cols = min(len(picked), 4)
    rows = math.ceil(len(picked) / cols)
    subprocess.run([CHROME, '--headless', '--disable-gpu', f'--screenshot={a.out}',
                    f'--window-size={cols*(CARD_W+24)+40},{rows*(CARD_H+50)+40}',
                    '--hide-scrollbars', '--default-background-color=141f1b',
                    f'file://{page}'], capture_output=True)
    print(f'  wrote {a.out}')


if __name__ == '__main__':
    main()
