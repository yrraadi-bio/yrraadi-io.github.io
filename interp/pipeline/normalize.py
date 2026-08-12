"""Deduplicate pathway payloads into compact collection-level shared stores."""

import argparse
import gzip
import hashlib
import json
from pathlib import Path

from pipeline.config import DEFAULT_OUT, load_json, write_atomic, write_json

PATHWAY_SCHEMA = 2
SHARED_SCHEMA = 1
STATIC_TILE_FIELDS = ("sequence_id", "slide_id", "source_h5_row", "tissue", "split", "image", "gene_patch", "gene_cells")
ACTIVATION_FIELDS = ("activity", "patches", "max_patch", "mean_patch", "n_firing", "peak_to_mean")


def new_pool():

    """Create empty tile and activation intern tables.

    Returns:
        dict: Mutable normalization pool.
    """

    return {"tiles": [], "tile_index": {}, "activations": [], "activation_index": {}}


def merge_gene_values(target, incoming, identity):

    """Merge one tile's sparse gene channels without changing values.

    Args:
        target (dict): Pooled symbol-to-values mapping.
        incoming (dict): New symbol-to-values mapping.
        identity (tuple): Tile identity used in validation errors.

    Returns:
        None
    """

    for symbol, values in incoming.items():
        if symbol in target and target[symbol] != values:
            raise ValueError(f"gene values disagree for {identity} and {symbol}")
        target[symbol] = values


def intern_tile(tile, pool):

    """Intern one physical tile and merge its requested gene channels.

    Args:
        tile (dict): Expanded tile record.
        pool (dict): Mutable normalization pool.

    Returns:
        int: Tile pool index.
    """

    identity = (tile["slide_id"], int(tile["source_h5_row"]))
    if identity not in pool["tile_index"]:
        record = {field: tile[field] for field in STATIC_TILE_FIELDS}
        record["gene_values"] = dict(tile["gene_values"])
        pool["tile_index"][identity] = len(pool["tiles"])
        pool["tiles"].append(record)

        return pool["tile_index"][identity]

    index = pool["tile_index"][identity]
    record = pool["tiles"][index]
    for field in STATIC_TILE_FIELDS:
        if record[field] != tile[field]:
            raise ValueError(f"tile field {field} disagrees for {identity}")

    merge_gene_values(record["gene_values"], tile["gene_values"], identity)

    return index


def intern_activation(tile, block_index, pool):

    """Intern one block activation over one tile.

    Args:
        tile (dict): Expanded tile record carrying patch activation fields.
        block_index (int): Global block index.
        pool (dict): Mutable normalization pool.

    Returns:
        int: Activation pool index.
    """

    tile_index = intern_tile(tile, pool)
    identity = (tile_index, int(block_index))
    candidate = {"tile": tile_index, "block": int(block_index)}
    candidate.update({field: tile[field] for field in ACTIVATION_FIELDS})

    if identity not in pool["activation_index"]:
        pool["activation_index"][identity] = len(pool["activations"])
        pool["activations"].append(candidate)

        return pool["activation_index"][identity]

    index = pool["activation_index"][identity]
    if pool["activations"][index] != candidate:
        raise ValueError(f"activation fields disagree for tile {tile_index} and block {block_index}")

    return index


def normalize_document(document, pool):

    """Replace repeated tile payloads with shared-pool references.

    Args:
        document (dict): Expanded pathway document.
        pool (dict): Mutable collection normalization pool.

    Returns:
        dict: Schema-versioned normalized pathway document.
    """

    normalized = {key: value for key, value in document.items() if key not in ("blocks", "score_tiles")}
    normalized["schema_version"] = PATHWAY_SCHEMA
    normalized["shared"] = ""
    normalized["blocks"] = []

    for block in document["blocks"]:
        block_index = int(block["block_global_index"])
        compact_block = {key: value for key, value in block.items() if key != "tiles"}
        compact_block["tiles"] = []

        for tile in block["tiles"]:
            compact_block["tiles"].append({
                "tile": intern_tile(tile, pool),
                "activation": intern_activation(tile, block_index, pool),
                "pathway_score": tile["pathway_score"],
            })

        normalized["blocks"].append(compact_block)

    normalized["score_tiles"] = []
    for tile in document["score_tiles"]:
        activations = [intern_activation(dict(tile, **values), int(block_index), pool)
                       for block_index, values in tile["by_block"].items()]
        normalized["score_tiles"].append({
            "tile": intern_tile(tile, pool),
            "pathway_score": tile["pathway_score"],
            "activations": activations,
            "n_blocks_firing": tile["n_blocks_firing"],
        })

    return normalized


