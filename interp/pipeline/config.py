"""Define shared pipeline configuration, paths, and JSON utilities."""

import json
import os
from pathlib import Path

BLOCKS_PER_DICTIONARY = 512
TOKENS_PER_TILE = 196
PATCH_GRID = 14

GENE_NEIGHBOURS = 10
MIN_GENE_MEASURED_TILES = 500
MIN_GENE_NONZERO_TILES = 40
MIN_GENE_DETECTION = 0.03
MIN_MANIFOLD_TILES = 32

DEFAULT_XENIUM = "/home/viraj/silico-folder/data/spatial_shards_hest_v1/xenium"
DEFAULT_OUT = "/home/viraj/yrraadi-io.github.io/interp"
DEFAULT_BRITE = "/home/viraj/silico-folder/data/kegg_brite/br08901.keg"
DEFAULT_PLAN_NAME = "published_blocks.json"

GIGAPATH_LAYERS = (0, 1, 13, 18, 23, 29, 38, 39)

COLLECTIONS = {
    "kegg": {
        "label": "KEGG",
        "url": "https://www.kegg.jp/pathway/{pathway_id}",
        "name_suffix": " - Homo sapiens (human)",
    },
    "msigdb": {
        "label": "MSigDB Hallmark",
        "url": "https://www.gsea-msigdb.org/gsea/msigdb/human/geneset/{pathway_id}.html",
        "name_suffix": "",
    },
}

MODELS = {
    "origin": {
        "label": "Origin checkpoint-6 (big47) · top-16 dictionaries",
        "encoder": "16 of 512 blocks are active at every patch",
        "root": "/home/viraj/silico-folder/runs_bsf/silico/experiments/_flat/exp_01ky62547mfmmtb1tv91m2hawz/gene_pathway_feature_extraction",
        "run_root": "/home/viraj/silico-folder/runs_bsf/manual_origin_ckpt6/origin_ckpt6/xenium_train46_test12",
        "dictionaries": [(layer, size) for layer in (1, 2, 3, 4) for size in (3, 16)],
        "world_size": 8,
        "layout": "origin",
        "collection": "kegg",
    },
    "gigapath": {
        "label": "Prov-GigaPath ViT-G · top-96 dictionaries",
        "encoder": "96 of 512 blocks are active at every patch",
        "root": "/home/viraj/origin-2.0/runs_bsf/prov_gigapath/xenium_16k_topk96/gene_pathway_feature_extraction",
        "run_root": "/home/viraj/origin-2.0/runs_bsf/prov_gigapath/xenium_16k_topk96",
        "dictionaries": [(layer, 3) for layer in GIGAPATH_LAYERS],
        "world_size": 4,
        "layout": "gigapath",
        "collection": "kegg",
    },
    "gigapath_msigdb": {
        "label": "Prov-GigaPath ViT-G · top-96 dictionaries",
        "encoder": "96 of 512 blocks are active at every patch",
        "root": "/home/viraj/origin-2.0/runs_bsf/prov_gigapath/xenium_16k_topk96/msigdb_hallmark_feature_extraction",
        "run_root": "/home/viraj/origin-2.0/runs_bsf/prov_gigapath/xenium_16k_topk96",
        "dictionaries": [(layer, 3) for layer in GIGAPATH_LAYERS],
        "world_size": 4,
        "layout": "gigapath",
        "collection": "msigdb",
    },
    "gigapath_gs16": {
        "label": "Prov-GigaPath ViT-G · top-96 width-16 dictionaries",
        "encoder": "96 of 512 blocks are active at every patch",
        "root": "/home/viraj/origin-2.0/runs_bsf/prov_gigapath/xenium_16k_gs16_topk96/gene_pathway_feature_extraction",
        "run_root": "/home/viraj/origin-2.0/runs_bsf/prov_gigapath/xenium_16k_gs16_topk96",
        "dictionaries": [(layer, 16) for layer in GIGAPATH_LAYERS],
        "world_size": 4,
        "layout": "gigapath",
        "collection": "kegg",
    },
    "gigapath_gs16_msigdb": {
        "label": "Prov-GigaPath ViT-G · top-96 width-16 dictionaries",
        "encoder": "96 of 512 blocks are active at every patch",
        "root": "/home/viraj/origin-2.0/runs_bsf/prov_gigapath/xenium_16k_gs16_topk96/msigdb_hallmark_feature_extraction",
        "run_root": "/home/viraj/origin-2.0/runs_bsf/prov_gigapath/xenium_16k_gs16_topk96",
        "dictionaries": [(layer, 16) for layer in GIGAPATH_LAYERS],
        "world_size": 4,
        "layout": "gigapath",
        "collection": "msigdb",
    },
}


