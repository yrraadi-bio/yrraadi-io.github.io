"""Invert the built pathway bundle into a block-first index, so the explorer can be browsed by block."""

import argparse
import json
from collections import defaultdict
from datetime import datetime
from pathlib import Path

import dominance
from build_site_data import COLLECTIONS, compact_json, load_pathway_names, write_atomic
from dominance import MIN_EFFECT, SETS_PER_BLOCK

# pooled over the sets a block shows, and held to the same count a single card carries in the other view
GENES_PER_BLOCK = 12


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


def collection_sources(out_root, collections):

    """Resolve each collection's analysis root and its display names.

    Args:
        out_root (Path): Site root holding ``data/``.
        collections (list): Collection entries from ``collections.json``.

    Returns:
        dict: slug -> {label, root, names}
    """

    sources = {}

    for entry in collections:
        index = json.loads((out_root / "data" / entry["slug"] / "index.json").read_text())
        root = Path(index["source_root"])
        names = load_pathway_names(root, COLLECTIONS[index["collection"]]["name_suffix"])
        sources[entry["slug"]] = {"label": entry["collection_label"], "root": root, "names": names}

    return sources


def reproduced_sets(effects, sources):

    """List every set each block reproduces above the floor, drawn from the analysis not the bundle.

    The bundle exports a fraction of the sets that reproduce, so a card list read off it would show a
    block a single weak set and then grey it for losing to sets the reader cannot see. The evidence the
    greying rule weighs is listed instead, and the cut to what the bundle exported is made afterwards.

    Args:
        effects (pd.DataFrame): Supported rows carrying train_effect and delta_r2.
        sources (dict): slug -> {label, root, names} from :func:`collection_sources`.

    Returns:
        dict: block global index -> association entries ranked by |held-out r|
    """

    associations = defaultdict(list)

    for row in dominance.ranked(effects).itertuples(index=False):
        source = sources[row.key]

        associations[int(row.block_global_index)].append({
            "slug": row.key,
            "collection_label": source["label"],
            "pathway_id": row.pathway_id,
            "name": source["names"][row.pathway_id],
            "train_effect": round(float(row.train_effect), 4),
            "heldout_effect": round(float(row.heldout_effect), 4),
            "delta_r2": round(float(row.delta_r2), 5),
        })

    return associations


def dominant_sets(effects, carded, shown):

    """Read the set each block points at and keep the ones the site can actually show.

    The rule itself is read from the analysis rather than from the documents, since the site exports
    a fraction of the sets that reproduce and a rule read off the documents could only ever nominate
    a block for a set it already ranked into. A winner is credited only where it has a card on that
    block, because a set with no card has no tiles, genes or colouring to stand on; the bundle build
    forces those cards, so an uncredited block means the analysis and the bundle disagree.

    Args:
        effects (pd.DataFrame): Supported rows from :func:`dominance.supported_effects`.
        carded (dict): (slug, pathway_id) -> block global indices carded for that set.
        shown (set): Block global indices the block list holds.

    Returns:
        tuple: (block global index as str -> {slug, pathway_id}, counts of blocks by outcome)
    """

    picks = dominance.winners(effects)

    kept = {str(global_index): {"slug": slug, "pathway_id": pathway} for global_index, (slug, pathway) in picks.items()
            if global_index in carded[(slug, pathway)] and global_index in shown}

    counts = {"n_blocks_scored": int(effects["block_global_index"].nunique()), "n_margin": len(picks),
              "n_unlisted": len(picks) - len(kept)}

    return kept, counts


def block_genes(shown, cards):

    """Collect a block's genes across the sets its cards show.

    Clustering is a property of the block's own tile geometry rather than of the pathway, so the same
    gene carries the same numbers wherever it appears and the first copy is kept. Each gene records the
    set that holds its per-tile values, which is what the tile overlays need, so pooling is restricted
    to the sets the block cards and the reader can therefore select.

    Args:
        shown (list): The block's carded association entries.
        cards (dict): (slug, pathway_id) -> block card for that pathway.

    Returns:
        list: Gene entries ranked by clustering, at most ``GENES_PER_BLOCK`` long.
    """

    seen = {}

    for entry in shown:
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

    cards = {}
    carded = defaultdict(set)

    for slug, label, document in documents:
        for block in document["blocks"]:
            cards.setdefault(block["block_global_index"], {})[(slug, document["pathway_id"])] = block
            carded[(slug, document["pathway_id"])].add(block["block_global_index"])

    sources = collection_sources(out_root, collections)
    effects = dominance.supported_effects([(slug, source["root"]) for slug, source in sources.items()],
                                          extra=("train_effect", "delta_r2"))

    associations = reproduced_sets(effects, sources)
    blocks = []

    for global_index, pathways in associations.items():

        # a block firing on a couple of dozen tiles has no manifold and so nothing to browse
        if global_index not in tiles_of:
            continue

        # the same cut the bundle build exported cards for, while the greying rule still weighs every
        # set above the floor. indexing the cards rather than testing them is deliberate: a missing
        # pair means the two builds ranked the same effects differently, which is a build to redo
        shown = pathways[:SETS_PER_BLOCK]
        by_pathway = cards[global_index]

        for entry in shown:
            card = by_pathway[(entry["slug"], entry["pathway_id"])]
            entry.update(basic_r=card["basic_r"], n_scored_genes=card["n_scored_genes"])

        first = next(iter(by_pathway.values()))
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
            "n_tiles": tiles_of[global_index],
            "best_effect": pathways[0]["heldout_effect"],
            "n_sets": len(pathways),
            "n_cards": len(shown),
            "n_pathways": dict(counts),
            "pathways": shown,
            "genes": block_genes(shown, by_pathway),
        })

    # strongest features first, which is the order the list is meant to be scrolled in
    blocks.sort(key=lambda block: -abs(block["best_effect"]))

    listed = {block["block_global_index"] for block in blocks}
    picks, outcomes = dominant_sets(effects, carded, listed)

    index = {
        "built": datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC"),
        "n_blocks": len(blocks),
        "n_carried": sum(block["n_sets"] for block in blocks),
        "n_cards": sum(block["n_cards"] for block in blocks),
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
    picked = json.loads((Path(args.out) / "data" / "blocks" / "dominance.json").read_text())
    size = (Path(args.out) / "data" / "blocks" / "index.json").stat().st_size

    print(f"{index['n_blocks']} blocks, {index['n_cards']} cards over {index['n_carried']} reproduced"
          f" associations, {size / 1024:.0f} KB")
    print(f"{picked['n_margin']} of {picked['n_blocks_scored']} scored blocks single out a set,"
          f" {picked['n_dominant']} of them blocks this site lists")


if __name__ == "__main__":
    main()