def projected_tile(shared, tile_index, symbols):

    """Materialize one tile with only the genes its pathway card requested.

    Args:
        shared (dict): Expanded shared collection payload.
        tile_index (int): Tile pool index.
        symbols (list): Gene symbols requested by the card.

    Returns:
        dict: Expanded tile fields.
    """

    source = shared["tiles"][tile_index]
    tile = {field: source[field] for field in STATIC_TILE_FIELDS}
    tile["gene_values"] = {symbol: source["gene_values"][symbol] for symbol in symbols if symbol in source["gene_values"]}

    return tile


def activation_fields(shared, activation_index, tile_index, block_index):

    """Materialize and validate one pooled activation.

    Args:
        shared (dict): Expanded shared collection payload.
        activation_index (int): Activation pool index.
        tile_index (int): Expected tile pool index.
        block_index (int): Expected global block index.

    Returns:
        dict: Patch activation fields.
    """

    source = shared["activations"][activation_index]
    if source["tile"] != tile_index or source["block"] != block_index:
        raise ValueError(f"activation {activation_index} does not match tile {tile_index} and block {block_index}")

    return {field: source[field] for field in ACTIVATION_FIELDS}


def expand_document(document, shared):

    """Expand one normalized pathway document to the runtime-compatible shape.

    Args:
        document (dict): Normalized pathway document.
        shared (dict): Expanded shared collection payload.

    Returns:
        dict: Original denormalized pathway shape.
    """

    if document["schema_version"] != PATHWAY_SCHEMA:
        raise ValueError(f"unsupported pathway schema {document['schema_version']}")
    if shared["schema_version"] != SHARED_SCHEMA:
        raise ValueError(f"unsupported shared schema {shared['schema_version']}")

    expanded = {key: value for key, value in document.items() if key not in ("schema_version", "shared", "blocks", "score_tiles")}
    expanded["blocks"] = []

    for block in document["blocks"]:
        block_index = int(block["block_global_index"])
        symbols = [gene["symbol"] for gene in block["genes"]]
        expanded_block = {key: value for key, value in block.items() if key != "tiles"}
        expanded_block["tiles"] = []

        for reference in block["tiles"]:
            tile = projected_tile(shared, reference["tile"], symbols)
            tile["pathway_score"] = reference["pathway_score"]
            tile.update(activation_fields(shared, reference["activation"], reference["tile"], block_index))
            expanded_block["tiles"].append(tile)

        expanded["blocks"].append(expanded_block)

    symbols = [gene["symbol"] for gene in document["genes"]]
    expanded["score_tiles"] = []
    for reference in document["score_tiles"]:
        tile = projected_tile(shared, reference["tile"], symbols)
        tile["pathway_score"] = reference["pathway_score"]
        tile["by_block"] = {}

        for activation_index in reference["activations"]:
            activation = shared["activations"][activation_index]
            tile["by_block"][str(activation["block"])] = activation_fields(
                shared, activation_index, reference["tile"], activation["block"])

        tile["n_blocks_firing"] = reference["n_blocks_firing"]
        expanded["score_tiles"].append(tile)

    return expanded


def load_shared(path):

    """Load one deterministic gzip-compressed shared payload.

    Args:
        path (Path): Shared payload path.

    Returns:
        dict: Parsed shared payload.
    """

    return json.loads(gzip.decompress(path.read_bytes()))


