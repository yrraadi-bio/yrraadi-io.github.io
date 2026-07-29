"""Build the static KEGG pathway explorer bundle: per-pathway top blocks, top tiles, and per-patch block activations."""

import argparse
import json
import os
from datetime import datetime
from pathlib import Path

import h5py
import numpy as np
import pandas as pd
import torch

BLOCKS_PER_DICTIONARY = 512
TOKENS_PER_TILE = 196
PATCH_GRID = 14

DEFAULT_XENIUM = "/home/viraj/silico-folder/data/spatial_shards_hest_v1/xenium"
DEFAULT_OUT = "/home/viraj/yrraadi-io.github.io/interp"

GIGAPATH_LAYERS = (0, 1, 13, 18, 23, 29, 38, 39)

# per-collection display label, external reference link, and redundant name suffix
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

# the two BSF families differ in dictionary layout, activation sharding and checkpoint format;
# a profile also names which gene-set collection its analysis root was annotated against
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


def write_atomic(path, payload):

    """Replace a file in one step so a browser never reads a half-written rebuild.

    Args:
        path (Path): Destination file.
        payload (str or bytes): Contents to write.
    """

    scratch = path.with_name(path.name + ".partial")
    scratch.write_bytes(payload.encode() if isinstance(payload, str) else payload)
    os.replace(scratch, path)


def compact(payload):

    """Collapse integral floats to ints, which halves payloads dominated by zeroed patch arrays.

    Args:
        payload (object): Any JSON-serializable value.

    Returns:
        object: the same value with every integral float replaced by an int
    """

    if isinstance(payload, float): return int(payload) if payload == int(payload) else payload
    if isinstance(payload, dict): return {key: compact(value) for key, value in payload.items()}
    if isinstance(payload, list): return [compact(value) for value in payload]

    return payload


def compact_json(payload):

    """Encode one document as small as JSON allows without losing a value.

    allow_nan is off because bare NaN is invalid JSON and would fail silently in the browser.

    Args:
        payload (object): JSON-serializable document.

    Returns:
        str: encoded document
    """

    return json.dumps(compact(payload), separators=(",", ":"), allow_nan=False)


def task_index_of(profile, layer, group_size):

    """Return the canonical task index for one dictionary.

    Args:
        profile (dict): Model profile from ``MODELS``.
        layer (int): Transformer layer of the profile's dictionary list.
        group_size (int): Block dimension.

    Returns:
        int: Task index within the profile's dictionary list.
    """

    return profile["dictionaries"].index((int(layer), int(group_size)))


def load_blocks_index(root, profile):

    """Load per-block status, falling back to the per-task shards the encoder writes.

    ``all_blocks_status.parquet`` only appears once the aggregation stage finishes, but the
    per-task ``block_status`` shards carry the same fields and are written during encoding.

    Args:
        root (Path): Gene/pathway analysis output root.
        profile (dict): Model profile from ``MODELS``.

    Returns:
        pandas.DataFrame: Block index with block_global_index, layer, group_size, block,
            firing_fraction, contribution_stable_rank and estimability_status.
    """

    combined = root / "all_blocks_status.parquet"
    if combined.is_file():
        return pd.read_parquet(combined)

    frames = []
    for task_index in range(len(profile["dictionaries"])):
        frame = pd.read_parquet(root / "block_status" / f"task_{task_index:02d}.parquet")
        frame["block_global_index"] = task_index * BLOCKS_PER_DICTIONARY + frame["block"].to_numpy()
        frames.append(frame)

    return pd.concat(frames, ignore_index=True)


def write_collection_manifest(data_root):

    """Refresh the manifest of built bundles that drives the site's collection tabs.

    Every bundle directory is discovered from disk rather than listed in code, so the tabs can
    never advertise a collection whose data is missing.

    Args:
        data_root (Path): Site ``data`` directory holding one subdirectory per bundle.

    Returns:
        list: manifest entries in display order
    """

    entries = []
    for index_path in sorted(data_root.glob("*/index.json")):
        payload = json.loads(index_path.read_text())
        entries.append({
            "slug": payload["slug"] if "slug" in payload else index_path.parent.name,
            "collection": payload["collection"],
            "collection_label": payload["collection_label"],
            "label": payload["label"],
            "n_pathways": len(payload["pathways"]),
        })

    # KEGG first when present, so the default view matches the published figures
    entries.sort(key=lambda entry: (entry["collection"] != "kegg", entry["collection_label"]))
    write_atomic(data_root / "collections.json", compact_json({"collections": entries}))
    print(f"collection manifest: {', '.join(entry['collection_label'] for entry in entries)}", flush=True)

    return entries


def collection_profile(root, profile):

    """Resolve which gene-set collection the analysis root actually holds.

    The root's own ``pathway_collection.json`` wins over the model profile, so a root can
    never be described as a collection it was not annotated against.

    Args:
        root (Path): Gene/pathway analysis output root.
        profile (dict): Model profile from ``MODELS``.

    Returns:
        dict: name, label, url_template, and the display-name suffix to strip.
    """

    name = profile["collection"]

    record = root / "pathway_collection.json"
    if record.is_file():
        name = str(json.loads(record.read_text())["collection"])

    # the display label is ours, so a root's release-stamped label cannot leak into the tabs
    return {"name": name, "label": COLLECTIONS[name]["label"], "url_template": COLLECTIONS[name]["url"],
            "name_suffix": COLLECTIONS[name]["name_suffix"]}


