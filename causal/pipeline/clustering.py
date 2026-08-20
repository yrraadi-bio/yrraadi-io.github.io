"""Score how tightly each gene clusters on each feature's manifold with Moran's I."""

import numpy as np
from scipy.sparse import csr_matrix
from scipy.spatial import cKDTree

from pipeline.config import load_json, manifold_key

NEIGHBOURS = 15
MIN_TILES = 20


def neighbour_weights(points):

    """Build row-standardised weights over each tile's nearest manifold neighbours.

    Args:
        points (numpy.ndarray): Manifold coordinates [n_tiles, 3].

    Returns:
        scipy.sparse.csr_matrix: Row-standardised weights [n_tiles, n_tiles].
    """

    count = len(points)
    k = min(NEIGHBOURS, count - 1)
    neighbours = cKDTree(points).query(points, k=k + 1)[1][:, 1:]

    rows = np.repeat(np.arange(count), k)
    values = np.full(count * k, 1.0 / k)

    return csr_matrix((values, (rows, neighbours.ravel())), shape=(count, count))


def morans_i(weights, values):

    """Compute Moran's I for many genes at once over one shared neighbour graph.

    With row-standardised weights the usual ``n / S0`` factor is one, leaving the ratio of
    the spatial cross-product to the total variance.

    Args:
        weights (scipy.sparse.csr_matrix): Row-standardised weights [n_tiles, n_tiles].
        values (numpy.ndarray): Already-centred gene values [n_tiles, n_genes].

    Returns:
        numpy.ndarray: Moran's I per gene [n_genes], NaN where a gene does not vary.
    """

    # shape: [n_tiles, n_genes]
    lag = weights @ values
    variance = np.einsum("ij,ij->j", values, values)

    return np.where(variance > 0, np.einsum("ij,ij->j", values, lag) / np.where(variance > 0, variance, 1), np.nan)


def slide_centred(values, slide_code):

    """Remove each slide's own mean so between-slide offsets cannot read as clustering.

    Args:
        values (numpy.ndarray): Raw gene values [n_tiles, n_genes].
        slide_code (numpy.ndarray): Slide identifier per tile [n_tiles].

    Returns:
        numpy.ndarray: Values centred within each slide [n_tiles, n_genes].
    """

    codes, inverse = np.unique(slide_code, return_inverse=True)
    sums = np.zeros((len(codes), values.shape[1]))
    np.add.at(sums, inverse, values)
    counts = np.bincount(inverse, minlength=len(codes))[:, None]

    return values - (sums / counts)[inverse]


def score(interp_root, features, symbols, counts, axis, slide_code):

    """Score every gene against every feature's manifold.

    Args:
        interp_root (Path): Root of the pathway explorer supplying the manifolds.
        features (dict): Block global index to feature identity fields.
        symbols (list): Gene symbols to score, in output column order.
        counts (numpy.ndarray): Per-tile transcript counts [n_tiles, n_axis_genes].
        axis (dict): Gene symbol to its column in ``counts``.
        slide_code (numpy.ndarray): Slide identifier per tile [n_tiles].

    Returns:
        dict: Block global index to gene symbol to ``(raw, slide_adjusted)`` pairs.
    """

    # shape: [n_tiles, n_symbols]
    panel = counts[:, [axis[symbol] for symbol in symbols]]
    scored = {}

    for index, identity in features.items():
        payload = load_json(interp_root / "data" / "manifold" / "block_manifolds" / f"{manifold_key(identity)}.json")
        rows = np.asarray(payload["tile_rows"])

        # A handful of features fire on too few tiles for a neighbour graph to mean anything.
        if len(rows) < MIN_TILES:
            scored[index] = {symbol: (np.nan, np.nan) for symbol in symbols}
            continue

        weights = neighbour_weights(np.column_stack([payload["x"], payload["y"], payload["z"]]))
        values = panel[rows]

        raw = morans_i(weights, values - values.mean(axis=0))
        adjusted = morans_i(weights, slide_centred(values, slide_code[rows]))

        scored[index] = {symbol: (raw[position], adjusted[position]) for position, symbol in enumerate(symbols)}

    return scored


def entry(scored, index, symbol):

    """Read one gene's clustering pair, rounded for publication.

    Args:
        scored (dict): Output of ``score``.
        index (int): Block global index.
        symbol (str): Gene symbol.

    Returns:
        dict: ``clustering`` and ``clustering_slide_adjusted``, null where undefined.
    """

    raw, adjusted = scored[index][symbol]
    if not np.isfinite(raw):
        return {"clustering": None, "clustering_slide_adjusted": None}

    return {"clustering": round(float(raw), 3),
            "clustering_slide_adjusted": round(float(adjusted), 3) if np.isfinite(adjusted) else None}
