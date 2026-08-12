"""Build collection bundles and export their collection-level metadata."""

import argparse
from datetime import datetime
from pathlib import Path
import re

from pipeline.activity import (
    backfill_basic_correlations,
    collect_tile_requests,
    compute_patch_activations,
    export_tile_image,
    gene_patch_maps,
    gene_rankings,
    load_activity,
    load_pathway_tile_scores,
    patch_stats,
    verify_activity,
)
from pipeline.config import (
    DEFAULT_BRITE,
    DEFAULT_OUT,
    DEFAULT_XENIUM,
    MODELS,
    PATCH_GRID,
    TOKENS_PER_TILE,
    bundle_dirs,
    collection_profile,
    load_json,
    model_profile,
    plan_roots,
    resolve_build_paths,
    write_collection_manifest,
    write_json,
)
from pipeline.evidence import (
    card_requirements,
    load_blocks_index,
    load_or_create_plan,
    load_pathway_names,
    published_blocks,
    resolve_plan_path,
    select_pathways,
)
from pipeline.normalize import normalize_collection

BRITE = Path(DEFAULT_BRITE)
KEGG_DIR = Path(DEFAULT_OUT) / "data" / "kegg"


def add_arguments(parser):

    """Add bundle options to an argument parser.

    Args:
        parser (argparse.ArgumentParser): Parser to configure.

    Returns:
        argparse.ArgumentParser: Configured parser.
    """

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
    parser.add_argument("--block-plan", help="published block plan JSON, defaults to data/published_blocks.json")
    parser.add_argument("--refresh-plan", action="store_true", help="derive and replace the published block plan")

    return parser


def assemble_pathways(ordered, payload, block_rankings, pathway_rankings, patches, names, counts, n_tiles, xenium_root, tile_dir):

    """Assemble pathway documents and export their selected tile images.

    Args:
        ordered (list): Pathway identifiers in display order.
        payload (dict): Candidate pathway, block, and tile records.
        block_rankings (dict): Per-pathway feature gene rankings.
        pathway_rankings (dict): Per-pathway positive-score gene rankings.
        patches (dict): Per-block tile patch activations.
        names (dict): Pathway identifier to display name.
        counts (pandas.Series): Supported block counts by pathway.
        n_tiles (int): Tile examples retained per gallery.
        xenium_root (Path): Xenium shard root.
        tile_dir (Path): Shared tile image directory.

    Returns:
        tuple: Completed pathway documents and exported image cache.
    """

    seen = {}
    pathways_out = []

    for pathway in ordered:
        entry = payload[pathway]

        for block in entry["blocks"]:
            ranking = block_rankings[(pathway, block["block_global_index"])]
            block["genes"] = ranking["genes"]
            block["n_scored_genes"] = ranking["n_scored"]

            for tile in block["tiles"]:
                tile.update(patch_stats(patches[(block["block_global_index"], tile["sequence_id"])]))

            block["tiles"] = sorted(block["tiles"], key=lambda item: -item["max_patch"])[:n_tiles]
            for tile in block["tiles"]:
                tile["image"] = export_tile_image(xenium_root, tile["slide_id"], tile["source_h5_row"], tile_dir, seen)

        kept = []
        for tile in entry["score_tiles"]:
            by_block = {}
            for block in entry["blocks"]:
                key = str(block["block_global_index"])
                stats = patch_stats(patches[(block["block_global_index"], tile["sequence_id"])])
                stats["activity"] = tile["activity_by_block"][key]
                by_block[key] = stats

            firing_blocks = sum(1 for stats in by_block.values() if stats["n_firing"] > 0)
            if firing_blocks * 2 < len(by_block):
                continue

            tile.pop("activity_by_block")
            tile["by_block"] = by_block
            tile["n_blocks_firing"] = firing_blocks
            tile["image"] = export_tile_image(xenium_root, tile["slide_id"], tile["source_h5_row"], tile_dir, seen)
            kept.append(tile)

            if len(kept) == n_tiles:
                break

        entry["score_tiles"] = kept
        pathway_ranking = pathway_rankings[pathway]

        pathways_out.append({
            "pathway_id": pathway,
            "name": names[pathway] if pathway in names else pathway,
            "n_supported_blocks": int(counts[pathway]),
            "genes": pathway_ranking["genes"],
            "gene_basis": "positive_pathway_score",
            "n_active_tiles": pathway_ranking["n_active_tiles"],
            "n_pathway_genes": pathway_ranking["n_measured"],
            "blocks": entry["blocks"],
            "score_tiles": entry["score_tiles"],
        })

    return pathways_out, seen


