"""Merge the published tile and activation payloads into one deduplicated causal bundle."""

import gzip
import hashlib
import json
from collections import defaultdict
from pathlib import Path

from pipeline.config import TILE_ROOT, compact_json, load_json

SHARED_SCHEMA = 1
TILE_FIELDS = ("sequence_id", "slide_id", "source_h5_row", "tissue", "split", "gene_patch", "gene_cells")
ACTIVATION_FIELDS = ("activity", "patches", "max_patch", "mean_patch", "n_firing", "peak_to_mean")

TILES_PER_FEATURE = 24
SCAN_SLIDE_QUOTA = 12


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


def gallery(pooled, scan_slide):

    """Cap each feature's gallery, holding room for the slide the edits were scored on.

    Args:
        pooled (dict): Block global index to its ``(tile, activation)`` pairs.
        scan_slide (str): Slide every causal number is measured on.

    Returns:
        dict: Block global index to capped pairs in descending activation order.
    """

    capped = {}

    for feature, rows in pooled.items():
        order = sorted(range(len(rows)), key=lambda at: -rows[at][1]["activity"])
        reserved = [at for at in order if rows[at][0]["slide_id"] == scan_slide][:SCAN_SLIDE_QUOTA]
        held = set(reserved)
        keep = list(reserved)

        for at in order:
            if len(keep) >= TILES_PER_FEATURE:
                break
            if at not in held:
                keep.append(at)

        capped[feature] = [rows[at] for at in sorted(keep, key=lambda at: -rows[at][1]["activity"])]

    return capped


def build(interp_root, features, genes, scan_slide):

    """Collect the tiles and activations the causal explorer needs.

    Args:
        interp_root (Path): Root of the pathway explorer site.
        features (set): Block global indices the site publishes.
        genes (set): Gene symbols the causal scan ranks.
        scan_slide (str): Slide every causal number is measured on.

    Returns:
        tuple: Shared payload and block global index to ordered tile references.
    """

    rows = tile_rows(interp_root)
    tiles, tile_at = [], {}
    activations = []
    references = {}

    for feature, pairs in gallery(candidates(interp_root, features), scan_slide).items():
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
