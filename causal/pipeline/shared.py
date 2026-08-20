"""Merge the published tile and activation payloads into one deduplicated causal bundle."""

import gzip
import hashlib
import json
from collections import defaultdict
from pathlib import Path

import numpy as np

from pipeline.config import GENE_TILES, TILE_ROOT, compact_json, load_json

SHARED_SCHEMA = 1
TILE_FIELDS = ("sequence_id", "slide_id", "source_h5_row", "tissue", "split", "gene_patch", "gene_cells")
ACTIVATION_FIELDS = ("activity", "patches", "max_patch", "mean_patch", "n_firing", "peak_to_mean")


def source_payloads(interp_root):

    """Read every published shared payload from the pathway explorer.

    Args:
        interp_root (Path): Root of the pathway explorer site.

    Returns:
        list: Parsed shared payloads in collection order.
    """

    payloads = []

    for directory in sorted((interp_root / "data").glob("*/index.json")):
        collection = directory.parent
        for path in sorted(collection.glob("shared-*.json.gz")):
            payloads.append(json.loads(gzip.decompress(path.read_bytes())))

    return payloads


def tile_rows(interp_root):

    """Map tile sequence identifiers to their row in the global tile table.

    Args:
        interp_root (Path): Root of the pathway explorer site.

    Returns:
        dict: Sequence identifier to global tile row.
    """

    table = load_json(interp_root / "data" / "manifold" / "tiles.json")

    return {sequence: row for row, sequence in enumerate(table["tile_id"])}


def candidates(interp_root, features):

    """Pool every published tile a feature fires on, keeping one record per pair.

    Args:
        interp_root (Path): Root of the pathway explorer site.
        features (set): Block global indices the site publishes.

    Returns:
        dict: Block global index to its ``(tile, activation)`` pairs.
    """

    seen = set()
    pooled = defaultdict(list)

    for payload in source_payloads(interp_root):
        for source in payload["activations"]:
            feature = int(source["block"])
            tile = payload["tiles"][source["tile"]]

            if feature not in features or (feature, tile["sequence_id"]) in seen:
                continue

            seen.add((feature, tile["sequence_id"]))
            pooled[feature].append((tile, source))

    return pooled


def expressed(rows, tile_row, symbols, counts, axis, scan_slide):

    """Pick the pooled tiles each showcased gene is most expressed on.

    Each gene reserves its strongest tiles overall and again among the scored slide alone, so a
    gallery keeps a foothold on the slide every causal number was measured on.

    Args:
        rows (list): One feature's ``(tile, activation)`` pairs.
        tile_row (dict): Sequence identifier to global tile row.
        symbols (list): Gene symbols the feature's gallery can be ordered by.
        counts (numpy.ndarray): Per-tile transcript counts [n_tiles, n_genes].
        axis (dict): Gene symbol to axis column index.
        scan_slide (str): Slide every causal number is measured on.

    Returns:
        set: Indices into ``rows`` that carry one of the genes.
    """

    # shape: [n_pooled]
    pooled = np.array([tile_row[tile["sequence_id"]] for tile, _ in rows])
    # shape: [n_pooled]
    scored = np.array([tile["slide_id"] == scan_slide for tile, _ in rows])
    picked = set()

    for symbol in symbols:
        # shape: [n_pooled]
        column = counts[pooled, axis[symbol]]
        carrying = np.nonzero(column > 0)[0]
        on_slide = carrying[scored[carrying]]

        picked.update(int(at) for at in carrying[np.argsort(-column[carrying])][:GENE_TILES])
        picked.update(int(at) for at in on_slide[np.argsort(-column[on_slide])][:GENE_TILES])

    return picked