def model_profile(name):

    """Return one named build profile.

    Args:
        name (str): Key in ``MODELS``.

    Returns:
        dict: Build profile.
    """

    return MODELS[name]


def task_index_of(profile, layer, group_size):

    """Return the canonical task index for one dictionary.

    Args:
        profile (dict): Model profile from ``MODELS``.
        layer (int): Transformer layer.
        group_size (int): Block dimension.

    Returns:
        int: Task index within the profile.
    """

    return profile["dictionaries"].index((int(layer), int(group_size)))


def collection_profile(root, profile):

    """Resolve the collection metadata represented by an analysis root.

    Args:
        root (Path): Gene/pathway analysis output root.
        profile (dict): Model profile from ``MODELS``.

    Returns:
        dict: Collection name, label, URL template, and display-name suffix.
    """

    name = profile["collection"]
    record = root / "pathway_collection.json"

    if record.is_file():
        name = str(load_json(record)["collection"])

    return {"name": name, "label": COLLECTIONS[name]["label"], "url_template": COLLECTIONS[name]["url"],
            "name_suffix": COLLECTIONS[name]["name_suffix"]}


def collection_roots(profile):

    """Find every collection scored against the profile's encoder run.

    Args:
        profile (dict): Model profile from ``MODELS``.

    Returns:
        list: ``(collection name, analysis root Path)`` pairs.
    """

    return sorted((collection_profile(Path(entry["root"]), entry)["name"], Path(entry["root"]))
                  for entry in MODELS.values() if entry["run_root"] == profile["run_root"])


def plan_roots(profile, root):

    """Resolve all plan source roots, honoring the active collection override.

    Args:
        profile (dict): Active model profile.
        root (Path): Active analysis root, possibly overridden by the CLI.

    Returns:
        list: ``(collection name, analysis root Path)`` pairs.
    """

    active = collection_profile(root, profile)["name"]

    return [(name, root if name == active else candidate) for name, candidate in collection_roots(profile)]


def resolve_build_paths(profile, root, run_root, xenium, out):

    """Resolve optional CLI paths against one model profile.

    Args:
        profile (dict): Model profile from ``MODELS``.
        root (str or None): Optional analysis root override.
        run_root (str or None): Optional encoder run override.
        xenium (str): Xenium shard root.
        out (str): Site output root.

    Returns:
        dict: Paths named root, run_root, xenium, out, and data.
    """

    out_path = Path(out)

    return {
        "root": Path(root if root else profile["root"]),
        "run_root": Path(run_root if run_root else profile["run_root"]),
        "xenium": Path(xenium),
        "out": out_path,
        "data": out_path / "data",
    }


def load_json(path):

    """Read one JSON document.

    Args:
        path (Path): JSON file to read.

    Returns:
        object: Parsed JSON value.
    """

    return json.loads(path.read_text())


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


def bundle_dirs(data_root):

    """List collection bundle directories under a site data root.

    Args:
        data_root (Path): Site ``data`` directory.

    Returns:
        list: Bundle directories in name order.
    """

    return sorted(path.parent for path in data_root.glob("*/index.json") if (path.parent / "tiles.json").is_file())


def write_collection_manifest(data_root):

    """Refresh the manifest driving the site's collection tabs.

    Args:
        data_root (Path): Site ``data`` directory.

    Returns:
        list: Manifest entries in display order.
    """

    entries = []
    for index_path in [directory / "index.json" for directory in bundle_dirs(data_root)]:
        payload = load_json(index_path)
        entries.append({
            "slug": payload["slug"] if "slug" in payload else index_path.parent.name,
            "collection": payload["collection"],
            "collection_label": payload["collection_label"],
            "label": payload["label"],
            "n_pathways": len(payload["pathways"]),
        })

    entries.sort(key=lambda entry: (entry["collection"] != "kegg", entry["collection_label"]))
    write_json(data_root / "collections.json", {"collections": entries})
    print(f"collection manifest: {', '.join(entry['collection_label'] for entry in entries)}", flush=True)

    return entries
