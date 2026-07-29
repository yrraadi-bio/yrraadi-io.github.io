"""Pack the real H&E source ROIs into the two atlases the page loads.

Source: PanopTILs (CC0-1.0), 1024x1024 regions at 0.25 microns per pixel from
TCGA invasive breast cancer diagnostic slides. One region per slide, so no two
tiles in the grid atlas come off the same patient.

  he.webp     4x2 of TILE px tiles, drawn into the twenty sections in the grid
  he-lg.webp  one larger tile, for the single slide held up at the end

Run from this directory with the decoded PNGs in SRC:
  ./venv/bin/python he.py
"""

import os
from PIL import Image, ImageEnhance

SRC = '/tmp/he'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')

# the eight cleanest of the twelve pulled: the rest are mostly adipose or carry
# a scanner artefact across one corner
PICK = ['t0', 't40', 't90', 't150', 't210', 't350', 't430', 't510']
LARGE = 't90'

TILE = 320
COLS = 4
INSET = 64          # trims the ROI border, where edge artefacts sit
LG = 896


# Every tile is brought to the same mean luminance rather than knocked down by
# a fixed amount. Slides vary enormously in how heavily they were stained, and
# on a near-black page the pale ones read as a lightbox while the dense ones
# read as tissue; matching them is what makes twenty of these sit together.
TARGET = 86


def prep(name, size):
    im = Image.open(os.path.join(SRC, name + '.png')).convert('RGB')
    w, h = im.size
    im = im.crop((INSET, INSET, w - INSET, h - INSET))
    im = im.resize((size, size), Image.LANCZOS)

    mean = sum(im.convert('L').getdata()) / (size * size)
    im = ImageEnhance.Brightness(im).enhance(min(1.0, TARGET / mean))
    # saturation back up as luminance comes down, so they stay recognisably
    # H&E instead of turning into grey tissue
    im = ImageEnhance.Color(im).enhance(1.24)
    return ImageEnhance.Contrast(im).enhance(1.08)


def main():
    rows = (len(PICK) + COLS - 1) // COLS
    sheet = Image.new('RGB', (TILE * COLS, TILE * rows))
    for i, name in enumerate(PICK):
        sheet.paste(prep(name, TILE), ((i % COLS) * TILE, (i // COLS) * TILE))
    sheet.save(os.path.join(OUT, 'he.webp'), quality=82, method=6)

    prep(LARGE, LG).save(os.path.join(OUT, 'he-lg.webp'), quality=84, method=6)

    for f in ('he.webp', 'he-lg.webp'):
        p = os.path.join(OUT, f)
        print(f, Image.open(p).size, os.path.getsize(p) // 1024, 'KB')


if __name__ == '__main__':
    main()
