#!/usr/bin/env python3
"""Brightness across one row or down one column of a capture.

There is no image library on this machine, so the PNG is unpacked here: inflate
the IDAT stream, then undo the per-scanline filter, which is all a non-interlaced
truecolour file needs. Chrome writes exactly that.

    ./_row.py <png> row <y> [samples]
    ./_row.py <png> col <x> [samples]
"""
import sys
import zlib

PAETH = 4


def load(path):
    data = open(path, 'rb').read()
    assert data[:8] == b'\x89PNG\r\n\x1a\n', 'not a png'
    pos, idat, w, h, depth, colour = 8, [], 0, 0, 0, 0
    while pos < len(data):
        ln = int.from_bytes(data[pos:pos + 4], 'big')
        tag = data[pos + 4:pos + 8]
        body = data[pos + 8:pos + 8 + ln]
        if tag == b'IHDR':
            w = int.from_bytes(body[0:4], 'big')
            h = int.from_bytes(body[4:8], 'big')
            depth, colour = body[8], body[9]
        elif tag == b'IDAT':
            idat.append(body)
        elif tag == b'IEND':
            break
        pos += 12 + ln
    assert depth == 8 and colour in (2, 6), 'expected 8-bit truecolour'
    stride = 3 if colour == 2 else 4
    raw = zlib.decompress(b''.join(idat))
    rowlen = w * stride
    out = bytearray(h * rowlen)
    prev = bytearray(rowlen)
    p = 0
    for y in range(h):
        f = raw[p]
        p += 1
        line = bytearray(raw[p:p + rowlen])
        p += rowlen
        for i in range(rowlen):
            a = line[i - stride] if i >= stride else 0
            b = prev[i]
            c = prev[i - stride] if i >= stride else 0
            if f == 1:
                line[i] = (line[i] + a) & 255
            elif f == 2:
                line[i] = (line[i] + b) & 255
            elif f == 3:
                line[i] = (line[i] + ((a + b) >> 1)) & 255
            elif f == PAETH:
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 255
        out[y * rowlen:(y + 1) * rowlen] = line
        prev = line
    return w, h, stride, out


def lum(px, i):
    return 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]


def main():
    path, axis, at = sys.argv[1], sys.argv[2], int(sys.argv[3])
    n = int(sys.argv[4]) if len(sys.argv) > 4 else 24
    w, h, stride, px = load(path)
    print(f'{path}  {w}x{h}')
    if axis == 'row':
        pts = [(x, lum(px, (at * w + x) * stride)) for x in
               (round(i * (w - 1) / (n - 1)) for i in range(n))]
        label = 'x'
    else:
        pts = [(y, lum(px, (y * w + at) * stride)) for y in
               (round(i * (h - 1) / (n - 1)) for i in range(n))]
        label = 'y'
    for k, v in pts:
        print(f'{label}={k:5d}  L={v:6.1f}  {"#" * int(v / 4)}')


main()