def expand_from_collection(document, data_dir, cache):

    """Expand a document when normalized and pass legacy documents through.

    Args:
        document (dict): Pathway document in either supported shape.
        data_dir (Path): Collection data directory.
        cache (dict): Shared filename to parsed payload cache.

    Returns:
        dict: Expanded pathway document.
    """

    if "schema_version" not in document:
        return document

    name = document["shared"]
    if name not in cache:
        cache[name] = load_shared(data_dir / name)

    return expand_document(document, cache[name])


def shared_bytes(pool):

    """Encode and compress the populated collection pools deterministically.

    Args:
        pool (dict): Populated normalization pool.

    Returns:
        tuple: Parsed shared payload and compressed bytes.
    """

    shared = {"schema_version": SHARED_SCHEMA, "tiles": pool["tiles"], "activations": pool["activations"]}
    payload = json.dumps(shared, separators=(",", ":"), allow_nan=False).encode()

    return shared, gzip.compress(payload, compresslevel=9, mtime=0)


def normalize_collection(data_dir):

    """Normalize every pathway document in one collection atomically.

    Args:
        data_dir (Path): Collection directory containing ``pathways/``.

    Returns:
        dict: File counts and byte-size summary.
    """

    paths = sorted((data_dir / "pathways").glob("*.json"))
    if not paths:
        raise FileNotFoundError(f"no pathway documents under {data_dir / 'pathways'}")

    before_names = set()
    before = sum(path.stat().st_size for path in paths)
    old_shared = {}
    pool = new_pool()
    prepared = []

    for path in paths:
        source = load_json(path)
        if "schema_version" in source:
            before_names.add(source["shared"])
        expanded = expand_from_collection(source, data_dir, old_shared)
        normalized = normalize_document(expanded, pool)
        prepared.append((path, expanded, normalized))

    before += sum((data_dir / name).stat().st_size for name in before_names)
    shared, compressed = shared_bytes(pool)

    for _, expanded, normalized in prepared:
        if expand_document(normalized, shared) != expanded:
            raise ValueError(f"normalization changed pathway {expanded['pathway_id']}")

    digest = hashlib.sha256(compressed).hexdigest()
    shared_name = f"shared-{digest}.json.gz"
    shared_path = data_dir / shared_name
    if not shared_path.is_file():
        write_atomic(shared_path, compressed)

    for path, _, normalized in prepared:
        normalized["shared"] = shared_name
        write_json(path, normalized)

    for stale in data_dir.glob("shared-*.json.gz"):
        if stale != shared_path:
            stale.unlink()

    after = shared_path.stat().st_size + sum(path.stat().st_size for path in paths)
    summary = {
        "documents": len(paths),
        "tiles": len(pool["tiles"]),
        "activations": len(pool["activations"]),
        "before": before,
        "after": after,
        "shared": shared_name,
    }
    reduction = 100 * (before - after) / before
    print(f"normalized {len(paths)} {data_dir.name} documents: {before / (1024 ** 2):.1f} -> "
          f"{after / (1024 ** 2):.1f} MB ({reduction:.1f}% smaller)", flush=True)

    return summary


def add_arguments(parser):

    """Add normalization options to an argument parser.

    Args:
        parser (argparse.ArgumentParser): Parser to configure.

    Returns:
        argparse.ArgumentParser: Configured parser.
    """

    parser.add_argument("--out", default=DEFAULT_OUT, help="site root holding data/")
    parser.add_argument("--slug", action="append", help="collection slug to normalize; repeat for several")

    return parser


def run(args):

    """Normalize selected collections from parsed arguments.

    Args:
        args (argparse.Namespace): Parsed normalization options.

    Returns:
        None
    """

    data_root = Path(args.out) / "data"
    slugs = args.slug
    if slugs is None:
        slugs = [entry["slug"] for entry in load_json(data_root / "collections.json")["collections"]]

    for slug in slugs:
        normalize_collection(data_root / slug)


def main(argv=None):

    """Run the standalone normalization CLI.

    Args:
        argv (list or None): Optional argument vector.

    Returns:
        None
    """

    parser = add_arguments(argparse.ArgumentParser(description=__doc__))
    run(parser.parse_args(argv))


if __name__ == "__main__":
    main()
