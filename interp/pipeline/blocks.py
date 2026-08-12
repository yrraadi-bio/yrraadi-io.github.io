"""Build and audit the block-first site index."""

import argparse
from collections import defaultdict
from datetime import datetime
from pathlib import Path

from pipeline.config import COLLECTIONS, DEFAULT_OUT, load_json, write_json
from pipeline.evidence import MIN_EFFECT, SETS_PER_BLOCK, load_pathway_names, ranked, supported_effects, winners
from pipeline.normalize import expand_from_collection

GENES_PER_BLOCK = 12


def load_documents(out_root):

    """Read every built collection pathway document.

    Args:
        out_root (Path): Site root holding ``data``.

    Returns:
        tuple: Collection entries and ``(slug, label, document)`` rows.
    """

    collections = load_json(out_root / "data" / "collections.json")["collections"]
    documents = []

    for entry in collections:
        slug = entry["slug"]
        for path in sorted((out_root / "data" / slug / "pathways").glob("*.json")):
            documents.append((slug, entry["collection_label"], load_json(path)))

    return collections, documents


def collection_sources(out_root, collections):

    """Resolve collection analysis roots and display names.

    Args:
        out_root (Path): Site root holding ``data``.
        collections (list): Collection manifest entries.

    Returns:
        dict: Slug to label, root, and pathway names.
    """

    sources = {}

    for entry in collections:
        index = load_json(out_root / "data" / entry["slug"] / "index.json")
        root = Path(index["source_root"])
        names = load_pathway_names(root, COLLECTIONS[index["collection"]]["name_suffix"])
        sources[entry["slug"]] = {"label": entry["collection_label"], "root": root, "names": names}

    return sources


def reproduced_sets(effects, sources):

    """Build ranked association records from full analysis evidence.

    Args:
        effects (pandas.DataFrame): Supported association rows.
        sources (dict): Collection source metadata.

    Returns:
        dict: Block global index to ranked association records.
    """

    associations = defaultdict(list)

    for row in ranked(effects).itertuples(index=False):
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

    """Keep dominance winners whose cards are published.

    Args:
        effects (pandas.DataFrame): Supported association rows.
        carded (dict): Set key to carded block indices.
        shown (set): Listed block global indices.

    Returns:
        tuple: Published winners and outcome counts.
    """

    picks = winners(effects)
    kept, uncarded = {}, 0

    for global_index, sets in picks.items():
        if global_index not in shown:
            continue

        drawn = [{"slug": slug, "pathway_id": pathway} for slug, pathway in sets if global_index in carded[(slug, pathway)]]
        uncarded += len(sets) - len(drawn)

        if drawn:
            kept[str(global_index)] = drawn

    counts = {"n_blocks_scored": int(effects["block_global_index"].nunique()), "n_margin": len(picks),
              "n_unlisted": len(picks) - len(kept), "n_lit": sum(len(sets) for sets in kept.values()),
              "n_uncarded": uncarded}

    return kept, counts