def localize_genes(pathways_out, xenium_root):

    """Attach sparse patch-level gene values to every displayed tile.

    Args:
        pathways_out (list): Completed pathway documents.
        xenium_root (Path): Xenium shard root.

    Returns:
        None
    """

    wanted = []
    for item in pathways_out:
        union = [gene["symbol"] for gene in item["genes"]]
        for block in item["blocks"]:
            symbols = [gene["symbol"] for gene in block["genes"]]
            wanted.extend((tile, symbols) for tile in block["tiles"])

        wanted.extend((tile, union) for tile in item["score_tiles"])

    requests = {}
    for tile, symbols in wanted:
        requests.setdefault((tile["slide_id"], tile["source_h5_row"]), set()).update(symbols)

    print(f"localizing genes in {len(requests)} tiles across {len({slide for slide, _ in requests})} slides", flush=True)
    maps = gene_patch_maps(xenium_root, requests)

    for tile, symbols in wanted:
        entry = maps[(tile["slide_id"], tile["source_h5_row"])]
        tile["gene_patch"] = entry["patch"]
        tile["gene_cells"] = entry["cells"]
        tile["gene_values"] = {symbol: entry["genes"][symbol] for symbol in symbols if symbol in entry["genes"]}


def write_bundle(paths, data_dir, tile_dir, pathways_out, seen, label, model, slug, sets, profile):

    """Write one collection bundle and prune only unreferenced shared tiles.

    Args:
        paths (dict): Resolved build paths.
        data_dir (Path): Collection bundle directory.
        tile_dir (Path): Shared tile image directory.
        pathways_out (list): Completed pathway documents.
        seen (dict): Exported image cache.
        label (str): Bundle display label.
        model (str): Model profile name.
        slug (str): Bundle directory name.
        sets (dict): Collection metadata.
        profile (dict): Model profile.

    Returns:
        None
    """

    pathway_dir = data_dir / "pathways"
    pathway_dir.mkdir(parents=True, exist_ok=True)
    index = {
        "label": label,
        "model": model,
        "slug": slug,
        "collection": sets["name"],
        "collection_label": sets["label"],
        "pathway_url_template": sets["url_template"],
        "encoder_note": profile["encoder"],
        "built": datetime.now().astimezone().strftime("%Y-%m-%d %H:%M %Z"),
        "patch_grid": PATCH_GRID,
        "tokens_per_tile": TOKENS_PER_TILE,
        "source_root": str(paths["root"]),
        "run_root": str(paths["run_root"]),
        "pathways": [{"pathway_id": item["pathway_id"], "name": item["name"], "n_supported_blocks": item["n_supported_blocks"]} for item in pathways_out],
    }

    written = {f"{item['pathway_id']}.json" for item in pathways_out}
    for item in pathways_out:
        write_json(pathway_dir / f"{item['pathway_id']}.json", item)

    for stale in pathway_dir.glob("*.json"):
        if stale.name not in written:
            stale.unlink()

    write_json(data_dir / "index.json", index)
    referenced = sorted({Path(path).name for path in seen.values()})
    write_json(data_dir / "tiles.json", {"tiles": referenced})

    keep = set()
    for directory in bundle_dirs(paths["data"]):
        keep.update(load_json(directory / "tiles.json")["tiles"])

    removed = 0
    for existing in tile_dir.glob("*.jpg"):
        if existing.name not in keep:
            existing.unlink()
            removed += 1

    write_collection_manifest(paths["data"])
    payload_mb = sum(path.stat().st_size for path in pathway_dir.glob("*.json")) / (1024 ** 2)
    print(f"wrote {data_dir / 'index.json'} and {len(pathways_out)} pathway payloads ({payload_mb:.1f} MB), "
          f"{len(seen)} tile images, pruned {removed} stale", flush=True)


