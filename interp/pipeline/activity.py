"""Load encoder activity, rank genes, and prepare tile-level overlays."""

import h5py
import numpy as np
import pandas as pd
import torch

from pipeline.config import (
    BLOCKS_PER_DICTIONARY,
    GENE_NEIGHBOURS,
    MIN_GENE_DETECTION,
    MIN_GENE_MEASURED_TILES,
    MIN_GENE_NONZERO_TILES,
    PATCH_GRID,
    TOKENS_PER_TILE,
    load_json,
    task_index_of,
    write_atomic,
    write_json,
)


def load_activity(root, task_index, cache):

    """Load and cache one dictionary's per-tile block activity.

    Args:
        root (Path): Gene/pathway analysis output root.
        task_index (int): Dictionary task index.
        cache (dict): Mutable task cache.

    Returns:
        tuple: Identity DataFrame and activity [n_tiles, 512].
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


def tile_rows(identity):

    """Map tile identifiers to dictionary activity rows.

    Args:
        identity (pandas.DataFrame): Dictionary tile identity table.

    Returns:
        dict: Tile identifier to row index.
    """

    if "_rows" not in identity.attrs:
        identity.attrs["_rows"] = {str(value): index for index, value in enumerate(identity["tile_id"].to_numpy())}

    return identity.attrs["_rows"]


def load_pathway_tile_scores(root, pathways):

    """Load per-pathway scores over all available tiles.

    Args:
        root (Path): Gene/pathway analysis output root.
        pathways (list): Pathway identifiers to retain.

    Returns:
        dict: Pathway identifier to tile-score mapping.
    """

    order = pd.read_parquet(root / "tile_gene_counts.parquet", columns=["tile_id"])["tile_id"].astype(str).to_numpy()
    wanted = set(pathways)
    scores = pd.read_parquet(root / "tile_pathway_scores_all.parquet", columns=["tile_row", "pathway_id", "score"])
    scores = scores[scores["pathway_id"].isin(wanted)]

    out = {}
    for pathway, group in scores.groupby("pathway_id"):
        rows = group["tile_row"].to_numpy()
        values = group["score"].to_numpy().astype(float)
        finite = np.isfinite(values)
        out[pathway] = dict(zip(order[rows[finite]], values[finite]))

    return out


def basic_correlation(identity, activation, scores):

    """Compute a raw training-tile pathway-block correlation.

    Args:
        identity (pandas.DataFrame): Tile identity rows.
        activation (numpy.ndarray): Scalar block activity [n_tiles].
        scores (dict): Tile identifier to pathway score.

    Returns:
        tuple: Pearson correlation or None, and rows used.
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

    """Add raw correlations to an existing collection bundle.

    Args:
        root (Path): Gene/pathway analysis output root.
        data_dir (Path): Existing collection bundle directory.
        profile (dict): Model profile.

    Returns:
        int: Pathway documents updated.
    """

    paths = sorted((data_dir / "pathways").glob("*.json"))
    if not paths:
        raise FileNotFoundError(f"no pathway bundles found under {data_dir / 'pathways'}")

    documents = [load_json(path) for path in paths]
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

        write_json(path, document)

    return len(documents)


def provenance_map(run_root, split, profile):

    """Map each tile identifier to its activation shard position.

    Args:
        run_root (Path): BSF run root.
        split (str): Activation directory split.
        profile (dict): Model profile.

    Returns:
        dict: Tile identifier to ``(rank, tile index)``.
    """

    mapping = {}

    if profile["layout"] == "origin":
        for rank in range(profile["world_size"]):
            payload = load_json(run_root / "activations" / split / f"rank_{rank}" / "provenance.json")
            for index, record in enumerate(payload["tiles"]):
                mapping[str(record["sequence_id"])] = (rank, index)

        return mapping

    slides = load_json(run_root / "activations" / "manifest.json")["slides"]
    for rank in range(profile["world_size"]):
        # shape: [n_tiles, 2]
        index = np.load(run_root / "activations" / split / "index" / f"rank_{rank}_tile_index.npy")
        for position, (slide_ordinal, source_row) in enumerate(index):
            mapping[f"{slides[int(slide_ordinal)]}:{int(source_row)}"] = (rank, position)

    return mapping


