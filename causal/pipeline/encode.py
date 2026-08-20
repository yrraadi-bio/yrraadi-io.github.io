"""Encode the tiles each carded gene is most expressed on, past the pathway explorer's published pool."""

import gzip
import json
from collections import defaultdict
from pathlib import Path

import h5py
import numpy as np
import torch

from pipeline.config import (BLOCKS_PER_DICTIONARY, GENE_TILES, PATCH_GRID, TOKENS_PER_TILE, load_json,
                             manifold_key, write_atomic)

GROUP_SIZE = 16
WORLD_SIZE = 4


def identity(interp_root):

    """Resolve every global tile row to the slide, shard row and split it came from.

    Args:
        interp_root (Path): Root of the pathway explorer site.

    Returns:
        list: Per-row dicts carrying sequence id, slide, source row, tissue and split.
    """

    table = load_json(interp_root / "data" / "manifold" / "tiles.json")
    tissues = table["tissues"]
    rows = []

    for sequence, tissue, train in zip(table["tile_id"], table["tissue_code"], table["train_row"]):
        slide, source = sequence.split(":")
        rows.append({"sequence_id": sequence, "slide_id": slide, "source_h5_row": int(source),
                     "tissue": tissues[tissue], "split": "train" if train >= 0 else "heldout"})

    return rows


def demand(interp_root, features, cards, counts, axis):

    """Choose the tiles every carded gene is most expressed on within its feature's own manifold.

    The published pool ranks tiles by feature activity alone, which leaves galleries where the
    selected gene reads zero everywhere, so each pair is filled from the feature's full manifold.

    Args:
        interp_root (Path): Root of the pathway explorer site.
        features (dict): Block global index to its published identity.
        cards (dict): Block global index to the gene symbols its gallery can show.
        counts (numpy.ndarray): Per-tile transcript counts [n_tiles, n_genes].
        axis (dict): Gene symbol to axis column index.

    Returns:
        dict: Block global index to the global tile rows worth encoding for it.
    """

    manifolds = interp_root / "data" / "manifold" / "block_manifolds"
    wanted = {}

    for feature, symbols in cards.items():
        path = manifolds / f"{manifold_key(features[feature])}.json"
        if not path.is_file():
            continue

        # shape: [n_manifold_tiles]
        pool = np.asarray(load_json(path)["tile_rows"])
        picked = set()

        for symbol in symbols:
            # shape: [n_manifold_tiles]
            column = counts[pool, axis[symbol]]
            carrying = np.nonzero(column > 0)[0]
            picked.update(int(pool[at]) for at in carrying[np.argsort(-column[carrying])][:GENE_TILES])

        wanted[feature] = sorted(picked)

    return wanted


def provenance(run_root):

    """Map every tile identifier to its position inside the cached activation shards.

    Args:
        run_root (Path): BSF run root holding the activation cache.

    Returns:
        dict: Activation split to tile identifier to ``(rank, position)``.
    """

    slides = load_json(run_root / "activations" / "manifest.json")["slides"]
    mapping = {}

    for split in ("train", "held_out"):
        found = {}
        for rank in range(WORLD_SIZE):
            # shape: [n_rank_tiles, 2]
            index = np.load(run_root / "activations" / split / "index" / f"rank_{rank}_tile_index.npy")
            for position, (slide, source) in enumerate(index):
                found[f"{slides[int(slide)]}:{int(source)}"] = (rank, position)

        mapping[split] = found

    return mapping


def encoder(run_root, layer):

    """Load one layer's block-sparse encoder and its frozen normalizer.

    Args:
        run_root (Path): BSF run root.
        layer (int): Prov-GigaPath transformer layer.

    Returns:
        dict: Encoder weight, bias, normalizer, group size and gate width.
    """

    checkpoint = torch.load(run_root / "bsf" / f"layer_{layer:02d}" / "bsf.pt", map_location="cpu", weights_only=False)
    state = checkpoint["state_dict"] if "state_dict" in checkpoint else checkpoint["model"]

    # shape: [1536, 512 * group_size]
    weight = state["W_enc"].detach().cpu().numpy().astype(np.float32)
    bias = state["b_enc"].detach().cpu().numpy().astype(np.float32).reshape(-1)

    if weight.shape[1] != BLOCKS_PER_DICTIONARY * GROUP_SIZE:
        weight = weight.T

    assert str(checkpoint["center"]) == "global", "gigapath encoders expect a global-center normalizer"
    assert weight.shape[1] == bias.size == BLOCKS_PER_DICTIONARY * GROUP_SIZE, f"L{layer}: encoder width is not 512 x {GROUP_SIZE}"

    return {"w": weight, "b": bias, "mean": np.asarray(checkpoint["mean"]).reshape(-1).astype(np.float32),
            "scale": float(checkpoint["scale"]), "top_k": int(checkpoint["l0"])}


