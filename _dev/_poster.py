"""Bake the hero embed's poster frame from a real run's H&E thumbnail and predicted cells.

The poster is what the platform window shows before a visitor activates the live
demo, so it has to be the same picture the canvas paints: the slide, with every
predicted cell coloured by its lineage in the palette the app itself serves.
Nothing here is illustrative — the coordinates and labels are the run's own.

Usage:
    python3 _poster.py [job_dir] [out_dir]
"""

import json
import os
import sys

import numpy as np

from PIL import Image

Image.MAX_IMAGE_PIXELS = None

DEFAULT_JOB_DIR = "/mnt/bigdata/origin_webapp_jobs/17f983f0caf0"

# The lineage palette _CELLTYPE_COLORS serves from webapp/jobs.py, so a poster swatch matches the live canvas
CELLTYPE_COLORS = {
    "Immune": "#1b365d",
    "Epithelial": "#b85a5e",
    "Fibroblast / Stroma": "#6b7c8f",
    "Endothelial": "#6b5b8c",
    "Smooth muscle / Pericyte": "#b8894a",
    "Adipocyte": "#a89060",
    "Proliferating": "#9a5b7a",
    "Unannotated": "#9aa3ad",
}

SUPERSAMPLE = 2
# Cropped to where the cells are, plus a margin. A whole-slide fit spends a third
# of the window on blank glass, and the demo opens on these bounds for the same reason
CROP_MARGIN = 0.025
# A cell is ~30 slide px at this run's 0.364 MPP, which is a 2 px radius once the
# slide is fit to the window, so the stamp is the true size rather than a flattering one
CELL_OPACITY = 0.85
STAMP_RADIUS = 2
STAMP_SIGMA = 1.15
# Only the widths the still is actually served at. It stands in for the frame on
# handhelds, which is the one place the frame is never mounted, so a desktop-sized
# copy would be a megabyte nothing ever asks for
WIDTHS = [960, 640]