def activation_shard(run_root, profile, split, rank, layer):

    """Resolve one split-rank-layer activation shard.

    Args:
        run_root (Path): BSF run root.
        profile (dict): Model profile.
        split (str): ``train`` or ``held_out``.
        rank (int): Shard rank.
        layer (int): Dictionary layer.

    Returns:
        Path: Activation NPY path.
    """

    if profile["layout"] == "origin":
        return run_root / "activations" / split / f"rank_{rank}" / f"layer_{layer - 1}.npy"

    return run_root / "activations" / split / f"layer_{layer:02d}" / f"rank_{rank}.npy"


def load_bsf(run_root, layer, group_size, profile):

    """Load one encoder and its frozen normalizer.

    Args:
        run_root (Path): BSF run root.
        layer (int): Dictionary layer.
        group_size (int): Block dimension.
        profile (dict): Model profile.

    Returns:
        dict: Encoder weight, bias, normalizer, group size, and gate width.
    """

    if profile["layout"] == "origin":
        path = run_root / "bsf" / f"layer_{layer}" / f"dim_{group_size}" / "final.pt"
    else:
        path = run_root / "bsf" / f"layer_{layer:02d}" / "bsf.pt"

    checkpoint = torch.load(path, map_location="cpu", weights_only=False)
    state = checkpoint["state_dict"] if "state_dict" in checkpoint else checkpoint["model"]

    weight = state["W_enc"].detach().cpu().numpy().astype(np.float32)
    bias = state["b_enc"].detach().cpu().numpy().astype(np.float32).reshape(-1)

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
        # shape: [1536, 512 * group_size]
        "w": weight,
        "b": bias,
        # shape: [1536]
        "mean": np.asarray(mean.detach().cpu() if hasattr(mean, "detach") else mean).reshape(-1).astype(np.float32),
        "scale": float(scale),
        "group_size": int(group_size),
        "top_k": top_k,
    }


def verify_activity(root, run_root, profile, activity_cache, n_tiles):

    """Verify that re-encoding reproduces analysis activity.

    Args:
        root (Path): Gene/pathway analysis output root.
        run_root (Path): BSF run root.
        profile (dict): Model profile.
        activity_cache (dict): Dictionary activity cache.
        n_tiles (int): Tiles sampled per dictionary.

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

        state = "ok" if worst < 0.05 and weakest > 0.999 else "MISMATCH"
        print(f"  L{layer} gs{group_size}: max|diff| = {worst:.2e}  min corr = {weakest:.6f}  {state}", flush=True)
        if state == "MISMATCH":
            failures.append(f"L{layer} gs{group_size} (max|diff|={worst:.2e}, corr={weakest:.4f})")

    assert not failures, ("re-encoding disagrees with tile_block_activity for " + ", ".join(failures) +
                          "; the analysis for these dictionaries was encoded with a different linear map, "
                          "so patch overlays would not describe the blocks the evidence refers to")


def patch_norms(tokens, bsf):

    """Compute gated block norms for every image patch.

    Args:
        tokens (numpy.ndarray): Raw activations [tokens_per_tile, 1536].
        bsf (dict): Encoder bundle.

    Returns:
        numpy.ndarray: Gated norms [tokens_per_tile, 512].
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


