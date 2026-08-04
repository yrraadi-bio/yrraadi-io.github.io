"""Invert the built pathway bundle into a block-first index, so the explorer can be browsed by block."""

import argparse
import json
from collections import defaultdict
from datetime import datetime
from pathlib import Path

import pandas as pd

from build_site_data import compact_json, write_atomic

# pooled over the sets a block shows, and held to the same count a single card carries in the other view
GENES_PER_BLOCK = 12

# a handful of blocks carry dozens of sets, so the cards keep the strongest few rather than every one
SETS_PER_BLOCK = 8

# where an effect starts to count: the cut a block must clear to be listed, the cut an association must
# clear to count against the block's strongest one, and the margin that strongest one must win by
MIN_EFFECT = 0.1


def load_documents(out_root):

    """Read every pathway document of every collection already built into the site.

    Args:
        out_root (Path): Site root holding ``data/``.

    Returns:
        tuple: (collections list, list of (slug, collection_label, document) triples)
    """

    collections = json.loads((out_root / "data" / "collections.json").read_text())["collections"]
    documents = []

    for entry in collections:
        slug = entry["slug"]
        for path in sorted((out_root / "data" / slug / "pathways").glob("*.json")):
            documents.append((slug, entry["collection_label"], json.loads(path.read_text())))

    return collections, documents


def association(slug, label, document, block):

    """Describe one pathway a block carries, as the block-first view lists it.

    Args:
        slug (str): Collection slug the pathway belongs to.
        label (str): Display label of that collection.
        document (dict): Pathway document the block card came from.
        block (dict): Block card inside that document.

    Returns:
        dict: One pathway entry for a block.
    """

    return {
        "slug": slug,
        "collection_label": label,
        "pathway_id": document["pathway_id"],
        "name": document["name"],
        "train_effect": block["train_effect"],
        "heldout_effect": block["heldout_effect"],
        "delta_r2": block["delta_r2"],
        "basic_r": block["basic_r"],
        "n_scored_genes": block["n_scored_genes"],
    }


def supported_effects(out_root, collections):

    """Read every association the analysis reproduced on held-out tissue, exported or not.

    The site exports a fraction of the sets that reproduce, so the pathway documents describe a
    block only through the sets it happened to rank into. Deciding what a block points at has to
    read the analysis itself, or the answer is an artefact of the export cap.

    Args:
        out_root (Path): Site root holding ``data/``.
        collections (list): Collection entries from ``collections.json``.

    Returns:
        pd.DataFrame: slug, pathway_id, block_global_index and heldout_effect of supported rows
    """

    frames = []

    for entry in collections:
        slug = entry["slug"]
        root = Path(json.loads((out_root / "data" / slug / "index.json").read_text())["source_root"])
        frame = pd.read_parquet(root / "pathway_transfer_heldout.parquet",
                                columns=["block_global_index", "pathway_id", "heldout_effect", "supported"])
        frame = frame[frame["supported"]].drop(columns=["supported"])
        frame["slug"] = slug
        frames.append(frame)

    return pd.concat(frames, ignore_index=True)


def dominant_sets(effects, drawable):

    """Pick the one set each block's held-out evidence singles out, where the site can show it.

    A block that tracks a dozen sets equally well has told us nothing about any of them, so its
    strongest association counts only when it stands clear of the block's other real ones: its
    |held-out r| must beat the mean of the others above ``MIN_EFFECT`` by a further ``MIN_EFFECT``,
    measured over every set the block reproduces. The winner is then only credited where it has a
    card on that block, since a set with no card has no tiles, genes or colouring to stand on, and
    crediting the block's second choice instead would name a set the evidence did not pick.

    Args:
        effects (pd.DataFrame): Supported rows with slug, pathway_id, block_global_index, heldout_effect.
        drawable (dict): (slug, pathway_id) -> block global indices carded for that set.

    Returns:
        tuple: (block global index as str -> {slug, pathway_id}, counts of blocks by outcome)
    """

    ranked = effects.assign(magnitude=effects["heldout_effect"].abs()).sort_values("magnitude", ascending=False)
    picks = {}
    counts = {"n_blocks_scored": int(ranked["block_global_index"].nunique()), "n_margin": 0, "n_undrawable": 0}

    for global_index, group in ranked.groupby("block_global_index", sort=False):
        magnitudes = group["magnitude"].to_numpy()
        others = magnitudes[1:][magnitudes[1:] > MIN_EFFECT]
        floor = MIN_EFFECT + (others.mean() if len(others) else 0.0)

        if magnitudes[0] <= floor:
            continue

        counts["n_margin"] += 1
        winner = group.iloc[0]
        key = (winner["slug"], winner["pathway_id"])

        if key in drawable and int(global_index) in drawable[key]:
            picks[str(int(global_index))] = {"slug": key[0], "pathway_id": key[1]}
        else:
            counts["n_undrawable"] += 1

    return picks, counts