def load_pathway_names(root, suffix=""):

    """Map frozen gene-set identifiers to short display names.

    Args:
        root (Path): Gene/pathway analysis output root.
        suffix (str): Collection-specific name suffix to strip, empty when there is none.

    Returns:
        dict: set identifier to short pathway name.
    """

    sets = json.loads((root / "expanded_kegg_gene_sets.json").read_text())

    return {key: (value["name"].replace(suffix, "") if suffix else value["name"]) for key, value in sets.items()}


def select_pathways(root, n_pathways, n_blocks):

    """Choose the best-evidenced pathways and their strongest held-out-supported blocks.

    Args:
        root (Path): Gene/pathway analysis output root.
        n_pathways (int): Number of pathways to include.
        n_blocks (int): Number of blocks to keep per pathway.

    Returns:
        tuple: (ordered list of pathway ids, dict pathway id -> block rows DataFrame,
            pandas.Series of supported-block counts per pathway).
    """

    columns = ["block_global_index", "pathway_id", "train_effect", "heldout_effect", "delta_r2",
               "supported", "ci_low", "ci_high", "same_direction", "evidence_provenance"]
    transfer = pd.read_parquet(root / "pathway_transfer_heldout.parquet", columns=columns)

    supported = transfer[transfer["supported"]].copy()
    supported["abs_heldout"] = supported["heldout_effect"].abs()

    counts = supported.groupby("pathway_id").size().sort_values(ascending=False)
    ordered = counts.head(n_pathways).index.tolist()

    per_pathway = {}
    for pathway in ordered:
        rows = supported[supported["pathway_id"] == pathway].sort_values("abs_heldout", ascending=False).head(n_blocks)
        per_pathway[pathway] = rows.reset_index(drop=True)

    return ordered, per_pathway, counts


def load_activity(root, task_index, cache):

    """Load and cache one dictionary's per-tile block activity table.

    Args:
        root (Path): Gene/pathway analysis output root.
        task_index (int): Dictionary task index 0 through 7.
        cache (dict): Mutable cache keyed by task index.

    Returns:
        tuple: (identity DataFrame, activity array [n_tiles, 512] float32).
    """

    if task_index in cache:
        return cache[task_index]

    path = root / "tile_block_activity" / f"task_{task_index:02d}.parquet"
    frame = pd.read_parquet(path, columns=["tile_id", "slide_id", "source_h5_row", "tissue", "split", "activity"])

    # shape: [n_tiles, 512]
    activity = np.vstack(frame["activity"].to_numpy()).astype(np.float32)
    identity = frame.drop(columns=["activity"]).reset_index(drop=True)

    cache[task_index] = (identity, activity)

    return cache[task_index]


def load_pathway_genes(root, limit):

    """Rank each pathway's measured genes by mean training expression.

    Expression is the pipeline's ``log1p(raw_count / library_size * 1e6)`` transform, and the
    per-gene mean is the same one used to standardize genes when building pathway scores.

    Args:
        root (Path): Gene/pathway analysis output root.
        limit (int): Genes to keep per pathway.

    Genes the pipeline marks non-estimable (zero counts everywhere, hence a NaN standard deviation)
    are excluded from the ranking and counted separately, matching their exclusion from pathway scores.

    Returns:
        dict: pathway id -> {"genes": list of gene records, "n_genes": int measured gene count,
            "n_undetected": int genes never detected in training tiles}.
    """

    sets = pd.read_parquet(root / "expanded_kegg_gene_sets.parquet")
    axis = pd.read_parquet(root / "gene_axis_resolved.parquet", columns=["axis_index", "gene_symbol", "measured_train_slides", "measured_heldout_slides"])
    params = pd.read_parquet(root / "gene_score_parameters_train.parquet")

    table = axis.merge(params, on="axis_index", how="left").set_index("axis_index")

    out = {}
    for row in sets.itertuples():
        frame = table.loc[list(row.axis_indices)].reset_index()
        detected = frame.loc[np.isfinite(frame["mean"]) & np.isfinite(frame["std"]) & (frame["std"] > 0)].sort_values("mean", ascending=False)

        genes = [{
            "symbol": str(item.gene_symbol),
            "axis_index": int(item.axis_index),
            "mean": round(float(item.mean), 3),
            "std": round(float(item.std), 3),
            "train_slides": int(item.measured_train_slides),
            "heldout_slides": int(item.measured_heldout_slides),
        } for item in detected.head(limit).itertuples()]

        out[row.pathway_id] = {"genes": genes, "n_genes": int(row.n_measured_genes), "n_undetected": int(len(frame) - len(detected))}

    return out


def tile_rows(identity):

    """Map tile ids to row positions within one dictionary's activity table.

    ``tile_id`` is the one identity both families share: Origin sets it to the sequence id,
    GigaPath to ``SLIDE:source_row``.

    Args:
        identity (pandas.DataFrame): Identity frame from ``load_activity``.

    Returns:
        dict: tile_id str -> row index int.
    """

    if "_rows" not in identity.attrs:
        identity.attrs["_rows"] = {str(value): index for index, value in enumerate(identity["tile_id"].to_numpy())}

    return identity.attrs["_rows"]


