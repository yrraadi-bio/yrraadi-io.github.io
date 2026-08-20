"""Define shared configuration, paths, and JSON utilities for the causal explorer build."""

import gzip
import json
import os
from pathlib import Path

BLOCKS_PER_DICTIONARY = 512
TOKENS_PER_TILE = 196
PATCH_GRID = 14

GIGAPATH_LAYERS = (0, 1, 13, 18, 23, 29, 38, 39)

MIN_EFFECT = 0.01
CARDS_PER_TARGET = 8

DEFAULT_RANKINGS = "/home/viraj/origin-2.0/bsf/out/gene_causal_all_strict_ckpt4/discovery_report/per_gene_rankings.parquet"
DEFAULT_INTERP = "/home/viraj/yrraadi-io.github.io/interp"
DEFAULT_SOURCE = "/home/viraj/origin-2.0/runs_bsf/prov_gigapath/xenium_16k_gs16_topk96/gene_pathway_feature_extraction"
DEFAULT_OUT = "/home/viraj/yrraadi-io.github.io/causal"

TILE_ROOT = "tiles"

LABEL = "Prov-GigaPath ViT-G \u00b7 top-96 width-16 dictionaries"
ENCODER_NOTE = "96 of 512 blocks are active at every patch"
PROTOCOL = "single_block_raw_subpatch_pregate"
EXPRESSION_DOMAIN = "expm1_log1p_normalized_counts"


def layer_ordinal(layer):

    """Return the dictionary position of one encoder layer.

    Args:
        layer (int): Prov-GigaPath transformer layer.

    Returns:
        int: Index of the layer within ``GIGAPATH_LAYERS``.
    """

    return GIGAPATH_LAYERS.index(int(layer))


def global_index(layer, block):

    """Return the site's flat feature identifier.

    Args:
        layer (int): Prov-GigaPath transformer layer.
        block (int): Dictionary block in ``[0, 511]``.

    Returns:
        int: Block global index used across the site.
    """

    return layer_ordinal(layer) * BLOCKS_PER_DICTIONARY + int(block)


def load_json(path):

    """Read one JSON document.

    Args:
        path (Path): JSON file to read.

    Returns:
        object: Parsed JSON value.
    """

    return json.loads(Path(path).read_text())


def write_atomic(path, payload):

    """Replace a file atomically.

    Args:
        path (Path): Destination file.
        payload (str or bytes): Contents to write.

    Returns:
        None
    """

    scratch = path.with_name(path.name + ".partial")
    scratch.write_bytes(payload.encode() if isinstance(payload, str) else payload)
    os.replace(scratch, path)


def compact(payload):

    """Collapse integral floats without changing JSON values.

    Args:
        payload (object): JSON-serializable value.

    Returns:
        object: Value with integral floats replaced by integers.
    """

    if isinstance(payload, float): return int(payload) if payload == int(payload) else payload
    if isinstance(payload, dict): return {key: compact(value) for key, value in payload.items()}
    if isinstance(payload, list): return [compact(value) for value in payload]

    return payload


def compact_json(payload, sort_keys=False):

    """Encode one document as strict compact JSON.

    Args:
        payload (object): JSON-serializable document.
        sort_keys (bool): Whether to sort dictionary keys.

    Returns:
        str: Compact encoded document.
    """

    return json.dumps(compact(payload), separators=(",", ":"), allow_nan=False, sort_keys=sort_keys)


def write_json(path, payload, sort_keys=False):

    """Write one strict compact JSON document atomically.

    Args:
        path (Path): Destination JSON file.
        payload (object): JSON-serializable document.
        sort_keys (bool): Whether to sort dictionary keys.

    Returns:
        None
    """

    write_atomic(path, compact_json(payload, sort_keys=sort_keys))


def write_json_gz(path, payload, sort_keys=False):

    """Write one strict compact JSON document atomically, gzipped.

    Bulk assets no one reads by hand are stored compressed, so ``path`` names the JSON the
    runtime asks for and the bytes land at ``path`` plus ``.gz``.

    Args:
        path (Path): Logical JSON path; the file is written at ``path`` plus ``.gz``.
        payload (object): JSON-serializable document.
        sort_keys (bool): Whether to sort dictionary keys.

    Returns:
        None
    """

    write_atomic(path.with_name(path.name + ".gz"), gzip.compress(compact_json(payload, sort_keys=sort_keys).encode(), 9))


def manifold_key(identity):

    """Build the file stem a feature's tile manifold is stored under.

    Args:
        identity (dict): Feature identity carrying ``dictionary`` and ``block``.

    Returns:
        str: Manifold file stem.
    """

    layer, group = identity["dictionary"].split(" ")

    return f"{layer}_{group}_b{identity['block']}"
