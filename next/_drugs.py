#!/usr/bin/env python3
"""Bake the case-study drug renders into trimmed, transparent, black-and-white WebP.

The sources are public structure renders: RCSB PDB assembly images for the
antibodies, PubChem 2D depictions for the small molecules. Both arrive as artwork
composited onto an opaque canvas, which is wrong for this page twice over. A white
rectangle behind each render reads as a box the page never drew, and the margin the
source pads its canvas with means any frame tight enough to look deliberate crops
the molecule instead of holding it.

So each one is redrawn in black on nothing and trimmed to its own content. A
pre-trimmed transparent render cannot be letterboxed and cannot be cropped: the
layout only has to pick a height.

Build step only, not something the page loads. Needs Pillow.
Run from next/:  ./_drugs.py
"""

import io
import os
import urllib.request

from PIL import Image, ImageChops

OUT = 'drugs'
# they are drawn at about 150px, so this is already generous on a 2x screen
MAX_EDGE = 420
# below this the pixel is indistinguishable from the page and is not worth
# keeping in the bounding box, which would otherwise be the full source canvas
FLOOR = 6

PUBCHEM = ('https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/'
           '{}/PNG?image_size=large')
RCSB = 'https://cdn.rcsb.org/images/structures/{}_assembly-1.jpeg'

# The third number is the gamma the coverage is bent by. A PDB ribbon is mid-tone
# almost everywhere, so inverting it straight leaves a grey ghost and it needs
# pushing; a skeletal drawing is already black lines on a light canvas, so pushing
# it only thickens the anti-aliasing and blurs the bonds. Hence one figure per
# kind rather than one for all four.
RIBBON, LINES = 0.55, 1.0

SOURCES = [
    ('keytruda', RCSB.format('5dk3'), RIBBON),
    ('opdivo', RCSB.format('5ggr'), RIBBON),
    ('cabometyx', PUBCHEM.format('cabozantinib'), LINES),
    ('tecentriq', RCSB.format('5xxy'), RIBBON),
    ('yervoy', RCSB.format('5tru'), RIBBON),
    ('erbitux', RCSB.format('1yy9'), RIBBON),
    ('stivarga', PUBCHEM.format('regorafenib'), LINES),
]


def to_white(img):
    """Normalise the source canvas to true white.

    PubChem draws on (245, 245, 245) rather than white, and keying that against
    white leaves the canvas behind at four percent grey, which is invisible as a
    colour and perfectly visible as a rectangle, because a rectangle is a shape.
    Sampling the corners and scaling up to white first means the key has an exact
    background to remove instead of an assumed one.
    """
    rgb = img.convert('RGB')
    w, h = rgb.size
    px = rgb.load()
    corners = [px[0, 0], px[w - 1, 0], px[0, h - 1], px[w - 1, h - 1]]
    bg = [max(1, min(c[i] for c in corners)) for i in range(3)]
    if bg == [255, 255, 255]:
        return rgb
    return rgb.point([min(255, v * 255 // bg[i]) for i in range(3) for v in range(256)])


def redraw(img, gamma):
    """Redraw the render as black on transparent, weighted by how dark it was.

    Coverage comes from luminance, which is what keeps a ribbon diagram readable
    once its colour is gone: the chains were drawn at different brightnesses, so
    they survive as different greys and the fold can still be followed. Keying on
    saturation instead would flatten every chain to one solid and hand back a
    silhouette.
    """
    a = ImageChops.invert(img.convert('L'))
    if gamma != 1.0:
        a = a.point(lambda v: min(255, int(((v / 255) ** gamma) * 255)))
    out = Image.new('RGBA', img.size, (0, 0, 0, 0))
    out.putalpha(a)
    return out


def main():
    os.makedirs(OUT, exist_ok=True)
    for name, url, gamma in SOURCES:
        raw = urllib.request.urlopen(url, timeout=30).read()
        img = redraw(to_white(Image.open(io.BytesIO(raw))), gamma)

        box = img.getchannel('A').point(lambda v: 255 if v > FLOOR else 0).getbbox()
        if box:
            img = img.crop(box)
        if max(img.size) > MAX_EDGE:
            s = MAX_EDGE / max(img.size)
            img = img.resize(
                (max(1, round(img.width * s)), max(1, round(img.height * s))),
                Image.LANCZOS,
            )

        path = os.path.join(OUT, name + '.webp')
        img.save(path, quality=92, method=6)
        print('%-10s %4dx%-4d %6.1f kB' % (
            name, img.width, img.height, os.path.getsize(path) / 1024))


if __name__ == '__main__':
    main()