def patch_norms(tokens, bsf):

    """Compute the gated block norm every patch of one tile carries.

    Args:
        tokens (numpy.ndarray): Cached layer activations [tokens_per_tile, 1536].
        bsf (dict): Encoder bundle from ``encoder``.

    Returns:
        numpy.ndarray: Gated norms [tokens_per_tile, 512].
    """

    x = (tokens.astype(np.float32) - bsf["mean"]) * bsf["scale"] # shape: [tokens, 1536]

    # shape: [tokens, 512, group_size]
    z = (x @ bsf["w"] + bsf["b"]).reshape(len(x), BLOCKS_PER_DICTIONARY, GROUP_SIZE)

    # shape: [tokens, 512]
    norms = np.linalg.norm(z, axis=2)
    keep = np.zeros(norms.shape, dtype=bool)
    order = np.argsort(-norms, axis=1, kind="stable")[:, :min(bsf["top_k"], BLOCKS_PER_DICTIONARY)]
    np.put_along_axis(keep, order, True, axis=1)

    return (norms * keep).astype(np.float32)


def statistics(values):

    """Summarize one patch activation map the way the published payload does.

    Args:
        values (list): Gated block norms per patch.

    Returns:
        dict: Patch values, activity, and magnitude summaries.
    """

    # shape: [tokens_per_tile]
    array = np.asarray(values, dtype=np.float32)
    firing = array > 0
    mean_firing = float(array[firing].mean()) if firing.any() else 0.0

    return {
        "activity": round(float(np.log1p(array.mean())), 4),
        "patches": values,
        "max_patch": round(float(array.max()), 3),
        "mean_patch": round(float(array.mean()), 3),
        "n_firing": int(firing.sum()),
        "peak_to_mean": round(float(array.max() / mean_firing), 3) if mean_firing > 0 else 0.0,
    }


def activations(run_root, wanted, features, rows):

    """Encode every requested tile and keep the one block each request asked for.

    Args:
        run_root (Path): BSF run root holding the activation cache and encoders.
        wanted (dict): Block global index to the global tile rows to encode for it.
        features (dict): Block global index to its published identity.
        rows (list): Per-row tile identity from ``identity``.
        
    Returns:
        dict: ``(block global index, global tile row)`` to its patch statistics.
    """

    blocks_for = defaultdict(list)
    for feature, tiles in wanted.items():
        layer = int(features[feature]["layer"])
        for row in tiles:
            blocks_for[(layer, row)].append((feature, int(features[feature]["block"])))

    where = provenance(run_root)
    out = {}

    for layer in sorted({layer for layer, _ in blocks_for}):
        bsf = encoder(run_root, layer)
        requests = sorted(row for at, row in blocks_for if at == layer)
        shards = {}
        print(f"  L{layer}: encoding {len(requests):,} tiles", flush=True)

        for row in requests:
            tile = rows[row]
            split = "train" if tile["split"] == "train" else "held_out"
            rank, position = where[split][tile["sequence_id"]]

            if (split, rank) not in shards:
                shards[(split, rank)] = np.load(run_root / "activations" / split / f"layer_{layer:02d}" / f"rank_{rank}.npy", mmap_mode="r")

            start = position * TOKENS_PER_TILE
            # shape: [tokens_per_tile, 1536]
            tokens = np.asarray(shards[(split, rank)][start:start + TOKENS_PER_TILE])
            norms = patch_norms(tokens, bsf)

            for feature, block in blocks_for[(layer, row)]:
                out[(feature, row)] = statistics([round(float(value), 3) for value in norms[:, block]])

    return out