def hex_to_rgb(value):

    """Convert a #rrggbb string to a float RGB triple in 0-255.

    Args:
        value (str): Hex colour of the form ``#rrggbb``

    Returns:
        numpy.ndarray: RGB channels [3]
    """

    raw = value.lstrip("#")

    return np.array([int(raw[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.float32)


def stamp_kernel():

    """Build the gaussian weight stamp one cell is splatted through.

    A cell is a fraction of a pixel at whole-slide scale, so it is spread over a
    disc wide enough to survive the downscale to delivery width.

    Returns:
        list: (dy, dx, weight) tuples covering a (2r+1) square, peak weight 1.0
    """

    offsets = range(-STAMP_RADIUS, STAMP_RADIUS + 1)
    stamp = []

    for dy in offsets:
        for dx in offsets:
            weight = float(np.exp(-(dy * dy + dx * dx) / (2.0 * STAMP_SIGMA ** 2)))
            if weight > 0.05:
                stamp.append((dy, dx, weight))

    return stamp


def splat_cells(shape, coords, cell_type, scale):

    """Accumulate per-cell colour and coverage onto a supersampled canvas.

    Args:
        shape (tuple): Target canvas shape (height, width)
        coords (numpy.ndarray): Cell centroids in slide pixel space [n_cells, 2]
        cell_type (numpy.ndarray): Lineage label per cell [n_cells]
        scale (float): Slide pixels to canvas pixels conversion factor

    Returns:
        tuple: (colour [H, W, 3] float32, alpha [H, W] float32)
    """

    height, width = shape
    colour = np.zeros((height, width, 3), dtype=np.float32)
    alpha = np.zeros((height, width), dtype=np.float32)
    kernel = stamp_kernel()

    # One pass per lineage so the colour is a constant and the splat stays vectorised
    for label in np.unique(cell_type):
        rgb = hex_to_rgb(CELLTYPE_COLORS[str(label)])
        picked = coords[cell_type == label]
        xs = np.round(picked[:, 0] * scale).astype(np.int64)
        ys = np.round(picked[:, 1] * scale).astype(np.int64)

        for dy, dx, weight in kernel:
            ry = np.clip(ys + dy, 0, height - 1)
            rx = np.clip(xs + dx, 0, width - 1)
            np.add.at(alpha, (ry, rx), weight)
            for channel in range(3):
                np.add.at(colour[:, :, channel], (ry, rx), rgb[channel] * weight)

    # Normalise to a weighted mean colour, then saturate coverage so dense tissue reads solid
    covered = alpha > 0
    colour[covered] /= alpha[covered][:, None]

    return colour, np.clip(alpha, 0.0, 1.0)


def cell_bounds(coords, scale, canvas):

    """Find the crop box enclosing every cell, expanded by the margin.

    Args:
        coords (numpy.ndarray): Cell centroids in slide pixel space [n_cells, 2]
        scale (float): Slide pixels to canvas pixels conversion factor
        canvas (tuple): Canvas shape (height, width)

    Returns:
        tuple: (left, top, right, bottom) in canvas pixels
    """

    height, width = canvas
    xs = coords[:, 0] * scale
    ys = coords[:, 1] * scale
    pad = max(xs.max() - xs.min(), ys.max() - ys.min()) * CROP_MARGIN

    return (
        int(max(0, xs.min() - pad)),
        int(max(0, ys.min() - pad)),
        int(min(width, xs.max() + pad)),
        int(min(height, ys.max() + pad)),
    )


def slide_width(job_dir):

    """Read the width of the slide a job was run on, in slide pixels.

    Cell coordinates are in that space, so this is the denominator that puts them
    on the thumbnail. Read off the slide the run names rather than carried as a
    constant, which is only ever right for the one job it was measured on.

    Args:
        job_dir (str): Finished job directory holding run.json

    Returns:
        int: Slide width in pixels
    """

    run = json.load(open(os.path.join(job_dir, "run.json")))

    return Image.open(run["params"]["slide_path"]).width


def build(job_dir, out_dir):

    """Render and write the poster at every delivery width.

    Args:
        job_dir (str): Finished job directory holding the thumbnail and overlay arrays
        out_dir (str): Directory the .webp posters are written to
    """

    base = Image.open(os.path.join(job_dir, "thumbnail.png")).convert("RGB")
    coords = np.load(os.path.join(job_dir, "overlay_data.npz"))["coords"]
    cell_type = np.load(os.path.join(job_dir, "cell_labels.npz"), allow_pickle=True)["cell_type"]

    canvas = (base.height * SUPERSAMPLE, base.width * SUPERSAMPLE)
    scale = canvas[1] / slide_width(job_dir)
    colour, alpha = splat_cells(canvas, coords, cell_type, scale)

    # Composite the lineage layer over the slide at the canvas's own default cell opacity
    tissue = np.asarray(base.resize((canvas[1], canvas[0]), Image.LANCZOS), dtype=np.float32)
    mixed = tissue * (1.0 - alpha[:, :, None] * CELL_OPACITY) + colour * (alpha[:, :, None] * CELL_OPACITY)
    rendered = Image.fromarray(np.clip(mixed, 0, 255).astype(np.uint8)).crop(cell_bounds(coords, scale, canvas))

    os.makedirs(out_dir, exist_ok=True)
    print(f"crop {rendered.width}x{rendered.height}  aspect {rendered.width / rendered.height:.3f}")

    for width in WIDTHS:
        height = round(width * rendered.height / rendered.width)
        name = "platform-poster.webp" if width == max(WIDTHS) else f"platform-poster-{width}.webp"
        path = os.path.join(out_dir, name)
        rendered.resize((width, height), Image.LANCZOS).save(path, "WEBP", quality=82, method=6)
        print(f"{path}  {width}x{height}  {os.path.getsize(path) / 1024:.0f} KB")


if __name__ == "__main__":
    job = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_JOB_DIR
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.dirname(os.path.abspath(__file__))
    build(job, out)