def load_pathway_tile_scores(root, pathways):

    """Build per-pathway tile scores keyed by tile id for the training split.

    Args:
        root (Path): Gene/pathway analysis output root.
        pathways (list): Pathway identifiers to retain.

    Returns:
        dict: pathway id -> dict mapping tile_id str to float score.
    """

    counts = pd.read_parquet(root / "tile_gene_counts.parquet", columns=["tile_id", "split"])
    order = counts[counts["split"] == "train"]["tile_id"].astype(str).to_numpy()

    wanted = set(pathways)
    scores = pd.read_parquet(root / "tile_pathway_scores_train.parquet", columns=["tile_row", "pathway_id", "score"])
    scores = scores[scores["pathway_id"].isin(wanted)]

    out = {}
    for pathway, group in scores.groupby("pathway_id"):
        rows = group["tile_row"].to_numpy()
        valid = rows < len(order)
        out[pathway] = dict(zip(order[rows[valid]], group["score"].to_numpy()[valid].astype(float)))

    return out


def basic_correlation(identity, activation, scores):

    """Compute an unadjusted pathway-score versus block-activation Pearson correlation.

    Args:
        identity (pandas.DataFrame): Tile identity and split rows [n_tiles].
        activation (numpy.ndarray): Scalar block activation magnitude [n_tiles].
        scores (dict): Training tile id to pathway score.

    Returns:
        tuple: (Pearson r float or None, number of training tiles used)
    """

    tile_ids = identity["tile_id"].astype(str).to_numpy()
    train = identity["split"].astype(str).to_numpy() == "train"
    present = np.asarray([tile_id in scores for tile_id in tile_ids], dtype=bool)
    rows = train & present
    x = np.asarray(activation, dtype=np.float64)[rows]
    y = np.asarray([scores[tile_id] for tile_id in tile_ids[rows]], dtype=np.float64)
    finite = np.isfinite(x) & np.isfinite(y)
    x = x[finite]
    y = y[finite]

    if len(x) < 3 or np.var(x) <= np.finfo(np.float64).eps or np.var(y) <= np.finfo(np.float64).eps:
        return None, int(len(x))

    return float(np.corrcoef(x, y)[0, 1]), int(len(x))


def backfill_basic_correlations(root, data_dir, profile):

    """Add raw selected-block correlations to an already-built site bundle.

    Args:
        root (Path): Gene/pathway analysis output root.
        data_dir (Path): Existing collection bundle directory.
        profile (dict): Model profile from ``MODELS``.

    Returns:
        int: pathway documents updated
    """

    paths = sorted((data_dir / "pathways").glob("*.json"))
    if not paths:
        raise FileNotFoundError(f"no pathway bundles found under {data_dir / 'pathways'}")

    documents = [json.loads(path.read_text()) for path in paths]
    scores = load_pathway_tile_scores(root, [document["pathway_id"] for document in documents])
    activity_cache = {}

    for path, document in zip(paths, documents):
        pathway_scores = scores[document["pathway_id"]]
        for block in document["blocks"]:
            task_index = task_index_of(profile, block["layer"], block["group_size"])
            identity, activity = load_activity(root, task_index, activity_cache)
            value, rows = basic_correlation(identity, activity[:, int(block["block"])], pathway_scores)
            block["basic_r"] = round(value, 4) if value is not None else None
            block["basic_r_n"] = rows

        write_atomic(path, compact_json(document))

    return len(documents)


def provenance_map(run_root, split, profile):

    """Map each tile id to its activation shard position.

    Origin records tiles in a per-rank ``provenance.json``; GigaPath instead stores an integer
    index of (slide ordinal, source row) pairs beside the activations.

    Args:
        run_root (Path): BSF run root holding ``activations``.
        split (str): Activation directory split, ``train`` or ``held_out``.
        profile (dict): Model profile from ``MODELS``.

    Returns:
        dict: tile_id str -> (rank int, tile index within rank int).
    """

    mapping = {}

    if profile["layout"] == "origin":
        for rank in range(profile["world_size"]):
            payload = json.loads((run_root / "activations" / split / f"rank_{rank}" / "provenance.json").read_text())
            for index, record in enumerate(payload["tiles"]):
                mapping[str(record["sequence_id"])] = (rank, index)

        return mapping

    slides = json.loads((run_root / "activations" / "manifest.json").read_text())["slides"]
    for rank in range(profile["world_size"]):
        # shape: [n_tiles, 2] of (slide ordinal, source row)
        index = np.load(run_root / "activations" / split / "index" / f"rank_{rank}_tile_index.npy")
        for position, (slide_ordinal, source_row) in enumerate(index):
            mapping[f"{slides[int(slide_ordinal)]}:{int(source_row)}"] = (rank, position)

    return mapping


def activation_shard(run_root, profile, split, rank, layer):

    """Return the memmap path holding one split-rank-layer activation block.

    Args:
        run_root (Path): BSF run root holding ``activations``.
        profile (dict): Model profile from ``MODELS``.
        split (str): ``train`` or ``held_out``.
        rank (int): Shard rank.
        layer (int): Dictionary layer as named by the profile.

    Returns:
        Path: Activation ``.npy`` path.
    """

    if profile["layout"] == "origin":
        # Origin dictionaries are named for the post-residual block, one ahead of the array index
        return run_root / "activations" / split / f"rank_{rank}" / f"layer_{layer - 1}.npy"

    return run_root / "activations" / split / f"layer_{layer:02d}" / f"rank_{rank}.npy"


