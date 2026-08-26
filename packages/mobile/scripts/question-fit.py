#!/usr/bin/env python3
"""Does the quiz card's continue ticket actually fit? Answer it by arithmetic, not by eye.

QuestionPage has no ScrollView on purpose — a scroll view fights the feed's page-turn pan —
so anything that does not fit is simply clipped, and the element that gets clipped is the
last one: the continue ticket. That is a dead end, not a cosmetic issue.

This adds up the post-answer stack against the real card height using the constants that
SHIP (tierFor() is parsed out of QuestionPage.tsx, the paddings out of CardFrame.tsx), so
the check cannot drift from the component the way a hand-maintained copy would. It is
deliberately arithmetic rather than a re-rendered mock: a mock that is subtly wrong gives
false confidence, whereas a sum you can read line by line does not.

  python3 packages/mobile/scripts/question-fit.py
  python3 packages/mobile/scripts/question-fit.py --lang tl
"""
import argparse, json, math, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
MOBILE = os.path.dirname(HERE)
QPAGE = os.path.join(MOBILE, 'src/components/cards/QuestionPage.tsx')
FRAME = os.path.join(MOBILE, 'src/components/cards/CardFrame.tsx')
QUESTIONS = os.path.join(MOBILE, 'src/data/cards-questions.json')

# Mirrors card-preview.py, which mirrors CardFrame/CardPage.
CARD_W, CARD_H = 361, 640


def tiers():
    """Parse the tier ladder out of the component so this cannot go stale."""
    src = open(QPAGE).read()
    body = src[src.index('function tierFor('):src.index('/** How an answer row is printed')]
    out = []
    for cond, obj in re.findall(r'if \((.+?)\) \{\s*return \{(.+?)\};', body, re.S):
        d = {k: float(v) for k, v in re.findall(r'(\w+):\s*([\d.]+)', obj)}
        q = int(re.search(r'qChars <= (\d+)', cond).group(1))
        o = int(re.search(r'optChars <= (\d+)', cond).group(1))
        out.append((q, o, d))
    tail = re.search(r'return \{([^}]+)\};\s*\}\s*$', body.strip())
    out.append((10 ** 6, 10 ** 6, {k: float(v)
                                   for k, v in re.findall(r'(\w+):\s*([\d.]+)', tail.group(1))}))
    return out


def num(src, pattern, default=None):
    m = re.search(pattern, src)
    if m:
        return float(m.group(1))
    if default is None:
        sys.exit(f'could not find {pattern}')
    return default


def geometry():
    f = open(FRAME).read()
    q = open(QPAGE).read()
    content = f[f.index('  content: {'):f.index('  content: {') + 200]
    return {
        'padTop': num(content, r'paddingTop:\s*([\d.]+)'),
        'padBottom': num(content, r'paddingBottom:\s*([\d.]+)'),
        'padH': num(content, r'paddingHorizontal:\s*([\d.]+)'),
        'band': num(f, r'\n\s*height:\s*(34)'),          # the index band
        'ticket': 40.0,   # paddingVertical 7*2 + lineHeight 21 + 5 ledge
        'divider': 12.0 + 2,
        'explMarginTop': num(q, r'explanation: \{\s*marginTop:\s*([\d.]+)'),
        'explLine': num(q, r'explanation: \{[^}]*?lineHeight:\s*([\d.]+)'),
        'explClamp': num(q, r'numberOfLines=\{(\d+)\}\s*ellipsizeMode', 5),
        'optPadTop': 12.0,
    }


def wrapped_lines(text, font_px, width_px):
    """Rough but consistent: a Zilla Slab glyph averages ~0.5em wide."""
    per_line = max(1, int(width_px / (font_px * 0.5)))
    return max(1, math.ceil(len(text) / per_line))


def tier_for(qc, oc, ladder):
    for q, o, d in ladder:
        if qc <= q and oc <= o:
            return d
    return ladder[-1][2]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--lang', default='tl', choices=('en', 'tl', 'bis'))
    args = ap.parse_args()

    ladder, g = tiers(), geometry()
    inner_w = CARD_W - 2 * g['padH'] - 12       # keyline inset
    qs = json.load(open(QUESTIONS))['questions']

    def stack(rec, pinned):
        opts = [(o.get(args.lang) or '') for o in rec['o']]
        qt = rec['q'].get(args.lang) or ''
        t = tier_for(len(qt), max((len(o) for o in opts), default=0), ladder)
        rows = sum(max(t['row'], wrapped_lines(o, t['opt'], inner_w - 46) * t['optLine'] + 12)
                   for o in opts)
        h = (g['padTop'] + g['band'] + 6
             + wrapped_lines(qt, t['q'], inner_w) * t['qLine']
             + g['optPadTop'] + rows + t['gap'] * (len(opts) - 1)
             + g['divider']
             + g['explMarginTop']
             + min(g['explClamp'], wrapped_lines(rec['e'].get(args.lang) or '', 14.5, inner_w))
               * g['explLine']
             + 12 + g['ticket'] + g['padBottom'])
        # `marginTop: 'auto'` on the options block absorbs ALL remaining slack before the
        # rows, so everything appended after them is pushed out by its own height — the
        # overflow does not depend on how long the content is, which is why the ticket was
        # gone every time rather than only on long cards.
        if pinned:
            h += g['divider'] + g['explMarginTop'] + g['ticket'] + 12
        return h

    for label, pinned in (('BEFORE (options pinned to the bottom)', True),
                          ('AFTER  (pin released on reveal)', False)):
        over = [stack(r, pinned) - CARD_H for r in qs]
        bad = sum(1 for x in over if x > 0)
        over.sort()
        print(f'{label}')
        print(f'  cards whose stack exceeds the {CARD_H}px card: {bad:,}/{len(qs):,} '
              f'({bad / len(qs) * 100:.1f}%)')
        print(f'  overflow px  p50 {over[len(over)//2]:+.0f}  p95 {over[int(len(over)*.95)]:+.0f} '
              f'  worst {over[-1]:+.0f}\n')

    print(f'ticket height {g["ticket"]:.0f}px — any overflow at all puts it out of reach,')
    print(f'which is why this is a dead end and not a cosmetic clip.')


if __name__ == '__main__':
    main()
