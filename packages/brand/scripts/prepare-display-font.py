"""Create static Fraunces 600 (opsz 9, SOFT 0, WONK 1) from Google Fonts' variable TTF.
Usage: python prepare-display-font.py /path/to/Fraunces-variable.ttf
Requires fonttools and brotli. Keeps the complete character map for multilingual titles.
"""
from pathlib import Path
import sys
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
out=Path(__file__).resolve().parents[1]/'fonts'
f=instantiateVariableFont(TTFont(sys.argv[1]),{'opsz':9,'wght':600,'SOFT':0,'WONK':1},inplace=True)
for n in f['name'].names:
 values={1:'Fraunces SemiBold',2:'Regular',4:'Fraunces SemiBold',6:'Fraunces-SemiBold',16:'Fraunces',17:'SemiBold'}
 if n.nameID in values:n.string=values[n.nameID].encode(n.getEncoding())
f.save(out/'Fraunces-SemiBold.ttf')
f.flavor='woff2';f.save(out/'fraunces-semibold.woff2')
assert all(ord(c) in f.getBestCmap() for c in 'AaZzÑñÁáÉéÍíÓóÚú0123456789“”‘’–—…%°²³')
print('Generated full static display fonts:',len(f.getBestCmap()),'characters')