def load_bsf(run_root, layer, group_size, profile):

    """Load one BSF encoder, its train normalizer, and its top-k gate width.

    Origin keeps the normalizer in a ``normalization`` block beside an ``architecture`` block;
    GigaPath stores the train-fit global mean and scalar RMS scale at the checkpoint top level.

    Args:
        run_root (Path): BSF run root holding ``bsf``.
        layer (int): Transformer layer as named by the profile.
        group_size (int): Block dimension.
        profile (dict): Model profile from ``MODELS``.

    Returns:
        dict: Encoder weight, bias, mean, scale, group_size, and top_k.
    """

    if profile["layout"] == "origin":
        path = run_root / "bsf" / f"layer_{layer}" / f"dim_{group_size}" / "final.pt"
    else:
        path = run_root / "bsf" / f"layer_{layer:02d}" / "bsf.pt"

    checkpoint = torch.load(path, map_location="cpu", weights_only=False)
    state = checkpoint["state_dict"] if "state_dict" in checkpoint else checkpoint["model"]

    weight = state["W_enc"].detach().cpu().numpy().astype(np.float32)
    bias = state["b_enc"].detach().cpu().numpy().astype(np.float32).reshape(-1)

    # a square W_enc is already [d, blocks * group_size], so only transpose when unambiguous
    if weight.shape[1] != BLOCKS_PER_DICTIONARY * group_size:
        weight = weight.T

    if profile["layout"] == "origin":
        normalization = checkpoint["normalization"]
        assert normalization["fit_split"] == "train", "normalizer must be fit on the training split"
        mean, scale = normalization["mean"], normalization["scale"]
        top_k = int(checkpoint["architecture"]["l0"])
    else:
        assert str(checkpoint["center"]) == "global", "gigapath BSFs expect a global-center normalizer"
        mean, scale = checkpoint["mean"], checkpoint["scale"]
        top_k = int(checkpoint["l0"])

    assert weight.shape[1] == bias.size == BLOCKS_PER_DICTIONARY * group_size, f"{path}: encoder width does not match 512 x {group_size}"

    return {
        "w": weight, # shape: [1536, 512 * group_size]
        "b": bias,
        "mean": np.asarray(mean.detach().cpu() if hasattr(mean, "detach") else mean).reshape(-1).astype(np.float32), # shape: [1536]
        "scale": float(scale),
        "group_size": int(group_size),
        "top_k": top_k,
    }


def verify_activity(root, run_root, profile, activity_cache, n_tiles):

    """Check that re-encoding reproduces the activity the association analysis was fit on.

    The site claims a block supports a pathway using evidence from ``tile_block_activity``, so the
    patch overlays must come from the same linear map. Any disagreement means the overlays would
    describe a different encoder than the evidence, so this raises rather than warning.

    Args:
        root (Path): Gene/pathway analysis output root.
        run_root (Path): BSF run root.
        profile (dict): Model profile from ``MODELS``.
        activity_cache (dict): Cache passed to ``load_activity``.
        n_tiles (int): Tiles to sample per dictionary.

    Returns:
        None
    """

    provenance = {split: provenance_map(run_root, split, profile) for split in ("train", "held_out")}
    failures = []

    for task_index, (layer, group_size) in enumerate(profile["dictionaries"]):
        identity, activity = load_activity(root, task_index, activity_cache)
        bsf = load_bsf(run_root, layer, group_size, profile)

        picked = np.linspace(0, len(identity) - 1, n_tiles).astype(int)
        worst, weakest = 0.0, 1.0

        for position in picked:
            tile_id = str(identity.at[int(position), "tile_id"])
            split = "train" if str(identity.at[int(position), "split"]) == "train" else "held_out"
            rank, tile_index = provenance[split][tile_id]

            shard = np.load(activation_shard(run_root, profile, split, rank, layer), mmap_mode="r")
            # shape: [tokens_per_tile, 1536]
            tokens = np.asarray(shard[tile_index * TOKENS_PER_TILE:(tile_index + 1) * TOKENS_PER_TILE])

            reference = activity[int(position)]
            mine = np.log1p(patch_norms(tokens, bsf).mean(axis=0))

            worst = max(worst, float(np.abs(mine - reference).max()))
            weakest = min(weakest, float(np.corrcoef(mine, reference)[0, 1]))

        # a wrong encoder orientation lands near |diff| 3 and correlation 0.1; single-block gaps of
        # order 1e-2 are top-k gate ties flipping on float16 activations, which are harmless
        state = "ok" if worst < 0.05 and weakest > 0.999 else "MISMATCH"
        print(f"  L{layer} gs{group_size}: max|diff| = {worst:.2e}  min corr = {weakest:.6f}  {state}", flush=True)
        if state == "MISMATCH":
            failures.append(f"L{layer} gs{group_size} (max|diff|={worst:.2e}, corr={weakest:.4f})")

    assert not failures, ("re-encoding disagrees with tile_block_activity for " + ", ".join(failures) +
                          "; the analysis for these dictionaries was encoded with a different linear map, "
                          "so patch overlays would not describe the blocks the evidence refers to")


def patch_norms(tokens, bsf):

    """Compute per-patch block norms after per-token top-k gating.

    Mirrors the encoding used by the feature-extraction pipeline: normalize with the train
    mean and scalar scale, affine encode, take per-block L2 norms, then zero all but the
    strongest ``top_k`` blocks at each patch.

    Args:
        tokens (numpy.ndarray): Raw activations [tokens_per_tile, 1536].
        bsf (dict): Encoder bundle from ``load_bsf``.

    Returns:
        numpy.ndarray: Gated block norms [tokens_per_tile, 512] float32.
    """

    x = (tokens.astype(np.float32) - bsf["mean"]) * bsf["scale"] # shape: [tokens, 1536]

    # shape: [tokens, 512, group_size]
    z = (x @ bsf["w"] + bsf["b"]).reshape(len(x), BLOCKS_PER_DICTIONARY, bsf["group_size"])

    # shape: [tokens, 512]
    norms = np.linalg.norm(z, axis=2)

    keep = np.zeros(norms.shape, dtype=bool)
    order = np.argsort(-norms, axis=1, kind="stable")[:, :min(bsf["top_k"], BLOCKS_PER_DICTIONARY)]
    np.put_along_axis(keep, order, True, axis=1)

    return (norms * keep).astype(np.float32)