def run(args):

    """Run a bundle build from parsed arguments.

    Args:
        args (argparse.Namespace): Parsed bundle options.

    Returns:
        None
    """

    profile = model_profile(args.model)
    paths = resolve_build_paths(profile, args.root, args.run_root, args.xenium, args.out)
    sets = collection_profile(paths["root"], profile)
    label = args.label if args.label else profile["label"]
    slug = args.slug if args.slug else sets["name"]
    data_dir = paths["data"] / slug
    tile_dir = paths["out"] / "tiles"
    data_dir.mkdir(parents=True, exist_ok=True)
    tile_dir.mkdir(parents=True, exist_ok=True)

    if args.basic_correlations_only:
        updated = backfill_basic_correlations(paths["root"], data_dir, profile)
        print(f"updated raw pathway-block correlations in {updated} {slug} bundles", flush=True)
        return

    roots = plan_roots(profile, paths["root"])
    plan_path = resolve_plan_path(paths["data"], args.block_plan)
    block_plan = load_or_create_plan(plan_path, profile, roots, paths["run_root"], args.pathways, args.blocks,
                                     paths["data"], args.refresh_plan)
    blocks = published_blocks(block_plan)
    print(f"published block plan: {len(blocks)} eligible blocks from {plan_path}", flush=True)

    activity_cache = {}
    print(f"verifying {args.model} encoding against the analysis activity", flush=True)
    verify_activity(paths["root"], paths["run_root"], profile, activity_cache, args.verify_tiles)

    blocks_index = load_blocks_index(paths["root"], profile)
    print(f"gene-set collection: {sets['label']} ({sets['name']})", flush=True)
    names = load_pathway_names(paths["root"], sets["name_suffix"])
    required = card_requirements(profile, sets["name"], blocks)
    ordered, per_pathway, counts = select_pathways(paths["root"], args.pathways, args.blocks, required)
    carded = sum(len(rows) for rows in per_pathway.values())
    print(f"selected {len(ordered)} pathways with held-out support, {carded} block cards, of which"
          f" {sum(len(indices) for indices in required.values())} are pairs the feature view cards", flush=True)

    tile_scores = load_pathway_tile_scores(paths["root"], ordered)
    payload, needed, pairs = collect_tile_requests(paths["root"], per_pathway, tile_scores, args.candidates, args.score_candidates,
                                                   activity_cache, blocks_index, profile)
    print(f"{len(needed)} unique dictionary-tile encodes, {len(pairs)} block-tile pairs", flush=True)
    block_rankings, pathway_rankings = gene_rankings(paths["root"], profile, payload, tile_scores, args.genes)

    identity, _ = load_activity(paths["root"], 0, activity_cache)
    split_of = {str(tile): "train" if str(split) == "train" else "held_out" for tile, split in zip(identity["tile_id"], identity["split"])}
    patches = compute_patch_activations(paths["run_root"], needed, pairs, blocks_index, profile, split_of)
    pathways_out, seen = assemble_pathways(ordered, payload, block_rankings, pathway_rankings, patches, names, counts,
                                          args.tiles, paths["xenium"], tile_dir)
    localize_genes(pathways_out, paths["xenium"])
    write_bundle(paths, data_dir, tile_dir, pathways_out, seen, label, args.model, slug, sets, profile)
    normalize_collection(data_dir)


def main(argv=None):

    """Run the standalone bundle compatibility CLI.

    Args:
        argv (list or None): Optional argument vector.

    Returns:
        None
    """

    parser = add_arguments(argparse.ArgumentParser(description="Build the KEGG pathway explorer data bundle"))
    run(parser.parse_args(argv))


def labels(path=BRITE):

    """Parse pathway labels from a BRITE hierarchy.

    Args:
        path (Path): Cached KEGG BRITE hierarchy.

    Returns:
        dict: Pathway identifier to category and class.
    """

    category, klass, found = None, None, {}

    for line in path.read_text().splitlines():
        if line.startswith("A"):
            category = line[1:].strip()
        elif line.startswith("B") and line[1:].strip():
            klass = line[1:].strip()
        elif line.startswith("C"):
            match = re.match(r"C\s+(\d{5})\s+", line)

            if match:
                found[f"hsa{match.group(1)}"] = {"category": category, "class": klass}

    return found


def add_brite_arguments(parser):

    """Add BRITE export options to an argument parser.

    Args:
        parser (argparse.ArgumentParser): Parser to configure.

    Returns:
        argparse.ArgumentParser: Configured parser.
    """

    parser.add_argument("--brite", default=str(BRITE), help="cached KEGG BRITE hierarchy")
    parser.add_argument("--out", default=DEFAULT_OUT, help="site root holding data/")

    return parser


def run_brite(args):

    """Write labels for pathways exported by the KEGG bundle.

    Args:
        args (argparse.Namespace): Parsed BRITE options.

    Returns:
        None
    """

    kegg_dir = Path(args.out) / "data" / "kegg"
    exported = [entry["pathway_id"] for entry in load_json(kegg_dir / "index.json")["pathways"]]
    known = labels(Path(args.brite))
    kept = {pathway: known[pathway] for pathway in sorted(exported) if pathway in known}
    write_json(kegg_dir / "brite.json", kept, sort_keys=True)

    missing = [pathway for pathway in exported if pathway not in known]
    print(f"wrote {kegg_dir / 'brite.json'}: {len(kept)} of {len(exported)} exported maps labelled, "
          f"{len(set(entry['category'] for entry in kept.values()))} categories, "
          f"{len(set(entry['class'] for entry in kept.values()))} classes", flush=True)

    if missing:
        print(f"unlabelled: {', '.join(missing)}", flush=True)


def brite_main(argv=None):

    """Run the standalone BRITE compatibility CLI.

    Args:
        argv (list or None): Optional argument vector.

    Returns:
        None
    """

    parser = add_brite_arguments(argparse.ArgumentParser(description="Export KEGG BRITE category and class labels for published pathways."))
    run_brite(parser.parse_args(argv))