def localize(xenium_root, requests):

    """Localize each requested gene onto its tile's patch grid.

    Args:
        xenium_root (Path): Directory of Xenium slide shards.
        requests (dict): ``(slide id, source row)`` to the gene symbols wanted there.

    Returns:
        dict: ``(slide id, source row)`` to occupied patches, cell counts and per-gene values.
    """

    by_slide = defaultdict(list)
    for slide, source in requests:
        by_slide[slide].append(source)

    out = {}

    for slide, sources in sorted(by_slide.items()):
        symbols = sorted({symbol for source in sources for symbol in requests[(slide, source)]})

        with h5py.File(xenium_root / slide / "expression.patches.h5", "r") as handle:
            neighbours = {source: (np.asarray(handle["neighbor_idx"][source]),
                                   np.asarray(handle["neighbor_dxdy"][source]).reshape(-1, 2)) for source in sources}

        with h5py.File(xenium_root / slide / "expression.h5ad", "r") as handle:
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

            wanted = sorted({int(cell) for source in sources
                             for cell in np.concatenate([[source], neighbours[source][0]])})
            counted = {}
            for cell in wanted:
                start, stop = int(indptr[cell]), int(indptr[cell + 1])
                columns = indices[start:stop]
                hits = slot[columns] >= 0
                counted[cell] = (slot[columns[hits]], np.asarray(data[start:stop])[hits])

        for source in sources:
            index, offsets = neighbours[source]
            cells = np.concatenate([[source], index]).astype(int)
            offsets = np.vstack([[0.0, 0.0], offsets])

            column = np.clip(((offsets[:, 0] + 1.0) / 2.0 * PATCH_GRID).astype(int), 0, PATCH_GRID - 1)
            line = np.clip(((offsets[:, 1] + 1.0) / 2.0 * PATCH_GRID).astype(int), 0, PATCH_GRID - 1)
            patch = line * PATCH_GRID + column

            # shape: [n_cells, n_present_genes]
            expression = np.zeros((len(cells), len(present)), dtype=np.float32)
            for at, cell in enumerate(cells):
                slots, values = counted[int(cell)]
                expression[at, slots] = np.log1p(values / max(float(library[cell]), 1.0) * 1e6)

            occupied = np.unique(patch)
            keep = [index for index, symbol in enumerate(present) if symbol in requests[(slide, source)]]
            grouped = np.stack([expression[patch == cell].mean(axis=0) for cell in occupied]) if len(occupied) else np.zeros((0, len(present)), dtype=np.float32)

            out[(slide, source)] = {
                "patch": [int(value) for value in occupied],
                "cells": [int((patch == value).sum()) for value in occupied],
                "genes": {present[index]: [round(float(value), 1) for value in grouped[:, index]] for index in keep},
            }

    return out


def images(xenium_root, tiles, destination):

    """Copy the stored JPEG of every newly encoded tile out of its slide shard.

    Args:
        xenium_root (Path): Directory of Xenium slide shards.
        tiles (list): Tile identity records needing an image.
        destination (Path): Causal ``tiles`` directory.

    Returns:
        int: Number of images written.
    """

    destination.mkdir(parents=True, exist_ok=True)
    by_slide = defaultdict(list)
    for tile in tiles:
        by_slide[tile["slide_id"]].append(int(tile["source_h5_row"]))

    written = 0

    for slide, sources in sorted(by_slide.items()):
        with h5py.File(xenium_root / slide / "expression.patches.h5", "r") as handle:
            for source in sorted(set(sources)):
                write_atomic(destination / f"{slide}_{source:08d}.jpg", bytes(handle["patches"][source]))
                written += 1

    return written


def build(interp_root, run_root, xenium_root, features, cards, counts, axis, destination):

    """Encode and assemble every gene-led tile the published pool never carried.

    Args:
        interp_root (Path): Root of the pathway explorer site.
        run_root (Path): BSF run root holding the activation cache and encoders.
        xenium_root (Path): Directory of Xenium slide shards.
        features (dict): Block global index to its published identity.
        cards (dict): Block global index to the gene symbols its gallery can show.
        counts (numpy.ndarray): Per-tile transcript counts [n_tiles, n_genes].
        axis (dict): Gene symbol to axis column index.
        destination (Path): Causal ``tiles`` directory receiving the new images.

    Returns:
        tuple: Block global index to ``(tile, activation)`` pairs, and the number of tiles encoded.
    """

    rows = identity(interp_root)
    wanted = demand(interp_root, features, cards, counts, axis)
    encoded = activations(run_root, wanted, features, rows)

    requested = defaultdict(set)
    for feature, tiles in wanted.items():
        for row in tiles:
            tile = rows[row]
            requested[(tile["slide_id"], int(tile["source_h5_row"]))].update(
                symbol for symbol in cards[feature] if counts[row, axis[symbol]] > 0)

    located = localize(xenium_root, requested)
    needed = sorted({row for tiles in wanted.values() for row in tiles})
    written = images(xenium_root, [rows[row] for row in needed], destination)

    pooled = defaultdict(list)
    for feature, tiles in wanted.items():
        for row in tiles:
            tile = rows[row]
            local = located[(tile["slide_id"], int(tile["source_h5_row"]))]
            pooled[feature].append((dict(tile, gene_patch=local["patch"], gene_cells=local["cells"],
                                         gene_values=local["genes"],
                                         image=f"tiles/{tile['slide_id']}_{int(tile['source_h5_row']):08d}.jpg"),
                                    encoded[(feature, row)]))

    return pooled, written