def export_tile_image(xenium_root, slide_id, source_row, out_dir, seen):

    """Write one tile's stored JPEG bytes to the site asset directory.

    Args:
        xenium_root (Path): Directory of ``<SLIDE>/expression.patches.h5`` shards.
        slide_id (str): Slide identifier.
        source_row (int): Patch row within the slide shard.
        out_dir (Path): Destination tile directory.
        seen (dict): Cache of already written (slide, row) keys to relative paths.

    Returns:
        str: Site-relative image path.
    """

    key = (slide_id, int(source_row))
    if key in seen:
        return seen[key]

    name = f"{slide_id}_{int(source_row):08d}.jpg"
    target = out_dir / name
    if not target.exists():
        with h5py.File(xenium_root / slide_id / "expression.patches.h5", "r") as handle:
            payload = bytes(handle["patches"][int(source_row)])
        write_atomic(target, payload)

    seen[key] = f"tiles/{name}"

    return seen[key]


def collect_tile_requests(root, per_pathway, tile_scores, n_candidates, n_score_candidates, activity_cache, blocks_index, profile):

    """Choose candidate tiles for every pathway and pathway-block pair.

    Each block shortlists ``n_candidates`` tiles by mean gated activity; the pathway-score
    gallery shortlists ``n_score_candidates`` tiles by pathway score. Both are trimmed later,
    once patch maps reveal peak activation and whether any block fires.

    Args:
        root (Path): Gene/pathway analysis output root.
        per_pathway (dict): Pathway id -> supported block rows.
        tile_scores (dict): Pathway id -> sequence_id to pathway score.
        n_candidates (int): Candidate tiles to encode per block.
        n_score_candidates (int): Candidate tiles to encode for the pathway-score gallery.
        activity_cache (dict): Cache for ``load_activity``.
        blocks_index (pandas.DataFrame): Block index with layer, group_size, block columns.

    Returns:
        tuple: (pathway_payload dict, needed set of (layer, group_size, sequence_id),
            pairs dict mapping (block_global_index, sequence_id) to None placeholder).
    """

    lookup = blocks_index.set_index("block_global_index")[["layer", "group_size", "block", "firing_fraction", "contribution_stable_rank", "estimability_status"]]

    payload = {}
    needed = set()
    pairs = {}

    for pathway, rows in per_pathway.items():
        block_entries = []
        for _, row in rows.iterrows():
            global_index = int(row["block_global_index"])
            meta = lookup.loc[global_index]
            layer = int(meta["layer"])
            group_size = int(meta["group_size"])
            local_block = int(meta["block"])

            identity, activity = load_activity(root, task_index_of(profile, layer, group_size), activity_cache)

            # shortlist tiles by this block's mean gated activity across every cohort tile
            column = activity[:, local_block]
            top = np.argsort(-column)[:n_candidates]
            basic_r, basic_r_n = basic_correlation(identity, column, tile_scores[pathway])

            tiles = []
            for position in top:
                sequence_id = str(identity.at[int(position), "tile_id"])
                tiles.append({
                    "sequence_id": sequence_id,
                    "slide_id": str(identity.at[int(position), "slide_id"]),
                    "source_h5_row": int(identity.at[int(position), "source_h5_row"]),
                    "tissue": str(identity.at[int(position), "tissue"]),
                    "split": str(identity.at[int(position), "split"]),
                    "activity": round(float(column[int(position)]), 4),
                    "pathway_score": round(float(tile_scores[pathway][sequence_id]), 4) if pathway in tile_scores and sequence_id in tile_scores[pathway] else None,
                })
                needed.add((layer, group_size, sequence_id))
                pairs[(global_index, sequence_id)] = None

            block_entries.append({
                "block_global_index": global_index,
                "layer": layer,
                "group_size": group_size,
                "block": local_block,
                "dictionary": f"L{layer} gs{group_size}",
                "train_effect": round(float(row["train_effect"]), 4),
                "heldout_effect": round(float(row["heldout_effect"]), 4),
                "delta_r2": round(float(row["delta_r2"]), 5),
                "ci_low": round(float(row["ci_low"]), 4),
                "ci_high": round(float(row["ci_high"]), 4),
                "firing_fraction": round(float(meta["firing_fraction"]), 4),
                "stable_rank": round(float(meta["contribution_stable_rank"]), 3),
                "basic_r": round(basic_r, 4) if basic_r is not None else None,
                "basic_r_n": basic_r_n,
                "tiles": tiles,
            })

        # pathway-level gallery ranked purely by tile pathway score, overlayable with any shown block
        score_tiles = []
        if pathway in tile_scores and block_entries:
            lead = block_entries[0]
            identity, _ = load_activity(root, task_index_of(profile, lead["layer"], lead["group_size"]), activity_cache)
            rows = tile_rows(identity)
            train_only = {sequence: score for sequence, score in tile_scores[pathway].items() if sequence in rows}
            ranked = sorted(train_only.items(), key=lambda item: -item[1])[:n_score_candidates]

            for sequence_id, score in ranked:
                position = rows[sequence_id]

                # every displayed block gets its own patch map so block selection works here too
                activity_by_block = {}
                for block in block_entries:
                    block_identity, block_activity = load_activity(root, task_index_of(profile, block["layer"], block["group_size"]), activity_cache)
                    block_row = tile_rows(block_identity)[sequence_id]
                    activity_by_block[str(block["block_global_index"])] = round(float(block_activity[block_row, block["block"]]), 4)
                    needed.add((block["layer"], block["group_size"], sequence_id))
                    pairs[(block["block_global_index"], sequence_id)] = None

                score_tiles.append({
                    "sequence_id": sequence_id,
                    "slide_id": str(identity.at[position, "slide_id"]),
                    "source_h5_row": int(identity.at[position, "source_h5_row"]),
                    "tissue": str(identity.at[position, "tissue"]),
                    "split": str(identity.at[position, "split"]),
                    "pathway_score": round(float(score), 4),
                    "activity_by_block": activity_by_block,
                })

        payload[pathway] = {"blocks": block_entries, "score_tiles": score_tiles}

    return payload, needed, pairs