def gallery(pooled, scan_slide, showcased, tile_row, counts, axis):

    """Keep the tiles each feature's gallery can actually show.

    The gallery is read for one gene at a time and never shows a tile carrying none of it, so
    ranking by feature activity only ships tiles that can never be drawn; every kept tile is one
    a showcased gene is expressed on.

    Args:
        pooled (dict): Block global index to its ``(tile, activation)`` pairs.
        scan_slide (str): Slide every causal number is measured on.
        showcased (dict): Block global index to the gene symbols its gallery can show.
        tile_row (dict): Sequence identifier to global tile row.
        counts (numpy.ndarray): Per-tile transcript counts [n_tiles, n_genes].
        axis (dict): Gene symbol to axis column index.

    Returns:
        dict: Block global index to kept pairs in descending activation order.
    """

    capped = {}

    for feature, rows in pooled.items():
        keep = expressed(rows, tile_row, showcased[feature], counts, axis, scan_slide)
        capped[feature] = [rows[at] for at in sorted(keep, key=lambda at: -rows[at][1]["activity"])]

    return capped


def pool(interp_root, features, encoded):

    """Pool the published tiles with the ones encoded to carry the carded genes.

    Args:
        interp_root (Path): Root of the pathway explorer site.
        features (set): Block global indices the site publishes.
        encoded (dict): Block global index to freshly encoded ``(tile, activation)`` pairs.

    Returns:
        dict: Block global index to every candidate ``(tile, activation)`` pair.
    """

    pooled = candidates(interp_root, features)

    for feature, pairs in encoded.items():
        seen = {tile["sequence_id"] for tile, _ in pooled[feature]}
        pooled[feature].extend((tile, source) for tile, source in pairs if tile["sequence_id"] not in seen)

    return pooled


def build(interp_root, features, genes, scan_slide, showcased, counts, axis, encoded):

    """Collect the tiles and activations the causal explorer needs.

    Args:
        interp_root (Path): Root of the pathway explorer site.
        features (set): Block global indices the site publishes.
        genes (set): Gene symbols the causal scan ranks.
        scan_slide (str): Slide every causal number is measured on.
        showcased (dict): Block global index to the gene symbols its gallery can show.
        counts (numpy.ndarray): Per-tile transcript counts [n_tiles, n_genes].
        axis (dict): Gene symbol to axis column index.
        encoded (dict): Block global index to freshly encoded ``(tile, activation)`` pairs.

    Returns:
        tuple: Shared payload and block global index to ordered tile references.
    """

    rows = tile_rows(interp_root)
    tiles, tile_at = [], {}
    activations = []
    references = {}

    for feature, pairs in gallery(pool(interp_root, features, encoded), scan_slide, showcased, rows, counts, axis).items():
        picked = []

        for origin, source in pairs:
            sequence = origin["sequence_id"]

            if sequence not in tile_at:
                tile_at[sequence] = len(tiles)
                tiles.append(dict({field: origin[field] for field in TILE_FIELDS},
                                  image=f"{TILE_ROOT}/{Path(origin['image']).name}",
                                  row=rows[sequence],
                                  gene_values={symbol: values for symbol, values in origin["gene_values"].items()
                                               if symbol in genes}))

            picked.append({"tile": tile_at[sequence], "activation": len(activations)})
            activations.append(dict({field: source[field] for field in ACTIVATION_FIELDS},
                                    tile=tile_at[sequence], block=feature))

        references[feature] = picked

    return {"schema_version": SHARED_SCHEMA, "tiles": tiles, "activations": activations}, references


def write(data_root, payload):

    """Write the shared payload under a content-addressed name.

    Args:
        data_root (Path): Causal site ``data`` directory.
        payload (dict): Shared payload from ``build``.

    Returns:
        str: File name the gene documents should reference.
    """

    encoded = compact_json(payload).encode()
    name = f"shared-{hashlib.sha256(encoded).hexdigest()}.json.gz"

    for stale in data_root.glob("shared-*.json.gz"):
        stale.unlink()

    (data_root / name).write_bytes(gzip.compress(encoded, 9))

    return name