def compute_patch_activations(run_root, needed, pairs, blocks_index, profile, split_of):

    """Compute requested block patch maps.

    Args:
        run_root (Path): BSF run root.
        needed (set): ``(layer, group_size, tile_id)`` encodes.
        pairs (dict): ``(block_global_index, tile_id)`` requests.
        blocks_index (pandas.DataFrame): Canonical block metadata.
        profile (dict): Model profile.
        split_of (dict): Tile identifier to activation split.

    Returns:
        dict: Requested pair to 196 rounded patch norms.
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
                out[(global_index, sequence_id)] = [round(float(value), 3) for value in norms[:, local_block]]

    return out


def gene_reference_table(root):

    """Load gene scale and panel-coverage metadata.

    Args:
        root (Path): Gene/pathway analysis output root.

    Returns:
        pandas.DataFrame: Gene metadata indexed by axis position.
    """

    axis = pd.read_parquet(root / "gene_axis_resolved.parquet", columns=["axis_index", "gene_symbol", "measured_train_slides", "measured_heldout_slides"])
    params = pd.read_parquet(root / "gene_score_parameters_train.parquet")

    return axis.merge(params, on="axis_index", how="left").set_index("axis_index")


def tile_gene_expression(root):

    """Rebuild the transformed per-tile expression matrix.

    Args:
        root (Path): Gene/pathway analysis output root.

    Returns:
        tuple: Tile ids, slide ordinals, and expression [n_tiles, gene_axis].
    """

    covariates = pd.read_parquet(root / "tile_covariates.parquet", columns=["tile_id", "slide_id", "raw_library_size", "qc_eligible"])
    counts = pd.read_parquet(root / "tile_gene_counts.parquet", columns=["tile_id", "count", "measured"])

    covariates["tile_id"] = covariates["tile_id"].astype(str)
    counts["tile_id"] = counts["tile_id"].astype(str)
    counts = counts.set_index("tile_id").loc[covariates["tile_id"]].reset_index()

    # shape: [n_tiles, gene_axis]
    raw = np.vstack(counts["count"].to_numpy()).astype(np.float32)
    measured = np.vstack(counts["measured"].to_numpy())

    library = covariates["raw_library_size"].to_numpy(float)
    expression = np.log1p(np.divide(raw * 1e6, library[:, None], out=np.full(raw.shape, np.nan, dtype=np.float32), where=library[:, None] > 0))
    expression[~measured] = np.nan
    expression[~covariates["qc_eligible"].to_numpy()] = np.nan

    return covariates["tile_id"].to_numpy(), pd.factorize(covariates["slide_id"].to_numpy())[0], expression


def manifold_clustering(values, neighbours, slides):

    """Score expression clustering over a block's tile geometry.

    Args:
        values (numpy.ndarray): Gene expression [n_tiles].
        neighbours (numpy.ndarray): Neighbour indices [n_tiles, GENE_NEIGHBOURS].
        slides (numpy.ndarray): Slide ordinal [n_tiles].

    Returns:
        tuple: Moran's I and slide-centred Moran's I.
    """

    scores = []
    for centred in (False, True):
        series = values.astype(np.float64)

        if centred:
            usable = np.isfinite(series)
            total = np.bincount(slides[usable], weights=series[usable], minlength=slides.max() + 1)
            seen = np.bincount(slides[usable], minlength=slides.max() + 1)
            series = series - np.where(seen > 0, total / np.maximum(seen, 1), 0.0)[slides]

        standard = (series - np.nanmean(series)) / np.nanstd(series)
        scores.append(float(np.nanmean(standard[:, None] * standard[neighbours])))

    return scores[0], scores[1]


def gene_rankings(root, profile, payload, pathway_scores, limit):

    """Rank genes separately for feature cards and positive pathway scores.

    Args:
        root (Path): Gene/pathway analysis output root.
        profile (dict): Model profile.
        payload (dict): Pathway request payload.
        pathway_scores (dict): Pathway identifier to tile-score mapping.
        limit (int): Genes retained per feature or pathway.

    Returns:
        tuple: Per-pathway-feature and per-pathway gene rankings.
    """

    from scipy.spatial import cKDTree

    reference = gene_reference_table(root)
    sets = pd.read_parquet(root / "expanded_kegg_gene_sets.parquet").set_index("pathway_id")
    tiles, slides, expression = tile_gene_expression(root)

    work = {}
    for pathway, entry in payload.items():
        for block in entry["blocks"]:
            work.setdefault((block["layer"], block["group_size"]), []).append((pathway, block["block_global_index"], block["block"]))

    out = {}
    scored = {}

    for (layer, group_size), requests in sorted(work.items()):
        path = root / "tile_block_activity" / f"task_{task_index_of(profile, layer, group_size):02d}.parquet"
        frame = pd.read_parquet(path, columns=["tile_id", "signed_coordinate_mean", "activity"])
        frame["tile_id"] = frame["tile_id"].astype(str)
        frame = frame.set_index("tile_id").loc[tiles].reset_index()

        # shape: [n_tiles, n_blocks, group_size]
        cube = np.vstack(frame["signed_coordinate_mean"].to_numpy()).astype(np.float32).reshape(len(frame), -1, group_size)
        activity = np.vstack(frame["activity"].to_numpy()).astype(np.float32)
        print(f"ranking genes for {len(requests)} block cards on L{layer} gs{group_size}", flush=True)

        for pathway, global_index, local_block in requests:
            # shape: [n_tiles, group_size]
            coordinates = cube[:, local_block, :]
            live = np.flatnonzero(np.abs(coordinates).sum(axis=1) > 0)
            neighbours = cKDTree(coordinates[live]).query(coordinates[live], k=GENE_NEIGHBOURS + 1)[1][:, 1:]
            firing = activity[live, local_block]
            here = slides[live]

            genes = []
            axis_indices = list(sets.at[pathway, "axis_indices"])
            for axis_index in axis_indices:
                axis_index = int(axis_index)
                key = (global_index, axis_index)

                if key not in scored:
                    scored[key] = score_gene(expression[live, axis_index], neighbours, here, firing, reference.loc[axis_index], axis_index)

                if scored[key]: genes.append(scored[key])

            genes.sort(key=lambda record: -record["clustering"])
            out[(pathway, global_index)] = {"genes": genes[:limit], "n_scored": len(genes), "n_measured": len(axis_indices)}

        del cube, activity

    pathway_out = {}
    for pathway in payload:
        score_map = pathway_scores[pathway]
        scores = np.asarray([score_map[tile] if tile in score_map else np.nan for tile in tiles], dtype=np.float64)
        active = np.isfinite(scores) & (scores > 0)
        genes = []
        axis_indices = list(sets.at[pathway, "axis_indices"])

        for axis_index in axis_indices:
            axis_index = int(axis_index)
            gene = score_pathway_gene(expression[:, axis_index], scores, active, reference.loc[axis_index], axis_index)
            if gene: genes.append(gene)

        genes.sort(key=lambda record: (-record["detection"], -record["pathway_r"], record["symbol"]))
        pathway_out[pathway] = {
            "genes": genes[:limit],
            "n_measured": len(axis_indices),
            "n_active_tiles": int(active.sum()),
        }

    return out, pathway_out


def score_pathway_gene(values, scores, active, reference, axis_index):

    """Build a gene card from tiles with positive pathway score.

    Args:
        values (numpy.ndarray): Gene expression [n_tiles].
        scores (numpy.ndarray): Pathway scores [n_tiles].
        active (numpy.ndarray): Positive pathway-score mask [n_tiles].
        reference (pandas.Series): Gene reference metadata.
        axis_index (int): Gene axis position.

    Returns:
        dict or None: Pathway-level gene card or no card when never detected.
    """

    usable = active & np.isfinite(values)
    detected = usable & (values > 0)
    if not detected.any(): return None

    compared = np.isfinite(values) & np.isfinite(scores)
    pathway_r = np.corrcoef(values[compared], scores[compared])[0, 1] if values[compared].std() > 0 else 0.0

    return {
        "symbol": str(reference["gene_symbol"]),
        "axis_index": axis_index,
        "pathway_r": round(float(pathway_r), 3),
        "detection": round(float(detected.sum() / usable.sum()), 3),
        "n_tiles": int(usable.sum()),
        "n_detected_tiles": int(detected.sum()),
        "mean": round(float(reference["mean"]), 3),
        "std": round(float(reference["std"]), 3),
        "train_slides": int(reference["measured_train_slides"]),
        "heldout_slides": int(reference["measured_heldout_slides"]),
    }


def score_gene(values, neighbours, slides, firing, reference, axis_index):

    """Build one gene card when its detection supports scoring.

    Args:
        values (numpy.ndarray): Gene expression [n_tiles].
        neighbours (numpy.ndarray): Neighbour indices [n_tiles, GENE_NEIGHBOURS].
        slides (numpy.ndarray): Slide ordinals [n_tiles].
        firing (numpy.ndarray): Block activity [n_tiles].
        reference (pandas.Series): Gene reference metadata.
        axis_index (int): Gene axis position.

    Returns:
        dict or None: Gene card or no card below detection floors.
    """

    usable = np.isfinite(values)
    nonzero = int((values[usable] > 0).sum())

    if usable.sum() < MIN_GENE_MEASURED_TILES or nonzero < MIN_GENE_NONZERO_TILES: return None
    if nonzero / usable.sum() < MIN_GENE_DETECTION: return None

    clustering, slide_adjusted = manifold_clustering(values, neighbours, slides)
    activation = np.corrcoef(values[usable], firing[usable])[0, 1] if values[usable].std() > 0 else 0.0

    return {
        "symbol": str(reference["gene_symbol"]),
        "axis_index": axis_index,
        "clustering": round(float(clustering), 3),
        "clustering_slide_adjusted": round(float(slide_adjusted), 3),
        "activation_r": round(float(activation), 3),
        "detection": round(float(nonzero / usable.sum()), 3),
        "n_tiles": int(usable.sum()),
        "mean": round(float(reference["mean"]), 3),
        "std": round(float(reference["std"]), 3),
        "train_slides": int(reference["measured_train_slides"]),
        "heldout_slides": int(reference["measured_heldout_slides"]),
    }


def gene_patch_maps(xenium_root, requests):

    """Localize requested genes to each tile's 14x14 patch grid.

    Args:
        xenium_root (Path): Directory of Xenium slide shards.
        requests (dict): ``(slide_id, source_row)`` to gene symbols.

    Returns:
        dict: Tile key to sparse patch expression.
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

            # shape: [n_panel_genes]
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