def compute_patch_activations(run_root, needed, pairs, blocks_index, profile, split_of):

    """Compute per-patch gated norms for every requested block and tile.

    Args:
        run_root (Path): BSF run root.
        needed (set): (layer, group_size, tile_id) tuples to encode.
        pairs (dict): (block_global_index, tile_id) keys to populate.
        blocks_index (pandas.DataFrame): Block index used to resolve local block indices.
        profile (dict): Model profile from ``MODELS``.
        split_of (dict): tile_id -> activation split directory name.

    Returns:
        dict: (block_global_index, tile_id) -> list of 196 rounded floats.
    """

    lookup = blocks_index.set_index("block_global_index")[["layer", "group_size", "block"]]

    by_dictionary = {}
    for layer, group_size, sequence_id in needed:
        by_dictionary.setdefault((layer, group_size), set()).add(sequence_id)

    blocks_for = {}
    for global_index, sequence_id in pairs:
        meta = lookup.loc[global_index]
        key = (int(meta["layer"]), int(meta["group_size"]), sequence_id)
        blocks_for.setdefault(key, []).append((global_index, int(meta["block"])))

    provenance = {split: provenance_map(run_root, split, profile) for split in ("train", "held_out")}
    out = {}

    for (layer, group_size), sequences in sorted(by_dictionary.items()):
        bsf = load_bsf(run_root, layer, group_size, profile)
        memmaps = {}
        print(f"encoding {len(sequences)} tiles for L{layer} gs{group_size} (top_k={bsf['top_k']})", flush=True)

        for sequence_id in sorted(sequences):
            split = split_of[sequence_id]
            rank, tile_index = provenance[split][sequence_id]

            handle_key = (split, rank)
            if handle_key not in memmaps:
                memmaps[handle_key] = np.load(activation_shard(run_root, profile, split, rank, layer), mmap_mode="r")

            start = tile_index * TOKENS_PER_TILE
            # shape: [196, 1536]
            tokens = np.asarray(memmaps[handle_key][start:start + TOKENS_PER_TILE])

            # shape: [196, 512]
            norms = patch_norms(tokens, bsf)

            for global_index, local_block in blocks_for[(layer, group_size, sequence_id)]:
                out[(global_index, sequence_id)] = [round(float(v), 3) for v in norms[:, local_block]]

    return out


def gene_patch_maps(xenium_root, requests):

    """Localize gene expression to the 14x14 patch grid of each requested tile.

    Xenium measures expression once per cell-centred 256px patch, so a tile's own vector carries no
    sub-tile detail. The shard's ``neighbor_idx``/``neighbor_dxdy`` arrays, however, list neighbouring
    cell measurements with normalized offsets where +/-1 spans the tile footprint, which places each
    neighbour inside a specific patch cell. Cells are binned to that grid and averaged per patch.

    Args:
        xenium_root (Path): Directory of ``<SLIDE>/`` shards.
        requests (dict): (slide_id, source_row) -> set of gene symbols to localize.

    Returns:
        dict: (slide_id, source_row) -> {"patch": patch indices holding cells, "cells": cell count
            per patch, "genes": symbol -> mean log1p CPM per patch}.
    """

    by_slide = {}
    for slide_id, source_row in requests:
        by_slide.setdefault(slide_id, []).append(source_row)

    out = {}
    for slide_id, rows in sorted(by_slide.items()):
        symbols = sorted({symbol for row in rows for symbol in requests[(slide_id, row)]})

        with h5py.File(xenium_root / slide_id / "expression.patches.h5", "r") as handle:
            neighbours = {row: (np.asarray(handle["neighbor_idx"][row]), np.asarray(handle["neighbor_dxdy"][row]).reshape(-1, 2)) for row in rows}

        with h5py.File(xenium_root / slide_id / "expression.h5ad", "r") as handle:
            panel = [name.decode() if isinstance(name, bytes) else str(name) for name in handle["var"]["_index"][:]]
            position = {name: index for index, name in enumerate(panel)}
            present = [symbol for symbol in symbols if symbol in position]

            # map panel column -> dense slot for just the genes this slide needs
            slot = np.full(len(panel), -1, dtype=np.int32)
            for index, symbol in enumerate(present):
                slot[position[symbol]] = index

            library = handle["obs"]["total_counts"][:]
            indptr = handle["X"]["indptr"][:]
            indices = handle["X"]["indices"]
            data = handle["X"]["data"]

            wanted = sorted({int(cell) for row in rows for cell in np.concatenate([[row], neighbours[row][0]])})
            counts = {}
            for cell in wanted:
                start, stop = int(indptr[cell]), int(indptr[cell + 1])
                columns = indices[start:stop]
                hits = slot[columns] >= 0
                counts[cell] = (slot[columns[hits]], np.asarray(data[start:stop])[hits])

        for row in rows:
            index, offsets = neighbours[row]
            cells = np.concatenate([[row], index]).astype(int)
            offsets = np.vstack([[0.0, 0.0], offsets])

            column = np.clip(((offsets[:, 0] + 1.0) / 2.0 * PATCH_GRID).astype(int), 0, PATCH_GRID - 1)
            line = np.clip(((offsets[:, 1] + 1.0) / 2.0 * PATCH_GRID).astype(int), 0, PATCH_GRID - 1)
            patch = line * PATCH_GRID + column

            # shape: [n_cells, n_present_genes]
            expression = np.zeros((len(cells), len(present)), dtype=np.float32)
            for position_index, cell in enumerate(cells):
                slots, values = counts[int(cell)]
                expression[position_index, slots] = np.log1p(values / max(float(library[cell]), 1.0) * 1e6)

            occupied = np.unique(patch)
            wanted_here = requests[(slide_id, row)]
            keep = [index for index, symbol in enumerate(present) if symbol in wanted_here]

            grouped = np.stack([expression[patch == cell].mean(axis=0) for cell in occupied]) if len(occupied) else np.zeros((0, len(present)), dtype=np.float32)

            out[(slide_id, row)] = {
                "patch": [int(value) for value in occupied],
                "cells": [int((patch == value).sum()) for value in occupied],
                "genes": {present[index]: [round(float(value), 1) for value in grouped[:, index]] for index in keep},
            }

    return out