def block_genes(shown, cards):

    """Pool a block's genes over the set cards it shows.

    Args:
        shown (list): Carded association entries.
        cards (dict): Set key to block card.

    Returns:
        list: Genes ranked by clustering.
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

    """Write the block-first and dominance indices.

    Args:
        out_root (Path): Site root holding ``data``.

    Returns:
        dict: Block-first index document.
    """

    collections, documents = load_documents(out_root)
    manifolds = load_json(out_root / "data" / "manifold" / "block_manifolds_index.json")
    tiles_of = {entry["block_global_index"]: entry["n_tiles"] for entry in manifolds["blocks"]}
    cards = {}
    carded = defaultdict(set)

    for slug, _, document in documents:
        for block in document["blocks"]:
            cards.setdefault(block["block_global_index"], {})[(slug, document["pathway_id"])] = block
            carded[(slug, document["pathway_id"])].add(block["block_global_index"])

    sources = collection_sources(out_root, collections)
    effects = supported_effects([(slug, source["root"]) for slug, source in sources.items()],
                                extra=("train_effect", "delta_r2"))
    associations = reproduced_sets(effects, sources)
    blocks = []

    for global_index, pathways in associations.items():
        if global_index not in tiles_of:
            continue

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
    write_json(destination / "index.json", index)
    write_json(destination / "dominance.json", dict({
        "built": index["built"],
        "margin": MIN_EFFECT,
        "n_blocks": len(blocks),
        "n_dominant": len(picks),
    }, **outcomes, blocks=picks))

    return index


def add_arguments(parser):

    """Add block-index options to an argument parser.

    Args:
        parser (argparse.ArgumentParser): Parser to configure.

    Returns:
        argparse.ArgumentParser: Configured parser.
    """

    parser.add_argument("--out", default=DEFAULT_OUT, help="site root holding data/")

    return parser


def run(args):

    """Run a block-index build from parsed arguments.

    Args:
        args (argparse.Namespace): Parsed block options.

    Returns:
        None
    """

    out_root = Path(args.out)
    index = build(out_root)
    picked = load_json(out_root / "data" / "blocks" / "dominance.json")
    size = (out_root / "data" / "blocks" / "index.json").stat().st_size
    print(f"{index['n_blocks']} blocks, {index['n_cards']} cards over {index['n_carried']} reproduced"
          f" associations, {size / 1024:.0f} KB")
    print(f"{picked['n_margin']} of {picked['n_blocks_scored']} scored blocks single out at least one set,"
          f" {picked['n_dominant']} of them blocks this site lists, {picked['n_lit']} cards lit,"
          f" {picked['n_uncarded']} winners below the card cut")


def main(argv=None):

    """Run the standalone block-index compatibility CLI.

    Args:
        argv (list or None): Optional argument vector.

    Returns:
        None
    """

    parser = add_arguments(argparse.ArgumentParser(description="Build the block-first index from collection bundles and manifolds."))
    run(parser.parse_args(argv))


def load(path):

    """Read one JSON document.

    Args:
        path (Path): JSON file to read.

    Returns:
        dict: Parsed document.
    """

    return load_json(path)


def check_blocks(data, problems):

    """Check block indices against manifolds, cards, and dominance.

    Args:
        data (Path): Site ``data`` directory.
        problems (list): Collected problem strings.

    Returns:
        dict: Block-first index.
    """

    index = load_json(data / "blocks" / "index.json")
    picks = load_json(data / "blocks" / "dominance.json")["blocks"]
    manifolds = {entry["block_global_index"]: entry for entry in load_json(data / "manifold" / "block_manifolds_index.json")["blocks"]}
    documents = {}

    for manifold in manifolds.values():
        path = data / "manifold" / "block_manifolds" / f"{manifold['key']}.json"
        if not path.is_file():
            problems.append(f"feature #{manifold['block_global_index']}: manifold file is missing")
            continue

        document = load_json(path)
        label = f"feature #{manifold['block_global_index']}"
        if document["block_global_index"] != manifold["block_global_index"]:
            problems.append(f"{label}: manifold file identifies a different feature")
        if document["n_tiles"] != manifold["n_tiles"]:
            problems.append(f"{label}: manifold index and file disagree on tile count")
        for field in ("tile_rows", "x", "y", "z", "activation"):
            if len(document[field]) != document["n_tiles"]:
                problems.append(f"{label}: {field} does not cover every manifold tile")

    for block in index["blocks"]:
        global_index = block["block_global_index"]
        label = f"#{block['layer']}-{block['block']}"

        if global_index not in manifolds:
            problems.append(f"{label}: listed with no tile manifold")

        if not block["pathways"]:
            problems.append(f"{label}: no set carded, the page cannot open")

        for entry in block["pathways"]:
            key = (entry["slug"], entry["pathway_id"])
            if key not in documents:
                path = data / entry["slug"] / "pathways" / f"{entry['pathway_id']}.json"
                documents[key] = load_json(path) if path.is_file() else None

            document = documents[key]

            if document is None:
                problems.append(f"{label}: carded {entry['pathway_id']} has no document")
            elif not any(card["block_global_index"] == global_index for card in document["blocks"]):
                problems.append(f"{label}: {entry['pathway_id']} is carded but its document holds no card for it")

        carded = {entry["pathway_id"] for entry in block["pathways"]}
        for gene in block["genes"]:
            if gene["pathway_id"] not in carded:
                problems.append(f"{label}: gene {gene['symbol']} points at uncarded {gene['pathway_id']}")

    listed = {block["block_global_index"]: block for block in index["blocks"]}

    for key, credited in picks.items():
        if int(key) not in listed:
            problems.append(f"dominance credits block {key} that the list does not hold")
            continue

        carded = {entry["pathway_id"] for entry in listed[int(key)]["pathways"]}
        for pick in credited:
            if pick["pathway_id"] not in carded:
                problems.append(f"dominance credits block {key} for {pick['pathway_id']}, which it does not card")

    return index


def check_pathways(data, problems):

    """Check collection bundles against their pathway colourings.

    Args:
        data (Path): Site ``data`` directory.
        problems (list): Collected problem strings.

    Returns:
        int: Pathway documents checked.
    """

    collections = load_json(data / "collections.json")["collections"]
    n_blocks = load_json(data / "manifold" / "blocks.json")["n_blocks"]
    n_tiles = load_json(data / "manifold" / "tiles.json")["n_tiles"]
    gene_colours = {path.stem for path in (data / "manifold" / "genes").glob("*.json")}
    tile_genes = {path.stem for path in (data / "manifold" / "tile_genes").glob("*.json")}
    seen = 0

    for entry in collections:
        slug = entry["slug"]
        collection_dir = data / slug
        index = load_json(collection_dir / "index.json")
        coords = {path.stem for path in (collection_dir / "manifold" / "pathways").glob("*.json")}
        tile_scores = {path.stem for path in (collection_dir / "manifold" / "tile_pathways").glob("*.json")}
        shared = {}

        for pathway in index["pathways"]:
            pathway_id = pathway["pathway_id"]
            path = data / slug / "pathways" / f"{pathway['pathway_id']}.json"

            if not path.is_file():
                problems.append(f"{slug}/{pathway_id}: listed with no document")
                continue

            document = expand_from_collection(load_json(path), collection_dir, shared)
            seen += 1

            if not document["blocks"]:
                problems.append(f"{slug}/{pathway_id}: document holds no cards")
            if document["gene_basis"] != "positive_pathway_score":
                problems.append(f"{slug}/{pathway_id}: pathway genes are not ranked on positive pathway-score tiles")

            selectable_genes = {gene["symbol"] for gene in document["genes"]}
            for block in document["blocks"]:
                selectable_genes.update(gene["symbol"] for gene in block["genes"])

            for symbol in selectable_genes:
                if symbol not in gene_colours:
                    problems.append(f"{slug}/{pathway_id}: selectable gene {symbol} has no cross-feature colouring")
                if symbol not in tile_genes:
                    problems.append(f"{slug}/{pathway_id}: selectable gene {symbol} has no per-tile expression")

            if pathway_id not in coords:
                problems.append(f"{slug}/{pathway_id}: no manifold colouring exported")
            else:
                colouring = load_json(collection_dir / "manifold" / "pathways" / f"{pathway_id}.json")
                if colouring["pathway_id"] != pathway_id:
                    problems.append(f"{slug}/{pathway_id}: manifold colouring identifies a different pathway")
                if len(colouring["values"]) != n_blocks:
                    problems.append(f"{slug}/{pathway_id}: manifold colouring does not cover every feature")

            if pathway_id not in tile_scores:
                problems.append(f"{slug}/{pathway_id}: no per-tile pathway scores exported")
            else:
                scores = load_json(collection_dir / "manifold" / "tile_pathways" / f"{pathway_id}.json")
                if scores["pathway_id"] != pathway_id:
                    problems.append(f"{slug}/{pathway_id}: per-tile scores identify a different pathway")
                if scores["n_tiles"] != n_tiles or len(scores["values"]) != n_tiles:
                    problems.append(f"{slug}/{pathway_id}: per-tile scores do not cover every tile")

    return seen


def add_audit_arguments(parser):

    """Add audit options to an argument parser.

    Args:
        parser (argparse.ArgumentParser): Parser to configure.

    Returns:
        argparse.ArgumentParser: Configured parser.
    """

    parser.add_argument("--out", default=DEFAULT_OUT, help="site root holding data/")

    return parser


def run_audit(args):

    """Run the site audit from parsed arguments.

    Args:
        args (argparse.Namespace): Parsed audit options.

    Returns:
        None
    """

    data = Path(args.out) / "data"
    problems = []
    index = check_blocks(data, problems)
    pathways = check_pathways(data, problems)
    print(f"{index['n_blocks']} features, {index['n_cards']} feature cards and {pathways} gene set"
          f" documents checked")

    if problems:
        for problem in problems[:40]:
            print(f"  {problem}")
        print(f"{len(problems)} problems")
        raise SystemExit(1)

    print("no problems")


def audit_main(argv=None):

    """Run the standalone audit compatibility CLI.

    Args:
        argv (list or None): Optional argument vector.

    Returns:
        None
    """

    parser = add_audit_arguments(argparse.ArgumentParser(description="Audit every document and cross-link reachable by the explorer."))
    run_audit(parser.parse_args(argv))