def block_genes(kept, cards):

    """Collect a block's genes across the sets its cards show.

    Clustering is a property of the block's own tile geometry rather than of the pathway, so the same
    gene carries the same numbers wherever it appears and the first copy is kept. Each gene records the
    set that holds its per-tile values, which is what the tile overlays need, so pooling is restricted
    to the sets that survive the card cut and stay selectable.

    Args:
        kept (list): Association entries the block's cards will show.
        cards (dict): (slug, pathway_id) -> block card for that pathway.

    Returns:
        list: Gene entries ranked by clustering, at most ``GENES_PER_BLOCK`` long.
    """

    seen = {}

    for entry in kept:
        for gene in cards[(entry["slug"], entry["pathway_id"])]["genes"]:
            if gene["symbol"] in seen:
                continue
            seen[gene["symbol"]] = dict(gene, slug=entry["slug"], pathway_id=entry["pathway_id"])

    ranked = sorted(seen.values(), key=lambda gene: -gene["clustering"])

    return ranked[:GENES_PER_BLOCK]


def build(out_root):

    """Write the block-first index next to the per-collection pathway bundles.

    Args:
        out_root (Path): Site root holding ``data/``.

    Returns:
        dict: The index document written.
    """

    collections, documents = load_documents(out_root)
    manifolds = json.loads((out_root / "data" / "manifold" / "block_manifolds_index.json").read_text())
    tiles_of = {entry["block_global_index"]: entry["n_tiles"] for entry in manifolds["blocks"]}

    cards = defaultdict(dict)
    associations = defaultdict(list)
    drawable = defaultdict(set)

    for slug, label, document in documents:
        for block in document["blocks"]:
            cards[block["block_global_index"]][(slug, document["pathway_id"])] = block
            associations[block["block_global_index"]].append(association(slug, label, document, block))
            drawable[(slug, document["pathway_id"])].add(block["block_global_index"])

    picks, outcomes = dominant_sets(supported_effects(out_root, collections), drawable)

    blocks = []

    for global_index, by_pathway in cards.items():
        pathways = sorted(associations[global_index], key=lambda entry: -abs(entry["heldout_effect"]))
        best = pathways[0]["heldout_effect"]

        # a block earns its place by reproducing something on the held-out slides
        if abs(best) <= MIN_EFFECT:
            continue

        first = next(iter(by_pathway.values()))
        kept = pathways[:SETS_PER_BLOCK]
        counts = defaultdict(int)
        for entry in pathways:
            counts[entry["slug"]] += 1

        blocks.append({
            "block_global_index": global_index,
            "layer": first["layer"],
            "group_size": first["group_size"],
            "block": first["block"],
            "dictionary": first["dictionary"],
            "stable_rank": first["stable_rank"],
            "n_tiles": tiles_of.get(global_index, 0),
            "best_effect": best,
            "n_sets": len(pathways),
            "n_pathways": dict(counts),
            "pathways": kept,
            "genes": block_genes(kept, by_pathway),
        })

    # strongest features first, which is the order the list is meant to be scrolled in
    blocks.sort(key=lambda block: -abs(block["best_effect"]))

    # a credited set has a card on its block, so the pathway view always shows that block among its own
    listed = {block["block_global_index"] for block in blocks}
    assert all(int(key) in listed for key in picks), "a block points at a set but is missing from the block list"

    index = {
        "built": datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC"),
        "n_blocks": len(blocks),
        "n_carried": sum(block["n_sets"] for block in blocks),
        "n_shown": sum(len(block["pathways"]) for block in blocks),
        "min_effect": MIN_EFFECT,
        "sets_per_block": SETS_PER_BLOCK,
        "n_dominant": len(picks),
        "collections": [{"slug": entry["slug"], "collection_label": entry["collection_label"]} for entry in collections],
        "blocks": blocks,
    }

    destination = out_root / "data" / "blocks"
    destination.mkdir(parents=True, exist_ok=True)
    write_atomic(destination / "index.json", compact_json(index))

    # both axes grey out what this rule did not pick, and the pathway axis needs it without the index
    write_atomic(destination / "dominance.json", compact_json(dict({
        "built": index["built"],
        "margin": MIN_EFFECT,
        "n_blocks": len(blocks),
        "n_dominant": len(picks),
    }, **outcomes, blocks=picks)))

    return index


def main():

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", default="/home/viraj/yrraadi-io.github.io/interp", help="site root holding data/")
    args = parser.parse_args()

    index = build(Path(args.out))
    dominance = json.loads((Path(args.out) / "data" / "blocks" / "dominance.json").read_text())
    size = (Path(args.out) / "data" / "blocks" / "index.json").stat().st_size

    print(f"{index['n_blocks']} blocks, {index['n_shown']} of {index['n_carried']} reproduced associations shown,"
          f" {size / 1024:.0f} KB")
    print(f"{dominance['n_margin']} of {dominance['n_blocks_scored']} scored blocks single out a set,"
          f" {dominance['n_dominant']} of them onto a set this build exported")


if __name__ == "__main__":
    main()