def export_tile_image(xenium_root, slide_id, source_row, out_dir, seen):

    """Export one stored tile JPEG into the shared image pool.

    Args:
        xenium_root (Path): Xenium shard root.
        slide_id (str): Slide identifier.
        source_row (int): Row within the slide shard.
        out_dir (Path): Shared tile output directory.
        seen (dict): Exported tile cache.

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

    """Select candidate tiles for every pathway and block card.

    Args:
        root (Path): Gene/pathway analysis output root.
        per_pathway (dict): Pathway identifier to supported block rows.
        tile_scores (dict): Pathway identifier to tile scores.
        n_candidates (int): Per-block candidate count.
        n_score_candidates (int): Pathway-score candidate count.
        activity_cache (dict): Dictionary activity cache.
        blocks_index (pandas.DataFrame): Canonical block metadata.
        profile (dict): Model profile.

    Returns:
        tuple: Pathway payload, dictionary-tile encodes, and block-tile requests.
    """

    lookup = blocks_index.set_index("block_global_index")[["layer", "group_size", "block", "contribution_stable_rank", "estimability_status"]]
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
                "stable_rank": round(float(meta["contribution_stable_rank"]), 3),
                "basic_r": round(basic_r, 4) if basic_r is not None else None,
                "basic_r_n": basic_r_n,
                "tiles": tiles,
            })

        score_tiles = []
        if pathway in tile_scores and block_entries:
            lead = block_entries[0]
            identity, _ = load_activity(root, task_index_of(profile, lead["layer"], lead["group_size"]), activity_cache)
            rows = tile_rows(identity)
            scored = {sequence: score for sequence, score in tile_scores[pathway].items() if sequence in rows}
            ranked = sorted(scored.items(), key=lambda item: -item[1])[:n_score_candidates]

            for sequence_id, score in ranked:
                position = rows[sequence_id]
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


def patch_stats(values):

    """Summarize one patch activation map.

    Args:
        values (list): Gated block norms per patch.

    Returns:
        dict: Patch values and magnitude summaries.
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