def patch_stats(values):

    """Summarize one patch map's magnitude and spatial selectivity.

    Args:
        values (list): Gated block norms per patch, length tokens_per_tile.

    Returns:
        dict: patches, max_patch, mean_patch, n_firing, and peak_to_mean.
    """

    array = np.asarray(values, dtype=np.float32)
    firing = array > 0
    mean_firing = float(array[firing].mean()) if firing.any() else 0.0

    return {
        "patches": values,
        "max_patch": round(float(array.max()), 3),
        "mean_patch": round(float(array.mean()), 3),
        "n_firing": int(firing.sum()),
        "peak_to_mean": round(float(array.max() / mean_firing), 3) if mean_firing > 0 else 0.0,
    }


def main():

    """Assemble the explorer bundle and copy tile images into the site directory."""

    parser = argparse.ArgumentParser(description="Build the KEGG pathway explorer data bundle")
    parser.add_argument("--model", default="origin", choices=sorted(MODELS))
    parser.add_argument("--root")
    parser.add_argument("--run-root")
    parser.add_argument("--xenium", default=DEFAULT_XENIUM)
    parser.add_argument("--out", default=DEFAULT_OUT)
    parser.add_argument("--pathways", type=int, default=60)
    parser.add_argument("--blocks", type=int, default=5)
    parser.add_argument("--tiles", type=int, default=6)
    parser.add_argument("--candidates", type=int, default=40)
    parser.add_argument("--score-candidates", type=int, default=12)
    parser.add_argument("--genes", type=int, default=12)
    parser.add_argument("--verify-tiles", type=int, default=3)
    parser.add_argument("--label")
    parser.add_argument("--slug", help="bundle directory under data/, defaults to the collection name")
    parser.add_argument("--basic-correlations-only", action="store_true", help="backfill raw pathway-block correlations")
    args = parser.parse_args()

    profile = MODELS[args.model]
    root = Path(args.root if args.root else profile["root"])
    run_root = Path(args.run_root if args.run_root else profile["run_root"])
    label = args.label if args.label else profile["label"]
    out_dir = Path(args.out)

    # each collection owns a bundle directory; tile images stay in one shared pool
    slug = args.slug if args.slug else collection_profile(root, profile)["name"]
    data_dir = out_dir / "data" / slug
    tile_dir = out_dir / "tiles"
    data_dir.mkdir(parents=True, exist_ok=True)
    tile_dir.mkdir(parents=True, exist_ok=True)

    if args.basic_correlations_only:
        updated = backfill_basic_correlations(root, data_dir, profile)
        print(f"updated raw pathway-block correlations in {updated} {slug} bundles", flush=True)
        return

    activity_cache = {}

    print(f"verifying {args.model} encoding against the analysis activity", flush=True)
    verify_activity(root, run_root, profile, activity_cache, args.verify_tiles)

    blocks_index = load_blocks_index(root, profile)
    sets = collection_profile(root, profile)
    print(f"gene-set collection: {sets['label']} ({sets['name']})", flush=True)
    names = load_pathway_names(root, sets["name_suffix"])

    ordered, per_pathway, counts = select_pathways(root, args.pathways, args.blocks)
    print(f"selected {len(ordered)} pathways with held-out support", flush=True)

    tile_scores = load_pathway_tile_scores(root, ordered)
    gene_table = load_pathway_genes(root, args.genes)

    payload, needed, pairs = collect_tile_requests(root, per_pathway, tile_scores, args.candidates, args.score_candidates, activity_cache, blocks_index, profile)
    print(f"{len(needed)} unique dictionary-tile encodes, {len(pairs)} block-tile pairs", flush=True)

    # the analysis labels the held-out split "heldout"; the activation directory is "held_out"
    identity, _ = load_activity(root, 0, activity_cache)
    split_of = {str(tile): "train" if str(split) == "train" else "held_out" for tile, split in zip(identity["tile_id"], identity["split"])}

    patches = compute_patch_activations(run_root, needed, pairs, blocks_index, profile, split_of)

    seen = {}
    pathways_out = []
    for pathway in ordered:
        entry = payload[pathway]

        # keep the candidates whose peak patch is strongest, so overlays show localized structure
        for block in entry["blocks"]:
            for tile in block["tiles"]:
                tile.update(patch_stats(patches[(block["block_global_index"], tile["sequence_id"])]))

            block["tiles"] = sorted(block["tiles"], key=lambda item: -item["max_patch"])[:args.tiles]
            for tile in block["tiles"]:
                tile["image"] = export_tile_image(Path(args.xenium), tile["slide_id"], tile["source_h5_row"], tile_dir, seen)

        # score tiles carry one overlay per displayed block so block selection changes the view
        kept = []
        for tile in entry["score_tiles"]:
            by_block = {}
            for block in entry["blocks"]:
                key = str(block["block_global_index"])
                stats = patch_stats(patches[(block["block_global_index"], tile["sequence_id"])])
                stats["activity"] = tile["activity_by_block"][key]
                by_block[key] = stats

            # skip near-dead tiles so any block the viewer selects usually has something to show
            firing_blocks = sum(1 for stats in by_block.values() if stats["n_firing"] > 0)
            if firing_blocks * 2 < len(by_block):
                continue

            tile.pop("activity_by_block")
            tile["by_block"] = by_block
            tile["n_blocks_firing"] = firing_blocks
            tile["image"] = export_tile_image(Path(args.xenium), tile["slide_id"], tile["source_h5_row"], tile_dir, seen)
            kept.append(tile)

            if len(kept) == args.tiles:
                break

        entry["score_tiles"] = kept

        pathways_out.append({
            "pathway_id": pathway,
            "name": names[pathway] if pathway in names else pathway,
            "n_supported_blocks": int(counts[pathway]),
            "genes": gene_table[pathway]["genes"],
            "n_pathway_genes": gene_table[pathway]["n_genes"],
            "n_undetected_genes": gene_table[pathway]["n_undetected"],
            "blocks": entry["blocks"],
            "score_tiles": entry["score_tiles"],
        })

    # localize each pathway's displayed genes inside its displayed tiles
    requests = {}
    for item in pathways_out:
        symbols = {gene["symbol"] for gene in item["genes"]}
        for tile in [tile for block in item["blocks"] for tile in block["tiles"]] + item["score_tiles"]:
            requests.setdefault((tile["slide_id"], tile["source_h5_row"]), set()).update(symbols)

    print(f"localizing genes in {len(requests)} tiles across {len({slide for slide, _ in requests})} slides", flush=True)
    maps = gene_patch_maps(Path(args.xenium), requests)

    for item in pathways_out:
        symbols = [gene["symbol"] for gene in item["genes"]]
        for tile in [tile for block in item["blocks"] for tile in block["tiles"]] + item["score_tiles"]:
            entry = maps[(tile["slide_id"], tile["source_h5_row"])]
            tile["gene_patch"] = entry["patch"]
            tile["gene_cells"] = entry["cells"]
            tile["gene_values"] = {symbol: entry["genes"][symbol] for symbol in symbols if symbol in entry["genes"]}

    # a light index keeps startup fast; per-pathway payloads load on demand
    pathway_dir = data_dir / "pathways"
    pathway_dir.mkdir(parents=True, exist_ok=True)

    index = {
        "label": label,
        "model": args.model,
        "slug": slug,
        "collection": sets["name"],
        "collection_label": sets["label"],
        "pathway_url_template": sets["url_template"],
        "encoder_note": profile["encoder"],
        "built": datetime.now().astimezone().strftime("%Y-%m-%d %H:%M %Z"),
        "patch_grid": PATCH_GRID,
        "tokens_per_tile": TOKENS_PER_TILE,
        "source_root": str(root),
        "run_root": str(run_root),
        "pathways": [{"pathway_id": item["pathway_id"], "name": item["name"], "n_supported_blocks": item["n_supported_blocks"]} for item in pathways_out],
    }

    written = {f"{item['pathway_id']}.json" for item in pathways_out}
    for item in pathways_out:
        write_atomic(pathway_dir / f"{item['pathway_id']}.json", compact_json(item))

    for stale in pathway_dir.glob("*.json"):
        if stale.name not in written:
            stale.unlink()

    write_atomic(data_dir / "index.json", compact_json(index))

    # record this bundle's tiles so pruning can spare images another bundle still needs
    referenced = sorted({Path(path).name for path in seen.values()})
    write_atomic(data_dir / "tiles.json", compact_json({"tiles": referenced}))

    keep = set()
    for manifest in (out_dir / "data").glob("*/tiles.json"):
        keep.update(json.loads(manifest.read_text())["tiles"])

    removed = 0
    for existing in tile_dir.glob("*.jpg"):
        if existing.name not in keep:
            existing.unlink()
            removed += 1

    write_collection_manifest(out_dir / "data")

    payload_mb = sum(path.stat().st_size for path in pathway_dir.glob("*.json")) / (1024 ** 2)
    print(f"wrote {data_dir / 'index.json'} and {len(pathways_out)} pathway payloads ({payload_mb:.1f} MB), "
          f"{len(seen)} tile images, pruned {removed} stale", flush=True)


if __name__ == "__main__":
    main()
