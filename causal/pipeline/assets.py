"""Copy the manifold and tile assets the site reads into its own tree so it deploys alone."""

import gzip
from pathlib import Path

import mozjpeg_lossless_optimization

from pipeline.config import manifold_key, write_atomic

MANIFOLD_INDEXES = ("blocks.json", "tiles.json", "block_manifolds_index.json")


def compress(source, destination):

    """Copy one JSON file through gzip, leaving its decoded bytes untouched.

    Args:
        source (Path): JSON file to read.
        destination (Path): Destination path; the file lands at ``destination`` plus ``.gz``.

    Returns:
        int: Bytes written.
    """

    payload = gzip.compress(source.read_bytes(), 9)
    write_atomic(destination.with_name(destination.name + ".gz"), payload)

    return len(payload)


def manifolds(interp_root, features, destination):

    """Copy the tile manifolds and their indexes for the features the site publishes.

    Args:
        interp_root (Path): Root of the pathway explorer holding the published manifolds.
        features (dict): Block global index to feature identity fields.
        destination (Path): Causal ``data/manifold`` directory.

    Returns:
        tuple: Number of files written and their total size in bytes.
    """

    source = interp_root / "data" / "manifold"
    (destination / "block_manifolds").mkdir(parents=True, exist_ok=True)
    written = 0

    for name in MANIFOLD_INDEXES:
        written += compress(source / name, destination / name)

    for identity in features.values():
        key = manifold_key(identity)
        written += compress(source / "block_manifolds" / f"{key}.json",
                            destination / "block_manifolds" / f"{key}.json")

    return len(features) + len(MANIFOLD_INDEXES), written


def tiles(interp_root, payload, destination):

    """Rebuild every tile image the shared payload references, losslessly.

    Optimisation rewrites Huffman tables and rescans the file progressively without touching a
    DCT coefficient, so every decoded pixel is unchanged. Tiles the pathway explorer published
    are taken from there; the rest were already laid down by the encoding stage.

    Args:
        interp_root (Path): Root of the pathway explorer holding the published tiles.
        payload (dict): Shared payload from ``shared.build``.
        destination (Path): Causal ``tiles`` directory.

    Returns:
        tuple: Number of images written, their size in bytes, and their original size in bytes.
    """

    destination.mkdir(parents=True, exist_ok=True)
    names = {Path(tile["image"]).name for tile in payload["tiles"]}
    written = original = 0

    for name in sorted(names):
        published = interp_root / "tiles" / name
        source = (published if published.is_file() else destination / name).read_bytes()
        optimised = mozjpeg_lossless_optimization.optimize(source)
        write_atomic(destination / name, optimised)
        written += len(optimised)
        original += len(source)

    return len(names), written, original
