"""Export the per-tile expression that colours the manifold and orders the tile gallery."""

import numpy as np
import pandas as pd

from pipeline.config import write_json_gz


def gene_axis(source_root):

    """Map gene symbols to their column on the measured gene axis.

    Args:
        source_root (Path): Gene/pathway analysis root holding the resolved axis.

    Returns:
        dict: Gene symbol to axis column index.
    """

    axis = pd.read_parquet(source_root / "gene_axis_resolved.parquet", columns=["axis_index", "gene_symbol"])

    return {symbol: int(index) for symbol, index in zip(axis["gene_symbol"], axis["axis_index"])}


def tile_counts(source_root):

    """Read the per-tile transcript counts in site tile order.

    Args:
        source_root (Path): Gene/pathway analysis root holding the tile counts.

    Returns:
        tuple: Counts and measured masks, both [n_tiles, n_genes], plus per-tile slide ids.
    """

    frame = pd.read_parquet(source_root / "tile_gene_counts.parquet", columns=["slide_id", "count", "measured"])

    # shape: [n_tiles, n_genes]
    counts = np.stack([np.asarray(values, dtype=np.float32) for values in frame["count"]])
    measured = np.stack([np.asarray(values, dtype=bool) for values in frame["measured"]])

    return counts, measured, np.asarray(frame["slide_id"])


def build(counts, measured, slides, axis, symbols, destination):

    """Write one per-tile expression document for every selectable gene.

    Only tiles carrying the transcript are listed, so a tile absent from ``rows`` was measured
    and read zero unless its slide appears in ``unmeasured_slides``.

    Args:
        counts (numpy.ndarray): Per-tile transcript counts [n_tiles, n_genes].
        measured (numpy.ndarray): Whether each tile's panel carries each gene [n_tiles, n_genes].
        slides (numpy.ndarray): Slide identifier per tile [n_tiles].
        axis (dict): Gene symbol to axis column index.
        symbols (set): Gene symbols the site can select.
        destination (Path): Directory receiving the expression documents.

    Returns:
        int: Number of documents written.
    """

    destination.mkdir(parents=True, exist_ok=True)

    for symbol in sorted(symbols):
        column = counts[:, axis[symbol]]
        flags = measured[:, axis[symbol]]
        rows = np.nonzero(column)[0]

        write_json_gz(destination / f"{symbol}.json", {
            "symbol": symbol,
            "n_measured_tiles": int(flags.sum()),
            "unmeasured_slides": sorted({str(slide) for slide, ok in zip(slides, flags) if not ok}),
            "rows": [int(row) for row in rows],
            "values": [float(column[row]) for row in rows],
        })

    return len(symbols)
